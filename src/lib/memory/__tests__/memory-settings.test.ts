import { describe, expect, it } from 'vitest';
import {
  MEMORY_DEFAULT_RESULT_COUNT,
  MEMORY_MAX_RESULT_COUNT,
  MEMORY_MAX_RETENTION_DAYS,
  MEMORY_MIN_RESULT_COUNT,
  MEMORY_MIN_RETENTION_DAYS,
  MEMORY_SEARCH_RETENTION_DAYS,
  clampMemoryResultCount,
  clampMemoryRetentionDays,
  defaultMemoryAiSettings,
  memorySearchExpiry,
  normaliseMemoryAiSettings,
} from '../settings';
import { MEMORY_RESEMBLANCE_FLOOR } from '../similarity';

/**
 * Consent and the bounds around it.
 *
 * The one behaviour worth being pedantic about: a missing or malformed consent flag has to
 * resolve to "no". The failure mode of getting that backwards is an upgrade that quietly starts
 * uploading a trader's private charts, and nobody would notice until it had already happened.
 */

const NOW = '2026-03-01T12:00:00.000Z';

describe('defaultMemoryAiSettings', () => {
  it('starts with image processing off', () => {
    const settings = defaultMemoryAiSettings(NOW);
    expect(settings.imageProcessingConsent).toBe(false);
    expect(settings.whenConsentedAt).toBeUndefined();
    expect(settings.rerankEnabled).toBe(false);
  });

  it('still starts useful, so the feature works without visiting settings', () => {
    const settings = defaultMemoryAiSettings(NOW);
    expect(settings.resultCount).toBe(MEMORY_DEFAULT_RESULT_COUNT);
    expect(settings.resemblanceFloor).toBe(MEMORY_RESEMBLANCE_FLOOR);
    expect(settings.searchRetentionDays).toBe(MEMORY_SEARCH_RETENTION_DAYS);
    expect(settings.updatedAt).toBe(NOW);
  });
});

describe('normaliseMemoryAiSettings', () => {
  it('resolves a missing record to the defaults, with consent off', () => {
    expect(normaliseMemoryAiSettings(null, NOW)).toEqual(defaultMemoryAiSettings(NOW));
    expect(normaliseMemoryAiSettings(undefined, NOW)).toEqual(defaultMemoryAiSettings(NOW));
  });

  it('treats an absent consent flag as no consent', () => {
    expect(normaliseMemoryAiSettings({}, NOW).imageProcessingConsent).toBe(false);
  });

  it('accepts only an explicit true as consent', () => {
    const loose = { imageProcessingConsent: 'yes' } as unknown as { imageProcessingConsent: boolean };
    expect(normaliseMemoryAiSettings(loose, NOW).imageProcessingConsent).toBe(false);
    expect(normaliseMemoryAiSettings({ imageProcessingConsent: true }, NOW).imageProcessingConsent).toBe(
      true
    );
  });

  it('drops a consent timestamp that has no consent behind it', () => {
    const setAside = {
      imageProcessingConsent: false,
      whenConsentedAt: NOW,
    };
    expect(normaliseMemoryAiSettings(setAside, NOW).whenConsentedAt).toBeUndefined();
  });

  it('keeps the moment consent was given', () => {
    const settings = normaliseMemoryAiSettings(
      { imageProcessingConsent: true, whenConsentedAt: NOW },
      '2026-04-01T00:00:00.000Z'
    );
    expect(settings.whenConsentedAt).toBe(NOW);
  });

  it('clamps a result count into the supported range', () => {
    expect(normaliseMemoryAiSettings({ resultCount: 500 }, NOW).resultCount).toBe(
      MEMORY_MAX_RESULT_COUNT
    );
    expect(normaliseMemoryAiSettings({ resultCount: -5 }, NOW).resultCount).toBe(
      MEMORY_MIN_RESULT_COUNT
    );
    expect(normaliseMemoryAiSettings({ resultCount: 20 }, NOW).resultCount).toBe(20);
  });

  it('falls back rather than trusting a result count that is not a number', () => {
    const broken = { resultCount: Number.NaN };
    expect(normaliseMemoryAiSettings(broken, NOW).resultCount).toBe(MEMORY_DEFAULT_RESULT_COUNT);
  });

  it('clamps a retention window into the supported range', () => {
    expect(normaliseMemoryAiSettings({ searchRetentionDays: 1000 }, NOW).searchRetentionDays).toBe(
      MEMORY_MAX_RETENTION_DAYS
    );
    expect(normaliseMemoryAiSettings({ searchRetentionDays: 1 }, NOW).searchRetentionDays).toBe(
      MEMORY_MIN_RETENTION_DAYS
    );
  });

  it('keeps a resemblance floor inside 0-100', () => {
    expect(normaliseMemoryAiSettings({ resemblanceFloor: 500 }, NOW).resemblanceFloor).toBe(100);
    expect(normaliseMemoryAiSettings({ resemblanceFloor: -20 }, NOW).resemblanceFloor).toBe(
      MEMORY_RESEMBLANCE_FLOOR
    );
    expect(normaliseMemoryAiSettings({ resemblanceFloor: 70 }, NOW).resemblanceFloor).toBe(70);
  });
});

describe('clamp helpers', () => {
  it('snaps to whole numbers', () => {
    expect(clampMemoryResultCount(12.6)).toBe(13);
    expect(clampMemoryRetentionDays(30.4)).toBe(30);
  });
});

describe('memorySearchExpiry', () => {
  it('adds the retention window to the search time', () => {
    expect(memorySearchExpiry('2026-03-01T00:00:00.000Z', 90)).toBe('2026-05-30T00:00:00.000Z');
  });

  it('uses the clamped window, so a wild value cannot make a search immortal', () => {
    expect(memorySearchExpiry('2026-03-01T00:00:00.000Z', 100000)).toBe(
      memorySearchExpiry('2026-03-01T00:00:00.000Z', MEMORY_MAX_RETENTION_DAYS)
    );
  });

  it('still produces a date when the search time is unreadable', () => {
    const expiry = memorySearchExpiry('not a date', 30);
    expect(Number.isFinite(Date.parse(expiry))).toBe(true);
  });
});
