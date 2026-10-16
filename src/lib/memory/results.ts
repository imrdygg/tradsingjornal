/**
 * The evidence behind a set of matches, assembled in one place.
 *
 * A search returns observations. What the trader actually reads is a claim about them: *twelve
 * comparable cases, eight continued, three reversed, one not recorded, and of the four I traded,
 * three lost money*. That claim is assembled here, once, so that no screen invents its own
 * totals and two panels on the same result can never disagree.
 *
 * Three rules this module exists to hold:
 *
 *   1. **Market behaviour and trade execution are counted separately and never blended.** The
 *      market can continue upward after a setup while the trader's own trade loses money. The
 *      two rates are reported beside each other, and a single "success rate" is never produced,
 *      because it would be a market statistic that was never measured sitting on top of an
 *      execution statistic that was. `buildMemoryEvidence` returns both, and the tests pin down a
 *      case where they point in opposite directions.
 *   2. **Missing stays missing.** A case with no outcome recorded is `unknown`, never a reversal.
 *      A trade with no readable result is absent, never a scratch. Zero is a real number that a
 *      scratch can have, so using it for "nothing recorded" would let an empty record sort and
 *      average alongside a genuine one.
 *   3. **Nothing is recalculated.** Every figure comes off a field that was already stored on the
 *      record. This module does no P&L arithmetic, no tick value lookup and no R maths, because
 *      the journal already has one tested implementation of each and a second one here would
 *      eventually drift from it.
 */

import type { MemoryOutcome, Trade, TradingObservation } from '../../types';
import {
  summarizeMemoryOutcomes,
  type MemoryMarketOutcome,
  type MemoryOutcomeSample,
  type MemoryOutcomeSummary,
  type MemoryTradeResult,
} from './outcomes';

/**
 * One matched observation, with the resemblance it was shown at and its trade, if it had one.
 *
 * The resemblance travels with the case so the evidence and the list it came from describe the
 * same thing: a summary over "the matches" that does not record how close each one was cannot be
 * read against the floor that decided what counted as a match.
 */
export interface MemoryMatchedCase {
  observation: TradingObservation;
  /** Normalised resemblance, 0-100, as it was shown to the trader. */
  resemblance: number;
  /** The executed trade this observation was taken under, when there was one. */
  trade?: Trade;
}

/** The counts that describe what the matched set is made of, each with its own denominator. */
export interface MemoryEvidenceCounts {
  /** Every case handed in, including the ones with nothing recorded after them. */
  matched: number;
  /** Cases with an executed trade linked to them. */
  withTrade: number;
  /** Cases where something was recorded about what price did afterwards. */
  withRecordedOutcome: number;
  /** Cases where nothing was recorded about what price did afterwards. A real answer. */
  withoutRecordedOutcome: number;
  /** Cases with at least one pre-decision picture that finished indexing. */
  indexed: number;
  /** Cases whose pictures are not searchable, which is why a search could not have found them. */
  notIndexed: number;
}

export interface MemoryEvidence {
  /** The market and execution figures, from `summarizeMemoryOutcomes`. */
  summary: MemoryOutcomeSummary;
  /** The cases as they were ranked. Order is the caller's; this module does not re-sort them. */
  cases: MemoryMatchedCase[];
  counts: MemoryEvidenceCounts;
  /** What these numbers cannot support, from both this module and the outcome summary. */
  warnings: string[];
}

/**
 * What price did after a setup, reduced to the vocabulary the outcome summary counts in.
 *
 * Total, and it fails towards `unknown` on every branch. An absent outcome, an outcome still
 * marked `unknown`, and an outcome that says it was recorded but carries no continuation are all
 * the same answer here: nothing about price was written down. The alternative, inferring a
 * continuation from the mere presence of a record, would let a trader's unfinished note count as
 * evidence that a setup worked.
 */
export function marketOutcomeSample(outcome: MemoryOutcome | undefined): MemoryMarketOutcome {
  if (!outcome) return 'unknown';
  // Only a record that says it is a reading counts. `unknown` is the default state of a freshly
  // seen setup, and it must not be read as a reading of anything.
  if (outcome.status !== 'recorded') return 'unknown';
  if (outcome.continuation === 'continuation') return 'continuation';
  if (outcome.continuation === 'reversal') return 'reversal';
  if (outcome.continuation === 'unclear') return 'unclear';
  // Recorded, but with no continuation named: still nothing that can be counted as a direction.
  return 'unknown';
}

/**
 * What the trader's own trade did, from fields that are already on it.
 *
 * Three distinctions matter and each is a separate branch:
 *
 *   - **An open trade is not a result.** It is counted as `open` so the display can say the trade
 *     has no outcome yet, rather than leaving it looking like a loss or dropping it.
 *   - **A scratch is not a win and not a loss.** Exactly zero is `breakeven`, and the win rate's
 *     denominator excludes it, because a trade that went nowhere is not evidence either way.
 *   - **No trade is not a scratch.** An undefined trade returns undefined: nothing was taken, so
 *     there is no execution result at all. Returning `breakeven` here would fabricate a data
 *     point in the one column that is supposed to be a record of what the trader actually did.
 *
 * `netPnL` is preferred over `grossPnL` because fees are part of what the trader kept, and only
 * the stored values are read: no P&L is recomputed here.
 */
export function tradeResultSample(trade: Trade | undefined): MemoryTradeResult | undefined {
  if (!trade) return undefined;
  if (trade.status === 'open') return 'open';

  const pnl = typeof trade.netPnL === 'number' ? trade.netPnL : trade.grossPnL;
  // A missing or unreadable figure is not a break-even. It is the absence of a result, and it is
  // reported as absent so the execution column can show a gap rather than a zero.
  if (typeof pnl !== 'number' || !Number.isFinite(pnl)) return undefined;
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'breakeven';
}

/** Whether a case holds at least one picture that finished indexing and can be searched. */
function isCaseIndexed(observation: TradingObservation): boolean {
  return (observation.images ?? []).some((image) => image.indexStatus === 'completed');
}

/**
 * Builds the evidence for a set of matches.
 *
 * The samples are built one per case, pairing that case's own market outcome with its own trade's
 * result. Keeping the pairing intact is what stops a win on one setup being attributed to a
 * continuation on another: the two columns describe the same case, and only because they are
 * counted separately can a reader see that the market went one way and the trader's money went
 * the other.
 */
export function buildMemoryEvidence(
  cases: readonly MemoryMatchedCase[],
  options: { minSample?: number } = {}
): MemoryEvidence {
  const samples: MemoryOutcomeSample[] = cases.map((entry) => {
    const sample: MemoryOutcomeSample = {
      observationId: entry.observation.id,
      marketOutcome: marketOutcomeSample(entry.observation.outcome),
    };
    const tradeResult = tradeResultSample(entry.trade);
    // Assigned rather than spread, so an absent result is an absent key and not an explicit
    // `undefined` that a reader could mistake for a recorded value.
    if (tradeResult) sample.tradeResult = tradeResult;
    return sample;
  });

  const summary = summarizeMemoryOutcomes(samples, options);

  const indexed = cases.filter((entry) => isCaseIndexed(entry.observation)).length;
  const withTrade = cases.filter((entry) => Boolean(entry.trade)).length;
  const withRecordedOutcome = cases.filter(
    (entry) => marketOutcomeSample(entry.observation.outcome) !== 'unknown'
  ).length;

  // The outcome summary's warnings come first and are passed through untouched, so nothing it
  // decided to withhold is quietly re-enabled by this layer.
  const warnings: string[] = [...summary.warnings];

  if (cases.length === 0) {
    warnings.push(
      'There is nothing to read yet. Record an observation and this becomes evidence about your ' +
        'own history rather than an empty panel.'
    );
  } else {
    if (withTrade === 0) {
      // Stated separately from the outcome summary's own line because this one is about the
      // record's shape, not about a rate: the execution column is empty by construction, and a
      // reader should not go looking for a trade they never took.
      warnings.push(
        'None of these matches is linked to a trade, so the execution figures are empty by ' +
          'construction rather than because a result is missing.'
      );
    }
    if (withRecordedOutcome === 0) {
      // Broader than the summary's line about decided cases: this fires even when readings were
      // made and all of them were unclassifiable.
      warnings.push(
        'No match has an outcome recorded, so this is a record of what the setups looked like ' +
          'and nothing about what followed.'
      );
    }
  }

  return {
    summary,
    cases: [...cases],
    counts: {
      matched: cases.length,
      withTrade,
      withRecordedOutcome,
      withoutRecordedOutcome: cases.length - withRecordedOutcome,
      indexed,
      notIndexed: cases.length - indexed,
    },
    warnings,
  };
}
