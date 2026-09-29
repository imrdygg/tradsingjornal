import type { Trade, TradingDay } from '../../types';
import { hasAssumedRisk } from '../trading/risk-fixup';

/**
 * The shapes the Insights tab draws, computed and nothing else.
 *
 * The tab's observations are prose written from the record; these are the series behind the
 * pictures around them, and they are built here rather than inside the components for the
 * reason every other analytic in this folder is: a bar chart is arithmetic, and arithmetic
 * that lives in a render function is arithmetic nobody can check. Nothing here decides what
 * happened — every figure is a sum, a count or a share of trades the trader already recorded
 * — and nothing here is a forecast.
 *
 * All of it is gross, before fees, because the observations on the same tab are: a bar that
 * disagreed with the sentence beside it would be worse than no bar at all.
 */

/** One thing the record can be split by, reduced to the four figures worth comparing. */
export interface SegmentRow {
  /** Stable key, also the id of the observation about the same bucket where there is one. */
  key: string;
  /** What the segment is, in the trader's words. */
  label: string;
  /** Closed trades in it. */
  trades: number;
  /** Wins as a share of those trades, 0–100. */
  winRate: number;
  /** Mean R across them. */
  avgR: number;
  /** Gross P&L across them. */
  pnl: number;
}

/** One trading day, as the column it is drawn as. */
export interface DailyPnLPoint {
  /** Trading date, YYYY-MM-DD. */
  date: string;
  /** The date as the axis writes it — `9/22`. */
  label: string;
  /** That day's gross P&L. */
  pnl: number;
  /** Running total from the start of the window, so the line has a shape. */
  cumulative: number;
  trades: number;
}

/** One bucket of the R histogram. */
export interface RDistributionBucket {
  key: string;
  /** The range as the axis writes it. */
  label: string;
  /** Closed trades whose R falls in it. */
  count: number;
  /** True for the buckets that lost money. */
  loss: boolean;
}

/** One closed trade, as one square of the tape. */
export interface TapeEntry {
  id: string;
  /** Win, loss or flat, by the money rather than by the R. */
  result: 'win' | 'loss' | 'flat';
  /** The R it closed at, for the hover. */
  r: number;
  /** `9/22 · Support` — what the square is, said in the hover. */
  label: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `2026-09-22` as `9/22`, short enough for an axis tick. */
function shortDate(date: string): string {
  const parts = date.split('-');
  if (parts.length < 3) return date;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** Which trading day each trade belongs to, by date rather than by when it was typed. */
function datesByDayId(tradingDays: TradingDay[]): Map<string, string> {
  return new Map(tradingDays.map((day) => [day.id, day.tradeDate]));
}

/**
 * One column per trading day, with the running total over them.
 *
 * A day's figure is the whole day's, not a trade's, because the question this answers is how
 * the days went — and a trader's month is made of days, not of fills. The window is the last
 * `maxDays` days that traded, so a long record does not turn into a comb of hairline
 * columns; the running total starts at zero at the first day shown, which is what makes the
 * line read as the shape of the window rather than of the account.
 */
export function buildDailyPnLSeries(
  trades: Trade[],
  tradingDays: TradingDay[],
  maxDays = 40
): DailyPnLPoint[] {
  const dateById = datesByDayId(tradingDays);

  const byDate = new Map<string, { pnl: number; trades: number }>();
  for (const trade of trades) {
    if (trade.status !== 'closed') continue;
    const date = dateById.get(trade.tradingDayId);
    if (!date) continue;
    const existing = byDate.get(date) ?? { pnl: 0, trades: 0 };
    existing.pnl += trade.grossPnL;
    existing.trades += 1;
    byDate.set(date, existing);
  }

  const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
  const window = maxDays > 0 ? dates.slice(-maxDays) : dates;

  let cumulative = 0;
  return window.map((date) => {
    const day = byDate.get(date) ?? { pnl: 0, trades: 0 };
    cumulative += day.pnl;
    return {
      date,
      label: shortDate(date),
      pnl: round2(day.pnl),
      cumulative: round2(cumulative),
      trades: day.trades,
    };
  });
}

/** Where the R histogram's buckets end: `≤ -2`, then each 1R band, then `3R+`. */
const R_EDGES = [-2, -1, 0, 1, 2] as const;

/** How many trades the tape shows. Enough for a streak to be visible, few enough to scan. */
export const TAPE_LENGTH = 40;

/**
 * The distribution of R across closed trades.
 *
 * An average R says nothing about the shape of a record: a trader whose average is +0.4R
 * could be winning small and often or losing small and often and catching one big one, and
 * those are different businesses with different fixes. The histogram is the shape.
 *
 * Trades whose stop the app had to invent are left out and counted separately. Their R was
 * built from a placeholder risk, so including them would put fiction into the distribution —
 * the same reason the target-exit read excludes them.
 */
export function buildRDistribution(trades: Trade[]): {
  buckets: RDistributionBucket[];
  measured: number;
  excluded: number;
} {
  const closed = trades.filter((trade) => trade.status === 'closed');
  const usable = closed.filter(
    (trade) => !hasAssumedRisk(trade) && Number.isFinite(trade.rMultiple)
  );

  // Labels are kept short because all seven sit on one axis: a tick that wraps stops being a
  // tick, and the ranges are read off the sign more than the digits.
  const buckets: RDistributionBucket[] = [
    { key: 'le-2', label: '≤ -2R', count: 0, loss: true },
    { key: '-2..-1', label: '-2 to -1', count: 0, loss: true },
    { key: '-1..0', label: '-1 to 0', count: 0, loss: true },
    { key: '0..1', label: '0 to 1', count: 0, loss: false },
    { key: '1..2', label: '1 to 2', count: 0, loss: false },
    { key: '2..3', label: '2 to 3', count: 0, loss: false },
    { key: 'ge-3', label: '3R+', count: 0, loss: false },
  ];

  for (const trade of usable) {
    const r = trade.rMultiple;
    // A flat trade lands in the band below zero: it gained nothing, and the honest drawing of
    // "no gain" is beside the losses rather than beside the wins.
    let index = 0;
    for (let i = 0; i < R_EDGES.length; i += 1) {
      if (r > R_EDGES[i]) index = i + 1;
    }
    buckets[index].count += 1;
  }

  return { buckets, measured: usable.length, excluded: closed.length - usable.length };
}

/**
 * The last few closed trades as a row of results, oldest first.
 *
 * The one thing a P&L curve cannot show is how it got there: three losses in a row that end
 * flat is a different month from three losses spread out, and the tape is the only place the
 * cluster is visible. Ordered by the day the trade was taken and then by its entry time, so a
 * trade logged late still appears where it happened.
 */
export function buildResultTape(
  trades: Trade[],
  tradingDays: TradingDay[],
  limit = TAPE_LENGTH
): TapeEntry[] {
  const dateById = datesByDayId(tradingDays);

  const closed = trades
    .filter((trade) => trade.status === 'closed')
    .map((trade) => ({
      trade,
      date: dateById.get(trade.tradingDayId) ?? trade.entryTime?.slice(0, 10) ?? '',
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.trade.entryTime ?? '').localeCompare(b.trade.entryTime ?? '')
    );

  const window = limit > 0 ? closed.slice(-limit) : closed;

  return window.map(({ trade, date }) => ({
    id: trade.id,
    result: trade.grossPnL > 0 ? 'win' : trade.grossPnL < 0 ? 'loss' : 'flat',
    r: round2(trade.rMultiple || 0),
    label: `${shortDate(date)} · ${trade.setupName || 'no setup'}`,
  }));
}

/** How many trades a weekday needs before its own row means anything. */
export const MIN_WEEKDAY_TRADES = 1;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * P&L per weekday.
 *
 * The session split says when in the day the money was made; this says which day of the week
 * spent it, and the two are not the same question. A Tuesday can be the bad day because of
 * the news cycle or because of what the trader does between the weekend and it, and either
 * way it is only visible once the days are stacked against each other.
 *
 * Ordered Monday first, which is how a trading week is read, rather than Sunday first, which
 * is how `getUTCDay` counts.
 */
export function buildWeekdayBreakdown(
  trades: Trade[],
  tradingDays: TradingDay[],
  minTrades = MIN_WEEKDAY_TRADES
): SegmentRow[] {
  const dateById = datesByDayId(tradingDays);
  const groups = new Map<number, Trade[]>();

  for (const trade of trades) {
    if (trade.status !== 'closed') continue;
    const date = dateById.get(trade.tradingDayId);
    if (!date) continue;
    // Parsed as UTC because the date is a plain calendar date, not an instant: a local parse
    // would move a Sunday-evening trade to Monday for anyone east of UTC.
    const at = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(at)) continue;
    const weekday = new Date(at).getUTCDay();
    groups.set(weekday, [...(groups.get(weekday) ?? []), trade]);
  }

  // Monday to Friday, then the weekend: a futures journal that traded a Saturday traded it on
  // purpose, and the row is worth showing rather than assuming away.
  const order = [1, 2, 3, 4, 5, 6, 0];

  return order
    .filter((weekday) => (groups.get(weekday)?.length ?? 0) >= minTrades)
    .map((weekday) => {
      const list = groups.get(weekday) ?? [];
      const pnl = round2(list.reduce((sum, trade) => sum + trade.grossPnL, 0));
      const wins = list.filter((trade) => trade.grossPnL > 0).length;
      return {
        key: `weekday-${WEEKDAYS[weekday].toLowerCase()}`,
        label: WEEKDAYS[weekday],
        trades: list.length,
        winRate: list.length ? Math.round((wins / list.length) * 1000) / 10 : 0,
        avgR: list.length
          ? round2(list.reduce((sum, trade) => sum + (trade.rMultiple || 0), 0) / list.length)
          : 0,
        pnl,
      };
    });
}
