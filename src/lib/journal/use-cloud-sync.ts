import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../storage';
import type { StorageState } from '../storage';
import { loadOrMigrateJournal, overwriteJournal } from '../cloud-sync';
import { countLocalOnlyRecords, createJournalSaver } from '../journal-sync';
import type { SyncStatus } from '../../components/layout/SyncStatusBadge';
import { describeSyncFailure } from './describe-sync-failure';

export interface CloudSyncDeps {
  userId: string;
  /** False in a local-only build: nothing here runs, and the status is 'local'. */
  cloudEnabled: boolean;
  /** The journal as it stands. Used as the trigger for the debounced save. */
  currentState: StorageState;
  /** The same journal, reachable at write time without re-running the save effect. */
  currentStateRef: { current: StorageState };
  /** Adopts a cloud snapshot as the whole journal. */
  applyJournalState: (next: StorageState) => void;
  /** Called when the initial load fails, so the shell can surface it once. */
  onLoadError: (message: string) => void;
}

export interface CloudSync {
  cloudReady: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: Date | null;
  /** Re-runs a save the trader asked for after a failure. */
  retrySave: () => Promise<void>;
  /** Flushes a final save. True when the cloud copy is up to date. */
  flushPendingSave: () => Promise<boolean>;
  /** Unconditional write of the whole journal — the "start fresh" reset. */
  overwriteCloud: (state: StorageState) => Promise<void>;
}

/**
 * Everything that talks to the cloud: the initial load, the debounced save, and the two
 * places a write is made on purpose rather than by an edit.
 *
 * Extracted from App so the shell holds state and renders it, while the rules that protect a
 * journal in flight — serialised writes, a conflict resolved in the trader's favour with the
 * replaced copy set aside — live in one file next to `journal-sync.ts`, which they share.
 */
export function useCloudSync({
  userId,
  cloudEnabled,
  currentState,
  currentStateRef,
  applyJournalState,
  onLoadError,
}: CloudSyncDeps): CloudSync {
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudEnabled ? 'loading' : 'local');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // The cloud revision this device last read or wrote. Kept in a ref, not state,
  // because a successful save changing state would re-run the save effect and
  // loop forever.
  const cloudRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    (async () => {
      try {
        const snapshot = await loadOrMigrateJournal(userId, currentStateRef.current);
        if (!active) return;
        // Adopting the cloud copy is the one moment a sync can overwrite work this
        // device is holding, so anything the cloud does not already have is set aside
        // first. It costs a check on sign-in and nothing in normal use, where the two
        // copies agree.
        const localOnly = countLocalOnlyRecords(currentStateRef.current, snapshot.state);
        if (localOnly > 0) {
          storage.saveRecoveryCopy(
            JSON.stringify(currentStateRef.current),
            `This device was holding ${localOnly} ${
              localOnly === 1 ? 'record' : 'records'
            } the cloud copy did not have when it signed in and downloaded the cloud copy over them.`
          );
        }
        cloudRevisionRef.current = snapshot.revision;
        applyJournalState(snapshot.state);
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } catch (error) {
        console.error('Cloud journal load failed:', error);
        setSyncStatus('error');
        onLoadError(
          describeSyncFailure(error, 'Cloud sync is unavailable. Your local journal is still available.')
        );
      } finally {
        if (active) setCloudReady(true);
      }
    })();
    return () => { active = false; };
  }, [cloudEnabled, userId, applyJournalState, currentStateRef, onLoadError]);

  /**
   * The one path the journal takes to the cloud.
   *
   * Writes are serialised rather than fired in parallel: the debounce below does not
   * cancel a write already in flight, so two saves could both carry the revision this
   * device last read and the second was refused by the first — reported to the trader as
   * another device's change when it was this device refusing itself.
   *
   * A refusal that survives that (a genuine write from another device) is resolved here
   * by saving this device's copy, which is the one being typed into. The copy it replaces
   * is set aside first, so resolving is never the reason work is gone.
   */
  const persistJournal = useMemo(
    () =>
      createJournalSaver({
        userId,
        readState: () => currentStateRef.current,
        readRevision: () => cloudRevisionRef.current,
        writeRevision: (revision) => {
          cloudRevisionRef.current = revision;
        },
        onRemoteReplaced: (remote) => {
          if (!remote) return;
          storage.saveRecoveryCopy(
            JSON.stringify(remote),
            'A save from this device replaced it while syncing — it had been written by another device.'
          );
        },
      }),
    [userId, currentStateRef]
  );

  // `currentState` is not read in the body: it is the trigger. Any journal edit
  // produces a new object here and schedules the debounced save below.
  useEffect(() => {
    if (!cloudEnabled || !cloudReady) return;
    setSyncStatus('saving');
    const timeout = window.setTimeout(async () => {
      const result = await persistJournal();
      if (result === 'saved') {
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } else {
        setSyncStatus('error');
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cloudEnabled, cloudReady, persistJournal, currentState]);

  const retrySave = useCallback(async () => {
    if (!cloudEnabled) return;
    setSyncStatus('saving');
    const result = await persistJournal();
    if (result === 'saved') {
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } else {
      setSyncStatus('error');
    }
  }, [cloudEnabled, persistJournal]);

  /**
   * Flushes the journal before sign-out. False means the final save did not land, which is
   * what stops the local copy being cleared out from under a session that is not in the cloud.
   */
  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (!cloudEnabled || !cloudReady) return true;
    setSyncStatus('saving');
    const result = await persistJournal();
    if (result === 'saved') {
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
      return true;
    }
    setSyncStatus('error');
    return false;
  }, [cloudEnabled, cloudReady, persistJournal]);

  /**
   * Unconditional write of the whole journal, used only by the deliberate "start fresh" reset:
   * the emptied journal must not sit locally while the cloud still holds everything the trader
   * just wiped, so this takes the last-write-wins path rather than the revision-guarded one.
   */
  const overwriteCloud = useCallback(
    async (state: StorageState) => {
      if (cloudEnabled && cloudReady) {
        cloudRevisionRef.current = await overwriteJournal(userId, state);
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
        return;
      }
      setSyncStatus(cloudEnabled ? 'saved' : 'local');
      setLastSyncedAt(cloudEnabled ? new Date() : null);
    },
    [cloudEnabled, cloudReady, userId]
  );

  return { cloudReady, syncStatus, lastSyncedAt, retrySave, flushPendingSave, overwriteCloud };
}
