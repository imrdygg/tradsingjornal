import {
  allowsMarketOpinion,
  buildCoachPrompt,
  isCoachMode,
  parseCoachResponse,
  type CoachPromptExtras,
} from '../lib/ai/coach-prompt';
import type {
  CoachEntryFacts,
  CoachMode,
  CoachPositionFacts,
  CoachTradeFacts,
} from '../lib/ai/coach-types';
import type { JournalDigest } from '../lib/ai/journal-digest';
import { getInstrumentQuote, getMarketBrief } from '../lib/ai/market-data';
import type { MarketBrief } from '../lib/ai/market-data';

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


const ENDPOINT_VERSION = 7;

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

// ---------------------------------------------------------------------------
// Access control
//
// This endpoint spends a paid API key, so it needs a caller it can identify and a
// ceiling on how often that caller may ask. Both belong on the server: a client can
// be edited by anyone who opens devtools, so neither can be enforced from there.
//
// The one hole worth naming: the counters live in this instance's memory. A serverless
// platform runs many instances and replaces them freely, so the limits below are a
// per-instance speed bump, not a global quota accounting. They make a scraped endpoint
// useless cheaply, which is the actual risk; they are not billing enforcement.
// ---------------------------------------------------------------------------

/** Requests allowed in one window, and how long that window lasts. */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** Ceiling for one signed-in trader. The UI only asks on a button press. */
const DEFAULT_USER_LIMIT = 30;

/**
 * Ceiling for an unauthenticated caller, used only when this deployment has no
 * Supabase credentials and so cannot identify anyone at all. Much tighter, because
 * there is no identity to hold responsible for the spend.
 */
const DEFAULT_ANON_LIMIT = 10;

/** A single caller may not have more than this many answers in flight. */
const DEFAULT_MAX_IN_FLIGHT = 2;

/** How many identities to remember, to bound memory in a long-lived instance. */
const MAX_TRACKED_IDENTITIES = 5000;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The active limits. Overridable so a deployment can loosen or tighten them without
 * a code change, but never to zero: a bad value falls back to the default rather than
 * disabling the limit.
 */
export function rateLimitRules(env: Record<string, string | undefined> = process.env): {
  user: RateLimitRule;
  anon: RateLimitRule;
  maxInFlight: number;
} {
  return {
    user: {
      limit: readPositiveInt(env.COACH_RATE_LIMIT, DEFAULT_USER_LIMIT),
      windowMs: HOUR_MS,
    },
    anon: {
      limit: readPositiveInt(env.COACH_ANON_RATE_LIMIT, DEFAULT_ANON_LIMIT),
      windowMs: HOUR_MS,
    },
    maxInFlight: readPositiveInt(env.COACH_MAX_IN_FLIGHT, DEFAULT_MAX_IN_FLIGHT),
  };
}

/**
 * Reads one header case-insensitively.
 *
 * Node and most hosts lowercase incoming header names, but nothing guarantees it, and a
 * `Authorization` that went unread would look exactly like a signed-out user.
 */
function readHeader(req: ApiRequest, name: string): string | undefined {
  const headers = req.headers;
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const raw = headers[key];
    return Array.isArray(raw) ? raw[0] : raw;
  }
  return undefined;
}

/** The bearer token from the Authorization header, or null when there is none. */
export function bearerToken(req: ApiRequest): string | null {
  const value = readHeader(req, 'authorization')?.trim();
  if (!value) return null;
  const match = /^bearer\s+(\S+)$/i.exec(value);
  return match ? match[1] : null;
}

/**
 * Where the caller is, as far as the platform will say.
 *
 * `x-forwarded-for` is set by the host's edge, but nothing stops a direct caller from
 * sending their own, so a determined attacker can appear as many IPs. That is why the
 * authenticated path keys on the Supabase user id instead — it cannot be forged — and
 * why this value is only ever used for the anonymous fallback.
 */
export function clientIp(req: ApiRequest): string {
  const forwarded = readHeader(req, 'x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || readHeader(req, 'x-real-ip')?.trim() || 'unknown';
}

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

/**
 * Supabase credentials for checking a session, or null when this deployment has none.
 *
 * Both spellings are accepted because a host that only ever set the client's VITE_
 * variables still exposes them to functions at runtime, and a coach that refuses every
 * request because a variable is spelled `VITE_SUPABASE_URL` would be a self-inflicted
 * outage.
 */
export function supabaseAuthConfig(
  env: Record<string, string | undefined> = process.env,
): SupabaseAuthConfig | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export type SessionCheck =
  | { ok: true; userId: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Asks Supabase who a token belongs to.
 *
 * Asking the auth server (rather than verifying a JWT locally) works with both the
 * legacy shared-secret tokens and the newer asymmetric signing keys, and needs no
 * secret beyond the anon key. It costs one subrequest, which is nothing next to a
 * Gemini call.
 */
export async function verifySession(
  token: string,
  config: SupabaseAuthConfig,
): Promise<SessionCheck> {
  let status = 0;
  let text = '';
  try {
    const res = await fetch(`${config.url}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 503,
      code: 'auth_unavailable',
      message: `Could not reach Supabase to check your session (${message}). Try again shortly.`,
    };
  }

  if (status === 200) {
    try {
      const user = JSON.parse(text) as { id?: string };
      if (user?.id) return { ok: true, userId: user.id };
    } catch {
      // Fall through to the shared failure below.
    }
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'That session token did not identify a user. Sign in again, then retry.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Your session has expired. Sign in again, then retry.',
    };
  }

  return {
    ok: false,
    status: 503,
    code: 'auth_unavailable',
    message: `Supabase rejected the session check with HTTP ${status}. Try again shortly.`,
  };
}

export interface AdmissionGrant {
  ok: true;
  remaining: number;
  /** Must be called on every path, including failures, to free the in-flight slot. */
  release: () => void;
}

export interface AdmissionRefusal {
  ok: false;
  reason: 'rate_limited' | 'too_many_in_flight';
  retryAfterSeconds: number;
}

export type Admission = AdmissionGrant | AdmissionRefusal;

export interface RateLimiter {
  acquire(key: string, rule: RateLimitRule, maxInFlight: number): Admission;
  /** Number of identities currently tracked; used by tests to prove pruning. */
  tracked: () => number;
  reset: () => void;
}

/**
 * A fixed-window counter plus an in-flight guard, per identity.
 *
 * `now` is injectable so the window can be tested without waiting an hour.
 */
export function createRateLimiter(
  options: { now?: () => number; maxTracked?: number } = {},
): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const maxTracked = Math.max(1, options.maxTracked ?? MAX_TRACKED_IDENTITIES);
  const windows = new Map<string, { count: number; resetAt: number }>();
  const inFlight = new Map<string, number>();

  function prune(at: number): void {
    for (const [key, entry] of [...windows]) {
      if (entry.resetAt <= at) windows.delete(key);
    }
    // Bound memory when a flood of distinct identities arrives. This runs before the
    // new entry is recorded, so it leaves room for it rather than settling one over the
    // limit. Forgetting the oldest window costs one extra allowed request, not
    // correctness, and the identity being evicted is never the one now asking.
    while (windows.size >= maxTracked) {
      const oldest = windows.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  }

  return {
    acquire(key, rule, maxInFlight) {
      const at = now();
      prune(at);

      const existing = windows.get(key);
      const live = existing && existing.resetAt > at ? existing : null;

      if (live && live.count >= rule.limit) {
        return {
          ok: false,
          reason: 'rate_limited',
          retryAfterSeconds: Math.max(1, Math.ceil((live.resetAt - at) / 1000)),
        };
      }

      const active = inFlight.get(key) ?? 0;
      if (active >= maxInFlight) {
        return { ok: false, reason: 'too_many_in_flight', retryAfterSeconds: 20 };
      }

      const entry = live ?? { count: 0, resetAt: at + rule.windowMs };
      entry.count += 1;
      windows.set(key, entry);
      inFlight.set(key, active + 1);

      let released = false;
      return {
        ok: true,
        remaining: rule.limit - entry.count,
        release() {
          // Guarded so a double release cannot free someone else's slot.
          if (released) return;
          released = true;
          const current = inFlight.get(key) ?? 0;
          if (current <= 1) inFlight.delete(key);
          else inFlight.set(key, current - 1);
        },
      };
    },
    tracked: () => windows.size,
    reset() {
      windows.clear();
      inFlight.clear();
    },
  };
}

/** The limiter this instance enforces. See the note on per-instance counters above. */
export const coachRateLimiter = createRateLimiter();

export interface AuthorizationGrant {
  ok: true;
  identity: 'user' | 'anonymous';
  /** What the counters are keyed on: a user id, or an IP when there is no account. */
  limitKey: string;
  rule: RateLimitRule;
  userId?: string;
}

export type Authorization = AuthorizationGrant | {
  ok: false;
  status: number;
  code: string;
  message: string;
};

/**
 * Works out who is asking and what they are allowed.
 *
 * A deployment with Supabase credentials requires a valid session: that is the whole
 * point of the check, because an unauthenticated endpoint that spends a paid key is
 * usable by anyone who finds the URL. A deployment without them cannot identify
 * anybody — and the app documents running with no accounts at all — so rather than
 * refusing to serve it falls back to a per-IP limit and says so in its health check.
 */
export async function authorize(
  req: ApiRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<Authorization> {
  const config = supabaseAuthConfig(env);
  const rules = rateLimitRules(env);

  if (!config) {
    return {
      ok: true,
      identity: 'anonymous',
      limitKey: `ip:${clientIp(req)}`,
      rule: rules.anon,
    };
  }

  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'sign_in_required',
      message:
        'The coach runs against your own journal, so it needs a signed-in session. ' +
        'Sign in, then try again.',
    };
  }

  const check = await verifySession(token, config);
  if (!check.ok) return check;

  return {
    ok: true,
    identity: 'user',
    userId: check.userId,
    limitKey: `user:${check.userId}`,
    rule: rules.user,
  };
}

export interface CoachModelOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The part that spends money: assemble the prompt on the server and try each model
 * until one answers.
 *
 * Split out of the handler so the access gates above stay readable, and so
 * `npm run verify:coach` can exercise the real prompt, key and model chain without
 * having to fake a signed-in session first.
 */
export async function runCoachModels(params: {
  apiKey: string;
  mode: CoachMode;
  digest: JournalDigest;
  trade?: CoachTradeFacts;
  marketBrief?: MarketBrief;
  extras?: CoachPromptExtras;
}): Promise<CoachModelOutcome> {
  const { apiKey, mode, digest, trade, marketBrief, extras } = params;

  // The prompt is assembled here, on the server, from the digest the client sent.
  const { systemInstruction, userPrompt } = buildCoachPrompt(
    mode,
    digest,
    trade,
    marketBrief,
    extras,
  );

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
        return {
          status: 200,
          body: {
            mode,
            model: result.model,
            data: parseCoachResponse(mode, parsed, extras),
            // The live read behind an opinion, handed back so the client can record the
            // moment the call was made against. Never a secret: it is public market data.
            instrument: extras?.instrumentQuote,
          },
        };
      } catch (err) {
        return {
          status: 502,
          body: {
            error: err instanceof Error ? err.message : 'The coach returned an unusable response.',
            model: result.model,
          },
        };
      }
    }

    attempted.push(`${model}: ${result.status} ${result.message}`);

    if (!result.retryable) break;

    // Gemini reports an exhausted free-tier quota as 429. Falling through to the next
    // model is still worth one attempt, but a genuine key problem should stop here.
    if (/api key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(result.message)) break;
  }

  const summary = attempted.join(' | ');

  if (/api key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(summary)) {
    return {
      status: 502,
      body: {
        error:
          'Gemini rejected the API key on the server. Check that GEMINI_API_KEY in the host ' +
          'environment is complete and has no surrounding quotes or spaces.',
        code: 'bad_key',
      },
    };
  }

  if (attempted.every((entry) => /: 429|exhausted|quota/i.test(entry))) {
    return {
      status: 429,
      body: {
        error: 'The coach has hit its Gemini rate limit on every available model. Try again later.',
        code: 'rate_limited',
      },
    };
  }

  console.error('[coach] every model failed:', summary);
  return {
    status: 502,
    body: {
      error:
        'No Gemini model could answer right now. Every model we tried was unavailable or ' +
        'overloaded. This is usually temporary — try again in a minute.',
      code: 'model_unavailable',
      detail: summary,
    },
  };
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

/** A finite number from the client, or undefined. Strings are not trusted here. */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * The open position, re-validated on the server.
 *
 * These numbers go straight into the prompt and then into a size suggestion, so a
 * malformed or missing one has to be refused rather than coerced to zero: "0 contracts
 * at 0" would produce an opinion about a position that does not exist.
 */
export function readPositionFacts(raw: unknown): CoachPositionFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const symbol = typeof record.symbol === 'string' ? record.symbol.trim() : '';
  const direction =
    record.direction === 'short' ? 'short' : record.direction === 'long' ? 'long' : null;
  const contracts = readNumber(record.contracts);
  const entryPrice = readNumber(record.entryPrice);
  const initialStop = readNumber(record.initialStop);

  if (!symbol || !direction || !contracts || entryPrice === undefined || initialStop === undefined) {
    return null;
  }

  return {
    symbol,
    direction,
    contracts,
    entryPrice,
    initialStop,
    currentPrice: readNumber(record.currentPrice),
    addContracts: readNumber(record.addContracts),
    addPrice: readNumber(record.addPrice),
    plannedLossLimit: readNumber(record.plannedLossLimit),
    openPoints: readNumber(record.openPoints),
  };
}

/** The entry just recorded, re-validated on the server. */
export function readEntryFacts(raw: unknown): CoachEntryFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const symbol = typeof record.symbol === 'string' ? record.symbol.trim() : '';
  const direction =
    record.direction === 'short' ? 'short' : record.direction === 'long' ? 'long' : null;
  const contracts = readNumber(record.contracts);
  const entryPrice = readNumber(record.entryPrice);
  const initialStop = readNumber(record.initialStop);

  if (!symbol || !direction || !contracts || entryPrice === undefined || initialStop === undefined) {
    return null;
  }

  return {
    symbol,
    direction,
    contracts,
    entryPrice,
    initialStop,
    setupName: typeof record.setupName === 'string' ? record.setupName.trim() : undefined,
    entryReason: typeof record.entryReason === 'string' ? record.entryReason.trim() : undefined,
    session: typeof record.session === 'string' ? record.session.trim() : 'Regular Session',
  };
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
  const rules = rateLimitRules();

  // A GET is a health check: opening this URL in a browser proves whether the function
  // is deployed and whether its key is visible, which is otherwise impossible to tell
  // apart from the app being served in its place.
  if (req.method === 'GET') {
    const config = supabaseAuthConfig();
    res.status(200).json({
      ok: true,
      service: 'coach',
      version: ENDPOINT_VERSION,
      keyConfigured: !!apiKey,
      models: modelChain(),
      access: {
        // False means this deployment cannot identify the caller at all, so only the
        // per-IP limit stands between the URL and the API key. Nothing secret is
        // revealed here; it is the one fact needed to know whether that is the case.
        authRequired: !!config,
        perUserPerHour: rules.user.limit,
        anonymousPerHour: rules.anon.limit,
        maxInFlight: rules.maxInFlight,
        // These counters are this instance's memory, not a shared ledger.
        countersArePerInstance: true,
      },
      ...(config
        ? {}
        : {
            warning:
              'SUPABASE_URL and SUPABASE_ANON_KEY are not set on this deployment, so a ' +
              'signed-in session cannot be required. Requests are limited per IP instead.',
          }),
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

  // ---- Who is asking, and are they allowed to spend the key? ----
  const auth = await authorize(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.message, code: auth.code });
    return;
  }

  const body = readBody(req.body);
  const mode = body?.mode;
  const digest = body?.digest;

  if (!isCoachMode(mode)) {
    res.status(400).json({
      error:
        'Unknown coach mode. Expected brief, weekly, trade, prep, postclose, planreview, ' +
        'planfield, planbuild, scalein or entrycall.',
    });
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

  // Live sector data for the plan lock preview. Fetched on the server so the Yahoo
  // call is not blocked by the browser's CORS rules, and so the client cannot forge it.
  // A failed fetch degrades inside getMarketBrief to a brief with ok:false — the coach
  // is told the data is unavailable and writes its opinion anyway.
  const marketBrief = mode === 'planreview' ? await getMarketBrief() : undefined;

  // ---- The extras the opinion modes need, each re-validated here ----
  const extrasRaw = readBody(body?.extras) ?? {};
  const extras: CoachPromptExtras = {};

  if (mode === 'planfield') {
    const field = extrasRaw.field === 'stayOutIf' ? 'stayOutIf' : extrasRaw.field === 'waitingFor' ? 'waitingFor' : null;
    if (!field) {
      res.status(400).json({ error: 'Plan-field mode needs the field to draft: waitingFor or stayOutIf.' });
      return;
    }
    extras.field = field;
    if (typeof extrasRaw.currentFieldValue === 'string') {
      // Bounded, because this text is pasted straight into the prompt.
      extras.currentFieldValue = extrasRaw.currentFieldValue.slice(0, 2000);
    }
  }

  if (mode === 'scalein') {
    const position = readPositionFacts(extrasRaw.position);
    if (!position) {
      res.status(400).json({
        error: 'Scale-in mode needs the open position: symbol, direction, contracts, entry and stop.',
      });
      return;
    }
    extras.position = position;
  }

  if (mode === 'entrycall') {
    const entry = readEntryFacts(extrasRaw.entry);
    if (!entry) {
      res.status(400).json({
        error: 'Entry-call mode needs the entry: symbol, direction, contracts, entry and stop.',
      });
      return;
    }
    extras.entry = entry;
  }

  // The live futures read, for the modes whose guardrails allow it to be quoted. The
  // symbol is taken from the position or entry when the request did not name one, so a
  // caller cannot ask about one instrument while describing another.
  if (allowsMarketOpinion(mode)) {
    const fromExtras = typeof extrasRaw.instrument === 'string' ? extrasRaw.instrument.trim() : '';
    const instrument =
      extras.position?.symbol || extras.entry?.symbol || fromExtras;
    extras.instrument = instrument;
    // A failure here degrades inside getInstrumentQuote to ok:false with a reason, and
    // the guardrails require the model to stand aside rather than fill the gap.
    extras.instrumentQuote = await getInstrumentQuote(instrument);
  }

  // Only requests that would actually reach Gemini are counted, so a malformed request
  // cannot lock a trader out of their own coach.
  const admission = coachRateLimiter.acquire(auth.limitKey, auth.rule, rules.maxInFlight);
  if (!admission.ok) {
    const busy = admission.reason === 'too_many_in_flight';
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    res.status(429).json({
      error: busy
        ? 'The coach is still working on your previous request. Give it a moment, then try again.'
        : `The coach has answered as often as it may for now. Try again in about ${Math.ceil(
            admission.retryAfterSeconds / 60,
          )} minute(s).`,
      code: busy ? 'busy' : 'rate_limited',
      retryAfterSeconds: admission.retryAfterSeconds,
    });
    return;
  }

  try {
    const outcome = await runCoachModels({ apiKey, mode, digest, trade, marketBrief, extras });
    res.status(outcome.status).json(outcome.body);
  } finally {
    // On every path, including a throw, or this caller's in-flight slot leaks.
    admission.release();
  }
}
