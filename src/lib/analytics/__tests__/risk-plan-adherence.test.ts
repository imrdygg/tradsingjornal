import { describe, it, expect } from 'vitest';
import type { Trade } from '../../../types';
import {
  RISK_PLAN_TOLERANCE,
  summariseRiskPlanAdherence,
  summariseSlotTrends,
} from '../risk-plan-adherence';
import { DEFAULT_RISK_TIER_AMOUNTS } from '../../trading/risk-tiers';

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
    initialRisk: 25,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'closed',
    createdAt: '2026-09-21T14:00:00.000Z',
    updatedAt: '2026-09-21T14:00:00.000Z',
    ...overrides,
  };
}

const amounts = DEFAULT_RISK_TIER_AMOUNTS;

describe('summariseRiskPlanAdherence', () => {
  it('counts a trade that risked no more than its slot as within', () => {
    // A $25 slot on a 4-point MES stop can only be taken as one contract risking $20.
    const adherence = summariseRiskPlanAdherence(
      [makeTrade({ riskTier: 1, plannedRisk: 25, initialRisk: 20 })],
      amounts
    );

    expect(adherence.measured).toBe(1);
    expect(adherence.within).toBe(1);
    expect(adherence.over).toBe(0);
    expect(adherence.withinPct).toBe(100);
    expect(adherence.worstOver).toBeNull();
  });

  it('counts a trade that risked more than its slot as over, and remembers by how much', () => {
    const adherence = summariseRiskPlanAdherence(
      [
        makeTrade({ id: 'a', riskTier: 2, plannedRisk: 50, initialRisk: 75 }),
        makeTrade({ id: 'b', riskTier: 2, plannedRisk: 50, initialRisk: 100 }),
      ],
      amounts
    );

    expect(adherence.measured).toBe(2);
    expect(adherence.over).toBe(2);
    expect(adherence.within).toBe(0);
    expect(adherence.withinPct).toBe(0);
    expect(adherence.worstOver).toBe(50);
    expect(adherence.avgOverRisk).toBe(37.5);
  });

  it('always reports all five slots, in ladder order', () => {
    const adherence = summariseRiskPlanAdherence(
      [makeTrade({ riskTier: 3, plannedRisk: 75, initialRisk: 75 })],
      amounts
    );

    expect(adherence.slots.map((row) => row.label)).toEqual(['#1', '#2', '#3', '#4', 'Custom']);
    expect(adherence.slots[2]).toMatchObject({ target: 75, trades: 1, within: 1, over: 0 });
    expect(adherence.slots[0].trades).toBe(0);
  });

  it('measures the custom slot against each trade’s own amount', () => {
    const adherence = summariseRiskPlanAdherence(
      [
        makeTrade({ id: 'a', riskTier: null, plannedRisk: 40, initialRisk: 40 }),
        makeTrade({ id: 'b', riskTier: null, plannedRisk: 40, initialRisk: 60 }),
      ],
      amounts
    );

    const custom = adherence.slots[4];
    expect(custom.target).toBeNull();
    expect(custom.trades).toBe(2);
    expect(custom.within).toBe(1);
    expect(custom.over).toBe(1);
    expect(custom.worstOver).toBe(20);
  });

  it('sets aside trades with no slot or no target instead of counting them as breaks', () => {
    const adherence = summariseRiskPlanAdherence(
      [
        makeTrade({ id: 'imported' }), // no riskTier at all
        makeTrade({ id: 'noslot', riskTier: 2 }), // slot but no amount recorded
        makeTrade({ id: 'ok', riskTier: 1, plannedRisk: 25, initialRisk: 25 }),
      ],
      amounts
    );

    expect(adherence.measured).toBe(1);
    expect(adherence.unrecorded).toBe(2);
  });

  it('never judges a trade whose stop the app invented', () => {
    const adherence = summariseRiskPlanAdherence(
      [
        makeTrade({
          id: 'csv',
          riskTier: 2,
          plannedRisk: 50,
          initialRisk: 500,
          source: 'tradovate_csv',
        }),
      ],
      amounts
    );

    expect(adherence.measured).toBe(0);
    expect(adherence.assumed).toBe(1);
    expect(adherence.withinPct).toBeNull();
    expect(adherence.over).toBe(0);
  });

  it('treats a difference smaller than a cent as float noise, not a breach', () => {
    const adherence = summariseRiskPlanAdherence(
      [makeTrade({ riskTier: 1, plannedRisk: 25, initialRisk: 25 + RISK_PLAN_TOLERANCE / 2 })],
      amounts
    );

    expect(adherence.within).toBe(1);
    expect(adherence.over).toBe(0);
  });

  it('reports nothing measured for an empty journal', () => {
    const adherence = summariseRiskPlanAdherence([], amounts);

    expect(adherence.measured).toBe(0);
    expect(adherence.withinPct).toBeNull();
    expect(adherence.avgOverRisk).toBeNull();
    expect(adherence.worstOver).toBeNull();
    expect(adherence.currentStreak).toBe(0);
    expect(adherence.longestStreak).toBe(0);
    expect(adherence.slots).toHaveLength(5);
  });
});

const byEntryDate = (trade: Trade) => (trade.entryTime ? trade.entryTime.slice(0, 10) : null);

describe('summariseSlotTrends', () => {
  /** 2026-09-15 is a Tuesday, so its week starts Monday 2026-09-14. */
  const tue = '2026-09-15T14:00:00.000Z';
  const thu = '2026-09-17T14:00:00.000Z';
  /** 2026-09-21 is itself a Monday. */
  const mon = '2026-09-21T14:00:00.000Z';

  it('groups the whole week under its Monday and labels it', () => {
    const trend = summariseSlotTrends(
      [
        makeTrade({ id: 'a', entryTime: tue, riskTier: 1, plannedRisk: 25, initialRisk: 20 }),
        makeTrade({ id: 'b', entryTime: thu, riskTier: 1, plannedRisk: 25, initialRisk: 20 }),
        makeTrade({ id: 'c', entryTime: mon, riskTier: 1, plannedRisk: 25, initialRisk: 20 }),
      ],
      byEntryDate
    );

    expect(trend.points.map((point) => point.bucketKey)).toEqual(['2026-09-14', '2026-09-21']);
    expect(trend.points.map((point) => point.bucket)).toEqual(['Sep 14', 'Sep 21']);
    expect(trend.points[0].counts.s1).toBe(2);
  });

  it('rates each slot on its own, leaving unused slots empty rather than zero', () => {
    const trend = summariseSlotTrends(
      [
        makeTrade({ id: 'a', entryTime: tue, riskTier: 1, plannedRisk: 25, initialRisk: 20 }),
        makeTrade({ id: 'b', entryTime: thu, riskTier: 1, plannedRisk: 25, initialRisk: 75 }),
        makeTrade({ id: 'c', entryTime: thu, riskTier: 2, plannedRisk: 50, initialRisk: 50 }),
      ],
      byEntryDate
    );

    const week = trend.points[0];
    expect(week.rates.s1).toBe(50);
    expect(week.counts.s1).toBe(2);
    expect(week.rates.s2).toBe(100);
    expect(week.counts.s2).toBe(1);
    // Never used that week: no line point at all.
    expect(week.rates.s3).toBeNull();
    expect(week.counts.s3).toBe(0);
    expect(week.rates.custom).toBeNull();
  });

  it('leaves out trades that cannot be judged', () => {
    const trend = summariseSlotTrends(
      [
        makeTrade({ id: 'no-slot', entryTime: tue }),
        makeTrade({
          id: 'csv',
          entryTime: tue,
          riskTier: 1,
          plannedRisk: 25,
          initialRisk: 900,
          source: 'tradovate_csv',
        }),
        makeTrade({ id: 'ok', entryTime: tue, riskTier: 1, plannedRisk: 25, initialRisk: 20 }),
      ],
      byEntryDate
    );

    expect(trend.points).toHaveLength(1);
    expect(trend.points[0].counts.s1).toBe(1);
  });

  it('skips a trade whose date cannot be read', () => {
    const trend = summariseSlotTrends(
      [makeTrade({ id: 'a', entryTime: '', riskTier: 1, plannedRisk: 25, initialRisk: 20 })],
      () => null
    );

    expect(trend.points).toEqual([]);
    expect(trend.slotKeys).toEqual(['s1', 's2', 's3', 's4', 'custom']);
    expect(trend.slotLabels).toEqual(['#1', '#2', '#3', '#4', 'Custom']);
  });
});

describe('streaks', () => {
  // Distinct entry times so the run has a real order to count along.
  const at = (minute: number) => `2026-09-21T14:${String(minute).padStart(2, '0')}:00.000Z`;
  const within = (id: string, minute: number, risk = 25, planned = 25) =>
    makeTrade({
      id,
      entryTime: at(minute),
      riskTier: 1,
      plannedRisk: planned,
      initialRisk: risk,
    });
  const over = (id: string, minute: number) =>
    makeTrade({ id, entryTime: at(minute), riskTier: 1, plannedRisk: 25, initialRisk: 75 });

  it('counts the run of most recent trades that stayed within their slot', () => {
    const adherence = summariseRiskPlanAdherence(
      [within('a', 0), within('b', 5), within('c', 10)],
      amounts
    );

    expect(adherence.currentStreak).toBe(3);
    expect(adherence.longestStreak).toBe(3);
  });

  it('resets the current streak on a breach and keeps the best run', () => {
    // within, within, over, within → the newest run is 1; the best was 2.
    const adherence = summariseRiskPlanAdherence(
      [within('a', 0), within('b', 5), over('c', 10), within('d', 15)],
      amounts
    );

    expect(adherence.currentStreak).toBe(1);
    expect(adherence.longestStreak).toBe(2);
  });

  it('has no current streak once the newest trade breaks it', () => {
    const adherence = summariseRiskPlanAdherence(
      [within('a', 0), within('b', 5), over('c', 10)],
      amounts
    );

    expect(adherence.currentStreak).toBe(0);
    expect(adherence.longestStreak).toBe(2);
  });

  it('lets unmeasurable trades neither extend nor break a streak', () => {
    const adherence = summariseRiskPlanAdherence(
      [
        within('a', 0),
        // No slot at all, sitting between two measurable trades.
        makeTrade({ id: 'unsorted', entryTime: at(5) }),
        // An invented stop, which cannot be judged either way.
        makeTrade({
          id: 'csv',
          entryTime: at(10),
          riskTier: 1,
          plannedRisk: 25,
          initialRisk: 900,
          source: 'tradovate_csv',
        }),
        within('b', 15),
      ],
      amounts
    );

    expect(adherence.measured).toBe(2);
    expect(adherence.currentStreak).toBe(2);
    expect(adherence.longestStreak).toBe(2);
  });
});
