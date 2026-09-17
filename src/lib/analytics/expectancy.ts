/**
 * Expectancy per trade:
 * (win_rate * avg_win) - (loss_rate * abs(avg_loss))
 *
 * Uses completed realized trades only.
 */
export function calculateExpectancy(trades: { grossPnL: number }[]): number | null {
  if (!trades.length) return null;

  const winners = trades.filter((t) => t.grossPnL > 0);
  const losers = trades.filter((t) => t.grossPnL < 0);

  if (winners.length === 0 && losers.length === 0) return 0;

  const winRate = winners.length / trades.length;
  const lossRate = losers.length / trades.length;

  const avgWin = winners.length > 0
    ? winners.reduce((acc, t) => acc + t.grossPnL, 0) / winners.length
    : 0;

  const avgLoss = losers.length > 0
    ? Math.abs(losers.reduce((acc, t) => acc + t.grossPnL, 0) / losers.length)
    : 0;

  const expectancy = (winRate * avgWin) - (lossRate * avgLoss);
  return Math.round(expectancy * 100) / 100;
}
