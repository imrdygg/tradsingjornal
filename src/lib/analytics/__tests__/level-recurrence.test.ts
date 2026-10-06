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

/**
 * The price lines, drawn: one row per price that has been touched at all.
 *
 * The recurrence read above deliberately reports only lines reached on more than one day, because
 * one day is the ordinary case. A chart of the prices has to carry those too — the trader's
 * question is "does 7791.25 hold", and a line touched once still has an answer pending on it.
 */
describe('summarizeLevelRecurrence — every price line', () => {
  /** One touch a day for five days, on the same price: enough sample to carry a rate. */
  const fiveDays = (price: number, outcome: 'returned' | 'never-returned', held: number) =>
    ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((date, index) =>
      touch({
        id: `${price}-${index}`,
        price,
        tradeDate: date,
        touchedAt: `${date}T13:00:00Z`,
        outcome: index < held ? 'never-returned' : outcome,
      })
    );

  it('lists a line touched once, which the recurrence read on its own would leave out', () => {
    const touches = [
      touch({ id: 'a', price: 100, touchedAt: '2026-09-28T13:00:00Z' }),
      touch({
        id: 'b',
        price: 101,
        tradeDate: '2026-09-29',
        touchedAt: '2026-09-29T13:00:00Z',
        outcome: 'never-returned',
      }),
    ];

    const report = summarizeLevelRecurrence(touches, 'America/New_York', DEFAULT_INSTRUMENTS);
    expect(report.repeatedLevels).toHaveLength(0);
    expect(report.lineEdges.map((row) => row.price).sort()).toEqual([100, 101]);
  });

  it('gathers every touch of one price into that line, and rates it once there is a sample', () => {
    const report = summarizeLevelRecurrence(
      fiveDays(7791.25, 'returned', 4),
      'America/New_York',
      DEFAULT_INSTRUMENTS
    );

    expect(report.lineEdges).toHaveLength(1);
    const [line] = report.lineEdges;
    expect(line.price).toBe(7791.25);
    expect(line.days).toBe(5);
    expect(line.touches).toBe(5);
    expect(line.weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    expect(line.stats.decided).toBe(5);
    expect(line.stats.holdRate).toBe(80);
    expect(line.stats.enoughData).toBe(true);
  });

  it('leads with the lines a rate may be read from, then the best-evidenced thin ones', () => {
    const touches = [
      ...fiveDays(100, 'never-returned', 5),
      // Thin, but two decisions behind it.
      touch({ id: 'a1', price: 200, touchedAt: '2026-09-28T14:00:00Z', outcome: 'never-returned' }),
      touch({ id: 'a2', price: 200, touchedAt: '2026-09-28T15:00:00Z', outcome: 'returned' }),
      // Thin, and nothing decided at all.
      touch({ id: 'b1', price: 300, touchedAt: '2026-09-28T16:00:00Z', outcome: 'watching' }),
    ];

    const report = summarizeLevelRecurrence(touches, 'America/New_York', DEFAULT_INSTRUMENTS);
    expect(report.lineEdges.map((row) => row.price)).toEqual([100, 200, 300]);
    expect(report.lineEdges[0].stats.holdRate).toBe(100);
    expect(report.lineEdges[1].stats.enoughData).toBe(false);
    expect(report.lineEdges[1].stats.decided).toBe(2);
    expect(report.lineEdges[2].stats.decided).toBe(0);
  });

  it('keeps a line whose touches were set aside out of the chart', () => {
    const report = summarizeLevelRecurrence(
      [touch({ id: 'v', price: 400, outcome: 'invalid' })],
      'America/New_York',
      DEFAULT_INSTRUMENTS
    );
    expect(report.lineEdges).toHaveLength(0);
  });
});
