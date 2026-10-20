import type { TradingObservation } from '../../types';
import type { SightingNote, SightingNotesFacts } from '../ai/coach-types';

/**
 * Turns the memory library into the notes the coach reads for a pattern.
 *
 * The library itself is a list of pictures; this is the one place that decides what a
 * "sighting" looks like as text. Three rules, each for a reason:
 *
 *   1. **Only sightings that carry a note are sent.** A picture with no words is still a
 *      searchable chart, but it contributes no observation, and listing it empty would let the
 *      coach count pictures it was told nothing about.
 *   2. **Newest first.** A pattern read is about what the trader keeps doing, and recent
 *      sightings are the ones they can still recognise. The cap is applied after sorting, so
 *      it is always the newest N rather than whichever records happened to be first.
 *   3. **Both counts travel.** `total` is how many sightings have a note, `listed` is how many
 *      were sent. A read of the newest forty of two hundred must be able to say so, and the
 *      card repeats that distinction rather than letting the coach imply it read everything.
 *
 * The notes keep their order: picture 1 is the first chart the trader attached, and a note
 * that says "then this" only makes sense beside the picture it followed.
 */

/** How many sightings one read may carry. Mirrors the endpoint's own ceiling. */
export const MAX_SIGHTINGS_PER_READ = 40;

export interface SightingPatternInputOptions {
  /** Defaults to `MAX_SIGHTINGS_PER_READ`; the endpoint caps whatever is sent. */
  maxSightings?: number;
}

/** The notes under one sighting, in the order the pictures were attached. */
export function sightingNotes(observation: TradingObservation): string[] {
  return (observation.images ?? [])
    .map((image) => (image.note ?? '').trim())
    .filter((note) => note.length > 0);
}

/**
 * Whether a sighting can contribute to a pattern at all.
 *
 * Exported because the card uses it for its own counts, so the number it shows and the number
 * it sends cannot disagree.
 */
export function hasSightingNote(observation: TradingObservation): boolean {
  return sightingNotes(observation).length > 0;
}

/** Every note written in the library, which is the material a pattern read can ever have. */
export function countSightingNotes(observations: readonly TradingObservation[]): number {
  return observations.reduce((total, observation) => total + sightingNotes(observation).length, 0);
}

export function buildSightingNotesFacts(
  observations: readonly TradingObservation[],
  options: SightingPatternInputOptions = {}
): SightingNotesFacts {
  const max = Math.max(1, options.maxSightings ?? MAX_SIGHTINGS_PER_READ);

  const withNotes = observations
    .map((observation) => {
      const notes = sightingNotes(observation);
      if (notes.length === 0) return null;
      return { observation, notes };
    })
    .filter((entry): entry is { observation: TradingObservation; notes: string[] } => entry !== null)
    // Newest first, and by id second so the order is total rather than dependent on the
    // array the caller happened to pass.
    .sort((a, b) => {
      const byTime = (b.observation.observedAt ?? '').localeCompare(a.observation.observedAt ?? '');
      return byTime !== 0 ? byTime : b.observation.id.localeCompare(a.observation.id);
    });

  const listed = withNotes.slice(0, max).map(
    ({ observation, notes }): SightingNote => ({
      date: (observation.observedAt ?? '').slice(0, 10),
      symbol: observation.symbol || 'unknown',
      ...(observation.timeframe ? { timeframe: observation.timeframe } : {}),
      notes,
    })
  );

  return { total: withNotes.length, listed: listed.length, sightings: listed };
}
