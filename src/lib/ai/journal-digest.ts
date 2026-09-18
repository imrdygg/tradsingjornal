import { DailyReview, Instrument, QuestionAnswer, Setup, Trade, TradingDay } from '../../types';
import { calculateTradeRuleFollowing, DAILY_DISCIPLINE_RULES } from '../analytics/discipline';
import { instrumentSymbol } from '../trading/instruments';
import { hasAssumedRisk } from '../trading/risk-fixup';

/**
 * The journal digest is the *only* factual basis the AI coach is allowed to use.
 *
 * Everything here is computed from records the trader entered themselves. The
 * digest deliberately contains no market data, no prices beyond the trader's own
 * fills, and no news, because the model has no way to know those things and would
 * otherwise invent them. If a fact is not in this object, the coach is instructed
 * to say it does not know.
 */

export interface DigestStatLine {
  label: string;
  trades: number;
  netPnL: number;
  totalR: number;
  avgR: number;
  winRate: number;
}

export interface DigestRuleFailure {
  rule: string;
  times: number;
}

export interface DigestDay {
  date: string;
  netPnL: number;
  trades: number;
  disciplineScore: number | null;
  rulesBroken: string[];
}

export interface JournalDigest {
  /** The trading date this digest was built for (YYYY-MM-DD). */
  generatedFor: string;
  /** What the app knows, and how thin it is. The coach must respect this. */
  dataSufficiency: {
    totalTrades: number;
    closedTrades: number;
    openTrades: number;
    reviewedDays: number;
    reviewedTrades: number;
    daysLogged: number;
    hasEnoughForPatterns: boolean;
    caveats: string[];
  };
  overall: {
    netPnL: number;
    totalR: number;
    avgR: number;
    expectancyR: number;
    winRate: number;
    wins: number;
    losses: number;
    scratches: number;
    avgWinR: number;
    avgLossR: number;
    largestWin: number;
    largestLoss: number;
  };
  byInstrument: DigestStatLine[];
  bySetup: DigestStatLine[];
  bySession: DigestStatLine[];
  discipline: {
    reviewedDays: number;
    avgScore: number;
    bestScore: number | null;
    worstScore: number | null;
    failedRules: DigestRuleFailure[];
    /** Net P&L on days scored >= 80 vs days scored < 80. This is the honest signal. */
    highDisciplineAvgPnL: number | null;
    lowDisciplineAvgPnL: number | null;
  };
  execution: {
    reviewedTrades: number;
    avgScore: number;
    failedRules: DigestRuleFailure[];
  };
  /** Plan vs what actually happened. Often the most useful section. */
  planAdherence: {
    daysWithPlan: number;
    daysExceededLossLimit: number;
    worstOvershoot: number;
    tradesOutsideAllowedSessions: number;
    sessionsTradedOutsidePlan: string[];
    tradesOnUnplannedSetup: number;
    unplannedSetupsTraded: string[];
    tradesOnNonPrimaryInstrument: number;
    lockedPlanEdits: number;
    lockedPlanEditExamples: string[];
  };
  streaks: {
    consecutiveLosingDays: number;
    consecutiveRuleBreakDays: number;
    losingStreakPnL: number;
  };
  recentDays: DigestDay[];
  /** The trader's own words, trimmed. Lets the coach quote them back. */
  traderOwnWords: {
    entryReasons: string[];
    tradeNotes: string[];
    tradeManagementNotes: string[];
    didWell: string[];
    didPoorly: string[];
    tomorrowFocus: string[];
  };
  today: {
    date: string;
    hasPlan: boolean;
    status: string;
    locked: boolean;
    marketBias: string;
    primaryInstrument: string;
    contractsPlanned: number;
    plannedLossLimit: number;
    allowedSessions: string[];
    watchedSetups: string[];
    waitingFor: string;
    stayOutIf: string;
    notes: string;
    tradesTaken: number;
    netPnL: number;
    openTrades: number;
  };
}

const MAX_RECENT_DAYS = 14;
const MAX_OWN_WORDS = 6;
const MAX_WORD_LENGTH = 240;

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/** Net P&L when present, otherwise gross. Never invents a number for a missing value. */
function realized(trade: Trade): number {
  if (typeof trade.netPnL === 'number' && Number.isFinite(trade.netPnL)) return trade.netPnL;
  return Number.isFinite(trade.grossPnL) ? trade.grossPnL : 0;
}

function rMultiple(trade: Trade): number {
  return Number.isFinite(trade.rMultiple) ? trade.rMultiple : 0;
}

function isClosed(trade: Trade): boolean {
  return trade.status === 'closed';
}

function trimWord(text: string | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > MAX_WORD_LENGTH ? `${clean.slice(0, MAX_WORD_LENGTH)}…` : clean;
}

/** Collects the most recent non-empty free-text entries, newest first. */
function collectWords(values: Array<string | undefined>, limit = MAX_OWN_WORDS): string[] {
  const out: string[] = [];
  for (const value of values) {
    const word = trimWord(value);
    if (word) out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

function statLine(label: string, trades: Trade[]): DigestStatLine {
  const netPnL = trades.reduce((sum, t) => sum + realized(t), 0);
  const totalR = trades.reduce((sum, t) => sum + rMultiple(t), 0);
  const wins = trades.filter((t) => realized(t) > 0).length;
  return {
    label,
    trades: trades.length,
    netPnL: round(netPnL),
    totalR: round(totalR),
    avgR: trades.length ? round(totalR / trades.length) : 0,
    winRate: trades.length ? round((wins / trades.length) * 100, 1) : 0,
  };
}

/**
 * Buckets by label, keeping only groups with a real sample so the coach is not
 * invited to draw conclusions from a single trade.
 */
function group(
  trades: Trade[],
  keyOf: (trade: Trade) => string | null,
  minimum = 2
): DigestStatLine[] {
  const buckets = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(trade);
    else buckets.set(key, [trade]);
  }
  return [...buckets.entries()]
    .filter(([, list]) => list.length >= minimum)
    .map(([label, list]) => statLine(label, list))
    .sort((a, b) => b.trades - a.trades);
}

function tallyRules(entries: string[]): DigestRuleFailure[] {
  const counts = new Map<string, number>();
  for (const rule of entries) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return [...counts.entries()]
    .map(([rule, times]) => ({ rule, times }))
    .sort((a, b) => b.times - a.times);
}

/** Human-readable labels for the rules that were NOT followed. */
function dailyRuleBreaks(review: DailyReview): string[] {
  const broken: string[] = [];
  for (const rule of DAILY_DISCIPLINE_RULES) {
    const answer: QuestionAnswer = review.questions[rule.id];
    if (answer === 'na') continue;
    if (answer !== rule.desiredAnswer) broken.push(rule.label);
  }
  return broken;
}

function tradeRuleBreaks(trade: Trade): string[] {
  const review = trade.executionReview;
  if (!review) return [];
  const broken: string[] = [];
  const checks: Array<{ label: string; answer: QuestionAnswer; pass: 'yes' | 'no' }> = [
    { label: 'Followed the planned setup', answer: review.followedSetup, pass: 'yes' },
    { label: 'Honoured the initial stop', answer: review.followedStop, pass: 'yes' },
    { label: 'Did not chase the entry', answer: review.chasedEntry, pass: 'no' },
    { label: 'Was not a revenge trade', answer: review.revengeTrade, pass: 'no' },
    { label: 'Did not add unnecessary risk', answer: review.addedUnnecessaryRisk, pass: 'no' },
    { label: 'Did not move the stop on emotion', answer: review.movedStopEmotion, pass: 'no' },
    { label: 'Let the winner work', answer: review.letWinnerWork, pass: 'yes' },
  ];
  for (const check of checks) {
    if (check.answer === 'na') continue;
    if (check.answer !== check.pass) broken.push(check.label);
  }
  return broken;
}

export function buildJournalDigest(input: {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
}): JournalDigest {
  const { trades, tradingDays, reviews, setups, instruments, todayTradeDate } = input;

  // Newest first. Trade dates are YYYY-MM-DD so a string sort is chronological.
  const daysByDate = new Map<string, TradingDay>();
  for (const day of tradingDays) daysByDate.set(day.tradeDate, day);
  const sortedDays = [...tradingDays].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));

  const reviewByDayId = new Map<string, DailyReview>();
  for (const review of reviews) reviewByDayId.set(review.tradingDayId, review);

  const closed = trades.filter(isClosed);
  const open = trades.filter((t) => !isClosed(t));

  // ---- Overall performance -------------------------------------------------
  const wins = closed.filter((t) => realized(t) > 0);
  const losses = closed.filter((t) => realized(t) < 0);
  const scratches = closed.length - wins.length - losses.length;

  const netPnL = closed.reduce((sum, t) => sum + realized(t), 0);
  const totalR = closed.reduce((sum, t) => sum + rMultiple(t), 0);
  const avgR = closed.length ? totalR / closed.length : 0;
  const winRate = closed.length ? wins.length / closed.length : 0;
  const avgWinR = wins.length ? wins.reduce((s, t) => s + rMultiple(t), 0) / wins.length : 0;
  const avgLossR = losses.length ? losses.reduce((s, t) => s + rMultiple(t), 0) / losses.length : 0;

  // ---- Discipline ----------------------------------------------------------
  const scoredReviews = reviews.filter((r) => Number.isFinite(r.disciplineScore));
  const scores = scoredReviews.map((r) => r.disciplineScore);
  const failedRuleEntries = scoredReviews.flatMap(dailyRuleBreaks);

  // Does discipline actually pay for this trader? Compare per-day P&L on days
  // they executed well against days they did not.
  const dayPnLById = new Map<string, number>();
  for (const trade of closed) {
    dayPnLById.set(trade.tradingDayId, (dayPnLById.get(trade.tradingDayId) ?? 0) + realized(trade));
  }
  const highScores: number[] = [];
  const lowScores: number[] = [];
  for (const review of scoredReviews) {
    const dayPnL = dayPnLById.get(review.tradingDayId);
    if (dayPnL === undefined) continue;
    if (review.disciplineScore >= 80) highScores.push(dayPnL);
    else lowScores.push(dayPnL);
  }
  const mean = (list: number[]): number | null =>
    list.length ? round(list.reduce((a, b) => a + b, 0) / list.length) : null;

  const reviewedTrades = closed.filter((t) => t.executionReview);
  const tradeScores = reviewedTrades
    .map((t) => calculateTradeRuleFollowing(t.executionReview))
    .filter((x): x is { score: number; followedAll: boolean } => x !== null);

  // ---- Plan adherence ------------------------------------------------------
  let tradesOutsideAllowedSessions = 0;
  const outsideSessions = new Set<string>();
  let tradesOnUnplannedSetup = 0;
  const unplannedSetups = new Set<string>();
  let tradesOnNonPrimaryInstrument = 0;
  let daysExceededLossLimit = 0;
  let worstOvershoot = 0;
  let lockedPlanEdits = 0;
  const lockedEditExamples: string[] = [];

  const dayById = new Map<string, TradingDay>();
  for (const day of tradingDays) dayById.set(day.id, day);

  for (const trade of trades) {
    const day = dayById.get(trade.tradingDayId);
    if (!day) continue;

    if (day.allowedSessions.length && !day.allowedSessions.includes(trade.session)) {
      tradesOutsideAllowedSessions += 1;
      outsideSessions.add(trade.session);
    }

    // `watchedSetups` stores ids or names, so accept either side of the match.
    // An empty plan is skipped rather than counted as a breach.
    if (day.watchedSetups.length) {
      const planned =
        (trade.setupId ? day.watchedSetups.includes(trade.setupId) : false) ||
        (trade.setupName ? day.watchedSetups.includes(trade.setupName) : false);
      if (!planned) {
        tradesOnUnplannedSetup += 1;
        if (trade.setupName) unplannedSetups.add(trade.setupName);
      }
    }

    if (day.primaryInstrument) {
      const symbol = instrumentSymbol(instruments, trade.instrumentId);
      if (symbol !== day.primaryInstrument) tradesOnNonPrimaryInstrument += 1;
    }
  }

  for (const day of tradingDays) {
    // Exceeding the loss limit needs a result to compare against...
    const dayPnL = dayPnLById.get(day.id);
    if (dayPnL !== undefined && day.plannedLossLimit > 0 && dayPnL < -day.plannedLossLimit) {
      daysExceededLossLimit += 1;
      const overshoot = Math.abs(dayPnL) - day.plannedLossLimit;
      if (overshoot > worstOvershoot) worstOvershoot = overshoot;
    }
    // ...but editing a locked plan is a discipline fact even on a day with no trade,
    // so it must not be skipped when there is no P&L for that day.
    for (const change of day.planChanges ?? []) {
      lockedPlanEdits += 1;
      if (lockedEditExamples.length < 5) {
        lockedEditExamples.push(
          `${day.tradeDate}: ${change.fieldName} ${change.oldValue} → ${change.newValue} (${change.reason})`
        );
      }
    }
  }

  // ---- Streaks -------------------------------------------------------------
  const daysWithTrades = sortedDays.filter((d) => dayPnLById.has(d.id));
  let consecutiveLosingDays = 0;
  let losingStreakPnL = 0;
  for (const day of daysWithTrades) {
    const dayPnL = dayPnLById.get(day.id) ?? 0;
    if (dayPnL < 0) {
      consecutiveLosingDays += 1;
      losingStreakPnL += dayPnL;
    } else break;
  }

  let consecutiveRuleBreakDays = 0;
  for (const day of sortedDays) {
    const review = reviewByDayId.get(day.id);
    if (!review) continue;
    if (dailyRuleBreaks(review).length > 0) consecutiveRuleBreakDays += 1;
    else break;
  }

  // ---- Recent day-by-day ---------------------------------------------------
  const recentDays: DigestDay[] = daysWithTrades.slice(0, MAX_RECENT_DAYS).map((day) => {
    const review = reviewByDayId.get(day.id);
    const dayPnL = dayPnLById.get(day.id) ?? 0;
    return {
      date: day.tradeDate,
      netPnL: round(dayPnL),
      trades: trades.filter((t) => t.tradingDayId === day.id).length,
      disciplineScore: review ? review.disciplineScore : null,
      rulesBroken: review ? dailyRuleBreaks(review) : [],
    };
  });

  // ---- The trader's own words ---------------------------------------------
  const closedNewestFirst = [...closed].sort((a, b) =>
    (b.exitTime ?? b.entryTime ?? b.updatedAt).localeCompare(a.exitTime ?? a.entryTime ?? a.updatedAt)
  );
  const reviewsNewestFirst = [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ---- Today ---------------------------------------------------------------
  const today = daysByDate.get(todayTradeDate);
  const todayTrades = trades.filter((t) => today && t.tradingDayId === today.id);

  const closedCaveat = closed.length < 10;
  const caveats: string[] = [];
  if (closed.length === 0) {
    caveats.push('No closed trades have been logged yet, so no performance claim can be made.');
  } else if (closedCaveat) {
    caveats.push(
      `Only ${closed.length} closed trade(s) logged. Treat any pattern below as a hint, not a finding.`
    );
  }
  if (scoredReviews.length === 0) {
    caveats.push('No end-of-day reviews completed, so there is no discipline evidence.');
  }
  if (reviewedTrades.length === 0) {
    caveats.push('No trade execution reviews completed, so per-trade rule following is unknown.');
  }
  const assumedRiskCount = trades.filter(hasAssumedRisk).length;
  if (assumedRiskCount > 0) {
    caveats.push(
      `${assumedRiskCount} trade(s) have an ASSUMED stop because a broker CSV carries no stop ` +
        `price. Their risk and R-multiple are placeholders, not the trader's real numbers, so ` +
        `any risk, expectancy or R-based pattern below is unreliable until those stops are set.`
    );
  }
  for (const day of tradingDays) {
    if (day.riskMode === 'expanded') {
      caveats.push(
        `Risk mode was expanded on at least one day (${day.tradeDate}); planned loss limits differ from normal.`
      );
      break;
    }
  }

  return {
    generatedFor: todayTradeDate,
    dataSufficiency: {
      totalTrades: trades.length,
      closedTrades: closed.length,
      openTrades: open.length,
      reviewedDays: scoredReviews.length,
      reviewedTrades: reviewedTrades.length,
      daysLogged: tradingDays.length,
      hasEnoughForPatterns: closed.length >= 10 && scoredReviews.length >= 3,
      caveats,
    },
    overall: {
      netPnL: round(netPnL),
      totalR: round(totalR),
      avgR: round(avgR),
      // Expectancy: average of the R distribution, floored when there is no data.
      expectancyR: closed.length ? round(totalR / closed.length) : 0,
      winRate: round(winRate * 100, 1),
      wins: wins.length,
      losses: losses.length,
      scratches,
      avgWinR: round(avgWinR),
      avgLossR: round(avgLossR),
      largestWin: round(closed.reduce((m, t) => Math.max(m, realized(t)), 0)),
      largestLoss: round(closed.reduce((m, t) => Math.min(m, realized(t)), 0)),
    },
    byInstrument: group(closed, (t) => instrumentSymbol(instruments, t.instrumentId)),
    bySetup: group(closed, (t) => {
      if (t.setupName) return t.setupName;
      const setup = t.setupId ? setups.find((s) => s.id === t.setupId) : undefined;
      return setup?.name ?? null;
    }),
    bySession: group(closed, (t) => t.session, 3),
    discipline: {
      reviewedDays: scoredReviews.length,
      avgScore: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length, 1) : 0,
      bestScore: scores.length ? Math.max(...scores) : null,
      worstScore: scores.length ? Math.min(...scores) : null,
      failedRules: tallyRules(failedRuleEntries),
      highDisciplineAvgPnL: mean(highScores),
      lowDisciplineAvgPnL: mean(lowScores),
    },
    execution: {
      reviewedTrades: reviewedTrades.length,
      avgScore: tradeScores.length
        ? round(tradeScores.reduce((a, b) => a + b.score, 0) / tradeScores.length, 1)
        : 0,
      failedRules: tallyRules(reviewedTrades.flatMap(tradeRuleBreaks)),
    },
    planAdherence: {
      daysWithPlan: tradingDays.filter((d) => !!d.lockedAt).length,
      daysExceededLossLimit,
      worstOvershoot: round(worstOvershoot),
      tradesOutsideAllowedSessions,
      sessionsTradedOutsidePlan: [...outsideSessions],
      tradesOnUnplannedSetup,
      unplannedSetupsTraded: [...unplannedSetups],
      tradesOnNonPrimaryInstrument,
      lockedPlanEdits,
      lockedPlanEditExamples: lockedEditExamples,
    },
    streaks: {
      consecutiveLosingDays,
      consecutiveRuleBreakDays,
      losingStreakPnL: round(losingStreakPnL),
    },
    recentDays,
    traderOwnWords: {
      entryReasons: collectWords(closedNewestFirst.map((t) => t.entryReason)),
      tradeNotes: collectWords(closedNewestFirst.map((t) => t.notes)),
      tradeManagementNotes: collectWords(
        closedNewestFirst.map((t) => t.tradeManagement?.notes)
      ),
      didWell: collectWords(reviewsNewestFirst.map((r) => r.didWell)),
      didPoorly: collectWords(reviewsNewestFirst.map((r) => r.didPoorly)),
      tomorrowFocus: collectWords(reviewsNewestFirst.map((r) => r.tomorrowFocus)),
    },
    today: {
      date: todayTradeDate,
      hasPlan: !!today,
      status: today?.status ?? 'no plan recorded',
      locked: !!today?.lockedAt,
      marketBias: today?.marketBias ?? 'not recorded',
      primaryInstrument: today?.primaryInstrument ?? 'not recorded',
      contractsPlanned: today?.contractsPlanned ?? 0,
      plannedLossLimit: today?.plannedLossLimit ?? 0,
      allowedSessions: today?.allowedSessions ?? [],
      watchedSetups: today?.watchedSetups ?? [],
      waitingFor: today?.waitingFor ?? '',
      stayOutIf: today?.stayOutIf ?? '',
      notes: today?.notes ?? '',
      tradesTaken: todayTrades.length,
      netPnL: round(todayTrades.reduce((sum, t) => sum + realized(t), 0)),
      openTrades: todayTrades.filter((t) => !isClosed(t)).length,
    },
  };
}
