import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JournalConflictError } from '../cloud-sync';
import { countLocalOnlyRecords, createJournalSaver } from '../journal-sync';
import type { StorageState } from '../storage';

/**
 * A fake cloud that behaves like PostgREST for the revision guard: an update whose
 * `revision` filter no longer matches updates nothing and returns an empty array, a
 * duplicate insert is a unique violation, and an upsert always wins.
 *
 * `gate` lets a test hold a write open, which is how the original bug is reproduced:
 * the debounce never cancelled a write already in flight, so two writes could both
 * carry the revision this device last read.
 */
const cloud = vi.hoisted(() => {
  interface Row {
    user_id: string;
    data: unknown;
    revision: number;
    updated_at: string;
  }

  const state = {
    rows: [] as Row[],
    /** A promise a test can resolve to release a held write. */
    gate: null as Promise<void> | null,
    /** Every write that reached the cloud, for assertions about ordering. */
    writes: [] as number[],
    /** Makes every write fail with a transport error rather than a revision refusal. */
    failWrites: false,
  };

  function from() {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Partial<Row> | null = null;

    async function run() {
      if (state.gate) await state.gate;
      if (state.failWrites && op !== 'select') {
        return { data: null, error: { message: 'network unreachable', code: '08006' } };
      }

      if (op === 'insert') {
        if (state.rows.some((row) => row.user_id === payload!.user_id)) {
          return { data: null, error: { message: 'duplicate key', code: '23505' } };
        }
        state.rows.push(payload as Row);
        state.writes.push(payload!.revision ?? 1);
        return { data: null, error: null };
      }

      if (op === 'update') {
        const index = state.rows.findIndex(
          (row) => row.user_id === filters.user_id && row.revision === filters.revision
        );
        if (index < 0) return { data: [], error: null };
        state.rows[index] = { ...state.rows[index], ...(payload as Row) };
        state.writes.push(state.rows[index].revision);
        return { data: [{ revision: state.rows[index].revision }], error: null };
      }

      if (op === 'upsert') {
        const index = state.rows.findIndex((row) => row.user_id === payload!.user_id);
        if (index < 0) state.rows.push(payload as Row);
        else state.rows[index] = { ...state.rows[index], ...(payload as Row) };
        state.writes.push(payload!.revision ?? 1);
        return { data: null, error: null };
      }

      return { data: null, error: null };
    }

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      insert: (values: Partial<Row>) => {
        op = 'insert';
        payload = values;
        return builder;
      },
      update: (values: Partial<Row>) => {
        op = 'update';
        payload = values;
        return builder;
      },
      upsert: (values: Partial<Row>) => {
        op = 'upsert';
        payload = values;
        return builder;
      },
      maybeSingle: async () => {
        const row = state.rows.find((candidate) => candidate.user_id === filters.user_id) ?? null;
        return { data: row, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        run().then(resolve, reject),
    };

    return builder;
  }

  return { state, from };
});

vi.mock('../supabase', () => ({
  supabase: { from: cloud.from },
}));

const USER = 'user-1';

function journal(overrides: Partial<StorageState> = {}): StorageState {
  return {
    profile: { id: USER, displayName: 'Trader' } as StorageState['profile'],
    instruments: [],
    setups: [],
    tradingDays: [],
    trades: [],
    reviews: [],
    ...overrides,
  };
}

/** Builds a saver over a mutable revision, the way App holds it in a ref. */
function makeSaver(options: { revision: number | null; state?: StorageState }) {
  const held = { revision: options.revision, state: options.state ?? journal() };
  const replaced: Array<StorageState | null> = [];
  const saver = createJournalSaver({
    userId: USER,
    readState: () => held.state,
    readRevision: () => held.revision,
    writeRevision: (revision) => {
      held.revision = revision;
    },
    onRemoteReplaced: (remote) => replaced.push(remote),
  });
  return { saver, held, replaced };
}

beforeEach(() => {
  cloud.state.rows = [];
  cloud.state.gate = null;
  cloud.state.writes = [];
  cloud.state.failWrites = false;
});

describe('createJournalSaver', () => {
  it('saves a journal and records the revision the write landed on', async () => {
    const { saver, held } = makeSaver({ revision: null });

    await expect(saver()).resolves.toBe('saved');
    expect(held.revision).toBe(1);
  });

  it('does not let this device refuse its own save when two writes overlap', async () => {
    // The original bug: both writes started from revision 1, so the second matched nothing
    // and the app reported it as another device's change — stopping all saving until the
    // trader chose between two copies of their own journal.
    const seed = journal();
    cloud.state.rows.push({
      user_id: USER,
      data: seed,
      revision: 1,
      updated_at: new Date().toISOString(),
    });

    const { saver, held } = makeSaver({ revision: 1 });

    // Hold the first write open, then queue a second one behind it — exactly what a
    // debounce over a slow save used to do.
    let release!: () => void;
    cloud.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = saver();
    const second = saver();

    cloud.state.gate = null;
    release();

    await expect(first).resolves.toBe('saved');
    await expect(second).resolves.toBe('saved');

    // Both writes were accepted, each from the revision the last one landed on.
    expect(cloud.state.writes).toEqual([2, 3]);
    expect(held.revision).toBe(3);
  });

  it('reads the journal at write time, not when the save was queued', async () => {
    const { saver, held } = makeSaver({ revision: null });

    let release!: () => void;
    cloud.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = saver();

    // An edit lands while the first write is still in flight.
    held.state = journal({ trades: [{ id: 'trade-late' }] as StorageState['trades'] });

    cloud.state.gate = null;
    release();
    await pending;

    const queued = saver();
    await queued;

    expect(cloud.state.rows[0].data).toMatchObject({ trades: [{ id: 'trade-late' }] });
  });

  it('resolves a genuine refusal by this device and keeps the copy it replaced', async () => {
    // Another device moved the row to revision 4 while this one still held revision 2.
    const otherDevice = journal({ trades: [{ id: 'from-the-phone' }] as StorageState['trades'] });
    cloud.state.rows.push({
      user_id: USER,
      data: otherDevice,
      revision: 4,
      updated_at: new Date().toISOString(),
    });

    const mine = journal({ trades: [{ id: 'from-the-desktop' }] as StorageState['trades'] });
    const { saver, held, replaced } = makeSaver({ revision: 2, state: mine });

    // No throw, no prompt: it saves, and the trader's work is what lands.
    await expect(saver()).resolves.toBe('saved');

    expect(cloud.state.rows[0].data).toMatchObject({ trades: [{ id: 'from-the-desktop' }] });
    expect(held.revision).toBe(5);
    // The replaced copy was handed back rather than destroyed.
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ trades: [{ id: 'from-the-phone' }] });
  });

  it('reports a plain write failure as an error, leaving the revision untouched', async () => {
    const { saver, held } = makeSaver({ revision: 1 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    cloud.state.failWrites = true;

    await expect(saver()).resolves.toBe('error');

    // Nothing landed, so the device still believes it is at revision 1 and can retry.
    expect(held.revision).toBe(1);
    consoleError.mockRestore();
  });

  it('survives a failure on the recovery read, still reporting an error not a throw', async () => {
    // A conflict whose remote read also fails must not reject: the caller keys off the
    // outcome, and an unhandled rejection here would be an unhandled rejection in App.
    cloud.state.rows.push({
      user_id: USER,
      data: journal(),
      revision: 9,
      updated_at: new Date().toISOString(),
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saver = createJournalSaver({
      userId: USER,
      readState: () => journal(),
      readRevision: () => 1,
      writeRevision: () => {
        throw new Error('recording the revision failed');
      },
    });

    await expect(saver()).resolves.toBe('error');
    consoleError.mockRestore();
  });

  it('keeps serving writes after a failure instead of wedging the queue', async () => {
    const { saver } = makeSaver({ revision: null });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    cloud.state.failWrites = true;
    await expect(saver()).resolves.toBe('error');

    cloud.state.failWrites = false;
    await expect(saver()).resolves.toBe('saved');

    expect(new JournalConflictError(1).name).toBe('JournalConflictError');
    consoleError.mockRestore();
  });
});

describe('countLocalOnlyRecords', () => {
  it('is zero when the cloud already holds everything this device has', () => {
    const state = journal({
      trades: [{ id: 'a' }, { id: 'b' }] as StorageState['trades'],
      tradingDays: [{ id: 'day-1' }] as StorageState['tradingDays'],
    });

    expect(countLocalOnlyRecords(state, JSON.parse(JSON.stringify(state)))).toBe(0);
  });

  it('counts records the cloud copy does not have at all', () => {
    const local = journal({ trades: [{ id: 'a' }, { id: 'b' }] as StorageState['trades'] });
    const remote = journal({ trades: [{ id: 'a' }] as StorageState['trades'] });

    expect(countLocalOnlyRecords(local, remote)).toBe(1);
  });

  it('does not count an older version of a record the cloud already has', () => {
    // The common case of switching devices: the cloud moved a record on, so this device's
    // copy differs. Adopting the cloud copy is the sync working, not a loss, and counting
    // it would raise a recovery notice on every device switch.
    const local = journal({
      trades: [{ id: 'a', notes: 'older' }] as StorageState['trades'],
    });
    const remote = journal({
      trades: [{ id: 'a', notes: 'edited elsewhere' }] as StorageState['trades'],
    });

    expect(countLocalOnlyRecords(local, remote)).toBe(0);
  });

  it('counts a record that exists only here, which is a save that never landed', () => {
    const local = journal({
      trades: [
        { id: 'a' },
        { id: 'never-synced' },
      ] as StorageState['trades'],
    });
    const remote = journal({ trades: [{ id: 'a' }] as StorageState['trades'] });

    expect(countLocalOnlyRecords(local, remote)).toBe(1);
  });

  it('ignores records only the cloud has, since adopting it destroys none of this device', () => {
    const local = journal({ trades: [] });
    const remote = journal({ trades: [{ id: 'theirs' }] as StorageState['trades'] });

    expect(countLocalOnlyRecords(local, remote)).toBe(0);
  });

  it('treats a missing remote list as empty rather than as an error', () => {
    const local = journal({
      trades: [{ id: 'a' }] as StorageState['trades'],
      reviews: [{ id: 'r1' }] as StorageState['reviews'],
    });

    expect(countLocalOnlyRecords(local, journal())).toBe(2);
  });
});
