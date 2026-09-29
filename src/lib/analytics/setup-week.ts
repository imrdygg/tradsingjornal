import { LevelKind, LevelTouch, Trade, TradingDay } from '../../types';
import { MIN_DECIDED, summarizeTouches, type LevelEdgeStats } from './level-edge';
import { realizedPnL } from './realized-pnl';

/**
 * One week of trades and level touches, read one setup at a time.
 *
 * The journal can already say how each setup has done over its whole history, and how each
 * level has held over its whole log. Neither answers the question a trader actually has on a
 * Sunday: *this week*, which of my setups is earning its place? That question needs a window
 * and a join — the trades taken under a setup and the touches logged for it, over the same
 * seven days — and it needs the two halves kept apart, because they are not the same kind of
 * evidence.
 *
 * The half split is deliberate:
 *
 * - **The outcome** is what the trades did: net P&L, R, the record. This is the half that
 *   decides, because it is the only half that had money on it.
 * - **The touch record** is what the levels did: of the touches with a decided answer, how
 *   many saw price never come back. This explains an outcome rather than standing in for
 *   one — a setup can hold beautifully at its levels and still lose money on bad sizing, and
 *   the read should be able to say so.
 *
 * Every rate carries the count it came from, and a setup without enough of either half says
 * so rather than being ranked on noise. Nothing here is a forecast.
 */

/** How many days the rolling window covers, counting back from today. */
export const SETUP_WEEK_DAYS = 7;

/**
 * Closed trades a setup needs in the window before any verdict may be named.
 *
 * A week of a two-setup journal is a handful of trades, so this is deliberately small — but
 * not one. "It made money the once" is the most expensive sentence in trading, and a journal
 * whose whole point is honest feedback should not be the thing that says it.
 */
export const MIN_SETUP_WEEK_TRADES = 3;

/**
 * The trade dates in a window ending on `to`, oldest first.
 *
 * Date arithmetic is done in UTC on purpose. A window is a list of trade dates — the same
 * `YYYY-MM-DD` strings the day records and the touch log use — so it must not drift when a
 * local clock changes, which is also why this takes and returns plain dates rather than
 * instants.
 */
export function setupWeekDates(to: string, days = SETUP_WEEK_DAYS): string[] {
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isInteger(days) || days < 1) return [];

  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(new Date(end - offset * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * The level kind a setup reads its touches from, if it is one of the two level setups.
 *
 * Support and Resistance are the same pattern at two sides of price, and the touch log
 * already records which side was touched. Matching on that rather than on a name typed again
 * is what keeps the log and the trades talking about the same subject.
 */
export function levelKindForSetup(name: string): LevelKind | null {
  const key = name.trim().toLowerCase();
  if (key === 'support') return 'support';
  if (key === 'resistance') return 'resistance';
  return null;
}

/**
 * What the window's own numbers say about a setup. Decided here, never by the model.
 *
 * The same rule the recent-form read follows: the conclusion is computed from the recorded
 * figures, so the writing and the numbers on screen cannot disagree about which setup is
 * working. The coach's job is to explain this, not to pick it.
 */
export type SetupVerdict =
  /** Enough trades, and the setup made money over the window. */
  | 'working'
  /** Enough trades, and it did not — including a flat week, which earns nothing back. */
  | 'not-working'
  /** Too few closed trades to say anything about it yet. */
  | 'too-thin';

/** One setup's week: what its trades did, and what its levels did. */
export interface SetupWeekRow {
  /** The setup's name, as the playbook spells it. */
  name: string;
  /** The level kind its touches are read from, or null when the name is not a level setup. */
  kind: LevelKind | null;
  /** Closed trades taken under this setup in the window. */
  trades: number;
  wins: number;
  losses: number;
  /** Realized P&L across those trades, net of fees where the journal knows them. */
  netPnL: number;
  totalR: number;
  /** Average R per closed trade, or null when there were none — never a confident zero. */
  avgR: number | null;
  /** True once there is a closed trade to read at all. */
  hasOutcome: boolean;
  /** The verdict the outcome supports; see {@link MIN_SETUP_WEEK_TRADES}. */
  verdict: SetupVerdict;
  /**
   * The touch record for this setup's levels over the same window, or null when the setup
   * has no level kind to read them from.
   */
  touchRecord: LevelEdgeStats | null;
}

export interface SetupWeek {
  /** First trade date in the window, inclusive. */
  from: string;
  /** Last trade date in the window — today, when a caller asks for one ending today. */
  to: string;
  /** How many days the window covers. */
  days: number;
  /** One row per setup asked for, in the order asked. */
  rows: SetupWeekRow[];
  /** True once any setup has a closed trade in the window. */
  hasOutcome: boolean;
  /** Decided trades a setup needs before a verdict may be read. */
  minTrades: number;
  /** Decided touches a hold rate needs before it may be read. */
  minDecided: number;
}

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** The trade date a trade belongs to, or null when its day is not in the list given. */
function tradeDate(trade: Trade, byId: Map<string, TradingDay>): string | null {
  if (!trade.tradingDayId) return null;
  return byId.get(trade.tradingDayId)?.tradeDate ?? null;
}

/**
 * The touches logged for one setup in the window.
 *
 * A touch is counted for the setup it was logged under when it names one, and otherwise for
 * the level kind it touched. The order matters: a level marked as a setup of the trader's own
 * belongs to that setup, not to the generic side of price it happened to be on, and reading
 * it in both places would report the same touch twice.
 */
function touchesForSetup(name: string, kind: LevelKind | null, touches: LevelTouch[]): LevelTouch[] {
  const wanted = name.trim().toLowerCase();
  return touches.filter((touch) => {
    const named = touch.setupName?.trim();
    if (named) return named.toLowerCase() === wanted;
    return kind !== null && touch.kind === kind;
  });
}

/**
 * Reads a window of trades and level touches, one setup at a time.
 *
 * Trades are counted by the day they were taken on, not by when they were typed in, so a
 * trade logged late still lands in the week it belongs to. Only closed trades carry an
 * outcome — an open one has no R and no realized P&L — so an open trade is left out of the
 * week's numbers rather than counted as a flat.
 */
export function buildSetupWeek(input: {
  trades: Trade[];
  tradingDays: TradingDay[];
  touches: LevelTouch[];
  /** The trade date the window ends on — today, in the trader's own calendar. */
  todayTradeDate: string;
  /**
   * The setups always reported, in the order the trader ordered them in their own playbook.
   *
   * Always, rather than only when they traded: a setup that was not taken all week is one of
   * the more useful things a weekly read can say, and a row that disappears when it is
   * unused is a row the trader never notices is missing.
   */
  focusSetupNames: string[];
  days?: number;
  minTrades?: number;
  minDecided?: number;
}): SetupWeek {
  const {
    trades,
    tradingDays,
    touches,
    todayTradeDate,
    focusSetupNames,
    days = SETUP_WEEK_DAYS,
    minTrades = MIN_SETUP_WEEK_TRADES,
    minDecided = MIN_DECIDED,
  } = input;

  const dates = setupWeekDates(todayTradeDate, days);
  const inWindow = new Set(dates);
  const dayById = new Map(tradingDays.map((day) => [day.id, day]));

  const closedThisWeek = trades.filter(
    (trade) => trade.status === 'closed' && inWindow.has(tradeDate(trade, dayById) ?? '')
  );
  const touchesThisWeek = touches.filter((touch) => inWindow.has(touch.tradeDate));

  // Setups the week's own trades were labelled with that are not in the playbook any more —
  // a renamed or deleted setup. Their trades are real and the window must not quietly drop
  // them, so they are reported after the playbook's own, most traded first.
  const extraCounts = new Map<string, number>();
  for (const trade of closedThisWeek) {
    const name = trade.setupName?.trim();
    if (!name || focusSetupNames.includes(name)) continue;
    extraCounts.set(name, (extraCounts.get(name) ?? 0) + 1);
  }
  const extraNames = [...extraCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  const rows: SetupWeekRow[] = [...focusSetupNames, ...extraNames].map((name) => {
    const mine = closedThisWeek.filter((trade) => (trade.setupName ?? '') === name);
    const netPnL = mine.reduce((sum, trade) => sum + realizedPnL(trade), 0);
    const totalR = mine.reduce((sum, trade) => sum + (trade.rMultiple || 0), 0);
    const wins = mine.filter((trade) => realizedPnL(trade) > 0).length;
    const losses = mine.filter((trade) => realizedPnL(trade) < 0).length;
    const enoughTrades = mine.length >= minTrades;

    // A row reports a touch record when it has one to read — it is one of the two level
    // setups, or the log carries touches named after it. A setup with neither shows no
    // touch column at all rather than a column of zeros, which would read as "nothing
    // held" when the truth is "there is nothing here to hold".
    const kind = levelKindForSetup(name);
    const mineTouches = touchesForSetup(name, kind, touchesThisWeek);
    const touchRecord =
      kind === null && mineTouches.length === 0
        ? null
        : summarizeTouches(mineTouches, minDecided);

    return {
      name,
      kind,
      trades: mine.length,
      wins,
      losses,
      netPnL: round(netPnL),
      totalR: round(totalR),
      avgR: mine.length ? round(totalR / mine.length) : null,
      hasOutcome: mine.length > 0,
      // A flat week is read as not working, not as working: a setup that spent a week of
      // screen time and returned nothing has to earn the next one, and calling that a
      // success would be the generous reading the trader cannot spend.
      verdict: !enoughTrades ? 'too-thin' : netPnL > 0 ? 'working' : 'not-working',
      touchRecord,
    };
  });

  return {
    from: dates[0] ?? todayTradeDate,
    to: dates[dates.length - 1] ?? todayTradeDate,
    days,
    rows,
    hasOutcome: rows.some((row) => row.hasOutcome),
    minTrades,
    minDecided,
  };
}
