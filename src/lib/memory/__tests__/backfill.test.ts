import { describe, expect, it } from 'vitest';

import type { MemoryImage, MemoryImageRole, TradingObservation } from '../../../types';
import { MAX_COACH_IMAGE_DATA_CHARS } from '../../ai/coach-images';
import {
  MEMORY_BACKFILL_PAGE_SIZE,
  MEMORY_MAX_BACKFILL_PAGE_SIZE,
  planLibraryBackfill,
  type MemoryBackfillSkipReason,
} from '../backfill';
import {
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from '../embeddings';

/**
 * The rules these tests pin down are the ones that decide what leaves the machine, so each asserts
 * the *reason* a picture was left out and not merely that it was: a planner that excluded everything
 * would pass a test that only counted candidates.
 */

const VALID_DATA_URL = 'data:image/jpeg;base64,AAAA';

function observation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'user-1',
    observedAt: '2026-03-03T14:30:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'MES',
    symbol: 'MES',
    images: [],
    createdAt: '2026-03-03T14:31:00.000Z',
    updatedAt: '2026-03-03T14:31:00.000Z',
    ...overrides,
  };
}

function image(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    storagePath: 'user-1/obs-1/img-1.jpg',
    indexStatus: 'pending',
    createdAt: '2026-03-03T14:31:00.000Z',
    updatedAt: '2026-03-03T14:31:00.000Z',
    ...overrides,
  };
}

/** A picture already embedded by THIS build: the one state that must never be re-sent. */
function embedded(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return image({
    indexStatus: 'completed',
    embeddingModel: MEMORY_EMBEDDING_MODEL,
    embeddingVersion: MEMORY_EMBEDDING_VERSION,
    embeddingDimension: MEMORY_EMBEDDING_DIMENSION,
    indexedAt: '2026-03-04T09:00:00.000Z',
    ...overrides,
  });
}

/** The reasons one image id was left out, which is how the assertions below read. */
function reasonsFor(plan: ReturnType<typeof planLibraryBackfill>, imageId: string) {
  return plan.skipped.filter((entry) => entry.imageId === imageId);
}

/** The roles that show the time after the decision, which may never be sent for embedding. */
const POST_DECISION_ROLES: MemoryImageRole[] = ['exit', 'after-setup', 'context', 'other'];

describe('planLibraryBackfill — the pre-decision boundary', () => {
  it.each(POST_DECISION_ROLES)(
    'never sends a %s picture, because it shows the time after the decision',
    (role) => {
      const plan = planLibraryBackfill({
        observations: [observation()],
        images: [image({ role })],
        consent: true,
      });

      expect(plan.candidates).toEqual([]);
      expect(reasonsFor(plan, 'img-1')).toEqual([
        { imageId: 'img-1', observationId: 'obs-1', reason: 'not-eligible', detail: 'not-pre-decision' },
      ]);
      expect(plan.skippedByReason['not-eligible']).toBe(1);
    }
  );

  it('sends a before-setup and an entry picture', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [image({ id: 'a', role: 'before-setup' }), image({ id: 'b', role: 'entry' })],
      consent: true,
    });

    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual(['a', 'b']);
    expect(plan.candidates.every((candidate) => candidate.reason === 'new')).toBe(true);
  });

  it('honours a narrower role request but refuses to widen one', () => {
    const narrow = planLibraryBackfill({
      observations: [observation()],
      images: [image({ id: 'a', role: 'before-setup' }), image({ id: 'b', role: 'entry' })],
      consent: true,
      roles: ['entry'],
    });

    expect(narrow.candidates.map((candidate) => candidate.imageId)).toEqual(['b']);
    expect(reasonsFor(narrow, 'a')[0]?.detail).toBe('not-requested');

    // Asking for a post-decision role cannot turn hindsight into evidence: the intersection with the
    // pre-decision roles is empty, so nothing is sent and the reason is the role itself.
    const widened = planLibraryBackfill({
      observations: [observation()],
      images: [image({ id: 'c', role: 'exit' })],
      consent: true,
      roles: ['exit'],
    });

    expect(widened.candidates).toEqual([]);
    expect(reasonsFor(widened, 'c')[0]?.detail).toBe('not-pre-decision');
  });
});

describe('planLibraryBackfill — what is already indexed', () => {
  it('does not re-send a picture embedded by the configuration this build uses', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [embedded()],
      consent: true,
    });

    expect(plan.candidates).toEqual([]);
    expect(reasonsFor(plan, 'img-1')[0]?.reason).toBe('already-indexed');
    expect(plan.skippedByReason['already-indexed']).toBe(1);
  });

  it('re-sends a picture whose stamp is from another configuration, and says why', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [
        embedded({ id: 'old-model', embeddingModel: 'gemini-embedding-old' }),
        embedded({ id: 'old-version', embeddingVersion: MEMORY_EMBEDDING_VERSION - 1 }),
        embedded({ id: 'old-dimension', embeddingDimension: MEMORY_EMBEDDING_DIMENSION / 2 }),
        embedded({ id: 'unstamped', embeddingModel: undefined, embeddingVersion: undefined, embeddingDimension: undefined }),
      ],
      consent: true,
    });

    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual([
      'old-dimension',
      'old-model',
      'old-version',
      'unstamped',
    ]);
    expect(plan.candidates.every((candidate) => candidate.reason === 'stale-embedding')).toBe(true);
    // A stale picture is re-sent, not skipped, so it is reported in `candidates` and NOT here — which
    // is why this counter stays at zero and is still present.
    expect(plan.skipped).toEqual([]);
    expect(plan.skippedByReason['stale-embedding']).toBe(0);
  });

  it('re-sends a picture a previous run abandoned mid-flight, and one that failed', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [image({ id: 'half-done', indexStatus: 'processing' }), image({ id: 'broken', indexStatus: 'failed' })],
      consent: true,
    });

    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual(['broken', 'half-done']);
  });

  it('treats a skipped picture as work to do once consent exists', () => {
    // `skipped` recorded a refusal made while consent was off. This code only runs with consent on,
    // so leaving it unindexed would make the switch look broken.
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [image({ indexStatus: 'skipped' })],
      consent: true,
    });

    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual(['img-1']);
  });
});

describe('planLibraryBackfill — consent', () => {
  it('sends nothing and accounts for every picture that is otherwise ready', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [image({ id: 'a' }), image({ id: 'b' }), embedded({ id: 'c' })],
      consent: false,
    });

    expect(plan.candidates).toEqual([]);
    expect(plan.skippedByReason['no-consent']).toBe(2);
    expect(reasonsFor(plan, 'a')[0]?.detail).toBe('consent-withheld');
    // The picture that is already indexed stays indexed: consent governs sending, not what exists.
    expect(reasonsFor(plan, 'c')[0]?.reason).toBe('already-indexed');
  });

  it('does not blame consent for a picture that could never be sent anyway', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [image({ id: 'post', role: 'exit' })],
      consent: false,
    });

    expect(plan.skippedByReason['no-consent']).toBe(0);
    expect(plan.skippedByReason['not-eligible']).toBe(1);
  });
});

describe('planLibraryBackfill — eligibility and payload', () => {
  it('refuses a timestamp it cannot place in time', () => {
    const plan = planLibraryBackfill({
      observations: [
        observation({ id: 'uploaded', observedAtSource: 'upload-time' }),
        observation({ id: 'unknown', observedAtSource: 'unknown' }),
        observation({ id: 'timeless', observedAt: 'not a date' }),
      ],
      images: [
        image({ id: 'a', observationId: 'uploaded' }),
        image({ id: 'b', observationId: 'unknown' }),
        image({ id: 'c', observationId: 'timeless' }),
      ],
      consent: true,
    });

    expect(plan.candidates).toEqual([]);
    expect(reasonsFor(plan, 'a')[0]?.detail).toBe('untrusted-observation-time');
    expect(reasonsFor(plan, 'b')[0]?.detail).toBe('untrusted-observation-time');
    expect(reasonsFor(plan, 'c')[0]?.detail).toBe('missing-observation-time');
    expect(plan.skippedByReason['not-eligible']).toBe(3);
  });

  it('reports an image whose observation is not in the snapshot', () => {
    const plan = planLibraryBackfill({
      observations: [],
      images: [image({ observationId: 'obs-missing' })],
      consent: true,
    });

    expect(plan.candidates).toEqual([]);
    expect(reasonsFor(plan, 'img-1')[0]).toMatchObject({
      reason: 'not-eligible',
      detail: 'unknown-observation',
    });
  });

  it('leaves out a picture with no object and no inline copy', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [image({ storagePath: undefined })],
      consent: true,
    });

    expect(plan.candidates).toEqual([]);
    expect(reasonsFor(plan, 'img-1')[0]?.reason).toBe('no-image');
    expect(reasonsFor(plan, 'img-1')[0]?.detail).toBeUndefined();
  });

  it('sends a pre-migration picture that still lives inline, and refuses one that is not an image', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [
        image({ id: 'inline', storagePath: undefined, dataUrl: VALID_DATA_URL }),
        image({ id: 'not-an-image', storagePath: undefined, dataUrl: 'https://example.com/chart.png' }),
      ],
      consent: true,
    });

    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual(['inline']);
    expect(reasonsFor(plan, 'not-an-image')[0]).toEqual({
      imageId: 'not-an-image',
      observationId: 'obs-1',
      reason: 'no-image',
      detail: 'inline-unusable',
    });
  });

  it('refuses an inline picture larger than the model will accept, and only when it can measure it', () => {
    const plan = planLibraryBackfill({
      observations: [observation()],
      images: [
        image({ id: 'huge', storagePath: undefined, dataUrl:
          `data:image/jpeg;base64,${'A'.repeat(MAX_COACH_IMAGE_DATA_CHARS)}` }),
        // In the bucket, so its size is not on the row: the planner must not claim a limit it cannot
        // check, or every migrated screenshot would be reported as too large.
        image({ id: 'stored' }),
      ],
      consent: true,
    });

    expect(reasonsFor(plan, 'huge')[0]?.reason).toBe('too-large');
    expect(reasonsFor(plan, 'huge')[0]?.detail).toBe('inline-too-large');
    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual(['stored']);
  });
});

describe('planLibraryBackfill — order, paging and resuming', () => {
  it('is deterministic and orders oldest first, totalling the order with the id', () => {
    const observations = [
      observation({ id: 'later', observedAt: '2026-05-01T14:30:00.000Z' }),
      observation({ id: 'earlier', observedAt: '2026-01-01T14:30:00.000Z' }),
    ];
    const images = [
      image({ id: 'z-later', observationId: 'later' }),
      image({ id: 'b-early', observationId: 'earlier' }),
      image({ id: 'a-early', observationId: 'earlier' }),
    ];

    const first = planLibraryBackfill({ observations, images, consent: true });
    const second = planLibraryBackfill({ observations, images, consent: true });

    expect(first).toEqual(second);
    expect(first.candidates.map((candidate) => candidate.imageId)).toEqual([
      'a-early',
      'b-early',
      'z-later',
    ]);
    expect(first.candidates.map((candidate) => candidate.order)).toEqual([0, 1, 2]);
  });

  it('numbers the order across the whole list, so two page sizes agree', () => {
    const images = Array.from({ length: 5 }, (_, index) => image({ id: `img-${index}` }));

    const all = planLibraryBackfill({ observations: [observation()], images, consent: true, pageSize: 5 });
    const paged = planLibraryBackfill({ observations: [observation()], images, consent: true, pageSize: 2 });

    expect(paged.candidates.map((candidate) => candidate.order)).toEqual([0, 1]);
    expect(all.candidates.map((candidate) => candidate.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('pages, says there is more, and resumes without losing or repeating a picture', () => {
    const images = Array.from({ length: 7 }, (_, index) => image({ id: `img-${index}` }));

    const walked: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const plan = planLibraryBackfill({
        observations: [observation()],
        images,
        consent: true,
        pageSize: 3,
        cursor,
      });

      pages += 1;
      walked.push(...plan.candidates.map((candidate) => candidate.imageId));
      if (!plan.truncated) {
        expect(plan.nextCursor).toBeUndefined();
        break;
      }
      expect(plan.candidates.length).toBeGreaterThan(0);
      cursor = plan.nextCursor;
      expect(cursor).toBeDefined();
      if (pages > 10) throw new Error('the walk never finished');
    }

    expect(walked).toEqual(images.map((entry) => entry.id));
    expect(pages).toBe(3);
  });

  it('reports the whole page as untruncated when it is exactly the last of the work', () => {
    const images = Array.from({ length: 4 }, (_, index) => image({ id: `img-${index}` }));
    const plan = planLibraryBackfill({ observations: [observation()], images, consent: true, pageSize: 4 });

    expect(plan.candidates).toHaveLength(4);
    expect(plan.truncated).toBe(false);
    expect(plan.nextCursor).toBeUndefined();
  });

  it('restarts rather than throwing when the cursor is not in the list', () => {
    // The picture the cursor named is gone, or a version change removed it from the candidates. A
    // restart is safe because the stamp check above skips whatever has already been embedded.
    const images = [image({ id: 'a' }), image({ id: 'b' }), embedded({ id: 'c' })];
    const plan = planLibraryBackfill({
      observations: [observation()],
      images,
      consent: true,
      cursor: 'img-that-never-existed',
    });

    expect(plan.candidates.map((candidate) => candidate.imageId)).toEqual(['a', 'b']);
  });

  it('ignores a page size that is not a usable number', () => {
    const images = Array.from({ length: 3 }, (_, index) => image({ id: `img-${index}` }));

    for (const pageSize of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planLibraryBackfill({ observations: [observation()], images, consent: true, pageSize });
      expect(plan.candidates).toHaveLength(3);
      expect(plan.truncated).toBe(false);
    }

    const huge = planLibraryBackfill({
      observations: [observation()],
      images: Array.from({ length: 3 }, (_, index) => image({ id: `img-${index}` })),
      consent: true,
      pageSize: 100_000,
    });
    expect(huge.candidates).toHaveLength(3);
    expect(MEMORY_MAX_BACKFILL_PAGE_SIZE).toBeGreaterThan(MEMORY_BACKFILL_PAGE_SIZE);
  });
});

describe('planLibraryBackfill — the counts add up', () => {
  it('accounts for every picture in the library exactly once', () => {
    const observations = [observation({ id: 'ok' }), observation({ id: 'uploaded', observedAtSource: 'upload-time' })];
    const images = [
      image({ id: 'ready-1', observationId: 'ok' }),
      image({ id: 'ready-2', observationId: 'ok', role: 'entry' }),
      embedded({ id: 'done', observationId: 'ok' }),
      image({ id: 'exit', observationId: 'ok', role: 'exit' }),
      image({ id: 'no-payload', observationId: 'ok', storagePath: undefined }),
      image({ id: 'bad-time', observationId: 'uploaded' }),
    ];

    const plan = planLibraryBackfill({ observations, images, consent: true });

    const counted = Object.values(plan.skippedByReason).reduce((sum, count) => sum + count, 0);
    expect(plan.totalImages).toBe(6);
    expect(plan.candidates).toHaveLength(2);
    expect(plan.skipped).toHaveLength(4);
    expect(counted).toBe(4);
    expect(plan.candidates.length + counted).toBe(plan.totalImages);
  });

  it('still reports the exclusions when the page is truncated', () => {
    const images = [
      image({ id: 'a' }),
      image({ id: 'b' }),
      image({ id: 'c' }),
      image({ id: 'exit', role: 'exit' }),
    ];
    const plan = planLibraryBackfill({ observations: [observation()], images, consent: true, pageSize: 1 });

    expect(plan.candidates).toHaveLength(1);
    expect(plan.truncated).toBe(true);
    // The exclusions describe the library, not the page: a trader reading "1 ready" must be able to
    // see the other three accounted for.
    expect(plan.skipped).toHaveLength(1);
    expect(Object.values(plan.skippedByReason).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it('always presents every reason key, including on an empty library', () => {
    const plan = planLibraryBackfill({ observations: [], images: [], consent: true });
    const keys: MemoryBackfillSkipReason[] = [
      'no-image',
      'no-consent',
      'not-eligible',
      'already-indexed',
      'stale-embedding',
      'too-large',
    ];

    expect(Object.keys(plan.skippedByReason).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(plan.skippedByReason[key]).toBe(0);

    expect(plan.candidates).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.totalImages).toBe(0);
    expect(plan.truncated).toBe(false);
    expect(plan.nextCursor).toBeUndefined();
  });
});
