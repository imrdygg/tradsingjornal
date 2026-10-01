import React from 'react';
import {
  BookOpen,
  ClipboardCheck,
  FileText,
  Flag,
  GraduationCap,
  Target,
} from 'lucide-react';
import type { CoachPlan, CoachPlanOutcome, Instrument } from '../../types';
import type { PlanCoachContext } from '../../lib/ai/plan-coach';
import {
  COACH_PLAN_OUTCOMES,
  COACH_PLAN_OUTCOME_LABEL,
  summariseCoachPlanGrades,
  summariseCoachPlanOutcomes,
} from '../../lib/analytics/coach-plan-grades';
import { CoachPlanCard } from './CoachPlanCard';
import { CoachPlanGradeTrendChart } from './CoachPlanGradeTrendChart';

/**
 * The Calls tab: the coach's own calls, and how they turned out.
 *
 * This is the coach's own space, kept apart from the Coach tab's writing about the trader's
 * process. It is deliberately about calls and their results: the calls it makes on the live
 * market, the grades the trader gives how they were written, and the results the trader marks
 * once price has done what it did. Reviewing a call and grading it happen here, so a call made
 * on one instrument is still there to judge after the next one is asked for.
 *
 * The R figures are the coach's hypothetical result at one unit of risk per call, not money in
 * the trader's account — the tab says so plainly, because a win rate that quietly read as
 * account profit would be the most misleading number on the page.
 */
export interface CallsViewProps {
  /** The journal context each plan request is built from. */
  context: PlanCoachContext;
  /** The coach's own calls, newest first. */
  plans: CoachPlan[];
  /** The instrument the make-a-plan form opens on. */
  defaultSymbol: string;
  instruments: Instrument[];
  userId: string;
  onSavePlan: (plan: CoachPlan) => void;
  onDeletePlan: (planId: string) => void;
  timezone: string;
  /** How many setups the playbook holds, shown beside the calls. */
  setupCount: number;
  /** How many end-of-day reviews the trader has written. */
  reviewCount: number;
}

const OUTCOME_TONE: Record<CoachPlanOutcome, string> = {
  target: 'bg-emerald-500',
  stopped: 'bg-rose-500',
  'no-fill': 'bg-zinc-500',
  open: 'bg-sky-500',
};

const OUTCOME_TEXT_TONE: Record<CoachPlanOutcome, string> = {
  target: 'text-emerald-300',
  stopped: 'text-rose-300',
  'no-fill': 'text-zinc-400',
  open: 'text-sky-300',
};

/** A signed R for display, or a dash. */
function formatR(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

const StatCard: React.FC<{ label: string; value: string; sub: string; tone?: string }> = ({
  label,
  value,
  sub,
  tone = 'text-zinc-100',
}) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 space-y-1">
    <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
      {label}
    </span>
    <span className={`text-xl font-bold font-mono ${tone}`}>{value}</span>
    <span className="text-[10px] text-zinc-400 font-mono block">{sub}</span>
  </div>
);

export const CallsView: React.FC<CallsViewProps> = ({
  context,
  plans,
  defaultSymbol,
  instruments,
  userId,
  onSavePlan,
  onDeletePlan,
  timezone,
  setupCount,
  reviewCount,
}) => {
  const grades = summariseCoachPlanGrades(plans);
  const outcomes = summariseCoachPlanOutcomes(plans);

  const outcomeRows = COACH_PLAN_OUTCOMES.map((outcome) => ({
    outcome,
    count: outcomes[
      outcome === 'target'
        ? 'target'
        : outcome === 'stopped'
        ? 'stopped'
        : outcome === 'no-fill'
        ? 'noFill'
        : 'open'
    ],
  }));
  const maxOutcome = Math.max(1, ...outcomeRows.map((row) => row.count));

  const winRateTone =
    outcomes.winRate === null
      ? 'text-zinc-200'
      : outcomes.winRate >= 50
      ? 'text-emerald-400'
      : 'text-rose-400';
  const netRTone =
    outcomes.settled === 0
      ? 'text-zinc-200'
      : outcomes.netR > 0
      ? 'text-emerald-400'
      : outcomes.netR < 0
      ? 'text-rose-400'
      : 'text-zinc-200';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Target className="w-5 h-5 text-sky-400" />
          Calls
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          The coach's own calls: what it called, how it wrote them, and how they turned out. Make
          a call on any instrument, keep it as a draft, and grade it and mark its result whenever
          you get to it.
        </p>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* The record so far                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div
        id="calls-overview"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-sky-400" />
            How the calls have gone
          </h2>
          <span className="text-[11px] font-mono text-zinc-500">
            the coach's result, not your account P&amp;L
          </span>
        </div>

        {grades.total === 0 ? (
          <p className="text-xs text-zinc-400 leading-relaxed">
            No calls yet. Make one below — it is saved as a draft, and the grade and result you
            give it are what turn this into a scoreboard.
          </p>
        ) : (
          <>
            <div id="calls-overview-facts" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                label="Calls made"
                value={`${grades.total}`}
                sub={`${grades.ungraded} draft(s) ungraded`}
              />
              <StatCard
                label="Avg grade"
                value={grades.averagePercent === null ? '—' : `${grades.averagePercent}%`}
                sub={`${grades.graded} of ${grades.total} graded`}
                tone={
                  grades.averagePercent === null
                    ? 'text-zinc-200'
                    : grades.averagePercent >= 75
                    ? 'text-emerald-400'
                    : grades.averagePercent >= 50
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }
              />
              <StatCard
                label="Win rate"
                value={outcomes.winRate === null ? '—' : `${outcomes.winRate}%`}
                sub={
                  outcomes.settled
                    ? `${outcomes.target}W / ${outcomes.stopped}L`
                    : 'no settled calls yet'
                }
                tone={winRateTone}
              />
              <StatCard
                label="Net R"
                value={outcomes.settled === 0 ? '—' : formatR(outcomes.netR)}
                sub={
                  outcomes.averageR === null
                    ? 'mark a result to score it'
                    : `${formatR(outcomes.averageR)} avg per call`
                }
                tone={netRTone}
              />
              <StatCard
                label="Setups"
                value={`${setupCount}`}
                sub="in your playbook"
              />
              <StatCard
                label="Reviews written"
                value={`${reviewCount}`}
                sub="end-of-day reviews"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* The grades over time, when there is a trend to draw. */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  Grade over time
                </span>
                {grades.graded >= 2 ? (
                  <>
                    <CoachPlanGradeTrendChart plans={plans} id="calls-grade-trend" />
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      A at the top, F at the bottom, with the running average behind it. Only
                      graded calls are plotted.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Two graded calls draw a trend line here — one grade is a point, not a trend.
                  </p>
                )}
              </div>

              {/* What the calls actually did, as the trader marked them. */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 block">
                  What they did
                </span>
                <div className="space-y-1">
                  {outcomeRows.map((row) => (
                    <div key={row.outcome} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 font-mono text-[10px] text-zinc-400">
                        {COACH_PLAN_OUTCOME_LABEL[row.outcome]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${OUTCOME_TONE[row.outcome]}`}
                          style={{ width: `${Math.round((row.count / maxOutcome) * 100)}%` }}
                        />
                      </div>
                      <span
                        className={`w-6 shrink-0 text-right font-mono text-[11px] ${OUTCOME_TEXT_TONE[row.outcome]}`}
                      >
                        {row.count}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="font-mono text-[10px] text-zinc-500">
                      {outcomes.unmarked} not marked yet
                      {outcomes.unscored > 0 ? ` · ${outcomes.unscored} unscored` : ''}
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                      <Flag className="h-3 w-3" />
                      a target pays the plan's reward-to-risk, a stop costs 1R
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {outcomes.settled > 0 && (
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Win rate and R count settled calls only: a call that never filled, is still open or
                has not been marked would otherwise dilute the number with results that never
                happened. The R is the coach's own result at one unit of risk per call — it is not
                money in your account, and it never touches your journal's P&amp;L.
              </p>
            )}
          </>
        )}
      </div>

      {/*
        The working end of the tab: make a call, keep it as a draft, and grade or delete any of
        them. The same card the Coach tab used to carry, moved here now that calls have a home.
      */}
      <CoachPlanCard
        context={context}
        plans={plans}
        defaultSymbol={defaultSymbol}
        instruments={instruments}
        userId={userId}
        onSavePlan={onSavePlan}
        onDeletePlan={onDeletePlan}
        timezone={timezone}
      />

      {/* What the scoreboard is built from, so the numbers above can be checked. */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-zinc-400" />
          What feeds this tab
        </h2>
        <ul className="space-y-1 text-[11px] text-zinc-400 leading-relaxed">
          <li className="flex items-start gap-1.5">
            <FileText className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
            Every call you make is saved as a draft and never overwritten, so a call on one
            instrument is still here after you ask about another.
          </li>
          <li className="flex items-start gap-1.5">
            <ClipboardCheck className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
            The grade is your judgement of how the call was written; the result is what the market
            did with it. The win rate and R come only from marked results.
          </li>
        </ul>
      </div>
    </div>
  );
};
