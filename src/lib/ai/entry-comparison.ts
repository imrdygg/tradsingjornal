import type { Trade } from '../../types';
import { isCoachEntryCall } from './coach-types';

/**
 * The coach's call against the trader's own entry.
 *
 * The point of this module is to be the honest half of the feature: the coach is asked
 * for a direction and a level at the moment an entry is recorded, both are stored, and
 * this works out where they differed. It is deliberately pure — no coach call, no
 * storage — so the comparison can be unit tested and so a missing coach answer is a
 * first-class outcome rather than an error.
 *
 * The comparison is about DIRECTION first and price second, because direction is the
 * part the coach can actually be right or wrong about. The price difference says
 * something much smaller: who got the better fill on the same idea.
 */

export type ComparisonVerdict =
  /** Coach named the same side. */
  | 'agreed'
  /** Coach named the other side. */
  | 'opposed'
  /** Coach would not have been in a trade at all. */
  | 'coach-flat'
  /** No coach call was recorded (offline, unconfigured, or the request failed). */
  | 'no-call';

export interface EntryComparison {
  tradeId: string;
  traderDirection: 'long' | 'short';
  verdict: ComparisonVerdict;
  coachDirection: 'long' | 'short' | 'flat' | null;
  /** The coach's level, when it named one. */
  coachEntry: number | null;
  traderEntry: number;
  /**
   * Points the TRADER gained against the coach's level, positive meaning the trader's
   * fill was better. Sign is normalised for side: for a long, entering lower is better;
   * for a short, entering higher is. Null when the coach gave no usable level.
   */
  priceEdge: number | null;
  rationale: string;
  createdAt: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Points the trader's fill beat the coach's level by, positive when it did. */
export function traderPriceEdge(
  direction: 'long' | 'short',
  traderEntry: number,
  coachEntry: number | null
): number | null {
  if (coachEntry === null || !Number.isFinite(coachEntry)) return null;
  // Judged on the side that was actually traded: for a long, filling BELOW the coach's
  // level is the better fill; for a short, filling above it is.
  const diff = direction === 'long' ? coachEntry - traderEntry : traderEntry - coachEntry;
  return round(diff);
}

/** The comparison for one trade, or null when the coach never made a call on it. */
export function compareEntry(trade: Trade): EntryComparison | null {
  const call = trade.coachCall;
  if (!isCoachEntryCall(call)) return null;

  const direction = trade.direction;
  const verdict: ComparisonVerdict =
    call.direction === 'flat' ? 'coach-flat' : call.direction === direction ? 'agreed' : 'opposed';

  return {
    tradeId: trade.id,
    traderDirection: direction,
    verdict,
    coachDirection: call.direction,
    coachEntry: call.entry,
    traderEntry: trade.entryPrice,
    priceEdge: traderPriceEdge(direction, trade.entryPrice, call.entry),
    rationale: call.rationale,
    createdAt: call.createdAt ?? null,
  };
}

/** The scoreboard numbers, shared by every view of the same calls. */
export interface ComparisonMetrics {
  /** Entries the coach actually made a call on. */
  compared: number;
  agreed: number;
  opposed: number;
  /** Calls where the coach would have stood aside. */
  coachFlat: number;
  /**
   * Agreed as a share of the calls that took a side, 0–100. Null when the coach took no
   * side at all, because a percentage over zero directional calls would be meaningless.
   */
  agreementRate: number | null;
  /** Average points the trader's fill beat the coach's level by, when it had one. */
  avgTraderEdgePoints: number | null;
}

/**
 * The shared arithmetic, in one place so no two views of the same calls can disagree.
 *
 * A stand-aside is deliberately excluded from the agreement rate: the coach saying "I
 * would not be in this" is neither agreement nor opposition, and folding it into either
 * would move the number without any new information behind it.
 */
function metricsFor(comparisons: EntryComparison[]): ComparisonMetrics {
  const agreed = comparisons.filter((c) => c.verdict === 'agreed').length;
  const opposed = comparisons.filter((c) => c.verdict === 'opposed').length;
  const coachFlat = comparisons.filter((c) => c.verdict === 'coach-flat').length;
  const directional = agreed + opposed;

  const edges = comparisons
    .map((c) => c.priceEdge)
    .filter((edge): edge is number => edge !== null);

  return {
    compared: comparisons.length,
    agreed,
    opposed,
    coachFlat,
    agreementRate: directional > 0 ? Math.round((agreed / directional) * 100) : null,
    avgTraderEdgePoints: edges.length
      ? round(edges.reduce((sum, edge) => sum + edge, 0) / edges.length)
      : null,
  };
}

/** Every comparison the given trades carry. */
function comparisonsOf(trades: Trade[]): EntryComparison[] {
  return trades
    .map((trade) => compareEntry(trade))
    .filter((comparison): comparison is EntryComparison => comparison !== null);
}

export interface EntryComparisonSummary extends ComparisonMetrics {
  comparisons: EntryComparison[];
}

/** The day's (or any set's) comparison, from the trades that carry a coach call. */
export function summariseEntryComparisons(trades: Trade[]): EntryComparisonSummary {
  const comparisons = comparisonsOf(trades);
  return { ...metricsFor(comparisons), comparisons };
}

/** One day of comparison, for the scoreboard chart and table. */
export interface DailyComparisonRow extends ComparisonMetrics {
  /** The trading date, YYYY-MM-DD. */
  date: string;
  /**
   * Agreement across every directional call up to and including this day. This is the
   * number that actually settles a disagreement: a single day is one or two entries and
   * tells you almost nothing, while the running rate is what shows whether the coach is
   * reading the moment the same way over a real sample.
   */
  runningAgreementRate: number | null;
}

/**
 * Groups the comparisons by trading day, oldest first.
 *
 * The date is supplied by the caller rather than read off the trade, because a trade's
 * `entryTime` is a timestamp while the journal's days are keyed by the trader's own
 * trading date — a late-night entry belongs to the day the trader was trading, not to the
 * calendar day its timestamp happens to fall on.
 */
export function summariseComparisonsByDay(
  trades: Trade[],
  dateOf: (trade: Trade) => string | null
): DailyComparisonRow[] {
  const byDate = new Map<string, EntryComparison[]>();

  for (const trade of trades) {
    const comparison = compareEntry(trade);
    if (!comparison) continue;
    const date = dateOf(trade);
    if (!date) continue;
    const existing = byDate.get(date);
    if (existing) existing.push(comparison);
    else byDate.set(date, [comparison]);
  }

  let runningAgreed = 0;
  let runningDirectional = 0;

  return [...byDate.keys()].sort().map((date) => {
    const metrics = metricsFor(byDate.get(date) ?? []);

    runningAgreed += metrics.agreed;
    runningDirectional += metrics.agreed + metrics.opposed;

    return {
      date,
      ...metrics,
      runningAgreementRate:
        runningDirectional > 0 ? Math.round((runningAgreed / runningDirectional) * 100) : null,
    };
  });
}

/** One group of the scoreboard: a setup, a session, or any other slice. */
export interface ComparisonGroupRow extends ComparisonMetrics {
  label: string;
}

/**
 * Groups the comparisons by a label the caller supplies — a setup, a session, an
 * instrument — so a breakdown does not need its own arithmetic or its own rules about
 * missing data.
 *
 * Rows are ordered by how many directional calls they contain, because a group built on
 * one entry is a coincidence, and putting it beside a group built on twenty invites
 * exactly the wrong comparison. Ties fall back to the label so the order is stable.
 */
export function groupComparisons(
  trades: Trade[],
  labelOf: (trade: Trade) => string | null
): ComparisonGroupRow[] {
  const byLabel = new Map<string, EntryComparison[]>();

  for (const trade of trades) {
    const comparison = compareEntry(trade);
    if (!comparison) continue;
    const label = labelOf(trade);
    if (!label) continue;
    const existing = byLabel.get(label);
    if (existing) existing.push(comparison);
    else byLabel.set(label, [comparison]);
  }

  return [...byLabel.entries()]
    .map(([label, comparisons]) => ({ label, ...metricsFor(comparisons) }))
    .sort(
      (a, b) =>
        b.agreed + b.opposed - (a.agreed + a.opposed) || a.label.localeCompare(b.label)
    );
}

/**
 * How many directional calls a group needs before its rate is worth reading. Below this
 * the UI labels the row as a thin sample rather than presenting a percentage as a finding.
 */
export const MIN_DIRECTIONAL_SAMPLE = 3;

export function isThinSample(row: ComparisonGroupRow): boolean {
  return row.agreed + row.opposed < MIN_DIRECTIONAL_SAMPLE;
}

/** Short verdict label for a badge. */
export function verdictLabel(verdict: ComparisonVerdict): string {
  switch (verdict) {
    case 'agreed':
      return 'Coach agreed';
    case 'opposed':
      return 'Coach opposed';
    case 'coach-flat':
      return 'Coach was flat';
    default:
      return 'No coach call';
  }
}
