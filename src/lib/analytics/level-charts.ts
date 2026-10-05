import type { Instrument, LevelTouch, MarkedLevel } from '../../types';
import { instrumentSymbol } from '../trading/instruments';
import { formatTradingDate, timeInTimezone } from '../storage/date-utils';
import { summarizeMarkedLevels, summarizeTouches } from './level-edge';
import {
  MIN_MARKED_FOR_IGNORE,
  MIN_UNTESTED_FOR_IGNORE,
  summarizeTimeframeEdges,
  timeframeBucketLabel,
  timeframeHighlights,
} from './level-timeframes';

/**
 * The level record, shaped for the charts.
 *
 * The level cards read the record as counts and rates; this module turns the same two records
 * — the lines the trader marked before anything touched them, and the touches they logged after
 * — into plain series that a chart can plot. Nothing here decides anything the other modules do
 * not already decide: it groups by symbol, walks the touches in the order they happened, and
 * counts the days. Every builder is pure and takes no React, so the shapes can be tested without
 * a browser.
 *
 * Four series, matching the four questions the charts answer:
 *
 * 1. **Coverage by symbol** — of the lines marked for each contract, how many price reached, how
 *    many the trader closed out as never reached, and how many are still open.
 * 2. **Edge building over time** — the hold rate as decided touches accumulate, oldest first, so
 *    the record can show whether the edge is holding up or thinning.
 * 3. **Touch timeline** — every touch placed on the clock at the price it printed, coloured by
 *    what price did afterwards.
 * 4. **Coverage by session** — per trading day, how many lines were marked and how many of them
 *    were reached, so a day of many lines and no touches reads plainly.
 * 5. **Two contracts side by side** — the same coverage counts, plus the hold rate, for the two
 *    contracts the trader picks, on one shared axis so the comparison is direct.
 *
 * The one finding pulled out of these series is {@link buildLevelFixup}: the line the trader keeps
 * marking while price never reaches it. It is a blind spot in their attention, not a prediction,
 * and it is stated only once the counts clear the same floors the rest of the record uses.
 */

/** One contract's mark-and-touch record, as a bar. */
export interface SymbolCoverageRow {
  instrumentId: string;
  symbol: string;
  /** Active lines marked for this contract: voided lines are excluded. */
  marked: number;
  /** Marked lines price reached and the trader logged a touch against. */
  tested: number;
  /** Untested lines closed out as never reached — a deliberate count, not merely unlogged. */
  neverTouched: number;
  /** Untested lines with no answer yet. */
  open: number;
  /** Tested / marked as a percentage, or null while nothing was marked. */
  testRate: number | null;
}

/**
 * Groups the marked lines by contract and reads each group's coverage.
 *
 * Uses {@link summarizeMarkedLevels} so a line counts as tested exactly the way the edge finder
 * counts it — a touch linking back to the level — and a `void` line is dropped here the same way.
 * Ordered busiest first, so the contracts the trader actually works lead.
 */
export function buildSymbolCoverage(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  instruments: Instrument[]
): SymbolCoverageRow[] {
  const groups = new Map<string, MarkedLevel[]>();
  for (const level of levels) {
    const list = groups.get(level.instrumentId);
    if (list) list.push(level);
    else groups.set(level.instrumentId, [level]);
  }

  return [...groups.entries()]
    .map(([instrumentId, group]) => {
      const coverage = summarizeMarkedLevels(group, touches);
      return {
        instrumentId,
        symbol: instrumentSymbol(instruments, instrumentId),
        marked: coverage.marked,
        tested: coverage.tested,
        neverTouched: coverage.neverTouched,
        open: coverage.untested - coverage.neverTouched,
        testRate: coverage.testRate,
      };
    })
    .sort((a, b) => b.marked - a.marked || a.symbol.localeCompare(b.symbol));
}

/** One contract's side of a comparison. */
export interface SymbolComparisonSide {
  instrumentId: string;
  symbol: string;
  /** Active lines marked for this contract: voided lines are excluded. */
  marked: number;
  /** Marked lines price reached and the trader logged a touch against. */
  tested: number;
  /** Untested lines closed out as never reached. */
  neverTouched: number;
  /** Untested lines with no answer yet. */
  open: number;
  /** Tested / marked as a percentage, or null while nothing was marked. */
  testRate: number | null;
  /** Decided touches logged for this contract (never-returned plus returned). */
  decided: number;
  /** Decided touches where price never came back. */
  neverReturned: number;
  /** Share of decided touches that held, or null until a touch is decided. */
  holdRate: number | null;
  /** True when `decided` clears the sample floor, so the hold rate may be read as a rate. */
  enoughData: boolean;
}

/** One grouped pair of bars, sharing a metric on the axis. */
export interface SymbolComparisonRow {
  /** The metric, in the trader's words, e.g. `Reached`. */
  metric: string;
  left: number;
  right: number;
}

/** Two contracts read side by side on one shared axis. */
export interface SymbolComparison {
  left: SymbolComparisonSide;
  right: SymbolComparisonSide;
  /** The coverage counts as grouped bars, so both contracts share the same scale. */
  rows: SymbolComparisonRow[];
}

/**
 * Reads two contracts against each other.
 *
 * The coverage view draws every contract on one axis already, but only as totals; this pairs
 * two chosen contracts so the counts sit next to each other and their hold rates can be read
 * without moving a selector between them. Both sides use the same rules as the rest of the
 * record — a line is tested when a touch links back to it, `void` lines are dropped, and a
 * hold rate is only reported once its decided sample clears {@link summarizeTouches}'s floor.
 * A contract with nothing marked still returns a zeroed side rather than being omitted, so the
 * comparison always has two columns.
 */
export function buildSymbolComparison(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  instruments: Instrument[],
  leftId: string,
  rightId: string
): SymbolComparison {
  const coverage = buildSymbolCoverage(levels, touches, instruments);

  const side = (instrumentId: string): SymbolComparisonSide => {
    const row = coverage.find((entry) => entry.instrumentId === instrumentId);
    const stats = summarizeTouches(touches.filter((touch) => touch.instrumentId === instrumentId));
    return {
      instrumentId,
      symbol: instrumentSymbol(instruments, instrumentId),
      marked: row?.marked ?? 0,
      tested: row?.tested ?? 0,
      neverTouched: row?.neverTouched ?? 0,
      open: row?.open ?? 0,
      testRate: row?.testRate ?? null,
      decided: stats.decided,
      neverReturned: stats.neverReturned,
      holdRate: stats.holdRate,
      enoughData: stats.enoughData,
    };
  };

  const left = side(leftId);
  const right = side(rightId);
  const rows: SymbolComparisonRow[] = [
    { metric: 'Reached', left: left.tested, right: right.tested },
    { metric: 'Still open', left: left.open, right: right.open },
    { metric: 'Never touched', left: left.neverTouched, right: right.neverTouched },
  ];
  return { left, right, rows };
}

/** The one line worth fixing, read from the whole marked record. */
export interface LevelFixup {
  /**
   * Whether the finding is about one instrument/timeframe/side bucket or, when the lines carry
   * no timeframe, about a whole contract.
   */
  scope: 'timeframe' | 'symbol';
  /** A readable target, e.g. `MES 5 min resistance` or `MNQ`. */
  label: string;
  /** Active lines marked here: voided lines are not counted. */
  marked: number;
  /** Lines price reached and the trader logged a touch against. */
  tested: number;
  /** Lines nothing has been logged against yet. */
  untested: number;
  /** Untested lines the trader closed out as never reached, a subset of `untested`. */
  neverTouched: number;
  /** Tested / marked as a percentage, or null while nothing was marked. */
  testRate: number | null;
}

/**
 * The line the trader keeps marking that price never reaches.
 *
 * Reads the same two records the charts plot and picks the one blind spot worth naming. It
 * prefers a timeframe bucket — "MES 5 min resistance" is actionable where "MES" is not — and
 * only falls back to a whole contract when the lines were marked before timeframes existed.
 * Both routes apply the same count floors the edge finder uses, so a thin sample leaves this as
 * a tally rather than a finding: a bucket needs {@link MIN_MARKED_FOR_IGNORE} marked lines and
 * {@link MIN_UNTESTED_FOR_IGNORE} never reached before it qualifies, and a contract honours the
 * same floors. Returns null when nothing clears them.
 */
export function buildLevelFixup(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  instruments: Instrument[]
): LevelFixup | null {
  const buckets = summarizeTimeframeEdges(levels, touches);
  const { mostIgnored } = timeframeHighlights(buckets);
  if (mostIgnored) {
    return {
      scope: 'timeframe',
      label: timeframeBucketLabel(mostIgnored, instrumentSymbol(instruments, mostIgnored.instrumentId)),
      marked: mostIgnored.marked,
      tested: mostIgnored.tested,
      untested: mostIgnored.untested,
      neverTouched: mostIgnored.neverTouched,
      testRate: mostIgnored.testRate,
    };
  }

  const row = buildSymbolCoverage(levels, touches, instruments)
    .filter(
      (entry) =>
        entry.marked >= MIN_MARKED_FOR_IGNORE &&
        entry.open + entry.neverTouched >= MIN_UNTESTED_FOR_IGNORE &&
        entry.testRate !== null &&
        entry.testRate < 100
    )
    .sort((a, b) => (a.testRate ?? 0) - (b.testRate ?? 0) || b.marked - a.marked)[0];

  if (!row) return null;
  return {
    scope: 'symbol',
    label: row.symbol,
    marked: row.marked,
    tested: row.tested,
    untested: row.open + row.neverTouched,
    neverTouched: row.neverTouched,
    testRate: row.testRate,
  };
}

/** One step on the accumulating hold-rate line. */
export interface EdgeCurvePoint {
  /** Decided touches counted so far — the sample the rate is drawn from. */
  index: number;
  /** The trading date of this touch, for the axis. */
  date: string;
  /** Decided touches so far (never came back plus returned). */
  decided: number;
  /** Cumulative share of decided touches where price never came back, as a percentage. */
  holdRate: number;
}

/**
 * Walks the decided touches in the order they happened, reporting the hold rate each step of
 * the way.
 *
 * Only decided touches (never-returned or returned) move the line: a touch still being watched
 * has no answer to count, exactly as `summarizeTouches` treats it. Invalid touches are dropped.
 * The result is the trader's own edge accumulating — the chart that shows whether the first few
 * good touches were a run or a pattern.
 */
export function buildEdgeCurve(touches: LevelTouch[]): EdgeCurvePoint[] {
  const decided = touches
    .filter((touch) => touch.outcome === 'never-returned' || touch.outcome === 'returned')
    .map((touch) => ({ touch, at: touchStamp(touch) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const points: EdgeCurvePoint[] = [];
  let neverReturned = 0;
  decided.forEach(({ touch }, index) => {
    if (touch.outcome === 'never-returned') neverReturned += 1;
    const count = index + 1;
    points.push({
      index: count,
      date: touch.tradeDate,
      decided: count,
      holdRate: round((neverReturned / count) * 100, 1),
    });
  });
  return points;
}

/** One touch placed on the timeline. */
export interface TouchTimelinePoint {
  id: string;
  /** The instant of the touch, in epoch milliseconds, for the horizontal axis. */
  x: number;
  /** The price the line was at, for the vertical axis. */
  y: number;
  outcome: LevelTouch['outcome'];
  /** The trading date of the touch. */
  date: string;
  /** The clock time the touch was logged, on the trader's own clock (`HH:MM`). */
  time: string;
  priceLabel: number;
}

/**
 * Every logged touch as a point on the clock, coloured by what price did.
 *
 * Touches with no readable timestamp or price are skipped rather than plotted at zero, which
 * would put a false point on the axis. Covers `watching` as well as decided outcomes, so a
 * still-forming touch is shown grey rather than hidden — the trader can see the tests that have
 * not answered yet.
 */
export function buildTouchTimeline(touches: LevelTouch[], timezone: string): TouchTimelinePoint[] {
  return touches
    .filter((touch) => Number.isFinite(touch.price) && touch.outcome !== 'invalid')
    .map((touch) => {
      const at = touchStamp(touch);
      return {
        id: touch.id,
        x: at.getTime(),
        y: touch.price,
        outcome: touch.outcome,
        date: touch.tradeDate,
        time: timeInTimezone(at, timezone),
        priceLabel: touch.price,
      };
    })
    .sort((a, b) => a.x - b.x);
}

/** One session's mark-and-touch coverage, as a stacked bar. */
export interface SessionCoverageRow {
  date: string;
  /** A short readable date, e.g. `Sep 22`. */
  label: string;
  marked: number;
  tested: number;
  untested: number;
  /** Untested lines closed out as never reached, a subset of `untested`. */
  neverTouched: number;
}

/**
 * Per trading session, how many lines the trader marked and how many were reached.
 *
 * The most recent `maxSessions` days are returned, oldest first, so the bars read left to right
 * in time. A line counts as tested when a touch links back to it, the same rule the coverage
 * totals use. `void` lines are dropped. Days with no marked line are left out rather than drawn
 * as empty bars.
 */
export function buildSessionCoverage(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  maxSessions = 14
): SessionCoverageRow[] {
  const active = levels.filter((level) => level.resolution !== 'void');
  const levelIds = new Set(active.map((level) => level.id));
  const testedIds = new Set(
    touches.filter((touch) => touch.levelId && levelIds.has(touch.levelId)).map((t) => t.levelId as string)
  );

  const byDate = new Map<string, MarkedLevel[]>();
  for (const level of active) {
    const list = byDate.get(level.tradeDate);
    if (list) list.push(level);
    else byDate.set(level.tradeDate, [level]);
  }

  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-Math.max(1, maxSessions))
    .map(([date, group]) => {
      const tested = group.filter((level) => testedIds.has(level.id)).length;
      const neverTouched = group.filter(
        (level) => level.resolution === 'never-touched' && !testedIds.has(level.id)
      ).length;
      return {
        date,
        label: shortDate(date),
        marked: group.length,
        tested,
        untested: group.length - tested,
        neverTouched,
      };
    });
}

/** The instant a touch is stamped with, falling back to when it was logged. */
function touchStamp(touch: LevelTouch): Date {
  const date = new Date(touch.touchedAt ?? touch.createdAt);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** A trade date without its year, e.g. `Sep 22`. */
function shortDate(date: string): string {
  return formatTradingDate(date).replace(/,\s*\d{4}$/, '');
}

function round(value: number, dp = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
