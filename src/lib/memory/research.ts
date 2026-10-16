/**
 * The historical research read: how often a setup was SEEN against how often it was TAKEN.
 *
 * This is the question the whole feature exists to be able to answer, and it is a question the
 * library is unusually well placed to answer because a sighting does not require a trade. That is
 * the point of recording observations rather than only trades: the trader can ask *"what happened
 * the last forty times this setup appeared"* instead of *"what happened the three times I traded
 * it"*, and those two questions have different answers.
 *
 * Three rules shape everything below, and each is a thing that is easy to get subtly wrong:
 *
 *   1. **Seen and taken are two populations, and they are never blended.** Forty sightings and three
 *      trades are two facts, and a screen that reported a single sample size of forty for the
 *      execution figures would be claiming a record of forty trades. The counts are returned
 *      separately, the two denominators are stated wherever a rate is, and the gap between them is
 *      a number the trader is shown rather than a rounding decision.
 *   2. **A gap is not a zero.** A trade the trader took whose result was never recorded, a sighting
 *      with nothing written about what price did, a window that is only part of a setup's history —
 *      each is counted and named. `takenWithoutResult` exists specifically so that a missing result
 *      cannot be read as a loss: three trades taken with one result recorded is not three losses.
 *   3. **Nothing is recalculated.** Every figure comes from `summarizeMemoryOutcomes`, over samples
 *      built by the same `marketOutcomeSample` and `tradeResultSample` a search result uses. The
 *      market/execution split, the sample floor and the withholder of thin rates are all that
 *      module's decisions, inherited rather than re-derived — a second implementation of a win rate
 *      here would eventually disagree with the one shown beside a search.
 *
 * The one judgement this module adds on top of those: `searchable`. An observation with no picture,
 * or with only pictures from after the decision, can never be found by a similarity search however
 * much is written on it. Reporting the record and reporting what a search could have reached are
 * different facts, and a setup whose history is large but mostly unphotographed is exactly the case
 * where confusing them would mislead.
 */

import type { Trade, TradingObservation } from '../../types';
import { hasTrustworthyObservationTime, isPreDecisionRole } from './eligibility';
import {
  MEMORY_MIN_OUTCOME_SAMPLE,
  summarizeMemoryOutcomes,
  type MemoryOutcomeSample,
  type MemoryOutcomeSummary,
} from './outcomes';
import { marketOutcomeSample, tradeResultSample } from './results';

/**
 * What is known about one setup across the trader's record.
 *
 * The two denominators are the whole shape of this: `seen` is what every market figure is over, and
 * `seen`/`taken` are what the execution figures are over. They are never added together, averaged,
 * or described as one sample.
 */
export interface MemorySetupResearch {
  /**
   * What this setup is grouped by: its id when it has one, else its name.
   *
   * The id is preferred because a renamed setup must not split its own history in two — the
   * observation stores the name it had at the time, so grouping on the name alone would quietly
   * fragment the record exactly when the trader tidies their setup list.
   */
  setupKey: string;
  /** The name to show, which is the most recent one recorded on a sighting. */
  setupName: string;
  setupCategory?: string;

  /** Observations in the window where this setup appeared, traded or not. */
  seen: number;
  /** How many of those sightings have a trade present in the journal. */
  taken: number;
  /** Sightings with no trade under them. A real answer: most sightings are not trades. */
  notTaken: number;
  /**
   * Sightings the trader traded whose trade produced no result at all.
   *
   * Two cases, and both are the same thing to a reader: a trade still open, which has no result yet
   * by definition, and a trade that is closed with no readable P&L on the record. Counted so that a
   * missing result can never be read as a loss and so that the number is visible next to the win
   * rate it was left out of. A scratch is NOT counted here — it is a result, and it is excluded
   * from the rate's denominator for a different reason.
   */
  takenWithoutResult: number;

  /**
   * The outcome summary over this setup's window.
   *
   * Read it as two populations, because that is what it is: the market fields are over every
   * sighting (`seen`), and the trade fields are over the traded ones (`taken`). The module this
   * comes from counts them separately by design, so a single rate can never be produced from both.
   */
  outcomes: MemoryOutcomeSummary;

  /** Sightings whose own timestamp cannot be trusted, so they cannot be placed in time. */
  untrustedTime: number;
  /** Sightings a similarity search could actually have reached: a completed pre-decision picture. */
  searchable: number;

  /**
   * The most recent sighting in the window, so a caller can open one concrete record.
   *
   * The id is carried rather than left to the caller to re-derive. A screen that wants to open
   * "this setup's latest sighting" would otherwise have to search the whole library again, and it
   * would have to apply the same window to get the same answer — which is exactly the kind of
   * second implementation that drifts from this one.
   */
  newestObservationId?: string;

  firstSeenAt?: string;
  lastSeenAt?: string;
  /** True when the window holds only part of this setup's history. */
  truncated: boolean;
  /** True when a rate was withheld because its sample is below the floor. */
  thinSample: boolean;
  /** The floor a rate had to clear, echoed so the display can quote it. */
  minSample: number;
}

/** The library-level counts, each of which is a count of observations and says so. */
export interface MemoryResearchTotals {
  /** How many setups the record contains. */
  setups: number;
  /** Every observation handed in, including ones with no setup at all. */
  observations: number;
  /** Observations that could be grouped under a setup. */
  grouped: number;
  /** Observations with no setup written on them. Reported, never silently dropped. */
  unlabelled: number;
  /** Sightings with a trade under them, across every setup. */
  taken: number;
  /** Sightings whose trade has no readable result yet. */
  takenWithoutResult: number;
  /** Sightings with something recorded about what price did afterwards. */
  withRecordedOutcome: number;
  /** Sightings whose timestamp cannot be trusted. */
  untrustedTime: number;
  /** Sightings a search could have reached. */
  searchable: number;
}

export interface MemoryResearch {
  /** Ranked by how much is recorded about each, most first. */
  setups: MemorySetupResearch[];
  totals: MemoryResearchTotals;
  /** What this read cannot support. Passed through from the outcome summary per setup. */
  warnings: string[];
}

export interface MemoryResearchInput {
  observations: readonly TradingObservation[];
  /** The journal's trades. A sighting's `linkedTradeId` is resolved against these. */
  trades?: readonly Trade[];
  /**
   * How many of the most recent sightings per setup to summarise.
   *
   * The question this dashboard answers is usually asked about the recent past, but a window is
   * only ever applied to the FRONT of the list and `truncated` reports that it was applied, so a
   * figure is never quietly a subset of the record it appears to describe.
   */
  limitPerSetup?: number;
  /** The sample floor a rate must clear. Defaults to the outcome module's own floor. */
  minSample?: number;
}

/** Milliseconds for a timestamp, or null when it is missing or unparseable. */
function parseInstant(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The most recent sightings first, then by id so the order is total. */
function byMostRecent(a: TradingObservation, b: TradingObservation): number {
  const aMs = parseInstant(a.observedAt);
  const bMs = parseInstant(b.observedAt);
  // A sighting that cannot be placed in time sorts last rather than first. It must not jump the
  // queue and become the newest thing the trader has seen, which is what a NaN comparison or a
  // zero would do.
  const aKey = aMs === null ? Number.MIN_SAFE_INTEGER : aMs;
  const bKey = bMs === null ? Number.MIN_SAFE_INTEGER : bMs;
  return bKey - aKey || a.id.localeCompare(b.id);
}

/**
 * The key a sighting is grouped under, or null when it names no setup at all.
 *
 * Null is returned rather than a placeholder like `'(unnamed)'` so an unlabelled sighting cannot
 * collide with a setup a trader genuinely called that, and so the caller can count unlabelled
 * observations as their own fact instead of printing them as one more setup.
 */
export function setupResearchKey(observation: TradingObservation): string | null {
  const id = observation.setupId?.trim();
  if (id) return `id:${id}`;
  const name = observation.setupName?.trim();
  return name ? `name:${name.toLowerCase()}` : null;
}

/** Whether a search could have reached this sighting: a completed picture from before the decision. */
function isSearchable(observation: TradingObservation): boolean {
  return (observation.images ?? []).some(
    (image) => isPreDecisionRole(image.role) && image.indexStatus === 'completed'
  );
}

/** Builds one sample per sighting, pairing its own market reading with its own trade. */
function samplesFor(
  observations: readonly TradingObservation[],
  tradesById: ReadonlyMap<string, Trade>
): MemoryOutcomeSample[] {
  return observations.map((observation) => {
    const sample: MemoryOutcomeSample = {
      observationId: observation.id,
      marketOutcome: marketOutcomeSample(observation.outcome),
    };
    const trade = observation.linkedTradeId ? tradesById.get(observation.linkedTradeId) : undefined;
    const tradeResult = tradeResultSample(trade);
    // Assigned rather than present-and-undefined, so an absent result is an absent key rather than
    // a value a reader could mistake for something recorded.
    if (tradeResult) sample.tradeResult = tradeResult;
    return sample;
  });
}

/**
 * Groups the record by setup and counts what happened.
 *
 * Ordering of the returned list is total — most sightings first, then most trades, then the key —
 * so the same record always produces the same ranking, and so a setup's position cannot move
 * because two setups happen to have equal counts.
 */
export function buildSetupResearch(input: MemoryResearchInput): MemoryResearch {
  const { observations, trades = [] } = input;
  const minSample = Math.max(1, input.minSample ?? MEMORY_MIN_OUTCOME_SAMPLE);
  const limit = input.limitPerSetup;

  const tradesById = new Map<string, Trade>();
  for (const trade of trades) tradesById.set(trade.id, trade);

  // Insertion order is the record's own order, and the final sort is total, so nothing here
  // depends on it — but keeping the groups in encounter order makes a debug read of it match the
  // input rather than a hash bucket order.
  const groups = new Map<string, TradingObservation[]>();
  let unlabelled = 0;

  for (const observation of observations) {
    const key = setupResearchKey(observation);
    if (!key) {
      unlabelled += 1;
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(observation);
    else groups.set(key, [observation]);
  }

  const setups: MemorySetupResearch[] = [];

  for (const [setupKey, all] of groups) {
    // The whole group is sorted before it is windowed, so "the most recent N" means the most recent
    // N of this setup's history and not of the order the caller happened to hand them in.
    const ordered = [...all].sort(byMostRecent);
    const window = limit === undefined ? ordered : ordered.slice(0, Math.max(0, limit));
    const truncated = window.length < ordered.length;

    const samples = samplesFor(window, tradesById);
    const outcomes = summarizeMemoryOutcomes(samples, { minSample });

    // Narrowed through a local rather than by reading the property twice: a `linkedTradeId` is
    // optional, and the count must not depend on how well a type-checker follows a property access
    // across a predicate.
    const taken = window.filter((observation) => {
      const tradeId = observation.linkedTradeId;
      return typeof tradeId === 'string' && tradeId.length > 0 && tradesById.has(tradeId);
    }).length;

    // `outcomes.traded` counts trades whose status is at least known — a win, a loss, a scratch or
    // one still open — so a trade with no result is either one of the open ones or a closed trade
    // that produced no sample at all (no readable P&L on the record). Those two are added together
    // because to a reader they are one thing; neither may fall through into the losses, and a
    // scratch is deliberately in neither, because a scratch IS a result.
    const closedWithoutResult = Math.max(0, taken - outcomes.traded);
    const takenWithoutResult = outcomes.openTrades + closedWithoutResult;

    // The name shown is the newest one recorded, so a tidied-up setup name reads as the trader last
    // wrote it rather than as whatever the oldest sighting happened to say.
    const newest = window[0];

    setups.push({
      setupKey,
      setupName: newest?.setupName?.trim() || newest?.setupId?.trim() || setupKey.replace(/^[a-z]+:/, ''),
      setupCategory: newest?.setupCategory,
      newestObservationId: newest?.id,
      seen: window.length,
      taken,
      notTaken: window.length - taken,
      takenWithoutResult,
      outcomes,
      untrustedTime: window.filter((observation) => !hasTrustworthyObservationTime(observation))
        .length,
      searchable: window.filter(isSearchable).length,
      // Each end of the range is found independently, so a window whose newest sighting has no
      // usable timestamp still reports the oldest one that does. Absent rather than an empty string
      // when nothing can be placed at all: an empty string reads as a date on a screen.
      firstSeenAt: oldestWithTime(window),
      lastSeenAt: newestWithTime(window),
      truncated,
      // A withheld EXECUTION rate only counts as thin when there are trades whose rate is being
      // withheld. A setup that was never traded has no win rate because no trade exists, not because
      // the sample is small, and flagging it would read as "come back with more trades" about a
      // setup the trader has deliberately been watching instead of taking.
      thinSample:
        outcomes.continuationRate === null || (taken > 0 && outcomes.winRate === null),
      minSample,
    });
  }

  // Most-recorded first: a setup with forty sightings is what a research read is for, and the
  // ranking is stable because the key is unique.
  setups.sort(
    (a, b) => b.seen - a.seen || b.taken - a.taken || a.setupKey.localeCompare(b.setupKey)
  );

  const totals: MemoryResearchTotals = {
    setups: setups.length,
    observations: observations.length,
    grouped: observations.length - unlabelled,
    unlabelled,
    taken: setups.reduce((sum, entry) => sum + entry.taken, 0),
    takenWithoutResult: setups.reduce((sum, entry) => sum + entry.takenWithoutResult, 0),
    withRecordedOutcome: setups.reduce((sum, entry) => sum + entry.outcomes.marketKnown, 0),
    untrustedTime: setups.reduce((sum, entry) => sum + entry.untrustedTime, 0),
    searchable: setups.reduce((sum, entry) => sum + entry.searchable, 0),
  };

  return { setups, totals, warnings: researchWarnings(totals, limit) };
}

/** The oldest placeable moment in a window, or undefined when none can be placed. */
function oldestWithTime(observations: readonly TradingObservation[]): string | undefined {
  let best: string | undefined;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const observation of observations) {
    const ms = parseInstant(observation.observedAt);
    if (ms !== null && ms < bestMs) {
      bestMs = ms;
      best = observation.observedAt;
    }
  }
  return best;
}

/** The newest placeable moment in a window, or undefined when none can be placed. */
function newestWithTime(observations: readonly TradingObservation[]): string | undefined {
  let best: string | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const observation of observations) {
    const ms = parseInstant(observation.observedAt);
    if (ms !== null && ms > bestMs) {
      bestMs = ms;
      best = observation.observedAt;
    }
  }
  return best;
}

/**
 * What the library-level numbers cannot support.
 *
 * Every line states a fact about the record rather than about the market. The temptation with a
 * dashboard like this is to add one closing line of encouragement; the reason not to is that the
 * only thing this data can honestly say is what was written down.
 */
function researchWarnings(totals: MemoryResearchTotals, limit: number | undefined): string[] {
  const warnings: string[] = [];

  if (totals.observations === 0) {
    warnings.push(
      'Nothing has been recorded yet, so there is no history to read. Record a sighting and this ' +
        'becomes a count of your own record rather than an empty panel.'
    );
    return warnings;
  }

  if (limit !== undefined) {
    warnings.push(
      `Each setup is read over its ${limit} most recent ${limit === 1 ? 'sighting' : 'sightings'}, ` +
        'not over its whole history. A setup marked as cut off has older sightings that are not ' +
        'counted below.'
    );
  }

  if (totals.unlabelled > 0) {
    warnings.push(
      `${totals.unlabelled} of ${totals.observations} ${
        totals.unlabelled === 1 ? 'sighting names' : 'sightings name'
      } no setup, so ${totals.unlabelled === 1 ? 'it is' : 'they are'} counted separately rather ` +
        'than grouped into one.'
    );
  }

  if (totals.taken === 0) {
    warnings.push(
      'No sighting here has a trade under it, so the execution half of every comparison is empty. ' +
        'That is what was recorded, not a run of losses.'
    );
  } else if (totals.takenWithoutResult > 0) {
    warnings.push(
      `${totals.takenWithoutResult} of ${totals.taken} ${
        totals.takenWithoutResult === 1 ? 'trade has' : 'trades have'
      } no readable result yet, so ${totals.takenWithoutResult === 1 ? 'it is' : 'they are'} ` +
        'excluded from the win rate rather than counted as a loss.'
    );
  }

  if (totals.untrustedTime > 0) {
    warnings.push(
      `${totals.untrustedTime} ${
        totals.untrustedTime === 1 ? 'sighting has' : 'sightings have'
      } a timestamp that cannot be trusted, so ${
        totals.untrustedTime === 1 ? 'it' : 'they'
      } cannot be placed in a replay and may sit on the wrong side of a date you filter by.`
    );
  }

  if (totals.searchable === 0) {
    warnings.push(
      'No sighting here has a searchable picture. The record below is complete, but a similarity ' +
        'search cannot reach any of it until a pre-decision chart is attached and indexed.'
    );
  } else if (totals.searchable < totals.grouped) {
    warnings.push(
      `Only ${totals.searchable} of ${totals.grouped} grouped sightings have a searchable ` +
        'pre-decision chart, so a search will reach fewer cases than this record contains.'
    );
  }

  return warnings;
}

/**
 * The headline sentence for one setup: what was seen against what was taken.
 *
 * Deliberately one sentence containing both denominators, because the failure this whole module
 * guards against is a reader taking the larger number and applying it to the smaller population.
 * The market counts are quoted over sightings and the execution counts over trades, in the same
 * breath, so the two can be compared without either being stretched over the other's sample.
 */
export function describeSeenVersusTaken(entry: MemorySetupResearch): string {
  const { seen, taken, outcomes } = entry;
  const parts: string[] = [];

  parts.push(
    `Saw this setup ${seen} ${seen === 1 ? 'time' : 'times'} and took it ${taken} ${
      taken === 1 ? 'time' : 'times'
    }.`
  );

  const market: string[] = [];
  market.push(
    `${outcomes.continuations} continued and ${outcomes.reversals} reversed out of ` +
      `${outcomes.marketDecided} recorded ${outcomes.marketDecided === 1 ? 'reading' : 'readings'}`
  );
  if (outcomes.unclear > 0) market.push(`${outcomes.unclear} unclassified`);
  if (outcomes.marketUnknown > 0) market.push(`${outcomes.marketUnknown} with nothing written down`);
  parts.push(`Market, over the sightings: ${market.join(', ')}.`);

  if (taken === 0) {
    parts.push('No trade was taken, so there is no execution record for this setup.');
  } else {
    const execution: string[] = [`${outcomes.wins} won and ${outcomes.losses} lost`];
    if (outcomes.breakeven > 0) execution.push(`${outcomes.breakeven} broke even`);
    if (outcomes.openTrades > 0) execution.push(`${outcomes.openTrades} still open`);
    if (entry.takenWithoutResult > 0) {
      execution.push(`${entry.takenWithoutResult} with no result recorded`);
    }
    parts.push(
      `Execution, over the ${taken} ${taken === 1 ? 'trade' : 'trades'}: ${execution.join(', ')}.`
    );
  }

  return parts.join(' ');
}
