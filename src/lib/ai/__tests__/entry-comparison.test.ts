import { describe, it, expect } from 'vitest';
import {
  compareEntry,
  groupComparisons,
  isThinSample,
  summariseComparisonsByDay,
  summariseEntryComparisons,
  traderPriceEdge,
  verdictLabel,
  MIN_DIRECTIONAL_SAMPLE,
} from '../entry-comparison';
import type { CoachEntryCall, Trade } from '../../../types';

/**
 * The comparison is the honest half of the feature: the coach commits to a side at the
 * moment of entry, and this reports where the two differed. Because it decides what the
 * trader sees as "the coach agreed", the sign conventions and the missing-call case are
 * the things worth pinning down.
 */

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    userId: 'u1',
    tradingDayId: 'd1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 7740,
    initialStop: 7730,
    entryTime: '2026-09-18T13:30:00.000Z',
    session: 'Regular Session',
    initialRisk: 50,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'open',
    createdAt: '2026-09-18T13:30:00.000Z',
    updatedAt: '2026-09-18T13:30:00.000Z',
    ...overrides,
  };
}

function call(overrides: Partial<CoachEntryCall> = {}): CoachEntryCall {
  return {
    direction: 'long',
    entry: 7745,
    stop: 7735,
    target: 7765,
    rationale: 'Held above the prior close.',
    marketPrice: 7744,
    createdAt: '2026-09-18T13:31:00.000Z',
    ...overrides,
  };
}

describe('traderPriceEdge', () => {
  it('counts a lower fill as better for a long', () => {
    expect(traderPriceEdge('long', 7740, 7745)).toBe(5);
    expect(traderPriceEdge('long', 7750, 7745)).toBe(-5);
  });

  it('counts a higher fill as better for a short', () => {
    expect(traderPriceEdge('short', 7750, 7745)).toBe(5);
    expect(traderPriceEdge('short', 7740, 7745)).toBe(-5);
  });

  it('has no edge to report when the coach gave no level', () => {
    expect(traderPriceEdge('long', 7740, null)).toBeNull();
  });
});

describe('compareEntry', () => {
  it('reports nothing for a trade the coach never called', () => {
    expect(compareEntry(trade())).toBeNull();
  });

  it('ignores a malformed stored call rather than rendering a hole', () => {
    const broken = trade({ coachCall: { direction: 'long' } as unknown as CoachEntryCall });
    expect(compareEntry(broken)).toBeNull();
  });

  it('agrees when the coach named the same side', () => {
    const comparison = compareEntry(trade({ coachCall: call() }));
    expect(comparison?.verdict).toBe('agreed');
    expect(comparison?.coachDirection).toBe('long');
    expect(comparison?.priceEdge).toBe(5);
  });

  it('is opposed when the coach named the other side', () => {
    const comparison = compareEntry(
      trade({ direction: 'long', coachCall: call({ direction: 'short', entry: 7750 }) })
    );
    expect(comparison?.verdict).toBe('opposed');
    // The trader went long at 7740 while the coach wanted the short from 7750, so the
    // trader's long filled 10 points below the level the coach named.
    expect(comparison?.priceEdge).toBe(10);
  });

  it('is its own verdict when the coach would have stood aside', () => {
    const comparison = compareEntry(
      trade({ coachCall: call({ direction: 'flat', entry: null, stop: null, target: null }) })
    );
    expect(comparison?.verdict).toBe('coach-flat');
    expect(comparison?.coachEntry).toBeNull();
    expect(comparison?.priceEdge).toBeNull();
  });
});

describe('summariseEntryComparisons', () => {
  it('reports an empty day without inventing a rate', () => {
    const summary = summariseEntryComparisons([trade()]);
    expect(summary.compared).toBe(0);
    expect(summary.agreementRate).toBeNull();
    expect(summary.avgTraderEdgePoints).toBeNull();
    expect(summary.comparisons).toEqual([]);
  });

  it('scores agreement over the calls that took a side', () => {
    const summary = summariseEntryComparisons([
      trade({ id: 'a', coachCall: call() }),
      trade({ id: 'b', direction: 'short', entryPrice: 7760, coachCall: call({ direction: 'short', entry: 7755 }) }),
      trade({ id: 'c', coachCall: call({ direction: 'short' }) }),
      trade({ id: 'd', coachCall: call({ direction: 'flat', entry: null }) }),
    ]);

    expect(summary.compared).toBe(4);
    expect(summary.agreed).toBe(2);
    expect(summary.opposed).toBe(1);
    expect(summary.coachFlat).toBe(1);
    // 2 of the 3 directional calls agreed.
    expect(summary.agreementRate).toBe(67);
  });

  it('averages the trader’s fill advantage across the calls with a level', () => {
    const summary = summariseEntryComparisons([
      trade({ id: 'a', entryPrice: 7740, coachCall: call({ entry: 7745 }) }),
      trade({ id: 'b', entryPrice: 7752, coachCall: call({ entry: 7745 }) }),
    ]);
    // +5 and -7 average to -1.
    expect(summary.avgTraderEdgePoints).toBe(-1);
  });
});

describe('summariseComparisonsByDay', () => {
  const dateOf = (t: Trade) => t.tradingDayId;

  it('groups by day, oldest first, and skips anything without a call or a date', () => {
    const rows = summariseComparisonsByDay(
      [
        trade({ id: 'b', tradingDayId: '2026-09-18', coachCall: call() }),
        trade({ id: 'a', tradingDayId: '2026-09-17', coachCall: call() }),
        trade({ id: 'c', tradingDayId: '2026-09-19' }),
        trade({ id: 'd', tradingDayId: '', coachCall: call() }),
      ],
      dateOf
    );

    expect(rows.map((row) => row.date)).toEqual(['2026-09-17', '2026-09-18']);
    expect(rows[0].compared).toBe(1);
  });

  it('carries the agreement rate forward so a real sample can be read', () => {
    const rows = summariseComparisonsByDay(
      [
        trade({ id: 'a', tradingDayId: '2026-09-17', coachCall: call() }),
        trade({ id: 'b', tradingDayId: '2026-09-18', coachCall: call() }),
        trade({ id: 'c', tradingDayId: '2026-09-18', coachCall: call({ direction: 'short' }) }),
      ],
      dateOf
    );

    // Day one: one of one. Day two: one of two, so two of three overall.
    expect(rows[0].agreementRate).toBe(100);
    expect(rows[0].runningAgreementRate).toBe(100);
    expect(rows[1].agreementRate).toBe(50);
    expect(rows[1].runningAgreementRate).toBe(67);
  });

  it('does not divide by zero on a day the coach only ever stood aside', () => {
    const rows = summariseComparisonsByDay(
      [
        trade({
          id: 'a',
          tradingDayId: '2026-09-18',
          coachCall: call({ direction: 'flat', entry: null }),
        }),
      ],
      dateOf
    );

    expect(rows[0].compared).toBe(1);
    expect(rows[0].coachFlat).toBe(1);
    expect(rows[0].agreementRate).toBeNull();
    expect(rows[0].runningAgreementRate).toBeNull();
  });

  it('reports the day’s average fill edge from the calls that had a level', () => {
    const rows = summariseComparisonsByDay(
      [
        trade({ id: 'a', tradingDayId: '2026-09-18', entryPrice: 7740, coachCall: call({ entry: 7745 }) }),
        trade({
          id: 'b',
          tradingDayId: '2026-09-18',
          entryPrice: 7752,
          coachCall: call({ entry: 7745 }),
        }),
        trade({
          id: 'c',
          tradingDayId: '2026-09-18',
          coachCall: call({ direction: 'flat', entry: null }),
        }),
      ],
      dateOf
    );

    // +5 and -7 average to -1; the flat call contributes nothing to the average.
    expect(rows[0].avgTraderEdgePoints).toBe(-1);
  });
});

describe('groupComparisons', () => {
  const trades = [
    // Breakout: two agreements and one opposition.
    trade({ id: 'a', setupName: 'Breakout', coachCall: call() }),
    trade({ id: 'b', setupName: 'Breakout', coachCall: call() }),
    trade({ id: 'c', setupName: 'Breakout', coachCall: call({ direction: 'short' }) }),
    // Reversal: one stand-aside only, so no rate at all.
    trade({
      id: 'd',
      setupName: 'Reversal',
      coachCall: call({ direction: 'flat', entry: null }),
    }),
  ];

  it('groups by whatever label it is given', () => {
    const bySetup = groupComparisons(trades, (t) => t.setupName ?? null);
    expect(bySetup.map((row) => row.label).sort()).toEqual(['Breakout', 'Reversal']);

    const breakout = bySetup.find((row) => row.label === 'Breakout')!;
    expect(breakout).toMatchObject({
      compared: 3,
      agreed: 2,
      opposed: 1,
      coachFlat: 0,
      agreementRate: 67,
    });

    const reversal = bySetup.find((row) => row.label === 'Reversal')!;
    // A group the coach only ever stood aside in has no agreement rate to report.
    expect(reversal.agreementRate).toBeNull();
    expect(reversal.coachFlat).toBe(1);
  });

  it('puts the groups with the most directional calls first', () => {
    const rows = groupComparisons(trades, (t) => t.setupName ?? null);
    expect(rows[0].label).toBe('Breakout');
  });

  it('skips a trade the coach never called, and one with no label', () => {
    const rows = groupComparisons(
      [
        trade({ id: 'a', setupName: 'Breakout', coachCall: call() }),
        // Called, but never logged against a setup.
        trade({ id: 'b', setupName: undefined, coachCall: call() }),
        // Labelled, but the coach never made a call on it.
        trade({ id: 'c', setupName: 'Breakout' }),
      ],
      (t) => t.setupName ?? null
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].compared).toBe(1);
  });

  it('splits long from short without flipping the sign of the edge', () => {
    const rows = groupComparisons(
      [
        // Long, filled 5 below the coach's level: the better fill, so +5.
        trade({ id: 'a', direction: 'long', entryPrice: 7740, coachCall: call() }),
        // Short, filled 5 above it: also the better fill, so also +5.
        trade({
          id: 'b',
          direction: 'short',
          entryPrice: 7750,
          coachCall: call({ direction: 'short', entry: 7745 }),
        }),
      ],
      (t) => (t.direction === 'long' ? 'Long' : 'Short')
    );

    expect(rows.map((row) => row.label).sort()).toEqual(['Long', 'Short']);
    // Both fills beat the coach's level even though the prices sit on opposite sides of
    // it, which is the whole point of normalising the sign for the side traded.
    expect(rows.map((row) => row.avgTraderEdgePoints)).toEqual([5, 5]);
    expect(rows.map((row) => row.agreementRate)).toEqual([100, 100]);
  });

  it('marks a group too small to read as a thin sample', () => {
    const rows = groupComparisons(
      [
        trade({ id: 'a', setupName: 'Breakout', coachCall: call() }),
        trade({ id: 'b', setupName: 'Breakout', coachCall: call() }),
      ],
      (t) => t.setupName ?? null
    );

    // Two agreements out of two is a 100% that means nothing yet.
    expect(rows[0].agreementRate).toBe(100);
    expect(isThinSample(rows[0])).toBe(true);
    expect(MIN_DIRECTIONAL_SAMPLE).toBe(3);
  });
});

describe('verdictLabel', () => {
  it('names every verdict in the trader’s language', () => {
    expect(verdictLabel('agreed')).toBe('Coach agreed');
    expect(verdictLabel('opposed')).toBe('Coach opposed');
    expect(verdictLabel('coach-flat')).toBe('Coach was flat');
    expect(verdictLabel('no-call')).toBe('No coach call');
  });
});
