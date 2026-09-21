import {
  isJournalConflictError,
  loadJournal,
  overwriteJournal,
  saveJournal,
} from './cloud-sync';
import type { StorageState } from './storage';

/**
 * The one path a journal takes to the cloud.
 *
 * Two rules live here, and both came out of the same morning: a trader spent eight minutes
 * filling in a plan, was shown a box asking whether to keep "this device's copy" or "the
 * cloud copy", picked the cloud one, and watched the plan disappear.
 *
 * The box was a lie. Nothing had touched the journal from another device. This device's own
 * saves had raced each other: the debounce does not cancel a write already in flight, so two
 * writes could both carry the revision this device last read — and the second of the pair was
 * refused by the first, which the app then reported as another device's change.
 *
 * So: writes are chained, and a refusal is resolved rather than handed to the trader.
 */

/** `saved` also covers "there was somebody else's newer copy, and this one has replaced it". */
export type SaveOutcome = 'saved' | 'error';

export interface JournalSaverDeps {
  userId: string;
  /** The journal as it stands at write time, not as it stood when the save was queued. */
  readState: () => StorageState;
  /** The revision this device last read or wrote. */
  readRevision: () => number | null;
  /** Records the revision a write landed on. */
  writeRevision: (revision: number) => void;
  /**
   * Called with the cloud copy a refusal was about to overwrite, so the caller can keep it
   * as a recovery copy. The copy being replaced is the only thing this path can destroy.
   */
  onRemoteReplaced?: (remote: StorageState | null) => void;
}

export type JournalSaver = () => Promise<SaveOutcome>;

/**
 * Builds the serialised saver.
 *
 * Every call queues behind the previous write instead of starting a second one, so each
 * write begins from the revision the last one landed on. That is what removes the
 * self-inflicted conflict: this device can no longer refuse its own save.
 *
 * A refusal that survives that — a genuine write from another device — is resolved here by
 * writing this device's copy over it, because this is the copy the trader is looking at and
 * typing into. The replaced copy is handed to `onRemoteReplaced` first, so resolving can
 * never be the reason work is gone for good. Nothing is ever put to the trader mid-edit.
 */
export function createJournalSaver({
  userId,
  readState,
  readRevision,
  writeRevision,
  onRemoteReplaced,
}: JournalSaverDeps): JournalSaver {
  /** The write in flight. Never rejects: the outcome is the value. */
  let inFlight: Promise<SaveOutcome> = Promise.resolve('saved');

  const write = async (): Promise<SaveOutcome> => {
    // Read both at write time, after any queued write has already landed.
    const state = readState();

    try {
      writeRevision(await saveJournal(userId, state, readRevision()));
      return 'saved';
    } catch (error) {
      if (!isJournalConflictError(error)) {
        console.error('Cloud journal save failed:', error);
        return 'error';
      }

      try {
        const remote = await loadJournal(userId);
        onRemoteReplaced?.(remote?.state ?? null);
        writeRevision(await overwriteJournal(userId, state));
        return 'saved';
      } catch (retryError) {
        console.error('Cloud journal overwrite failed:', retryError);
        return 'error';
      }
    }
  };

  return () => {
    const run = inFlight.then(write).catch((): SaveOutcome => 'error');
    inFlight = run;
    return run;
  };
}

/**
 * How many of this device's records the incoming cloud copy does not have at all.
 *
 * Adopting a cloud copy on sign-in is the one moment a sync can overwrite work this
 * device is holding, and this is the test for whether it would.
 *
 * Presence is what counts, deliberately, not value. A record the cloud also holds but in
 * an older version is just the state the cloud has moved past — syncing to the newer copy
 * is the point, not a loss — and flagging it would put a recovery notice in front of a
 * trader every single time they moved from one device to another. What this is looking for
 * is the other thing: records that exist only here, which is what a save that never
 * reached the cloud leaves behind.
 *
 * Deliberately looks only at records with an `id` (days, trades, reviews). Pattern studies
 * are keyed by pattern rather than by id and are playbook material rather than journal
 * entries, so they are not what a lost morning consists of.
 */
export function countLocalOnlyRecords(local: StorageState, remote: StorageState): number {
  let count = 0;

  const compare = <T extends { id: string }>(mine: T[] = [], theirs: T[] = []) => {
    const theirsById = new Set(theirs.map((record) => record.id));
    for (const record of mine) {
      if (!theirsById.has(record.id)) count += 1;
    }
  };

  compare(local.tradingDays, remote.tradingDays);
  compare(local.trades, remote.trades);
  compare(local.reviews, remote.reviews);

  return count;
}
