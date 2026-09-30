import { ExtremeKind, SessionExtreme, SessionWindow } from '../../types';

/**
 * Where a session's extremes printed, read as numbers.
 *
 * The trader logs the clock time of each session's overnight and regular-session high and
 * low by hand. This module turns that log into the one thing it can honestly answer:
 * *when an extreme printed in a given hour, did the session keep it?* That is a count over
 * their own recorded sessions — the overnight high that was never taken out during the
 * regular session, and how often that happened when it printed in the 3am hour.
 *
 * It is deliberately arithmetic and nothing else. There is no probability here, no
 * direction, no score for how likely a print is to hold next time: the log is a record of
 * what price has already done, and the only thing worth adding is the tally a trader
 * cannot keep in their head. Every rate carries the count it came from, and a bucket below
 * {@link MIN_PATTERN_SESSIONS} reports `enoughData: false` rather than a percentage that
 * would read like a forecast.
 *
 * The clock is Eastern on purpose. Futures trade nearly around the clock, but the trader
 * reads the pre-open hours off an ET chart, so "3am" means 03:00 ET here and the windows
 * below are stated in that clock.
 */

/** Overnight opens: 18:00 ET, when the futures session reopens after the daily halt. */
export const OVERNIGHT_OPEN_MINUTES = 18 * 60;

/** The regular session opens: 09:30 ET — "the open" this log is about. */
export const REGULAR_OPEN_MINUTES = 9 * 60 + 30;

/** The regular session closes: 16:00 ET. */
export const REGULAR_CLOSE_MINUTES = 16 * 60;

/**
 * Decided sessions an hour bucket needs before its rate may be read as a pattern.
 *
 * Five is the same floor the level-touch record uses, for the same reason: "2 of 2 so far"
 * is a tally, and publishing it as a percentage would turn a fortnight of logging into
 * something that looks like an edge.
 */
export const MIN_PATTERN_SESSIONS = 5;

/** Reads `HH:MM` into minutes past midnight, or null when it is not a clock time. */
export function parseClock(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Which window a clock time falls in, or null when it falls outside both.
 *
 * 18:00–23:59 and 00:00–09:29 count as overnight; 09:30–15:59 as the regular session. The
 * 16:00–17:59 halt belongs to neither, and returning null for it is the honest answer:
 * a print there is not part of either session, so it must not be filed as one.
 */
export function sessionWindowForTime(time: string): SessionWindow | null {
  const minutes = parseClock(time);
  if (minutes === null) return null;
  // 18:00 to 09:29 is one continuous window across midnight.
  if (minutes >= OVERNIGHT_OPEN_MINUTES || minutes < REGULAR_OPEN_MINUTES) return 'overnight';
  if (minutes < REGULAR_CLOSE_MINUTES) return 'regular';
  return null;
}

/** The clock hour (0–23) a time falls in, or null when it cannot be read. */
export function clockHour(time: string): number | null {
  const minutes = parseClock(time);
  return minutes === null ? null : Math.floor(minutes / 60);
}

/** A clock hour as the trader reads it: `3am`, `9am`, `12pm`. */
export function hourLabel(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '—';
  const suffix = hour < 12 ? 'am' : 'pm';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}${suffix}`;
}

/** One logged extreme, reduced to what the stats read. */
export interface ExtremePoint {
  /** The clock hour it printed in, 0–23. */
  hour: number;
  /** The clock time as logged, `HH:MM`. */
  time: string;
  price: number;
}

/** One session's logged extremes, paired by symbol and date. */
export interface ExtremeDay {
  tradeDate: string;
  symbol: string;
  overnightHigh: ExtremePoint | null;
  overnightLow: ExtremePoint | null;
  regularHigh: ExtremePoint | null;
  regularLow: ExtremePoint | null;
}

/** The four slots a session can record, so the pairing code names them once. */
type ExtremeSlot = 'overnightHigh' | 'overnightLow' | 'regularHigh' | 'regularLow';

const SLOTS: ExtremeSlot[] = ['overnightHigh', 'overnightLow', 'regularHigh', 'regularLow'];

/** Which slot a record is, given its kind and the window it was logged in. */
function slotOf(extreme: SessionExtreme): ExtremeSlot {
  return `${extreme.window}${extreme.kind === 'high' ? 'High' : 'Low'}` as ExtremeSlot;
}

/**
 * Whether a candidate replaces what is already in a slot.
 *
 * A slot holds one print — the session's overnight high is a single time. If two records
 * land in the same slot (the same extreme logged twice, or a typo corrected with a second
 * entry) the more extreme one wins: the higher high, the lower low. Ties go to the earlier
 * clock time, so the outcome does not depend on the order the records arrived in.
 */
function isMoreExtreme(candidate: ExtremePoint, current: ExtremePoint, kind: ExtremeKind): boolean {
  if (candidate.price !== current.price) {
    return kind === 'high' ? candidate.price > current.price : candidate.price < current.price;
  }
  return candidate.time < current.time;
}

/**
 * Pairs the raw log into one row per symbol and session.
 *
 * Rows come back oldest first, so a caller reading the tail is reading the most recent
 * sessions. A record whose time cannot be read is not silently dropped into "unknown":
 * it is left out of the pairing and reported by {@link summarizeExtremes}, because a
 * number the trader typed and the journal could not read is not the same as no number.
 */
export function buildExtremeDays(extremes: SessionExtreme[]): ExtremeDay[] {
  const byKey = new Map<string, ExtremeDay>();

  for (const extreme of extremes) {
    if (!extreme || typeof extreme.price !== 'number' || !Number.isFinite(extreme.price)) continue;
    if (!extreme.tradeDate || !extreme.symbol) continue;
    const hour = clockHour(extreme.time);
    if (hour === null) continue;
    const slot = slotOf(extreme);
    if (!SLOTS.includes(slot)) continue;

    const key = `${extreme.symbol}|${extreme.tradeDate}`;
    const day: ExtremeDay = byKey.get(key) ?? {
      tradeDate: extreme.tradeDate,
      symbol: extreme.symbol,
      overnightHigh: null,
      overnightLow: null,
      regularHigh: null,
      regularLow: null,
    };

    const point: ExtremePoint = {
      hour,
      time: extreme.time.trim(),
      price: extreme.price,
    };
    const current = day[slot];
    if (!current || isMoreExtreme(point, current, extreme.kind)) day[slot] = point;

    byKey.set(key, day);
  }

  return [...byKey.values()].sort(
    (a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.symbol.localeCompare(b.symbol)
  );
}

/** What the log holds, before any pattern is read from it. */
export interface ExtremeLogSummary {
  /** Symbol-and-date rows logged, however many of their four slots are filled. */
  sessions: number;
  /** Individual extremes logged. */
  points: number;
  /** Symbols with at least one readable session, alphabetically. */
  symbols: string[];
  /** The oldest and newest session dates in the log, or null when it is empty. */
  firstDate: string | null;
  lastDate: string | null;
  /** Records whose time could not be read, so they are absent from the pairing. */
  unreadable: number;
}

/** Counts the log, so a card can say how much there is to read. */
export function summarizeExtremes(extremes: SessionExtreme[]): ExtremeLogSummary {
  const days = buildExtremeDays(extremes);
  const read = new Set<string>();
  for (const extreme of extremes) {
    if (clockHour(extreme?.time ?? '') === null || !Number.isFinite(extreme?.price)) continue;
    read.add(extreme.id);
  }

  return {
    sessions: days.length,
    points: read.size,
    symbols: [...new Set(days.map((day) => day.symbol))].sort(),
    firstDate: days[0]?.tradeDate ?? null,
    lastDate: days[days.length - 1]?.tradeDate ?? null,
    unreadable: extremes.length - read.size,
  };
}

/** One clock hour's record, for one symbol and one side of the range. */
export interface ExtremeHourPattern {
  /** Stable key, e.g. `MES|high|3`, so a list can be diffed. */
  key: string;
  symbol: string;
  /** Which extreme the bucket is about: the overnight high, or the overnight low. */
  kind: ExtremeKind;
  /** The clock hour the overnight extreme printed in, 0–23. */
  hour: number;
  /** Sessions where the overnight extreme printed in this hour. */
  sessions: number;
  /**
   * Of those, the sessions the regular session never extended past it — the extreme held
   * as the session's own. For a high that means the regular high did not exceed it; for a
   * low, that the regular low did not go under it.
   */
  held: number;
  /** Sessions the regular session extended past it. */
  takenOut: number;
  /**
   * Sessions in the sample with no regular-session extreme logged to compare against, so
   * they cannot be judged either way. Kept out of the rate rather than counted as a hold.
   */
  undecided: number;
  /** Share of the decided sessions where the extreme held, or null when none are decided. */
  heldRate: number | null;
  /** True once `held + takenOut` reaches {@link MIN_PATTERN_SESSIONS}. */
  enoughData: boolean;
  /** Median points the regular session extended past it, on the sessions it did. */
  medianExtensionPoints: number | null;
  /** The session dates in the sample, newest first, so a card can link the trades behind it. */
  tradeDates: string[];
}

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Median of a non-empty list of numbers, or null. Values are copied before sorting. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** What one logged session did to its overnight extreme. */
interface ExtremesOutcome {
  /** True when the overnight extreme held, false when the regular session took it out. */
  held: boolean;
  /** Points the regular session extended past the extreme. Zero when it held. */
  extensionPoints: number;
}

/**
 * Reads one session's overnight extreme against its regular extreme.
 *
 * Returns null when the session cannot be judged — one of the two extremes was never
 * logged. That is the honest state rather than a hold: an unlogged regular high is not
 * evidence that the overnight high survived, and counting it as one would manufacture
 * exactly the pattern the trader is looking for.
 */
function readOutcome(day: ExtremeDay, kind: ExtremeKind): ExtremesOutcome | null {
  const overnight = kind === 'high' ? day.overnightHigh : day.overnightLow;
  const regular = kind === 'high' ? day.regularHigh : day.regularLow;
  if (!overnight || !regular) return null;

  if (kind === 'high') {
    const extension = regular.price - overnight.price;
    return extension > 0
      ? { held: false, extensionPoints: extension }
      : { held: true, extensionPoints: 0 };
  }
  const extension = overnight.price - regular.price;
  return extension > 0 ? { held: false, extensionPoints: extension } : { held: true, extensionPoints: 0 };
}

/**
 * The hour-by-hour record: when the overnight extreme printed, did the session keep it?
 *
 * This is the question the trader is trying to ask of their own log — "MES high at 3am,
 * what did the open do with it?" — answered as a count over the sessions they recorded.
 * Each bucket is one symbol, one side of the range and one clock hour, and every bucket
 * carries the counts behind it so a rate can never be read without its sample.
 *
 * Buckets with no sessions are not returned at all, and buckets are ordered the way the
 * edge finder orders its conditions: the readable ones first by hold rate, the thin ones
 * after them. A thin bucket is kept rather than hidden, because "three sessions so far" is
 * the honest answer a trader needs to keep logging.
 */
export function buildOvernightHourPatterns(
  days: ExtremeDay[],
  options: { minSessions?: number } = {}
): ExtremeHourPattern[] {
  const minSessions = options.minSessions ?? MIN_PATTERN_SESSIONS;
  const buckets = new Map<string, ExtremeHourPattern>();
  const extensions = new Map<string, number[]>();

  for (const day of days) {
    for (const kind of ['high', 'low'] as ExtremeKind[]) {
      const overnight = kind === 'high' ? day.overnightHigh : day.overnightLow;
      if (!overnight) continue;

      const key = `${day.symbol}|${kind}|${overnight.hour}`;
      const pattern: ExtremeHourPattern = buckets.get(key) ?? {
        key,
        symbol: day.symbol,
        kind,
        hour: overnight.hour,
        sessions: 0,
        held: 0,
        takenOut: 0,
        undecided: 0,
        heldRate: null,
        enoughData: false,
        medianExtensionPoints: null,
        tradeDates: [],
      };

      pattern.sessions += 1;
      pattern.tradeDates.push(day.tradeDate);

      const outcome = readOutcome(day, kind);
      if (outcome === null) {
        pattern.undecided += 1;
      } else if (outcome.held) {
        pattern.held += 1;
      } else {
        pattern.takenOut += 1;
        const list = extensions.get(key) ?? [];
        list.push(outcome.extensionPoints);
        extensions.set(key, list);
      }

      buckets.set(key, pattern);
    }
  }

  const finished = [...buckets.values()].map((pattern): ExtremeHourPattern => {
    const decided = pattern.held + pattern.takenOut;
    const extensionPoints = extensions.get(pattern.key) ?? [];
    const medianExtension = median(extensionPoints);
    return {
      ...pattern,
      tradeDates: [...pattern.tradeDates].sort((a, b) => b.localeCompare(a)),
      heldRate: decided > 0 ? round((pattern.held / decided) * 100, 1) : null,
      enoughData: decided >= minSessions,
      medianExtensionPoints: medianExtension === null ? null : round(medianExtension),
    };
  });

  return finished.sort((a, b) => {
    if (a.enoughData !== b.enoughData) return a.enoughData ? -1 : 1;
    const rateA = a.heldRate ?? -1;
    const rateB = b.heldRate ?? -1;
    if (rateA !== rateB) return rateB - rateA;
    if (a.sessions !== b.sessions) return b.sessions - a.sessions;
    return a.key.localeCompare(b.key);
  });
}

/**
 * The share of decided sessions a record must lean past before a heads-up names a side.
 *
 * Above this one way, below its mirror the other; in between the record is a coin toss and
 * is reported as one rather than dressed up as a lean. Named rather than inline because it
 * is the difference between "your log usually keeps this" and "this is noise".
 */
export const LEAN_THRESHOLD_PCT = 60;

/** Which way a readable record leans, if it leans at all. */
export type ExtremeLean = 'kept' | 'taken-out' | 'split';

/** One of today's prints that lands in an hour the trader's own log has a record for. */
export interface ExtremeMatch {
  symbol: string;
  kind: ExtremeKind;
  /** The hour today's print landed in. */
  hour: number;
  /** Today's own clock time and price for the print. */
  time: string;
  price: number;
  /** The readable hour record this print lands in. */
  pattern: ExtremeHourPattern;
  /** Which way that record leans; `split` means it does not. */
  lean: ExtremeLean;
  /**
   * Today's regular-session extreme for this side, when it has already been logged.
   * Null while it has not, which is the honest state before the session is written down.
   */
  todayRegularPrice: number | null;
  /** Whether today's regular session has already traded past the overnight extreme. */
  todayTakenOut: boolean | null;
}

/**
 * Today's overnight prints that land in an hour the trader's own log can speak about.
 *
 * This is the on-the-day half of the log: the record is only useful while the session is
 * still open, and the one moment it applies is when this morning's extreme prints in an
 * hour that has already happened often enough to be readable. Only readable hours match — a
 * tally of two sessions is not a heads-up — and the sample is every logged session,
 * including today once its regular extreme is filled in, so the strip and the card beside it
 * cannot disagree about the same hour.
 *
 * Nothing here is a forecast and nothing is a signal to trade: it reads the trader's own
 * recorded sessions back to them and stops. The leaning is stated so a coin toss is never
 * presented as a pattern.
 */
export function findExtremeMatches(
  days: ExtremeDay[],
  todayTradeDate: string,
  options: { minSessions?: number } = {}
): ExtremeMatch[] {
  const minSessions = options.minSessions ?? MIN_PATTERN_SESSIONS;
  const patterns = buildOvernightHourPatterns(days, { minSessions }).filter(
    (pattern) => pattern.enoughData
  );
  const byKey = new Map(patterns.map((pattern) => [pattern.key, pattern]));

  const today = days.find((day) => day.tradeDate === todayTradeDate);
  if (!today) return [];

  const matches: ExtremeMatch[] = [];
  for (const kind of ['high', 'low'] as ExtremeKind[]) {
    const overnight = kind === 'high' ? today.overnightHigh : today.overnightLow;
    if (!overnight) continue;

    const pattern = byKey.get(`${today.symbol}|${kind}|${overnight.hour}`);
    if (!pattern || pattern.heldRate === null) continue;

    const regular = kind === 'high' ? today.regularHigh : today.regularLow;
    const todayTakenOut = regular
      ? kind === 'high'
        ? regular.price > overnight.price
        : regular.price < overnight.price
      : null;

    matches.push({
      symbol: today.symbol,
      kind,
      hour: overnight.hour,
      time: overnight.time,
      price: overnight.price,
      pattern,
      lean:
        pattern.heldRate >= LEAN_THRESHOLD_PCT
          ? 'kept'
          : pattern.heldRate <= 100 - LEAN_THRESHOLD_PCT
          ? 'taken-out'
          : 'split',
      todayRegularPrice: regular?.price ?? null,
      todayTakenOut,
    });
  }

  // A lean leads, and the direction it leans in leads: what the log has to say about this
  // morning is more useful than the order the sides happen to be checked in.
  return matches.sort((a, b) => {
    const rank = (match: ExtremeMatch) => (match.lean === 'kept' ? 0 : match.lean === 'taken-out' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.kind.localeCompare(b.kind);
  });
}

/** One symbol's overnight extremes, counted by the hour they printed in. */
export interface ExtremeHourHistogram {
  symbol: string;
  kind: ExtremeKind;
  /** Sessions with an overnight extreme of this kind logged. */
  sessions: number;
  /** A count for every clock hour of the day, index 0–23. */
  hours: number[];
  /** The hour with the most prints, or null when nothing is logged. Ties go to the earlier hour. */
  busiestHour: number | null;
}

/**
 * The picture behind the patterns: for each symbol and side, which clock hours its
 * overnight extremes actually print in.
 *
 * Only the overnight extremes are counted. Those are the prints that happen before the
 * open, which is the window the trader is collecting; the regular session's own extremes
 * are read by the pattern code above, against the overnight ones.
 */
export function buildExtremeHourHistogram(days: ExtremeDay[]): ExtremeHourHistogram[] {
  const byKey = new Map<string, ExtremeHourHistogram>();

  for (const day of days) {
    for (const kind of ['high', 'low'] as ExtremeKind[]) {
      const overnight = kind === 'high' ? day.overnightHigh : day.overnightLow;
      if (!overnight) continue;
      const key = `${day.symbol}|${kind}`;
      const row: ExtremeHourHistogram = byKey.get(key) ?? {
        symbol: day.symbol,
        kind,
        sessions: 0,
        hours: new Array<number>(24).fill(0),
        busiestHour: null,
      };
      row.sessions += 1;
      row.hours[overnight.hour] += 1;
      byKey.set(key, row);
    }
  }

  return [...byKey.values()]
    .map((row): ExtremeHourHistogram => {
      let busiestHour: number | null = null;
      for (let hour = 0; hour < 24; hour += 1) {
        if (row.hours[hour] > 0 && (busiestHour === null || row.hours[hour] > row.hours[busiestHour])) {
          busiestHour = hour;
        }
      }
      return { ...row, busiestHour };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.kind.localeCompare(b.kind));
}
