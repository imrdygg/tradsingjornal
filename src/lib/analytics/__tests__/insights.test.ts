import { describe, it, expect } from 'vitest';
import type { Trade } from '../../../types';
import { generateDeterministicInsights, MIN_TARGET_SAMPLE } from '../insights';

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

/** A short-of-target trade: a 2R target filled at 1.5R, half an R left behind. */
const shortExit = (id: string) => makeTrade({ id, targetPrice: 6720, exitPrice: 6715 });

const findInsight = (trades: Trade[]) =>
  generateDeterministicInsights(trades, []).find((i) => i.id === 'target-exits-short');

describe('target short-exit insight', () => {
  it('flags a habit of exiting short of the target once the sample is large enough', () => {
    const trades = Array.from({ length: MIN_TARGET_SAMPLE }, (_, i) => shortExit(`t${i}`));
    const insight = findInsight(trades);

    expect(insight).toBeDefined();
    expect(insight!.category).toBe('Discipline');
    expect(insight!.isPositive).toBe(false);
    expect(insight!.sampleSize).toBe(MIN_TARGET_SAMPLE);
    expect(insight!.metricHighlight).toBe('0% hit · -0.50R avg');
    expect(insight!.statement).toContain('0% of the time');
    expect(insight!.statement).toContain('0.50R short');
  });

  it('stays quiet below the minimum sample', () => {
    const trades = Array.from({ length: MIN_TARGET_SAMPLE - 1 }, (_, i) => shortExit(`t${i}`));

    expect(findInsight(trades)).toBeUndefined();
  });

  it('stays quiet when exits reach the target on average', () => {
    const trades = Array.from({ length: MIN_TARGET_SAMPLE }, (_, i) =>
      makeTrade({ id: `t${i}`, targetPrice: 6720, exitPrice: 6725 })
    );

    expect(findInsight(trades)).toBeUndefined();
  });

  it('ignores trades with no target or an invented stop', () => {
    const trades = [
      ...Array.from({ length: MIN_TARGET_SAMPLE }, (_, i) => shortExit(`t${i}`)),
      makeTrade({ id: 'no-target', exitPrice: 6715 }),
      makeTrade({
        id: 'assumed',
        source: 'tradovate_csv',
        riskSource: 'assumed',
        targetPrice: 6720,
        exitPrice: 6705,
      }),
    ];
    const insight = findInsight(trades);

    // Only the five real trades with a target are measured.
    expect(insight!.sampleSize).toBe(MIN_TARGET_SAMPLE);
  });
});
