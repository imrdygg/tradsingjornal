import { describe, it, expect } from 'vitest';
import { LevelTouch, MarkedLevel } from '../../../types';
import {
  diffLevelPrices,
  findCarryoverLevels,
  previousLevelDate,
  summarizeInstrumentEdges,
  summarizeTimeframeEdges,
  timeframeBucketLabel,
  timeframeHighlights,
} from '../level-timeframes';

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
    touchedAt: '2026-09-28T02:00:00Z',
    session: 'Regular Session',
    outcome: 'watching',
    checks: 1,
    createdAt: '2026-09-28T02:00:00Z',
    updatedAt: '2026-09-28T02:00:00Z',
    ...over,
  };
}

describe('summarizeTimeframeEdges', () => {
  it('groups by instrument, timeframe and side, counting tested lines only where a touch links back', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', kind: 'resistance' }),
      marked({ id: 'b', timeframe: '5m', kind: 'resistance' }),
      marked({ id: 'c', timeframe: '5m', kind: 'resistance' }),
      // A different timeframe and a different side, so both split out.
      marked({ id: 'd', timeframe: '30m', kind: 'resistance' }),
      marked({ id: 'e', timeframe: '5m', kind: 'support' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a', outcome: 'never-returned' }),
      touch({ id: 't2', levelId: 'b', outcome: 'returned' }),
      // No level behind it: belongs to the older record and must not count here.
      touch({ id: 't3', outcome: 'never-returned' }),
    ];

    const buckets = summarizeTimeframeEdges(levels, touches);
    const mes5Res = buckets.find((b) => b.key === 'mes|5m|resistance');
    expect(mes5Res?.marked).toBe(3);
    expect(mes5Res?.tested).toBe(2);
    expect(mes5Res?.untested).toBe(1);
    expect(mes5Res?.testRate).toBeCloseTo(66.7, 1);
    expect(mes5Res?.stats.decided).toBe(2);
    expect(mes5Res?.stats.holdRate).toBe(50);

    const mes30Res = buckets.find((b) => b.key === 'mes|30m|resistance');
    expect(mes30Res?.marked).toBe(1);
    expect(mes30Res?.tested).toBe(0);
    expect(mes30Res?.stats.touches).toBe(0);

    const mes5Sup = buckets.find((b) => b.key === 'mes|5m|support');
    expect(mes5Sup?.marked).toBe(1);
  });

  it('orders the buckets by how many lines were actually tested', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m' }),
      marked({ id: 'b', timeframe: '5m' }),
      marked({ id: 'c', timeframe: '30m' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a' }),
      touch({ id: 't2', levelId: 'b' }),
      touch({ id: 't3', levelId: 'c' }),
    ];
    const buckets = summarizeTimeframeEdges(levels, touches);
    expect(buckets[0].key).toBe('mes|5m|resistance');
    expect(buckets[0].tested).toBe(2);
  });

  it('treats a level with no timeframe as its own bucket rather than inventing one', () => {
    const buckets = summarizeTimeframeEdges([marked({ id: 'a', timeframe: undefined })], []);
    expect(buckets[0].timeframe).toBeNull();
    expect(buckets[0].testRate).toBe(0);
    expect(timeframeBucketLabel(buckets[0], 'MES')).toBe('MES no timeframe resistance');
  });

  it('drops a voided line and breaks out the ones closed out as never touched', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', resolution: 'void' }),
      marked({ id: 'b', timeframe: '5m', resolution: 'never-touched' }),
      marked({ id: 'c', timeframe: '5m' }),
    ];
    const buckets = summarizeTimeframeEdges(levels, []);
    const mes5Res = buckets.find((b) => b.key === 'mes|5m|resistance');
    // The void line is gone entirely: two lines are marked, both untested.
    expect(mes5Res?.marked).toBe(2);
    expect(mes5Res?.tested).toBe(0);
    expect(mes5Res?.untested).toBe(2);
    expect(mes5Res?.neverTouched).toBe(1);
  });
});

describe('summarizeInstrumentEdges', () => {
  it('rolls each instrument up across its timeframes and sides', () => {
    const levels = [
      marked({ id: 'a', instrumentId: 'mes', timeframe: '5m', kind: 'resistance' }),
      marked({ id: 'b', instrumentId: 'mes', timeframe: '5m', kind: 'support' }),
      marked({ id: 'c', instrumentId: 'mes', timeframe: '30m', kind: 'resistance' }),
      marked({ id: 'd', instrumentId: 'mnq', timeframe: '5m', kind: 'resistance' }),
    ];
    const touches = [
      touch({ id: 't1', instrumentId: 'mes', levelId: 'a', outcome: 'never-returned' }),
      touch({ id: 't2', instrumentId: 'mes', levelId: 'b', outcome: 'returned' }),
      touch({ id: 't3', instrumentId: 'mnq', levelId: 'd', outcome: 'never-returned' }),
      // No marked level behind it: it belongs to the older record, not here.
      touch({ id: 't4', instrumentId: 'mes', outcome: 'never-returned' }),
    ];

    const buckets = summarizeInstrumentEdges(levels, touches);
    const mes = buckets.find((b) => b.key === 'mes');
    expect(mes?.marked).toBe(3);
    expect(mes?.tested).toBe(2);
    expect(mes?.untested).toBe(1);
    expect(mes?.stats.decided).toBe(2);
    expect(mes?.stats.holdRate).toBe(50);

    const mnq = buckets.find((b) => b.key === 'mnq');
    expect(mnq?.marked).toBe(1);
    expect(mnq?.tested).toBe(1);
    expect(mnq?.stats.holdRate).toBe(100);
  });

  it('leads with the instrument that has the most tested lines', () => {
    const levels = [
      marked({ id: 'a', instrumentId: 'mnq' }),
      marked({ id: 'b', instrumentId: 'mcl' }),
      marked({ id: 'c', instrumentId: 'mcl' }),
    ];
    const touches = [
      touch({ id: 't1', instrumentId: 'mnq', levelId: 'a' }),
      touch({ id: 't2', instrumentId: 'mcl', levelId: 'b' }),
      touch({ id: 't3', instrumentId: 'mcl', levelId: 'c' }),
    ];
    const buckets = summarizeInstrumentEdges(levels, touches);
    expect(buckets[0].key).toBe('mcl');
    expect(buckets[0].tested).toBe(2);
  });

  it('drops a void line and breaks out the ones closed out as never touched', () => {
    const levels = [
      marked({ id: 'a', instrumentId: 'mes', resolution: 'void' }),
      marked({ id: 'b', instrumentId: 'mes', resolution: 'never-touched' }),
      marked({ id: 'c', instrumentId: 'mes' }),
    ];
    const buckets = summarizeInstrumentEdges(levels, []);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].marked).toBe(2);
    expect(buckets[0].untested).toBe(2);
    expect(buckets[0].neverTouched).toBe(1);
  });
});

describe('timeframeHighlights', () => {
  it('names the most-reached line only once enough of its lines were tested', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m' }),
      marked({ id: 'b', timeframe: '5m' }),
      marked({ id: 'c', timeframe: '5m' }),
      marked({ id: 'd', timeframe: '30m' }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'a' }),
      touch({ id: 't2', levelId: 'b' }),
      touch({ id: 't3', levelId: 'c' }),
      touch({ id: 't4', levelId: 'd' }),
    ];
    const highlights = timeframeHighlights(summarizeTimeframeEdges(levels, touches));
    expect(highlights.mostReached?.key).toBe('mes|5m|resistance');
    expect(highlights.mostReached?.tested).toBe(3);
  });

  it('reports no most-reached line when every bucket is below the reach floor', () => {
    const levels = [marked({ id: 'a' }), marked({ id: 'b' })];
    const touches = [touch({ id: 't1', levelId: 'a' }), touch({ id: 't2', levelId: 'b' })];
    const highlights = timeframeHighlights(summarizeTimeframeEdges(levels, touches));
    expect(highlights.mostReached).toBeNull();
  });

  it('flags a line the trader marks but keeps untested', () => {
    // Six marked, one tested: a real blind spot.
    const levels = Array.from({ length: 6 }, (_, i) =>
      marked({ id: `l${i}`, timeframe: '15m' })
    );
    const touches = [touch({ id: 't1', levelId: 'l0' })];
    const highlights = timeframeHighlights(summarizeTimeframeEdges(levels, touches));
    expect(highlights.mostIgnored?.key).toBe('mes|15m|resistance');
    expect(highlights.mostIgnored?.untested).toBe(5);
  });

  it('withholds a best-hold line until the sample is readable', () => {
    // Four decided touches is below the five-touch floor.
    const levels = Array.from({ length: 4 }, (_, i) => marked({ id: `l${i}`, timeframe: '1h' }));
    const touches = levels.map((level, i) =>
      touch({ id: `t${i}`, levelId: level.id, outcome: 'never-returned' })
    );
    const thin = timeframeHighlights(summarizeTimeframeEdges(levels, touches));
    expect(thin.bestHold).toBeNull();

    // A fifth decided touch crosses the floor and the 100% hold becomes readable.
    const fifth = marked({ id: 'l4', timeframe: '1h' });
    const readable = timeframeHighlights(
      summarizeTimeframeEdges(
        [...levels, fifth],
        [...touches, touch({ id: 't4', levelId: 'l4', outcome: 'never-returned' })]
      )
    );
    expect(readable.bestHold?.key).toBe('mes|1h|resistance');
    expect(readable.bestHold?.stats.holdRate).toBe(100);
  });
});

describe('diffLevelPrices', () => {
  it('reports added, removed and unchanged prices between two days', () => {
    const diff = diffLevelPrices([100, 105, 110], [100, 95, 110]);
    expect(diff.added).toEqual([105]);
    expect(diff.removed).toEqual([95]);
    expect(diff.unchanged).toEqual([100, 110]);
  });

  it('ignores duplicates and order', () => {
    const diff = diffLevelPrices([105, 100, 105], [100]);
    expect(diff.added).toEqual([105]);
    expect(diff.removed).toEqual([]);
  });
});

describe('previousLevelDate', () => {
  it('returns the most recent earlier day the instrument was marked on, skipping gaps', () => {
    const levels = [
      marked({ id: 'a', instrumentId: 'mes', tradeDate: '2026-09-20' }),
      marked({ id: 'b', instrumentId: 'mes', tradeDate: '2026-09-25' }),
      marked({ id: 'c', instrumentId: 'mnq', tradeDate: '2026-09-27' }),
      marked({ id: 'd', instrumentId: 'mes', tradeDate: '2026-09-28' }),
    ];
    expect(previousLevelDate(levels, 'mes', '2026-09-28')).toBe('2026-09-25');
    expect(previousLevelDate(levels, 'mnq', '2026-09-28')).toBe('2026-09-27');
    expect(previousLevelDate(levels, 'mcl', '2026-09-28')).toBeNull();
  });
});

describe('findCarryoverLevels', () => {
  it('offers a price marked on another chart, naming the charts it is already on', () => {
    const levels = [
      marked({ id: 'a', timeframe: '15m', kind: 'resistance', price: 7760 }),
      marked({ id: 'b', timeframe: '1h', kind: 'resistance', price: 7760 }),
    ];
    const carry = findCarryoverLevels(levels, { instrumentId: 'mes', timeframe: '5m' });
    expect(carry).toHaveLength(1);
    expect(carry[0].kind).toBe('resistance');
    expect(carry[0].price).toBe(7760);
    // Chart order, not insertion order: 15m comes before 1h.
    expect(carry[0].timeframes).toEqual(['15m', '1h']);
  });

  it('leaves out a price already on the chart on screen with the same side', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', kind: 'resistance', price: 7760 }),
      marked({ id: 'b', timeframe: '15m', kind: 'resistance', price: 7760 }),
    ];
    expect(findCarryoverLevels(levels, { instrumentId: 'mes', timeframe: '5m' })).toEqual([]);
  });

  it('still offers a price leaning the other way on the chart on screen', () => {
    const levels = [
      marked({ id: 'a', timeframe: '5m', kind: 'support', price: 7700 }),
      marked({ id: 'b', timeframe: '15m', kind: 'resistance', price: 7700 }),
    ];
    const carry = findCarryoverLevels(levels, { instrumentId: 'mes', timeframe: '5m' });
    expect(carry).toEqual([{ kind: 'resistance', price: 7700, timeframes: ['15m'] }]);
  });

  it('ignores other instruments and reads resistance above support', () => {
    const levels = [
      marked({ id: 'a', timeframe: '15m', kind: 'support', price: 7700 }),
      marked({ id: 'b', timeframe: '15m', kind: 'resistance', price: 7740 }),
      marked({ id: 'c', instrumentId: 'mnq', timeframe: '15m', kind: 'resistance', price: 20500 }),
    ];
    const carry = findCarryoverLevels(levels, { instrumentId: 'mes', timeframe: '5m' });
    expect(carry.map((level) => `${level.kind} ${level.price}`)).toEqual([
      'resistance 7740',
      'support 7700',
    ]);
  });

  it('reads a level with no timeframe as the default chart, matching the marking card', () => {
    const levels = [marked({ id: 'a', kind: 'resistance', price: 7760, timeframe: undefined })];
    // Absent is treated as 5m, so nothing is carried while 5m is on screen...
    expect(findCarryoverLevels(levels, { instrumentId: 'mes', timeframe: '5m' })).toEqual([]);
    // ...and it is offered once another chart is open.
    expect(findCarryoverLevels(levels, { instrumentId: 'mes', timeframe: '15m' })).toEqual([
      { kind: 'resistance', price: 7760, timeframes: ['5m'] },
    ]);
  });
});
