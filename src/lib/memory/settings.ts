/**
 * The trader's own switches for the memory engine, and the bounds they move within.
 *
 * Kept apart from the search screen on purpose. Everything in here is a decision about cost,
 * privacy or display that a trader should make once and then forget about, and putting it beside
 * the upload box would mean every search is made next to a wall of technical controls. The
 * defaults are chosen so the feature is useful without visiting this screen at all, and so that
 * nothing expensive happens until the trader has said it may.
 */

import type { MemoryAiSettings } from '../../types';
import { MEMORY_RESEMBLANCE_FLOOR } from './similarity';

/**
 * How long a saved search is kept.
 *
 * Ninety days is a quarter of looking at charts — long enough that the history shows which of
 * the trader's own uploads found real matches, short enough that the query thumbnails in it do
 * not become the largest table in the project. Mirrors the SQL default on `memory_searches`.
 */
export const MEMORY_SEARCH_RETENTION_DAYS = 90;

/** The fewest and most days a retention window may be set to. */
export const MEMORY_MIN_RETENTION_DAYS = 7;
export const MEMORY_MAX_RETENTION_DAYS = 365;

/** How many matches a search returns by default. */
export const MEMORY_DEFAULT_RESULT_COUNT = 12;

/**
 * The most matches one search may ask for.
 *
 * Capped well below what the database would happily return. A list past this length stops being
 * read, and every extra match is another row the trader has to weigh — a search that returns
 * fifty "similar" pictures has not answered the question, it has moved it.
 */
export const MEMORY_MAX_RESULT_COUNT = 50;
export const MEMORY_MIN_RESULT_COUNT = 1;

/**
 * The settings a journal starts with.
 *
 * `imageProcessingConsent` is false and the reranker is off. That is the whole privacy position
 * in two booleans: a fresh install sends nothing anywhere, and the trader turns it on for their
 * own library when they decide to.
 */
export function defaultMemoryAiSettings(now: string): MemoryAiSettings {
  return {
    imageProcessingConsent: false,
    rerankEnabled: false,
    resultCount: MEMORY_DEFAULT_RESULT_COUNT,
    resemblanceFloor: MEMORY_RESEMBLANCE_FLOOR,
    searchRetentionDays: MEMORY_SEARCH_RETENTION_DAYS,
    updatedAt: now,
  };
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Snaps a requested result count into the supported range. */
export function clampMemoryResultCount(value: number): number {
  return clampInt(value, MEMORY_MIN_RESULT_COUNT, MEMORY_MAX_RESULT_COUNT, MEMORY_DEFAULT_RESULT_COUNT);
}

/** Snaps a requested retention window into the supported range. */
export function clampMemoryRetentionDays(value: number): number {
  return clampInt(
    value,
    MEMORY_MIN_RETENTION_DAYS,
    MEMORY_MAX_RETENTION_DAYS,
    MEMORY_SEARCH_RETENTION_DAYS
  );
}

/**
 * Reads settings off a record that may predate them.
 *
 * Every field is defaulted rather than trusted, because these arrive from a synced journal that
 * another device — or an older build — may have written. A missing consent flag must resolve to
 * "no consent", which is the safe direction: the failure mode of defaulting it the other way is
 * quietly uploading a trader's private charts after an upgrade.
 */
export function normaliseMemoryAiSettings(
  raw: Partial<MemoryAiSettings> | null | undefined,
  now: string
): MemoryAiSettings {
  const fallback = defaultMemoryAiSettings(now);
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    imageProcessingConsent: raw.imageProcessingConsent === true,
    whenConsentedAt:
      raw.imageProcessingConsent === true && typeof raw.whenConsentedAt === 'string'
        ? raw.whenConsentedAt
        : undefined,
    rerankEnabled: raw.rerankEnabled === true,
    resultCount: clampMemoryResultCount(raw.resultCount ?? fallback.resultCount),
    resemblanceFloor:
      Number.isFinite(raw.resemblanceFloor as number) && (raw.resemblanceFloor as number) >= 0
        ? Math.min(100, Math.round(raw.resemblanceFloor as number))
        : fallback.resemblanceFloor,
    searchRetentionDays: clampMemoryRetentionDays(
      raw.searchRetentionDays ?? fallback.searchRetentionDays
    ),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
}

/**
 * When a search saved now should stop being kept.
 *
 * Stored on the row rather than computed at read time so that shortening the retention window
 * later cannot retroactively pretend an old search was never within it — the row says when it
 * expires, and the prune function reads that.
 */
export function memorySearchExpiry(searchedAt: string, retentionDays: number): string {
  const start = Date.parse(searchedAt);
  const from = Number.isFinite(start) ? start : Date.now();
  const days = clampMemoryRetentionDays(retentionDays);
  return new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
}
