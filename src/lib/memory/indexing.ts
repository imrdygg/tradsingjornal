/**
 * The arithmetic of a resumable indexing backfill.
 *
 * Indexing a library of chart screenshots is not a request. It is a long job that spends one
 * rate-limited, paid API call per picture, over a collection that may be several hundred strong,
 * on a connection that will drop somewhere in the middle of it. Three things follow from that,
 * and this module is where all three are decided so they can be reasoned about without a network:
 *
 *   1. **It has to be planned in batches.** Sending every picture at once earns a rate-limit
 *      response and loses the run; sending one at a time and awaiting each is needlessly slow.
 *      A batch is also the unit a resumed run can skip past, so the plan must be a partition of
 *      the work: every picture in exactly one batch, none lost, none repeated.
 *   2. **It has to back off, and it has to obey the server.** A retry that fires immediately is
 *      how a rate limit becomes a ban. The delay doubles per attempt and is capped, and when the
 *      provider states a `Retry-After` that instruction wins over our own guess, because the
 *      server knows when it will be ready and we do not.
 *   3. **It has to stop.** Some failures are permanent: a bad key, a picture the provider will
 *      never accept, a request that is malformed. Retrying those forever burns quota and hides a
 *      real error behind a spinner, so an unretryable failure is reported on the first try.
 *
 * Nothing here performs I/O, reads the clock, or imports the Supabase client. Every function is a
 * pure function of its arguments, so the retry behaviour a backfill depends on is verified by
 * unit tests rather than by watching a long job and hoping.
 */

import type { MemoryIndexJobStatus } from '../../types';

/** How many pictures one request asks the provider to embed. */
export const MEMORY_INDEX_BATCH_SIZE = 8;

/**
 * The largest batch a run may ask for.
 *
 * Well above the default, and bounded anyway: a batch is one request whose failure costs the
 * whole batch's progress, so making it enormous trades throughput for a larger blast radius.
 */
export const MEMORY_MAX_INDEX_BATCH_SIZE = 40;

/**
 * How many times one batch is attempted before it is given up on.
 *
 * Three, matching the model chain the coach already retries down: enough to ride out an
 * overloaded provider, few enough that a genuinely broken picture is reported in seconds rather
 * than pursued for the length of the backfill.
 */
export const MEMORY_MAX_INDEX_ATTEMPTS = 3;

/** The first retry delay, in milliseconds. Doubles each attempt from here. */
export const MEMORY_INDEX_BASE_DELAY_MS = 700;

/**
 * The longest a retry may wait.
 *
 * A hard ceiling rather than a courtesy. Without it, doubling reaches hours within a dozen
 * attempts, and a run that is merely waiting becomes indistinguishable from one that has hung -
 * including to the trader, who is watching a progress bar.
 */
export const MEMORY_INDEX_MAX_DELAY_MS = 30_000;

/** Statuses the provider uses to say "try again", as opposed to "this will never work". */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Messages that mean "try again" whatever the status says.
 *
 * A provider that rates-limits on a 200-level envelope, or reports an exhausted free-tier quota
 * as a 400, is common enough that the status alone cannot be trusted. This is deliberately
 * narrow: it matches the words that describe a transient condition, and nothing that describes a
 * broken request.
 */
const RETRYABLE_MESSAGE = /rate limit|quota|overloaded|timeout|temporar/i;

/** Snaps a requested batch size into the supported range. */
export function clampIndexBatchSize(value: number): number {
  if (!Number.isFinite(value)) return MEMORY_INDEX_BATCH_SIZE;
  return Math.min(MEMORY_MAX_INDEX_BATCH_SIZE, Math.max(1, Math.round(value)));
}

/**
 * Splits the work into batches.
 *
 * The contract that matters is that this is a partition: concatenating the batches returns the
 * input exactly, in order. A run that dropped an id would report a picture as unindexed forever,
 * and a run that repeated one would spend a second paid call on it - so both are properties of
 * this function rather than things to notice later from a count that looks slightly off.
 *
 * An empty list produces no batches rather than one empty batch, because a batch with nothing in
 * it would become a request with nothing to ask.
 */
export function planIndexBatches(
  ids: readonly string[],
  batchSize: number = MEMORY_INDEX_BATCH_SIZE
): string[][] {
  const size = clampIndexBatchSize(batchSize);
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    batches.push(ids.slice(start, start + size));
  }
  return batches;
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** What a `Retry-After` header said, in seconds. Omitted or unusable falls back to exponential. */
  retryAfterSeconds?: number | null;
  /**
   * Spread the delay by up to twenty percent either way.
   *
   * Off by default so that the delay for a given attempt is a single known number that a test can
   * assert. It exists because several runs that hit the same rate limit at the same moment would
   * otherwise retry in lockstep and collide again.
   */
  jitter?: boolean;
}

/**
 * How long to wait before attempt number `attempt`, which is zero-based.
 *
 * The exponential value is `baseMs * 2 ** attempt`, capped at `maxMs`. A usable
 * `retryAfterSeconds` replaces that value rather than being added to it, because the provider
 * asked for a specific wait and a longer one is not more correct - but it is still capped, so a
 * provider asking for an hour cannot park the run for an hour.
 *
 * An unusable `retryAfterSeconds` (zero, negative, NaN, Infinity) is ignored rather than trusted.
 * Zero is the interesting one: taken literally it would mean "retry immediately", which is the
 * behaviour the backoff exists to prevent, so it falls back to the exponential value.
 *
 * The result is always a non-negative integer of milliseconds.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = Number.isFinite(options.baseMs) ? Math.max(0, options.baseMs as number) : MEMORY_INDEX_BASE_DELAY_MS;
  const maxMs = Number.isFinite(options.maxMs) ? Math.max(0, options.maxMs as number) : MEMORY_INDEX_MAX_DELAY_MS;
  const step = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;

  // Capped before rounding: `baseMs * 2 ** step` overflows to Infinity for a large enough step,
  // and `Math.min` is what turns that back into the ceiling instead of Infinity milliseconds.
  let delay = Math.min(maxMs, baseMs * 2 ** step);

  const retryAfter = options.retryAfterSeconds;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
    delay = Math.min(maxMs, retryAfter * 1000);
  }

  if (options.jitter) {
    const span = delay * 0.2;
    delay = delay + (Math.random() * 2 - 1) * span;
  }

  return Math.max(0, Math.round(delay));
}

/**
 * Whether a failed attempt is worth trying again.
 *
 * Status `0` is the network case: no response arrived at all, which is the definition of a
 * temporary failure and the one a backfill will meet most often.
 *
 * Everything not named here is treated as permanent. That is the deliberate direction to fail in:
 * an unrecognised failure that turns out to be transient costs one reported picture the trader
 * can re-queue, while an unrecognised failure that is actually permanent costs the whole run,
 * repeatedly, against a quota.
 */
export function isRetryableIndexFailure(status: number, message: string): boolean {
  // No response at all.
  if (status === 0) return true;

  if (RETRYABLE_STATUSES.has(status)) return true;
  // Every server-side status is retryable, named ones and unnamed ones alike.
  if (status >= 500) return true;

  // Checked after the statuses so that a named transient status is caught even with a message
  // that says nothing useful, and checked at all so that a transient condition reported with a
  // client-side status is still retried.
  if (RETRYABLE_MESSAGE.test(message ?? '')) return true;

  return false;
}

/**
 * Whether another attempt is allowed, given the attempt that just failed (zero-based).
 *
 * Separate from `isRetryableIndexFailure` because the two are different questions: one is about
 * the failure, the other about how much of the run's patience has been spent. Keeping them apart
 * is what lets a permanent failure be reported immediately while a transient one gets its full
 * allowance.
 */
export function shouldRetryAttempt(attempt: number): boolean {
  if (!Number.isFinite(attempt)) return false;
  return Math.max(0, Math.floor(attempt)) + 1 < MEMORY_MAX_INDEX_ATTEMPTS;
}

/**
 * Where a run that stopped should pick up from.
 *
 * The last id handled, so a resumed run continues past it rather than starting over. Undefined
 * for a run that has handled nothing, which is the correct state to resume from the beginning.
 */
export function nextCursor(processedIds: readonly string[]): string | undefined {
  if (!processedIds || processedIds.length === 0) return undefined;
  return processedIds[processedIds.length - 1];
}

/** "1 picture" against "N pictures", so a label never reads "1 pictures". */
function pictureWord(count: number): string {
  return count === 1 ? 'picture' : 'pictures';
}

export interface IndexJobView {
  percent: number;
  remaining: number;
  /** A short factual sentence for the UI. */
  label: string;
  /** True while the job is still going. */
  running: boolean;
}

/**
 * Reads a job row as something the trader can look at.
 *
 * Two details are load-bearing. The percentage is zero rather than `NaN` for a job with nothing
 * in it, because `0 / 0` in a progress bar renders as "NaN%" and that is a bug the trader sees.
 * And the failure count is stated whenever there is one, in every state: a run that reported
 * "Indexed 40 of 40" while three pictures failed would be describing a clean pass over work that
 * is not done, which is exactly the misreporting a progress label must not do.
 */
export function indexJobView(job: {
  status: MemoryIndexJobStatus;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
}): IndexJobView {
  const whole = (value: number): number => Math.max(0, Math.floor(value) || 0);

  const total = whole(job.totalItems);
  const processed = whole(job.processedItems);
  const failed = whole(job.failedItems);
  const skipped = whole(job.skippedItems);

  const percent = total === 0 ? 0 : Math.min(100, Math.round((processed / total) * 100));
  const remaining = Math.max(0, total - processed);
  const running = job.status === 'pending' || job.status === 'processing';

  let label: string;
  if (total === 0) {
    label = 'Nothing to index yet';
  } else {
    switch (job.status) {
      case 'pending':
        label = `Waiting to start on ${total} ${pictureWord(total)}`;
        break;
      case 'processing':
        label = `Indexing ${processed} of ${total}`;
        break;
      case 'skipped':
        label = `Skipped ${skipped} of ${total} ${pictureWord(total)}`;
        break;
      case 'failed':
        label = `Stopped at ${processed} of ${total}`;
        break;
      case 'cancelled':
        label = `Cancelled at ${processed} of ${total}`;
        break;
      case 'completed':
        label = `Indexed ${processed} of ${total}`;
        break;
      default:
        label = `Indexed ${processed} of ${total}`;
    }
  }

  if (failed > 0) label += `. ${failed} failed`;

  return { percent, remaining, label, running };
}
