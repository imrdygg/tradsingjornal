import type { Instrument, LevelKind, LevelTouch } from '../../types';
import { instrumentSymbol } from '../trading/instruments';
import { hourInTimezone } from '../storage/date-utils';
import { MIN_DECIDED, summarizeTouches, type LevelEdgeStats } from './level-edge';

/**
 * Repetition in the level-touch record.
 *
 * A level is rarely reached once. Price tests the same line in the overnight session, again at
 * the open, and again at midday, and the outcome is often different each time — which is the
 * whole reason the touch log exists. This module reads those repetitions, and it reads them two
 * ways on purpose:
 *
 * 1. **Within a day.** The touches of one line, in the order they happened, so the record can
 *    say whether it is the *first* test of a line that holds or the *third* one near midday.
 * 2. **Across days.** The same line — same instrument, same side, same price — touched on
 *    different days, with the weekdays it printed on, so a pattern like "every Monday this line
 *    is reached and price comes back" is a fact the record can carry.
 *
 * Deliberately pure and symbol-free at the edges: it takes the touches, a timezone and the
 * instruments to name them, and returns counts. A rate is never returned without the decided
 * count behind it, and a bucket below the readability floor says so through `enoughData`, so a
 * caller cannot turn three touches into a percentage.
 */

/** Weekday names indexed by `Date.getDay()` (0 = Sunday), shared by the label and the reader. */
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** How a line is identified across days: the same instrument, side and price. */
export function levelKeyOf(touch: LevelTouch): string {
  return `${touch.instrumentId}|${touch.kind}|${touch.price}`;
}

/**
 * How a line is identified within one day.
 *
 * A touch that came from a marked level shares that level's id, so the touches of one written
 * line group together even if its price was rounded differently on the way in. A touch logged
 * free-standing has no level behind it, so it falls back to its own key and date — the same line
 * touched twice in a day still groups, without inventing a level the trader never marked.
 */
function occurrenceKeyOf(touch: LevelTouch): string {
  return touch.levelId ? `lvl:${touch.levelId}` : `${levelKeyOf(touch)}|${touch.tradeDate}`;
}

function touchStamp(touch: LevelTouch): string {
  return touch.touchedAt ?? touch.createdAt;
}

function touchDate(touch: LevelTouch): Date {
  const date = new Date(touchStamp(touch));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
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

/**
 * The 1-based position of each touch in its own line's day, oldest first.
 *
 * Ordinals are assigned before any outcome is read, because the question is about the order
 * price arrived in, not about which tests passed. A `void` touch is excluded by the caller so it
 * cannot inflate a later touch's ordinal.
 */
function ordinalByOccurrence(touches: LevelTouch[]): Map<string, number> {
  const groups = new Map<string, LevelTouch[]>();
  for (const touch of touches) {
    const key = occurrenceKeyOf(touch);
    const list = groups.get(key);
    if (list) list.push(touch);
    else groups.set(key, [touch]);
  }

  const ordinal = new Map<string, number>();
  for (const list of groups.values()) {
    [...list]
      .sort((a, b) => touchStamp(a).localeCompare(touchStamp(b)))
      .forEach((touch, index) => ordinal.set(touch.id, index + 1));
  }
  return ordinal;
}

function push<K>(map: Map<K, LevelTouch[]>, key: K, touch: LevelTouch) {
  const list = map.get(key);
  if (list) list.push(touch);
  else map.set(key, [touch]);
}

/** One condition built from the record, with the counts it was drawn from. */
export interface RecurrenceBucket {
  /** Stable key, e.g. `ordinal:3` or `weekday:1`. */
  key: string;
  /** The condition in the trader's terms. */
  label: string;
  stats: LevelEdgeStats;
}

/**
 * One line that was reached on more than one day — the cross-day recurrence.
 *
 * `weekdays` is what makes the "every Monday" read checkable: it names the days of the week this
 * exact instrument, side and price were touched on, and the counts behind the hold rate travel
 * with the row.
 */
export interface RepeatedLevelRow {
  key: string;
  symbol: string;
  kind: LevelKind;
  price: number;
  /** Distinct trading days this line was touched on. */
  days: number;
  /** Total touches of this line across those days. */
  touches: number;
  /** Weekday names it was touched on, e.g. `['Mon', 'Wed']`, in week order. */
  weekdays: string[];
  stats: LevelEdgeStats;
}

export interface LevelRecurrenceReport {
  /** Lines touched on more than one day, busiest first; bounded by the caller's slice. */
  repeatedLevels: RepeatedLevelRow[];
  /** Hold rate by where a touch fell in the day's own sequence. */
  byOrdinal: RecurrenceBucket[];
  /** Hold rate by the hour of day a touch printed, in the trader's timezone. */
  byHour: RecurrenceBucket[];
  /** Hold rate by weekday, across every touch on the record. */
  byWeekday: RecurrenceBucket[];
  minDecided: number;
}

/**
 * Week order for display: Monday first, as a week is read, and Saturday last-to-dropped.
 *
 * Saturday is left out because the market is closed then: no touch can print on it, so a
 * bucket for it could only ever be empty, and listing it would suggest a day worth watching.
 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 0];

/**
 * The whole recurrence read, from the touches alone.
 *
 * `void` touches are dropped before anything is counted, for the same reason the edge finder
 * excludes them: a touch the trader set aside is not evidence about the line, and letting one
 * stand in a sequence would shift every ordinal after it.
 */
export function summarizeLevelRecurrence(
  touches: LevelTouch[],
  timezone: string,
  instruments: Instrument[],
  minDecided = MIN_DECIDED
): LevelRecurrenceReport {
  const valid = touches.filter((touch) => touch.outcome !== 'invalid');

  // ---- Within a day: the ordinal read --------------------------------------
  const ordinal = ordinalByOccurrence(valid);
  const ordinalGroups = new Map<number, LevelTouch[]>();
  for (const touch of valid) {
    // Everything from the third touch on is one bucket: by then the trader is watching a level
    // price keeps returning to, and splitting 3, 4 and 5 would only fragment a thin sample.
    push(ordinalGroups, Math.min(ordinal.get(touch.id) ?? 1, 3), touch);
  }
  const byOrdinal: RecurrenceBucket[] = [1, 2, 3]
    .filter((rank) => ordinalGroups.has(rank))
    .map((rank) => ({
      key: `ordinal:${rank}`,
      label:
        rank === 1
          ? 'First touch of the day'
          : rank === 2
          ? 'Second touch of the day'
          : 'Third touch of the day or later',
      stats: summarizeTouches(ordinalGroups.get(rank) ?? [], minDecided),
    }));

  // ---- Within a day: the hour read -----------------------------------------
  const hourGroups = new Map<number, LevelTouch[]>();
  for (const touch of valid) {
    push(hourGroups, hourInTimezone(touchDate(touch), timezone), touch);
  }
  const byHour: RecurrenceBucket[] = [...hourGroups.keys()]
    .sort((a, b) => a - b)
    .map((hour) => ({
      key: `hour:${hour}`,
      label: `${String(hour).padStart(2, '0')}:00`,
      stats: summarizeTouches(hourGroups.get(hour) ?? [], minDecided),
    }));

  // ---- Across days: the weekday read ---------------------------------------
  const weekdayGroups = new Map<number, LevelTouch[]>();
  for (const touch of valid) {
    push(weekdayGroups, weekdayInTimezone(touchDate(touch), timezone), touch);
  }
  const byWeekday: RecurrenceBucket[] = WEEK_ORDER.filter((day) => weekdayGroups.has(day)).map(
    (day) => ({
      key: `weekday:${day}`,
      label: WEEKDAY_NAMES[day],
      stats: summarizeTouches(weekdayGroups.get(day) ?? [], minDecided),
    })
  );

  // ---- Across days: the same line, week after week -------------------------
  const byLevel = new Map<string, LevelTouch[]>();
  for (const touch of valid) {
    push(byLevel, levelKeyOf(touch), touch);
  }
  const repeatedLevels: RepeatedLevelRow[] = [...byLevel.entries()]
    .map(([key, list]) => {
      const daySet = new Set(list.map((touch) => touch.tradeDate));
      const weekdaySet = new Set(
        list.map((touch) => WEEKDAY_NAMES[weekdayInTimezone(touchDate(touch), timezone)])
      );
      const first = list[0];
      return {
        key,
        symbol: instrumentSymbol(instruments, first.instrumentId),
        kind: first.kind,
        price: first.price,
        days: daySet.size,
        touches: list.length,
        weekdays: WEEK_ORDER.map((day) => WEEKDAY_NAMES[day]).filter((name) =>
          weekdaySet.has(name)
        ),
        stats: summarizeTouches(list, minDecided),
      };
    })
    // A line reached on one day only is not a recurrence; it is the ordinary case.
    .filter((row) => row.days > 1)
    .sort((a, b) => b.days - a.days || b.touches - a.touches || a.key.localeCompare(b.key));

  return { repeatedLevels, byOrdinal, byHour, byWeekday, minDecided };
}
