import React, { useState, useMemo } from 'react';
import {
  Plus,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Target,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Percent,
  ImageIcon,
} from 'lucide-react';
import { Trade, TradingDay, Setup, Instrument } from '../../types';
import { TradeCard } from './TradeCard';
import { CoachEntryCallBadge } from './CoachEntryCallBadge';
import { calculateTradeRuleFollowing } from '../../lib/analytics/discipline';
import { formatTimestamp } from '../../lib/storage/date-utils';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { buildPositionGroups, findPositionGroup } from '../../lib/trading/position-groups';
import { hasAssumedRisk } from '../../lib/trading/risk-fixup';
import { instrumentSymbol } from '../../lib/trading/instruments';

interface TradesViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  setups: Setup[];
  instruments: Instrument[];
  onOpenAddTrade: () => void;
  /** Opens the full detail view for a trade. */
  onViewTrade: (trade: Trade) => void;
  onEditTrade: (trade: Trade) => void;
  onCloseTrade: (trade: Trade) => void;
  onDeleteTrade: (tradeId: string) => void;
}

export const TradesView: React.FC<TradesViewProps> = ({
  trades,
  tradingDays,
  setups,
  instruments,
  onOpenAddTrade,
  onViewTrade,
  onEditTrade,
  onCloseTrade,
  onDeleteTrade,
}) => {
  // Filters state
  const [filterSession, setFilterSession] = useState<string>('all');
  const [filterDirection, setFilterDirection] = useState<string>('all');
  const [filterSetup, setFilterSetup] = useState<string>('all');
  const [filterOutcome, setFilterOutcome] = useState<string>('all');
  const [filterInstrument, setFilterInstrument] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [tableLightbox, setTableLightbox] = useState<{
    images: string[];
    initialIndex?: number;
    title: string;
    subtitle?: string;
  } | null>(null);

  // Scale-in legs are grouped so each row can show the blended entry and size of
  // the position it belongs to. Built from ALL trades, not the filtered set, so
  // the average stays correct while filters are applied.
  const positionGroups = useMemo(() => buildPositionGroups(trades), [trades]);

  // Collect all unique setups (from configured setups list + any setups present in recorded trades)
  const availableSetups = useMemo(() => {
    const names = new Set<string>();
    setups.forEach((s) => {
      if (s.name && s.name.trim()) names.add(s.name.trim());
    });
    trades.forEach((t) => {
      if (t.setupName && t.setupName.trim()) names.add(t.setupName.trim());
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [setups, trades]);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (filterSession !== 'all' && t.session !== filterSession) return false;
      if (filterDirection !== 'all' && t.direction !== filterDirection) return false;
      if (filterSetup !== 'all' && t.setupName !== filterSetup) return false;
      if (filterInstrument !== 'all' && t.instrumentId !== filterInstrument) return false;
      if (filterDate && !t.entryTime.startsWith(filterDate)) return false;

      if (filterOutcome === 'winners' && (t.status !== 'closed' || t.grossPnL <= 0))
        return false;
      if (filterOutcome === 'losers' && (t.status !== 'closed' || t.grossPnL >= 0))
        return false;
      if (filterOutcome === 'open' && t.status !== 'open') return false;

      return true;
    });
  }, [
    trades,
    filterSession,
    filterDirection,
    filterSetup,
    filterOutcome,
    filterInstrument,
    filterDate,
  ]);

  const totalRealized = useMemo(() => {
    return (
      Math.round(
        filteredTrades
          .filter((t) => t.status === 'closed')
          .reduce((sum, t) => sum + t.grossPnL, 0) * 100
      ) / 100
    );
  }, [filteredTrades]);

  // Strategy performance isolated metrics for the selected setup
  const strategyStats = useMemo(() => {
    if (filterSetup === 'all') return null;

    const setupTrades = trades.filter((t) => t.setupName === filterSetup);
    const closed = setupTrades.filter((t) => t.status === 'closed');
    const winners = closed.filter((t) => t.grossPnL > 0);
    const losers = closed.filter((t) => t.grossPnL < 0);
    const totalPnL = Math.round(closed.reduce((acc, t) => acc + t.grossPnL, 0) * 100) / 100;
    const winRate = closed.length > 0 ? Math.round((winners.length / closed.length) * 100) : 0;

    const grossGains = winners.reduce((acc, t) => acc + t.grossPnL, 0);
    const grossLosses = Math.abs(losers.reduce((acc, t) => acc + t.grossPnL, 0));
    const profitFactor =
      grossLosses > 0
        ? Math.round((grossGains / grossLosses) * 100) / 100
        : grossGains > 0
        ? Infinity
        : null;

    const avgWin = winners.length > 0 ? Math.round((grossGains / winners.length) * 100) / 100 : 0;
    const avgLoss = losers.length > 0 ? Math.round((grossLosses / losers.length) * 100) / 100 : 0;

    const rValues = closed
      .filter((t) => typeof t.rMultiple === 'number' && !isNaN(t.rMultiple))
      .map((t) => t.rMultiple as number);
    const avgR =
      rValues.length > 0
        ? Math.round((rValues.reduce((a, b) => a + b, 0) / rValues.length) * 100) / 100
        : null;

    const reviewed = setupTrades.filter((t) => t.executionReview);
    let avgDiscipline: number | null = null;
    if (reviewed.length > 0) {
      const sumScore = reviewed.reduce((acc, t) => {
        const rf = calculateTradeRuleFollowing(t.executionReview);
        return acc + (rf ? rf.score : 100);
      }, 0);
      avgDiscipline = Math.round(sumScore / reviewed.length);
    }

    return {
      setupName: filterSetup,
      totalTrades: setupTrades.length,
      closedTrades: closed.length,
      openTrades: setupTrades.length - closed.length,
      totalPnL,
      winRate,
      winnersCount: winners.length,
      losersCount: losers.length,
      profitFactor,
      avgWin,
      avgLoss,
      avgR,
      avgDiscipline,
    };
  }, [filterSetup, trades]);

  // Overall metrics across all trades for default summary state
  const allTradesStats = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'closed');
    const winners = closed.filter((t) => t.grossPnL > 0);
    const losers = closed.filter((t) => t.grossPnL < 0);
    const totalPnL = Math.round(closed.reduce((acc, t) => acc + t.grossPnL, 0) * 100) / 100;
    const winRate = closed.length > 0 ? Math.round((winners.length / closed.length) * 100) : 0;
    return {
      winRate,
      totalPnL,
      winnersCount: winners.length,
      losersCount: losers.length,
      closedCount: closed.length,
      totalCount: trades.length,
    };
  }, [trades]);

  const hasActiveFilters =
    filterSession !== 'all' ||
    filterDirection !== 'all' ||
    filterSetup !== 'all' ||
    filterOutcome !== 'all' ||
    filterInstrument !== 'all' ||
    !!filterDate;

  const handleResetFilters = () => {
    setFilterSession('all');
    setFilterDirection('all');
    setFilterSetup('all');
    setFilterOutcome('all');
    setFilterInstrument('all');
    setFilterDate('');
  };

  const currentSetupPnL =
    filterSetup !== 'all' ? strategyStats?.totalPnL || 0 : allTradesStats.totalPnL;
  const currentSetupWinRate =
    filterSetup !== 'all' ? strategyStats?.winRate || 0 : allTradesStats.winRate;

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-zinc-400" />
            Trade Log
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Showing {filteredTrades.length} of {trades.length} recorded trade{trades.length === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right font-mono hidden sm:block">
            <span className="text-[10px] text-zinc-400 uppercase block">Filtered P&L</span>
            <span
              className={`text-sm font-bold ${
                totalRealized > 0
                  ? 'text-emerald-400'
                  : totalRealized < 0
                  ? 'text-rose-400'
                  : 'text-zinc-300'
              }`}
            >
              {totalRealized > 0 ? '+' : ''}${totalRealized.toFixed(2)}
            </span>
          </div>

          <button
            onClick={onOpenAddTrade}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            Add Trade
          </button>
        </div>
      </div>

      {/* Small Summary Header: Performance Feedback for Currently Filtered Setup */}
      <div
        id="trades-setup-summary-header"
        className={`rounded-2xl border p-3.5 transition-all ${
          filterSetup !== 'all'
            ? 'border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-zinc-900/80 to-zinc-900/60 shadow-sm'
            : 'border-zinc-800 bg-zinc-900/50'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Setup Identity & Feedback Status */}
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl border flex items-center justify-center ${
                filterSetup !== 'all'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-400'
              }`}
            >
              <Target className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                  {filterSetup !== 'all' ? 'Filtered Setup Summary' : 'Setup Performance Summary'}
                </span>
                {filterSetup !== 'all' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 font-mono text-xs font-bold">
                    {filterSetup}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-xs font-medium">
                    All Setups
                  </span>
                )}
                {filterSetup !== 'all' && strategyStats && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 font-mono uppercase font-bold rounded ${
                      strategyStats.totalPnL > 0
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : strategyStats.totalPnL < 0
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {strategyStats.totalPnL > 0
                      ? 'Profitable Edge'
                      : strategyStats.totalPnL < 0
                      ? 'Drawdown'
                      : 'Flat'}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {filterSetup !== 'all' && strategyStats
                  ? `Immediate feedback: ${strategyStats.totalTrades} trade${
                      strategyStats.totalTrades === 1 ? '' : 's'
                    } recorded (${strategyStats.closedTrades} closed, ${strategyStats.openTrades} open)`
                  : 'Instant performance feedback across all trade setups. Select any setup below to isolate.'}
              </p>
            </div>
          </div>

          {/* Quick Metrics: Total Win Rate & Net Realized P&L */}
          <div className="flex items-center gap-4 sm:gap-6 font-mono">
            {/* Total Win Rate */}
            <div className="text-right">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Total Win Rate
              </span>
              <span className="text-base sm:text-lg font-bold text-zinc-100 flex items-center justify-end gap-0.5">
                {currentSetupWinRate}%
              </span>
              <span className="text-[10px] text-zinc-400 block">
                {filterSetup !== 'all'
                  ? `${strategyStats?.winnersCount || 0}W - ${strategyStats?.losersCount || 0}L`
                  : `${allTradesStats.winnersCount}W - ${allTradesStats.losersCount}L`}
              </span>
            </div>

            <div className="h-8 w-px bg-zinc-800" />

            {/* Net P&L */}
            <div className="text-right">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Net P&L
              </span>
              <span
                className={`text-base sm:text-lg font-bold ${
                  currentSetupPnL > 0
                    ? 'text-emerald-400'
                    : currentSetupPnL < 0
                    ? 'text-rose-400'
                    : 'text-zinc-300'
                }`}
              >
                {currentSetupPnL > 0 ? '+' : currentSetupPnL < 0 ? '-' : ''}$
                {Math.abs(currentSetupPnL).toFixed(2)}
              </span>
              <span className="text-[10px] text-zinc-400 block">
                {filterSetup !== 'all'
                  ? `${strategyStats?.closedTrades || 0} closed`
                  : `${allTradesStats.closedCount} closed`}
              </span>
            </div>

            {filterSetup !== 'all' && (
              <button
                onClick={() => setFilterSetup('all')}
                className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded-lg border border-zinc-800 bg-zinc-950/60 hover:bg-zinc-800 transition-colors ml-1"
                title="Reset setup filter to show all setups"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Quick Setup Selector Chips */}
        {availableSetups.length > 0 && (
          <div className="mt-2.5 pt-2.5 border-t border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono scrollbar-none">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 whitespace-nowrap mr-1">
              Quick Setup:
            </span>
            <button
              onClick={() => setFilterSetup('all')}
              className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors ${
                filterSetup === 'all'
                  ? 'bg-zinc-200 text-zinc-950 font-bold'
                  : 'bg-zinc-950/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              All Setups
            </button>
            {availableSetups.map((sName) => {
              const isSelected = filterSetup === sName;
              const count = trades.filter((t) => t.setupName === sName).length;
              return (
                <button
                  key={sName}
                  onClick={() => setFilterSetup(sName)}
                  className={`px-2 py-0.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1 ${
                    isSelected
                      ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-600/70 shadow-sm'
                      : 'bg-zinc-950/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                  }`}
                >
                  <span>{sName}</span>
                  <span
                    className={`text-[9px] px-1 rounded ${
                      isSelected ? 'bg-emerald-900/60 text-emerald-200' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-3">
        <div className="flex items-center justify-between text-xs text-zinc-400 font-mono font-semibold">
          <div className="flex items-center gap-1.5 uppercase">
            <Filter className="w-3.5 h-3.5 text-zinc-300" />
            Filter Trade History
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset all filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* Setup Filter Dropdown */}
          <div className="col-span-2 sm:col-span-1 lg:col-span-2">
            <label
              htmlFor="trades-setup-filter"
              className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1 flex items-center justify-between"
            >
              <span className="flex items-center gap-1">
                <Target className="w-3 h-3 text-zinc-300" />
                Setup / Strategy
              </span>
              {filterSetup !== 'all' && (
                <span className="text-[10px] text-emerald-400 lowercase font-normal">filtered</span>
              )}
            </label>
            <select
              id="trades-setup-filter"
              value={filterSetup}
              onChange={(e) => setFilterSetup(e.target.value)}
              className={`w-full rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none transition-colors ${
                filterSetup !== 'all'
                  ? 'border-emerald-600/80 bg-zinc-950 text-emerald-300 font-semibold ring-1 ring-emerald-500/30'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-200 focus:border-zinc-600'
              }`}
            >
              <option value="all">All Setups ({trades.length})</option>
              {availableSetups.map((name) => {
                const count = trades.filter((t) => t.setupName === name).length;
                return (
                  <option key={name} value={name}>
                    {name} ({count})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Session Filter */}
          <div>
            <label
              htmlFor="trades-session-filter"
              className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1"
            >
              Session
            </label>
            <select
              id="trades-session-filter"
              value={filterSession}
              onChange={(e) => setFilterSession(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
            >
              <option value="all">All Sessions</option>
              <option value="Overnight">Overnight</option>
              <option value="Premarket">Premarket</option>
              <option value="Regular Session">Regular Session</option>
            </select>
          </div>

          {/* Direction Filter */}
          <div>
            <label
              htmlFor="trades-direction-filter"
              className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1"
            >
              Direction
            </label>
            <select
              id="trades-direction-filter"
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
            >
              <option value="all">All Directions</option>
              <option value="long">Long Only</option>
              <option value="short">Short Only</option>
            </select>
          </div>

          {/* Outcome Filter */}
          <div>
            <label
              htmlFor="trades-outcome-filter"
              className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1"
            >
              Outcome
            </label>
            <select
              id="trades-outcome-filter"
              value={filterOutcome}
              onChange={(e) => setFilterOutcome(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
            >
              <option value="all">All Outcomes</option>
              <option value="winners">Winners Only</option>
              <option value="losers">Losers Only</option>
              <option value="open">Open Positions</option>
            </select>
          </div>

          {/* Date Filter */}
          <div>
            <label
              htmlFor="trades-date-filter"
              className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1"
            >
              Trade Date
            </label>
            <input
              id="trades-date-filter"
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Strategy Isolated Performance Spotlight Banner */}
      {strategyStats && (
        <div className="rounded-2xl border border-emerald-900/60 bg-gradient-to-r from-emerald-950/30 via-zinc-900/60 to-zinc-900/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                Isolated Strategy Performance
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 font-bold text-xs">
                {strategyStats.setupName}
              </span>
            </div>

            <button
              onClick={() => setFilterSetup('all')}
              className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
            >
              Show All Setups
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
            {/* Net P&L */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Realized P&L
              </span>
              <span
                className={`text-base font-bold font-mono ${
                  strategyStats.totalPnL > 0
                    ? 'text-emerald-400'
                    : strategyStats.totalPnL < 0
                    ? 'text-rose-400'
                    : 'text-zinc-300'
                }`}
              >
                {strategyStats.totalPnL > 0 ? '+' : ''}${strategyStats.totalPnL.toFixed(2)}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                {strategyStats.closedTrades} closed trade{strategyStats.closedTrades === 1 ? '' : 's'}
              </span>
            </div>

            {/* Win Rate */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Win Rate
              </span>
              <span className="text-base font-bold font-mono text-zinc-100">
                {strategyStats.winRate}%
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                {strategyStats.winnersCount}W - {strategyStats.losersCount}L
              </span>
            </div>

            {/* Profit Factor */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Profit Factor
              </span>
              <span className="text-base font-bold font-mono text-zinc-100">
                {strategyStats.profitFactor === null
                  ? '—'
                  : strategyStats.profitFactor === Infinity
                  ? '∞'
                  : `${strategyStats.profitFactor.toFixed(2)}`}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                Gains / Losses
              </span>
            </div>

            {/* Avg Win / Avg Loss */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Avg Win / Loss
              </span>
              <span className="text-base font-bold font-mono text-zinc-100">
                +${strategyStats.avgWin.toFixed(0)} / -${strategyStats.avgLoss.toFixed(0)}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                Win-to-loss size
              </span>
            </div>

            {/* Average R */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Avg R-Multiple
              </span>
              <span
                className={`text-base font-bold font-mono ${
                  strategyStats.avgR !== null && strategyStats.avgR > 0
                    ? 'text-emerald-400'
                    : strategyStats.avgR !== null && strategyStats.avgR < 0
                    ? 'text-rose-400'
                    : 'text-zinc-300'
                }`}
              >
                {strategyStats.avgR !== null
                  ? `${strategyStats.avgR > 0 ? '+' : ''}${strategyStats.avgR.toFixed(2)}R`
                  : '—'}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                Risk-adjusted return
              </span>
            </div>

            {/* Discipline Score */}
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Discipline
              </span>
              <span
                className={`text-base font-bold font-mono ${
                  strategyStats.avgDiscipline !== null && strategyStats.avgDiscipline >= 90
                    ? 'text-emerald-400'
                    : strategyStats.avgDiscipline !== null && strategyStats.avgDiscipline >= 70
                    ? 'text-amber-400'
                    : strategyStats.avgDiscipline !== null
                    ? 'text-rose-400'
                    : 'text-zinc-400'
                }`}
              >
                {strategyStats.avgDiscipline !== null ? `${strategyStats.avgDiscipline}%` : '—'}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                Execution adherence
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Trades Container */}
      {filteredTrades.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center space-y-3">
          <Clock className="w-8 h-8 text-zinc-400 mx-auto" />
          <h3 className="text-sm font-semibold text-zinc-300">No trades matching criteria</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            {filterSetup !== 'all'
              ? `No trades found for setup "${filterSetup}". Adjust your filters or log a trade using this setup.`
              : 'Try adjusting your filters or record a new trade to begin tracking execution facts.'}
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 text-xs font-medium hover:bg-zinc-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset Filters
              </button>
            )}
            <button
              onClick={onOpenAddTrade}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Record Trade
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Mobile view: Cards */}
          <div className="block lg:hidden space-y-3">
            {filteredTrades.map((t) => (
              <TradeCard
                key={t.id}
                trade={t}
                instruments={instruments}
                positionGroup={findPositionGroup(positionGroups, t)}
                onView={onViewTrade}
                onEdit={onEditTrade}
                onCloseTrade={onCloseTrade}
                onDelete={onDeleteTrade}
              />
            ))}
          </div>

          {/* Desktop view: Structured Table */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/40">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/70 text-zinc-400 font-mono uppercase text-[11px]">
                  <th className="py-3 px-3">Date / Time</th>
                  <th className="py-3 px-3">Symbol</th>
                  <th className="py-3 px-3">Dir</th>
                  <th className="py-3 px-3">Session</th>
                  <th className="py-3 px-3">Setup</th>
                  <th className="py-3 px-3 text-right">Entry</th>
                  <th className="py-3 px-3 text-right">Stop</th>
                  <th className="py-3 px-3 text-right">Exit</th>
                  <th className="py-3 px-3 text-right">Qty</th>
                  <th className="py-3 px-3">Position</th>
                  <th className="py-3 px-3 text-right">Initial Risk</th>
                  <th className="py-3 px-3 text-right">Gross P&L</th>
                  <th className="py-3 px-3 text-right">R</th>
                  <th className="py-3 px-3 text-center">Discipline</th>
                  <th className="py-3 px-3 text-center">Chart</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {filteredTrades.map((t) => {
                  const isLong = t.direction === 'long';
                  const isClosed = t.status === 'closed';
                  const position = findPositionGroup(positionGroups, t);
                  const tradeImages =
                    t.images && t.images.length > 0
                      ? t.images
                      : t.screenshotPath
                      ? [t.screenshotPath]
                      : [];
                  const pnlColor =
                    t.grossPnL > 0
                      ? 'text-emerald-400'
                      : t.grossPnL < 0
                      ? 'text-rose-400'
                      : 'text-zinc-400';

                  const ruleFollowing = calculateTradeRuleFollowing(t.executionReview);

                  return (
                    <tr
                      key={t.id}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest('button, a, video, input, select, label')) return;
                        onViewTrade(t);
                      }}
                      className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      title="Click a row to open the full trade record"
                    >
                      <td className="py-2.5 px-3 text-zinc-400 text-[11px]">
                        {formatTimestamp(t.entryTime)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-zinc-100">
                        {instrumentSymbol(instruments, t.instrumentId)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            isLong
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                              : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                          }`}
                        >
                          {isLong ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          {t.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-zinc-300">
                        {t.session}
                      </td>
                      <td className="py-2.5 px-3 font-sans">
                        <button
                          type="button"
                          onClick={() => setFilterSetup(t.setupName || 'all')}
                          className={`hover:underline text-left ${
                            filterSetup === t.setupName
                              ? 'text-emerald-400 font-semibold'
                              : 'text-zinc-300'
                          }`}
                          title={`Click to filter by ${t.setupName || 'setup'}`}
                        >
                          {t.setupName || '—'}
                        </button>
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-200">
                        <div>{t.entryPrice.toFixed(2)}</div>
                        {/* The coach's own call at entry, right beside the fill it is
                            compared with. Renders nothing when there was no call. */}
                        <CoachEntryCallBadge trade={t} align="right" className="mt-1" />
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-400">
                        {t.initialStop.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-200">
                        {t.exitPrice !== undefined && t.exitPrice !== null
                          ? t.exitPrice.toFixed(2)
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-300">
                        {t.contracts}
                      </td>
                      <td className="py-2.5 px-3">
                        {position ? (
                          <div className="leading-tight">
                            <div className="text-emerald-300 font-semibold whitespace-nowrap">
                              {position.totalContracts}{' '}
                              {instrumentSymbol(instruments, t.instrumentId)}
                              {position.legCount > 1 ? ' total' : ''}
                            </div>
                            <div className="text-[10px] text-zinc-400 whitespace-nowrap">
                              avg {position.averageEntry.toFixed(2)}
                              {position.legCount > 1
                                ? ` · ${position.legIndex(t.id)}/${position.legCount} legs`
                                : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-300">
                        ${t.initialRisk.toFixed(2)}
                        {hasAssumedRisk(t) && (
                          <span
                            data-assumed-risk="true"
                            title="Imported from a CSV, which has no stop price. Set the real stop in Settings → Fix imported risk."
                            className="ml-1.5 align-middle rounded border border-amber-800 bg-amber-950/60 px-1 py-px text-[9px] font-mono uppercase text-amber-300"
                          >
                            assumed
                          </span>
                        )}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-bold ${pnlColor}`}>
                        {isClosed
                          ? `${t.grossPnL > 0 ? '+' : ''}$${t.grossPnL.toFixed(2)}`
                          : 'Open'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-300">
                        {isClosed && t.rMultiple !== undefined
                          ? `${t.rMultiple > 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {ruleFollowing ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                              ruleFollowing.followedAll
                                ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800'
                                : 'bg-amber-950/70 text-amber-300 border border-amber-800'
                            }`}
                          >
                            {ruleFollowing.followedAll ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <AlertTriangle className="w-3 h-3" />
                            )}
                            {ruleFollowing.score}%
                          </span>
                        ) : isClosed ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewTrade(t);
                            }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-900/70 hover:bg-amber-900/50 font-mono whitespace-nowrap"
                            title="No execution review yet — open the trade to complete it"
                          >
                            Review pending
                          </button>
                        ) : (
                          <span className="text-[10px] text-zinc-400">In play</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {tradeImages.length > 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setTableLightbox({
                                images: tradeImages,
                                initialIndex: 0,
                                title: `${t.direction.toUpperCase()} ${instrumentSymbol(
                                  instruments,
                                  t.instrumentId
                                )} @ ${t.entryPrice.toFixed(2)}`,
                                subtitle: `${t.session} • ${t.setupName || 'Setup'} (${tradeImages.length} chart${tradeImages.length > 1 ? 's' : ''})`,
                              })
                            }
                            className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-300 hover:text-emerald-300 border border-zinc-700/70 hover:border-emerald-600/70 text-[11px] font-sans transition-all"
                            title="Click to view chart screenshot full-size"
                          >
                            <ImageIcon className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                            <span className="font-mono text-[10px]">{tradeImages.length}</span>
                          </button>
                        ) : (
                          <span className="text-zinc-600 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-sans">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewTrade(t);
                            }}
                            className="text-emerald-300 hover:text-emerald-200 px-1.5 py-0.5 rounded hover:bg-zinc-800 font-medium"
                            title="Open the full trade record"
                          >
                            View
                          </button>
                          {!isClosed && (
                            <button
                              onClick={() => onCloseTrade(t)}
                              className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-medium border border-emerald-800/80"
                            >
                              Close
                            </button>
                          )}
                          <button
                            onClick={() => onEditTrade(t)}
                            className="text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded hover:bg-zinc-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onDeleteTrade(t.id)}
                            className="text-zinc-400 hover:text-rose-400 px-1.5 py-0.5 rounded hover:bg-zinc-800"
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Lightbox for seeing table chart big */}
      {tableLightbox && (
        <ImageLightboxModal
          isOpen={true}
          onClose={() => setTableLightbox(null)}
          images={tableLightbox.images}
          initialIndex={tableLightbox.initialIndex || 0}
          title={tableLightbox.title}
          subtitle={tableLightbox.subtitle}
        />
      )}
    </div>
  );
};
