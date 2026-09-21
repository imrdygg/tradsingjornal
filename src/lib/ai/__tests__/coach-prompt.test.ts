import { describe, it, expect } from 'vitest';
import {
  buildCoachPrompt,
  COACH_GUARDRAILS,
  COACH_MODES,
  COACH_RESPONSE_SHAPES,
  formatDigestForPrompt,
  formatTradeForPrompt,
  isCoachMode,
  parseCoachResponse,
} from '../coach-prompt';
import type { CoachTradeFacts } from '../coach-types';
import { buildJournalDigest } from '../journal-digest';
import type { MarketBrief } from '../market-data';
import { DailyReview, DailyReviewQuestions, Trade, TradingDay } from '../../../types';
import { DEFAULT_INSTRUMENTS } from '../../trading/instruments';

const ALL_YES: DailyReviewQuestions = {
  followedSetups: 'yes',
  followedPredeterminedRisk: 'yes',
  followedStops: 'yes',
  chasedEntries: 'no',
  revengeTraded: 'no',
  addedUnnecessaryRisk: 'no',
  movedStopsEmotion: 'no',
  letWinnersWork: 'yes',
  stoppedWhenShould: 'yes',
};

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
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
    entryReason: 'Reclaimed the opening range',
    initialRisk: 50,
    grossPnL: 50,
    netPnL: 45,
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
    marketBias: 'bullish',
    watchedSetups: ['Breakout'],
    importantLevels: [],
    waitingFor: 'Retest of the open',
    stayOutIf: 'Chop inside the prior range',
    planChanges: [],
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<DailyReview> = {}): DailyReview {
  return {
    id: 'r1',
    userId: 'u1',
    tradingDayId: 'd1',
    questions: ALL_YES,
    disciplineScore: 100,
    scoringDetails: [],
    didWell: 'Waited for the retest.',
    didPoorly: 'Sized up after a win.',
    tomorrowFocus: 'Hold the planned size.',
    createdAt: '2026-09-18T20:00:00.000Z',
    updatedAt: '2026-09-18T20:00:00.000Z',
    ...overrides,
  };
}

const digestFor = (overrides: Partial<Parameters<typeof buildJournalDigest>[0]> = {}) =>
  buildJournalDigest({
    trades: [],
    tradingDays: [],
    reviews: [],
    setups: [],
    instruments: DEFAULT_INSTRUMENTS,
    todayTradeDate: '2026-09-18',
    timezone: 'America/New_York',
    ...overrides,
  });

describe('coach guardrails', () => {
  it('forbids market claims outright', () => {
    expect(COACH_GUARDRAILS).toContain('NO MARKET DATA');
    expect(COACH_GUARDRAILS).toContain('NEVER predict');
    expect(COACH_GUARDRAILS).toContain('never tell them to buy, sell, hold');
    expect(COACH_GUARDRAILS).toContain('NEVER invent');
  });

  it('requires numbers to be cited and thin evidence to be admitted', () => {
    expect(COACH_GUARDRAILS).toContain('CITE THE NUMBERS');
    expect(COACH_GUARDRAILS).toContain('RESPECT THIN EVIDENCE');
  });

  it('keeps the ban on empty motivation from being softened', () => {
    expect(COACH_GUARDRAILS).toContain('you got this');
    expect(COACH_GUARDRAILS).toContain('hustle slogans');
  });

  it('demands bare JSON so the response can be parsed', () => {
    expect(COACH_GUARDRAILS).toContain('single JSON object and nothing else');
    expect(COACH_GUARDRAILS).toContain('No markdown fences');
  });
});

describe('isCoachMode', () => {
  it('accepts the six real modes and nothing else', () => {
    for (const mode of ['brief', 'weekly', 'trade', 'prep', 'postclose', 'planreview']) {
      expect(isCoachMode(mode)).toBe(true);
    }
    expect(isCoachMode('market')).toBe(false);
    expect(isCoachMode('checkpoint')).toBe(false);
    expect(isCoachMode(undefined)).toBe(false);
    expect(isCoachMode(42)).toBe(false);
  });
});

describe('checkpoint modes', () => {
  it('asks the morning checkpoint for a preparation brief, not a summary', () => {
    const { userPrompt } = buildCoachPrompt('prep', digestFor());
    expect(userPrompt).toContain('Prepare this trader for today');
    expect(userPrompt).toContain('"yesterdayLesson"');
    expect(userPrompt).toContain('"howToApproach"');
    expect(userPrompt).toContain('"watchOutFor"');
    expect(userPrompt).toContain('"planGaps"');
    expect(userPrompt).toContain('Do not repeat a general performance summary');
  });

  it('asks the post-close checkpoint to compare plan against what happened', () => {
    const { userPrompt } = buildCoachPrompt('postclose', digestFor());
    expect(userPrompt).toContain('Review the session that has just finished');
    expect(userPrompt).toContain('"whatHappened"');
    expect(userPrompt).toContain('"wentWell"');
    expect(userPrompt).toContain('"wentWrong"');
    expect(userPrompt).toContain('"tomorrowAction"');
  });

  it('tells the post-close checkpoint to say when the review is not done', () => {
    expect(COACH_RESPONSE_SHAPES.postclose).toContain('end-of-day review has not been completed');
  });

  it('still applies the no-market-data guardrails to the checkpoints', () => {
    expect(buildCoachPrompt('prep', digestFor()).systemInstruction).toBe(COACH_GUARDRAILS);
    expect(buildCoachPrompt('postclose', digestFor()).systemInstruction).toBe(COACH_GUARDRAILS);
  });

  it('parses a valid morning prep response', () => {
    const payload = {
      headline: 'Protect the second half of the session',
      yesterdayLesson: 'You cut the winner early again.',
      howToApproach: 'Take the first setup and then stop.',
      watchOutFor: ['Moved the stop on emotion 2x this week'],
      planGaps: ['No watched setups recorded', 'No important levels'],
      motivation: 'Five days of logging without a gap.',
    };
    expect(parseCoachResponse('prep', payload)).toEqual(payload);
  });

  it('rejects a morning prep response missing the lesson it must carry forward', () => {
    expect(() =>
      parseCoachResponse('prep', {
        headline: 'h',
        howToApproach: 'a',
        watchOutFor: [],
        planGaps: [],
        motivation: 'm',
      })
    ).toThrow(/yesterdayLesson/);
  });

  it('parses a valid post-close response and defaults absent lists to empty', () => {
    const result = parseCoachResponse('postclose', {
      headline: 'Plan held, size did not',
      whatHappened: 'Two trades, net -$180.',
      tomorrowAction: 'Stop after the second loss.',
      motivation: 'You stuck to the sessions you planned.',
    }) as { wentWell: string[]; wentWrong: string[]; rulesBroken: string[] };

    expect(result.wentWell).toEqual([]);
    expect(result.wentWrong).toEqual([]);
    expect(result.rulesBroken).toEqual([]);
  });

  it('rejects a post-close response with no action for tomorrow', () => {
    expect(() =>
      parseCoachResponse('postclose', {
        headline: 'h',
        whatHappened: 'w',
        wentWell: [],
        wentWrong: [],
        rulesBroken: [],
        motivation: 'm',
      })
    ).toThrow(/tomorrowAction/);
  });
});

describe('formatDigestForPrompt', () => {
  it('states plainly when nothing has been recorded', () => {
    const text = formatDigestForPrompt(digestFor());
    expect(text).toContain('No closed trades recorded.');
    expect(text).toContain('No end-of-day reviews completed');
    expect(text).toContain('No plan has been recorded for today yet.');
  });

  it('flags thin evidence so the model cannot mistake it for a finding', () => {
    const text = formatDigestForPrompt(digestFor({ trades: [makeTrade()] }));
    expect(text).toContain('EVIDENCE LEVEL: THIN');
  });

  it('passes every caveat through verbatim', () => {
    const digest = digestFor({ trades: [makeTrade({ source: 'tradovate_csv' })] });
    const text = formatDigestForPrompt(digest);
    for (const caveat of digest.dataSufficiency.caveats) {
      expect(text).toContain(caveat);
    }
  });

  it('includes the actual figures the coach is allowed to quote', () => {
    const text = formatDigestForPrompt(
      digestFor({ trades: [makeTrade({ netPnL: 45, rMultiple: 1 })] })
    );
    expect(text).toContain('$45');
    expect(text).toContain('expectancy');
  });

  it('never introduces market vocabulary that the model could latch onto', () => {
    const text = formatDigestForPrompt(digestFor({ trades: [makeTrade()] }));
    for (const word of ['support', 'resistance', 'current price', "today's high", 'forecast']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it("includes the trader's own words", () => {
    const text = formatDigestForPrompt(digestFor({ trades: [makeTrade()] }));
    expect(text).toContain('Reclaimed the opening range');
  });

  it("includes today's plan so the brief can compare plan against reality", () => {
    const text = formatDigestForPrompt(
      digestFor({ tradingDays: [makeDay()], todayTradeDate: '2026-09-18' })
    );
    expect(text).toContain('Retest of the open');
    expect(text).toContain('Chop inside the prior range');
    expect(text).toContain('Breakout');
  });

  it('reports plan breaches in the plan-versus-reality section', () => {
    const text = formatDigestForPrompt(
      digestFor({
        trades: [makeTrade({ netPnL: -150 })],
        tradingDays: [makeDay({ plannedLossLimit: 100 })],
      })
    );
    expect(text).toContain('Days that lost more than the planned loss limit: 1');
    expect(text).toContain('$50');
  });
});

describe('planreview mode', () => {
  const marketBrief: MarketBrief = {
    ok: true,
    fetchedAt: new Date().toISOString(),
    maxAgeSeconds: 60,
    quotes: [
      { symbol: 'SPY', label: 'S&P 500', changePercent: 0.4, price: 580, previousClose: 577.7 },
      { symbol: 'XLK', label: 'Technology', changePercent: 1.2, price: 200, previousClose: 197.6 },
      { symbol: 'XLE', label: 'Energy', changePercent: -1.1, price: 80, previousClose: 80.9 },
    ],
  };

  it('appends the live sector read only in planreview mode', () => {
    const withMarket = buildCoachPrompt('planreview', digestFor(), undefined, marketBrief);
    expect(withMarket.userPrompt).toContain("TODAY'S MARKET READ");
    expect(withMarket.userPrompt).toContain('+1.20%');

    for (const mode of ['brief', 'weekly', 'prep', 'postclose', 'trade'] as const) {
      const other = buildCoachPrompt(mode, digestFor(), undefined, marketBrief);
      expect(other.userPrompt).not.toContain("TODAY'S MARKET READ");
    }
  });

  it('extends the guardrails with the market rules instead of replacing them', () => {
    const { systemInstruction } = buildCoachPrompt('planreview', digestFor(), undefined, marketBrief);
    expect(systemInstruction).toContain('NO MARKET DATA');
    expect(systemInstruction).toContain('LIVE SECTOR DATA');
    expect(systemInstruction).toContain('Never flatter a plan into ready');
    // Non-market modes keep the untouched guardrails.
    expect(buildCoachPrompt('brief', digestFor()).systemInstruction).toBe(COACH_GUARDRAILS);
  });

  it('asks the coach to judge the plan, not to predict the market', () => {
    const { userPrompt } = buildCoachPrompt('planreview', digestFor(), undefined, marketBrief);
    expect(userPrompt).toContain('honest opinion');
    expect(userPrompt).toContain('never tell them to take, size or skip trades');
    expect(userPrompt).toContain('"verdict"');
    expect(userPrompt).toContain('"planGaps"');
    expect(userPrompt).toContain('"marketRead"');
  });

  it('parses a valid planreview response and normalises the verdict', () => {
    const result = parseCoachResponse('planreview', {
      headline: 'Plan is coherent, bias is one-sided',
      marketRead: '7 of 11 sectors up, tech leads at +1.20%.',
      alignment: 'Your bullish bias agrees with breadth.',
      riskCheck: '$100 limit against 2 contracts is within your recent norms.',
      planGaps: ['No levels marked'],
      watchFor: ['Opening range before entries'],
      verdict: 'READY',
      oneFix: '',
    }) as { verdict: string; oneFix: string };
    expect(result.verdict).toBe('ready');
    expect(result.oneFix).toBe('');
  });

  it('demands a fix unless the verdict is ready, and falls back to shaky on a nonsense verdict', () => {
    const base = {
      headline: 'h',
      marketRead: 'm',
      alignment: 'a',
      riskCheck: 'r',
      planGaps: [],
      watchFor: [],
    };
    expect(() => parseCoachResponse('planreview', { ...base, verdict: 'shaky' })).toThrow(
      /oneFix/
    );
    const fallen = parseCoachResponse('planreview', {
      ...base,
      verdict: 'amazing',
      oneFix: 'Mark your levels.',
    }) as { verdict: string };
    expect(fallen.verdict).toBe('shaky');
  });
});

describe('buildCoachPrompt', () => {
  it('always uses the server-owned guardrails as the system instruction', () => {
    const { systemInstruction } = buildCoachPrompt('brief', digestFor());
    expect(systemInstruction).toBe(COACH_GUARDRAILS);
  });

  it('asks for the JSON shape that matches the mode', () => {
    expect(buildCoachPrompt('brief', digestFor()).userPrompt).toContain('"todayFocus"');
    expect(buildCoachPrompt('weekly', digestFor()).userPrompt).toContain('"biggestLeak"');
    expect(buildCoachPrompt('trade', digestFor()).userPrompt).toContain('"grade"');
  });

  it('omits the trade block outside trade mode', () => {
    const trade = makeTrade();
    const brief = buildCoachPrompt('brief', digestFor(), {
      symbol: 'MES',
    } as CoachTradeFacts);
    expect(brief.userPrompt).not.toContain('THE TRADE TO CRITIQUE');

    const critique = buildCoachPrompt('trade', digestFor(), {
      ...({} as CoachTradeFacts),
      symbol: 'MES',
      direction: 'long',
      contracts: 1,
      entryPrice: 5000,
      initialStop: 4990,
      entryTime: trade.entryTime,
      session: 'Regular Session',
      source: 'recorded by hand',
      status: 'closed',
      initialRisk: 50,
      grossPnL: 50,
      pointsPnL: 10,
      rMultiple: 1,
    });
    expect(critique.userPrompt).toContain('THE TRADE TO CRITIQUE');
  });
});

describe('formatTradeForPrompt', () => {
  const facts: CoachTradeFacts = {
    symbol: 'MNQ',
    direction: 'short',
    contracts: 2,
    entryPrice: 18000,
    initialStop: 18020,
    exitPrice: 17960,
    entryTime: '2026-09-18T13:30:00.000Z',
    exitTime: '2026-09-18T13:45:00.000Z',
    session: 'Regular Session',
    setupName: 'Fade',
    source: 'recorded by hand',
    status: 'closed',
    initialRisk: 40,
    grossPnL: 80,
    pointsPnL: 40,
    rMultiple: 2,
    executionReview: {
      followedSetup: 'yes',
      followedStop: 'no',
      chasedEntry: 'no',
      revengeTrade: 'no',
      addedUnnecessaryRisk: 'na',
      movedStopEmotion: 'yes',
      letWinnerWork: 'yes',
      wouldTakeAgain: 'yes',
    },
  };

  it('describes the trade using the real instrument and its recorded numbers', () => {
    const text = formatTradeForPrompt(facts);
    expect(text).toContain('SHORT 2 MNQ');
    expect(text).toContain('18000');
    expect(text).toContain('2R');
    expect(text).not.toContain('MES');
  });

  it('passes the review answers through so rule breaches can be judged', () => {
    const text = formatTradeForPrompt(facts);
    expect(text).toContain('Honoured the initial stop: no');
    expect(text).toContain('Moved the stop out of emotion: yes');
  });

  it('says when a figure is missing instead of leaving it blank', () => {
    const text = formatTradeForPrompt({
      ...facts,
      exitPrice: undefined,
      exitTime: undefined,
      status: 'open',
    });
    expect(text).toContain('still open, no exit recorded');
  });

  it('explains a scale-in leg so the R is not misread as the whole position', () => {
    const text = formatTradeForPrompt({ ...facts, positionLegs: 3, positionAvgEntry: 17990, positionTotalContracts: 6 });
    expect(text).toContain('3-leg position');
    expect(text).toContain('17990');
  });
});

describe('parseCoachResponse', () => {
  const briefJson = {
    headline: 'Process held, risk did not',
    yesterday: 'You lost $120 across 3 trades.',
    wins: ['Followed the plan'],
    fixes: ['Stopped after the second loss'],
    todayFocus: 'Two losses ends the day.',
    motivation: 'You logged every trade this week.',
  };

  it('accepts a well-formed brief', () => {
    const result = parseCoachResponse('brief', briefJson);
    expect(result).toEqual(briefJson);
  });

  it('accepts JSON that the model wrapped in a code fence', () => {
    const fenced = '```json\n' + JSON.stringify(briefJson) + '\n```';
    expect(parseCoachResponse('brief', fenced)).toEqual(briefJson);
  });

  it('rejects a response that is not JSON at all', () => {
    expect(() => parseCoachResponse('brief', 'Sure! Here is your brief:')).toThrow(
      /did not return valid JSON/
    );
  });

  it('rejects a missing required field rather than rendering a hole', () => {
    const { headline, ...rest } = briefJson;
    expect(() => parseCoachResponse('brief', rest)).toThrow(/headline/);
  });

  it('rejects an empty required field', () => {
    expect(() => parseCoachResponse('brief', { ...briefJson, todayFocus: '   ' })).toThrow(
      /todayFocus/
    );
  });

  it('drops non-string list entries instead of failing the whole response', () => {
    const result = parseCoachResponse('brief', {
      ...briefJson,
      wins: ['real point', '', 42, null, '  another  '],
    }) as { wins: string[] };
    expect(result.wins).toEqual(['real point', 'another']);
  });

  it('keeps weekly patterns that carry an observation and drops the rest', () => {
    const result = parseCoachResponse('weekly', {
      headline: 'Leaking at the close',
      patterns: [
        { observation: 'Late entries', evidence: '-0.8R in 4 trades' },
        { evidence: 'no observation here' },
        'garbage',
      ],
      disciplineRead: 'Scores averaged 72.',
      riskRead: 'One plan breach.',
      biggestLeak: 'Late entries.',
      oneChange: 'No entries after 15:30.',
      motivation: 'Four clean days.',
    }) as { patterns: Array<{ observation: string; evidence: string }> };

    expect(result.patterns).toEqual([
      { observation: 'Late entries', evidence: '-0.8R in 4 trades' },
    ]);
  });

  it('normalises the trade grade and falls back when it is meaningless', () => {
    const base = {
      verdict: 'Good read, poor stop.',
      didWell: [],
      costYou: [],
      rulesBroken: [],
      nextTime: 'Set the stop before entry.',
    };
    expect((parseCoachResponse('trade', { ...base, grade: 'a' }) as { grade: string }).grade).toBe('A');
    expect((parseCoachResponse('trade', { ...base, grade: 'B+' }) as { grade: string }).grade).toBe('B+');
    expect(
      (parseCoachResponse('trade', { ...base, grade: 'Excellent' }) as { grade: string }).grade
    ).toBe('—');
  });

  it('rejects a bare array or a non-object', () => {
    expect(() => parseCoachResponse('brief', [1, 2, 3])).toThrow(/JSON object/);
    expect(() => parseCoachResponse('brief', null)).toThrow(/JSON object/);
  });
});

describe('behaviour section in the prompt', () => {
  it('forbids reading the timing data as advice about when to trade', () => {
    expect(COACH_GUARDRAILS).toContain('NOT THE MARKET');
    expect(COACH_GUARDRAILS).toContain('Never tell them to trade');
  });

  it('scopes the hour buckets to the trader own timezone', () => {
    const digest = digestFor({
      trades: [
        makeTrade({ id: 'a', entryTime: '2026-09-18T13:30:00.000Z' }),
        makeTrade({ id: 'b', entryTime: '2026-09-18T13:45:00.000Z' }),
        makeTrade({ id: 'c', entryTime: '2026-09-18T13:50:00.000Z' }),
      ],
    });

    const { userPrompt } = buildCoachPrompt('brief', digest);
    expect(userPrompt).toContain('Entry hour in their own timezone (America/New_York)');
    expect(userPrompt).toContain('- 09:00: 3 trades');
  });

  it('states the after-loss comparison with both sides of it', () => {
    const digest = digestFor({
      trades: [
        makeTrade({
          id: 'loss',
          entryTime: '2026-09-18T13:00:00.000Z',
          exitTime: '2026-09-18T13:20:00.000Z',
          netPnL: -50,
        }),
        makeTrade({
          id: 'reaction',
          entryTime: '2026-09-18T13:30:00.000Z',
          exitTime: '2026-09-18T13:40:00.000Z',
          netPnL: -40,
        }),
      ],
    });

    const { userPrompt } = buildCoachPrompt('brief', digest);
    expect(userPrompt).toContain('REACTION TO A LOSS');
    expect(userPrompt).toContain('Everything else: 1 trade(s)');
  });

  it('says plainly when there is no timed entry to judge', () => {
    const { userPrompt } = buildCoachPrompt('brief', digestFor());
    expect(userPrompt).toContain('REACTION TO A LOSS: no timed entry to judge.');
  });

  it('reaches every mode, not just the brief', () => {
    for (const mode of COACH_MODES) {
      expect(buildCoachPrompt(mode, digestFor()).userPrompt).toContain(
        'BEHAVIOUR, READ FROM THEIR OWN TIMESTAMPS AND SIZES'
      );
    }
  });
});
