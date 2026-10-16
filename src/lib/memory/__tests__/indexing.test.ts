import { describe, expect, it } from 'vitest';
import {
  MEMORY_INDEX_BASE_DELAY_MS,
  MEMORY_INDEX_BATCH_SIZE,
  MEMORY_INDEX_MAX_DELAY_MS,
  MEMORY_MAX_INDEX_ATTEMPTS,
  MEMORY_MAX_INDEX_BATCH_SIZE,
  backoffDelayMs,
  clampIndexBatchSize,
  indexJobView,
  isRetryableIndexFailure,
  nextCursor,
  planIndexBatches,
  shouldRetryAttempt,
} from '../indexing';

/**
 * The scheduling rules a backfill depends on.
 *
 * None of this touches the network, so the behaviour that decides whether a long paid job rides
 * out a rate limit or burns through its quota is pinned down here rather than observed later
 * from a progress bar that stopped moving.
 */

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `img-${i}`);

describe('clampIndexBatchSize', () => {
  it('keeps a sensible value as it is', () => {
    expect(clampIndexBatchSize(12)).toBe(12);
  });

  it('never returns a batch of nothing, which would become an empty request', () => {
    expect(clampIndexBatchSize(0)).toBe(1);
    expect(clampIndexBatchSize(-5)).toBe(1);
  });

  it('caps the batch so one failure cannot cost too much progress', () => {
    expect(clampIndexBatchSize(1000)).toBe(MEMORY_MAX_INDEX_BATCH_SIZE);
  });

  it('falls back to the default rather than trusting a value that is not a number', () => {
    expect(clampIndexBatchSize(Number.NaN)).toBe(MEMORY_INDEX_BATCH_SIZE);
    expect(clampIndexBatchSize(Number.POSITIVE_INFINITY)).toBe(MEMORY_INDEX_BATCH_SIZE);
  });

  it('rounds to a whole number of pictures', () => {
    expect(clampIndexBatchSize(3.7)).toBe(4);
  });
});

describe('planIndexBatches', () => {
  it('partitions the work: nothing dropped, nothing duplicated, order kept', () => {
    const input = ids(20);
    const batches = planIndexBatches(input, 8);
    expect(batches.map((batch) => batch.length)).toEqual([8, 8, 4]);
    expect(batches.flat()).toEqual(input);
  });

  it('produces no batches for an empty library', () => {
    expect(planIndexBatches([])).toEqual([]);
  });

  it('uses the default batch size when none is asked for', () => {
    expect(planIndexBatches(ids(MEMORY_INDEX_BATCH_SIZE + 1)).map((b) => b.length)).toEqual([
      MEMORY_INDEX_BATCH_SIZE,
      1,
    ]);
  });

  it('honours the clamp rather than making one request per picture', () => {
    expect(planIndexBatches(ids(10), 0).every((batch) => batch.length === 1)).toBe(true);
    expect(planIndexBatches(ids(50), 1000).map((b) => b.length)).toEqual([
      MEMORY_MAX_INDEX_BATCH_SIZE,
      10,
    ]);
  });

  it('is a partition for every batch size it accepts', () => {
    const input = ids(23);
    for (const size of [1, 2, 7, 8, 40]) {
      const batches = planIndexBatches(input, size);
      expect(batches.flat()).toEqual(input);
      for (const batch of batches) {
        expect(batch.length).toBeGreaterThan(0);
        expect(batch.length).toBeLessThanOrEqual(size);
      }
    }
  });
});

describe('backoffDelayMs', () => {
  it('doubles from the base delay', () => {
    expect(backoffDelayMs(0)).toBe(MEMORY_INDEX_BASE_DELAY_MS);
    expect(backoffDelayMs(1)).toBe(1400);
    expect(backoffDelayMs(2)).toBe(2800);
    expect(backoffDelayMs(3)).toBe(5600);
  });

  it('caps the wait instead of doubling towards an hour', () => {
    expect(backoffDelayMs(6)).toBe(MEMORY_INDEX_MAX_DELAY_MS);
    expect(backoffDelayMs(50)).toBe(MEMORY_INDEX_MAX_DELAY_MS);
  });

  it('obeys a Retry-After instruction over its own guess', () => {
    // The provider asked for 5s; the exponential value at this attempt is far larger.
    expect(backoffDelayMs(5, { retryAfterSeconds: 5 })).toBe(5000);
    expect(backoffDelayMs(0, { retryAfterSeconds: 5 })).toBe(5000);
  });

  it('still bounds a Retry-After, so one instruction cannot park the run', () => {
    expect(backoffDelayMs(0, { retryAfterSeconds: 100_000 })).toBe(MEMORY_INDEX_MAX_DELAY_MS);
    expect(backoffDelayMs(0, { retryAfterSeconds: 600, maxMs: 2000 })).toBe(2000);
  });

  it('ignores a Retry-After that cannot be obeyed', () => {
    // Zero is the dangerous one: taken literally it would mean retry immediately, which is the
    // behaviour the backoff exists to stop.
    expect(backoffDelayMs(0, { retryAfterSeconds: 0 })).toBe(MEMORY_INDEX_BASE_DELAY_MS);
    expect(backoffDelayMs(0, { retryAfterSeconds: -1 })).toBe(MEMORY_INDEX_BASE_DELAY_MS);
    expect(backoffDelayMs(0, { retryAfterSeconds: Number.NaN })).toBe(MEMORY_INDEX_BASE_DELAY_MS);
    expect(backoffDelayMs(0, { retryAfterSeconds: Number.POSITIVE_INFINITY })).toBe(
      MEMORY_INDEX_BASE_DELAY_MS
    );
  });

  it('is deterministic with jitter off, which is the default', () => {
    expect(backoffDelayMs(3, {})).toBe(backoffDelayMs(3, { jitter: false }));
    expect(backoffDelayMs(3, { jitter: false })).toBe(5600);
  });

  it('spreads a jittered wait within twenty percent and never below zero', () => {
    for (let i = 0; i < 200; i += 1) {
      const delay = backoffDelayMs(2, { jitter: true });
      expect(delay).toBeGreaterThanOrEqual(2800 * 0.8);
      expect(delay).toBeLessThanOrEqual(2800 * 1.2);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps a jittered wait inside the cap as well', () => {
    for (let i = 0; i < 100; i += 1) {
      const delay = backoffDelayMs(30, { jitter: true });
      expect(delay).toBeGreaterThanOrEqual(MEMORY_INDEX_MAX_DELAY_MS * 0.8);
      expect(delay).toBeLessThanOrEqual(MEMORY_INDEX_MAX_DELAY_MS * 1.2);
    }
  });

  it('always returns a non-negative whole number of milliseconds', () => {
    for (const attempt of [-3, 0, 1.9, 7, 100, Number.NaN]) {
      for (const jitter of [false, true]) {
        const delay = backoffDelayMs(attempt, { jitter });
        expect(Number.isInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('treats a negative or fractional attempt as the attempt it rounds to', () => {
    expect(backoffDelayMs(-3)).toBe(MEMORY_INDEX_BASE_DELAY_MS);
    expect(backoffDelayMs(2.9)).toBe(2800);
  });
});

describe('isRetryableIndexFailure', () => {
  it('retries a network failure, which is the one a backfill meets most', () => {
    expect(isRetryableIndexFailure(0, '')).toBe(true);
  });

  it.each([429, 500, 502, 503, 504, 599])('retries status %i', (status) => {
    expect(isRetryableIndexFailure(status, '')).toBe(true);
  });

  it.each([400, 401, 403, 404, 413, 422])('does not retry status %i', (status) => {
    expect(isRetryableIndexFailure(status, '')).toBe(false);
  });

  it('retries a transient condition even when it arrives with a client-side status', () => {
    expect(isRetryableIndexFailure(400, 'Rate limit exceeded for this project')).toBe(true);
    expect(isRetryableIndexFailure(403, 'Free-tier quota exhausted')).toBe(true);
    expect(isRetryableIndexFailure(200, 'model overloaded, try later')).toBe(true);
  });

  it('reports a permanent failure rather than pursuing it', () => {
    expect(isRetryableIndexFailure(400, 'Invalid JSON payload received')).toBe(false);
    expect(isRetryableIndexFailure(401, 'API key not valid')).toBe(false);
    expect(isRetryableIndexFailure(404, 'model not found')).toBe(false);
    expect(isRetryableIndexFailure(200, '')).toBe(false);
  });

  it('survives a missing or unreadable message', () => {
    expect(isRetryableIndexFailure(500, undefined as unknown as string)).toBe(true);
    expect(isRetryableIndexFailure(400, undefined as unknown as string)).toBe(false);
  });
});

describe('shouldRetryAttempt', () => {
  it('allows the attempts the budget holds and then stops', () => {
    expect(MEMORY_MAX_INDEX_ATTEMPTS).toBe(3);
    expect(shouldRetryAttempt(0)).toBe(true);
    expect(shouldRetryAttempt(1)).toBe(true);
    expect(shouldRetryAttempt(2)).toBe(false);
    expect(shouldRetryAttempt(99)).toBe(false);
  });

  it('does not retry on an unreadable attempt count', () => {
    expect(shouldRetryAttempt(Number.NaN)).toBe(false);
  });
});

describe('nextCursor', () => {
  it('resumes after the last id handled', () => {
    expect(nextCursor(['a', 'b', 'c'])).toBe('c');
  });

  it('has no cursor for a run that has handled nothing', () => {
    expect(nextCursor([])).toBeUndefined();
  });
});

describe('indexJobView', () => {
  it('reports zero rather than NaN for a job with nothing in it', () => {
    const view = indexJobView({
      status: 'pending',
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
      skippedItems: 0,
    });
    expect(view.percent).toBe(0);
    expect(Number.isNaN(view.percent)).toBe(false);
    expect(view.remaining).toBe(0);
    expect(view.label).toBe('Nothing to index yet');
    expect(view.running).toBe(true);
  });

  it('reads a run in progress as a fraction of the whole', () => {
    const view = indexJobView({
      status: 'processing',
      totalItems: 10,
      processedItems: 5,
      failedItems: 0,
      skippedItems: 0,
    });
    expect(view.percent).toBe(50);
    expect(view.remaining).toBe(5);
    expect(view.running).toBe(true);
    expect(view.label).toContain('5 of 10');
  });

  it('never reports more than everything, or a negative remainder', () => {
    const view = indexJobView({
      status: 'processing',
      totalItems: 10,
      processedItems: 14,
      failedItems: 0,
      skippedItems: 0,
    });
    expect(view.percent).toBe(100);
    expect(view.remaining).toBe(0);
  });

  it('stops calling a finished run running', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'skipped'] as const) {
      expect(
        indexJobView({
          status,
          totalItems: 4,
          processedItems: 4,
          failedItems: 0,
          skippedItems: 0,
        }).running
      ).toBe(false);
    }
  });

  it('does not describe a run with failures as a clean pass', () => {
    const view = indexJobView({
      status: 'completed',
      totalItems: 10,
      processedItems: 10,
      failedItems: 3,
      skippedItems: 0,
    });
    expect(view.label).toContain('Indexed 10 of 10');
    expect(view.label).toContain('3 failed');
  });

  it('says what happened to a run that stopped early', () => {
    expect(
      indexJobView({
        status: 'failed',
        totalItems: 20,
        processedItems: 6,
        failedItems: 2,
        skippedItems: 0,
      }).label
    ).toBe('Stopped at 6 of 20. 2 failed');

    expect(
      indexJobView({
        status: 'cancelled',
        totalItems: 20,
        processedItems: 6,
        failedItems: 0,
        skippedItems: 0,
      }).label
    ).toBe('Cancelled at 6 of 20');
  });

  it('says when nothing could be sent rather than reporting progress', () => {
    const view = indexJobView({
      status: 'skipped',
      totalItems: 5,
      processedItems: 0,
      failedItems: 0,
      skippedItems: 5,
    });
    expect(view.label).toBe('Skipped 5 of 5 pictures');
  });

  it('clamps a nonsensical row instead of rendering it', () => {
    const view = indexJobView({
      status: 'processing',
      totalItems: Number.NaN,
      processedItems: Number.NaN,
      failedItems: -4,
      skippedItems: Number.NaN,
    });
    expect(view.percent).toBe(0);
    expect(view.remaining).toBe(0);
  });
});
