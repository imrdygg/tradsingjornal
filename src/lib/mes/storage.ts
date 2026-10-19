import type { JournalFile, LevelRecord } from './types';
import { STORAGE_KEY } from './constants';
import { normalizeMesLevel } from './analytics';

/**
 * The MES tracker's own storage slice.
 *
 * The key is the one the journal already writes (`ptj_mes_levels_v1`), so a buyer of the
 * standalone tracker can move a backup into the full journal and back without a migration.
 * The journal keeps its own read/write so a quota failure reaches its sticky warning banner;
 * both sides share `normalizeMesLevel`, so they cannot disagree about what a valid row is.
 */

export const MES_LEVELS_KEY = STORAGE_KEY;

/** Normalises untrusted rows and drops duplicates by id, last wins. */
export function normalizeMesRecords(value: unknown): LevelRecord[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, LevelRecord>();
  for (const entry of value) {
    const clean = normalizeMesLevel(entry);
    if (clean) byId.set(clean.id, clean);
  }
  return [...byId.values()];
}

export function readMesLevels(): LevelRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MES_LEVELS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const rows =
      parsed && typeof parsed === 'object' && 'records' in parsed
        ? (parsed as Partial<JournalFile>).records
        : parsed;
    return normalizeMesRecords(rows);
  } catch (err) {
    console.warn('Could not read the MES levels:', err);
    return [];
  }
}

/** Writes the slice. Returns false when the browser refuses the write (quota/private mode). */
export function writeMesLevels(records: LevelRecord[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(MES_LEVELS_KEY, JSON.stringify(normalizeMesRecords(records)));
    return true;
  } catch (err) {
    console.warn('Could not save the MES levels:', err);
    return false;
  }
}

/** The backup file the Data tab and the product header both write. */
export function buildMesExport(
  records: LevelRecord[],
  exportedAt: string = new Date().toISOString()
): string {
  const file: JournalFile = {
    version: 1,
    app: 'mes-level-tracker',
    exportedAt,
    records,
  };
  return JSON.stringify(file, null, 2);
}

export type MesImportSource = 'export' | 'list' | 'journal';

export interface MesImport {
  records: LevelRecord[];
  source: MesImportSource;
}

/**
 * Accepts the tracker's own backup envelope, a bare array, or a full journal backup, which
 * carries `mesLevels`. Anything else returns `null` so the UI can refuse the file instead of
 * silently replacing the record with nothing.
 */
export function parseMesImport(value: unknown): MesImport | null {
  if (Array.isArray(value)) {
    return { records: normalizeMesRecords(value), source: 'list' };
  }

  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.records)) {
    return { records: normalizeMesRecords(record.records), source: 'export' };
  }

  if (Array.isArray(record.mesLevels)) {
    return { records: normalizeMesRecords(record.mesLevels), source: 'journal' };
  }

  return null;
}
