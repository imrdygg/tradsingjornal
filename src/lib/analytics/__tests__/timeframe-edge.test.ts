import { describe, it, expect } from 'vitest';
import { LevelTouch, MarkedLevel } from '../../../types';
import {
  HOLD_BARS,
  TIMEFRAME_MINUTES,
  awayMinutes,
  holdHorizonMinutes,
  summarizeTimeframeEdgeScores,
  timeframeEdgeTrend,
} from '../timeframe-edge';

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
    createdAt: '2026-09-28T13:00:00Z',
    updatedAt: '2026-09-28T13:00:00Z',
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
    touchedAt: '2026-09-28T14:00:00Z',
    session: 'Regular Session',
    outcome: 'watching',
    checks: 1,
    timeframe: '5m',
    levelId: 'l',
    createdAt: '2026-09-28T14:00:00Z',
    updatedAt: '2026-09-28T14:00:00Z',
    ...over,
  };
}

/** A decided touch that stayed away `minutes`, ending whichever way asked. */
function decided(
  over: Partial<LevelTouch> & { minutes: number; outcome: 'never-returned' | 'returned' }
): LevelTouch {
  const { minutes, ...rest } = over;
  const end = new Date(Date.parse('2026-09-28T14:00:00Z') + minutes * 60000).toISOString();
  return touch({
    ...rest,
    touchedAt: '2026-09-28T14:00:00Z',
    ...(rest.outcome === 'returned' ? { returnedAt: end } : { checkedAt: end }),
  });
}

describe('hold horizon', () => {
  it('is three bars of the chart it came from', () => {
    expect(HOLD_BARS).toBe(3);
    expect(TIMEFRAME_MINUTES['1m']).toBe(1);
    expect(TIMEFRAME_MINUTES['1h']).toBe(60);
    expect(holdHorizonMinutes('1m')).toBe(3);
    expect(holdHorizonMinutes('5m')).toBe(15);
    expect(holdHorizonMinutes('15m')).toBe(45);
    expect(holdHorizonMinutes('1h')).toBe(180);
  });
});

describe('awayMinutes', () => {
  it('is exact for a return and a lower bound for a hold', () => {
    expect(awayMinutes(decided({ outcome: 'returned', minutes: 20 }))).toBe(20);
    expect(awayMinutes(decided({ outcome: 'never-returned', minutes: 60 }))).toBe(60);
  });

  it('is null while a touch is undecided, void, or missing its time', () => {
    expect(awayMinutes(touch({ outcome: 'watching', checkedAt: '2026-09-28T15:00:00Z' }))).toBeNull();
    expect(awayMinutes(touch({ outcome: 'invalid' }))).toBeNull();
    expect(awayMinutes(touch({ outcome: 'returned' }))).toBeNull();
    expect(awayMinutes(touch({ outcome: 'never-returned' }))).toBeNull();
  });
});

describe('summarizeTimeframeEdgeScores', () => {
  /**
   * One chart, three decided touches: a hold well past the horizon, a return inside it, and a
   * hold called before the horizon had elapsed.
   */
  const levels = [marked({ id: 'a' }), marked({ id: 'b' }), marked({ id: 'c' })];
  const touches = [
    decided({ id: 't1', levelId: 'a', outcome: 'never-returned', minutes: 30 }),
    decided({ id: 't2', levelId: 'b', outcome: 'returned', minutes: 5 }),
    decided({ id: 't3', levelId: 'c', outcome: 'never-returned', minutes: 5 }),
  ];

  it('reports the plain hold rate and the horizon rate as different numbers', () => {
    const [score] = summarizeTimeframeEdgeScores(levels, touches, { instrumentId: 'mes' });
    expect(score.key).toBe('5m|resistance');
    expect(score.marked).toBe(3);
    expect(score.decided).toBe(3);
    expect(score.neverReturned).toBe(2);
    expect(score.holdRate).toBeCloseTo(66.7, 1);

    // The hold called at five minutes cannot be judged, so it is set aside, not failed.
    expect(score.horizonMinutes).toBe(15);
    expect(score.heldAtHorizon).toBe(1);
    expect(score.judgedAtHorizon).toBe(2);
    expect(score.unknownAtHorizon).toBe(1);
    expect(score.holdRateAtHorizon).toBe(50);
    expect(score.avgAwayMinutes).toBeCloseTo(13.3, 1);
  });

  it('withholds the horizon rate until its own sample clears the floor', () => {
    const thin = summarizeTimeframeEdgeScores(levels, touches, {
      instrumentId: 'mes',
      minDecided: 3,
    })[0];
    expect(thin.enoughData).toBe(false);

    const readable = summarizeTimeframeEdgeScores(levels, touches, {
      instrumentId: 'mes',
      minDecided: 2,
    })[0];
    expect(readable.enoughData).toBe(true);
  });

  it('counts a return that took longer than the horizon as having held it', () => {
    const late = decided({ id: 't4', levelId: 'a', outcome: 'returned', minutes: 40 });
    const [score] = summarizeTimeframeEdgeScores(levels, [late], { instrumentId: 'mes' });
    expect(score.heldAtHorizon).toBe(1);
    expect(score.judgedAtHorizon).toBe(1);
    expect(score.holdRateAtHorizon).toBe(100);
    expect(score.holdRate).toBe(0);
  });

  it('judges a 1h line against its own bars, not the 5m line’s', () => {
    const slowLevels = [marked({ id: 's1', timeframe: '1h' })];
    const slowTouches = [
      decided({ id: 'st', levelId: 's1', timeframe: '1h', outcome: 'never-returned', minutes: 30 }),
    ];
    const [score] = summarizeTimeframeEdgeScores(slowLevels, slowTouches, {
      instrumentId: 'mes',
    });
    expect(score.horizonMinutes).toBe(180);
    // Thirty minutes is a hold on the 5m chart and a call made too early on the hourly one.
    expect(score.judgedAtHorizon).toBe(0);
    expect(score.holdRateAtHorizon).toBeNull();
    expect(score.unknownAtHorizon).toBe(1);
  });

  it('reads only this instrument’s lines, and only lines that carry a chart', () => {
    const mixed = [
      marked({ id: 'a' }),
      marked({ id: 'b', instrumentId: 'mnq' }),
      marked({ id: 'c', timeframe: undefined }),
      marked({ id: 'd', resolution: 'void' }),
    ];
    const reads = [
      decided({ id: 't1', levelId: 'a', outcome: 'never-returned', minutes: 30 }),
      decided({ id: 't2', levelId: 'b', instrumentId: 'mnq', outcome: 'never-returned', minutes: 30 }),
      decided({ id: 't3', levelId: 'c', timeframe: undefined, outcome: 'never-returned', minutes: 30 }),
      decided({ id: 't4', levelId: 'd', outcome: 'never-returned', minutes: 30 }),
      // No marked line behind it: the older, mark-as-you-go record, not this read.
      decided({ id: 't5', levelId: undefined, outcome: 'never-returned', minutes: 30 }),
      // Set aside, so out of every rate.
      touch({ id: 't6', levelId: 'a', outcome: 'invalid' }),
    ];
    const scores = summarizeTimeframeEdgeScores(mixed, reads, { instrumentId: 'mes' });
    expect(scores).toHaveLength(1);
    expect(scores[0].key).toBe('5m|resistance');
    expect(scores[0].decided).toBe(1);
  });

  it('reads points per touch only from the distances the record carries', () => {
    const without = summarizeTimeframeEdgeScores(levels, touches, { instrumentId: 'mes' })[0];
    expect(without.expectancyPoints).toBeNull();
    expect(without.expectancySample).toBe(0);

    const withDistances = [
      decided({ id: 't1', levelId: 'a', outcome: 'never-returned', minutes: 30, maxExcursionPoints: 10 }),
      decided({ id: 't2', levelId: 'b', outcome: 'returned', minutes: 40, maxReturnPoints: 4 }),
    ];
    const [score] = summarizeTimeframeEdgeScores(levels, withDistances, { instrumentId: 'mes' });
    expect(score.expectancySample).toBe(2);
    expect(score.expectancyPoints).toBe(3);
  });

  it('leads with the readable buckets, best horizon rate first', () => {
    const lv = [
      marked({ id: 'r1' }),
      marked({ id: 'r2' }),
      marked({ id: 's1', kind: 'support' }),
      marked({ id: 'q1', timeframe: '15m' }),
    ];
    const reads = [
      decided({ id: 't1', levelId: 'r1', outcome: 'never-returned', minutes: 30 }),
      decided({ id: 't2', levelId: 'r2', outcome: 'never-returned', minutes: 30 }),
      decided({ id: 't3', levelId: 's1', kind: 'support', outcome: 'never-returned', minutes: 30 }),
      decided({ id: 't4', levelId: 's1', kind: 'support', outcome: 'returned', minutes: 5 }),
      // One decided touch: below the floor, so it sorts under the readable ones.
      decided({ id: 't5', levelId: 'q1', timeframe: '15m', outcome: 'never-returned', minutes: 60 }),
    ];
    const scores = summarizeTimeframeEdgeScores(lv, reads, { instrumentId: 'mes', minDecided: 2 });
    expect(scores.map((score) => `${score.key}:${score.enoughData}`)).toEqual([
      '5m|resistance:true',
      '5m|support:true',
      '15m|resistance:false',
    ]);
    expect(scores[0].holdRateAtHorizon).toBe(100);
    expect(scores[1].holdRateAtHorizon).toBe(50);
  });

  it('returns nothing for an instrument with no timeframed lines', () => {
    expect(summarizeTimeframeEdgeScores([], [], { instrumentId: 'mes' })).toEqual([]);
  });
});

describe('timeframeEdgeTrend', () => {
  const levels = [marked({ id: 'a' })];
  /** Oldest first: a hold, a return that still held the horizon, a hold, then a fast return. */
  const ordered = [
    decided({ id: 't1', levelId: 'a', outcome: 'never-returned', minutes: 30 }),
    decided({ id: 't2', levelId: 'a', outcome: 'returned', minutes: 20 }),
    decided({ id: 't3', levelId: 'a', outcome: 'never-returned', minutes: 40 }),
    decided({ id: 't4', levelId: 'a', outcome: 'returned', minutes: 5 }),
  ];

  it('slides a fixed window over the decided touches, oldest first', () => {
    const trend = timeframeEdgeTrend(levels, ordered, { instrumentId: 'mes', window: 3 });
    expect(trend.decided).toBe(4);
    expect(trend.points).toHaveLength(2);
    // Window 1 held every one of the three; window 2 loses the last to a fast return.
    expect(trend.points[0].holdRateAtHorizon).toBe(100);
    expect(trend.points[1].holdRateAtHorizon).toBeCloseTo(66.7, 1);
    expect(trend.deltaPoints).toBeCloseTo(-33.3, 1);
    expect(trend.points[1].decided).toBe(3);
  });

  it('says nothing until a first full window exists', () => {
    const trend = timeframeEdgeTrend(levels, ordered.slice(0, 2), {
      instrumentId: 'mes',
      window: 3,
    });
    expect(trend.points).toEqual([]);
    expect(trend.deltaPoints).toBeNull();
  });

  it('clears the sample floor off the whole record, not one window', () => {
    const thin = timeframeEdgeTrend(levels, ordered.slice(0, 2), {
      instrumentId: 'mes',
      window: 3,
      minDecided: 5,
    });
    expect(thin.enoughData).toBe(false);

    const read = timeframeEdgeTrend(levels, ordered, {
      instrumentId: 'mes',
      window: 3,
      minDecided: 3,
    });
    expect(read.enoughData).toBe(true);
  });

  it('ignores touches that never linked to a marked line', () => {
    const stray = [...ordered, decided({ id: 'tx', levelId: undefined, outcome: 'never-returned', minutes: 30 })];
    const trend = timeframeEdgeTrend(levels, stray, { instrumentId: 'mes', window: 3 });
    expect(trend.decided).toBe(4);
  });
});
