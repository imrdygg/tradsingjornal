import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Percent,
  Calculator,
  Calendar,
  Filter,
  DollarSign,
  Activity,
  Layers,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Trade, TradingDay, DailyReview, Setup, Instrument } from '../../types';
import { calculateProfitFactor } from '../../lib/analytics/profit-factor';
import { calculateExpectancy } from '../../lib/analytics/expectancy';
import { calculateMaxDrawdown } from '../../lib/analytics/drawdown';
import {
  calculateSessionBreakdown,
  calculateSetupBreakdown,
} from '../../lib/analytics/aggregations';

interface AnalyticsViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
}) => {
  // Filters
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('all');
  const [filterRiskMode, setFilterRiskMode] = useState<string>('all');
  const [filterSession, setFilterSession] = useState<string>('all');
  const [filterSetup, setFilterSetup] = useState<string>('all');

  // Filter closed trades
  const filteredTrades = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'closed');
    const now = new Date().getTime();

    return closed.filter((t) => {
      // Date range
      if (dateRange !== 'all') {
        const tTime = new Date(t.entryTime).getTime();
        const daysAgo = (now - tTime) / (1000 * 60 * 60 * 24);
        if (dateRange === '7d' && daysAgo > 7) return false;
        if (dateRange === '30d' && daysAgo > 30) return false;
      }

      // Session
      if (filterSession !== 'all' && t.session !== filterSession) return false;

      // Setup
      if (filterSetup !== 'all' && t.setupName !== filterSetup) return false;

      // Risk mode filter (check parent day)
      if (filterRiskMode !== 'all') {
        const parentDay = tradingDays.find((d) => d.id === t.tradingDayId);
        if (parentDay && parentDay.riskMode !== filterRiskMode) return false;
      }

      return true;
    });
  }, [trades, tradingDays, dateRange, filterRiskMode, filterSession, filterSetup]);

  // Core Statistics Calculation
  const stats = useMemo(() => {
    const count = filteredTrades.length;
    const netPnL = Math.round(filteredTrades.reduce((s, t) => s + t.grossPnL, 0) * 100) / 100;
    const winners = filteredTrades.filter((t) => t.grossPnL > 0);
    const losers = filteredTrades.filter((t) => t.grossPnL < 0);
    const winRate = count > 0 ? Math.round((winners.length / count) * 1000) / 10 : 0;

    const avgWinner =
      winners.length > 0
        ? Math.round((winners.reduce((s, t) => s + t.grossPnL, 0) / winners.length) * 100) / 100
        : 0;

    const avgLoser =
      losers.length > 0
        ? Math.round((losers.reduce((s, t) => s + t.grossPnL, 0) / losers.length) * 100) / 100
        : 0;

    const profitFactor = calculateProfitFactor(filteredTrades);
    const expectancy = calculateExpectancy(filteredTrades);
    const maxDrawdown = calculateMaxDrawdown(filteredTrades);

    // Average Discipline score from reviews
    const relevantReviews = reviews.filter((r) => {
      if (dateRange === 'all') return true;
      const day = tradingDays.find((d) => d.id === r.tradingDayId);
      if (!day) return true;
      const now = new Date().getTime();
      const dTime = new Date(day.tradeDate).getTime();
      const daysAgo = (now - dTime) / (1000 * 60 * 60 * 24);
      if (dateRange === '7d' && daysAgo > 7) return false;
      if (dateRange === '30d' && daysAgo > 30) return false;
      return true;
    });

    const avgDiscipline =
      relevantReviews.length > 0
        ? Math.round(
            relevantReviews.reduce((sum, r) => sum + r.disciplineScore, 0) / relevantReviews.length
          )
        : 100;

    return {
      count,
      netPnL,
      winRate,
      avgWinner,
      avgLoser,
      profitFactor,
      expectancy,
      maxDrawdown,
      avgDiscipline,
    };
  }, [filteredTrades, reviews, tradingDays, dateRange]);

  // Chart 1: Cumulative P&L Curve
  const cumulativeData = useMemo(() => {
    // Sort trades chronologically
    const sorted = [...filteredTrades].sort(
      (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
    );

    let runningTotal = 0;
    return sorted.map((t, idx) => {
      runningTotal = Math.round((runningTotal + t.grossPnL) * 100) / 100;
      const dateStr = t.entryTime ? t.entryTime.slice(5, 10) : `#${idx + 1}`;
      return {
        index: idx + 1,
        tradeLabel: `${dateStr} (${idx + 1})`,
        cumulativePnL: runningTotal,
        tradePnL: t.grossPnL,
      };
    });
  }, [filteredTrades]);

  // Chart 2: Aggregated by Session
  const sessionData = useMemo(() => {
    const list = calculateSessionBreakdown(filteredTrades);
    return list.map((item) => ({
      name: item.session,
      pnl: item.pnl,
      count: item.tradesCount,
      winRate: item.winRate,
    }));
  }, [filteredTrades]);

  // Chart 3: Aggregated by Setup
  const setupData = useMemo(() => {
    const list = calculateSetupBreakdown(filteredTrades);
    return list.map((item) => ({
      name: item.setupName,
      pnl: item.pnl,
      count: item.tradesCount,
      winRate: item.winRate,
    }));
  }, [filteredTrades]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-zinc-400" />
            Performance & Discipline Analytics
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Objective statistical analysis separating financial returns from strict rule compliance.
          </p>
        </div>

        {/* Date Quick Filter Pills */}
        <div className="flex items-center gap-1 rounded-xl bg-zinc-900 p-1 border border-zinc-800">
          {(['7d', '30d', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1 rounded-lg text-xs font-medium font-mono uppercase transition-all ${
                dateRange === range
                  ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {range === '7d' ? 'Last 7D' : range === '30d' ? 'Last 30D' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Secondary Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
        <div>
          <label className="text-[10px] text-zinc-400 block mb-1">Risk Mode</label>
          <select
            value={filterRiskMode}
            onChange={(e) => setFilterRiskMode(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All Risk Modes</option>
            <option value="normal">Normal Mode</option>
            <option value="expanded">Expanded Mode</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-zinc-400 block mb-1">Session</label>
          <select
            value={filterSession}
            onChange={(e) => setFilterSession(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All Sessions</option>
            <option value="Overnight">Overnight</option>
            <option value="Premarket">Premarket</option>
            <option value="Regular Session">Regular Session</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] text-zinc-400 block mb-1">Setup</label>
          <select
            value={filterSetup}
            onChange={(e) => setFilterSetup(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none"
          >
            <option value="all">All Setups</option>
            {setups.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Core Stats Bento Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Net P&L */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Net Realized P&L
          </span>
          <span
            className={`text-xl font-bold font-mono ${
              stats.netPnL > 0
                ? 'text-emerald-400'
                : stats.netPnL < 0
                ? 'text-rose-400'
                : 'text-zinc-200'
            }`}
          >
            {stats.netPnL > 0 ? '+' : ''}${stats.netPnL.toFixed(2)}
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            {stats.count} closed trades
          </span>
        </div>

        {/* Win Rate */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Win Rate
          </span>
          <span className="text-xl font-bold font-mono text-zinc-100">
            {stats.winRate}%
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            Avg W: +${stats.avgWinner.toFixed(0)} | L: -${Math.abs(stats.avgLoser).toFixed(0)}
          </span>
        </div>

        {/* Profit Factor */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Profit Factor
          </span>
          <span className="text-xl font-bold font-mono text-zinc-100">
            {stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            Gross gains / Gross losses
          </span>
        </div>

        {/* Expectancy */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Expectancy / Trade
          </span>
          <span
            className={`text-xl font-bold font-mono ${
              stats.expectancy !== null && stats.expectancy > 0
                ? 'text-emerald-400'
                : stats.expectancy !== null && stats.expectancy < 0
                ? 'text-rose-400'
                : 'text-zinc-200'
            }`}
          >
            {stats.expectancy !== null
              ? `${stats.expectancy > 0 ? '+' : ''}$${stats.expectancy.toFixed(2)}`
              : '—'}
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            Mathematical edge
          </span>
        </div>

        {/* Max Drawdown ($) */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Max Drawdown ($)
          </span>
          <span className="text-xl font-bold font-mono text-rose-300">
            -${stats.maxDrawdown.toFixed(2)}
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            Peak to trough drop
          </span>
        </div>

        {/* Discipline Score */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Discipline Score
          </span>
          <span
            className={`text-xl font-bold font-mono ${
              stats.avgDiscipline >= 90
                ? 'text-emerald-400'
                : stats.avgDiscipline >= 70
                ? 'text-amber-400'
                : 'text-rose-400'
            }`}
          >
            {stats.avgDiscipline}%
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            Rules followed / applicable
          </span>
        </div>

        {/* Win/Loss Ratio */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Win/Loss Ratio
          </span>
          <span className="text-xl font-bold font-mono text-zinc-100">
            {stats.avgLoser !== 0
              ? (Math.abs(stats.avgWinner) / Math.abs(stats.avgLoser)).toFixed(2)
              : '—'}
            x
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            Avg Win to Avg Loss
          </span>
        </div>

        {/* Closed Trades Count */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
            Closed Positions
          </span>
          <span className="text-xl font-bold font-mono text-zinc-100">
            {stats.count}
          </span>
          <span className="text-[10px] text-zinc-400 font-mono block">
            MES sample size
          </span>
        </div>
      </div>

      {/* Chart 1: Cumulative Equity Curve */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            Cumulative P&L Curve ($)
          </h3>
          <span className="text-[11px] font-mono text-zinc-400">
            {cumulativeData.length} data points
          </span>
        </div>

        {cumulativeData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-zinc-400 text-xs">
            Not enough closed trades to plot equity curve.
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulativeData}>
                <defs>
                  <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="tradeLabel"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                  }}
                  formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Cumulative P&L']}
                />
                <Area
                  type="monotone"
                  dataKey="cumulativePnL"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#pnlGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Grid of Sub-charts: By Session & By Setup */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By Session */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">
            Performance by Session
          </h3>
          {sessionData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-zinc-400 text-xs">
              No session data available.
            </div>
          ) : (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sessionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={10}
                    tickLine={false}
                    tickFormatter={(val) => `$${val}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#27272a',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                    formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Net P&L']}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {sessionData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* By Setup */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">
            Performance by Setup
          </h3>
          {setupData.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-zinc-400 text-xs">
              No setup data available.
            </div>
          ) : (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={setupData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#71717a"
                    fontSize={10}
                    tickLine={false}
                    tickFormatter={(val) => `$${val}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#27272a',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                    formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Net P&L']}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {setupData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
