import type { Trade } from '../../types';

/**
 * What a trade actually put in the account: net when the journal recorded it, gross otherwise.
 *
 * Fees are real money and a drawdown limit is enforced in real money, so the net figure is
 * the one every account-level reading has to use — the room left, the coach's P&L, the
 * review trend. The trouble with a reader like this is that "roughly net" hides the exact
 * places that disagree, so it lives in one function that everything shares rather than in a
 * copy per caller.
 *
 * Gross is the fallback rather than zero: a trade the journal never recorded a fee for has
 * to be read as though it had none, and a missing number must not silently read as a loss.
 * When net and gross are equal — every hand-recorded trade, which is most of them — the two
 * readings are the same number.
 */
export function realizedPnL(trade: Pick<Trade, 'netPnL' | 'grossPnL'>): number {
  if (typeof trade.netPnL === 'number' && Number.isFinite(trade.netPnL)) return trade.netPnL;
  return Number.isFinite(trade.grossPnL) ? trade.grossPnL : 0;
}
