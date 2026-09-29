import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Info,
  Lightbulb,
  Target,
  TrendingUp,
} from 'lucide-react';
import { Trade, TradingDay } from '../../types';
import {
  generateDeterministicInsights,
  MIN_TARGET_SAMPLE,
  type DeterministicInsight,
} from '../../lib/analytics/insights';
import {
  calculateCoreAnalytics,
  calculateRiskModeComparison,
  calculateSessionBreakdown,
  calculateSetupBreakdown,
} from '../../lib/analytics/aggregations';
import { summariseTargetExits } from '../../lib/analytics/target-exits';
import {
  DailyPnlChart,
  DivergingBars,
  LabelledBar,
  ModeTile,
  RDistributionChart,
  ResultTape,
  ShareRing,
  signedMoney,
  moneyTone,
  StatTile,
} from './insights-charts';
import {
  buildDailyPnLSeries,
  buildRDistribution,
  buildResultTape,
  buildWeekdayBreakdown,
  type SegmentRow,
} from '../../lib/analytics/insights-series';

interface InsightsViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
}

/**
 * What the record says about the trader, in pictures.
 *
 * The findings themselves are unchanged — they are still the deterministic ones written from
 * logged trades, never a market call and never a prediction. What changed is how they are
 * read. Prose is a poor instrument for comparison: eight cards of sentences each holding one
 * number is a wall to walk past, and the two questions a trader actually has here are "which
 * of these is biggest" and "which of these rests on enough trades to believe". Both are
 * questions a bar answers before the sentence is finished.
 *
 * So the tab is organised the way the record is. A strip of the headline figures, a bar per
 * segment showing where the money came from, the two risk modes head to head, the exits
 * against the plan, and then every observation underneath in the same words as before — now
 * with a meter beside it, so the eye can rank them and the words can explain them.
 *
 * The figures on this tab are gross, before fees, because the observations are: they are
 * built from the same breakdowns, and a bar that disagreed with the sentence next to it would
 * be worse than no bar at all.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const share = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
const meanR = (list: Trade[]) =>
  list.length ? round2(list.reduce((sum, t) => sum + (t.rMultiple || 0), 0) / list.length) : 0;
const grossOf = (list: Trade[]) => round2(list.reduce((sum, t) => sum + t.grossPnL, 0));

/** The sample chip, in the same four tones the observation has always used. */
const SAMPLE_CHIP: Record<DeterministicInsight['sampleVariant'], string> = {
  warning: 'bg-amber-950/80 text-amber-300 border-amber-800',
  info: 'bg-sky-950/70 text-sky-300 border-sky-900',
  primary: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  success: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
};

/** The edge of a card, coloured by whether the finding is a strength, a leak or neither. */
const ACCENT: Record<string, string> = {
  good: 'border-l-emerald-500/70',
  bad: 'border-l-rose-500/70',
  neutral: 'border-l-zinc-700',
};

const accentFor = (item: DeterministicInsight) =>
  ACCENT[item.isPositive === true ? 'good' : item.isPositive === false ? 'bad' : 'neutral'];

/** The colour a finding's own figure is written in, matching the accent of its card. */
const metricTone = (item: DeterministicInsight) =>
  item.isPositive === true
    ? 'text-emerald-400'
    : item.isPositive === false
    ? 'text-rose-400'
    : 'text-zinc-200';

/** One group of segments, under the heading that names what they are split by. */
const SegmentGroup: React.FC<{ title: string; note: string; rows: SegmentRow[]; id?: string }> = ({
  title,
  note,
  rows,
  id,
}) => (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-3">
    <div>
      <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
        {title}
      </h3>
      <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{note}</p>
    </div>
    <DivergingBars rows={rows} id={id} />
  </div>
);

export const InsightsView: React.FC<InsightsViewProps> = ({ trades, tradingDays }) => {
  const insights = useMemo(
    () => generateDeterministicInsights(trades, tradingDays),
    [trades, tradingDays]
  );

  const data = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'closed');
    const core = calculateCoreAnalytics(trades, tradingDays, []);

    // One row per segment, keyed by the id of the observation about it, so a bar and the card
    // underneath can never drift apart into two different buckets.
    const sessions: SegmentRow[] = calculateSessionBreakdown(closed)
      .filter((s) => s.tradesCount > 0)
      .map((s) => ({
        key: `session-${s.session}`,
        label: s.session,
        trades: s.tradesCount,
        winRate: s.winRate,
        avgR: s.avgR,
        pnl: s.pnl,
      }));

    const setups: SegmentRow[] = calculateSetupBreakdown(closed).map((s) => ({
      key: `setup-${s.setupName}`,
      label: s.setupName,
      trades: s.tradesCount,
      winRate: s.winRate,
      avgR: s.avgR,
      pnl: s.pnl,
    }));

    const sides: SegmentRow[] = (['long', 'short'] as const)
      .map((direction) => {
        const list = closed.filter((t) => t.direction === direction);
        return {
          key: `direction-${direction}`,
          label: direction === 'long' ? 'Long' : 'Short',
          trades: list.length,
          winRate: share(list.filter((t) => t.grossPnL > 0).length, list.length),
          avgR: meanR(list),
          pnl: grossOf(list),
        };
      })
      .filter((row) => row.trades > 0);

    // Biggest first in every group: the row worth looking at should be the one at the top.
    const byMoney = (rows: SegmentRow[]) => [...rows].sort((a, b) => b.pnl - a.pnl);

    return {
      closed,
      core,
      grossTotal: grossOf(closed),
      sessions: byMoney(sessions),
      setups: byMoney(setups),
      sides: byMoney(sides),
      // Monday first, unlike the other groups: a trading week is read in weekday order, not
      // reordered by which day happened to make the most money.
      weekdays: buildWeekdayBreakdown(closed, tradingDays),
      daily: buildDailyPnLSeries(closed, tradingDays),
      rDistribution: buildRDistribution(closed),
      tape: buildResultTape(closed, tradingDays),
      riskModes: calculateRiskModeComparison(closed, tradingDays, []),
      targets: summariseTargetExits(closed),
    };
  }, [trades, tradingDays]);

  const {
    closed,
    core,
    grossTotal,
    sessions,
    setups,
    sides,
    weekdays,
    daily,
    rDistribution,
    tape,
    riskModes,
    targets,
  } = data;

  /**
   * The meter under each observation.
   *
   * The number a finding is about is different for every family — a share of trades won, a
   * share of days won, a share of targets reached — and none of them is stored on the
   * observation itself, which only carries the sentence and a formatted figure. Parsing the
   * sentence back into a number would be reading the prose to draw the chart, so the value is
   * taken from the same breakdown the sentence was written from.
   */
  const meters = useMemo(() => {
    const map = new Map<string, { pct: number; label: string; barClass: string }>();
    for (const row of [...sessions, ...setups, ...sides]) {
      map.set(row.key, { pct: row.winRate, label: 'win rate', barClass: 'bg-sky-400' });
    }
    map.set('risk-mode-normal', {
      pct: riskModes.normal.winningDayRate,
      label: 'winning days',
      barClass: 'bg-sky-400',
    });
    map.set('risk-mode-expanded', {
      pct: riskModes.expanded.winningDayRate,
      label: 'winning days',
      barClass: 'bg-amber-400',
    });
    if (targets.hitPct !== null) {
      map.set('target-exits-short', {
        pct: targets.hitPct,
        label: 'reached the target',
        barClass: 'bg-amber-400',
      });
    }
    return map;
  }, [sessions, setups, sides, riskModes, targets]);

  /** Best and worst single trade by R, and what a win and a loss are worth on average. */
  const rStats = useMemo(() => {
    const withR = closed.filter((trade) => Number.isFinite(trade.rMultiple));
    const winners = withR.filter((trade) => trade.rMultiple > 0);
    const losers = withR.filter((trade) => trade.rMultiple < 0);
    return {
      best: withR.reduce<number | null>(
        (top, trade) => (top === null || trade.rMultiple > top ? trade.rMultiple : top),
        null
      ),
      worst: withR.reduce<number | null>(
        (low, trade) => (low === null || trade.rMultiple < low ? trade.rMultiple : low),
        null
      ),
      avgWin: meanR(winners),
      avgLoss: meanR(losers),
      winners: winners.length,
      losers: losers.length,
    };
  }, [closed]);

  const modesShown = (['normal', 'expanded'] as const)
    .map((mode) => ({ mode, stats: riskModes[mode] }))
    .filter(({ stats }) => stats.days > 0);
  const maxAbsAvg = Math.max(1, ...modesShown.map(({ stats }) => Math.abs(stats.avgDailyPnL)));

  const profitFactor = core.profitFactor;
  const targetsShown = targets.measured >= MIN_TARGET_SAMPLE;
  const hitPct = targets.hitPct ?? 0;
  const gapShort = targets.avgGapR < 0;

  if (core.tradeCount === 0) {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-100">
            <Lightbulb className="h-5 w-5 text-amber-400" />
            Performance insights
          </h1>
          <p className="mt-0.5 text-xs text-zinc-400">
            What your own logged trades show, read back one segment at a time. Never a market
            call and never a prediction.
          </p>
        </header>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
          <BarChart3 className="mx-auto h-6 w-6 text-zinc-600" />
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            No closed trade yet, so there is nothing to draw. The first one puts a bar on this
            tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-100">
          <Lightbulb className="h-5 w-5 text-amber-400" />
          Performance insights
        </h1>
        <p className="mt-0.5 text-xs text-zinc-400">
          What your own logged trades show, read back one segment at a time. Every figure here
          is counted from your record — never a market call, never a prediction.
        </p>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* The headline figures                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section id="insights-kpis" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          label="P&L before fees"
          value={signedMoney(grossTotal)}
          valueClass={moneyTone(grossTotal)}
          sub={`${core.tradeCount} closed trade${core.tradeCount === 1 ? '' : 's'} over ${
            core.completedDaysCount
          } day${core.completedDaysCount === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Win rate"
          value={`${core.tradeWinRate}%`}
          meter={core.tradeWinRate}
          marker={50}
          meterClass="bg-sky-400"
          sub={`${core.winCount}W / ${core.lossCount}L${
            core.breakEvenCount ? ` / ${core.breakEvenCount} flat` : ''
          }`}
        />
        <StatTile
          label="Profit factor"
          value={profitFactor === null ? '—' : profitFactor.toFixed(2)}
          valueClass={
            profitFactor === null
              ? 'text-zinc-400'
              : profitFactor >= 1
              ? 'text-emerald-400'
              : 'text-rose-400'
          }
          meter={profitFactor === null ? 0 : Math.min(profitFactor, 3) * (100 / 3)}
          marker={100 / 3}
          meterClass={profitFactor !== null && profitFactor >= 1 ? 'bg-emerald-500/80' : 'bg-rose-500/80'}
          sub={
            profitFactor === null
              ? 'no losing trade to divide by'
              : 'gross wins ÷ gross losses, 1.00 is break-even'
          }
        />
        <StatTile
          label="Average R"
          value={`${core.avgRMultiple}R`}
          valueClass={moneyTone(core.avgRMultiple)}
          sub="per closed trade"
        />
      </section>

      {/*
        Every day as a column, with the running total drawn over it.

        This is the tab's hero because it is the one picture that answers both of a trader's
        first questions at once: how each day went, and what the days added up to.
      */}
      {daily.length > 0 && (
        <section id="insights-daily" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-emerald-400" />
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
                Every trading day
              </h2>
            </div>
            <span className="font-mono text-[10px] text-zinc-500">
              {daily.length} day{daily.length === 1 ? '' : 's'} · columns left, running total
              right
            </span>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3.5">
            <DailyPnlChart points={daily} />
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              Each column is one day's whole result; the line is the running total across the
              days shown, starting at zero on the left. A red column inside a rising line is
              what a good month normally looks like.
            </p>
          </div>
        </section>
      )}

      {/*
        Where the money came from.

        Three groups rather than one list, because they are three different questions: which
        hours pay, which setup pays, and which side of the market pays. Each group is scaled to
        its own biggest row, so a $60 session is still visible next to a $600 setup.
      */}
      <section id="insights-segments" className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-sky-400" />
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
            Where the money came from
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sessions.length > 0 && (
            <SegmentGroup
              title="By session"
              note="Hours of the day, biggest first. A session is a time, not a verdict."
              rows={sessions}
              id="insights-sessions"
            />
          )}
          {setups.length > 0 && (
            <SegmentGroup
              title="By setup"
              note="The setups you actually took, biggest first."
              rows={setups}
              id="insights-setups"
            />
          )}
          {sides.length > 0 && (
            <SegmentGroup
              title="By side"
              note="Long against short. Two sides of the same habit, or two different ones."
              rows={sides}
              id="insights-sides"
            />
          )}
          {weekdays.length > 0 && (
            <SegmentGroup
              title="By weekday"
              note="Which day of the week the money was made on. Monday first, the way a week is read."
              rows={weekdays}
              id="insights-weekdays"
            />
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-zinc-500">
          P&L before fees, so these bars and the observations below are the same money. Each
          group is scaled to its own largest row: bar lengths compare within a group, not
          between them.
        </p>
      </section>

      {/*
        The shape of the record rather than its total.

        An average R hides the distribution behind it, and the sequence of results is the one
        thing a P&L curve cannot show at all — so the histogram and the tape sit together,
        with the best and worst trades beside them.
      */}
      {rDistribution.measured > 0 && (
        <section id="insights-distribution" className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-sky-400" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
              How the trades ended
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
            <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3.5">
              <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                R per trade
              </h3>
              <p className="text-[10px] leading-snug text-zinc-500">
                How far each trade ran, in multiples of what it risked. The weight of the
                record under the line is the thing to look at, not the average of it.
              </p>
              <RDistributionChart
                buckets={rDistribution.buckets}
                measured={rDistribution.measured}
                excluded={rDistribution.excluded}
              />
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <StatTile
                  label="Best trade"
                  value={`${rStats.best ?? 0}R`}
                  valueClass="text-emerald-400"
                />
                <StatTile
                  label="Worst trade"
                  value={`${rStats.worst ?? 0}R`}
                  valueClass="text-rose-400"
                />
                <StatTile
                  label="Average win"
                  value={`${rStats.avgWin}R`}
                  valueClass="text-emerald-400"
                  sub={`across ${rStats.winners} winning trade${rStats.winners === 1 ? '' : 's'}`}
                />
                <StatTile
                  label="Average loss"
                  value={`${rStats.avgLoss}R`}
                  valueClass="text-rose-400"
                  sub={`across ${rStats.losers} losing trade${rStats.losers === 1 ? '' : 's'}`}
                />
              </div>

              <div className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3.5">
                <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                  The tape
                </h3>
                <ResultTape entries={tape} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Normal against expanded risk                                          */}
      {/* ------------------------------------------------------------------ */}
      {modesShown.length > 0 && (
        <section id="insights-modes" className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-400" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
              Risk mode, day by day
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {modesShown.map(({ mode, stats }) => (
              <ModeTile
                key={mode}
                name={mode === 'normal' ? 'Normal risk' : 'Expanded risk'}
                blurb={
                  mode === 'normal'
                    ? 'The days taken on the size you planned for.'
                    : 'The days taken on the larger size — the ones worth checking against their result.'
                }
                days={stats.days}
                trades={stats.trades}
                avgDailyPnL={stats.avgDailyPnL}
                winningDayRate={stats.winningDayRate}
                maxAbsAvg={maxAbsAvg}
                barClass={mode === 'normal' ? 'bg-sky-500/80' : 'bg-amber-500/80'}
                ringColor={mode === 'normal' ? '#38bdf8' : '#f59e0b'}
              />
            ))}
          </div>

          {modesShown.length === 1 && (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Only one risk mode has been traded, so there is nothing to compare it against yet.
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* The exits against the plan                                            */}
      {/* ------------------------------------------------------------------ */}
      {targetsShown && (
        <section id="insights-targets" className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-400" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
              Where the exits landed
            </h2>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex flex-wrap items-center gap-5">
              <ShareRing
                pct={hitPct}
                center={`${hitPct}%`}
                color={gapShort ? '#f59e0b' : '#10b981'}
                caption={`reached the target · ${targets.measured} measured`}
                size="h-24 w-24"
              />

              <div className="min-w-[13rem] flex-1 space-y-3">
                <LabelledBar
                  label="Target"
                  display={`${targets.avgTargetR.toFixed(2)}R`}
                  pct={100}
                  barClass="bg-zinc-600"
                  muted
                  valueClass="text-zinc-400"
                />
                <LabelledBar
                  label="Actual exit"
                  display={`${targets.avgRealizedR.toFixed(2)}R`}
                  pct={(targets.avgRealizedR / Math.max(targets.avgTargetR, 0.01)) * 100}
                  barClass={gapShort ? 'bg-amber-500/80' : 'bg-emerald-500/80'}
                  valueClass={moneyTone(targets.avgRealizedR)}
                />
                <p className="text-[10px] leading-relaxed text-zinc-400">
                  {gapShort ? (
                    <>
                      Exits finished{' '}
                      <span className="font-mono text-amber-300">
                        {Math.abs(targets.avgGapR).toFixed(2)}R short
                      </span>{' '}
                      of the plan on average
                      {targets.worstShortR !== null && (
                        <>
                          , worst{' '}
                          <span className="font-mono text-amber-300">
                            {targets.worstShortR.toFixed(2)}R
                          </span>
                        </>
                      )}
                      . The gap between the two bars is the part of the plan not collected.
                    </>
                  ) : (
                    <>
                      Exits finished{' '}
                      <span className="font-mono text-emerald-300">
                        {targets.avgGapR.toFixed(2)}R beyond
                      </span>{' '}
                      the plan on average. This is a strength to keep, not a leak to fix.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Every observation, in the same words as before                        */}
      {/* ------------------------------------------------------------------ */}
      {insights.length > 0 && (
        <section id="insights-observations" className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
              The observations
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {insights.map((item) => {
              const meter = meters.get(item.id);
              return (
                <article
                  key={item.id}
                  data-insight={item.category}
                  className={`space-y-2 rounded-2xl border border-zinc-800 border-l-2 bg-zinc-900/50 p-3.5 ${accentFor(
                    item
                  )}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-400">
                      {item.category}
                    </span>
                    <span
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                        SAMPLE_CHIP[item.sampleVariant]
                      }`}
                    >
                      {item.sampleLabel} · {item.sampleSize}
                    </span>
                  </div>

                  {/* The figure carries the card; the sentence explains it. */}
                  <div className="flex items-end justify-between gap-3">
                    <span
                      className={`font-mono text-xl font-bold leading-none ${metricTone(item)}`}
                    >
                      {item.metricHighlight}
                    </span>
                    {meter && (
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {meter.pct}% {meter.label}
                      </span>
                    )}
                  </div>

                  {meter && (
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full ${meter.barClass}`}
                        style={{ width: `${Math.max(0, Math.min(100, meter.pct))}%` }}
                      />
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs font-semibold text-zinc-200">{item.title}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                      {item.statement}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />
            A sample size is printed on every observation because a pattern from four trades is a
            coincidence that happens to be in your journal. Read these as a description of what
            has already happened, never as a forecast.
          </p>
        </section>
      )}
    </div>
  );
};
