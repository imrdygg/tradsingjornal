import { describe, it, expect } from 'vitest';
import type { Trade } from '../../../types';
import {
  DEFAULT_RISK_TIER_AMOUNTS,
  RISK_TIER_COUNT,
  countTradesByTier,
  normalizeTierCaps,
  riskTierAmount,
  riskTierAmounts,
  riskTierLabel,
  sizeForRisk,
} from '../risk-tiers';

/** Only the fields the cap helpers read are filled in. */
const tierTrade = (id: string, riskTier: number | null | undefined): Trade =>
  ({ id, riskTier } as Trade);

describe('riskTierAmounts', () => {
  it('returns the built-in ladder for a profile that has none', () => {
    expect(riskTierAmounts(null)).toEqual([25, 50, 75, 100]);
    expect(riskTierAmounts({})).toEqual([25, 50, 75, 100]);
    expect(RISK_TIER_COUNT).toBe(DEFAULT_RISK_TIER_AMOUNTS.length);
  });

  it('uses the trader’s own amounts when they are set', () => {
    expect(riskTierAmounts({ riskTierAmounts: [10, 20, 30, 40] })).toEqual([10, 20, 30, 40]);
  });

  it('repairs one bad slot rather than discarding the whole ladder', () => {
    // A zero, a blank and a missing tail must not cost the trader the slots that are fine.
    expect(riskTierAmounts({ riskTierAmounts: [0, 50, 75, 100] })).toEqual([25, 50, 75, 100]);
    expect(riskTierAmounts({ riskTierAmounts: [40, Number.NaN, 30] })).toEqual([40, 50, 30, 100]);
    expect(riskTierAmounts({ riskTierAmounts: [-5, 50, 75, 100] })).toEqual([25, 50, 75, 100]);
  });
});

describe('riskTierAmount', () => {
  it('maps each slot to its amount', () => {
    expect(riskTierAmount(1, DEFAULT_RISK_TIER_AMOUNTS)).toBe(25);
    expect(riskTierAmount(4, DEFAULT_RISK_TIER_AMOUNTS)).toBe(100);
  });

  it('has no amount for the custom slot or an out-of-range slot', () => {
    expect(riskTierAmount(null, DEFAULT_RISK_TIER_AMOUNTS)).toBeNull();
    expect(riskTierAmount(undefined, DEFAULT_RISK_TIER_AMOUNTS)).toBeNull();
    expect(riskTierAmount(5, DEFAULT_RISK_TIER_AMOUNTS)).toBeNull();
    expect(riskTierAmount(0, DEFAULT_RISK_TIER_AMOUNTS)).toBeNull();
  });
});

describe('riskTierLabel', () => {
  it('names a fixed slot with its risk', () => {
    expect(riskTierLabel(2, 50, DEFAULT_RISK_TIER_AMOUNTS)).toBe('Trade #2 · $50');
  });

  it('names the custom slot by its amount, not by a number', () => {
    expect(riskTierLabel(null, 40, DEFAULT_RISK_TIER_AMOUNTS)).toBe('Custom risk · $40');
    expect(riskTierLabel(null, undefined, DEFAULT_RISK_TIER_AMOUNTS)).toBe('Custom risk');
  });
});

describe('normalizeTierCaps', () => {
  it('reads a missing or cleared cap as no cap', () => {
    expect(normalizeTierCaps(undefined)).toEqual([0, 0, 0, 0]);
    expect(normalizeTierCaps(null)).toEqual([0, 0, 0, 0]);
    expect(normalizeTierCaps([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it('keeps whole positive caps and repairs anything else', () => {
    expect(normalizeTierCaps([2, 1, 3, 1])).toEqual([2, 1, 3, 1]);
    // Fractions, negatives, NaN and a short list all become "no cap".
    expect(normalizeTierCaps([1.5, -2, Number.NaN, 4])).toEqual([0, 0, 0, 4]);
    expect(normalizeTierCaps([2])).toEqual([2, 0, 0, 0]);
  });
});

describe('countTradesByTier', () => {
  it('counts each fixed slot and ignores the custom slot', () => {
    const counts = countTradesByTier([
      tierTrade('a', 1),
      tierTrade('b', 1),
      tierTrade('c', 3),
      tierTrade('d', null),
      tierTrade('e', undefined),
    ]);

    expect(counts).toEqual([2, 0, 1, 0]);
  });

  it('leaves out a trade when it is the one being edited', () => {
    const counts = countTradesByTier([tierTrade('a', 2), tierTrade('b', 2)], 'b');
    expect(counts).toEqual([0, 1, 0, 0]);
  });
});

describe('sizeForRisk', () => {
  it('derives the contracts that risk the slot exactly', () => {
    // MES is $5/pt: a $50 slot on a 10-point stop is one contract.
    const sized = sizeForRisk({ risk: 50, entryPrice: 6700, stopPrice: 6690, pointValue: 5 });
    expect(sized).toEqual({
      contracts: 1,
      actualRisk: 50,
      stopPoints: 10,
      riskPerContract: 50,
      rounded: false,
    });
  });

  it('flags a size that cannot hit the slot exactly', () => {
    // A $25 slot on a 4-point MES stop needs 1.25 contracts; one contract risks $20.
    const sized = sizeForRisk({ risk: 25, entryPrice: 6700, stopPrice: 6696, pointValue: 5 });
    expect(sized?.contracts).toBe(1);
    expect(sized?.actualRisk).toBe(20);
    expect(sized?.rounded).toBe(true);
  });

  it('never sizes below one contract', () => {
    // A $25 slot with a wide 40-point stop is a fraction of a contract, but futures only
    // trade in whole ones.
    const sized = sizeForRisk({ risk: 25, entryPrice: 6700, stopPrice: 6660, pointValue: 5 });
    expect(sized?.contracts).toBe(1);
    expect(sized?.actualRisk).toBe(200);
    expect(sized?.rounded).toBe(true);
  });

  it('rounds to the nearest whole size', () => {
    // 2.4 contracts rounds to 2 at $50/pt.
    const sized = sizeForRisk({ risk: 120, entryPrice: 6700, stopPrice: 6690, pointValue: 5 });
    expect(sized?.contracts).toBe(2);
    expect(sized?.actualRisk).toBe(100);
  });

  it('returns null until there is a risk and a real stop distance', () => {
    expect(sizeForRisk({ risk: 0, entryPrice: 6700, stopPrice: 6690, pointValue: 5 })).toBeNull();
    expect(sizeForRisk({ risk: 50, entryPrice: 6700, stopPrice: 6700, pointValue: 5 })).toBeNull();
    expect(sizeForRisk({ risk: 50, entryPrice: 6700, stopPrice: 6690, pointValue: 0 })).toBeNull();
  });
});
