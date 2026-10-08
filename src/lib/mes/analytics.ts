/**
 * The rating engine: pure functions over `LevelRecord[]`, no React, no storage.
 *
 * This is the whole product in one module — hit rate, reliability, shrunk strength, grade,
 * confidence, the groupings the screens read, the timing histograms, the outcome mix and the
 * series. Keeping it free of framework imports is what makes the numbers testable in
 * isolation, which is the single most valuable structural decision in this feature.
 *
 * The one idea worth stating plainly: raw reliability on a one-test level reads 100% and
 * looks like a brick wall. Every headline rating is therefore SHRUNK toward 50% with a
 * Beta(2,2) prior, so a small sample has to earn its grade:
 *
 *   strengthOf(7, 3) = 64.3   (raw reliability 70%)
 *   strengthOf(1, 0) = 60     (raw reliability 100% — the prior pulls it back)
 *   strengthOf(0, 0) = null   (nothing to rate)
 */
import type {
  BreakDirection,
  Confidence,
  Grade,
  LevelKind,
  LevelOutcome,
  LevelRecord,
  SetupTag,
  Timeframe,
} from './types';
import {
  BREAK_DIRECTIONS,
  BUCKET_MINUTES,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  GRADE_A,
  GRADE_B,
  GRADE_C,
  LEVEL_KINDS,
  NOTABLE_LEVEL_LIMIT,
  SETUP_TAGS,
  TIMEFRAMES,
  TIMEFRAME_ORDER,
} from './constants';
import { minutesToClockLabel, newId, parseClockMinutes } from './utils';

// ---------------------------------------------------------------------------
// The five core formulas
// ---------------------------------------------------------------------------

/**
 * `holds / (holds + breaks)`, or null when nothing decisive happened.
 *
 * Untested levels are excluded rather than counted as a win: a level nobody reached has no
 * opinion about whether it holds. Null (not 0) so the UI renders '—' and charts leave a gap.
 */
export function reliabilityOf(holds: number, breaks: number): number | null {
  const decided = holds + breaks;
  return decided > 0 ? holds / decided : null;
}

/**
 * Beta(2,2)-shrunk hold rate, 0..100, rounded to 1 dp.
 *
 * `(holds + 2) / (holds + breaks + 4) * 100`. The prior keeps one lucky hold from reading
 * as 100%. Null when there is nothing decisive to rate.
 */
export function strengthOf(holds: number, breaks: number): number | null {
  const decided = holds + breaks;
  if (decided <= 0) return null;
  return Math.round(((holds + 2) / (decided + 4)) * 100 * 10) / 10;
}

/** Grade from SHRUNK strength, not raw reliability. Null reads '—'. */
export function gradeOf(strength: number | null): Grade {
  if (strength === null || !Number.isFinite(strength)) return '—';
  if (strength >= GRADE_A) return 'A';
  if (strength >= GRADE_B) return 'B';
  if (strength >= GRADE_C) return 'C';
  return 'D';
}

/** How much is behind a rating, by decisive tests. Shown as a coloured dot. */
export function confidenceOf(decisive: number): Confidence {
  if (decisive >= CONFIDENCE_HIGH) return 'high';
  if (decisive >= CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface GroupStats {
  key: string;
  label: string;
  logged: number;
  tested: number;
  touches: number;
  holds: number;
  breaks: number;
  /** 0..1, null when nothing logged. */
  hitRate: number | null;
  /** 0..1, null when nothing decisive. */
  reliability: number | null;
  /** 0..100, null when nothing decisive. */
  strength: number | null;
  grade: Grade;
  confidence: Confidence;
  /** holds + breaks */
  sampleSize: number;
  avgTouches: number | null;
}

/** The workhorse: every figure for one group of levels. */
export function statsFor(key: string, label: string, records: LevelRecord[]): GroupStats {
  const logged = records.length;
  const testedRecords = records.filter((record) => record.touches > 0);
  const tested = testedRecords.length;
  const touches = records.reduce((sum, record) => sum + record.touches, 0);
  const holds = records.reduce((sum, record) => sum + record.holds, 0);
  const breaks = records.reduce((sum, record) => sum + record.breaks, 0);
  const strength = strengthOf(holds, breaks);
  return {
    key,
    label,
    logged,
    tested,
    touches,
    holds,
    breaks,
    hitRate: logged > 0 ? tested / logged : null,
    reliability: reliabilityOf(holds, breaks),
    strength,
    grade: gradeOf(strength),
    confidence: confidenceOf(holds + breaks),
    sampleSize: holds + breaks,
    avgTouches: tested > 0 ? touches / tested : null,
  };
}

/** All six timeframes, always, so charts and the heat grid never have a hole. */
export function statsByTimeframe(records: LevelRecord[]): GroupStats[] {
  return TIMEFRAMES.map((timeframe) =>
    statsFor(timeframe, timeframe, records.filter((record) => record.timeframe === timeframe))
  );
}

/** Both sides, always. */
export function statsByKind(records: LevelRecord[]): GroupStats[] {
  return LEVEL_KINDS.map((kind) =>
    statsFor(kind, kind === 'support' ? 'Support' : 'Resistance', records.filter((r) => r.kind === kind))
  );
}

/** Only tagged setups, busiest first. Untagged levels are excluded from the pattern read. */
export function statsBySetup(records: LevelRecord[]): GroupStats[] {
  return SETUP_TAGS.map((setup) =>
    statsFor(setup, setup, records.filter((record) => record.setup === setup))
  )
    .filter((group) => group.logged > 0)
    .sort((a, b) => b.sampleSize - a.sampleSize || b.logged - a.logged || a.key.localeCompare(b.key));
}

/** For each timeframe, its support and resistance groups — the heat grid. */
export function statsByTimeframeKind(
  records: LevelRecord[]
): Array<{ timeframe: Timeframe; support: GroupStats; resistance: GroupStats }> {
  return TIMEFRAMES.map((timeframe) => {
    const forTf = records.filter((record) => record.timeframe === timeframe);
    return {
      timeframe,
      support: statsFor('support', 'Support', forTf.filter((r) => r.kind === 'support')),
      resistance: statsFor('resistance', 'Resistance', forTf.filter((r) => r.kind === 'resistance')),
    };
  });
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

export interface DirectionStats {
  up: number;
  down: number;
  /** Breaks WITH a direction recorded (up + down). */
  total: number;
  upShare: number | null;
  downShare: number | null;
  /** Breaks with `breaks > 0` but `breakDirection === ''` — surfaced as a nudge. */
  unknown: number;
}

/**
 * The upside / downside split, counted in break EVENTS.
 *
 * `total` counts only tagged breaks, so a record with many untagged ones still reports a
 * meaningful split — and the untagged count comes back as `unknown`, which the Timing tab
 * turns into a nudge to go back and tag them.
 */
export function directionStats(records: LevelRecord[]): DirectionStats {
  let up = 0;
  let down = 0;
  let unknown = 0;
  for (const record of records) {
    if (record.breaks <= 0) continue;
    if (record.breakDirection === 'up') up += record.breaks;
    else if (record.breakDirection === 'down') down += record.breaks;
    else unknown += record.breaks;
  }
  const total = up + down;
  return {
    up,
    down,
    total,
    upShare: total > 0 ? up / total : null,
    downShare: total > 0 ? down / total : null,
    unknown,
  };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export interface TimingBucket {
  /** Minutes since midnight of the bucket's start, as a stable key. */
  key: string;
  /** Human label, e.g. '9:30 AM'. */
  label: string;
  startMinutes: number;
  hit: number;
  broke: number;
}

/**
 * A histogram of when levels were hit and when they broke.
 *
 * Bucket index is `floor(minutesSinceMidnight / bucketMinutes)`. Each record contributes 1 to
 * its bucket in each series (not weighted by touches), so the bars count levels. With
 * `trimEmpty` the leading and trailing all-zero buckets are dropped, and a record with no
 * times at all returns `[]`.
 */
export function timingHistogram(
  records: LevelRecord[],
  bucketMinutes = BUCKET_MINUTES,
  trimEmpty = true
): TimingBucket[] {
  const buckets = new Map<number, TimingBucket>();
  const bucketAt = (minutes: number): TimingBucket => {
    const start = Math.floor(minutes / bucketMinutes) * bucketMinutes;
    let bucket = buckets.get(start);
    if (!bucket) {
      bucket = { key: String(start), label: minutesToClockLabel(start), startMinutes: start, hit: 0, broke: 0 };
      buckets.set(start, bucket);
    }
    return bucket;
  };

  for (const record of records) {
    const hit = parseClockMinutes(record.hitTime);
    if (hit !== null) bucketAt(hit).hit += 1;
    const broke = parseClockMinutes(record.breakTime);
    if (broke !== null) bucketAt(broke).broke += 1;
  }

  const all = [...buckets.values()].sort((a, b) => a.startMinutes - b.startMinutes);
  if (!trimEmpty) return all;

  const first = all.findIndex((bucket) => bucket.hit > 0 || bucket.broke > 0);
  if (first === -1) return [];
  let last = all.length - 1;
  while (last > first && all[last].hit === 0 && all[last].broke === 0) last -= 1;
  return all.slice(first, last + 1);
}

/** Mean minutes since midnight for a clock field, or null when none has one. */
export function averageClockMinutes(
  records: LevelRecord[],
  field: 'hitTime' | 'breakTime'
): number | null {
  let sum = 0;
  let count = 0;
  for (const record of records) {
    const minutes = parseClockMinutes(record[field]);
    if (minutes === null) continue;
    sum += minutes;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

/** The busiest bucket for one series, for the 'your levels get hit in this window' callout. */
export function peakBucket(
  buckets: TimingBucket[],
  series: 'hit' | 'broke'
): TimingBucket | null {
  let peak: TimingBucket | null = null;
  for (const bucket of buckets) {
    if (bucket[series] <= 0) continue;
    if (!peak || bucket[series] > peak[series]) peak = bucket;
  }
  return peak;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export function outcomeOfLevel(record: LevelRecord): LevelOutcome {
  if (record.touches === 0) return 'untested';
  if (record.breaks > 0 && record.holds === 0) return 'broke';
  if (record.holds > 0 && record.breaks === 0) return 'held';
  return 'mixed';
}

export interface OutcomeSplit {
  held: number;
  broke: number;
  untested: number;
  total: number;
}

/**
 * The donut's three buckets.
 *
 * A `mixed` level has no single home, so it is split proportionally between held and broke
 * by its own holds/breaks. That keeps the three counts summing to the number of levels,
 * which is what makes the donut readable against the record.
 */
export function outcomeSplit(records: LevelRecord[]): OutcomeSplit {
  let held = 0;
  let broke = 0;
  let untested = 0;
  for (const record of records) {
    const outcome = outcomeOfLevel(record);
    if (outcome === 'untested') {
      untested += 1;
    } else if (outcome === 'held') {
      held += 1;
    } else if (outcome === 'broke') {
      broke += 1;
    } else {
      const decided = record.holds + record.breaks;
      if (decided > 0) {
        held += record.holds / decided;
        broke += record.breaks / decided;
      }
    }
  }
  return { held, broke, untested, total: records.length };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export interface DayStats extends GroupStats {
  /** The session date, repeated as `key`/`label` above, for chart axes and sorting. */
  date: string;
  /** The SAME figure repeated cumulatively: rolling reliability across all sessions to date. */
  cumulativeReliability: number | null;
  /** Rolling hit rate across all sessions to date. */
  cumulativeHitRate: number | null;
  cumulativeLogged: number;
  cumulativeTested: number;
}

/**
 * Per-date figures, oldest to newest, with the rolling cumulative beside them.
 *
 * Note the distinction this module keeps honest: `holds`/`breaks` are THAT DAY's values;
 * the running totals live only in `cumulativeReliability` and `cumulativeHitRate`.
 */
export function dailyStats(records: LevelRecord[]): DayStats[] {
  const dates = [...new Set(records.map((record) => record.date))].sort((a, b) => a.localeCompare(b));
  let cumulativeLogged = 0;
  let cumulativeTested = 0;
  let cumulativeHolds = 0;
  let cumulativeBreaks = 0;

  return dates.map((date) => {
    const dayRecords = records.filter((record) => record.date === date);
    cumulativeLogged += dayRecords.length;
    cumulativeTested += dayRecords.filter((record) => record.touches > 0).length;
    cumulativeHolds += dayRecords.reduce((sum, record) => sum + record.holds, 0);
    cumulativeBreaks += dayRecords.reduce((sum, record) => sum + record.breaks, 0);

    return {
      ...statsFor(date, date, dayRecords),
      date,
      cumulativeReliability: reliabilityOf(cumulativeHolds, cumulativeBreaks),
      cumulativeHitRate: cumulativeLogged > 0 ? cumulativeTested / cumulativeLogged : null,
      cumulativeLogged,
      cumulativeTested,
    };
  });
}

export interface ReliabilityPoint {
  date: string;
  /** That session's reliability as 0..100, or null for a gap. */
  reliability: number | null;
  /** Rolling reliability as 0..100, or null. */
  cumulative: number | null;
}

/** Chart-ready reliability over time: per-session and rolling, as 0..100 numbers. */
export function reliabilitySeries(records: LevelRecord[]): ReliabilityPoint[] {
  return dailyStats(records).map((day) => ({
    date: day.date,
    reliability: day.reliability === null ? null : Math.round(day.reliability * 1000) / 10,
    cumulative: day.cumulativeReliability === null ? null : Math.round(day.cumulativeReliability * 1000) / 10,
  }));
}

// ---------------------------------------------------------------------------
// Normalising and sanitising
// ---------------------------------------------------------------------------

function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (TIMEFRAMES as readonly string[]).includes(value);
}

function isKind(value: unknown): value is LevelKind {
  return typeof value === 'string' && (LEVEL_KINDS as readonly string[]).includes(value);
}

function isSetup(value: unknown): value is SetupTag {
  return typeof value === 'string' && (SETUP_TAGS as readonly string[]).includes(value);
}

function isDirection(value: unknown): value is BreakDirection {
  return typeof value === 'string' && (BREAK_DIRECTIONS as readonly string[]).includes(value);
}

function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Enforces the tallies' internal consistency.
 *
 * Runs on every add/update (in the store), so a hand-typed `tests 1 / held 2 / broke 1`
 * becomes `touches 3` rather than a corrupt record, and a field that an outcome makes
 * impossible is pruned rather than silently retained:
 *
 *   touches = max(touches, holds + breaks)
 *   holds   = min(holds, touches)
 *   breaks  = min(breaks, touches)
 *   touches <= 0 → hitTime cleared
 *   breaks  <= 0 → breakTime, breakDirection cleared
 */
export function sanitizeLevel(record: LevelRecord): LevelRecord {
  const held = toCount(record.holds);
  const broken = toCount(record.breaks);
  const touches = Math.max(toCount(record.touches), held + broken);
  const holds = Math.min(held, touches);
  const breaks = Math.min(broken, touches);

  let hitTime = toString(record.hitTime).trim();
  let breakTime = toString(record.breakTime).trim();
  let breakDirection = record.breakDirection;

  if (touches <= 0) hitTime = '';
  if (breaks <= 0) {
    breakTime = '';
    breakDirection = '';
  }
  if (!isDirection(breakDirection)) breakDirection = '';

  return { ...record, touches, holds, breaks, hitTime, breakTime, breakDirection };
}

/**
 * Coerces one raw stored/imported row into a `LevelRecord`, or null when it is not one.
 *
 * Deliberately tolerant of an OLDER schema: a record saved before timing existed must load
 * with `''` for the timing fields, not `undefined`, or a later `.length`/`.includes` call
 * crashes the whole tab. Only a row with no usable date and no usable price is dropped.
 */
export function normalizeMesLevel(raw: unknown): LevelRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<LevelRecord>;

  const price = typeof candidate.price === 'number' ? candidate.price : Number(candidate.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const date = toString(candidate.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const now = Date.now();
  const record: LevelRecord = {
    id: toString(candidate.id) || newId(),
    date,
    timeframe: isTimeframe(candidate.timeframe) ? candidate.timeframe : '5m',
    kind: isKind(candidate.kind) ? candidate.kind : 'resistance',
    price,
    touches: toCount(candidate.touches),
    holds: toCount(candidate.holds),
    breaks: toCount(candidate.breaks),
    setup: isSetup(candidate.setup) ? candidate.setup : '',
    hitTime: toString(candidate.hitTime),
    breakTime: toString(candidate.breakTime),
    breakDirection: isDirection(candidate.breakDirection) ? candidate.breakDirection : '',
    notes: toString(candidate.notes),
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : now,
  };

  return sanitizeLevel(record);
}

/**
 * One line named well enough to be quoted on its own.
 *
 * A rate is only meaningful beside the line it was taken from, so this carries the line's whole
 * identity — chart, side and price — and its own counts. Nothing here is a group figure restated:
 * every field belongs to this one level.
 */
export interface NotableLevel {
  /** How the line is named in a read, e.g. '30m support 5820.00'. */
  label: string;
  date: string;
  timeframe: Timeframe;
  kind: LevelKind;
  price: number;
  touches: number;
  holds: number;
  breaks: number;
  /** 0..1, null when this line was never decided. */
  reliability: number | null;
  /** 0..100 shrunk strength for this line alone. */
  strength: number | null;
  grade: Grade;
  confidence: Confidence;
  setup: SetupTag | '';
  /** What the trader wrote against the line, or null when they wrote nothing. */
  notes: string | null;
}

/**
 * The lines worth naming in a read: the ones with the most decided tests behind them.
 *
 * A group figure — "your 5-minute lines hold 64% of the time" — is a statement about a bucket,
 * and a reader who wants to check it has to go looking for the lines underneath. This surfaces
 * them instead, so a read can say which line it means. Only lines with something decisive on them
 * are listed, because a rate needs a decided test to exist at all; ties go to the line whose rate
 * sits furthest from a coin flip, and then to the most recent session, so the list leads with the
 * lines that say the most rather than with whatever happened to be logged first.
 *
 * This ranks nothing as an edge. `strength` is the same shrunk figure the screens show, and it is
 * the caller's job — and the prompt's — never to turn a line's tally into a forecast.
 */
export function notableLevels(
  records: LevelRecord[],
  limit = NOTABLE_LEVEL_LIMIT
): NotableLevel[] {
  return records
    .filter((record) => record.holds + record.breaks > 0)
    .map((record) => {
      const strength = strengthOf(record.holds, record.breaks);
      const notes = record.notes.trim();
      return {
        label: `${record.timeframe} ${record.kind} ${record.price.toFixed(2)}`,
        date: record.date,
        timeframe: record.timeframe,
        kind: record.kind,
        price: record.price,
        touches: record.touches,
        holds: record.holds,
        breaks: record.breaks,
        reliability: reliabilityOf(record.holds, record.breaks),
        strength,
        grade: gradeOf(strength),
        confidence: confidenceOf(record.holds + record.breaks),
        setup: record.setup,
        notes: notes || null,
      };
    })
    .sort((a, b) => {
      const decided = b.holds + b.breaks - (a.holds + a.breaks);
      if (decided !== 0) return decided;
      const conviction = Math.abs((b.strength ?? 50) - 50) - Math.abs((a.strength ?? 50) - 50);
      if (conviction !== 0) return conviction;
      return b.date.localeCompare(a.date);
    })
    .slice(0, Math.max(0, limit));
}

/** Sorts levels strongest-price-first, with ties broken by timeframe then id. */
export function sortByPriceDesc(records: LevelRecord[]): LevelRecord[] {
  return [...records].sort(
    (a, b) => b.price - a.price || TIMEFRAME_ORDER[a.timeframe] - TIMEFRAME_ORDER[b.timeframe]
  );
}

/** Total tallies and distinct sessions — the Data tab's storage summary. */
export function totals(records: LevelRecord[]): {
  records: number;
  sessions: number;
  touches: number;
  holds: number;
  breaks: number;
  firstDate: string | null;
  lastDate: string | null;
} {
  const dates = records.map((record) => record.date).sort((a, b) => a.localeCompare(b));
  return {
    records: records.length,
    sessions: new Set(records.map((record) => record.date)).size,
    touches: records.reduce((sum, record) => sum + record.touches, 0),
    holds: records.reduce((sum, record) => sum + record.holds, 0),
    breaks: records.reduce((sum, record) => sum + record.breaks, 0),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
