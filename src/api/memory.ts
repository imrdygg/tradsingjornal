/**
 * The chart-embedding endpoint.
 *
 * One job: take a compressed chart screenshot, ask Google's multimodal embedding model for a vector,
 * hand the vector back as numbers. The client never performs this call itself, because that would
 * put the API key in the browser — the same reason the coach's key lives here.
 *
 * It is a separate function from `api/coach.ts` rather than another mode on it, for three reasons:
 *
 *   1. **The quotas must not be shared.** A backfill spends one call PER PICTURE, so a library of two
 *      hundred charts is two hundred calls. If those were spent from the coach's allowance, indexing
 *      a library would lock the trader out of their own coach for the rest of the hour, which is a
 *      self-inflicted outage with no upside. This endpoint keeps its own counter.
 *   2. **The guardrails are different.** The coach's prompt is strict about never forecasting, and
 *      those rules are enforced by tests. Embedding has no prompt and no opinion; keeping it out of
 *      that file is what stops its rules being loosened to accommodate something unrelated.
 *   3. **The failure modes are different.** Embedding a backfill must be resumable, bounded and
 *      quiet; a coach answer is a single request with an answer.
 *
 * What IS shared is the access control: `authorize` and `createRateLimiter` are imported from the
 * coach module rather than reimplemented, because a second implementation of session verification is
 * a second place for it to be wrong. That does mean this function's bundle contains the coach's
 * module graph; it stays dependency-free, because the coach is dependency-free by construction. See
 * `scripts/bundle-coach.ts`.
 *
 * The handler is deliberately dependency-free: it talks to the embedding API with `fetch` so the
 * host's TypeScript function build has nothing to do. See the note at the top of `coach.ts`.
 */

import {
  ENDPOINT_VERSION,
  authorize,
  createRateLimiter,
  isRetryable,
  bearerToken,
  clientIp,
  supabaseAuthConfig,
} from './coach';
import { MAX_COACH_IMAGE_DATA_CHARS, readCoachImages } from '../lib/ai/coach-images';
import {
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from '../lib/memory/embeddings';
import { MEMORY_MAX_IMAGES_PER_REQUEST } from '../lib/memory/embedding-wire';

// `tsconfig.json` restricts global types to vite/client, so Node's globals are not declared.
// Declaring just what this function needs keeps Node types out of the frontend typecheck, where
// `process` should not be available. Module-scoped, so it does not collide with the same
// declaration in `coach.ts`.
declare const process: { env: Record<string, string | undefined> };

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** The version this endpoint reports on its health check. */
export const MEMORY_ENDPOINT_VERSION = 1;

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Attempts per picture. Small on purpose: the caller retries too, and a poison picture is worse. */
const MAX_ATTEMPTS = 3;

/** How long to wait after a retryable failure when the provider did not say. */
const RETRY_BASE_MS = 700;

/** The longest a retry may wait: a provider asking for an hour must not park the run for one. */
const RETRY_MAX_MS = 30_000;

const HOUR_MS = 60 * 60 * 1000;

/** One identity's ceiling. Generous, because a backfill is legitimate and spends per picture. */
const DEFAULT_USER_LIMIT = 600;
/**
 * The anonymous ceiling, used only where this deployment cannot identify anyone at all. Far tighter,
 * because there is no account to hold responsible for the spend.
 */
const DEFAULT_ANON_LIMIT = 20;
const DEFAULT_MAX_IN_FLIGHT = 2;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface MemoryRateRules {
  user: { limit: number; windowMs: number };
  anon: { limit: number; windowMs: number };
  maxInFlight: number;
}

/**
 * This endpoint's own limits, deliberately not the coach's.
 *
 * `MEMORY_RATE_LIMIT` and friends rather than `COACH_*`, so the two budgets can be reasoned about and
 * tuned separately: a backfill must be able to spend hundreds of calls without eating the thirty an
 * hour the coach allows. A bad value falls back to the default rather than disabling the limit.
 */
function memoryRateRules(env: Record<string, string | undefined> = process.env): MemoryRateRules {
  return {
    user: { limit: readPositiveInt(env.MEMORY_RATE_LIMIT, DEFAULT_USER_LIMIT), windowMs: HOUR_MS },
    anon: { limit: readPositiveInt(env.MEMORY_ANON_RATE_LIMIT, DEFAULT_ANON_LIMIT), windowMs: HOUR_MS },
    maxInFlight: readPositiveInt(env.MEMORY_MAX_IN_FLIGHT, DEFAULT_MAX_IN_FLIGHT),
  };
}

/** This instance's counter. A separate instance from the coach's, for the reason above. */
const memoryRateLimiter = createRateLimiter();

/** Parses a request body that may arrive as a string or already parsed. */
function readBody(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

interface EmbedAttempt {
  ok: true;
  embedding: number[];
}

interface EmbedAttemptFailure {
  ok: false;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

/** Reads a `Retry-After` header, which may be seconds or an HTTP date. */
function readRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    const delta = Math.ceil((at - Date.now()) / 1000);
    if (delta > 0) return delta;
  }
  return undefined;
}

/**
 * Asks the model to embed one picture.
 *
 * Deliberately total: it returns a status and a message rather than throwing, so the handler has one
 * error shape to report and one place to decide what is retryable. The response is read defensively
 * because a provider can change its envelope, and a shape a reader does not recognise must become a
 * reported failure rather than an undefined stuffed into a vector column.
 */
async function embedOne(
  apiKey: string,
  mimeType: string,
  base64: string
): Promise<EmbedAttempt | EmbedAttemptFailure> {
  let response: {
    status: number;
    ok: boolean;
    text: () => Promise<string>;
    headers?: { get?: (name: string) => string | null };
  };

  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${MEMORY_EMBEDDING_MODEL}:embedContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: `models/${MEMORY_EMBEDDING_MODEL}`,
        content: {
          parts: [{ inlineData: { mimeType, data: base64 } }],
        },
        // Controls the output size. Omitted it would be 3072, which is not what the column holds.
        outputDimensionality: MEMORY_EMBEDDING_DIMENSION,
      }),
    });
  } catch (err) {
    // Status 0 is the network case, which the retry rules treat as temporary.
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'The embedding request failed to send.',
    };
  }

  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: text.slice(0, 400),
      retryAfterSeconds: readRetryAfter(response.headers?.get?.('retry-after') ?? undefined),
    };
  }

  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: 502, message: 'The embedding response was not JSON.' };
  }

  // Two envelopes are accepted: `{ embedding: { values } }` for a single input, and
  // `{ embeddings: [{ values }] }` which the API uses when it aggregates several. Only the first
  // slot is ever read, because this endpoint sends exactly one picture.
  const record = (body ?? {}) as Record<string, unknown>;
  const single = record.embedding as { values?: unknown } | undefined;
  const many = Array.isArray(record.embeddings)
    ? (record.embeddings[0] as { values?: unknown } | undefined)
    : undefined;
  const values = single?.values ?? many?.values;

  if (!Array.isArray(values) || values.length !== MEMORY_EMBEDDING_DIMENSION) {
    return {
      ok: false,
      status: 502,
      message:
        `The embedding model returned ` +
        `${Array.isArray(values) ? `${values.length} dimensions` : 'no usable vector'}, but this ` +
        `build stores ${MEMORY_EMBEDDING_DIMENSION}.`,
    };
  }

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, status: 502, message: 'The embedding contained a non-numeric value.' };
    }
  }

  return { ok: true, embedding: values as number[] };
}

/** Waits, without depending on a timer type the frontend typecheck would not have. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embeds one picture, retrying only what is worth retrying.
 *
 * The `Retry-After` the provider sends wins over the exponential value but is still capped, so an
 * instruction to wait an hour cannot park the run for an hour — the trader is watching a progress
 * bar, and a run that is merely waiting must be distinguishable from one that has hung.
 */
async function embedWithRetries(
  apiKey: string,
  mimeType: string,
  base64: string
): Promise<EmbedAttempt | EmbedAttemptFailure> {
  let last: EmbedAttemptFailure = { ok: false, status: 500, message: 'Not attempted.' };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const result = await embedOne(apiKey, mimeType, base64);
    if (result.ok) return result;
    last = result;

    // A permanent failure is reported on the first try rather than pursued against a quota.
    if (!isRetryable(result.status, result.message)) return result;
    if (attempt + 1 >= MAX_ATTEMPTS) break;

    const fromHeader =
      typeof result.retryAfterSeconds === 'number' && result.retryAfterSeconds > 0
        ? result.retryAfterSeconds * 1000
        : null;
    const delay = Math.min(RETRY_MAX_MS, fromHeader ?? RETRY_BASE_MS * 2 ** attempt);
    await sleep(Math.max(0, delay));
  }

  return last;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const authConfig = supabaseAuthConfig();

  // A GET is a health check: opening this URL in a browser proves whether the function is deployed
  // and whether its key is visible, which is otherwise indistinguishable from the app being served
  // in its place. Nothing secret is revealed.
  if (req.method === 'GET') {
    const rules = memoryRateRules();
    res.status(200).json({
      ok: true,
      service: 'memory',
      version: MEMORY_ENDPOINT_VERSION,
      keyConfigured: !!apiKey,
      embedding: {
        model: MEMORY_EMBEDDING_MODEL,
        version: MEMORY_EMBEDDING_VERSION,
        dimension: MEMORY_EMBEDDING_DIMENSION,
        // The largest single picture the endpoint will accept, so a caller can tell whether its own
        // compressed screenshot fits without having to find out by being refused.
        maxImageChars: MAX_COACH_IMAGE_DATA_CHARS,
      },
      access: {
        authRequired: !!authConfig,
        perUserPerHour: rules.user.limit,
        anonymousPerHour: rules.anon.limit,
        maxInFlight: rules.maxInFlight,
        // True deliberately: this ceiling counts in this instance only, and is separate from the
        // coach's so a backfill cannot spend the coach's allowance.
        countersArePerInstance: true,
      },
      ...(authConfig
        ? {}
        : {
            warning:
              'SUPABASE_URL and SUPABASE_ANON_KEY are not set on this deployment, so a signed-in ' +
              'session cannot be required. Requests are limited per IP instead.',
          }),
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST, or GET for a health check.' });
    return;
  }

  // Fail closed on configuration: without the key there is nothing to do, and answering as though
  // the embedding succeeded would be the one unforgivable outcome here.
  if (!apiKey) {
    res.status(503).json({
      ok: false,
      code: 'unconfigured',
      error:
        'Chart embedding is not configured on the server. Set GEMINI_API_KEY in the hosting ' +
        'environment variables for Production (no VITE_ prefix), then redeploy. Verify with a GET ' +
        'to this same URL: it should report keyConfigured: true.',
    });
    return;
  }

  const body = readBody(req.body);
  if (!body) {
    res.status(400).json({ ok: false, code: 'bad_request', error: 'The request body was not JSON.' });
    return;
  }

  const rawImages = body.images;
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    res.status(400).json({
      ok: false,
      code: 'bad_request',
      error: 'The request did not include any chart images to embed.',
    });
    return;
  }
  if (rawImages.length > MEMORY_MAX_IMAGES_PER_REQUEST) {
    res.status(400).json({
      ok: false,
      code: 'bad_request',
      error:
        `At most ${MEMORY_MAX_IMAGES_PER_REQUEST} picture may be embedded per request. The model ` +
        'aggregates several inputs into ONE embedding, so a batch would come back as a single ' +
        'vector for the whole group.',
    });
    return;
  }

  // The same reader the coach uses for the images it is sent: an inline base64 image, a bounded
  // label, a per-image size cap and a total budget. A request body is untrusted input whichever
  // client sent it, so the validation is shared rather than trusted.
  const parts = readCoachImages(rawImages, MEMORY_MAX_IMAGES_PER_REQUEST);
  if (parts.length !== rawImages.length) {
    res.status(400).json({
      ok: false,
      code: 'bad_request',
      error:
        `One of the pictures was not usable: it must be an inline base64 image under ` +
        `${MAX_COACH_IMAGE_DATA_CHARS} characters. Nothing was embedded.`,
    });
    return;
  }

  // ---- Who is asking, and are they allowed to spend the key? ----
  const auth = await authorize(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, code: auth.code, error: auth.message });
    return;
  }

  // This endpoint's own rule, not the one `authorize` picked: the client's budget for embeddings and
  // its budget for coach answers are different budgets.
  const rules = memoryRateRules();
  const rule = auth.identity === 'user' ? rules.user : rules.anon;
  const admission = memoryRateLimiter.acquire(auth.limitKey, rule, rules.maxInFlight);
  if (!admission.ok) {
    res.status(429).json({
      ok: false,
      code: 'rate_limited',
      error:
        admission.reason === 'too_many_in_flight'
          ? 'This endpoint is already embedding a picture for you. Wait for it to finish, then continue.'
          : `Indexing has reached its ceiling of ${rule.limit} pictures an hour. It will continue after that.`,
      retryAfterSeconds: admission.retryAfterSeconds,
    });
    return;
  }

  try {
    const results: { label: string; embedding: number[] }[] = [];
    for (const part of parts) {
      const outcome = await embedWithRetries(apiKey, part.mimeType, part.data);
      if (!outcome.ok) {
        // The whole request fails if any picture fails, rather than returning a partial list: a
        // caller zipping a short answer against its own inputs by position is how a chart ends up
        // indexed under another chart's id.
        res.status(outcome.status === 0 ? 503 : outcome.status).json({
          ok: false,
          code:
            outcome.status === 401 || outcome.status === 403
              ? 'bad_key'
              : outcome.status === 429
              ? 'rate_limited'
              : 'server',
          error:
            outcome.status === 429
              ? 'The embedding provider is rate-limiting right now. Indexing will pause and resume.'
              : 'The embedding provider could not embed that picture, so nothing was indexed.',
          detail: outcome.message,
          ...(outcome.retryAfterSeconds ? { retryAfterSeconds: outcome.retryAfterSeconds } : {}),
        });
        return;
      }
      results.push({ label: part.label, embedding: outcome.embedding });
    }

    res.status(200).json({
      ok: true,
      // Echoed so the client can refuse a vector produced by a configuration it does not store.
      model: MEMORY_EMBEDDING_MODEL,
      version: MEMORY_EMBEDDING_VERSION,
      dimension: MEMORY_EMBEDDING_DIMENSION,
      results,
    });
  } finally {
    // Released on every path, including failures, so a failed picture cannot hold the slot.
    admission.release();
  }
}

/** Re-exported for the endpoint's tests, which assert the handler's routing without a network. */
export { ENDPOINT_VERSION, bearerToken, clientIp };
