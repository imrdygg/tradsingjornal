import React, { useEffect, useMemo, useState } from 'react';
import { Check, Compass, FileText, Flag, Sparkles, Trash2 } from 'lucide-react';
import type { CoachPlan, CoachPlanGrade, CoachPlanOutcome, Instrument } from '../../types';
import { CoachErrorCode } from '../../lib/ai/coach-client';
import type { SelfPlanResponse } from '../../lib/ai/coach-types';
import { askSelfPlan, type PlanCoachContext } from '../../lib/ai/plan-coach';
import {
  COACH_PLAN_OUTCOMES,
  COACH_PLAN_OUTCOME_LABEL,
} from '../../lib/analytics/coach-plan-grades';
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
 * Every plan is kept, not just the newest. The trader runs several instruments at once — a
 * call on MES while they wait on a setup, then a look at MCL or MNQ — so each answer is
 * saved as a draft they can reopen, grade or delete whenever they get to it, rather than
 * being pushed aside by the next call. An ungraded plan is a draft; grading one never
 * removes it from the list.
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

/** The colour a marked outcome reads in, so a loss is never mistaken for a win. */
const OUTCOME_TONE: Record<CoachPlanOutcome, string> = {
  target: 'border-emerald-800 bg-emerald-950/70 text-emerald-300',
  stopped: 'border-rose-800 bg-rose-950/70 text-rose-300',
  'no-fill': 'border-zinc-700 bg-zinc-900/70 text-zinc-400',
  open: 'border-sky-800 bg-sky-950/60 text-sky-300',
};

/** A price as it was recorded, or a dash. */
function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** How many saved plans the list shows before it says the rest are in the journal. */
const LIST_CAP = 20;

type ListFilter = 'all' | 'draft' | 'graded';

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

  const [symbol, setSymbol] = useState(defaultSymbol || symbols[0] || 'MES');
  const [state, setState] = useState<PlanState>({ loading: false, failure: null });
  const [draftGrade, setDraftGrade] = useState<CoachPlanGrade | null>(null);
  const [draftFeedback, setDraftFeedback] = useState('');
  const [draftOutcome, setDraftOutcome] = useState<CoachPlanOutcome | null>(null);
  // Which saved plan is open for reading and grading. Null falls back to the newest, so a
  // freshly made plan is the one on screen without a separate effect to select it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>('all');

  const viewing = useMemo(
    () => plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null,
    [plans, selectedId]
  );

  // Seed the grading form from the plan on screen, and re-seed whenever a different plan is
  // opened — a draft starts ungraded rather than inheriting the last plan's grade.
  const viewingId = viewing?.id ?? null;
  useEffect(() => {
    setDraftGrade(viewing?.grade ?? null);
    setDraftFeedback(viewing?.feedback ?? '');
    setDraftOutcome(viewing?.outcome ?? null);
  }, [viewingId]);
  // `viewing` is read inside the effect keyed on its id; the grade and note are the only
  // things that matter here, and re-seeding on every render would fight the trader's typing.

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
      // Open the plan that was just saved, so it is read on arrival and not the last draft.
      setSelectedId(plan.id);
      setState({ loading: false, failure: null });
      return;
    }
    setState({ loading: false, failure: { code: result.code, message: result.message } });
  }

  function saveGrade() {
    if (!viewing) return;
    onSavePlan({
      ...viewing,
      grade: draftGrade ?? undefined,
      feedback: draftFeedback.trim() || undefined,
      gradedAt: new Date().toISOString(),
      // The trader's mark of what the call actually did, which is what turns the plan record
      // into a win rate and an R result on the Calls tab.
      outcome: draftOutcome ?? undefined,
      outcomeAt: draftOutcome ? viewing.outcomeAt ?? new Date().toISOString() : undefined,
    });
  }

  function deletePlan(planId: string) {
    onDeletePlan(planId);
    // Nothing to do about the selection: it falls back to the newest plan that is left.
    if (selectedId === planId) setSelectedId(null);
  }

  const draftCount = plans.filter((plan) => !plan.grade).length;
  const gradedCount = plans.length - draftCount;

  const visible = useMemo(() => {
    if (listFilter === 'draft') return plans.filter((plan) => !plan.grade);
    if (listFilter === 'graded') return plans.filter((plan) => plan.grade);
    return plans;
  }, [plans, listFilter]);

  const hiddenCount = Math.max(0, visible.length - LIST_CAP);

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
            commits to a direction, entry, stop and target on its own. Every plan is saved as a
            draft you can grade now or come back to later.
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
          label={plans.length ? 'Make me another plan' : 'Make me a plan'}
          loadingLabel="Building a plan…"
          loading={state.loading}
          onClick={generate}
        />
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-500">
        It plans from the live quote and recent daily bars only — not from your levels — and
        says plainly that the call is its opinion and can be wrong. {plans.length
          ? `${plans.length} plan(s) kept · ${draftCount} draft(s) not graded yet · ${gradedCount} graded.`
          : 'Nothing made yet.'}
      </p>

      {state.loading && (
        <CoachLoading label="Reading the market and making its own call…" steps={COACH_WAIT_STEPS('a plan')} />
      )}

      {state.failure && (
        <CoachErrorPanel code={state.failure.code} message={state.failure.message} idSuffix="self-plan" />
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The saved plans, newest first, with the filter and per-row delete */}
      {/* ---------------------------------------------------------------- */}
      {plans.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              Saved plans ({visible.length})
            </span>
            <div className="flex items-center gap-1">
              {(
                [
                  ['all', `All ${plans.length}`],
                  ['draft', `Drafts ${draftCount}`],
                  ['graded', `Graded ${gradedCount}`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  id={`coach-plan-filter-${value}`}
                  aria-pressed={listFilter === value}
                  onClick={() => setListFilter(value)}
                  className={`rounded-lg border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                    listFilter === value
                      ? 'border-sky-700 bg-sky-950/50 text-sky-200'
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              {listFilter === 'draft'
                ? 'No drafts — every saved plan has a grade.'
                : 'No graded plans yet. Open a draft and grade it.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {visible.slice(0, LIST_CAP).map((plan) => {
                const isSelected = plan.id === viewing?.id;
                return (
                  <li
                    key={plan.id}
                    data-coach-plan-row={plan.id}
                    data-coach-plan-status={plan.grade ? 'graded' : 'draft'}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[11px] transition-colors ${
                      isSelected
                        ? 'border-sky-700 bg-sky-950/30'
                        : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900'
                    }`}
                  >
                    <button
                      type="button"
                      data-coach-plan-open={plan.id}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(plan.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          plan.direction === 'long' ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                      />
                      <span className="font-mono text-zinc-500">
                        {plan.createdAt.slice(0, 10)}
                      </span>
                      <span className="font-mono text-zinc-200">{plan.symbol}</span>
                      <span className="min-w-0 truncate font-mono text-zinc-400">
                        {plan.direction} · {price(plan.entry)} → {price(plan.target)}
                      </span>
                    </button>

                    {plan.outcome && (
                      <span
                        title={COACH_PLAN_OUTCOME_LABEL[plan.outcome]}
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${OUTCOME_TONE[plan.outcome]}`}
                      >
                        {plan.outcome === 'target'
                          ? 'WIN'
                          : plan.outcome === 'stopped'
                          ? 'LOSS'
                          : plan.outcome === 'no-fill'
                          ? 'no fill'
                          : 'open'}
                      </span>
                    )}
                    {plan.grade ? (
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${GRADE_TONE[plan.grade]}`}
                      >
                        {plan.grade}
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono text-[10px] text-amber-400/80">
                        draft
                      </span>
                    )}

                    <button
                      type="button"
                      data-coach-plan-delete={plan.id}
                      onClick={() => deletePlan(plan.id)}
                      className="shrink-0 rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400"
                      title="Delete this plan"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {hiddenCount > 0 && (
            <p className="text-[10px] text-zinc-500">
              {hiddenCount} older plan(s) not shown; use the filter above to narrow the list.
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* The open plan: read it, grade it, write the note, delete it         */}
      {/* ------------------------------------------------------------------- */}
      {viewing && (
        <div className="space-y-3 rounded-2xl border border-sky-900/50 bg-sky-950/10 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                <FileText className="h-3 w-3" />
                {viewing.grade ? 'Graded' : 'Draft'}
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase font-bold ${
                  viewing.direction === 'long'
                    ? 'border-emerald-800 bg-emerald-950/70 text-emerald-300'
                    : 'border-rose-800 bg-rose-950/70 text-rose-300'
                }`}
              >
                {viewing.direction}
              </span>
              <span className="font-mono text-xs text-zinc-200">{viewing.symbol}</span>
              <span className={`font-mono text-[10px] uppercase ${CONFIDENCE_TONE[viewing.confidence]}`}>
                {viewing.confidence} confidence
              </span>
              {viewing.grade && (
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${GRADE_TONE[viewing.grade]}`}
                >
                  Graded {viewing.grade}
                </span>
              )}
              {viewing.outcome && (
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${OUTCOME_TONE[viewing.outcome]}`}
                >
                  {COACH_PLAN_OUTCOME_LABEL[viewing.outcome]}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-zinc-500">
                {formatTimestamp(viewing.createdAt, timezone)}
              </span>
              <button
                type="button"
                id={`coach-self-plan-delete-${viewing.id}`}
                onClick={() => deletePlan(viewing.id)}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400"
                title="Delete this plan"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <p className="text-sm font-semibold text-zinc-100 leading-snug">{viewing.headline ?? ''}</p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Entry</span>
              <span className="text-sm font-bold text-zinc-100">{price(viewing.entry)}</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Stop</span>
              <span className="text-sm font-bold text-rose-300">{price(viewing.stop)}</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Target</span>
              <span className="text-sm font-bold text-emerald-300">{price(viewing.target)}</span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
              <span className="block text-[9px] uppercase text-zinc-500">Market at call</span>
              <span className="text-sm font-bold text-zinc-200">{price(viewing.marketPrice)}</span>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="block font-semibold text-zinc-400">Why it would enter</span>
              <p className="mt-0.5 text-zinc-200">{viewing.entryReason}</p>
            </div>
            <div>
              <span className="block font-semibold text-zinc-400">How it would exit</span>
              <p className="mt-0.5 text-zinc-200">{viewing.exitReason}</p>
            </div>
            <div>
              <span className="block font-semibold text-zinc-400">What proves it wrong</span>
              <p className="mt-0.5 text-zinc-200">{viewing.invalidation}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
              <span className="block font-semibold text-zinc-400">In its own words</span>
              <p className="mt-0.5 leading-relaxed text-zinc-300">{viewing.rationale}</p>
            </div>
          </div>

          {/*
            What the call actually did. The journal has no price history for it, so the trader's
            own mark is the only honest source for a win rate — and it is the honest half of the
            record, because the grade says whether the plan was well made and this says whether
            it worked.
          */}
          <div className="space-y-2 border-t border-sky-900/40 pt-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-sky-300">
              <Flag className="h-3 w-3" />
              What did the call actually do?
            </span>

            <div className="flex flex-wrap items-center gap-1.5">
              {COACH_PLAN_OUTCOMES.map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  id={`coach-plan-outcome-${outcome}`}
                  aria-pressed={draftOutcome === outcome}
                  onClick={() => setDraftOutcome(draftOutcome === outcome ? null : outcome)}
                  className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10px] transition-colors ${
                    draftOutcome === outcome
                      ? OUTCOME_TONE[outcome]
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {COACH_PLAN_OUTCOME_LABEL[outcome]}
                </button>
              ))}
            </div>

            <p className="text-[10px] leading-relaxed text-zinc-500">
              Mark the result so the Calls tab can score its calls: a target hit pays the
              reward-to-risk the plan named, a stop costs 1R, and a call that never filled costs
              nothing. Save it below with your grade.
            </p>
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-500">
                {viewing.grade ? 'Change the grade or result and save again, or delete the plan.' : 'Saving keeps the plan in the list.'}
              </span>
              <button
                type="button"
                id="coach-plan-save-grade"
                onClick={saveGrade}
                className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950 transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
              >
                <Check className="h-3.5 w-3.5" />
                Save grade, result &amp; feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </CoachCard>
  );
};
