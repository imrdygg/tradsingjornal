/**
 * Calculates R-multiple for a trade.
 * R multiple = gross_pnl / initial_risk
 */
export function calculateRMultiple(grossPnL: number, initialRisk: number): number {
  if (initialRisk <= 0) return 0;
  const r = grossPnL / initialRisk;
  return Math.round(r * 100) / 100;
}
