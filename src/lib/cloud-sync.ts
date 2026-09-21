import { supabase } from './supabase';
import { StorageState } from './storage';

/**
 * Cloud persistence for the journal snapshot.
 *
 * The journal is stored as one JSON document per user, which keeps loading and
 * saving trivial. The cost of that shape is that two devices writing at the
 * same time would overwrite each other wholesale, with the loser's work gone
 * and no trace of it. So every write is conditional on the `revision` the
 * client last read: the row only accepts the write if nobody has moved it on
 * since. A refused write surfaces as `JournalConflictError`, which the saver in
 * `journal-sync.ts` resolves on the trader's behalf: this device's copy is written,
 * and the copy it replaced is kept aside rather than lost. Nothing is ever put to the
 * trader mid-edit.
 */

/** A journal plus the revision it was read at. */
export interface JournalSnapshot {
  state: StorageState;
  /** Incremented on every accepted write; the token that makes a save safe. */
  revision: number;
}

/**
 * Raised when the cloud copy moved on after this device last read it, so the
 * write was refused rather than allowed to flatten the other device's work.
 */
export class JournalConflictError extends Error {
  /** Revision currently on the server, for the report and the next attempt. */
  readonly remoteRevision: number;

  constructor(remoteRevision: number) {
    super('The cloud copy of this journal was changed by another device.');
    this.name = 'JournalConflictError';
    this.remoteRevision = remoteRevision;
  }
}

export function isJournalConflictError(error: unknown): error is JournalConflictError {
  return error instanceof JournalConflictError;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

/**
 * Turns a Postgres error into something the trader can act on.
 *
 * The revision guard needs a column that older deployments do not have yet, so
 * a missing-column failure is far more likely to mean "schema.sql has not been
 * re-run" than anything exotic — say so rather than surfacing a bare SQL error.
 */
function explainSchemaError(error: { message?: string; code?: string }): Error {
  const message = error?.message ?? 'Unknown Supabase error.';
  const mentionsRevision = /revision/i.test(message);
  const looksLikeMissingColumn =
    error?.code === '42703' || /column .* does not exist|schema cache/i.test(message);

  if (mentionsRevision && looksLikeMissingColumn) {
    return new Error(
      'The journal_snapshots table has no `revision` column yet. Open the Supabase SQL ' +
        'editor and run supabase/schema.sql again (it only adds what is missing), then retry.'
    );
  }
  return new Error(message);
}

/** Postgres unique-violation: another device inserted the row first. */
const UNIQUE_VIOLATION = '23505';

/** The stored journal, or null when this user has never saved one. */
export async function loadJournal(userId: string): Promise<JournalSnapshot | null> {
  const client = requireClient();

  const { data, error } = await client
    .from('journal_snapshots')
    .select('data, revision')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw explainSchemaError(error);
  if (!data?.data) return null;

  return {
    state: data.data as StorageState,
    // Rows written before the revision column existed default to 1.
    revision: Number(data.revision ?? 1),
  };
}

/** Seeds the cloud from this device's journal. Returns the new revision. */
async function insertJournal(userId: string, state: StorageState): Promise<number> {
  const client = requireClient();

  const { error } = await client.from('journal_snapshots').insert({
    user_id: userId,
    data: state,
    revision: 1,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const remote = await loadJournal(userId);
      throw new JournalConflictError(remote?.revision ?? 1);
    }
    throw explainSchemaError(error);
  }

  return 1;
}

/**
 * Loads the cloud journal, seeding it from `localState` on the very first run
 * so an existing local-only journal is not thrown away.
 */
export async function loadOrMigrateJournal(
  userId: string,
  localState: StorageState,
): Promise<JournalSnapshot> {
  const existing = await loadJournal(userId);
  if (existing) return existing;

  const revision = await insertJournal(userId, localState);
  return { state: localState, revision };
}

/**
 * Writes the journal, but only if the cloud copy is still at `expectedRevision`.
 *
 * Returns the new revision. Throws `JournalConflictError` when another device
 * has written since — the caller must resolve that with the trader rather than
 * retry blindly, because a blind retry is exactly the overwrite this prevents.
 */
export async function saveJournal(
  userId: string,
  state: StorageState,
  expectedRevision: number | null,
): Promise<number> {
  // No revision means this device has never read the row: it is an insert, and
  // a collision there means another device created it first.
  if (expectedRevision === null) return insertJournal(userId, state);

  const client = requireClient();
  const nextRevision = expectedRevision + 1;

  const { data, error } = await client
    .from('journal_snapshots')
    .update({
      data: state,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('revision', expectedRevision)
    .select('revision');

  if (error) throw explainSchemaError(error);

  // The row-level guard matched nothing: the revision moved on (or the row was
  // deleted on another device). Refuse the write and report where the cloud is.
  if (!data || data.length === 0) {
    const remote = await loadJournal(userId);
    throw new JournalConflictError(remote?.revision ?? 0);
  }

  return nextRevision;
}

/**
 * Unconditional write, used only when the trader has explicitly chosen this
 * device's journal over the cloud copy. It is the old last-write-wins
 * behaviour, kept for that one deliberate case.
 */
export async function overwriteJournal(userId: string, state: StorageState): Promise<number> {
  const client = requireClient();

  const remote = await loadJournal(userId);
  const revision = (remote?.revision ?? 0) + 1;

  const { error } = await client.from('journal_snapshots').upsert(
    {
      user_id: userId,
      data: state,
      revision,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) throw explainSchemaError(error);
  return revision;
}
