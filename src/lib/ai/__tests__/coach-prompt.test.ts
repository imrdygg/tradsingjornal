import { describe, it, expect } from 'vitest';
import {
  allowsMarketOpinion,
  buildCoachPrompt,
  COACH_GUARDRAILS,
  COACH_MODES,
  COACH_OPINION_MODES,
  COACH_RESPONSE_SHAPES,
  formatDigestForPrompt,
  formatTradeForPrompt,
  isCoachMode,
  parseCoachResponse,
} from '../coach-prompt';
import type { ChartReadResponse, CoachTradeFacts } from '../coach-types';
import { buildJournalDigest } from '../journal-digest';
import type { DailyBars, MarketBrief } from '../market-data';
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
  it('accepts every real mode and nothing else', () => {
    for (const mode of COACH_MODES) {
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

// ---------------------------------------------------------------------------
// The opinion modes: the one deliberate departure from "never comment on the market",
// scoped to the four modes where the trader explicitly asks for a call on their own
// instrument. Everything that keeps that departure honest is asserted here.
// ---------------------------------------------------------------------------

const liveRead = {
  ok: true,
  symbol: 'MES',
  yahooSymbol: 'MES=F',
  price: 7740,
  previousClose: 7712.5,
  changePercent: 0.36,
  dayHigh: 7744,
  dayLow: 7730,
  volume: 58591,
  fetchedAt: new Date().toISOString(),
};

const position = {
  symbol: 'MES',
  direction: 'long' as const,
  contracts: 1,
  entryPrice: 7730,
  initialStop: 7710,
  currentPrice: 7700,
  addContracts: 2,
  addPrice: 7700,
  plannedLossLimit: 100,
};

const entry = {
  symbol: 'MES',
  direction: 'long' as const,
  contracts: 1,
  entryPrice: 7740,
  initialStop: 7730,
  setupName: 'Breakout',
  session: 'Regular Session',
};

describe('opinion modes', () => {
  it('is an explicit list, so a stray mode can never inherit the market allowance', () => {
    expect(allowsMarketOpinion('planbuild')).toBe(true);
    expect(allowsMarketOpinion('entrycall')).toBe(true);
    expect(allowsMarketOpinion('scalein')).toBe(true);
    expect(allowsMarketOpinion('planfield')).toBe(true);
    expect(allowsMarketOpinion('planreview')).toBe(false);
    expect(allowsMarketOpinion('brief')).toBe(false);
  });

  it('narrows the ban on market claims instead of replacing it', () => {
    const { systemInstruction } = buildCoachPrompt('planbuild', digestFor(), undefined, undefined, {
      instrumentQuote: liveRead,
    });
    expect(systemInstruction).toContain('NO MARKET DATA');
    expect(systemInstruction).toContain('YOUR OPINION WAS ASKED FOR');
    expect(systemInstruction).toContain('STANDING ASIDE IS A REAL ANSWER');
    expect(systemInstruction).toContain('SIZE MUST RESPECT THEIR RISK');
    // And the modes that did not ask keep the strict rules untouched.
    expect(buildCoachPrompt('brief', digestFor()).systemInstruction).toBe(COACH_GUARDRAILS);
  });

  it('attaches the live read to the opinion modes and to nothing else', () => {
    const withRead = buildCoachPrompt('planbuild', digestFor(), undefined, undefined, {
      instrumentQuote: liveRead,
    });
    expect(withRead.userPrompt).toContain('LIVE READ: MES');
    expect(withRead.userPrompt).toContain('7,740.00');

    for (const mode of ['brief', 'weekly', 'prep', 'postclose', 'trade', 'planreview'] as const) {
      const other = buildCoachPrompt(mode, digestFor(), undefined, undefined, {
        instrumentQuote: liveRead,
      });
      expect(other.userPrompt).not.toContain('LIVE READ: MES');
    }
  });

  it('injects the position only into the scale-in prompt', () => {
    const { userPrompt } = buildCoachPrompt('scalein', digestFor(), undefined, undefined, {
      position,
    });
    expect(userPrompt).toContain('=== THE POSITION ===');
    expect(userPrompt).toContain('1 MES, LONG, entry 7,730.00, initial stop 7,710.00');
    // The arithmetic is done here, so the model cannot mis-state the blended entry:
    // 1 @ 7730 plus 2 @ 7700 blends to 3 contracts at 7710.
    expect(userPrompt).toContain('blended entry of 7,710.00');

    for (const mode of ['brief', 'planbuild', 'entrycall'] as const) {
      expect(
        buildCoachPrompt(mode, digestFor(), undefined, undefined, { position }).userPrompt
      ).not.toContain('=== THE POSITION ===');
    }
  });

  it('injects the entry only into the entry-call prompt, and asks for an independent call', () => {
    const { userPrompt } = buildCoachPrompt('entrycall', digestFor(), undefined, undefined, {
      entry,
    });
    expect(userPrompt).toContain('=== THE ENTRY THE TRADER JUST RECORDED ===');
    expect(userPrompt).toContain('do not simply agree with them');

    for (const mode of ['brief', 'scalein', 'planbuild'] as const) {
      expect(
        buildCoachPrompt(mode, digestFor(), undefined, undefined, { entry }).userPrompt
      ).not.toContain('THE ENTRY THE TRADER JUST RECORDED');
    }
  });

  it('injects the field request only into the plan-field prompt', () => {
    const { userPrompt } = buildCoachPrompt('planfield', digestFor(), undefined, undefined, {
      field: 'stayOutIf',
      currentFieldValue: 'no chop',
    });
    expect(userPrompt).toContain('=== THE FIELD TO DRAFT ===');
    expect(userPrompt).toContain('What will keep me out of a trade?');
    expect(userPrompt).toContain('no chop');

    expect(
      buildCoachPrompt('brief', digestFor(), undefined, undefined, { field: 'stayOutIf' })
        .userPrompt
    ).not.toContain('=== THE FIELD TO DRAFT ===');
  });

  it('tells the model to stand aside when the live read failed', () => {
    expect(COACH_RESPONSE_SHAPES.planbuild).toContain('return skip with null levels');
    expect(COACH_RESPONSE_SHAPES.entrycall).toContain('flat when you would not be in a trade');
  });

  it('parses a planbuild draft and normalises a nonsense enum', () => {
    const parsed = parseCoachResponse('planbuild', {
      headline: 'Two-sided, lean long above the prior close',
      bias: 'BULLISH',
      direction: 'long',
      entry: '7740.00',
      stop: 7730,
      target: null,
      contracts: 2.4,
      waitingFor: 'Hold above the prior close on the first pullback.',
      stayOutIf: 'Any break back below the overnight low.',
      setups: ['Breakout', 42],
      levels: [
        { price: 7744, label: 'day high' },
        { price: 'not a number', label: 'junk' },
        'garbage',
      ],
      rationale: 'The read shows strength; this can still be wrong.',
      confidence: 'excellent',
      basedOn: ['live MES 7740.00'],
    }) as {
      bias: string;
      entry: number | null;
      contracts: number;
      confidence: string;
      setups: string[];
      levels: Array<{ price: number; label: string }>;
    };

    expect(parsed.bias).toBe('bullish');
    // A currency-formatted entry is accepted; anything unreadable would have thrown.
    expect(parsed.entry).toBe(7740);
    // Contracts are whole numbers, and never zero.
    expect(parsed.contracts).toBe(2);
    // An unknown confidence is reported as low rather than passed through.
    expect(parsed.confidence).toBe('low');
    expect(parsed.setups).toEqual(['Breakout']);
    expect(parsed.levels).toEqual([{ price: 7744, label: 'day high' }]);
  });

  it('rejects a planbuild level that is not a number rather than guessing one', () => {
    expect(() =>
      parseCoachResponse('planbuild', {
        headline: 'h',
        bias: 'bullish',
        direction: 'long',
        entry: 'somewhere near the highs',
        stop: 7730,
        target: null,
        contracts: 1,
        waitingFor: 'w',
        stayOutIf: 's',
        setups: [],
        levels: [],
        rationale: 'r',
        confidence: 'low',
        basedOn: [],
      })
    ).toThrow(/entry/);
  });

  it('drops the add levels when the coach said not to add', () => {
    const parsed = parseCoachResponse('scalein', {
      stance: 'do-not-add',
      addPrice: 7700,
      addContracts: 5,
      stopAfterAdd: 7690,
      breakevenPrice: null,
      rationale: 'Adding here doubles the risk for no structural reason.',
      risks: ['The stop is already the session low.'],
    }) as { stance: string; addPrice: number | null; addContracts: number | null };

    expect(parsed.stance).toBe('do-not-add');
    // A level attached to a refusal would render an add the coach never asked for.
    expect(parsed.addPrice).toBeNull();
    expect(parsed.addContracts).toBeNull();
  });

  it('parses a scale-in opinion that would add', () => {
    const parsed = parseCoachResponse('scalein', {
      stance: 'ADD',
      addPrice: 7700,
      addContracts: 2,
      stopAfterAdd: 7690,
      breakevenPrice: 7715,
      rationale: 'A retest of the prior close inside the planned risk.',
      risks: ['Fails if the low breaks first.'],
    }) as { stance: string; addPrice: number | null; addContracts: number };

    expect(parsed.stance).toBe('add');
    expect(parsed.addPrice).toBe(7700);
    expect(parsed.addContracts).toBe(2);
  });

  it('blanks the entry-call levels when the coach would be flat', () => {
    const parsed = parseCoachResponse('entrycall', {
      direction: 'flat',
      entry: 7740,
      stop: 7730,
      target: 7760,
      rationale: 'Nothing here supports a side yet.',
    }) as { direction: string; entry: number | null; stop: number | null };

    expect(parsed.direction).toBe('flat');
    expect(parsed.entry).toBeNull();
    expect(parsed.stop).toBeNull();
  });

  it('parses an entry call with a side and levels', () => {
    const parsed = parseCoachResponse('entrycall', {
      direction: 'short',
      entry: 7750,
      stop: 7762,
      target: 7720,
      rationale: 'Failed at the day high.',
    }) as { direction: string; entry: number | null; stop: number | null; target: number | null };

    expect(parsed.direction).toBe('short');
    expect(parsed.entry).toBe(7750);
    expect(parsed.stop).toBe(7762);
    expect(parsed.target).toBe(7720);
  });

  it('uses the field that was actually asked for, whatever the model labelled it', () => {
    const parsed = parseCoachResponse(
      'planfield',
      {
        field: 'waitingFor',
        suggestion: 'Wait for a hold above the prior close.',
        rationale: 'Your last three losing days came from entering early.',
        basedOn: ['3 entries before the open'],
      },
      { field: 'stayOutIf' }
    ) as { field: string; suggestion: string };

    expect(parsed.field).toBe('stayOutIf');
    expect(parsed.suggestion).toContain('Wait for a hold');
  });

  it('rejects an opinion that arrives without a rationale', () => {
    expect(() =>
      parseCoachResponse('entrycall', { direction: 'long', entry: 7740, stop: 7730, target: 7760 })
    ).toThrow(/rationale/);
  });
});

/**
 * The Markets chart read doubles as a draft of today's plan.
 *
 * The trader is looking at one symbol at a time, so the plan half must be asked for and
 * read back as a plan for that instrument alone — and, because the read is the feature
 * they actually asked for, a response that arrives without the plan half must still give
 * a usable read rather than an error.
 */
describe('the chart read drafts today’s plan', () => {
  const chartSeries: DailyBars = {
    ok: true,
    symbol: 'MES',
    yahooSymbol: 'MES=F',
    fetchedAt: '2026-09-18T13:00:00.000Z',
    bars: [
      { date: '2026-09-16', open: 7700, high: 7725, low: 7695, close: 7720, volume: 1000 },
      { date: '2026-09-17', open: 7720, high: 7745, low: 7715, close: 7740, volume: 1100 },
      { date: '2026-09-18', open: 7740, high: 7760, low: 7735, close: 7755, volume: 1200 },
    ],
  };

  it('asks for the plan fields, scoped to the instrument on the chart', () => {
    const shape = COACH_RESPONSE_SHAPES.chartread;
    for (const field of ['"bias"', '"contracts"', '"waitingFor"', '"stayOutIf"', '"setups"']) {
      expect(shape).toContain(field);
    }
    expect(shape).toContain('this instrument only');

    const { userPrompt } = buildCoachPrompt('chartread', digestFor(), undefined, undefined, {
      instrument: 'MES',
      chartSeries,
    });
    expect(userPrompt).toContain('DAILY CHART DATA: MES');
    // Without this the model plans for the whole watchlist instead of the chart on screen.
    expect(userPrompt).toContain("draft today's plan for THIS instrument alone");
    expect(userPrompt).toContain('do not assume they will trade');
  });

  it('parses the drafted plan fields alongside the read', () => {
    const parsed = parseCoachResponse('chartread', {
      headline: 'Higher closes, price near the top of the series.',
      patternRead: 'The three closes rise and the last sits near the series high.',
      levels: [{ price: 7760, label: 'series high' }],
      direction: 'long',
      entry: 7750,
      stop: 7735,
      target: 7790,
      bias: 'BULLISH',
      contracts: 2.6,
      waitingFor: 'Hold above 7740 on the first pullback.',
      stayOutIf: 'A close back under the series low.',
      setups: ['Breakout', 7],
      fitsTheirTrading: 'It fits the setup they already trade.',
      risks: ['The series is short.'],
      rationale: 'This is my read and it can be wrong.',
      confidence: 'medium',
      basedOn: ['three daily closes'],
    }) as ChartReadResponse;

    expect(parsed.bias).toBe('bullish');
    // Whole contracts, and a fractional answer is rounded rather than shown as 2.6.
    expect(parsed.contracts).toBe(3);
    expect(parsed.waitingFor).toContain('7740');
    expect(parsed.stayOutIf).toContain('series low');
    // A non-string entry in the list is dropped, like every other list here.
    expect(parsed.setups).toEqual(['Breakout']);
  });

  it('still returns a usable read when the plan half is missing', () => {
    // 0 contracts and empty text are what the plan applier reads as "write nothing", so
    // an older or thinner answer degrades to a read-only result instead of an error.
    const parsed = parseCoachResponse('chartread', {
      headline: 'h',
      patternRead: 'p',
      levels: [],
      direction: 'skip',
      entry: null,
      stop: null,
      target: null,
      fitsTheirTrading: 'f',
      risks: [],
      rationale: 'r',
      confidence: 'low',
      basedOn: [],
    }) as ChartReadResponse;

    expect(parsed.direction).toBe('skip');
    expect(parsed.contracts).toBe(0);
    expect(parsed.bias).toBe('unsure');
    expect(parsed.waitingFor).toBe('');
    expect(parsed.stayOutIf).toBe('');
    expect(parsed.setups).toEqual([]);
  });
});
