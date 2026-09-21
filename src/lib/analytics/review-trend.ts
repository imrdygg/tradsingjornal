import type { DailyReview, Trade, TradingDay } from '../../types';

/**
 * The end-of-day review as a line, day by day.
 *
 * The point of this module is the thing the trader cannot see from a P&L curve: whether
 * they are actually running the process they committed to. Strategy shows up in the money;
 * adherence shows up here, and it is the part that is about them rather than the market.
 *
 * Only reviewed days appear. A day with no review has no score, and inventing one — or
 * carrying the last score forward — would put a flat line where there is simply no data.
 */

/**
 * The score at or above which the review counted as a day that held the plan.
 *
 * Shared with the coach digest, which compares P&L on days above and below this line, so
 * the chart and the coach's claim about the same days cannot disagree.
 */
export const HIGH_DISCIPLINE_SCORE = 80;

export interface ReviewTrendPoint {
  /** Trading date, YYYY-MM-DD. */
  date: string;
  disciplineScore: number;
  /** Realized P&L that day, net when the journal records it, otherwise gross. */
  netPnL: number;
  trades: number;
}

export interface ReviewTrend {
  points: ReviewTrendPoint[];
  reviewedDays: number;
  average: number | null;
  best: ReviewTrendPoint | null;
  worst: ReviewTrendPoint | null;
  /** Days at or above {@link HIGH_DISCIPLINE_SCORE}. */
  onPlanDays: number;
  /**
   * Consecutive most-recent reviewed days at or above the threshold. A break of even one
   * day resets it, which is the point: a streak is only worth reading if it is unbroken.
   */
  onPlanStreak: number;
  /** Average P&L on the days that held the plan, and on the days that did not. */
  onPlanAvgPnL: number | null;
  offPlanAvgPnL: number | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Net P&L when the journal has it, else gross — the same reading the coach digest uses. */
function realized(trade: Trade): number {
  const value =
    typeof trade.netPnL === 'number' && Number.isFinite(trade.netPnL)
      ? trade.netPnL
      : trade.grossPnL ?? 0;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Builds the trend from the reviews the trader has completed.
 *
 * The date comes from the parent trading day rather than the review's timestamp, because a
 * late-evening review belongs to the day that was traded.
 */
export function buildReviewTrend(input: {
  reviews: DailyReview[];
  tradingDays: TradingDay[];
  trades: Trade[];
}): ReviewTrend {
  const dateByDayId = new Map(input.tradingDays.map((day) => [day.id, day.tradeDate]));

  const byDay = new Map<string, { pnl: number; trades: number }>();
  for (const trade of input.trades) {
    const date = dateByDayId.get(trade.tradingDayId);
    if (!date) continue;
    const existing = byDay.get(date) ?? { pnl: 0, trades: 0 };
    existing.pnl = round(existing.pnl + realized(trade));
    existing.trades += 1;
    byDay.set(date, existing);
  }

  const points: ReviewTrendPoint[] = [];
  for (const review of input.reviews) {
    const date = dateByDayId.get(review.tradingDayId);
    // A review whose day is gone (a reset, or an import without its day) is skipped rather
    // than charted at an invented position.
    if (!date) continue;
    const day = byDay.get(date) ?? { pnl: 0, trades: 0 };
    points.push({
      date,
      disciplineScore: Math.max(0, Math.min(100, review.disciplineScore)),
      netPnL: day.pnl,
      trades: day.trades,
    });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  const scored = points.map((point) => point.disciplineScore);
  const onPlan = points.filter((point) => point.disciplineScore >= HIGH_DISCIPLINE_SCORE);

  let onPlanStreak = 0;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].disciplineScore < HIGH_DISCIPLINE_SCORE) break;
    onPlanStreak += 1;
  }

  // Ties keep the earlier day, so the label beside the figure is stable rather than
  // flipping between two equal scores.
  const best = points.reduce<ReviewTrendPoint | null>(
    (top, point) => (!top || point.disciplineScore > top.disciplineScore ? point : top),
    null
  );
  const worst = points.reduce<ReviewTrendPoint | null>(
    (low, point) => (!low || point.disciplineScore < low.disciplineScore ? point : low),
    null
  );

  return {
    points,
    reviewedDays: points.length,
    average: mean(scored),
    best,
    worst,
    onPlanDays: onPlan.length,
    onPlanStreak,
    onPlanAvgPnL: mean(onPlan.map((point) => point.netPnL)),
    offPlanAvgPnL: mean(
      points.filter((point) => point.disciplineScore < HIGH_DISCIPLINE_SCORE).map((p) => p.netPnL)
    ),
  };
}
