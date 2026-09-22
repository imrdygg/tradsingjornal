import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Scale,
  Target,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  LineChart,
  ComposedChart,
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
import {
  groupComparisons,
  isThinSample,
  summariseEntryComparisons,
  summariseComparisonsByDay,
  type ComparisonGroupRow,
} from '../../lib/ai/entry-comparison';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { DEFAULT_RISK_TIER_AMOUNTS } from '../../lib/trading/risk-tiers';
import {
  assessRiskCapacity,
  buildEquityCurve,
  type RiskStance,
} from '../../lib/analytics/risk-capacity';
import {
  summariseRiskPlanAdherence,
  summariseSlotTrends,
  type SlotTrendPoint,
} from '../../lib/analytics/risk-plan-adherence';
import {
  THIN_TARGET_SAMPLE,
  summariseTargetExits,
  summariseTargetExitsBySetup,
  summariseTargetHitTrend,
  type HitRateTrendPoint,
} from '../../lib/analytics/target-exits';

/**
 * One colour per slot, in ladder order (#1–#4, then custom).
 *
 * Fixed rather than themed so a slot keeps its colour between visits: a line whose colour
 * changes week to week is a line nobody can follow.
 */
const SLOT_COLORS = ['#10b981', '#38bdf8', '#fbbf24', '#a78bfa', '#a1a1aa'];

/**
 * The weekly per-slot tooltip.
 *
 * It shows the sample size beside each rate on purpose: a 100% week built from one trade is
 * exactly the reading this chart is most likely to be misused for.
 */
const SlotTrendTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload?: SlotTrendPoint }>;
  slotKeys: string[];
  slotLabels: string[];
}> = ({ active, payload, slotKeys, slotLabels }) => {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono space-y-1">
      <div className="text-zinc-300">{point.bucket}</div>
      {slotKeys.map((key, index) => {
        const rate = point.rates[key];
        if (rate === null || rate === undefined) return null;
        const count = point.counts[key] ?? 0;
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: SLOT_COLORS[index] }}
            />
            <span className="text-zinc-400">{slotLabels[index]}</span>
            <span className="font-bold text-zinc-100">{rate}%</span>
            <span className="text-zinc-500">
              {count} trade{count === 1 ? '' : 's'}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * The weekly target hit-rate tooltip.
 *
 * The sample travels with the rate on purpose: a 100% week built from one trade is noise, and
 * the tooltip is the only place that can say so while the line above it looks convincing.
 */
const HitRateTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload?: HitRateTrendPoint }>;
}> = ({ active, payload }) => {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono space-y-1">
      <div className="text-zinc-300">{point.bucket}</div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-sm bg-emerald-400" />
        <span className="text-zinc-400">Reached target</span>
        <span className="font-bold text-zinc-100">{point.hitPct}%</span>
        <span className="text-zinc-500">
          {point.hit}/{point.measured} trade{point.measured === 1 ? '' : 's'}
        </span>
      </div>
      <div className="text-zinc-500">Avg gap {point.avgGapR > 0 ? '+' : ''}{point.avgGapR.toFixed(2)}R</div>
    </div>
  );
};

/**
 * One breakdown table of the coach scoreboard — by side, by setup, by session, or
 * anything else worth slicing.
 *
 * A group built on one or two calls gets a "thin" mark rather than a confident
 * percentage, because a single agreed entry reads as 100% and means nothing. That is the
 * whole point of showing the sample size beside the rate.
 */
const ComparisonBreakdown: React.FC<{
  id: string;
  title: string;
  rows: ComparisonGroupRow[];
  emptyLabel: string;
  /** Header for the first column, so a slice can name its own dimension. */
  groupLabel?: string;
}> = ({ id, title, rows, emptyLabel, groupLabel = 'Group' }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2.5" id={id}>
    <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 font-mono">
      {title}
    </h4>

    {rows.length === 0 ? (
      <p className="text-[11px] text-zinc-500 leading-relaxed">{emptyLabel}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left">
              <th className="pb-1.5 font-medium">{groupLabel}</th>
              <th className="pb-1.5 font-medium">Calls</th>
              <th className="pb-1.5 font-medium">Same</th>
              <th className="pb-1.5 font-medium">Against</th>
              <th className="pb-1.5 font-medium">Rate</th>
              <th className="pb-1.5 font-medium text-right">Avg edge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40">
            {rows.map((row) => {
              const thin = isThinSample(row);
              return (
                <tr key={row.label} className="text-zinc-300">
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate max-w-[10rem]" title={row.label}>
                        {row.label}
                      </span>
                      {thin && (
                        <span
                          className="shrink-0 rounded border border-amber-800/70 bg-amber-950/40 px-1 py-0.5 text-[9px] uppercase text-amber-300"
                          title={`Only ${row.agreed + row.opposed} call(s) where the coach took a side — too few to read as a rate.`}
                        >
                          thin
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 text-zinc-400">{row.compared}</td>
                  <td className="py-1.5 text-emerald-400">{row.agreed}</td>
                  <td className="py-1.5 text-rose-400">{row.opposed}</td>
                  <td className="py-1.5">
                    {row.agreementRate === null ? '—' : `${row.agreementRate}%`}
                  </td>
                  <td className="py-1.5 text-right">
                    {row.avgTraderEdgePoints === null
                      ? '—'
                      : `${row.avgTraderEdgePoints > 0 ? '+' : ''}${row.avgTraderEdgePoints}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

/**
 * How each stance reads on the page.
 *
 * The labels describe the ROOM, not the response: `Tight room` says what is left without
 * telling the trader to do anything about it, because the size that is right for a tight
 * account depends on what they are trading, not on a label a chart chose.
 */
/** Signed dollars, so a figure that can be negative is never ambiguous. */
const signedMoney = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

/** Signed R, so an exit that fell short reads as a negative rather than an unsigned gap. */
const signedR = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}R`;

/** Green above zero, red below, neutral at flat. */
const pnlTone = (n: number) =>
  n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-zinc-100';

const STANCE_STYLES: Record<RiskStance, { label: string; className: string }> = {
  'limit-reached': {
    label: 'Limit reached',
    className: 'border-rose-800/70 bg-rose-950/40 text-rose-200',
  },
  defensive: {
    label: 'Tight room',
    className: 'border-amber-800/70 bg-amber-950/40 text-amber-200',
  },
  normal: {
    label: 'Normal room',
    className: 'border-zinc-700 bg-zinc-900/70 text-zinc-300',
  },
  ample: {
    label: 'Ample room',
    className: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-200',
  },
};

interface AnalyticsViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  /**
   * The account drawdown the trader has agreed to. Null means none is set, which the panel
   * says plainly rather than drawing a floor at zero.
   */
  maxDrawdown?: number | null;
  /** Today's planned loss, so the remaining room can be read in whole losing days. */
  dailyLossLimit?: number | null;
  /** Writes a new limit. The panel is deliberately an editor as well as a readout. */
  onUpdateMaxDrawdown?: (value: number) => void;
  /**
   * The trader's risk ladder, so the adherence panel can name what each slot allows.
   *
   * Absent falls back to the built-in ladder, which keeps the panel readable before the
   * profile has ever been edited.
   */
  riskTiers?: number[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  maxDrawdown = null,
  dailyLossLimit = null,
  onUpdateMaxDrawdown,
  riskTiers = DEFAULT_RISK_TIER_AMOUNTS,
}) => {
  // Filters
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('all');
  const [filterRiskMode, setFilterRiskMode] = useState<string>('all');
  const [filterSession, setFilterSession] = useState<string>('all');
  const [filterSetup, setFilterSetup] = useState<string>('all');

  /**
   * The shared filter, so the coach scoreboard reads exactly the same slice of the journal
   * as the performance figures beside it — otherwise the two would disagree about what
   * "this period" means.
   */
  const passesFilters = useCallback(
    (t: Trade) => {
      // Date range
      if (dateRange !== 'all') {
        const now = new Date().getTime();
        const daysAgo = (now - new Date(t.entryTime).getTime()) / (1000 * 60 * 60 * 24);
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
    },
    [tradingDays, dateRange, filterRiskMode, filterSession, filterSetup]
  );

  // Filter closed trades
  const filteredTrades = useMemo(
    () => trades.filter((t) => t.status === 'closed' && passesFilters(t)),
    [trades, passesFilters]
  );

  /**
   * Every trade in the same slice, open ones included.
   *
   * The coach's call is made at the moment of entry, so a position still open says just
   * as much about its read as a closed one does, and restricting this to closed trades
   * would hide today's calls until the position was over.
   */
  const coachTrades = useMemo(() => trades.filter(passesFilters), [trades, passesFilters]);

  const coachScore = useMemo(() => summariseEntryComparisons(coachTrades), [coachTrades]);

  /**
   * Risk-plan adherence over the same slice as the coach scoreboard.
   *
   * Built from `coachTrades` — every filtered trade, open ones included — because the slot
   * and the size are chosen at entry, so an open position can already have broken its plan
   * and hiding it until the exit would report the discipline one trade too late.
   */
  const adherence = useMemo(
    () => summariseRiskPlanAdherence(coachTrades, riskTiers),
    [coachTrades, riskTiers]
  );

  /**
   * The trading date for each day id.
   *
   * Read from the parent day rather than the entry timestamp, so a late-night entry lands on
   * the day the trader was actually trading.
   */
  const dateByDayId = useMemo(
    () => new Map(tradingDays.map((day) => [day.id, day.tradeDate])),
    [tradingDays]
  );

  /**
   * Adherence per slot, week by week.
   *
   * Falls back to the entry date only when a trade's own day is missing from the journal —
   * an import whose day was since deleted — so the week a trade belongs to is the week it was
   * traded, not the week its timestamp happens to fall in.
   */
  const slotTrend = useMemo(
    () =>
      summariseSlotTrends(
        coachTrades,
        (trade) =>
          dateByDayId.get(trade.tradingDayId) ??
          (trade.entryTime ? trade.entryTime.slice(0, 10) : null)
      ),
    [coachTrades, dateByDayId]
  );

  /**
   * Planned target versus realized exit, in R.
   *
   * Built from the same filtered slice as the panels above, so switching the date filter
   * moves this with everything else. Open positions stay in the input: one carrying a target
   * is a live plan, and the summary reports it separately rather than dropping it.
   */
  const targetExits = useMemo(() => summariseTargetExits(coachTrades), [coachTrades]);

  /** The same measurement split by setup, so a habit that lives in one play stands out. */
  const targetBySetup = useMemo(() => summariseTargetExitsBySetup(coachTrades), [coachTrades]);

  /**
   * Target hit rate, week by week, so the habit can be read as improving or worsening rather
   * than as a single all-time number. Dated off the trading day, like the slot trend.
   */
  const targetTrend = useMemo(
    () =>
      summariseTargetHitTrend(
        coachTrades,
        (trade) =>
          dateByDayId.get(trade.tradingDayId) ??
          (trade.entryTime ? trade.entryTime.slice(0, 10) : null)
      ),
    [coachTrades, dateByDayId]
  );

  /** The most recent weeks, so a long journal does not draw an unreadable chart. */
  const targetTrendWeeks = useMemo(() => targetTrend.slice(-12), [targetTrend]);

  /** The most recent weeks, so a long journal does not draw an unreadable chart. */
  const trendWeeks = useMemo(() => slotTrend.points.slice(-12), [slotTrend]);

  /**
   * The same weeks shaped for recharts: one top-level key per slot.
   *
   * The rates and counts stay on each row too, so the tooltip can report the sample behind
   * every point rather than presenting a percentage with no idea how many trades it came
   * from.
   */
  const trendChartData = useMemo(
    () =>
      trendWeeks.map((point) => {
        const row: Record<string, unknown> = {
          bucket: point.bucket,
          rates: point.rates,
          counts: point.counts,
        };
        for (const key of slotTrend.slotKeys) row[key] = point.rates[key];
        return row;
      }),
    [trendWeeks, slotTrend.slotKeys]
  );

  /** The comparison by trading day. */
  const coachDaily = useMemo(
    () => summariseComparisonsByDay(coachTrades, (t) => dateByDayId.get(t.tradingDayId) ?? null),
    [coachTrades, dateByDayId]
  );

  /**
   * Where the coach's read holds up and where it does not: the same calls sliced by the
   * setup the entry was logged as, by the session it was taken in, and by the instrument
   * that was traded.
   */
  const coachBySetup = useMemo(
    () => groupComparisons(coachTrades, (t) => t.setupName || null),
    [coachTrades]
  );

  const coachBySession = useMemo(
    () => groupComparisons(coachTrades, (t) => t.session || null),
    [coachTrades]
  );

  /**
   * The same calls split by instrument.
   *
   * Labelled through `instrumentSymbol` rather than read off the id, so a trade shows the
   * contract it was actually taken in (MNQ, not "mnq"), and an id the journal no longer
   * recognises is shown uppercased rather than relabelled MES.
   *
   * Note the fill edge is in POINTS, which is only comparable within one instrument: five
   * points is $25 on MES and $10 on MNQ. The edge column is therefore a per-instrument
   * number here, not something to total across the rows.
   */
  const coachByInstrument = useMemo(
    () => groupComparisons(coachTrades, (t) => instrumentSymbol(instruments, t.instrumentId)),
    [coachTrades, instruments]
  );

  /**
   * The same calls split by the side actually traded, which is the split a directional
   * trader is most likely to be skewed on: an edge that only shows up on longs (or a coach
   * that only ever reads one way) is an asymmetry the overall rate would hide.
   *
   * The fill edge stays comparable across the two rows because `traderPriceEdge`
   * normalises its sign for the side, so "+5" means the better fill on a long and on a
   * short alike.
   */
  const coachBySide = useMemo(
    () => groupComparisons(coachTrades, (t) => (t.direction === 'long' ? 'Long' : 'Short')),
    [coachTrades]
  );

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

  /**
   * Every closed trade in the journal, regardless of the page's filters.
   *
   * The drawdown limit belongs to the account, not to the slice being displayed: reading
   * "room left" off a filtered week would report the peak of that week as the account's
   * high-water mark and quietly overstate how much room is really there.
   */
  const closedTrades = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);

  /**
   * Where the account stands against the agreed drawdown.
   *
   * The limit is measured from the high-water mark, so the numbers move when a new peak is
   * set as well as when money is given back — which is the whole reason this needs to be
   * computed rather than eyeballed off the curve.
   */
  const capacity = useMemo(
    () => assessRiskCapacity({ trades: closedTrades, maxDrawdown, dailyLossLimit }),
    [closedTrades, maxDrawdown, dailyLossLimit]
  );

  /**
   * Each trade's own drawdown floor, from the account-wide record.
   *
   * Kept apart from the plotted curve so a filtered chart still draws the real floor: the
   * peak that sets it may sit outside the range being shown, and pretending otherwise
   * would make the room look larger exactly when it is being read most closely.
   */
  const floorByTradeId = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const point of buildEquityCurve(closedTrades, maxDrawdown)) {
      map.set(point.tradeId, point.floor);
    }
    return map;
  }, [closedTrades, maxDrawdown]);

  /**
   * The limit as typed, so the field can be cleared mid-edit without the stored number
   * being overwritten by a half-typed one.
   */
  const [drawdownDraft, setDrawdownDraft] = useState<string>(
    maxDrawdown === null ? '' : String(maxDrawdown)
  );
  useEffect(() => {
    setDrawdownDraft(maxDrawdown === null ? '' : String(maxDrawdown));
  }, [maxDrawdown]);

  // Chart 1: Cumulative P&L Curve, with the drawdown floor that trails the peak.
  const cumulativeData = useMemo(
    () =>
      buildEquityCurve(filteredTrades, null).map((point) => ({
        tradeLabel: point.label,
        cumulativePnL: point.cumulative,
        tradePnL: point.pnl,
        floor: floorByTradeId.get(point.tradeId) ?? null,
        drawdown: point.drawdown,
      })),
    [filteredTrades, floorByTradeId]
  );

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
            closed trades in sample
          </span>
        </div>
      </div>

      {/*
        Coach scoreboard.

        It reports agreement on side and the fill difference separately, and refuses to
        combine them into a single score, because the two answer different questions: one is
        about reading the moment, the other about execution. Both are tracked over time,
        since a handful of entries says nothing either way.
      */}
      <div
        id="coach-scoreboard"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
            <Scale className="w-4 h-4 text-amber-400" />
            Coach scoreboard — agreement &amp; fill edge
          </h3>
          <span className="text-[11px] font-mono text-zinc-400">
            {coachScore.compared} of {coachTrades.length} entries have a coach call
          </span>
        </div>

        {coachScore.compared === 0 ? (
          <p className="text-xs text-zinc-400 leading-relaxed">
            Nothing to score yet. The coach records its own side, entry, stop and target every
            time you save an entry, and this is where the two are compared, day by day. That
            needs the coach service, so calls are recorded on the deployed site rather than a
            local dev server.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Directional calls */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Calls it took a side on
                </span>
                <span className="text-xl font-bold font-mono text-zinc-100">
                  {coachScore.agreed + coachScore.opposed}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {coachScore.coachFlat} it would have skipped
                </span>
              </div>

              {/* Agreement */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Same side as you
                </span>
                <span
                  className={`text-xl font-bold font-mono ${
                    coachScore.agreementRate === null
                      ? 'text-zinc-200'
                      : coachScore.agreementRate >= 50
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {coachScore.agreementRate === null ? '—' : `${coachScore.agreementRate}%`}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {coachScore.agreed} agreed / {coachScore.opposed} opposed
                </span>
              </div>

              {/* Opposed */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Took the other side
                </span>
                <span className="text-xl font-bold font-mono text-rose-300">
                  {coachScore.opposed}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  entries it was against
                </span>
              </div>

              {/* Fill edge */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Avg fill edge
                </span>
                <span
                  className={`text-xl font-bold font-mono ${
                    coachScore.avgTraderEdgePoints === null
                      ? 'text-zinc-200'
                      : coachScore.avgTraderEdgePoints >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {coachScore.avgTraderEdgePoints === null
                    ? '—'
                    : `${coachScore.avgTraderEdgePoints > 0 ? '+' : ''}${coachScore.avgTraderEdgePoints} pts`}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  your fill vs its level (+ is better)
                </span>
              </div>
            </div>

            {coachDaily.length > 1 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={coachDaily.map((row) => ({ ...row, label: row.date.slice(5) }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis
                      yAxisId="calls"
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      domain={[0, 100]}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      tickFormatter={(val) => `${val}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#18181b',
                        borderColor: '#27272a',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                      }}
                      formatter={(value: any, name: any) =>
                        name === 'Running agreement'
                          ? [`${value}%`, name]
                          : [value, name]
                      }
                    />
                    <Bar
                      yAxisId="calls"
                      dataKey="agreed"
                      stackId="calls"
                      fill="#10b981"
                      name="Same side"
                    />
                    <Bar
                      yAxisId="calls"
                      dataKey="opposed"
                      stackId="calls"
                      fill="#f43f5e"
                      name="Opposed"
                    />
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="runningAgreementRate"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={false}
                      name="Running agreement"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                One day of calls so far — the trend needs a few more sessions before it means
                anything.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                    <th className="pb-1.5 font-medium">Day</th>
                    <th className="pb-1.5 font-medium">Calls</th>
                    <th className="pb-1.5 font-medium">Same</th>
                    <th className="pb-1.5 font-medium">Opposed</th>
                    <th className="pb-1.5 font-medium">Flat</th>
                    <th className="pb-1.5 font-medium">Rate</th>
                    <th className="pb-1.5 font-medium text-right">Avg edge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {[...coachDaily].reverse().slice(0, 10).map((row) => (
                    <tr key={row.date} className="text-zinc-300">
                      <td className="py-1.5">{row.date}</td>
                      <td className="py-1.5 text-zinc-400">{row.compared}</td>
                      <td className="py-1.5 text-emerald-400">{row.agreed}</td>
                      <td className="py-1.5 text-rose-400">{row.opposed}</td>
                      <td className="py-1.5 text-amber-300">{row.coachFlat}</td>
                      <td className="py-1.5">
                        {row.agreementRate === null ? '—' : `${row.agreementRate}%`}
                      </td>
                      <td className="py-1.5 text-right text-zinc-300">
                        {row.avgTraderEdgePoints === null
                          ? '—'
                          : `${row.avgTraderEdgePoints > 0 ? '+' : ''}${row.avgTraderEdgePoints}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <ComparisonBreakdown
                id="coach-breakdown-side"
                title="By side"
                groupLabel="Side"
                rows={coachBySide}
                emptyLabel="No long or short entries have a coach call yet."
              />
              <ComparisonBreakdown
                id="coach-breakdown-setup"
                title="By setup"
                rows={coachBySetup}
                emptyLabel="No entries with a coach call were logged against a setup yet."
              />
              <ComparisonBreakdown
                id="coach-breakdown-session"
                title="By session"
                rows={coachBySession}
                emptyLabel="No entries with a coach call were logged in a session yet."
              />
              <ComparisonBreakdown
                id="coach-breakdown-instrument"
                title="By instrument"
                groupLabel="Instrument"
                rows={coachByInstrument}
                emptyLabel="No entries with a coach call were logged on an instrument yet."
              />
            </div>

            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Agreement is not correctness: taking the same side as the coach is not the same as
              being right, and a fill advantage is about price, not about the idea. In the side
              table a group is the direction you traded, so a gap between long and short is worth
              more than either rate on its own. Read the two numbers together, and judge neither
              on a single day. The edge is in points, so compare it within a row: an instrument
              with a bigger point value turns the same number into more money. Groups marked{' '}
              <span className="text-amber-300">thin</span> hold too few calls for the rate to
              mean anything yet.
            </p>
          </>
        )}
      </div>

      {/*
        Risk capacity.

        The P&L curve below shows what the account has done; this shows what it can still
        absorb. They answer different questions, and the second is the one that decides
        whether today's risk is affordable — a rising curve with a trailing limit can still
        be one bad day from the floor.
      */}
      <div
        id="risk-capacity"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              Risk capacity — drawdown room
            </h3>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed max-w-xl">
              Measured from the highest equity point, the way a funding firm measures a
              trailing drawdown: a new high restores the room, and the floor never moves down.
              Read from the whole journal, not from the filters above — the limit belongs to
              the account.
            </p>
          </div>

          {onUpdateMaxDrawdown && (
            <label className="flex items-end gap-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 pb-2">
                Max drawdown ($)
              </span>
              <input
                id="max-drawdown-input"
                type="number"
                min="0"
                step="100"
                inputMode="numeric"
                value={drawdownDraft}
                placeholder="not set"
                onChange={(e) => {
                  const raw = e.target.value;
                  setDrawdownDraft(raw);
                  const next = Number(raw);
                  // Committed as it is typed, but only for a usable number: clearing the
                  // field mid-edit must not silently rewrite the limit to zero.
                  if (raw.trim() !== '' && Number.isFinite(next) && next > 0) {
                    onUpdateMaxDrawdown(next);
                  }
                }}
                className="w-32 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-600"
              />
            </label>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Current P&amp;L
            </span>
            <span className={`text-lg font-bold font-mono ${pnlTone(capacity.current)}`}>
              {signedMoney(capacity.current)}
            </span>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              High-water mark
            </span>
            <span className="text-lg font-bold font-mono text-zinc-100">
              {signedMoney(capacity.peak)}
            </span>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Drawdown used
            </span>
            <span
              className={`text-lg font-bold font-mono ${
                capacity.drawdownUsed > 0 ? 'text-rose-300' : 'text-zinc-100'
              }`}
            >
              -${capacity.drawdownUsed.toFixed(2)}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono block">
              {capacity.usedPct === null ? 'no limit set' : `${capacity.usedPct}% of the limit`}
            </span>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Room left
            </span>
            <span className="text-lg font-bold font-mono text-sky-300">
              {capacity.headroom === null ? '—' : `$${capacity.headroom.toFixed(2)}`}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono block">
              {capacity.headroomPct === null ? 'set a max drawdown' : `${capacity.headroomPct}% left`}
            </span>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Worst drop so far
            </span>
            <span className="text-lg font-bold font-mono text-zinc-300">
              -${capacity.largestHistorical.toFixed(2)}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono block">peak to trough</span>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-0.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Room in losing days
            </span>
            <span className="text-lg font-bold font-mono text-zinc-100">
              {capacity.daysOfHeadroom === null ? '—' : capacity.daysOfHeadroom}
            </span>
            <span className="text-[10px] text-zinc-500 font-mono block">
              {capacity.dailyLossLimit === null
                ? 'no daily limit set'
                : `at $${capacity.dailyLossLimit}/day`}
            </span>
          </div>
        </div>

        <div
          className={`rounded-xl border p-3 text-[11px] leading-relaxed font-mono ${
            STANCE_STYLES[capacity.stance].className
          }`}
          data-stance={capacity.stance}
        >
          <span className="font-bold uppercase tracking-wider text-[10px] mr-2">
            {STANCE_STYLES[capacity.stance].label}
          </span>
          {capacity.note}
        </div>

        <p className="text-[10px] text-zinc-500 leading-relaxed">
          This is capacity, not advice: it says what the account can absorb, not what to do
          with it. Size that grows with the account only works if the room is measured before
          the trade, not after a bad day.
        </p>
      </div>

      {/*
        Risk-plan adherence.

        The ladder only does anything if the size that was actually taken is measured against
        the slot it was logged under. This is that measurement.
      */}
      <div
        id="risk-plan-adherence"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              Risk plan adherence — did each trade stick to its slot
            </h3>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed max-w-xl">
              Each trade is measured against the slot it was recorded under. On plan means it
              risked no more than the slot allows — not that it matched to the cent, since
              futures trade in whole contracts and the nearest size can sit under the slot
              while being the only size available. Open positions count: the size is decided
              at entry, not at the exit.
            </p>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            {adherence.measured} measured · {adherence.unrecorded} without a slot
          </span>
        </div>

        {adherence.measured === 0 ? (
          <p className="text-xs text-zinc-400 leading-relaxed">
            No trades with a recorded risk slot yet. Pick a Trade # when you record a trade and
            this panel will read back whether the size stayed inside it.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Kept within the slot
                </span>
                <span
                  data-testid="adherence-rate"
                  className={`text-xl font-bold font-mono ${
                    adherence.withinPct === null
                      ? 'text-zinc-200'
                      : adherence.withinPct >= 90
                      ? 'text-emerald-400'
                      : adherence.withinPct >= 70
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {adherence.withinPct === null ? '—' : `${adherence.withinPct}%`}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {adherence.within} within / {adherence.over} over
                </span>
              </div>

              {/*
                The streak counts backwards from the newest measurable trade, so it is a
                "where am I now" figure rather than a season average. The best run sits in
                the sub-line as the record to beat.
              */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Current streak
                </span>
                <span
                  data-testid="adherence-streak"
                  className={`text-xl font-bold font-mono ${
                    adherence.currentStreak > 0 ? 'text-emerald-400' : 'text-zinc-200'
                  }`}
                >
                  {adherence.currentStreak}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {adherence.currentStreak === 1 ? 'trade' : 'trades'} within the slot
                  {adherence.longestStreak > adherence.currentStreak
                    ? ` · best ${adherence.longestStreak}`
                    : ''}
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Trades measured
                </span>
                <span className="text-xl font-bold font-mono text-zinc-100">
                  {adherence.measured}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  logged against a slot
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Avg risk taken
                </span>
                <span className="text-xl font-bold font-mono text-zinc-100">
                  ${adherence.avgActualRisk.toFixed(2)}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  across every measured trade
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Worst breach
                </span>
                <span
                  data-testid="adherence-worst"
                  className={`text-xl font-bold font-mono ${
                    adherence.worstOver === null ? 'text-zinc-200' : 'text-rose-300'
                  }`}
                >
                  {adherence.worstOver === null ? '—' : `+$${adherence.worstOver.toFixed(2)}`}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {adherence.avgOverRisk === null
                    ? 'nothing went over'
                    : `${adherence.avgOverRisk.toFixed(2)} avg over the plan`}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                    <th className="pb-1.5 font-medium">Slot</th>
                    <th className="pb-1.5 font-medium">Allows</th>
                    <th className="pb-1.5 font-medium">Trades</th>
                    <th className="pb-1.5 font-medium">Within</th>
                    <th className="pb-1.5 font-medium">Over</th>
                    <th className="pb-1.5 font-medium text-right">Avg risk</th>
                    <th className="pb-1.5 font-medium text-right">Worst over</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {adherence.slots.map((row) => (
                    <tr key={row.key} className={row.trades === 0 ? 'text-zinc-600' : 'text-zinc-300'}>
                      <td className="py-1.5">{row.label}</td>
                      <td className="py-1.5 text-zinc-400">
                        {row.target === null ? 'your amount' : `$${row.target}`}
                      </td>
                      <td className="py-1.5">{row.trades}</td>
                      <td className="py-1.5 text-emerald-400">{row.within}</td>
                      <td className={`py-1.5 ${row.over > 0 ? 'text-rose-400' : 'text-zinc-600'}`}>
                        {row.over}
                      </td>
                      <td className="py-1.5 text-right">
                        {row.trades === 0 ? '—' : `$${row.avgActualRisk.toFixed(2)}`}
                      </td>
                      <td className="py-1.5 text-right">
                        {row.worstOver === null ? '—' : `+$${row.worstOver.toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/*
              The per-slot trend.

              The table above says what each slot's record is; this says which one is sliding.
              A slot is only plotted for the weeks it was used, because a gap means the slot was
              untouched rather than that it scored zero.
            */}
            <div className="space-y-2 border-t border-zinc-800/70 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Weekly adherence by slot
                </span>
                <div className="flex flex-wrap items-center gap-2.5">
                  {slotTrend.slotLabels.map((label, index) => (
                    <span
                      key={label}
                      className="flex items-center gap-1 text-[10px] font-mono text-zinc-400"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ backgroundColor: SLOT_COLORS[index] }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {trendWeeks.length < 2 ? (
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  {trendWeeks.length === 0
                    ? 'No week of measured trades yet, so there is no trend to draw.'
                    : 'One week of measured trades so far — a trend needs a second week before it can show a direction.'}
                </p>
              ) : (
                <>
                  <div className="h-56 w-full" data-testid="slot-trend-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="bucket" stroke="#71717a" fontSize={10} tickLine={false} />
                        <YAxis
                          domain={[0, 100]}
                          stroke="#71717a"
                          fontSize={10}
                          tickLine={false}
                          tickFormatter={(val) => `${val}%`}
                        />
                        <Tooltip
                          content={
                            <SlotTrendTooltip
                              slotKeys={slotTrend.slotKeys}
                              slotLabels={slotTrend.slotLabels}
                            />
                          }
                        />
                        {slotTrend.slotKeys.map((key, index) => (
                          <Line
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={slotTrend.slotLabels[index]}
                            stroke={SLOT_COLORS[index]}
                            strokeWidth={2}
                            dot={{ r: 2 }}
                            connectNulls
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Each point is one week, and a slot is plotted only for the weeks it was used
                    — a gap means it was untouched, not that it scored zero.{' '}
                    {slotTrend.points.length > trendWeeks.length
                      ? `Showing the most recent ${trendWeeks.length} weeks. `
                      : ''}
                    Read it for direction over a month rather than off a single week, and check
                    the sample size in the tooltip: 100% from one trade is noise, not a finding.
                  </p>
                </>
              )}
            </div>

            <p className="text-[10px] text-zinc-500 leading-relaxed">
              A slot with no trades simply has not been used yet.
              {adherence.assumed > 0 && (
                <>
                  {' '}
                  {adherence.assumed} trade{adherence.assumed === 1 ? '' : 's'} came from a
                  broker CSV, whose stop the app had to invent — those are counted separately
                  and cannot be judged against a plan until the real stop is set.
                </>
              )}
              {adherence.unrecorded > 0 && (
                <>
                  {' '}
                  {adherence.unrecorded} trade{adherence.unrecorded === 1 ? '' : 's'} carr
                  {adherence.unrecorded === 1 ? 'ies' : 'y'} no slot at all (recorded before the
                  ladder, or imported), so there is nothing to measure them against.
                </>
              )}
            </p>
          </>
        )}
      </div>

      {/*
        Target vs realized R.

        The trade form shows the target in R at the moment of entry; this reads back across
        every trade whether the exits actually matched the plans. Both the target and the fill
        are converted to R off the same stop, so a miss is measured in the trader's own risk
        rather than in points that mean different things at different sizes.
      */}
      <div
        id="target-vs-realized"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              Target vs realized R — did the exits match the plan
            </h3>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed max-w-xl">
              Each trade's target price and its actual exit are both measured in R off that
              trade's own stop, so the plan and the fill are compared on the same scale. A
              target 2R out reached at 1.5R is half a risk of the plan left behind — a miss the
              P&amp;L alone will not show.
            </p>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            {targetExits.measured} measured
            {targetExits.openWithTarget > 0 ? ` · ${targetExits.openWithTarget} open with a target` : ''}
          </span>
        </div>

        {targetExits.measured === 0 ? (
          <p className="text-xs text-zinc-400 leading-relaxed">
            No closed trade with a target and a usable stop yet. Set a target price when you
            record a trade and this panel will compare what you planned to make with what the
            exit actually earned.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Reached target
                </span>
                <span
                  data-testid="target-hit-rate"
                  className={`text-xl font-bold font-mono ${
                    targetExits.hitPct === null
                      ? 'text-zinc-200'
                      : targetExits.hitPct >= 60
                      ? 'text-emerald-400'
                      : targetExits.hitPct >= 40
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {targetExits.hitPct === null ? '—' : `${targetExits.hitPct}%`}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {targetExits.hit} of {targetExits.measured} exits
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Avg target
                </span>
                <span className="text-xl font-bold font-mono text-zinc-100">
                  {signedR(targetExits.avgTargetR)}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  what the plans aimed for
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Avg realized
                </span>
                <span
                  data-testid="target-realized"
                  className={`text-xl font-bold font-mono ${pnlTone(targetExits.avgRealizedR)}`}
                >
                  {signedR(targetExits.avgRealizedR)}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  what the exits actually earned
                </span>
              </div>

              {/*
                The headline number: realized minus target, averaged. Negative is a plan that
                is being routinely undershot, which is the whole reason to compare them.
              */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Avg gap
                </span>
                <span
                  data-testid="target-avg-gap"
                  className={`text-xl font-bold font-mono ${
                    targetExits.avgGapR >= 0 ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {signedR(targetExits.avgGapR)}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {targetExits.avgGapR >= 0 ? 'exits run past the plan' : 'exits fall short of the plan'}
                </span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Worst shortfall
                </span>
                <span
                  data-testid="target-worst-short"
                  className={`text-xl font-bold font-mono ${
                    targetExits.worstShortR === null ? 'text-zinc-200' : 'text-rose-300'
                  }`}
                >
                  {targetExits.worstShortR === null ? '—' : `-${targetExits.worstShortR.toFixed(2)}R`}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono block">
                  {targetExits.avgShortR === null
                    ? 'nothing fell short'
                    : `${targetExits.avgShortR.toFixed(2)}R avg when it did`}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                    <th className="pb-1.5 font-medium">Date</th>
                    <th className="pb-1.5 font-medium">Instrument</th>
                    <th className="pb-1.5 font-medium">Side</th>
                    <th className="pb-1.5 font-medium text-right">Target</th>
                    <th className="pb-1.5 font-medium text-right">Exit</th>
                    <th className="pb-1.5 font-medium text-right">Vs plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {targetExits.rows.slice(0, 12).map((row) => (
                    <tr key={row.trade.id} className="text-zinc-300">
                      <td className="py-1.5 text-zinc-400">
                        {dateByDayId.get(row.trade.tradingDayId) ??
                          (row.trade.entryTime ? row.trade.entryTime.slice(0, 10) : '—')}
                      </td>
                      <td className="py-1.5">
                        {instrumentSymbol(instruments, row.trade.instrumentId)}
                      </td>
                      <td className="py-1.5 text-zinc-400">
                        {row.trade.direction === 'long' ? 'Long' : 'Short'}
                      </td>
                      <td className="py-1.5 text-right text-zinc-400">{signedR(row.targetR)}</td>
                      <td className={`py-1.5 text-right ${pnlTone(row.realizedR)}`}>
                        {signedR(row.realizedR)}
                      </td>
                      <td
                        className={`py-1.5 text-right ${
                          row.hit ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {signedR(row.gapR)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {targetExits.rows.length > 12 && (
                <p className="pt-1.5 text-[10px] text-zinc-500 font-mono">
                  Showing the most recent 12 of {targetExits.rows.length} measured trades.
                </p>
              )}
            </div>

            {/*
              The same measurement per setup. A shortfall spread evenly is a discipline
              problem; one concentrated in a single setup usually means that setup's target
              is set somewhere the trade never reaches.
            */}
            {targetBySetup.length > 0 && (
              <div className="space-y-2 border-t border-zinc-800/70 pt-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Hit rate by setup
                </span>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                        <th className="pb-1.5 font-medium">Setup</th>
                        <th className="pb-1.5 font-medium">Trades</th>
                        <th className="pb-1.5 font-medium">Hit</th>
                        <th className="pb-1.5 font-medium">Rate</th>
                        <th className="pb-1.5 font-medium text-right">Avg target</th>
                        <th className="pb-1.5 font-medium text-right">Avg exit</th>
                        <th className="pb-1.5 font-medium text-right">Avg gap</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40">
                      {targetBySetup.map((row) => (
                        <tr key={row.setupName} className="text-zinc-300">
                          <td className="py-1.5">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate max-w-[12rem]" title={row.setupName}>
                                {row.setupName}
                              </span>
                              {row.thin && (
                                <span
                                  className="shrink-0 rounded border border-amber-800/70 bg-amber-950/40 px-1 py-0.5 text-[9px] uppercase text-amber-300"
                                  title={`Only ${row.measured} trade(s) with a target — too few to read as a rate.`}
                                >
                                  thin
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-1.5 text-zinc-400">{row.measured}</td>
                          <td className="py-1.5 text-emerald-400">{row.hit}</td>
                          <td className="py-1.5">{row.hitPct}%</td>
                          <td className="py-1.5 text-right text-zinc-400">
                            {signedR(row.avgTargetR)}
                          </td>
                          <td className={`py-1.5 text-right ${pnlTone(row.avgRealizedR)}`}>
                            {signedR(row.avgRealizedR)}
                          </td>
                          <td
                            className={`py-1.5 text-right ${
                              row.avgGapR >= 0 ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {signedR(row.avgGapR)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Read a setup's gap against its own target: a wide target that is never reached
                  may be the target rather than the exit.
                  {targetBySetup.some((row) => row.thin)
                    ? ` Setups marked thin carry fewer than ${THIN_TARGET_SAMPLE} targeted trades — treat their rate as a hint, not a finding.`
                    : ''}
                </p>
              </div>
            )}

            {/*
              Hit rate over time. The figures above are all-time; this is the only place the
              direction of travel is visible — a rate that is climbing is a plan being fixed.
            */}
            <div className="space-y-2 border-t border-zinc-800/70 pt-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                Weekly target hit rate
              </span>

              {targetTrendWeeks.length < 2 ? (
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  {targetTrendWeeks.length === 0
                    ? 'No week of targeted trades yet, so there is no trend to draw.'
                    : 'One week of targeted trades so far — a trend needs a second week before it can show a direction.'}
                </p>
              ) : (
                <>
                  <div className="h-48 w-full" data-testid="target-hit-trend">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={targetTrendWeeks}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="bucket" stroke="#71717a" fontSize={10} tickLine={false} />
                        <YAxis
                          domain={[0, 100]}
                          stroke="#71717a"
                          fontSize={10}
                          tickLine={false}
                          tickFormatter={(val) => `${val}%`}
                        />
                        <Tooltip content={<HitRateTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="hitPct"
                          name="Reached target"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Each point is one week; a missing week simply had no targeted trades to
                    measure.{' '}
                    {targetTrend.length > targetTrendWeeks.length
                      ? `Showing the most recent ${targetTrendWeeks.length} weeks. `
                      : ''}
                    Read it for direction over a month rather than off a single week, and check
                    the sample size in the tooltip — 100% from one trade is noise, not a finding.
                  </p>
                </>
              )}
            </div>

            <p className="text-[10px] text-zinc-500 leading-relaxed">
              R is measured from the stop recorded on each trade, so a target that was reached
              at a different size still reads on the same scale.
              {targetExits.noTarget > 0 && (
                <>
                  {' '}
                  {targetExits.noTarget} closed trade{targetExits.noTarget === 1 ? '' : 's'} carr
                  {targetExits.noTarget === 1 ? 'ies' : 'y'} no target, so there is nothing to
                  compare.
                </>
              )}
              {targetExits.assumed > 0 && (
                <>
                  {' '}
                  {targetExits.assumed} trade{targetExits.assumed === 1 ? '' : 's'} came from a
                  broker CSV, whose stop the app had to invent — their R is a placeholder and is
                  left out.
                </>
              )}
            </p>
          </>
        )}
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
              <ComposedChart data={cumulativeData}>
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
                {/*
                  The trailing floor: peak minus the agreed drawdown at every point. It
                  rises with a new high and never falls, so the distance between the curve
                  and this line is exactly the room left.
                */}
                {maxDrawdown !== null && (
                  <Line
                    type="monotone"
                    dataKey="floor"
                    name="Drawdown floor"
                    stroke="#f43f5e"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {maxDrawdown !== null && cumulativeData.length > 0 && (
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            The dashed line is the drawdown floor: it trails the highest point reached so far
            by ${maxDrawdown}, so the gap between the curve and that line is the room left
            before the account hits it.
          </p>
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
