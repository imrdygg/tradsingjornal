import { describe, expect, it } from 'vitest';
import type { LevelTouch, MarkedLevel } from '../../../types';
import type { LevelRecord } from '../types';
import { DEFAULT_MES_TIMEFRAME } from '../constants';
import {
  bridgeFromMes,
  bridgeFromPlaybook,
  bridgedLevelFigures,
  markedLevelsFromBridged,
  mesRecordsFromBridged,
  type MarkedLevelStamp,
} from '../playbook-bridge';

/**
 * The bridge is the one place the tracker's record and the playbook's marked lines meet, so it is
 * the one place a wrong assumption between them could hide. These tests hold it to the two things
 * that matter: what a line is, and how many times it can be written.
 */

const SOURCE = { instrumentId: 'mes', timezone: 'America/New_York' };

function level(overrides: Partial<MarkedLevel> = {}): MarkedLevel {
  return {
    id: overrides.id ?? 'l1',
    userId: 'u1',
    tradingDayId: overrides.tradingDayId ?? 'day-2026-09-22',
    tradeDate: overrides.tradeDate ?? '2026-09-22',
    instrumentId: overrides.instrumentId ?? 'mes',
    kind: overrides.kind ?? 'resistance',
    price: overrides.price ?? 5820,
    zonePoints: 4,
    label: overrides.label,
    session: overrides.session ?? 'Regular Session',
    timeframe: 'timeframe' in overrides ? overrides.timeframe : '5m',
    source: overrides.source,
    resolution: overrides.resolution,
    notes: overrides.notes,
    createdAt: '2026-09-22T13:00:00.000Z',
    updatedAt: '2026-09-22T13:00:00.000Z',
  };
}

function touch(overrides: Partial<LevelTouch> = {}): LevelTouch {
  return {
    id: overrides.id ?? 't1',
    userId: 'u1',
    tradingDayId: 'day-2026-09-22',
    tradeDate: overrides.tradeDate ?? '2026-09-22',
    instrumentId: overrides.instrumentId ?? 'mes',
    kind: overrides.kind ?? 'resistance',
    price: overrides.price ?? 5820,
    zonePoints: 4,
    touchedAt: overrides.touchedAt ?? '2026-09-22T13:35:00.000Z',
    session: overrides.session ?? 'Regular Session',
    outcome: overrides.outcome ?? 'watching',
    breakDirection: overrides.breakDirection,
    levelId: overrides.levelId,
    checks: 1,
    createdAt: '2026-09-22T13:35:00.000Z',
    updatedAt: '2026-09-22T13:35:00.000Z',
  };
}

function mesRecord(overrides: Partial<LevelRecord> = {}): LevelRecord {
  return {
    id: overrides.id ?? 'm1',
    date: overrides.date ?? '2026-09-22',
    timeframe: overrides.timeframe ?? '5m',
    kind: overrides.kind ?? 'resistance',
    price: overrides.price ?? 5820,
    touches: overrides.touches ?? 0,
    holds: overrides.holds ?? 0,
    breaks: overrides.breaks ?? 0,
    setup: overrides.setup ?? '',
    hitTime: overrides.hitTime ?? '',
    breakTime: '',
    breakDirection: overrides.breakDirection ?? '',
    notes: overrides.notes ?? '',
    createdAt: 0,
    updatedAt: 0,
  };
}

const STAMP: MarkedLevelStamp = {
  userId: 'u1',
  instrumentId: 'mes',
  dayIdOf: (date) => `day-${date}`,
  zonePoints: 4,
  sessionOf: () => 'Regular Session',
};

describe('a playbook line crossing into the tracker', () => {
  it('carries every touch already logged against it as the tracker counts them', () => {
    const marked = [level({ id: 'l1' })];
    const touches = [
      touch({ id: 't1', levelId: 'l1', outcome: 'returned' }),
      touch({ id: 't2', levelId: 'l1', outcome: 'returned' }),
      touch({ id: 't3', levelId: 'l1', outcome: 'never-returned', breakDirection: 'up' }),
      // Still being watched: a test that settled neither way, which the tracker holds as more
      // tests than decisions rather than as a failure.
      touch({ id: 't4', levelId: 'l1', outcome: 'watching' }),
    ];

    const { levels } = bridgeFromPlaybook(marked, touches, [], SOURCE);

    expect(levels).toHaveLength(1);
    expect(levels[0].touches).toBe(4);
    expect(levels[0].holds).toBe(2);
    expect(levels[0].breaks).toBe(1);
    expect(levels[0].breakDirection).toBe('up');
    // 13:35 UTC is 09:35 on the trader's own clock.
    expect(levels[0].hitTime).toBe('09:35');
  });

  it('leaves out a touch the trader set aside and every line that is not a level', () => {
    const marked = [
      level({ id: 'l1' }),
      level({ id: 'voided', price: 5700, resolution: 'void' }),
      level({ id: 'other', price: 5600, instrumentId: 'mnq' }),
      level({ id: 'undated', price: 5500, tradeDate: '' }),
      level({ id: 'priceless', price: 0 }),
    ];
    const touches = [
      touch({ id: 't1', levelId: 'l1', outcome: 'returned' }),
      touch({ id: 't2', levelId: 'l1', outcome: 'invalid' }),
    ];

    const { levels } = bridgeFromPlaybook(marked, touches, [], SOURCE);

    expect(levels.map((entry) => entry.price)).toEqual([5820]);
    // The invalid touch is not a test: the playbook's own rates exclude it, so this must too.
    expect(levels[0].touches).toBe(1);
    expect(levels[0].holds).toBe(1);
  });

  it('files a line with no chart on the default chart and says how many it did that to', () => {
    const { levels, untaggedCharts } = bridgeFromPlaybook(
      [level({ id: 'l1', timeframe: undefined })],
      [],
      [],
      SOURCE
    );

    expect(levels[0].timeframe).toBe(DEFAULT_MES_TIMEFRAME);
    expect(untaggedCharts).toBe(1);
  });

  it('leaves the direction untagged when two breaks disagree about it', () => {
    const touches = [
      touch({ id: 't1', levelId: 'l1', outcome: 'never-returned', breakDirection: 'up' }),
      touch({ id: 't2', levelId: 'l1', outcome: 'never-returned', breakDirection: 'down' }),
    ];

    const { levels } = bridgeFromPlaybook([level({ id: 'l1' })], touches, [], SOURCE);

    expect(levels[0].breaks).toBe(2);
    // The tracker holds one direction per line; picking one of two opposite breaks would be a
    // claim the record cannot support.
    expect(levels[0].breakDirection).toBe('');
  });

  it('skips what the tracker already holds and orders what is left by price', () => {
    const marked = [level({ id: 'a', price: 5820 }), level({ id: 'b', price: 5830 })];
    const existing = [mesRecord({ price: 5820 })];

    const { levels, skipped } = bridgeFromPlaybook(marked, [], existing, SOURCE);

    expect(skipped).toBe(1);
    expect(levels.map((entry) => entry.price)).toEqual([5830]);
  });

  it('folds the label a line came from into the note it arrives with', () => {
    const { levels } = bridgeFromPlaybook(
      [level({ id: 'l1', label: 'overnight high', notes: 'watch the retest' })],
      [],
      [],
      SOURCE
    );

    // The tracker has one free-text field and the playbook has two, so both of the trader's own
    // statements about the line arrive rather than the provenance being dropped.
    expect(levels[0].label).toBe('overnight high');
    expect(levels[0].notes).toBe('overnight high — watch the retest');
  });

  it('carries the test tally into a line whose outcome nobody recorded', () => {
    const { levels } = bridgeFromPlaybook([level({ id: 'l1', price: 5760 })], [], [], SOURCE);

    expect(levels[0].touches).toBe(0);
    expect(levels[0].hitTime).toBe('');
    // Nothing decided and nothing reached: no rate exists rather than a rate of zero.
    expect(bridgedLevelFigures(levels[0]).strength).toBeNull();
    expect(bridgedLevelFigures(levels[0]).grade).toBe('—');
  });
});

describe('a tracked line crossing into the playbook', () => {
  it('skips a line already marked for the same day, chart, side and price', () => {
    const records = [mesRecord({ price: 5820 }), mesRecord({ id: 'm2', price: 5810 })];
    const marked = [level({ id: 'a', price: 5820 })];

    const { levels, skipped } = bridgeFromMes(records, marked, { instrumentId: 'mes' });

    expect(skipped).toBe(1);
    expect(levels.map((entry) => entry.price)).toEqual([5810]);
  });

  it('treats the same price on another chart as a different line', () => {
    const records = [mesRecord({ price: 5820, timeframe: '1h' })];
    const marked = [level({ id: 'a', price: 5820, timeframe: '5m' })];

    const { levels } = bridgeFromMes(records, marked, { instrumentId: 'mes' });

    expect(levels.map((entry) => entry.timeframe)).toEqual(['1h']);
  });

  it('carries what the trader wrote against the line and leaves the figures behind', () => {
    const records = [mesRecord({ notes: 'overnight high', holds: 7, breaks: 3 })];

    const { levels } = bridgeFromMes(records, [], { instrumentId: 'mes' });

    expect(levels[0].notes).toBe('overnight high');
    expect(levels[0].label).toBe('');
  });
});

describe('stamping bridged lines into each record', () => {
  it('writes the tracker rows sanitised, so an impossible row cannot land', () => {
    const { levels } = bridgeFromPlaybook(
      [level({ id: 'l1' })],
      [
        touch({ id: 't1', levelId: 'l1', outcome: 'returned' }),
        touch({ id: 't2', levelId: 'l1', outcome: 'returned' }),
      ],
      [],
      SOURCE
    );

    const [record] = mesRecordsFromBridged(levels);

    expect(record.holds).toBe(2);
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBeGreaterThan(0);
    // The playbook records only that a line broke, never when, so the tracker's break clock is
    // left unset rather than invented.
    expect(record.breakTime).toBe('');
  });

  it('files an untested line with no hit time, so nothing claims price reached it', () => {
    const [record] = mesRecordsFromBridged([
      {
        date: '2026-09-22',
        timeframe: '5m',
        kind: 'support',
        price: 5700,
        label: '',
        notes: '',
        // A tally nobody decided, but a time that would be a lie: nothing reached this line.
        touches: 0,
        holds: 0,
        breaks: 0,
        breakDirection: '',
        hitTime: '09:35',
      },
    ]);

    expect(record.hitTime).toBe('');
    expect(record.timeframe).toBe('5m');
  });

  it('marks the playbook lines on the session that exists for each date', () => {
    const days: string[] = [];
    const marked = markedLevelsFromBridged(
      [
        {
          date: '2026-09-22',
          timeframe: '15m',
          kind: 'resistance',
          price: 5830,
          label: '',
          notes: 'overnight high',
          touches: 3,
          holds: 2,
          breaks: 1,
          breakDirection: 'up',
          hitTime: '09:35',
        },
        {
          date: '2026-09-23',
          timeframe: '1h',
          kind: 'support',
          price: 5750,
          label: '',
          notes: '',
          touches: 0,
          holds: 0,
          breaks: 0,
          breakDirection: '',
          hitTime: '',
        },
      ],
      {
        ...STAMP,
        dayIdOf: (date) => {
          days.push(date);
          return `day-${date}`;
        },
      }
    );

    expect(days).toEqual(['2026-09-22', '2026-09-23']);
    expect(marked[0].tradingDayId).toBe('day-2026-09-22');
    expect(marked[0].tradeDate).toBe('2026-09-22');
    expect(marked[0].timeframe).toBe('15m');
    expect(marked[0].notes).toBe('overnight high');
    expect(marked[0].source).toBe('carried');
    expect(marked[1].label).toBeUndefined();
    expect(marked[1].notes).toBeUndefined();
  });
});

describe('crossing the same lines twice', () => {
  it('adds nothing the second time, in either direction', () => {
    const marked = [level({ id: 'l1', price: 5820 }), level({ id: 'l2', price: 5760 })];
    const touches = [
      touch({ id: 't1', levelId: 'l1', outcome: 'returned' }),
      touch({ id: 't2', levelId: 'l2', outcome: 'never-returned' }),
    ];

    // Playbook -> tracker, then the same press again.
    const first = bridgeFromPlaybook(marked, touches, [], SOURCE);
    const tracked = mesRecordsFromBridged(first.levels);
    const second = bridgeFromPlaybook(marked, touches, tracked, SOURCE);
    expect(first.levels).toHaveLength(2);
    expect(second.levels).toHaveLength(0);
    expect(second.skipped).toBe(2);

    // Tracker -> playbook. The lines that came from the playbook are already marked there, so
    // only a line the tracker holds on its own is new to the playbook.
    const withTrackerOnly = [...tracked, mesRecord({ id: 'm9', price: 5900, timeframe: '1h' })];
    const backFirst = bridgeFromMes(withTrackerOnly, marked, { instrumentId: 'mes' });
    expect(backFirst.levels.map((entry) => entry.price)).toEqual([5900]);

    const backMarked = [...marked, ...markedLevelsFromBridged(backFirst.levels, STAMP)];
    const backSecond = bridgeFromMes(withTrackerOnly, backMarked, { instrumentId: 'mes' });
    expect(backSecond.levels).toHaveLength(0);
    expect(backSecond.skipped).toBe(3);
  });
});
