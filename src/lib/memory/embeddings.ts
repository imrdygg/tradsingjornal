/**
 * Which embedding model the memory engine uses, and what it means to be comparable with it.
 *
 * A vector is only meaningful against vectors from the SAME model at the SAME output size. Two
 * vectors from different configurations are both well-formed arrays of numbers and the distance
 * between them is a well-formed number too — which is exactly the problem: nothing about the
 * arithmetic fails, so mixing them produces a plausible score that means nothing. The only defence
 * is to label every vector with what produced it and refuse to compare across labels.
 *
 * So the model, the version and the dimension are decided here, once, and they are stored on every
 * indexed image (`memory_images.embedding_model`, `.embedding_version`, `.embedding_dimension`) and
 * filtered on inside `memory_match_images`. The browser never chooses them, and the endpoint
 * validates against them.
 *
 * Changing the model means bumping `MEMORY_EMBEDDING_VERSION`, which is what makes a re-index an
 * explicit, visible operation rather than a silent one: existing rows keep their old stamp and stay
 * searchable against each other until they are re-embedded, and `canCompareEmbeddings` refuses to
 * mix the two generations in the meantime.
 */

/**
 * Google's natively multimodal embedding model.
 *
 * Verified against the current Gemini API documentation: `gemini-embedding-2` is the multimodal
 * model (`gemini-embedding-001` remains available for text only), it is called through
 * `POST /v1beta/models/gemini-embedding-2:embedContent` with the key in `x-goog-api-key`, and it
 * supports `output_dimensionality`. That it is called the same way as the coach's generateContent is
 * what lets the endpoint stay dependency-free `fetch`, the same as `src/api/coach.ts`.
 *
 * One property of this model matters to the design: it produces a SINGLE AGGREGATED embedding for
 * several inputs rather than one per input. So a batch is not a way to get many vectors from one
 * call, and the indexing runner must not build a batch of pictures and expect a vector for each.
 * See `MEMORY_INDEX_REQUEST_SIZE`.
 */
export const MEMORY_EMBEDDING_MODEL = 'gemini-embedding-2';

/**
 * The configuration version.
 *
 * Bump this whenever the model, the output size, or anything about how the image is prepared before
 * embedding changes. It is not a model version the provider gives us — it is ours, and it exists so
 * that vectors from before and after a change can never be ranked against each other.
 */
export const MEMORY_EMBEDDING_VERSION = 1;

/**
 * 768 dimensions, which is one of the sizes the model documents as recommended.
 *
 * Chosen over the 3072 default for storage: this library is expected to reach the thousands of
 * screenshots, and a third of the dimensions is a third of the index, at a quality difference the
 * provider describes as small. The column in `supabase/schema.sql` is `vector(768)`, so changing
 * this needs a migration as well as a version bump.
 */
export const MEMORY_EMBEDDING_DIMENSION = 768;

/**
 * How many pictures are sent for embedding in one request.
 *
 * ONE. The model aggregates multiple inputs into a single vector, so a larger request would return
 * one embedding for a batch of charts — useless for indexing, which needs one vector per picture.
 * The constant exists so the reason is recorded rather than rediscovered: this was not a timidity
 * about batch sizes, it is a property of the model.
 *
 * The indexing runner therefore parallelises across requests with a bounded concurrency rather than
 * by sending bigger ones. See `MEMORY_INDEX_CONCURRENCY`.
 */
export const MEMORY_INDEX_REQUEST_SIZE = 1;

/**
 * How many embedding requests may be in flight at once during a backfill.
 *
 * Deliberately low. The work is a paid, rate-limited API call per picture over a library that may be
 * several hundred strong, so the risk is not slowness but a burst that earns a rate limit and loses
 * the whole run — and a rate limit costs far more time than the concurrency would have saved. Two
 * keeps the run moving without ever looking like an attack.
 */
export const MEMORY_INDEX_CONCURRENCY = 2;

/** The smallest input size the column and the model can agree on, for validation. */
export const MEMORY_MIN_EMBEDDING_DIMENSION = 128;
/** The largest output size the model documents. */
export const MEMORY_MAX_EMBEDDING_DIMENSION = 3072;

/** The embedding configuration a vector was produced with. */
export interface MemoryEmbeddingConfig {
  model: string;
  version: number;
  dimension: number;
}

/** The configuration this build produces and expects. */
export function currentEmbeddingConfig(): MemoryEmbeddingConfig {
  return {
    model: MEMORY_EMBEDDING_MODEL,
    version: MEMORY_EMBEDDING_VERSION,
    dimension: MEMORY_EMBEDDING_DIMENSION,
  };
}

/**
 * Whether a value read off a stored row is a usable vector for this build.
 *
 * Total, because the value comes from a synced journal and from Postgres, either of which may hold
 * something an older or newer build wrote. It checks the configuration AND the shape: a vector of
 * the right nominal length that is full of `null`s, `NaN`s or strings is not a vector, and accepting
 * it would put a corrupt row into a ranking where it would score against everything at random.
 */
export function isUsableEmbedding(
  value: unknown,
  expected: MemoryEmbeddingConfig = currentEmbeddingConfig()
): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length !== expected.dimension) return false;
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return false;
  }
  return true;
}

/**
 * Whether a stored row's stamp matches this build's configuration.
 *
 * A row with no stamp at all is NOT compatible. Treating an unstamped vector as a wildcard would
 * mean an imported or hand-written row could be compared against anything, which is the one thing
 * the stamp exists to prevent.
 */
export function matchesEmbeddingConfig(
  stamp: { model?: string | null; version?: number | null; dimension?: number | null } | null | undefined,
  expected: MemoryEmbeddingConfig = currentEmbeddingConfig()
): boolean {
  if (!stamp) return false;
  if (!stamp.model || stamp.model !== expected.model) return false;
  if (typeof stamp.version !== 'number' || stamp.version !== expected.version) return false;
  // The dimension is checked when the row states one, and its absence is not treated as a match:
  // `embedding_dimension` is written by the same code that writes the vector, so a row without it
  // predates the feature rather than being configurable.
  return typeof stamp.dimension === 'number' && stamp.dimension === expected.dimension;
}
