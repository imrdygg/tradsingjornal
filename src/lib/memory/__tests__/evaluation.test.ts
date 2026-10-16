import { describe, expect, it } from 'vitest';
import {
  MEMORY_EVAL_K_VALUES,
  evaluateRun,
  summarizeEvaluation,
  type MemoryEvalCaseResult,
  type MemoryEvalReference,
} from '../evaluation';

/**
 * The retrieval harness.
 *
 * What is worth pinning down here is not the averages but the decisions behind them: that a miss
 * is null rather than a large number, that precision divides by k rather than by what happened to
 * be returned, that a repeated id counts once, and that a mismatched pair is refused instead of
 * scored. Each of those, got the other way, produces a report that looks fine and means nothing.
 */

function reference(overrides: Partial<MemoryEvalReference> = {}): MemoryEvalReference {
  return {
    id: 'ref-1',
    label: 'overnight reversal into the open',
    relevantObservationIds: ['obs-a', 'obs-b'],
    ...overrides,
  };
}

function run(rankedObservationIds: string[], referenceId = 'ref-1') {
  return { referenceId, rankedObservationIds };
}

describe('MEMORY_EVAL_K_VALUES', () => {
  it('reports precision at the cut-offs a trader actually reads', () => {
    expect(MEMORY_EVAL_K_VALUES).toEqual([1, 3, 5, 10]);
  });
});

describe('evaluateRun', () => {
  it('scores a relevant match at rank 1 as a perfect reciprocal rank', () => {
    const result = evaluateRun(reference(), run(['obs-a', 'x', 'y']));
    expect(result.firstRelevantRank).toBe(1);
    expect(result.reciprocalRank).toBe(1);
    expect(result.hit).toBe(true);
    expect(result.label).toBe('overnight reversal into the open');
  });

  it('scores a relevant match at rank 3 as one third', () => {
    const result = evaluateRun(reference(), run(['x', 'y', 'obs-b']));
    expect(result.firstRelevantRank).toBe(3);
    expect(result.reciprocalRank).toBe(0.3333);
    expect(result.hit).toBe(true);
  });

  it('reports a total miss as null and zero rather than an enormous rank', () => {
    const result = evaluateRun(reference(), run(['x', 'y', 'z']));
    expect(result.firstRelevantRank).toBeNull();
    expect(result.reciprocalRank).toBe(0);
    expect(result.hit).toBe(false);
  });

  it('handles an empty ranking as a miss', () => {
    const result = evaluateRun(reference(), run([]));
    expect(result.firstRelevantRank).toBeNull();
    expect(result.reciprocalRank).toBe(0);
  });

  it('divides precision by k, not by how many ids were returned', () => {
    // One relevant id and one other, so only two of the ten asked for came back.
    const result = evaluateRun(reference(), run(['obs-a', 'x']));
    const at = (k: number) => result.precisionAtK.find((point) => point.k === k)?.precision;
    expect(at(1)).toBe(1);
    // 1 relevant in the top 3, over a denominator of 3: the unfilled slot is a failure of the
    // list, not an absence of one.
    expect(at(3)).toBe(0.3333);
    expect(at(5)).toBe(0.2);
    expect(at(10)).toBe(0.1);
  });

  it('never divides by a k of zero or a negative k', () => {
    const result = evaluateRun(reference(), run(['obs-a']), [0, -2]);
    for (const point of result.precisionAtK) {
      expect(point.precision).toBe(0);
      expect(Number.isNaN(point.precision)).toBe(false);
    }
  });

  it('counts a repeated id once, because a repeat is one retrieval', () => {
    const result = evaluateRun(reference(), run(['x', 'x', 'obs-a']));
    // The duplicate does not buy the second slot back: the relevant match is still at rank 2.
    expect(result.firstRelevantRank).toBe(2);
    expect(result.reciprocalRank).toBe(0.5);
    const at = (k: number) => result.precisionAtK.find((point) => point.k === k)?.precision;
    expect(at(1)).toBe(0);
    expect(at(3)).toBe(0.3333);
  });

  it('refuses a run that belongs to another reference', () => {
    expect(() => evaluateRun(reference(), run(['obs-a'], 'ref-2'))).toThrow(/ref-2/);
    expect(() => evaluateRun(reference(), run(['obs-a'], 'ref-2'))).toThrow(
      /cannot be scored against reference "ref-1"/
    );
  });

  it('reports lookalikes separately from hits', () => {
    const labelled = reference({ lookalikeObservationIds: ['look-1'] });
    const result = evaluateRun(labelled, run(['look-1', 'x']));
    // Returning the same-looking chart of a different setup is the failure, not a partial hit.
    expect(result.lookalikesReturned).toEqual(['look-1']);
    expect(result.hit).toBe(false);
    expect(result.firstRelevantRank).toBeNull();
    expect(result.reciprocalRank).toBe(0);
  });

  it('does not count an unlabelled id as a hit or as an intrusion', () => {
    const labelled = reference({ lookalikeObservationIds: ['look-1'] });
    const result = evaluateRun(labelled, run(['unknown-1', 'unknown-2']));
    expect(result.lookalikesReturned).toEqual([]);
    expect(result.hit).toBe(false);
  });

  it('finds a lookalike even when a real match is also present', () => {
    const labelled = reference({ lookalikeObservationIds: ['look-1'] });
    const result = evaluateRun(labelled, run(['obs-a', 'look-1']));
    expect(result.hit).toBe(true);
    expect(result.lookalikesReturned).toEqual(['look-1']);
  });

  it('marks a reference with nothing to find as unscoreable', () => {
    const empty = reference({ relevantObservationIds: [] });
    const result = evaluateRun(empty, run(['x']));
    expect(result.labelledWithNoRelevant).toBe(true);
    expect(result.hit).toBe(false);
  });

  it('is reproducible: the same pair scores the same twice', () => {
    const labelled = reference({ lookalikeObservationIds: ['look-1'] });
    const ranking = run(['x', 'obs-a', 'look-1', 'obs-b']);
    expect(evaluateRun(labelled, ranking)).toEqual(evaluateRun(labelled, ranking));
  });
});

describe('summarizeEvaluation', () => {
  function scored(overrides: Partial<MemoryEvalCaseResult> = {}): MemoryEvalCaseResult {
    return {
      referenceId: 'ref-1',
      label: 'case',
      firstRelevantRank: 1,
      reciprocalRank: 1,
      precisionAtK: MEMORY_EVAL_K_VALUES.map((k) => ({ k, precision: 1 })),
      lookalikesReturned: [],
      hit: true,
      ...overrides,
    };
  }

  it('averages reciprocal rank and precision over the cases', () => {
    const results = [
      evaluateRun(reference({ id: 'a', relevantObservationIds: ['x'] }), {
        referenceId: 'a',
        rankedObservationIds: ['x'],
      }),
      evaluateRun(reference({ id: 'b', relevantObservationIds: ['y'] }), {
        referenceId: 'b',
        rankedObservationIds: ['p', 'y'],
      }),
    ];

    const report = summarizeEvaluation(results);
    expect(report.hits).toBe(2);
    expect(report.misses).toBe(0);
    // (1 + 0.5) / 2
    expect(report.meanReciprocalRank).toBe(0.75);
    const at1 = report.meanPrecisionAtK.find((point) => point.k === 1)?.precision;
    // (1 + 0) / 2
    expect(at1).toBe(0.5);
  });

  it('returns zero rather than NaN for an empty set of results', () => {
    const report = summarizeEvaluation([]);
    expect(report.meanReciprocalRank).toBe(0);
    expect(Number.isNaN(report.meanReciprocalRank)).toBe(false);
    for (const point of report.meanPrecisionAtK) {
      expect(point.precision).toBe(0);
      expect(Number.isNaN(point.precision)).toBe(false);
    }
    expect(report.hits).toBe(0);
    expect(report.misses).toBe(0);
  });

  it('counts hits and misses', () => {
    const report = summarizeEvaluation([
      scored(),
      scored({ referenceId: 'b', hit: false, firstRelevantRank: null, reciprocalRank: 0 }),
    ]);
    expect(report.hits).toBe(1);
    expect(report.misses).toBe(1);
    expect(report.cases).toHaveLength(2);
  });

  it('rounds the averages to four decimal places', () => {
    // Three cases scoring 1, 0.3333 and 0.5 average to 0.6111.
    const report = summarizeEvaluation([
      scored({ reciprocalRank: 1 }),
      scored({ referenceId: 'b', reciprocalRank: 0.3333 }),
      scored({ referenceId: 'c', reciprocalRank: 0.5 }),
    ]);
    expect(report.meanReciprocalRank).toBe(0.6111);
  });

  it('reports lookalike intrusions as their own count', () => {
    const report = summarizeEvaluation([
      scored({ lookalikesReturned: ['look-1'] }),
      scored({ referenceId: 'b' }),
    ]);
    expect(report.lookalikeIntrusions).toBe(1);
    expect(report.warnings.join(' ')).toContain('lookalike');
  });

  it('warns that a small labelled set cannot support a claim', () => {
    const report = summarizeEvaluation([scored(), scored({ referenceId: 'b' })]);
    expect(report.warnings.join(' ')).toContain('Only 2 labelled examples');
    expect(report.warnings.join(' ')).toContain('cannot support any claim');
  });

  it('stops warning about the sample once there are enough cases', () => {
    const enough = Array.from({ length: 5 }, (_, i) => scored({ referenceId: `ref-${i}` }));
    expect(summarizeEvaluation(enough).warnings.join(' ')).not.toContain('cannot support any claim');
  });

  it('names the references that had nothing to find and keeps them out of the averages', () => {
    const scoreable = Array.from({ length: 4 }, (_, i) => scored({ referenceId: `ref-${i}` }));
    const unlabelled = scored({
      referenceId: 'ref-empty',
      labelledWithNoRelevant: true,
      hit: false,
      firstRelevantRank: null,
      reciprocalRank: 0,
    });

    const report = summarizeEvaluation([...scoreable, unlabelled]);
    expect(report.warnings.join(' ')).toContain('no relevant observations');
    // Counted as a miss, but its inevitable zero does not drag the average down.
    expect(report.misses).toBe(1);
    expect(report.meanReciprocalRank).toBe(1);
  });

  it('never phrases a warning as a trading recommendation', () => {
    const report = summarizeEvaluation([scored(), scored({ referenceId: 'b' })]);
    const text = report.warnings.join(' ').toLowerCase();
    expect(text).toContain('not a measured edge');
    for (const forbidden of ['buy', 'sell', 'should take', 'profitable', 'expect']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('says plainly that nothing has been measured when there is nothing to measure', () => {
    expect(summarizeEvaluation([]).warnings).toEqual([
      'There are no labelled examples, so nothing has been measured at all.',
    ]);
  });
});
