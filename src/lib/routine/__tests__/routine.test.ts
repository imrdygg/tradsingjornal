import { describe, expect, it } from 'vitest';
import type { DayRoutine, Trade, TradingDay } from '../../../types';
import {
  ROUTINE_CRITICAL_STEPS,
  ROUTINE_TEMPLATE,
  routineStepsInSection,
} from '../routine-template';
import {
  nextOutstandingStep,
  routineGate,
  routineProgress,
  toggleRoutineStep,
} from '../routine-progress';
import { buildRoutineConsistency } from '../routine-consistency';

/**
 * The desk routine's maths, tested without a browser.
 *
 * The parts worth guarding are the ones a future edit can silently break: that an old record
 * with a key the template no longer carries does not sit below a hundred percent forever, that
 * the readiness boundary sits exactly on the critical steps, and that the P&L comparison never
 * counts a day that did not trade.
 */

const AT = '2026-10-14T09:25:00.000Z';

function routine(done: string[]): DayRoutine {
  return { done, updatedAt: AT };
}

const allKeys = ROUTINE_TEMPLATE.map((step) => step.key);
const criticalKeys = ROUTINE_CRITICAL_STEPS.map((step) => step.key);
const nonCriticalKeys = allKeys.filter((key) => !criticalKeys.includes(key));

function makeDay(overrides: Partial<TradingDay> & { id: string; tradeDate: string }): TradingDay {
  return {
    userId: 'u1',
    status: 'planning',
    riskMode: 'normal',
    normalLossLimit: 100,
    plannedLossLimit: 100,
    contractsPlanned: 2,
    primaryInstrument: 'MES',
    allowedSessions: ['Regular Session'],
    marketBias: 'neutral',
    watchedSetups: [],
    importantLevels: [],
    waitingFor: '',
    stayOutIf: '',
    planChanges: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> & { id: string; tradingDayId: string }): Trade {
  return {
    userId: 'u1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 5000,
    initialStop: 4996,
    entryTime: AT,
    session: 'Regular Session',
    initialRisk: 20,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'closed',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe('routineProgress', () => {
  it('reads a day with no record as not started, with every critical step outstanding', () => {
    const progress = routineProgress(undefined);
    expect(progress.readiness).toBe('not-started');
    expect(progress.done).toBe(0);
    expect(progress.total).toBe(ROUTINE_TEMPLATE.length);
    expect(progress.pct).toBe(0);
    expect(progress.criticalOutstanding).toHaveLength(ROUTINE_CRITICAL_STEPS.length);
  });

  it('sums the phase totals to the whole template', () => {
    const progress = routineProgress(undefined);
    const summed = progress.phases.reduce((sum, phase) => sum + phase.total, 0);
    expect(summed).toBe(ROUTINE_TEMPLATE.length);
    expect(progress.phases.map((p) => p.section)).toEqual(['premarket', 'session', 'postmarket']);
  });

  it('ignores and deduplicates keys the template no longer carries', () => {
    const progress = routineProgress(routine(['premarket-state', 'premarket-state', 'gone-step']));
    expect(progress.done).toBe(1);
    expect(progress.tickedKeys).toEqual(['premarket-state']);
  });

  it('stays in preparing until every critical step is ticked, then reads ready', () => {
    expect(routineProgress(routine(criticalKeys.slice(0, -1))).readiness).toBe('preparing');
    expect(routineProgress(routine(criticalKeys)).readiness).toBe('ready');
  });

  it('reads complete only when every step in every phase is ticked', () => {
    const everythingButOne = [...criticalKeys, ...nonCriticalKeys].slice(0, -1);
    expect(routineProgress(routine(everythingButOne)).readiness).toBe('ready');
    expect(routineProgress(routine(allKeys)).readiness).toBe('complete');
    expect(routineProgress(routine(allKeys)).pct).toBe(100);
  });

  it('marks a phase complete only when all of its own steps are ticked', () => {
    const sessionKeys = routineStepsInSection('session').map((step) => step.key);
    const progress = routineProgress(routine(sessionKeys));
    const session = progress.phases.find((p) => p.section === 'session');
    expect(session?.complete).toBe(true);
    expect(progress.phases.find((p) => p.section === 'premarket')?.complete).toBe(false);
  });

  it('does not trust a stored finish time over an incomplete phase', () => {
    // The phase carried a timestamp when it was finished, and a step was unticked afterwards.
    const progress = routineProgress({
      done: ['premarket-state'],
      phaseDoneAt: { premarket: AT },
      updatedAt: AT,
    });
    const premarket = progress.phases.find((p) => p.section === 'premarket');
    expect(premarket?.complete).toBe(false);
    expect(premarket?.doneAt).toBeUndefined();
  });
});

describe('toggleRoutineStep', () => {
  it('ticks and unticks a step', () => {
    const ticked = toggleRoutineStep(undefined, 'premarket-state', AT);
    expect(ticked.done).toEqual(['premarket-state']);
    expect(toggleRoutineStep(ticked, 'premarket-state', AT).done).toEqual([]);
  });

  it('never mutates the record it was handed', () => {
    const before = routine(['premarket-state']);
    const snapshot = [...before.done];
    toggleRoutineStep(before, 'premarket-levels', AT);
    expect(before.done).toEqual(snapshot);
  });

  it('drops an unknown key instead of storing it forever', () => {
    const next = toggleRoutineStep(undefined, 'not-a-real-step', AT);
    expect(next.done).toEqual([]);
  });

  it('stamps the phase when it completes, and clears it when a step is unticked', () => {
    const sessionKeys = routineStepsInSection('session').map((step) => step.key);
    const complete = sessionKeys.reduce<DayRoutine | undefined>(
      (acc, key) => toggleRoutineStep(acc, key, AT),
      undefined
    );
    expect(complete?.phaseDoneAt?.session).toBe(AT);

    const reopened = toggleRoutineStep(complete, sessionKeys[0], AT);
    expect(reopened.phaseDoneAt?.session).toBeUndefined();
  });
});

describe('routineGate', () => {
  it('closes while a critical step is outstanding and names it', () => {
    const gate = routineGate(routine(criticalKeys.slice(1)));
    expect(gate.ready).toBe(false);
    expect(gate.outstanding.map((step) => step.key)).toEqual([criticalKeys[0]]);
  });

  it('opens once the critical steps are done, whatever the rest of the list says', () => {
    const gate = routineGate(routine(criticalKeys));
    expect(gate.ready).toBe(true);
    expect(gate.outstanding).toEqual([]);
  });

  it('is closed for a day with no record at all', () => {
    expect(routineGate(undefined).ready).toBe(false);
  });
});

describe('nextOutstandingStep', () => {
  it('returns the first unticked step in template order', () => {
    expect(nextOutstandingStep(undefined)?.key).toBe(ROUTINE_TEMPLATE[0].key);
    expect(nextOutstandingStep(routine([ROUTINE_TEMPLATE[0].key]))?.key).toBe(
      ROUTINE_TEMPLATE[1].key
    );
  });

  it('returns null once everything is ticked', () => {
    expect(nextOutstandingStep(routine(allKeys))).toBeNull();
  });
});

describe('buildRoutineConsistency', () => {
  const prepared = routine(criticalKeys);

  it('leaves out days that never opened the routine', () => {
    const result = buildRoutineConsistency({
      tradingDays: [
        makeDay({ id: 'd1', tradeDate: '2026-10-13', routine: prepared }),
        makeDay({ id: 'd2', tradeDate: '2026-10-12' }),
      ],
      trades: [],
    });
    expect(result.rows.map((row) => row.tradingDayId)).toEqual(['d1']);
    expect(result.trackedDays).toBe(1);
  });

  it('lists days newest first whatever order they arrive in', () => {
    const result = buildRoutineConsistency({
      tradingDays: [
        makeDay({ id: 'older', tradeDate: '2026-10-01', routine: prepared }),
        makeDay({ id: 'newer', tradeDate: '2026-10-09', routine: prepared }),
      ],
      trades: [],
    });
    expect(result.rows.map((row) => row.tradeDate)).toEqual(['2026-10-09', '2026-10-01']);
  });

  it('counts the current streak from the newest day and stops at the first unprepared one', () => {
    const result = buildRoutineConsistency({
      tradingDays: [
        makeDay({ id: 'd1', tradeDate: '2026-10-13', routine: prepared }),
        makeDay({ id: 'd2', tradeDate: '2026-10-12', routine: prepared }),
        makeDay({ id: 'd3', tradeDate: '2026-10-11', routine: routine(['premarket-state']) }),
        makeDay({ id: 'd4', tradeDate: '2026-10-10', routine: prepared }),
      ],
      trades: [],
    });
    expect(result.currentStreak).toBe(2);
    expect(result.longestStreak).toBe(2);
    expect(result.preparedDays).toBe(3);
    expect(result.preparedRate).toBe(75);
  });

  it('measures longest streak across the whole record, not just the recent end', () => {
    const result = buildRoutineConsistency({
      tradingDays: [
        makeDay({ id: 'd1', tradeDate: '2026-10-05', routine: routine(['premarket-state']) }),
        makeDay({ id: 'd2', tradeDate: '2026-10-04', routine: prepared }),
        makeDay({ id: 'd3', tradeDate: '2026-10-03', routine: prepared }),
        makeDay({ id: 'd4', tradeDate: '2026-10-02', routine: prepared }),
      ],
      trades: [],
    });
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(3);
  });

  it('compares only days that actually traded', () => {
    const result = buildRoutineConsistency({
      tradingDays: [
        // Prepared, traded, made $200.
        makeDay({ id: 'd1', tradeDate: '2026-10-13', routine: prepared }),
        // Prepared, but no trades: must not be averaged in at $0.
        makeDay({ id: 'd2', tradeDate: '2026-10-12', routine: prepared }),
        // Unprepared and traded, lost $100.
        makeDay({ id: 'd3', tradeDate: '2026-10-11', routine: routine(['premarket-state']) }),
      ],
      trades: [
        makeTrade({ id: 't1', tradingDayId: 'd1', grossPnL: 200, netPnL: 200 }),
        makeTrade({ id: 't2', tradingDayId: 'd3', grossPnL: -100, netPnL: -100 }),
      ],
    });
    expect(result.comparedDays).toBe(2);
    expect(result.avgPnLPrepared).toBe(200);
    expect(result.avgPnLUnprepared).toBe(-100);
    expect(result.pnlDelta).toBe(300);
  });

  it('reports no comparison when only one side has traded', () => {
    const result = buildRoutineConsistency({
      tradingDays: [makeDay({ id: 'd1', tradeDate: '2026-10-13', routine: prepared })],
      trades: [makeTrade({ id: 't1', tradingDayId: 'd1', grossPnL: 50, netPnL: 50 })],
    });
    expect(result.avgPnLPrepared).toBe(50);
    expect(result.avgPnLUnprepared).toBeNull();
    expect(result.pnlDelta).toBeNull();
  });

  it('reads a day with no trades as flat rather than as a loss', () => {
    const result = buildRoutineConsistency({
      tradingDays: [makeDay({ id: 'd1', tradeDate: '2026-10-13', routine: prepared })],
      trades: [],
    });
    expect(result.rows[0].pnl).toBe(0);
    expect(result.rows[0].tradeCount).toBe(0);
    expect(result.comparedDays).toBe(0);
  });

  it('counts a day complete only when every step is ticked', () => {
    const result = buildRoutineConsistency({
      tradingDays: [
        makeDay({ id: 'd1', tradeDate: '2026-10-13', routine: prepared }),
        makeDay({ id: 'd2', tradeDate: '2026-10-12', routine: routine(allKeys) }),
      ],
      trades: [],
    });
    expect(result.completeDays).toBe(1);
  });
});
