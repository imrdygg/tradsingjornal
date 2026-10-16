import { describe, expect, it } from 'vitest';
import { sightingFromSearchChart } from '../sighting';
import { isPreDecisionRole } from '../eligibility';

/**
 * Recording the chart a search was made with.
 *
 * Three things are asserted here rather than left to the screen: that the picture lands in a role a
 * search can actually return (a post-decision role would make the new sighting invisible to the very
 * feature that created it), that nothing pretends to be known that is not — no outcome, no index
 * status — and that the filters in force are described as the trader's own words rather than
 * re-derived.
 */

const NOW = new Date('2026-10-16T14:30:00.000Z');
/** A one-pixel PNG, which is the smallest thing `readImageDataUrl` accepts. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function build(overrides: Partial<Parameters<typeof sightingFromSearchChart>[0]> = {}) {
  return sightingFromSearchChart({
    userId: 'user-1',
    timezone: 'America/New_York',
    dataUrl: PNG,
    now: NOW,
    ...overrides,
  });
}

describe('sightingFromSearchChart', () => {
  it('files the chart in a role a search can return', () => {
    const observation = build();
    const image = observation.images?.[0];

    expect(image?.role).toBe('before-setup');
    // The whole point of recording it: if this were a post-decision role the sighting would never
    // appear in a later search, and the feature would be a dead end.
    expect(isPreDecisionRole(image!.role)).toBe(true);
  });

  it('leaves the outcome absent rather than filling in an unknown', () => {
    const observation = build();

    // An outcome is what price did afterwards. `unknown` is a real value a trader can record later;
    // putting it here would claim a reading that nobody made.
    expect(observation.outcome).toBeUndefined();
    expect(observation.linkedTradeId).toBeUndefined();
    expect(observation.notes).toBeUndefined();
  });

  it('records the sighting as pending until indexing has actually run', () => {
    const image = build().images?.[0];

    expect(image?.indexStatus).toBe('pending');
    expect(image?.embeddingModel).toBeUndefined();
    expect(image?.indexedAt).toBeUndefined();
    expect(image?.storagePath).toBeUndefined();
  });

  it('keeps the picture itself, so the sighting is not an empty record', () => {
    const observation = build();
    const image = observation.images?.[0];

    expect(image?.dataUrl).toBe(PNG);
    expect(image?.mimeType).toBe('image/png');
    // Attached to the record it was built with, so the picture cannot end up orphaned.
    expect(image?.observationId).toBe(observation.id);
  });

  it('describes the chart with the filters the search was running under', () => {
    const observation = build({
      filters: {
        instrument: 'MES',
        timeframe: '5m',
        session: 'Regular Session',
        setupName: 'Opening drive pullback',
      },
    });

    expect(observation.symbol).toBe('MES');
    expect(observation.instrumentId).toBe('MES');
    expect(observation.timeframe).toBe('5m');
    expect(observation.session).toBe('Regular Session');
    expect(observation.setupName).toBe('Opening drive pullback');
    // A name is not an id, and guessing one would attach the sighting to whatever setup shares it.
    expect(observation.setupId).toBeUndefined();
  });

  it('invents nothing for a search that was never narrowed', () => {
    const observation = build();

    expect(observation.symbol).toBe('');
    expect(observation.timeframe).toBeUndefined();
    expect(observation.session).toBeUndefined();
    expect(observation.setupName).toBeUndefined();
  });

  it('times the sighting as the moment of the decision, in the trader`s own zone', () => {
    const observation = build();

    expect(observation.observedAt).toBe(NOW.toISOString());
    // Not `upload-time`: this is the moment the setup was in front of them, so a replay may use it.
    expect(observation.observedAtSource).toBe('recorded');
    expect(observation.marketTimezone).toBe('America/New_York');
  });

  it('refuses a chart it cannot store, instead of recording a sighting without one', () => {
    expect(() => build({ dataUrl: 'https://example.com/chart.png' })).toThrow(/not an inline image/);
  });
});
