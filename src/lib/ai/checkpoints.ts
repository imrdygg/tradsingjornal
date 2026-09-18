import { DailyReview, Trade, TradingDay } from '../../types';
import type { CoachResponse } from './coach-types';

/**
 * The two daily coach checkpoints.
 *
 * The app has no scheduler, so a checkpoint is not "delivered" at a time — the app
 * works out which one is currently relevant from the trader's own timezone and lets
 * them generate it. That keeps the feature honest (nothing is written unless they ask
 * for it) and keeps the Gemini spend to what they actually read.
 *
 * Boundaries are in the trader's LOCAL time, matching how the rest of the app treats
 * timezones. They are constants rather than settings so there is one obvious place to
 * change them.
 */

export type CheckpointId = 'prep' | 'postclose';

/** Preparation opens at 08:00, ahead of the regular session open at 09:30. */
export const PREP_START_HOUR = 8;
/** The regular session closes at 16:00: prep hands over to the review here. */
export const PREP_END_HOUR = 16;

export interface CheckpointInfo {
  id: CheckpointId;
  label: string;
  windowLabel: string;
  description: string;
  /** Button text, kept short for the Today card. */
  actionLabel: string;
  loadingLabel: string;
}

export const CHECKPOINTS: Record<CheckpointId, CheckpointInfo> = {
  prep: {
    id: 'prep',
    // Session-neutral names, so renaming the hours never leaves the label lying
    // about when the checkpoint actually applies.
    label: 'Pre-session prep',
    windowLabel: `${String(PREP_START_HOUR).padStart(2, '0')}:00–${String(PREP_END_HOUR).padStart(2, '0')}:00`,
    description: 'How to approach the session, before it closes.',
    actionLabel: 'Prepare me for the session',
    loadingLabel: 'Reading your plan and recent sessions…',
  },
  postclose: {
    id: 'postclose',
    label: 'Post-session review',
    windowLabel: `${String(PREP_END_HOUR).padStart(2, '0')}:00–${String(PREP_START_HOUR).padStart(2, '0')}:00`,
    description: 'What the session produced, and what to change.',
    actionLabel: 'Review the session',
    loadingLabel: 'Reading today\u2019s trades and reviews…',
  },
};

export function otherCheckpoint(id: CheckpointId): CheckpointId {
  return id === 'prep' ? 'postclose' : 'prep';
}

/**
 * Hour of day (0-23) in the given timezone.
 *
 * `hour12: false` can yield "24" for midnight in some engines, so the result is
 * normalised. Falls back to the host clock rather than throwing if the timezone is
 * invalid, because a bad profile value must not break the Today tab.
 */
export function hourInTimezone(date: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const raw = parts.find((part) => part.type === 'hour')?.value;
    const hour = Number(raw);
    return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : date.getHours();
  } catch {
    return date.getHours();
  }
}

/**
 * Which checkpoint is relevant now. Before the session closes the trader still needs
 * preparation; afterwards, the review of what the session produced.
 */
export function resolveCheckpoint(timezone: string, now: Date = new Date()): CheckpointId {
  const hour = hourInTimezone(now, timezone);
  return hour >= PREP_START_HOUR && hour < PREP_END_HOUR ? 'prep' : 'postclose';
}

/**
 * Reports both boundaries for display, so the schedule is never a mystery. Reads the
 * names and windows straight from CHECKPOINTS so they cannot drift apart.
 */
export function checkpointWindowNote(): string {
  return (
    `${CHECKPOINTS.prep.label} ${CHECKPOINTS.prep.windowLabel}, ` +
    `${CHECKPOINTS.postclose.label.toLowerCase()} ${CHECKPOINTS.postclose.windowLabel}. ` +
    `Your local time.`
  );
}

// ---------------------------------------------------------------------------
// Per-day note cache
// ---------------------------------------------------------------------------

const CACHE_KEY = 'ptj_coach_checkpoints_v1';
/** Enough history to look back over a couple of weeks without growing forever. */
const MAX_CACHED_NOTES = 28;

export interface CachedCheckpointNote {
  checkpoint: CheckpointId;
  /** Trading date the note was written for. */
  date: string;
  generatedAt: string;
  /** Journal state at generation time, used to detect a stale note. */
  fingerprint: string;
  data: CoachResponse;
}

interface CacheShape {
  version: 1;
  notes: Record<string, CachedCheckpointNote>;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Private mode or a blocked storage API: caching is a nicety, not a requirement.
    return null;
  }
}

function readCache(): CacheShape {
  const store = storage();
  if (!store) return { version: 1, notes: {} };
  try {
    const raw = store.getItem(CACHE_KEY);
    if (!raw) return { version: 1, notes: {} };
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || parsed.version !== 1 || typeof parsed.notes !== 'object' || !parsed.notes) {
      return { version: 1, notes: {} };
    }
    return parsed;
  } catch {
    return { version: 1, notes: {} };
  }
}

export function noteKey(date: string, checkpoint: CheckpointId): string {
  return `${date}:${checkpoint}`;
}

export function readCachedNote(
  date: string,
  checkpoint: CheckpointId
): CachedCheckpointNote | null {
  const note = readCache().notes[noteKey(date, checkpoint)];
  if (!note || note.checkpoint !== checkpoint) return null;
  return note;
}

export function writeCachedNote(note: CachedCheckpointNote): void {
  const store = storage();
  if (!store) return;
  try {
    const cache = readCache();
    cache.notes[noteKey(note.date, note.checkpoint)] = note;

    // Prune oldest first so the cache cannot grow without bound.
    const keys = Object.keys(cache.notes);
    if (keys.length > MAX_CACHED_NOTES) {
      keys
        .sort((a, b) => (cache.notes[a].generatedAt < cache.notes[b].generatedAt ? -1 : 1))
        .slice(0, keys.length - MAX_CACHED_NOTES)
        .forEach((key) => delete cache.notes[key]);
    }

    store.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota or serialisation problems must never break the coach card.
  }
}

/** Clears cached notes, e.g. when the journal is reset. */
export function clearCachedNotes(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(CACHE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Cheap identity for the journal. Changes whenever a trade, day or review is added
 * or edited, which is enough to tell the trader a saved note no longer reflects what
 * they have logged.
 */
export function journalFingerprint(input: {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
}): string {
  const latest = (records: Array<{ updatedAt: string }>) =>
    records.reduce((max, record) => (record.updatedAt > max ? record.updatedAt : max), '');
  return [
    input.trades.length,
    input.tradingDays.length,
    input.reviews.length,
    latest(input.trades),
    latest(input.tradingDays),
    latest(input.reviews),
  ].join('|');
}

/** True when the journal has changed since the note was generated. */
export function isNoteStale(note: CachedCheckpointNote, fingerprint: string): boolean {
  return note.fingerprint !== fingerprint;
}
