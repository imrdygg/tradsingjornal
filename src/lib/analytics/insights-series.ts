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
 * The closed trades in the order they happened, each with the day it belongs to.
 *
 * Ordered by the day the trade was taken and then by its entry time, so a trade logged late
 * still lands where it happened rather than where it was typed. Everything that reads the
 * record as a sequence — the tape, the underwater curve — orders it here, so three pictures
 * of the same month cannot disagree about what came first.
 */
function closedInOrder(
  trades: Trade[],
  tradingDays: TradingDay[]
): Array<{ trade: Trade; date: string }> {
  const dateById = datesByDayId(tradingDays);
  return trades
    .filter((trade) => trade.status === 'closed')
    .map((trade) => ({
      trade,
      date: dateById.get(trade.tradingDayId) ?? trade.entryTime?.slice(0, 10) ?? '',
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.trade.entryTime ?? '').localeCompare(b.trade.entryTime ?? '')
    );
}

/** The middle value of a list, or null when there is nothing to take the middle of. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10
    : sorted[middle];
}

/**
 * How long a trade was held, in minutes.
 *
 * Both stamps are wall-clock strings, so the difference is the trader's own local duration
 * and needs no timezone conversion — the same reading the form and the trade card give it.
 * A negative duration is a data-entry error rather than an instant hold, so it is refused
 * instead of being drawn to the left of zero.
 */
function minutesHeld(trade: Trade): number | null {
  if (!trade.entryTime || !trade.exitTime) return null;
  const entry = Date.parse(trade.entryTime);
  const exit = Date.parse(trade.exitTime);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
  const minutes = Math.round((exit - entry) / 60000);
  return minutes >= 0 ? minutes : null;
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
  const closed = closedInOrder(trades, tradingDays);
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

/** One step of the underwater curve: where the account stood against its own best. */
export interface UnderwaterPoint {
  /** 1-based position of the trade in the sequence. */
  index: number;
  date: string;
  /** The axis label: `#12`. */
  label: string;
  /** Running gross P&L to this trade. */
  cumulative: number;
  /** The highest the running total had reached by this trade. */
  peak: number;
  /** How far below that peak this trade left the account. Never positive. */
  drawdown: number;
}

/** How many trades the underwater curve plots; past this it is a smear rather than a shape. */
export const UNDERWATER_LENGTH = 150;

/**
 * How far below its own best the record sat, trade by trade.
 *
 * The equity curve shows a line that goes up and to the right; this shows what it felt like
 * to hold. A curve can double over a year while spending months underwater, and the two
 * readings are the same record — one is the destination, the other is the ride. Drawn below
 * zero because that is what it is: the depth by which the account was behind its high-water
 * mark, never above it.
 *
 * The deepest point is the one to read, which is why the peak is carried into each point
 * rather than only the running total: the depth cannot be recovered from the curve alone.
 */
export function buildUnderwaterCurve(
  trades: Trade[],
  tradingDays: TradingDay[],
  maxTrades = UNDERWATER_LENGTH
): UnderwaterPoint[] {
  const closed = closedInOrder(trades, tradingDays);
  const window = maxTrades > 0 ? closed.slice(-maxTrades) : closed;

  let cumulative = 0;
  let peak = 0;

  return window.map(({ trade, date }, position) => {
    cumulative += trade.grossPnL;
    peak = Math.max(peak, cumulative);
    return {
      index: position + 1,
      date,
      label: `#${position + 1}`,
      cumulative: round2(cumulative),
      peak: round2(peak),
      drawdown: round2(cumulative - peak),
    };
  });
}

/** One closed trade as a point: how long it was held, and what it returned. */
export interface HoldTimePoint {
  id: string;
  /** Minutes between the entry and the exit, the trader's own wall clock. */
  minutes: number;
  r: number;
  win: boolean;
  label: string;
}

/** How long the winners and the losers were held, as a count and a middle value. */
export interface HoldTimeRead {
  points: HoldTimePoint[];
  winners: { count: number; medianMinutes: number | null };
  losers: { count: number; medianMinutes: number | null };
  /** Closed trades with no usable pair of stamps, left out rather than guessed at. */
  unreadable: number;
}

/**
 * How long each trade was held, against what it returned.
 *
 * The medians are reported rather than the means because one trade held over a news event
 * drags an average far enough to describe nothing; the middle of the list is what a trader's
 * typical hold actually is. The comparison worth making is between the two sides: holding
 * winners longer than losers is the whole mechanic of a positive expectancy, and its absence
 * is invisible in every other reading on this tab.
 */
export function buildHoldTime(trades: Trade[], tradingDays: TradingDay[]): HoldTimeRead {
  const closed = closedInOrder(trades, tradingDays);
  const points: HoldTimePoint[] = [];
  let unreadable = 0;

  for (const { trade, date } of closed) {
    const minutes = minutesHeld(trade);
    if (minutes === null) {
      unreadable += 1;
      continue;
    }
    points.push({
      id: trade.id,
      minutes,
      r: round2(trade.rMultiple || 0),
      win: trade.grossPnL > 0,
      label: `${shortDate(date)} · ${trade.setupName || 'no setup'}`,
    });
  }

  const winners = points.filter((point) => point.win);
  const losers = points.filter((point) => !point.win);

  return {
    points,
    winners: {
      count: winners.length,
      medianMinutes: median(winners.map((point) => point.minutes)),
    },
    losers: {
      count: losers.length,
      medianMinutes: median(losers.map((point) => point.minutes)),
    },
    unreadable,
  };
}

/** One hour of the day, as the heatmap cell it is drawn as. */
export interface HourlyRow {
  /** The hour on the trader's own clock, 0–23. */
  hour: number;
  /** The axis label: `14:00`. */
  label: string;
  trades: number;
  pnl: number;
  winRate: number;
}

/**
 * P&L by the hour of the day the trade was entered.
 *
 * The session split is three buckets wide, and three buckets cannot show that the money in a
 * session is made in its first twenty minutes and given back over the next two hours. Entry
 * time is a wall-clock string throughout this app, so the hour is read off it directly — the
 * trader's own hour, which is the one they can act on.
 *
 * Only hours that were actually traded appear. An empty hour is not a zero: no trade was
 * taken then, and a cell of zeroes would read as "flat" rather than "not tried".
 */
export function buildHourlyBreakdown(trades: Trade[]): HourlyRow[] {
  const groups = new Map<number, Trade[]>();

  for (const trade of trades) {
    if (trade.status !== 'closed') continue;
    const hour = Number(trade.entryTime?.slice(11, 13));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    groups.set(hour, [...(groups.get(hour) ?? []), trade]);
  }

  return [...groups.keys()]
    .sort((a, b) => a - b)
    .map((hour) => {
      const list = groups.get(hour) ?? [];
      const wins = list.filter((trade) => trade.grossPnL > 0).length;
      return {
        hour,
        label: `${String(hour).padStart(2, '0')}:00`,
        trades: list.length,
        pnl: round2(list.reduce((sum, trade) => sum + trade.grossPnL, 0)),
        winRate: list.length ? Math.round((wins / list.length) * 1000) / 10 : 0,
      };
    });
}

/** One closed trade as a point: what it risked, and what it returned. */
export interface RiskResultPoint {
  id: string;
  /** The dollars the trade was risking at entry. */
  risk: number;
  r: number;
  win: boolean;
  label: string;
}

/**
 * What was risked against what came back.
 *
 * Sizing up is the most common thing a trader does after a good run, and it is invisible in
 * every other picture here: the R of a trade is size-independent, so a record with a rising R
 * and a rising size looks fine until the positions are put back on one axis. Trades whose
 * stop was never recorded are left out and counted, because their risk is a placeholder and
 * the whole chart is about that number.
 */
export function buildRiskVsResult(trades: Trade[]): {
  points: RiskResultPoint[];
  excluded: number;
} {
  const closed = trades.filter((trade) => trade.status === 'closed');
  const points: RiskResultPoint[] = [];
  let excluded = 0;

  for (const trade of closed) {
    if (hasAssumedRisk(trade) || !Number.isFinite(trade.initialRisk) || trade.initialRisk <= 0) {
      excluded += 1;
      continue;
    }
    points.push({
      id: trade.id,
      risk: round2(trade.initialRisk),
      r: round2(trade.rMultiple || 0),
      win: trade.grossPnL > 0,
      label: `${trade.entryTime?.slice(0, 10) ?? 'no date'} · risked ${round2(trade.initialRisk)}`,
    });
  }

  return { points, excluded };
}
