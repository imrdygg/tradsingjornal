import { describe, it, expect } from 'vitest';
import { SessionExtreme } from '../../../types';
import {
  buildDaysByTimeframe,
  buildExtremeDays,
  buildExtremeHourHistogram,
  buildOvernightHourPatterns,
  clockHour,
  defaultLevelType,
  findExtremeMatches,
  findRatingEdges,
  hourLabel,
  LEAN_THRESHOLD_PCT,
  levelTypeOf,
  MIN_PATTERN_SESSIONS,
  MIN_RATED,
  parseClock,
  sessionWindowForTime,
  summarizeExtremes,
  summarizeRatings,
} from '../session-extremes';

function extreme(over: Partial<SessionExtreme> = {}): SessionExtreme {
  const time = over.time ?? '03:00';
  return {
    id: `${over.symbol ?? 'MES'}-${over.tradeDate ?? '2026-09-28'}-${over.kind ?? 'high'}-${
      over.window ?? 'overnight'
    }-${time}`,
    userId: 'u',
    tradeDate: '2026-09-28',
    instrumentId: 'mes',
    symbol: 'MES',
    kind: 'high',
    time,
    price: 6000,
    window: sessionWindowForTime(time) ?? 'overnight',
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    ...over,
  };
}

/** One judged session: an overnight extreme, and the regular extreme that followed it. */
function session(
  day: number,
  symbol: string,
  kind: 'high' | 'low',
  overnightHour: number,
  overnightPrice: number,
  regularPrice: number
): SessionExtreme[] {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  const overnightTime = `${String(overnightHour).padStart(2, '0')}:00`;
  return [
    extreme({ tradeDate: date, symbol, kind, time: overnightTime, price: overnightPrice }),
    extreme({ tradeDate: date, symbol, kind, time: '10:00', price: regularPrice }),
  ];
}

describe('parseClock', () => {
  it('reads a clock time into minutes past midnight', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('03:15')).toBe(195);
    expect(parseClock('9:30')).toBe(570);
    expect(parseClock('23:59')).toBe(1439);
  });

  it('refuses anything that is not a clock time', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('03:60')).toBeNull();
    expect(parseClock('3')).toBeNull();
    expect(parseClock('ab:cd')).toBeNull();
  });
});

describe('sessionWindowForTime', () => {
  it('puts the pre-open hours and the evening in the overnight window', () => {
    expect(sessionWindowForTime('18:00')).toBe('overnight');
    expect(sessionWindowForTime('23:59')).toBe('overnight');
    expect(sessionWindowForTime('00:00')).toBe('overnight');
    expect(sessionWindowForTime('09:29')).toBe('overnight');
  });

  it('puts the regular session from the open to the close', () => {
    expect(sessionWindowForTime('09:30')).toBe('regular');
    expect(sessionWindowForTime('12:00')).toBe('regular');
    expect(sessionWindowForTime('15:59')).toBe('regular');
  });

  it('refuses the daily halt rather than filing it in either session', () => {
    expect(sessionWindowForTime('16:00')).toBeNull();
    expect(sessionWindowForTime('17:59')).toBeNull();
    expect(sessionWindowForTime('nonsense')).toBeNull();
  });
});

describe('clockHour and hourLabel', () => {
  it('reads the hour out of a time', () => {
    expect(clockHour('03:45')).toBe(3);
    expect(clockHour('23:59')).toBe(23);
    expect(clockHour('')).toBeNull();
  });

  it('names an hour the way a trader reads a clock', () => {
    expect(hourLabel(0)).toBe('12am');
    expect(hourLabel(3)).toBe('3am');
    expect(hourLabel(11)).toBe('11am');
    expect(hourLabel(12)).toBe('12pm');
    expect(hourLabel(23)).toBe('11pm');
  });
});

describe('buildExtremeDays', () => {
  it('pairs the four slots of one session by symbol and date', () => {
    const days = buildExtremeDays([
      extreme({ kind: 'high', time: '03:00', price: 6012 }),
      extreme({ kind: 'low', time: '05:00', price: 5988 }),
      extreme({ kind: 'high', time: '11:00', price: 6020 }),
      extreme({ kind: 'low', time: '14:00', price: 5995 }),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0].timeframe).toBe('1m');
    // A high defaults to resistance and a low to support unless the trader flips it.
    expect(days[0].overnightHigh).toMatchObject({
      hour: 3,
      time: '03:00',
      price: 6012,
      levelType: 'resistance',
    });
    expect(days[0].overnightLow).toMatchObject({
      hour: 5,
      time: '05:00',
      price: 5988,
      levelType: 'support',
    });
    expect(days[0].regularHigh).toMatchObject({ hour: 11, price: 6020 });
    expect(days[0].regularLow).toMatchObject({ hour: 14, price: 5995 });
  });

  it('keeps one print per slot, taking the more extreme of two', () => {
    const days = buildExtremeDays([
      extreme({ kind: 'high', time: '02:00', price: 6005 }),
      extreme({ kind: 'high', time: '04:00', price: 6018 }),
      extreme({ kind: 'low', time: '02:00', price: 5990 }),
      extreme({ kind: 'low', time: '04:00', price: 5975 }),
    ]);

    expect(days[0].overnightHigh?.price).toBe(6018);
    expect(days[0].overnightLow?.price).toBe(5975);
  });

  it('breaks a tie on price with the earlier clock time', () => {
    const days = buildExtremeDays([
      extreme({ kind: 'high', time: '04:00', price: 6005 }),
      extreme({ kind: 'high', time: '02:00', price: 6005 }),
    ]);

    expect(days[0].overnightHigh?.time).toBe('02:00');
  });

  it('leaves a record with an unreadable time out of the pairing', () => {
    const days = buildExtremeDays([
      extreme({ kind: 'high', time: '03:00' }),
      extreme({ kind: 'low', time: 'nonsense' }),
    ]);

    expect(days[0].overnightHigh).not.toBeNull();
    expect(days[0].overnightLow).toBeNull();
  });

  it('sorts sessions oldest first, and symbols within a date', () => {
    const days = buildExtremeDays([
      extreme({ tradeDate: '2026-09-28', symbol: 'MNQ' }),
      extreme({ tradeDate: '2026-09-26', symbol: 'MES' }),
      extreme({ tradeDate: '2026-09-28', symbol: 'MES' }),
    ]);

    expect(days.map((day) => `${day.tradeDate}|${day.symbol}`)).toEqual([
      '2026-09-26|MES',
      '2026-09-28|MES',
      '2026-09-28|MNQ',
    ]);
  });
});

describe('summarizeExtremes', () => {
  it('counts sessions, extremes and the span, and reports unreadable records', () => {
    const summary = summarizeExtremes([
      extreme({ tradeDate: '2026-09-26', symbol: 'MES' }),
      extreme({ tradeDate: '2026-09-28', symbol: 'MES', kind: 'low' }),
      extreme({ tradeDate: '2026-09-28', symbol: 'MCL', time: 'bad' }),
    ]);

    expect(summary.sessions).toBe(2);
    expect(summary.points).toBe(2);
    // MCL's only record had an unreadable time, so it is counted as unreadable rather than
    // as an instrument the tally covers.
    expect(summary.symbols).toEqual(['MES']);
    expect(summary.firstDate).toBe('2026-09-26');
    expect(summary.lastDate).toBe('2026-09-28');
    expect(summary.unreadable).toBe(1);
  });
});

describe('buildOvernightHourPatterns', () => {
  it('counts when the regular session kept the overnight high', () => {
    // Four sessions where the 3am overnight high held, one where the regular session
    // extended past it.
    const days = buildExtremeDays([
      ...[1, 2, 3, 4].flatMap((day) => session(day, 'MES', 'high', 3, 6000, 5990)),
      ...session(5, 'MES', 'high', 3, 6000, 6012),
    ]);

    const patterns = buildOvernightHourPatterns(days);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      key: 'MES|1m|high|3',
      sessions: 5,
      held: 4,
      takenOut: 1,
      undecided: 0,
      heldRate: 80,
      enoughData: true,
    });
    expect(patterns[0].medianExtensionPoints).toBe(12);
  });

  it('reads the low the other way round: the low holds when price never goes under it', () => {
    const days = buildExtremeDays([
      ...[1, 2].flatMap((day) => session(day, 'MES', 'low', 5, 5980, 5995)),
      ...session(3, 'MES', 'low', 5, 5980, 5960),
    ]);

    const patterns = buildOvernightHourPatterns(days);
    expect(patterns[0]).toMatchObject({ held: 2, takenOut: 1, heldRate: 66.7 });
    expect(patterns[0].medianExtensionPoints).toBe(20);
  });

  it('excludes a session it cannot compare instead of counting it as a hold', () => {
    const days = buildExtremeDays([
      ...session(1, 'MES', 'high', 3, 6000, 5990),
      extreme({ tradeDate: '2026-09-02', kind: 'high', time: '03:00', price: 6000 }),
    ]);

    const patterns = buildOvernightHourPatterns(days);
    expect(patterns[0]).toMatchObject({ sessions: 2, held: 1, takenOut: 0, undecided: 1, heldRate: 100 });
  });

  it('withholds a rate below the sample floor and is honest about the count', () => {
    const days = buildExtremeDays(
      [1, 2].flatMap((day) => session(day, 'MES', 'high', 3, 6000, 5990))
    );

    const patterns = buildOvernightHourPatterns(days);
    expect(patterns[0].heldRate).toBe(100);
    expect(patterns[0].enoughData).toBe(false);

    const strict = buildOvernightHourPatterns(days, { minSessions: 2 });
    expect(strict[0].enoughData).toBe(true);
    expect(MIN_PATTERN_SESSIONS).toBe(5);
  });

  it('keeps symbols and hours in separate buckets, readable ones first', () => {
    const days = buildExtremeDays([
      // A thin bucket with a perfect rate beside a readable one with a lower rate.
      ...session(1, 'MES', 'high', 3, 6000, 5990),
      ...session(1, 'MCL', 'high', 3, 70, 69),
      ...[2, 3, 4].flatMap((day) => session(day, 'MES', 'high', 4, 6000, 5990)),
      ...session(5, 'MES', 'high', 4, 6000, 6010),
      ...session(6, 'MES', 'high', 4, 6000, 6010),
    ]);

    const patterns = buildOvernightHourPatterns(days);
    // The readable 5-session bucket (3 held of 5) leads despite its lower rate; the two thin
    // ones follow, both at 100%, separated by their key.
    expect(patterns.map((pattern) => pattern.key)).toEqual([
      'MES|1m|high|4',
      'MCL|1m|high|3',
      'MES|1m|high|3',
    ]);
    expect(patterns[0]).toMatchObject({ held: 3, takenOut: 2, heldRate: 60, enoughData: true });
    expect(patterns[1].enoughData).toBe(false);
  });

  it('lists the sample dates newest first', () => {
    const days = buildExtremeDays([
      ...session(1, 'MES', 'high', 3, 6000, 5990),
      ...session(3, 'MES', 'high', 3, 6000, 5990),
      ...session(2, 'MES', 'high', 3, 6000, 5990),
    ]);

    expect(buildOvernightHourPatterns(days)[0].tradeDates).toEqual([
      '2026-09-03',
      '2026-09-02',
      '2026-09-01',
    ]);
  });
});

describe('timeframes', () => {
  it('defaults a record saved before timeframes existed to the 1-minute chart', () => {
    const days = buildExtremeDays([extreme({ kind: 'high', time: '03:00' })]);
    expect(days[0].timeframe).toBe('1m');
  });

  it('pairs each chart separately, so a 30m print never mixes with a 1m one', () => {
    const extremes = [
      extreme({ kind: 'high', time: '03:00', price: 6000, timeframe: '1m' }),
      extreme({ kind: 'high', time: '03:10', price: 6010, timeframe: '30m' }),
      extreme({ kind: 'high', time: '11:00', price: 5990, timeframe: '1m' }),
    ];

    const oneMinute = buildExtremeDays(extremes, { timeframe: '1m' });
    expect(oneMinute).toHaveLength(1);
    expect(oneMinute[0].overnightHigh?.price).toBe(6000);
    expect(oneMinute[0].regularHigh?.price).toBe(5990);

    const thirty = buildExtremeDays(extremes, { timeframe: '30m' });
    expect(thirty).toHaveLength(1);
    expect(thirty[0].overnightHigh?.price).toBe(6010);
    expect(thirty[0].regularHigh).toBeNull();

    expect(buildDaysByTimeframe(extremes)).toHaveLength(2);
  });

  it('keeps the same hour on two charts apart in the pattern read', () => {
    const extremes = [
      ...[1, 2, 3, 4, 5].flatMap((day) => [
        ...session(day, 'MES', 'high', 3, 6000, 5990).map((record) => ({ ...record, timeframe: '1m' as const })),
      ]),
      ...session(1, 'MES', 'high', 3, 6000, 6030).map((record) => ({ ...record, timeframe: '30m' as const })),
    ];

    const patterns = buildOvernightHourPatterns(buildDaysByTimeframe(extremes));
    expect(patterns.map((pattern) => `${pattern.key}:${pattern.heldRate}`)).toEqual([
      'MES|1m|high|3:100',
      'MES|30m|high|3:0',
    ]);
  });
});

describe('level types', () => {
  it('defaults a high to resistance and a low to support', () => {
    expect(defaultLevelType('high')).toBe('resistance');
    expect(defaultLevelType('low')).toBe('support');
  });

  it('keeps a flipped side, because that is the case worth recording', () => {
    expect(levelTypeOf({ kind: 'low', levelType: 'resistance' })).toBe('resistance');
    expect(levelTypeOf({ kind: 'high' })).toBe('resistance');
  });

  it('carries the picked side through to the pairing and the match', () => {
    const flipped = { kind: 'low' as const, levelType: 'resistance' as const };
    const levels = [1, 2, 3, 4, 5].flatMap((day) => [
      extreme({ tradeDate: `2026-09-0${day}`, ...flipped, time: '05:00', price: 5980 }),
      extreme({ tradeDate: `2026-09-0${day}`, ...flipped, time: '10:00', price: 5995 }),
    ]);

    const days = buildExtremeDays(levels);
    expect(days[3].overnightLow?.levelType).toBe('resistance');
    const matches = findExtremeMatches(days, '2026-09-05');
    expect(matches[0].levelType).toBe('resistance');
  });
});

describe('rating the result', () => {
  /** A print carrying one reading at a horizon. */
  const rated = (
    day: number,
    outcome: 'held' | 'taken-out' | 'chopped',
    options: {
      horizon?: '30m' | '1h' | 'eod';
      grade?: number;
      levelType?: 'support' | 'resistance';
      timeframe?: '1m' | '30m' | '1h';
      time?: string;
      kind?: 'high' | 'low';
    } = {}
  ) =>
    extreme({
      tradeDate: `2026-09-${String(day).padStart(2, '0')}`,
      kind: options.kind ?? 'high',
      levelType: options.levelType,
      timeframe: options.timeframe,
      time: options.time ?? '03:00',
      id: `rated-${day}-${options.horizon ?? 'eod'}-${options.levelType ?? 'default'}-${
        options.timeframe ?? '1m'
      }-${options.time ?? '03:00'}-${options.kind ?? 'high'}`,
      ratings: [
        {
          horizon: options.horizon ?? 'eod',
          outcome,
          grade: options.grade,
          ratedAt: '2026-09-20T20:00:00.000Z',
        },
      ],
    });

  it('counts the readings and treats a chopped one as not held', () => {
    const stats = summarizeRatings([
      rated(1, 'held'),
      rated(2, 'held'),
      rated(3, 'taken-out'),
      rated(4, 'chopped'),
    ]);

    expect(stats).toMatchObject({ rated: 4, held: 2, takenOut: 1, chopped: 1, heldRate: 50 });
    expect(stats.enoughData).toBe(false);
    expect(MIN_RATED).toBe(5);
  });

  it('averages the grades apart from the outcomes', () => {
    const stats = summarizeRatings([
      rated(1, 'held', { grade: 5 }),
      rated(2, 'taken-out', { grade: 4 }),
      rated(3, 'held'),
    ]);

    expect(stats.graded).toBe(2);
    expect(stats.avgGrade).toBe(4.5);
    expect(stats.heldRate).toBe(66.7);
  });

  it('reads the same print at each horizon separately', () => {
    const print = extreme({
      tradeDate: '2026-09-01',
      ratings: [
        { horizon: '30m', outcome: 'held', ratedAt: '2026-09-01T10:00:00.000Z' },
        { horizon: 'eod', outcome: 'taken-out', ratedAt: '2026-09-01T20:00:00.000Z' },
      ],
    });

    expect(summarizeRatings([print]).rated).toBe(2);
    expect(summarizeRatings([print], { horizon: '30m' })).toMatchObject({
      rated: 1,
      held: 1,
      heldRate: 100,
    });
    expect(summarizeRatings([print], { horizon: 'eod' })).toMatchObject({
      rated: 1,
      held: 0,
      heldRate: 0,
    });
  });

  it('lets the last reading of a horizon win, and ignores an unusable one', () => {
    const print = extreme({
      tradeDate: '2026-09-01',
      ratings: [
        { horizon: '30m', outcome: 'held', ratedAt: '2026-09-01T10:00:00.000Z' },
        { horizon: '30m', outcome: 'taken-out', ratedAt: '2026-09-01T11:00:00.000Z' },
        { horizon: '1h', outcome: 'held', grade: 9, ratedAt: '2026-09-01T11:30:00.000Z' },
      ],
    });
    // A horizon that is not one of the three is not a reading at all.
    print.ratings!.push({
      horizon: 'week' as never,
      outcome: 'held',
      ratedAt: '2026-09-01T12:00:00.000Z',
    });

    const stats = summarizeRatings([print]);
    expect(stats.rated).toBe(2);
    expect(stats.takenOut).toBe(1);
    expect(stats.avgGrade).toBe(9);
  });

  it('reports nothing rather than a zero rate when nothing is rated', () => {
    expect(summarizeRatings([extreme()])).toMatchObject({
      rated: 0,
      heldRate: null,
      avgGrade: null,
    });
  });

  it('buckets the readings by side, chart, horizon and hour, readable first', () => {
    const support = [1, 2, 3, 4, 5].map((day) =>
      rated(day, 'held', { levelType: 'support', kind: 'low', time: '05:00' })
    );
    const resistance = [1, 2].map((day) =>
      rated(day, 'taken-out', { levelType: 'resistance', timeframe: '30m' })
    );

    // A floor of zero keeps the tallies, which is how the digest and the cards read them.
    const buckets = findRatingEdges([...support, ...resistance], { minRated: 0 });
    const keys = buckets.map((bucket) => bucket.key);

    // Every family is represented; readable conditions lead and the tallies follow.
    expect(keys).toContain('all');
    expect(keys).toContain('level:support');
    expect(keys).toContain('level:resistance');
    expect(keys).toContain('tf:30m');      expect(keys).toContain('horizon:eod');
    expect(keys).toContain('hour:5');
    expect(keys).toContain('hour:3');
    expect(keys).toContain('MES:support');

    const supportBucket = buckets.find((bucket) => bucket.key === 'level:support')!;
    expect(supportBucket.stats).toMatchObject({ rated: 5, held: 5, heldRate: 100, enoughData: true });
    expect(supportBucket.levelType).toBe('support');

    const thin = buckets.find((bucket) => bucket.key === 'level:resistance')!;
    expect(thin.stats.rated).toBeLessThan(MIN_RATED);
    // A clean 5 of 5 sorts above the pooled record, and every readable bucket sorts above
    // every thin one whatever their rates.
    const all = buckets.find((bucket) => bucket.key === 'all')!;
    expect(all.stats.heldRate).toBe(71.4);
    expect(keys.indexOf('level:support')).toBeLessThan(keys.indexOf('all'));
    expect(keys.indexOf('all')).toBeLessThan(keys.indexOf('level:resistance'));

    // A thin bucket with a single reading is dropped rather than shown as a rate.
    const minuteChart = findRatingEdges([rated(1, 'held', { timeframe: '1h' })]);
    expect(minuteChart.map((bucket) => bucket.key)).toEqual(['all']);
  });
});

describe('findExtremeMatches', () => {
  /** Sessions where the 3am overnight high was kept — the regular high stayed below it. */
  const keptDays = (days: number[]) =>
    days.flatMap((day) => session(day, 'MES', 'high', 3, 6000, 5990));

  /** Sessions where the regular session extended past the same 3am high. */
  const takenOutDays = (days: number[]) =>
    days.flatMap((day) => session(day, 'MES', 'high', 3, 6000, 6030));

  it('matches today’s print to the hour record and names the lean', () => {
    const days = buildExtremeDays([...keptDays([1, 2, 3, 4]), ...keptDays([5])]);

    const matches = findExtremeMatches(days, '2026-09-05');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      symbol: 'MES',
      kind: 'high',
      hour: 3,
      time: '03:00',
      price: 6000,
      lean: 'kept',
      todayTakenOut: false,
      todayRegularPrice: 5990,
    });
    expect(matches[0].pattern.heldRate).toBe(100);
  });

  it('says nothing when today has no log at all, or no overnight print yet', () => {
    const days = buildExtremeDays(keptDays([1, 2, 3, 4, 5]));
    expect(findExtremeMatches(days, '2026-09-06')).toEqual([]);

    // A day that exists but only carries its regular-session extreme has nothing to match.
    const partial = buildExtremeDays([
      ...keptDays([1, 2, 3, 4, 5]),
      extreme({ tradeDate: '2026-09-06', kind: 'high', time: '11:00', price: 6001 }),
    ]);
    expect(findExtremeMatches(partial, '2026-09-06')).toEqual([]);
  });

  it('refuses to raise an hour that is still a tally', () => {
    const days = buildExtremeDays([...keptDays([1, 2]), ...keptDays([3])]);
    expect(findExtremeMatches(days, '2026-09-03')).toEqual([]);
  });

  it('names the other side when that is the way the log leans', () => {
    const days = buildExtremeDays([...takenOutDays([1, 2, 3, 4]), ...takenOutDays([5])]);

    const matches = findExtremeMatches(days, '2026-09-05');
    expect(matches[0].lean).toBe('taken-out');
    expect(matches[0].todayTakenOut).toBe(true);
  });

  it('calls a coin toss a split rather than a lean', () => {
    const days = buildExtremeDays([
      ...keptDays([1, 2, 3]),
      ...takenOutDays([4, 5, 6]),
    ]);

    const matches = findExtremeMatches(days, '2026-09-06');
    expect(matches[0].pattern.heldRate).toBe(50);
    expect(matches[0].lean).toBe('split');
    expect(LEAN_THRESHOLD_PCT).toBe(60);
  });

  it('leads with the lean, and reports today’s regular extreme when it exists', () => {
    const days = buildExtremeDays([
      // The 3am high was kept in all five sessions.
      ...keptDays([1, 2, 3, 4, 5]),
      // The 5am low was taken out in four of them and kept in the fifth, and today's own
      // regular low has not gone under it.
      ...[1, 2, 3, 4].flatMap((day) => session(day, 'MES', 'low', 5, 5980, 5970)),
      ...session(5, 'MES', 'low', 5, 5980, 5990),
    ]);

    const matches = findExtremeMatches(days, '2026-09-05');
    expect(matches.map((match) => `${match.kind}:${match.lean}`)).toEqual([
      'high:kept',
      'low:taken-out',
    ]);
    expect(matches[1]).toMatchObject({ todayTakenOut: false, todayRegularPrice: 5990 });
    expect(matches[1].pattern.takenOut).toBe(4);
  });
});

describe('buildExtremeHourHistogram', () => {
  it('counts overnight prints per clock hour, per symbol and side', () => {
    const days = buildExtremeDays([
      extreme({ tradeDate: '2026-09-01', kind: 'high', time: '03:00' }),
      extreme({ tradeDate: '2026-09-02', kind: 'high', time: '03:00' }),
      extreme({ tradeDate: '2026-09-03', kind: 'high', time: '05:00' }),
      extreme({ tradeDate: '2026-09-03', kind: 'low', time: '05:00' }),
    ]);

    const rows = buildExtremeHourHistogram(days);
    const highRow = rows.find((row) => row.symbol === 'MES' && row.kind === 'high');
    expect(highRow?.sessions).toBe(3);
    expect(highRow?.hours[3]).toBe(2);
    expect(highRow?.hours[5]).toBe(1);
    expect(highRow?.busiestHour).toBe(3);

    // The regular session's own extreme is not part of the overnight picture.
    const lowRow = rows.find((row) => row.symbol === 'MES' && row.kind === 'low');
    expect(lowRow?.sessions).toBe(1);
    expect(lowRow?.busiestHour).toBe(5);
  });

  it('ignores a regular-session print when counting overnight hours', () => {
    const days = buildExtremeDays([extreme({ kind: 'high', time: '11:00' })]);
    expect(buildExtremeHourHistogram(days)).toHaveLength(0);
  });
});
