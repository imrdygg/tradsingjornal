import { Instrument } from '../../types';

export interface CalculateRiskParams {
  entryPrice: number;
  stopPrice: number;
  contracts: number;
  instrument: Pick<Instrument, 'pointValue'>;
}

/**
 * Calculates initial dollar risk for a trade.
 * Initial risk: abs(entry - stop) * point_value * contracts
 */
export function calculateInitialRisk({
  entryPrice,
  stopPrice,
  contracts,
  instrument,
}: CalculateRiskParams): number {
  if (contracts <= 0) return 0;
  const priceDistance = Math.abs(entryPrice - stopPrice);
  const risk = priceDistance * instrument.pointValue * contracts;
  // Round to 2 decimal places to avoid floating point precision artifacts
  return Math.round(risk * 100) / 100;
}
