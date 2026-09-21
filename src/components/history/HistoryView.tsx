import React, { useState, useEffect, useMemo } from 'react';
import {
  History as HistoryIcon,
  Calendar,
  Lock,
  Award,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  X,
  Layers,
  Filter,
  Tag,
} from 'lucide-react';
import { TradingDay, Trade, DailyReview, Setup, Instrument } from '../../types';
import { formatTradingDate, formatTimestamp } from '../../lib/storage/date-utils';
import { dayHasRecordedActivity } from '../../lib/history/day-activity';
import { TradeCard } from '../trades/TradeCard';
import { ModalOverlay } from '../common/ModalOverlay';

/**
 * How many of a day's price levels a card in the list shows.
 *
 * The card is a summary — enough to recognise the day at a glance, not the whole plan. A
 * handful of levels is typical, and a day carrying a dozen (an overnight range marked
 * tick by tick) would otherwise push every other card off the screen.
 */
const LEVELS_ON_CARD = 3;

interface HistoryViewProps {
  tradingDays: TradingDay[];
  trades: Trade[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  /**
   * A day to open in the detail modal on arrival, handed over from the home page's
   * search (a plan/review match has no other place to be read). Consumed by the caller
   * once applied, so it never re-opens a modal the trader already closed.
   */
  focusDayId?: string | null;
  /** Clears the focus request once it has been applied. */
  onConsumeFocusDay?: () => void;
  /** Deletes a trade after the history detail confirms the request. */
  onDeleteTrade: (tradeId: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  tradingDays,
  trades,
  reviews,
  setups,
  instruments,
  focusDayId = null,
  onConsumeFocusDay,
  onDeleteTrade,
}) => {
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  // Filters
  const [filterResult, setFilterResult] = useState<'all' | 'profitable' | 'losing'>('all');
  const [filterRiskMode, setFilterRiskMode] = useState<'all' | 'normal' | 'expanded'>('all');
  const [filterSession, setFilterSession] = useState<string>('all');
  const [filterSetup, setFilterSetup] = useState<string>('all');
  const [filterLevelTag, setFilterLevelTag] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Daily statistics lookup
  const dayStats = useMemo(() => {
    const map = new Map<
      string,
      {
        realizedPnL: number;
        tradeCount: number;
        wins: number;
        losses: number;
        winRate: number;
        review?: DailyReview;
      }
    >();

    for (const day of tradingDays) {
      const dayTrades = trades.filter((t) => t.tradingDayId === day.id && t.status === 'closed');
      const count = dayTrades.length;
      const realizedPnL = Math.round(dayTrades.reduce((s, t) => s + t.grossPnL, 0) * 100) / 100;
      const wins = dayTrades.filter((t) => t.grossPnL > 0).length;
      const losses = dayTrades.filter((t) => t.grossPnL < 0).length;
      const winRate = count > 0 ? Math.round((wins / count) * 1000) / 10 : 0;
      const review = reviews.find((r) => r.tradingDayId === day.id);

      map.set(day.id, {
        realizedPnL,
        tradeCount: count,
        wins,
        losses,
        winRate,
        review,
      });
    }

    return map;
  }, [tradingDays, trades, reviews]);

  /**
   * How many trades each day holds, open and closed together.
   *
   * Counted separately from `dayStats`, which only totals closed trades for the P&L
   * figures: a day whose only trade is still open has a record on it and belongs in the
   * archive, even though its realized P&L is zero.
   */
  const tradesPerDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trade of trades) {
      counts.set(trade.tradingDayId, (counts.get(trade.tradingDayId) ?? 0) + 1);
    }
    return counts;
  }, [trades]);

  /**
   * The days worth archiving at all.
   *
   * The journal keeps a day object for every date the app has been opened on, so an
   * untouched one exists for each of them. Listing those read as traded days that came to
   * nothing, so a day is only offered once something was actually recorded on it.
   */
  const daysWithActivity = useMemo(
    () =>
      tradingDays.filter((day) =>
        dayHasRecordedActivity(day, {
          tradeCount: tradesPerDay.get(day.id) ?? 0,
          review: dayStats.get(day.id)?.review,
        })
      ),
    [tradingDays, tradesPerDay, dayStats]
  );

  const availableLevelTags = useMemo(() => {
    const tags = new Set<string>();
    for (const day of tradingDays) {
      for (const level of day.importantLevels ?? []) {
        for (const tag of level.tags ?? []) {
          const normalized = tag.trim();
          if (normalized) tags.add(normalized);
        }
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [tradingDays]);

  // Filtered days list
  const filteredDays = useMemo(() => {
    return daysWithActivity.filter((day) => {
      const stats = dayStats.get(day.id);
      if (!stats) return false;

      // Date range filter
      if (startDate && day.tradeDate < startDate) return false;
      if (endDate && day.tradeDate > endDate) return false;

      // Risk mode filter
      if (filterRiskMode !== 'all' && day.riskMode !== filterRiskMode) return false;

      // Profitable / losing filter
      if (filterResult === 'profitable' && stats.realizedPnL <= 0) return false;
      if (filterResult === 'losing' && stats.realizedPnL >= 0) return false;

      // Session filter
      if (filterSession !== 'all') {
        const dayTrades = trades.filter((t) => t.tradingDayId === day.id);
        const hasSession = dayTrades.some((t) => t.session === filterSession);
        if (!hasSession) return false;
      }

      // Setup filter
      if (filterSetup !== 'all') {
        const dayTrades = trades.filter((t) => t.tradingDayId === day.id);
        const hasSetup = dayTrades.some((t) => t.setupName === filterSetup);
        if (!hasSetup) return false;
      }

      // Level tag filter. A day matches when at least one of its important levels has the
      // selected tag; tags belong to levels, not to the day's trades.
      if (filterLevelTag !== 'all') {
        const hasLevelTag = (day.importantLevels ?? []).some((level) =>
          (level.tags ?? []).some((tag) => tag.trim() === filterLevelTag)
        );
        if (!hasLevelTag) return false;
      }

      return true;
    });
  }, [
    daysWithActivity,
    dayStats,
    startDate,
    endDate,
    filterRiskMode,
    filterResult,
    filterSession,
    filterSetup,
    filterLevelTag,
    trades,
  ]);

  const selectedDay = useMemo(() => {
    return tradingDays.find((d) => d.id === selectedDayId) || null;
  }, [tradingDays, selectedDayId]);

  // Apply a handed-over day once on arrival. The effect re-runs only when the request
  // changes, and consuming it means a modal the trader closed stays closed.
  useEffect(() => {
    if (!focusDayId) return;
    // A day the journal no longer holds (a reset, or an import without its day) is
    // dropped rather than left pointing at nothing.
    if (tradingDays.some((day) => day.id === focusDayId)) {
      setSelectedDayId(focusDayId);
    }
    onConsumeFocusDay?.();
  }, [focusDayId, tradingDays, onConsumeFocusDay]);

  const selectedDayTrades = useMemo(() => {
    if (!selectedDayId) return [];
    return trades.filter((t) => t.tradingDayId === selectedDayId);
  }, [trades, selectedDayId]);

  const hasActiveFilters =
    filterResult !== 'all' ||
    filterRiskMode !== 'all' ||
    filterSession !== 'all' ||
    filterSetup !== 'all' ||
    filterLevelTag !== 'all' ||
    !!startDate ||
    !!endDate;

  const handleResetFilters = () => {
    setFilterResult('all');
    setFilterRiskMode('all');
    setFilterSession('all');
    setFilterSetup('all');
    setFilterLevelTag('all');
    setStartDate('');
    setEndDate('');
  };

  const handleDeleteTrade = (trade: Trade) => {
    const label = `${trade.direction.toUpperCase()} trade at ${trade.entryPrice.toFixed(2)}`;
    if (window.confirm(`Delete this ${label}? This cannot be undone.`)) {
      onDeleteTrade(trade.id);
    }
  };

  const selectedDayReview = useMemo(() => {
    if (!selectedDayId) return undefined;
    return reviews.find((r) => r.tradingDayId === selectedDayId);
  }, [reviews, selectedDayId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-zinc-400" />
            Trading Day History
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Detailed archive of locked morning plans, mid-day changes, trade executions, and disciplined reviews.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 font-mono font-semibold uppercase">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-zinc-300" />
            Filter Days
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-[10px] normal-case tracking-normal text-zinc-400 hover:text-zinc-200"
            >
              Reset filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-emerald-400" />
              <span>From Date</span>
            </label>
            <div className="relative">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-emerald-400" />
              <span>To Date</span>
            </label>
            <div className="relative">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 font-mono focus:border-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">P&L Outcome</label>
            <select
              value={filterResult}
              onChange={(e) => setFilterResult(e.target.value as 'all' | 'profitable' | 'losing')}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
            >
              <option value="all">All Days</option>
              <option value="profitable">Profitable Days</option>
              <option value="losing">Losing Days</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">Risk Mode</label>
            <select
              value={filterRiskMode}
              onChange={(e) => setFilterRiskMode(e.target.value as 'all' | 'normal' | 'expanded')}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
            >
              <option value="all">All Risk Modes</option>
              <option value="normal">Normal Risk</option>
              <option value="expanded">Expanded Risk</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">Session Traded</label>
            <select
              value={filterSession}
              onChange={(e) => setFilterSession(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
            >
              <option value="all">All Sessions</option>
              <option value="Overnight">Overnight</option>
              <option value="Premarket">Premarket</option>
              <option value="Regular Session">Regular Session</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5">Setup Traded</label>
            <select
              value={filterSetup}
              onChange={(e) => setFilterSetup(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
            >
              <option value="all">All Setups</option>
              {setups.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400 block mb-0.5 flex items-center gap-1">
              <Tag className="w-3 h-3 text-emerald-400" />
              Level Tag
            </label>
            <select
              value={filterLevelTag}
              onChange={(e) => setFilterLevelTag(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
            >
              <option value="all">All Level Tags</option>
              {availableLevelTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Days List */}
      {filteredDays.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-zinc-400 text-xs">
          {daysWithActivity.length === 0
            ? 'Nothing to archive yet. A day appears here once it has a trade, a plan or an end-of-day review — dates you only opened the app on are left out.'
            : 'No historical trading days found matching the specified filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredDays.map((day) => {
            const stats = dayStats.get(day.id);
            const dayLevels = day.importantLevels ?? [];
            const shownLevels = dayLevels.slice(0, LEVELS_ON_CARD);
            const hiddenLevels = dayLevels.length - shownLevels.length;
            const pnl = stats?.realizedPnL || 0;
            const pnlColor =
              pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-zinc-400';
            const pnlSign = pnl > 0 ? '+' : '';

            return (
              <div
                key={day.id}
                onClick={() => setSelectedDayId(day.id)}
                className="group cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-700 hover:bg-zinc-900/80 transition-all space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-zinc-400" />
                    <span className="font-semibold text-sm text-zinc-100 font-mono">
                      {formatTradingDate(day.tradeDate)}
                    </span>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-mono uppercase font-semibold ${
                      day.riskMode === 'expanded'
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {day.riskMode}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-zinc-950/70 border border-zinc-800/80 p-2.5 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-zinc-400 block uppercase">Realized P&L</span>
                    <span className={`font-bold ${pnlColor}`}>
                      {pnlSign}${pnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block uppercase">Trades</span>
                    <span className="text-zinc-200">
                      {stats?.tradeCount || 0} ({stats?.winRate || 0}%)
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block uppercase">Discipline</span>
                    <span className="font-bold text-zinc-200">
                      {stats?.review ? `${stats.review.disciplineScore}%` : '—'}
                    </span>
                  </div>
                </div>

                {/*
                  The prices the day was planned around, each with its own tags.

                  Shown per level rather than as one pooled tag list, because a tag belongs
                  to the level it was put on: pooling "liquidity" from four levels would
                  claim something about all of them. Days with no levels show nothing here.
                */}
                {shownLevels.length > 0 && (
                  <div className="space-y-1 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-2.5">
                    <span className="text-[10px] text-zinc-400 uppercase font-mono flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-zinc-400" />
                      Price levels ({dayLevels.length})
                    </span>
                    {shownLevels.map((level) => (
                      <div
                        key={level.id}
                        className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0"
                      >
                        <span className="font-mono font-bold text-xs text-zinc-200">
                          {level.price.toFixed(2)}
                        </span>
                        {level.label && (
                          <span className="text-[11px] text-zinc-300 truncate max-w-[55%]">
                            {level.label}
                          </span>
                        )}
                        {(level.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-px font-mono text-[9px] text-zinc-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ))}
                    {hiddenLevels > 0 && (
                      <span className="text-[10px] text-zinc-500 font-mono">
                        +{hiddenLevels} more — open the day
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
                  <span className="truncate max-w-[200px]">
                    Bias: <span className="text-zinc-300 capitalize">{day.marketBias}</span>
                  </span>
                  <span className="flex items-center gap-1 text-zinc-400 group-hover:text-zinc-200 transition-colors font-medium">
                    Inspect Day <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Day Details Modal */}
      {selectedDay && (
        <ModalOverlay
          backdropClassName="bg-black/85 backdrop-blur-sm"
          onRequestClose={() => setSelectedDayId(null)}
          label={`Day detail — ${formatTradingDate(selectedDay.tradeDate)}`}
        >
          <div className="relative my-6 w-full max-w-3xl space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-zinc-300" />
                  Day Detail — {formatTradingDate(selectedDay.tradeDate)}
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  Status: {selectedDay.status} • Risk Mode: {selectedDay.riskMode.toUpperCase()} (Max Loss: ${selectedDay.plannedLossLimit})
                </p>
              </div>
              <button
                onClick={() => setSelectedDayId(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 1. Original Morning Plan & Immutable Snapshot */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-zinc-300" />
                  Morning Plan & Original Snapshot
                </span>
                {selectedDay.lockedAt && (
                  <span className="text-[11px] font-mono text-zinc-400">
                    Locked at {formatTimestamp(selectedDay.lockedAt)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div>
                  <span className="text-zinc-400 text-[10px] block">Bias</span>
                  <span className="capitalize text-zinc-200 font-semibold">{selectedDay.marketBias}</span>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] block">Planned Contracts</span>
                  <span className="text-zinc-200 font-semibold">{selectedDay.contractsPlanned}x {selectedDay.primaryInstrument}</span>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] block">Max Loss</span>
                  <span className="text-zinc-200 font-semibold">${selectedDay.plannedLossLimit}</span>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] block">Sessions</span>
                  <span className="text-zinc-200">{selectedDay.allowedSessions?.join(', ')}</span>
                </div>
              </div>

              {(selectedDay.waitingFor || selectedDay.stayOutIf) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/60 text-xs">
                  {selectedDay.waitingFor && (
                    <div>
                      <span className="text-zinc-400 text-[11px] font-medium block">Waiting for:</span>
                      <p className="text-zinc-200 italic mt-0.5">{selectedDay.waitingFor}</p>
                    </div>
                  )}
                  {selectedDay.stayOutIf && (
                    <div>
                      <span className="text-zinc-400 text-[11px] font-medium block">Stay out if:</span>
                      <p className="text-zinc-200 italic mt-0.5">{selectedDay.stayOutIf}</p>
                    </div>
                  )}
                </div>
              )}

              {/*
                The prices the plan was built around, tags and all.

                Shown only when the day actually has levels: most days have none, and a
                line saying so on every one of them would be noise in an archive. Styled
                like the lock preview so a level reads the same wherever it is met.
              */}
              {(selectedDay.importantLevels ?? []).length > 0 && (
                <div className="pt-2 border-t border-zinc-800/60">
                  <span className="text-zinc-400 text-[10px] uppercase font-mono flex items-center gap-1.5">
                    <Tag className="w-3 h-3 text-zinc-400" />
                    Important price levels ({(selectedDay.importantLevels ?? []).length})
                  </span>
                  <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {(selectedDay.importantLevels ?? []).map((level) => (
                      <li
                        key={level.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]"
                      >
                        <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono font-bold text-zinc-100">
                          {level.price.toFixed(2)}
                        </span>
                        {level.label && (
                          <span className="text-zinc-300 truncate">{level.label}</span>
                        )}
                        {(level.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                          >
                            {tag}
                          </span>
                        ))}
                        {level.notes && (
                          <span className="text-zinc-500 italic truncate">— {level.notes}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Plan changes audit list */}
              {selectedDay.planChanges && selectedDay.planChanges.length > 0 && (
                <div className="pt-2 border-t border-zinc-800/60 space-y-1.5">
                  <span className="text-[11px] font-semibold text-amber-300 uppercase font-mono block">
                    Recorded Plan Changes ({selectedDay.planChanges.length})
                  </span>
                  {selectedDay.planChanges.map((c) => (
                    <div key={c.id} className="text-xs text-zinc-300 bg-zinc-900/80 p-2 rounded-lg">
                      <span className="font-semibold text-zinc-100">{c.fieldName}</span> changed from{' '}
                      <span className="text-rose-300 font-mono">{c.oldValue}</span> to{' '}
                      <span className="text-emerald-300 font-mono">{c.newValue}</span> at{' '}
                      <span className="text-zinc-400 font-mono">{formatTimestamp(c.changedAt)}</span>.
                      <p className="text-zinc-400 italic text-[11px] mt-0.5">Reason: "{c.reason}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Executed Trades for Day */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-zinc-300" />
                Trades Executed ({selectedDayTrades.length})
              </span>
              {selectedDayTrades.length === 0 ? (
                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 text-xs text-zinc-400 text-center">
                  No trades were recorded for this trading day.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {selectedDayTrades.map((t) => (
                    <TradeCard
                      key={t.id}
                      trade={t}
                      instruments={instruments}
                      onDelete={() => handleDeleteTrade(t)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 3. Daily Review Reflections & Score */}
            {selectedDayReview && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    End-of-Day Execution Review
                  </span>
                  <span className="font-mono text-xs font-bold text-amber-300">
                    Discipline Score: {selectedDayReview.disciplineScore}%
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-zinc-400 font-semibold block">What did I do well?</span>
                    <p className="text-zinc-200 mt-0.5">{selectedDayReview.didWell}</p>
                  </div>
                  <div>
                    <span className="text-zinc-400 font-semibold block">What did I do poorly?</span>
                    <p className="text-zinc-200 mt-0.5">{selectedDayReview.didPoorly}</p>
                  </div>
                  <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2.5">
                    <span className="text-amber-300 font-semibold block">Tomorrow's Focus:</span>
                    <p className="text-amber-100 italic mt-0.5 font-medium">
                      "{selectedDayReview.tomorrowFocus}"
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};
