import { describe, expect, it } from 'vitest';
import {
  MEMORY_RESEMBLANCE_FLOOR,
  canCompareEmbeddings,
  memoryResemblanceBand,
  rankMemoryMatches,
  resemblanceFromCosineDistance,
  type MemoryVectorMatch,
} from '../similarity';

/**
 * Scoring and ranking.
 *
 * Two properties are worth more than the rest and are pinned down here: the score is a
 * resemblance rather than a probability, and the same candidate set always comes back in the
 * same order. A ranking that reshuffles between identical runs cannot be checked against
 * anything, including the trader's own memory of what it showed them yesterday.
 */

function match(overrides: Partial<MemoryVectorMatch> = {}): MemoryVectorMatch {
  return {
    observationId: 'obs-1',
    imageId: 'img-1',
    role: 'before-setup',
    cosineDistance: 0.2,
    observedAt: '2026-03-01T14:00:00.000Z',
    instrument: 'MES',
    ...overrides,
  };
}

describe('resemblanceFromCosineDistance', () => {
  it('maps identical vectors to 100 and unrelated ones to 0', () => {
    expect(resemblanceFromCosineDistance(0)).toBe(100);
    // Cosine distance 1 is orthogonal: nothing in common, and nothing claimed either.
    expect(resemblanceFromCosineDistance(1)).toBe(0);
  });

  it('scales the distance linearly in between', () => {
    expect(resemblanceFromCosineDistance(0.2)).toBe(80);
    expect(resemblanceFromCosineDistance(0.25)).toBe(75);
    expect(resemblanceFromCosineDistance(0.55)).toBe(45);
  });

  it('clamps anything less alike than unrelated to zero rather than showing a negative', () => {
    expect(resemblanceFromCosineDistance(1.5)).toBe(0);
    expect(resemblanceFromCosineDistance(2)).toBe(0);
    expect(resemblanceFromCosineDistance(-0.5)).toBe(100);
  });

  it('degrades a malformed distance to "not alike" instead of throwing mid-search', () => {
    expect(resemblanceFromCosineDistance(Number.NaN)).toBe(0);
    expect(resemblanceFromCosineDistance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(resemblanceFromCosineDistance(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('never returns a value outside 0-100', () => {
    for (const distance of [-10, -0.001, 0, 0.5, 1, 1.999, 2, 50]) {
      const score = resemblanceFromCosineDistance(distance);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('memoryResemblanceBand', () => {
  it('bands a score against the floor, strongest first', () => {
    expect(memoryResemblanceBand(95)).toBe('strong');
    expect(memoryResemblanceBand(80)).toBe('strong');
    expect(memoryResemblanceBand(79)).toBe('good');
    expect(memoryResemblanceBand(60)).toBe('good');
    expect(memoryResemblanceBand(59)).toBe('modest');
    expect(memoryResemblanceBand(55)).toBe('modest');
    expect(memoryResemblanceBand(54)).toBe('below');
  });

  it('lets a raised floor demote a score that would otherwise be strong', () => {
    // The floor is the trader's line, so it wins over the fixed tiers — otherwise raising it
    // would still leave the list looking strong.
    expect(memoryResemblanceBand(85, 90)).toBe('below');
    expect(MEMORY_RESEMBLANCE_FLOOR).toBe(55);
  });
});

describe('canCompareEmbeddings', () => {
  const base = { model: 'gemini-embedding-2', version: 1, dimension: 768 };

  it('accepts two vectors from the same configuration', () => {
    expect(canCompareEmbeddings(base, { ...base })).toBe(true);
  });

  it('rejects a different model, version or dimension', () => {
    expect(canCompareEmbeddings(base, { ...base, model: 'gemini-embedding-001' })).toBe(false);
    expect(canCompareEmbeddings(base, { ...base, version: 2 })).toBe(false);
    expect(canCompareEmbeddings(base, { ...base, dimension: 1536 })).toBe(false);
  });

  it('rejects an unstamped vector rather than treating it as a wildcard', () => {
    expect(canCompareEmbeddings(base, null)).toBe(false);
    expect(canCompareEmbeddings(null, base)).toBe(false);
    expect(canCompareEmbeddings(base, { ...base, model: '' })).toBe(false);
    expect(canCompareEmbeddings(base, { ...base, dimension: 0 })).toBe(false);
  });
});

describe('rankMemoryMatches', () => {
  it('orders by resemblance, closest first', () => {
    const result = rankMemoryMatches([
      match({ observationId: 'c', cosineDistance: 0.4 }),
      match({ observationId: 'a', cosineDistance: 0.05 }),
      match({ observationId: 'b', cosineDistance: 0.25 }),
    ]);
    expect(result.matches.map((entry) => entry.observationId)).toEqual(['a', 'b', 'c']);
    expect(result.matches.map((entry) => entry.resemblance)).toEqual([95, 75, 60]);
  });

  it('drops anything below the floor and says how many', () => {
    const result = rankMemoryMatches([
      match({ observationId: 'a', cosineDistance: 0.1 }),
      match({ observationId: 'b', cosineDistance: 0.5 }),
      match({ observationId: 'c', cosineDistance: 0.9 }),
    ]);
    expect(result.matches.map((entry) => entry.observationId)).toEqual(['a']);
    expect(result.belowFloor).toBe(2);
  });

  it('honours a floor the trader moved', () => {
    const result = rankMemoryMatches([match({ cosineDistance: 0.2 })], { floor: 90 });
    expect(result.matches).toHaveLength(0);
    expect(result.belowFloor).toBe(1);
  });

  it('returns one best picture per observation, so several shots are one memory', () => {
    const result = rankMemoryMatches([
      match({ observationId: 'obs-1', imageId: 'a', cosineDistance: 0.3 }),
      match({ observationId: 'obs-1', imageId: 'b', cosineDistance: 0.1 }),
      match({ observationId: 'obs-1', imageId: 'c', cosineDistance: 0.35 }),
      match({ observationId: 'obs-2', imageId: 'd', cosineDistance: 0.4 }),
    ]);
    expect(result.matches.map((entry) => entry.imageId)).toEqual(['b', 'd']);
    expect(result.duplicateObservations).toBe(2);
    expect(result.belowFloor).toBe(0);
  });

  it('counts a below-floor picture as unshown rather than as a duplicate', () => {
    // Two separate reasons a candidate can disappear, and they must not be conflated: one means
    // "a closer shot of the same setup won", the other means "this was never close enough".
    const result = rankMemoryMatches([
      match({ observationId: 'obs-1', imageId: 'a', cosineDistance: 0.1 }),
      match({ observationId: 'obs-1', imageId: 'b', cosineDistance: 0.9 }),
    ]);
    expect(result.matches.map((entry) => entry.imageId)).toEqual(['a']);
    expect(result.duplicateObservations).toBe(0);
    expect(result.belowFloor).toBe(1);
  });

  it('can keep several pictures of one observation when asked', () => {
    const result = rankMemoryMatches(
      [
        match({ observationId: 'obs-1', imageId: 'a', cosineDistance: 0.1 }),
        match({ observationId: 'obs-1', imageId: 'b', cosineDistance: 0.2 }),
      ],
      { perObservation: 2 }
    );
    expect(result.matches).toHaveLength(2);
    expect(result.duplicateObservations).toBe(0);
  });

  it('breaks a tie towards the more recent observation', () => {
    const result = rankMemoryMatches([
      match({ observationId: 'old', observedAt: '2026-01-01T14:00:00.000Z' }),
      match({ observationId: 'new', observedAt: '2026-03-01T14:00:00.000Z' }),
    ]);
    expect(result.matches.map((entry) => entry.observationId)).toEqual(['new', 'old']);
  });

  it('is reproducible, including for exact ties', () => {
    const candidates = [
      match({ observationId: 'b', imageId: 'z' }),
      match({ observationId: 'a', imageId: 'y' }),
      match({ observationId: 'b', imageId: 'x' }),
      match({ observationId: 'a', imageId: 'w' }),
    ];
    const first = rankMemoryMatches(candidates, { perObservation: 2 });
    // Shuffled input order must not change the answer.
    const second = rankMemoryMatches([...candidates].reverse(), { perObservation: 2 });
    expect(first.matches).toEqual(second.matches);
    expect(first.matches.map((entry) => `${entry.observationId}:${entry.imageId}`)).toEqual([
      'a:w',
      'a:y',
      'b:x',
      'b:z',
    ]);
  });

  it('carries the band through so a row does not have to recompute it', () => {
    const result = rankMemoryMatches([match({ cosineDistance: 0.1 })]);
    expect(result.matches[0].band).toBe('strong');
  });

  it('respects a result limit without reordering', () => {
    const result = rankMemoryMatches(
      [
        match({ observationId: 'a', cosineDistance: 0.05 }),
        match({ observationId: 'b', cosineDistance: 0.1 }),
        match({ observationId: 'c', cosineDistance: 0.15 }),
      ],
      { limit: 2 }
    );
    expect(result.matches.map((entry) => entry.observationId)).toEqual(['a', 'b']);
  });

  it('treats "show me nothing" as a valid answer rather than an error', () => {
    const result = rankMemoryMatches([match()], { limit: 0 });
    expect(result.matches).toEqual([]);
  });

  it('handles an empty candidate set', () => {
    expect(rankMemoryMatches([])).toEqual({ matches: [], belowFloor: 0, duplicateObservations: 0 });
  });
});
