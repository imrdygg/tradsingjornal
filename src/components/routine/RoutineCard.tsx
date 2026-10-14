import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Flame,
  Info,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { DayRoutine, TradingDay } from '../../types';
import {
  ROUTINE_SECTION_BLURB,
  ROUTINE_SECTION_LABEL,
} from '../../lib/routine/routine-template';
import {
  routineProgress,
  toggleRoutineStep,
  type RoutineReadiness,
} from '../../lib/routine/routine-progress';
import type { RoutineConsistency } from '../../lib/routine/routine-consistency';

/**
 * The desk routine, on the day it belongs to.
 *
 * Three phases, ticked in place, with the one number that decides whether the day is safe to
 * trade: whether the critical steps are done. It sits on Today rather than getting a tab of
 * its own because a checklist you have to navigate to is a checklist that gets skipped on the
 * mornings it matters most.
 *
 * Two things are stated plainly in the card rather than left to the reader:
 *
 * - The routine scoring nothing but the routine. It never reads P&L, so a losing day taken
 *   properly still scores as prepared, and a profitable day taken sloppily does not.
 * - The consistency strip at the top is the trader's OWN record, not a general claim. It says
 *   what their prepared days averaged against their unprepared ones, and it says out loud that
 *   a handful of days is an observation and not proof. Turning this into a promise the app
 *   cannot keep — "run this and you will make money" — would be the fastest way to make the
 *   whole card ignorable.
 */

export interface RoutineCardProps {
  /** Today's routine record, when the day has one. */
  routine?: DayRoutine | null;
  /** The day the ticks belong to — source of the id, date and user. */
  todayTradingDay: TradingDay;
  /** Writes the whole record, through the same day-save path the plan uses. */
  onSaveRoutine: (routine: DayRoutine) => void;
  /** The trader's own completed-vs-skipped read, for the strip at the top. */
  consistency: RoutineConsistency;
}

/** How the readiness reads, and in what colour. */
const READINESS_META: Record<
  RoutineReadiness,
  { label: string; chip: string; bar: string }
> = {
  'not-started': {
    label: 'Not started',
    chip: 'border-zinc-700 bg-zinc-900 text-zinc-400',
    bar: 'bg-zinc-600',
  },
  preparing: {
    label: 'Preparing — not ready',
    chip: 'border-amber-800/70 bg-amber-950/40 text-amber-300',
    bar: 'bg-amber-500',
  },
  ready: {
    label: 'Ready to trade',
    chip: 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300',
    bar: 'bg-emerald-500',
  },
  complete: {
    label: 'Routine complete',
    chip: 'border-emerald-700/70 bg-emerald-900/40 text-emerald-200',
    bar: 'bg-emerald-400',
  },
};

const money = (value: number): string =>
  `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;

export const RoutineCard: React.FC<RoutineCardProps> = ({
  routine,
  todayTradingDay,
  onSaveRoutine,
  consistency,
}) => {
  const [explain, setExplain] = useState(false);

  const progress = useMemo(() => routineProgress(routine), [routine]);
  const meta = READINESS_META[progress.readiness];

  /**
   * Toggles a step and writes the day straight away.
   *
   * The write goes through the day's own save path rather than being batched, so a tick is
   * durable the moment it is made — a checklist half-filled and then lost to a closed tab is
   * worse than no checklist, because the trader believes it was recorded.
   */
  const toggle = (key: string) => {
    onSaveRoutine(toggleRoutineStep(routine, key, new Date().toISOString()));
  };

  const saveNote = (note: string) => {
    const base: DayRoutine = routine ?? { done: [], updatedAt: new Date().toISOString() };
    onSaveRoutine({ ...base, note, updatedAt: new Date().toISOString() });
  };

  /**
   * What the comparison can honestly say.
   *
   * Every branch here refuses to make a claim the sample cannot support, and the "not enough
   * evidence" branch is written to be informative rather than apologetic.
   */
  const comparisonLine = (() => {
    const c = consistency;
    if (c.comparedDays === 0) {
      return 'No traded days with a routine record yet. Once there are a few on each side, this compares your prepared days against your unprepared ones.';
    }
    if (c.avgPnLPrepared === null || c.avgPnLUnprepared === null) {
      const missing =
        c.avgPnLPrepared === null ? 'prepared' : 'unprepared';
      return `Only ${missing} days have traded so far, so there is nothing to compare yet. This needs days on both sides before it means anything.`;
    }
    const direction = c.pnlDelta === null ? 0 : c.pnlDelta;
    const verdict =
      direction > 0
        ? 'your prepared days averaged more'
        : direction < 0
        ? 'your unprepared days averaged more'
        : 'the two averaged the same';
    return `Prepared days averaged ${money(c.avgPnLPrepared)} across ${
      c.rows.filter((r) => r.prepared && r.tradeCount > 0).length
    } day(s); unprepared days averaged ${money(c.avgPnLUnprepared)} — ${verdict}. Your own record, not advice.`;
  })();

  return (
    <div
      data-testid="routine-card"
      data-readiness={progress.readiness}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5"
    >
      {/* ---- Header: what this is, how far through, and the gate ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-100">
            <ClipboardCheck className="h-4 w-4 text-zinc-300" />
            The Desk Routine
          </h1>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            The process the session is run against — prepared before the open, held during it,
            closed out after. The ticks are yours; the list is the job.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            data-testid="routine-readiness"
            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${meta.chip}`}
          >
            {meta.label}
          </span>
          <span
            data-testid="routine-progress"
            className="font-mono text-[11px] text-zinc-400"
          >
            {progress.done}/{progress.total} steps
          </span>
        </div>
      </div>

      {/* Progress bar. Colour follows readiness, so the bar and the chip can never disagree. */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${meta.bar}`}
          style={{ width: `${progress.pct}%` }}
        />
      </div>

      {/* ---- The gate, said in one line ---- */}
      {progress.criticalOutstanding.length > 0 ? (
        <p
          data-testid="routine-gate-line"
          className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
        >
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-amber-400" />
          <strong className="font-semibold">
            {progress.criticalOutstanding.length} critical step
            {progress.criticalOutstanding.length === 1 ? '' : 's'} outstanding:{' '}
          </strong>
          {progress.criticalOutstanding.map((step) => step.label).join(' · ')}
        </p>
      ) : (
        <p
          data-testid="routine-gate-line"
          className="mt-3 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] leading-relaxed text-emerald-200"
        >
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />
          Every critical step is done. A trade taken now is a prepared one.
        </p>
      )}

      {/* ---- Consistency strip: the trader's own record, framed as an observation ---- */}
      {consistency.trackedDays > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Current streak
            </span>
            <div className="mt-0.5 flex items-center gap-1 font-mono text-sm font-semibold text-zinc-100">
              <Flame
                className={`h-3.5 w-3.5 ${
                  consistency.currentStreak > 0 ? 'text-amber-400' : 'text-zinc-600'
                }`}
              />
              <span data-testid="routine-streak">{consistency.currentStreak}</span>
              <span className="text-[10px] font-normal text-zinc-500">
                {consistency.currentStreak === 1 ? 'day' : 'days'}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Best streak
            </span>
            <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-100">
              {consistency.longestStreak}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Prepared days
            </span>
            <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-100">
              {consistency.preparedDays}
              <span className="text-[10px] font-normal text-zinc-500">
                /{consistency.trackedDays}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Prepared rate
            </span>
            <div className="mt-0.5 font-mono text-sm font-semibold text-zinc-100">
              {consistency.preparedRate}%
            </div>
          </div>
        </div>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-500">
        <TrendingUp className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />
        <span>{comparisonLine}</span>
      </p>

      {/* ---- The list itself, phase by phase ---- */}
      <div className="mt-4 space-y-4">
        {progress.phases.map((phase) => (
          <section
            key={phase.section}
            id={`routine-phase-${phase.section}`}
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                {ROUTINE_SECTION_LABEL[phase.section]}
              </h2>
              <span className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                {phase.doneAt && (
                  <span className="text-emerald-400/80">
                    finished {new Date(phase.doneAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
                {phase.done}/{phase.total}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              {ROUTINE_SECTION_BLURB[phase.section]}
            </p>

            <ul className="mt-2.5 space-y-0.5">
              {phase.steps.map((step) => (
                <li key={step.key}>
                  <button
                    type="button"
                    data-testid={`routine-step-${step.key}`}
                    data-done={step.done ? 'true' : 'false'}
                    aria-pressed={step.done}
                    onClick={() => toggle(step.key)}
                    className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-zinc-900/70"
                  >
                    {step.done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-xs font-medium ${
                            step.done
                              ? 'text-zinc-500 line-through decoration-zinc-700'
                              : 'text-zinc-100'
                          }`}
                        >
                          {step.label}
                        </span>
                        {step.critical && !step.done && (
                          <span className="rounded border border-amber-900/70 bg-amber-950/50 px-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                            critical
                          </span>
                        )}
                      </span>
                      {!step.done && (
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
                          {step.detail}
                        </span>
                      )}
                      {explain && (
                        <span className="mt-1 block border-l-2 border-zinc-800 pl-2 text-[11px] italic leading-relaxed text-zinc-500">
                          {step.why}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* ---- The trader's own note, for the step they chose to skip ---- */}
      <div className="mt-4">
        <label
          htmlFor="routine-note"
          className="font-mono text-[10px] uppercase tracking-wider text-zinc-500"
        >
          Note on anything skipped or changed
        </label>
        <textarea
          id="routine-note"
          data-testid="routine-note"
          rows={2}
          value={routine?.note ?? ''}
          onChange={(e) => saveNote(e.target.value)}
          placeholder="Why a step was skipped, or what today needs that the list does not cover."
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
      </div>

      {/* ---- The explainer: what this list is, and what it is not ---- */}
      <button
        type="button"
        data-testid="routine-explain-toggle"
        onClick={() => setExplain((prev) => !prev)}
        aria-expanded={explain}
        className="mt-3 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <Info className="h-3 w-3" />
        {explain ? 'Hide the reasoning' : 'Why these steps, and what this cannot do'}
      </button>

      {explain && (
        <div
          data-testid="routine-explainer"
          className="mt-2 space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-400"
        >
          <p>
            <strong className="text-zinc-200">Where it comes from.</strong> There is no secret
            here. The public, documented record of traders who last is a set of habits around
            entries rather than a set of entries: risk defined before the open, a small number
            of written-down setups, and an honest review afterwards. This card is that loop made
            tickable. The per-step reasoning is behind{' '}
            <em>the reasoning</em> toggle above.
          </p>
          <p>
            <strong className="text-zinc-200">What the score is.</strong> Steps ticked, nothing
            else. P&amp;L is never an input, so a losing day taken properly scores as prepared
            and a winning day taken sloppily does not. A day off is a completed checklist, not a
            failed one.
          </p>
          <p>
            <strong className="text-zinc-200">What the comparison is not.</strong> A handful of
            prepared days against a handful of unprepared ones is an observation about your own
            record, not a controlled experiment and not proof. Treat it as a reason to look, and
            check the sample size before you believe the difference. The Analytics tab is where
            that check is done properly.
          </p>
          <p>
            <strong className="text-zinc-200">Why it only warns.</strong> The pre-trade gate
            flags outstanding critical steps in the trade form and still lets the trade be
            recorded. A form that refuses a trade is one the trader works around, and the record
            of having traded through an incomplete routine is exactly the evidence this journal
            exists to keep.
          </p>
          <p className="text-zinc-500">Routine date: {todayTradingDay.tradeDate}</p>
        </div>
      )}
    </div>
  );
};
