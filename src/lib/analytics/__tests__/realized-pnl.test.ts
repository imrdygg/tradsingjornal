import { describe, it, expect } from 'vitest';
import { realizedPnL } from '../realized-pnl';

describe('realizedPnL', () => {
  it('keeps the fees out of the account when the journal recorded them', () => {
    expect(realizedPnL({ grossPnL: 200, netPnL: 150 })).toBe(150);
  });

  it('falls back to gross for a trade with no fee recorded', () => {
    expect(realizedPnL({ grossPnL: 200 })).toBe(200);
  });

  it('reads a break-even trade as zero rather than as missing', () => {
    expect(realizedPnL({ grossPnL: 0, netPnL: 0 })).toBe(0);
  });

  it('never invents a number from a broken value', () => {
    expect(realizedPnL({ grossPnL: 120, netPnL: Number.NaN })).toBe(120);
    expect(realizedPnL({ grossPnL: Number.POSITIVE_INFINITY })).toBe(0);
  });
});
