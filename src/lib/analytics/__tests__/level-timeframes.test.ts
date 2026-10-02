import { describe, it, expect } from 'vitest';
import { LevelTouch, MarkedLevel } from '../../../types';
import {
  diffLevelPrices,
  previousLevelDate,
  summarizeTimeframeEdges,
  timeframeBucketLabel,
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
