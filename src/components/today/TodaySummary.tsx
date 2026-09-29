import React from 'react';
import { TrendingUp, TrendingDown, Shield, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { TierCapStatus } from '../../lib/trading/risk-tiers';

/**
 * The day's own numbers, one row.
 *
 * Deliberately only what the trader's trades produced — P&L, how many, the record, and the
 * limit they are measured against — plus the two things there is always something to do
 * about. The plan's cells (risk mode, lock status) were removed with the plan: a value that
 * can only ever read "planning" is worse than no value at all.
 */
interface TodaySummaryProps {
  realizedPnL: number;
  totalTrades: number;
  wins: number;
  losses: number;
  plannedMaxLoss: number;
  onOpenAddTrade: () => void;
  onOpenEndDay: () => void;
  /**
   * Slots whose cap today's trades have used up, when the day carries any.
   *
   * Computed by the caller from the same day and caps the trade form warns with, so the two
   * can never disagree about the same slot. No plan form sets these any more, but a day
   * imported or saved with caps still reports them.
   */
  capStatuses?: TierCapStatus[];
}

export const TodaySummary: React.FC<TodaySummaryProps> = ({
  realizedPnL,
  totalTrades,
  wins,
  losses,
  plannedMaxLoss,
  onOpenAddTrade,
  onOpenEndDay,
  capStatuses = [],
}) => {
  const pnlColor =
    realizedPnL > 0
      ? 'text-emerald-400'
      : realizedPnL < 0
      ? 'text-rose-400'
      : 'text-zinc-300';

  const pnlSign = realizedPnL > 0 ? '+' : '';

  // Max loss threshold warning
  const isApproachingMaxLoss =
    realizedPnL < 0 && Math.abs(realizedPnL) >= plannedMaxLoss * 0.8;
  const isOverMaxLoss = realizedPnL < 0 && Math.abs(realizedPnL) >= plannedMaxLoss;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 backdrop-blur-sm">
      {/* Risk threshold alert if approaching or breached */}
      {isOverMaxLoss && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-rose-800/80 bg-rose-950/40 p-3 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          <div>
            <strong className="font-semibold">Daily Max Loss Limit Breached: </strong>
            Loss of ${Math.abs(realizedPnL).toFixed(2)} exceeds planned limit of $
            {plannedMaxLoss.toFixed(2)}. Immediate stop recommended.
          </div>
        </div>
      )}

      {isApproachingMaxLoss && !isOverMaxLoss && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <strong className="font-semibold">Max Loss Warning: </strong>
            Loss is currently 80%+ of planned daily max (${plannedMaxLoss.toFixed(2)}). Protect capital.
          </div>
        </div>
      )}

      {/*
        Slots the day has used up.

        Shown here because the summary is what is on screen the moment a trade is saved: the
        plan's cap is decided in the morning and is easy to forget by the third trade.
      */}
      {capStatuses.map((status) => (
        <div
          key={status.tier}
          data-testid={`cap-flag-${status.tier}`}
          data-cap-over={status.over ? 'true' : 'false'}
          role="status"
          className={`mb-4 flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
            status.over
              ? 'border-rose-800/80 bg-rose-950/40 text-rose-200'
              : 'border-amber-800/70 bg-amber-950/30 text-amber-200'
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 shrink-0 ${status.over ? 'text-rose-400' : 'text-amber-400'}`}
          />
          <div>
            <strong className="font-semibold">
              {status.over
                ? `Trade #${status.tier} is over its cap: `
                : `Trade #${status.tier} is full: `}
            </strong>
            {status.over
              ? `${status.used} taken against a plan of ${status.cap}. That slot was meant to be spent.`
              : `${status.used} of ${status.cap} taken.${
                  status.filledByLatest ? ' Your last trade filled it.' : ''
                } No more at #${status.tier} today.`}
          </div>
        </div>
      ))}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-center">
        {/* Realized P&L */}
        <div className="col-span-2 lg:col-span-1 rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 font-mono">
            Realized P&L
          </span>
          <div className={`mt-1 text-xl sm:text-2xl font-bold font-mono tracking-tight ${pnlColor}`}>
            {pnlSign}${realizedPnL.toFixed(2)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
            {realizedPnL > 0 ? (
              <span className="flex items-center text-emerald-400">
                <TrendingUp className="w-3 h-3 mr-0.5 inline" /> In Profit
              </span>
            ) : realizedPnL < 0 ? (
              <span className="flex items-center text-rose-400">
                <TrendingDown className="w-3 h-3 mr-0.5 inline" /> Drawdown
              </span>
            ) : (
              <span>Flat</span>
            )}
          </div>
        </div>

        {/* Total Trades & Record */}
        <div className="rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 font-mono">
            Trades Executed
          </span>
          <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-zinc-100">
            {totalTrades}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400 font-mono">
            <span className="text-emerald-400 font-medium">{wins}W</span>{' '}
            <span className="text-zinc-500">/</span>{' '}
            <span className="text-rose-400 font-medium">{losses}L</span>
          </div>
        </div>

        {/* Planned Max Loss */}
        <div className="rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 font-mono">
            Planned Max Loss
          </span>
          <div className="mt-1 text-xl sm:text-2xl font-bold font-mono text-zinc-100">
            ${plannedMaxLoss.toFixed(0)}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400 font-mono">
            <Shield className="w-3 h-3 text-zinc-400" />
            Hard Daily Stop
          </div>
        </div>

        {/* Actions: Add Trade & the day's review */}
        <div className="col-span-2 lg:col-span-1 flex flex-col gap-2 justify-center">
          <button
            id="today-add-trade-btn"
            onClick={onOpenAddTrade}
            className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-sm transition-all active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            Add Trade
          </button>
          <button
            id="today-end-day-btn"
            onClick={onOpenEndDay}
            title="Write or update the day's review"
            className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-xs font-medium text-zinc-200 transition-all active:scale-[0.98]"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Daily Review
          </button>
        </div>
      </div>
    </div>
  );
};
