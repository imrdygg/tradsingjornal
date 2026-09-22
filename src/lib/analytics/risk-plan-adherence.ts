import type { Trade } from '../../types';
import { hasAssumedRisk } from '../trading/risk-fixup';
import { RISK_TIER_COUNT } from '../trading/risk-tiers';
import { formatBucket, weekStart } from './weekly-buckets';

/**
 * Did each trade stick to the risk plan it was recorded against?
 *
 * The risk ladder only means something if the size that was actually taken is measured
 * against the slot it was logged under. This reads that out of the journal.
 *
 * "On plan" is deliberately defined as *no more than the slot allows*, not as an exact
 * match: futures trade in whole contracts, so a $25 slot on a 6-point MES stop cannot be
 * hit at all — the nearest size risks $30. Treating that as a breach would blame the
 * trader for arithmetic they cannot avoid. Risking MORE than the slot is the breach.
 */

/** One cent: differences smaller than this are float noise, not a decision. */
export const RISK_PLAN_TOLERANCE = 0.01;

export interface RiskPlanSlotRow {
  /** Stable key, so the table rows never reorder between renders. */
  key: string;
  /** "#2" for a fixed slot, "Custom" for the catch-all row. */
  label: string;
  /** What the slot allows. Null for the custom row, which has no single amount. */
  target: number | null;
  trades: number;
  within: number;
  over: number;
  /** Mean actual risk across the row's trades. */
  avgActualRisk: number;
  /** The most risked beyond the slot, in dollars. Null when nothing went over. */
  worstOver: number | null;
}

export interface RiskPlanAdherence {
  /** Trades that carry a slot and a target risk, and whose stop is real. */
  measured: number;
  within: number;
  over: number;
  /** Share of measured trades that risked no more than their slot. */
  withinPct: number | null;
  avgActualRisk: number;
  /** Mean dollars risked beyond the slot, across the trades that went over. */
  avgOverRisk: number | null;
  worstOver: number | null;
  /** Trades with no slot recorded at all — imports and pre-ladder records. */
  unrecorded: number;
  /** Trades whose stop the app had to invent, so their risk cannot be judged. */
  assumed: number;
  /**
   * How many of the most recent measured trades in a row stayed within their slot.
   *
   * The run counts backwards from the newest trade and stops at the first breach, so it
   * answers "where am I right now" rather than "how good have I been lately".
   */
  currentStreak: number;
  /** The longest such run anywhere in the sample, as the record to beat. */
  longestStreak: number;
  /** One row per fixed slot, then the custom row. Always all five. */
  slots: RiskPlanSlotRow[];
}

/** Chart-safe key for each slot, in ladder order: `s1`–`s4` then `custom`. */
export const SLOT_KEYS = [
  ...Array.from({ length: RISK_TIER_COUNT }, (_, index) => `s${index + 1}`),
  'custom',
];

/** How the same slots read on screen. */
export const SLOT_LABELS = [
  ...Array.from({ length: RISK_TIER_COUNT }, (_, index) => `#${index + 1}`),
  'Custom',
];

/** One week of adherence, one rate per slot. */
export interface SlotTrendPoint {
  /** The Monday the week starts on, as YYYY-MM-DD — the bucket's identity and sort key. */
  bucketKey: string;
  /** Human label for the axis, e.g. "Sep 14". */
  bucket: string;
  /** Within-rate 0–100 per slot key, or null when the slot was unused that week. */
  rates: Record<string, number | null>;
  /** How many measured trades each rate was computed from. */
  counts: Record<string, number>;
}

export interface SlotTrend {
  /** Slot keys, in the order the chart's series should be drawn. */
  slotKeys: string[];
  /** Matching labels for the legend. */
  slotLabels: string[];
  /** Weeks with at least one measured trade, oldest first. */
  points: SlotTrendPoint[];
}

/** The slot key a trade belongs to, or null when it cannot be judged at all. */
function slotKeyOf(trade: Trade): string | null {
  const hasSlot = typeof trade.riskTier === 'number' || trade.riskTier === null;
  if (!hasSlot || !trade.plannedRisk || trade.plannedRisk <= 0) return null;
  if (hasAssumedRisk(trade)) return null;
  if (
    typeof trade.riskTier === 'number' &&
    trade.riskTier >= 1 &&
    trade.riskTier <= RISK_TIER_COUNT
  ) {
    return `s${trade.riskTier}`;
  }
  return 'custom';
}

/**
 * Adherence per slot, week by week.
 *
 * The flat panel above says where the trader stands; this says which slot is slipping. A
 * slot is only plotted for a week it was actually used — a gap means untouched, not zero,
 * and drawing it as zero would invent a collapse that never happened.
 *
 * The counts travel with each rate so the chart can show its own sample size: one trade in a
 * week reads as 100% or 0%, and both are noise rather than a finding.
 */
export function summariseSlotTrends(
  trades: Trade[],
  dateOf: (trade: Trade) => string | null
): SlotTrend {
  const weeks = new Map<string, { measured: Record<string, number>; within: Record<string, number> }>();

  for (const trade of trades) {
    const slot = slotKeyOf(trade);
    if (!slot) continue;
    const date = dateOf(trade);
    if (!date) continue;
    const bucketKey = weekStart(date);
    if (!bucketKey) continue;

    let week = weeks.get(bucketKey);
    if (!week) {
      week = { measured: {}, within: {} };
      weeks.set(bucketKey, week);
    }
    week.measured[slot] = (week.measured[slot] ?? 0) + 1;
    if (withinSlot(trade)) week.within[slot] = (week.within[slot] ?? 0) + 1;
  }

  const points: SlotTrendPoint[] = [...weeks.keys()]
    .sort()
    .map((bucketKey) => {
      const week = weeks.get(bucketKey)!;
      const rates: Record<string, number | null> = {};
      const counts: Record<string, number> = {};

      for (const slot of SLOT_KEYS) {
        const measured = week.measured[slot] ?? 0;
        counts[slot] = measured;
        rates[slot] = measured
          ? Math.round(((week.within[slot] ?? 0) / measured) * 100)
          : null;
      }

      return { bucketKey, bucket: formatBucket(bucketKey), rates, counts };
    });

  return { slotKeys: [...SLOT_KEYS], slotLabels: [...SLOT_LABELS], points };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How far a trade's actual risk sits above the slot it was taken against. */
function overRisk(trade: Trade): number {
  return round2(trade.initialRisk - (trade.plannedRisk ?? 0));
}

/** True when the trade risked no more than its slot allows. */
function withinSlot(trade: Trade): boolean {
  return overRisk(trade) <= RISK_PLAN_TOLERANCE;
}

/**
 * Chronological order for the streak.
 *
 * A streak is a sequence, so it needs one: the entry time when there is one, and the
 * creation time as a fallback for a record without it. Compared as strings because both are
 * ISO timestamps, which sort correctly that way.
 */
function byEntryTime(a: Trade, b: Trade): number {
  return (a.entryTime || a.createdAt || '').localeCompare(b.entryTime || b.createdAt || '');
}

export function summariseRiskPlanAdherence(
  trades: Trade[],
  amounts: number[]
): RiskPlanAdherence {
  const fixed: Trade[][] = Array.from({ length: RISK_TIER_COUNT }, () => []);
  const custom: Trade[] = [];
  let unrecorded = 0;
  let assumed = 0;

  for (const trade of trades) {
    // `typeof null === 'object'`, so null (custom) is checked explicitly.
    const hasSlot = typeof trade.riskTier === 'number' || trade.riskTier === null;
    // No slot, or no target amount, means there is nothing to measure it against.
    if (!hasSlot || !trade.plannedRisk || trade.plannedRisk <= 0) {
      unrecorded += 1;
      continue;
    }
    // An invented stop makes the actual risk a placeholder, so it is not a breach — it is
    // unknown, and counted separately so it can never flatter or damage the rate.
    if (hasAssumedRisk(trade)) {
      assumed += 1;
      continue;
    }
    if (
      typeof trade.riskTier === 'number' &&
      trade.riskTier >= 1 &&
      trade.riskTier <= RISK_TIER_COUNT
    ) {
      fixed[trade.riskTier - 1].push(trade);
    } else {
      custom.push(trade);
    }
  }

  const buildRow = (
    key: string,
    label: string,
    target: number | null,
    list: Trade[]
  ): RiskPlanSlotRow => {
    let within = 0;
    let over = 0;
    let worstOver: number | null = null;
    let totalActual = 0;

    for (const trade of list) {
      const diff = overRisk(trade);
      totalActual += trade.initialRisk;
      if (diff > RISK_PLAN_TOLERANCE) {
        over += 1;
        worstOver = worstOver === null ? diff : Math.max(worstOver, diff);
      } else {
        within += 1;
      }
    }

    return {
      key,
      label,
      target,
      trades: list.length,
      within,
      over,
      avgActualRisk: list.length ? round2(totalActual / list.length) : 0,
      worstOver,
    };
  };

  const slots: RiskPlanSlotRow[] = [];
  for (let index = 0; index < RISK_TIER_COUNT; index += 1) {
    slots.push(buildRow(`tier-${index + 1}`, `#${index + 1}`, amounts[index] ?? null, fixed[index]));
  }
  slots.push(buildRow('custom', 'Custom', null, custom));

  const measuredTrades = [...fixed.flat(), ...custom];
  const measured = measuredTrades.length;
  const within = slots.reduce((sum, row) => sum + row.within, 0);
  const over = slots.reduce((sum, row) => sum + row.over, 0);

  const overTrades = measuredTrades.filter((trade) => !withinSlot(trade));
  const totalOver = overTrades.reduce((sum, trade) => sum + overRisk(trade), 0);
  const totalActual = measuredTrades.reduce((sum, trade) => sum + trade.initialRisk, 0);

  /**
   * The streaks, over the measurable trades only.
   *
   * A trade with no slot, or one whose stop was invented, takes part in neither: it cannot
   * extend a run and it does not break one. Judging them either way would make the number
   * move for reasons the trader never chose.
   */
  const chronological = [...measuredTrades].sort(byEntryTime);

  let currentStreak = 0;
  for (let index = chronological.length - 1; index >= 0; index -= 1) {
    if (!withinSlot(chronological[index])) break;
    currentStreak += 1;
  }

  let longestStreak = 0;
  let run = 0;
  for (const trade of chronological) {
    run = withinSlot(trade) ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }

  return {
    measured,
    within,
    over,
    withinPct: measured ? Math.round((within / measured) * 1000) / 10 : null,
    avgActualRisk: measured ? round2(totalActual / measured) : 0,
    avgOverRisk: overTrades.length ? round2(totalOver / overTrades.length) : null,
    worstOver: slots.reduce<number | null>(
      (worst, row) =>
        row.worstOver === null ? worst : worst === null ? row.worstOver : Math.max(worst, row.worstOver),
      null
    ),
    unrecorded,
    assumed,
    currentStreak,
    longestStreak,
    slots,
  };
}
