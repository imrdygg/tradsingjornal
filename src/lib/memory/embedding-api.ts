/**
 * The browser's half of the embedding contract.
 *
 * This module never sees an API key and never builds a model request: it posts a compressed picture
 * to the serverless endpoint and gets numbers back, validating them against the contract in
 * `embedding-wire.ts`. That split is the same one the coach lives under, and it is what keeps the
 * key off the client.
 *
 * The wire contract itself lives in `embedding-wire.ts` rather than here, because importing this
 * file pulls in the Supabase client and the serverless handler must stay dependency-free. Nothing
 * that runs on the server may import from this module.
 */

import { supabase } from '../supabase';
import {
  readEmbedFailure,
  readEmbedResponse,
  type EmbedImageInput,
  type EmbedOutcome,
  type EmbedRequest,
} from './embedding-wire';
import {
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from './embeddings';

export type {
  EmbedErrorCode,
  EmbedFailure,
  EmbedImageInput,
  EmbedOutcome,
  EmbedRequest,
  EmbedResult,
  EmbedSuccess,
} from './embedding-wire';

/** Where the embedding endpoint lives. Matches the file the bundler writes into `api/`. */
export const MEMORY_ENDPOINT = '/api/memory';

/** How long to wait before giving up on an embedding request. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Embeds the pictures handed to it.
 *
 * Ordinary calls carry ONE picture, because the model aggregates several inputs into a single
 * embedding rather than returning one per input — a batch would come back as one vector for a group
 * of charts, which is not an embedding of any of them. The indexing runner parallelises across calls
 * instead.
 *
 * A local-only build with no Supabase still attempts the request: there is no session token to send,
 * and the endpoint's own health check is what decides whether it can serve an anonymous caller. That
 * keeps `vercel dev` usable without inventing a fake account.
 */
export async function requestChartEmbeddings(
  images: readonly EmbedImageInput[]
): Promise<EmbedOutcome> {
  if (images.length === 0) {
    return { ok: false, code: 'bad_request', message: 'Nothing was sent to embed.' };
  }

  let token: string | null = null;
  if (supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      token = session?.access_token ?? null;
    } catch {
      // No readable session: the request still goes, and the endpoint decides what to do with it.
      token = null;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(MEMORY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Copied into a mutable array because the wire type describes what is serialised, and a
      // frozen or readonly caller array would otherwise be rejected by the request shape.
      body: JSON.stringify({ images: [...images] } satisfies EmbedRequest),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      code: 'network',
      message: aborted
        ? 'The embedding request timed out. Nothing was indexed for that picture.'
        : 'The embedding service could not be reached. Nothing was indexed for that picture.',
    };
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) return readEmbedFailure(response.status, body);

  const parsed = readEmbedResponse(body, images.length);
  if (!parsed) {
    return {
      ok: false,
      code: 'bad_response',
      message:
        'The embedding service answered with something unusable, so nothing was indexed. This is ' +
        'usually a deployed endpoint whose model changed shape.',
    };
  }

  // The configuration the server reports must be the one this build stores. A vector kept under a
  // stamp it does not belong to would be compared against the wrong generation later, and the
  // comparison would produce a plausible number rather than an error.
  if (
    parsed.model !== MEMORY_EMBEDDING_MODEL ||
    parsed.version !== MEMORY_EMBEDDING_VERSION ||
    parsed.dimension !== MEMORY_EMBEDDING_DIMENSION
  ) {
    return {
      ok: false,
      code: 'bad_response',
      message:
        `The embedding service is using ${parsed.model} v${parsed.version} at ` +
        `${parsed.dimension} dimensions, but this build stores ${MEMORY_EMBEDDING_MODEL} ` +
        `v${MEMORY_EMBEDDING_VERSION} at ${MEMORY_EMBEDDING_DIMENSION}. Nothing was indexed, ` +
        'because vectors from two configurations cannot be compared.',
    };
  }

  return parsed;
}
