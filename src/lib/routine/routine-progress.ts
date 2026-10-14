import type { DayRoutine, RoutineSection } from '../../types';
import {
  ROUTINE_CRITICAL_STEPS,
  ROUTINE_SECTION_ORDER,
  ROUTINE_STEP_BY_KEY,
  ROUTINE_TEMPLATE,
  type RoutineStep,
} from './routine-template';

/**
 * How far through the desk routine a day is, and whether it is fit to trade.
 *
 * Pure and total. It takes whatever ticks a day happens to carry — including keys for steps
 * that later left the template — and reads only the ones that still exist. That is what keeps
 * an old day from being permanently stuck below a hundred percent after an upgrade, and it is
 * why nothing here trusts the stored list to be well-formed.
 *
 * Nothing in this file reads trades or P&L. Readiness is a statement about the trader's
 * preparation, never about whether the preparation worked: a fully prepared day that loses
 * money is still a fully prepared day, and a score that moves with P&L would teach exactly the
 * habit the routine exists to break.
 */

export type RoutineReadiness =
  /** Nothing ticked yet — the day has not been started. */
  | 'not-started'
  /** Started, but at least one critical step is still outstanding. */
  | 'preparing'
  /** Every critical step is ticked. A trade taken now is a prepared one. */
  | 'ready'
  /** Every step in every phase is ticked. */
  | 'complete';

export interface RoutinePhaseProgress {
  section: RoutineSection;
  /** Template steps in this phase. */
  total: number;
  done: number;
  /** True when every step in the phase is ticked. */
  complete: boolean;
  /** Steps ticked in this phase, resolved to the template. */
  steps: Array<RoutineStep & { done: boolean }>;
  /** When the phase was finished, if it ever was in one sitting. See `DayRoutine.phaseDoneAt`. */
  doneAt?: string;
}

export interface RoutineProgress {
  /** Steps in the template right now. */
  total: number;
  done: number;
  /** 0-100, rounded. Zero for an empty template rather than a division by zero. */
  pct: number;
  readiness: RoutineReadiness;
  phases: RoutinePhaseProgress[];
  /** Critical steps still unticked, in template order. Empty when the gate is open. */
  criticalOutstanding: RoutineStep[];
  /** Tick count only, for readers that do not need the shape. */
  tickedKeys: string[];
}

/** Deduplicates and drops keys the template no longer carries. */
export function normaliseTicks(routine?: DayRoutine | null): string[] {
  if (!routine || !Array.isArray(routine.done)) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const key of routine.done) {
    if (typeof key !== 'string') continue;
    if (!ROUTINE_STEP_BY_KEY.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(key);
  }
  return kept;
}

/**
 * The day's readiness, from its ticks alone.
 *
 * `not-started` is kept apart from `preparing` on purpose: a day nobody has touched and a day
 * half-prepared call for different sentences from the app, and collapsing them would make an
 * untouched day look like a considered one.
 */
export function routineReadiness(ticked: string[]): RoutineReadiness {
  const set = new Set(ticked);
  if (ticked.length === 0) return 'not-started';
  const outstanding = ROUTINE_CRITICAL_STEPS.some((step) => !set.has(step.key));
  if (outstanding) return 'preparing';
  return ticked.length >= ROUTINE_TEMPLATE.length ? 'complete' : 'ready';
}

/**
 * The whole reading of a day's routine: progress, phases and the gate.
 *
 * One function rather than three, so the card, the gate banner and the consistency analytics
 * can never disagree about how prepared a day was.
 */
export function routineProgress(routine?: DayRoutine | null): RoutineProgress {
  const tickedKeys = normaliseTicks(routine);
  const set = new Set(tickedKeys);

  const phases: RoutinePhaseProgress[] = ROUTINE_SECTION_ORDER.map((section) => {
    const steps = ROUTINE_TEMPLATE.filter((step) => step.section === section).map((step) => ({
      ...step,
      done: set.has(step.key),
    }));
    const done = steps.filter((step) => step.done).length;
    const doneAt = routine?.phaseDoneAt?.[section];
    // A stored finish time is only trusted while the phase is actually finished: a step
    // unticked after the phase was marked done must not leave a "finished at 9:25" label
    // sitting over an incomplete phase.
    const complete = steps.length > 0 && done === steps.length;
    return {
      section,
      total: steps.length,
      done,
      complete,
      steps,
      doneAt: complete && doneAt ? doneAt : undefined,
    };
  });

  const total = ROUTINE_TEMPLATE.length;
  const done = tickedKeys.length;
  const criticalOutstanding = ROUTINE_CRITICAL_STEPS.filter((step) => !set.has(step.key));

  return {
    total,
    done,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    readiness: routineReadiness(tickedKeys),
    phases,
    criticalOutstanding,
    tickedKeys,
  };
}

/**
 * Whether a trade may be taken against this day's preparation.
 *
 * Separate from {@link routineProgress} only so call sites that just want the gate do not have
 * to reach into the reading. It is the same answer either way.
 */
export function routineGate(routine?: DayRoutine | null): {
  ready: boolean;
  readiness: RoutineReadiness;
  outstanding: RoutineStep[];
} {
  const progress = routineProgress(routine);
  return {
    ready: progress.criticalOutstanding.length === 0,
    readiness: progress.readiness,
    outstanding: progress.criticalOutstanding,
  };
}

/** The next unticked step in template order, for the one-line "what is left" prompt. */
export function nextOutstandingStep(routine?: DayRoutine | null): RoutineStep | null {
  const { tickedKeys } = routineProgress(routine);
  const set = new Set(tickedKeys);
  return ROUTINE_TEMPLATE.find((step) => !set.has(step.key)) ?? null;
}

/** Ticks or unticks one step, returning a fresh record. Never mutates the input. */
export function toggleRoutineStep(
  routine: DayRoutine | undefined | null,
  key: string,
  at: string
): DayRoutine {
  if (!ROUTINE_STEP_BY_KEY.has(key)) {
    // An unknown key would otherwise be stored and silently ignored forever after.
    return routine ? { ...routine, updatedAt: at } : { done: [], updatedAt: at };
  }

  const ticked = normaliseTicks(routine);
  const isDone = ticked.includes(key);
  const nextDone = isDone ? ticked.filter((k) => k !== key) : [...ticked, key];

  const progress = routineProgress({ done: nextDone, updatedAt: at });
  const phase = ROUTINE_STEP_BY_KEY.get(key)?.section;
  const phaseDoneAt = { ...(routine?.phaseDoneAt ?? {}) };

  if (phase) {
    const phaseProgress = progress.phases.find((p) => p.section === phase);
    if (phaseProgress?.complete) {
      // Stamped when the phase first completes, and left alone afterwards: the time a trader
      // finished the morning is a fact about the morning, not about the last edit.
      phaseDoneAt[phase] = phaseDoneAt[phase] ?? at;
    } else {
      delete phaseDoneAt[phase];
    }
  }

  return {
    done: nextDone,
    phaseDoneAt: Object.keys(phaseDoneAt).length ? phaseDoneAt : undefined,
    note: routine?.note,
    updatedAt: at,
  };
}
