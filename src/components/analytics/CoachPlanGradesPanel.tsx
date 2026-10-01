import React from 'react';
import { GraduationCap, MessageSquareText, Target } from 'lucide-react';
import type { CoachPlan, CoachPlanGrade } from '../../types';
import {
  COACH_PLAN_GRADES,
  sortCoachPlansNewestFirst,
  summariseCoachPlanGrades,
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

export const CoachPlanGradesPanel: React.FC<CoachPlanGradesPanelProps> = ({ plans }) => {
  const summary = summariseCoachPlanGrades(plans);
  const listed = sortCoachPlansNewestFirst(plans).slice(0, 12);

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
