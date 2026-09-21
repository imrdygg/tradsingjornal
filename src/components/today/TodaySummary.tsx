import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Shield,
  Lock,
  Plus,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { DayStatus, RiskMode } from '../../types';
import type { TierCapStatus } from '../../lib/trading/risk-tiers';

interface TodaySummaryProps {
  realizedPnL: number;
  totalTrades: number;
  wins: number;
  losses: number;
  plannedMaxLoss: number;
  riskMode: RiskMode;
  planStatus: DayStatus;
  onOpenAddTrade: () => void;
  onOpenEndDay: () => void;
  isPlanLocked: boolean;
  /**
   * Slots whose cap today's trades have used up, when the plan set any.
   *
   * Computed by the caller from the same day and caps the trade form warns with, so the two
   * can never disagree about the same slot.
   */
  capStatuses?: TierCapStatus[];
}

export const TodaySummary: React.FC<TodaySummaryProps> = ({
  realizedPnL,
  totalTrades,
  wins,
  losses,
  plannedMaxLoss,
  riskMode,
  planStatus,
  onOpenAddTrade,
  onOpenEndDay,
  isPlanLocked,
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 items-center">
        {/* Realized P&L */}
        <div className="col-span-2 sm:col-span-1 rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-3.5">
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

        {/* Risk Mode */}
        <div className="rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 font-mono">
            Risk Mode
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                riskMode === 'expanded'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                  : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
              }`}
            >
              {riskMode}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-400 truncate">
            {riskMode === 'expanded' ? 'Written reason set' : 'Standard limits'}
          </div>
        </div>

        {/* Plan Status */}
        <div className="rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-3.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 font-mono">
            Plan Status
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            {isPlanLocked ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800">
                <Lock className="w-3 h-3" /> Locked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                Planning
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400 capitalize">
            Day: {planStatus}
          </div>
        </div>

        {/* Actions: Add Trade & End Day */}
        <div className="col-span-2 sm:col-span-1 lg:col-span-1 flex flex-col gap-2 justify-center">
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
            className={`flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl text-xs font-medium border transition-all active:scale-[0.98] ${
              planStatus === 'completed'
                ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-300 hover:bg-emerald-950/60'
                : 'bg-zinc-800 hover:bg-zinc-750 border-zinc-700 text-zinc-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {planStatus === 'completed' ? 'Review Saved' : 'End Trading Day'}
          </button>
        </div>
      </div>
    </div>
  );
};
