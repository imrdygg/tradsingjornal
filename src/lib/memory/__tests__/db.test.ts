import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MemoryImage, MemoryOutcome, MemorySearch, TradingObservation } from '../../../types';

// ---------------------------------------------------------------------------
// A fake Supabase that records what was asked rather than pretending to be one.
//
// Two things here are worth pinning down and neither can be checked by reading the code:
//
//   1. A write must never carry a user id the caller supplied. `user_id` is `not null` in every
//      memory table, so it has to be written — and the test below hands `upsertObservations` a
//      record that claims a different owner, then asserts the row that reached the request body is
//      keyed to the SESSION's id. Row-level security would refuse the other one anyway; this says
//      the client never knowingly asks.
//   2. The search must not name an owner at all. `memory_match_images` reads `auth.uid()`, and the
//      test asserts the RPC's argument list contains no user id, so a future edit cannot quietly
//      add one back and move the boundary into the client.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const state = {
    tables: {} as Record<string, Row[]>,
    /** Every rpc call, in order, with its argument object captured as given. */
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    /** Every write, so a test can inspect exactly what would have reached the request body. */
    writes: [] as { table: string; op: string; payload: Row | Row[] }[],
    /** What the next rpc returns. Numbers are supported because a prune returns a count. */
    rpcResult: undefined as unknown,
    rpcError: null as { message: string; code?: string } | null,
    /** The signed-in user, or null to simulate a signed-out tab. */
    user: { id: 'session-user' } as { id: string } | null,
    /** Simulates a project where schema.sql has never been run. */
    missingSchema: false as boolean,
  };

  const table = (name: string): Row[] => {
    state.tables[name] ??= [];
    return state.tables[name];
  };

  const primaryKeyOf = (row: Row): unknown => row.id ?? row.observation_id;

  const missingSchemaError = () => ({
    message: 'relation "public.memory_images" does not exist',
    code: '42P01',
  });

  function from(name: string) {
    let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    const orders: { column: string; ascending: boolean }[] = [];
    let rowLimit: number | null = null;

    async function run() {
      if (state.missingSchema) return { data: null, error: missingSchemaError() };

      if (op === 'select') {
        let rows = [...table(name)];
        rows = rows.filter((row) =>
          Object.entries(filters).every(([column, value]) => row[column] === value)
        );
        rows = rows.filter((row) =>
          Object.entries(inFilters).every(([column, values]) => values.includes(row[column]))
        );
        for (const order of [...orders].reverse()) {
          rows.sort((a, b) => {
            const left = String(a[order.column] ?? '');
            const right = String(b[order.column] ?? '');
            return order.ascending ? left.localeCompare(right) : right.localeCompare(left);
          });
        }
        if (rowLimit !== null) rows = rows.slice(0, rowLimit);
        return { data: rows, error: null };
      }

      if (op === 'delete') {
        const remaining = table(name).filter((row) => {
          const matchesFilters = Object.entries(filters).every(
            ([column, value]) => row[column] === value
          );
          const matchesIn = Object.entries(inFilters).every(([column, values]) =>
            values.includes(row[column])
          );
          return !(matchesFilters && matchesIn);
        });
        // Mutated in place, so the state a later read sees is the state after the delete.
        table(name).splice(0, table(name).length, ...remaining);
        return { data: null, error: null };
      }

      const rows = Array.isArray(payload) ? payload : [payload as Row];
      if (op === 'insert') {
        for (const row of rows) table(name).push({ ...row });
        return { data: rows, error: null };
      }
      if (op === 'upsert') {
        for (const row of rows) {
          const existing = table(name).findIndex(
            (candidate) => primaryKeyOf(candidate) === primaryKeyOf(row)
          );
          if (existing < 0) table(name).push({ ...row });
          else table(name)[existing] = { ...table(name)[existing], ...row };
        }
        return { data: rows, error: null };
      }

      // update
      const patch = payload as Row;
      let touched = 0;
      for (let index = 0; index < table(name).length; index += 1) {
        const row = table(name)[index];
        const matches = Object.entries(filters).every(([column, value]) => row[column] === value);
        if (!matches) continue;
        table(name)[index] = { ...row, ...patch };
        touched += 1;
      }
      return { data: touched > 0 ? [{ id: rows[0]?.id ?? patch.id }] : [], error: null };
    }

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        inFilters[column] = values;
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        orders.push({ column, ascending: options?.ascending !== false });
        return builder;
      },
      limit: (count: number) => {
        rowLimit = count;
        return builder;
      },
      insert: (values: Row | Row[]) => {
        op = 'insert';
        payload = values;
        state.writes.push({ table: name, op, payload: values });
        return builder;
      },
      upsert: (values: Row | Row[], _options?: unknown) => {
        op = 'upsert';
        payload = values;
        state.writes.push({ table: name, op, payload: values });
        return builder;
      },
      update: (values: Row) => {
        op = 'update';
        payload = values;
        state.writes.push({ table: name, op, payload: values });
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      single: async () => {
        const result = await run();
        const rows = (result.data ?? []) as Row[];
        return { data: rows[0] ?? null, error: result.error };
      },
      maybeSingle: async () => {
        const result = await run();
        const rows = (result.data ?? []) as Row[];
        return { data: rows[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        run().then(resolve, reject),
    };

    return builder;
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    state.rpcCalls.push({ fn, args });
    if (state.rpcError) return { data: null, error: state.rpcError };
    return { data: state.rpcResult ?? null, error: null };
  }

  async function getUser() {
    return { data: { user: state.user } };
  }

  return { state, from, rpc, getUser };
});

vi.mock('../../supabase', () => ({
  supabase: { from: fake.from, rpc: fake.rpc, auth: { getUser: fake.getUser } },
}));

import {
  explainSchemaError,
  imageFromRow,
  imageRow,
  indexJobFromRow,
  observationFromRow,
  observationRow,
  outcomeFromRow,
  outcomeRow,
  readPgVector,
  searchFromRow,
  searchMemoryImages,
  toPgVector,
  vectorMatchFromRow,
  listImagesNeedingIndex,
  createMemoryIndexPort,
  createIndexJob,
  pruneMemorySearches,
  saveImageEmbedding,
  saveMemorySearch,
  setMatchFeedback,
  updateIndexJob,
  upsertObservationOutcome,
  upsertObservations,
} from '../db';

const USER = 'session-user';

/** A 768-wide vector of exactly-representable values, so it survives text round-tripping. */
function vector(fill = 0.5): number[] {
  return Array.from({ length: 768 }, (_, index) => (index % 2 === 0 ? fill : -1.25));
}

function observation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    // Deliberately a DIFFERENT id from the session's: nothing may write this one.
    userId: 'somebody-else',
    linkedTradeId: 'trade-1',
    observedAt: '2026-09-01T13:45:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'instrument-1',
    symbol: 'MES',
    setupName: 'Opening drive pullback',
    setupCategory: 'continuation',
    marketContext: 'Gap up, first pullback held the opening range.',
    notes: 'Watching the 20 EMA.',
    images: [],
    createdAt: '2026-09-01T13:45:01.000Z',
    updatedAt: '2026-09-01T13:45:01.000Z',
    ...overrides,
  };
}

function image(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    storagePath: `${USER}/obs-1/img-1.jpg`,
    checksum: 'abc123',
    mimeType: 'image/jpeg',
    indexStatus: 'pending',
    createdAt: '2026-09-01T13:45:02.000Z',
    updatedAt: '2026-09-01T13:45:02.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  fake.state.tables = {};
  fake.state.rpcCalls = [];
  fake.state.writes = [];
  fake.state.rpcResult = undefined;
  fake.state.rpcError = null;
  fake.state.user = { id: USER };
  fake.state.missingSchema = false;
});

// ---------------------------------------------------------------------------

describe('toPgVector / readPgVector', () => {
  it('sends a vector as the text literal PostgREST can cast to vector', () => {
    expect(toPgVector([0.5, -1.25])).toBe('[0.5,-1.25]');
  });

  it('round-trips a full-width vector exactly', () => {
    const original = vector();
    expect(readPgVector(toPgVector(original))).toEqual(original);
  });

  it('refuses a vector of the wrong width rather than returning a short one', () => {
    expect(readPgVector('[1,2,3]')).toBeNull();
  });

  it('refuses a vector containing anything that is not a finite number', () => {
    const poisoned = vector();
    poisoned[17] = Number.NaN;
    expect(readPgVector(toPgVector(poisoned))).toBeNull();
  });

  it('refuses null and anything that is not a vector at all', () => {
    expect(readPgVector(null)).toBeNull();
    expect(readPgVector('null')).toBeNull();
    expect(readPgVector(undefined)).toBeNull();
    expect(readPgVector('[]')).toBeNull();
  });

  it('accepts an already-parsed array of the right width', () => {
    expect(readPgVector(vector(0.25))).toEqual(vector(0.25));
  });
});

describe('observationRow', () => {
  it('stores the symbol in the searchable instrument column, not the local instrument id', () => {
    const row = observationRow(observation(), USER);
    expect(row.instrument).toBe('MES');
    expect(JSON.stringify(row)).not.toContain('instrument-1');
  });

  it('writes the session owner, never the one the record claims', () => {
    expect(observationRow(observation(), USER).user_id).toBe(USER);
  });

  it('turns absent optionals into null, so a null means "not recorded"', () => {
    const row = observationRow(
      observation({ setupName: undefined, notes: undefined, linkedTradeId: undefined }),
      USER
    );
    expect(row.setup_name).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.linked_trade_id).toBeNull();
  });

  it('round-trips through observationFromRow with the symbol standing in for the instrument id', () => {
    const original = observation();
    const restored = observationFromRow(observationRow(original, USER));
    expect(restored.id).toBe(original.id);
    expect(restored.symbol).toBe('MES');
    expect(restored.instrumentId).toBe('MES');
    expect(restored.observedAt).toBe(original.observedAt);
    expect(restored.observedAtSource).toBe('recorded');
    expect(restored.marketContext).toBe(original.marketContext);
    expect(restored.notes).toBe(original.notes);
  });

  it('leaves an unknown option absent rather than inventing an empty one', () => {
    const restored = observationFromRow(observationRow(observation(), USER));
    expect(restored.setupId).toBeUndefined();
    expect(restored.timeframe).toBeUndefined();
    expect(restored.session).toBeUndefined();
    expect(restored.observedDirection).toBeUndefined();
  });
});

describe('imageRow / imageFromRow', () => {
  it('always stamps the private bucket, whatever the record says', () => {
    expect(imageRow(image(), USER, 'obs-1').bucket_id).toBe('journal-memory');
  });

  it('carries the note written under the picture', () => {
    const row = imageRow(image({ note: 'Held the shelf for two days.' }), USER, 'obs-1');
    expect(row.note).toBe('Held the shelf for two days.');
    expect(imageFromRow(row).note).toBe('Held the shelf for two days.');
  });

  it('writes a missing note as null, so a null means nothing was written', () => {
    const row = imageRow(image(), USER, 'obs-1');
    expect(row.note).toBeNull();
    expect(imageFromRow(row).note).toBeUndefined();
  });

  it('round-trips a picture, and never carries the vector itself', () => {
    const row = imageRow(image(), USER, 'obs-1');
    const restored = imageFromRow({ ...row, embedding: toPgVector(vector()) });
    expect(restored.id).toBe('img-1');
    expect(restored.role).toBe('before-setup');
    expect(restored.storagePath).toBe(`${USER}/obs-1/img-1.jpg`);
    expect(restored.checksum).toBe('abc123');
    expect(restored.embeddingModel).toBeUndefined();
    // The vector is not part of the type at all: a 768-number array on every record would travel
    // through the journal sync the snapshot shape cannot afford.
    expect(JSON.stringify(restored)).not.toContain('0.5,');
  });

  it('reads a missing status as pending rather than as completed', () => {
    const restored = imageFromRow({
      ...imageRow(image(), USER, 'obs-1'),
      indexing_status: undefined as unknown as string,
    });
    expect(restored.indexStatus).toBe('pending');
  });

  it('keeps the failure message verbatim', () => {
    const restored = imageFromRow({
      ...imageRow(image(), USER, 'obs-1'),
      indexing_status: 'failed',
      indexing_error: 'HTTP 429 from the provider',
    });
    expect(restored.indexError).toBe('HTTP 429 from the provider');
  });
});

describe('outcomeRow / outcomeFromRow', () => {
  it('round-trips a recorded outcome', () => {
    const original: MemoryOutcome = {
      status: 'recorded',
      window: '30 minutes after the open',
      continuation: 'continuation',
      measuredMovementPoints: 12.5,
      source: 'trader-recorded',
      notes: 'Ran to the prior high.',
    };
    const restored = outcomeFromRow(outcomeRow('obs-1', USER, original, '2026-09-01T14:00:00.000Z'));
    expect(restored.status).toBe('recorded');
    expect(restored.continuation).toBe('continuation');
    expect(restored.measuredMovementPoints).toBe(12.5);
    expect(restored.notes).toBe('Ran to the prior high.');
  });

  it('keeps an unrecorded movement as absent rather than zero', () => {
    const restored = outcomeFromRow(
      outcomeRow('obs-1', USER, { status: 'unknown', source: 'unknown' }, 'x')
    );
    // A zero here would be a measurement nobody made, and averaging it in would invent a result.
    expect(restored.measuredMovementPoints).toBeUndefined();
    expect(restored.maxAdverseExcursionPoints).toBeUndefined();
    expect(restored.status).toBe('unknown');
  });
});

describe('vectorMatchFromRow', () => {
  it('maps a ranked candidate, including its distance', () => {
    const match = vectorMatchFromRow({
      observation_id: 'obs-1',
      image_id: 'img-1',
      image_role: 'entry',
      cosine_distance: 0.12,
      observed_at: '2026-09-01T13:45:00.000Z',
      instrument: 'MES',
      timeframe: '5m',
      session_type: 'new-york-am',
      setup_name: 'Opening drive pullback',
      linked_trade_id: 'trade-1',
    });
    expect(match.observationId).toBe('obs-1');
    expect(match.role).toBe('entry');
    expect(match.cosineDistance).toBeCloseTo(0.12);
    expect(match.timeframe).toBe('5m');
    expect(match.linkedTradeId).toBe('trade-1');
  });

  it('turns an unusable distance into the furthest one, not NaN', () => {
    const match = vectorMatchFromRow({ observation_id: 'obs-1', cosine_distance: null });
    // NaN would sort unpredictably; 1 is "no resemblance" and deterministic.
    expect(match.cosineDistance).toBe(1);
    expect(Number.isNaN(match.cosineDistance)).toBe(false);
  });
});

describe('searchFromRow / indexJobFromRow', () => {
  it('lifts the resemblance floor out of the stored metadata', () => {
    const search = searchFromRow({
      id: 'search-1',
      user_id: USER,
      searched_at: '2026-09-10T14:00:00.000Z',
      query_checksum: 'abc',
      filters: { instrument: 'MES' },
      matched_observation_ids: ['obs-1'],
      retrieval_model: 'gemini-embedding-2',
      retrieval_version: 1,
      result_metadata: { resemblanceFloor: 55, matches: [] },
      feedback: null,
      expires_at: '2026-12-09T14:00:00.000Z',
    });
    expect(search.resemblanceFloor).toBe(55);
    expect(search.filters.instrument).toBe('MES');
    expect(search.embeddingModel).toBe('gemini-embedding-2');
    expect(search.matches).toEqual([]);
  });

  it('maps a job, keeping the cursor, the counters and the last error', () => {
    const job = indexJobFromRow({
      id: 'job-1',
      user_id: USER,
      kind: 'backfill',
      status: 'cancelled',
      total_items: 300,
      processed_items: 41,
      failed_items: 2,
      skipped_items: 1,
      cursor: 'img-41',
      model: 'gemini-embedding-2',
      embedding_version: 1,
      last_error: 'HTTP 429',
      created_at: '2026-09-01T10:00:00.000Z',
      updated_at: '2026-09-01T10:05:00.000Z',
      started_at: '2026-09-01T10:00:01.000Z',
      finished_at: null,
    });
    expect(job.status).toBe('cancelled');
    expect(job.cursor).toBe('img-41');
    expect(job.processedItems).toBe(41);
    expect(job.failedItems).toBe(2);
    expect(job.lastError).toBe('HTTP 429');
    expect(job.finishedAt).toBeUndefined();
  });
});

describe('upsertObservations', () => {
  it('writes the session owner even when the records claim another one', async () => {
    await upsertObservations([observation()]);
    const write = fake.state.writes.find((entry) => entry.table === 'trading_observations');
    const rows = write?.payload as Record<string, unknown>[];
    expect(rows[0].user_id).toBe(USER);
  });

  it('writes a picture row only for a picture that is actually in the bucket', async () => {
    await upsertObservations([
      observation({
        images: [
          image({ id: 'stored', storagePath: 'a/b/c.jpg' }),
          // Inline only: a journal with no cloud. `memory_images.storage_path` is `not null`, so
          // there is no row this could honestly become.
          image({ id: 'inline', storagePath: undefined, dataUrl: 'data:image/jpeg;base64,AAAA' }),
        ],
      }),
    ]);

    const write = fake.state.writes.find((entry) => entry.table === 'memory_images');
    const rows = write?.payload as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('stored');
  });

  it('writes no picture rows at all when nothing is uploaded', async () => {
    await upsertObservations([observation({ images: [image({ storagePath: undefined })] })]);
    expect(fake.state.writes.some((entry) => entry.table === 'memory_images')).toBe(false);
  });

  it('deletes the row of a picture that was removed from a sighting', async () => {
    // The picture was stored once, so its row exists. The trader then removed it from the
    // sighting: the row has to go too, or a search can still return a chart the record no
    // longer shows.
    fake.state.tables.memory_images = [
      { ...imageRow(image({ id: 'kept' }), USER, 'obs-1') },
      { ...imageRow(image({ id: 'removed' }), USER, 'obs-1') },
    ];

    await upsertObservations([observation({ images: [image({ id: 'kept' })] })]);

    expect(fake.state.tables.memory_images.map((row) => row.id)).toEqual(['kept']);
  });

  it('leaves pictures of an observation outside the batch alone', async () => {
    fake.state.tables.memory_images = [
      { ...imageRow(image({ id: 'other-obs' }), USER, 'obs-2') },
    ];

    await upsertObservations([observation({ id: 'obs-1', images: [] })]);

    // Deleting another sighting's pictures would silently empty a library one save at a time.
    expect(fake.state.tables.memory_images.map((row) => row.id)).toEqual(['other-obs']);
  });

  it('does nothing, and asks for nothing, on an empty library', async () => {
    expect(await upsertObservations([])).toBe(0);
    expect(fake.state.writes).toHaveLength(0);
  });

  it('reports how many observation rows it wrote', async () => {
    expect(await upsertObservations([observation(), observation({ id: 'obs-2' })])).toBe(2);
  });

  it('refuses to write without a signed-in session', async () => {
    fake.state.user = null;
    const error = await upsertObservations([observation()]).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Sign in');
  });
});

describe('listImagesNeedingIndex', () => {
  beforeEach(() => {
    fake.state.tables.memory_images = [
      { ...imageRow(image({ id: 'a' }), USER, 'obs-1'), created_at: '2026-09-01T10:00:00.000Z' },
      { ...imageRow(image({ id: 'b' }), USER, 'obs-1'), created_at: '2026-09-02T10:00:00.000Z' },
      {
        ...imageRow(image({ id: 'c', indexStatus: 'completed' }), USER, 'obs-1'),
        created_at: '2026-09-03T10:00:00.000Z',
      },
      {
        ...imageRow(image({ id: 'd', indexStatus: 'failed' }), USER, 'obs-1'),
        created_at: '2026-09-04T10:00:00.000Z',
      },
      {
        // Interrupted mid-flight by a closed tab: without being re-offered this row would sit in
        // `processing` for ever while the library screen showed it as work in progress.
        ...imageRow(image({ id: 'e', indexStatus: 'processing' }), USER, 'obs-1'),
        created_at: '2026-09-05T10:00:00.000Z',
      },
    ];
  });

  it('picks up failed pictures as well as pending ones, oldest first', async () => {
    const pending = await listImagesNeedingIndex(10);
    // `failed` is included on purpose: a failure is usually a rate limit rather than a fact about
    // the picture, and a run the trader restarts has to pick it up.
    expect(pending.map((entry) => entry.id)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('re-offers a picture stuck in processing, so an interrupted run can finish', async () => {
    const pending = await listImagesNeedingIndex(10);
    expect(pending.some((entry) => entry.id === 'e')).toBe(true);
  });

  it('leaves completed pictures alone', async () => {
    const pending = await listImagesNeedingIndex(10);
    expect(pending.some((entry) => entry.id === 'c')).toBe(false);
  });

  it('honours the requested batch size', async () => {
    expect(await listImagesNeedingIndex(1)).toHaveLength(1);
  });

  it('never offers a picture that carries no label, whatever its status says', async () => {
    // A screenshot brought in from the journal is `pending` from the moment consent exists, and it
    // is still not work: nothing may match on it, so sending it would spend a model call on a chart
    // the engine has already decided it will never use.
    fake.state.tables.memory_images = [
      ...fake.state.tables.memory_images,
      {
        ...imageRow(image({ id: 'unlabelled', role: 'context', indexStatus: 'pending' }), USER, 'obs-1'),
        created_at: '2026-09-06T10:00:00.000Z',
      },
    ];

    const pending = await listImagesNeedingIndex(10);
    expect(pending.some((entry) => entry.id === 'unlabelled')).toBe(false);
  });

  it('offers that picture as soon as the trader has labelled it', async () => {
    fake.state.tables.memory_images = [
      {
        ...imageRow(image({ id: 'labelled', role: 'before-setup' }), USER, 'obs-1'),
        created_at: '2026-09-06T10:00:00.000Z',
      },
    ];

    const pending = await listImagesNeedingIndex(10);
    expect(pending.map((entry) => entry.id)).toEqual(['labelled']);
  });
});

describe('saveImageEmbedding', () => {
  it('writes the vector and its full stamp in one statement', async () => {
    await saveImageEmbedding('img-1', vector());
    const write = fake.state.writes.find((entry) => entry.table === 'memory_images');
    const patch = write?.payload as Record<string, unknown>;
    expect(patch.embedding_model).toBe('gemini-embedding-2');
    expect(patch.embedding_version).toBe(1);
    expect(patch.embedding_dimension).toBe(768);
    expect(patch.indexing_status).toBe('completed');
    expect(patch.indexing_error).toBeNull();
    expect(typeof patch.embedding).toBe('string');
    // Together is the point: a vector without its stamp cannot say what it is comparable with.
    expect(readPgVector(patch.embedding)).toHaveLength(768);
  });
});

describe('createMemoryIndexPort', () => {
  it('records a skip as skipped, with the reason, and not as a failure', async () => {
    await createMemoryIndexPort().markSkipped('img-1', 'The trader declined AI processing.');
    const patch = fake.state.writes[0].payload as Record<string, unknown>;
    expect(patch.indexing_status).toBe('skipped');
    expect(patch.indexing_error).toBe('The trader declined AI processing.');
  });

  it('records a failure as failed', async () => {
    await createMemoryIndexPort().markFailed('img-1', 'HTTP 429');
    const patch = fake.state.writes[0].payload as Record<string, unknown>;
    expect(patch.indexing_status).toBe('failed');
    expect(patch.indexing_error).toBe('HTTP 429');
  });

  it('records processing before the work starts', async () => {
    await createMemoryIndexPort().markProcessing('img-1');
    expect((fake.state.writes[0].payload as Record<string, unknown>).indexing_status).toBe(
      'processing'
    );
  });
});

describe('searchMemoryImages', () => {
  it('names no owner in the RPC arguments', async () => {
    await searchMemoryImages(vector());
    const call = fake.state.rpcCalls[0];
    expect(call.fn).toBe('memory_match_images');
    // The function reads auth.uid(). A user id here would move the boundary into the client, which
    // is the one thing this call must never do.
    expect(JSON.stringify(call.args)).not.toContain(USER);
    expect(call.args.p_user_id).toBeUndefined();
    expect(call.args.user_id).toBeUndefined();
  });

  it('searches only the roles that existed before the decision', async () => {
    await searchMemoryImages(vector());
    // 'after-setup' and 'exit' are excluded: a chart printed after the entry is hindsight, and
    // matching against it would let the search "find" a setup it could not have seen.
    expect(fake.state.rpcCalls[0].args.p_roles).toEqual(['before-setup', 'entry']);
  });

  it('stamps the query with the configuration this build stores', async () => {
    await searchMemoryImages(vector());
    const args = fake.state.rpcCalls[0].args;
    expect(args.p_model).toBe('gemini-embedding-2');
    expect(args.p_version).toBe(1);
    expect(typeof args.p_query).toBe('string');
  });

  it('passes the filters it was given and null for the ones it was not', async () => {
    await searchMemoryImages(vector(), {
      filters: { instrument: 'MES', setupName: 'Opening drive pullback' },
      limit: 5,
    });
    const args = fake.state.rpcCalls[0].args;
    expect(args.p_instrument).toBe('MES');
    expect(args.p_setup_name).toBe('Opening drive pullback');
    expect(args.p_timeframe).toBeNull();
    expect(args.p_session).toBeNull();
    expect(args.p_cutoff).toBeNull();
    expect(args.p_match_count).toBe(5);
  });

  it('reads an inclusive end date as the end of that day, not its start', async () => {
    await searchMemoryImages(vector(), { filters: { toDate: '2026-09-30' } });
    const cutoff = fake.state.rpcCalls[0].args.p_cutoff as string;
    expect(cutoff.startsWith('2026-09-30')).toBe(true);
    // Interpreting it as 00:00 would silently drop the day the trader asked to include.
    expect(cutoff > '2026-09-30T00:00:00.000Z').toBe(true);
  });

  it('lets an explicit replay cutoff win over the date filter', async () => {
    await searchMemoryImages(vector(), {
      filters: { toDate: '2026-09-30' },
      cutoff: '2026-09-15T13:00:00.000Z',
    });
    expect(fake.state.rpcCalls[0].args.p_cutoff).toBe('2026-09-15T13:00:00.000Z');
  });

  it('maps the returned rows into ranked candidates', async () => {
    fake.state.rpcResult = [
      { observation_id: 'obs-1', image_id: 'img-1', image_role: 'entry', cosine_distance: 0.2 },
    ];
    const matches = await searchMemoryImages(vector());
    expect(matches).toHaveLength(1);
    expect(matches[0].observationId).toBe('obs-1');
  });

  it('returns an empty list rather than throwing when nothing is close', async () => {
    fake.state.rpcResult = [];
    expect(await searchMemoryImages(vector())).toEqual([]);
  });
});

describe('explainSchemaError', () => {
  it('says to run schema.sql for a missing table', () => {
    const error = explainSchemaError({ message: 'relation does not exist', code: '42P01' });
    expect(error.message).toContain('supabase/schema.sql');
  });

  it('says the same for a column the schema cache does not have', () => {
    // What PostgREST returns for a write naming a column it cannot find — the code an unknown
    // column actually arrives as, rather than the Postgres one.
    const error = explainSchemaError({
      message: "Could not find the 'updated_at' column of 'memory_searches' in the schema cache",
      code: 'PGRST204',
    });
    expect(error.message).toContain('supabase/schema.sql');
  });

  it('says the same for a missing function, which is what an un-run search gives', () => {
    expect(explainSchemaError({ message: 'Could not find the function', code: 'PGRST202' }).message).toContain(
      'supabase/schema.sql'
    );
  });

  it('passes an unrelated error through with its own words', () => {
    const error = explainSchemaError({ message: 'JWT expired', code: 'PGRST301' });
    expect(error.message).toBe('JWT expired');
  });

  it('explains a missing memory table when the query actually ran', async () => {
    fake.state.missingSchema = true;
    const error = await listImagesNeedingIndex(5).catch((err: unknown) => err);
    expect((error as Error).message).toContain('supabase/schema.sql');
  });
});

// ---------------------------------------------------------------------------
// The schema contract
//
// `supabase/schema.sql` is applied by hand, in another tool, so nothing in this module can compile
// against it: a column the client invents, or a name it spells wrong, is not a type error. It is a
// 400 from PostgREST at the moment the trader clicks, on a write that never happens — and
// `explainSchemaError` reads those codes as "the memory tables are missing", which is the one
// diagnosis that is wrong. That is how `memory_searches.updated_at` survived: the table has only
// ever had `searched_at`, every write of a saved search failed, and nothing above it noticed.
//
// So the schema file is the assertion's source of truth. The tables, their columns and the
// functions' argument names are parsed out of it here, and every write and RPC this module issues is
// checked against them. Deliberately NOT a list of column names copied into the test: a copied list
// drifts in exactly the way the code did.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = readFileSync(
  new URL('../../../../supabase/schema.sql', import.meta.url),
  'utf8'
  // Comments first, so a comma inside one cannot be mistaken for a separator in a column list.
).replace(/--[^\n]*/g, '');

/** The body of the parenthesised list opening at `open`, nesting respected (`vector(768)`). */
function parenBody(sql: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, index);
    }
  }
  throw new Error(`Unbalanced parentheses in schema.sql at offset ${open}`);
}

/** A list's entries, split only at the commas that are not nested inside brackets. */
function listEntries(body: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

/** Anything that starts a table-level clause rather than a column. */
const NOT_A_COLUMN = new Set([
  'constraint',
  'primary',
  'unique',
  'foreign',
  'check',
  'exclude',
  'like',
]);

function columnsFromSchema(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    const columns = tables.get(table) ?? new Set<string>();
    columns.add(column);
    tables.set(table, columns);
  };

  for (const match of sql.matchAll(/create table if not exists public\.(\w+)\s*\(/g)) {
    const body = parenBody(sql, (match.index ?? 0) + match[0].length - 1);
    for (const entry of listEntries(body)) {
      const name = entry.split(/[\s(]/)[0];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      if (NOT_A_COLUMN.has(name.toLowerCase())) continue;
      add(match[1], name);
    }
  }

  // Columns added in place for projects created before they existed.
  for (const match of sql.matchAll(/alter table public\.(\w+)\s+add column if not exists\s+(\w+)/g)) {
    add(match[1], match[2]);
  }

  return tables;
}

function parametersFromSchema(sql: string): Map<string, Set<string>> {
  const functions = new Map<string, Set<string>>();
  for (const match of sql.matchAll(/create or replace function public\.(\w+)\s*\(/g)) {
    const body = parenBody(sql, (match.index ?? 0) + match[0].length - 1);
    const names = new Set<string>();
    for (const entry of listEntries(body)) {
      const name = entry.split(/\s+/)[0];
      // A mode keyword would make the first token the mode rather than the name.
      if (/^(in|out|inout|variadic)$/i.test(name)) continue;
      names.add(name);
    }
    functions.set(match[1], names);
  }
  return functions;
}

/** One saved search, with a verdict-ready match on it. */
function savedSearch(): MemorySearch {
  return {
    id: 'search-1',
    userId: 'somebody-else',
    searchedAt: '2026-09-01T14:00:00.000Z',
    queryChecksum: 'abc123',
    filters: { instrument: 'MES' },
    embeddingModel: 'gemini-embedding-2',
    embeddingVersion: 1,
    resemblanceFloor: 0.62,
    matches: [
      {
        observationId: 'obs-1',
        imageId: 'img-1',
        role: 'entry',
        resemblance: 0.81,
        cosineDistance: 0.19,
        observedAt: '2026-09-01T13:45:00.000Z',
        instrument: 'MES',
      },
    ],
  };
}

describe('the schema contract', () => {
  const columns = columnsFromSchema(SCHEMA_SQL);
  const parameters = parametersFromSchema(SCHEMA_SQL);

  it('reads the real tables and functions out of schema.sql', () => {
    // Without these three the assertions below could pass on an empty parse of the wrong file.
    expect(columns.get('trading_observations')?.has('observed_at_source')).toBe(true);
    expect(columns.get('memory_searches')?.has('searched_at')).toBe(true);
    // Added by an `alter table`, three statements below the table it belongs to.
    expect(columns.get('journal_snapshots')?.has('revision')).toBe(true);
    expect(parameters.get('memory_match_images')?.has('p_cutoff')).toBe(true);
  });

  it('writes only columns that schema.sql creates', async () => {
    // One of every write this module performs, so the check below has something to check.
    await upsertObservations([observation({ images: [image()] })]);
    await upsertObservationOutcome('obs-1', { status: 'unknown', source: 'unknown' });
    await saveImageEmbedding('img-1', vector());
    const port = createMemoryIndexPort();
    await port.markProcessing('img-1');
    await port.markFailed('img-1', 'HTTP 429 from the provider');
    await saveMemorySearch(savedSearch());
    // Recorded against the row the write above just saved, because a verdict on a search that is no
    // longer stored cannot be recorded at all.
    await setMatchFeedback('search-1', 'obs-1', 'partial');
    await createIndexJob('backfill', 3);
    await updateIndexJob('job-1', {
      status: 'completed',
      cursor: 'obs-9',
      finishedAt: '2026-09-01T15:00:00.000Z',
    });

    // A run that wrote nothing would satisfy the loop below without checking anything.
    expect(fake.state.writes.length).toBeGreaterThanOrEqual(7);

    for (const write of fake.state.writes) {
      const known = columns.get(write.table);
      expect(known, `schema.sql creates no table public.${write.table}`).toBeDefined();
      const rows = Array.isArray(write.payload) ? write.payload : [write.payload];
      for (const row of rows) {
        const unknown = Object.keys(row).filter((key) => !known?.has(key));
        // PostgREST rejects the ENTIRE statement over one unknown column, so this is not a warning.
        expect(
          unknown,
          `public.${write.table} has no column ${unknown.join(', ')} — PostgREST refuses the whole ${write.op}`
        ).toEqual([]);
      }
    }
  });

  it('calls the search functions with the argument names schema.sql declares', async () => {
    await searchMemoryImages(vector());
    await pruneMemorySearches(90);

    expect(fake.state.rpcCalls).toHaveLength(2);
    for (const call of fake.state.rpcCalls) {
      const declared = parameters.get(call.fn);
      expect(declared, `schema.sql creates no function public.${call.fn}`).toBeDefined();
      const unknown = Object.keys(call.args).filter((key) => !declared?.has(key));
      // PostgREST matches an RPC by argument NAME, so one misspelt key is a function not found.
      expect(
        unknown,
        `public.${call.fn} has no argument ${unknown.join(', ')} — PostgREST reports no such function`
      ).toEqual([]);
    }
  });
});
