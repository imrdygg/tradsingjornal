/**
 * Calculate maximum drawdown from cumulative realized P&L.
 * Peak to valley decline in cumulative dollar P&L.
 */
export function calculateMaxDrawdown(trades: { grossPnL: number }[]): number {
  if (!trades.length) return 0;

  let peak = 0;
  let cumulativePnL = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    cumulativePnL += trade.grossPnL;
    if (cumulativePnL > peak) {
      peak = cumulativePnL;
    }
    const currentDrawdown = peak - cumulativePnL;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }
  }

  return Math.round(maxDrawdown * 100) / 100;
}
