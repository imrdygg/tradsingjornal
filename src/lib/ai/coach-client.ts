import { Instrument, Trade, TradingDay } from '../../types';
import { instrumentSymbol } from '../trading/instruments';
import {
  buildPositionGroups,
  findPositionGroup,
  TradePositionGroup,
} from '../trading/position-groups';
import type { CoachMode, CoachResponse, CoachTradeFacts } from './coach-types';
import type { JournalDigest } from './journal-digest';

/**
 * Frontend half of the coach.
 *
 * This module never sees an API key and never builds a prompt: it posts the journal
 * digest to the serverless function and gets validated JSON back. That split is what
 * keeps the key off the client and the guardrails out of the browser's reach.
 */

export type CoachErrorCode =
  | 'unconfigured'
  | 'network'
  | 'rate_limited'
  | 'bad_key'
  | 'bad_response'
  | 'server';

export type CoachResult =
  | { ok: true; data: CoachResponse }
  | { ok: false; code: CoachErrorCode; message: string };

/** How long to wait before giving up on the coach. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Explains the one failure that is otherwise impossible to diagnose from the UI: a
 * response that is not JSON at all. That means the request never reached the function,
 * and the status and content type say which way it went.
 */
export function explainNonJsonResponse(status: number, contentType: string): string {
  const base = `The coach service did not answer with JSON (HTTP ${status}, content-type "${contentType || 'none'}").`;

  // Always ends with the same instruction: the health check distinguishes "not
  // deployed" from "deployed but misconfigured" in one click.
  const hint =
    ' Open /api/coach in a browser tab to check: it should show a small JSON health ' +
    'check naming the models it will use. If you see this app instead, the api/coach ' +
    'function was not deployed with this build.';

  if (status === 200) {
    return (
      `${base} A 200 with HTML means this app answered in place of the function, so ` +
      'api/coach was not deployed. On the host, check the deployment\u2019s Functions ' +
      'list and confirm api/coach is in it.' +
      hint
    );
  }
  if (status === 404) {
    return (
      `${base} A 404 means the function is not there. On Vercel the api/ directory at the ` +
      'project root becomes a function at api/coach automatically, so check the file is ' +
      'committed and that the host is deploying this repository.' +
      hint
    );
  }
  if (status >= 500) {
    return (
      `${base} A server error here usually means the function started and then crashed. ` +
      'Check the host\u2019s function logs for the stack trace.' +
      hint
    );
  }
  return base + hint;
}

/**
 * Shown when the endpoint cannot be reached at all: a local Vite dev server, an
 * unchecked-in api directory, or a host that does not deploy functions.
 */
export const COACH_UNAVAILABLE_MESSAGE =
  'The coach service is not running here. Local `npm run dev` does not serve serverless ' +
  'functions, so the coach only works on the deployed site or under `vercel dev`. To check ' +
  'a deployment, open /api/coach in a browser tab: it should show a small JSON health ' +
  'check. If you see the app instead, the api/coach function was not deployed.';

/**
 * Converts a stored trade into the fact sheet the coach reasons about. Only values
 * already recorded on the trade are included — nothing is estimated, and a missing
 * figure stays missing so the coach is told the journal does not record it.
 */
export function buildTradeFacts(
  trade: Trade,
  context: {
    instruments: Instrument[];
    day?: TradingDay;
    positionGroup?: TradePositionGroup;
    allTrades?: Trade[];
  }
): CoachTradeFacts {
  const { instruments, day } = context;
  // Only group when the caller handed us the full trade list. Without it we cannot
  // know whether this trade is a leg of a larger position.
  const groups = context.allTrades ? buildPositionGroups(context.allTrades) : undefined;
  const group = context.positionGroup ?? findPositionGroup(groups, trade);

  return {
    symbol: instrumentSymbol(instruments, trade.instrumentId),
    direction: trade.direction,
    contracts: trade.contracts,
    entryPrice: trade.entryPrice,
    initialStop: trade.initialStop,
    exitPrice: trade.exitPrice,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    session: trade.session,
    setupName: trade.setupName,
    source: trade.source === 'tradovate_csv' ? 'imported from a broker CSV' : 'recorded by hand',
    status: trade.status,
    entryReason: trade.entryReason,
    notes: trade.notes,
    tags: trade.tags,
    initialRisk: trade.initialRisk,
    grossPnL: trade.grossPnL,
    netPnL: trade.netPnL,
    pointsPnL: trade.pointsPnL,
    rMultiple: trade.rMultiple,
    management: trade.tradeManagement
      ? {
          breakevenPrice: trade.tradeManagement.breakevenPrice,
          profitSecured: trade.tradeManagement.profitSecured,
          trailingMethod: trade.tradeManagement.trailingMethod,
          notes: trade.tradeManagement.notes,
        }
      : undefined,
    executionReview: trade.executionReview
      ? {
          followedSetup: trade.executionReview.followedSetup,
          followedStop: trade.executionReview.followedStop,
          chasedEntry: trade.executionReview.chasedEntry,
          revengeTrade: trade.executionReview.revengeTrade,
          addedUnnecessaryRisk: trade.executionReview.addedUnnecessaryRisk,
          movedStopEmotion: trade.executionReview.movedStopEmotion,
          letWinnerWork: trade.executionReview.letWinnerWork,
          wouldTakeAgain: trade.executionReview.wouldTakeAgain,
        }
      : undefined,
    positionLegs: group && group.legCount > 1 ? group.legCount : undefined,
    positionAvgEntry: group && group.legCount > 1 ? group.averageEntry : undefined,
    positionTotalContracts: group && group.legCount > 1 ? group.totalContracts : undefined,
    dayPlan: day
      ? {
          plannedLossLimit: day.plannedLossLimit,
          contractsPlanned: day.contractsPlanned,
          allowedSessions: day.allowedSessions,
          watchedSetups: day.watchedSetups,
          primaryInstrument: day.primaryInstrument,
          marketBias: day.marketBias,
          waitingFor: day.waitingFor,
          stayOutIf: day.stayOutIf,
        }
      : undefined,
  };
}

function isJsonResponse(res: Response): boolean {
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('application/json');
}

/**
 * Sends a digest to the coach and returns validated JSON, or a typed failure.
 *
 * A non-JSON response is treated as "the function is not deployed" rather than an
 * error, because that is what both `vite dev` and a missing function actually return.
 */
export async function requestCoach(
  mode: CoachMode,
  digest: JournalDigest,
  trade?: CoachTradeFacts
): Promise<CoachResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, digest, trade }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      code: 'network',
      message: aborted
        ? 'The coach took too long to answer and the request was stopped. Try again.'
        : 'Could not reach the coach service. Check your connection and try again.',
    };
  }
  clearTimeout(timeout);

  if (!isJsonResponse(res)) {
    const contentType = res.headers.get('content-type') ?? '';
    // Distinguish "the app answered" from "nothing answered" — the fixes are different.
    const looksLikeTheApp = res.status === 200 || contentType.includes('text/html');
    return {
      ok: false,
      code: 'unconfigured',
      message: looksLikeTheApp
        ? explainNonJsonResponse(res.status, contentType)
        : COACH_UNAVAILABLE_MESSAGE,
    };
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: 'bad_response',
      message: 'The coach service returned a response that could not be read.',
    };
  }

  if (!res.ok) {
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : `The coach service returned an error (HTTP ${res.status}).`;
    const code = payload?.code;
    const mapped: CoachErrorCode =
      code === 'unconfigured'
        ? 'unconfigured'
        : code === 'rate_limited'
        ? 'rate_limited'
        : code === 'bad_key'
        ? 'bad_key'
        : code === 'model_unavailable'
        ? 'rate_limited'
        : 'server';
    return { ok: false, code: mapped, message };
  }

  const data = payload?.data;
  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      code: 'bad_response',
      message: 'The coach replied without any content.',
    };
  }

  return { ok: true, data: data as CoachResponse };
}
