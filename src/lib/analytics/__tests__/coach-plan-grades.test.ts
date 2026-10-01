import { describe, it, expect } from 'vitest';
import type { CoachPlan } from '../../../types';
import {
  COACH_PLAN_GRADES,
  sortCoachPlansNewestFirst,
  summariseCoachPlanGrades,
} from '../coach-plan-grades';

function plan(overrides: Partial<CoachPlan> = {}): CoachPlan {
  return {
    id: 'cp1',
    userId: 'u1',
    createdAt: '2026-09-19T13:00:00.000Z',
    symbol: 'MES',
    marketPrice: 7740,
    direction: 'long',
    entry: 7742,
    stop: 7732,
    target: 7760,
    confidence: 'medium',
    entryReason: 'a',
    exitReason: 'b',
    invalidation: 'c',
    rationale: 'd',
    ...overrides,
  };
}

describe('summariseCoachPlanGrades', () => {
  it('counts the plans, the graded ones and the rest as ungraded', () => {
    const summary = summariseCoachPlanGrades([
      plan({ id: 'a', grade: 'A' }),
      plan({ id: 'b', grade: 'B' }),
      plan({ id: 'c' }),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.graded).toBe(2);
    expect(summary.ungraded).toBe(1);
  });

  it('always lists all five grades, so an unearned grade reads as a zero', () => {
    const summary = summariseCoachPlanGrades([plan({ id: 'a', grade: 'A' })]);
    expect(summary.distribution.map((row) => row.grade)).toEqual([...COACH_PLAN_GRADES]);
    expect(summary.distribution.find((row) => row.grade === 'A')).toEqual({
      grade: 'A',
      count: 1,
      share: 100,
    });
    expect(summary.distribution.find((row) => row.grade === 'F')?.count).toBe(0);
  });

  it('averages on the 4-point scale and reports it as a percentage', () => {
    // A and C are 4 and 2 points, so 3.0 of 4 → 75%.
    const summary = summariseCoachPlanGrades([
      plan({ id: 'a', grade: 'A' }),
      plan({ id: 'b', grade: 'C' }),
    ]);
    expect(summary.averagePoints).toBe(3);
    expect(summary.averagePercent).toBe(75);
  });

  it('counts a grade it does not recognise as ungraded rather than trusting it', () => {
    const summary = summariseCoachPlanGrades([
      plan({ id: 'a', grade: 'Z' as unknown as CoachPlan['grade'] }),
      plan({ id: 'b', grade: 'B' }),
    ]);
    expect(summary.graded).toBe(1);
    expect(summary.ungraded).toBe(1);
    expect(summary.averagePoints).toBe(3);
  });

  it('counts only real written feedback, not whitespace', () => {
    const summary = summariseCoachPlanGrades([
      plan({ id: 'a', feedback: '  ' }),
      plan({ id: 'b', feedback: 'Entry was too close to the level.' }),
    ]);
    expect(summary.withFeedback).toBe(1);
  });

  it('reads an empty history as nothing graded, with no invented average', () => {
    const summary = summariseCoachPlanGrades([]);
    expect(summary.total).toBe(0);
    expect(summary.graded).toBe(0);
    expect(summary.averagePoints).toBeNull();
    expect(summary.averagePercent).toBeNull();
    expect(summary.distribution.every((row) => row.count === 0 && row.share === 0)).toBe(true);
  });
});

describe('sortCoachPlansNewestFirst', () => {
  it('orders newest first and leaves the journal list untouched', () => {
    const plans = [
      plan({ id: 'old', createdAt: '2026-09-17T13:00:00.000Z' }),
      plan({ id: 'new', createdAt: '2026-09-21T13:00:00.000Z' }),
      plan({ id: 'mid', createdAt: '2026-09-19T13:00:00.000Z' }),
    ];
    const before = plans.map((p) => p.id);

    expect(sortCoachPlansNewestFirst(plans).map((p) => p.id)).toEqual(['new', 'mid', 'old']);
    // The panel must not reorder the journal's own list underneath it.
    expect(plans.map((p) => p.id)).toEqual(before);
  });
});
