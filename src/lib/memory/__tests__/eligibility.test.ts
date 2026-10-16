import { describe, expect, it } from 'vitest';
import {
  POST_DECISION_ROLES,
  PRE_DECISION_ROLES,
  isPreDecisionRole,
  isPostDecisionRole,
  isSearchableObservation,
  selectMatchCandidates,
  selectOutcomeImages,
} from '../eligibility';
import type { MemoryImage, MemoryImageRole, TradingObservation } from '../../../types';

/**
 * The rules that keep hindsight out of a similarity search.
 *
 * These are the tests that matter most in the whole subsystem. Every other property of the
 * memory engine degrades into "a weaker search"; this one degrades into a search that finds
 * matches by knowing the future, which is worse than no search at all because it looks like it
 * works.
 */

const MODEL = 'gemini-embedding-2';
const VERSION = 1;

function makeImage(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    indexStatus: 'completed',
    embeddingModel: MODEL,
    embeddingVersion: VERSION,
    createdAt: '2026-03-01T13:00:00.000Z',
    updatedAt: '2026-03-01T13:00:00.000Z',
    ...overrides,
  };
}

function makeObservation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'user-1',
    observedAt: '2026-03-01T14:00:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    images: [makeImage()],
    createdAt: '2026-03-01T13:00:00.000Z',
    updatedAt: '2026-03-01T13:00:00.000Z',
    ...overrides,
  };
}

describe('image roles', () => {
  it('treats only a pre-decision picture as knowable at the decision', () => {
    expect(PRE_DECISION_ROLES).toEqual(['before-setup', 'entry']);
    for (const role of PRE_DECISION_ROLES) expect(isPreDecisionRole(role)).toBe(true);
  });

  it('excludes everything that could show what happened afterwards', () => {
    expect(POST_DECISION_ROLES).toEqual(['exit', 'after-setup', 'context', 'other']);
    for (const role of POST_DECISION_ROLES) {
      expect(isPreDecisionRole(role)).toBe(false);
      expect(isPostDecisionRole(role)).toBe(true);
    }
  });

  it('is total over the role union, so no role is silently unclassified', () => {
    const all: MemoryImageRole[] = [
      'before-setup',
      'entry',
      'exit',
      'after-setup',
      'context',
      'other',
    ];
    for (const role of all) {
      expect(isPreDecisionRole(role)).toBe(!isPostDecisionRole(role));
    }
  });
});

describe('selectMatchCandidates', () => {
  it('keeps a pre-decision picture of an indexed observation', () => {
    const { eligible, excluded } = selectMatchCandidates([makeObservation()], { embedding: { model: MODEL, version: VERSION } });
    expect(eligible).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it('excludes AFTER screenshots from pre-decision matching', () => {
    const observation = makeObservation({
      images: [
        makeImage({ id: 'before', role: 'before-setup' }),
        makeImage({ id: 'after', role: 'after-setup' }),
        makeImage({ id: 'exit', role: 'exit' }),
      ],
    });

    const { eligible, excludedByReason } = selectMatchCandidates([observation]);
    expect(eligible.map((entry) => entry.image.id)).toEqual(['before']);
    expect(excludedByReason['not-pre-decision']).toBe(2);
  });

  it('treats an unlabelled picture as not provably pre-decision', () => {
    const observation = makeObservation({
      images: [makeImage({ id: 'ctx', role: 'context' }), makeImage({ id: 'oth', role: 'other' })],
    });
    const { eligible, excludedByReason } = selectMatchCandidates([observation]);
    expect(eligible).toHaveLength(0);
    expect(excludedByReason['not-pre-decision']).toBe(2);
  });

  it('cannot reach a future observation during a historical replay', () => {
    const past = makeObservation({ id: 'past', observedAt: '2026-02-01T14:00:00.000Z' });
    const future = makeObservation({ id: 'future', observedAt: '2026-04-01T14:00:00.000Z' });

    const { eligible, excludedByReason } = selectMatchCandidates([past, future], {
      cutoff: '2026-03-01T00:00:00.000Z',
    });

    expect(eligible.map((entry) => entry.observation.id)).toEqual(['past']);
    expect(excludedByReason['after-cutoff']).toBe(1);
  });

  it('excludes an observation that happened exactly at the cutoff', () => {
    // Strictly before: a record printed at the cutoff instant is the first thing the replay is
    // trying to find out, not something already known when it started.
    const observation = makeObservation({ observedAt: '2026-03-01T00:00:00.000Z' });
    const { eligible, excludedByReason } = selectMatchCandidates([observation], {
      cutoff: '2026-03-01T00:00:00.000Z',
    });
    expect(eligible).toHaveLength(0);
    expect(excludedByReason['after-cutoff']).toBe(1);
  });

  it('refuses to place an observation whose time it cannot trust', () => {
    const uploaded = makeObservation({ observedAtSource: 'upload-time' });
    const unknown = makeObservation({ id: 'obs-2', observedAtSource: 'unknown' });

    const { eligible, excludedByReason } = selectMatchCandidates([uploaded, unknown]);
    expect(eligible).toHaveLength(0);
    expect(excludedByReason['untrusted-observation-time']).toBe(2);
  });

  it('reports a missing timestamp as missing rather than as an untrusted one', () => {
    const observation = makeObservation({ observedAt: 'not a date' });
    const { excludedByReason } = selectMatchCandidates([observation]);
    expect(excludedByReason['missing-observation-time']).toBe(1);
    expect(excludedByReason['untrusted-observation-time']).toBe(0);
  });

  it('excludes a picture that has not been indexed', () => {
    const observation = makeObservation({
      images: [makeImage({ indexStatus: 'pending' }), makeImage({ id: 'failed', indexStatus: 'failed' })],
    });
    const { eligible, excludedByReason } = selectMatchCandidates([observation]);
    expect(eligible).toHaveLength(0);
    expect(excludedByReason['not-indexed']).toBe(2);
  });

  it('can preview what will be searchable once indexing catches up', () => {
    const observation = makeObservation({ images: [makeImage({ indexStatus: 'pending' })] });
    const { eligible } = selectMatchCandidates([observation], { requireIndexed: false });
    expect(eligible).toHaveLength(1);
  });

  it('never ranks vectors from a different embedding configuration together', () => {
    const otherModel = makeObservation({
      id: 'obs-other-model',
      images: [makeImage({ id: 'a', embeddingModel: 'gemini-embedding-001' })],
    });
    const otherVersion = makeObservation({
      id: 'obs-other-version',
      images: [makeImage({ id: 'b', embeddingVersion: 2 })],
    });
    const unstamped = makeObservation({
      id: 'obs-unstamped',
      images: [makeImage({ id: 'c', embeddingModel: undefined, embeddingVersion: undefined })],
    });

    const { eligible, excludedByReason } = selectMatchCandidates(
      [otherModel, otherVersion, unstamped],
      { embedding: { model: MODEL, version: VERSION } }
    );

    expect(eligible).toHaveLength(0);
    expect(excludedByReason['different-embedding']).toBe(2);
    expect(excludedByReason['missing-embedding-config']).toBe(1);
  });

  it('leaves the library untouched when no embedding configuration is asked for', () => {
    const observation = makeObservation({
      images: [makeImage({ embeddingModel: undefined, embeddingVersion: undefined })],
    });
    const { eligible } = selectMatchCandidates([observation]);
    expect(eligible).toHaveLength(1);
  });

  it('counts every exclusion, so a short list can be explained', () => {
    const observation = makeObservation({
      images: [
        makeImage({ id: 'a', role: 'after-setup' }),
        makeImage({ id: 'b', indexStatus: 'pending' }),
        makeImage({ id: 'c', role: 'entry' }),
      ],
    });

    const selection = selectMatchCandidates([observation]);
    expect(selection.eligible).toHaveLength(1);
    expect(selection.excluded).toHaveLength(2);
    const total = Object.values(selection.excludedByReason).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(selection.excluded.length);
  });

  it('reports the first failing rule, so a library always produces the same report', () => {
    // After the cutoff AND not pre-decision: chronology is the reason, because a record nobody
    // can place in time cannot be judged on its role.
    const observation = makeObservation({
      observedAt: '2026-04-01T14:00:00.000Z',
      images: [makeImage({ role: 'after-setup' })],
    });
    const first = selectMatchCandidates([observation], { cutoff: '2026-03-01T00:00:00.000Z' });
    const second = selectMatchCandidates([observation], { cutoff: '2026-03-01T00:00:00.000Z' });
    expect(first.excluded[0].reason).toBe('after-cutoff');
    expect(first.excluded).toEqual(second.excluded);
  });

  it('returns an empty selection for an observation with no pictures', () => {
    const { eligible, excluded } = selectMatchCandidates([makeObservation({ images: [] })]);
    expect(eligible).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });
});

describe('selectOutcomeImages', () => {
  it('reads only the pictures from after the decision', () => {
    const observation = makeObservation({
      images: [
        makeImage({ id: 'before', role: 'before-setup' }),
        makeImage({ id: 'after', role: 'after-setup' }),
        makeImage({ id: 'exit', role: 'exit' }),
      ],
    });
    expect(selectOutcomeImages(observation).map((image) => image.id)).toEqual(['after', 'exit']);
  });

  it('finds nothing to read when only the pre-decision picture exists', () => {
    // The honest state for an observation whose outcome nobody has recorded yet: there is no
    // outcome picture, and the pre-decision one must not be pressed into service as one.
    expect(selectOutcomeImages(makeObservation())).toEqual([]);
  });
});

describe('isSearchableObservation', () => {
  it('is true once a pre-decision picture has been indexed', () => {
    expect(isSearchableObservation(makeObservation())).toBe(true);
  });

  it('is false for a library that is only browsable', () => {
    const observation = makeObservation({ images: [makeImage({ indexStatus: 'pending' })] });
    expect(isSearchableObservation(observation)).toBe(false);
  });

  it('is false when the only indexed picture is a post-decision one', () => {
    const observation = makeObservation({
      images: [makeImage({ role: 'after-setup', indexStatus: 'completed' })],
    });
    expect(isSearchableObservation(observation)).toBe(false);
  });
});
