import { describe, it, expect } from 'vitest';
import { LevelTouch } from '../../../types';
import { summarizeLevelRecurrence } from '../level-recurrence';
import { DEFAULT_INSTRUMENTS } from '../../trading/instruments';

function touch(over: Partial<LevelTouch> = {}): LevelTouch {
  return {
    id: 't',
    userId: 'u',
    tradingDayId: 'd',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    kind: 'resistance',
    price: 100,
    zonePoints: 2,
    touchedAt: '2026-09-28T13:00:00Z',
    session: 'Regular Session',
    outcome: 'watching',
    checks: 1,
    createdAt: '2026-09-28T13:00:00Z',
    updatedAt: '2026-09-28T13:00:00Z',
    ...over,
  };
}

describe('summarizeLevelRecurrence — weekday read', () => {
  it('leaves Saturday out, because the market is closed and no touch can print on it', () => {
    // 2026-09-28 is a Monday; 2026-10-03 is a Saturday.
    const touches = [
      touch({ id: 'mon', touchedAt: '2026-09-28T13:00:00Z' }),
      touch({ id: 'sat', tradeDate: '2026-10-03', touchedAt: '2026-10-03T13:00:00Z' }),
    ];

    const report = summarizeLevelRecurrence(touches, 'America/New_York', DEFAULT_INSTRUMENTS);
    const labels = report.byWeekday.map((bucket) => bucket.label);
    expect(labels).toContain('Mon');
    expect(labels).not.toContain('Sat');
  });
});
