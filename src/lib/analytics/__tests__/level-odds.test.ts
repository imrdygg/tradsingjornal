import { describe, it, expect } from 'vitest';
import { LevelKind, LevelTimeframe, LevelTouch, MarkedLevel, TradingDay } from '../../../types';
import {
  mostReachedLine,
  summarizeLevelOdds,
  todayProjection,
  weekdayOfTradeDate,
} from '../level-odds';

function tradingDay(over: Partial<TradingDay> = {}): TradingDay {
  return {
    id: 'day-today',
    userId: 'u',
    tradeDate: '2026-09-28',
    status: 'active',
    riskMode: 'normal',
    normalLossLimit: 0,
    plannedLossLimit: 0,
    contractsPlanned: 1,
    primaryInstrument: 'MES',
    allowedSessions: ['Regular Session'],
    marketBias: 'neutral',
    watchedSetups: [],
    importantLevels: [],
    waitingFor: '',
    stayOutIf: '',
    planChanges: [],
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    ...over,
  };
}

function marked(over: Partial<MarkedLevel> = {}): MarkedLevel {
  return {
    id: 'l',
    userId: 'u',
    tradingDayId: 'd',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    kind: 'resistance',
    price: 100,
    zonePoints: 2,
    session: 'Regular Session',
    timeframe: '5m',
    createdAt: '2026-09-28T02:00:00Z',
    updatedAt: '2026-09-28T02:00:00Z',
    ...over,
  };
}

function touch(over: Partial<LevelTouch> = {}): LevelTouch {
  return {
    id: 't',
    userId: 'u',
    tradingDayId: 'd',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    kind: 'resistance',
    price: 100,
    zonePoints: 2,
    touchedAt: '2026-09-28T13:00:00Z',
    session: 'Regular Session',
    outcome: 'watching',
    checks: 1,
    createdAt: '2026-09-28T13:00:00Z',
    updatedAt: '2026-09-28T13:00:00Z',
    ...over,
  };
}

describe('summarizeLevelOdds — reach', () => {
  it('counts days marked and days reached per timeframe and side', () => {
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-29' }),
      marked({ id: 'c', tradeDate: '2026-09-30' }),
    ];
    const touches = [
      // Reached on two of the three marked days, decided one each way.
      touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28', outcome: 'never-returned' }),
      touch({ id: 't2', levelId: 'b', tradeDate: '2026-09-29', outcome: 'returned' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    const row = report.rows.find((r) => r.key === '5m|resistance');

    expect(report.daysMarked).toBe(3);
    expect(row?.daysMarked).toBe(3);
    expect(row?.daysReached).toBe(2);
    expect(row?.reachRate).toBeCloseTo(66.7, 1);
    expect(row?.enoughDays).toBe(true);
    expect(row?.marked).toBe(3);
    expect(row?.tested).toBe(2);
    expect(row?.stats.decided).toBe(2);
    expect(row?.stats.neverReturned).toBe(1);
    expect(row?.stats.holdRate).toBe(50);
  });

  it('withholds the "enough days" flag below the floor but still reports the count', () => {
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-29' }),
    ];
    const touches = [touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28' })];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    const row = report.rows.find((r) => r.key === '5m|resistance');
    expect(row?.daysMarked).toBe(2);
    expect(row?.daysReached).toBe(1);
    expect(row?.enoughDays).toBe(false);
  });

  it('splits by timeframe and side and orders the fullest reach first', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-28' }),
      marked({ id: 'b', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-29' }),
      marked({ id: 'c', timeframe: '30m', kind: 'support', tradeDate: '2026-09-28' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-28' }),
      touch({ id: 't2', levelId: 'b', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-29' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    expect(report.rows[0].key).toBe('5m|resistance');
    expect(report.rows[0].reachRate).toBe(100);
    const support = report.rows.find((r) => r.key === '30m|support');
    expect(support?.reachRate).toBe(0);
  });

  it('leaves out touches with no marked line behind them and levels with no timeframe', () => {
    const levels = [
      marked({ id: 'a', timeframe: undefined }),
      marked({ id: 'b', timeframe: '5m' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', outcome: 'never-returned' }),
      // No level behind it — the older record, excluded from this read.
      touch({ id: 't2', outcome: 'never-returned' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    expect(report.rows.map((r) => r.key)).toEqual(['5m|resistance']);
    expect(report.rows[0].tested).toBe(0);
  });

  it('ignores levels and touches for another instrument', () => {
    const levels = [marked({ id: 'a', instrumentId: 'mnq', timeframe: '5m' })];
    const touches = [touch({ id: 't1', levelId: 'a', instrumentId: 'mnq' })];
    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    expect(report.daysMarked).toBe(0);
    expect(report.rows).toHaveLength(0);
  });
});

describe('summarizeLevelOdds — when', () => {
  it('reads the busiest hour and weekday from the touch stamps in the trader timezone', () => {
    // 13:00Z is 09:00 on Monday 2026-09-28 in New York; 14:00Z is 10:00 on Tuesday 2026-09-29.
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-29' }),
      marked({ id: 'c', tradeDate: '2026-09-30' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28', touchedAt: '2026-09-28T13:00:00Z' }),
      touch({ id: 't2', levelId: 'b', tradeDate: '2026-09-29', touchedAt: '2026-09-29T14:00:00Z' }),
      // A second Monday touch at 09:30 local makes 09:00 the busiest hour and Monday the
      // busiest weekday.
      touch({ id: 't3', levelId: 'a', tradeDate: '2026-09-28', touchedAt: '2026-09-28T13:30:00Z' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    const row = report.rows.find((r) => r.key === '5m|resistance');
    expect(row?.hours[0]).toEqual({ hour: 9, count: 2 });
    expect(row?.weekdays[0].name).toBe('Mon');
    expect(row?.weekdays[0].count).toBe(2);
  });
});

describe('summarizeLevelOdds — sequence', () => {
  it('reports which other lines were reached on the days a line was reached', () => {
    const levels = [
      // The 5m resistance is reached on three days.
      marked({ id: 'a', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-28' }),
      marked({ id: 'b', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-29' }),
      marked({ id: 'c', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-30' }),
      // The 15m support is reached on two of those same days.
      marked({ id: 'd', timeframe: '15m', kind: 'support', tradeDate: '2026-09-28' }),
      marked({ id: 'e', timeframe: '15m', kind: 'support', tradeDate: '2026-09-29' }),
    ];
    const touches = [
      // The 5m resistance is reached first each day, the 15m support later.
      touch({ id: 't1', levelId: 'a', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-28', touchedAt: '2026-09-28T13:00:00Z' }),
      touch({ id: 't2', levelId: 'b', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-29', touchedAt: '2026-09-29T13:00:00Z' }),
      touch({ id: 't3', levelId: 'c', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-30', touchedAt: '2026-09-30T13:00:00Z' }),
      touch({ id: 't4', levelId: 'd', timeframe: '15m', kind: 'support', tradeDate: '2026-09-28', touchedAt: '2026-09-28T15:00:00Z' }),
      touch({ id: 't5', levelId: 'e', timeframe: '15m', kind: 'support', tradeDate: '2026-09-29', touchedAt: '2026-09-29T15:00:00Z' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    const seq = report.sequences.find((s) => s.key === '5m|resistance');
    expect(seq?.fromDays).toBe(3);
    const next = seq?.also.find((a) => a.key === '15m|support');
    expect(next?.days).toBe(2);
    expect(next?.rate).toBeCloseTo(66.7, 1);
  });

  it('counts only lines reached later, not ones already reached earlier', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-28' }),
      marked({ id: 'b', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-29' }),
      marked({ id: 'c', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-30' }),
      // The 1h support is reached *earlier* each day, so it is not a next step.
      marked({ id: 'd', timeframe: '1h', kind: 'support', tradeDate: '2026-09-28' }),
      marked({ id: 'e', timeframe: '1h', kind: 'support', tradeDate: '2026-09-29' }),
      marked({ id: 'f', timeframe: '1h', kind: 'support', tradeDate: '2026-09-30' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-28', touchedAt: '2026-09-28T13:00:00Z' }),
      touch({ id: 't2', levelId: 'b', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-29', touchedAt: '2026-09-29T13:00:00Z' }),
      touch({ id: 't3', levelId: 'c', timeframe: '5m', kind: 'resistance', tradeDate: '2026-09-30', touchedAt: '2026-09-30T13:00:00Z' }),
      touch({ id: 't4', levelId: 'd', timeframe: '1h', kind: 'support', tradeDate: '2026-09-28', touchedAt: '2026-09-28T11:00:00Z' }),
      touch({ id: 't5', levelId: 'e', timeframe: '1h', kind: 'support', tradeDate: '2026-09-29', touchedAt: '2026-09-29T11:00:00Z' }),
      touch({ id: 't6', levelId: 'f', timeframe: '1h', kind: 'support', tradeDate: '2026-09-30', touchedAt: '2026-09-30T11:00:00Z' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    // The earlier 1h line is never a "next step", so it appears in no sequence.
    expect(
      report.sequences.some((s) => s.also.some((a) => a.key === '1h|support'))
    ).toBe(false);
  });

  it('draws no sequence line until the reached sample is large enough', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', tradeDate: '2026-09-28' }),
      marked({ id: 'b', timeframe: '15m', tradeDate: '2026-09-28' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', timeframe: '5m', tradeDate: '2026-09-28' }),
      touch({ id: 't2', levelId: 'b', timeframe: '15m', tradeDate: '2026-09-28' }),
    ];
    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    expect(report.sequences).toHaveLength(0);
  });
});

describe('mostReachedLine', () => {
  it('prefers the highest rate among lines with enough marked days, over a one-day 100%', () => {
    const levels = [
      // The 5m support is reached on five of ten marked days (50%).
      ...Array.from({ length: 10 }, (_, i) =>
        marked({ id: `a${i}`, timeframe: '5m', kind: 'support', tradeDate: `2026-09-${10 + i}` })
      ),
      // The 1h resistance is reached on its only marked day (100%), but that is a tally.
      marked({ id: 'b', timeframe: '1h', kind: 'resistance', tradeDate: '2026-09-28' }),
    ];
    const touches = [
      ...[0, 1, 2, 3, 4].map((i) =>
        touch({ id: `t${i}`, levelId: `a${i}`, tradeDate: `2026-09-${10 + i}` })
      ),
      touch({ id: 'tb', levelId: 'b', timeframe: '1h', kind: 'resistance', tradeDate: '2026-09-28' }),
    ];

    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    expect(mostReachedLine(report.rows)?.key).toBe('5m|support');
  });

  it('falls back to the most-reached line when nothing clears the floor', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', tradeDate: '2026-09-28' }),
      marked({ id: 'b', timeframe: '15m', tradeDate: '2026-09-28' }),
    ];
    const touches = [touch({ id: 't1', levelId: 'a', timeframe: '5m', tradeDate: '2026-09-28' })];
    const report = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    const top = mostReachedLine(report.rows);
    expect(top?.key).toBe('5m|resistance');
    expect(top?.enoughDays).toBe(false);
  });

  it('returns null when no line has been reached', () => {
    const levels = [marked({ id: 'a', timeframe: '5m' })];
    const report = summarizeLevelOdds(levels, [], 'mes', 'America/New_York');
    expect(mostReachedLine(report.rows)).toBeNull();
  });
});

describe('summarizeLevelOdds — condition', () => {
  it('narrows to a weekday, both the denominator and the reaches', () => {
    // 2026-09-28 is a Monday, 2026-09-29 a Tuesday.
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-29' }),
    ];
    const touches = [touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28' })];

    const all = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York');
    expect(all.rows[0].daysMarked).toBe(2);
    expect(all.rows[0].daysReached).toBe(1);

    const mondays = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York', {
      weekday: weekdayOfTradeDate('2026-09-28'),
    });
    expect(mondays.rows[0].daysMarked).toBe(1);
    expect(mondays.rows[0].daysReached).toBe(1);
    expect(mondays.rows[0].reachRate).toBe(100);

    const tuesdays = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York', {
      weekday: weekdayOfTradeDate('2026-09-29'),
    });
    expect(tuesdays.rows[0].daysMarked).toBe(1);
    expect(tuesdays.rows[0].daysReached).toBe(0);
    expect(tuesdays.rows[0].reachRate).toBe(0);
  });

  it('narrows to a session on both the marked lines and the touches', () => {
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28', session: 'Overnight' }),
      marked({ id: 'b', tradeDate: '2026-09-29', session: 'Regular Session' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28', session: 'Overnight' }),
      touch({ id: 't2', levelId: 'b', tradeDate: '2026-09-29', session: 'Regular Session' }),
    ];

    const overnight = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York', {
      session: 'Overnight',
    });
    expect(overnight.rows).toHaveLength(1);
    expect(overnight.rows[0].daysMarked).toBe(1);
    expect(overnight.rows[0].daysReached).toBe(1);
  });

  it('narrows reaches to an hour without changing the days marked', () => {
    const levels = [
      marked({ id: 'a', tradeDate: '2026-09-28' }),
      marked({ id: 'b', tradeDate: '2026-09-29' }),
      marked({ id: 'c', tradeDate: '2026-09-30' }),
    ];
    const touches = [
      // 09:00, 11:00, 09:00 local (America/New_York, EDT).
      touch({ id: 't1', levelId: 'a', tradeDate: '2026-09-28', touchedAt: '2026-09-28T13:00:00Z' }),
      touch({ id: 't2', levelId: 'b', tradeDate: '2026-09-29', touchedAt: '2026-09-29T15:00:00Z' }),
      touch({ id: 't3', levelId: 'c', tradeDate: '2026-09-30', touchedAt: '2026-09-30T13:00:00Z' }),
    ];

    const nine = summarizeLevelOdds(levels, touches, 'mes', 'America/New_York', { hour: 9 });
    // Three days marked, but only the two 09:00 reaches count.
    expect(nine.rows[0].daysMarked).toBe(3);
    expect(nine.rows[0].daysReached).toBe(2);
    expect(nine.rows[0].stats.touches).toBe(2);
    expect(nine.rows[0].hours[0].hour).toBe(9);
  });
});

describe('todayProjection', () => {
  it('reads today\'s marked lines against the same weekday in the record', () => {
    const day = tradingDay({ tradeDate: '2026-09-28' }); // Monday
    const levels = [
      // Today's line, and two earlier Mondays of the same line.
      marked({ id: 'today', tradingDayId: day.id, tradeDate: '2026-09-28', timeframe: '5m' }),
      marked({ id: 'p1', tradingDayId: 'd1', tradeDate: '2026-09-21', timeframe: '5m' }),
      marked({ id: 'p2', tradingDayId: 'd2', tradeDate: '2026-09-14', timeframe: '5m' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'p1', tradeDate: '2026-09-21' }),
      touch({ id: 't2', levelId: 'p2', tradeDate: '2026-09-14' }),
    ];

    const projection = todayProjection(levels, touches, day, 'mes', 'America/New_York');
    expect(projection.weekdayName).toBe('Mon');
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0].key).toBe('5m|resistance');
    // Three Mondays marked (including today), two reached.
    expect(projection.rows[0].daysMarked).toBe(3);
    expect(projection.rows[0].daysReached).toBe(2);
  });

  it('is empty when nothing has been marked for today', () => {
    const day = tradingDay({ id: 'day-other', tradeDate: '2026-09-28' });
    const projection = todayProjection(
      [marked({ id: 'a', tradingDayId: 'd1', tradeDate: '2026-09-21' })],
      [],
      day,
      'mes',
      'America/New_York'
    );
    expect(projection.rows).toHaveLength(0);
  });
});

describe('summarizeLevelOdds — typing', () => {
  it('exports keys that round-trip a timeframe and kind', () => {
    const frames: LevelTimeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h'];
    const kinds: LevelKind[] = ['support', 'resistance'];
    for (const frame of frames) {
      for (const kind of kinds) {
        const report = summarizeLevelOdds(
          [marked({ id: 'a', timeframe: frame, kind })],
          [],
          'mes',
          'America/New_York'
        );
        expect(report.rows[0].timeframe).toBe(frame);
        expect(report.rows[0].kind).toBe(kind);
      }
    }
  });
});
