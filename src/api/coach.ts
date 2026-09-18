import {
  buildCoachPrompt,
  isCoachMode,
  parseCoachResponse,
} from '../lib/ai/coach-prompt';
import type { CoachTradeFacts } from '../lib/ai/coach-types';
import type { JournalDigest } from '../lib/ai/journal-digest';

/**
 * The AI coach endpoint.
 *
 * This runs on the server for two reasons:
 *  1. The Gemini API key is a server secret. Anything the browser touches ships to
 *     every visitor, so the key must never reach the client.
 *  2. The guardrails live in ./coach-prompt, so the browser cannot rewrite the system
 *     instruction that forbids market claims and predictions.
 *
 * Deliberately dependency-free: it talks to the Gemini REST API with `fetch` and imports
 * no third-party package.
 *
 * Deployment shape: the committed handler is `api/coach.js` — a plain-JS bundle generated
 * by `npm run build:function` (scripts/bundle-coach.ts) from `src/api/coach.ts`. It is
 * committed so the deployed function requires no TypeScript compilation at all; whatever
 * compiler the host runs cannot break it. Do not edit `api/coach.js` by hand. The
 * generated file is the ONLY file in `api/`: the host turns every file in that directory
 * into a serverless function, so nothing else (tests, TS sources) may live there.
 */

// `tsconfig.json` restricts global types to vite/client, so Node's globals are not
// declared. Declaring just what this function needs keeps Node types out of the
// frontend typecheck, where `process` should not be available.
declare const process: { env: Record<string, string | undefined> };
declare const fetch: (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}>;

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

/** Bumped whenever the endpoint's contract changes, so a live check is conclusive. */
const ENDPOINT_VERSION = 4;

/** Total time to spend trying models before returning what we have. */
const REQUEST_BUDGET_MS = 45_000;

/**
 * Models tried in order.
 *
 * The `-latest` aliases are not dependable: on this key `gemini-flash-latest`,
 * `gemini-3.5-flash` and `gemini-3.6-flash` all returned 503 "high demand" while the
 * lite model served fine. Retrying down the chain turns a dead coach into a slower one.
 */
const DEFAULT_MODEL_CHAIN = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3.6-flash',
  'gemini-2.5-flash-lite',
];

export function modelChain(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.GEMINI_MODEL?.trim();
  const chain = configured ? [configured, ...DEFAULT_MODEL_CHAIN] : DEFAULT_MODEL_CHAIN;
  return [...new Set(chain)];
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Errors that mean "this model, right now" rather than "your request is wrong". */
export function isRetryable(status: number, message: string): boolean {
  // 0 means the request never produced a response at all, which is worth another model.
  if (status === 0) return true;
  if (status === 503 || status === 429 || status === 500) return true;
  // A retired model id: another model in the chain will still work.
  if (status === 404) return true;
  return /unavailable|high demand|overload|not found|no longer available/i.test(message);
}

async function callGemini(params: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
}): Promise<{ ok: true; text: string; model: string } | { ok: false; status: number; message: string; retryable: boolean }> {
  const { apiKey, model, systemInstruction, userPrompt } = params;

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      // Ask for JSON, then validate it ourselves: a shape mismatch is better reported
      // as a readable error than rendered as a hole in the UI.
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  };

  let status = 0;
  let text = '';
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, message: `network: ${message}`, retryable: true };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, status, message: text.slice(0, 500), retryable: isRetryable(status, text) };
  }

  try {
    const parsed = JSON.parse(text);
    const candidateText = parsed?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('');
    if (!candidateText) {
      // A safety block or an empty candidate. Retrying another model is reasonable.
      return {
        ok: false,
        status: 502,
        message: `empty candidate: ${JSON.stringify(parsed).slice(0, 300)}`,
        retryable: true,
      };
    }
    return { ok: true, text: candidateText, model };
  } catch {
    return { ok: false, status: 502, message: 'unreadable response', retryable: true };
  }
}

/** Vercel parses JSON bodies, but a raw string is possible depending on runtime. */
function readBody(body: unknown): Record<string, unknown> | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  return null;
}

/**
 * Minimal shape check on the digest. We do not re-validate every field — the client
 * built it from its own types — but we must reject anything that would leave the prompt
 * with no facts at all, because a coach with no data invents data.
 */
function hasUsableDigest(value: unknown): value is JournalDigest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const digest = value as Partial<JournalDigest>;
  return (
    !!digest.dataSufficiency &&
    typeof digest.dataSufficiency === 'object' &&
    !!digest.overall &&
    typeof digest.overall === 'object' &&
    !!digest.today &&
    typeof digest.today === 'object'
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  // A GET is a health check: opening this URL in a browser proves whether the function
  // is deployed and whether its key is visible, which is otherwise impossible to tell
  // apart from the app being served in its place.
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'coach',
      version: ENDPOINT_VERSION,
      keyConfigured: !!apiKey,
      models: modelChain(),
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST, or GET for a health check.' });
    return;
  }

  if (!apiKey) {
    // The most likely cause on a live site: the variable was added after the last
    // deploy, was scoped to another environment, or was named with a VITE_ prefix and so
    // never reached the server.
    res.status(503).json({
      error:
        'The coach is not configured on the server. Set GEMINI_API_KEY in the hosting ' +
        "environment variables for Production (no VITE_ prefix), then redeploy. Verify with " +
        'a GET to this same URL: it should report keyConfigured: true.',
      code: 'unconfigured',
    });
    return;
  }

  const body = readBody(req.body);
  const mode = body?.mode;
  const digest = body?.digest;

  if (!isCoachMode(mode)) {
    res.status(400).json({ error: 'Unknown coach mode. Expected brief, weekly or trade.' });
    return;
  }
  if (!hasUsableDigest(digest)) {
    res.status(400).json({ error: 'The request did not include a usable journal digest.' });
    return;
  }

  const trade = mode === 'trade' ? (body?.trade as CoachTradeFacts | undefined) : undefined;
  if (mode === 'trade' && (!trade || typeof trade !== 'object')) {
    res.status(400).json({ error: 'Trade mode needs the trade to critique.' });
    return;
  }

  // The prompt is assembled here, on the server, from the digest the client sent.
  const { systemInstruction, userPrompt } = buildCoachPrompt(mode, digest, trade);

  // Stop starting new attempts once the budget is spent. Better to return the errors we
  // have than to be killed mid-request by the platform's own limit, which surfaces to
  // the browser as an HTML error page and looks like the function is missing.
  const startedAt = Date.now();
  const attempted: string[] = [];

  for (const model of modelChain()) {
    if (Date.now() - startedAt > REQUEST_BUDGET_MS) {
      attempted.push(`${model}: skipped, out of time budget`);
      break;
    }

    const result = await callGemini({ apiKey, model, systemInstruction, userPrompt });

    if (result.ok) {
      const raw = result.text;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      try {
        res.status(200).json({
          mode,
          model: result.model,
          data: parseCoachResponse(mode, parsed),
        });
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'The coach returned an unusable response.',
          model: result.model,
        });
      }
      return;
    }

    attempted.push(`${model}: ${result.status} ${result.message}`);

    if (!result.retryable) break;

    // Gemini reports an exhausted free-tier quota as 429. Falling through to the next
    // model is still worth one attempt, but a genuine key problem should stop here.
    if (/api key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(result.message)) break;
  }

  const summary = attempted.join(' | ');

  if (/api key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(summary)) {
    res.status(502).json({
      error:
        'Gemini rejected the API key on the server. Check that GEMINI_API_KEY in the host ' +
        'environment is complete and has no surrounding quotes or spaces.',
      code: 'bad_key',
    });
    return;
  }
  if (attempted.every((entry) => /: 429|exhausted|quota/i.test(entry))) {
    res.status(429).json({
      error: 'The coach has hit its Gemini rate limit on every available model. Try again later.',
      code: 'rate_limited',
    });
    return;
  }

  console.error('[coach] every model failed:', summary);
  res.status(502).json({
    error:
      'No Gemini model could answer right now. Every model we tried was unavailable or ' +
      'overloaded. This is usually temporary — try again in a minute.',
    code: 'model_unavailable',
    detail: summary,
  });
}
