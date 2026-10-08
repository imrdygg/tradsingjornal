import { describe, expect, it } from 'vitest';
import {
  averageClockMinutes,
  dailyStats,
  directionStats,
  gradeOf,
  normalizeMesLevel,
  outcomeOfLevel,
  outcomeSplit,
  peakBucket,
  reliabilityOf,
  reliabilitySeries,
  sanitizeLevel,
  statsByTimeframe,
  statsFor,
  strengthOf,
  timingHistogram,
} from '../analytics';
import { TIMEFRAMES, TIMEFRAME_ORDER } from '../constants';
import type { LevelRecord } from '../types';

function record(overrides: Partial<LevelRecord> = {}): LevelRecord {
  return {
    id: overrides.id ?? 'id',
    date: overrides.date ?? '2026-09-22',
    timeframe: overrides.timeframe ?? '30m',
    kind: overrides.kind ?? 'support',
    price: overrides.price ?? 5820,
    touches: overrides.touches ?? 0,
    holds: overrides.holds ?? 0,
    breaks: overrides.breaks ?? 0,
    setup: overrides.setup ?? '',
    hitTime: overrides.hitTime ?? '',
    breakTime: overrides.breakTime ?? '',
    breakDirection: overrides.breakDirection ?? '',
    notes: overrides.notes ?? '',
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt ?? 0,
  };
}

describe('the five worked examples from the spec', () => {
  it('computes raw reliability', () => {
    expect(reliabilityOf(7, 3)).toBeCloseTo(0.7, 10);
  });

  it('shrinks strength toward 50% so a small sample cannot read 100%', () => {
    expect(strengthOf(7, 3)).toBe(64.3);
    expect(strengthOf(1, 0)).toBe(60);
    expect(strengthOf(0, 0)).toBeNull();
  });

  it('grades from strength, and null reads as a dash', () => {
    expect(gradeOf(64.3)).toBe('B');
    expect(gradeOf(null)).toBe('—');
  });
});

describe('statsFor', () => {
  const records = [
    record({ id: 'a', touches: 3, holds: 2, breaks: 1, hitTime: '09:35' }),
    record({ id: 'b', touches: 2, holds: 2, breaks: 0 }),
    record({ id: 'c', touches: 0 }),
    record({ id: 'd', touches: 1, holds: 0, breaks: 1 }),
  ];

  it('counts logged, tested, and the tallies', () => {
    const stats = statsFor('30m', '30m', records);
    expect(stats.logged).toBe(4);
    expect(stats.tested).toBe(3);
    expect(stats.touches).toBe(6);
    expect(stats.holds).toBe(4);
    expect(stats.breaks).toBe(2);
  });

  it('derives hit rate, reliability, strength, grade, confidence and avg tests', () => {
    const stats = statsFor('30m', '30m', records);
    expect(stats.hitRate).toBeCloseTo(3 / 4, 10);
    expect(stats.reliability).toBeCloseTo(4 / 6, 10);
    expect(stats.strength).toBe(Math.round(((4 + 2) / (6 + 4)) * 100 * 10) / 10);
    expect(stats.grade).toBe(gradeOf(stats.strength));
    expect(stats.confidence).toBe('medium'); // 6 decisive >= 5
    expect(stats.sampleSize).toBe(6);
    expect(stats.avgTouches).toBeCloseTo(6 / 3, 10);
  });

  it('returns nulls rather than zeros for an empty group', () => {
    const stats = statsFor('1h', '1h', []);
    expect(stats.hitRate).toBeNull();
    expect(stats.reliability).toBeNull();
    expect(stats.strength).toBeNull();
    expect(stats.grade).toBe('—');
    expect(stats.confidence).toBe('low');
    expect(stats.avgTouches).toBeNull();
  });
});

describe('statsByTimeframe', () => {
  it('returns all six timeframes in ascending chart order', () => {
    const groups = statsByTimeframe([]);
    expect(groups.map((group) => group.key)).toEqual([...TIMEFRAMES]);
    expect(TIMEFRAME_ORDER['1m']).toBeLessThan(TIMEFRAME_ORDER['1h']);
  });
});

describe('outcomeSplit', () => {
  it('sums to the number of levels, splitting mixed proportionally', () => {
    const records = [
      record({ id: 'held', touches: 1, holds: 1 }),
      record({ id: 'broke', touches: 1, breaks: 1 }),
      record({ id: 'untested', touches: 0 }),
      record({ id: 'mixed', touches: 2, holds: 1, breaks: 1 }),
    ];
    const split = outcomeSplit(records);
    expect(split.total).toBe(4);
    expect(split.held + split.broke + split.untested).toBeCloseTo(4, 10);
    expect(split.held).toBeCloseTo(1.5, 10); // one held + half of mixed
    expect(split.broke).toBeCloseTo(1.5, 10); // one broke + half of mixed
    expect(split.untested).toBe(1);
  });

  it('classifies a level by what happened at it', () => {
    expect(outcomeOfLevel(record({ touches: 0 }))).toBe('untested');
    expect(outcomeOfLevel(record({ touches: 1, breaks: 1 }))).toBe('broke');
    expect(outcomeOfLevel(record({ touches: 1, holds: 1 }))).toBe('held');
    expect(outcomeOfLevel(record({ touches: 2, holds: 1, breaks: 1 }))).toBe('mixed');
  });
});

describe('dailyStats', () => {
  const records = [
    record({ id: 'd1', date: '2026-09-21', touches: 1, holds: 1 }),
    record({ id: 'd2', date: '2026-09-22', touches: 1, breaks: 1 }),
    record({ id: 'd3', date: '2026-09-22', touches: 0 }),
  ];

  it('is oldest to newest and keeps per-day apart from cumulative', () => {
    const days = dailyStats(records);
    expect(days.map((day) => day.date)).toEqual(['2026-09-21', '2026-09-22']);

    const [first, second] = days;
    expect(first.holds).toBe(1);
    expect(first.breaks).toBe(0);
    expect(first.cumulativeReliability).toBe(1);

    // Second day's own row is its own result, not the running total.
    expect(second.holds).toBe(0);
    expect(second.breaks).toBe(1);
    expect(second.reliability).toBe(0);
    // The running total carries both days.
    expect(second.cumulativeReliability).toBeCloseTo(1 / 2, 10);
    expect(second.cumulativeLogged).toBe(3);
    expect(second.cumulativeTested).toBe(2);
  });

  it('produces a chart-ready reliability series as 0..100 numbers', () => {
    const series = reliabilitySeries(records);
    expect(series[0].reliability).toBe(100);
    expect(series[1].cumulative).toBe(50);
  });
});

describe('timing', () => {
  const records = [
    record({ id: 'a', hitTime: '09:35', breakTime: '11:15' }),
    record({ id: 'b', hitTime: '09:50' }),
    record({ id: 'c' }),
  ];

  it('buckets hit and break times, trimming empty buckets', () => {
    const buckets = timingHistogram(records, 30, true);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].hit).toBe(2); // 09:35 and 09:50
    expect(buckets[1].broke).toBe(1); // 11:15
  });

  it('returns nothing when no level has a time', () => {
    expect(timingHistogram([record({ id: 'z' })])).toEqual([]);
  });

  it('averages clock times and finds the peak bucket', () => {
    expect(averageClockMinutes(records, 'hitTime')).toBeCloseTo((575 + 590) / 2, 10);
    const peak = peakBucket(timingHistogram(records, 30), 'hit');
    expect(peak?.hit).toBe(2);
  });
});

describe('directionStats', () => {
  it('counts tagged breaks and surfaces the untagged ones', () => {
    const records = [
      record({ id: 'a', breaks: 3, breakDirection: 'up' }),
      record({ id: 'b', breaks: 1, breakDirection: 'down' }),
      record({ id: 'c', breaks: 2 }), // untagged
    ];
    const stats = directionStats(records);
    expect(stats.up).toBe(3);
    expect(stats.down).toBe(1);
    expect(stats.total).toBe(4);
    expect(stats.upShare).toBeCloseTo(0.75, 10);
    expect(stats.unknown).toBe(2);
  });
});

describe('sanitizeLevel', () => {
  it('self-heals an inconsistent tally', () => {
    const fixed = sanitizeLevel(record({ touches: 1, holds: 2, breaks: 1 }));
    expect(fixed.touches).toBe(3);
    expect(fixed.holds).toBe(2);
    expect(fixed.breaks).toBe(1);
  });

  it('prunes timing a change made impossible', () => {
    const untested = sanitizeLevel(
      record({ touches: 0, hitTime: '09:30', breaks: 0, breakTime: '10:00', breakDirection: 'up' })
    );
    expect(untested.hitTime).toBe('');
    expect(untested.breakTime).toBe('');
    expect(untested.breakDirection).toBe('');
  });
});

describe('normalizeMesLevel', () => {
  it('tolerates a legacy record with no timing fields', () => {
    const legacy = {
      id: 'old',
      date: '2026-09-20',
      timeframe: '15m',
      kind: 'resistance',
      price: 6010.5,
      touches: 2,
      holds: 1,
      breaks: 1,
      notes: 'legacy',
    };
    const normalized = normalizeMesLevel(legacy);
    expect(normalized).not.toBeNull();
    expect(normalized?.hitTime).toBe('');
    expect(normalized?.breakTime).toBe('');
    expect(normalized?.breakDirection).toBe('');
    expect(normalized?.setup).toBe('');
  });

  it('drops rows with no usable date or price', () => {
    expect(normalizeMesLevel({ price: 0, date: '2026-09-20' })).toBeNull();
    expect(normalizeMesLevel({ price: 5820, date: 'not-a-date' })).toBeNull();
    expect(normalizeMesLevel(null)).toBeNull();
  });
});
