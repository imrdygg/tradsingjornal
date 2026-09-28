import { describe, it, expect } from 'vitest';
import type { Trade } from '../../../types';
import {
  assessPlannedSize,
  assessRiskCapacity,
  buildEquityCurve,
  buildRoomCurve,
  drawdownShortfall,
} from '../risk-capacity';

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

/** A record of closed trades, each with its own P&L, in the order they were taken. */
function series(pnls: number[]): Trade[] {
  return pnls.map((pnl, idx) =>
    makeTrade({
      id: `trade-${idx + 1}`,
      grossPnL: pnl,
      exitTime: `2026-09-${String(20 + idx).padStart(2, '0')}T18:00:00.000Z`,
    })
  );
}

describe('assessRiskCapacity', () => {
  it('starts on the full agreed drawdown with nothing spent', () => {
    const capacity = assessRiskCapacity({ trades: [], maxDrawdown: 1000, dailyLossLimit: 100 });

    expect(capacity.headroom).toBe(1000);
    expect(capacity.usedPct).toBe(0);
    expect(capacity.headroomPct).toBe(100);
    expect(capacity.daysOfHeadroom).toBe(10);
    expect(capacity.stance).toBe('ample');
  });

  it('adds room above the agreed limit when the record is up', () => {
    // The reading that used to be pinned: winning left the room on the limit.
    const capacity = assessRiskCapacity({ trades: series([100]), maxDrawdown: 1000, dailyLossLimit: 100 });

    expect(capacity.current).toBe(100);
    expect(capacity.headroom).toBe(1100);
    expect(capacity.headroomPct).toBe(110);
    expect(capacity.daysOfHeadroom).toBe(11);
    // Nothing of the limit is spent, whatever came off the high-water mark.
    expect(capacity.drawdownUsed).toBe(0);
  });

  it('spends the limit dollar for dollar when the record is down', () => {
    const capacity = assessRiskCapacity({ trades: series([-200]), maxDrawdown: 1000, dailyLossLimit: 100 });

    expect(capacity.headroom).toBe(800);
    expect(capacity.drawdownUsed).toBe(200);
    expect(capacity.usedPct).toBe(20);
    expect(capacity.headroomPct).toBe(80);
    expect(capacity.note).toContain('$800 of room against the $1,000 drawdown');
  });

  it('reports dollars handed back from the high separately from the limit spent', () => {
    // Up $500 at the peak, now up $300: $200 given back, and no limit spent at all.
    const capacity = assessRiskCapacity({
      trades: series([500, -200]),
      maxDrawdown: 1000,
      dailyLossLimit: 100,
    });

    expect(capacity.current).toBe(300);
    expect(capacity.peak).toBe(500);
    expect(capacity.givenBack).toBe(200);
    expect(capacity.drawdownUsed).toBe(0);
    expect(capacity.headroom).toBe(1300);
  });

  it('calls the limit reached once the account is through the floor', () => {
    const capacity = assessRiskCapacity({
      trades: series([-1000]),
      maxDrawdown: 1000,
      dailyLossLimit: 100,
    });

    expect(capacity.headroom).toBe(0);
    expect(capacity.stance).toBe('limit-reached');
    expect(capacity.daysOfHeadroom).toBe(0);
    expect(capacity.dailyLimitFits).toBe(false);
  });

  it('reports no room at all without a limit, rather than assuming one', () => {
    const capacity = assessRiskCapacity({ trades: series([250]), maxDrawdown: null });

    expect(capacity.maxDrawdown).toBeNull();
    expect(capacity.headroom).toBeNull();
    expect(capacity.headroomPct).toBeNull();
    expect(capacity.usedPct).toBeNull();
    expect(capacity.daysOfHeadroom).toBeNull();
  });

  it('reads net P&L when the caller asks for it, so the coach and the chart agree', () => {
    const trades = [makeTrade({ grossPnL: 120, netPnL: 100 })];
    const capacity = assessRiskCapacity({
      trades,
      maxDrawdown: 1000,
      pnlOf: (trade) =>
        typeof trade.netPnL === 'number' ? trade.netPnL : trade.grossPnL,
    });

    expect(capacity.current).toBe(100);
    expect(capacity.headroom).toBe(1100);
  });
});

describe('buildEquityCurve', () => {
  it('draws one fixed floor below the starting point instead of trailing the peak', () => {
    const curve = buildEquityCurve(series([300, -400]), 1000);

    expect(curve.map((point) => point.floor)).toEqual([-1000, -1000]);
    // The peak still rises, and the drawdown below it is still measured from it.
    expect(curve.map((point) => point.peak)).toEqual([300, 300]);
    expect(curve[1].drawdown).toBe(400);
  });

  it('leaves the floor unset when no limit is named', () => {
    expect(buildEquityCurve(series([100]), null).every((point) => point.floor === null)).toBe(true);
  });
});

describe('buildRoomCurve', () => {
  it('steps the room up on a win and back down on a loss', () => {
    const rooms = buildRoomCurve(series([100, -300, 50]), 1000).map((point) => point.room);

    expect(rooms).toEqual([1100, 800, 850]);
  });

  it('carries the trade P&L so a step can be read against its cause', () => {
    const [first, second] = buildRoomCurve(series([100, -300]), 1000);

    expect(first.pnl).toBe(100);
    expect(second.pnl).toBe(-300);
    expect(second.index).toBe(2);
    expect(second.label).toContain('(2)');
  });

  it('charts nothing at all without a limit to measure room against', () => {
    expect(buildRoomCurve(series([100]), null)).toEqual([]);
    expect(buildRoomCurve(series([100]), 0)).toEqual([]);
  });

  it('charts nothing before the first closed trade', () => {
    expect(buildRoomCurve([], 1000)).toEqual([]);
  });
});

describe('the warnings built on the room', () => {
  it('stays silent while the plan fits the room', () => {
    const capacity = assessRiskCapacity({ trades: [], maxDrawdown: 1000, dailyLossLimit: 100 });
    expect(drawdownShortfall(capacity, 100)).toBeNull();
  });

  it('warns when the plan reaches past the room', () => {
    const capacity = assessRiskCapacity({
      trades: series([-950]),
      maxDrawdown: 1000,
      dailyLossLimit: 100,
    });
    const shortfall = drawdownShortfall(capacity, 100);

    expect(shortfall).not.toBeNull();
    expect(shortfall?.headroom).toBe(50);
    expect(shortfall?.over).toBe(50);
    expect(shortfall?.limitReached).toBe(false);
  });

  it('sizes a planned position against the room, including room that profit added', () => {
    const capacity = assessRiskCapacity({
      trades: series([500]),
      maxDrawdown: 1000,
      dailyLossLimit: 100,
    });
    // 2 contracts, a 100-point stop, $5 a point = $1,000 at risk against $1,500 of room.
    expect(
      assessPlannedSize({
        capacity,
        contracts: 2,
        stopDistance: { points: 100, source: 'open-position', sample: 0 },
        pointValue: 5,
        symbol: 'MES',
      })
    ).toBeNull();

    const tooBig = assessPlannedSize({
      capacity,
      contracts: 4,
      stopDistance: { points: 100, source: 'open-position', sample: 0 },
      pointValue: 5,
      symbol: 'MES',
    });
    expect(tooBig?.dollarsAtRisk).toBe(2000);
    expect(tooBig?.headroom).toBe(1500);
    expect(tooBig?.over).toBe(500);
  });
});
