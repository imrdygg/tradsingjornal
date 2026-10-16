import { describe, expect, it } from 'vitest';
import {
  buildSetupResearch,
  describeSeenVersusTaken,
  setupResearchKey,
  tradeResearchKey,
} from '../research';
import type { MemoryContinuation, MemoryImage, Trade, TradingObservation } from '../../../types';

/**
 * The seen-versus-taken research read.
 *
 * The failure this dashboard can produce while looking entirely correct is a number over the wrong
 * population: a "win rate" computed over forty sightings, or three taken trades with one result
 * recorded rendering as three losses. So almost every test below asserts a DENOMINATOR rather than
 * a count, and several assert that two figures which could plausibly be averaged are not.
 */

const NOW = '2026-03-01T14:00:00.000Z';

function makeImage(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    indexStatus: 'completed',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'user-1',
    observedAt: NOW,
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    setupId: 'setup-1',
    setupName: 'Opening drive',
    images: [makeImage()],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    userId: 'user-1',
    tradingDayId: 'day-1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 5000,
    initialStop: 4995,
    entryTime: NOW,
    session: 'Regular Session',
    initialRisk: 25,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'closed',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** An observation that was taken: it names a trade that exists. */
function taken(
  id: string,
  tradeId: string,
  continuation: MemoryContinuation | undefined,
  options: Partial<TradingObservation> = {}
): TradingObservation {
  return makeObservation({
    id,
    linkedTradeId: tradeId,
    outcome: continuation
      ? { status: 'recorded', continuation, source: 'trader-recorded' }
      : undefined,
    ...options,
  });
}

/** An observation that was only seen. */
function seen(
  id: string,
  continuation: MemoryContinuation | undefined,
  options: Partial<TradingObservation> = {}
): TradingObservation {
  return makeObservation({
    id,
    outcome: continuation
      ? { status: 'recorded', continuation, source: 'trader-recorded' }
      : undefined,
    ...options,
  });
}

describe('buildSetupResearch — seen against taken', () => {
  it('reports forty sightings and three trades as two different numbers', () => {
    // The headline failure: one "sample size" of 40 applied to the execution figures.
    const observations = [
      ...Array.from({ length: 37 }, (_, index) => seen(`seen-${index}`, 'continuation')),
      taken('taken-1', 'trade-1', 'continuation'),
      taken('taken-2', 'trade-2', 'reversal'),
      taken('taken-3', 'trade-3', 'continuation'),
    ];
    const trades = [
      makeTrade({ id: 'trade-1', netPnL: 100 }),
      makeTrade({ id: 'trade-2', netPnL: -50 }),
      makeTrade({ id: 'trade-3', netPnL: 25 }),
    ];

    const { setups, totals } = buildSetupResearch({ observations, trades });
    const entry = setups[0];

    expect(entry.seen).toBe(40);
    expect(entry.taken).toBe(3);
    expect(entry.notTaken).toBe(37);
    // Market figures are over the 40 sightings; the win rate is over the 3 trades.
    expect(entry.outcomes.matched).toBe(40);
    expect(entry.outcomes.marketDecided).toBe(40);
    expect(entry.outcomes.traded).toBe(3);
    expect(entry.outcomes.wins).toBe(2);
    expect(entry.outcomes.losses).toBe(1);
    expect(totals.observations).toBe(40);
    expect(totals.taken).toBe(3);
  });

  it('does not count a sighting as taken when its trade is not in the journal', () => {
    // A dangling link is a broken reference, not an execution.
    const observations = [seen('obs-1', 'continuation', { linkedTradeId: 'gone' })];
    const { setups } = buildSetupResearch({ observations, trades: [] });

    expect(setups[0].taken).toBe(0);
    expect(setups[0].outcomes.traded).toBe(0);
    expect(setups[0].outcomes.winRate).toBeNull();
  });

  it('never renders a taken trade with no recorded result as a loss', () => {
    const observations = [
      taken('obs-1', 'trade-1', 'continuation'),
      taken('obs-2', 'trade-2', 'continuation'),
      taken('obs-3', 'trade-3', 'continuation'),
    ];
    // One trade closed at a profit; two are still open and have no result at all.
    const trades = [
      makeTrade({ id: 'trade-1', netPnL: 100 }),
      makeTrade({ id: 'trade-2', status: 'open' }),
      makeTrade({ id: 'trade-3', status: 'open' }),
    ];

    const { setups, warnings } = buildSetupResearch({ observations, trades });
    const entry = setups[0];

    expect(entry.taken).toBe(3);
    expect(entry.takenWithoutResult).toBe(2);
    // The win rate's denominator is decided trades, so one win of one decided trade is not 1/3.
    expect(entry.outcomes.wins).toBe(1);
    expect(entry.outcomes.losses).toBe(0);
    expect(entry.outcomes.traded).toBe(3);
    expect(warnings.some((line) => line.includes('2 of 3 trades have no readable result'))).toBe(
      true
    );
  });

  it('treats a scratch as neither a win nor a loss', () => {
    // Sized to clear `MEMORY_MIN_OUTCOME_SAMPLE`. Below that floor the rate is withheld for a thin
    // sample, so a four-decided-trade fixture would report null and this test would be asserting
    // the floor rather than the denominator it is about.
    const observations = Array.from({ length: 6 }, (_, index) =>
      taken(`obs-${index}`, `trade-${index}`, 'continuation')
    );
    const trades = [
      makeTrade({ id: 'trade-0', netPnL: 100 }),
      makeTrade({ id: 'trade-1', netPnL: 100 }),
      makeTrade({ id: 'trade-2', netPnL: 100 }),
      makeTrade({ id: 'trade-3', netPnL: -40 }),
      makeTrade({ id: 'trade-4', netPnL: -40 }),
      makeTrade({ id: 'trade-5', netPnL: 0 }),
    ];

    const { setups } = buildSetupResearch({ observations, trades });
    const entry = setups[0];

    expect(entry.outcomes.breakeven).toBe(1);
    // Three wins of FIVE decided trades, not of six: the scratch is out of the denominator.
    expect(entry.outcomes.winRate).toBe(60);
  });
});

describe('buildSetupResearch — what price did', () => {
  it('excludes sightings with nothing recorded from the rate and counts them as unknown', () => {
    const observations = [
      ...Array.from({ length: 6 }, (_, index) => seen(`cont-${index}`, 'continuation')),
      ...Array.from({ length: 3 }, (_, index) => seen(`rev-${index}`, 'reversal')),
      ...Array.from({ length: 11 }, (_, index) => seen(`none-${index}`, undefined)),
    ];

    const { setups } = buildSetupResearch({ observations });
    const entry = setups[0];

    expect(entry.outcomes.matched).toBe(20);
    expect(entry.outcomes.marketDecided).toBe(9);
    expect(entry.outcomes.marketUnknown).toBe(11);
    // 6/9, never 6/20: the eleven with nothing written down are not failures to continue.
    expect(entry.outcomes.continuationRate).toBeCloseTo(66.7, 1);
  });

  it('counts an unclear reading as something recorded but not as a decision', () => {
    const observations = [
      ...Array.from({ length: 4 }, (_, index) => seen(`cont-${index}`, 'continuation')),
      ...Array.from({ length: 2 }, (_, index) => seen(`unclear-${index}`, 'unclear')),
    ];
    const { setups } = buildSetupResearch({ observations });

    expect(setups[0].outcomes.marketKnown).toBe(6);
    expect(setups[0].outcomes.unclear).toBe(2);
    expect(setups[0].outcomes.marketDecided).toBe(4);
    // Below the floor of five, so the rate is withheld rather than reported as 100%.
    expect(setups[0].outcomes.continuationRate).toBeNull();
  });

  it('leaves a recorded continuation off a sample that is not a reading', () => {
    // `status: 'unknown'` with a continuation typed into it is not a reading of anything.
    const observations = [
      makeObservation({
        id: 'obs-1',
        outcome: { status: 'unknown', continuation: 'continuation', source: 'trader-recorded' },
      }),
    ];
    const { setups } = buildSetupResearch({ observations });

    expect(setups[0].outcomes.marketUnknown).toBe(1);
    expect(setups[0].outcomes.continuations).toBe(0);
  });
});

describe('buildSetupResearch — sample size', () => {
  it('flags a setup whose rate was withheld for a thin sample', () => {
    const observations = [seen('obs-1', 'continuation'), seen('obs-2', 'reversal')];
    const { setups } = buildSetupResearch({ observations });

    expect(setups[0].outcomes.marketDecided).toBe(2);
    expect(setups[0].thinSample).toBe(true);
    expect(setups[0].minSample).toBe(5);
  });

  it('does not flag a setup as thin for an execution rate it has no trades to compute', () => {
    // Twelve sightings, none traded: the win rate legitimately does not exist, and calling that a
    // thin sample would read as "come back when you have more trades" about a setup never taken.
    const observations = Array.from({ length: 12 }, (_, index) => seen(`obs-${index}`, 'continuation'));
    const { setups } = buildSetupResearch({ observations });

    expect(setups[0].outcomes.winRate).toBeNull();
    expect(setups[0].outcomes.continuationRate).toBe(100);
    expect(setups[0].thinSample).toBe(false);
  });

  it('honours a caller-supplied floor and echoes it', () => {
    const observations = [seen('obs-1', 'continuation'), seen('obs-2', 'continuation')];
    const { setups } = buildSetupResearch({ observations, minSample: 2 });

    expect(setups[0].outcomes.continuationRate).toBe(100);
    expect(setups[0].thinSample).toBe(false);
    expect(setups[0].minSample).toBe(2);
  });
});

describe('buildSetupResearch — grouping', () => {
  it('groups a renamed setup under its id rather than splitting its history', () => {
    const observations = [
      seen('obs-1', 'continuation', { setupName: 'Old name' }),
      seen('obs-2', 'continuation', { setupName: 'Tidied name' }),
    ];
    const { setups } = buildSetupResearch({ observations });

    expect(setups).toHaveLength(1);
    expect(setups[0].seen).toBe(2);
  });

  it('shows the name from the most recent sighting', () => {
    const observations = [
      seen('older', 'continuation', {
        setupName: 'Old name',
        observedAt: '2026-01-01T14:00:00.000Z',
      }),
      seen('newer', 'continuation', {
        setupName: 'Tidied name',
        observedAt: '2026-02-01T14:00:00.000Z',
      }),
    ];
    const { setups } = buildSetupResearch({ observations });

    expect(setups[0].setupName).toBe('Tidied name');
  });

  it('falls back to the name when a sighting has no setup id', () => {
    const observations = [seen('obs-1', 'continuation', { setupId: undefined, setupName: 'By name' })];
    const { setups } = buildSetupResearch({ observations });

    expect(setups).toHaveLength(1);
    expect(setups[0].setupKey).toBe('name:by name');
    expect(setups[0].setupName).toBe('By name');
  });

  it('keeps an unlabelled sighting out of every setup and counts it instead of dropping it', () => {
    const observations = [
      seen('obs-1', 'continuation'),
      seen('obs-2', 'continuation', { setupId: undefined, setupName: undefined }),
    ];
    const { setups, totals, warnings } = buildSetupResearch({ observations });

    expect(setups).toHaveLength(1);
    expect(setups[0].seen).toBe(1);
    expect(totals.unlabelled).toBe(1);
    expect(totals.grouped).toBe(1);
    // Nothing may be lost: grouped plus unlabelled is every observation handed in.
    expect(totals.grouped + totals.unlabelled).toBe(totals.observations);
    expect(warnings.some((line) => line.includes('names no setup'))).toBe(true);
  });

  it('keeps an unnamed setup distinct from one genuinely called that', () => {
    const observations = [
      seen('obs-1', 'continuation', { setupId: undefined, setupName: 'Unnamed setup' }),
      seen('obs-2', 'continuation', { setupId: undefined, setupName: undefined }),
    ];
    const { setups, totals } = buildSetupResearch({ observations });

    expect(setups).toHaveLength(1);
    expect(setups[0].seen).toBe(1);
    expect(totals.unlabelled).toBe(1);
  });

  it('returns null as the key for a sighting with no setup, and never a placeholder', () => {
    expect(setupResearchKey(makeObservation({ setupId: undefined, setupName: undefined }))).toBeNull();
    expect(setupResearchKey(makeObservation({ setupId: '   ', setupName: undefined }))).toBeNull();
    expect(setupResearchKey(makeObservation({ setupId: 'setup-1' }))).toBe('id:setup-1');
    expect(setupResearchKey(makeObservation({ setupId: undefined, setupName: 'Drive' }))).toBe(
      'name:drive'
    );
  });
});

describe('buildSetupResearch — ordering', () => {
  it('ranks by how much is recorded, and is total when counts tie', () => {
    const observations = [
      seen('a-1', 'continuation', { setupId: 'alpha' }),
      seen('b-1', 'continuation', { setupId: 'beta' }),
      seen('b-2', 'continuation', { setupId: 'beta' }),
      seen('c-1', 'continuation', { setupId: 'gamma' }),
      seen('c-2', 'continuation', { setupId: 'gamma' }),
    ];
    const { setups } = buildSetupResearch({ observations });

    expect(setups.map((entry) => entry.setupKey)).toEqual(['id:beta', 'id:gamma', 'id:alpha']);
  });

  it('breaks a tie on sightings with the traded count, then the key', () => {
    const observations = [
      seen('z-1', 'continuation', { setupId: 'zeta' }),
      seen('z-2', 'continuation', { setupId: 'zeta' }),
      taken('a-1', 'trade-1', 'continuation', { setupId: 'alpha' }),
      seen('a-2', 'continuation', { setupId: 'alpha' }),
    ];
    const { setups } = buildSetupResearch({
      observations,
      trades: [makeTrade({ id: 'trade-1', netPnL: 10 })],
    });

    // Both have two sightings; alpha has a trade and sorts first, which is the only difference.
    expect(setups.map((entry) => entry.setupKey)).toEqual(['id:alpha', 'id:zeta']);
  });

  it('produces the same ranking whatever order the record arrives in', () => {
    const observations = [
      seen('a-1', 'continuation', { setupId: 'alpha', observedAt: '2026-01-01T14:00:00.000Z' }),
      seen('b-1', 'reversal', { setupId: 'beta', observedAt: '2026-02-01T14:00:00.000Z' }),
      seen('c-1', 'continuation', { setupId: 'gamma', observedAt: '2026-03-01T14:00:00.000Z' }),
    ];

    const forward = buildSetupResearch({ observations });
    const reversed = buildSetupResearch({ observations: [...observations].reverse() });

    expect(forward.setups).toEqual(reversed.setups);
  });
});

describe('buildSetupResearch — the window', () => {
  it('windows a setup to its most recent sightings and says it did', () => {
    const observations = Array.from({ length: 10 }, (_, index) =>
      seen(`obs-${index}`, 'continuation', {
        observedAt: `2026-01-${String(index + 1).padStart(2, '0')}T14:00:00.000Z`,
      })
    );

    const { setups, warnings } = buildSetupResearch({ observations, limitPerSetup: 4 });
    const entry = setups[0];

    expect(entry.seen).toBe(4);
    expect(entry.truncated).toBe(true);
    // The window is the most RECENT four, so its newest day is the tenth.
    expect(entry.lastSeenAt).toBe('2026-01-10T14:00:00.000Z');
    expect(entry.firstSeenAt).toBe('2026-01-07T14:00:00.000Z');
    // Asserted against the sentence the screen actually prints, not a paraphrase of it: a test that
    // guesses the wording passes on a warning nobody can read and fails on a reworded one that is
    // still correct. This fragment is the part that names the window.
    expect(warnings.some((line) => line.includes('4 most recent sightings'))).toBe(true);
  });

  it('sorts before it windows, whatever order the record arrived in', () => {
    const days = ['2026-01-01', '2026-01-05', '2026-01-09'];
    const observations = days.map((day, index) =>
      seen(`obs-${index}`, 'continuation', { observedAt: `${day}T14:00:00.000Z` })
    );

    const shuffled = buildSetupResearch({
      observations: [observations[1], observations[2], observations[0]],
      limitPerSetup: 2,
    });

    expect(shuffled.setups[0].firstSeenAt).toBe('2026-01-05T14:00:00.000Z');
    expect(shuffled.setups[0].lastSeenAt).toBe('2026-01-09T14:00:00.000Z');
  });

  it('names the newest sighting in the window, so a caller can open one record', () => {
    const observations = [
      seen('older', 'continuation', { observedAt: '2026-01-01T14:00:00.000Z' }),
      seen('newer', 'continuation', { observedAt: '2026-03-01T14:00:00.000Z' }),
    ];
    const { setups } = buildSetupResearch({ observations, limitPerSetup: 1 });

    expect(setups[0].newestObservationId).toBe('newer');
  });

  it('does not mark a setup as truncated when the window covers it', () => {
    const observations = [seen('obs-1', 'continuation'), seen('obs-2', 'continuation')];
    const { setups } = buildSetupResearch({ observations, limitPerSetup: 5 });

    expect(setups[0].seen).toBe(2);
    expect(setups[0].truncated).toBe(false);
  });

  it('reports no dates at all when nothing in the window can be placed in time', () => {
    const observations = [seen('obs-1', 'continuation', { observedAt: 'not a date' })];
    const { setups } = buildSetupResearch({ observations });

    expect(setups[0].firstSeenAt).toBeUndefined();
    expect(setups[0].lastSeenAt).toBeUndefined();
  });
});

describe('buildSetupResearch — timestamps and reach', () => {
  it('counts a timestamp that cannot be trusted and warns', () => {
    const observations = [
      seen('obs-1', 'continuation'),
      seen('obs-2', 'continuation', { observedAtSource: 'upload-time' }),
    ];
    const { setups, totals, warnings } = buildSetupResearch({ observations });

    expect(setups[0].untrustedTime).toBe(1);
    expect(totals.untrustedTime).toBe(1);
    expect(warnings.some((line) => line.includes('cannot be trusted'))).toBe(true);
  });

  it('counts a sighting as reachable only with a completed pre-decision chart', () => {
    const observations = [
      seen('obs-1', 'continuation'),
      seen('obs-2', 'continuation', {
        images: [makeImage({ id: 'img-2', role: 'exit' })],
      }),
      seen('obs-3', 'continuation', {
        images: [makeImage({ id: 'img-3', indexStatus: 'pending' })],
      }),
      seen('obs-4', 'continuation', { images: [] }),
    ];
    const { setups, totals, warnings } = buildSetupResearch({ observations });

    expect(setups[0].seen).toBe(4);
    expect(setups[0].searchable).toBe(1);
    expect(totals.searchable).toBe(1);
    expect(warnings.some((line) => line.includes('Only 1 of 4 grouped sightings'))).toBe(true);
  });

  it('says plainly when nothing in the record is reachable by a search', () => {
    const observations = [seen('obs-1', 'continuation', { images: [] })];
    const { warnings } = buildSetupResearch({ observations });

    expect(warnings.some((line) => line.includes('No sighting here has a searchable picture'))).toBe(
      true
    );
  });
});

describe('buildSetupResearch — the empty and untraded record', () => {
  it('says there is no history rather than showing zeroes', () => {
    const { setups, totals, warnings } = buildSetupResearch({ observations: [] });

    expect(setups).toEqual([]);
    expect(totals.observations).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Nothing has been recorded yet');
  });

  it('says the execution half is empty rather than implying losses', () => {
    const observations = [seen('obs-1', 'continuation'), seen('obs-2', 'reversal')];
    const { warnings } = buildSetupResearch({ observations });

    expect(warnings.some((line) => line.includes('the execution half of every comparison is empty'))).toBe(
      true
    );
  });
});

describe('describeSeenVersusTaken', () => {
  it('states both denominators in one sentence', () => {
    const observations = [
      ...Array.from({ length: 6 }, (_, index) => seen(`seen-${index}`, 'continuation')),
      taken('taken-1', 'trade-1', 'continuation'),
      taken('taken-2', 'trade-2', 'reversal'),
    ];
    const trades = [
      makeTrade({ id: 'trade-1', netPnL: 100 }),
      makeTrade({ id: 'trade-2', netPnL: -50 }),
    ];

    const { setups } = buildSetupResearch({ observations, trades });
    const line = describeSeenVersusTaken(setups[0]);

    expect(line).toContain('Saw this setup 8 times and took it 2 times.');
    expect(line).toContain('out of 8 recorded readings');
    expect(line).toContain('over the 2 trades');
  });

  it('does not invent an execution sentence for a setup that was never traded', () => {
    const observations = [seen('obs-1', 'continuation')];
    const { setups } = buildSetupResearch({ observations });
    const line = describeSeenVersusTaken(setups[0]);

    expect(line).toContain('took it 0 times');
    expect(line).toContain('No trade was taken, so there is no execution record');
    expect(line).not.toContain('0 won');
  });

  it('names the sightings with nothing written down instead of folding them in', () => {
    const observations = [seen('obs-1', 'continuation'), seen('obs-2', undefined)];
    const { setups } = buildSetupResearch({ observations });
    const line = describeSeenVersusTaken(setups[0]);

    expect(line).toContain('1 with nothing written down');
  });

  it('names trades taken whose result is not recorded', () => {
    const observations = [taken('obs-1', 'trade-1', 'continuation')];
    const { setups } = buildSetupResearch({
      observations,
      trades: [makeTrade({ id: 'trade-1', status: 'open' })],
    });
    const line = describeSeenVersusTaken(setups[0]);

    expect(line).toContain('1 still open');
    expect(line).toContain('1 with no result recorded');
  });
});

/**
 * The trade-log side.
 *
 * These tests exist because the saw-vs-took read used to see only the trades a sighting pointed at:
 * a setup traded thirty times and photographed twice reported a win rate over two trades, which is
 * arithmetically correct and completely misleading. Two things are asserted throughout — that the
 * log counts come from the journal's trades rather than from the sightings that mention them, and
 * that whatever the match could not reach is reported as a count instead of vanishing from the
 * screen.
 */
describe('the trade log side', () => {
  /** A closed trade under the default setup, with a result. */
  const logged = (id: string, pnl: number, overrides: Partial<Trade> = {}): Trade =>
    makeTrade({
      id,
      setupId: 'setup-1',
      status: 'closed',
      grossPnL: pnl,
      netPnL: pnl,
      ...overrides,
    });

  it('keys a trade by the same rule a sighting is keyed by', () => {
    expect(tradeResearchKey(makeTrade({ setupId: 'setup-1' }))).toBe('id:setup-1');
    // Same key as `setupResearchKey` gives a sighting named the same way, or the two would never
    // join: the case is deliberately identical to that function's.
    expect(tradeResearchKey(makeTrade({ setupName: 'Opening Drive' }))).toBe(
      setupResearchKey(makeObservation({ setupId: undefined, setupName: 'Opening Drive' }))
    );
    expect(tradeResearchKey(makeTrade({ setupId: '  ', setupName: '   ' }))).toBeNull();
  });

  it('counts the whole log for a setup, not only the trades a sighting points at', () => {
    const observations = [taken('obs-1', 'trade-1', 'continuation'), seen('obs-2', 'reversal')];
    const trades = [
      logged('trade-1', 100),
      logged('trade-2', 100),
      logged('trade-3', -50),
      logged('trade-4', -50),
      logged('trade-5', -50),
      logged('trade-6', 0),
      logged('trade-7', 25),
    ];

    const { setups } = buildSetupResearch({ observations, trades });
    const entry = setups[0];

    // Two sightings, one of them taken: unchanged, and still the only denominator the sighting
    // figures are over.
    expect(entry.seen).toBe(2);
    expect(entry.taken).toBe(1);

    // The execution record, however, is the journal's seven trades under this setup — three wins of
    // SIX decided (the scratch is a result and is not in the denominator), not one of one.
    expect(entry.tradeLog.trades).toBe(7);
    expect(entry.tradeLog.outcomes.wins).toBe(3);
    expect(entry.tradeLog.outcomes.losses).toBe(3);
    expect(entry.tradeLog.outcomes.breakeven).toBe(1);
    expect(entry.tradeLog.outcomes.winRate).toBe(50);
    expect(entry.tradeLog.untracked).toBe(6);

    // The market side of the log summary is over ZERO readings, by construction: a trade says
    // nothing about what price did. Reading `continuationRate` off it would report an absence of
    // evidence as a market finding, so the number is pinned here as the only correct one.
    expect(entry.tradeLog.outcomes.marketKnown).toBe(0);
    expect(entry.tradeLog.outcomes.continuationRate).toBeNull();
  });

  it('does not cut the trade log down to the sighting window', () => {
    // Five sightings, five linked trades, and a window of two. The window is there to bound the
    // sighting read; applying it to the log would shrink the very record it was added to widen, and
    // would report three trades as ones the trader never photographed.
    const observations = Array.from({ length: 5 }, (_, index) =>
      taken(`obs-${index}`, `trade-${index}`, 'continuation', {
        observedAt: `2026-03-0${index + 1}T14:00:00.000Z`,
      })
    );
    const trades = Array.from({ length: 5 }, (_, index) => logged(`trade-${index}`, 100));

    const { setups } = buildSetupResearch({ observations, trades, limitPerSetup: 2 });
    const entry = setups[0];

    expect(entry.seen).toBe(2);
    expect(entry.taken).toBe(2);
    expect(entry.tradeLog.trades).toBe(5);
    expect(entry.tradeLog.untracked).toBe(0);
  });

  it('counts the trades it cannot join rather than dropping them', () => {
    // One sighting under `id:setup-1` and three trades the grouping cannot attach to it: one naming
    // no setup, one under a setup with no sighting at all, and one naming only the setup's name —
    // which will not join a sighting grouped under that setup's id. That last one is the real
    // asymmetry between the two records, and it is a count rather than a silence.
    const observations = [seen('obs-1', 'continuation')];
    const trades = [
      makeTrade({ id: 'trade-nosetup', setupId: undefined, setupName: undefined }),
      logged('trade-other', 100, { setupId: 'setup-9' }),
      logged('trade-nameonly', 100, { setupId: undefined, setupName: 'Opening drive' }),
    ];

    const { setups, totals, warnings } = buildSetupResearch({ observations, trades });

    expect(totals.tradesInLog).toBe(3);
    expect(totals.tradesWithoutSetup).toBe(1);
    expect(totals.tradesWithoutSightings).toBe(2);
    expect(setups[0].tradeLog.trades).toBe(0);

    const said = warnings.join(' ');
    expect(said).toContain('1 of 3 trades names no setup');
    expect(said).toContain('2 trades are logged under a setup with no recorded sighting');
  });

  it('says a trade log is wider than the sightings without repeating a figure that already agrees', () => {
    const linked = taken('obs-1', 'trade-1', 'continuation');

    const alone = describeSeenVersusTaken(
      buildSetupResearch({ observations: [linked], trades: [logged('trade-1', 100)] }).setups[0]
    );
    expect(alone).not.toContain('with no sighting recorded');

    const withSurplus = describeSeenVersusTaken(
      buildSetupResearch({
        observations: [linked],
        trades: [logged('trade-1', 100), logged('trade-2', -50)],
      }).setups[0]
    );
    expect(withSurplus).toContain('A further 1 trade is logged under this setup with no sighting');
  });

  it('will not report an empty note over trades it holds but cannot group', () => {
    const { warnings } = buildSetupResearch({
      observations: [],
      trades: [logged('trade-1', 100)],
    });

    // "Nothing has been recorded yet" would be true of the sightings and false of the journal.
    expect(warnings[0]).toContain('No sighting has been recorded yet');
    expect(warnings[0]).toContain('1 trade is in the journal');
  });
});
