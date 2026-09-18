import { Instrument, Trade, TradeDirection } from '../../types';
import { calculateInitialRisk } from './calculate-risk';
import { calculateRMultiple } from './calculate-r';

/**
 * Fixing the risk on imported trades.
 *
 * A broker CSV carries no stop price, so an import has to invent one. That invented
 * stop flows into initial risk, the R-multiple, expectancy and every risk statistic in
 * the app — numbers that look authoritative but are fiction. This module is how the
 * trader replaces them with real ones, either one at a time or in bulk.
 *
 * Everything here is pure so the arithmetic can be tested directly.
 */

export type RiskFixMode = 'points' | 'dollars';

export interface RiskFixPlan {
  mode: RiskFixMode;
  /** Stop distance in points, when mode is 'points'. */
  points?: number;
  /** Total dollar risk for the whole trade, when mode is 'dollars'. */
  dollars?: number;
}

export interface RiskFixItem {
  tradeId: string;
  symbol: string;
  direction: TradeDirection;
  contracts: number;
  entryPrice: number;
  previousStop: number;
  previousRisk: number;
  previousR: number;
  stop: number;
  risk: number;
  rMultiple: number;
  /** Points between entry and the new stop, after tick rounding. */
  stopPoints: number;
}

export interface RiskFixSkip {
  tradeId: string;
  symbol: string;
  reason: string;
}

export interface RiskFixPreview {
  items: RiskFixItem[];
  skipped: RiskFixSkip[];
  /** True when the plan itself is unusable, e.g. a zero distance. */
  planError: string | null;
  summary: {
    count: number;
    totalRisk: number;
    averageRisk: number;
    /** Trades whose R-multiple actually changes. */
    rChanged: number;
  };
}

/**
 * True when a trade's risk is a placeholder rather than something the trader set.
 *
 * Trades imported before this flag existed have it undefined, and their stop could
 * only ever have been a guess, so an imported trade without an explicit 'recorded'
 * marker counts as assumed. No migration is needed.
 */
export function hasAssumedRisk(trade: Pick<Trade, 'source' | 'riskSource'>): boolean {
  if (trade.riskSource === 'assumed') return true;
  if (trade.riskSource === 'recorded') return false;
  return trade.source === 'tradovate_csv';
}

/** Trades whose risk still needs a real stop, newest first. */
export function findAssumedRiskTrades(trades: Trade[]): Trade[] {
  return trades
    .filter(hasAssumedRisk)
    .sort((a, b) => (b.entryTime ?? '').localeCompare(a.entryTime ?? ''));
}

/** Rounds a price to the nearest tradable tick. */
export function roundToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price)) return 0;
  if (!tickSize || tickSize <= 0) return Math.round(price * 100) / 100;
  // Work in integer ticks to avoid float drift, e.g. 0.25 steps landing on .2499.
  const ticks = Math.round(price / tickSize);
  return Math.round(ticks * tickSize * 10000) / 10000;
}

/**
 * The stop price implied by a plan, always on the losing side of the entry: below it
 * for a long, above it for a short. Rounded to a real tick so the stop is a price the
 * trader could actually have placed.
 */
export function deriveStop(params: {
  entryPrice: number;
  direction: TradeDirection;
  mode: RiskFixMode;
  points?: number;
  dollars?: number;
  contracts: number;
  pointValue: number;
  tickSize: number;
}): number {
  const { entryPrice, direction, mode, contracts, pointValue, tickSize } = params;

  const distance =
    mode === 'points'
      ? params.points ?? 0
      : pointValue > 0 && contracts > 0
      ? (params.dollars ?? 0) / (pointValue * contracts)
      : 0;

  const raw = direction === 'long' ? entryPrice - distance : entryPrice + distance;
  return roundToTick(raw, tickSize);
}

function resolveInstrument(trade: Trade, instruments: Instrument[]): Instrument | undefined {
  return instruments.find((i) => i.id === trade.instrumentId);
}

/**
 * Recomputes everything that depends on the stop.
 *
 * Points P&L and cash P&L come from the fills, not the stop, so they are untouched —
 * only risk, the stop itself and the R-multiple change.
 */
export function recomputeTradeRisk(
  trade: Trade,
  stop: number,
  instrument: Pick<Instrument, 'pointValue'>
): { initialStop: number; initialRisk: number; rMultiple: number } {
  const initialRisk = calculateInitialRisk({
    entryPrice: trade.entryPrice,
    stopPrice: stop,
    contracts: trade.contracts,
    instrument,
  });
  return {
    initialStop: stop,
    initialRisk,
    rMultiple: calculateRMultiple(trade.grossPnL || 0, initialRisk),
  };
}

function planDistance(plan: RiskFixPlan): { ok: boolean; error: string | null } {
  if (plan.mode === 'points') {
    if (!Number.isFinite(plan.points) || (plan.points ?? 0) <= 0) {
      return { ok: false, error: 'Enter a stop distance greater than zero points.' };
    }
    return { ok: true, error: null };
  }
  if (!Number.isFinite(plan.dollars) || (plan.dollars ?? 0) <= 0) {
    return { ok: false, error: 'Enter a dollar risk greater than zero.' };
  }
  return { ok: true, error: null };
}

/**
 * Works out what a plan would do to every trade with assumed risk, without changing
 * anything. The UI shows this before anything is applied, so the trader sees the real
 * stops and R-multiples rather than trusting a bulk edit blindly.
 */
export function previewRiskFix(params: {
  trades: Trade[];
  instruments: Instrument[];
  plan: RiskFixPlan;
}): RiskFixPreview {
  const { trades, instruments, plan } = params;
  const items: RiskFixItem[] = [];
  const skipped: RiskFixSkip[] = [];

  const validity = planDistance(plan);
  if (!validity.ok) {
    return {
      items,
      skipped,
      planError: validity.error,
      summary: { count: 0, totalRisk: 0, averageRisk: 0, rChanged: 0 },
    };
  }

  for (const trade of findAssumedRiskTrades(trades)) {
    const instrument = resolveInstrument(trade, instruments);
    const symbol = instrument?.symbol ?? 'unknown';

    if (!instrument) {
      skipped.push({ tradeId: trade.id, symbol, reason: 'The instrument is not recognised.' });
      continue;
    }
    if (!Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) {
      skipped.push({ tradeId: trade.id, symbol, reason: 'No entry price recorded.' });
      continue;
    }
    if (!Number.isFinite(trade.contracts) || trade.contracts <= 0) {
      skipped.push({ tradeId: trade.id, symbol, reason: 'No contract count recorded.' });
      continue;
    }
    if (instrument.pointValue <= 0) {
      skipped.push({ tradeId: trade.id, symbol, reason: 'The instrument has no point value.' });
      continue;
    }

    const stop = deriveStop({
      entryPrice: trade.entryPrice,
      direction: trade.direction,
      mode: plan.mode,
      points: plan.points,
      dollars: plan.dollars,
      contracts: trade.contracts,
      pointValue: instrument.pointValue,
      tickSize: instrument.tickSize,
    });

    const stopPoints =
      trade.direction === 'long' ? trade.entryPrice - stop : stop - trade.entryPrice;

    // A stop on the wrong side of the entry, or a distance smaller than one tick,
    // would silently create a nonsense risk figure.
    if (!Number.isFinite(stopPoints) || stopPoints <= 0) {
      skipped.push({
        tradeId: trade.id,
        symbol,
        reason: `The resulting stop (${stop}) is not on the losing side of the entry (${trade.entryPrice}).`,
      });
      continue;
    }

    const recomputed = recomputeTradeRisk(trade, stop, instrument);
    items.push({
      tradeId: trade.id,
      symbol,
      direction: trade.direction,
      contracts: trade.contracts,
      entryPrice: trade.entryPrice,
      previousStop: trade.initialStop,
      previousRisk: trade.initialRisk,
      previousR: trade.rMultiple,
      stop: recomputed.initialStop,
      risk: recomputed.initialRisk,
      rMultiple: recomputed.rMultiple,
      stopPoints: Math.round(stopPoints * 100) / 100,
    });
  }

  const totalRisk = items.reduce((sum, item) => sum + item.risk, 0);
  return {
    items,
    skipped,
    planError: null,
    summary: {
      count: items.length,
      totalRisk: Math.round(totalRisk * 100) / 100,
      averageRisk: items.length ? Math.round((totalRisk / items.length) * 100) / 100 : 0,
      rChanged: items.filter((item) => item.rMultiple !== item.previousR).length,
    },
  };
}

/**
 * A single trade's fix, so one trade can be corrected on its own.
 *
 * `points` is a distance from the entry rather than an absolute price: the trader
 * knows the distance they use, and the entry side is already recorded.
 */
export function previewSingleRiskFix(params: {
  trade: Trade;
  instruments: Instrument[];
  points: number;
}): RiskFixItem | { error: string } {
  const preview = previewRiskFix({
    // previewRiskFix only considers trades with assumed risk, so the flag is
    // normalised here to allow fixing a trade the app has not flagged.
    trades: [{ ...params.trade, riskSource: 'assumed' }],
    instruments: params.instruments,
    plan: { mode: 'points', points: params.points },
  });

  if (preview.planError) return { error: preview.planError };
  if (preview.skipped.length) return { error: preview.skipped[0].reason };
  if (!preview.items.length) return { error: 'This trade could not be priced.' };
  return preview.items[0];
}
