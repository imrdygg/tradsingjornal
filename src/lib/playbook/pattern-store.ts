import type {
  PatternStatus,
  PatternStudy,
  PatternStudyEntry,
} from './pattern-study-types';

/**
 * The Chart Pattern Playbook's own storage slice.
 *
 * This is the only state the standalone product owns, and the key is the one the journal
 * already writes, so a buyer of the mini-product can export their studies and import them
 * into the full app (or the bundle) without a migration.
 *
 * The journal's `storage` module still performs its own reads and writes so a quota
 * failure reaches its sticky warning banner; it shares the pure functions here
 * (`upsertPatternStudy`, `normalisePatternStudies`) so the two paths cannot disagree about
 * what a valid study row is.
 */

export const PATTERN_STUDIES_KEY = 'ptj_pattern_studies_v1';

/** Marks an export file as this product's, so an unrelated JSON file is refused. */
export const PATTERN_EXPORT_APP = 'chart-pattern-playbook';
export const PATTERN_EXPORT_VERSION = 1;

const PATTERN_STATUSES: PatternStatus[] = [
  'watching',
  'forming',
  'near-breakout',
  'breakout-attempted',
  'confirmed',
  'retest',
  'failed-breakout',
  'invalidated',
  'completed',
];

function isStatus(value: unknown): value is PatternStatus {
  return typeof value === 'string' && PATTERN_STATUSES.includes(value as PatternStatus);
}

function normaliseEntry(value: unknown): PatternStudyEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<PatternStudyEntry>;
  if (typeof entry.id !== 'string' || !entry.id) return null;

  return {
    ...entry,
    id: entry.id,
    patternId: typeof entry.patternId === 'string' ? entry.patternId : '',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
  };
}

function normaliseStudy(value: unknown): PatternStudy | null {
  if (!value || typeof value !== 'object') return null;
  const study = value as Partial<PatternStudy>;
  if (typeof study.patternId !== 'string' || !study.patternId) return null;

  return {
    patternId: study.patternId,
    status: isStatus(study.status) ? study.status : 'watching',
    checklist: Array.isArray(study.checklist)
      ? study.checklist.filter((key): key is string => typeof key === 'string')
      : [],
    notes: typeof study.notes === 'string' ? study.notes : '',
    entries: Array.isArray(study.entries)
      ? study.entries
          .map(normaliseEntry)
          .filter((entry): entry is PatternStudyEntry => entry !== null)
      : [],
    ...(typeof study.movedAt === 'string' ? { movedAt: study.movedAt } : {}),
    updatedAt:
      typeof study.updatedAt === 'string' ? study.updatedAt : new Date(0).toISOString(),
  };
}

/** One row per pattern, last wins, in first-seen order. */
export function dedupePatternStudies(studies: PatternStudy[]): PatternStudy[] {
  const byPattern = new Map<string, PatternStudy>();
  for (const study of studies) byPattern.set(study.patternId, study);
  return [...byPattern.values()];
}

/**
 * Turns untrusted JSON into study rows, or `null` when the shape is not a study list at all.
 *
 * Tolerant on purpose: an export written by an older build may be missing `checklist`, and a
 * journal snapshot may carry extra fields. What it will not do is invent a pattern id.
 */
export function normalisePatternStudies(value: unknown): PatternStudy[] | null {
  if (!Array.isArray(value)) return null;
  const studies = value
    .map(normaliseStudy)
    .filter((study): study is PatternStudy => study !== null);
  return dedupePatternStudies(studies);
}

/** Upserts one pattern's study row and stamps it, matching the journal's save rule. */
export function upsertPatternStudy(
  studies: PatternStudy[],
  study: PatternStudy
): PatternStudy[] {
  const updated: PatternStudy = { ...study, updatedAt: new Date().toISOString() };
  const index = studies.findIndex((existing) => existing.patternId === study.patternId);
  if (index < 0) return [...studies, updated];
  return [...studies.slice(0, index), updated, ...studies.slice(index + 1)];
}

/** Reads the slice. A corrupt value reads as empty rather than crashing the product. */
export function readPatternStudies(): PatternStudy[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PATTERN_STUDIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return normalisePatternStudies(parsed) ?? [];
  } catch (err) {
    console.warn('Could not read the pattern studies:', err);
    return [];
  }
}

/** Writes the slice. Returns false when the browser refuses the write (quota/private mode). */
export function writePatternStudies(studies: PatternStudy[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(PATTERN_STUDIES_KEY, JSON.stringify(studies));
    return true;
  } catch (err) {
    console.warn('Could not save the pattern studies:', err);
    return false;
  }
}

export function savePatternStudy(study: PatternStudy): PatternStudy[] {
  const next = upsertPatternStudy(readPatternStudies(), study);
  writePatternStudies(next);
  return next;
}

/** The file this product exports: only the trader's own material, never pattern content. */
export function buildPatternExport(
  studies: PatternStudy[],
  exportedAt: string = new Date().toISOString()
): string {
  return JSON.stringify(
    {
      app: PATTERN_EXPORT_APP,
      version: PATTERN_EXPORT_VERSION,
      exportedAt,
      studies,
    },
    null,
    2
  );
}

export type PatternImportSource = 'export' | 'journal' | 'list';

export interface PatternImport {
  studies: PatternStudy[];
  source: PatternImportSource;
}

/**
 * Accepts three shapes, because a buyer may arrive with any of them:
 *
 * - this product's export envelope (`{ app, version, studies }`);
 * - the journal's whole-journal backup, which carries `patternStudies`;
 * - a bare array, which is what the storage key itself holds.
 *
 * Anything else returns `null` so the UI can say the file was not a playbook export
 * instead of silently importing nothing.
 */
export function parsePatternImport(value: unknown): PatternImport | null {
  if (Array.isArray(value)) {
    const studies = normalisePatternStudies(value);
    return studies ? { studies, source: 'list' } : null;
  }

  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.studies)) {
    const studies = normalisePatternStudies(record.studies);
    return studies ? { studies, source: 'export' } : null;
  }

  if (Array.isArray(record.patternStudies)) {
    const studies = normalisePatternStudies(record.patternStudies);
    return studies ? { studies, source: 'journal' } : null;
  }

  return null;
}

/**
 * Merges an import into the current studies by pattern id, imported rows winning.
 *
 * A merge rather than a replace: importing a journal backup must add the trader's history,
 * not delete the patterns they have been studying in this product since they bought it.
 */
export function mergePatternStudies(
  current: PatternStudy[],
  imported: PatternStudy[]
): PatternStudy[] {
  return dedupePatternStudies([...current, ...imported]);
}
