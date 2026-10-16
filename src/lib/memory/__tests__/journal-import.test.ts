import { describe, expect, it } from 'vitest';

import type { MemoryImage, Trade, TradingObservation } from '../../../types';
import {
  JOURNAL_IMPORT_PAGE_SIZE,
  countUnlabelledImages,
  importedMemoryImage,
  isImportableJournalImage,
  journalImageId,
  journalObservationId,
  observationFromJournalTrade,
  planJournalImport,
  promoteJournalImage,
  unlabelledImages,
  type JournalImportPlan,
} from '../journal-import';
import { importJournalScreenshots } from '../journal-import-runner';

/**
 * The rules these tests pin down are the ones that decide what an imported screenshot may ever be
 * used for, so the important assertions are about the ROLE and about what the record does not claim.
 * An import that quietly produced matchable pictures would pass any test that only counted what
 * arrived — and would put hindsight into a search, which is the failure this whole subsystem exists
 * to prevent.
 */

const INLINE = 'data:image/jpeg;base64,AAAA';
const OTHER_INLINE = 'data:image/jpeg;base64,BBBB';
const CLOUD_URL = 'https://project.supabase.co/storage/v1/object/public/journal-media/user/trade-1.png';

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    userId: 'user-1',
    tradingDayId: 'day-1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 2,
    entryPrice: 5000,
    initialStop: 4995,
    entryTime: '2026-03-03T14:30:00.000Z',
    session: 'Regular Session',
    initialRisk: 50,
    grossPnL: 120,
    pointsPnL: 6,
    rMultiple: 2.4,
    status: 'closed',
    images: [INLINE],
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

function plan(overrides: {
  trades?: Trade[];
  observations?: TradingObservation[];
  pageSize?: number;
} = {}): JournalImportPlan {
  return planJournalImport({
    trades: overrides.trades ?? [trade()],
    observations: overrides.observations ?? [],
    pageSize: overrides.pageSize,
  });
}

describe('planJournalImport — what of the journal can come across', () => {
  it('plans a trade screenshot, at the trade’s own entry moment', () => {
    const planned = plan();

    expect(planned.candidates).toEqual([
      {
        tradeId: 'trade-1',
        observationId: journalObservationId('trade-1'),
        existingObservation: false,
        observedAt: '2026-03-03T14:30:00.000Z',
        instrumentId: 'mes',
        images: [{ source: INLINE, imageId: journalImageId('trade-1', INLINE) }],
      },
    ]);
    expect(planned.totalJournalImages).toBe(1);
    expect(planned.tradesWithImages).toBe(1);
    expect(planned.imagesToImport).toBe(1);
    expect(planned.truncated).toBe(false);
  });

  it('adds to the sighting a trade already has, instead of making a second record for it', () => {
    const existing: TradingObservation = {
      id: 'obs-mine',
      userId: 'user-1',
      linkedTradeId: 'trade-1',
      observedAt: '2026-03-03T14:29:00.000Z',
      observedAtSource: 'recorded',
      marketTimezone: 'America/New_York',
      instrumentId: 'mes',
      symbol: 'MES',
      images: [],
      createdAt: '2026-03-03T14:29:00.000Z',
      updatedAt: '2026-03-03T14:29:00.000Z',
    };

    const planned = plan({ observations: [existing] });

    expect(planned.candidates[0].observationId).toBe('obs-mine');
    expect(planned.candidates[0].existingObservation).toBe(true);
  });

  it('counts a picture the library already holds rather than importing it twice', () => {
    const source = INLINE;
    const alreadyThere = image({ id: journalImageId('trade-1', source), role: 'context' });

    const planned = plan({
      observations: [
        {
          ...observationFromJournalTrade({
            candidate: plan().candidates[0],
            trade: trade(),
            userId: 'user-1',
            timezone: 'America/New_York',
            symbol: 'MES',
            consent: false,
          }),
          id: 'obs-1',
          images: [alreadyThere],
        },
      ],
    });

    expect(planned.candidates).toEqual([]);
    expect(planned.skippedByReason['already-imported']).toBe(1);
    expect(planned.imagesToImport).toBe(0);
  });

  it('is idempotent by id, so the same plan run twice cannot duplicate a picture', () => {
    // The identity of a picture is derived from the trade and the journal's own reference, so a plan
    // taken before an import and a plan taken after it agree on which picture is which without the
    // library having to remember anything about the import itself.
    expect(journalImageId('trade-1', INLINE)).toBe(journalImageId('trade-1', INLINE));
    expect(journalImageId('trade-1', INLINE)).not.toBe(journalImageId('trade-1', OTHER_INLINE));
    expect(journalImageId('trade-1', INLINE)).not.toBe(journalImageId('trade-2', INLINE));
  });

  it('leaves a trade whose entry time is unknown exactly where it is', () => {
    const planned = plan({ trades: [trade({ entryTime: '' })] });

    expect(planned.candidates).toEqual([]);
    expect(planned.skippedByReason['no-decision-time']).toBe(1);
    // Not a reason to place it at an upload time: an observation in the wrong replay window is worse
    // than one that is not there.
    expect(planned.imagesToImport).toBe(0);
  });

  it('refuses a clip or a reference it cannot read, and says how many', () => {
    const planned = plan({
      trades: [
        trade({ images: ['https://project.supabase.co/storage/v1/object/public/journal-media/a.mp4', INLINE] }),
      ],
    });

    expect(planned.skippedByReason['unreadable-source']).toBe(1);
    expect(planned.candidates[0].images.map((entry) => entry.source)).toEqual([INLINE]);
  });

  it('counts one URL written twice on a trade as one picture', () => {
    const planned = plan({ trades: [trade({ images: [INLINE, INLINE] })] });

    expect(planned.candidates[0].images).toHaveLength(1);
    expect(planned.skippedByReason['already-imported']).toBe(1);
  });

  it('plans a page at a time and still reports the size of the whole backlog', () => {
    const planned = plan({
      trades: [trade({ id: 'a' }), trade({ id: 'b' }), trade({ id: 'c' })],
      pageSize: 2,
    });

    expect(planned.candidates).toHaveLength(2);
    expect(planned.truncated).toBe(true);
    expect(planned.imagesToImport).toBe(3);
  });

  it('orders by entry time so two plans of the same journal agree on the pages', () => {
    const planned = plan({
      trades: [
        trade({ id: 'later', entryTime: '2026-03-04T14:30:00.000Z' }),
        trade({ id: 'earlier', entryTime: '2026-03-02T14:30:00.000Z' }),
      ],
    });

    expect(planned.candidates.map((candidate) => candidate.tradeId)).toEqual(['earlier', 'later']);
  });

  it('keeps its ids usable as object paths, including for an id full of punctuation', () => {
    const planned = plan({ trades: [trade({ id: 'trade/1 with spaces' })] });

    expect(planned.candidates[0].observationId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(planned.candidates[0].images[0].imageId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(planned.candidates[0].observationId).not.toContain('trade/1');
  });

  it('defaults to a bounded page rather than the whole journal', () => {
    expect(JOURNAL_IMPORT_PAGE_SIZE).toBeLessThan(50);
  });
});

describe('isImportableJournalImage', () => {
  it.each([
    [INLINE, true],
    [CLOUD_URL, true],
    ['https://example.com/a.mp4', false],
    ['https://example.com/a.webm?t=1', false],
    ['blob:http://localhost/1234', false],
    ['', false],
    [undefined, false],
  ])('%s → %s', (source, expected) => {
    expect(isImportableJournalImage(source as string)).toBe(expected);
  });
});

describe('an imported picture can never be a search candidate', () => {
  it('arrives in the unlabelled role, whatever consent says', () => {
    for (const consent of [true, false]) {
      const picture = importedMemoryImage({
        imageId: 'img-journal-a',
        observationId: 'obs-journal-a',
        dataUrl: INLINE,
        consent,
      });

      expect(picture.role).toBe('context');
      // `context` is on the post-decision side of the boundary, so no search may match on it. The
      // status only decides what an indexing run will do once the trader has labelled it.
      expect(picture.indexStatus).toBe(consent ? 'pending' : 'skipped');
    }
  });

  it('is listed as unlabelled until the trader answers', () => {
    const record = planObservation([importedMemoryImage({ imageId: 'a', observationId: 'obs-1', dataUrl: INLINE, consent: true })]);

    expect(unlabelledImages(record).map((entry) => entry.id)).toEqual(['a']);
    expect(countUnlabelledImages([record])).toBe(1);
    expect(countUnlabelledImages([planObservation([image({ role: 'before-setup' })])])).toBe(0);
  });
});

/** A record holding exactly the pictures given, for the role assertions above and below. */
function planObservation(images: MemoryImage[]): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'user-1',
    observedAt: '2026-03-03T14:30:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    images,
    createdAt: '2026-03-03T14:30:00.000Z',
    updatedAt: '2026-03-03T14:30:00.000Z',
  };
}

describe('observationFromJournalTrade — what the record does not claim', () => {
  it('carries no outcome, because the trade holds the execution and not the market', () => {
    const record = observationFromJournalTrade({
      candidate: plan().candidates[0],
      trade: trade({ setupName: 'Opening drive', setupId: 'setup-1' }),
      userId: 'user-1',
      timezone: 'America/New_York',
      symbol: 'MES',
      consent: true,
      now: new Date('2026-10-16T12:00:00.000Z'),
    });

    expect(record.outcome).toBeUndefined();
    expect(record.notes).toBeUndefined();
    expect(record.linkedTradeId).toBe('trade-1');
    expect(record.observedAt).toBe('2026-03-03T14:30:00.000Z');
    // The entry time is a recorded fact, so a replay may place this record. The picture's role is
    // the part that is unknown, and it is the role that keeps it out of a search.
    expect(record.observedAtSource).toBe('recorded');
    expect(record.setupName).toBe('Opening drive');
    expect(record.images).toEqual([]);
  });
});

describe('promoteJournalImage — answering what a picture shows', () => {
  const imported = image({ id: 'imported', role: 'context', dataUrl: INLINE, storagePath: undefined });

  it('makes the picture the before-the-decision one and queues it for indexing', () => {
    const next = promoteJournalImage(planObservation([imported]), 'imported', {
      consent: true,
      now: new Date('2026-10-16T12:00:00.000Z'),
    });

    expect(next.images[0].role).toBe('before-setup');
    expect(next.images[0].indexStatus).toBe('pending');
    expect(next.updatedAt).toBe('2026-10-16T12:00:00.000Z');
  });

  it('queues it as a refusal rather than a promise when consent is off', () => {
    const next = promoteJournalImage(planObservation([imported]), 'imported', { consent: false });

    expect(next.images[0].role).toBe('before-setup');
    expect(next.images[0].indexStatus).toBe('skipped');
  });

  it('takes the place of a before-the-decision picture the record already had', () => {
    const previous = image({ id: 'previous', role: 'before-setup' });
    const next = promoteJournalImage(planObservation([previous, imported]), 'imported', {
      consent: true,
    });

    // One record, one picture claiming to be the moment of decision: the other one becomes
    // unlabelled rather than both being matchable.
    expect(next.images.find((entry) => entry.id === 'imported')?.role).toBe('before-setup');
    expect(next.images.find((entry) => entry.id === 'previous')?.role).toBe('context');
    expect(next.images.filter((entry) => entry.role === 'before-setup')).toHaveLength(1);
  });

  it('leaves the what-happened-next picture alone', () => {
    const after = image({ id: 'after', role: 'after-setup' });
    const next = promoteJournalImage(planObservation([imported, after]), 'imported', {
      consent: true,
    });

    expect(next.images.find((entry) => entry.id === 'after')?.role).toBe('after-setup');
  });

  it('changes nothing for an id the record does not hold, or one already labelled', () => {
    const record = planObservation([imported, image({ id: 'before', role: 'before-setup' })]);

    expect(promoteJournalImage(record, 'missing', { consent: true })).toBe(record);
    expect(promoteJournalImage(record, 'before', { consent: true })).toBe(record);
  });
});

describe('importJournalScreenshots — the part that touches storage', () => {
  const io = {
    read: async (source: string) => ({ dataUrl: source }),
    upload: async (input: { observationId: string; imageId: string }) => ({
      storagePath: `user-1/${input.observationId}/${input.imageId}.jpg`,
      checksum: 'abc123',
    }),
  };

  it('stores each picture privately and keeps no inline copy', async () => {
    const planned = plan({ trades: [trade({ images: [INLINE, OTHER_INLINE] })] });

    const result = await importJournalScreenshots({
      plan: planned,
      trades: [trade({ images: [INLINE, OTHER_INLINE] })],
      observations: [],
      instruments: [],
      userId: 'user-1',
      timezone: 'America/New_York',
      consent: true,
      cloudEnabled: true,
      io,
      now: () => new Date('2026-10-16T12:00:00.000Z'),
    });

    expect(result.imported).toBe(2);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failures).toEqual([]);
    const record = result.observations[0];
    expect(record.images).toHaveLength(2);
    for (const picture of record.images) {
      expect(picture.role).toBe('context');
      expect(picture.storagePath).toBeTruthy();
      expect(picture.dataUrl).toBeUndefined();
      expect(picture.checksum).toBe('abc123');
      expect(picture.observationId).toBe(record.id);
    }
  });

  it('keeps a picture in the browser when there is nowhere to upload it', async () => {
    const planned = plan();
    let uploads = 0;

    const result = await importJournalScreenshots({
      plan: planned,
      trades: [trade()],
      observations: [],
      instruments: [],
      userId: 'user-1',
      timezone: 'America/New_York',
      consent: false,
      cloudEnabled: false,
      io: {
        ...io,
        upload: async () => {
          uploads += 1;
          return { storagePath: 'never', checksum: null };
        },
      },
    });

    expect(uploads).toBe(0);
    expect(result.observations[0].images[0].dataUrl).toBe(INLINE);
    expect(result.observations[0].images[0].storagePath).toBeUndefined();
    expect(result.observations[0].images[0].indexStatus).toBe('skipped');
  });

  it('never loses a picture to a failed upload, and says it was kept', async () => {
    const planned = plan();

    const result = await importJournalScreenshots({
      plan: planned,
      trades: [trade()],
      observations: [],
      instruments: [],
      userId: 'user-1',
      timezone: 'America/New_York',
      consent: true,
      cloudEnabled: true,
      io: {
        ...io,
        upload: async () => {
          throw new Error('the bucket said no');
        },
      },
    });

    expect(result.imported).toBe(1);
    expect(result.observations[0].images[0].dataUrl).toBe(INLINE);
    expect(result.failures).toEqual([
      {
        tradeId: 'trade-1',
        imageId: journalImageId('trade-1', INLINE),
        reason: 'Kept in this browser instead of your private storage: the bucket said no',
        keptInline: true,
      },
    ]);
  });

  it('reports a picture it could not read rather than recording it as brought in', async () => {
    const planned = plan({ trades: [trade({ images: [INLINE, OTHER_INLINE] })] });

    const result = await importJournalScreenshots({
      plan: planned,
      trades: [trade({ images: [INLINE, OTHER_INLINE] })],
      observations: [],
      instruments: [],
      userId: 'user-1',
      timezone: 'America/New_York',
      consent: true,
      cloudEnabled: false,
      io: {
        ...io,
        read: async (source: string) =>
          source === OTHER_INLINE ? { reason: 'That screenshot could not be downloaded.' } : { dataUrl: source },
      },
    });

    expect(result.imported).toBe(1);
    expect(result.observations[0].images.map((entry) => entry.dataUrl)).toEqual([INLINE]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].keptInline).toBe(false);
    expect(result.failures[0].reason).toBe('That screenshot could not be downloaded.');
  });

  it('adds the pictures to a sighting the trade already has', async () => {
    const existing = planObservation([]);
    const planned = plan({
      observations: [{ ...existing, linkedTradeId: 'trade-1' }],
    });

    const result = await importJournalScreenshots({
      plan: planned,
      trades: [trade()],
      observations: [{ ...existing, linkedTradeId: 'trade-1' }],
      instruments: [],
      userId: 'user-1',
      timezone: 'America/New_York',
      consent: true,
      cloudEnabled: false,
      io,
    });

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].id).toBe('obs-1');
    expect(result.observations[0].images).toHaveLength(1);
  });

  it('keeps what it did when the run is stopped, and says so', async () => {
    const controller = new AbortController();
    const planned = plan({ trades: [trade({ id: 'a' }), trade({ id: 'b' })] });
    const both = [trade({ id: 'a' }), trade({ id: 'b' })];

    const result = await importJournalScreenshots({
      plan: planned,
      trades: both,
      observations: [],
      instruments: [],
      userId: 'user-1',
      timezone: 'America/New_York',
      consent: true,
      cloudEnabled: false,
      io: {
        ...io,
        read: async (source: string) => {
          controller.abort();
          return { dataUrl: source };
        },
      },
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    // The picture already in flight is finished and kept — a stop is not a failure.
    expect(result.imported).toBe(1);
    expect(result.observations).toHaveLength(1);
  });
});
