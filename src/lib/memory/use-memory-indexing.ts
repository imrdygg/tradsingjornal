import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MemoryImage, MemoryIndexJob, TradingObservation } from '../../types';
import { MAX_COACH_IMAGE_DATA_CHARS } from '../ai/coach-images';
import { readBlobAsDataUrl } from '../utils/image-utils';
import { MEMORY_BACKFILL_PAGE_SIZE, planLibraryBackfill, type MemoryBackfillPlan } from './backfill';
import {
  createIndexJob,
  createMemoryIndexPort,
  latestIndexJob,
  updateIndexJob,
  upsertObservations,
} from './db';
import { requestChartEmbeddings } from './embedding-api';
import type { EmbedOutcome } from './embedding-wire';
import {
  memoryIndexRunSummary,
  runMemoryIndex,
  type MemoryIndexProgress,
  type MemoryIndexRunResult,
} from './index-runner';
import {
  createMemoryImageUrl,
  migrateObservationImages,
  uploadMemoryImage,
  type MemoryMigrationCounts,
} from './storage';

/**
 * The one place that turns "a library of screenshots" into "an indexed library".
 *
 * Four things have to happen in a fixed order for a similarity search to work at all, and every one
 * of them is a thing a caller could plausibly get wrong:
 *
 *   1. **The pictures have to be somewhere reachable.** A screenshot may still be inline base64 in
 *      the journal snapshot, where no server can read it. It is uploaded to the trader's own private
 *      bucket first, and only a verified object lets its inline copy be dropped.
 *   2. **The rows have to exist before anything is indexed.** `memory_images` is what the runner's
 *      queue reads, so the observations are mirrored into the database first. Indexing a library
 *      that has no rows would report a clean, empty, entirely wrong success.
 *   3. **Consent gates all of it.** Sending a private chart to a model is the trader's decision
 *      about their own material, so it is checked here, once, before any byte leaves the browser —
 *      and a refusal is REPORTED rather than silently doing nothing, because a button that appears
 *      to work and sends nothing is worse than one that says no.
 *   4. **The run has to end in a state that matches what happened.** A job row is opened before the
 *      work and closed afterwards on every path, including the failure paths, so a run can never be
 *      left looking like it is still going.
 *
 * The hook owns no rules of its own beyond that ordering. What may be sent, what a failure means,
 * how long to wait before a retry and how a run is described are all decided by `backfill.ts`,
 * `indexing.ts` and `index-runner.ts`, and are covered by their own tests. This file is the wiring,
 * and the reason it is a hook rather than a component's effect is that two screens need it: the
 * library screen's backfill button and the search screen's "index what changed".
 */

export interface MemoryIndexingDeps {
  /** The journal's observations. Their pictures are what a backfill plans over and uploads. */
  observations: readonly TradingObservation[];
  /**
   * The trader's permission to send chart screenshots to the embedding model.
   *
   * Passed in rather than read from storage here: the consent flag lives in the journal snapshot and
   * a second reader of it is a second thing that can disagree about whether the trader agreed.
   */
  consent: boolean;
  /** False in a local-only build, where there is no table to store a vector in. */
  cloudEnabled: boolean;
  /**
   * Called after a backfill rewrites the observations it uploaded.
   *
   * The migration returns the library it would become rather than mutating it, and this hook must
   * not write the journal itself. The caller persists what this hands back, which is what stops a
   * successful upload from being forgotten on the next reload.
   */
  onObservationsMigrated?: (observations: TradingObservation[]) => void;
  /** Live progress, for a bar. Also available on the hook's own return value. */
  onProgress?: (progress: MemoryIndexProgress) => void;
}

export interface MemoryIndexing {
  /** True while a run is in flight, so a button can be disabled rather than double-fired. */
  running: boolean;
  progress: MemoryIndexProgress | null;
  result: MemoryIndexRunResult | null;
  /** `memoryIndexRunSummary(result)`, verbatim — never a re-worded or rounded-up version. */
  summary: string | null;
  /** What this hook refused to do, and why. Set when consent is missing, never a silent no-op. */
  refusal: string | null;
  /** A failure that stopped the run, as the layer that produced it described it. */
  error: string | null;
  /**
   * True when the run stopped because the provider was metering the key.
   *
   * This is a PAUSE and the copy says so: nothing is broken, nothing is lost, and running it again
   * continues from where it stopped. It is derived from the failure the provider gave back and is
   * only ever used to choose words — never to decide whether to retry, which `index-runner` and
   * `indexing.ts` own and do from status codes.
   */
  paused: boolean;
  /** What a backfill would send and what it would leave behind. Useful with consent still off. */
  /**
   * What is ready to send, and what is being left behind.
   *
   * Never null: before a run it is the live plan over the journal, and during and after one it is
   * the plan that run was measured against. A screen can therefore always state how many pictures
   * are waiting on consent — which is the one fact a trader needs BEFORE they turn consent on.
   */
  plan: MemoryBackfillPlan;
  /** What the last upload of inline pictures actually moved. */
  migration: MemoryMigrationCounts | null;
  /** The most recent job row, so a reopened screen can say what the last run did. */
  lastJob: MemoryIndexJob | null;
  /** Uploads whatever is still inline, mirrors the rows, then indexes everything pending. */
  runBackfill: () => Promise<void>;
  /** Indexes whatever is already pending. The "carry on" action after a pause or a cancel. */
  runPending: (options?: { maxItems?: number }) => Promise<void>;
  /** Stops after the picture in flight. A cancelled run is not a failed one. */
  cancel: () => void;
  /** Re-reads the last job row. */
  refreshLastJob: () => Promise<void>;
}

/**
 * The pictures as a flat list, which is the shape the planner and the database both read.
 *
 * `observationId` is stamped from the record rather than trusted off the image: an image row written
 * by an older build, or nested under an observation in a snapshot, need not carry it, and a missing
 * owner is what makes a picture unplaceable later.
 */
export function flattenMemoryImages(
  observations: readonly TradingObservation[]
): MemoryImage[] {
  const images: MemoryImage[] = [];
  for (const observation of observations) {
    for (const image of observation.images ?? []) {
      images.push({ ...image, observationId: image.observationId || observation.id });
    }
  }
  return images;
}

/**
 * The bytes of one picture, in the only form the embedding endpoint accepts.
 *
 * An inline copy is used directly. A picture that lives in the private bucket has to be fetched
 * through a short-lived signed URL and turned back into a data URL, because the endpoint takes
 * inline images and has no access to the bucket — the row deliberately stores a path, never a URL,
 * since a signed URL expires.
 *
 * Returns null rather than throwing, with the reason, so the caller can report one unreadable
 * picture without ending a run over it.
 */
async function pictureToDataUrl(image: MemoryImage): Promise<{ dataUrl: string } | { reason: string }> {
  if (image.dataUrl && image.dataUrl.startsWith('data:image/')) {
    if (image.dataUrl.length > MAX_COACH_IMAGE_DATA_CHARS) {
      return {
        reason:
          'This screenshot is larger than the embedding model accepts, so it was not indexed. ' +
          'Compress it, or attach a smaller crop of the chart.',
      };
    }
    return { dataUrl: image.dataUrl };
  }

  if (!image.storagePath) {
    return { reason: 'This picture has no stored copy to send.' };
  }

  const url = await createMemoryImageUrl(image.storagePath);
  if (!url) {
    return {
      reason: 'A readable link to that screenshot could not be made, so it was not indexed.',
    };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { reason: 'That screenshot could not be read back from private storage.' };
    }
    const dataUrl = await readBlobAsDataUrl(await response.blob());
    if (!dataUrl) {
      return { reason: 'That screenshot could not be turned into something the model accepts.' };
    }
    // Checked AFTER the round trip, because the limit is on what is sent, and a stored picture's
    // size is only knowable once its bytes are here. Reporting it now is what keeps the failure
    // message about the picture rather than about the request shape.
    if (dataUrl.length > MAX_COACH_IMAGE_DATA_CHARS) {
      return {
        reason:
          'This screenshot is larger than the embedding model accepts, so it was not indexed. ' +
          'Compress it, or attach a smaller crop of the chart.',
      };
    }
    return { dataUrl };
  } catch {
    return {
      reason: 'That screenshot could not be downloaded, so it was not indexed. It is not lost.',
    };
  }
}

/**
 * Whether a failure's own words say the provider is metering the key.
 *
 * Wording, not a status code — the status was already consumed by `isRetryableIndexFailure`, which
 * decided whether to retry. This only chooses which sentence the screen shows after the fact, so a
 * message phrased differently costs the trader a less specific sentence and never a wrong action.
 */
function looksRateLimited(message: string): boolean {
  return /rate|quota|too many|429|limit/i.test(message);
}

export function useMemoryIndexing({
  observations,
  consent,
  cloudEnabled,
  onObservationsMigrated,
  onProgress,
}: MemoryIndexingDeps): MemoryIndexing {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MemoryIndexProgress | null>(null);
  const [result, setResult] = useState<MemoryIndexRunResult | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // Set once a run computes one, so its counters stay stable while it works. The value returned is
  // `runPlan ?? planned`, and `planned` is always computed, so the exposed `plan` is never null.
  // override rather than a second source of truth that could disagree with the library on screen.
  const [runPlan, setRunPlan] = useState<MemoryBackfillPlan | null>(null);
  const [migration, setMigration] = useState<MemoryMigrationCounts | null>(null);
  const [lastJob, setLastJob] = useState<MemoryIndexJob | null>(null);

  // The cancellation handle for the run in flight. Created per run so a stop cannot be attributed
  // to a later one, and cleared in the `finally` below so a stale signal is never reused.
  const abortRef = useRef<AbortController | null>(null);
  // Every state write above is guarded by this. A backfill can outlive the screen that started it,
  // and writing to an unmounted component is a warning at best and a leak at worst.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The latest callbacks, held in refs so the memoised actions below do not have to be rebuilt on
  // every render of a screen that re-renders once per picture indexed.
  const migratedRef = useRef(onObservationsMigrated);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    migratedRef.current = onObservationsMigrated;
    progressRef.current = onProgress;
  }, [onObservationsMigrated, onProgress]);

  const images = useMemo(() => flattenMemoryImages(observations), [observations]);

  /**
   * What a backfill would send, recomputed whenever the library changes.
   *
   * Computed even when consent is off, on purpose: the interesting number at that moment is how many
   * pictures are waiting on it, and a plan that returned nothing until consent existed could not say
   * that. `skippedByReason['no-consent']` is where it shows up.
   */
  const planned = useMemo(
    () => planLibraryBackfill({ observations, images, consent, pageSize: MEMORY_BACKFILL_PAGE_SIZE }),
    [observations, images, consent]
  );

  const refuse = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setRefusal(message);
    setRunning(false);
  }, []);

  const refreshLastJob = useCallback(async () => {
    if (!cloudEnabled) return;
    try {
      const job = await latestIndexJob();
      if (mountedRef.current) setLastJob(job);
    } catch {
      // A missing job row is not worth an error banner: it means nothing has been indexed yet, which
      // the screen already says. A database that is genuinely unreachable will report itself the
      // moment the trader presses a button.
      if (mountedRef.current) setLastJob(null);
    }
  }, [cloudEnabled]);

  useEffect(() => {
    void refreshLastJob();
  }, [refreshLastJob]);

  const embedOne = useCallback(async (image: MemoryImage): Promise<EmbedOutcome> => {
    const picture = await pictureToDataUrl(image);
    if ('reason' in picture) {
      // `bad_request` is the non-retryable code: this picture will fail identically next time, and
      // retrying it three times only delays the other two hundred.
      return { ok: false, code: 'bad_request', message: picture.reason };
    }
    // One picture per request, always. The model aggregates several inputs into a SINGLE embedding,
    // so a batch would come back as one vector for a group of charts rather than one per chart. The
    // runner parallelises across calls instead, which is what `concurrency` is for.
    return requestChartEmbeddings([{ label: image.id, dataUrl: picture.dataUrl }]);
  }, []);

  /**
   * One indexing run, with the job row opened and closed around it.
   *
   * `total` is what the run was asked to cover, recorded so a job that stopped at 40 of 300 has a
   * 300 to be measured against. The row is closed on every path — completed, failed or cancelled —
   * because a row left in `processing` is a screen that claims work is happening when nothing is.
   */
  const execute = useCallback(
    async (kind: MemoryIndexJob['kind'], total: number, maxItems?: number) => {
      if (!mountedRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setRefusal(null);
      setError(null);
      setPaused(false);
      setSummary(null);
      setProgress({
        settled: 0,
        indexed: 0,
        failed: 0,
        skipped: 0,
        cancelling: false,
      });

      let jobId: string | null = null;
      const now = () => new Date().toISOString();

      try {
        const job = await createIndexJob(kind, total, now());
        jobId = job.id;
        if (mountedRef.current) setLastJob(job);

        const outcome = await runMemoryIndex(createMemoryIndexPort(), {
          // `true` literally rather than the caller's flag: both callers refuse before reaching
          // this line, so passing the variable through would only add a way for a future edit to
          // arrive here with `false` and a runner that has already read the library.
          consent: true,
          embed: embedOne,
          ...(maxItems === undefined ? {} : { maxItems }),
          signal: controller.signal,
          onProgress: (next) => {
            if (!mountedRef.current) return;
            setProgress(next);
            progressRef.current?.(next);
          },
        });

        const rateLimited = outcome.failures.some((failure) => looksRateLimited(failure.message));
        const firstFailure = outcome.failures[0];

        if (mountedRef.current) {
          setResult(outcome);
          setSummary(memoryIndexRunSummary(outcome));
          setPaused(rateLimited && !outcome.cancelled);
        }

        await updateIndexJob(
          job.id,
          {
            status: outcome.cancelled
              ? 'cancelled'
              : outcome.failures.length > 0
              ? 'failed'
              : 'completed',
            processedItems: outcome.indexed,
            failedItems: outcome.failures.length,
            skippedItems: outcome.skipped,
            // Absent and undefined are the same thing to this column, so the first failure's own
            // words are passed straight through rather than conditionally added.
            lastError: firstFailure?.message,
            finishedAt: now(),
          },
          now()
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'The indexing run could not be completed. Nothing already indexed was lost.';
        if (mountedRef.current) setError(message);
        // Best effort: if the failure WAS the database, this throws too, and there is nothing left
        // to do about it. It is not allowed to replace the real message with its own.
        if (jobId) {
          try {
            await updateIndexJob(jobId, { status: 'failed', lastError: message, finishedAt: now() }, now());
          } catch {
            /* the row cannot be reached; the error above is already the honest report */
          }
        }
      } finally {
        abortRef.current = null;
        if (mountedRef.current) setRunning(false);
      }
    },
    [embedOne]
  );

  /**
   * The first run over an existing library: upload, mirror, index.
   *
   * The upload pass is `migrateObservationImages`, which moves EVERY inline picture rather than only
   * this plan's page — the pictures need to be reachable before any of them can be indexed, and a
   * page-at-a-time move would leave most of the library unindexable while claiming to be a backfill.
   * It also verifies each object before dropping the inline copy, so an interrupted run cannot cost
   * the trader a screenshot.
   */
  const runBackfill = useCallback(async () => {
    if (running) return;

    // Consent first, before the library is read, so there is no state in which a refusal has
    // uploaded anything or rewritten a record.
    if (!consent) {
      refuse(
        'Indexing needs your permission to send chart screenshots to the embedding model, and the ' +
          'query chart counts as one. Turn it on, then run this again. Nothing was uploaded and ' +
          'nothing was sent.'
      );
      return;
    }

    if (!cloudEnabled) {
      refuse(
        'A similarity search needs the private cloud library: the vectors are stored beside your ' +
          'screenshots so a search costs one embedding rather than one per chart. Add your ' +
          'Supabase credentials to use it.'
      );
      return;
    }

    if (mountedRef.current) {
      setRunning(true);
      setRefusal(null);
      setError(null);
    }

    // Reassigned from the migration below; the journal's own copy is the fallback so a failure
    // before the move still leaves the rows to be mirrored from the record as it stands.
    let moved: TradingObservation[] = [...observations];

    try {
      const now = new Date().toISOString();
      const migrated = await migrateObservationImages(
        observations,
        (image, observation) =>
          uploadMemoryImage({
            userId: observation.userId,
            observationId: observation.id,
            imageId: image.id,
            dataUrl: image.dataUrl ?? '',
          }),
        now
      );
      moved = migrated.observations;
      if (mountedRef.current) setMigration(migrated.counts);
      // Handed back rather than persisted here: this hook does not own the journal, and a caller
      // that never writes this back would upload the same pictures again on the next run.
      migratedRef.current?.(moved);
    } catch (err) {
      // The move is the only step allowed to abandon the run before it starts, because every later
      // step assumes the rows it produces. Pictures that did move are still reported.
      if (mountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'The screenshots could not be moved into private storage, so nothing was indexed.'
        );
        setRunning(false);
      }
      return;
    }

    try {
      // Mirrored before indexing, because `memory_images` is the queue the runner reads. Without
      // this, an untouched library indexes as a clean, empty success.
      await upsertObservations(moved);
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'The library could not be recorded, so nothing was indexed. Nothing was lost.'
        );
        setRunning(false);
      }
      return;
    }

    // The plan the run is measured against: everything that was ready when the trader pressed the
    // button. The runner then works through the rows until there is nothing pending left.
    const fresh = planLibraryBackfill({
      observations: moved,
      images: flattenMemoryImages(moved),
      consent: true,
      pageSize: MEMORY_BACKFILL_PAGE_SIZE,
    });
    if (mountedRef.current) setRunPlan(fresh);

    // The job's total is the pictures the run is responsible for: the whole library minus the ones
    // that already carry a comparable vector. Counting the already-indexed ones in would let a run
    // that did nothing at all report "300 of 300".
    const total = Math.max(0, fresh.totalImages - fresh.skippedByReason['already-indexed']);
    await execute('backfill', total);
  }, [running, consent, cloudEnabled, observations, refuse, execute]);

  /**
   * Indexes what is already pending, without touching storage.
   *
   * The action after a pause, a cancel or a failure: the rows are already there and the runner picks
   * up exactly the ones without a vector, so this cannot re-spend a call that already succeeded.
   */
  const runPending = useCallback(
    async (options?: { maxItems?: number }) => {
      if (running) return;

      if (!consent) {
        refuse(
          'Indexing needs your permission to send chart screenshots to the embedding model. Turn ' +
            'it on, then run this again. Nothing was sent.'
        );
        return;
      }
      if (!cloudEnabled) {
        refuse('A similarity search needs the private cloud library. Add your Supabase credentials.');
        return;
      }

      await execute('reindex', 0, options?.maxItems);
    },
    [running, consent, cloudEnabled, refuse, execute]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    running,
    progress,
    result,
    summary,
    refusal,
    error,
    paused,
    plan: runPlan ?? planned,
    migration,
    lastJob,
    runBackfill,
    runPending,
    cancel,
    refreshLastJob,
  };
}
