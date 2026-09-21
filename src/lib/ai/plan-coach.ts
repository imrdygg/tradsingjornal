import type { DailyReview, Instrument, Setup, Trade, TradingDay } from '../../types';
import { buildJournalDigest, type JournalDigest } from './journal-digest';
import { requestCoach, type CoachResult } from './coach-client';
import type {
  CoachEntryFacts,
  CoachPositionFacts,
  PlanFieldName,
} from './coach-types';
import type { InstrumentQuote } from './market-data';

/**
 * The plan-side half of the coach, for the browser.
 *
 * Every call here is one the trader asked for by pressing a button, or that the app
 * makes at the single moment an entry is recorded. Nothing runs on a timer and nothing
 * writes into the plan on its own: a suggestion is returned to the component that asked
 * for it, and only the trader's own click puts it in a field.
 *
 * The digest is rebuilt for each call rather than cached, because the whole point of
 * these answers is that they reflect the journal as it is right now.
 */

/** Everything the coach needs to know about this journal. */
export interface PlanCoachContext {
  day: TradingDay;
  /**
   * The account drawdown the trader has agreed to.
   *
   * It travels with the day rather than being looked up, because it is a limit the coach
   * must be able to weigh a suggested plan or size against, and because a suggestion that
   * ignores the room left is the one kind of answer that can cost real money.
   */
  maxDrawdown?: number | null;
  instruments: Instrument[];
  setups: Setup[];
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  timezone: string;
}

export function buildPlanCoachDigest(context: PlanCoachContext): JournalDigest {
  return buildJournalDigest({
    maxDrawdown: context.maxDrawdown ?? null,
    trades: context.trades,
    tradingDays: context.tradingDays,
    reviews: context.reviews,
    setups: context.setups,
    instruments: context.instruments,
    todayTradeDate: context.day.tradeDate,
    timezone: context.timezone,
  });
}

/** Drafts text for one plan field. The trader decides whether to keep it. */
export function askPlanField(
  context: PlanCoachContext,
  field: PlanFieldName,
  currentValue: string
): Promise<CoachResult> {
  return requestCoach('planfield', buildPlanCoachDigest(context), undefined, {
    field,
    currentFieldValue: currentValue,
    instrument: context.day.primaryInstrument,
  });
}

/** Drafts a whole plan for the day, from the trader's style plus a live instrument read. */
export function askPlanBuild(context: PlanCoachContext): Promise<CoachResult> {
  return requestCoach('planbuild', buildPlanCoachDigest(context), undefined, {
    instrument: context.day.primaryInstrument,
  });
}

/** Opinion on adding to a position that is already on. */
export function askScaleIn(
  context: PlanCoachContext,
  position: CoachPositionFacts
): Promise<CoachResult> {
  return requestCoach('scalein', buildPlanCoachDigest(context), undefined, {
    instrument: position.symbol,
    position: { ...position, plannedLossLimit: position.plannedLossLimit ?? context.day.plannedLossLimit },
  });
}

/**
 * The coach's own call at the moment an entry is recorded. Stored beside the trade so
 * the two can be compared later; never shown as an instruction to act on.
 */
export function askEntryCall(
  context: PlanCoachContext,
  entry: CoachEntryFacts
): Promise<CoachResult> {
  return requestCoach('entrycall', buildPlanCoachDigest(context), undefined, {
    instrument: entry.symbol,
    entry,
  });
}

/**
 * The coach's read of one instrument's recent daily bars — the request behind the
 * Markets view's "What does the coach see?" button.
 *
 * The server fetches the same series the chart shows and hands it to the model with the
 * journal digest, so the opinion quotes the numbers on screen and weighs them against
 * the trader's own documented habits.
 */
export function askChartRead(context: PlanCoachContext, symbol: string): Promise<CoachResult> {
  return requestCoach('chartread', buildPlanCoachDigest(context), undefined, {
    instrument: symbol,
  });
}

/**
 * The live futures read, through the same public endpoint the plan preview uses.
 *
 * Returns null on any failure: the price is context for the panel, never a
 * requirement, and a plan form that stopped working because a quote provider was down
 * would be worse than one that shows no price.
 */
export async function fetchInstrumentQuote(symbol: string): Promise<InstrumentQuote | null> {
  if (!symbol.trim()) return null;
  try {
    const res = await fetch(`/api/market?symbol=${encodeURIComponent(symbol.trim())}`);
    if (!res.ok) return null;
    const payload = (await res.json()) as { instrument?: InstrumentQuote };
    const quote = payload.instrument;
    return quote && typeof quote === 'object' ? quote : null;
  } catch {
    return null;
  }
}

/** A price for display, or a dash when the read has none. */
export function formatQuotePrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '—';
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A signed percent for display, or a dash. */
export function formatQuotePercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}
