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
 *
 * The same reading is then taken over several consecutive weeks, because one week of a
 * two-setup journal is a handful of trades and a single number cannot tell a setup that is
 * finding its footing from one that is coming apart. The series is what shows direction, and
 * the direction is computed here from the trader's own figures like the verdict is — a
 * judgement the model explains rather than makes.
 */

/** How many days the rolling window covers, counting back from today. */
export const SETUP_WEEK_DAYS = 7;

/**
 * How many consecutive weeks the trend covers, the current one included.
 *
 * Four is one trading month: enough for a shape to show at a trade or two a day, and few
 * enough that the oldest window is still a market the trader remembers trading.
 */
export const SETUP_TREND_WEEKS = 4;

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
 * A trade date shifted by whole days, in UTC.
 *
 * The trend's older windows are built by moving the end date back a week at a time, and that
 * arithmetic has to be the same day-count arithmetic the window itself uses or a series can
 * skip or repeat a day at a month boundary.
 */
function shiftTradeDate(date: string, days: number): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(at)) return date;
  return new Date(at - days * 86_400_000).toISOString().slice(0, 10);
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

/** One setup's outcome in one week of the trend. */
export interface SetupWeekPoint {
  /** First trade date in the week, inclusive. */
  from: string;
  /** Last trade date in the week, inclusive. */
  to: string;
  /** True for the week the rest of the read is about — the last seven days. */
  current: boolean;
  /** The verdict this one week supports on its own, by the same threshold as the read. */
  verdict: SetupVerdict;
  trades: number;
  wins: number;
  losses: number;
  netPnL: number;
  totalR: number;
  avgR: number | null;
  hasOutcome: boolean;
}

/**
 * Which way a setup's own weeks say it is heading. Computed here, never inferred by the model.
 *
 * The comparison is between the two most recent weeks that could be judged at all, not
 * necessarily the current one and the one before it: a week too thin to judge carries no
 * information, and skipping it is the honest reading of the weeks either side of it.
 */
export type SetupDirection =
  /** The latest judged week paid more than the one before it. */
  | 'improving'
  /** The latest judged week paid less than the one before it. */
  | 'deteriorating'
  /** The latest judged week paid the same as the one before it. */
  | 'steady'
  /** Fewer than two judged weeks in the trend — there is no line to read a slope from. */
  | 'too-thin';

/** One setup's week: what its trades did, what its levels did, and where the line is going. */
export interface SetupWeekRow {
  /** The setup's name, as the playbook spells it. */
  name: string;
  /** The level kind its touches are read from, or null when the name is not a level setup. */
  kind: LevelKind | null;
  /** Closed trades taken under this setup in the current window. */
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
   * The touch record for this setup's levels over the current window, or null when the setup
   * has no level kind to read them from.
   */
  touchRecord: LevelEdgeStats | null;
  /**
   * The last {@link SETUP_TREND_WEEKS} weeks for this setup, oldest first. The last entry is
   * the current window, and carries the same figures as the fields above.
   */
  trend: SetupWeekPoint[];
  /** The direction the two most recent judged weeks point in; see {@link SetupDirection}. */
  direction: SetupDirection;
  /** Weeks in the trend with enough closed trades to be judged at all. */
  judgedWeeks: number;
}

export interface SetupWeek {
  /** First trade date in the current window, inclusive. */
  from: string;
  /** Last trade date in the current window — today, when a caller asks for one ending today. */
  to: string;
  /** How many days the current window covers. */
  days: number;
  /** How many consecutive weeks the trend covers, the current one included. */
  trendWeeks: number;
  /** One row per setup asked for, in the order asked. */
  rows: SetupWeekRow[];
  /** True once any setup has a closed trade in the current window. */
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
  /** The trade date the current window ends on — today, in the trader's own calendar. */
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
  /** How many consecutive weeks the trend covers; one disables the series entirely. */
  weeks?: number;
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
    weeks = SETUP_TREND_WEEKS,
  } = input;

  const windowCount = Number.isInteger(weeks) && weeks > 0 ? weeks : 1;

  // Oldest window first and the current seven days last, so a row's series reads left to
  // right the way the trader remembers the month.
  const windows = Array.from({ length: windowCount }, (_, index) => {
    const weeksBack = windowCount - 1 - index;
    const end = shiftTradeDate(todayTradeDate, weeksBack * days);
    const dates = setupWeekDates(end, days);
    return {
      from: dates[0] ?? end,
      to: dates[dates.length - 1] ?? end,
      current: weeksBack === 0,
      dates: new Set(dates),
    };
  });
  const current = windows[windows.length - 1];

  const dayById = new Map(tradingDays.map((day) => [day.id, day]));
  const closedTrades = trades.filter((trade) => trade.status === 'closed');
  const dateOf = (trade: Trade) => tradeDate(trade, dayById) ?? '';

  const closedThisWeek = closedTrades.filter((trade) => current.dates.has(dateOf(trade)));
  const touchesThisWeek = touches.filter((touch) => current.dates.has(touch.tradeDate));

  // Setups the current week's own trades were labelled with that are not in the playbook any
  // more — a renamed or deleted setup. Their trades are real and the week must not quietly
  // drop them, so they are reported after the playbook's own, most traded first. Only this
  // week's names are considered: the row list is the current week's subject, and a name that
  // only traded a month ago is not part of it.
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
    // The same setup, read once per week of the trend. Each week carries its own verdict so
    // the series can be compared like with like: four figures from the same rule, rather
    // than four figures chosen to flatter a conclusion.
    const trend: SetupWeekPoint[] = windows.map((window) => {
      const mine = closedTrades.filter(
        (trade) => (trade.setupName ?? '') === name && window.dates.has(dateOf(trade))
      );
      const netPnL = mine.reduce((sum, trade) => sum + realizedPnL(trade), 0);
      const totalR = mine.reduce((sum, trade) => sum + (trade.rMultiple || 0), 0);

      return {
        from: window.from,
        to: window.to,
        current: window.current,
        trades: mine.length,
        wins: mine.filter((trade) => realizedPnL(trade) > 0).length,
        losses: mine.filter((trade) => realizedPnL(trade) < 0).length,
        netPnL: round(netPnL),
        totalR: round(totalR),
        avgR: mine.length ? round(totalR / mine.length) : null,
        hasOutcome: mine.length > 0,
        verdict: mine.length < minTrades ? 'too-thin' : netPnL > 0 ? 'working' : 'not-working',
      };
    });

    // The current window is the last point; everything the row reports above the strip comes
    // from it, so the header figures and the rightmost chip can never disagree.
    const latest = trend[trend.length - 1];

    const judged = trend.filter((point) => point.verdict !== 'too-thin');
    const latestJudged = judged[judged.length - 1];
    const previousJudged = judged[judged.length - 2];
    // Two judged weeks are the least a slope can be read from, and thin weeks are skipped
    // rather than treated as zeroes: a week with nothing in it is not a week that broke even.
    const direction: SetupDirection =
      !latestJudged || !previousJudged
        ? 'too-thin'
        : latestJudged.netPnL > previousJudged.netPnL
        ? 'improving'
        : latestJudged.netPnL < previousJudged.netPnL
        ? 'deteriorating'
        : 'steady';

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
      trades: latest.trades,
      wins: latest.wins,
      losses: latest.losses,
      netPnL: latest.netPnL,
      totalR: latest.totalR,
      avgR: latest.avgR,
      hasOutcome: latest.hasOutcome,
      // A flat week is read as not working, not as working: a setup that spent a week of
      // screen time and returned nothing has to earn the next one, and calling that a
      // success would be the generous reading the trader cannot spend.
      verdict: latest.verdict,
      touchRecord,
      trend,
      direction,
      judgedWeeks: judged.length,
    };
  });

  return {
    from: current.from,
    to: current.to,
    days,
    trendWeeks: windowCount,
    rows,
    hasOutcome: rows.some((row) => row.hasOutcome),
    minTrades,
    minDecided,
  };
}
