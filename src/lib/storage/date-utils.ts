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
