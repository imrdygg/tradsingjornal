import { TradeDirection } from '../../types';

/**
 * Scale-in (averaging) maths for an open futures position.
 *
 * Adding to a losing position does not remove the loss — it spreads it over
 * more contracts, which moves the average entry price (the break-even price)
 * towards the current market. Everything here is pure so the numbers can be
 * unit tested independently of the UI.
 *
 * Dollar figures always come from the instrument's own point value, so MES
 * ($5/pt), MNQ ($2/pt) and ES ($50/pt) are each priced correctly.
 */

export interface ScaleInPlanInput {
  direction: TradeDirection;
  /** Contracts already held. */
  contracts: number;
  /** Average entry price of the contracts already held. */
  entryPrice: number;
  /** Live market price. Defaults to the entry price when unknown. */
  currentPrice?: number;
  /** Contracts being added. */
  addContracts: number;
  /** Price the extra contracts would be added at. Defaults to current price. */
  addPrice?: number;
  /** Instrument point value in dollars, e.g. 5 for MES. */
  pointValue: number;
  /** Instrument tick size in points, e.g. 0.25 for MES. */
  tickSize?: number;
  /** Bounce the trader expects, used by the reverse solver. */
  desiredBouncePts?: number;
  /** Points used for the "what does a move cost me" readout. */
  movePts?: number;
}

export interface ScaleInPlan {
  contracts: number;
  entryPrice: number;
  currentPrice: number;
  addContracts: number;
  addPrice: number;
  isLong: boolean;
  totalContracts: number;
  /** Points the position is currently up (+) or down (-). */
  currentPointsDiff: number;
  /** Open P&L before adding, in dollars. */
  currentPnL: number;
  /** Points price must travel to get back to the original entry. */
  originalPointsToBreakeven: number;
  /** Weighted average entry after the add — the new break-even price. */
  newAveragePrice: number;
  /** How many points the average entry improved by. */
  averageImprovedBy: number;
  /** Points needed from the add price to reach the new average. */
  pointsToNewBreakeven: number;
  /** How many points of required travel the add removes. */
  distanceSavedPts: number;
  /** Distance removed, as a percentage of the original requirement. */
  percentDistanceReduced: number;
  dollarPerPointBefore: number;
  dollarPerPointAfter: number;
  dollarPerTickAfter: number;
  /** Contracts required to break even within `desiredBouncePts` (0 = not solvable). */
  neededContractsForTarget: number;
  targetBounce: number;
  movePts: number;
  favorableMovePnL: number;
  adverseMovePnL: number;
}

/** One row of the "if I add a different size" comparison table. */
export interface ScaleInScenario {
  addQty: number;
  totalQty: number;
  avgPrice: number;
  bounceNeeded: number;
  dollarPt: number;
}

const positive = (n: number | undefined, fallback: number): number =>
  typeof n === 'number' && isFinite(n) && n > 0 ? n : fallback;

export function calculateScaleInPlan(input: ScaleInPlanInput): ScaleInPlan {
  const {
    direction,
    entryPrice,
    pointValue,
    desiredBouncePts,
    movePts = 5,
  } = input;

  const isLong = direction === 'long';

  const contracts = Math.max(1, input.contracts || 1);
  const entry = positive(entryPrice, 0);
  const currentPrice = positive(input.currentPrice, entry);
  const addContracts = Math.max(1, input.addContracts || 1);
  const addPrice = positive(input.addPrice, currentPrice);
  const tickSize = positive(input.tickSize, 0.25);

  // Current position, before the add
  const currentPointsDiff = isLong ? currentPrice - entry : entry - currentPrice;
  const currentPnL = currentPointsDiff * contracts * pointValue;
  const originalPointsToBreakeven = Math.abs(entry - currentPrice);

  // Weighted average = new break-even price
  const totalContracts = contracts + addContracts;
  const newAveragePrice = (contracts * entry + addContracts * addPrice) / totalContracts;
  const averageImprovedBy = Math.abs(entry - newAveragePrice);

  const pointsToNewBreakeven = isLong ? newAveragePrice - addPrice : addPrice - newAveragePrice;
  const distanceSavedPts = originalPointsToBreakeven - Math.max(0, pointsToNewBreakeven);
  const percentDistanceReduced =
    originalPointsToBreakeven > 0
      ? Math.max(0, Math.min(100, (distanceSavedPts / originalPointsToBreakeven) * 100))
      : 0;

  // Risk exposure
  const dollarPerPointBefore = contracts * pointValue;
  const dollarPerPointAfter = totalContracts * pointValue;
  const dollarPerTickAfter = dollarPerPointAfter * tickSize;

  // Reverse solver: which add size gets break-even within the expected bounce?
  const targetBounce = Math.max(tickSize, desiredBouncePts || tickSize);
  const canSolve = entry > 0 && originalPointsToBreakeven > targetBounce;
  const neededContractsForTarget = canSolve
    ? Math.ceil((contracts * (originalPointsToBreakeven - targetBounce)) / targetBounce)
    : 0;

  return {
    contracts,
    entryPrice: entry,
    currentPrice,
    addContracts,
    addPrice,
    isLong,
    totalContracts,
    currentPointsDiff,
    currentPnL,
    originalPointsToBreakeven,
    newAveragePrice,
    averageImprovedBy,
    pointsToNewBreakeven,
    distanceSavedPts,
    percentDistanceReduced,
    dollarPerPointBefore,
    dollarPerPointAfter,
    dollarPerTickAfter,
    neededContractsForTarget,
    targetBounce,
    movePts,
    favorableMovePnL: movePts * dollarPerPointAfter,
    adverseMovePnL: -movePts * dollarPerPointAfter,
  };
}

/** Compares the break-even for a range of possible add sizes. */
export function calculateScaleInScenarios(
  input: Pick<
    ScaleInPlanInput,
    'direction' | 'contracts' | 'entryPrice' | 'currentPrice' | 'addPrice' | 'pointValue'
  >,
  sizes: number[] = [1, 2, 3, 5, 8, 10]
): ScaleInScenario[] {
  const isLong = input.direction === 'long';
  const contracts = Math.max(1, input.contracts || 1);
  const entry = positive(input.entryPrice, 0);
  const currentPrice = positive(input.currentPrice, entry);
  const addPrice = positive(input.addPrice, currentPrice);

  return sizes.map((addQty) => {
    const totalQty = contracts + addQty;
    const avgPrice = totalQty > 0 ? (contracts * entry + addQty * addPrice) / totalQty : 0;
    const bounceNeeded = isLong ? avgPrice - addPrice : addPrice - avgPrice;
    return {
      addQty,
      totalQty,
      avgPrice,
      bounceNeeded: Math.max(0, bounceNeeded),
      dollarPt: totalQty * input.pointValue,
    };
  });
}
