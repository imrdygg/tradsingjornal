import { describe, it, expect } from 'vitest';
import { Trade } from '../../../types';
import { DEFAULT_INSTRUMENTS, findInstrument } from '../instruments';
import {
  deriveStop,
  findAssumedRiskTrades,
  hasAssumedRisk,
  previewRiskFix,
  previewSingleRiskFix,
  recomputeTradeRisk,
  roundToTick,
} from '../risk-fixup';

const MES = findInstrument(DEFAULT_INSTRUMENTS, 'mes')!; // $5/pt, 0.25 tick
const MNQ = findInstrument(DEFAULT_INSTRUMENTS, 'mnq')!; // $2/pt, 0.25 tick

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    userId: 'u1',
    tradingDayId: 'd1',
    instrumentId: 'mes',
    source: 'tradovate_csv',
    direction: 'long',
    contracts: 1,
    entryPrice: 7730,
    initialStop: 7720,
    exitPrice: 7740,
    entryTime: '2026-09-18T13:30:00.000Z',
    exitTime: '2026-09-18T14:00:00.000Z',
    session: 'Regular Session',
    initialRisk: 50,
    grossPnL: 50,
    pointsPnL: 10,
    rMultiple: 1,
    status: 'closed',
    createdAt: '2026-09-18T13:30:00.000Z',
    updatedAt: '2026-09-18T14:00:00.000Z',
    ...overrides,
  };
}

const preview = (trades: Trade[], plan: Parameters<typeof previewRiskFix>[0]['plan']) =>
  previewRiskFix({ trades, instruments: DEFAULT_INSTRUMENTS, plan });

describe('hasAssumedRisk', () => {
  it('treats an explicit assumption as assumed', () => {
    expect(hasAssumedRisk({ source: 'tradovate_csv', riskSource: 'assumed' })).toBe(true);
  });

  it('respects an explicit recorded stop, even on an imported trade', () => {
    expect(hasAssumedRisk({ source: 'tradovate_csv', riskSource: 'recorded' })).toBe(false);
  });

  it('treats a legacy import as assumed, since its stop could only be a guess', () => {
    expect(hasAssumedRisk({ source: 'tradovate_csv', riskSource: undefined })).toBe(true);
  });

  it('treats a hand-recorded trade as real', () => {
    expect(hasAssumedRisk({ source: 'manual', riskSource: undefined })).toBe(false);
  });
});

describe('findAssumedRiskTrades', () => {
  it('returns only the trades needing a real stop, newest first', () => {
    const trades = [
      makeTrade({ id: 'old', entryTime: '2026-09-01T13:30:00.000Z' }),
      makeTrade({ id: 'real', source: 'manual', entryTime: '2026-09-20T13:30:00.000Z' }),
      makeTrade({ id: 'new', entryTime: '2026-09-10T13:30:00.000Z' }),
    ];

    expect(findAssumedRiskTrades(trades).map((t) => t.id)).toEqual(['new', 'old']);
  });
});

describe('roundToTick', () => {
  it('snaps a price to the nearest tick', () => {
    expect(roundToTick(7729.4, 0.25)).toBe(7729.5);
    expect(roundToTick(7729.1, 0.25)).toBe(7729);
    expect(roundToTick(7720, 0.25)).toBe(7720);
  });

  it('does not drift on exact tick multiples', () => {
    // 0.25 steps are not exactly representable, so this is the regression guard.
    expect(roundToTick(0.75, 0.25)).toBe(0.75);
    expect(roundToTick(7729.75, 0.25)).toBe(7729.75);
  });

  it('falls back to two decimals when there is no tick size', () => {
    expect(roundToTick(7729.456, 0)).toBe(7729.46);
  });
});

describe('deriveStop', () => {
  it('places the stop below the entry for a long', () => {
    const stop = deriveStop({
      entryPrice: 7730,
      direction: 'long',
      mode: 'points',
      points: 10,
      contracts: 1,
      pointValue: MES.pointValue,
      tickSize: MES.tickSize,
    });
    expect(stop).toBe(7720);
  });

  it('places the stop above the entry for a short', () => {
    const stop = deriveStop({
      entryPrice: 7730,
      direction: 'short',
      mode: 'points',
      points: 10,
      contracts: 1,
      pointValue: MES.pointValue,
      tickSize: MES.tickSize,
    });
    expect(stop).toBe(7740);
  });

  it('converts a dollar risk into a distance using point value and contracts', () => {
    // $50 on one MES contract at $5/pt is 10 points.
    const oneContract = deriveStop({
      entryPrice: 7730,
      direction: 'long',
      mode: 'dollars',
      dollars: 50,
      contracts: 1,
      pointValue: MES.pointValue,
      tickSize: MES.tickSize,
    });
    expect(oneContract).toBe(7720);

    // The same $50 spread over two contracts is 5 points each.
    const twoContracts = deriveStop({
      entryPrice: 7730,
      direction: 'long',
      mode: 'dollars',
      dollars: 50,
      contracts: 2,
      pointValue: MES.pointValue,
      tickSize: MES.tickSize,
    });
    expect(twoContracts).toBe(7725);
  });

  it('uses the instrument point value, so MNQ is not priced as MES', () => {
    // $40 on one MNQ contract at $2/pt is 20 points, not 8.
    const stop = deriveStop({
      entryPrice: 18000,
      direction: 'long',
      mode: 'dollars',
      dollars: 40,
      contracts: 1,
      pointValue: MNQ.pointValue,
      tickSize: MNQ.tickSize,
    });
    expect(stop).toBe(17980);
  });

  it('snaps a fractional distance onto a real tick', () => {
    // $3 on one MES contract is 0.6 points, which is not a tradable price.
    const stop = deriveStop({
      entryPrice: 7730,
      direction: 'long',
      mode: 'dollars',
      dollars: 3,
      contracts: 1,
      pointValue: MES.pointValue,
      tickSize: MES.tickSize,
    });
    expect(stop % 0.25).toBe(0);
    expect(stop).toBe(7729.5);
  });

  it('returns the entry unchanged when there is no usable input', () => {
    expect(
      deriveStop({
        entryPrice: 7730,
        direction: 'long',
        mode: 'dollars',
        dollars: 50,
        contracts: 0,
        pointValue: MES.pointValue,
        tickSize: MES.tickSize,
      })
    ).toBe(7730);
  });
});

describe('recomputeTradeRisk', () => {
  it('recomputes risk from the new stop and R from the fills', () => {
    const trade = makeTrade({ contracts: 2, entryPrice: 7730, grossPnL: 200 });
    const result = recomputeTradeRisk(trade, 7725, MES);

    // 5 points * $5/pt * 2 contracts = $50.
    expect(result.initialRisk).toBe(50);
    expect(result.initialStop).toBe(7725);
    expect(result.rMultiple).toBe(4);
  });

  it('gives an open trade a zero R, since it has no result yet', () => {
    const trade = makeTrade({ status: 'open', exitPrice: undefined, grossPnL: 0 });
    const result = recomputeTradeRisk(trade, 7710, MES);
    expect(result.initialRisk).toBe(100);
    expect(result.rMultiple).toBe(0);
  });
});

describe('previewRiskFix', () => {
  it('rejects an unusable plan before touching anything', () => {
    const trades = [makeTrade()];
    expect(preview(trades, { mode: 'points', points: 0 }).planError).toMatch(/greater than zero/);
    expect(preview(trades, { mode: 'points', points: -5 }).planError).toMatch(/greater than zero/);
    expect(preview(trades, { mode: 'dollars', dollars: 0 }).planError).toMatch(/greater than zero/);
    expect(preview(trades, { mode: 'points' }).planError).toBeTruthy();
  });

  it('lists the trades it will change with their before and after numbers', () => {
    const result = preview([makeTrade({ rMultiple: 0.5 })], { mode: 'points', points: 25 });

    expect(result.planError).toBeNull();
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.previousStop).toBe(7720);
    expect(item.previousRisk).toBe(50);
    expect(item.stop).toBe(7705);
    // 25 points * $5/pt * 1 contract = $125.
    expect(item.risk).toBe(125);
    // $50 of profit over $125 of risk.
    expect(item.rMultiple).toBe(0.4);
    expect(item.stopPoints).toBe(25);
    expect(result.summary.count).toBe(1);
    expect(result.summary.totalRisk).toBe(125);
    expect(result.summary.averageRisk).toBe(125);
    expect(result.summary.rChanged).toBe(1);
  });

  it('leaves trades that already have a real stop alone', () => {
    const trades = [
      makeTrade({ id: 'assumed' }),
      makeTrade({ id: 'real', source: 'manual' }),
      makeTrade({ id: 'confirmed', riskSource: 'recorded' }),
    ];

    const result = preview(trades, { mode: 'points', points: 10 });
    expect(result.items.map((i) => i.tradeId)).toEqual(['assumed']);
  });

  it('prices each trade with its own instrument', () => {
    const trades = [
      makeTrade({ id: 'mes-trade', instrumentId: 'mes', entryPrice: 7730, contracts: 1 }),
      makeTrade({ id: 'mnq-trade', instrumentId: 'mnq', entryPrice: 18000, contracts: 1 }),
    ];

    const result = preview(trades, { mode: 'dollars', dollars: 100 });
    const mes = result.items.find((i) => i.tradeId === 'mes-trade')!;
    const mnq = result.items.find((i) => i.tradeId === 'mnq-trade')!;

    expect(mes.risk).toBe(100);
    expect(mnq.risk).toBe(100);
    // Same dollars, different distances: 20 points on MES vs 50 on MNQ.
    expect(mes.stopPoints).toBe(20);
    expect(mnq.stopPoints).toBe(50);
  });

  it('skips a trade with no entry price instead of inventing one', () => {
    const result = preview([makeTrade({ entryPrice: 0 })], { mode: 'points', points: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/entry price/i);
  });

  it('skips a trade with no contract count', () => {
    const result = preview([makeTrade({ contracts: 0 })], { mode: 'points', points: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/contract count/i);
  });

  it('skips a trade whose instrument is unknown rather than guessing MES', () => {
    const result = preview([makeTrade({ instrumentId: 'does-not-exist' })], {
      mode: 'points',
      points: 10,
    });
    expect(result.items).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/not recognised/i);
  });

  it('skips a stop that rounding pushed onto the entry', () => {
    // 0.1 points rounds to no distance at all on a 0.25 tick.
    const result = preview([makeTrade()], { mode: 'points', points: 0.1 });
    expect(result.items).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/losing side/i);
  });

  it('reports a mix of changed and skipped trades together', () => {
    const trades = [
      makeTrade({ id: 'ok-1' }),
      makeTrade({ id: 'ok-2', contracts: 2 }),
      makeTrade({ id: 'bad', entryPrice: 0 }),
    ];

    const result = preview(trades, { mode: 'points', points: 10 });
    expect(result.items.map((i) => i.tradeId).sort()).toEqual(['ok-1', 'ok-2']);
    expect(result.skipped.map((s) => s.tradeId)).toEqual(['bad']);
    // $50 and $100.
    expect(result.summary.totalRisk).toBe(150);
    expect(result.summary.averageRisk).toBe(75);
  });

  it('reports no change when the plan matches the existing stop', () => {
    const trade = makeTrade({ initialRisk: 50, rMultiple: 1 });
    const result = preview([trade], { mode: 'points', points: 10 });
    expect(result.items[0].risk).toBe(50);
    expect(result.items[0].rMultiple).toBe(1);
    expect(result.summary.rChanged).toBe(0);
  });
});

describe('previewSingleRiskFix', () => {
  it('fixes one trade even if the app has not flagged it', () => {
    const trade = makeTrade({ source: 'manual', riskSource: undefined, rMultiple: 0.5 });
    const result = previewSingleRiskFix({
      trade,
      instruments: DEFAULT_INSTRUMENTS,
      points: 20,
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.stop).toBe(7710);
      expect(result.risk).toBe(100);
      expect(result.rMultiple).toBe(0.5);
    }
  });

  it('returns a readable error rather than a broken item', () => {
    const result = previewSingleRiskFix({
      trade: makeTrade(),
      instruments: DEFAULT_INSTRUMENTS,
      points: 0,
    });
    expect('error' in result).toBe(true);
  });
});
