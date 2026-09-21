import type { DailyReview, TradingDay } from '../../types';

/**
 * Which trading days belong in the History archive.
 *
 * The journal creates a day object lazily for whatever date the app opens on, and keeps
 * the day it created. So every date the trader has ever opened the app leaves a row
 * behind — an untouched one carrying nothing but its defaults. Listed in History those
 * read as days that were traded and came to nothing, which is the opposite of what they
 * are: dates with no record at all. A trader who opened the app on a Sunday, or who is
 * looking at today before doing anything, should not be shown a "Sunday, Sep 20 — $0.00,
 * 0 trades" card.
 *
 * This module decides that one question, as a pure function, so the rule can be stated
 * and tested in one place rather than inferred from a component's filter chain.
 */

export interface DayActivityFacts {
  /**
   * How many trades the day holds, open and closed together.
   *
   * Open trades count: a position still on is a record of the session, and the day detail
   * shows it.
   */
  tradeCount: number;
  /** The day's end-of-day review, when one was written. */
  review?: DailyReview;
}

/**
 * Whether a day holds anything worth archiving.
 *
 * Kept deliberately narrow: only things the trader *did* count. Everything a lazily
 * created day is given for free — a neutral bias, one planned contract, the profile's
 * loss limit, the three default set-ups, an empty level list — is excluded, because none
 * of it was chosen by anyone. When in doubt this counts a day in, since hiding something
 * the trader actually wrote is worse than showing a sparse card.
 *
 * `watchedSetups` is not consulted at all, and that is the one surprising rule here: a
 * fresh day already arrives holding three default set-up names, so an untouched plan's
 * list and a hand-picked one cannot be told apart from the day alone.
 */
export function dayHasRecordedActivity(
  day: TradingDay,
  facts: DayActivityFacts
): boolean {
  // A trade is the strongest signal there is: the session happened.
  if (facts.tradeCount > 0) return true;

  // A review, a locked plan, or a change recorded against a locked plan.
  if (facts.review) return true;
  if (day.lockedAt || day.lockedSnapshot) return true;
  if (day.planChanges.length > 0) return true;

  // The day was closed out on purpose.
  if (day.endedAt) return true;

  // Plan text or levels the trader typed. The lazily created day carries empty strings and
  // an empty level list, so anything here was written by hand.
  if (day.waitingFor.trim() !== '') return true;
  if (day.stayOutIf.trim() !== '') return true;
  if ((day.notes ?? '').trim() !== '') return true;
  if (day.importantLevels.length > 0) return true;

  // The day's risk was deliberately widened, which always carries a written reason.
  if ((day.profitCushionContext ?? '').trim() !== '') return true;
  if ((day.riskIncreaseReason ?? '').trim() !== '') return true;

  // A bias the trader picked. 'neutral' is the default and proves nothing, but bullish,
  // bearish or 'unsure' is a choice someone made.
  if (day.marketBias !== 'neutral') return true;

  return false;
}
