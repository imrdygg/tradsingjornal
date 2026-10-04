import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentTradingSessionDate,
  shiftTradingDate,
  weekdayOfTradingDate,
} from '../date-utils';

afterEach(() => {
  vi.useRealTimers();
});

/** Pins the clock so the current-date helpers can be read against a known day. */
function freezeAt(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('weekdayOfTradingDate', () => {
  it('reads the calendar weekday in UTC, so the label never shifts with the reader', () => {
    expect(weekdayOfTradingDate('2026-10-03')).toBe(6); // Saturday
    expect(weekdayOfTradingDate('2026-10-04')).toBe(0); // Sunday
    expect(weekdayOfTradingDate('2026-10-02')).toBe(5); // Friday
  });
});

describe('shiftTradingDate', () => {
  it('steps whole days across a month boundary', () => {
    expect(shiftTradingDate('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftTradingDate('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('getCurrentTradingSessionDate', () => {
  it('rolls a Saturday back to Friday, because the market never opens that day', () => {
    // 2026-10-03 is a Saturday; 15:00Z is 11:00 in New York (EDT), still Saturday there.
    freezeAt('2026-10-03T15:00:00Z');
    expect(getCurrentTradingSessionDate('America/New_York')).toBe('2026-10-02');
  });

  it('leaves Sunday alone: 6pm Sunday is already the week open', () => {
    freezeAt('2026-10-04T20:00:00Z');
    expect(getCurrentTradingSessionDate('America/New_York')).toBe('2026-10-04');
  });

  it('leaves an ordinary weekday alone', () => {
    freezeAt('2026-09-30T15:00:00Z'); // Wednesday
    expect(getCurrentTradingSessionDate('America/New_York')).toBe('2026-09-30');
  });
});
