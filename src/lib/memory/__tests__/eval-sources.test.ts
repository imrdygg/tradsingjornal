import { describe, expect, it } from 'vitest';

import type { MemoryMatchFeedback, MemorySearch, MemorySearchMatch } from '../../../types';
import { evaluateRun, summarizeEvaluation } from '../evaluation';
import {
  MEMORY_EVAL_LOOKALIKE_VERDICT,
  MEMORY_EVAL_RELEVANT_VERDICTS,
  evaluationSourcesFromSavedSearches,
  referencesFromSavedSearches,
  runsFromSavedSearches,
  savedSearchLabel,
} from '../eval-sources';

function match(observationId: string, feedback?: MemoryMatchFeedback): MemorySearchMatch {
  return {
    observationId,
    imageId: `img-${observationId}`,
    role: 'before-setup',
    resemblance: 80,
    cosineDistance: 0.2,
    observedAt: '2026-09-01T14:00:00.000Z',
    instrument: 'MES',
    feedback,
  };
}

function search(overrides: Partial<MemorySearch> = {}): MemorySearch {
  return {
    id: 'search-1',
    userId: 'user-1',
    searchedAt: '2026-09-10T14:00:00.000Z',
    filters: { instrument: 'MES', timeframe: '5m' },
    matches: [],
    ...overrides,
  };
}

describe('which searches become labelled examples', () => {
  it('turns a judged search into a reference and a run, paired by id', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ matches: [match('obs-a', 'strong'), match('obs-b', 'partial')] }),
    ]);

    expect(sources.references).toHaveLength(1);
    expect(sources.runs).toHaveLength(1);
    expect(sources.runs[0].referenceId).toBe(sources.references[0].id);
    expect(sources.counts).toMatchObject({ searches: 1, judged: 1, unjudged: 0 });
  });

  it('treats both strong and partial as relevant', () => {
    expect(MEMORY_EVAL_RELEVANT_VERDICTS).toEqual(['strong', 'partial']);

    const sources = evaluationSourcesFromSavedSearches([
      search({ matches: [match('obs-a', 'strong'), match('obs-b', 'partial')] }),
    ]);

    expect(sources.references[0].relevantObservationIds).toEqual(['obs-a', 'obs-b']);
    expect(sources.references[0].lookalikeObservationIds).toEqual([]);
  });

  it('labels a wrong verdict as a lookalike and never as relevant', () => {
    expect(MEMORY_EVAL_LOOKALIKE_VERDICT).toBe('wrong');

    const sources = evaluationSourcesFromSavedSearches([
      search({ matches: [match('obs-a', 'strong'), match('obs-b', 'wrong')] }),
    ]);

    const reference = sources.references[0];
    expect(reference.relevantObservationIds).toEqual(['obs-a']);
    expect(reference.lookalikeObservationIds).toEqual(['obs-b']);
  });

  it('does not turn a search nobody judged into an example', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ id: 's1', matches: [match('obs-a'), match('obs-b')] }),
    ]);

    // Not a reference with no relevant ids: that would report a miss the system never made.
    expect(sources.references).toEqual([]);
    expect(sources.counts.unjudged).toBe(1);
    expect(sources.counts.unjudgedMatches).toBe(2);
    expect(sources.warnings.join(' ')).toContain('nothing to measure yet');
  });

  it('counts every verdict over the searches it read', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ id: 's1', matches: [match('a', 'strong')] }),
      search({ id: 's2', matches: [match('b', 'partial'), match('c', 'wrong'), match('d')] }),
      search({ id: 's3', matches: [match('e')] }),
    ]);

    expect(sources.counts).toMatchObject({
      searches: 3,
      judged: 2,
      unjudged: 1,
      strong: 1,
      partial: 1,
      wrong: 1,
      unjudgedMatches: 2,
    });
  });

  it('says nothing was measured when there are no searches at all', () => {
    const sources = evaluationSourcesFromSavedSearches([]);
    expect(sources.references).toEqual([]);
    expect(sources.counts.searches).toBe(0);
    expect(sources.warnings.join(' ')).toContain('no saved searches');
  });

  it('reports a missing input as a missing input, not as a result', () => {
    for (const input of [null, undefined, 'not an array' as unknown as MemorySearch[]]) {
      const sources = evaluationSourcesFromSavedSearches(input);
      expect(sources.references).toEqual([]);
      expect(sources.warnings.join(' ')).toContain('missing input');
    }
  });
});

describe('the ranking is exactly what was returned', () => {
  it('keeps every returned row, in stored order, verdicts or not', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({
        matches: [match('lookalike', 'wrong'), match('never-judged'), match('real', 'strong')],
      }),
    ]);

    expect(sources.runs[0].rankedObservationIds).toEqual([
      'lookalike',
      'never-judged',
      'real',
    ]);
  });

  it('does not lift a real match by dropping the lookalikes above it', () => {
    // The assertion this file exists for. Two lookalikes rank ahead of the only real match, so the
    // correct reciprocal rank is a third. Removing the rows the trader marked 'wrong' instead would
    // report 1.0 for a search that failed to put anything relevant on top, and `lookalikeIntrusions`
    // below would be structurally zero — a warning that could never fire.
    const sources = evaluationSourcesFromSavedSearches([
      search({
        matches: [match('wrong-1', 'wrong'), match('wrong-2', 'wrong'), match('real', 'strong')],
      }),
    ]);

    const scored = evaluateRun(sources.references[0], sources.runs[0]);

    expect(scored.firstRelevantRank).toBe(3);
    expect(scored.reciprocalRank).toBeCloseTo(1 / 3);
  });

  it('still counts the lookalikes as intrusions', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ matches: [match('wrong-1', 'wrong'), match('real', 'strong')] }),
    ]);

    const report = summarizeEvaluation(
      sources.references.map((reference, index) => evaluateRun(reference, sources.runs[index]))
    );

    expect(report.lookalikeIntrusions).toBe(1);
    expect(report.warnings.join(' ')).toContain('lookalike');
  });

  it('leaves an unjudged row in the ranking while scoring it as neither', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ matches: [match('unjudged'), match('real', 'partial')] }),
    ]);

    const scored = evaluateRun(sources.references[0], sources.runs[0]);

    expect(sources.runs[0].rankedObservationIds).toContain('unjudged');
    expect(scored.firstRelevantRank).toBe(2);
    expect(scored.lookalikesReturned).toEqual([]);
  });
});

describe('the example whose every verdict was wrong', () => {
  it('becomes a reference with no relevant ids, which the harness marks as unscoreable', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ matches: [match('a', 'wrong'), match('b', 'wrong')] }),
    ]);

    expect(sources.references).toHaveLength(1);
    expect(sources.references[0].relevantObservationIds).toEqual([]);

    const scored = evaluateRun(sources.references[0], sources.runs[0]);
    // The harness's own flag, not a field this module writes: producing the empty relevant list is
    // what makes it fire, so this assertion is really about that list being empty on purpose.
    expect(scored.labelledWithNoRelevant).toBe(true);
  });

  it('is kept out of the averages and named in the warnings, not read as a retrieval failure', () => {
    const onlyWrong = evaluationSourcesFromSavedSearches([
      search({ id: 'all-wrong', matches: [match('a', 'wrong')] }),
    ]);
    const scored = evaluateRun(onlyWrong.references[0], onlyWrong.runs[0]);
    const report = summarizeEvaluation([scored]);

    expect(report.misses).toBe(1);
    expect(report.meanReciprocalRank).toBe(0);
    expect(report.warnings.join(' ')).toContain('no relevant observations');
  });
});

describe('determinism and tolerant input', () => {
  const judged = [
    search({ id: 'later', searchedAt: '2026-09-20T14:00:00.000Z', matches: [match('b', 'strong')] }),
    search({ id: 'earlier', searchedAt: '2026-09-01T14:00:00.000Z', matches: [match('a', 'strong')] }),
    search({ id: 'middle', searchedAt: '2026-09-10T14:00:00.000Z', matches: [match('c', 'strong')] }),
  ];

  it('produces the same report twice, and independently of the order given', () => {
    const once = evaluationSourcesFromSavedSearches(judged);
    const twice = evaluationSourcesFromSavedSearches(judged);
    const reversed = evaluationSourcesFromSavedSearches([...judged].reverse());

    expect(once.references).toEqual(twice.references);
    expect(once.references.map((r) => r.id)).toEqual(reversed.references.map((r) => r.id));
    expect(once.references.map((r) => r.id)).toEqual(['earlier', 'middle', 'later']);
  });

  it('sorts an unreadable timestamp last rather than throwing the example away', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ id: 'broken-date', searchedAt: 'not a date', matches: [match('x', 'strong')] }),
      search({ id: 'fine', searchedAt: '2026-09-01T14:00:00.000Z', matches: [match('y', 'strong')] }),
    ]);

    expect(sources.references.map((r) => r.id)).toEqual(['fine', 'broken-date']);
  });

  it('counts a repeated search id once', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ id: 'dup', matches: [match('a', 'strong')] }),
      search({ id: 'dup', matches: [match('a', 'strong')] }),
    ]);

    expect(sources.references).toHaveLength(1);
    expect(sources.counts.searches).toBe(1);
  });

  it('leaves out an entry that is not readable as a search, and says so', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({ id: 'ok', matches: [match('a', 'strong')] }),
      { id: '', matches: [] } as unknown as MemorySearch,
      { matches: [] } as unknown as MemorySearch,
      { id: 'no-matches', matches: undefined } as unknown as MemorySearch,
      null as unknown as MemorySearch,
    ]);

    expect(sources.counts.skipped).toBe(4);
    expect(sources.references.map((r) => r.id)).toEqual(['ok']);
    expect(sources.warnings.join(' ')).toContain('could not be read as a search');
  });

  it('ignores malformed match rows without dropping the search', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({
        matches: [
          null as unknown as MemorySearchMatch,
          { observationId: '' } as MemorySearchMatch,
          match('real', 'strong'),
        ],
      }),
    ]);

    expect(sources.runs[0].rankedObservationIds).toEqual(['real']);
    expect(sources.references[0].relevantObservationIds).toEqual(['real']);
  });

  it('treats a verdict this build does not recognise as no verdict at all', () => {
    const sources = evaluationSourcesFromSavedSearches([
      search({
        matches: [
          match('a', 'maybe' as MemoryMatchFeedback),
          match('b', 'strong'),
        ],
      }),
    ]);

    expect(sources.references[0].relevantObservationIds).toEqual(['b']);
    expect(sources.references[0].lookalikeObservationIds).toEqual([]);
    expect(sources.counts.unjudgedMatches).toBe(1);
  });
});

describe('the helpers agree with the one function that decides', () => {
  it('returns the same references and runs', () => {
    const searches = [
      search({ id: 's1', matches: [match('a', 'strong')] }),
      search({ id: 's2', matches: [match('b')] }),
    ];

    const full = evaluationSourcesFromSavedSearches(searches);
    expect(referencesFromSavedSearches(searches)).toEqual(full.references);
    expect(runsFromSavedSearches(searches)).toEqual(full.runs);
  });

  it('caps the list to the most recent judged searches, and says it did', () => {
    const searches = [1, 2, 3, 4].map((n) =>
      search({
        id: `s${n}`,
        searchedAt: `2026-09-0${n}T14:00:00.000Z`,
        matches: [match(`obs-${n}`, 'strong')],
      })
    );

    const sources = evaluationSourcesFromSavedSearches(searches, { limit: 2 });

    expect(sources.references.map((r) => r.id)).toEqual(['s3', 's4']);
    expect(sources.runs.map((run) => run.referenceId)).toEqual(['s3', 's4']);
    // The counts still describe everything that was read, so the report cannot claim a total it
    // never looked at.
    expect(sources.counts.judged).toBe(4);
    expect(sources.warnings.join(' ')).toContain('most recent of 4');
  });

  it('ignores an unusable limit instead of emptying the report', () => {
    const searches = [1, 2, 3].map((n) =>
      search({ id: `s${n}`, searchedAt: `2026-09-0${n}T14:00:00.000Z`, matches: [match(`o${n}`, 'strong')] })
    );

    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, -1, undefined]) {
      const sources = evaluationSourcesFromSavedSearches(searches, { limit });
      expect(sources.references).toHaveLength(3);
    }
  });

  it('labels an example with its own date and filters', () => {
    expect(savedSearchLabel(search())).toBe('2026-09-10 — MES · 5m');
    expect(savedSearchLabel(search({ filters: {}, searchedAt: 'nonsense' }))).toBe(
      'date not recorded'
    );
    expect(savedSearchLabel(search({ filters: { setupName: 'Opening drive' } }))).toBe(
      '2026-09-10 — Opening drive'
    );
  });
});
