import type { CoachPlan, CoachPlanGrade } from '../../types';

/**
 * The trader's grades of the coach's own plans, read as a record.
 *
 * The grades are the only judgement of the coach's planning that exists — the coach is not
 * scored on anything else — so this is deliberately a plain count rather than a single
 * blended score. A run of F's and a run of A's both need to be visible on their own, and a
 * plan the trader never graded is reported as ungraded rather than guessed at.
 */

/** The grade scale, best to worst. The order the distribution is shown in. */
export const COACH_PLAN_GRADES: readonly CoachPlanGrade[] = ['A', 'B', 'C', 'D', 'F'];

/** Points for each grade on a 4-point scale, F = 0. */
const GRADE_POINTS: Record<CoachPlanGrade, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
  F: 0,
};

function isGrade(value: unknown): value is CoachPlanGrade {
  return typeof value === 'string' && (COACH_PLAN_GRADES as readonly string[]).includes(value);
}

/** One bar of the distribution: a grade, how many plans carry it, and its share. */
export interface CoachPlanGradeRow {
  grade: CoachPlanGrade;
  count: number;
  /** Share of the graded plans, 0-100. Zero when nothing is graded. */
  share: number;
}

export interface CoachPlanGradeSummary {
  /** Every plan the coach has made. */
  total: number;
  graded: number;
  ungraded: number;
  /** How many plans carry written feedback, graded or not. */
  withFeedback: number;
  /** A..F, always all five, so an empty grade reads as a zero rather than vanishing. */
  distribution: CoachPlanGradeRow[];
  /** Mean grade on the 4-point scale, or null when nothing is graded. */
  averagePoints: number | null;
  /** The same mean as 0-100, or null. */
  averagePercent: number | null;
}

/**
 * Counts the trader's grades and feedback across the coach's plans.
 *
 * Pure and total: a plan with a missing or unrecognised grade is counted as ungraded, so a
 * malformed record can never inflate the average.
 */
export function summariseCoachPlanGrades(plans: CoachPlan[]): CoachPlanGradeSummary {
  const total = plans.length;
  const gradedPlans = plans.filter((plan) => isGrade(plan.grade));
  const graded = gradedPlans.length;

  const distribution = COACH_PLAN_GRADES.map((grade) => {
    const count = gradedPlans.filter((plan) => plan.grade === grade).length;
    return { grade, count, share: graded ? Math.round((count / graded) * 100) : 0 };
  });

  const withFeedback = plans.filter((plan) => (plan.feedback ?? '').trim().length > 0).length;

  const sum = gradedPlans.reduce(
    (running, plan) => running + GRADE_POINTS[plan.grade as CoachPlanGrade],
    0
  );
  const averagePoints = graded ? sum / graded : null;

  return {
    total,
    graded,
    ungraded: total - graded,
    withFeedback,
    distribution,
    averagePoints,
    averagePercent: averagePoints === null ? null : Math.round((averagePoints / 4) * 100),
  };
}

/**
 * The coach's plans newest first.
 *
 * Sorted on a copy rather than in place so the panel never reorders the journal's own list,
 * and tolerant of a missing timestamp so an imported or hand-edited record still lists.
 */
export function sortCoachPlansNewestFirst(plans: CoachPlan[]): CoachPlan[] {
  return [...plans].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
