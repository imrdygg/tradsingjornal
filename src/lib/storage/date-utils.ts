/**
 * Date and timezone utilities for the trading journal.
 * Respects configured timezone (default 'America/New_York') for daily grouping.
 */

export function getCurrentTradingDate(timezone = 'America/New_York'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date()); // Outputs YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * The calendar weekday (0 = Sunday) of a `YYYY-MM-DD` trading date.
 *
 * Read in UTC on purpose: a trading date is a calendar label, so its weekday must not shift
 * with the reader's timezone. Parsing it as a local instant would move the date across midnight
 * for anyone east or west of the record's own clock.
 */
export function weekdayOfTradingDate(dateStr: string): number {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 0 : date.getUTCDay();
}

/** Steps a `YYYY-MM-DD` date by whole days, staying on the same calendar. */
export function shiftTradingDate(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The trading date the app should treat as the current session.
 *
 * The futures market is closed on Saturday: it reopens Sunday evening and runs through Friday
 * afternoon. A Saturday has no session of its own, so rather than opening a day nothing can
 * trade on, this rolls back to Friday — the session that just closed — and the app carries on
 * with that. Every other day is returned unchanged, Sunday included, since 6pm Sunday is
 * already the week's open.
 */
export function getCurrentTradingSessionDate(timezone = 'America/New_York'): string {
  const today = getCurrentTradingDate(timezone);
  // 6 = Saturday, the one weekday the market never trades.
  return weekdayOfTradingDate(today) === 6 ? shiftTradingDate(today, -1) : today;
}

export function getCurrentTradingTime(timezone = 'America/New_York'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toTimeString().slice(0, 8);
  }
}

export function formatTradingDate(dateStr: string, timezone = 'America/New_York'): string {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateStr;
  }
}

/**
 * Hour of day (0-23) in the given timezone.
 *
 * `hour12: false` can yield "24" for midnight in some engines, so the result is
 * normalised. Falls back to the host clock rather than throwing if the timezone is
 * invalid, because a bad profile value must not break the UI.
 */
export function hourInTimezone(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const raw = parts.find((part) => part.type === 'hour')?.value;
    const hour = Number(raw);
    return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : date.getHours();
  } catch {
    return date.getHours();
  }
}

export function formatTimestamp(isoString: string, timezone = 'America/New_York'): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return isoString;
  }
}
