import { LevelKind, LevelTimeframe, LevelTouch, MarkedLevel } from '../../types';
import { MIN_DECIDED, summarizeTouches, type LevelEdgeStats } from './level-edge';

/**
 * The timeframe record: which chart a level came off, and whether that line was ever tested.
 *
 * The trader marks support and resistance from an indicator that draws the same pattern on
 * 1m, 3m, 5m, 15m, 30m and 1h charts, for each of their instruments, every day. The hold rate
 * in `level-edge.ts` answers "when a line is tested, does price come back?". This answers the
 * two questions underneath it, which only exist because the lines are written down before they
 * are touched:
 *
 * 1. **Was the line tested at all?** A marked level nothing was ever logged against is the
 *    trader leaving a line their own indicator offered. That is a fact about their attention,
 *    not about the market, and it is reported as a count rather than a rate.
 * 2. **Which timeframe and side does price actually reach?** Once the levels carry their
 *    timeframe, the same record can say whether the 5-minute resistance gets reached more
 *    often than the 30-minute one — the pattern the trader is trying to find.
 *
 * Nothing here predicts. It counts what the trader marked and what they logged, and every
 * rate it reports carries the counts it came from.
 */

/** The six resolutions the trader's indicator draws, in the order they are shown. */
export const LEVEL_TIMEFRAMES: readonly LevelTimeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h'];

/** How a timeframe reads in the UI and in the coach's prompt. */
export const TIMEFRAME_LABEL: Record<LevelTimeframe, string> = {
  '1m': '1 min',
  '3m': '3 min',
  '5m': '5 min',
  '15m': '15 min',
  '30m': '30 min',
  '1h': '1 hour',
};

/** The kind word, for building a bucket's label. */
function kindWord(kind: LevelKind): string {
  return kind === 'support' ? 'support' : 'resistance';
}

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** One instrument, timeframe and side, with its own mark/tested record. */
export interface TimeframeEdgeBucket {
  /** Stable key, e.g. `mes|5m|resistance`, so a list can diff it. */
  key: string;
  instrumentId: string;
  /** Null when the level was marked before timeframes existed, so nothing is invented. */
  timeframe: LevelTimeframe | null;
  kind: LevelKind;
  /** Levels marked in this bucket. */
  marked: number;
  /** Marked levels that were reached and logged as a touch. */
  tested: number;
  /** Marked levels nothing has been logged against yet, confirmed or not. */
  untested: number;
  /** Untested levels the trader has explicitly closed out as never reached. */
  neverTouched: number;
  /** Tested / marked as a percentage, or null while nothing is marked here. */
  testRate: number | null;
  /** The bucket's touches, so its hold rate is read over the marked levels that were tested. */
  stats: LevelEdgeStats;
}

/**
 * Groups marked levels by instrument, timeframe and side, and reads each group's record.
 *
 * A level counts as tested when a touch links back to it, so a touch with no marked level
 * behind it (the older, mark-as-you-go record) is left out of every count here — it belongs to
 * `findLevelEdges`, not to this read. A level the trader marked `void` is dropped entirely:
 * a line set aside is not evidence about which resolutions price reaches. An untested level the
 * trader closed out as `never-touched` stays in the marked and untested counts — it really was
 * never reached — and is broken out so the record can say how much has been given an answer.
 * Buckets are ordered so the busiest record leads: most tested first, then most marked, because
 * the question being asked is which lines price actually reaches.
 */
export function summarizeTimeframeEdges(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  minDecided = 5
): TimeframeEdgeBucket[] {
  const active = levels.filter((level) => level.resolution !== 'void');
  const levelIds = new Set(active.map((level) => level.id));
  const linked = touches.filter((touch) => touch.levelId && levelIds.has(touch.levelId));

  const touchByLevel = new Map<string, LevelTouch>();
  for (const touch of linked) {
    if (touch.levelId) touchByLevel.set(touch.levelId, touch);
  }

  const groups = new Map<string, MarkedLevel[]>();
  for (const level of active) {
    const key = `${level.instrumentId}|${level.timeframe ?? 'none'}|${level.kind}`;
    const list = groups.get(key);
    if (list) list.push(level);
    else groups.set(key, [level]);
  }

  const buckets: TimeframeEdgeBucket[] = [];
  for (const [key, group] of groups) {
    const testedLevels = group.filter((level) => touchByLevel.has(level.id));
    const bucketTouches = testedLevels
      .map((level) => touchByLevel.get(level.id))
      .filter((touch): touch is LevelTouch => Boolean(touch));
    const first = group[0];
    const marked = group.length;
    const tested = testedLevels.length;
    const neverTouched = group.filter(
      (level) => level.resolution === 'never-touched' && !touchByLevel.has(level.id)
    ).length;

    buckets.push({
      key,
      instrumentId: first.instrumentId,
      timeframe: first.timeframe ?? null,
      kind: first.kind,
      marked,
      tested,
      untested: marked - tested,
      neverTouched,
      testRate: marked > 0 ? round((tested / marked) * 100, 1) : null,
      stats: summarizeTouches(bucketTouches, minDecided),
    });
  }

  return buckets.sort((a, b) => {
    if (a.tested !== b.tested) return b.tested - a.tested;
    if (a.marked !== b.marked) return b.marked - a.marked;
    return a.key.localeCompare(b.key);
  });
}

/** The fewest tested lines before "price reaches this" is said as a finding, not a one-off. */
const MIN_REACHED = 3;

/** The fewest lines marked before a low test rate says anything about attention. */
const MIN_MARKED_FOR_IGNORE = 5;

/** The fewest untouched lines before a bucket counts as a real blind spot. */
const MIN_UNTESTED_FOR_IGNORE = 3;

/**
 * The three things the timeframe record can say outright, pulled out of the bucket list.
 *
 * These are the answers that do not need a model: which line price reaches most, which line the
 * trader marks and keeps ignoring, and the strongest hold rate that has a real sample behind
 * it. Each is drawn only from buckets that meet a count floor, so the callouts cannot be built
 * out of one reach or two decided touches — the failure mode this whole record exists to avoid.
 */
export interface TimeframeHighlights {
  /** The instrument/timeframe/side price reaches most, or null until one is reached enough. */
  mostReached: TimeframeEdgeBucket | null;
  /** The most-marked, least-tested line — a blind spot, or null when nothing qualifies. */
  mostIgnored: TimeframeEdgeBucket | null;
  /** The best hold rate with a readable sample behind it, or null while nothing qualifies. */
  bestHold: TimeframeEdgeBucket | null;
}

/**
 * Picks the three headline findings out of an already-built bucket list.
 *
 * Takes buckets rather than raw records so a caller that has just built them — the edge finder
 * does — pays for one pass instead of two. Ties fall to the busiest bucket, so a callout names
 * the record with the most behind it rather than an arbitrary one of two equal rates.
 */
export function timeframeHighlights(
  buckets: TimeframeEdgeBucket[],
  minDecided = MIN_DECIDED
): TimeframeHighlights {
  const mostReached =
    [...buckets]
      .filter((bucket) => bucket.tested >= MIN_REACHED)
      .sort((a, b) => b.tested - a.tested || b.marked - a.marked)[0] ?? null;

  const mostIgnored =
    [...buckets]
      .filter(
        (bucket) =>
          bucket.marked >= MIN_MARKED_FOR_IGNORE &&
          bucket.untested >= MIN_UNTESTED_FOR_IGNORE &&
          bucket.testRate !== null &&
          bucket.testRate < 100
      )
      .sort((a, b) => (a.testRate ?? 0) - (b.testRate ?? 0) || b.marked - a.marked)[0] ?? null;

  const bestHold =
    [...buckets]
      .filter((bucket) => bucket.stats.enoughData && bucket.stats.decided >= minDecided)
      .sort(
        (a, b) =>
          (b.stats.holdRate ?? -1) - (a.stats.holdRate ?? -1) || b.stats.decided - a.stats.decided
      )[0] ?? null;

  return { mostReached, mostIgnored, bestHold };
}

/** A readable one-line label for a bucket, e.g. "MES 5 min resistance". */
export function timeframeBucketLabel(
  bucket: Pick<TimeframeEdgeBucket, 'timeframe' | 'kind'>,
  symbol: string
): string {
  const frame = bucket.timeframe ? TIMEFRAME_LABEL[bucket.timeframe] : 'no timeframe';
  return `${symbol} ${frame} ${kindWord(bucket.kind)}`;
}

/** What changed in one list of prices against another. */
export interface LevelPriceDiff {
  /** Prices present today that were not there the day before. */
  added: number[];
  /** Prices from the day before that are gone today. */
  removed: number[];
  /** Prices present on both days. */
  unchanged: number[];
}

/**
 * Compares today's prices for one line against the previous day's.
 *
 * Prices are compared by value, not by id, because that is the question the trader is asking:
 * did this line move. A price re-typed to the same number is unchanged; a price that moved
 * shows up once in `added` and once in `removed`, so a shift of the whole set reads plainly.
 */
export function diffLevelPrices(current: number[], previous: number[]): LevelPriceDiff {
  const currentSet = new Set(current.map((price) => round(price)));
  const previousSet = new Set(previous.map((price) => round(price)));

  const added = [...currentSet].filter((price) => !previousSet.has(price)).sort((a, b) => a - b);
  const removed = [...previousSet].filter((price) => !currentSet.has(price)).sort((a, b) => a - b);
  const unchanged = [...currentSet].filter((price) => previousSet.has(price)).sort((a, b) => a - b);

  return { added, removed, unchanged };
}

/**
 * The most recent day before `todayTradeDate` the trader marked this instrument.
 *
 * Read from the levels themselves rather than from the trading days, so a weekend or a day
 * with no lines marked is skipped naturally and the comparison is always against the last day
 * there was actually something to compare.
 */
export function previousLevelDate(
  levels: MarkedLevel[],
  instrumentId: string,
  todayTradeDate: string
): string | null {
  const dates = new Set(
    levels
      .filter((level) => level.instrumentId === instrumentId && level.tradeDate < todayTradeDate)
      .map((level) => level.tradeDate)
  );
  return [...dates].sort().pop() ?? null;
}
