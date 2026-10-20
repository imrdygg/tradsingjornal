/**
 * The memory library's database half.
 *
 * Everything the memory engine stores outside the journal snapshot lives in the tables
 * `supabase/schema.sql` creates, and this module is the only place that knows their column names.
 * Two rules shape it:
 *
 *   1. **The caller never supplies an owner.** Every write reads the signed-in user from the
 *      session itself (`requireUserId`) instead of taking a `userId` argument. Row-level security
 *      would refuse a forged id anyway, but a function that cannot be handed somebody else's id is
 *      a stronger guarantee than one whose WHERE clause happens to be right — and it means the
 *      search below takes no user id at all, because `memory_match_images` reads `auth.uid()`.
 *   2. **A failure is thrown, not returned.** This follows `cloud-sync.ts` and `storage.ts`: the
 *      house style in this codebase is to throw with a message the trader can act on, and let the
 *      hook that called it decide what to show. A `{ ok, error }` wrapper here would be a second
 *      convention doing the same job.
 *
 * The schema has its own failure mode worth naming. `supabase/schema.sql` is additive and re-runnable
 * but it has to have been RUN, and the errors a missing table, column or function produce (42P01,
 * 42703, 42883, PGRST202) say nothing to a trader. `explainSchemaError` turns exactly those into
 * "run schema.sql again", which is the fix every one of them needs.
 *
 * The row mappers are exported and pure. Snake_case-to-camelCase translation is where a data layer
 * actually breaks — a silently swapped `observed_at` and `captured_at` produces a library that looks
 * right and reasons wrongly — so they are separated from the queries and tested directly.
 */

import { supabase } from '../supabase';
import type {
  MemoryImage,
  MemoryIndexJob,
  MemoryIndexStatus,
  MemoryMatchFeedback,
  MemoryObservedAtSource,
  MemoryOutcome,
  MemoryOutcomeStatus,
  MemorySearch,
  MemorySearchFilters,
  MemorySearchMatch,
  TradingObservation,
} from '../../types';
import type { MemoryVectorMatch } from './similarity';
import { PRE_DECISION_ROLES } from './eligibility';
import { MEMORY_BUCKET } from './storage';
import type { MemoryEmbeddingConfig } from './embeddings';
import {
  currentEmbeddingConfig,
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from './embeddings';
import type { MemoryIndexPort } from './index-runner';

function requireClient() {
  if (!supabase) {
    throw new Error(
      'The memory library needs cloud storage. Add your Supabase credentials to use it.'
    );
  }
  return supabase;
}

/**
 * The signed-in user's id, read from the session rather than accepted as an argument.
 *
 * This is the reason no write in this module takes a `userId`. `user_id` is `not null` with no
 * default in every memory table, so it has to be supplied — and supplying it from the session is
 * the only version of that which cannot be talked into writing somebody else's row.
 */
async function requireUserId(): Promise<string> {
  const client = requireClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Sign in first — the memory library is stored in your own account.');
  }
  return user.id;
}

/** Postgres and PostgREST codes that mean "the schema has not been applied yet". */
const MISSING_TABLE = '42P01';
const MISSING_COLUMN = '42703';
const UNDEFINED_FUNCTION = '42883';
const POSTGREST_NO_FUNCTION = 'PGRST202';
// What PostgREST actually returns for a write that names a column it cannot find. It is not 42703:
// the column is unknown to the schema CACHE, so the statement never reaches Postgres.
const POSTGREST_NO_COLUMN = 'PGRST204';

/**
 * Turns an error that means "schema.sql has not been run" into that sentence.
 *
 * Every other error is passed through with its own message, because a database that is unreachable
 * and a permission that is missing both have specific things to say and paraphrasing them would
 * lose the only clue.
 */
export function explainSchemaError(error: { message?: string; code?: string } | null): Error {
  const message = error?.message ?? 'Unknown Supabase error.';
  const missing =
    error?.code === MISSING_TABLE ||
    error?.code === MISSING_COLUMN ||
    error?.code === UNDEFINED_FUNCTION ||
    error?.code === POSTGREST_NO_FUNCTION ||
    error?.code === POSTGREST_NO_COLUMN ||
    /does not exist|schema cache/i.test(message);

  if (missing) {
    return new Error(
      `${message} — the memory tables are missing. Open the Supabase SQL editor and run ` +
        'supabase/schema.sql (it only adds what is missing), then try again.'
    );
  }
  return new Error(message);
}

// ---------------------------------------------------------------------------
// pgvector at the boundary
// ---------------------------------------------------------------------------

/**
 * An embedding as PostgREST will accept it.
 *
 * A JavaScript array is serialised into the request body as JSON, and PostgREST has no implicit cast
 * from `json`/`jsonb` to `vector`, so the insert is rejected with a type error. The text literal
 * `[1,2,3]` does have one, so the vector travels as a string and the cast happens in Postgres. This
 * is a wire-format detail, not a change to the data: the same numbers arrive either way.
 */
export function toPgVector(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * A vector read back off a row, or null when it is not a usable one.
 *
 * PostgREST returns `vector` as its text form (`"[1,2,3]"`). Anything else — a null, the string
 * "null", a short array — becomes null rather than an array of the wrong length, because a vector
 * that cannot be trusted must not reach a ranking where it would score against everything.
 */
export function readPgVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.length === MEMORY_EMBEDDING_DIMENSION &&
      value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ? (value as number[])
      : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return null;
  const parts = trimmed.split(',');
  if (parts.length !== MEMORY_EMBEDDING_DIMENSION) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return numbers;
}

// ---------------------------------------------------------------------------
// Row shapes, as the tables define them
// ---------------------------------------------------------------------------

export interface TradingObservationRow {
  id: string;
  user_id: string;
  linked_trade_id: string | null;
  observed_at: string;
  observed_at_source: string;
  market_timezone: string;
  instrument: string;
  timeframe: string | null;
  session_type: string | null;
  setup_id: string | null;
  setup_name: string | null;
  setup_category: string | null;
  previous_trend: string | null;
  observed_direction: string | null;
  market_context: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryImageRow {
  id: string;
  user_id: string;
  observation_id: string;
  linked_trade_id: string | null;
  image_role: string;
  bucket_id: string;
  storage_path: string;
  image_checksum: string | null;
  /** What the trader saw in this picture, in their own words. */
  note: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  captured_at: string | null;
  embedding_model: string | null;
  embedding_version: number | null;
  embedding_dimension: number | null;
  embedding?: string | null;
  indexing_status: string;
  indexing_error: string | null;
  indexed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryOutcomeRow {
  observation_id: string;
  user_id: string;
  outcome_status: string;
  outcome_window: string | null;
  observation_cutoff: string | null;
  continuation_or_reversal: string | null;
  measured_market_movement: number | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  outcome_source: string;
  verified_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface MemorySearchRow {
  id: string;
  user_id: string;
  searched_at: string;
  query_checksum: string | null;
  filters: unknown;
  matched_observation_ids: string[] | null;
  retrieval_model: string | null;
  retrieval_version: number | null;
  result_metadata: unknown;
  feedback: unknown;
  expires_at: string | null;
}

export interface MemoryIndexJobRow {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  total_items: number;
  processed_items: number;
  failed_items: number;
  skipped_items: number;
  cursor: string | null;
  model: string | null;
  embedding_version: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** A nullable value, normalised so `undefined` never reaches a column. */
const orNull = <T>(value: T | undefined | null): T | null => (value === undefined ? null : value ?? null);

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * The observation's columns.
 *
 * One deliberate translation: `instrument` holds the SYMBOL. The table's column is the searchable
 * one — `memory_match_images` filters on it — and the journal's `instrumentId` is a local record id
 * that means nothing in this table and is deliberately not stored.
 */
export function observationRow(
  observation: TradingObservation,
  userId: string
): TradingObservationRow {
  return {
    id: observation.id,
    user_id: userId,
    linked_trade_id: orNull(observation.linkedTradeId),
    observed_at: observation.observedAt,
    observed_at_source: observation.observedAtSource,
    market_timezone: observation.marketTimezone,
    instrument: observation.symbol,
    timeframe: orNull(observation.timeframe),
    session_type: orNull(observation.session),
    setup_id: orNull(observation.setupId),
    setup_name: orNull(observation.setupName),
    setup_category: orNull(observation.setupCategory),
    previous_trend: orNull(observation.previousTrend),
    observed_direction: orNull(observation.observedDirection),
    market_context: orNull(observation.marketContext),
    notes: orNull(observation.notes),
    created_at: observation.createdAt,
    updated_at: observation.updatedAt,
  };
}

export function imageRow(
  image: MemoryImage,
  userId: string,
  observationId: string,
  linkedTradeId?: string
): MemoryImageRow {
  return {
    id: image.id,
    user_id: userId,
    observation_id: observationId,
    linked_trade_id: orNull(linkedTradeId),
    image_role: image.role,
    bucket_id: MEMORY_BUCKET,
    // `storage_path` is `not null`, and this is the reason `upsertObservations` only writes rows for
    // pictures that are actually in the bucket. See the caller.
    storage_path: image.storagePath as string,
    image_checksum: orNull(image.checksum),
    note: orNull(image.note),
    width: orNull(image.width),
    height: orNull(image.height),
    mime_type: orNull(image.mimeType),
    captured_at: orNull(image.capturedAt),
    embedding_model: orNull(image.embeddingModel),
    embedding_version: orNull(image.embeddingVersion),
    embedding_dimension: orNull(image.embeddingDimension),
    indexing_status: image.indexStatus,
    indexing_error: orNull(image.indexError),
    indexed_at: orNull(image.indexedAt),
    created_at: image.createdAt,
    updated_at: image.updatedAt,
  };
}

export function observationFromRow(
  row: TradingObservationRow,
  images: MemoryImage[] = [],
  outcome?: MemoryOutcome
): TradingObservation {
  return {
    id: row.id,
    userId: row.user_id,
    linkedTradeId: row.linked_trade_id ?? undefined,
    observedAt: row.observed_at,
    observedAtSource: (row.observed_at_source as MemoryObservedAtSource) ?? 'recorded',
    marketTimezone: row.market_timezone,
    // No instrument id is stored, so the symbol stands in for both. A UI that needs the id resolves
    // it against the journal's instruments, which is the only place it exists.
    instrumentId: row.instrument,
    symbol: row.instrument,
    timeframe: (row.timeframe ?? undefined) as TradingObservation['timeframe'],
    session: (row.session_type ?? undefined) as TradingObservation['session'],
    setupId: row.setup_id ?? undefined,
    setupName: row.setup_name ?? undefined,
    setupCategory: row.setup_category ?? undefined,
    previousTrend: (row.previous_trend ?? undefined) as TradingObservation['previousTrend'],
    observedDirection: (row.observed_direction ?? undefined) as TradingObservation['observedDirection'],
    marketContext: row.market_context ?? undefined,
    notes: row.notes ?? undefined,
    images,
    outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function imageFromRow(row: MemoryImageRow): MemoryImage {
  return {
    id: row.id,
    observationId: row.observation_id,
    role: row.image_role as MemoryImage['role'],
    storagePath: row.storage_path ?? undefined,
    checksum: row.image_checksum ?? undefined,
    note: row.note ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    mimeType: row.mime_type ?? undefined,
    capturedAt: row.captured_at ?? undefined,
    embeddingModel: row.embedding_model ?? undefined,
    embeddingVersion: row.embedding_version ?? undefined,
    embeddingDimension: row.embedding_dimension ?? undefined,
    // The vector itself stays in the database. It is never carried on the type, because a 768-number
    // array on every record would travel through the journal sync the snapshot shape cannot afford.
    indexStatus: (row.indexing_status as MemoryIndexStatus) ?? 'pending',
    indexError: row.indexing_error ?? undefined,
    indexedAt: row.indexed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function outcomeRow(
  observationId: string,
  userId: string,
  outcome: MemoryOutcome,
  now: string
): MemoryOutcomeRow {
  return {
    observation_id: observationId,
    user_id: userId,
    outcome_status: outcome.status,
    outcome_window: orNull(outcome.window),
    observation_cutoff: orNull(outcome.observationCutoff),
    continuation_or_reversal: orNull(outcome.continuation),
    measured_market_movement: orNull(outcome.measuredMovementPoints),
    max_favorable_excursion: orNull(outcome.maxFavorableExcursionPoints),
    max_adverse_excursion: orNull(outcome.maxAdverseExcursionPoints),
    outcome_source: outcome.source,
    verified_at: orNull(outcome.verifiedAt),
    notes: orNull(outcome.notes),
    updated_at: now,
  };
}

export function outcomeFromRow(row: MemoryOutcomeRow): MemoryOutcome {
  return {
    status: (row.outcome_status as MemoryOutcomeStatus) ?? 'unknown',
    window: row.outcome_window ?? undefined,
    observationCutoff: row.observation_cutoff ?? undefined,
    continuation: (row.continuation_or_reversal ?? undefined) as MemoryOutcome['continuation'],
    measuredMovementPoints: row.measured_market_movement ?? undefined,
    maxFavorableExcursionPoints: row.max_favorable_excursion ?? undefined,
    maxAdverseExcursionPoints: row.max_adverse_excursion ?? undefined,
    source: (row.outcome_source as MemoryOutcome['source']) ?? 'unknown',
    verifiedAt: row.verified_at ?? undefined,
    notes: row.notes ?? undefined,
  };
}

/**
 * One ranked candidate, as `memory_match_images` returns it.
 *
 * The `p_model`/`p_version` guard in the function means every row here was embedded by the
 * configuration the query used, so there is nothing to re-check — but `cosine_distance` is still
 * passed through as a number rather than trusted to be one, because a null would become `NaN` in
 * the resemblance arithmetic and sort unpredictably.
 */
export function vectorMatchFromRow(row: Record<string, unknown>): MemoryVectorMatch {
  // A missing distance is read as a MISSING distance, not as zero. `Number(null)` is 0, and 0 is
  // cosine distance "identical" — so the obvious `Number(row.cosine_distance)` would turn a null
  // into a perfect match, ranking a row the database could not score as the closest thing to the
  // query. The empty string is included because PostgREST serialises a null numeric as one in some
  // shapes. Unusable distances become 1 ("no resemblance") rather than NaN, which would sort
  // unpredictably and compare false against everything.
  const raw = row.cosine_distance;
  const distance =
    raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return {
    observationId: String(row.observation_id ?? ''),
    imageId: String(row.image_id ?? ''),
    role: (row.image_role ?? 'context') as MemoryVectorMatch['role'],
    cosineDistance: Number.isFinite(distance) ? distance : 1,
    observedAt: String(row.observed_at ?? ''),
    instrument: String(row.instrument ?? ''),
    timeframe: (row.timeframe as string | null) ?? undefined,
    session: (row.session_type as string | null) ?? undefined,
    setupName: (row.setup_name as string | null) ?? undefined,
    linkedTradeId: (row.linked_trade_id as string | null) ?? undefined,
  };
}

/** A stored search, reassembled from its four columns. */
export function searchFromRow(row: MemorySearchRow, matches: MemorySearchMatch[] = []): MemorySearch {
  const meta = (row.result_metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    userId: row.user_id,
    searchedAt: row.searched_at,
    queryChecksum: row.query_checksum ?? undefined,
    filters: (row.filters ?? {}) as MemorySearchFilters,
    matches,
    embeddingModel: row.retrieval_model ?? undefined,
    embeddingVersion: row.retrieval_version ?? undefined,
    resemblanceFloor:
      typeof meta.resemblanceFloor === 'number' ? meta.resemblanceFloor : undefined,
    expiresAt: row.expires_at ?? undefined,
  };
}

export function indexJobFromRow(row: MemoryIndexJobRow): MemoryIndexJob {
  return {
    id: row.id,
    userId: row.user_id,
    kind: (row.kind as MemoryIndexJob['kind']) ?? 'backfill',
    status: (row.status as MemoryIndexJob['status']) ?? 'pending',
    totalItems: row.total_items ?? 0,
    processedItems: row.processed_items ?? 0,
    failedItems: row.failed_items ?? 0,
    skippedItems: row.skipped_items ?? 0,
    cursor: row.cursor ?? undefined,
    embeddingModel: row.model ?? undefined,
    embeddingVersion: row.embedding_version ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Mirrors a set of observations into the tables, with their pictures.
 *
 * Idempotent by construction: every row is keyed by the client's own id, so re-offering the same
 * records — which is what a snapshot sync does on every save — upserts rather than duplicating.
 *
 * Only pictures with a `storagePath` get a row, and that is a property of the schema rather than a
 * choice: `memory_images.storage_path` is `not null`. A journal with no cloud therefore keeps its
 * inline screenshots in the snapshot and none of them are searchable until they are uploaded. That
 * is the honest state, not a silent half-import.
 *
 * Returns how many observation rows were written.
 */
export async function upsertObservations(
  observations: readonly TradingObservation[]
): Promise<number> {
  if (observations.length === 0) return 0;
  const client = requireClient();
  const userId = await requireUserId();

  const rows = observations.map((observation) => observationRow(observation, userId));
  const images = observations.flatMap((observation) =>
    (observation.images ?? [])
      .filter((image) => Boolean(image.storagePath))
      .map((image) => imageRow(image, userId, observation.id, observation.linkedTradeId))
  );

  const { error } = await client
    .from('trading_observations')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw explainSchemaError(error);

  if (images.length > 0) {
    // The checksum column is part of a unique key scoped to the observation, so a re-offered picture
    // with the same digest updates its row instead of colliding.
    const { error: imageError } = await client
      .from('memory_images')
      .upsert(images, { onConflict: 'id' });
    if (imageError) throw explainSchemaError(imageError);
  }

  // ---- Pictures removed from a sighting stop being matchable ----
  //
  // An upsert only adds or updates. Without this pass, a picture the trader removed keeps its row
  // and its embedding, so a later search can still return it — pointing at a sighting that no
  // longer shows that chart. The read is one query for the whole batch and the delete is one
  // statement, so this does not turn a backfill into a query per picture.
  const { data: existingImages, error: existingImagesError } = await client
    .from('memory_images')
    .select('id')
    .in('observation_id', rows.map((row) => row.id));
  if (existingImagesError) throw explainSchemaError(existingImagesError);

  const currentImageIds = new Set(images.map((image) => image.id));
  const staleImageIds = ((existingImages ?? []) as { id: string }[])
    .map((row) => row.id)
    // A row is stale when the observation it belongs to was in this batch and its picture is no
    // longer on the record. Rows for observations outside the batch are never considered.
    .filter((id) => !currentImageIds.has(id));

  if (staleImageIds.length > 0) {
    const { error: staleError } = await client
      .from('memory_images')
      .delete()
      .in('id', staleImageIds);
    if (staleError) throw explainSchemaError(staleError);
  }

  return rows.length;
}

/** Records what price did after the setup, or that it is genuinely not known. */
export async function upsertObservationOutcome(
  observationId: string,
  outcome: MemoryOutcome,
  now: string = new Date().toISOString()
): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client
    .from('memory_outcomes')
    .upsert(outcomeRow(observationId, userId, outcome, now), { onConflict: 'observation_id' });
  if (error) throw explainSchemaError(error);
}

/**
 * Records where one picture is in the pipeline.
 *
 * One function for every state rather than one per state, so there is a single place where the
 * status column and the error column are set together — a `failed` row with no message is the one
 * combination a trader cannot act on.
 */
export async function setImageIndexState(
  imageId: string,
  state: {
    status: MemoryIndexStatus;
    error?: string;
    stamp?: MemoryEmbeddingConfig;
    indexedAt?: string;
  },
  now: string = new Date().toISOString()
): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('memory_images')
    .update({
      indexing_status: state.status,
      indexing_error: orNull(state.error),
      ...(state.stamp
        ? {
            embedding_model: state.stamp.model,
            embedding_version: state.stamp.version,
            embedding_dimension: state.stamp.dimension,
          }
        : {}),
      indexed_at: orNull(state.indexedAt),
      updated_at: now,
    })
    .eq('id', imageId);
  if (error) throw explainSchemaError(error);
}

/**
 * Stores a vector and the stamp that says what produced it, together.
 *
 * Together is the point: a vector without its stamp is a row that cannot say what it is comparable
 * with, and `matchesEmbeddingConfig` rejects one. Writing them in one statement is what makes that
 * unreachable rather than merely unlikely.
 */
export async function saveImageEmbedding(
  imageId: string,
  embedding: readonly number[],
  stamp: MemoryEmbeddingConfig = currentEmbeddingConfig(),
  now: string = new Date().toISOString()
): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('memory_images')
    .update({
      embedding: toPgVector(embedding),
      embedding_model: stamp.model,
      embedding_version: stamp.version,
      embedding_dimension: stamp.dimension,
      indexing_status: 'completed',
      indexing_error: null,
      indexed_at: now,
      updated_at: now,
    })
    .eq('id', imageId);
  if (error) throw explainSchemaError(error);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The pictures still waiting for a vector.
 *
 * `failed` is included with `pending` on purpose: a failure is usually a rate limit or a timeout
 * rather than a fact about the picture, and a run the trader restarts must pick those up. A failure
 * that is genuinely permanent is re-attempted once per run and re-recorded, which is cheap.
 *
 * `processing` is included for a reason that is easy to miss: a run that is interrupted between
 * "mark this one in progress" and "store its vector" — a closed tab, a dropped connection, a
 * browser killed by the OS — leaves that picture stuck in `processing` for ever if the queue only
 * ever accepts `pending`. It would then be invisible to every later run while looking, from the
 * library screen, like work that is happening. Re-offering it costs one unnecessary embedding and
 * makes the "interruption is a state, not a crash" property of the runner actually true.
 *
 * Ordered by creation so a resumed run continues in the same order it was interrupted in.
 *
 * Only pre-decision roles are offered at all, whatever their status. A picture brought in from the
 * journal is `pending` the moment consent exists, but it is not WORK: nothing may ever match on it,
 * so sending it would spend a model call on a chart the engine has already decided it will not use,
 * and would hand a picture to the provider that the trader has not yet said anything about. Labelling
 * it is the one thing that changes its role, and the row becomes work on the next run.
 */
export async function listImagesNeedingIndex(limit: number): Promise<MemoryImage[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('memory_images')
    .select('*')
    .in('indexing_status', ['pending', 'failed', 'processing'])
    .in('image_role', [...PRE_DECISION_ROLES])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(Math.max(1, limit));
  if (error) throw explainSchemaError(error);
  return ((data ?? []) as MemoryImageRow[]).map(imageFromRow);
}

/** Every observation in the library, with its pictures and its recorded outcome. */
export async function listObservations(): Promise<TradingObservation[]> {
  const client = requireClient();

  const { data: observationRows, error } = await client
    .from('trading_observations')
    .select('*')
    .order('observed_at', { ascending: false });
  if (error) throw explainSchemaError(error);

  const observations = (observationRows ?? []) as TradingObservationRow[];
  if (observations.length === 0) return [];

  const ids = observations.map((row) => row.id);

  // Two more reads rather than a join: PostgREST would embed both, and the embedding of a
  // many-row `in` filter is the shape that gets silently truncated.
  const { data: imageRows, error: imageError } = await client
    .from('memory_images')
    .select('*')
    .in('observation_id', ids);
  if (imageError) throw explainSchemaError(imageError);

  const { data: outcomeRows, error: outcomeError } = await client
    .from('memory_outcomes')
    .select('*')
    .in('observation_id', ids);
  if (outcomeError) throw explainSchemaError(outcomeError);

  const imagesByObservation = new Map<string, MemoryImage[]>();
  for (const row of (imageRows ?? []) as MemoryImageRow[]) {
    const list = imagesByObservation.get(row.observation_id) ?? [];
    list.push(imageFromRow(row));
    imagesByObservation.set(row.observation_id, list);
  }

  const outcomes = new Map<string, MemoryOutcome>();
  for (const row of (outcomeRows ?? []) as MemoryOutcomeRow[]) {
    outcomes.set(row.observation_id, outcomeFromRow(row));
  }

  return observations.map((row) =>
    observationFromRow(row, imagesByObservation.get(row.id) ?? [], outcomes.get(row.id))
  );
}

/**
 * The roles a match may be drawn from: pictures that existed BEFORE the decision.
 *
 * This mirrors the default in `memory_match_images` and is passed explicitly so the boundary is
 * visible in the client too. Widening it to include `after-setup` or `exit` would let the search
 * "find" a setup using a chart printed after the entry, which is hindsight dressed as evidence.
 */
export const MEMORY_MATCH_ROLES = ['before-setup', 'entry'] as const;

export interface MemorySearchQuery {
  filters?: MemorySearchFilters;
  limit?: number;
  /** Ordered roles to search. Defaults to `MEMORY_MATCH_ROLES`. */
  roles?: readonly string[];
  /**
   * The instant the search must not see past — the replay boundary.
   *
   * Strictly exclusive, matching the SQL: an observation at the cutoff itself is not knowable at the
   * cutoff, and including it would be the one-off error that turns a replay into a search with
   * foresight.
   */
  cutoff?: string;
  stamp?: MemoryEmbeddingConfig;
}

/**
 * The nearest stored pictures to a query vector.
 *
 * No user id is passed, and that is the security property rather than an omission: the RPC reads
 * `auth.uid()` and RLS scopes every row it touches, so a caller cannot ask about anyone but
 * themselves even by constructing the call by hand.
 *
 * KNOWN GAP: the RPC has an upper time bound (`p_cutoff`) and no lower one, so
 * `filters.fromDate` cannot be pushed into the query. It is applied by the caller over the returned
 * page, which means a page can be filled by matches older than `fromDate`. Closing that needs a
 * `p_from` parameter, and adding it means changing the function's signature — which the schema file
 * deliberately avoids, because the `revoke`/`grant` statements name the function without one.
 */
export async function searchMemoryImages(
  query: readonly number[],
  options: MemorySearchQuery = {}
): Promise<MemoryVectorMatch[]> {
  const client = requireClient();
  const stamp = options.stamp ?? currentEmbeddingConfig();
  const filters = options.filters ?? {};

  // `toDate` is an inclusive day in the UI and an exclusive instant in the query, so the boundary
  // is the end of that day. Interpreting it as the start would silently drop the day the trader
  // asked to include.
  const cutoff =
    options.cutoff ??
    (filters.toDate ? new Date(`${filters.toDate}T23:59:59.999Z`).toISOString() : undefined);

  const { data, error } = await client.rpc('memory_match_images', {
    p_query: toPgVector(query),
    p_match_count: Math.max(1, options.limit ?? 12),
    p_model: stamp.model,
    p_version: stamp.version,
    p_roles: [...(options.roles ?? MEMORY_MATCH_ROLES)],
    p_instrument: orNull(filters.instrument),
    p_timeframe: orNull(filters.timeframe),
    p_session: orNull(filters.session),
    p_setup_name: orNull(filters.setupName),
    p_cutoff: orNull(cutoff),
  });
  if (error) throw explainSchemaError(error);

  return ((data ?? []) as Record<string, unknown>[]).map(vectorMatchFromRow);
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

/**
 * Keeps a search and what it returned, so retrieval can be judged later.
 *
 * There is deliberately no `updated_at` in this payload. `memory_searches` has no such column —
 * `searched_at` is its only timestamp, and the row is written once — and PostgREST refuses a write
 * naming a column it cannot find, so sending one failed the whole insert and `explainSchemaError`
 * then reported it as "run schema.sql again" over a schema that was already correct. The same
 * contract is asserted against the schema file itself in `db.test.ts`.
 */
export async function saveMemorySearch(search: MemorySearch): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();

  const { error } = await client.from('memory_searches').upsert(
    {
      id: search.id,
      user_id: userId,
      searched_at: search.searchedAt,
      query_checksum: orNull(search.queryChecksum),
      filters: search.filters ?? {},
      matched_observation_ids: search.matches.map((match) => match.observationId),
      retrieval_model: orNull(search.embeddingModel),
      retrieval_version: orNull(search.embeddingVersion),
      // The matches themselves travel in `result_metadata` rather than in their own table: they are
      // a snapshot of one answer, read whole or not at all, and never joined against.
      result_metadata: {
        resemblanceFloor: search.resemblanceFloor,
        matches: search.matches,
      },
      ...(search.expiresAt ? { expires_at: search.expiresAt } : {}),
    },
    { onConflict: 'id' }
  );
  if (error) throw explainSchemaError(error);
}

/** Recent searches, most recent first. */
export async function listMemorySearches(limit = 20): Promise<MemorySearch[]> {
  const client = requireClient();
  const { data, error } = await client
    .from('memory_searches')
    .select('*')
    .order('searched_at', { ascending: false })
    .limit(Math.max(1, limit));
  if (error) throw explainSchemaError(error);

  return ((data ?? []) as MemorySearchRow[]).map((row) => {
    const meta = (row.result_metadata ?? {}) as Record<string, unknown>;
    const matches = Array.isArray(meta.matches) ? (meta.matches as MemorySearchMatch[]) : [];
    return searchFromRow(row, matches);
  });
}

/** Records the trader's own verdict on one returned match. */
export async function setMatchFeedback(
  searchId: string,
  observationId: string,
  feedback: MemoryMatchFeedback
): Promise<void> {
  const client = requireClient();
  const { data, error } = await client
    .from('memory_searches')
    .select('result_metadata')
    .eq('id', searchId)
    .maybeSingle();
  if (error) throw explainSchemaError(error);
  if (!data) throw new Error('That search is no longer saved, so its verdict cannot be recorded.');

  const meta = ((data.result_metadata ?? {}) as Record<string, unknown>) ?? {};
  const matches = Array.isArray(meta.matches) ? (meta.matches as MemorySearchMatch[]) : [];
  const next = matches.map((match) =>
    match.observationId === observationId ? { ...match, feedback } : match
  );

  const { error: writeError } = await client
    .from('memory_searches')
    .update({ result_metadata: { ...meta, matches: next } })
    .eq('id', searchId);
  if (writeError) throw explainSchemaError(writeError);
}

/** Deletes searches older than the retention window, returning how many went. */
export async function pruneMemorySearches(keepDays = 90): Promise<number> {
  const client = requireClient();
  const { data, error } = await client.rpc('memory_prune_searches', {
    p_keep_days: Math.max(1, Math.round(keepDays)),
  });
  if (error) throw explainSchemaError(error);
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------------
// Indexing jobs
// ---------------------------------------------------------------------------

/** Opens a job row, so a run that stops has somewhere to have stopped. */
export async function createIndexJob(
  kind: MemoryIndexJob['kind'],
  totalItems: number,
  now: string = new Date().toISOString()
): Promise<MemoryIndexJob> {
  const client = requireClient();
  const userId = await requireUserId();
  const config = currentEmbeddingConfig();
  const id = `job-${now}-${Math.random().toString(36).slice(2, 10)}`;

  const { data, error } = await client
    .from('memory_index_jobs')
    .insert({
      id,
      user_id: userId,
      kind,
      status: 'processing',
      total_items: Math.max(0, totalItems),
      model: config.model,
      embedding_version: config.version,
      created_at: now,
      updated_at: now,
      started_at: now,
    })
    .select('*')
    .single();
  if (error) throw explainSchemaError(error);
  return indexJobFromRow(data as MemoryIndexJobRow);
}

/** Moves a job on: its counters, its cursor, and its ending when there is one. */
export async function updateIndexJob(
  id: string,
  patch: Partial<Pick<MemoryIndexJob, 'status' | 'totalItems' | 'processedItems' | 'failedItems' | 'skippedItems' | 'cursor' | 'lastError' | 'finishedAt'>>,
  now: string = new Date().toISOString()
): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('memory_index_jobs')
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.totalItems !== undefined ? { total_items: patch.totalItems } : {}),
      ...(patch.processedItems !== undefined ? { processed_items: patch.processedItems } : {}),
      ...(patch.failedItems !== undefined ? { failed_items: patch.failedItems } : {}),
      ...(patch.skippedItems !== undefined ? { skipped_items: patch.skippedItems } : {}),
      ...(patch.cursor !== undefined ? { cursor: orNull(patch.cursor) } : {}),
      ...(patch.lastError !== undefined ? { last_error: orNull(patch.lastError) } : {}),
      ...(patch.finishedAt !== undefined ? { finished_at: orNull(patch.finishedAt) } : {}),
      updated_at: now,
    })
    .eq('id', id);
  if (error) throw explainSchemaError(error);
}

/** The most recent job, so a reopened screen can say what the last run actually did. */
export async function latestIndexJob(): Promise<MemoryIndexJob | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('memory_index_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw explainSchemaError(error);
  return data ? indexJobFromRow(data as MemoryIndexJobRow) : null;
}

// ---------------------------------------------------------------------------
// The runner's port
// ---------------------------------------------------------------------------

/**
 * The database, as `runMemoryIndex` needs it.
 *
 * `markSkipped` writes `skipped` with its reason in the error column. That column is called
 * `indexing_error` and this is the one case where what it holds is not an error: a reason. It is
 * reused rather than given its own column because the alternative is a second nullable text column
 * that only ever holds one of two kinds of sentence, and the status says which kind it is.
 */
export function createMemoryIndexPort(): MemoryIndexPort {
  return {
    listPending: listImagesNeedingIndex,
    markProcessing: (imageId) => setImageIndexState(imageId, { status: 'processing' }),
    saveEmbedding: (imageId, embedding, stamp) => saveImageEmbedding(imageId, embedding, stamp),
    markFailed: (imageId, error) => setImageIndexState(imageId, { status: 'failed', error }),
    markSkipped: (imageId, reason) => setImageIndexState(imageId, { status: 'skipped', error: reason }),
  };
}

/** Re-exported so callers of this module do not have to reach into `embeddings` for the stamp. */
export { MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_VERSION, MEMORY_EMBEDDING_DIMENSION };
