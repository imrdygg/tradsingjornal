/**
 * What may be searched, and what counts as knowable at a point in time.
 *
 * This is the module that stops the memory engine from cheating. Everything else in the
 * subsystem is a retrieval convenience; this file is the correctness boundary, because a
 * similarity search over a personal screenshot library has one failure mode that makes it
 * worse than useless — matching today's chart against a historical picture that only looks
 * like a match because it shows what happened *afterwards*.
 *
 * Two independent rules have to hold, and they are deliberately separate:
 *
 *   1. **Role.** Only a picture from before the decision may be a candidate. A screenshot
 *      labelled `after-setup` or `exit` contains candles that had not printed when the trader
 *      decided, so using it as a "similar past setup" is hindsight wearing the costume of
 *      history. `context` and `other` are excluded too: they are unlabelled, an unlabelled
 *      picture cannot be *shown* to be pre-decision, and a boundary that leans permissive is
 *      not a boundary.
 *
 *   2. **Chronology.** An observation must have *existed* before the moment being replayed.
 *      This is what makes a historical replay a replay: asked "what did I know on the 3rd of
 *      March", the engine must not answer with a record from April that the trader would not
 *      have had. A timestamp that cannot be trusted is therefore treated as unusable rather
 *      than as permissive — `upload-time` is not the decision moment, and a screenshot
 *      uploaded days later would otherwise be silently dropped into a window it never
 *      belonged to.
 *
 * The exclusions are returned rather than swallowed. A count of what was left out, and why,
 * is the difference between a search that honestly found four things and one that quietly
 * threw away forty and reported four.
 */

import type { MemoryImage, MemoryImageRole, TradingObservation } from '../../types';

/**
 * The roles a trader could genuinely have been looking at when they decided.
 *
 * Kept as one list so the browser, the tests and the SQL function's default all describe the
 * same rule; `supabase/schema.sql` passes this array as the default for `p_roles`.
 */
export const PRE_DECISION_ROLES: readonly MemoryImageRole[] = ['before-setup', 'entry'];

/** The roles that show information from after the decision, and may never be matched against. */
export const POST_DECISION_ROLES: readonly MemoryImageRole[] = [
  'exit',
  'after-setup',
  'context',
  'other',
];

/** True when a picture could have been on screen before the trader decided. */
export function isPreDecisionRole(role: MemoryImageRole): boolean {
  return PRE_DECISION_ROLES.includes(role);
}

/** True when a picture shows information from after the decision. */
export function isPostDecisionRole(role: MemoryImageRole): boolean {
  return !isPreDecisionRole(role);
}

/** Why one picture was left out of a candidate set. Each is reported separately. */
export type MemoryExclusionReason =
  /** It shows the time after the decision, so it cannot be evidence about the decision. */
  | 'not-pre-decision'
  /** It has no embedding yet — never sent, or indexing failed. */
  | 'not-indexed'
  /** It was embedded, but by a different model or version than the one searching. */
  | 'different-embedding'
  /** It is not stamped with the embedding configuration at all. */
  | 'missing-embedding-config'
  /** It was observed at or after the moment being replayed. */
  | 'after-cutoff'
  /** Its timestamp could not be trusted, so it cannot be placed in time. */
  | 'untrusted-observation-time'
  /** It has no usable timestamp at all. */
  | 'missing-observation-time';

export interface MemoryExcludedImage {
  observationId: string;
  imageId: string;
  reason: MemoryExclusionReason;
}

/** One observation paired with one of its pictures: the unit a search actually ranks. */
export interface MemoryCandidateImage {
  observation: TradingObservation;
  image: MemoryImage;
}

export interface MemoryCandidateSelection {
  eligible: MemoryCandidateImage[];
  excluded: MemoryExcludedImage[];
  /** The same exclusions counted by reason, for a one-line summary in the UI. */
  excludedByReason: Record<MemoryExclusionReason, number>;
}

/**
 * The embedding identity a picture must share with the query to be comparable.
 *
 * Model and version, which is exactly what `memory_match_images` filters on. The output
 * dimension is deliberately NOT part of it: a dimension is a property of the model and version
 * pair, so a change that altered it is a new version, and accepting it here as well would let a
 * client claim a comparability the database is going to refuse anyway.
 */
export interface MemoryEmbeddingFilter {
  model: string;
  version: number;
}

export interface MemoryCandidateOptions {
  /**
   * The moment being replayed, ISO 8601. Omitted means "now" is not relevant and the caller is
   * asking what is searchable at all rather than what was searchable then.
   */
  cutoff?: string | null;
  /**
   * The embedding configuration the query was made with. When given, pictures stamped with
   * anything else are excluded rather than ranked: two embedding spaces do not share a scale,
   * so a score between them is a number without a meaning.
   */
  embedding?: MemoryEmbeddingFilter | null;
  /** False keeps un-indexed pictures in the running, for a "what will be searchable" preview. */
  requireIndexed?: boolean;
}

/** Milliseconds for a timestamp, or null when it is missing or unparseable. */
function parseInstant(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether an observation's own timestamp can be used to place it in time.
 *
 * `recorded` is the only source that counts. `upload-time` is explicitly rejected here rather
 * than merely down-weighted, because the failure it causes is silent: an observation that ends
 * up on the wrong side of a replay cutoff does not error, it just quietly becomes a match the
 * trader could not have found.
 */
export function hasTrustworthyObservationTime(observation: TradingObservation): boolean {
  if (observation.observedAtSource !== 'recorded') return false;
  return parseInstant(observation.observedAt) !== null;
}

/**
 * Every picture that may be used to find a similar setup.
 *
 * The checks run in a fixed order and the first one that fails is the reason reported, so the
 * same library always produces the same report — a count that reorders itself between runs is
 * not something anyone can act on.
 */
export function selectMatchCandidates(
  observations: readonly TradingObservation[],
  options: MemoryCandidateOptions = {}
): MemoryCandidateSelection {
  const { cutoff = null, embedding = null, requireIndexed = true } = options;
  const cutoffMs = parseInstant(cutoff);

  const eligible: MemoryCandidateImage[] = [];
  const excluded: MemoryExcludedImage[] = [];
  const excludedByReason: Record<MemoryExclusionReason, number> = {
    'not-pre-decision': 0,
    'not-indexed': 0,
    'different-embedding': 0,
    'missing-embedding-config': 0,
    'after-cutoff': 0,
    'untrusted-observation-time': 0,
    'missing-observation-time': 0,
  };

  const reject = (observation: TradingObservation, image: MemoryImage, reason: MemoryExclusionReason) => {
    excluded.push({ observationId: observation.id, imageId: image.id, reason });
    excludedByReason[reason] += 1;
  };

  for (const observation of observations) {
    // Chronology first: a record that cannot be placed in time cannot be judged at all, and
    // reporting it as "excluded for its role" would be misleading when the real problem is
    // that nobody knows when it happened.
    const observedMs = parseInstant(observation.observedAt);
    const untrustedTime = observation.observedAtSource !== 'recorded';

    for (const image of observation.images ?? []) {
      if (observedMs === null) {
        reject(observation, image, 'missing-observation-time');
        continue;
      }
      if (untrustedTime) {
        reject(observation, image, 'untrusted-observation-time');
        continue;
      }
      if (cutoffMs !== null && observedMs >= cutoffMs) {
        reject(observation, image, 'after-cutoff');
        continue;
      }
      if (!isPreDecisionRole(image.role)) {
        reject(observation, image, 'not-pre-decision');
        continue;
      }
      if (requireIndexed && image.indexStatus !== 'completed') {
        reject(observation, image, 'not-indexed');
        continue;
      }
      if (embedding) {
        if (!image.embeddingModel || !image.embeddingVersion) {
          reject(observation, image, 'missing-embedding-config');
          continue;
        }
        if (
          image.embeddingModel !== embedding.model ||
          image.embeddingVersion !== embedding.version
        ) {
          reject(observation, image, 'different-embedding');
          continue;
        }
      }
      eligible.push({ observation, image });
    }
  }

  return { eligible, excluded, excludedByReason };
}

/**
 * The pictures from AFTER the decision, which may only be read once the candidates are chosen.
 *
 * The order matters and is the whole point: `selectMatchCandidates` answers "what looked like
 * this", and only then may the engine look at what happened next. Reading the two in the other
 * order — glancing at the outcome while still deciding what resembles what — is how hindsight
 * gets into a ranking even when every individual rule above is respected.
 */
export function selectOutcomeImages(observation: TradingObservation): MemoryImage[] {
  return (observation.images ?? []).filter((image) => isPostDecisionRole(image.role));
}

/**
 * True when a search would be able to say anything about this observation at all.
 *
 * A library of pictures with no embeddings is still a library — it can be browsed, edited and
 * exported — it simply cannot be searched by similarity. Callers use this to tell "nothing
 * matched" apart from "nothing could be searched yet", which are different messages.
 */
export function isSearchableObservation(observation: TradingObservation): boolean {
  return (observation.images ?? []).some(
    (image) => isPreDecisionRole(image.role) && image.indexStatus === 'completed'
  );
}
