/**
 * What the matched observations actually amounted to, counted honestly.
 *
 * This module produces the sentence the whole feature exists to be able to say: *twelve
 * comparable cases, eight continued, three reversed, one not recorded*. Getting that sentence
 * right is almost entirely a question of denominators, so this is where the denominators are
 * written down and tested.
 *
 * The two rules that matter most:
 *
 *   1. **Market behaviour and trade execution are never combined.** A setup can continue
 *      upward while the trader's own trade loses money — entered late, stopped tightly, exited
 *      early — and a single "win rate" over both would be reporting a market statistic that was
 *      never measured and hiding an execution statistic that was. They are counted separately,
 *      always, and the two rates are separate numbers.
 *   2. **Unknown is a result.** An observation with nothing recorded after it is not a case that
 *      failed to continue; it is a case nobody wrote down. Dropping it silently would make the
 *      denominator look complete and the rate look better than the evidence supports, so the
 *      unknown count is returned alongside every rate and a rate is withheld entirely until the
 *      decided sample clears a floor.
 *
 * `unclear` deserves its own note: it is a market reading the trader made and could not classify
 * as continuation or reversal. It counts as known (something was recorded) but it is excluded
 * from the continuation rate's denominator, because a reading that could not be classified as a
 * reversal is not one.
 */

import type { MemoryContinuation } from '../../types';

/**
 * The decided cases a rate needs before it is a rate.
 *
 * Five mirrors the floor the level-recurrence read already uses for the same reason: below it
 * the percentages move by twenty points per case, so what looks like a finding is arithmetic
 * noise. Under the floor the counts are still returned — they are true — and only the rate is
 * withheld.
 */
export const MEMORY_MIN_OUTCOME_SAMPLE = 5;

/** The market outcome of one matched observation, as it was recorded. */
export type MemoryMarketOutcome = MemoryContinuation | 'unknown';

/** The trader's own result on the trade attached to that observation, when there was one. */
export type MemoryTradeResult = 'win' | 'loss' | 'breakeven' | 'open';

export interface MemoryOutcomeSample {
  observationId: string;
  /** What price did, or `unknown` when nothing was recorded. */
  marketOutcome: MemoryMarketOutcome;
  /** What the trader's own trade did. Absent means no trade was taken under this observation. */
  tradeResult?: MemoryTradeResult;
}

export interface MemoryOutcomeSummary {
  /** Every observation handed in, including the ones with nothing recorded. */
  matched: number;

  /** Cases where SOMETHING was recorded about price: continuation, reversal or unclear. */
  marketKnown: number;
  /** Cases with nothing recorded about price. A real answer, not a gap to be filled in. */
  marketUnknown: number;
  /**
   * The continuation rate's denominator: cases recorded as a genuine continuation or reversal.
   * Never includes `unclear` or `unknown`.
   */
  marketDecided: number;
  continuations: number;
  reversals: number;
  unclear: number;
  /** Continuations over decisions, or null when the decided sample is below the floor. */
  continuationRate: number | null;

  /** Observations with an executed trade attached. */
  traded: number;
  wins: number;
  losses: number;
  /** Excluded from the win rate: a scratch is neither a win nor a loss. */
  breakeven: number;
  /** Trades still open, so they have no result yet to count. */
  openTrades: number;
  /** Wins over decided trades (wins + losses), or null when that sample is below the floor. */
  winRate: number | null;

  /** The sample floor a rate had to clear, echoed so the display can describe it. */
  minSample: number;
  /** Plain-language notes about what the numbers cannot support. */
  warnings: string[];
}

export interface MemoryOutcomeOptions {
  minSample?: number;
}

/**
 * Counts a set of matched observations into market behaviour and trade execution.
 *
 * Every rate is `null` rather than `0` when its sample is too thin, because a displayed "0%"
 * beside three cases reads as a finding and a withheld rate does not. The counts are returned
 * either way so nothing is hidden behind the decision to withhold.
 */
export function summarizeMemoryOutcomes(
  samples: readonly MemoryOutcomeSample[],
  options: MemoryOutcomeOptions = {}
): MemoryOutcomeSummary {
  const minSample = Math.max(1, options.minSample ?? MEMORY_MIN_OUTCOME_SAMPLE);

  let continuations = 0;
  let reversals = 0;
  let unclear = 0;
  let marketUnknown = 0;

  let traded = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let openTrades = 0;

  for (const sample of samples) {
    // ---- Market behaviour: what price did, which is independent of what the trader did.
    if (sample.marketOutcome === 'continuation') continuations += 1;
    else if (sample.marketOutcome === 'reversal') reversals += 1;
    else if (sample.marketOutcome === 'unclear') unclear += 1;
    else marketUnknown += 1;

    // ---- Execution: what the trader did, which is independent of what price did.
    if (sample.tradeResult === 'win') {
      traded += 1;
      wins += 1;
    } else if (sample.tradeResult === 'loss') {
      traded += 1;
      losses += 1;
    } else if (sample.tradeResult === 'breakeven') {
      traded += 1;
      breakeven += 1;
    } else if (sample.tradeResult === 'open') {
      traded += 1;
      openTrades += 1;
    }
  }

  const marketKnown = continuations + reversals + unclear;
  const marketUnknownCount = marketUnknown;
  const marketDecided = continuations + reversals;
  const decidedTrades = wins + losses;

  const continuationRate =
    marketDecided >= minSample ? Math.round((continuations / marketDecided) * 1000) / 10 : null;
  const winRate = decidedTrades >= minSample ? Math.round((wins / decidedTrades) * 1000) / 10 : null;

  const warnings: string[] = [];
  if (samples.length === 0) {
    warnings.push('Nothing matched, so there is no evidence to read at all.');
  } else {
    if (marketDecided === 0) {
      warnings.push(
        'No matched case has a recorded continuation or reversal, so there is no market rate to ' +
          'read yet — only the counts.'
      );
    } else if (marketDecided < minSample) {
      warnings.push(
        `${marketDecided} of ${samples.length} ${
          samples.length === 1 ? 'case is' : 'cases are'
        } a recorded continuation or reversal. A rate needs ${minSample}, so the counts are ` +
          'shown and the percentage is not.'
      );
    }
    if (marketUnknownCount > 0) {
      warnings.push(
        `${marketUnknownCount} of ${samples.length} ${
          samples.length === 1 ? 'case has' : 'cases have'
        } no recorded market outcome. They are counted as unknown, never as a reversal.`
      );
    }
    if (unclear > 0) {
      warnings.push(
        `${unclear} ${unclear === 1 ? 'reading was' : 'readings were'} recorded as unclear and ` +
          `left out of the continuation rate's denominator.`
      );
    }
    if (openTrades > 0) {
      warnings.push(
        `${openTrades} ${openTrades === 1 ? 'trade is' : 'trades are'} still open, so ` +
          `${openTrades === 1 ? 'it has' : 'they have'} no result to count yet.`
      );
    }
    if (traded === 0) {
      warnings.push(
        'None of these setups was traded, so there is no execution record here — only what the ' +
          'market did.'
      );
    } else if (decidedTrades < minSample) {
      warnings.push(
        `${decidedTrades} of ${traded} ${
          traded === 1 ? 'trade' : 'trades'
        } among these matches is decided. A win rate needs ${minSample} decided trades.`
      );
    }
  }

  return {
    matched: samples.length,
    marketKnown,
    marketUnknown: marketUnknownCount,
    marketDecided,
    continuations,
    reversals,
    unclear,
    continuationRate,
    traded,
    wins,
    losses,
    breakeven,
    openTrades,
    winRate,
    minSample,
    warnings,
  };
}

/**
 * Formats a rate that may legitimately not exist yet.
 *
 * One place decides how a withheld rate reads, so a "not enough cases" can never be rendered as
 * a zero somewhere the numbers were formatted by hand.
 */
export function formatMemoryRate(rate: number | null): string {
  return rate === null ? 'not enough cases' : `${rate}%`;
}

/**
 * The outcome windows a trader may pick, stated as horizons rather than as free text.
 *
 * Free text here would be a trap: two observations recorded as "30 min after open" and "half an
 * hour into the session" would sit in different buckets while meaning the same thing, and the
 * whole value of the field is that comparable cases group together. The list is a starting
 * point, and `window` on the record is still a string so a trader can add their own.
 */
export const MEMORY_OUTCOME_WINDOWS: readonly string[] = [
  '15 minutes after the open',
  '30 minutes after the open',
  '1 hour after the open',
  'End of the overnight session',
  'End of the regular session',
  'Next session',
];
