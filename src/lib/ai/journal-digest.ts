import { DailyReview, Instrument, QuestionAnswer, Setup, Trade, TradingDay } from '../../types';
import { calculateTradeRuleFollowing, DAILY_DISCIPLINE_RULES } from '../analytics/discipline';
import { analyzeBehavior, BehaviorFacts } from '../analytics/behavior';
import { instrumentSymbol } from '../trading/instruments';
import { hasAssumedRisk } from '../trading/risk-fixup';
import { HIGH_DISCIPLINE_SCORE } from '../analytics/review-trend';
import { assessRiskCapacity, type RiskCapacity } from '../analytics/risk-capacity';

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

/**
 * The two windows the recent-form comparison is built from.
 *
 * The most recent window is measured against the one immediately before it, at a fixed
 * size, so the two halves cover a like-for-like number of trades. A short window is
 * reported as short rather than topped up with older trades, which would quietly turn a
 * change in form into a change in the sample.
 */
export const FORM_WINDOW_TRADES = 10;
/** Closed trades each window needs before any change in form may be named at all. */
export const MIN_FORM_WINDOW_TRADES = 6;
/** How far average R must move between the windows to count as a real change. */
export const FORM_TREND_AVG_R = 0.15;

/** Which way the trader's own numbers say their recent form is going. */
export type FormTrend = 'improving' | 'declining' | 'steady' | 'mixed' | 'not-enough-data';

/** One side of the recent-form comparison. An empty window reports nulls, never zeros. */
export interface FormWindow {
  trades: number;
  /** Trading days those trades fall on. */
  days: number;
  /** Oldest and newest trading date in the window, or null when it is empty. */
  from: string | null;
  to: string | null;
  netPnL: number | null;
  totalR: number | null;
  avgR: number | null;
  /** Wins as a percentage of the window's closed trades. */
  winRate: number | null;
  /**
   * Net P&L per trading day. The per-trade window and the per-day reading disagree often
   * enough — one oversized day inside a good run — that both are worth stating.
   */
  netPnLPerDay: number | null;
  /** Average end-of-day discipline score over the window's own reviewed days. */
  disciplineScore: number | null;
}

/**
 * How the trader is trending right now, from their own closed trades alone.
 *
 * This is the one reading that answers "am I getting better or worse lately", which a
 * lifetime total cannot: the same record can be a trader who is climbing out of a bad run
 * or one who has just started giving back a good one. It is deliberately built only from
 * the trader's own fills and reviews, and it states a trend only when both windows carry a
 * real sample — a comparison of four trades against four trades is noise with a direction.
 *
 * The `note` is written here rather than left to the model so the UI and the prompt make
 * the same claim from the same numbers.
 */
export interface RecentForm {
  /** Closed trades per window. Both windows are this size by construction. */
  windowTrades: number;
  recent: FormWindow;
  prior: FormWindow;
  trend: FormTrend;
  /** recent minus prior. Null when either window is too thin to compare. */
  avgRDelta: number | null;
  netPnLPerDayDelta: number | null;
  winRateDelta: number | null;
  disciplineDelta: number | null;
  /** True when both windows hold at least {@link MIN_FORM_WINDOW_TRADES}. */
  hasEnoughForTrend: boolean;
  /** The read in the digest's own words, so the UI and the prompt say the same thing. */
  note: string;
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
  /**
   * How much of the account's agreed drawdown is spent, and what is left.
   *
   * Present so the coach can answer "can this account afford today's risk" from numbers
   * rather than from the size of the last few P&L figures. It is the balance-sheet half of
   * the risk question, and it is the one thing a trader looking at an equity curve
   * systematically misreads, because the room left moves with every dollar gained or given
   * back rather than sitting still.
   */
  riskCapacity: RiskCapacity;
  recentDays: DigestDay[];
  /** Where the trader's numbers say they are heading, most recent window first. */
  recentForm: RecentForm;
  /**
   * Behaviour visible only in the trader's own timestamps and sizes: when they trade,
   * how long they hold, whether they re-enter straight after a loss, and how their size
   * compares with their own plan. This is what a self-reported review cannot show,
   * because it only catches what the trader noticed and was willing to write down.
   */
  behavior: BehaviorFacts;
  /** The trader's own words, trimmed. Lets the coach quote them back. */
  traderOwnWords: {
    entryReasons: string[];
    /** Why the trader said they did exit, in their own words, newest first. */
    exitReasons: string[];
    /** The trader's own entry notes, newest first. */
    tradeNotes: string[];
    /** The trader's own exit notes, newest first. */
    exitNotes: string[];
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

// ---- Recent form -----------------------------------------------------------

/** One closed trade, reduced to what the recent-form comparison needs. */
interface FormTradeRow {
  /** Trading date, so the window can state the span it covers. */
  date: string;
  netPnL: number;
  r: number;
  /** That day's end-of-day discipline score, when a review exists for it. */
  disciplineScore: number | null;
}

function emptyFormWindow(): FormWindow {
  return {
    trades: 0,
    days: 0,
    from: null,
    to: null,
    netPnL: null,
    totalR: null,
    avgR: null,
    winRate: null,
    netPnLPerDay: null,
    disciplineScore: null,
  };
}

function buildFormWindow(rows: FormTradeRow[]): FormWindow {
  if (!rows.length) return emptyFormWindow();

  const netPnL = rows.reduce((sum, row) => sum + row.netPnL, 0);
  const totalR = rows.reduce((sum, row) => sum + row.r, 0);
  const wins = rows.filter((row) => row.netPnL > 0).length;
  const dates = [...new Set(rows.map((row) => row.date))].sort((a, b) => a.localeCompare(b));

  // One score per day: a busy day must not outvote a quiet one merely by holding more trades.
  const scoreByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.disciplineScore !== null && !scoreByDate.has(row.date)) {
      scoreByDate.set(row.date, row.disciplineScore);
    }
  }
  const scores = [...scoreByDate.values()];

  return {
    trades: rows.length,
    days: dates.length,
    from: dates[0],
    to: dates[dates.length - 1],
    netPnL: round(netPnL),
    totalR: round(totalR),
    avgR: round(totalR / rows.length),
    winRate: round((wins / rows.length) * 100, 1),
    netPnLPerDay: round(netPnL / dates.length),
    disciplineScore: scores.length
      ? round(scores.reduce((a, b) => a + b, 0) / scores.length, 1)
      : null,
  };
}

/** A window as one clause, for the digest's own note. */
function describeFormWindow(label: string, window: FormWindow): string {
  const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;
  const span = window.from ? ` (${window.from} to ${window.to})` : '';
  return (
    `${label}${span}: ${money(window.netPnL ?? 0)} net, ${window.avgR}R average, ` +
    `${window.winRate}% win, ${money(window.netPnLPerDay ?? 0)} per day over ` +
    `${window.days} day(s)` +
    (window.disciplineScore === null
      ? ', no discipline review'
      : `, discipline ${window.disciplineScore}/100`)
  );
}

/**
 * Compares the trader's most recent closed trades against the same number before them.
 *
 * Both halves are required to carry a real sample before a direction is named. That is the
 * entire point of the exercise: with a handful of trades, a run of two winners looks like
 * "improving" to anything willing to say so.
 */
export function buildRecentForm(rowsNewestFirst: FormTradeRow[]): RecentForm {
  const recent = buildFormWindow(rowsNewestFirst.slice(0, FORM_WINDOW_TRADES));
  const prior = buildFormWindow(rowsNewestFirst.slice(FORM_WINDOW_TRADES, FORM_WINDOW_TRADES * 2));

  const hasEnoughForTrend =
    recent.trades >= MIN_FORM_WINDOW_TRADES && prior.trades >= MIN_FORM_WINDOW_TRADES;

  const avgRDelta = hasEnoughForTrend ? round((recent.avgR ?? 0) - (prior.avgR ?? 0)) : null;
  const netPnLPerDayDelta = hasEnoughForTrend
    ? round((recent.netPnLPerDay ?? 0) - (prior.netPnLPerDay ?? 0))
    : null;
  const winRateDelta = hasEnoughForTrend
    ? round((recent.winRate ?? 0) - (prior.winRate ?? 0), 1)
    : null;
  const disciplineDelta =
    recent.disciplineScore !== null && prior.disciplineScore !== null
      ? round(recent.disciplineScore - prior.disciplineScore, 1)
      : null;

  let trend: FormTrend = 'not-enough-data';
  if (hasEnoughForTrend) {
    const betterR = (avgRDelta ?? 0) >= FORM_TREND_AVG_R;
    const worseR = (avgRDelta ?? 0) <= -FORM_TREND_AVG_R;
    const paidMore = (netPnLPerDayDelta ?? 0) > 0;
    const paidLess = (netPnLPerDayDelta ?? 0) < 0;
    // R says how well each trade was taken; dollars-per-day says whether that survived
    // contact with a real week. When they disagree the honest answer is that they disagree.
    if (betterR && paidMore) trend = 'improving';
    else if (worseR && paidLess) trend = 'declining';
    else if ((betterR && paidLess) || (worseR && paidMore)) trend = 'mixed';
    else trend = 'steady';
  }

  const lead =
    trend === 'improving'
      ? 'Form is improving'
      : trend === 'declining'
      ? 'Form is worsening'
      : trend === 'mixed'
      ? 'Form is sending mixed signals'
      : trend === 'steady'
      ? 'Form is broadly unchanged'
      : `Not enough closed trades to compare form: ${MIN_FORM_WINDOW_TRADES} are needed on each side`;

  return {
    windowTrades: FORM_WINDOW_TRADES,
    recent,
    prior,
    trend,
    avgRDelta,
    netPnLPerDayDelta,
    winRateDelta,
    disciplineDelta,
    hasEnoughForTrend,
    note: `${lead}. ${describeFormWindow(
      `The most recent ${recent.trades} closed trade(s)`,
      recent
    )}. ${describeFormWindow(`The ${prior.trades} before them`, prior)}.`,
  };
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
  /** The trader's timezone, used to read clock hours out of their own timestamps. */
  timezone: string;
  /**
   * The account drawdown the trader has agreed to, when the caller knows it. Omitted means
   * the coach is told there is no limit set rather than being left to assume one.
   */
  maxDrawdown?: number | null;
}): JournalDigest {
  const { trades, tradingDays, reviews, setups, instruments, todayTradeDate, timezone } = input;

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
    if (review.disciplineScore >= HIGH_DISCIPLINE_SCORE) highScores.push(dayPnL);
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

  // ---- Recent form ---------------------------------------------------------
  // Built from the same newest-first order the owner's words use, so "the most recent
  // trades" means the same thing everywhere in the digest. A trade whose day is missing
  // falls back to the date on its own timestamp rather than being dropped from the window.
  const recentForm = buildRecentForm(
    closedNewestFirst.map((trade) => {
      const day = dayById.get(trade.tradingDayId);
      const review = day ? reviewByDayId.get(day.id) : undefined;
      return {
        date: day?.tradeDate ?? (trade.entryTime ? trade.entryTime.slice(0, 10) : ''),
        netPnL: realized(trade),
        r: rMultiple(trade),
        disciplineScore: review ? review.disciplineScore : null,
      };
    })
  );

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
  const behavior = analyzeBehavior({ trades, tradingDays, timezone });
  const unreadableTimes = behavior.timeOfDay.unreadableEntries + behavior.holdTime.unreadable;
  if (unreadableTimes > 0) {
    caveats.push(
      `${unreadableTimes} trade(s) have a missing or unreadable entry/exit time, so they are ` +
        `absent from the timing and hold-time figures below. Do not read those figures as ` +
        `covering every trade.`
    );
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
    // Measured on the same net-of-fees reading as every other figure in this digest, and
    // against today's own planned loss limit, so "can I afford this day" is answered with
    // the number the trader actually set rather than a default.
    riskCapacity: assessRiskCapacity({
      trades,
      maxDrawdown: input.maxDrawdown ?? null,
      dailyLossLimit: today?.plannedLossLimit ?? null,
      pnlOf: realized,
    }),
    recentDays,
    recentForm,
    behavior,
    traderOwnWords: {
      entryReasons: collectWords(closedNewestFirst.map((t) => t.entryReason)),
      tradeNotes: collectWords(closedNewestFirst.map((t) => t.notes)),
      exitReasons: collectWords(closedNewestFirst.map((t) => t.exitReason)),
      exitNotes: collectWords(closedNewestFirst.map((t) => t.exitNote)),
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
