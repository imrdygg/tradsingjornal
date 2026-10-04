import { describe, it, expect } from 'vitest';
import type { Instrument, LevelTouch, MarkedLevel } from '../../../types';
import {
  buildEdgeCurve,
  buildSessionCoverage,
  buildSymbolCoverage,
  buildTouchTimeline,
} from '../level-charts';

const TZ = 'America/New_York';

const INSTRUMENTS = [
  { id: 'mes', symbol: 'MES' },
  { id: 'mnq', symbol: 'MNQ' },
] as Instrument[];

function marked(over: Partial<MarkedLevel> = {}): MarkedLevel {
  return {
    id: 'l',
    userId: 'u',
    tradingDayId: 'd',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    kind: 'resistance',
    price: 100,
    zonePoints: 2,
    session: 'Overnight',
    createdAt: '2026-09-28T02:00:00Z',
    updatedAt: '2026-09-28T02:00:00Z',
    ...over,
  };
}

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
    touchedAt: '2026-09-28T02:00:00Z',
    session: 'Overnight',
    outcome: 'watching',
    checks: 1,
    createdAt: '2026-09-28T02:00:00Z',
    updatedAt: '2026-09-28T02:00:00Z',
    ...over,
  };
}

describe('buildSymbolCoverage', () => {
  it('reads tested, never-touched and still-open lines per contract', () => {
    const levels = [
      marked({ id: 'a', instrumentId: 'mes' }),
      marked({ id: 'b', instrumentId: 'mes', resolution: 'never-touched' }),
      marked({ id: 'c', instrumentId: 'mes' }),
      marked({ id: 'x', instrumentId: 'mnq' }),
    ];
    const touches = [touch({ id: 't1', levelId: 'a', outcome: 'never-returned' })];

    const rows = buildSymbolCoverage(levels, touches, INSTRUMENTS);
    expect(rows.map((row) => row.symbol)).toEqual(['MES', 'MNQ']);

    const mes = rows[0];
    expect(mes.marked).toBe(3);
    expect(mes.tested).toBe(1);
    expect(mes.neverTouched).toBe(1);
    expect(mes.open).toBe(1);
    expect(mes.testRate).toBeCloseTo(33.3, 1);
  });

  it('drops a voided line from the count entirely', () => {
    const rows = buildSymbolCoverage(
      [marked({ id: 'a', resolution: 'void' }), marked({ id: 'b' })],
      [],
      INSTRUMENTS
    );
    expect(rows[0].marked).toBe(1);
  });
});

describe('buildEdgeCurve', () => {
  it('accumulates the hold rate over decided touches, oldest first', () => {
    const touches = [
      touch({ id: 'c', outcome: 'returned', touchedAt: '2026-09-30T02:00:00Z', tradeDate: '2026-09-30' }),
      touch({ id: 'a', outcome: 'never-returned', touchedAt: '2026-09-28T02:00:00Z', tradeDate: '2026-09-28' }),
      touch({ id: 'b', outcome: 'never-returned', touchedAt: '2026-09-29T02:00:00Z', tradeDate: '2026-09-29' }),
    ];

    const points = buildEdgeCurve(touches);
    expect(points.map((p) => p.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
    expect(points.map((p) => p.holdRate)).toEqual([100, 100, 66.7]);
    expect(points.map((p) => p.decided)).toEqual([1, 2, 3]);
  });

  it('ignores touches with no answer and invalid ones', () => {
    const points = buildEdgeCurve([
      touch({ id: 'a', outcome: 'watching' }),
      touch({ id: 'b', outcome: 'invalid' }),
    ]);
    expect(points).toEqual([]);
  });
});

describe('buildTouchTimeline', () => {
  it('skips invalid touches and unreadable prices, and sorts by time', () => {
    const points = buildTouchTimeline(
      [
        touch({ id: 'late', touchedAt: '2026-09-28T14:00:00Z', price: 105 }),
        touch({ id: 'bad', outcome: 'invalid' }),
        touch({ id: 'noprice', price: Number.NaN }),
        touch({ id: 'early', touchedAt: '2026-09-28T02:00:00Z', price: 100, outcome: 'never-returned' }),
      ],
      TZ
    );

    expect(points.map((p) => p.id)).toEqual(['early', 'late']);
    // 02:00Z is 22:00 the previous evening in New York.
    expect(points[0].time).toBe('22:00');
    expect(points[0].date).toBe('2026-09-28');
    // 14:00Z is 10:00 in New York.
    expect(points[1].time).toBe('10:00');
  });
});

describe('buildSessionCoverage', () => {
  it('counts marked and reached lines per session, oldest first', () => {
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-28', resolution: 'never-touched' }),
      marked({ id: 'c', tradeDate: '2026-09-29' }),
    ];
    const touches = [touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28' })];

    const rows = buildSessionCoverage(levels, touches);
    expect(rows.map((row) => row.date)).toEqual(['2026-09-28', '2026-09-29']);
    expect(rows[0]).toMatchObject({ marked: 2, tested: 1, untested: 1, neverTouched: 1 });
    expect(rows[1]).toMatchObject({ marked: 1, tested: 0, untested: 1 });
  });

  it('caps the number of sessions and drops voided lines', () => {
    const levels = [
      marked({ id: 'v', tradeDate: '2026-09-27', resolution: 'void' }),
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-29' }),
    ];
    const rows = buildSessionCoverage(levels, [], 1);
    expect(rows.map((row) => row.date)).toEqual(['2026-09-29']);
  });
});
