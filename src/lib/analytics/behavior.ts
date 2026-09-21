import { Trade, TradingDay } from '../../types';
import { hourInTimezone } from '../storage/date-utils';

/**
 * Behavioural analysis of the trader's OWN records.
 *
 * Everything here comes out of timestamps and sizes the trader already logged: when
 * they entered, how long they held, how fast they re-entered after a loss, and how
 * their size compared with their own plan. No market data is involved, so nothing
 * here can turn into a claim about what the market was doing.
 *
 * The reason this exists: a self-reported review only catches what the trader was
 * willing and able to admit. Reaction-to-loss and overtrading are exactly the
 * behaviours people miss about themselves, and they are visible in the timestamps.
 *
 * Two honesty rules run through the whole module:
 *   1. Nothing is reported below a real sample size, so the coach is never handed a
 *      "pattern" built from one trade.
 *   2. A figure that cannot be derived from the records stays null rather than
 *      defaulting to zero, so a missing number is never read as a real one.
 */

/** A group with fewer trades than this is not reported at all. */
export const MIN_BUCKET_TRADES = 3;

/** An entry within this many minutes of a losing exit counts as reacting to it. */
export const AFTER_LOSS_WINDOW_MINUTES = 15;

export interface BehaviorBucket {
  label: string;
  trades: number;
  netPnL: number;
  avgR: number;
  winRate: number;
}

export interface TimeOfDayFacts {
  /** Local clock hour of entry, hours with a real sample only, earliest first. */
  buckets: BehaviorBucket[];
  /** Entries whose timestamp could not be read, so no hour could be assigned. */
  unreadableEntries: number;
  /** Only set when there are at least two hours to compare. */
  best: BehaviorBucket | null;
  worst: BehaviorBucket | null;
}

export interface HoldTimeFacts {
  buckets: BehaviorBucket[];
  averageMinutes: number | null;
  /** Trades with no usable entry/exit pair, or a negative duration. */
  unreadable: number;
}

export interface AfterLossFacts {
  windowMinutes: number;
  /** Entries opened within the window of a losing exit on the same day. */
  afterLoss: BehaviorBucket | null;
  /** Every other entry, for comparison. */
  other: BehaviorBucket | null;
  /** How many trading days contributed an after-loss entry. */
  daysAffected: number;
}

export interface SizeDisciplineFacts {
  /** Days that recorded a planned contract count to check size against. */
  daysWithPlannedContracts: number;
  tradesOverPlannedSize: number;
  /** Worst overshoot, in contracts. */
  worstOvershootContracts: number;
  /** Of the over-sized trades, how many were entered within the after-loss window. */
  overPlannedSizeAfterLoss: number;
}

export interface ActivityFacts {
  daysWithTrades: number;
  medianTradesPerDay: number;
  busyDays: number;
  busyAvgPnL: number | null;
  quietDays: number;
  quietAvgPnL: number | null;
  busiestDay: { date: string; trades: number; netPnL: number } | null;
}

export interface BehaviorFacts {
  /** Timezone the clock hour was read in, so the prompt can say whose local time. */
  timezone: string;
  timeOfDay: TimeOfDayFacts;
  holdTime: HoldTimeFacts;
  afterLoss: AfterLossFacts;
  sizeDiscipline: SizeDisciplineFacts;
  activity: ActivityFacts;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Net P&L when present, otherwise gross. Duplicated from the digest on purpose so
 *  this module stays a leaf with no dependency back into the AI layer. */
function realized(trade: Trade): number {
  if (typeof trade.netPnL === 'number' && Number.isFinite(trade.netPnL)) return trade.netPnL;
  return Number.isFinite(trade.grossPnL) ? trade.grossPnL : 0;
}

function rMultiple(trade: Trade): number {
  return Number.isFinite(trade.rMultiple) ? trade.rMultiple : 0;
}

/** Null for an empty group, so callers can leave the field unset instead of zero. */
export function summarize(trades: Trade[], label: string): BehaviorBucket | null {
  if (trades.length === 0) return null;
  const netPnL = trades.reduce((sum, t) => sum + realized(t), 0);
  const totalR = trades.reduce((sum, t) => sum + rMultiple(t), 0);
  const wins = trades.filter((t) => realized(t) > 0).length;
  return {
    label,
    trades: trades.length,
    netPnL: round(netPnL),
    avgR: round(totalR / trades.length),
    winRate: round((wins / trades.length) * 100, 1),
  };
}

/** Trailing zone designator: "Z" or something like "-04:00" / "+0000". */
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/** The clock portion of a "YYYY-MM-DD HH:MM" style timestamp. */
const CLOCK_PREFIX = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/;

/**
 * Epoch milliseconds for a recorded timestamp, or null when it cannot be read.
 *
 * A space separator is converted to "T" first: `new Date('2026-09-18 09:31:00')` is
 * not valid ISO and is only accepted by engines as a non-standard extension.
 */
export function timestampMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const raw = timestamp.trim();
  if (!raw) return null;
  const isoish = raw.includes(' ') ? raw.replace(' ', 'T') : raw;
  const ms = Date.parse(isoish);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Clock hour (0-23) of an entry, in the trader's own timezone.
 *
 * A broker export usually writes a bare wall-clock time with no zone. Pushing that
 * through the trader's timezone would shift it by hours and manufacture a "pattern"
 * out of a timezone conversion, so a zone-less value is read at face value. Only a
 * value carrying an explicit offset or Z is actually converted.
 */
export function localHourOf(timestamp: string | undefined, timezone: string): number | null {
  if (!timestamp) return null;
  const raw = timestamp.trim();
  const clock = CLOCK_PREFIX.exec(raw);
  if (clock && !ZONE_SUFFIX.test(raw)) {
    const hour = Number(clock[1]);
    return Number.isFinite(hour) ? hour % 24 : null;
  }
  const ms = timestampMs(raw);
  if (ms === null) return null;
  return hourInTimezone(new Date(ms), timezone);
}

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

/** The hour with the best/worst net P&L, but only once there is something to compare. */
function extreme(
  buckets: BehaviorBucket[],
  better: (a: number, b: number) => boolean
): BehaviorBucket | null {
  if (buckets.length < 2) return null;
  return buckets.reduce((best, bucket) => (better(bucket.netPnL, best.netPnL) ? bucket : best));
}

export function analyzeTimeOfDay(closed: Trade[], timezone: string): TimeOfDayFacts {
  const byHour = new Map<number, Trade[]>();
  let unreadableEntries = 0;

  for (const trade of closed) {
    const hour = localHourOf(trade.entryTime, timezone);
    if (hour === null) {
      unreadableEntries += 1;
      continue;
    }
    const list = byHour.get(hour);
    if (list) list.push(trade);
    else byHour.set(hour, [trade]);
  }

  const buckets = [...byHour.entries()]
    .filter(([, trades]) => trades.length >= MIN_BUCKET_TRADES)
    .sort((a, b) => a[0] - b[0])
    .map(([hour, trades]) => summarize(trades, `${String(hour).padStart(2, '0')}:00`)!)
    .filter(Boolean);

  return {
    buckets,
    unreadableEntries,
    best: extreme(buckets, (a, b) => a > b),
    worst: extreme(buckets, (a, b) => a < b),
  };
}

// ---------------------------------------------------------------------------
// Hold time
// ---------------------------------------------------------------------------

/** Bands chosen so a short scalp, a normal intraday hold and an overnight carry
 *  land in different buckets without needing a per-trader setting. */
const HOLD_BANDS: Array<{ maxMinutes: number; label: string }> = [
  { maxMinutes: 5, label: 'under 5 min' },
  { maxMinutes: 15, label: '5-15 min' },
  { maxMinutes: 60, label: '15-60 min' },
  { maxMinutes: 240, label: '1-4 hours' },
  { maxMinutes: Infinity, label: 'over 4 hours' },
];

function holdBandLabel(minutes: number): string {
  for (const band of HOLD_BANDS) {
    if (minutes < band.maxMinutes) return band.label;
  }
  return HOLD_BANDS[HOLD_BANDS.length - 1].label;
}

export function analyzeHoldTime(closed: Trade[]): HoldTimeFacts {
  const bands = new Map<string, Trade[]>();
  const durations: number[] = [];
  let unreadable = 0;

  for (const trade of closed) {
    const entry = timestampMs(trade.entryTime);
    const exit = timestampMs(trade.exitTime);
    if (entry === null || exit === null) {
      unreadable += 1;
      continue;
    }
    const minutes = (exit - entry) / 60_000;
    if (!Number.isFinite(minutes) || minutes < 0) {
      // A negative duration means the record is wrong, not that the trade was fast.
      unreadable += 1;
      continue;
    }
    durations.push(minutes);
    const label = holdBandLabel(minutes);
    const list = bands.get(label);
    if (list) list.push(trade);
    else bands.set(label, [trade]);
  }

  const buckets = HOLD_BANDS.map((band) => ({ band, trades: bands.get(band.label) ?? [] }))
    .filter(({ trades }) => trades.length >= MIN_BUCKET_TRADES)
    .map(({ band, trades }) => summarize(trades, band.label)!)
    .filter(Boolean);

  return {
    buckets,
    averageMinutes: durations.length
      ? round(durations.reduce((a, b) => a + b, 0) / durations.length, 1)
      : null,
    unreadable,
  };
}

// ---------------------------------------------------------------------------
// Reaction to a loss
// ---------------------------------------------------------------------------

/**
 * Ids of entries opened within `windowMinutes` of a losing exit on the same day.
 *
 * The comparison is sequence, not sentiment: the trader does not have to have ticked
 * "revenge trade" on any review for this to show up.
 */
function afterLossIds(closed: Trade[], windowMinutes: number): Set<string> {
  const windowMs = windowMinutes * 60_000;
  const ids = new Set<string>();
  const byDay = new Map<string, Trade[]>();

  for (const trade of closed) {
    const list = byDay.get(trade.tradingDayId);
    if (list) list.push(trade);
    else byDay.set(trade.tradingDayId, [trade]);
  }

  for (const trades of byDay.values()) {
    const dated = trades
      .map((trade) => ({
        trade,
        entry: timestampMs(trade.entryTime),
        exit: timestampMs(trade.exitTime),
      }))
      .filter(
        (row): row is { trade: Trade; entry: number; exit: number } =>
          row.entry !== null && row.exit !== null
      );

    const losingExits = dated
      .filter((row) => realized(row.trade) < 0)
      .map((row) => ({ id: row.trade.id, exit: row.exit }));

    if (losingExits.length === 0) continue;

    for (const row of dated) {
      // The nearest loss that had already finished by the time this entry was taken.
      // A trade is never matched against its own exit, and `>=` keeps a same-instant
      // reversal — a stop-out immediately flipped the other way — counted, since that
      // is the most reactive entry there is rather than the least.
      let gap = Infinity;
      for (const loss of losingExits) {
        if (loss.id === row.trade.id) continue;
        const delta = row.entry - loss.exit;
        if (delta >= 0 && delta < gap) gap = delta;
      }
      if (gap <= windowMs) ids.add(row.trade.id);
    }
  }

  return ids;
}

export function analyzeAfterLoss(
  closed: Trade[],
  windowMinutes = AFTER_LOSS_WINDOW_MINUTES
): AfterLossFacts {
  const ids = afterLossIds(closed, windowMinutes);
  const after = closed.filter((trade) => ids.has(trade.id));
  const other = closed.filter((trade) => !ids.has(trade.id));

  return {
    windowMinutes,
    afterLoss: summarize(after, `within ${windowMinutes} min of a losing exit`),
    other: summarize(other, 'all other entries'),
    daysAffected: new Set(after.map((trade) => trade.tradingDayId)).size,
  };
}

// ---------------------------------------------------------------------------
// Size against the trader's own plan
// ---------------------------------------------------------------------------

export function analyzeSizeDiscipline(
  trades: Trade[],
  tradingDays: TradingDay[],
  windowMinutes = AFTER_LOSS_WINDOW_MINUTES
): SizeDisciplineFacts {
  const dayById = new Map(tradingDays.map((day) => [day.id, day]));
  const reactive = afterLossIds(
    trades.filter((trade) => trade.status === 'closed'),
    windowMinutes
  );

  let tradesOverPlannedSize = 0;
  let worstOvershootContracts = 0;
  let overPlannedSizeAfterLoss = 0;

  for (const trade of trades) {
    const planned = dayById.get(trade.tradingDayId)?.contractsPlanned ?? 0;
    if (planned <= 0) continue;
    if (trade.contracts <= planned) continue;

    tradesOverPlannedSize += 1;
    worstOvershootContracts = Math.max(worstOvershootContracts, trade.contracts - planned);
    if (reactive.has(trade.id)) overPlannedSizeAfterLoss += 1;
  }

  return {
    daysWithPlannedContracts: tradingDays.filter((day) => day.contractsPlanned > 0).length,
    tradesOverPlannedSize,
    worstOvershootContracts,
    overPlannedSizeAfterLoss,
  };
}

// ---------------------------------------------------------------------------
// Trading activity
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[mid - 1] + sorted[mid]) / 2, 1) : sorted[mid];
}

export function analyzeActivity(trades: Trade[], tradingDays: TradingDay[]): ActivityFacts {
  const dateByDayId = new Map(tradingDays.map((day) => [day.id, day.tradeDate]));
  const perDay = new Map<string, Trade[]>();

  for (const trade of trades) {
    const list = perDay.get(trade.tradingDayId);
    if (list) list.push(trade);
    else perDay.set(trade.tradingDayId, [trade]);
  }

  const days = [...perDay.entries()].map(([dayId, dayTrades]) => ({
    dayId,
    date: dateByDayId.get(dayId) ?? '',
    trades: dayTrades.length,
    netPnL: round(dayTrades.reduce((sum, trade) => sum + realized(trade), 0)),
  }));

  const counts = days.map((day) => day.trades);
  const medianTradesPerDay = median(counts);

  // Split on the median rather than a fixed trade count, so the comparison is against
  // this trader's own normal level of activity rather than a number we picked.
  const busy = days.filter((day) => day.trades > medianTradesPerDay);
  const quiet = days.filter((day) => day.trades <= medianTradesPerDay);
  const avg = (list: typeof days) =>
    list.length ? round(list.reduce((sum, day) => sum + day.netPnL, 0) / list.length) : null;

  const busiest = days.reduce<ActivityFacts['busiestDay']>(
    (top, day) => (!top || day.trades > top.trades ? { date: day.date, trades: day.trades, netPnL: day.netPnL } : top),
    null
  );

  return {
    daysWithTrades: days.length,
    medianTradesPerDay,
    // Both sides need real samples, otherwise a "busy" day is simply the only day.
    busyDays: busy.length >= 2 ? busy.length : 0,
    busyAvgPnL: busy.length >= 2 ? avg(busy) : null,
    quietDays: quiet.length >= 2 ? quiet.length : 0,
    quietAvgPnL: quiet.length >= 2 ? avg(quiet) : null,
    busiestDay: days.length >= MIN_BUCKET_TRADES ? busiest : null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function analyzeBehavior(input: {
  trades: Trade[];
  tradingDays: TradingDay[];
  timezone: string;
}): BehaviorFacts {
  const { trades, tradingDays, timezone } = input;
  const closed = trades.filter((trade) => trade.status === 'closed');

  return {
    timezone,
    timeOfDay: analyzeTimeOfDay(closed, timezone),
    holdTime: analyzeHoldTime(closed),
    afterLoss: analyzeAfterLoss(closed),
    sizeDiscipline: analyzeSizeDiscipline(trades, tradingDays),
    activity: analyzeActivity(trades, tradingDays),
  };
}
