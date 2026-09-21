import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  JournalConflictError,
  isJournalConflictError,
  loadJournal,
  loadOrMigrateJournal,
  overwriteJournal,
  saveJournal,
} from '../cloud-sync';
import type { StorageState } from '../storage';

// ---------------------------------------------------------------------------
// A fake Supabase that behaves like the real one *for the revision guard*:
// an update whose `revision` filter no longer matches updates nothing and
// returns an empty array (which is what RLS-scoped PostgREST does), and a
// duplicate insert returns Postgres' unique-violation code.
//
// The tests below exist to pin down the one behaviour that matters: a save
// made from stale data must be refused, not applied.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => {
  interface Row {
    user_id: string;
    data: unknown;
    revision: number;
    updated_at: string;
  }

  const state = {
    rows: [] as Row[],
    /** Simulates a project where schema.sql has not been re-run yet. */
    missingRevisionColumn: false,
  };

  const missingColumnError = () => ({
    message: 'column journal_snapshots.revision does not exist',
    code: '42703',
  });

  function from() {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Partial<Row> | null = null;

    async function run() {
      if (state.missingRevisionColumn) {
        return { data: null, error: missingColumnError() };
      }

      if (op === 'insert') {
        if (state.rows.some((row) => row.user_id === payload!.user_id)) {
          return {
            data: null,
            error: {
              message: 'duplicate key value violates unique constraint "journal_snapshots_pkey"',
              code: '23505',
            },
          };
        }
        state.rows.push(payload as Row);
        return { data: null, error: null };
      }

      if (op === 'update') {
        const index = state.rows.findIndex(
          (row) => row.user_id === filters.user_id && row.revision === filters.revision,
        );
        // Nothing matched the revision we expected: the cloud moved on.
        if (index < 0) return { data: [], error: null };
        state.rows[index] = { ...state.rows[index], ...(payload as Row) };
        return { data: [{ revision: state.rows[index].revision }], error: null };
      }

      if (op === 'upsert') {
        const index = state.rows.findIndex((row) => row.user_id === payload!.user_id);
        if (index < 0) state.rows.push(payload as Row);
        else state.rows[index] = { ...state.rows[index], ...(payload as Row) };
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
        if (state.missingRevisionColumn) return { data: null, error: missingColumnError() };
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
  supabase: { from: fake.from },
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

/** Puts a row in the fake table without going through the code under test. */
function seedRow(revision: number, data: StorageState = journal()) {
  fake.state.rows.push({
    user_id: USER,
    data,
    revision,
    updated_at: new Date().toISOString(),
  });
}

beforeEach(() => {
  fake.state.rows = [];
  fake.state.missingRevisionColumn = false;
});

describe('loadJournal', () => {
  it('returns null when this user has never saved a journal', async () => {
    expect(await loadJournal(USER)).toBeNull();
  });

  it('returns the stored journal with its revision', async () => {
    seedRow(7);
    const snapshot = await loadJournal(USER);
    expect(snapshot?.revision).toBe(7);
  });

  it('treats a pre-migration row without a revision as revision 1', async () => {
    fake.state.rows.push({
      user_id: USER,
      data: journal(),
      revision: undefined as unknown as number,
      updated_at: new Date().toISOString(),
    });
    expect((await loadJournal(USER))?.revision).toBe(1);
  });
});

describe('loadOrMigrateJournal', () => {
  it('seeds the cloud from the local journal on the very first run', async () => {
    const local = journal();
    const snapshot = await loadOrMigrateJournal(USER, local);
    expect(snapshot.revision).toBe(1);
    expect(fake.state.rows).toHaveLength(1);
  });

  it('never overwrites a cloud journal that already exists', async () => {
    const cloud = journal({ setups: [] });
    seedRow(4, cloud);

    const snapshot = await loadOrMigrateJournal(USER, journal());

    expect(snapshot.revision).toBe(4);
    expect(fake.state.rows).toHaveLength(1);
    expect(fake.state.rows[0].revision).toBe(4);
  });
});

describe('saveJournal', () => {
  it('accepts a write made from the current revision and bumps it', async () => {
    seedRow(2);

    const revision = await saveJournal(USER, journal(), 2);

    expect(revision).toBe(3);
    expect(fake.state.rows[0].revision).toBe(3);
  });

  it('refuses a write made from a stale revision instead of the other device being flattened', async () => {
    seedRow(3);

    // This device still thinks the cloud is at revision 2.
    await expect(saveJournal(USER, journal(), 2)).rejects.toBeInstanceOf(JournalConflictError);

    // And the other device's journal is untouched.
    expect(fake.state.rows[0].revision).toBe(3);
  });

  it('reports the revision the cloud is actually on, so the choice can be retried', async () => {
    seedRow(9);

    const error = await saveJournal(USER, journal(), 1).catch((err: unknown) => err);

    expect(isJournalConflictError(error)).toBe(true);
    expect((error as JournalConflictError).remoteRevision).toBe(9);
  });

  it('refuses a save when the row was deleted on another device', async () => {
    const error = await saveJournal(USER, journal(), 5).catch((err: unknown) => err);
    expect(isJournalConflictError(error)).toBe(true);
  });

  it('inserts with revision 1 when this device has never read the row', async () => {
    expect(await saveJournal(USER, journal(), null)).toBe(1);
    expect(fake.state.rows[0].revision).toBe(1);
  });

  it('reports a conflict when another device inserted the row first', async () => {
    seedRow(1);
    const error = await saveJournal(USER, journal(), null).catch((err: unknown) => err);
    expect(isJournalConflictError(error)).toBe(true);
    expect((error as JournalConflictError).remoteRevision).toBe(1);
  });

  it('applies a retry once the caller adopts the reported revision', async () => {
    seedRow(3);
    const error = (await saveJournal(USER, journal(), 2).catch((err: unknown) => err)) as
      JournalConflictError;

    const revision = await saveJournal(USER, journal(), error.remoteRevision);

    expect(revision).toBe(4);
  });
});

describe('overwriteJournal', () => {
  it('wins regardless of revision, which is what an explicit choice needs', async () => {
    seedRow(12);
    expect(await overwriteJournal(USER, journal())).toBe(13);
    expect(fake.state.rows[0].revision).toBe(13);
  });

  it('creates the row when the other device deleted it', async () => {
    expect(await overwriteJournal(USER, journal())).toBe(1);
    expect(fake.state.rows).toHaveLength(1);
  });
});

describe('missing revision column', () => {
  it('says to re-run schema.sql rather than reporting a bare SQL error', async () => {
    fake.state.missingRevisionColumn = true;

    const error = await loadJournal(USER).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('supabase/schema.sql');
    // Crucially not a conflict: nothing was overwritten, the app just cannot guard.
    expect(isJournalConflictError(error)).toBe(false);
  });
});
