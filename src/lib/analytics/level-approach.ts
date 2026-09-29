import type { ImportantLevel } from '../../types';
import type { InstrumentQuote } from '../ai/market-data';

/**
 * How far price is from each of today's levels.
 *
 * This is the forward-looking half of the level work. The touch log answers what happened
 * at a level; this answers which level is about to matter, and it can only do that from
 * numbers the trader wrote down *before* price arrived — the levels in the morning plan.
 *
 * It is deliberately arithmetic and nothing else. There is no prediction here, no
 * direction, no score for how likely a level is to hold: the level a trader picks is the
 * judgement, and the only thing worth adding is the measurement they cannot do in their
 * head while watching the screen — how far away price actually is, right now.
 *
 * Two thresholds are named rather than magic numbers, and they only ever choose a word.
 * Every level is returned, nearest first, so a level outside the band is still on screen
 * with its true distance instead of being filtered away by what is a display convention.
 */

/** At or inside this many points, price is *at* the level. */
export const AT_LEVEL_POINTS = 2;

/** At or inside this many points, price is *close* to the level. */
export const NEAR_LEVEL_POINTS = 10;

export type ApproachState = 'at' | 'near' | 'further';

export interface LevelApproach {
  id: string;
  price: number;
  label?: string;
  /** Points between the live price and the level. Always positive. */
  distancePoints: number;
  /** True when the level sits above the live price — the way price would have to rise. */
  above: boolean;
  state: ApproachState;
}

/**
 * Measures every level against one live read, nearest first.
 *
 * Returns an empty list when there is no usable price. That is the honest answer rather
 * than a zero distance: without a price there is nothing to measure, and a level reported
 * as zero points away would read as price sitting on it.
 */
export function findLevelApproaches(
  levels: ImportantLevel[],
  quote: InstrumentQuote | null,
  options: { atPoints?: number; nearPoints?: number } = {}
): LevelApproach[] {
  const price = quote?.ok ? quote.price : null;
  if (price === null || !Number.isFinite(price)) return [];

  const atPoints = options.atPoints ?? AT_LEVEL_POINTS;
  const nearPoints = options.nearPoints ?? NEAR_LEVEL_POINTS;

  return levels
    .filter((level) => Number.isFinite(level.price) && level.price > 0)
    .map((level) => {
      const distancePoints = Math.abs(level.price - price);
      const state: ApproachState =
        distancePoints <= atPoints ? 'at' : distancePoints <= nearPoints ? 'near' : 'further';
      return {
        id: level.id,
        price: level.price,
        label: level.label,
        distancePoints: Math.round(distancePoints * 100) / 100,
        // A level exactly on the price is read as being above it, so the answer is stated
        // rather than left to the sign of a zero.
        above: level.price >= price,
        state,
      };
    })
    .sort((a, b) => a.distancePoints - b.distancePoints);
}
