import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, Info } from 'lucide-react';
import type { DailyReview, Trade, TradingDay } from '../../types';
import { buildReviewTrend, HIGH_DISCIPLINE_SCORE } from '../../lib/analytics/review-trend';
import { money } from '../coach/coach-ui';

interface ReviewTrendPanelProps {
  reviews: DailyReview[];
  tradingDays: TradingDay[];
  trades: Trade[];
}

/**
 * The end-of-day review as a line, the way a price chart tracks a market.
 *
 * It only appears once the carried-forward lesson has been acknowledged, which is the
 * deliberate part: the lesson is what the trader promised to hold today, and the trend is
 * the evidence of how the last weeks actually went. Reading the second without accepting
 * the first is how a review becomes a diary nobody acts on.
 *
 * Only reviewed days are plotted. A gap in the line means no review was written, and
 * filling it in — with a repeat of the last score, or with a zero — would invent evidence.
 */
export const ReviewTrendPanel: React.FC<ReviewTrendPanelProps> = ({
  reviews,
  tradingDays,
  trades,
}) => {
  const trend = useMemo(
    () => buildReviewTrend({ reviews, tradingDays, trades }),
    [reviews, tradingDays, trades]
  );

  const { points, average, onPlanDays, reviewedDays, onPlanStreak } = trend;
  const thin = reviewedDays < 3;

  const streakLabel =
    onPlanStreak === 0
      ? 'none yet'
      : `${onPlanStreak} day${onPlanStreak === 1 ? '' : 's'}`;

  return (
    <div
      id="review-trend"
      className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          End-of-day review trend
        </h3>
        <span className="text-[11px] font-mono text-zinc-400">
          {reviewedDays} reviewed day{reviewedDays === 1 ? '' : 's'}
        </span>
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Discipline per reviewed day, plotted in order. This line is about you rather than the
        market: it moves when your execution moves, whatever the P&amp;L did. A break in the
        line is a day with no review, not a zero.
      </p>

      {reviewedDays === 0 ? (
        <p className="text-xs text-zinc-400 leading-relaxed py-4">
          No end-of-day review has been written yet, so there is no line to draw. Finish one
          and the first point appears here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Average
              </span>
              <span className="text-lg font-bold font-mono text-zinc-100">
                {average === null ? '—' : `${average}/100`}
              </span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Held the plan
              </span>
              <span className="text-lg font-bold font-mono text-emerald-300">
                {onPlanDays}/{reviewedDays}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono block">
                scored {HIGH_DISCIPLINE_SCORE}+
              </span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Current streak
              </span>
              <span className="text-lg font-bold font-mono text-zinc-100">{streakLabel}</span>
              <span className="text-[10px] text-zinc-500 font-mono block">at {HIGH_DISCIPLINE_SCORE}+</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Best / worst
              </span>
              <span className="text-lg font-bold font-mono text-zinc-100">
                {trend.best && trend.worst
                  ? `${trend.best.disciplineScore} / ${trend.worst.disciplineScore}`
                  : '—'}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono block">
                {trend.best && trend.worst ? `${trend.best.date} · ${trend.worst.date}` : ''}
              </span>
            </div>
          </div>

          <div className="h-56 w-full" data-testid="review-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#71717a" fontSize={10} tickLine={false} />
                <YAxis
                  domain={[0, 100]}
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  ticks={[0, 25, 50, 75, 100]}
                />
                {/* The day's own numbers in the hover, so a dip can be read against what the
                    day actually earned rather than floating free of it. */}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const point = points.find((p) => p.date === String(label));
                    if (!point) return null;
                    return (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[11px] font-mono text-zinc-200 space-y-0.5">
                        <div className="text-zinc-400">{point.date}</div>
                        <div>Discipline {point.disciplineScore}/100</div>
                        <div className={point.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {money(point.netPnL)} on {point.trades} trade
                          {point.trades === 1 ? '' : 's'}
                        </div>
                      </div>
                    );
                  }}
                />
                {/* The level the review counted as a day that held the plan. */}
                <ReferenceLine
                  y={HIGH_DISCIPLINE_SCORE}
                  stroke="#10b981"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                />
                {average !== null && (
                  <ReferenceLine
                    y={average}
                    stroke="#f59e0b"
                    strokeDasharray="2 4"
                    strokeOpacity={0.6}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="disciplineScore"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-sky-400" /> discipline score
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 border-t border-dashed border-emerald-500" />
              held the plan ({HIGH_DISCIPLINE_SCORE}+)
            </span>
            {average !== null && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 border-t border-dashed border-amber-500" />
                your average ({average})
              </span>
            )}
          </div>

          {trend.onPlanAvgPnL !== null && trend.offPlanAvgPnL !== null && (
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Days you held the plan averaged{' '}
              <span className="font-mono text-emerald-300">{money(trend.onPlanAvgPnL)}</span>;
              days you did not averaged{' '}
              <span className="font-mono text-rose-300">{money(trend.offPlanAvgPnL)}</span>. The
              two are worth reading together before concluding that discipline is what pays —
              a small sample can go either way.
            </p>
          )}

          {thin && (
            <p className="flex items-start gap-1.5 text-[10px] text-amber-300/80 leading-relaxed">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Fewer than three reviewed days so far. The line is real but the shape of it is
              not yet a finding.
            </p>
          )}
        </>
      )}
    </div>
  );
};
