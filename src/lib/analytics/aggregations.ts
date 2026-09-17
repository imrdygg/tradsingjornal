import { Trade, TradingDay, DailyReview } from '../../types';
import { calculateProfitFactor } from './profit-factor';
import { calculateExpectancy } from './expectancy';
import { calculateMaxDrawdown } from './drawdown';

export interface CoreAnalytics {
  totalPnL: number;
  tradeCount: number;
  completedDaysCount: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;
  tradeWinRate: number; // percentage e.g. 60.5
  winningDayRate: number;
  avgWinner: number;
  avgLoser: number;
  largestWinner: number;
  largestLoss: number;
  profitFactor: number | null;
  expectancy: number | null;
  avgRMultiple: number;
  maxDrawdown: number;
  longPnL: number;
  longTrades: number;
  shortPnL: number;
  shortTrades: number;
  avgDisciplineScore: number;
}

export interface SessionBreakdownItem {
  session: string;
  tradesCount: number;
  pnl: number;
  winRate: number;
  avgR: number;
  profitFactor: number | null;
}

export interface SetupBreakdownItem {
  setupName: string;
  tradesCount: number;
  pnl: number;
  winRate: number;
  avgR: number;
  profitFactor: number | null;
}

export interface RiskModeComparison {
  normal: {
    days: number;
    trades: number;
    winningDayRate: number;
    netPnL: number;
    avgDailyPnL: number;
    avgLosingDay: number;
    largestLosingDay: number;
    avgDisciplineScore: number;
  };
  expanded: {
    days: number;
    trades: number;
    winningDayRate: number;
    netPnL: number;
    avgDailyPnL: number;
    avgLosingDay: number;
    largestLosingDay: number;
    avgDisciplineScore: number;
  };
}

export interface ChartCurvePoint {
  index: number;
  date: string;
  pnl: number;
  cumulativePnL: number;
  disciplineScore?: number;
  label: string;
}

export function calculateCoreAnalytics(
  trades: Trade[],
  tradingDays: TradingDay[],
  reviews: DailyReview[]
): CoreAnalytics {
  const closedTrades = trades.filter((t) => t.status === 'closed');
  const tradeCount = closedTrades.length;

  const winners = closedTrades.filter((t) => t.grossPnL > 0);
  const losers = closedTrades.filter((t) => t.grossPnL < 0);
  const breakEvens = closedTrades.filter((t) => t.grossPnL === 0);

  const totalPnL = Math.round(
    closedTrades.reduce((sum, t) => sum + (t.netPnL !== undefined ? t.netPnL : t.grossPnL), 0) * 100
  ) / 100;

  const winCount = winners.length;
  const lossCount = losers.length;
  const breakEvenCount = breakEvens.length;

  const tradeWinRate = tradeCount > 0 ? Math.round((winCount / tradeCount) * 1000) / 10 : 0;

  const avgWinner =
    winners.length > 0
      ? Math.round((winners.reduce((sum, t) => sum + t.grossPnL, 0) / winners.length) * 100) / 100
      : 0;

  const avgLoser =
    losers.length > 0
      ? Math.round((losers.reduce((sum, t) => sum + t.grossPnL, 0) / losers.length) * 100) / 100
      : 0;

  const largestWinner =
    winners.length > 0 ? Math.max(...winners.map((t) => t.grossPnL)) : 0;

  const largestLoss =
    losers.length > 0 ? Math.min(...losers.map((t) => t.grossPnL)) : 0;

  const profitFactor = calculateProfitFactor(closedTrades);
  const expectancy = calculateExpectancy(closedTrades);

  const avgRMultiple =
    tradeCount > 0
      ? Math.round(
          (closedTrades.reduce((sum, t) => sum + (t.rMultiple || 0), 0) / tradeCount) * 100
        ) / 100
      : 0;

  const maxDrawdown = calculateMaxDrawdown(closedTrades);

  const longTradesList = closedTrades.filter((t) => t.direction === 'long');
  const shortTradesList = closedTrades.filter((t) => t.direction === 'short');

  const longPnL = Math.round(longTradesList.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;
  const shortPnL = Math.round(shortTradesList.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;

  // Trading day win rate: group closed trades by day
  const dayPnLMap = new Map<string, number>();
  for (const t of closedTrades) {
    dayPnLMap.set(t.tradingDayId, (dayPnLMap.get(t.tradingDayId) || 0) + t.grossPnL);
  }

  const completedDays = Array.from(dayPnLMap.entries());
  const winningDaysCount = completedDays.filter(([, pnl]) => pnl > 0).length;
  const winningDayRate =
    completedDays.length > 0
      ? Math.round((winningDaysCount / completedDays.length) * 1000) / 10
      : 0;

  const avgDisciplineScore =
    reviews.length > 0
      ? Math.round(
          reviews.reduce((sum, r) => sum + r.disciplineScore, 0) / reviews.length
        )
      : 100;

  return {
    totalPnL,
    tradeCount,
    completedDaysCount: completedDays.length,
    winCount,
    lossCount,
    breakEvenCount,
    tradeWinRate,
    winningDayRate,
    avgWinner,
    avgLoser,
    largestWinner,
    largestLoss,
    profitFactor,
    expectancy,
    avgRMultiple,
    maxDrawdown,
    longPnL,
    longTrades: longTradesList.length,
    shortPnL,
    shortTrades: shortTradesList.length,
    avgDisciplineScore,
  };
}

export function calculateSessionBreakdown(trades: Trade[]): SessionBreakdownItem[] {
  const closed = trades.filter((t) => t.status === 'closed');
  const sessions: Array<Trade['session']> = ['Overnight', 'Premarket', 'Regular Session'];

  return sessions.map((sess) => {
    const sessTrades = closed.filter((t) => t.session === sess);
    const count = sessTrades.length;
    const pnl = Math.round(sessTrades.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;
    const wins = sessTrades.filter((t) => t.grossPnL > 0).length;
    const winRate = count > 0 ? Math.round((wins / count) * 1000) / 10 : 0;
    const avgR =
      count > 0
        ? Math.round((sessTrades.reduce((sum, t) => sum + (t.rMultiple || 0), 0) / count) * 100) /
          100
        : 0;
    const pf = calculateProfitFactor(sessTrades);

    return {
      session: sess,
      tradesCount: count,
      pnl,
      winRate,
      avgR,
      profitFactor: pf,
    };
  });
}

export function calculateSetupBreakdown(trades: Trade[]): SetupBreakdownItem[] {
  const closed = trades.filter((t) => t.status === 'closed');
  const setupGroups = new Map<string, Trade[]>();

  for (const trade of closed) {
    const name = trade.setupName || 'Unspecified';
    if (!setupGroups.has(name)) {
      setupGroups.set(name, []);
    }
    setupGroups.get(name)!.push(trade);
  }

  const result: SetupBreakdownItem[] = [];
  for (const [setupName, sTrades] of setupGroups.entries()) {
    const count = sTrades.length;
    const pnl = Math.round(sTrades.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;
    const wins = sTrades.filter((t) => t.grossPnL > 0).length;
    const winRate = count > 0 ? Math.round((wins / count) * 1000) / 10 : 0;
    const avgR =
      count > 0
        ? Math.round((sTrades.reduce((sum, t) => sum + (t.rMultiple || 0), 0) / count) * 100) /
          100
        : 0;
    const pf = calculateProfitFactor(sTrades);

    result.push({
      setupName,
      tradesCount: count,
      pnl,
      winRate,
      avgR,
      profitFactor: pf,
    });
  }

  return result.sort((a, b) => b.tradesCount - a.tradesCount);
}

export function calculateRiskModeComparison(
  trades: Trade[],
  tradingDays: TradingDay[],
  reviews: DailyReview[]
): RiskModeComparison {
  const closed = trades.filter((t) => t.status === 'closed');
  const dayMap = new Map<string, TradingDay>();
  tradingDays.forEach((d) => dayMap.set(d.id, d));
  const reviewMap = new Map<string, DailyReview>();
  reviews.forEach((r) => reviewMap.set(r.tradingDayId, r));

  const modes: Array<'normal' | 'expanded'> = ['normal', 'expanded'];

  const stats = modes.reduce(
    (acc, mode) => {
      const modeDays = tradingDays.filter((d) => d.riskMode === mode);
      const modeDayIds = new Set(modeDays.map((d) => d.id));
      const modeTrades = closed.filter((t) => modeDayIds.has(t.tradingDayId));

      const dailyPnLMap = new Map<string, number>();
      for (const t of modeTrades) {
        dailyPnLMap.set(t.tradingDayId, (dailyPnLMap.get(t.tradingDayId) || 0) + t.grossPnL);
      }

      const dayPnLs = Array.from(dailyPnLMap.values());
      const winningDays = dayPnLs.filter((p) => p > 0).length;
      const losingDays = dayPnLs.filter((p) => p < 0);

      const netPnL = Math.round(modeTrades.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;
      const winningDayRate =
        dayPnLs.length > 0 ? Math.round((winningDays / dayPnLs.length) * 1000) / 10 : 0;
      const avgDailyPnL =
        dayPnLs.length > 0 ? Math.round((netPnL / dayPnLs.length) * 100) / 100 : 0;
      const avgLosingDay =
        losingDays.length > 0
          ? Math.round((losingDays.reduce((sum, p) => sum + p, 0) / losingDays.length) * 100) / 100
          : 0;
      const largestLosingDay = losingDays.length > 0 ? Math.min(...losingDays) : 0;

      const modeReviews = modeDays
        .map((d) => reviewMap.get(d.id))
        .filter((r): r is DailyReview => !!r);
      const avgDisciplineScore =
        modeReviews.length > 0
          ? Math.round(
              modeReviews.reduce((sum, r) => sum + r.disciplineScore, 0) / modeReviews.length
            )
          : 100;

      acc[mode] = {
        days: modeDays.length,
        trades: modeTrades.length,
        winningDayRate,
        netPnL,
        avgDailyPnL,
        avgLosingDay,
        largestLosingDay,
        avgDisciplineScore,
      };
      return acc;
    },
    {
      normal: {
        days: 0,
        trades: 0,
        winningDayRate: 0,
        netPnL: 0,
        avgDailyPnL: 0,
        avgLosingDay: 0,
        largestLosingDay: 0,
        avgDisciplineScore: 0,
      },
      expanded: {
        days: 0,
        trades: 0,
        winningDayRate: 0,
        netPnL: 0,
        avgDailyPnL: 0,
        avgLosingDay: 0,
        largestLosingDay: 0,
        avgDisciplineScore: 0,
      },
    }
  );

  return stats;
}

export function buildCumulativePnLSeries(
  trades: Trade[],
  tradingDays: TradingDay[]
): ChartCurvePoint[] {
  const closed = trades
    .filter((t) => t.status === 'closed')
    .sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  let cum = 0;
  return closed.map((t, idx) => {
    cum += t.grossPnL;
    return {
      index: idx + 1,
      date: t.entryTime.slice(0, 10),
      pnl: t.grossPnL,
      cumulativePnL: Math.round(cum * 100) / 100,
      label: `#${idx + 1} (${t.direction.toUpperCase()} ${t.contracts}x)`,
    };
  });
}
