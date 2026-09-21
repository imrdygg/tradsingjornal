import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler, {
  authorize,
  bearerToken,
  clientIp,
  coachRateLimiter,
  createRateLimiter,
  rateLimitRules,
  supabaseAuthConfig,
} from '../../../../src/api/coach';
import { buildJournalDigest } from '../journal-digest';
import { DEFAULT_INSTRUMENTS } from '../../trading/instruments';

/**
 * The endpoint spends a paid API key, so it must be able to say who is asking and how
 * often they may ask. These cover both gates, and — most importantly — that a failed
 * gate stops before a single Gemini request is made.
 */

const ENV_KEYS = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'GEMINI_API_KEY',
  'COACH_RATE_LIMIT',
  'COACH_ANON_RATE_LIMIT',
  'COACH_MAX_IN_FLIGHT',
];

interface FetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

let calls: FetchCall[] = [];
let authReply: { status: number; text: string } = { status: 200, text: '{"id":"user-1"}' };
let authThrows = false;
let geminiReply: { status: number; text: string } = { status: 500, text: 'unset' };

/** A valid `brief` payload, wrapped the way Gemini returns it. */
const BRIEF_JSON = JSON.stringify({
  headline: 'h',
  yesterday: 'y',
  wins: ['w'],
  fixes: ['f'],
  todayFocus: 't',
  motivation: 'm',
});

function geminiEnvelope(inner: string): string {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: inner }] } }] });
}

function installFetch() {
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init?: FetchCall['init'],
  ) => {
    calls.push({ url, init });
    if (url.includes('/auth/v1/user')) {
      if (authThrows) throw new Error('fetch failed');
      return {
        status: authReply.status,
        ok: authReply.status >= 200 && authReply.status < 300,
        text: async () => authReply.text,
      };
    }
    return {
      status: geminiReply.status,
      ok: geminiReply.status >= 200 && geminiReply.status < 300,
      text: async () => geminiReply.text,
    };
  };
}

function geminiCalls(): FetchCall[] {
  return calls.filter((call) => call.url.includes('generativelanguage'));
}

function authCalls(): FetchCall[] {
  return calls.filter((call) => call.url.includes('/auth/v1/user'));
}

/** The smallest response object the handler actually uses. */
function fakeRes() {
  const res = {
    statusCode: 0,
    body: null as Record<string, unknown> | null,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body as Record<string, unknown>;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

const digest = buildJournalDigest({
  trades: [],
  tradingDays: [],
  reviews: [],
  setups: [],
  instruments: DEFAULT_INSTRUMENTS,
  todayTradeDate: '2026-09-20',
  timezone: 'America/New_York',
});

function post(overrides: { headers?: Record<string, string>; body?: unknown } = {}) {
  return {
    method: 'POST',
    headers: overrides.headers,
    body: overrides.body ?? { mode: 'brief', digest },
  } as never;
}

let originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  calls = [];
  authThrows = false;
  authReply = { status: 200, text: '{"id":"user-1"}' };
  geminiReply = { status: 200, text: geminiEnvelope(BRIEF_JSON) };
  installFetch();
  coachRateLimiter.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('supabaseAuthConfig', () => {
  it('is null when the deployment has no credentials, which is the local-only setup', () => {
    expect(supabaseAuthConfig({})).toBeNull();
    expect(supabaseAuthConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
  });

  it('accepts the VITE_ spellings too, so a host that only set those still authenticates', () => {
    expect(
      supabaseAuthConfig({
        VITE_SUPABASE_URL: 'https://x.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'anon',
      }),
    ).toEqual({ url: 'https://x.supabase.co', anonKey: 'anon' });
  });

  it('prefers the server-only names and tolerates a trailing slash', () => {
    const config = supabaseAuthConfig({
      SUPABASE_URL: 'https://server.supabase.co/',
      SUPABASE_ANON_KEY: 'server-anon',
      VITE_SUPABASE_URL: 'https://client.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'client-anon',
    });
    expect(config).toEqual({ url: 'https://server.supabase.co', anonKey: 'server-anon' });
  });
});

describe('request identity helpers', () => {
  it('reads a bearer token however the header is cased', () => {
    expect(bearerToken({ headers: { authorization: 'Bearer abc.def' } })).toBe('abc.def');
    expect(bearerToken({ headers: { Authorization: 'bearer abc.def' } })).toBe('abc.def');
  });

  it('ignores a missing or malformed authorization header', () => {
    expect(bearerToken({})).toBeNull();
    expect(bearerToken({ headers: {} })).toBeNull();
    expect(bearerToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(bearerToken({ headers: { authorization: 'Bearer' } })).toBeNull();
  });

  it('takes the first forwarded address, and falls back where there is none', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' } })).toBe(
      '203.0.113.7',
    );
    expect(clientIp({ headers: { 'x-real-ip': '203.0.113.9' } })).toBe('203.0.113.9');
    expect(clientIp({ headers: {} })).toBe('unknown');
  });
});

describe('rateLimitRules', () => {
  it('defaults to a ceiling per signed-in user and a tighter one per anonymous IP', () => {
    const rules = rateLimitRules({});
    expect(rules.user.limit).toBe(30);
    expect(rules.anon.limit).toBe(10);
    expect(rules.anon.limit).toBeLessThan(rules.user.limit);
    expect(rules.maxInFlight).toBe(2);
  });

  it('can be tuned from the environment, because the right ceiling depends on the key', () => {
    const rules = rateLimitRules({ COACH_RATE_LIMIT: '120', COACH_ANON_RATE_LIMIT: '5' });
    expect(rules.user.limit).toBe(120);
    expect(rules.anon.limit).toBe(5);
  });

  it('falls back rather than disabling the limit when the value is unusable', () => {
    // A limit of 0 (or garbage) must never mean "unlimited".
    expect(rateLimitRules({ COACH_RATE_LIMIT: '0' }).user.limit).toBe(30);
    expect(rateLimitRules({ COACH_RATE_LIMIT: '-5' }).user.limit).toBe(30);
    expect(rateLimitRules({ COACH_RATE_LIMIT: 'lots' }).user.limit).toBe(30);
    expect(rateLimitRules({ COACH_MAX_IN_FLIGHT: '0' }).maxInFlight).toBe(2);
  });
});

describe('createRateLimiter', () => {
  const rule = { limit: 2, windowMs: 60_000 };

  it('allows up to the limit, then refuses with the time left in the window', () => {
    let at = 1_000_000;
    const limiter = createRateLimiter({ now: () => at });

    expect(limiter.acquire('user:a', rule, 2).ok).toBe(true);
    const second = limiter.acquire('user:a', rule, 2);
    expect(second.ok).toBe(true);
    if (second.ok) second.release();

    const third = limiter.acquire('user:a', rule, 2);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe('rate_limited');
      expect(third.retryAfterSeconds).toBe(60);
    }

    // Once the window has passed the caller is welcome again.
    at += 60_001;
    expect(limiter.acquire('user:a', rule, 2).ok).toBe(true);
  });

  it('counts each identity separately', () => {
    const limiter = createRateLimiter({ now: () => 0 });
    expect(limiter.acquire('user:a', rule, 2).ok).toBe(true);
    expect(limiter.acquire('user:a', rule, 2).ok).toBe(true);
    expect(limiter.acquire('user:b', rule, 2).ok).toBe(true);
    expect(limiter.acquire('user:a', rule, 2).ok).toBe(false);
  });

  it('limits concurrent answers, and frees the slot on release', () => {
    const limiter = createRateLimiter({ now: () => 0 });
    const wide = { limit: 100, windowMs: 60_000 };

    const first = limiter.acquire('user:a', wide, 1);
    expect(first.ok).toBe(true);

    const second = limiter.acquire('user:a', wide, 1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('too_many_in_flight');

    if (first.ok) first.release();
    expect(limiter.acquire('user:a', wide, 1).ok).toBe(true);
  });

  it('cannot free another request\u2019s slot by releasing twice', () => {
    const limiter = createRateLimiter({ now: () => 0 });
    const wide = { limit: 100, windowMs: 60_000 };

    const first = limiter.acquire('user:a', wide, 2);
    const second = limiter.acquire('user:a', wide, 2);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    first.release();
    first.release();
    // One slot is still held by the second, so a third request still fits under 2.
    expect(limiter.acquire('user:a', wide, 2).ok).toBe(true);
    expect(limiter.acquire('user:a', wide, 2).ok).toBe(false);
    second.release();
  });

  it('forgets expired identities instead of growing without bound', () => {
    let at = 0;
    const limiter = createRateLimiter({ now: () => at, maxTracked: 3 });
    const rule10 = { limit: 10, windowMs: 1_000 };

    for (let i = 0; i < 5; i += 1) limiter.acquire(`user:${i}`, rule10, 2);
    expect(limiter.tracked()).toBeLessThanOrEqual(3);

    at += 1_001;
    limiter.acquire('user:fresh', rule10, 2);
    expect(limiter.tracked()).toBe(1);
  });
});

describe('authorize', () => {
  it('requires a session when the deployment can check one', async () => {
    const result = await authorize(
      { headers: {} } as never,
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('sign_in_required');
    }
  });

  it('keys an authenticated caller on the user id, which cannot be forged', async () => {
    authReply = { status: 200, text: '{"id":"user-42"}' };
    const result = await authorize(
      { headers: { authorization: 'Bearer good-token' } } as never,
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity).toBe('user');
      expect(result.limitKey).toBe('user:user-42');
      expect(result.rule.limit).toBe(30);
    }
  });

  it('rejects an expired token rather than treating it as anonymous', async () => {
    authReply = { status: 401, text: '{"message":"invalid claim"}' };
    const result = await authorize(
      { headers: { authorization: 'Bearer stale-token' } } as never,
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unauthorized');
      expect(result.message).toMatch(/sign in again/i);
    }
  });

  it('refuses to spend the key when the session cannot be checked at all', async () => {
    authThrows = true;
    const result = await authorize(
      { headers: { authorization: 'Bearer some-token' } } as never,
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe('auth_unavailable');
    }
  });

  it('falls back to a per-IP limit only when there is no way to identify anyone', async () => {
    const result = await authorize(
      { headers: { 'x-forwarded-for': '203.0.113.7' } } as never,
      {},
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity).toBe('anonymous');
      expect(result.limitKey).toBe('ip:203.0.113.7');
      expect(result.rule.limit).toBe(10);
    }
  });
});

describe('the handler', () => {
  it('does not call Gemini at all without a session', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';

    const res = fakeRes();
    await handler(post(), res as never);

    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('sign_in_required');
    expect(geminiCalls()).toHaveLength(0);
  });

  it('does not call Gemini when the token is rejected', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    authReply = { status: 401, text: '{}' };

    const res = fakeRes();
    await handler(post({ headers: { authorization: 'Bearer stale' } }), res as never);

    expect(res.statusCode).toBe(401);
    expect(res.body?.code).toBe('unauthorized');
    expect(geminiCalls()).toHaveLength(0);
  });

  it('answers a signed-in trader, and sends the session token upstream', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';

    const res = fakeRes();
    await handler(post({ headers: { authorization: 'Bearer good-token' } }), res as never);

    expect(res.statusCode).toBe(200);
    expect((res.body?.data as { headline: string }).headline).toBe('h');

    // The token was checked, and the Gemini call carried the server key, never the token.
    expect(authCalls()).toHaveLength(1);
    expect(authCalls()[0].init?.headers?.Authorization).toBe('Bearer good-token');
    expect(geminiCalls()[0].init?.headers?.['x-goog-api-key']).toBe('server-key');
  });

  it('throttles a signed-in trader once they hit their ceiling', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.COACH_RATE_LIMIT = '2';

    const header = { authorization: 'Bearer good-token' };
    const first = fakeRes();
    const second = fakeRes();
    const third = fakeRes();

    await handler(post({ headers: header }), first as never);
    await handler(post({ headers: header }), second as never);
    await handler(post({ headers: header }), third as never);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.body?.code).toBe('rate_limited');
    expect(third.headers['Retry-After']).toBe(String(60 * 60));
    // The refused request never reached the model.
    expect(geminiCalls()).toHaveLength(2);
  });

  it('does not count a malformed request against the trader', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.COACH_RATE_LIMIT = '1';

    const header = { authorization: 'Bearer good-token' };
    const bad = fakeRes();
    await handler(post({ headers: header, body: { mode: 'nonsense' } }), bad as never);
    expect(bad.statusCode).toBe(400);

    // Their single allowance is intact.
    const good = fakeRes();
    await handler(post({ headers: header }), good as never);
    expect(good.statusCode).toBe(200);
  });

  it('throttles an anonymous caller by IP when the deployment cannot authenticate', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.COACH_ANON_RATE_LIMIT = '1';

    const first = fakeRes();
    const second = fakeRes();
    await handler(post({ headers: { 'x-forwarded-for': '203.0.113.7' } }), first as never);
    await handler(post({ headers: { 'x-forwarded-for': '203.0.113.7' } }), second as never);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.body?.code).toBe('rate_limited');
  });

  it('releases its in-flight slot even when the model call fails', async () => {
    process.env.GEMINI_API_KEY = 'server-key';
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.COACH_MAX_IN_FLIGHT = '1';
    // Every model fails, so the handler returns an error rather than a body.
    geminiReply = { status: 400, text: 'Invalid JSON payload received.' };

    const header = { authorization: 'Bearer good-token' };
    const failed = fakeRes();
    await handler(post({ headers: header }), failed as never);
    expect(failed.statusCode).toBe(502);

    // The next request is not blocked by the previous one.
    geminiReply = { status: 200, text: geminiEnvelope(BRIEF_JSON) };
    const next = fakeRes();
    await handler(post({ headers: header }), next as never);
    expect(next.statusCode).toBe(200);
  });

  it('tells the owner, unauthenticated, whether a session is even required', async () => {
    process.env.GEMINI_API_KEY = 'server-key';

    const anonymous = fakeRes();
    await handler({ method: 'GET' } as never, anonymous as never);
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.body?.version).toBe(6);
    const access = anonymous.body?.access as Record<string, unknown>;
    expect(access.authRequired).toBe(false);
    expect(access.countersArePerInstance).toBe(true);
    expect(String(anonymous.body?.warning)).toMatch(/limited per IP/i);

    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    const secured = fakeRes();
    await handler({ method: 'GET' } as never, secured as never);
    expect((secured.body?.access as Record<string, unknown>).authRequired).toBe(true);
    expect(secured.body?.warning).toBeUndefined();
  });

  it('still reports a missing key before anything else, so setup is diagnosable', async () => {
    const res = fakeRes();
    await handler(post(), res as never);
    expect(res.statusCode).toBe(503);
    expect(res.body?.code).toBe('unconfigured');
  });
});
