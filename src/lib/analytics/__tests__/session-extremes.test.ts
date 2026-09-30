import { describe, it, expect } from 'vitest';
import { SessionExtreme } from '../../../types';
import {
  buildExtremeDays,
  buildExtremeHourHistogram,
  buildOvernightHourPatterns,
  clockHour,
  findExtremeMatches,
  hourLabel,
  LEAN_THRESHOLD_PCT,
  MIN_PATTERN_SESSIONS,
  parseClock,
  sessionWindowForTime,
  summarizeExtremes,
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
    expect(days[0].overnightHigh).toEqual({ hour: 3, time: '03:00', price: 6012 });
    expect(days[0].overnightLow).toEqual({ hour: 5, time: '05:00', price: 5988 });
    expect(days[0].regularHigh).toEqual({ hour: 11, time: '11:00', price: 6020 });
    expect(days[0].regularLow).toEqual({ hour: 14, time: '14:00', price: 5995 });
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
      key: 'MES|high|3',
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
      'MES|high|4',
      'MCL|high|3',
      'MES|high|3',
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
