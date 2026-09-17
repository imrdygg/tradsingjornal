/**
 * Profit Factor: gross profits / abs(gross losses)
 * Returns number, or null if no losing trades (to avoid division by zero or represent infinite).
 */
export function calculateProfitFactor(trades: { grossPnL: number }[]): number | null {
  if (!trades.length) return null;

  let grossProfits = 0;
  let grossLosses = 0;

  for (const trade of trades) {
    if (trade.grossPnL > 0) {
      grossProfits += trade.grossPnL;
    } else if (trade.grossPnL < 0) {
      grossLosses += Math.abs(trade.grossPnL);
    }
  }

  if (grossLosses === 0) {
    return grossProfits > 0 ? Infinity : 0;
  }

  return Math.round((grossProfits / grossLosses) * 100) / 100;
}
