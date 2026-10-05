import { LevelKind, LevelTimeframe, LevelTouch, MarkedLevel } from '../../types';
import { MIN_DECIDED, summarizeTouches } from './level-edge';

/**
 * The timeframe read as a scoreboard.
 *
 * The by-timeframe block in the edge finder answers "which of my charts gets reached", which is
 * half the question. This answers the other half, the one that decides where the trader should
 * spend their attention: of the lines marked on each chart, which ones actually KEEP price away,
 * and for how long. The difference matters because a 5-minute line that holds for six minutes
 * and a 1-hour line that holds all session are the same `never-returned` touch in the raw record.
 *
 * Two ideas do the work here:
 *
 * 1. **A horizon, in the chart's own units.** A level counts as held when price stays away for
 *    {@link HOLD_BARS} bars of the chart it came off, so every timeframe is judged against the
 *    same standard rather than a shared number of minutes that would only restate that slow
 *    charts move slower.
 * 2. **A hold that cannot be judged is excluded, not failed.** A return carries the exact moment
 *    price came back. A hold carries the moment the trader made the call, which is only a lower
 *    bound on how long price stayed away — so a hold called before the horizon elapsed is set
 *    aside rather than counted against the level, and the count of those is reported.
 *
 * Nothing here predicts, and nothing is inferred from price: every figure is a count of touches
 * the trader logged, over marked lines the trader wrote down.
 */

/** Minutes in one bar, for each chart the trader marks. */
export const TIMEFRAME_MINUTES: Record<LevelTimeframe, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
};

/**
 * How many bars of its own chart a line must keep price away to count as held.
 *
 * Three bars: long enough that acting on the level was possible, short enough that the bar is
 * still about the level rather than about the session. The number is a judgement, not a
 * measurement — which is exactly why it is one constant named here rather than a per-chart
 * guess scattered through the read.
 */
export const HOLD_BARS = 3;

/** The minutes a line on this chart must keep price away to count as held. */
export function holdHorizonMinutes(timeframe: LevelTimeframe): number {
  return TIMEFRAME_MINUTES[timeframe] * HOLD_BARS;
}

/**
 * How long price stayed away from the level, in minutes, or null when the record cannot say.
 *
 * A return is stamped with the moment price traded back inside the zone, so its number is exact.
 * A hold is stamped with the moment the trader made the call, so its number is a lower bound:
 * price stayed away AT LEAST that long. That asymmetry is why the horizon read below keeps the
 * two apart rather than treating every decided touch the same.
 */
export function awayMinutes(touch: LevelTouch): number | null {
  if (touch.outcome !== 'never-returned' && touch.outcome !== 'returned') return null;
  const from = Date.parse(touch.touchedAt ?? touch.createdAt);
  const to = Date.parse((touch.outcome === 'returned' ? touch.returnedAt : touch.checkedAt) ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / 60000;
}

/** One chart-and-side pair's record, with the horizon read on it. */
export interface TimeframeEdgeScore {
  /** Stable key, e.g. `5m|resistance`. */
  key: string;
  timeframe: LevelTimeframe;
  kind: LevelKind;
  /** Active lines marked on this chart and side. */
  marked: number;
  /** Marked lines a touch linked back to. */
  tested: number;
  /** Decided touches linked to this bucket's marked lines. */
  decided: number;
  neverReturned: number;
  returned: number;
  /** Share of decided touches where price never came back, or null until one is decided. */
  holdRate: number | null;
  /** Minutes price must stay away to count as held here: {@link HOLD_BARS} bars of this chart. */
  horizonMinutes: number;
  /** Decided touches that demonstrably stayed away at least the horizon. */
  heldAtHorizon: number;
  /** Decided touches the horizon can be judged on. */
  judgedAtHorizon: number;
  /**
   * Decided touches left out of the horizon read: a hold called before the horizon had elapsed,
   * or a touch with no readable time. Excluded rather than counted as a failure.
   */
  unknownAtHorizon: number;
  /** heldAtHorizon / judgedAtHorizon as a percentage, or null while nothing can be judged. */
  holdRateAtHorizon: number | null;
  /** True when `judgedAtHorizon` clears the sample floor, so the horizon rate may be read. */
  enoughData: boolean;
  /** Mean minutes price stayed away, across decided touches with a readable time. */
  avgAwayMinutes: number | null;
  /**
   * Points per decided touch, on a plain rule: a hold adds the distance it ran, a return
   * subtracts how far it went back through. Null until some touch carries those distances —
   * the app does not measure them today, so this stays empty rather than being guessed.
   */
  expectancyPoints: number | null;
  /** How many decided touches carried the distances the expectancy is read from. */
  expectancySample: number;
}

/** The active marked lines and decided touches for one instrument, over timeframes only. */
function scopedRecords(levels: MarkedLevel[], touches: LevelTouch[], instrumentId: string) {
  const active = levels.filter(
    (level) =>
      level.instrumentId === instrumentId && level.resolution !== 'void' && Boolean(level.timeframe)
  );
  const levelIds = new Set(active.map((level) => level.id));

  // A touch that links back to a marked line, on the same document the level belongs to. The
  // timeframe and side travel on the touch itself, so a bucket needs no join to the level.
  const linked = touches.filter(
    (touch) =>
      Boolean(touch.levelId) &&
      levelIds.has(touch.levelId as string) &&
      touch.outcome !== 'invalid' &&
      Boolean(touch.timeframe)
  );

  return { active, linked };
}

/** The instant a touch is stamped with, falling back to when it was logged. */
function touchTime(touch: LevelTouch): number {
  const at = Date.parse(touch.touchedAt ?? touch.createdAt);
  return Number.isFinite(at) ? at : 0;
}

/**
 * One bucket's horizon read, over whatever touches were handed in.
 *
 * The returned counts are the whole answer: `judgedAtHorizon` is the sample the rate is drawn
 * from, and `unknownAtHorizon` is what was set aside, so the rate can never look better than the
 * record that supports it.
 */
function readHorizon(timeframe: LevelTimeframe, bucketTouches: LevelTouch[]) {
  const horizonMinutes = holdHorizonMinutes(timeframe);
  let heldAtHorizon = 0;
  let judgedAtHorizon = 0;
  const aways: number[] = [];

  for (const touch of bucketTouches) {
    if (touch.outcome !== 'never-returned' && touch.outcome !== 'returned') continue;
    const away = awayMinutes(touch);
    if (away === null) continue;
    aways.push(away);
    if (away >= horizonMinutes) {
      // It stayed away at least the horizon, whichever way it ended: a return that took longer
      // than the horizon still held for the horizon.
      heldAtHorizon += 1;
      judgedAtHorizon += 1;
    } else if (touch.outcome === 'returned') {
      // The return time is exact, so this is a known miss rather than an unknown.
      judgedAtHorizon += 1;
    }
    // A hold called before the horizon elapsed tells us nothing and is left out.
  }

  return { horizonMinutes, heldAtHorizon, judgedAtHorizon, aways };
}

/** A bucket's points-per-touch read, over the distances the record actually carries. */
function readExpectancy(bucketTouches: LevelTouch[]) {
  let points = 0;
  let sample = 0;
  for (const touch of bucketTouches) {
    if (touch.outcome === 'never-returned' && typeof touch.maxExcursionPoints === 'number') {
      points += touch.maxExcursionPoints;
      sample += 1;
    } else if (touch.outcome === 'returned' && typeof touch.maxReturnPoints === 'number') {
      points -= touch.maxReturnPoints;
      sample += 1;
    }
  }
  return { points, sample };
}

/**
 * Scores every timeframe and side for one instrument, so the charts can be ranked.
 *
 * Only lines that carry a timeframe are read: a line marked before timeframes existed cannot be
 * part of a timeframe scoreboard, and inventing one for it would be the silent lie this whole
 * record avoids. Only touches linked back to a marked line count, which is what makes the read
 * about the trader's own indicator rather than about every price they happened to write down.
 * Ordered with the readable buckets first, best horizon rate leading, then the thin ones — so
 * the answer is at the top and the evidence it is missing sits under it.
 */
export function summarizeTimeframeEdgeScores(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  options: { instrumentId: string; minDecided?: number }
): TimeframeEdgeScore[] {
  const minDecided = options.minDecided ?? MIN_DECIDED;
  const { active, linked } = scopedRecords(levels, touches, options.instrumentId);

  const levelsByKey = new Map<string, MarkedLevel[]>();
  for (const level of active) {
    const key = `${level.timeframe}|${level.kind}`;
    const list = levelsByKey.get(key);
    if (list) list.push(level);
    else levelsByKey.set(key, [level]);
  }

  const touchesByKey = new Map<string, LevelTouch[]>();
  for (const touch of linked) {
    const key = `${touch.timeframe}|${touch.kind}`;
    const list = touchesByKey.get(key);
    if (list) list.push(touch);
    else touchesByKey.set(key, [touch]);
  }

  const scores: TimeframeEdgeScore[] = [];
  for (const [key, group] of levelsByKey) {
    const [timeframe, kind] = key.split('|') as [LevelTimeframe, LevelKind];
    const bucketTouches = touchesByKey.get(key) ?? [];
    const stats = summarizeTouches(bucketTouches, minDecided);
    const { horizonMinutes, heldAtHorizon, judgedAtHorizon, aways } = readHorizon(
      timeframe,
      bucketTouches
    );
    const expectancy = readExpectancy(bucketTouches);
    const tested = group.filter((level) => bucketTouches.some((t) => t.levelId === level.id)).length;

    scores.push({
      key,
      timeframe,
      kind,
      marked: group.length,
      tested,
      decided: stats.decided,
      neverReturned: stats.neverReturned,
      returned: stats.returned,
      holdRate: stats.holdRate,
      horizonMinutes,
      heldAtHorizon,
      judgedAtHorizon,
      unknownAtHorizon: Math.max(0, stats.decided - judgedAtHorizon),
      holdRateAtHorizon:
        judgedAtHorizon > 0 ? round((heldAtHorizon / judgedAtHorizon) * 100, 1) : null,
      enoughData: judgedAtHorizon >= minDecided,
      avgAwayMinutes: aways.length ? round(aways.reduce((a, b) => a + b, 0) / aways.length) : null,
      expectancyPoints: expectancy.sample ? round(expectancy.points / expectancy.sample) : null,
      expectancySample: expectancy.sample,
    });
  }

  return scores.sort((a, b) => {
    if (a.enoughData !== b.enoughData) return a.enoughData ? -1 : 1;
    if (a.enoughData && b.enoughData) {
      const rate = (b.holdRateAtHorizon ?? 0) - (a.holdRateAtHorizon ?? 0);
      if (rate !== 0) return rate;
    }
    if (a.judgedAtHorizon !== b.judgedAtHorizon) return b.judgedAtHorizon - a.judgedAtHorizon;
    return a.key.localeCompare(b.key);
  });
}

/** One step of the rolling read: the horizon rate over a fixed number of decided touches. */
export interface TimeframeEdgeTrendPoint {
  /** 1-based window number, oldest first. */
  index: number;
  /** The trading date of the oldest touch in the window. */
  fromDate: string;
  /** The trading date of the newest touch in the window. */
  toDate: string;
  /** Decided touches in the window — constant by construction. */
  decided: number;
  /** Share of the window that held its own chart's horizon, or null when none could be judged. */
  holdRateAtHorizon: number | null;
}

export interface TimeframeEdgeTrend {
  /** Sliding windows, oldest first. Empty until a first full window exists. */
  points: TimeframeEdgeTrendPoint[];
  /** True when the whole record clears the sample floor, so the trend is worth reading. */
  enoughData: boolean;
  /** Total decided touches the trend was built from. */
  decided: number;
  /** Last window's rate minus the first readable one, in percentage points. */
  deltaPoints: number | null;
}

/**
 * The same horizon read, rolled rather than cumulative.
 *
 * An accumulating hold rate answers "what is my edge" and hides "is it still there": a stretch
 * of early wins holds the line up long after the read has changed. Sliding a fixed window over
 * the decided touches, oldest first, shows the change instead — and the window counts touches,
 * not days, so a quiet fortnight does not read as a collapse. Each touch is judged against the
 * horizon of the chart it came from, so a window can span timeframes and still mean one thing.
 */
export function timeframeEdgeTrend(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  options: { instrumentId: string; window?: number; minDecided?: number }
): TimeframeEdgeTrend {
  const window = Math.max(3, options.window ?? 10);
  const { linked } = scopedRecords(levels, touches, options.instrumentId);
  const decided = linked
    .filter((touch) => touch.outcome === 'never-returned' || touch.outcome === 'returned')
    .sort((a, b) => touchTime(a) - touchTime(b));

  const points: TimeframeEdgeTrendPoint[] = [];
  for (let end = window - 1; end < decided.length; end += 1) {
    const slice = decided.slice(end - window + 1, end + 1);
    let held = 0;
    let judged = 0;
    for (const touch of slice) {
      if (!touch.timeframe) continue;
      const read = readHorizon(touch.timeframe, [touch]);
      held += read.heldAtHorizon;
      judged += read.judgedAtHorizon;
    }
    points.push({
      index: points.length + 1,
      fromDate: slice[0].tradeDate,
      toDate: slice[slice.length - 1].tradeDate,
      decided: slice.length,
      holdRateAtHorizon: judged > 0 ? round((held / judged) * 100, 1) : null,
    });
  }

  const readable = points.filter(
    (point): point is TimeframeEdgeTrendPoint & { holdRateAtHorizon: number } =>
      point.holdRateAtHorizon !== null
  );
  const deltaPoints =
    readable.length >= 2
      ? round(readable[readable.length - 1].holdRateAtHorizon - readable[0].holdRateAtHorizon, 1)
      : null;

  return {
    points,
    enoughData: decided.length >= (options.minDecided ?? MIN_DECIDED),
    decided: decided.length,
    deltaPoints,
  };
}

function round(value: number, dp = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
