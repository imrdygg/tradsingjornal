import { describe, it, expect } from 'vitest';
import { Trade } from '../../../types';
import { buildPositionGroups, positionKey, findPositionGroup } from '../position-groups';

function makeTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 't1',
    userId: 'u1',
    tradingDayId: 'd1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 7730,
    initialStop: 7710,
    entryTime: '2026-09-18T13:30:00.000Z',
    session: 'Regular Session',
    initialRisk: 100,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'open',
    createdAt: '2026-09-18T13:30:00.000Z',
    updatedAt: '2026-09-18T13:30:00.000Z',
    ...overrides,
  };
}

describe('positionKey', () => {
  it('uses positionId when present, otherwise the trade id', () => {
    expect(positionKey({ id: 'a', positionId: undefined })).toBe('a');
    expect(positionKey({ id: 'b', positionId: 'a' })).toBe('a');
  });
});

describe('buildPositionGroups', () => {
  it('treats unlinked trades as their own single-leg positions', () => {
    const groups = buildPositionGroups([
      makeTrade({ id: 'a' }),
      makeTrade({ id: 'b', entryPrice: 7700 }),
    ]);

    expect(groups.size).toBe(2);
    expect(groups.get('a')!.legCount).toBe(1);
    expect(groups.get('a')!.averageEntry).toBe(7730);
  });

  it('blends a scale-in: combined size and weighted average entry', () => {
    const original = makeTrade({ id: 'leg-1', contracts: 1, entryPrice: 7730 });
    const add = makeTrade({
      id: 'leg-2',
      contracts: 5,
      entryPrice: 7700,
      positionId: 'leg-1',
      entryTime: '2026-09-18T13:45:00.000Z',
    });

    const groups = buildPositionGroups([original, add]);
    expect(groups.size).toBe(1);

    const group = groups.get('leg-1')!;
    expect(group.legCount).toBe(2);
    expect(group.totalContracts).toBe(6);
    // (1*7730 + 5*7700) / 6 = 7705
    expect(group.averageEntry).toBe(7705);
    expect(group.legIndex('leg-1')).toBe(1);
    expect(group.legIndex('leg-2')).toBe(2);
    expect(group.openLegs).toBe(2);
    expect(group.allClosed).toBe(false);
  });

  it('orders legs oldest first regardless of array order', () => {
    const first = makeTrade({ id: 'leg-1', entryTime: '2026-09-18T13:30:00.000Z' });
    const second = makeTrade({
      id: 'leg-2',
      positionId: 'leg-1',
      entryTime: '2026-09-18T13:45:00.000Z',
    });

    const group = buildPositionGroups([second, first]).get('leg-1')!;
    expect(group.trades.map((t) => t.id)).toEqual(['leg-1', 'leg-2']);
    expect(group.legIndex('leg-2')).toBe(2);
  });

  it('sums risk and realized P&L once every leg is closed', () => {
    const legs = [
      makeTrade({ id: 'leg-1', contracts: 1, entryPrice: 7730, initialRisk: 100, status: 'closed', grossPnL: -100 }),
      makeTrade({
        id: 'leg-2',
        contracts: 5,
        entryPrice: 7700,
        positionId: 'leg-1',
        initialRisk: 50,
        status: 'closed',
        grossPnL: 250,
        entryTime: '2026-09-18T13:45:00.000Z',
      }),
    ];

    const group = buildPositionGroups(legs).get('leg-1')!;
    expect(group.totalInitialRisk).toBe(150);
    expect(group.realizedPnL).toBe(150);
    expect(group.allClosed).toBe(true);
    expect(group.openLegs).toBe(0);
  });

  it('never returns NaN when contract counts are missing', () => {
    const groups = buildPositionGroups([
      makeTrade({ id: 'a', contracts: 0, entryPrice: 0 }),
    ]);
    expect(groups.get('a')!.averageEntry).toBe(0);
    expect(Number.isFinite(groups.get('a')!.averageEntry)).toBe(true);
  });
});

describe('findPositionGroup', () => {
  it('finds the group for a leg and returns undefined without groups', () => {
    const add = makeTrade({ id: 'leg-2', positionId: 'leg-1' });
    const groups = buildPositionGroups([makeTrade({ id: 'leg-1' }), add]);

    expect(findPositionGroup(groups, add)!.legCount).toBe(2);
    expect(findPositionGroup(undefined, add)).toBeUndefined();
  });
});
