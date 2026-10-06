import React, { useMemo } from 'react';
import { Activity, ArrowDown, ArrowUp, TrendingUp } from 'lucide-react';
import type { Instrument, LevelTouch, MarkedLevel, TradingDay } from '../../types';
import { CoachCard } from '../coach/coach-ui';
import { formatTradingDate } from '../../lib/storage/date-utils';
import { findInstrument, instrumentSymbol } from '../../lib/trading/instruments';
import { TIMEFRAME_LABEL } from '../../lib/analytics/level-timeframes';
import {
  HOLD_BARS,
  summarizeTimeframeEdgeScores,
  timeframeEdgeTrend,
  type TimeframeEdgeScore,
} from '../../lib/analytics/timeframe-edge';

/**
 * Which of the trader's charts actually holds.
 *
 * The level cards next door answer "where is price going" and "which of my lines gets reached".
 * This is the one that answers the question that decides where to spend attention: of the lines
 * each chart gives, which ones KEEP price away — judged in that chart's own bars, so a 5-minute
 * line and an hourly one are held to the same standard rather than to the same number of minutes.
 *
 * Everything here is a count of the trader's own record: lines they wrote down before anything
 * happened at them, and touches they logged against those lines. Nothing is fetched, nothing is
 * inferred from price, and a bucket without enough judged touches says so instead of showing a
 * rate. The rolling read underneath exists because an edge decays — an accumulating rate keeps a
 * good early run on the screen long after the read has changed.
 */

/** Decided touches in each rolling window. Small enough to move, large enough to mean something. */
const TREND_WINDOW = 10;

export interface TimeframeEdgeCardProps {
  levels: MarkedLevel[];
  touches: LevelTouch[];
  instruments: Instrument[];
  /**
   * The instrument on screen. Falls back to the day's own when absent, so the card reads the
   * contract the trader works even before any level selection has been made.
   */
  instrumentId?: string;
  todayTradingDay: TradingDay;
  timezone: string;
}

/** Minutes as a readable span: `15 min`, `1.5 h`, `3 h`. */
function formatSpan(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** One bucket's row: the chart and side, then what its decided touches did. */
const ScoreRow: React.FC<{ score: TimeframeEdgeScore }> = ({ score }) => {
  const support = score.kind === 'support';
  return (
    <div
      data-timeframe-score={score.key}
      data-timeframe-score-enough={score.enoughData ? 'true' : 'false'}
      className={`space-y-1 rounded-lg border px-2.5 py-1.5 ${
        score.enoughData ? 'border-zinc-800 bg-zinc-950/40' : 'border-zinc-800/60 bg-zinc-950/20'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-zinc-300">
            {TIMEFRAME_LABEL[score.timeframe]}
          </span>
          <span
            className={`flex items-center gap-1 text-xs ${support ? 'text-sky-300' : 'text-amber-300'}`}
          >
            {support ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
            {score.kind}
          </span>
          <span className="truncate font-mono text-[10px] text-zinc-500">
            {score.marked} marked
          </span>
        </span>

        <span className="shrink-0 font-mono text-[10px] text-zinc-400">
          {score.enoughData && score.holdRateAtHorizon !== null ? (
            <span className="font-bold text-zinc-100">
              held {score.holdRateAtHorizon}% of {score.judgedAtHorizon}
            </span>
          ) : (
            <span className="text-zinc-500">
              {score.decided} decided — too thin for a rate
            </span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-500">
        <span title={`Held at least ${formatSpan(score.horizonMinutes)}: ${HOLD_BARS} bars of the ${TIMEFRAME_LABEL[score.timeframe]} chart`}>
          held ≥ {formatSpan(score.horizonMinutes)}
        </span>
        <span>
          never came back {score.holdRate === null ? '—' : `${score.holdRate}%`}
          {score.decided > 0 ? ` (${score.neverReturned}/${score.decided})` : ''}
        </span>
        {score.avgAwayMinutes !== null && (
          <span title="Mean time price stayed away, across decided touches with a readable time">
            away {formatSpan(score.avgAwayMinutes)} avg
          </span>
        )}
        {score.unknownAtHorizon > 0 && (
          <span
            className="text-zinc-600"
            title="Decided touches the horizon cannot be judged on — a hold called before it elapsed, or no readable time. Left out rather than counted against the line."
          >
            {score.unknownAtHorizon} not judgeable
          </span>
        )}
        {score.expectancyPoints !== null && (
          <span
            className={score.expectancyPoints >= 0 ? 'text-emerald-400/90' : 'text-rose-400/90'}
            title={`Points per decided touch over ${score.expectancySample} touch(es) that carried the distance`}
          >
            {score.expectancyPoints > 0 ? '+' : ''}
            {score.expectancyPoints} pts/touch
          </span>
        )}
      </div>
    </div>
  );
};

export const TimeframeEdgeCard: React.FC<TimeframeEdgeCardProps> = ({
  levels,
  touches,
  instruments,
  instrumentId,
  todayTradingDay,
  timezone,
}) => {
  const focusId =
    instrumentId ?? findInstrument(instruments, todayTradingDay.primaryInstrument).id;
  const symbol = instrumentSymbol(instruments, focusId);

  const scores = useMemo(
    () => summarizeTimeframeEdgeScores(levels, touches, { instrumentId: focusId }),
    [levels, touches, focusId]
  );
  const trend = useMemo(
    () => timeframeEdgeTrend(levels, touches, { instrumentId: focusId, window: TREND_WINDOW }),
    [levels, touches, focusId]
  );

  const readable = scores.filter((score) => score.enoughData);
  const trendReadable = trend.points.filter((point) => point.holdRateAtHorizon !== null);

  // A short sparkline of the rolling read. Drawn by hand rather than pulled from the chart
  // library: it is one line over a handful of points, and the card reads better without a
  // second axis to interpret.
  const sparkW = 100;
  const sparkH = 24;
  const xOf = (index: number) =>
    trend.points.length <= 1 ? 0 : (index / (trend.points.length - 1)) * sparkW;
  const yOf = (rate: number) => sparkH - (rate / 100) * sparkH;
  const sparkPath = trend.points
    .map((point, index) =>
      point.holdRateAtHorizon === null
        ? null
        : `${xOf(index).toFixed(2)},${yOf(point.holdRateAtHorizon).toFixed(2)}`
    )
    .filter((pair): pair is string => pair !== null);

  const firstRead = trendReadable[0];
  const lastRead = trendReadable[trendReadable.length - 1];

  return (
    <CoachCard id="playbook-timeframe-edge" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300">
          <Activity className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Timeframe edge — {symbol}
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Which of your charts actually holds. A line counts as held when price stays away{' '}
            <span className="font-mono text-zinc-300">{HOLD_BARS} bars</span> of its own chart —{' '}
            {formatSpan(15)} on the {TIMEFRAME_LABEL['5m']}, {formatSpan(180)} on the{' '}
            {TIMEFRAME_LABEL['1h']} — so every timeframe is judged the same way.
          </p>
        </div>
      </div>

      {scores.length === 0 ? (
        <p id="timeframe-edge-empty" className="text-xs italic text-zinc-500">
          Nothing marked on a chart for {symbol} yet. Mark its lines in the card above and log
          when price reaches them — this will show which chart's lines keep price away.
        </p>
      ) : (
        <>
          <div className="space-y-1" id="timeframe-edge-scores">
            {scores.map((score) => (
              <ScoreRow key={score.key} score={score} />
            ))}
          </div>

          {readable.length === 0 && (
            <p className="text-[10px] leading-relaxed text-zinc-500">
              No bucket has enough judged touches for a rate yet. The counts above are the read
              for now — a rate off two or three touches would be noise wearing a percentage sign.
            </p>
          )}

          {readable.length > 1 && (
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Best on this record: <span className="text-zinc-300">{readable[0].kind}</span> on
              the <span className="text-zinc-300">{TIMEFRAME_LABEL[readable[0].timeframe]}</span>{' '}
              — held {readable[0].holdRateAtHorizon}% of {readable[0].judgedAtHorizon} judged.
            </p>
          )}
        </>
      )}

      {/* The rolling read: is this still working, not just did it work. */}
      <div
        id="timeframe-edge-trend"
        className="space-y-2 border-t border-zinc-800/70 pt-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 text-teal-300" />
            Rolling — last {TREND_WINDOW} touches
          </span>
          <span className="text-[10px] text-zinc-500">
            {trend.decided} decided touch{trend.decided === 1 ? '' : 'es'} so far
          </span>
        </div>

        {/*
          Guarded on the readable windows, not on how many windows there are. A window is built
          from decided touches, but it only carries a rate once a touch in it has an answer at its
          chart's own horizon — so a record can fill three windows and still have nothing to roll.
          Reading `firstRead` off the window count crashed the card on that record, which took the
          whole tab down with it; the two cases are said out loud instead.
        */}
        {trend.points.length < 2 || trendReadable.length === 0 ? (
          <p id="timeframe-edge-trend-empty" className="text-[10px] leading-relaxed text-zinc-500">
            {trend.points.length < 2
              ? 'A rolling read needs more decided touches than a single window. Keep logging what price does after each touch and this fills in — it is what shows whether the edge is still there rather than only that it once was.'
              : `None of these ${trend.points.length} windows carries a judged rate yet, so there is nothing to roll. A window counts a touch once it has an answer at its own chart's horizon — the counts above are the read for now.`}
          </p>
        ) : (
          <>
            <svg
              data-trend-line
              viewBox={`0 0 ${sparkW} ${sparkH}`}
              preserveAspectRatio="none"
              className="h-8 w-full"
              role="img"
              aria-label={`Rolling hold rate across ${trend.points.length} windows`}
            >
              <line
                x1={0}
                y1={yOf(50)}
                x2={sparkW}
                y2={yOf(50)}
                stroke="#3f3f46"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
              <polyline
                points={sparkPath.join(' ')}
                fill="none"
                stroke="#2dd4bf"
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            <div
              id="timeframe-edge-trend-read"
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-500"
            >
              <span>
                first {firstRead.holdRateAtHorizon}% ({formatTradingDate(firstRead.fromDate, timezone)})
              </span>
              <span>
                last {lastRead.holdRateAtHorizon}% ({formatTradingDate(lastRead.toDate, timezone)})
              </span>
              {trend.deltaPoints !== null && (
                <span
                  className={
                    trend.deltaPoints > 0
                      ? 'font-bold text-emerald-400/90'
                      : trend.deltaPoints < 0
                        ? 'font-bold text-rose-400/90'
                        : 'font-bold text-zinc-400'
                  }
                  title="Change in the rolling hold rate between the first and last readable window"
                >
                  {trend.deltaPoints > 0 ? '▲' : trend.deltaPoints < 0 ? '▼' : '■'}{' '}
                  {Math.abs(trend.deltaPoints)} pts
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </CoachCard>
  );
};
