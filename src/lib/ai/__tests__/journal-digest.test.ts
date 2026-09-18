import { describe, it, expect } from 'vitest';
import { DailyReview, DailyReviewQuestions, Setup, Trade, TradingDay } from '../../../types';
import { buildJournalDigest } from '../journal-digest';
import { DEFAULT_INSTRUMENTS } from '../../trading/instruments';

const ALL_YES: DailyReviewQuestions = {
  followedSetups: 'yes',
  followedPredeterminedRisk: 'yes',
  followedStops: 'yes',
  chasedEntries: 'no',
  revengeTraded: 'no',
  addedUnnecessaryRisk: 'no',
  movedStopsEmotion: 'no',
  letWinnersWork: 'yes',
  stoppedWhenShould: 'yes',
};

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    userId: 'u1',
    tradingDayId: 'd1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 5000,
    initialStop: 4990,
    exitPrice: 5010,
    entryTime: '2026-09-18T13:30:00.000Z',
    exitTime: '2026-09-18T14:00:00.000Z',
    session: 'Regular Session',
    setupName: 'Breakout',
    initialRisk: 50,
    grossPnL: 50,
    netPnL: 45,
    pointsPnL: 10,
    rMultiple: 1,
    status: 'closed',
    createdAt: '2026-09-18T13:30:00.000Z',
    updatedAt: '2026-09-18T14:00:00.000Z',
    ...overrides,
  };
}

function makeDay(overrides: Partial<TradingDay> = {}): TradingDay {
  return {
    id: 'd1',
    userId: 'u1',
    tradeDate: '2026-09-18',
    status: 'active',
    riskMode: 'normal',
    normalLossLimit: 100,
    plannedLossLimit: 100,
    contractsPlanned: 2,
    primaryInstrument: 'MES',
    allowedSessions: ['Regular Session'],
    marketBias: 'bullish',
    watchedSetups: ['Breakout'],
    importantLevels: [],
    waitingFor: 'Retest of the open',
    stayOutIf: 'Chop inside the prior range',
    planChanges: [],
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<DailyReview> = {}): DailyReview {
  return {
    id: 'r1',
    userId: 'u1',
    tradingDayId: 'd1',
    questions: ALL_YES,
    disciplineScore: 100,
    scoringDetails: [],
    didWell: 'Waited for the retest.',
    didPoorly: 'Sized up after a win.',
    tomorrowFocus: 'Hold the planned size.',
    createdAt: '2026-09-18T20:00:00.000Z',
    updatedAt: '2026-09-18T20:00:00.000Z',
    ...overrides,
  };
}

const build = (input: Partial<Parameters<typeof buildJournalDigest>[0]> = {}) =>
  buildJournalDigest({
    trades: [],
    tradingDays: [],
    reviews: [],
    setups: [],
    instruments: DEFAULT_INSTRUMENTS,
    todayTradeDate: '2026-09-18',
    ...input,
  });

describe('buildJournalDigest', () => {
  it('summarises closed-trade performance from net P&L and R', () => {
    const digest = build({
      trades: [
        makeTrade({ id: 'a', netPnL: 100, rMultiple: 2, exitTime: '2026-09-18T14:00:00.000Z' }),
        makeTrade({ id: 'b', netPnL: -50, rMultiple: -1, exitTime: '2026-09-18T15:00:00.000Z' }),
      ],
    });

    expect(digest.overall.netPnL).toBe(50);
    expect(digest.overall.totalR).toBe(1);
    expect(digest.overall.avgR).toBe(0.5);
    expect(digest.overall.wins).toBe(1);
    expect(digest.overall.losses).toBe(1);
    expect(digest.overall.winRate).toBe(50);
  });

  it('falls back to gross P&L when net is not recorded', () => {
    const digest = build({ trades: [makeTrade({ netPnL: undefined, grossPnL: 77 })] });
    expect(digest.overall.netPnL).toBe(77);
  });

  it('separates open trades from closed ones and counts them', () => {
    const digest = build({
      trades: [
        makeTrade({ id: 'a' }),
        makeTrade({ id: 'b', status: 'open', exitPrice: undefined, exitTime: undefined }),
      ],
    });

    expect(digest.dataSufficiency.closedTrades).toBe(1);
    expect(digest.dataSufficiency.openTrades).toBe(1);
    expect(digest.overall.netPnL).toBe(45);
  });

  it('withholds instrument and setup groups below a two-trade sample', () => {
    const digest = build({
      trades: [
        makeTrade({ id: 'a', instrumentId: 'mes', setupName: 'Breakout' }),
        makeTrade({ id: 'b', instrumentId: 'mes', setupName: 'Fade' }),
        makeTrade({ id: 'c', instrumentId: 'mnq', setupName: 'Breakout' }),
      ],
    });

    expect(digest.byInstrument.map((g) => g.label)).toEqual(['MES']);
    expect(digest.byInstrument[0].trades).toBe(2);
    expect(digest.bySetup.map((g) => g.label)).toEqual(['Breakout']);
  });

  it('names the instrument from the trade, never a hard-coded MES', () => {
    const digest = build({
      trades: [
        makeTrade({ id: 'a', instrumentId: 'mnq' }),
        makeTrade({ id: 'b', instrumentId: 'mnq' }),
      ],
    });

    expect(digest.byInstrument.map((g) => g.label)).toEqual(['MNQ']);
  });

  it('tallies which daily rules were broken and averages the scores', () => {
    const digest = build({
      trades: [makeTrade({ id: 'a', netPnL: 100 })],
      tradingDays: [makeDay()],
      reviews: [
        makeReview({
          disciplineScore: 60,
          questions: { ...ALL_YES, followedStops: 'no', chasedEntries: 'yes' },
        }),
      ],
    });

    expect(digest.discipline.avgScore).toBe(60);
    expect(digest.discipline.failedRules).toEqual(
      expect.arrayContaining([
        { rule: 'Followed initial stops?', times: 1 },
        { rule: 'Chased entries?', times: 1 },
      ])
    );
  });

  it('ignores N/A answers rather than counting them as failures', () => {
    const digest = build({
      trades: [makeTrade({ id: 'a', netPnL: 100 })],
      tradingDays: [makeDay()],
      reviews: [
        makeReview({
          disciplineScore: 100,
          questions: { ...ALL_YES, followedStops: 'na', movedStopsEmotion: 'na' },
        }),
      ],
    });

    expect(digest.discipline.failedRules).toEqual([]);
  });

  it('compares day P&L on well-executed days against poorly executed ones', () => {
    const digest = build({
      trades: [
        makeTrade({ id: 'a', tradingDayId: 'good', netPnL: 200 }),
        makeTrade({ id: 'b', tradingDayId: 'bad', netPnL: -120 }),
      ],
      tradingDays: [
        makeDay({ id: 'good', tradeDate: '2026-09-17' }),
        makeDay({ id: 'bad', tradeDate: '2026-09-18' }),
      ],
      reviews: [
        makeReview({ id: 'r-good', tradingDayId: 'good', disciplineScore: 90 }),
        makeReview({ id: 'r-bad', tradingDayId: 'bad', disciplineScore: 40 }),
      ],
      todayTradeDate: '2026-09-18',
    });

    expect(digest.discipline.highDisciplineAvgPnL).toBe(200);
    expect(digest.discipline.lowDisciplineAvgPnL).toBe(-120);
  });

  describe('plan adherence', () => {
    it('flags trades outside the planned sessions', () => {
      const digest = build({
        trades: [makeTrade({ session: 'Overnight' })],
        tradingDays: [makeDay({ allowedSessions: ['Regular Session'] })],
      });

      expect(digest.planAdherence.tradesOutsideAllowedSessions).toBe(1);
      expect(digest.planAdherence.sessionsTradedOutsidePlan).toEqual(['Overnight']);
    });

    it('flags a setup that was not on the watch list', () => {
      const digest = build({
        trades: [makeTrade({ setupName: 'Fade' })],
        tradingDays: [makeDay({ watchedSetups: ['Breakout'] })],
      });

      expect(digest.planAdherence.tradesOnUnplannedSetup).toBe(1);
      expect(digest.planAdherence.unplannedSetupsTraded).toEqual(['Fade']);
    });

    it('matches a planned setup given as a setup id', () => {
      const setups: Setup[] = [
        { id: 'setup-1', name: 'Breakout', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
      ];
      const digest = build({
        trades: [makeTrade({ setupId: 'setup-1', setupName: undefined })],
        setups,
        tradingDays: [makeDay({ watchedSetups: ['setup-1'] })],
      });

      expect(digest.planAdherence.tradesOnUnplannedSetup).toBe(0);
    });

    it('does not flag setups when the day listed none', () => {
      const digest = build({
        trades: [makeTrade({ setupName: 'Anything' })],
        tradingDays: [makeDay({ watchedSetups: [] })],
      });

      expect(digest.planAdherence.tradesOnUnplannedSetup).toBe(0);
    });

    it('flags trading an instrument other than the planned one', () => {
      const digest = build({
        trades: [makeTrade({ instrumentId: 'mnq' })],
        tradingDays: [makeDay({ primaryInstrument: 'MES' })],
      });

      expect(digest.planAdherence.tradesOnNonPrimaryInstrument).toBe(1);
    });

    it('flags a day that lost more than the planned loss limit, and how much', () => {
      const digest = build({
        trades: [makeTrade({ netPnL: -150 })],
        tradingDays: [makeDay({ plannedLossLimit: 100 })],
      });

      expect(digest.planAdherence.daysExceededLossLimit).toBe(1);
      expect(digest.planAdherence.worstOvershoot).toBe(50);
    });

    it('does not flag a day that stayed inside the loss limit', () => {
      const digest = build({
        trades: [makeTrade({ netPnL: -80 })],
        tradingDays: [makeDay({ plannedLossLimit: 100 })],
      });

      expect(digest.planAdherence.daysExceededLossLimit).toBe(0);
      expect(digest.planAdherence.worstOvershoot).toBe(0);
    });

    it('counts edits made to a locked plan and keeps examples', () => {
      const digest = build({
        tradingDays: [
          makeDay({
            tradeDate: '2026-09-17',
            planChanges: [
              {
                id: 'c1',
                tradingDayId: 'd1',
                fieldName: 'Planned loss limit',
                oldValue: '100',
                newValue: '200',
                reason: 'felt good',
                changedAt: '2026-09-17T15:00:00.000Z',
              },
            ],
          }),
        ],
      });

      expect(digest.planAdherence.lockedPlanEdits).toBe(1);
      expect(digest.planAdherence.lockedPlanEditExamples[0]).toContain('felt good');
    });
  });

  describe('streaks', () => {
    it('counts consecutive losing days from the most recent session backwards', () => {
      const digest = build({
        trades: [
          makeTrade({ id: 'a', tradingDayId: 'd3', netPnL: -30 }),
          makeTrade({ id: 'b', tradingDayId: 'd2', netPnL: -20 }),
          makeTrade({ id: 'c', tradingDayId: 'd1', netPnL: 500 }),
        ],
        tradingDays: [
          makeDay({ id: 'd1', tradeDate: '2026-09-16' }),
          makeDay({ id: 'd2', tradeDate: '2026-09-17' }),
          makeDay({ id: 'd3', tradeDate: '2026-09-18' }),
        ],
        todayTradeDate: '2026-09-18',
      });

      expect(digest.streaks.consecutiveLosingDays).toBe(2);
      expect(digest.streaks.losingStreakPnL).toBe(-50);
    });

    it('stops the losing streak at the first break-even or winning day', () => {
      const digest = build({
        trades: [
          makeTrade({ id: 'a', tradingDayId: 'd3', netPnL: -30 }),
          makeTrade({ id: 'b', tradingDayId: 'd2', netPnL: 10 }),
          makeTrade({ id: 'c', tradingDayId: 'd1', netPnL: -99 }),
        ],
        tradingDays: [
          makeDay({ id: 'd1', tradeDate: '2026-09-16' }),
          makeDay({ id: 'd2', tradeDate: '2026-09-17' }),
          makeDay({ id: 'd3', tradeDate: '2026-09-18' }),
        ],
        todayTradeDate: '2026-09-18',
      });

      expect(digest.streaks.consecutiveLosingDays).toBe(1);
    });
  });

  describe('thin evidence', () => {
    it('warns when nothing has been closed', () => {
      const digest = build();
      expect(digest.dataSufficiency.hasEnoughForPatterns).toBe(false);
      expect(digest.dataSufficiency.caveats.join(' ')).toContain('No closed trades');
    });

    it('warns about missing reviews in both places they matter', () => {
      const digest = build({ trades: [makeTrade()] });
      const caveats = digest.dataSufficiency.caveats.join(' ');
      expect(caveats).toContain('No end-of-day reviews');
      expect(caveats).toContain('No trade execution reviews');
    });

    it('warns that imported trades may carry placeholder risk and R', () => {
      const digest = build({
        trades: [makeTrade({ source: 'tradovate_csv' })],
      });

      expect(digest.dataSufficiency.caveats.join(' ')).toContain('broker CSV');
    });

    it('warns when risk mode was expanded on any day', () => {
      const digest = build({
        tradingDays: [makeDay({ riskMode: 'expanded', plannedLossLimit: 200 })],
      });

      expect(digest.dataSufficiency.caveats.join(' ')).toContain('expanded');
    });

    it('says patterns are supported once there is enough data and no thin caveats', () => {
      const trades = Array.from({ length: 10 }, (_, i) =>
        makeTrade({
          id: `t${i}`,
          tradingDayId: `d${i}`,
          netPnL: 10,
          rMultiple: 0.5,
          executionReview: {
            id: `er${i}`,
            tradeId: `t${i}`,
            followedSetup: 'yes',
            followedStop: 'yes',
            chasedEntry: 'no',
            revengeTrade: 'no',
            addedUnnecessaryRisk: 'no',
            movedStopEmotion: 'no',
            letWinnerWork: 'yes',
            wouldTakeAgain: 'yes',
          },
        })
      );
      const days = Array.from({ length: 10 }, (_, i) =>
        makeDay({ id: `d${i}`, tradeDate: `2026-09-${String(i + 1).padStart(2, '0')}` })
      );
      const reviews = days.map((day, i) =>
        makeReview({ id: `r${i}`, tradingDayId: day.id, disciplineScore: 100 })
      );

      const digest = build({ trades, tradingDays: days, reviews });

      expect(digest.dataSufficiency.hasEnoughForPatterns).toBe(true);
      expect(digest.dataSufficiency.caveats).toEqual([]);
    });
  });

  it("keeps the trader's own words, newest first, and trims them", () => {
    const longNote = 'x'.repeat(400);
    const digest = build({
      trades: [
        makeTrade({
          id: 'old',
          entryReason: 'older reason',
          exitTime: '2026-09-18T14:00:00.000Z',
        }),
        makeTrade({
          id: 'new',
          entryReason: 'newer reason',
          notes: longNote,
          exitTime: '2026-09-18T16:00:00.000Z',
        }),
      ],
    });

    expect(digest.traderOwnWords.entryReasons[0]).toBe('newer reason');
    expect(digest.traderOwnWords.entryReasons[1]).toBe('older reason');
    expect(digest.traderOwnWords.tradeNotes[0].length).toBeLessThan(longNote.length);
    expect(digest.traderOwnWords.tradeNotes[0].endsWith('…')).toBe(true);
  });

  it('collapses whitespace in free text so the prompt stays readable', () => {
    const digest = build({
      trades: [makeTrade({ notes: '  spaced\n\nout   badly  ' })],
    });

    expect(digest.traderOwnWords.tradeNotes[0]).toBe('spaced out badly');
  });

  it("reports today's plan and today's result separately from history", () => {
    const digest = build({
      trades: [makeTrade({ tradingDayId: 'today', netPnL: 25 })],
      tradingDays: [makeDay({ id: 'today', tradeDate: '2026-09-18', lockedAt: '2026-09-18T13:00:00.000Z' })],
      todayTradeDate: '2026-09-18',
    });

    expect(digest.today.hasPlan).toBe(true);
    expect(digest.today.locked).toBe(true);
    expect(digest.today.tradesTaken).toBe(1);
    expect(digest.today.netPnL).toBe(25);
    expect(digest.planAdherence.daysWithPlan).toBe(1);
  });

  it('handles a completely empty journal without producing NaN', () => {
    const digest = build();
    const numbers = JSON.stringify(digest).match(/-?\d+\.?\d*/g) ?? [];
    expect(numbers.some((n) => n === 'NaN' || n === 'Infinity')).toBe(false);
    expect(digest.today.hasPlan).toBe(false);
    expect(digest.recentDays).toEqual([]);
  });

  it('survives a trade whose day is missing from the journal', () => {
    const digest = build({
      trades: [makeTrade({ tradingDayId: 'missing-day', netPnL: 10 })],
    });

    expect(digest.overall.netPnL).toBe(10);
    expect(digest.planAdherence.tradesOutsideAllowedSessions).toBe(0);
  });
});
