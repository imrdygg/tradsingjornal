import { describe, it, expect } from 'vitest';
import type { Trade } from '../../../types';
import {
  TARGET_R_TOLERANCE,
  THIN_TARGET_SAMPLE,
  compareTargetOnTrade,
  rMultipleAtPrice,
  summariseTargetExits,
  summariseTargetExitsBySetup,
  summariseTargetHitTrend,
} from '../target-exits';

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 'trade-1',
    userId: 'user-1',
    tradingDayId: 'day-1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 6700,
    initialStop: 6690,
    entryTime: '2026-09-21T14:00:00.000Z',
    session: 'Regular Session',
    initialRisk: 50,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'closed',
    createdAt: '2026-09-21T14:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  };
}

describe('rMultipleAtPrice', () => {
  it('measures a long in R off the stop distance', () => {
    // 10-point stop; a fill 20 points up is +2R.
    expect(rMultipleAtPrice(makeTrade({}), 6720)).toBe(2);
  });

  it('measures a short the other way round', () => {
    const short = makeTrade({ direction: 'short', entryPrice: 6700, initialStop: 6710 });
    expect(rMultipleAtPrice(short, 6680)).toBe(2);
    expect(rMultipleAtPrice(short, 6710)).toBe(-1);
  });

  it('returns null when the stop cannot define an R', () => {
    expect(rMultipleAtPrice(makeTrade({ initialStop: 6700 }), 6720)).toBeNull();
    expect(
      rMultipleAtPrice(makeTrade({ direction: 'long', initialStop: 6710, entryPrice: 6700 }), 6720)
    ).toBeNull();
  });
});

describe('compareTargetOnTrade', () => {
  it('reports the target R and the gap once the trade has closed', () => {
    const comparison = compareTargetOnTrade(makeTrade({ targetPrice: 6720, exitPrice: 6715 }));

    expect(comparison).toEqual({ targetR: 2, realizedR: 1.5, gapR: -0.5, hit: false });
  });

  it('leaves the realized side null while the trade is open', () => {
    const comparison = compareTargetOnTrade(
      makeTrade({ status: 'open', exitPrice: undefined, targetPrice: 6720 })
    );

    expect(comparison).toEqual({ targetR: 2, realizedR: null, gapR: null, hit: null });
  });

  it('returns null without a target or a usable stop', () => {
    expect(compareTargetOnTrade(makeTrade({ exitPrice: 6715 }))).toBeNull();
    expect(
      compareTargetOnTrade(makeTrade({ targetPrice: 6720, initialStop: 6700 }))
    ).toBeNull();
  });
});

describe('summariseTargetExits', () => {
  it('compares the planned target R against the realized R', () => {
    const summary = summariseTargetExits([
      makeTrade({ targetPrice: 6720, exitPrice: 6715 }),
    ]);

    expect(summary.measured).toBe(1);
    expect(summary.rows[0].targetR).toBe(2);
    expect(summary.rows[0].realizedR).toBe(1.5);
    expect(summary.rows[0].gapR).toBe(-0.5);
    expect(summary.rows[0].hit).toBe(false);
    expect(summary.hitPct).toBe(0);
    expect(summary.avgShortR).toBe(0.5);
    expect(summary.worstShortR).toBe(0.5);
  });

  it('counts an exit beyond the target as a hit and reports the extra R', () => {
    const summary = summariseTargetExits([
      makeTrade({ targetPrice: 6720, exitPrice: 6740 }),
    ]);

    expect(summary.hit).toBe(1);
    expect(summary.rows[0].gapR).toBe(2);
    expect(summary.avgBeyondR).toBe(2);
    expect(summary.avgShortR).toBeNull();
    expect(summary.worstShortR).toBeNull();
    expect(summary.hitPct).toBe(100);
  });

  it('treats an exit inside the tolerance of the target as reached', () => {
    const target = 6720;
    // 0.004R short, which is float noise rather than a real miss.
    const exit = 6720 - 0.004 * 10;
    const summary = summariseTargetExits([makeTrade({ targetPrice: target, exitPrice: exit })]);
    expect(TARGET_R_TOLERANCE).toBeGreaterThan(0.004);
    expect(summary.rows[0].hit).toBe(true);
  });

  it('summarises the averages across several trades', () => {
    const summary = summariseTargetExits([
      makeTrade({ id: 'a', targetPrice: 6720, exitPrice: 6730, entryTime: '2026-09-21T14:00:00.000Z' }),
      makeTrade({ id: 'b', targetPrice: 6720, exitPrice: 6705, entryTime: '2026-09-21T16:00:00.000Z' }),
    ]);

    expect(summary.measured).toBe(2);
    expect(summary.avgTargetR).toBe(2);
    expect(summary.avgRealizedR).toBe(1.75);
    expect(summary.avgGapR).toBe(-0.25);
    expect(summary.hit).toBe(1);
    expect(summary.hitPct).toBe(50);
  });

  it('sorts the rows newest first', () => {
    const summary = summariseTargetExits([
      makeTrade({ id: 'old', targetPrice: 6720, exitPrice: 6720, entryTime: '2026-09-18T14:00:00.000Z' }),
      makeTrade({ id: 'new', targetPrice: 6720, exitPrice: 6720, entryTime: '2026-09-21T14:00:00.000Z' }),
    ]);

    expect(summary.rows.map((row) => row.trade.id)).toEqual(['new', 'old']);
  });

  it('sets aside a trade whose stop was invented', () => {
    const summary = summariseTargetExits([
      makeTrade({ source: 'tradovate_csv', riskSource: 'assumed', targetPrice: 6720, exitPrice: 6720 }),
    ]);

    expect(summary.measured).toBe(0);
    expect(summary.assumed).toBe(1);
    expect(summary.hitPct).toBeNull();
  });

  it('separates open targets from closed trades with no target', () => {
    const summary = summariseTargetExits([
      makeTrade({ id: 'open', status: 'open', exitPrice: undefined, targetPrice: 6720 }),
      makeTrade({ id: 'no-target', exitPrice: 6705 }),
    ]);

    expect(summary.measured).toBe(0);
    expect(summary.openWithTarget).toBe(1);
    expect(summary.noTarget).toBe(1);
  });

  it('returns empty figures when there is nothing to measure', () => {
    const summary = summariseTargetExits([]);

    expect(summary.measured).toBe(0);
    expect(summary.hitPct).toBeNull();
    expect(summary.avgTargetR).toBe(0);
    expect(summary.avgBeyondR).toBeNull();
    expect(summary.avgShortR).toBeNull();
    expect(summary.worstShortR).toBeNull();
    expect(summary.rows).toEqual([]);
  });
});

describe('summariseTargetExitsBySetup', () => {
  it('breaks the hit rate down per setup', () => {
    const rows = summariseTargetExitsBySetup([
      makeTrade({ id: 'e1', setupName: 'Engulfing', targetPrice: 6720, exitPrice: 6720 }),
      makeTrade({ id: 'e2', setupName: 'Engulfing', targetPrice: 6720, exitPrice: 6705 }),
      makeTrade({ id: 'b1', setupName: 'Breakout', targetPrice: 6720, exitPrice: 6720 }),
    ]);

    const engulfing = rows.find((row) => row.setupName === 'Engulfing')!;
    expect(engulfing.measured).toBe(2);
    expect(engulfing.hit).toBe(1);
    expect(engulfing.hitPct).toBe(50);
    expect(engulfing.avgGapR).toBe(-0.75);
    expect(engulfing.thin).toBe(true);

    const breakout = rows.find((row) => row.setupName === 'Breakout')!;
    expect(breakout.hitPct).toBe(100);
    expect(breakout.avgGapR).toBe(0);
  });

  it('sorts by sample size, then hit rate', () => {
    const rows = summariseTargetExitsBySetup([
      makeTrade({ id: 'a1', setupName: 'Thin', targetPrice: 6720, exitPrice: 6720 }),
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade({ id: `w${i}`, setupName: 'Wide', targetPrice: 6720, exitPrice: 6705 })
      ),
    ]);

    expect(rows.map((row) => row.setupName)).toEqual(['Wide', 'Thin']);
    expect(rows[0].thin).toBe(false);
  });

  it('labels trades with no setup instead of dropping them', () => {
    const rows = summariseTargetExitsBySetup([
      makeTrade({ id: 'n1', targetPrice: 6720, exitPrice: 6720 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].setupName).toBe('No setup recorded');
  });

  it('returns nothing when no trade has a measurable target', () => {
    expect(summariseTargetExitsBySetup([makeTrade({ exitPrice: 6715 })])).toEqual([]);
    expect(THIN_TARGET_SAMPLE).toBeGreaterThan(1);
  });
});

describe('summariseTargetHitTrend', () => {
  const dateOf = (trade: Trade) => trade.entryTime.slice(0, 10);

  it('buckets the hit rate by Monday-started week, oldest first', () => {
    const trend = summariseTargetHitTrend(
      [
        // Week of Mon 14 Sep: one reached, one short.
        makeTrade({
          id: 'a',
          targetPrice: 6720,
          exitPrice: 6720,
          entryTime: '2026-09-15T14:00:00.000Z',
        }),
        makeTrade({
          id: 'b',
          targetPrice: 6720,
          exitPrice: 6715,
          entryTime: '2026-09-16T14:00:00.000Z',
        }),
        // Week of Mon 21 Sep: reached.
        makeTrade({
          id: 'c',
          targetPrice: 6720,
          exitPrice: 6725,
          entryTime: '2026-09-22T14:00:00.000Z',
        }),
      ],
      dateOf
    );

    expect(trend.map((point) => point.bucketKey)).toEqual(['2026-09-14', '2026-09-21']);
    expect(trend[0]).toMatchObject({ bucket: 'Sep 14', measured: 2, hit: 1, hitPct: 50 });
    expect(trend[0].avgGapR).toBe(-0.25);
    expect(trend[1]).toMatchObject({ bucket: 'Sep 21', measured: 1, hit: 1, hitPct: 100 });
  });

  it('skips trades whose date is missing or unusable', () => {
    const trend = summariseTargetHitTrend(
      [
        makeTrade({ id: 'a', targetPrice: 6720, exitPrice: 6720, entryTime: 'not-a-date' }),
        makeTrade({ id: 'b', targetPrice: 6720, exitPrice: 6720 }),
      ],
      (trade) => (trade.id === 'a' ? 'not-a-date' : null)
    );

    expect(trend).toEqual([]);
  });
});
