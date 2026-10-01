import React, { useEffect, useMemo, useState } from 'react';
import { Check, Compass, Sparkles, Trash2 } from 'lucide-react';
import type { CoachPlan, CoachPlanGrade, Instrument } from '../../types';
import type { CoachResult } from '../../lib/ai/coach-client';
import { CoachErrorCode, requestCoach } from '../../lib/ai/coach-client';
import type { SelfPlanResponse } from '../../lib/ai/coach-types';
import { askSelfPlan, type PlanCoachContext } from '../../lib/ai/plan-coach';
import { instrumentSymbol } from '../../lib/trading/instruments';
import {
  CoachCard,
  CoachErrorPanel,
  CoachGenerateButton,
  CoachLoading,
} from './coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The coach's own trade plan, and the trader's grade of it.
 *
 * This is the one place the coach makes a call entirely by itself: it is handed the live
 * read for one instrument and nothing of the trader's own levels, and it commits to a
 * direction, an entry, a stop and a target. The trader asked for exactly that — a plan to
 * judge rather than a plan that agrees with them — so the loop here is generate, then grade,
 * then write feedback, and that feedback travels back into the coach's next plan.
 *
 * Nothing here is written into the day's plan: this is a record the coach made and the
 * trader judged, kept separate from the plan they trade. It is an opinion and labelled as
 * one throughout.
 */
export interface CoachPlanCardProps {
  /** The journal context the plan request is built from. */
  context: PlanCoachContext;
  /** The coach's own plans, newest first. */
  plans: CoachPlan[];
  /** The instrument to open on, when the day names one. */
  defaultSymbol: string;
  instruments: Instrument[];
  userId: string;
  onSavePlan: (plan: CoachPlan) => void;
  onDeletePlan: (planId: string) => void;
  timezone: string;
}

interface PlanState {
  loading: boolean;
  failure: { code: CoachErrorCode; message: string } | null;
}

const GRADES: CoachPlanGrade[] = ['A', 'B', 'C', 'D', 'F'];

const GRADE_TONE: Record<CoachPlanGrade, string> = {
  A: 'border-emerald-700 bg-emerald-950/70 text-emerald-300',
  B: 'border-lime-700 bg-lime-950/60 text-lime-300',
  C: 'border-amber-700 bg-amber-950/60 text-amber-300',
  D: 'border-orange-700 bg-orange-950/60 text-orange-300',
  F: 'border-rose-700 bg-rose-950/60 text-rose-300',
};

const CONFIDENCE_TONE: Record<CoachPlan['confidence'], string> = {
  high: 'text-emerald-300',
  medium: 'text-amber-300',
  low: 'text-zinc-400',
};

/** A price as it was recorded, or a dash. */
function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const CoachPlanCard: React.FC<CoachPlanCardProps> = ({
  context,
  plans,
  defaultSymbol,
  instruments,
  userId,
  onSavePlan,
  onDeletePlan,
  timezone,
}) => {
  const symbols = useMemo(() => {
    const active = instruments.filter((instrument) => instrument.active);
    const list = (active.length ? active : instruments).map((instrument) => instrument.symbol);
    return [...new Set(list)];
  }, [instruments]);

  const [symbol, setSymbol] = useState(
    defaultSymbol || symbols[0] || 'MES'
  );
  const [state, setState] = useState<PlanState>({ loading: false, failure: null });
  const [draftGrade, setDraftGrade] = useState<CoachPlanGrade | null>(null);
  const [draftFeedback, setDraftFeedback] = useState('');

  const latest = plans[0] ?? null;

  // Seed the grading form from whatever plan is on screen, and re-seed whenever a different
  // plan becomes the newest one — a fresh plan starts ungraded rather than inheriting the
  // last plan's grade.
  const latestId = latest?.id ?? null;
  useEffect(() => {
    setDraftGrade(latest?.grade ?? null);
    setDraftFeedback(latest?.feedback ?? '');
  }, [latestId]);
  // `latest` is read inside the effect keyed on its id; the fields are the only thing that
  // matters here, and re-seeding on every render of the same plan would fight the trader's typing.

  async function generate() {
    if (!symbol.trim()) return;
    setState({ loading: true, failure: null });
    const result = await askSelfPlan({ ...context, coachPlans: plans }, symbol);

    if (result.ok) {
      const answer = result.data as SelfPlanResponse;
      const plan: CoachPlan = {
        id: `coachplan-${Date.now()}`,
        userId,
        headline: answer.headline,
        createdAt: new Date().toISOString(),
        symbol: answer.symbol || symbol,
        marketPrice: result.instrument?.price ?? null,
        direction: answer.direction,
        entry: answer.entry,
        stop: answer.stop,
        target: answer.target,
        confidence: answer.confidence,
        entryReason: answer.entryReason,
        exitReason: answer.exitReason,
        invalidation: answer.invalidation,
        rationale: answer.rationale,
      };
      onSavePlan(plan);
      setState({ loading: false, failure: null });
      return;
    }
    setState({ loading: false, failure: { code: result.code, message: result.message } });
  }

  function saveGrade() {
    if (!latest) return;
    onSavePlan({
      ...latest,
      grade: draftGrade ?? undefined,
      feedback: draftFeedback.trim() || undefined,
      gradedAt: new Date().toISOString(),
    });
  }

  const gradedCount = plans.filter((plan) => plan.grade).length;

  return (
    <CoachCard id="coach-self-plan" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Compass className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Make me a plan — the coach's own call
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            The coach reads the live market for one instrument, ignores your own levels, and
            commits to a direction, entry, stop and target on its own. Grade it and write what
            you thought — that feedback shapes its next plan.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-zinc-400">
          Instrument
          <select
            id="coach-self-plan-symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            className="mt-1 block rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
          >
            {symbols.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <CoachGenerateButton
          id="coach-self-plan-generate"
          label={latest ? 'Make me another plan' : 'Make me a plan'}
          loadingLabel="Building a plan…"
          loading={state.loading}
          onClick={generate}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-500">
        It plans from the live quote and recent daily bars only — not from your levels — and
        says plainly that the call is its opinion and can be wrong. {gradedCount > 0
          ? `${gradedCount} of ${plans.length} plan(s) graded so far.`
          : 'Nothing graded yet.'}
      </p>

      {state.loading && (
        <CoachLoading label="Reading the market and making its own call…" steps={COACH_WAIT_STEPS('a plan')} />
      )}

      {state.failure && (
        <CoachErrorPanel code={state.failure.code} message={state.failure.message} idSuffix="self-plan" />
      )}

      {latest && (
        <div className="space-y-3 rounded-2xl border border-sky-900/50 bg-sky-950/10 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase font-bold ${
                  latest.direction === 'long'
                    ? 'border-emerald-800 bg-emerald-950/70 text-emerald-300'
                    : 'border-rose-800 bg-rose-950/70 text-rose-300'
                }`}
              >
                {latest.direction}
              </span>
              <span className="font-mono text-xs text-zinc-200">{latest.symbol}</span>
              <span className={`font-mono text-[10px] uppercase ${CONFIDENCE_TONE[latest.confidence]}`}>
                {latest.confidence} confidence
              </span>
              {latest.grade && (
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${GRADE_TONE[latest.grade]}`}
                >
                  Graded {latest.grade}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-zinc-500">
                {formatTimestamp(latest.createdAt, timezone)}
              </span>
              <button
                type="button"
                id={`coach-self-plan-delete-${latest.id}`}
                onClick={() => onDeletePlan(latest.id)}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400"
                title="Delete this plan"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <p className="text-sm font-semibold text-zinc-100 leading-snug">{latest.headline ?? ''}</p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Entry</span>
              <span className="text-sm font-bold text-zinc-100">{price(latest.entry)}</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Stop</span>
              <span className="text-sm font-bold text-rose-300">{price(latest.stop)}</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Target</span>
              <span className="text-sm font-bold text-emerald-300">{price(latest.target)}</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Market at call</span>
              <span className="text-sm font-bold text-zinc-200">{price(latest.marketPrice)}</span>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="block font-semibold text-zinc-400">Why it would enter</span>
              <p className="mt-0.5 text-zinc-200">{latest.entryReason}</p>
            </div>
            <div>
              <span className="block font-semibold text-zinc-400">How it would exit</span>
              <p className="mt-0.5 text-zinc-200">{latest.exitReason}</p>
            </div>
            <div>
              <span className="block font-semibold text-zinc-400">What proves it wrong</span>
              <p className="mt-0.5 text-zinc-200">{latest.invalidation}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
              <span className="block font-semibold text-zinc-400">In its own words</span>
              <p className="mt-0.5 leading-relaxed text-zinc-300">{latest.rationale}</p>
            </div>
          </div>

          {/* The grading loop: the trader's judgement, fed back into the next plan. */}
          <div className="space-y-2 border-t border-sky-900/40 pt-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-sky-300">
              <Sparkles className="h-3 w-3" />
              Your grade of this plan
            </span>

            <div className="flex items-center gap-1.5">
              {GRADES.map((grade) => (
                <button
                  key={grade}
                  type="button"
                  id={`coach-plan-grade-${grade}`}
                  aria-pressed={draftGrade === grade}
                  onClick={() => setDraftGrade(draftGrade === grade ? null : grade)}
                  className={`h-8 w-8 rounded-lg border font-mono text-xs font-bold transition-colors ${
                    draftGrade === grade
                      ? GRADE_TONE[grade]
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {grade}
                </button>
              ))}
            </div>

            <textarea
              id="coach-plan-feedback"
              rows={3}
              value={draftFeedback}
              onChange={(event) => setDraftFeedback(event.target.value)}
              placeholder="What did it get right or wrong? Write it as you would tell a person — the coach reads this before its next plan."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />

            <div className="flex items-center justify-end">
              <button
                type="button"
                id="coach-plan-save-grade"
                onClick={saveGrade}
                className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950 transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
              >
                <Check className="h-3.5 w-3.5" />
                Save grade &amp; feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The plan history, so the trader can see what the coach has been calling. */}
      {plans.length > 1 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
            Earlier plans ({plans.length - 1})
          </span>
          <ul className="space-y-1">
            {plans.slice(1, 8).map((plan) => (
              <li
                key={plan.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px]"
              >
                <span className="min-w-0 truncate text-zinc-300">
                  <span className="font-mono text-zinc-500">{plan.createdAt.slice(0, 10)}</span>{' '}
                  {plan.symbol} {plan.direction} · {price(plan.entry)} → {price(plan.target)}
                </span>
                <span className="shrink-0 font-mono">
                  {plan.grade ? (
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${GRADE_TONE[plan.grade]}`}>
                      {plan.grade}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-600">ungraded</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </CoachCard>
  );
};
