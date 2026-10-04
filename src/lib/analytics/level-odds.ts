import type { LevelKind, LevelTimeframe, LevelTouch, MarkedLevel } from '../../types';
import { hourInTimezone } from '../storage/date-utils';
import { MIN_DECIDED, summarizeTouches, type LevelEdgeStats } from './level-edge';
import { WEEKDAY_NAMES } from './level-recurrence';

/**
 * What the trader's own record says about reaching each indicator line.
 *
 * The level-touch record answers "when a line is tested, does price come back?". This module
 * answers the question the trader asks *before* the session: **if I mark my six lines again
 * today, which ones has price actually been reaching, when does it reach them, and what does it
 * do after.** It is drawn entirely from the trader's own marked levels and logged touches —
 * nothing comes from a market feed, and nothing here predicts.
 *
 * Three reads, all built from the same two records:
 *
 * 1. **Reach.** For each timeframe and side, how many days the trader marked that line and how
 *    many of those days price reached it. The denominator is *days marked*, not lines marked,
 *    because the trader's mental model is per-session: "on a day I mark the 5m resistance, how
 *    often does price get there."
 * 2. **Hold.** Of the touches that were reached and later decided, how many saw price never
 *    come back. This is the same statistic the edge finder reports, scoped to one line.
 * 3. **When.** The hour of day and the weekday the touches printed on, so a pattern like "most
 *    often reached early Monday" is a count the trader can check rather than a hunch.
 *
 * And one sequence read: on the days a given line was reached, which other lines were reached
 * the same day — the record's answer to "does it go on to the 15m line next, or reverse".
 *
 * Every rate carries the days it was drawn from. A rate is only marked `enoughDays` once the
 * sample clears {@link MIN_DAYS_FOR_RATE}, so a caller can show the raw count while withholding
 * the percentage that would read like an edge. A touch only counts here when it links back to a
 * marked level: the older, mark-as-you-go touches have no line to attribute to and are left out
 * rather than folded into a bucket they do not belong to.
 */

/** Fewest marked days before a reach rate is stated as a finding rather than shown as a tally. */
export const MIN_DAYS_FOR_RATE = 3;

/** Fewest reached days before a "what happened next" line is drawn. */
export const MIN_DAYS_FOR_SEQUENCE = 3;

function round(value: number, dp = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** The weekday (0 = Sunday) a timestamp falls on in the trader's own timezone. */
function weekdayInTimezone(date: Date, timezone: string): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(date);
    const index = (WEEKDAY_NAMES as readonly string[]).indexOf(name);
    return index >= 0 ? index : date.getDay();
  } catch {
    return date.getDay();
  }
}

function touchDate(touch: LevelTouch): Date {
  const date = new Date(touch.touchedAt ?? touch.createdAt);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** A stable key for one line: its timeframe and side. */
export function levelOddsKey(timeframe: LevelTimeframe, kind: LevelKind): string {
  return `${timeframe}|${kind}`;
}

function splitKey(key: string): { timeframe: LevelTimeframe; kind: LevelKind } {
  const [timeframe, kind] = key.split('|');
  return { timeframe: timeframe as LevelTimeframe, kind: kind as LevelKind };
}

/** One timeframe and side: how often price reaches it, and what it does after. */
export interface LevelOddsRow {
  /** Stable key, e.g. `5m|resistance`. */
  key: string;
  timeframe: LevelTimeframe;
  kind: LevelKind;
  /** Distinct days the trader marked at least one line on this timeframe and side. */
  daysMarked: number;
  /** Distinct of those days price reached the line. */
  daysReached: number;
  /** `daysReached / daysMarked` as a percentage, or null when nothing was marked. */
  reachRate: number | null;
  /** True once `daysMarked` clears {@link MIN_DAYS_FOR_RATE}, so the rate may be read. */
  enoughDays: boolean;
  /** Lines marked on this timeframe and side, across every day. */
  marked: number;
  /** Lines that were reached. */
  tested: number;
  /** Hold/return stats over the touches that came from these lines. */
  stats: LevelEdgeStats;
  /** Hours of day touches printed at, busiest first. */
  hours: Array<{ hour: number; count: number }>;
  /** Weekdays touches printed on, busiest first. */
  weekdays: Array<{ day: number; name: string; count: number }>;
}

/** One line, and what price reached *after* it, on the same days. */
export interface LevelSequenceRow {
  key: string;
  timeframe: LevelTimeframe;
  kind: LevelKind;
  /** Days this line was reached. */
  fromDays: number;
  /**
   * The other lines price reached later the same day, most often first.
   *
   * "Later" is by the touch timestamps, not merely the same day, so the row answers the
   * question the trader is actually asking: once this line is reached, where does price go
   * next. A line only ever reached before this one is not a next-step and is not counted here.
   */
  also: Array<{
    key: string;
    timeframe: LevelTimeframe;
    kind: LevelKind;
    /** Days the other line was reached after this one. */
    days: number;
    /** `days / fromDays` as a percentage. */
    rate: number;
  }>;
}

export interface LevelOddsReport {
  instrumentId: string;
  /** Distinct days the instrument was marked on at all — the whole read's sample. */
  daysMarked: number;
  /** Every timeframe and side with at least one marked line, busiest first. */
  rows: LevelOddsRow[];
  /** Sequence reads for lines reached on enough days, busiest first. */
  sequences: LevelSequenceRow[];
  minDaysForRate: number;
  minDaysForSequence: number;
}

/**
 * The one line price reaches most, for the card's headline.
 *
 * Ranked by reach rate among lines that clear {@link MIN_DAYS_FOR_RATE}, ties falling to the
 * busier record, so a line reached on one of one day cannot outrank a line reached on five of
 * ten. Only when nothing clears the floor does it fall back to the most-reached line by absolute
 * days, which the caller renders as a tally. Null when no line was reached at all.
 */
export function mostReachedLine(rows: LevelOddsRow[]): LevelOddsRow | null {
  const reached = rows.filter((row) => row.daysReached > 0);
  if (!reached.length) return null;
  const qualifying = reached.filter((row) => row.enoughDays);
  const pool = qualifying.length ? qualifying : reached;
  return [...pool].sort(
    (a, b) =>
      (b.reachRate ?? 0) - (a.reachRate ?? 0) ||
      b.daysReached - a.daysReached ||
      b.daysMarked - a.daysMarked ||
      a.key.localeCompare(b.key)
  )[0];
}

/**
 * The whole odds read for one instrument, from the trader's own records.
 *
 * Pure and symbol-free: it takes the levels and touches, the instrument to scope to, a timezone
 * for the hour and weekday reads, and returns counts and rates. A caller renders it; nothing
 * here names a contract or touches the UI.
 */
export function summarizeLevelOdds(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  instrumentId: string,
  timezone: string,
  minDecided = MIN_DECIDED,
  minDaysForRate = MIN_DAYS_FOR_RATE,
  minDaysForSequence = MIN_DAYS_FOR_SEQUENCE
): LevelOddsReport {
  // Only lines that carry a timeframe can be attributed to a bucket; a level from before
  // timeframes existed is left out rather than invented into one.
  const instrumentLevels = levels.filter(
    (level) => level.instrumentId === instrumentId && !!level.timeframe
  );
  const levelById = new Map(instrumentLevels.map((level) => [level.id, level]));

  const bucketOfLevel = (level: MarkedLevel): string =>
    levelOddsKey(level.timeframe as LevelTimeframe, level.kind);

  // A touch counts only when it links back to a marked line; the free-standing, older touches
  // have no bucket to attribute to.
  const linked = touches.filter((touch) => touch.levelId && levelById.has(touch.levelId));

  const markedDays = new Map<string, Set<string>>();
  const reachedDays = new Map<string, Set<string>>();
  const markedCount = new Map<string, number>();
  const reachedCount = new Map<string, number>();
  const bucketTouches = new Map<string, LevelTouch[]>();

  const instrumentDays = new Set<string>();

  for (const level of instrumentLevels) {
    const key = bucketOfLevel(level);
    instrumentDays.add(level.tradeDate);
    markedCount.set(key, (markedCount.get(key) ?? 0) + 1);
    let days = markedDays.get(key);
    if (!days) {
      days = new Set();
      markedDays.set(key, days);
    }
    days.add(level.tradeDate);
  }

  for (const touch of linked) {
    const level = levelById.get(touch.levelId as string);
    if (!level) continue;
    const key = bucketOfLevel(level);
    reachedCount.set(key, (reachedCount.get(key) ?? 0) + 1);
    let days = reachedDays.get(key);
    if (!days) {
      days = new Set();
      reachedDays.set(key, days);
    }
    days.add(touch.tradeDate);
    const list = bucketTouches.get(key);
    if (list) list.push(touch);
    else bucketTouches.set(key, [touch]);
  }

  const rows: LevelOddsRow[] = [];
  for (const [key, days] of markedDays) {
    const { timeframe, kind } = splitKey(key);
    const dayCount = days.size;
    const reachedDayCount = reachedDays.get(key)?.size ?? 0;
    const touchList = bucketTouches.get(key) ?? [];

    const hourCounts = new Map<number, number>();
    const weekdayCounts = new Map<number, number>();
    for (const touch of touchList) {
      const date = touchDate(touch);
      const hour = hourInTimezone(date, timezone);
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
      const weekday = weekdayInTimezone(date, timezone);
      weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
    }

    rows.push({
      key,
      timeframe,
      kind,
      daysMarked: dayCount,
      daysReached: reachedDayCount,
      reachRate: dayCount > 0 ? round((reachedDayCount / dayCount) * 100, 1) : null,
      enoughDays: dayCount >= minDaysForRate,
      marked: markedCount.get(key) ?? 0,
      tested: reachedCount.get(key) ?? 0,
      stats: summarizeTouches(touchList, minDecided),
      hours: [...hourCounts.entries()]
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => b.count - a.count || a.hour - b.hour),
      weekdays: [...weekdayCounts.entries()]
        .map(([day, count]) => ({ day, name: WEEKDAY_NAMES[day], count }))
        .sort((a, b) => b.count - a.count || a.day - b.day),
    });
  }

  rows.sort(
    (a, b) =>
      (b.reachRate ?? -1) - (a.reachRate ?? -1) ||
      b.tested - a.tested ||
      a.key.localeCompare(b.key)
  );

  // ---- What happened next: the earliest reach of each line, day by day ------
  // The earliest touch per line per day is what orders the day: a later reach of another line
  // is a "next step", an earlier one is not.
  const reachedAtByDay = new Map<string, Map<string, number>>();
  for (const touch of linked) {
    const level = levelById.get(touch.levelId as string);
    if (!level) continue;
    const key = bucketOfLevel(level);
    const ms = touchDate(touch).getTime();
    let byBucket = reachedAtByDay.get(touch.tradeDate);
    if (!byBucket) {
      byBucket = new Map();
      reachedAtByDay.set(touch.tradeDate, byBucket);
    }
    const existing = byBucket.get(key);
    if (existing === undefined || ms < existing) byBucket.set(key, ms);
  }

  const sequences: LevelSequenceRow[] = [];
  for (const [key, days] of reachedDays) {
    if (days.size < minDaysForSequence) continue;
    const alsoCount = new Map<string, number>();
    for (const day of days) {
      const byBucket = reachedAtByDay.get(day);
      if (!byBucket) continue;
      const fromMs = byBucket.get(key);
      if (fromMs === undefined) continue;
      for (const [other, otherMs] of byBucket) {
        if (other === key) continue;
        // Only a line reached later the same day counts as what happened next.
        if (otherMs <= fromMs) continue;
        alsoCount.set(other, (alsoCount.get(other) ?? 0) + 1);
      }
    }
    if (!alsoCount.size) continue;
    const also = [...alsoCount.entries()]
      .map(([otherKey, count]) => ({
        key: otherKey,
        ...splitKey(otherKey),
        days: count,
        rate: round((count / days.size) * 100, 1),
      }))
      .sort((a, b) => b.rate - a.rate || b.days - a.days || a.key.localeCompare(b.key));
    const { timeframe, kind } = splitKey(key);
    sequences.push({ key, timeframe, kind, fromDays: days.size, also });
  }
  sequences.sort((a, b) => b.fromDays - a.fromDays || a.key.localeCompare(b.key));

  return {
    instrumentId,
    daysMarked: instrumentDays.size,
    rows,
    sequences,
    minDaysForRate,
    minDaysForSequence,
  };
}
