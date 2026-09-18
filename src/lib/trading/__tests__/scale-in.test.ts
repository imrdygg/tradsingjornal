import { describe, it, expect } from 'vitest';
import { DEFAULT_INSTRUMENTS, findInstrument } from '../instruments';
import { calculateScaleInPlan, calculateScaleInScenarios } from '../scale-in';

const mes = findInstrument(DEFAULT_INSTRUMENTS, 'MES'); // $5/pt
const mnq = findInstrument(DEFAULT_INSTRUMENTS, 'MNQ'); // $2/pt

describe('calculateScaleInPlan — weighted average / break-even', () => {
  it('pulls the break-even to the weighted average of all fills', () => {
    // The classic case: 1 long from 7730, add 5 at 7700.
    // (1*7730 + 5*7700) / 6 = 7705 -> only a 5 point bounce from 7700.
    const plan = calculateScaleInPlan({
      direction: 'long',
      contracts: 1,
      entryPrice: 7730,
      currentPrice: 7700,
      addContracts: 5,
      addPrice: 7700,
      pointValue: mes.pointValue,
      tickSize: mes.tickSize,
    });

    expect(plan.newAveragePrice).toBeCloseTo(7705, 5);
    expect(plan.pointsToNewBreakeven).toBeCloseTo(5, 5);
    expect(plan.totalContracts).toBe(6);
    expect(plan.originalPointsToBreakeven).toBeCloseTo(30, 5);
    // 30 points of required travel cut down to 5 = 83% less distance.
    expect(plan.percentDistanceReduced).toBeCloseTo(83.33, 1);
    expect(plan.distanceSavedPts).toBeCloseTo(25, 5);
  });

  it('prices the position with the real instrument point value, not a fixed $5', () => {
    const mnqPlan = calculateScaleInPlan({
      direction: 'long',
      contracts: 2,
      entryPrice: 20000,
      currentPrice: 19990,
      addContracts: 2,
      addPrice: 19990,
      pointValue: mnq.pointValue,
      tickSize: mnq.tickSize,
    });

    // 10 points against 2 MNQ contracts at $2/pt = -$40 (not -$100 as with MES).
    expect(mnqPlan.currentPnL).toBeCloseTo(-40, 5);
    expect(mnqPlan.dollarPerPointBefore).toBeCloseTo(4, 5);
    expect(mnqPlan.dollarPerPointAfter).toBeCloseTo(8, 5);
    expect(mnqPlan.dollarPerTickAfter).toBeCloseTo(2, 5); // 0.25 tick * $8/pt

    const es = findInstrument(DEFAULT_INSTRUMENTS, 'ES'); // $50/pt
    const esPlan = calculateScaleInPlan({
      direction: 'long',
      contracts: 1,
      entryPrice: 5000,
      currentPrice: 4990,
      addContracts: 1,
      addPrice: 4990,
      pointValue: es.pointValue,
      tickSize: es.tickSize,
    });
    expect(esPlan.currentPnL).toBeCloseTo(-500, 5);
  });

  it('handles shorts symmetrically', () => {
    const plan = calculateScaleInPlan({
      direction: 'short',
      contracts: 1,
      entryPrice: 7700,
      currentPrice: 7730, // price moved against the short
      addContracts: 5,
      addPrice: 7730,
      pointValue: mes.pointValue,
      tickSize: mes.tickSize,
    });

    expect(plan.currentPointsDiff).toBeCloseTo(-30, 5);
    expect(plan.currentPnL).toBeCloseTo(-150, 5);
    expect(plan.newAveragePrice).toBeCloseTo(7725, 5);
    expect(plan.pointsToNewBreakeven).toBeCloseTo(5, 5);
  });
});

describe('calculateScaleInPlan — reverse solver', () => {
  it('solves the add size needed for a given bounce', () => {
    // 30 points away, want break-even within 5 points -> 5 extra contracts.
    const plan = calculateScaleInPlan({
      direction: 'long',
      contracts: 1,
      entryPrice: 7730,
      currentPrice: 7700,
      addContracts: 1,
      addPrice: 7700,
      pointValue: mes.pointValue,
      desiredBouncePts: 5,
    });
    expect(plan.neededContractsForTarget).toBe(5);
  });

  it('returns 0 when no add is needed (bounce already covers the gap)', () => {
    const plan = calculateScaleInPlan({
      direction: 'long',
      contracts: 1,
      entryPrice: 7702,
      currentPrice: 7700,
      addContracts: 1,
      addPrice: 7700,
      pointValue: mes.pointValue,
      desiredBouncePts: 10,
    });
    expect(plan.neededContractsForTarget).toBe(0);
  });

  it('does not divide by zero when prices are missing', () => {
    const plan = calculateScaleInPlan({
      direction: 'long',
      contracts: 1,
      entryPrice: 0,
      addContracts: 1,
      pointValue: mes.pointValue,
    });
    expect(plan.neededContractsForTarget).toBe(0);
    expect(Number.isFinite(plan.newAveragePrice)).toBe(true);
  });
});

describe('calculateScaleInScenarios', () => {
  it('shows how bigger adds improve the break-even', () => {
    const rows = calculateScaleInScenarios({
      direction: 'long',
      contracts: 1,
      entryPrice: 7730,
      currentPrice: 7700,
      addPrice: 7700,
      pointValue: mes.pointValue,
    });

    const add5 = rows.find((r) => r.addQty === 5)!;
    expect(add5.totalQty).toBe(6);
    expect(add5.avgPrice).toBeCloseTo(7705, 5);
    expect(add5.bounceNeeded).toBeCloseTo(5, 5);
    expect(add5.dollarPt).toBeCloseTo(30, 5);

    // A bigger add always leaves a smaller bounce requirement.
    const add10 = rows.find((r) => r.addQty === 10)!;
    expect(add10.bounceNeeded).toBeLessThan(add5.bounceNeeded);
  });
});
