import { describe, it, expect } from 'vitest';
import { LevelTouch, MarkedLevel } from '../../../types';
import {
  evaluateTouch,
  findLevelEdges,
  MIN_DECIDED,
  summarizeMarkedLevels,
  summarizeTouches,
  type PriceSample,
} from '../level-edge';

function marked(over: Partial<MarkedLevel> = {}): MarkedLevel {
  return {
    id: 'l',
    userId: 'u',
    tradingDayId: 'd',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    kind: 'resistance',
    price: 100,
    zonePoints: 2,
    session: 'Overnight',
    createdAt: '2026-09-28T02:00:00Z',
    updatedAt: '2026-09-28T02:00:00Z',
    ...over,
  };
}

function touch(over: Partial<LevelTouch> = {}): LevelTouch {
  return {
    id: 't',
    userId: 'u',
    tradingDayId: 'd',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    kind: 'resistance',
    price: 100,
    zonePoints: 2,
    touchedAt: '2026-09-28T02:00:00Z',
    session: 'Overnight',
    outcome: 'watching',
    checks: 1,
    createdAt: '2026-09-28T02:00:00Z',
    updatedAt: '2026-09-28T02:00:00Z',
    ...over,
  };
}

const s = (at: string, price: number): PriceSample => ({ at, price });

describe('evaluateTouch', () => {
  it('reads a resistance break that never comes back as never-returned', () => {
    const result = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2 }),
      [s('02:01', 100.5), s('02:02', 102), s('02:05', 103), s('02:30', 105)]
    );
    expect(result.outcome).toBe('never-returned');
    expect(result.maxExcursionPoints).toBe(5);
    expect(result.maxReturnPoints).toBe(0);
    expect(result.returnedAt).toBeUndefined();
    expect(result.checkedPrice).toBe(105);
  });

  it('reads price back inside the zone as a return, however far it later ran', () => {
    const result = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2 }),
      [s('02:01', 102), s('02:10', 108), s('02:20', 100), s('02:40', 110)]
    );
    expect(result.outcome).toBe('returned');
    expect(result.returnedAt).toBe('02:20');
    // The dip to 100 is level-with; 110 is the best run.
    expect(result.maxExcursionPoints).toBe(10);
    expect(result.maxReturnPoints).toBe(0);
  });

  it('measures how far price came back through the level', () => {
    const result = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2 }),
      [s('02:01', 103), s('02:20', 98)]
    );
    expect(result.outcome).toBe('returned');
    expect(result.maxReturnPoints).toBe(2);
  });

  it('reads a support break downward the same way', () => {
    const never = evaluateTouch(
      touch({ kind: 'support', price: 100, zonePoints: 2 }),
      [s('02:01', 98), s('02:05', 96), s('02:30', 95)]
    );
    expect(never.outcome).toBe('never-returned');
    expect(never.maxExcursionPoints).toBe(5);

    const returned = evaluateTouch(
      touch({ kind: 'support', price: 100, zonePoints: 2 }),
      [s('02:01', 98), s('02:05', 96), s('02:30', 100.5)]
    );
    expect(returned.outcome).toBe('returned');
    expect(returned.maxReturnPoints).toBe(0.5);
  });

  it('stays watching while price has not left the zone', () => {
    const result = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2 }),
      [s('02:01', 100.2), s('02:02', 99.5), s('02:03', 100.8)]
    );
    expect(result.outcome).toBe('watching');
    expect(result.maxExcursionPoints).toBe(0);
    expect(result.maxReturnPoints).toBe(0);
  });

  it('does not call a dip back a return before the break exists', () => {
    // In the zone, briefly below the zone's low, then breaking upward and away: the
    // wobble under the zone happened BEFORE the break, so it is not a return.
    const result = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2 }),
      [s('02:01', 98.5), s('02:02', 102), s('02:10', 106)]
    );
    expect(result.outcome).toBe('never-returned');
  });

  it('ignores non-finite samples rather than inventing a return', () => {
    const result = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2 }),
      [s('02:01', Number.NaN), s('02:02', 104)]
    );
    expect(result.outcome).toBe('never-returned');
    expect(result.checkedPrice).toBe(104);
  });

  it('reads the break on the side the trader recorded, not the level\u2019s lean', () => {
    // A support that actually broke UPWARD: with the direction recorded, the rise above the
    // zone is the break, so price staying up there is a hold rather than an endless watch.
    const upBreak = evaluateTouch(
      touch({ kind: 'support', price: 100, zonePoints: 2, breakDirection: 'up' }),
      [s('02:01', 102), s('02:05', 104)]
    );
    expect(upBreak.outcome).toBe('never-returned');
    expect(upBreak.maxExcursionPoints).toBe(4);

    // A resistance that broke DOWNWARD, then traded back inside the zone, is a return.
    const downBreak = evaluateTouch(
      touch({ kind: 'resistance', price: 100, zonePoints: 2, breakDirection: 'down' }),
      [s('02:01', 98), s('02:10', 100.5)]
    );
    expect(downBreak.outcome).toBe('returned');
  });

  it('stays watching while price has not left on the recorded side', () => {
    // An upward break was recorded, but the samples only moved the other way — nothing has
    // broken yet, and the evaluator does not pretend the level's lean was the break.
    const result = evaluateTouch(
      touch({ kind: 'support', price: 100, zonePoints: 2, breakDirection: 'up' }),
      [s('02:01', 98), s('02:05', 96)]
    );
    expect(result.outcome).toBe('watching');
  });
});

describe('summarizeTouches', () => {
  it('reports the hold rate over decided touches only', () => {
    const stats = summarizeTouches([
      touch({ id: 'a', outcome: 'never-returned', maxExcursionPoints: 10 }),
      touch({ id: 'b', outcome: 'never-returned', maxExcursionPoints: 5 }),
      touch({ id: 'c', outcome: 'returned', maxExcursionPoints: 2 }),
      touch({ id: 'd', outcome: 'watching' }),
      touch({ id: 'e', outcome: 'invalid' }),
    ]);
    expect(stats.touches).toBe(5);
    expect(stats.decided).toBe(3);
    expect(stats.neverReturned).toBe(2);
    expect(stats.returned).toBe(1);
    expect(stats.watching).toBe(1);
    expect(stats.invalid).toBe(1);
    expect(stats.holdRate).toBeCloseTo(66.7, 1);
    expect(stats.avgExcursionPoints).toBeCloseTo(5.67, 2);
  });

  it('reports a null rate, not zero, while nothing is decided', () => {
    const stats = summarizeTouches([touch({ outcome: 'watching' }), touch({ outcome: 'watching' })]);
    expect(stats.decided).toBe(0);
    expect(stats.holdRate).toBeNull();
    expect(stats.enoughData).toBe(false);
  });

  it('withholds the rate as an edge below the sample threshold', () => {
    const thin = summarizeTouches([touch({ outcome: 'never-returned' })]);
    expect(thin.enoughData).toBe(false);

    const enough = summarizeTouches(
      Array.from({ length: MIN_DECIDED }, (_, i) =>
        touch({ id: `t${i}`, outcome: 'never-returned' })
      )
    );
    expect(enough.enoughData).toBe(true);
  });
});

describe('summarizeMarkedLevels', () => {
  it('counts tested lines by the touches that link back to them', () => {
    const levels = [
      marked({ id: 'a' }),
      marked({ id: 'b' }),
      marked({ id: 'c' }),
      marked({ id: 'd' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', outcome: 'never-returned' }),
      touch({ id: 't2', levelId: 'b', outcome: 'returned' }),
      // A touch with no level behind it belongs to the older record and must not count
      // towards the marked-level coverage either way.
      touch({ id: 't3', outcome: 'never-returned' }),
    ];

    const coverage = summarizeMarkedLevels(levels, touches);
    expect(coverage.marked).toBe(4);
    expect(coverage.tested).toBe(2);
    expect(coverage.untested).toBe(2);
    expect(coverage.testRate).toBe(50);
    // The hold rate is over the tested lines only: 1 held of 2 decided.
    expect(coverage.testedStats.decided).toBe(2);
    expect(coverage.testedStats.holdRate).toBe(50);
  });

  it('reports a null test rate while nothing has been marked', () => {
    const coverage = summarizeMarkedLevels([], [touch({ levelId: 'ghost' })]);
    expect(coverage.marked).toBe(0);
    expect(coverage.tested).toBe(0);
    expect(coverage.testRate).toBeNull();
    expect(coverage.testedStats.touches).toBe(0);
  });

  it('drops a voided line from every count and reports how many were set aside', () => {
    const levels = [
      marked({ id: 'a', resolution: 'void' }),
      marked({ id: 'b' }),
    ];
    const coverage = summarizeMarkedLevels(levels, []);
    expect(coverage.marked).toBe(1);
    expect(coverage.tested).toBe(0);
    expect(coverage.untested).toBe(1);
    expect(coverage.voided).toBe(1);
    expect(coverage.testRate).toBe(0);
  });

  it('counts an explicit never-touched line as untested but broken out from the rest', () => {
    const levels = [
      marked({ id: 'a', resolution: 'never-touched' }),
      // Open, not yet resolved.
      marked({ id: 'b' }),
      marked({ id: 'c' }),
    ];
    const touches = [touch({ id: 't1', levelId: 'c', outcome: 'never-returned' })];
    const coverage = summarizeMarkedLevels(levels, touches);
    expect(coverage.marked).toBe(3);
    expect(coverage.tested).toBe(1);
    expect(coverage.untested).toBe(2);
    expect(coverage.neverTouched).toBe(1);
  });
});

describe('findLevelEdges', () => {
  it('ranks enough-sample buckets by hold rate and filters the thin ones', () => {
    const touches: LevelTouch[] = [
      // Overnight: 3 of 3 held.
      touch({ id: 'o1', session: 'Overnight', outcome: 'never-returned' }),
      touch({ id: 'o2', session: 'Overnight', outcome: 'never-returned' }),
      touch({ id: 'o3', session: 'Overnight', outcome: 'never-returned' }),
      // Regular session: 1 of 3 held.
      touch({ id: 'r1', session: 'Regular Session', outcome: 'never-returned' }),
      touch({ id: 'r2', session: 'Regular Session', outcome: 'returned' }),
      touch({ id: 'r3', session: 'Regular Session', outcome: 'returned' }),
    ];

    const edges = findLevelEdges(touches, 2);
    const overnight = edges.find((e) => e.key === 'session:Overnight');
    const regular = edges.find((e) => e.key === 'session:Regular Session');

    expect(overnight?.stats.holdRate).toBe(100);
    expect(overnight?.stats.enoughData).toBe(true);
    expect(regular?.stats.holdRate).toBeCloseTo(33.3, 1);

    // The stronger condition comes first.
    expect(edges.indexOf(overnight!)).toBeLessThan(edges.indexOf(regular!));
  });

  it('keeps the overall bucket and excludes invalid touches from every rate', () => {
    const touches: LevelTouch[] = [
      touch({ id: 'a', outcome: 'never-returned', session: 'Overnight' }),
      touch({ id: 'b', outcome: 'never-returned', session: 'Overnight' }),
      touch({ id: 'c', outcome: 'invalid', session: 'Overnight' }),
    ];
    const edges = findLevelEdges(touches, 2);
    const all = edges.find((e) => e.key === 'all');
    expect(all?.stats.decided).toBe(2);
    expect(all?.stats.holdRate).toBe(100);
    // The invalid touch is counted as a touch but never as a decided one.
    expect(all?.stats.touches).toBe(2);
  });

  it('reads break direction as its own condition, from what the trader recorded', () => {
    const touches: LevelTouch[] = [
      // A support that broke DOWNWARD and held, five times.
      ...Array.from({ length: 5 }, (_, i) =>
        touch({
          id: `down${i}`,
          kind: 'support',
          session: 'Overnight',
          outcome: 'never-returned',
          breakDirection: 'down',
        })
      ),
      // The same side breaking UPWARD and coming back is a different condition.
      ...Array.from({ length: 5 }, (_, i) =>
        touch({
          id: `up${i}`,
          kind: 'support',
          session: 'Overnight',
          outcome: 'returned',
          breakDirection: 'up',
        })
      ),
    ];

    const edges = findLevelEdges(touches, 5);
    const down = edges.find((e) => e.key === 'direction:down');
    const up = edges.find((e) => e.key === 'direction:up');

    expect(down?.label).toBe('Broke downward');
    expect(down?.stats.holdRate).toBe(100);
    expect(up?.stats.holdRate).toBe(0);
    // Direction is its own axis: the same level kind and session appear on both sides.
    expect(down?.kind).toBeNull();
    expect(edges.find((e) => e.key === 'Overnight:down')?.stats.decided).toBe(5);
    expect(edges.find((e) => e.key === 'Overnight:up')?.stats.decided).toBe(5);
  });

  it('never folds a touch with no recorded direction into a direction bucket', () => {
    const touches: LevelTouch[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        touch({ id: `d${i}`, outcome: 'never-returned', breakDirection: 'down' })
      ),
      touch({ id: 'unstated', outcome: 'never-returned' }),
    ];

    const edges = findLevelEdges(touches, 2);
    const down = edges.find((e) => e.key === 'direction:down');
    expect(down?.stats.decided).toBe(5);
    // No bucket is invented for the break the trader did not describe.
    expect(edges.some((e) => e.key === 'direction:up')).toBe(false);
  });
});
