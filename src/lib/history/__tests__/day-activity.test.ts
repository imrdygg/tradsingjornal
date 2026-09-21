import { describe, it, expect } from 'vitest';
import { dayHasRecordedActivity } from '../day-activity';
import type { DailyReview, TradingDay } from '../../../types';

/**
 * The archive rule.
 *
 * The case that matters most is the first one: a day exactly as the journal creates it
 * when the app is opened, which must NOT appear in History. Everything else here is a
 * single act the trader took, which must.
 */

/** A day exactly as `storage.getOrCreateToday()` builds one, defaults and all. */
function freshDay(overrides: Partial<TradingDay> = {}): TradingDay {
  return {
    id: 'day-2026-09-20',
    userId: 'u1',
    tradeDate: '2026-09-20',
    status: 'planning',
    riskMode: 'normal',
    normalLossLimit: 100,
    plannedLossLimit: 100,
    contractsPlanned: 1,
    primaryInstrument: 'MES',
    allowedSessions: ['Regular Session'],
    marketBias: 'neutral',
    watchedSetups: ['Engulfing', 'Support', 'Resistance'],
    defaultRiskTier: 1,
    importantLevels: [],
    waitingFor: '',
    stayOutIf: '',
    notes: '',
    planChanges: [],
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
  };
}

const review: DailyReview = {
  id: 'r1',
  userId: 'u1',
  tradingDayId: 'day-2026-09-20',
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
  didWell: 'Waited.',
  didPoorly: 'None.',
  tomorrowFocus: 'Same again.',
  createdAt: '2026-09-20T20:00:00.000Z',
  updatedAt: '2026-09-20T20:00:00.000Z',
};

describe('dayHasRecordedActivity', () => {
  it('leaves out an untouched day the app created just by being opened', () => {
    // This is the card the trader complained about: a date with nothing on it that still
    // listed as "$0.00 · 0 trades · Bias: neutral".
    expect(dayHasRecordedActivity(freshDay(), { tradeCount: 0 })).toBe(false);
  });

  it('does not treat the plan defaults it was given as activity', () => {
    // The three default set-ups and the one planned contract are not choices, so a day
    // carrying only those must stay out of the archive.
    const day = freshDay({ watchedSetups: ['Engulfing', 'Support', 'Resistance'], contractsPlanned: 1 });
    expect(dayHasRecordedActivity(day, { tradeCount: 0 })).toBe(false);
  });

  it('keeps a day with a trade on it, open or closed', () => {
    expect(dayHasRecordedActivity(freshDay(), { tradeCount: 1 })).toBe(true);
    expect(dayHasRecordedActivity(freshDay({ status: 'active' }), { tradeCount: 3 })).toBe(true);
  });

  it('keeps a day with an end-of-day review', () => {
    expect(dayHasRecordedActivity(freshDay(), { tradeCount: 0, review })).toBe(true);
  });

  it('keeps a locked plan, even with nothing else on the day', () => {
    expect(
      dayHasRecordedActivity(freshDay({ lockedAt: '2026-09-20T13:30:00.000Z' }), { tradeCount: 0 })
    ).toBe(true);
  });

  it('keeps a recorded plan change', () => {
    expect(
      dayHasRecordedActivity(
        freshDay({
          planChanges: [
            {
              id: 'c1',
              tradingDayId: 'day-2026-09-20',
              fieldName: 'Planned Loss Limit',
              oldValue: '100',
              newValue: '150',
              reason: 'Earned cushion',
              changedAt: '2026-09-20T14:00:00.000Z',
            },
          ],
        }),
        { tradeCount: 0 }
      )
    ).toBe(true);
  });

  it('keeps a day the trader wrote plan text on', () => {
    expect(dayHasRecordedActivity(freshDay({ waitingFor: 'Retest of the open' }), { tradeCount: 0 })).toBe(true);
    expect(dayHasRecordedActivity(freshDay({ stayOutIf: 'No chop' }), { tradeCount: 0 })).toBe(true);
    expect(dayHasRecordedActivity(freshDay({ notes: 'CPI at 8:30' }), { tradeCount: 0 })).toBe(true);
  });

  it('keeps a day with levels marked on it', () => {
    expect(
      dayHasRecordedActivity(
        freshDay({ importantLevels: [{ id: 'l1', tradingDayId: 'day-2026-09-20', price: 7744 }] }),
        { tradeCount: 0 }
      )
    ).toBe(true);
  });

  it('keeps a bias the trader picked, but not the default one', () => {
    expect(dayHasRecordedActivity(freshDay({ marketBias: 'bullish' }), { tradeCount: 0 })).toBe(true);
    expect(dayHasRecordedActivity(freshDay({ marketBias: 'unsure' }), { tradeCount: 0 })).toBe(true);
    expect(dayHasRecordedActivity(freshDay({ marketBias: 'neutral' }), { tradeCount: 0 })).toBe(false);
  });

  it('keeps a day that was ended, or whose risk was deliberately widened', () => {
    expect(dayHasRecordedActivity(freshDay({ endedAt: '2026-09-20T21:00:00.000Z' }), { tradeCount: 0 })).toBe(true);
    expect(
      dayHasRecordedActivity(freshDay({ riskIncreaseReason: 'High-conviction A+ setup' }), { tradeCount: 0 })
    ).toBe(true);
  });

  it('ignores whitespace-only text rather than counting it as written', () => {
    expect(
      dayHasRecordedActivity(freshDay({ waitingFor: '   ', notes: '\n' }), { tradeCount: 0 })
    ).toBe(false);
  });
});
