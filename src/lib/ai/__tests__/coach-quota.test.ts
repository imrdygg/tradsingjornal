import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  admitRequest,
  coachInFlight,
  coachRateLimiter,
  consumeSharedQuota,
  getSharedQuotaState,
  type AuthorizationGrant,
  type RateLimitRules,
} from '../../../../src/api/coach';

/**
 * The coach's allowance used to live only in one instance's memory, so a serverless platform
 * that runs many boxes enforced the ceiling once per box and forgot it on every cold start.
 * These cover the shared store that replaced it: a spend in Postgres keyed on the signed-in
 * user, the anonymous fallback, and the honesty of a refusal — a genuine "out of allowance"
 * must never be mistaken for an unreachable store, or the quota would be silently bypassed.
 */

const CONFIG = { url: 'https://project.supabase.co', anonKey: 'anon-key' };
const RULE = { limit: 2, windowMs: 3_600_000 };
const RULES: RateLimitRules = { user: RULE, anon: { limit: 5, windowMs: 3_600_000 }, maxInFlight: 2 };

/** A fetch that answers the RPC with the given row. */
function quotaFetch(row: Record<string, unknown>, status = 200) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => (status >= 200 && status < 300 ? JSON.stringify([row]) : 'boom'),
  }));
}

function userGrant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant {
  return {
    ok: true,
    identity: 'user',
    userId: 'user-1',
    limitKey: 'user:user-1',
    rule: RULE,
    ...overrides,
  };
}

/** A request carrying a bearer token, as the handler receives one. */
function requestWithToken(token = 'access-token') {
  return { method: 'POST', headers: { authorization: `Bearer ${token}` } };
}

beforeEach(() => {
  coachRateLimiter.reset();
  coachInFlight.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consumeSharedQuota', () => {
  it('spends with the caller token and reports the remaining allowance', async () => {
    const fetchMock = quotaFetch({ allowed: true, remaining: 7, retry_after_seconds: 0 });

    const outcome = await consumeSharedQuota(
      CONFIG,
      'access-token',
      RULE,
      fetchMock as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ status: 'allowed', remaining: 7 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://project.supabase.co/rest/v1/rpc/coach_consume_quota');
    // The caller's own token, not a service key: RLS is what scopes the row.
    expect(init.headers.Authorization).toBe('Bearer access-token');
    expect(JSON.parse(init.body)).toEqual({ p_limit: 2, p_window_seconds: 3600 });
  });

  it('reports exhaustion, with the time to wait', async () => {
    const fetchMock = quotaFetch({ allowed: false, remaining: 0, retry_after_seconds: 42 });

    const outcome = await consumeSharedQuota(
      CONFIG,
      'access-token',
      RULE,
      fetchMock as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ status: 'exhausted', retryAfterSeconds: 42 });
  });

  it('reports an unreachable store rather than an allowance problem', async () => {
    const fetchMock = quotaFetch({}, 500);

    const outcome = await consumeSharedQuota(
      CONFIG,
      'access-token',
      RULE,
      fetchMock as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ status: 'unavailable' });
    expect(getSharedQuotaState()).toBe('unavailable');
  });

  it('treats an unreadable row as an unreachable store', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true, text: async () => 'not json' }));

    const outcome = await consumeSharedQuota(
      CONFIG,
      'access-token',
      RULE,
      fetchMock as unknown as typeof fetch,
    );

    expect(outcome).toEqual({ status: 'unavailable' });
  });
});

describe('admitRequest', () => {
  it('spends the shared allowance for a signed-in caller', async () => {
    const fetchMock = quotaFetch({ allowed: true, remaining: 1, retry_after_seconds: 0 });
    vi.stubGlobal('fetch', fetchMock);

    const admission = await admitRequest(requestWithToken(), userGrant(), RULES, {
      SUPABASE_URL: CONFIG.url,
      SUPABASE_ANON_KEY: CONFIG.anonKey,
    });

    expect(admission.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    admission.ok && admission.release();
  });

  it('refuses an exhausted caller without falling back to this instance', async () => {
    // The fallback exists for a broken store, not for a genuine refusal: if this returned a
    // local grant, an exhausted trader could keep asking on another instance.
    const fetchMock = quotaFetch({ allowed: false, remaining: 0, retry_after_seconds: 30 });
    vi.stubGlobal('fetch', fetchMock);

    const admission = await admitRequest(requestWithToken(), userGrant(), RULES, {
      SUPABASE_URL: CONFIG.url,
      SUPABASE_ANON_KEY: CONFIG.anonKey,
    });

    expect(admission).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: 30,
    });
  });

  it('falls back to the instance counter when the store is unavailable', async () => {
    const fetchMock = quotaFetch({}, 503);
    vi.stubGlobal('fetch', fetchMock);

    const admission = await admitRequest(requestWithToken(), userGrant(), RULES, {
      SUPABASE_URL: CONFIG.url,
      SUPABASE_ANON_KEY: CONFIG.anonKey,
    });

    // Allowed by the fallback limiter, which is what keeps a missing table from becoming an
    // outage. The next request within the same window is then counted locally.
    expect(admission.ok).toBe(true);
    admission.ok && admission.release();
  });

  it('uses the instance counter for the anonymous fallback, without any store call', async () => {
    const fetchMock = quotaFetch({ allowed: true, remaining: 1, retry_after_seconds: 0 });
    vi.stubGlobal('fetch', fetchMock);

    const admission = await admitRequest(
      requestWithToken(''),
      { ok: true, identity: 'anonymous', limitKey: 'ip:1.2.3.4', rule: RULES.anon },
      RULES,
      {},
    );

    expect(admission.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    admission.ok && admission.release();
  });

  it('holds one caller to the in-flight ceiling', async () => {
    const fetchMock = quotaFetch({ allowed: true, remaining: 5, retry_after_seconds: 0 });
    vi.stubGlobal('fetch', fetchMock);
    const env = { SUPABASE_URL: CONFIG.url, SUPABASE_ANON_KEY: CONFIG.anonKey };

    const first = await admitRequest(requestWithToken(), userGrant(), { ...RULES, maxInFlight: 1 }, env);
    const second = await admitRequest(requestWithToken(), userGrant(), { ...RULES, maxInFlight: 1 }, env);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'too_many_in_flight', retryAfterSeconds: 20 });

    // Releasing frees the slot for the next answer.
    first.ok && first.release();
    const third = await admitRequest(requestWithToken(), userGrant(), { ...RULES, maxInFlight: 1 }, env);
    expect(third.ok).toBe(true);
    third.ok && third.release();
  });
});
