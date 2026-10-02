import { LevelKind, LevelTouch, MarkedLevel, TradingSession } from '../../types';

/**
 * The level-touch edge, as pure numbers.
 *
 * Two questions live here, and they are deliberately kept apart from any UI:
 *
 * 1. **Did price come back?** (`evaluateTouch`) — the definition, expressed once, so
 *    the journal, the stats and the coach cannot disagree about what a break-and-run
 *    is. A level is a zone, a break is price leaving that zone on the break side, and
 *    a return is any later price back inside it. Nothing here predicts; it only reads
 *    what price has already done.
 * 2. **How often does it hold?** (`summarizeTouches`, `findLevelEdges`) — the hold
 *    rate: of the touches that have a decided answer, what share saw price never come
 *    back. That is the number the two set-ups are judged by.
 *
 * The sample is small — two set-ups, a few levels a week — so every rate carries the
 * count it came from, and a bucket below {@link MIN_DECIDED} reports `enoughData: false`
 * rather than a percentage that would read like an edge.
 */

/** A price observation after a touch: the moment, and where price was. */
export interface PriceSample {
  /** ISO timestamp. */
  at: string;
  price: number;
}

/** What {@link evaluateTouch} concluded from the samples it was given. */
export interface TouchEvaluation {
  /**
   * `watching` when price has not yet left the zone on the break side — the touch is
   * still forming; `returned` when a confirmed break was followed by price back inside
   * the zone; `never-returned` when it broke and never came back.
   */
  outcome: 'watching' | 'never-returned' | 'returned';
  /** Best favourable excursion away from the level, in points. */
  maxExcursionPoints: number;
  /** Deepest move back through the level after the touch, in points. Zero if none. */
  maxReturnPoints: number;
  /** The first sample that came back inside the zone, when there was one. */
  returnedAt?: string;
  /** The last price the evaluation saw. */
  checkedPrice: number;
}

/** The zone a level covers, in price terms. */
function levelZone(touch: LevelTouch): { low: number; high: number } {
  const half = Math.abs(touch.zonePoints) / 2;
  return { low: touch.price - half, high: touch.price + half };
}

/**
 * Reads a touch against everything price did after it.
 *
 * The rule, in the trader's own terms:
 *
 * - The **break** is price leaving the zone on the side the level was leaning.
 *   A resistance touch breaks up (above the zone's high); a support touch breaks
 *   down (below its low). Until that happens the touch is still forming, and the
 *   answer is `watching` — not yet a signal in either direction.
 * - Once the break is confirmed, **any later sample back inside the zone is a
 *   return**. From that moment the set-up failed, however far price later ran.
 * - A break with no sample back inside the zone is `never-returned` — the pattern
 *   the two set-ups are looking for.
 *
 * `maxExcursionPoints` is measured from the level price outward (always positive);
 * `maxReturnPoints` is measured from the level price back across it, so its zero is
 * the meaningful value: price never came back.
 *
 * Samples are expected after the touch and in chronological order; a caller that
 * passes unsorted data still gets a correct reading because the excursion and return
 * are maxima and the first return is chosen by timestamp, not by position.
 */
export function evaluateTouch(touch: LevelTouch, since: PriceSample[]): TouchEvaluation {
  const { low, high } = levelZone(touch);
  const samples = since.filter((sample) => Number.isFinite(sample.price));

  const last = samples.length ? samples[samples.length - 1].price : touch.price;

  // Two passes: the break has to exist before a return can mean anything. A price
  // that sits at the level the whole time has not broken, so samples inside the zone
  // only count once price has first been seen outside it.
  let broke = false;
  let maxExcursionPoints = 0;
  let maxReturnPoints = 0;
  let returnedAt: string | undefined;

  const upBreak = touch.kind === 'resistance';

  for (const sample of samples) {
    const outside = upBreak ? sample.price > high : sample.price < low;

    if (!broke) {
      if (outside) {
        broke = true;
        const excursion = upBreak ? sample.price - touch.price : touch.price - sample.price;
        if (excursion > maxExcursionPoints) maxExcursionPoints = excursion;
      }
      continue;
    }

    // Broken: measure how far it ran, and whether it ever came back.
    const excursion = upBreak ? sample.price - touch.price : touch.price - sample.price;
    if (excursion > maxExcursionPoints) maxExcursionPoints = excursion;

    // A return is price back at or through the level, not merely inside the band. Once
    // an up-break is confirmed, any descent to the zone's high or below means the level
    // was revisited — including a full pass back underneath it, which is as much a
    // "came back" as a touch of the top edge.
    const cameBack = upBreak ? sample.price <= high : sample.price >= low;
    if (cameBack) {
      const returned = upBreak ? touch.price - sample.price : sample.price - touch.price;
      if (returned > maxReturnPoints) maxReturnPoints = returned;
      if (!returnedAt || sample.at < returnedAt) returnedAt = sample.at;
    }
  }

  if (!broke) {
    return { outcome: 'watching', maxExcursionPoints, maxReturnPoints: 0, checkedPrice: last };
  }

  if (returnedAt) {
    return {
      outcome: 'returned',
      maxExcursionPoints,
      maxReturnPoints,
      returnedAt,
      checkedPrice: last,
    };
  }

  return { outcome: 'never-returned', maxExcursionPoints, maxReturnPoints: 0, checkedPrice: last };
}

/**
 * The least number of DECIDED touches before a rate is reported as an edge.
 *
 * Below this the count is still shown, but the rate is withheld: "2 of 2 so far" is
 * a tally, not a win rate, and this journal is small enough that publishing it as a
 * percentage would turn noise into a decision.
 */
export const MIN_DECIDED = 5;

/** A touch that has a definite answer, either way. `watching` and `invalid` do not. */
export function isDecided(touch: LevelTouch): boolean {
  return touch.outcome === 'never-returned' || touch.outcome === 'returned';
}

export interface LevelEdgeStats {
  /** Every touch in the bucket, including ones still being watched. */
  touches: number;
  /** Touches with a definite answer: never-returned plus returned. */
  decided: number;
  neverReturned: number;
  returned: number;
  watching: number;
  invalid: number;
  /**
   * The share of DECIDED touches where price never came back, as a percentage.
   * Null while nothing is decided — never 0, which would read as "it always returns".
   */
  holdRate: number | null;
  /** True when `decided` reaches {@link MIN_DECIDED}, so `holdRate` may be read. */
  enoughData: boolean;
  /** Average favourable excursion across decided touches, in points. */
  avgExcursionPoints: number | null;
}

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

export function summarizeTouches(
  touches: LevelTouch[],
  minDecided = MIN_DECIDED
): LevelEdgeStats {
  const neverReturned = touches.filter((t) => t.outcome === 'never-returned').length;
  const returned = touches.filter((t) => t.outcome === 'returned').length;
  const watching = touches.filter((t) => t.outcome === 'watching').length;
  const invalid = touches.filter((t) => t.outcome === 'invalid').length;
  const decided = neverReturned + returned;

  const excursions = touches
    .filter(isDecided)
    .map((t) => t.maxExcursionPoints)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));

  return {
    touches: touches.length,
    decided,
    neverReturned,
    returned,
    watching,
    invalid,
    holdRate: decided > 0 ? round((neverReturned / decided) * 100, 1) : null,
    enoughData: decided >= minDecided,
    avgExcursionPoints: excursions.length
      ? round(excursions.reduce((a, b) => a + b, 0) / excursions.length)
      : null,
  };
}

/** One named condition — a session, a level kind, a set-up — with its own record. */
export interface LevelEdgeBucket {
  /** Stable key, e.g. `session:Overnight`, so a UI list can diff it. */
  key: string;
  /** What the bucket is, in the trader's words. */
  label: string;
  /** The session it covers, when the bucket is scoped to one. */
  session: TradingSession | null;
  /** The level kind it covers, when the bucket is scoped to one. */
  kind: LevelKind | null;
  /** The label the levels in this bucket shared, when the bucket is by label. */
  levelLabel: string | null;
  stats: LevelEdgeStats;
}

function bucket(
  key: string,
  label: string,
  touches: LevelTouch[],
  scope: { session?: TradingSession; kind?: LevelKind; levelLabel?: string },
  minDecided: number
): LevelEdgeBucket {
  return {
    key,
    label,
    session: scope.session ?? null,
    kind: scope.kind ?? null,
    levelLabel: scope.levelLabel ?? null,
    stats: summarizeTouches(touches, minDecided),
  };
}

/**
 * The set-up finder: every condition worth looking at, ranked by hold rate.
 *
 * Buckets are built two ways on purpose. Whole-dimensional buckets (each session on
 * its own, each level kind on its own) say which single condition travels with the
 * pattern; the session-by-kind buckets say whether the two together do, which is the
 * actual question when both set-ups are the same pattern at different hours. Only
 * buckets with a real sample survive — everything else is a count pretending to be an
 * edge — and they are ordered by the hold rate the trader is trying to raise, with
 * the thin-but-decided ones last rather than dropped.
 */
export function findLevelEdges(
  touches: LevelTouch[],
  minDecided = MIN_DECIDED
): LevelEdgeBucket[] {
  const decidedTouches = touches.filter((t) => t.outcome !== 'invalid');
  const buckets: LevelEdgeBucket[] = [];

  buckets.push(bucket('all', 'All level touches', decidedTouches, {}, minDecided));

  const sessions = [...new Set(decidedTouches.map((t) => t.session))];
  for (const session of sessions) {
    const list = decidedTouches.filter((t) => t.session === session);
    buckets.push(bucket(`session:${session}`, session, list, { session }, minDecided));
  }

  const kinds: LevelKind[] = ['support', 'resistance'];
  for (const kind of kinds) {
    const list = decidedTouches.filter((t) => t.kind === kind);
    if (list.length) {
      buckets.push(
        bucket(`kind:${kind}`, kind === 'support' ? 'Support' : 'Resistance', list, { kind }, minDecided)
      );
    }
  }

  for (const session of sessions) {
    for (const kind of kinds) {
      const list = decidedTouches.filter((t) => t.session === session && t.kind === kind);
      if (list.length) {
        const word = kind === 'support' ? 'support' : 'resistance';
        buckets.push(
          bucket(`${session}:${kind}`, `${session} ${word}`, list, { session, kind }, minDecided)
        );
      }
    }
  }

  const labels = [...new Set(decidedTouches.map((t) => t.label?.trim()).filter(Boolean))] as string[];
  for (const levelLabel of labels) {
    const list = decidedTouches.filter((t) => t.label?.trim() === levelLabel);
    buckets.push(bucket(`label:${levelLabel}`, levelLabel, list, { levelLabel }, minDecided));
  }

  return buckets
    .filter((b) => b.stats.decided >= minDecided || b.key === 'all')
    .sort((a, b) => {
      // Enough-sample buckets lead, ordered by hold rate; a thin bucket is kept but
      // pushed below them. Null rates can only belong to thin buckets, so they fall in
      // the same group as the rest of the thin ones.
      if (a.stats.enoughData !== b.stats.enoughData) return a.stats.enoughData ? -1 : 1;
      const rateA = a.stats.holdRate ?? -1;
      const rateB = b.stats.holdRate ?? -1;
      if (rateA !== rateB) return rateB - rateA;
      return b.stats.decided - a.stats.decided;
    });
}

/**
 * How much of the trader's marked-level record their touches account for.
 *
 * The hold rate above answers "when a level is tested, does price come back?". This answers
 * the question underneath it: **how many of the levels the trader marked were ever tested at
 * all?** A trader whose indicator offers six lines and who only ever trades two is leaving
 * four out of the record entirely, and that only becomes visible when the lines are written
 * down before anything touches them.
 *
 * `testedStats` is deliberately computed over the touches that came from a marked level, not
 * over every touch — so the rate it reports is "of the levels I marked and actually reached,
 * how many held", with the untouched ones carried as their own count rather than folded into a
 * rate they do not belong in. A level is treated as tested when a touch links back to it; a
 * touch with no level behind it belongs to the older, mark-as-you-go record and is left out
 * of both counts here, though it still counts in {@link findLevelEdges}.
 */
export interface MarkedLevelCoverage {
  /** Every level the trader marked. */
  marked: number;
  /** Marked levels that price reached and were logged as a touch. */
  tested: number;
  /** Marked levels nothing has been logged against yet. */
  untested: number;
  /** Tested / marked as a percentage, or null while nothing has been marked. */
  testRate: number | null;
  /** The record of the tested levels alone, so its hold rate excludes the untouched. */
  testedStats: LevelEdgeStats;
}

export function summarizeMarkedLevels(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  minDecided = MIN_DECIDED
): MarkedLevelCoverage {
  const levelIds = new Set(levels.map((level) => level.id));
  const linked = touches.filter((touch) => touch.levelId && levelIds.has(touch.levelId));
  const testedIds = new Set(linked.map((touch) => touch.levelId));
  const marked = levels.length;
  const tested = testedIds.size;

  return {
    marked,
    tested,
    untested: marked - tested,
    testRate: marked > 0 ? round((tested / marked) * 100, 1) : null,
    testedStats: summarizeTouches(linked, minDecided),
  };
}
