import type { Trade } from '../../types';
import { hasAssumedRisk } from '../trading/risk-fixup';
import { formatBucket, weekStart } from './weekly-buckets';

/**
 * Planned exit versus realized exit, measured in R.
 *
 * A target is only meaningful against the risk being taken, so both sides are converted to
 * R-multiples before they are compared. The conversion is done from prices rather than the
 * stored `rMultiple`, so the target and the fill are always measured on the same basis:
 *
 *   long:  R = (price - entry) / (entry - stop)
 *   short: R = (entry - price) / (stop - entry)
 *
 * That ratio is instrument- and size-independent — the point value and contract count cancel
 * out — so two R values from the same trade are directly comparable.
 *
 * Trades whose stop the app had to invent (a broker CSV carries none) are excluded: their
 * risk is a placeholder, so any R built from it would be fiction in both directions.
 */

/** How close counts as reaching the target: any shortfall smaller than this is float noise. */
export const TARGET_R_TOLERANCE = 0.005;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One measured trade: its planned exit and what the exit actually was, in R. */
export interface TargetExitRow {
  trade: Trade;
  /** R-multiple the target price represents at the trade's own risk. */
  targetR: number;
  /** R-multiple the actual exit realized. */
  realizedR: number;
  /** Realized minus target. Negative means the exit fell short of the plan. */
  gapR: number;
  /** True when the exit reached or beat the target. */
  hit: boolean;
}

export interface TargetExitSummary {
  /** Closed trades with a target, a real stop and an exit — everything measured below. */
  measured: number;
  /** Of the measured, how many exited at or beyond their target. */
  hit: number;
  /** Share of measured trades that reached their target, 0–100, or null with none. */
  hitPct: number | null;
  /** Mean planned R across the measured trades. */
  avgTargetR: number;
  /** Mean realized R across the same trades. */
  avgRealizedR: number;
  /** Mean of realized minus target. Negative means exits fell short on average. */
  avgGapR: number;
  /** Mean extra R across the trades that beat their target. Null when none did. */
  avgBeyondR: number | null;
  /** Mean R left on the table across the trades that fell short. Null when none did. */
  avgShortR: number | null;
  /** The single largest shortfall in R, as a positive number. Null when nothing fell short. */
  worstShortR: number | null;
  /** Open trades that carry a target: the plan exists but has no outcome yet. */
  openWithTarget: number;
  /** Closed trades with no target recorded, so there is nothing to compare. */
  noTarget: number;
  /** Trades whose stop was invented, so neither R can be trusted. */
  assumed: number;
  /** Every measured trade, newest first. */
  rows: TargetExitRow[];
}

/** The R-multiple a price would produce on this trade, or null when the geometry is unusable. */
export function rMultipleAtPrice(trade: Trade, price: number): number | null {
  const { entryPrice, initialStop, direction } = trade;
  if (!Number.isFinite(price) || !Number.isFinite(entryPrice) || !Number.isFinite(initialStop)) {
    return null;
  }
  const stopDistance =
    direction === 'long' ? entryPrice - initialStop : initialStop - entryPrice;
  // A stop at (or on the wrong side of) entry is not a stop, so it cannot define an R.
  if (!(stopDistance > 0)) return null;

  const move = direction === 'long' ? price - entryPrice : entryPrice - price;
  return round2(move / stopDistance);
}

/**
 * Below this, a setup's hit rate is too small a sample to read as a rate.
 *
 * Exported so the panel can badge a row the same way the coach scoreboard badges a thin
 * group, rather than each place choosing its own cut-off.
 */
export const THIN_TARGET_SAMPLE = 5;

/** One setup's record of turning planned exits into realized ones. */
export interface TargetExitSetupRow {
  setupName: string;
  measured: number;
  hit: number;
  /** Share of the setup's measured trades that reached their target, 0–100. */
  hitPct: number;
  avgTargetR: number;
  avgRealizedR: number;
  avgGapR: number;
  /** True when the sample is too small for the rate to mean much. */
  thin: boolean;
}

/**
 * Target hit rate per setup, so a habit that lives in one play is visible.
 *
 * A shortfall that is spread evenly is a discipline problem; one concentrated in a single
 * setup is usually the target on that setup being unrealistic. Splitting it out is what
 * tells those two apart.
 */
export function summariseTargetExitsBySetup(trades: Trade[]): TargetExitSetupRow[] {
  const measured = summariseTargetExits(trades).rows;
  const bySetup = new Map<string, TargetExitRow[]>();

  for (const row of measured) {
    const name = row.trade.setupName?.trim() || 'No setup recorded';
    const list = bySetup.get(name);
    if (list) list.push(row);
    else bySetup.set(name, [row]);
  }

  const mean = (values: number[]) =>
    values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

  return [...bySetup.entries()]
    .map(([setupName, rows]) => {
      const hit = rows.filter((row) => row.hit).length;
      return {
        setupName,
        measured: rows.length,
        hit,
        hitPct: Math.round((hit / rows.length) * 100),
        avgTargetR: mean(rows.map((row) => row.targetR)),
        avgRealizedR: mean(rows.map((row) => row.realizedR)),
        avgGapR: mean(rows.map((row) => row.gapR)),
        thin: rows.length < THIN_TARGET_SAMPLE,
      };
    })
    .sort(
      (a, b) =>
        b.measured - a.measured ||
        b.hitPct - a.hitPct ||
        a.setupName.localeCompare(b.setupName)
    );
}

/** One week of targeted exits, for the hit-rate trend. */
export interface HitRateTrendPoint {
  /** The Monday the week starts on, as YYYY-MM-DD — the bucket's identity and sort key. */
  bucketKey: string;
  /** Human label for the axis, e.g. "Sep 14". */
  bucket: string;
  measured: number;
  hit: number;
  hitPct: number;
  /** Mean realized-minus-target R for the week's trades. */
  avgGapR: number;
}

/**
 * Target hit rate, week by week.
 *
 * The overall panel says whether exits keep up with the plan; this says whether that is
 * improving. Only weeks with at least one measured trade appear — an absent week is one with
 * nothing to measure, not a week that scored zero — and the sample travels with each point so
 * a 100% week built from one trade is never read as a finding.
 *
 * The caller supplies the date, the same way the slot trend does, so a late-night entry lands
 * on the day the trader was actually trading rather than the day its timestamp happens to fall
 * in.
 */
export function summariseTargetHitTrend(
  trades: Trade[],
  dateOf: (trade: Trade) => string | null
): HitRateTrendPoint[] {
  const weeks = new Map<string, TargetExitRow[]>();

  for (const row of summariseTargetExits(trades).rows) {
    const date = dateOf(row.trade);
    if (!date) continue;
    const bucketKey = weekStart(date);
    if (!bucketKey) continue;
    const list = weeks.get(bucketKey);
    if (list) list.push(row);
    else weeks.set(bucketKey, [row]);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketKey, rows]) => {
      const hit = rows.filter((row) => row.hit).length;
      return {
        bucketKey,
        bucket: formatBucket(bucketKey),
        measured: rows.length,
        hit,
        hitPct: Math.round((hit / rows.length) * 100),
        avgGapR: round2(rows.reduce((sum, row) => sum + row.gapR, 0) / rows.length),
      };
    });
}

/** A single trade's target, measured against its own risk and, once closed, its exit. */
export interface TargetComparison {
  /** R-multiple the target price represents. */
  targetR: number;
  /** R-multiple the exit realized, or null while the trade is open. */
  realizedR: number | null;
  /** Realized minus target. Null until there is an exit to compare. */
  gapR: number | null;
  /** Whether the exit reached the target. Null until there is an exit. */
  hit: boolean | null;
}

/**
 * The target R for one trade, beside its realized R once it has closed.
 *
 * Shared by the trade card and the detail view so both read the plan the same way — off the
 * trade's own stop rather than its stored `rMultiple`, which keeps the two figures on one
 * basis. Returns null when the trade has no usable target.
 */
export function compareTargetOnTrade(trade: Trade): TargetComparison | null {
  const hasTarget = typeof trade.targetPrice === 'number' && trade.targetPrice > 0;
  if (!hasTarget) return null;

  const targetR = rMultipleAtPrice(trade, trade.targetPrice as number);
  if (targetR === null) return null;

  const realizedR =
    typeof trade.exitPrice === 'number' ? rMultipleAtPrice(trade, trade.exitPrice) : null;

  return {
    targetR,
    realizedR,
    gapR: realizedR === null ? null : round2(realizedR - targetR),
    hit: realizedR === null ? null : realizedR >= targetR - TARGET_R_TOLERANCE,
  };
}

/** Newest first, so the panel's table reads the way the rest of the journal does. */
function byEntryTimeDesc(a: Trade, b: Trade): number {
  return (b.entryTime || b.createdAt || '').localeCompare(a.entryTime || a.createdAt || '');
}

export function summariseTargetExits(trades: Trade[]): TargetExitSummary {
  const rows: TargetExitRow[] = [];
  let openWithTarget = 0;
  let noTarget = 0;
  let assumed = 0;

  for (const trade of trades) {
    // An invented stop makes both R values placeholders, so the trade is set aside entirely.
    if (hasAssumedRisk(trade)) {
      assumed += 1;
      continue;
    }

    const hasTarget = typeof trade.targetPrice === 'number' && trade.targetPrice > 0;
    const isClosed = trade.status === 'closed' && typeof trade.exitPrice === 'number';

    if (!hasTarget) {
      if (isClosed) noTarget += 1;
      continue;
    }

    const targetR = rMultipleAtPrice(trade, trade.targetPrice as number);
    // A target with no usable risk geometry cannot be measured; treat it as an open plan.
    if (targetR === null) {
      if (!isClosed) openWithTarget += 1;
      continue;
    }

    if (!isClosed) {
      openWithTarget += 1;
      continue;
    }

    const realizedR = rMultipleAtPrice(trade, trade.exitPrice as number);
    if (realizedR === null) {
      openWithTarget += 1;
      continue;
    }

    const gapR = round2(realizedR - targetR);
    rows.push({
      trade,
      targetR,
      realizedR,
      gapR,
      hit: realizedR >= targetR - TARGET_R_TOLERANCE,
    });
  }

  rows.sort((a, b) => byEntryTimeDesc(a.trade, b.trade));

  const measured = rows.length;
  const hit = rows.filter((row) => row.hit).length;
  const beyond = rows.filter((row) => row.gapR > TARGET_R_TOLERANCE);
  const short = rows.filter((row) => row.gapR < -TARGET_R_TOLERANCE);

  const mean = (values: number[]) =>
    values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

  return {
    measured,
    hit,
    hitPct: measured ? Math.round((hit / measured) * 100) : null,
    avgTargetR: mean(rows.map((row) => row.targetR)),
    avgRealizedR: mean(rows.map((row) => row.realizedR)),
    avgGapR: mean(rows.map((row) => row.gapR)),
    avgBeyondR: beyond.length ? mean(beyond.map((row) => row.gapR)) : null,
    avgShortR: short.length ? round2(Math.abs(mean(short.map((row) => row.gapR)))) : null,
    worstShortR: short.length
      ? round2(Math.abs(Math.min(...short.map((row) => row.gapR))))
      : null,
    openWithTarget,
    noTarget,
    assumed,
    rows,
  };
}
