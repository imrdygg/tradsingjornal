import React, { createContext, useContext, useMemo } from 'react';
import type { JournalFile, LevelPatch, LevelRecord, NewLevelInput } from '../../lib/mes/types';
import type { MesPlaybookBridge } from '../../lib/mes/playbook-bridge';
import { normalizeMesLevel, sanitizeLevel } from '../../lib/mes/analytics';
import { buildDemoLevels } from '../../lib/mes/demo';
import { newId } from '../../lib/mes/utils';

/**
 * The tracker's own little store, so every screen can read and write the record the same
 * way without each one being handed the whole journal.
 *
 * It is a thin skin over the journal's own state: `records` is the app's live list and
 * `persist` writes the next list through storage and updates that state, so the record
 * syncs to the cloud and back up with everything else. The store owns two things the views
 * must never do themselves — stamping ids/timestamps, and sanitising a write so a level
 * with impossible timing can never be saved.
 */
export interface MesJournal {
  records: LevelRecord[];
  addLevel(input: NewLevelInput): LevelRecord;
  updateLevel(id: string, patch: LevelPatch): void;
  deleteLevel(id: string): void;
  replaceAll(records: unknown[]): void;
  clearAll(): void;
  loadDemo(): void;
  /** Replaces the whole record from a backup file; resolves to the number imported. */
  importFile(file: File): Promise<number>;
  /**
   * The way across to the playbook, when the app handed one over.
   *
   * Optional so a screen can still be rendered — in a test, or by a caller with no playbook —
   * without the cross-record card: absent hides it rather than breaking the tab.
   */
  bridge?: MesPlaybookBridge;
}

const MesJournalContext = createContext<MesJournal | null>(null);

export function useMesJournal(): MesJournal {
  const value = useContext(MesJournalContext);
  if (!value) throw new Error('useMesJournal must be used inside a MesJournalProvider.');
  return value;
}

interface MesJournalProviderProps {
  records: LevelRecord[];
  /** Writes the next list through storage and updates the app's state. */
  persist: (next: LevelRecord[]) => void;
  /** The playbook's lines and the way across, when the app has them to hand. */
  bridge?: MesPlaybookBridge;
  children: React.ReactNode;
}

export const MesJournalProvider: React.FC<MesJournalProviderProps> = ({
  records,
  persist,
  bridge,
  children,
}) => {
  const value = useMemo<MesJournal>(() => {
    const cleanAll = (list: unknown[]): LevelRecord[] =>
      list
        .map((entry) => normalizeMesLevel(entry))
        .filter((entry): entry is LevelRecord => entry !== null);

    return {
      records,
      bridge,
      addLevel(input) {
        const now = Date.now();
        const record = sanitizeLevel({
          ...input,
          id: newId(),
          createdAt: now,
          updatedAt: now,
        });
        persist([...records, record]);
        return record;
      },
      updateLevel(id, patch) {
        persist(
          records.map((record) =>
            record.id === id
              ? sanitizeLevel({ ...record, ...patch, updatedAt: Date.now() })
              : record
          )
        );
      },
      deleteLevel(id) {
        persist(records.filter((record) => record.id !== id));
      },
      replaceAll(list) {
        persist(cleanAll(list));
      },
      clearAll() {
        persist([]);
      },
      loadDemo() {
        persist(buildDemoLevels());
      },
      async importFile(file) {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const payload =
          parsed && typeof parsed === 'object' && 'records' in parsed
            ? (parsed as Partial<JournalFile>).records
            : parsed;
        const cleaned = cleanAll(Array.isArray(payload) ? payload : []);
        persist(cleaned);
        return cleaned.length;
      },
    };
  }, [records, persist, bridge]);

  return <MesJournalContext.Provider value={value}>{children}</MesJournalContext.Provider>;
};
