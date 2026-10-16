/**
 * The embedding wire contract: what goes to the endpoint and what may come back.
 *
 * Split out from `embedding-api.ts` for one hard reason: the serverless handler has to validate with
 * the same readers the browser builds with, and the handler must stay DEPENDENCY-FREE. The client
 * module imports the Supabase client, so a handler that reached into it would bundle
 * `@supabase/supabase-js` into the function — which is exactly what `api/coach.js` was created to
 * avoid, because the host's TypeScript function build repeatedly shipped a broken function and the
 * pre-bundled, dependency-free file is what removed that compiler from the equation.
 *
 * So the division is the same one the coach already uses: pure types and readers here, the network
 * call in `embedding-api.ts`, and both sides importing only this file.
 *
 * This module imports nothing but the embedding configuration, and must keep it that way.
 */

import {
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
  isUsableEmbedding,
} from './embeddings';

/** One picture to embed: a compressed data URL and a label naming what it is. */
export interface EmbedImageInput {
  label: string;
  dataUrl: string;
}

export interface EmbedRequest {
  images: EmbedImageInput[];
}

/** One embedding as the server returns it. */
export interface EmbedResult {
  label: string;
  embedding: number[];
}

export interface EmbedSuccess {
  ok: true;
  model: string;
  version: number;
  dimension: number;
  results: EmbedResult[];
}

export type EmbedErrorCode =
  | 'unconfigured'
  | 'network'
  | 'unauthorized'
  | 'rate_limited'
  | 'bad_request'
  | 'bad_key'
  /** The provider answered, but with something that is not a usable vector. */
  | 'bad_response'
  | 'server';

export interface EmbedFailure {
  ok: false;
  code: EmbedErrorCode;
  message: string;
  /** Seconds to wait before retrying, when the server said. */
  retryAfterSeconds?: number;
}

export type EmbedOutcome = EmbedSuccess | EmbedFailure;

/**
 * The most pictures one request may carry.
 *
 * One, because the model aggregates several inputs into a single embedding rather than returning
 * one per input — a batch would come back as one vector for a group of charts, which is not an
 * embedding of any of them. The cap is the endpoint's, enforced server-side so a hand-made request
 * cannot ask for something the browser would never send.
 */
export const MEMORY_MAX_IMAGES_PER_REQUEST = 1;

/**
 * Reads one embedding off the wire.
 *
 * Every value is checked, not just the length. An array of the right size containing a string or a
 * `NaN` would pass a length check and then poison a whole ranking, because the distance to a
 * non-number is a perfectly well-formed number. A row that fails this is rejected rather than
 * stored.
 */
export function readEmbedding(raw: unknown): number[] | null {
  if (!isUsableEmbedding(raw)) return null;
  return raw as number[];
}

/**
 * Reads a whole embedding response, refusing to pair a short answer with the pictures that asked.
 *
 * The count must match exactly. A short or reordered answer would otherwise be zipped up against the
 * inputs by position, which is how a chart ends up indexed under another chart's id — the worst
 * failure this pipeline could have, because every later search would return a match that is
 * confidently wrong.
 */
export function readEmbedResponse(raw: unknown, expectedCount: number): EmbedSuccess | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.ok !== true) return null;

  const results = record.results;
  if (!Array.isArray(results) || results.length !== expectedCount) return null;

  const parsed: EmbedResult[] = [];
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    const embedding = readEmbedding(item.embedding);
    if (!embedding) return null;
    parsed.push({ label: typeof item.label === 'string' ? item.label : '', embedding });
  }

  const model = typeof record.model === 'string' ? record.model : '';
  const version = typeof record.version === 'number' ? record.version : Number.NaN;
  const dimension = typeof record.dimension === 'number' ? record.dimension : Number.NaN;
  if (!model || !Number.isFinite(version) || !Number.isFinite(dimension)) return null;

  return { ok: true, model, version, dimension, results: parsed };
}

/** Reads a failure body, or classifies one from the status when the body says nothing useful. */
export function readEmbedFailure(status: number, body: unknown): EmbedFailure {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (
      record.ok === false &&
      typeof record.code === 'string' &&
      typeof record.message === 'string'
    ) {
      return {
        ok: false,
        code: record.code as EmbedErrorCode,
        message: record.message,
        retryAfterSeconds:
          typeof record.retryAfterSeconds === 'number' ? record.retryAfterSeconds : undefined,
      };
    }
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: 'unauthorized',
      message: 'Your session has expired. Sign in again, then retry the indexing.',
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: 'rate_limited',
      message: 'The embedding service is rate-limiting right now. Indexing will pause and resume.',
    };
  }
  if (status === 404) {
    return {
      ok: false,
      code: 'unconfigured',
      message:
        'The embedding endpoint is not deployed on this host. Local `npm run dev` does not serve ' +
        'serverless functions, so indexing only works on a deployment or under `vercel dev`.',
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      code: 'server',
      message: `The embedding service failed (HTTP ${status}). Nothing was indexed for that picture.`,
    };
  }
  return {
    ok: false,
    code: 'bad_request',
    message: `The embedding request was refused (HTTP ${status}).`,
  };
}

/**
 * The HTTP status a failure behaves like, so the retry rules have one vocabulary.
 *
 * `isRetryableIndexFailure` reads a status and a message, and the network case is status 0.
 * Collapsing the two here means the indexing runner never has to translate a code of its own into a
 * status: a failure that never reached the server and one that was refused both arrive as statuses.
 */
export function embeddingFailureStatus(failure: EmbedFailure): number {
  switch (failure.code) {
    case 'network':
      return 0;
    case 'unauthorized':
      return 401;
    case 'rate_limited':
      return 429;
    case 'bad_request':
      return 400;
    case 'bad_key':
      return 403;
    case 'bad_response':
      // A well-formed request that came back unusable is worth one more try, in case the provider
      // returned a truncated body.
      return 502;
    case 'unconfigured':
      return 404;
    case 'server':
      return 500;
    default:
      return 500;
  }
}

/** The configuration this build stores, echoed into every success so a mismatch is catchable. */
export function expectedEmbeddingConfig() {
  return {
    model: MEMORY_EMBEDDING_MODEL,
    version: MEMORY_EMBEDDING_VERSION,
    dimension: MEMORY_EMBEDDING_DIMENSION,
  };
}
