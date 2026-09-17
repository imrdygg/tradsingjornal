import { describe, it, expect } from 'vitest';
import { DEFAULT_INSTRUMENTS, findInstrument } from '../instruments';
import { calculateInitialRisk } from '../calculate-risk';
import { calculatePnL } from '../calculate-pnl';
import { calculateRMultiple } from '../calculate-r';

describe('Trading Calculations for MES Futures', () => {
  const mes = findInstrument(DEFAULT_INSTRUMENTS, 'MES');

  it('calculates initial risk correctly for 1 contract (Seed Example)', () => {
    const risk = calculateInitialRisk({
      entryPrice: 6702.25,
      stopPrice: 6692.25,
      contracts: 1,
      instrument: mes,
    });
    // 10 pts * $5 = $50
    expect(risk).toBe(50);
  });

  it('calculates initial risk for multi-contract positions (3 contracts)', () => {
    const risk = calculateInitialRisk({
      entryPrice: 6700.0,
      stopPrice: 6695.0,
      contracts: 3,
      instrument: mes,
    });
    // 5 pts * $5 * 3 = $75
    expect(risk).toBe(75);
  });

  it('calculates Long Gross P&L accurately (Seed Example: +$150)', () => {
    const result = calculatePnL({
      direction: 'long',
      entryPrice: 6702.25,
      exitPrice: 6732.25,
      contracts: 1,
      instrument: mes,
    });
    expect(result.pointsPnL).toBe(30);
    expect(result.grossPnL).toBe(150);
    expect(result.netPnL).toBe(150);
  });

  it('calculates Short Gross P&L accurately', () => {
    const result = calculatePnL({
      direction: 'short',
      entryPrice: 6750.0,
      exitPrice: 6730.0,
      contracts: 2,
      instrument: mes,
    });
    // (6750 - 6730) = 20 pts * $5 * 2 = $200
    expect(result.pointsPnL).toBe(20);
    expect(result.grossPnL).toBe(200);
  });

  it('calculates Short Loss correctly', () => {
    const result = calculatePnL({
      direction: 'short',
      entryPrice: 6700.0,
      exitPrice: 6710.0,
      contracts: 1,
      instrument: mes,
    });
    // (6700 - 6710) = -10 pts * $5 = -$50
    expect(result.pointsPnL).toBe(-10);
    expect(result.grossPnL).toBe(-50);
  });

  it('calculates R multiple accurately (Seed Example: +3.0R)', () => {
    const r = calculateRMultiple(150, 50);
    expect(r).toBe(3.0);
  });

  it('calculates negative R multiple for losing trades', () => {
    const r = calculateRMultiple(-50, 50);
    expect(r).toBe(-1.0);
  });

  it('calculates net P&L with fees', () => {
    const result = calculatePnL({
      direction: 'long',
      entryPrice: 6700.0,
      exitPrice: 6710.0,
      contracts: 1,
      instrument: mes,
      fees: 2.5,
    });
    // 10 pts * $5 = $50 gross, - $2.50 fees = $47.50 net
    expect(result.grossPnL).toBe(50);
    expect(result.fees).toBe(2.5);
    expect(result.netPnL).toBe(47.5);
  });
});
