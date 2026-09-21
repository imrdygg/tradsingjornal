import { describe, it, expect } from 'vitest';
import { Trade, TradingDay } from '../../../types';
import {
  AFTER_LOSS_WINDOW_MINUTES,
  MIN_BUCKET_TRADES,
  analyzeActivity,
  analyzeAfterLoss,
  analyzeBehavior,
  analyzeHoldTime,
  analyzeSizeDiscipline,
  analyzeTimeOfDay,
  localHourOf,
  summarize,
  timestampMs,
} from '../behavior';

const TZ = 'America/New_York';

let seq = 0;

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  seq += 1;
  return {
    id: `t${seq}`,
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
    marketBias: 'neutral',
    watchedSetups: [],
    importantLevels: [],
    waitingFor: '',
    stayOutIf: '',
    planChanges: [],
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('timestampMs', () => {
  it('reads ISO timestamps and space-separated broker timestamps alike', () => {
    expect(timestampMs('2026-09-18T13:30:00.000Z')).toBe(Date.parse('2026-09-18T13:30:00.000Z'));
    expect(timestampMs('2026-09-18 13:30:00')).toBe(Date.parse('2026-09-18T13:30:00'));
  });

  it('returns null rather than NaN for anything unreadable', () => {
    expect(timestampMs(undefined)).toBeNull();
    expect(timestampMs('')).toBeNull();
    expect(timestampMs('   ')).toBeNull();
    expect(timestampMs('not a time')).toBeNull();
  });
});

describe('localHourOf', () => {
  it('converts a zoned timestamp into the trader timezone', () => {
    // 13:30 UTC is 09:30 in New York during daylight saving.
    expect(localHourOf('2026-09-18T13:30:00.000Z', TZ)).toBe(9);
    expect(localHourOf('2026-09-18T13:30:00.000Z', 'UTC')).toBe(13);
  });

  it('reads a zone-less browser timestamp at face value instead of shifting it', () => {
    // A broker export writes wall-clock time. Converting it would invent a pattern.
    expect(localHourOf('2026-09-18 13:30:00', TZ)).toBe(13);
    expect(localHourOf('2026-09-18T13:30:00.000', TZ)).toBe(13);
  });

  it('normalises midnight to hour 0', () => {
    expect(localHourOf('2026-09-18T04:00:00.000Z', TZ)).toBe(0);
  });

  it('returns null when there is no time to read', () => {
    expect(localHourOf(undefined, TZ)).toBeNull();
    expect(localHourOf('nonsense', TZ)).toBeNull();
  });
});

describe('summarize', () => {
  it('withholds a group entirely rather than reporting zero trades', () => {
    expect(summarize([], 'nothing')).toBeNull();
  });

  it('reports net P&L, average R and win rate', () => {
    const bucket = summarize(
      [
        makeTrade({ netPnL: 100, rMultiple: 2 }),
        makeTrade({ netPnL: -50, rMultiple: -1 }),
      ],
      'test'
    )!;

    expect(bucket.trades).toBe(2);
    expect(bucket.netPnL).toBe(50);
    expect(bucket.avgR).toBe(0.5);
    expect(bucket.winRate).toBe(50);
  });
});

describe('analyzeTimeOfDay', () => {
  it('groups entries by local hour and withholds thin hours', () => {
    const trades = [
      makeTrade({ entryTime: '2026-09-18T13:30:00.000Z', netPnL: 100 }),
      makeTrade({ entryTime: '2026-09-18T13:45:00.000Z', netPnL: -20 }),
      makeTrade({ entryTime: '2026-09-18T13:50:00.000Z', netPnL: 30 }),
      // A single entry at another hour: below the sample floor, so not reported.
      makeTrade({ entryTime: '2026-09-18T18:00:00.000Z', netPnL: 500 }),
    ];

    const facts = analyzeTimeOfDay(trades, TZ);
    expect(facts.buckets).toHaveLength(1);
    expect(facts.buckets[0].label).toBe('09:00');
    expect(facts.buckets[0].trades).toBe(3);
    expect(facts.buckets[0].netPnL).toBe(110);
  });

  it('names a best and worst hour only when there are hours to compare', () => {
    const single = analyzeTimeOfDay(
      Array.from({ length: MIN_BUCKET_TRADES }, () => makeTrade({ entryTime: '2026-09-18T13:30:00.000Z' })),
      TZ
    );
    expect(single.best).toBeNull();
    expect(single.worst).toBeNull();

    const two = analyzeTimeOfDay(
      [
        ...Array.from({ length: 3 }, () =>
          makeTrade({ entryTime: '2026-09-18T13:30:00.000Z', netPnL: 80 })
        ),
        ...Array.from({ length: 3 }, () =>
          makeTrade({ entryTime: '2026-09-18T18:00:00.000Z', netPnL: -90 })
        ),
      ],
      TZ
    );
    expect(two.best?.netPnL).toBe(240);
    expect(two.worst?.netPnL).toBe(-270);
  });

  it('counts entries whose timestamp it could not read', () => {
    const facts = analyzeTimeOfDay([makeTrade({ entryTime: '' })], TZ);
    expect(facts.unreadableEntries).toBe(1);
    expect(facts.buckets).toEqual([]);
  });
});

describe('analyzeHoldTime', () => {
  it('bands holds and hides bands below the sample floor', () => {
    const facts = analyzeHoldTime([
      // 10 minute holds.
      makeTrade({ entryTime: '2026-09-18T13:30:00.000Z', exitTime: '2026-09-18T13:40:00.000Z' }),
      makeTrade({ entryTime: '2026-09-18T14:30:00.000Z', exitTime: '2026-09-18T14:40:00.000Z' }),
      makeTrade({ entryTime: '2026-09-18T15:30:00.000Z', exitTime: '2026-09-18T15:40:00.000Z' }),
      // One multi-hour hold: not enough to report.
      makeTrade({ entryTime: '2026-09-18T16:00:00.000Z', exitTime: '2026-09-18T19:00:00.000Z' }),
    ]);

    expect(facts.buckets.map((b) => b.label)).toEqual(['5-15 min']);
    expect(facts.buckets[0].trades).toBe(3);
    expect(facts.averageMinutes).toBe(52.5);
  });

  it('treats a negative duration as bad data rather than an instant trade', () => {
    const facts = analyzeHoldTime([
      makeTrade({ entryTime: '2026-09-18T14:00:00.000Z', exitTime: '2026-09-18T13:00:00.000Z' }),
    ]);

    expect(facts.unreadable).toBe(1);
    expect(facts.buckets).toEqual([]);
    expect(facts.averageMinutes).toBeNull();
  });

  it('counts an open trade with no exit as unreadable, not as a hold', () => {
    const facts = analyzeHoldTime([makeTrade({ status: 'open', exitTime: undefined })]);
    expect(facts.unreadable).toBe(1);
    expect(facts.averageMinutes).toBeNull();
  });
});

describe('analyzeAfterLoss', () => {
  it('flags an entry that followed a losing exit inside the window', () => {
    const facts = analyzeAfterLoss([
      makeTrade({
        id: 'loss',
        entryTime: '2026-09-18T13:00:00.000Z',
        exitTime: '2026-09-18T13:20:00.000Z',
        netPnL: -50,
      }),
      // 10 minutes after the loss closed -> inside the window.
      makeTrade({
        id: 'reaction',
        entryTime: '2026-09-18T13:30:00.000Z',
        exitTime: '2026-09-18T13:40:00.000Z',
        netPnL: -40,
      }),
      // Much later, unrelated to the loss.
      makeTrade({
        id: 'calm',
        entryTime: '2026-09-18T15:00:00.000Z',
        exitTime: '2026-09-18T15:30:00.000Z',
        netPnL: 60,
      }),
    ]);

    expect(facts.windowMinutes).toBe(AFTER_LOSS_WINDOW_MINUTES);
    expect(facts.afterLoss?.trades).toBe(1);
    expect(facts.afterLoss?.netPnL).toBe(-40);
    expect(facts.other?.trades).toBe(2);
    expect(facts.other?.netPnL).toBe(10);
    expect(facts.daysAffected).toBe(1);
  });

  it('does not count an entry inside the window as it happened before the loss closed', () => {
    const facts = analyzeAfterLoss([
      makeTrade({
        id: 'loss',
        entryTime: '2026-09-18T13:00:00.000Z',
        exitTime: '2026-09-18T13:20:00.000Z',
        netPnL: -50,
      }),
      // Entered while the loser was still open: not a reaction to a loss.
      makeTrade({
        id: 'concurrent',
        entryTime: '2026-09-18T13:10:00.000Z',
        exitTime: '2026-09-18T13:15:00.000Z',
        netPnL: 10,
      }),
    ]);

    expect(facts.afterLoss).toBeNull();
    expect(facts.other?.trades).toBe(2);
  });

  it('keeps sequences on separate days apart', () => {
    const facts = analyzeAfterLoss([
      makeTrade({
        id: 'loss-day-1',
        tradingDayId: 'd1',
        entryTime: '2026-09-17T13:00:00.000Z',
        exitTime: '2026-09-17T13:20:00.000Z',
        netPnL: -50,
      }),
      // Next day, ten minutes later on the clock but a day after the loss.
      makeTrade({
        id: 'next-day',
        tradingDayId: 'd2',
        entryTime: '2026-09-18T13:30:00.000Z',
        exitTime: '2026-09-18T13:40:00.000Z',
        netPnL: -40,
      }),
    ]);

    expect(facts.afterLoss).toBeNull();
  });

  it('measures the gap from the nearest loss, not the first one', () => {
    const earlier = makeTrade({
      id: 'early-loss',
      entryTime: '2026-09-18T13:00:00.000Z',
      exitTime: '2026-09-18T13:05:00.000Z',
      netPnL: -30,
    });
    const later = makeTrade({
      id: 'late-loss',
      entryTime: '2026-09-18T14:00:00.000Z',
      exitTime: '2026-09-18T14:50:00.000Z',
      netPnL: -30,
    });
    // 30 minutes after the early loss (outside the window), 0 minutes after the late one.
    const entry = makeTrade({
      id: 'entry',
      entryTime: '2026-09-18T14:50:00.000Z',
      exitTime: '2026-09-18T15:00:00.000Z',
      netPnL: 20,
    });

    expect(analyzeAfterLoss([earlier, later, entry]).afterLoss?.trades).toBe(1);
  });
  it('counts a same-instant reversal, the most reactive entry there is', () => {
    const facts = analyzeAfterLoss([
      makeTrade({
        id: 'loss',
        entryTime: '2026-09-18T13:00:00.000Z',
        exitTime: '2026-09-18T13:20:00.000Z',
        netPnL: -50,
      }),
      // Stopped out and flipped the other way at the very same timestamp.
      makeTrade({
        id: 'flip',
        entryTime: '2026-09-18T13:20:00.000Z',
        exitTime: '2026-09-18T13:30:00.000Z',
        netPnL: -25,
      }),
    ]);

    expect(facts.afterLoss?.trades).toBe(1);
    expect(facts.afterLoss?.netPnL).toBe(-25);
  });

  it('never matches a trade against its own exit', () => {
    // A zero-length loss: without the self-check its own exit would look like a loss
    // it reacted to, and it would be counted as a reaction to itself.
    const facts = analyzeAfterLoss([
      makeTrade({
        id: 'instant-loss',
        entryTime: '2026-09-18T13:20:00.000Z',
        exitTime: '2026-09-18T13:20:00.000Z',
        netPnL: -50,
      }),
    ]);

    expect(facts.afterLoss).toBeNull();
  });
});

describe('analyzeSizeDiscipline', () => {
  it('counts trades above the planned size, and how many followed a loss', () => {
    const day = makeDay({ id: 'd1', contractsPlanned: 1 });
    const facts = analyzeSizeDiscipline(
      [
        makeTrade({
          id: 'loss',
          tradingDayId: 'd1',
          contracts: 1,
          entryTime: '2026-09-18T13:00:00.000Z',
          exitTime: '2026-09-18T13:20:00.000Z',
          netPnL: -40,
        }),
        // Sized up to 3 against a planned 1, five minutes after the loss.
        makeTrade({
          id: 'revenge-size',
          tradingDayId: 'd1',
          contracts: 3,
          entryTime: '2026-09-18T13:25:00.000Z',
          exitTime: '2026-09-18T13:35:00.000Z',
          netPnL: -120,
        }),
        makeTrade({
          id: 'normal',
          tradingDayId: 'd1',
          contracts: 1,
          entryTime: '2026-09-18T15:00:00.000Z',
          exitTime: '2026-09-18T15:20:00.000Z',
          netPnL: 30,
        }),
      ],
      [day]
    );

    expect(facts.tradesOverPlannedSize).toBe(1);
    expect(facts.worstOvershootContracts).toBe(2);
    expect(facts.overPlannedSizeAfterLoss).toBe(1);
    expect(facts.daysWithPlannedContracts).toBe(1);
  });

  it('ignores size when the day planned no contracts to compare against', () => {
    const facts = analyzeSizeDiscipline(
      [makeTrade({ tradingDayId: 'd1', contracts: 9 })],
      [makeDay({ id: 'd1', contractsPlanned: 0 })]
    );

    expect(facts.tradesOverPlannedSize).toBe(0);
    expect(facts.daysWithPlannedContracts).toBe(0);
  });

  it('ignores a trade whose day is not in the journal', () => {
    const facts = analyzeSizeDiscipline([makeTrade({ tradingDayId: 'ghost', contracts: 9 })], []);
    expect(facts.tradesOverPlannedSize).toBe(0);
  });
});

describe('analyzeActivity', () => {
  const days = [
    makeDay({ id: 'd1', tradeDate: '2026-09-15' }),
    makeDay({ id: 'd2', tradeDate: '2026-09-16' }),
    makeDay({ id: 'd3', tradeDate: '2026-09-17' }),
    makeDay({ id: 'd4', tradeDate: '2026-09-18' }),
  ];

  const onDay = (dayId: string, count: number, pnl: number) =>
    Array.from({ length: count }, () => makeTrade({ tradingDayId: dayId, netPnL: pnl }));

  it('compares busier days against quieter ones using the trader own median', () => {
    const facts = analyzeActivity(
      [
        ...onDay('d1', 1, 10),
        ...onDay('d2', 2, 20),
        ...onDay('d3', 5, -50),
        ...onDay('d4', 6, -60),
      ],
      days
    );

    expect(facts.daysWithTrades).toBe(4);
    expect(facts.medianTradesPerDay).toBe(3.5);
    expect(facts.busyDays).toBe(2);
    // The two busier days: 5 x -50 and 6 x -60.
    expect(facts.busyAvgPnL).toBe(-305);
    expect(facts.quietDays).toBe(2);
    expect(facts.quietAvgPnL).toBe(25);
    expect(facts.busiestDay).toEqual({ date: '2026-09-18', trades: 6, netPnL: -360 });
  });

  it('withholds the comparison when one side of the split has no real sample', () => {
    const facts = analyzeActivity([...onDay('d1', 1, 10), ...onDay('d2', 3, -50)], days.slice(0, 2));

    expect(facts.busyDays).toBe(0);
    expect(facts.busyAvgPnL).toBeNull();
    expect(facts.quietAvgPnL).toBeNull();
    // Only two days of history: not enough to name a busiest day either.
    expect(facts.busiestDay).toBeNull();
  });

  it('names no busiest day on an empty journal', () => {
    const facts = analyzeActivity([], []);
    expect(facts.daysWithTrades).toBe(0);
    expect(facts.busiestDay).toBeNull();
  });
});

describe('analyzeBehavior', () => {
  it('produces an empty, NaN-free picture for an empty journal', () => {
    const facts = analyzeBehavior({ trades: [], tradingDays: [], timezone: TZ });

    expect(facts.timeOfDay.buckets).toEqual([]);
    expect(facts.holdTime.buckets).toEqual([]);
    expect(facts.afterLoss.afterLoss).toBeNull();
    expect(facts.activity.busiestDay).toBeNull();
    expect(JSON.stringify(facts)).not.toMatch(/NaN|Infinity/);
  });

  it('only analyses closed trades for outcome, but still checks size on open ones', () => {
    const facts = analyzeBehavior({
      trades: [
        makeTrade({ id: 'open', status: 'open', exitTime: undefined, contracts: 5, entryTime: '' }),
      ],
      tradingDays: [makeDay({ id: 'd1', contractsPlanned: 1 })],
      timezone: TZ,
    });

    expect(facts.timeOfDay.unreadableEntries).toBe(0);
    expect(facts.sizeDiscipline.tradesOverPlannedSize).toBe(1);
  });

  it('carries the timezone through so the prompt can name whose local time it is', () => {
    expect(analyzeBehavior({ trades: [], tradingDays: [], timezone: TZ }).timezone).toBe(TZ);
  });
});
