import type { Trade, TradingDay } from '../../types';
import { realizedPnL } from '../analytics/realized-pnl';
import { routineProgress, type RoutineReadiness } from './routine-progress';
import { ROUTINE_CRITICAL_STEPS } from './routine-template';

/**
 * Whether running the routine is worth anything, said in the trader's own money.
 *
 * This is the only part of the feature that can change behaviour, because it is the only part
 * that is evidence rather than instruction. Everything else in the routine is somebody else's
 * advice; this compares the trader's prepared days against their unprepared ones and lets the
 * account say which is which.
 *
 * Two deliberate restraints, both about not lying with a small sample:
 *
 * - The P&L comparison uses only days that actually traded. A day with the routine skipped and
 *   no trades has a P&L of exactly zero, and folding those in would drag the unprepared average
 *   toward zero and flatter the routine for no reason. Skipping the routine and not trading is
 *   not a loss, it is a day off, and it does not belong in the comparison.
 * - Averages are returned as `null` rather than as zero when nothing falls on one side, so the
 *   caller has to say "no evidence yet" instead of printing a confident $0.00.
 *
 * It is still not a controlled experiment and the UI says so. Ten prepared days and ten
 * unprepared ones is an observation, not proof, and a trader who reads it as proof is being
 * handed a new superstition.
 */

export interface RoutineDayRow {
  tradingDayId: string;
  /** YYYY-MM-DD, so the row can be sorted and read without its day. */
  tradeDate: string;
  done: number;
  total: number;
  /** 0-100. */
  pct: number;
  readiness: RoutineReadiness;
  /** Every critical step ticked: the day the gate would have opened. */
  prepared: boolean;
  /** Every step in every phase ticked. */
  complete: boolean;
  /** The day's realized P&L across the trades recorded against it. */
  pnl: number;
  tradeCount: number;
}

export interface RoutineConsistency {
  /** Days carrying a routine record, newest first. Days never touched are not listed. */
  rows: RoutineDayRow[];
  /** How many of those days had every critical step ticked. */
  preparedDays: number;
  /** How many had every step ticked, phase by phase. */
  completeDays: number;
  /** Days on the record with the routine started at all. */
  trackedDays: number;
  /** `preparedDays / trackedDays`, 0-100. Zero when nothing is tracked. */
  preparedRate: number;
  /** Consecutive most-recent tracked days that were prepared. */
  currentStreak: number;
  longestStreak: number;
  /** Average day P&L across prepared days that traded, or null when there are none. */
  avgPnLPrepared: number | null;
  /** The same across unprepared days that traded, or null when there are none. */
  avgPnLUnprepared: number | null;
  /** `prepared - unprepared` in dollars, or null when either side is empty. */
  pnlDelta: number | null;
  /** Days that traded and carry a routine record — the P&L sample, both sides together. */
  comparedDays: number;
  /** How many critical steps the template has, so the UI can say "4 of 5". */
  criticalTotal: number;
}

/** Rounds to cents: P&L is money and is displayed to two places. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The day's realized P&L.
 *
 * Because the rows are sorted by date, this is where a trade whose day record has gone
 * missing would otherwise vanish silently. Such a trade is skipped — see the note on orphan
 * trades in the builder — but the count of days that traded is taken from the trades that did
 * resolve, so the comparison's own sample size stays honest.
 */
function pnlForDay(trades: Trade[]): { pnl: number; count: number } {
  let pnl = 0;
  for (const trade of trades) pnl += realizedPnL(trade);
  return { pnl: round2(pnl), count: trades.length };
}

/** Consecutive prepared days, walking `preparedFlags` from the newest end. */
function streakFrom(preparedFlags: boolean[]): number {
  let streak = 0;
  for (const prepared of preparedFlags) {
    if (!prepared) break;
    streak += 1;
  }
  return streak;
}

/** The longest run of prepared days anywhere in the list. */
function longestStreakIn(preparedFlags: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const prepared of preparedFlags) {
    run = prepared ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Builds the read.
 *
 * `tradingDays` may arrive in any order; the rows are sorted newest-first here so every
 * caller reads the same order. Days are matched to their trades by `tradingDayId`, the same
 * link the rest of the journal uses, so a trade is only ever counted against the day it was
 * recorded under.
 */
export function buildRoutineConsistency(input: {
  tradingDays: TradingDay[];
  trades: Trade[];
}): RoutineConsistency {
  const { tradingDays, trades } = input;

  const tradesByDay = new Map<string, Trade[]>();
  for (const trade of trades) {
    const list = tradesByDay.get(trade.tradingDayId);
    if (list) list.push(trade);
    else tradesByDay.set(trade.tradingDayId, [trade]);
  }

  const rows: RoutineDayRow[] = tradingDays
    // A day is on the routine record only once it carries one. Days the trader never touched
    // are left out entirely rather than counted as failures, because a day that predates the
    // feature, or one the app created but nobody opened, is not evidence about anything.
    .filter((day) => Boolean(day.routine))
    .map((day) => {
      const progress = routineProgress(day.routine);
      const { pnl, count } = pnlForDay(tradesByDay.get(day.id) ?? []);
      return {
        tradingDayId: day.id,
        tradeDate: day.tradeDate,
        done: progress.done,
        total: progress.total,
        pct: progress.pct,
        readiness: progress.readiness,
        prepared: progress.criticalOutstanding.length === 0,
        complete: progress.readiness === 'complete',
        pnl,
        tradeCount: count,
      };
    })
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));

  const preparedFlags = rows.map((row) => row.prepared);

  // Days that traded, split by whether the routine was run. Days that did not trade are left
  // out on both sides, for the reason given in the file comment above.
  const traded = rows.filter((row) => row.tradeCount > 0);
  const preparedPnLs = traded.filter((row) => row.prepared).map((row) => row.pnl);
  const unpreparedPnLs = traded.filter((row) => !row.prepared).map((row) => row.pnl);

  const average = (values: number[]): number | null =>
    values.length === 0 ? null : round2(values.reduce((sum, v) => sum + v, 0) / values.length);

  const avgPnLPrepared = average(preparedPnLs);
  const avgPnLUnprepared = average(unpreparedPnLs);

  const preparedDays = preparedFlags.filter(Boolean).length;
  const trackedDays = rows.length;

  return {
    rows,
    preparedDays,
    completeDays: rows.filter((row) => row.complete).length,
    trackedDays,
    preparedRate: trackedDays === 0 ? 0 : Math.round((preparedDays / trackedDays) * 100),
    currentStreak: streakFrom(preparedFlags),
    longestStreak: longestStreakIn(preparedFlags),
    avgPnLPrepared,
    avgPnLUnprepared,
    pnlDelta:
      avgPnLPrepared !== null && avgPnLUnprepared !== null
        ? round2(avgPnLPrepared - avgPnLUnprepared)
        : null,
    comparedDays: traded.length,
    criticalTotal: ROUTINE_CRITICAL_STEPS.length,
  };
}
