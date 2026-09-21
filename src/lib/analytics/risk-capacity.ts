import type { Trade } from '../../types';

/**
 * How much of the account's agreed drawdown is still available.
 *
 * This is the arithmetic behind the "can I afford today's risk" question, and it is the
 * one thing the trader cannot work out from a P&L chart by eye: a curve that looks fine
 * can still be sitting close to a trailing limit, because the limit moves up with the
 * high-water mark.
 *
 * Two deliberate choices:
 *
 * - The limit is measured from the PEAK, not from a starting balance. A trailing
 *   drawdown is what a funding firm enforces and what makes "the more I make, the more
 *   room I have" true: a new high resets the room, and the room never shrinks below the
 *   agreed figure.
 * - Nothing here is advice. It reports capacity — dollars and days — and says plainly when
 *   a normal losing day would breach the limit. What the trader then does with that room
 *   is theirs.
 */

/** One point of the equity curve, with the drawdown floor trailing the peak. */
export interface EquityPoint {
  /** The trade this point belongs to, so a filtered view can still find its floor. */
  tradeId: string;
  /** 1-based trade number. */
  index: number;
  /** Short label for the axis, e.g. `09-18 (4)`. */
  label: string;
  /** This trade's own P&L. */
  pnl: number;
  /** Cumulative P&L through this trade. */
  cumulative: number;
  /** The highest cumulative P&L reached so far. */
  peak: number;
  /** Peak to here. Zero while at the high-water mark. */
  drawdown: number;
  /**
   * Where the account sits if the agreed drawdown is taken in full: `peak - maxDrawdown`.
   * Null when no limit is set, because a floor cannot be drawn for a limit nobody named.
   */
  floor: number | null;
}

/**
 * How much room is left. Ordered from worst to best so the UI can colour by index.
 *
 * `limit-reached` means the drawdown has been taken in full; `defensive` means the
 * remaining room no longer absorbs a normal losing day; `normal` means it does; `ample`
 * means it absorbs many.
 */
export type RiskStance = 'limit-reached' | 'defensive' | 'normal' | 'ample';

export interface RiskCapacity {
  /** The agreed limit, or null when the trader has not set one. */
  maxDrawdown: number | null;
  /** Cumulative P&L now. */
  current: number;
  /** Highest cumulative P&L reached. */
  peak: number;
  /** Peak to now: dollars given back. Zero at a new high. */
  drawdownUsed: number;
  /** Largest peak-to-trough drop in the whole record. */
  largestHistorical: number;
  /** Dollars of drawdown left before the limit. Null without a limit. */
  headroom: number | null;
  /** Headroom as a percentage of the limit. Null without a limit. */
  headroomPct: number | null;
  /** Drawdown used as a percentage of the limit. Null without a limit. */
  usedPct: number | null;
  stance: RiskStance;
  /** The trader's daily loss plan, when one was supplied. */
  dailyLossLimit: number | null;
  /** How many full daily-loss-limit days the headroom still absorbs. */
  daysOfHeadroom: number | null;
  /** Whether one more day at the daily loss limit would stay inside the limit. */
  dailyLimitFits: boolean | null;
  /** Plain-language read of the numbers above. Facts only, no instruction. */
  note: string;
}


/** A day's planned loss that the remaining drawdown room cannot absorb. */
export interface DrawdownShortfall {
  /** The loss the day's plan allows. */
  plannedLoss: number;
  /** Room left in the account drawdown. */
  headroom: number;
  /** How far past the room the day's plan reaches. */
  over: number;
  /** True when the agreed drawdown is already fully spent, so nothing is left at all. */
  limitReached: boolean;
}

/**
 * Whether today's planned loss reaches past the room left in the account drawdown.
 *
 * This is the check that a daily loss limit cannot make on its own: the two numbers live on
 * different screens until they are put side by side, and a plan that looked sensible all
 * month can be unaffordable the day the room runs out. Returns null when the plan fits, or
 * when there is no limit or no planned loss to compare — silence means "nothing to warn
 * about", so the caller never has to guess at a threshold of its own.
 */
export function drawdownShortfall(
  capacity: RiskCapacity | null | undefined,
  plannedLossLimit: number | null | undefined
): DrawdownShortfall | null {
  if (!capacity || capacity.headroom === null) return null;
  if (
    typeof plannedLossLimit !== 'number' ||
    !Number.isFinite(plannedLossLimit) ||
    plannedLossLimit <= 0
  ) {
    return null;
  }
  if (plannedLossLimit <= capacity.headroom) return null;

  return {
    plannedLoss: plannedLossLimit,
    headroom: capacity.headroom,
    over: round(plannedLossLimit - capacity.headroom),
    limitReached: capacity.headroom <= 0,
  };
}

/** Where a stop distance was read from. */
export type StopDistanceSource = 'open-position' | 'recent-trades';

/** How far this trader's stops usually sit from their entries on one instrument. */
export interface StopDistanceEstimate {
  /** Distance from entry to the initial stop, in points. */
  points: number;
  source: StopDistanceSource;
  /** Trades behind the estimate; zero when it came from a position that is open now. */
  sample: number;
}

/**
 * The least number of past trades a "usual" stop distance may be read from.
 *
 * Below this there is no usual distance to speak of, and a warning built on one trade would
 * be the app inventing a habit the trader does not have.
 */
export const MIN_STOP_SAMPLE = 3;

/** How far back the typical stop distance is read from. */
const MAX_STOP_SAMPLE = 20;

/**
 * The trader's own stop distance on an instrument, in points.
 *
 * Two sources, in order of how much they can be trusted:
 *
 * - A position open RIGHT NOW is a real stop, so it is used as it is, whatever the history
 *   says. It is also the case the size check matters most in, because the risk is live.
 * - Otherwise the median of their recent stops on the same instrument. The median rather
 *   than the average, because one trade with a 60-point stop should not move the number the
 *   app then uses to warn about size.
 *
 * Returns null when there is nothing to read — an instrument the trader has never stopped
 * out of, or too few trades to call anything typical. The callers treat null as "no opinion"
 * rather than substituting a default.
 */
export function estimateStopDistance(input: {
  /** Positions that are still open. */
  openTrades?: Trade[];
  /** Closed trades, any period; the most recent ones are used. */
  closedTrades?: Trade[];
  /**
   * The instrument's ID (not its symbol), so a custom instrument is matched correctly.
   * Resolve a day's primary instrument with `findInstrument` before calling.
   */
  instrumentId: string;
}): StopDistanceEstimate | null {
  const wanted = input.instrumentId.trim().toLowerCase();
  if (!wanted) return null;

  const distance = (trade: Trade) => Math.abs(trade.entryPrice - trade.initialStop);
  const usable = (trade: Trade) =>
    trade.instrumentId.trim().toLowerCase() === wanted &&
    Number.isFinite(trade.entryPrice) &&
    Number.isFinite(trade.initialStop) &&
    distance(trade) > 0;

  const open = (input.openTrades ?? [])
    .filter(usable)
    .sort(
      (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
    );
  if (open.length) {
    return { points: round(distance(open[0])), source: 'open-position', sample: 0 };
  }

  const closed = (input.closedTrades ?? [])
    .filter(usable)
    .sort(
      (a, b) =>
        new Date(b.exitTime ?? b.entryTime).getTime() -
        new Date(a.exitTime ?? a.entryTime).getTime()
    )
    .slice(0, MAX_STOP_SAMPLE);

  if (closed.length < MIN_STOP_SAMPLE) return null;

  const distances = closed.map(distance).sort((a, b) => a - b);
  const middle = Math.floor(distances.length / 2);
  const median =
    distances.length % 2 === 1
      ? distances[middle]
      : (distances[middle - 1] + distances[middle]) / 2;

  return { points: round(median), source: 'recent-trades', sample: closed.length };
}

/** What the day's planned size would risk at the trader's own stop distance. */
export interface PlannedSizeRisk {
  symbol: string;
  contracts: number;
  /** The stop distance used, in points. */
  stopPoints: number;
  stopSource: StopDistanceSource;
  stopSample: number;
  pointValue: number;
  /** Dollars at risk if every contract is stopped at that distance. */
  dollarsAtRisk: number;
  /** Room left in the account drawdown. */
  headroom: number;
  /** How far past the room those dollars reach. */
  over: number;
}

/**
 * Whether the day's planned size, stopped at the trader's own distance, reaches past the
 * room left in the account drawdown.
 *
 * This is a different question from the daily loss limit, and the one a plan cannot answer
 * by itself: the limit says what the trader is WILLING to lose, while this says what the
 * position they just described would actually cost if their own stop got hit. A size that
 * fits the day's limit can still be larger than the account can absorb — the smaller of the
 * two is the honest bound.
 *
 * Returns null when it cannot be answered (no limit, no stop history, no size) or when the
 * size fits, so silence again means "nothing to warn about".
 */
export function assessPlannedSize(input: {
  capacity?: RiskCapacity | null;
  contracts?: number | null;
  stopDistance?: StopDistanceEstimate | null;
  pointValue?: number | null;
  symbol: string;
}): PlannedSizeRisk | null {
  const { capacity, stopDistance } = input;
  if (!capacity || capacity.headroom === null || !stopDistance) return null;

  const contracts =
    typeof input.contracts === 'number' && Number.isFinite(input.contracts) ? input.contracts : null;
  const pointValue =
    typeof input.pointValue === 'number' && Number.isFinite(input.pointValue)
      ? input.pointValue
      : null;

  if (contracts === null || contracts <= 0) return null;
  if (pointValue === null || pointValue <= 0) return null;
  if (stopDistance.points <= 0) return null;

  const dollarsAtRisk = round(contracts * stopDistance.points * pointValue);
  if (dollarsAtRisk <= capacity.headroom) return null;

  return {
    symbol: input.symbol,
    contracts,
    stopPoints: stopDistance.points,
    stopSource: stopDistance.source,
    stopSample: stopDistance.sample,
    pointValue,
    dollarsAtRisk,
    headroom: capacity.headroom,
    over: round(dollarsAtRisk - capacity.headroom),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

function money(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs % 1 === 0 ? abs.toLocaleString('en-US') : abs.toFixed(2);
  return `${n < 0 ? '-' : ''}$${formatted}`;
}

/**
 * Order of realization: a trade's P&L lands when it closes, so a position entered earlier
 * but closed later books after the one that finished first. A trade still open has no exit
 * time and sorts by its entry time.
 */
function inOrder(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    const at = new Date(a.exitTime ?? a.entryTime).getTime();
    const bt = new Date(b.exitTime ?? b.entryTime).getTime();
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

/**
 * The equity curve with its trailing floor, one point per trade.
 *
 * `pnlOf` defaults to gross P&L so the curve lines up with the cumulative P&L chart it is
 * drawn on. Callers that report net (the coach digest) pass their own reader in, because
 * two different P&L notions on one screen is worse than either one alone.
 */
export function buildEquityCurve(
  trades: Trade[],
  maxDrawdown: number | null | undefined,
  pnlOf: (trade: Trade) => number = (trade) => trade.grossPnL
): EquityPoint[] {
  const limit =
    typeof maxDrawdown === 'number' && Number.isFinite(maxDrawdown) && maxDrawdown > 0
      ? maxDrawdown
      : null;

  let cumulative = 0;
  let peak = 0;

  return inOrder(trades).map((trade, idx) => {
    cumulative = round(cumulative + pnlOf(trade));
    if (cumulative > peak) peak = cumulative;
    // Labelled by the day the trade was taken, which is what the axis has always shown,
    // even though the point lands where the P&L was realized.
    const dateLabel = trade.entryTime
      ? trade.entryTime.slice(5, 10)
      : trade.exitTime
      ? trade.exitTime.slice(5, 10)
      : `#${idx + 1}`;

    return {
      tradeId: trade.id,
      index: idx + 1,
      label: `${dateLabel} (${idx + 1})`,
      pnl: round(pnlOf(trade)),
      cumulative,
      peak,
      drawdown: round(peak - cumulative),
      floor: limit === null ? null : round(peak - limit),
    };
  });
}

/**
 * The current position against the agreed drawdown.
 *
 * The note is generated here rather than in the component so the coach digest and the
 * panel say exactly the same thing about the same numbers.
 */
export function assessRiskCapacity(input: {
  trades: Trade[];
  maxDrawdown?: number | null;
  /** The trader's planned loss for the day, so a normal day can be measured against the room. */
  dailyLossLimit?: number | null;
  /** How to read a trade's P&L. Defaults to gross, like the equity curve. */
  pnlOf?: (trade: Trade) => number;
}): RiskCapacity {
  const pnlOf = input.pnlOf ?? ((trade: Trade) => trade.grossPnL);
  const curve = buildEquityCurve(input.trades, input.maxDrawdown, pnlOf);
  const last = curve[curve.length - 1];
  const current = last ? last.cumulative : 0;
  const peak = last ? last.peak : 0;
  const drawdownUsed = round(peak - current);
  const largestHistorical = curve.reduce((worst, point) => Math.max(worst, point.drawdown), 0);

  const limit =
    typeof input.maxDrawdown === 'number' &&
    Number.isFinite(input.maxDrawdown) &&
    input.maxDrawdown > 0
      ? input.maxDrawdown
      : null;

  const dailyLossLimit =
    typeof input.dailyLossLimit === 'number' &&
    Number.isFinite(input.dailyLossLimit) &&
    input.dailyLossLimit > 0
      ? input.dailyLossLimit
      : null;

  if (limit === null) {
    return {
      maxDrawdown: null,
      current,
      peak,
      drawdownUsed,
      largestHistorical,
      headroom: null,
      headroomPct: null,
      usedPct: null,
      stance: 'normal',
      dailyLossLimit,
      daysOfHeadroom: null,
      dailyLimitFits: null,
      note:
        `No account drawdown limit is set, so there is nothing to measure today's risk ` +
        `against. The record's largest drop so far is ${money(largestHistorical)}.`,
    };
  }

  const headroom = round(limit - drawdownUsed);
  const usedPct = Math.round((drawdownUsed / limit) * 100);
  const headroomPct = Math.max(0, 100 - usedPct);
  const daysOfHeadroom =
    dailyLossLimit === null ? null : Math.floor(Math.max(0, headroom) / dailyLossLimit);
  const dailyLimitFits = dailyLossLimit === null ? null : dailyLossLimit <= headroom;

  // Read off how much of the agreed room is gone, then escalate if a normal losing day
  // no longer fits inside what is left. A percentage alone would call 60% used "normal"
  // on an account whose daily risk is half of the remaining room.
  const stance: RiskStance =
    drawdownUsed >= limit
      ? 'limit-reached'
      : dailyLimitFits === false || usedPct >= 60
      ? 'defensive'
      : usedPct >= 25
      ? 'normal'
      : 'ample';

  const withinStance =
    stance === 'limit-reached'
      ? `The agreed ${money(limit)} drawdown has been taken in full.`
      : dailyLimitFits === false && dailyLossLimit !== null
      ? `One more day at your ${money(dailyLossLimit)} limit would breach the ${money(limit)} drawdown.`
      : dailyLossLimit !== null && daysOfHeadroom !== null
      ? `Room left for ${daysOfHeadroom} more full ${money(dailyLossLimit)} losing ` +
        `day${daysOfHeadroom === 1 ? '' : 's'}.`
      : `Room left for ${money(headroom)} of drawdown.`;

  return {
    maxDrawdown: limit,
    current,
    peak,
    drawdownUsed,
    largestHistorical,
    headroom,
    headroomPct,
    usedPct,
    stance,
    dailyLossLimit,
    daysOfHeadroom,
    dailyLimitFits,
    note:
      `${usedPct}% of the ${money(limit)} drawdown is used (${money(drawdownUsed)} from a ` +
      `peak of ${money(peak)}). ${withinStance}`,
  };
}
