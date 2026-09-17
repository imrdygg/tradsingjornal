import { Trade, TradingDay } from '../../types';
import { calculateSessionBreakdown, calculateSetupBreakdown, calculateRiskModeComparison } from './aggregations';

export type SampleSizeCategory =
  | 'Very limited data'
  | 'Early observation'
  | 'Developing sample'
  | 'More meaningful history';

export function getSampleSizeLabel(count: number): {
  label: SampleSizeCategory;
  variant: 'warning' | 'info' | 'primary' | 'success';
} {
  if (count < 10) {
    return { label: 'Very limited data', variant: 'warning' };
  }
  if (count <= 19) {
    return { label: 'Early observation', variant: 'info' };
  }
  if (count <= 49) {
    return { label: 'Developing sample', variant: 'primary' };
  }
  return { label: 'More meaningful history', variant: 'success' };
}

export interface DeterministicInsight {
  id: string;
  category: 'Session' | 'Setup' | 'Risk Mode' | 'Direction' | 'Discipline';
  title: string;
  statement: string;
  sampleSize: number;
  sampleLabel: SampleSizeCategory;
  sampleVariant: 'warning' | 'info' | 'primary' | 'success';
  metricHighlight: string;
  isPositive: boolean | null;
}

/**
 * Computes deterministic data-grounded insights strictly from actual recorded trades and plans.
 * Never predicts markets, never generates buy/sell advice.
 */
export function generateDeterministicInsights(
  trades: Trade[],
  tradingDays: TradingDay[]
): DeterministicInsight[] {
  const closed = trades.filter((t) => t.status === 'closed');
  const insights: DeterministicInsight[] = [];

  // 1. Session Insights
  const sessionBreakdowns = calculateSessionBreakdown(closed);
  for (const s of sessionBreakdowns) {
    if (s.tradesCount > 0) {
      const sample = getSampleSizeLabel(s.tradesCount);
      const sign = s.pnl >= 0 ? '+' : '';
      insights.push({
        id: `session-${s.session}`,
        category: 'Session',
        title: `${s.session} Performance`,
        statement: `${s.session} trades generated ${sign}$${s.pnl.toFixed(2)} across ${s.tradesCount} trades in this period (Win Rate: ${s.winRate}%).`,
        sampleSize: s.tradesCount,
        sampleLabel: sample.label,
        sampleVariant: sample.variant,
        metricHighlight: `${sign}$${s.pnl.toFixed(2)}`,
        isPositive: s.pnl > 0 ? true : s.pnl < 0 ? false : null,
      });
    }
  }

  // 2. Setup Insights
  const setupBreakdowns = calculateSetupBreakdown(closed);
  for (const setup of setupBreakdowns) {
    if (setup.tradesCount > 0) {
      const sample = getSampleSizeLabel(setup.tradesCount);
      const sign = setup.pnl >= 0 ? '+' : '';
      insights.push({
        id: `setup-${setup.setupName}`,
        category: 'Setup',
        title: `${setup.setupName} Setup`,
        statement: `${setup.setupName} trades had ${setup.winRate}% win rate across ${setup.tradesCount} completed trades (${sign}$${setup.pnl.toFixed(2)}, avg R: ${setup.avgR}R).`,
        sampleSize: setup.tradesCount,
        sampleLabel: sample.label,
        sampleVariant: sample.variant,
        metricHighlight: `${setup.winRate}% Win`,
        isPositive: setup.pnl > 0 ? true : setup.pnl < 0 ? false : null,
      });
    }
  }

  // 3. Risk Mode Insights
  const riskComparison = calculateRiskModeComparison(closed, tradingDays, []);
  if (riskComparison.expanded.days > 0) {
    const sample = getSampleSizeLabel(riskComparison.expanded.trades);
    const sign = riskComparison.expanded.netPnL >= 0 ? '+' : '';
    insights.push({
      id: 'risk-mode-expanded',
      category: 'Risk Mode',
      title: 'Expanded Risk Days',
      statement: `Expanded Risk was used on ${riskComparison.expanded.days} days (${riskComparison.expanded.trades} trades) with average daily result of $${riskComparison.expanded.avgDailyPnL.toFixed(2)} and total ${sign}$${riskComparison.expanded.netPnL.toFixed(2)}.`,
      sampleSize: riskComparison.expanded.trades,
      sampleLabel: sample.label,
      sampleVariant: sample.variant,
      metricHighlight: `Avg $${riskComparison.expanded.avgDailyPnL.toFixed(2)}/day`,
      isPositive: riskComparison.expanded.netPnL > 0 ? true : riskComparison.expanded.netPnL < 0 ? false : null,
    });
  }

  if (riskComparison.normal.days > 0) {
    const sample = getSampleSizeLabel(riskComparison.normal.trades);
    const sign = riskComparison.normal.netPnL >= 0 ? '+' : '';
    insights.push({
      id: 'risk-mode-normal',
      category: 'Risk Mode',
      title: 'Normal Risk Days',
      statement: `Normal Risk was used on ${riskComparison.normal.days} days (${riskComparison.normal.trades} trades) with average daily result of $${riskComparison.normal.avgDailyPnL.toFixed(2)} and total ${sign}$${riskComparison.normal.netPnL.toFixed(2)}.`,
      sampleSize: riskComparison.normal.trades,
      sampleLabel: sample.label,
      sampleVariant: sample.variant,
      metricHighlight: `Avg $${riskComparison.normal.avgDailyPnL.toFixed(2)}/day`,
      isPositive: riskComparison.normal.netPnL > 0 ? true : riskComparison.normal.netPnL < 0 ? false : null,
    });
  }

  // 4. Direction Insights
  const longs = closed.filter((t) => t.direction === 'long');
  const shorts = closed.filter((t) => t.direction === 'short');

  if (longs.length > 0) {
    const sample = getSampleSizeLabel(longs.length);
    const longPnL = Math.round(longs.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;
    const longWins = longs.filter((t) => t.grossPnL > 0).length;
    const winRate = Math.round((longWins / longs.length) * 1000) / 10;
    const sign = longPnL >= 0 ? '+' : '';
    insights.push({
      id: 'direction-long',
      category: 'Direction',
      title: 'Long Side Performance',
      statement: `Long trades produced ${sign}$${longPnL.toFixed(2)} across ${longs.length} executions with a ${winRate}% win rate.`,
      sampleSize: longs.length,
      sampleLabel: sample.label,
      sampleVariant: sample.variant,
      metricHighlight: `${sign}$${longPnL.toFixed(2)}`,
      isPositive: longPnL > 0 ? true : longPnL < 0 ? false : null,
    });
  }

  if (shorts.length > 0) {
    const sample = getSampleSizeLabel(shorts.length);
    const shortPnL = Math.round(shorts.reduce((sum, t) => sum + t.grossPnL, 0) * 100) / 100;
    const shortWins = shorts.filter((t) => t.grossPnL > 0).length;
    const winRate = Math.round((shortWins / shorts.length) * 1000) / 10;
    const sign = shortPnL >= 0 ? '+' : '';
    insights.push({
      id: 'direction-short',
      category: 'Direction',
      title: 'Short Side Performance',
      statement: `Short trades produced ${sign}$${shortPnL.toFixed(2)} across ${shorts.length} executions with a ${winRate}% win rate.`,
      sampleSize: shorts.length,
      sampleLabel: sample.label,
      sampleVariant: sample.variant,
      metricHighlight: `${sign}$${shortPnL.toFixed(2)}`,
      isPositive: shortPnL > 0 ? true : shortPnL < 0 ? false : null,
    });
  }

  return insights;
}
