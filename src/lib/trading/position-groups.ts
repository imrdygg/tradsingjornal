import { Trade } from '../../types';

/**
 * Grouping of position legs (scale-ins) so the journal can show one blended
 * view of a position instead of several unrelated rows.
 *
 * A trade belongs to a position when it carries a `positionId`. The opening
 * trade of a position is its own anchor: the calculator sets
 * `positionId = <opening trade id>` on every leg it adds. Trades without a
 * positionId are treated as standalone positions of one leg.
 */

export interface TradePositionGroup {
  positionId: string;
  /** Legs in the order they were entered (oldest first). */
  trades: Trade[];
  legCount: number;
  /** Total contracts across every leg, opened and closed. */
  totalContracts: number;
  /** Contracts-weighted average entry — the position's break-even before costs. */
  averageEntry: number;
  /** Sum of each leg's initial dollar risk. */
  totalInitialRisk: number;
  /** True P&L across the legs (0 while a leg is still open). */
  realizedPnL: number;
  openLegs: number;
  closedLegs: number;
  allClosed: boolean;
  /** 1-based position of `trade` inside the group. */
  legIndex: (tradeId: string) => number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Stable key for a trade: its position id, or its own id when standalone. */
export function positionKey(trade: Pick<Trade, 'id' | 'positionId'>): string {
  return trade.positionId || trade.id;
}

function buildGroup(positionId: string, legs: Trade[]): TradePositionGroup {
  const sorted = [...legs].sort(
    (a, b) => new Date(a.entryTime || a.createdAt).getTime() - new Date(b.entryTime || b.createdAt).getTime()
  );

  // Guard against missing/zero contract counts so a bad record cannot make the
  // average NaN.
  let weightedEntry = 0;
  let contractWeight = 0;
  for (const leg of sorted) {
    const qty = leg.contracts > 0 ? leg.contracts : 0;
    weightedEntry += qty * (leg.entryPrice || 0);
    contractWeight += qty;
  }

  const totalContracts = sorted.reduce(
    (sum, leg) => sum + (leg.contracts > 0 ? leg.contracts : 0),
    0
  );
  const closedLegs = sorted.filter((leg) => leg.status === 'closed');

  return {
    positionId,
    trades: sorted,
    legCount: sorted.length,
    totalContracts,
    averageEntry: contractWeight > 0 ? round2(weightedEntry / contractWeight) : 0,
    totalInitialRisk: round2(sorted.reduce((sum, leg) => sum + (leg.initialRisk || 0), 0)),
    realizedPnL: round2(closedLegs.reduce((sum, leg) => sum + (leg.grossPnL || 0), 0)),
    openLegs: sorted.length - closedLegs.length,
    closedLegs: closedLegs.length,
    allClosed: closedLegs.length === sorted.length && sorted.length > 0,
    legIndex: (tradeId: string) => sorted.findIndex((leg) => leg.id === tradeId) + 1,
  };
}

/** Builds every position group in the journal, keyed by position id. */
export function buildPositionGroups(trades: Trade[]): Map<string, TradePositionGroup> {
  const buckets = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = positionKey(trade);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(trade);
    else buckets.set(key, [trade]);
  }

  const groups = new Map<string, TradePositionGroup>();
  for (const [key, legs] of buckets) {
    groups.set(key, buildGroup(key, legs));
  }
  return groups;
}

/** The group a given trade belongs to, if the journal has been grouped. */
export function findPositionGroup(
  groups: Map<string, TradePositionGroup> | undefined,
  trade: Trade
): TradePositionGroup | undefined {
  if (!groups) return undefined;
  return groups.get(positionKey(trade));
}
