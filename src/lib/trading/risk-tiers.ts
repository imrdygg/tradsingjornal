import type { Trade, UserProfile } from '../../types';

/**
 * The numbered risk plan behind every trade.
 *
 * The journal is meant to make a trader pick a risk before they are in a position, so the
 * plan offers four fixed trade slots — #1 through #4 — and a custom amount for anything
 * that does not fit. Keeping the risk on a numbered slot (rather than free-typing a dollar
 * figure each time) is what makes a size that breaks the plan visible: the trade form will
 * size the position to the chosen slot and say when the stop distance cannot hit it exactly.
 */

/** How many fixed slots the ladder offers before the custom option. */
export const RISK_TIER_COUNT = 4;

/**
 * The out-of-the-box ladder: #1 risks $25, #2 $50, #3 $75, #4 $100.
 *
 * A starting point the trader can change in Settings — they are their own numbers, the
 * same way the daily loss limit is.
 */
export const DEFAULT_RISK_TIER_AMOUNTS: number[] = [25, 50, 75, 100];

/**
 * The ladder as the app should use it, with any missing or unusable slot filled in.
 *
 * Read defensively because the stored profile can be older than this feature, partially
 * written while a field is being edited, or restored from a backup: a slot the trader
 * cannot read is worse than the default, so each one is repaired on its own rather than
 * throwing the whole ladder away.
 */
export function riskTierAmounts(
  profile?: Pick<UserProfile, 'riskTierAmounts'> | null
): number[] {
  const stored = profile?.riskTierAmounts;
  return DEFAULT_RISK_TIER_AMOUNTS.map((fallback, index) => {
    const value = Number(stored?.[index]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  });
}

/** The dollar risk slot #`tier` commits to, or null when it is not one of the four. */
export function riskTierAmount(
  tier: number | null | undefined,
  amounts: number[]
): number | null {
  if (tier === null || tier === undefined || !Number.isInteger(tier)) return null;
  if (tier < 1 || tier > RISK_TIER_COUNT) return null;
  return amounts[tier - 1] ?? null;
}

/**
 * "Trade #2 · $50" — one label for the plan, the form and the trade card.
 *
 * The custom slot has no number by definition, so it reads as a plain risk amount instead.
 */
export function riskTierLabel(
  tier: number | null | undefined,
  plannedRisk: number | null | undefined,
  amounts: number[]
): string {
  const amount = riskTierAmount(tier, amounts);
  if (amount !== null) return `Trade #${tier} · $${amount}`;
  if (plannedRisk && plannedRisk > 0) return `Custom risk · $${plannedRisk}`;
  return 'Custom risk';
}

/**
 * How many trades the day's plan allows at each fixed slot, with 0 meaning no cap.
 *
 * Always four entries so an index is always a slot number minus one. A cap the trader has
 * not set and one they have deliberately cleared both read as 0: there is no difference
 * between "unlimited" and "not restricted" worth drawing.
 */
export function normalizeTierCaps(caps?: number[] | null): number[] {
  return Array.from({ length: RISK_TIER_COUNT }, (_, index) => {
    const value = Number(caps?.[index]);
    return Number.isInteger(value) && value > 0 ? value : 0;
  });
}

/**
 * How many trades have already been taken at each fixed slot.
 *
 * The custom slot is deliberately not counted: it has no number to cap, and a cap on
 * "whatever amount you type" would be a cap on nothing. Pass `excludeTradeId` when
 * checking an edit, so a trade does not count against its own cap.
 */
export function countTradesByTier(trades: Trade[], excludeTradeId?: string): number[] {
  const counts = Array.from({ length: RISK_TIER_COUNT }, () => 0);
  for (const trade of trades) {
    if (excludeTradeId && trade.id === excludeTradeId) continue;
    const tier = trade.riskTier;
    if (typeof tier === 'number' && tier >= 1 && tier <= RISK_TIER_COUNT) {
      counts[tier - 1] += 1;
    }
  }
  return counts;
}

/** A slot whose cap the day's trades have reached or passed. */
export interface TierCapStatus {
  /** Slot number, 1–4. */
  tier: number;
  /** What the plan allows at this slot. */
  cap: number;
  /** How many trades have been taken at it. */
  used: number;
  /** True once the count has passed the cap, not merely reached it. */
  over: boolean;
  /** True when the day's most recently recorded trade was taken at this slot. */
  filledByLatest: boolean;
}

/** The most recently recorded trade, by when it was saved. */
function latestRecordedTrade(trades: Trade[]): Trade | undefined {
  return trades.reduce<Trade | undefined>((latest, trade) => {
    if (!latest) return trade;
    const mine = trade.createdAt ?? '';
    const theirs = latest.createdAt ?? '';
    if (mine !== theirs) return mine > theirs ? trade : latest;
    // Same timestamp — a bulk import — so the id keeps the pick stable across renders.
    return trade.id > latest.id ? trade : latest;
  }, undefined);
}

/**
 * The slots whose cap the day has used up, most serious first.
 *
 * `used` counts every trade taken at a slot, open or closed: a cap is about how many trades
 * the plan allows, not how many are still running. Only slots with a cap set are considered,
 * so a day with no caps produces nothing to flag.
 *
 * `filledByLatest` separates "your last trade just used this up" from "this slot was already
 * spent", which is the difference between a nudge and a reminder.
 */
export function tierCapStatuses(trades: Trade[], caps?: number[] | null): TierCapStatus[] {
  const limits = normalizeTierCaps(caps);
  if (!limits.some((cap) => cap > 0)) return [];

  const used = countTradesByTier(trades);
  const latest = latestRecordedTrade(trades);

  return limits
    .map((cap, index) => ({
      tier: index + 1,
      cap,
      used: used[index],
      over: cap > 0 && used[index] > cap,
      filledByLatest: cap > 0 && latest?.riskTier === index + 1,
    }))
    .filter((status) => status.cap > 0 && status.used >= status.cap)
    // Breaches first, then by slot, so the line that matters most is read first.
    .sort((a, b) => Number(b.over) - Number(a.over) || a.tier - b.tier);
}

export interface RiskSizedContracts {
  /** Whole contracts, never below 1: one contract is the smallest position there is. */
  contracts: number;
  /** What those contracts actually risk at the given stop distance. */
  actualRisk: number;
  /** The stop distance the size was computed from, in points. */
  stopPoints: number;
  /** What a single contract risks at that distance. */
  riskPerContract: number;
  /** True when whole contracts cannot hit the slot's risk exactly. */
  rounded: boolean;
}

/**
 * The contracts that come closest to risking `risk` dollars at the given stop.
 *
 * Futures only trade in whole contracts, so the exact dollar figure is often unreachable:
 * a $25 slot on a 4-point MES stop is 1.25 contracts. This returns the nearest whole size
 * and flags that it was rounded, so the form can show the trader what they will actually
 * risk rather than a number they cannot take.
 */
export function sizeForRisk({
  risk,
  entryPrice,
  stopPrice,
  pointValue,
}: {
  risk: number;
  entryPrice: number;
  stopPrice: number;
  pointValue: number;
}): RiskSizedContracts | null {
  const stopPoints = Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  if (!Number.isFinite(stopPoints) || stopPoints <= 0) return null;
  if (!Number.isFinite(pointValue) || pointValue <= 0) return null;

  const riskPerContract = stopPoints * pointValue;
  const contracts = Math.max(1, Math.round(risk / riskPerContract));
  const actualRisk = Math.round(contracts * riskPerContract * 100) / 100;
  const rounded = Math.abs(actualRisk - risk) > 0.01;

  return {
    contracts,
    actualRisk,
    stopPoints: Math.round(stopPoints * 100) / 100,
    riskPerContract: Math.round(riskPerContract * 100) / 100,
    rounded,
  };
}
