import { describe, it, expect } from 'vitest';
import { calculateProfitFactor } from '../profit-factor';
import { calculateExpectancy } from '../expectancy';
import { calculateDisciplineScore } from '../discipline';
import { calculateCoreAnalytics, calculateSessionBreakdown } from '../aggregations';
import { Trade, TradingDay, DailyReview } from '../../../types';

describe('Analytics Calculations', () => {
  it('calculates profit factor correctly', () => {
    const trades = [
      { grossPnL: 150 },
      { grossPnL: 50 },
      { grossPnL: -100 },
    ];
    // 200 / 100 = 2.0
    expect(calculateProfitFactor(trades)).toBe(2.0);
  });

  it('handles zero losses in profit factor', () => {
    const trades = [{ grossPnL: 100 }];
    expect(calculateProfitFactor(trades)).toBe(Infinity);
  });

  it('calculates trade expectancy', () => {
    // 2 winners of $150, 1 loser of $100 -> win rate 66.7%, loss rate 33.3%
    // Expectancy = (2/3 * 150) - (1/3 * 100) = 100 - 33.33 = 66.67
    const trades = [
      { grossPnL: 150 },
      { grossPnL: 150 },
      { grossPnL: -100 },
    ];
    const expectancy = calculateExpectancy(trades);
    expect(expectancy).toBe(66.67);
  });

  it('calculates discipline score ignoring N/A questions and never factoring P&L', () => {
    // 9 total questions:
    // Suppose 6 answered with desired answer (followed), 2 violated, 1 is N/A
    // Applicable = 8, Followed = 6 -> 6/8 * 100 = 75%
    const scoreResult = calculateDisciplineScore({
      followedSetups: 'yes', // followed
      followedPredeterminedRisk: 'yes', // followed
      followedStops: 'yes', // followed
      chasedEntries: 'no', // followed (desired 'no')
      revengeTraded: 'yes', // violated (chose 'yes', wanted 'no')
      addedUnnecessaryRisk: 'no', // followed
      movedStopsEmotion: 'yes', // violated (chose 'yes', wanted 'no')
      letWinnersWork: 'yes', // followed
      stoppedWhenShould: 'na', // N/A (excluded)
    });

    expect(scoreResult.applicableRulesCount).toBe(8);
    expect(scoreResult.rulesFollowedCount).toBe(6);
    expect(scoreResult.score).toBe(75);
  });

  it('calculates 100% discipline score when all rules followed', () => {
    const scoreResult = calculateDisciplineScore({
      followedSetups: 'yes',
      followedPredeterminedRisk: 'yes',
      followedStops: 'yes',
      chasedEntries: 'no',
      revengeTraded: 'no',
      addedUnnecessaryRisk: 'no',
      movedStopsEmotion: 'no',
      letWinnersWork: 'yes',
      stoppedWhenShould: 'yes',
    });

    expect(scoreResult.score).toBe(100);
  });

  it('calculates session breakdown correctly', () => {
    const trades: Trade[] = [
      {
        id: 't1',
        userId: 'u1',
        tradingDayId: 'd1',
        instrumentId: 'mes',
        source: 'manual',
        direction: 'long',
        contracts: 1,
        entryPrice: 6700,
        initialStop: 6690,
        exitPrice: 6720,
        entryTime: '2026-09-17T09:30:00Z',
        session: 'Regular Session',
        grossPnL: 100,
        pointsPnL: 20,
        initialRisk: 50,
        rMultiple: 2,
        status: 'closed',
        createdAt: '2026-09-17T09:30:00Z',
        updatedAt: '2026-09-17T09:30:00Z',
      },
      {
        id: 't2',
        userId: 'u1',
        tradingDayId: 'd1',
        instrumentId: 'mes',
        source: 'manual',
        direction: 'short',
        contracts: 1,
        entryPrice: 6720,
        initialStop: 6730,
        exitPrice: 6725,
        entryTime: '2026-09-17T04:30:00Z',
        session: 'Premarket',
        grossPnL: -25,
        pointsPnL: -5,
        initialRisk: 50,
        rMultiple: -0.5,
        status: 'closed',
        createdAt: '2026-09-17T04:30:00Z',
        updatedAt: '2026-09-17T04:30:00Z',
      },
    ];

    const breakdown = calculateSessionBreakdown(trades);
    const regular = breakdown.find((b) => b.session === 'Regular Session');
    const premarket = breakdown.find((b) => b.session === 'Premarket');

    expect(regular?.tradesCount).toBe(1);
    expect(regular?.pnl).toBe(100);
    expect(regular?.winRate).toBe(100);

    expect(premarket?.tradesCount).toBe(1);
    expect(premarket?.pnl).toBe(-25);
    expect(premarket?.winRate).toBe(0);
  });

  it('aggregates daily trading statistics', () => {
    const trades: Trade[] = [
      {
        id: 't1',
        userId: 'u1',
        tradingDayId: 'd1',
        instrumentId: 'mes',
        source: 'manual',
        direction: 'long',
        contracts: 1,
        entryPrice: 6702.25,
        initialStop: 6692.25,
        exitPrice: 6732.25,
        entryTime: '2026-09-17T09:35:00Z',
        session: 'Regular Session',
        grossPnL: 150,
        pointsPnL: 30,
        initialRisk: 50,
        rMultiple: 3,
        status: 'closed',
        createdAt: '2026-09-17T09:35:00Z',
        updatedAt: '2026-09-17T09:35:00Z',
      },
    ];

    const days: TradingDay[] = [
      {
        id: 'd1',
        userId: 'u1',
        tradeDate: '2026-09-17',
        status: 'completed',
        riskMode: 'normal',
        normalLossLimit: 100,
        plannedLossLimit: 100,
        contractsPlanned: 1,
        primaryInstrument: 'MES',
        allowedSessions: ['Regular Session'],
        marketBias: 'neutral',
        watchedSetups: ['Engulfing'],
        importantLevels: [],
        waitingFor: 'Pullback to VWAP',
        stayOutIf: 'Choppy inside range',
        planChanges: [],
        createdAt: '2026-09-17T07:00:00Z',
        updatedAt: '2026-09-17T16:00:00Z',
      },
    ];

    const reviews: DailyReview[] = [
      {
        id: 'r1',
        userId: 'u1',
        tradingDayId: 'd1',
        questions: {
          followedSetups: 'yes',
          followedPredeterminedRisk: 'yes',
          followedStops: 'yes',
          chasedEntries: 'no',
          revengeTraded: 'no',
          addedUnnecessaryRisk: 'no',
          movedStopsEmotion: 'no',
          letWinnersWork: 'yes',
          stoppedWhenShould: 'yes',
        },
        disciplineScore: 100,
        scoringDetails: [],
        didWell: 'Followed plan',
        didPoorly: 'None',
        tomorrowFocus: 'Keep patience',
        createdAt: '2026-09-17T16:00:00Z',
        updatedAt: '2026-09-17T16:00:00Z',
      },
    ];

    const analytics = calculateCoreAnalytics(trades, days, reviews);
    expect(analytics.totalPnL).toBe(150);
    expect(analytics.tradeCount).toBe(1);
    expect(analytics.tradeWinRate).toBe(100);
    expect(analytics.winningDayRate).toBe(100);
    expect(analytics.avgDisciplineScore).toBe(100);
  });
});
