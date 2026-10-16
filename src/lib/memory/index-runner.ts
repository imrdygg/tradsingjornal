/**
 * The indexing runner: walking a library of screenshots and giving each one an embedding.
 *
 * This is where a long, paid, rate-limited operation is made safe to interrupt. A backfill over
 * three hundred pictures is three hundred API calls against a quota that will push back, and the
 * trader is watching a progress bar while it happens. So the runner is built around three
 * properties rather than around throughput:
 *
 *   1. **Nothing is claimed that did not happen.** A picture is only ever marked `completed` after
 *      a vector has been obtained AND stored. A failure is recorded with the provider's own words
 *      and its own state, and the run's final report counts failures instead of rounding them into
 *      a pass. `memoryIndexFailureSummary` exists so a run that indexed 260 of 300 cannot be
 *      described as finished.
 *   2. **Consent is checked here, not only at the button.** `consent` is a required field of the
 *      options and the run refuses outright when it is not explicitly `true`. A caller that
 *      forgets to check cannot accidentally start sending the trader's private charts to a model;
 *      the worst outcome is a refusal message. Marking pictures `skipped` is the only thing that
 *      happens without consent, and only the caller's own explicit call does that.
 *   3. **Interruption is a state, not a crash.** A cancelled run leaves every unfinished picture
 *      exactly where it was — still pending — so re-running resumes rather than restarting, and
 *      the pictures finished before the interruption stay finished.
 *
 * Everything external is injected: the port is the database, `embed` is the network, `sleep` is
 * time. That is what lets the whole runner be tested against a stub that fails on demand, which is
 * the only way to be sure about how it behaves when the provider says 429 halfway through.
 */

import type { MemoryImage } from '../../types';
import { embeddingFailureStatus, type EmbedOutcome } from './embedding-wire';
import { MEMORY_INDEX_CONCURRENCY, isUsableEmbedding } from './embeddings';
import type { MemoryEmbeddingConfig } from './embeddings';
import { backoffDelayMs, isRetryableIndexFailure, MEMORY_MAX_INDEX_ATTEMPTS } from './indexing';

/**
 * The database half of the runner, as the runner needs it.
 *
 * A narrow interface rather than the concrete module on purpose: it is the seam the tests replace,
 * and it is what stops this file growing a dependency on Supabase. Every method may throw — a
 * database that is unreachable is not a per-picture failure and must not be swallowed into one.
 */
export interface MemoryIndexPort {
  /**
   * The pictures waiting to be embedded, oldest first.
   *
   * Called repeatedly as the run works through the library, rather than once for the whole thing,
   * so a run started on a library that is still being added to keeps finding work, and so a
   * resumed run does not have to hold every backlogged picture in memory.
   */
  listPending(limit: number): Promise<MemoryImage[]>;
  /** Records that this picture is being worked on now. */
  markProcessing(imageId: string): Promise<void>;
  /** Stores the vector and the stamp that says what produced it. Both, or neither. */
  saveEmbedding(imageId: string, embedding: number[], stamp: MemoryEmbeddingConfig): Promise<void>;
  /** Records a permanent failure, with the message the trader will act on. */
  markFailed(imageId: string, error: string): Promise<void>;
  /** Records a picture that will not be indexed, and why. Never used for a failure. */
  markSkipped(imageId: string, reason: string): Promise<void>;
}

/** Why one picture was not indexed, as the run saw it. */
export interface MemoryIndexItemFailure {
  imageId: string;
  /** The provider's or the database's own message, kept verbatim. */
  message: string;
  /** Whether a later run could plausibly succeed at this picture. */
  retryable: boolean;
}

export interface MemoryIndexRunResult {
  /** False when the run never started, which happens only without consent. */
  ran: boolean;
  /** Set when `ran` is false. A refusal is reported, never mapped onto 'skipped'. */
  refusal?: string;
  /** Pictures that now have a stored vector. */
  indexed: number;
  /** Pictures the provider permanently refused. */
  failed: MemoryIndexItemFailure[];
  /** Pictures that were considered and deliberately left alone. */
  skipped: number;
  /** True when the run stopped early because it was cancelled or hit its item ceiling. */
  stoppedEarly: boolean;
  /** True when cancellation was requested. Distinguished from a completed run. */
  cancelled: boolean;
  /** The count the run was asked to stop at, when it stopped there rather than at the end. */
  ceilingReached: boolean;
  /** One entry per picture, so a report can name what broke rather than only how much. */
  failures: MemoryIndexItemFailure[];
  /** How many embedding attempts were made in total, including retries. */
  attempts: number;
}

export interface MemoryIndexRunOptions {
  /**
   * The trader's consent for cloud AI image processing. Required, and only `true` runs.
   *
   * Not optional and not defaulted. Consent is the trader's decision about their own material, and
   * a default would be a decision made on their behalf — the one thing this must never be.
   */
  consent: boolean;
  /** The network half: one picture in, one embedding or a failure out. */
  embed: (image: MemoryImage) => Promise<EmbedOutcome>;
  /** The most pictures to index in this run. Absent means the whole backlog. */
  maxItems?: number;
  /** How many embedding requests may be in flight. Defaults to `MEMORY_INDEX_CONCURRENCY`. */
  concurrency?: number;
  /** Cancellation. Checked before each picture, so a stop takes effect within one request. */
  signal?: AbortSignal;
  /** Progress, called after each picture settles. */
  onProgress?: (progress: MemoryIndexProgress) => void;
  /** Injected so a test can run a backoff without waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** How many pending pictures to fetch per round. */
  batchSize?: number;
}

/** A running tally, shaped for a progress display rather than for a log. */
export interface MemoryIndexProgress {
  /** Pictures settled so far, whatever the outcome. */
  settled: number;
  indexed: number;
  failed: number;
  skipped: number;
  /** The picture just handled, for a "currently indexing" line. */
  lastImageId?: string;
  /** True once cancellation has been requested. */
  cancelling: boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the library until there is nothing left, the ceiling is reached, or the trader stops it.
 *
 * The concurrency is bounded rather than unbounded on purpose: the failure this avoids is not
 * slowness, it is a burst that earns a rate limit and loses the run. Two in flight keeps the work
 * moving while never looking like an attack to a provider that is metering a paid key.
 *
 * Failures never abort the run. One unreadable picture must not stop the other two hundred and
 * ninety-nine, so a settled failure is recorded and the loop continues; only a database error
 * propagates, because that means the run cannot report its own results honestly.
 */
export async function runMemoryIndex(
  port: MemoryIndexPort,
  options: MemoryIndexRunOptions
): Promise<MemoryIndexRunResult> {
  const result: MemoryIndexRunResult = {
    ran: false,
    indexed: 0,
    failed: [],
    skipped: 0,
    stoppedEarly: false,
    cancelled: false,
    ceilingReached: false,
    failures: [],
    attempts: 0,
  };

  // Consent, before anything is read: a run without it must not even enumerate the library, so
  // there is no state in which a refusal has touched a row.
  if (options.consent !== true) {
    result.refusal =
      'Indexing needs your permission to send chart screenshots to the embedding model. Turn it ' +
      'on in the memory settings, then run this again. Nothing was sent and nothing was changed.';
    return result;
  }

  result.ran = true;

  const concurrency = Math.max(1, options.concurrency ?? MEMORY_INDEX_CONCURRENCY);
  const batchSize = Math.max(1, options.batchSize ?? 20);
  const ceiling = options.maxItems === undefined ? null : Math.max(0, options.maxItems);
  const sleep = options.sleep ?? defaultSleep;
  const signal = options.signal;

  const progress: MemoryIndexProgress = {
    settled: 0,
    indexed: 0,
    failed: 0,
    skipped: 0,
    cancelling: false,
  };

  const recordFailure = (imageId: string, message: string, retryable: boolean) => {
    const failure: MemoryIndexItemFailure = { imageId, message, retryable };
    result.failed.push(failure);
    result.failures.push(failure);
    progress.failed += 1;
  };

  // A picture with no bytes anywhere cannot be sent. It is recorded as a permanent failure rather
  // than a skip, because a skip means a decision was made and this is a broken reference.
  const missingBytes = (image: MemoryImage): boolean => !image.dataUrl && !image.storagePath;

  const handleOne = async (image: MemoryImage) => {
    if (missingBytes(image)) {
      await port.markFailed(
        image.id,
        'This picture has no stored copy to index. Re-upload it, or check that its upload to ' +
          'private storage completed.'
      );
      recordFailure(image.id, 'No stored copy of the picture.', false);
      return;
    }

    await port.markProcessing(image.id);

    let lastMessage = 'The picture could not be embedded.';
    let lastRetryable = false;

    for (let attempt = 0; attempt < MEMORY_MAX_INDEX_ATTEMPTS; attempt += 1) {
      result.attempts += 1;
      // Initialised rather than declared: a variable assigned only inside try/catch is the one
      // shape TypeScript's flow analysis cannot always prove before the read below.
      let outcome: EmbedOutcome = {
        ok: false,
        code: 'network',
        message: 'The picture was not attempted.',
      };
      try {
        outcome = await options.embed(image);
      } catch (err) {
        // The injected network half is allowed to throw; the runner treats that as a retryable
        // transport failure rather than letting one exception end the whole run.
        outcome = {
          ok: false,
          code: 'network',
          message: err instanceof Error ? err.message : 'The embedding request failed.',
        };
      }

      if (outcome.ok) {
        const embedding = outcome.results[0]?.embedding;
        const stamp: MemoryEmbeddingConfig = {
          model: outcome.model,
          version: outcome.version,
          dimension: outcome.dimension,
        };

        // A successful response is still checked before it is stored. An answer of the right
        // nominal length full of nulls, or one the endpoint stamped with a configuration this
        // client does not use, would be a vector that scores against everything at random.
        if (!embedding || !isUsableEmbedding(embedding, stamp)) {
          lastMessage =
            'The embedding service returned a vector this build cannot store, so that picture ' +
            'was not indexed.';
          lastRetryable = false;
          break;
        }

        // Stored first, counted second: the count is a claim about the database, so the database
        // has to have accepted it before the number moves.
        await port.saveEmbedding(image.id, embedding, stamp);
        result.indexed += 1;
        progress.indexed += 1;
        return;
      }

      lastMessage = outcome.message;
      lastRetryable = isRetryableIndexFailure(
        embeddingFailureStatus(outcome),
        outcome.message
      );

      if (!lastRetryable || attempt + 1 >= MEMORY_MAX_INDEX_ATTEMPTS) break;
      if (signal?.aborted) break;

      await sleep(
        backoffDelayMs(attempt, {
          retryAfterSeconds: outcome.retryAfterSeconds ?? null,
        })
      );
    }

    await port.markFailed(image.id, lastMessage);
    recordFailure(image.id, lastMessage, lastRetryable);
  };

  let handled = 0;

  while (true) {
    if (signal?.aborted) {
      result.cancelled = true;
      result.stoppedEarly = true;
      progress.cancelling = true;
      break;
    }
    if (ceiling !== null && handled >= ceiling) {
      // A ceiling reached is a stop, not an ending: the backlog is untouched and the caller is
      // told which of the two happened.
      result.stoppedEarly = true;
      result.ceilingReached = true;
      break;
    }

    const remaining = ceiling === null ? batchSize : Math.min(batchSize, ceiling - handled);
    if (remaining <= 0) {
      result.stoppedEarly = true;
      result.ceilingReached = true;
      break;
    }

    const pending = await port.listPending(remaining);
    if (pending.length === 0) break;

    // Fixed-size chunks, so the concurrency bound is also the most requests in flight at once.
    for (let start = 0; start < pending.length; start += concurrency) {
      if (signal?.aborted) break;
      const chunk = pending.slice(start, start + concurrency);
      await Promise.all(
        chunk.map(async (image) => {
          await handleOne(image);
          handled += 1;
          progress.settled += 1;
          progress.lastImageId = image.id;
          // Progress is reported after the picture has settled, never before, so a bar cannot
          // show work as done that is still in flight.
          options.onProgress?.({ ...progress });
        })
      );
    }

    // A picture that failed permanently is no longer returned by `listPending` (its status is
    // `failed`, not `pending`), so an empty round is the only termination condition needed; the
    // batch is fetched fresh each time precisely because the pending set shrinks as we go.
    if (pending.length < remaining) break;
  }

  return result;
}

/**
 * One line describing how a run ended, for the trader rather than for a log.
 *
 * Deliberately refuses to describe a run with failures as finished. The phrasing "Indexed 297 of
 * 300 pictures; 3 could not be indexed" is the honest sentence, and the alternative — a green
 * "done" over a library that is quietly missing three charts — is the failure mode this whole
 * module is arranged to prevent.
 */
export function memoryIndexRunSummary(result: MemoryIndexRunResult): string {
  if (!result.ran) return result.refusal ?? 'Indexing did not run.';

  const total = result.indexed + result.failures.length;
  if (total === 0) {
    return 'There was nothing to index. Every picture in the library already has a vector.';
  }

  const parts = [`Indexed ${result.indexed} of ${total} pictures`];
  if (result.failures.length > 0) parts.push(`${result.failures.length} could not be indexed`);
  if (result.skipped > 0) parts.push(`${result.skipped} were left alone`);
  if (result.cancelled) parts.push('and it was stopped before it finished');

  const first = result.failures[0];
  const head = `${parts.join('; ')}.`;
  return first
    ? `${head} The first failure was: ${first.message}`
    : `${head} Run it again to finish the rest.`;
}
