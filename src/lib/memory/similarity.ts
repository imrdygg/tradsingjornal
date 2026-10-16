/**
 * Turning a vector distance into something the trader can read, and ranking the result.
 *
 * The database hands back a cosine *distance* because that is what an approximate nearest
 * neighbour index over an embedding essentially is: a number that says how far apart two
 * pictures sit, with no meaning outside the model that produced it. Everything here is the
 * translation layer, and the translation is deliberately arithmetical and boring.
 *
 * Three rules this module exists to hold:
 *
 *   1. **The number is a resemblance, never a probability.** It says two charts look alike to
 *      an image model. It says nothing about what either one did. Calling it "93% likely to
 *      work" would be inventing a statistic from a similarity score, which is exactly the
 *      failure the whole feature is built to avoid.
 *   2. **The same input produces the same ranking.** Ordering is total — resemblance, then
 *      recency, then id — so ties never fall back to whatever order the database happened to
 *      return. A retrieval whose results shuffle between two identical runs cannot be checked
 *      against anything.
 *   3. **One observation contributes one best picture.** Five screenshots of the same setup
 *      are one memory, not five. Without this the ranking is dominated by whichever observation
 *      happens to have the most pictures attached rather than by which one is closest.
 */

import type { MemoryImageRole } from '../../types';

/**
 * The resemblance a match must reach to be shown as one.
 *
 * Fifty-five mirrors the picture search's own floor so the two features agree on what "close
 * enough to show" means, and it is a starting point rather than a fact about the trader's
 * setups — the settings screen lets them move it, and moving it only ever changes what is
 * displayed.
 */
export const MEMORY_RESEMBLANCE_FLOOR = 55;

/** The bands a resemblance is sorted into, strongest first. Mirrors the picture search's. */
export const MEMORY_RESEMBLANCE_STRONG = 80;
export const MEMORY_RESEMBLANCE_GOOD = 60;

/** Which band a resemblance falls in, given the floor that decides what is shown. */
export type MemoryResemblanceBand = 'strong' | 'good' | 'modest' | 'below';

/**
 * A cosine distance turned into a rounded 0-100 resemblance.
 *
 * Cosine distance runs 0 (identical) to 2 (opposite), so `1 - distance` is the cosine
 * similarity in the range -1..1 and scales to -100..100. The negative half is clamped to zero
 * because "less alike than unrelated" is not a distinction worth drawing in a list of things
 * that look like the trader's chart; it would only ever add noise below the floor.
 *
 * A non-finite distance becomes 0 rather than throwing. The value arrives from the database, and
 * a malformed one must degrade to "not alike" instead of breaking a search the trader is
 * watching.
 */
export function resemblanceFromCosineDistance(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const scaled = (1 - distance) * 100;
  const clamped = Math.max(0, Math.min(100, scaled));
  return Math.round(clamped);
}

/** Which band a resemblance falls in. Below the floor wins over the absolute tiers. */
export function memoryResemblanceBand(
  resemblance: number,
  floor: number = MEMORY_RESEMBLANCE_FLOOR
): MemoryResemblanceBand {
  if (resemblance < floor) return 'below';
  if (resemblance >= MEMORY_RESEMBLANCE_STRONG) return 'strong';
  if (resemblance >= MEMORY_RESEMBLANCE_GOOD) return 'good';
  return 'modest';
}

/** The embedding configuration two vectors must share before their distance means anything. */
export interface MemoryEmbeddingStamp {
  model: string;
  version: number;
  dimension: number;
}

/**
 * Whether two embeddings may be compared at all.
 *
 * Every part has to match and none of it may be missing. A vector embedded by a different model
 * — or the same model at a different output size — lives in a different space, and the distance
 * between one of those and the query is a well-formed number with no meaning. Rejecting an
 * incomplete stamp is the same judgement: a vector that cannot say what produced it cannot be
 * trusted to sit on the same scale as the query.
 */
export function canCompareEmbeddings(
  a: MemoryEmbeddingStamp | null | undefined,
  b: MemoryEmbeddingStamp | null | undefined
): boolean {
  if (!a || !b) return false;
  if (!a.model || !b.model) return false;
  if (a.model !== b.model) return false;
  if (a.version !== b.version) return false;
  if (!a.dimension || a.dimension !== b.dimension) return false;
  return true;
}

/** One candidate as the search returns it, before scoring. */
export interface MemoryVectorMatch {
  observationId: string;
  imageId: string;
  role: MemoryImageRole;
  cosineDistance: number;
  observedAt: string;
  instrument: string;
  timeframe?: string;
  session?: string;
  setupName?: string;
  linkedTradeId?: string;
}

/** A candidate with its resemblance computed and its place in the order settled. */
export interface RankedMemoryMatch extends MemoryVectorMatch {
  resemblance: number;
  band: MemoryResemblanceBand;
}

export interface MemoryRanking {
  matches: RankedMemoryMatch[];
  /** How many candidates scored below the floor and were therefore left out. */
  belowFloor: number;
  /** How many candidates were dropped because a closer picture of the same observation won. */
  duplicateObservations: number;
}

export interface MemoryRankingOptions {
  floor?: number;
  /** The most matches to return. Zero or negative returns none, which is a valid answer. */
  limit?: number;
  /** How many pictures of one observation may appear. Defaults to one. */
  perObservation?: number;
}

/**
 * Scores, dedupes and orders a candidate set.
 *
 * The order is total on purpose — resemblance, then the more recent observation, then the
 * observation id, then the image id — so the same candidates always produce the same list. The
 * last two keys only ever decide genuine ties, and they exist so that "the same" is a fact
 * rather than a hope about how the database paginated.
 *
 * `duplicateObservations` counts what the dedupe removed rather than hiding it, because a
 * search that returns six matches drawn from two observations is a very different piece of
 * evidence from one that returns six drawn from six.
 */
export function rankMemoryMatches(
  matches: readonly MemoryVectorMatch[],
  options: MemoryRankingOptions = {}
): MemoryRanking {
  const {
    floor = MEMORY_RESEMBLANCE_FLOOR,
    limit = Number.MAX_SAFE_INTEGER,
    perObservation = 1,
  } = options;

  const scored: RankedMemoryMatch[] = matches
    .map((match) => {
      const resemblance = resemblanceFromCosineDistance(match.cosineDistance);
      return { ...match, resemblance, band: memoryResemblanceBand(resemblance, floor) };
    })
    .filter((match) => match.resemblance >= floor);

  const belowFloor = matches.length - scored.length;

  scored.sort(
    (a, b) =>
      b.resemblance - a.resemblance ||
      // A later observation is the more useful precedent when two are equally close.
      (b.observedAt ?? '').localeCompare(a.observedAt ?? '') ||
      a.observationId.localeCompare(b.observationId) ||
      a.imageId.localeCompare(b.imageId)
  );

  const kept: RankedMemoryMatch[] = [];
  const perObservationCount = new Map<string, number>();
  let duplicateObservations = 0;

  for (const match of scored) {
    const already = perObservationCount.get(match.observationId) ?? 0;
    if (already >= perObservation) {
      duplicateObservations += 1;
      continue;
    }
    perObservationCount.set(match.observationId, already + 1);
    kept.push(match);
  }

  return {
    matches: kept.slice(0, Math.max(0, limit)),
    belowFloor,
    duplicateObservations,
  };
}
