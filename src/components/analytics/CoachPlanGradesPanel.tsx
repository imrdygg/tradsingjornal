import React from 'react';
import { GraduationCap, MessageSquareText, Target } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CoachPlan, CoachPlanGrade } from '../../types';
import {
  COACH_PLAN_GRADES,
  COACH_PLAN_GRADE_POINTS,
  buildCoachPlanGradeTrend,
  sortCoachPlansNewestFirst,
  summariseCoachPlanGrades,
  type CoachPlanGradePoint,
} from '../../lib/analytics/coach-plan-grades';

/**
 * The trader's grades of the coach's own plans.
 *
 * This is the whole scoreboard for the coach's planning: it made the call, the trader judged
 * it, and their feedback is what the next plan learns from. Nothing is blended into a single
 * number for the reader — the distribution and the written notes are shown as they are, so a
 * run of weak plans is as visible as a run of strong ones.
 *
 * The plans are the coach's own, made against the live market, so they are not filtered by
 * the trade filters above; the note in the header says exactly that rather than leaving the
 * reader to wonder why the count does not move.
 */
interface CoachPlanGradesPanelProps {
  plans: CoachPlan[];
}

const GRADE_TONE: Record<CoachPlanGrade, string> = {
  A: 'border-emerald-700 bg-emerald-950/70 text-emerald-300',
  B: 'border-lime-700 bg-lime-950/60 text-lime-300',
  C: 'border-amber-700 bg-amber-950/60 text-amber-300',
  D: 'border-orange-700 bg-orange-950/60 text-orange-300',
  F: 'border-rose-700 bg-rose-950/60 text-rose-300',
};

const BAR_TONE: Record<CoachPlanGrade, string> = {
  A: 'bg-emerald-500',
  B: 'bg-lime-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  F: 'bg-rose-500',
};

/** A price as it was recorded, or a dash. */
function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A grade letter for a y-axis tick, so the line reads as A–F rather than 0–4. */
const GRADE_BY_POINT = new Map<number, CoachPlanGrade>(
  COACH_PLAN_GRADES.map((grade) => [COACH_PLAN_GRADE_POINTS[grade], grade])
);

/** The tooltip for the grade trend, naming the plan the point belongs to. */
const GradeTrendTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload?: CoachPlanGradePoint }>;
}> = ({ active, payload }) => {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono space-y-1">
      <div className="text-zinc-300">
        {point.date} · {point.symbol}
      </div>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-sm ${BAR_TONE[point.grade]}`} />
        <span className="text-zinc-400">Grade</span>
        <span className="font-bold text-zinc-100">{point.grade}</span>
      </div>
      <div className="text-zinc-500">Running average {point.runningAverage.toFixed(2)} of 4</div>
    </div>
  );
};

export const CoachPlanGradesPanel: React.FC<CoachPlanGradesPanelProps> = ({ plans }) => {
  const summary = summariseCoachPlanGrades(plans);
  const listed = sortCoachPlansNewestFirst(plans).slice(0, 12);
  const trend = buildCoachPlanGradeTrend(plans);

  return (
    <div
      id="coach-plan-grades"
      className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-sky-400" />
          Your grades of the coach's own plans
        </h3>
        <span className="text-[11px] font-mono text-zinc-400">
          every plan, not filtered by the controls above
        </span>
      </div>

      {summary.total === 0 ? (
        <p className="text-xs text-zinc-400 leading-relaxed">
          The coach has not made a plan of its own yet. Ask it for one from the Coach tab, grade
          it and write what you thought — that grade and note is what it learns from, and this is
          where the record of it lives.
        </p>
      ) : (
        <>
          <div id="coach-plan-grades-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Plans made
              </span>
              <span className="text-xl font-bold font-mono text-zinc-100">{summary.total}</span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                {summary.ungraded} still ungraded
              </span>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Average grade
              </span>
              <span
                className={`text-xl font-bold font-mono ${
                  summary.averagePercent === null
                    ? 'text-zinc-200'
                    : summary.averagePercent >= 75
                    ? 'text-emerald-400'
                    : summary.averagePercent >= 50
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {summary.averagePercent === null ? '—' : `${summary.averagePercent}%`}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                {summary.averagePoints === null
                  ? 'nothing graded yet'
                  : `${summary.averagePoints.toFixed(1)} of 4 · A–F`}
              </span>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Graded
              </span>
              <span className="text-xl font-bold font-mono text-zinc-100">{summary.graded}</span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                of {summary.total} plan(s)
              </span>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                With a note
              </span>
              <span className="text-xl font-bold font-mono text-zinc-100">
                {summary.withFeedback}
              </span>
              <span className="text-[10px] text-zinc-400 font-mono block">
                feedback it reads next time
              </span>
            </div>
          </div>

          {/*
            The grades over time. One graded plan is not a trend, so the line waits until
            there are at least two — before that the average above already says the same thing.
          */}
          {trend.length >= 2 && (
            <div id="coach-plan-grade-trend" className="space-y-1.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                Grade over time (oldest → newest)
              </span>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis
                      domain={[0, 4]}
                      ticks={[0, 1, 2, 3, 4]}
                      tickFormatter={(value) => GRADE_BY_POINT.get(Number(value)) ?? ''}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      width={20}
                    />
                    <Tooltip content={<GradeTrendTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="points"
                      name="Grade"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#38bdf8' }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="runningAverage"
                      name="Running average"
                      stroke="#a1a1aa"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Each solid point is one plan the trader graded, A at the top and F at the bottom.
                The dashed line is the average of every grade up to that point, so an early bad
                run does not pin it down for good. Ungraded plans are not plotted — nobody has
                judged them yet.
              </p>
            </div>
          )}

          {/* The distribution, so a run of one grade cannot hide behind an average. */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Grade distribution
            </span>
            <div className="space-y-1">
              {summary.distribution.map((row) => (
                <div key={row.grade} className="flex items-center gap-2">
                  <span
                    className={`w-5 shrink-0 rounded border px-1 text-center font-mono text-[10px] font-bold ${GRADE_TONE[row.grade]}`}
                  >
                    {row.grade}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${BAR_TONE[row.grade]}`}
                      style={{ width: `${row.share}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-[10px] text-zinc-400">
                    {row.count} · {row.share}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* The plans themselves, newest first, each with the note it was given. */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
              Recent plans {listed.length < summary.total ? `(latest ${listed.length})` : ''}
            </span>
            <ul className="space-y-1.5">
              {listed.map((plan) => (
                <li
                  key={plan.id}
                  data-coach-plan-row={plan.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 space-y-1.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-500">
                      {(plan.createdAt ?? '').slice(0, 10)}
                    </span>
                    <span className="font-mono text-xs text-zinc-200">{plan.symbol}</span>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase font-bold ${
                        plan.direction === 'long'
                          ? 'border-emerald-800 bg-emerald-950/70 text-emerald-300'
                          : 'border-rose-800 bg-rose-950/70 text-rose-300'
                      }`}
                    >
                      {plan.direction}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {price(plan.entry)} → {price(plan.target)}
                      <span className="text-zinc-600"> · stop {price(plan.stop)}</span>
                    </span>
                    <span className="ml-auto shrink-0">
                      {plan.grade ? (
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${GRADE_TONE[plan.grade]}`}
                        >
                          {plan.grade}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-zinc-600">ungraded</span>
                      )}
                    </span>
                  </div>

                  {plan.headline && (
                    <p className="text-[11px] text-zinc-300 leading-snug">{plan.headline}</p>
                  )}

                  {plan.feedback && (
                    <p className="flex items-start gap-1.5 text-[11px] text-sky-200/90 leading-relaxed">
                      <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-sky-400/80" />
                      <span className="italic">"{plan.feedback}"</span>
                    </p>
                  )}

                  {!plan.feedback && plan.grade && (
                    <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <Target className="h-3 w-3" />
                      Graded with no note — a written line is what sharpens the next plan.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};
