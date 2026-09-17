import { Instrument, TradeDirection } from '../../types';

export interface CalculatePnLParams {
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  instrument: Pick<Instrument, 'pointValue'>;
  fees?: number;
}

export interface PnLResult {
  pointsPnL: number;
  grossPnL: number;
  netPnL: number;
  fees: number;
}

/**
 * Calculates Points P&L, Gross P&L, and Net P&L.
 * Long gross P&L: (exit - entry) * point_value * contracts
 * Short gross P&L: (entry - exit) * point_value * contracts
 * Net P&L: Gross P&L - Fees
 */
export function calculatePnL({
  direction,
  entryPrice,
  exitPrice,
  contracts,
  instrument,
  fees = 0,
}: CalculatePnLParams): PnLResult {
  const pointsPnL =
    direction === 'long'
      ? exitPrice - entryPrice
      : entryPrice - exitPrice;

  const rawGrossPnL = pointsPnL * instrument.pointValue * contracts;
  const grossPnL = Math.round(rawGrossPnL * 100) / 100;
  const roundedFees = Math.round(fees * 100) / 100;
  const netPnL = Math.round((grossPnL - roundedFees) * 100) / 100;

  return {
    pointsPnL: Math.round(pointsPnL * 100) / 100,
    grossPnL,
    netPnL,
    fees: roundedFees,
  };
}
