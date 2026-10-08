/**
 * Demo data, generated deterministically so the charts and the coverage story are the same
 * every time the trader loads it.
 *
 * A small seeded LCG means the same seed produces the same sessions. The generator is
 * deliberately biased the way a real record turns out: the higher timeframes hold more
 * often than the low ones, some lines are marked and never reached, and the odd break is
 * left untagged so the Timing tab's "tag your breaks" nudge has something to say.
 */
import type { BreakDirection, LevelKind, LevelRecord, SetupTag, Timeframe } from './types';
import { SETUP_TAGS, TIMEFRAMES } from './constants';
import { newId, shiftISODate, todayISO } from './utils';

/** A tiny linear congruential generator, so demo data is reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG constants.
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** How often a line at this timeframe holds, once it is tested at all. */
const HOLD_BIAS: Record<Timeframe, number> = {
  '1m': 0.42,
  '3m': 0.45,
  '5m': 0.48,
  '15m': 0.52,
  '30m': 0.6,
  '1h': 0.66,
};

const SETUPS: SetupTag[] = SETUP_TAGS.filter((tag) => tag !== 'other');

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)];
}

/** Rounds to the nearest MES tick (a quarter point). */
function tick(price: number): number {
  return Math.round(price * 4) / 4;
}

function clockFromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Builds ~24 weekday sessions of demo levels.
 *
 * `sessions` and `seed` are parameters so tests can ask for a small, fixed set; the tab uses
 * the defaults.
 */
export function buildDemoLevels(sessions = 24, seed = 20260922): LevelRecord[] {
  const rng = makeRng(seed);
  const records: LevelRecord[] = [];

  // Walk back from today, skipping weekends, so the sessions read as recent.
  let date = todayISO();
  for (let i = 0; i < sessions; i += 1) {
    // Skip Sat/Sun.
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(y, m - 1, d, 12).getDay();
    if (weekday === 0 || weekday === 6) {
      date = shiftISODate(date, -1);
      i -= 1;
      continue;
    }

    // Two to five lines marked for the day, one per chosen chart.
    const count = 2 + Math.floor(rng() * 4);
    const chosen = new Set<Timeframe>();
    const basePrice = 5800 + Math.round(rng() * 200);

    for (let levelIndex = 0; levelIndex < count; levelIndex += 1) {
      chosen.add(pick(rng, TIMEFRAMES));
    }

    let offset = 0;
    for (const timeframe of chosen) {
      offset += 6 + Math.floor(rng() * 18);
      const price = tick(basePrice + offset * (rng() > 0.5 ? 1 : -1));
      const kind: LevelKind = price >= basePrice ? 'resistance' : 'support';

      // One line in five is marked and never reached.
      const untested = rng() < 0.2;
      const touches = untested ? 0 : 1 + Math.floor(rng() * 3);
      let holds = 0;
      let breaks = 0;
      for (let test = 0; test < touches; test += 1) {
        if (rng() < HOLD_BIAS[timeframe]) holds += 1;
        else breaks += 1;
      }

      const hitTime = touches > 0 ? clockFromMinutes(9 * 60 + 30 + Math.floor(rng() * 300)) : '';
      const breakTime = breaks > 0 ? clockFromMinutes(9 * 60 + 45 + Math.floor(rng() * 330)) : '';
      // Most breaks are tagged; a handful are not, which is the nudge the Timing tab wants.
      const tagBreak = breaks > 0 && rng() > 0.15;
      const breakDirection: BreakDirection | '' = tagBreak
        ? rng() < (kind === 'resistance' ? 0.6 : 0.4)
          ? 'up'
          : 'down'
        : '';

      const now = Date.now() - (sessions - i) * 86_400_000;
      records.push({
        id: newId(),
        date,
        timeframe,
        kind,
        price,
        touches,
        holds,
        breaks,
        setup: touches > 0 && rng() < 0.75 ? pick(rng, SETUPS) : '',
        hitTime,
        breakTime,
        breakDirection,
        notes: rng() < 0.25 ? 'Watched off the ' + timeframe + ' chart.' : '',
        createdAt: now,
        updatedAt: now,
      });
    }

    date = shiftISODate(date, -1);
  }

  return records;
}
