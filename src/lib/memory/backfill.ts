/**
 * Deciding what a backfill over the existing library should actually send.
 *
 * A backfill is the moment a trader's whole screenshot history is offered to a paid, rate-limited
 * model. That makes the plan worth computing separately from the run, for three reasons:
 *
 *   1. **The boundary has to be drawn before anything is sent.** Whether a picture shows the time
 *      after the decision, whether its timestamp can be trusted at all, and where the run resumes
 *      from are all decisions, not loop control. If they live inside the loop that calls the model,
 *      the only way to check them is to spend the calls.
 *   2. **Not sending something must be visible.** A picture left out of a run that reports "300 of
 *      300 indexed" is a silent hole in the library. Every picture this planner declines is
 *      reported with a reason and counted, so the numbers add up to the library size.
 *   3. **A stopped run has to be resumable.** The cursor is derived here, so resuming is a property
 *      of the plan rather than something the runner remembers.
 *
 * Nothing in this module performs I/O, reads the clock, or talks to Supabase or a model. It is a
 * pure function of a journal snapshot, so the rules above are covered by unit tests instead of by
 * watching a long job and hoping.
 *
 * On the check order: the checks run in a fixed sequence and the FIRST one that fails is the reason
 * reported. That is deliberate — a `context` picture whose observation also has an untrustworthy
 * timestamp has two problems, and reporting whichever check happened to run first is only honest if
 * the order is fixed and documented. It is: unusable record, then eligibility, then the picture's
 * own payload, then its embedding stamp, and consent last of all.
 */

import type { MemoryImage, MemoryImageRole, TradingObservation } from '../../types';
import { MAX_COACH_IMAGE_DATA_CHARS, parseCoachImageDataUrl } from '../ai/coach-images';
import { PRE_DECISION_ROLES, hasTrustworthyObservationTime, isPreDecisionRole } from './eligibility';
import { matchesEmbeddingConfig } from './embeddings';
import { nextCursor } from './indexing';

/**
 * How many pictures one plan offers.
 *
 * A page rather than the whole library, because the plan is consumed by a run that persists its
 * progress after each page: twenty-five pictures is a few minutes of work, so a run that is closed,
 * loses its connection or is stopped by hand has a bounded amount to redo and a cursor that means
 * something. It is not a batch size — the runner decides how many requests to have in flight.
 */
export const MEMORY_BACKFILL_PAGE_SIZE = 25;

/**
 * The largest page a caller may ask for.
 *
 * Bounded because a page is also the unit of resumability: asking for the whole library would make
 * a run that stops at picture four hundred start again from one, which is the cost this planner
 * exists to avoid.
 */
export const MEMORY_MAX_BACKFILL_PAGE_SIZE = 500;

/** Why one picture is not part of this run. Every exclusion lands in exactly one of these. */
export type MemoryBackfillSkipReason =
  /** No object in the bucket and no inline copy: there is nothing to embed. */
  | 'no-image'
  /** The trader has not agreed to send pictures to an AI provider, so nothing is sent. */
  | 'no-consent'
  /** It cannot be a searchable memory at all — the wrong role, or a time that cannot be placed. */
  | 'not-eligible'
  /** Already embedded by the configuration this build uses. Nothing to do. */
  | 'already-indexed'
  /** Re-sent rather than skipped; see `MemoryBackfillCandidateReason`. Counted here as 0. */
  | 'stale-embedding'
  /** The inline copy is larger than the model will accept. */
  | 'too-large';

/**
 * The finer fact behind a `not-eligible` or `no-image` exclusion.
 *
 * Where the reason is one of `eligibility.ts`'s own, this is that module's vocabulary verbatim
 * rather than a second spelling of the same judgement. The two additions are this module's:
 * `not-requested` for a picture the caller narrowed away from, and `unknown-observation` for an
 * image row whose observation is not in the snapshot it was planned against.
 */
export type MemoryBackfillSkipDetail =
  | 'unknown-observation'
  | 'not-pre-decision'
  | 'not-requested'
  | 'untrusted-observation-time'
  | 'missing-observation-time'
  | 'inline-unusable'
  | 'inline-too-large'
  | 'consent-withheld';

/** One picture that was left out, and why. */
export interface MemoryBackfillSkippedImage {
  imageId: string;
  observationId: string;
  reason: MemoryBackfillSkipReason;
  detail?: MemoryBackfillSkipDetail;
}

/**
 * Why a candidate is being sent.
 *
 * `stale-embedding` is a picture that already has a vector, produced by a configuration this build
 * does not use. It is sent again rather than skipped — its old vector cannot be compared against a
 * query's, so leaving it alone would mean a library that looks indexed and returns nothing — and
 * this field is where that is recorded, because the picture is NOT an exclusion and must not appear
 * in `skipped`.
 */
export type MemoryBackfillCandidateReason = 'new' | 'stale-embedding';

/** One picture this run will send, in the order it will be sent. */
export interface MemoryBackfillCandidate {
  imageId: string;
  observationId: string;
  role: MemoryImageRole;
  /**
   * The picture's position in the WHOLE ordered candidate list, not in this page.
   *
   * Stable across page sizes on purpose: a page boundary that renumbered the work would make two
   * plans of the same library impossible to compare, which is exactly what a resumed run does.
   */
  order: number;
  reason: MemoryBackfillCandidateReason;
}

export interface MemoryBackfillPlan {
  /** This page's worth of work. Empty is a valid answer and has three distinct causes. */
  candidates: MemoryBackfillCandidate[];
  /**
   * Every picture left out, complete rather than paged.
   *
   * The counts are the point, so they must describe the library rather than the page: a trader
   * looking at "12 ready" needs to see the other 288 accounted for.
   */
  skipped: MemoryBackfillSkippedImage[];
  /** The same exclusions counted by reason. Every key is always present, including zeros. */
  skippedByReason: Record<MemoryBackfillSkipReason, number>;
  /** How many pictures the library holds, so the rest of the plan can be read against it. */
  totalImages: number;
  /** True when the ordered candidates continue past this page. */
  truncated: boolean;
  /** Where a resumed run continues from. Absent when there is nothing left. */
  nextCursor?: string;
}

export interface MemoryBackfillInput {
  observations: readonly TradingObservation[];
  /** The flat image rows, which are authoritative — see the note on `roles` below. */
  images: readonly MemoryImage[];
  /** Whether the trader has agreed to send pictures to an AI provider. */
  consent: boolean;
  pageSize?: number;
  /** The `nextCursor` of the previous page. An unrecognised value restarts from the beginning. */
  cursor?: string;
  /**
   * Which roles to consider. Defaults to the pre-decision roles.
   *
   * Narrowing is honoured — a run that only wants `entry` pictures gets only those — but widening is
   * refused: anything outside `PRE_DECISION_ROLES` is treated as not eligible rather than sent. A
   * caller cannot opt into indexing hindsight, and a role that is neither requested nor allowed is
   * reported as `not-pre-decision`, which is the fact that matters.
   */
  roles?: readonly MemoryImageRole[];
}

/** Milliseconds for a timestamp, or null when it is missing or unparseable. */
function parseInstant(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Snaps a requested page size into the supported range.
 *
 * A page size that is not a usable number at all — NaN, Infinity, zero, negative — falls back to the
 * documented default rather than being clamped up to one. Clamping a zero to one would answer "give
 * me none" with a single picture, which turns a three-hundred-picture library into three hundred
 * calls for a caller who passed a bad value; the default keeps that caller working. A number that IS
 * usable but out of range is clamped, because that is a real request for too much or too little.
 */
function clampPageSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return MEMORY_BACKFILL_PAGE_SIZE;
  }
  return Math.min(MEMORY_MAX_BACKFILL_PAGE_SIZE, Math.round(value));
}

/**
 * Whether a stored picture's stamp is the one this build would write.
 *
 * `matchesEmbeddingConfig` is used rather than a local comparison so that "comparable" means one
 * thing everywhere. A row with no stamp at all is NOT current: `memory_images` without an
 * `embedding_version` predates the feature or was written by something else, and treating that as a
 * match would leave a vector in the library that no query can ever rank.
 */
function isCurrent(image: MemoryImage): boolean {
  if (image.indexStatus !== 'completed') return false;
  return matchesEmbeddingConfig({
    model: image.embeddingModel,
    version: image.embeddingVersion,
    dimension: image.embeddingDimension,
  });
}

/**
 * Works out what a run over the existing library should send, and what it is leaving behind.
 *
 * Ordering is by observation time, oldest first, then by image id. The id is what makes the order
 * total, so the same library always produces the same sequence and a cursor is unambiguous. Oldest
 * first is chosen so that a run stopped partway leaves a contiguous block of history indexed — the
 * library's coverage can then be described as a date, which a scatter of recent days cannot, and the
 * dates that remain are the ones at the end of the queue.
 *
 * Consent is checked LAST, after every other reason to exclude a picture. That is what makes the
 * empty plan say something useful: with consent off, a library of three hundred ready pictures
 * reports three hundred `no-consent` exclusions rather than an empty page with no explanation, and
 * the trader can see exactly what turning the switch on would index.
 */
export function planLibraryBackfill(input: MemoryBackfillInput): MemoryBackfillPlan {
  const { observations, images, consent, cursor } = input;
  const pageSize = clampPageSize(input.pageSize);
  const requested = new Set((input.roles ?? PRE_DECISION_ROLES).filter(isPreDecisionRole));

  const byId = new Map<string, TradingObservation>();
  for (const observation of observations) byId.set(observation.id, observation);

  const skipped: MemoryBackfillSkippedImage[] = [];
  const skippedByReason: Record<MemoryBackfillSkipReason, number> = {
    'no-image': 0,
    'no-consent': 0,
    'not-eligible': 0,
    'already-indexed': 0,
    'stale-embedding': 0,
    'too-large': 0,
  };

  const skip = (
    image: MemoryImage,
    reason: MemoryBackfillSkipReason,
    detail?: MemoryBackfillSkipDetail
  ) => {
    skipped.push({ imageId: image.id, observationId: image.observationId, reason, detail });
    skippedByReason[reason] += 1;
  };

  // Sorted once, before anything is classified, so the candidate list, the page and the cursor all
  // describe the same sequence.
  const ordered = images
    .map((image) => {
      const observation = byId.get(image.observationId);
      return { image, observation, observedMs: observation ? parseInstant(observation.observedAt) : null };
    })
    .sort(
      (a, b) =>
        (a.observedMs ?? Number.MAX_SAFE_INTEGER) - (b.observedMs ?? Number.MAX_SAFE_INTEGER) ||
        a.image.id.localeCompare(b.image.id)
    );

  const ready: MemoryBackfillCandidate[] = [];

  for (const { image, observation, observedMs } of ordered) {
    // ---- The record the picture belongs to ----
    // An image row whose observation is not in the snapshot cannot be placed in time or judged for
    // its role, so it is reported rather than guessed at. This happens when a page of images was
    // read without the observations they hang from.
    if (!observation) {
      skip(image, 'not-eligible', 'unknown-observation');
      continue;
    }

    // ---- Eligibility. Reused from `eligibility.ts`, never restated. ----
    // The flat image list is authoritative here, which is why the role is tested with
    // `isPreDecisionRole` rather than by going through `selectMatchCandidates`: that function reads
    // `observation.images`, and a snapshot that carries the images separately would silently produce
    // an eligibility report of "nothing excluded" — the one failure this check exists to prevent.
    if (!isPreDecisionRole(image.role)) {
      skip(image, 'not-eligible', 'not-pre-decision');
      continue;
    }
    if (!requested.has(image.role)) {
      skip(image, 'not-eligible', 'not-requested');
      continue;
    }
    if (observedMs === null) {
      skip(image, 'not-eligible', 'missing-observation-time');
      continue;
    }
    if (!hasTrustworthyObservationTime(observation)) {
      skip(image, 'not-eligible', 'untrusted-observation-time');
      continue;
    }

    // ---- The picture's own payload ----
    if (!image.storagePath) {
      // Inline-only. This is the local-only case and also the pre-migration case, where the
      // screenshot still lives inside the journal snapshot.
      if (!image.dataUrl) {
        skip(image, 'no-image');
        continue;
      }
      // Measured only when the bytes are actually here. A picture already in the bucket has no size
      // on its row, so the parser below cannot be asked about it — and claiming `too-large` for an
      // object whose size is unknown would be inventing a fact.
      if (image.dataUrl.length > MAX_COACH_IMAGE_DATA_CHARS) {
        skip(image, 'too-large', 'inline-too-large');
        continue;
      }
      if (!parseCoachImageDataUrl(image.dataUrl)) {
        skip(image, 'no-image', 'inline-unusable');
        continue;
      }
    }

    // ---- Its embedding stamp ----
    const completed = image.indexStatus === 'completed';
    if (isCurrent(image)) {
      skip(image, 'already-indexed');
      continue;
    }

    // ---- Consent, last, so the counts can say what is waiting on it ----
    if (!consent) {
      skip(image, 'no-consent', 'consent-withheld');
      continue;
    }

    // A `completed` row that reached here is stamped with a configuration this build does not use,
    // so it is sent again. The other statuses — `pending`, `processing`, `failed`, `skipped` — are
    // all work still to do: `processing` is what a run that was interrupted mid-picture leaves
    // behind, and `skipped` recorded a refusal made when consent was off, which is no longer the
    // situation if this code is running at all.
    ready.push({
      imageId: image.id,
      observationId: image.observationId,
      role: image.role,
      order: ready.length,
      reason: completed ? 'stale-embedding' : 'new',
    });
  }

  // Resuming. A cursor that is not in the list — because the picture was deleted, or the config
  // changed and it is no longer a candidate — restarts from the beginning rather than throwing or
  // silently returning nothing: anything already embedded is skipped by the stamp check above, so a
  // restart costs the plan nothing and cannot spend a call it has already spent.
  const found = cursor ? ready.findIndex((candidate) => candidate.imageId === cursor) : -1;
  const start = found >= 0 ? found + 1 : 0;
  const page = ready.slice(start, start + pageSize);
  const truncated = start + page.length < ready.length;

  return {
    candidates: page,
    skipped,
    skippedByReason,
    totalImages: images.length,
    truncated,
    nextCursor: truncated ? nextCursor(page.map((candidate) => candidate.imageId)) : undefined,
  };
}
