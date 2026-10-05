import {
  DailyReview,
  Instrument,
  Lesson,
  CoachPlan,
  LevelKind,
  LevelOutlook,
  LevelTimeframe,
  LevelTouch,
  MarkedLevel,
  MarketOutlookBias,
  QuestionAnswer,
  SessionExtreme,
  Setup,
  TouchOutcome,
  Trade,
  TradingDay,
  TradingSession,
} from '../../types';
import { calculateTradeRuleFollowing, DAILY_DISCIPLINE_RULES } from '../analytics/discipline';
import { analyzeBehavior, BehaviorFacts } from '../analytics/behavior';
import { instrumentSymbol } from '../trading/instruments';
import { hasAssumedRisk } from '../trading/risk-fixup';
import { HIGH_DISCIPLINE_SCORE } from '../analytics/review-trend';
import { assessRiskCapacity, type RiskCapacity } from '../analytics/risk-capacity';
import { realizedPnL } from '../analytics/realized-pnl';
import {
  buildSetupWeek,
  type SetupWeek,
} from '../analytics/setup-week';
import {
  findLevelEdges,
  MIN_DECIDED,
  summarizeMarkedLevels,
  summarizeTouches,
  type LevelEdgeBucket,
} from '../analytics/level-edge';
import { summarizeTimeframeEdges, type TimeframeEdgeBucket } from '../analytics/level-timeframes';
import {
  summarizeLevelRecurrence,
  type LevelRecurrenceReport,
  type RecurrenceBucket,
} from '../analytics/level-recurrence';
import {
  buildDaysByTimeframe,
  buildOvernightHourPatterns,
  findRatingEdges,
  MIN_PATTERN_SESSIONS,
  MIN_RATED,
  RATING_HORIZONS,
  summarizeExtremes,
  summarizeRatings,
  type ExtremeHourPattern,
  type ExtremeRatingBucket,
  type ExtremeRatingStats,
} from '../analytics/session-extremes';
import {
  findLessonRecurrence,
  type LessonRecurrenceLevel,
} from '../analytics/lesson-recurrence';

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

/** One level touch, reduced to the facts the coach may quote about it. */
export interface DigestLevelTouch {
  date: string;
  symbol: string;
  kind: LevelKind;
  price: number;
  /** Half-width of the level's zone, in points. */
  zonePoints: number;
  label: string | null;
  session: TradingSession;
  setupName: string | null;
  outcome: TouchOutcome;
  /** How far price ran away from the level after the break, in points. */
  maxExcursionPoints: number | null;
  /** How far price came back through the level, in points. Null while undecided. */
  maxReturnPoints: number | null;
  /**
   * Which way price left the level, as the trader recorded it, or null when they did not say.
   * Never assumed from the level's side — a support that broke upward is a real observation.
   */
  breakDirection: 'up' | 'down' | null;
  /**
   * When the answer was settled: when price came back, for a return; the moment the call was
   * made, for a touch that never came back. Null while the touch is still undecided.
   */
  decidedAt: string | null;
  checks: number;
  notes: string | null;
}

/**
 * One logged trade, reduced to the facts the setup learner reasons about.
 *
 * The grouped stats elsewhere in the digest say how a labelled setup performed, but they
 * cannot show what the trader actually does: someone with two setups produces exactly two
 * groups. This is the per-trade record — what it was marked as, when, which way, and why in
 * their own words — which is the raw material for noticing a pattern they never named.
 */
export interface DigestTradeSample {
  /** Trading date, so a pattern can be placed in time. */
  date: string;
  symbol: string;
  direction: string;
  session: string;
  /** The setup the trade was logged under, or null when it was left blank. */
  setupName: string | null;
  /** The entry timestamp exactly as the trader entered it. */
  entryTime: string;
  rMultiple: number;
  netPnL: number;
  /** Why they said they entered, in their own words. */
  entryReason: string | null;
  notes: string | null;
  tags: string[];
  /** How many chart images the trade carries, whether or not any were sent to the coach. */
  imageCount: number;
}

/**
 * The break-and-run record: the trader's own forward observations of whether price came
 * back to a level.
 *
 * This is the one section the coach reads when the trader asks what actually works. It is
 * deliberately split into conditions with a readable sample and conditions that are still
 * too thin, so the model cannot quote a hold rate from two touches. A hold means price
 * never returned — not that a trade paid — and the prompt is told so explicitly.
 */
export interface LevelEdge {
  /** Every touch logged, including the ones still being watched. */
  touches: number;
  /** Touches with a definite answer: never-returned plus returned. */
  decided: number;
  neverReturned: number;
  returned: number;
  watching: number;
  invalid: number;
  /** Share of decided touches where price never came back, or null while nothing is decided. */
  holdRate: number | null;
  /** True once `decided` reaches {@link minDecided}, so `holdRate` may be read as an edge. */
  enoughData: boolean;
  /** Decided touches a bucket needs before its rate means anything. */
  minDecided: number;
  /** Average run away from the level across decided touches, in points. */
  avgExcursionPoints: number | null;
  /** Conditions with a readable sample, ranked by hold rate. */
  conditions: LevelEdgeBucket[];
  /** Conditions logged but still too thin to read, so the coach reports counts, not rates. */
  thinConditions: LevelEdgeBucket[];
  /** The most recent touches, so the coach can talk about specific levels. */
  recentTouches: DigestLevelTouch[];
}

/**
 * One instrument, chart and side of the marked-level record, as the coach reads it.
 *
 * Unlike a {@link LevelEdgeBucket}, which is scoped to a session or a label, this row is scoped
 * to a timeframe — which chart the trader's indicator drew the line on. It carries the mark and
 * test counts alongside the touch stats, because the two questions are different: how many of
 * the lines were reached at all, and what happened when they were.
 */
export interface LevelTimeframeRow {
  symbol: string;
  /** Null when the level was marked before timeframes existed, so nothing is invented. */
  timeframe: LevelTimeframe | null;
  kind: LevelKind;
  marked: number;
  tested: number;
  untested: number;
  /** Untested lines the trader has explicitly closed out as never reached. */
  neverTouched: number;
  testRate: number | null;
  /** Decided touches among the tested lines. */
  decided: number;
  /** Share of those decided touches where price never came back, or null while none is decided. */
  holdRate: number | null;
  /** True once `decided` reaches the readability floor, so `holdRate` may be quoted as a rate. */
  enoughData: boolean;
  watching: number;
}

/**
 * The marked-level record by timeframe, with the coverage that only exists because the lines
 * were written down before they were touched.
 *
 * The trader marks support and resistance on six resolutions for four instruments every day.
 * `tested` counts the marked lines a touch links back to; `untested` is the rest. A low test
 * rate is a fact about the trader's attention — lines they marked and never reached — and it is
 * deliberately kept apart from any hold rate, because the two are answers to different
 * questions and merging them would turn "never reached" into "did not hold".
 */
export interface LevelRecurrenceBucketRead {
  /** The condition in the trader's terms, e.g. "Second touch of the day" or "Mon". */
  label: string;
  touches: number;
  decided: number;
  /** Share of decided touches where price never came back, or null while none is decided. */
  holdRate: number | null;
  /** True once `decided` reaches the readability floor, so `holdRate` may be quoted as a rate. */
  enoughData: boolean;
}

/** One line reached on more than one day, as the coach reads it. */
export interface LevelRecurrenceRowRead {
  symbol: string;
  kind: LevelKind;
  price: number;
  /** Distinct trading days this exact line was touched on. */
  days: number;
  touches: number;
  /** Weekday names it was touched on, in week order. */
  weekdays: string[];
  decided: number;
  holdRate: number | null;
  enoughData: boolean;
}

/**
 * Repetition in the touch record, split by where a touch fell in a day and on which weekday.
 *
 * The break-and-run edge read above treats every touch as one observation. This is the same
 * record read as a sequence: the first test of a line against the third, price printing at the
 * same hour, and the same line reached on more than one day. Every rate is withheld until its
 * bucket reaches the readability floor, so the coach reports the counts instead of a percentage
 * drawn from a handful of touches.
 */
export interface LevelRecurrenceRead {
  /** Decided touches a bucket needs before its rate may be read. */
  minDecided: number;
  /** Lines touched on more than one day, busiest first. */
  repeatedLevels: LevelRecurrenceRowRead[];
  /** Repeated lines beyond the bounded sample above, so the coach knows it is not seeing all. */
  repeatedOmitted: number;
  /** Hold rate by the touch's order within its own day. */
  byOrdinal: LevelRecurrenceBucketRead[];
  /** Hold rate by the hour of day a touch printed, in the trader's timezone. */
  byHour: LevelRecurrenceBucketRead[];
  /** Hold rate by weekday, across every touch on the record. */
  byWeekday: LevelRecurrenceBucketRead[];
}

export interface LevelTimeframesRead {
  /** Every level marked, across all days on the record. */
  marked: number;
  /** Marked levels a touch links back to. */
  tested: number;
  /** Marked levels nothing has been logged against, confirmed or not. */
  untested: number;
  /** Untested levels the trader has explicitly closed out as never reached. */
  neverTouched: number;
  /** Levels the trader set aside as void — excluded from every count above. */
  voided: number;
  /** Tested / marked as a percentage, or null while nothing is marked. */
  testRate: number | null;
  /** Decided touches a row needs before its hold rate may be read as a rate. */
  minDecided: number;
  /** The busiest instrument/timeframe/side rows, tested lines first. */
  rows: LevelTimeframeRow[];
  /** Rows beyond the bounded sample above, so the coach knows it is not seeing everything. */
  rowsOmitted: number;
}

/**
 * One of today's marked lines, with what the record says has happened at that exact line.
 *
 * The timeframe read above is counts per bucket. This is the individual line, because an entry
 * question is about one price: whether the 15-minute resistance the trader is walking into was
 * ever reached today, and if it was, whether price broke through it and stayed away or came
 * straight back. A line nothing has been logged against is `never-touched` — which is not the
 * same as holding, and is never quoted as one.
 */
export interface TodayLevelRead {
  symbol: string;
  /** Null when the line was marked before timeframes existed, so nothing is invented. */
  timeframe: LevelTimeframe | null;
  kind: LevelKind;
  price: number;
  /** The width the line was marked with, in points, which sets what counts as a break. */
  zonePoints: number;
  label: string | null;
  /**
   * What the record says at this line.
   *
   * `never-touched` is the absence of a logged touch, and it is kept distinct from every
   * outcome: a line price never reached is not a line that held.
   */
  status: 'never-touched' | TouchOutcome;
  /**
   * True when the trader explicitly closed this never-reached line out as never touched.
   *
   * A line with no touch is `never-touched` whether or not the trader got to it; only this flag
   * says the answer is theirs rather than the absence of a log, so the coach can tell "price
   * never reached it" from "nothing was written down yet".
   */
  confirmed: boolean;
  /** The session the touch fell in, when there is one. */
  session: string | null;
  touchedAt: string | null;
  /** Points price ran away from the line after the touch, when it was measured. */
  maxExcursionPoints: number | null;
  /** Which way the line's latest touch broke, as the trader recorded it. Null when unstated. */
  breakDirection: 'up' | 'down' | null;
  /** How many times that touch has been checked against price. */
  checks: number | null;
  /** How many times price reached this line today in total. */
  touchCount: number;
  /**
   * Every touch of this line today, oldest first (bounded), each with its own logged state.
   *
   * A line is routinely reached more than once — overnight, at the open, then midday — and the
   * entry read is exactly where that sequence matters. The latest touch still sets `status` and
   * `touchedAt`; this list is what lets the coach tell "the first test held" from "the third one
   * near midday came straight back".
   */
  touches: Array<{ at: string; outcome: TouchOutcome; breakDirection: 'up' | 'down' | null }>;
}

/**
 * Today's marked lines, one row per line, with each line's own logged state.
 *
 * Built for the question a trader actually asks before an entry — "what is between me and where
 * I think this goes, and what did those lines do the last time they were reached?" — which the
 * bucket counts above cannot answer, because they aggregate the very lines that have to be told
 * apart. Only today's lines are here; the history stays in the timeframe read.
 */
export interface TodayLevelsRead {
  /** The trading date these lines belong to, YYYY-MM-DD. */
  date: string;
  /** The symbols with at least one line marked today. */
  symbols: string[];
  /** The lines themselves, grouped by symbol, then chart, then side. */
  levels: TodayLevelRead[];
  /** Lines beyond the bounded list, so the coach knows it is not seeing all of them. */
  omitted: number;
}

/**
 * What the trader expected each instrument to do, written beside the levels it goes with.
 *
 * Per instrument on purpose: MES can lean up while MCL leans down, and collapsing them into one
 * note for the day would throw away the disagreement the trader is trying to track. The previous
 * lean travels too, so a changed read is visible without the coach having to ask for history.
 */
export interface LevelOutlookRead {
  /** Today's leans, one per instrument the trader wrote one for. */
  today: Array<{ symbol: string; bias: MarketOutlookBias; notes: string | null }>;
  /** The most recent earlier lean per instrument, oldest first, so a change is visible. */
  previous: Array<{
    symbol: string;
    date: string;
    bias: MarketOutlookBias;
    notes: string | null;
  }>;
}

/**
 * The session-extreme log, reduced to what the coach may quote about it.
 *
 * The trader logs where each session's high and low printed on the clock; this is the
 * tally that comes back out — when the overnight extreme printed in a given hour, did the
 * regular session keep it, and how often. It is a count over their own recorded sessions
 * and nothing else: the same split as the level-touch record, into hours with a readable
 * sample and hours that are logged but still too thin to carry a rate, so the model cannot
 * quote a percentage from two sessions.
 */
export interface ExtremeRead {
  /** One manually entered price observation from the session the digest is built for. */
  todayObservations: Array<{
    symbol: string;
    date: string;
    time: string;
    price: number;
    kind: string;
    timeframe: string;
    levelType: string;
    ratings: Array<{ horizon: string; outcome: string; grade: number | null }>;
    notes: string | null;
  }>;
  /** Number of current-session observations omitted from the prompt's bounded sample. */
  todayObservationsOmitted: number;
  /** Symbol-and-date rows in the log, however many of their four slots are filled. */
  sessions: number;
  /** Individual extremes logged. */
  points: number;
  /** Instruments the log covers. */
  symbols: string[];
  /** The charts the log covers, so the coach knows which resolutions are even in play. */
  timeframes: string[];
  /** The oldest and newest session dates, or null when the log is empty. */
  firstDate: string | null;
  lastDate: string | null;
  /** Records whose time could not be read, so they are absent from the tally. */
  unreadable: number;
  /** Decided sessions an hour needs before its rate may be read as a pattern. */
  minSessions: number;
  /** Hours with a readable sample, best held rate first. */
  patterns: ExtremeHourPattern[];
  /** Hours logged but still too thin to read, so the coach reports counts, not rates. */
  thinPatterns: ExtremeHourPattern[];
  /** What the trader's own readings say, across every horizon together. */
  ratings: ExtremeRatingStats;
  /** The same readings split by horizon, so an hour that held and a close that did not are visible. */
  ratingsByHorizon: Array<{ horizon: string; stats: ExtremeRatingStats }>;
  /** Rated conditions with a readable sample, best held rate first. */
  ratingConditions: ExtremeRatingBucket[];
  /** Rated conditions logged but still too thin, so the coach reports counts only. */
  thinRatingConditions: ExtremeRatingBucket[];
  /** Rated readings a condition needs before its rate may be read. */
  minRated: number;
}

/** One lesson the trader wrote for themselves, reduced to what the coach may read. */
export interface DigestLesson {
  date: string;
  title: string;
  /** What they wrote, trimmed. Null when they saved only a title and media. */
  notes: string | null;
  kind: string;
  /** The setup the lesson relates to, when it names one. */
  setupName: string | null;
  tags: string[];
  /** How many still images are attached, without sending the bytes here. */
  imageCount: number;
  /**
   * How many video clips are attached.
   *
   * Counted so the coach can say the trader has a clip for this lesson, and that it cannot
   * watch it. The clips themselves are the trader's own and are never sent.
   */
  videoCount: number;
}

/** One lesson behind a repeat, named as the trader wrote it. */
export interface DigestLessonRef {
  /** The lesson's own title. */
  title: string;
  /** The day the trader wrote it, YYYY-MM-DD. */
  date: string;
}

/**
 * One finding the trader keeps writing down again, as the coach may report it.
 *
 * The grouping is computed before the model ever sees the notes — by matching the wording of
 * the notes and the tags they were filed under — so a repeat is a counted fact rather than the
 * model's impression. Only the counts, the titles and the days travel: the notes themselves are
 * already in the list below, and quoting them twice would only pad the prompt.
 */
export interface DigestLessonRepeat {
  /** The title of the earliest lesson that wrote the finding down. */
  title: string;
  /** How many lessons say the same thing. */
  count: number;
  /** How strongly it repeats: 2 is emerging, 3+ recurring, 5+ chronic. */
  level: LessonRecurrenceLevel;
  /** YYYY-MM-DD of the first and last time it was written down. */
  firstDate: string;
  lastDate: string;
  /** The most common kind among the lessons that make up the repeat. */
  kind: string;
  /** Tags shared by two or more of them, as the trader spelled them. */
  sharedTags: string[];
  /** The specific lessons behind the repeat, earliest first, bounded, with their days. */
  members: DigestLessonRef[];
}

/**
 * The trader's own written lessons, as the one dedicated read may quote them.
 *
 * This is the material the trader collected for themselves — a pattern they noticed, a
 * mistake they keep making, a note on how they behave. It is read on request and never
 * folded into the other coach answers, so the notes travel in the digest but only the
 * `lessons` mode formats them into a prompt.
 */
export interface LessonRead {
  /** The lessons, newest first. */
  lessons: DigestLesson[];
  /** Total lessons the trader has saved. */
  total: number;
  /** Lessons omitted from the bounded list above. */
  omitted: number;
  /** How many of the listed lessons carry at least one still image. */
  withImages: number;
  /**
   * Findings the trader keeps writing down again, strongest first.
   *
   * Counted here from the notes the coach is shown, so every repeat has its own lessons in
   * the list below rather than pointing at material the prompt does not carry.
   */
  repeats: DigestLessonRepeat[];
}

/** One coach plan the trader graded, reduced to what the coach may learn from. */
export interface DigestCoachPlan {
  date: string;
  symbol: string;
  direction: string;
  entry: number;
  stop: number;
  target: number;
  confidence: string;
  grade: string | null;
  feedback: string | null;
}

/**
 * The plans the coach made on its own, with the trader's grades and feedback.
 *
 * This is the loop that lets the coach improve at planning: its own recent calls, and the
 * trader's judgement of them. The feedback is quoted back so a habit the trader keeps
 * correcting is visible the next time a plan is asked for. Read only by the self-plan mode.
 */
export interface CoachPlanRead {
  /** The coach's recent plans, newest first. */
  plans: DigestCoachPlan[];
  /** How many plans the coach has made in total. */
  total: number;
  /** How many of them the trader has graded. */
  graded: number;
  /** Plans omitted from the bounded list above. */
  omitted: number;
  /** The trader's written feedback, newest first, for the coach to learn from. */
  feedback: string[];
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
  /**
   * The trader's own record of level touches and whether price came back: the only place
   * the coach can answer "which of my break-and-run conditions actually hold?".
   */
  levelEdge: LevelEdge;
  /**
   * The same record by timeframe: which chart the line came off, and whether it was ever
   * reached. The one place the coach can answer "do the 5-minute lines get tested more than
   * the 30-minute ones?".
   */
  levelTimeframes: LevelTimeframesRead;
  /**
   * Repetition across the touch record: the same line reached more than once, and the same line
   * reached on more than one day. The one place the coach can answer "is it the third test of
   * this line that fails?" or "does this line keep printing on Mondays?".
   */
  levelRecurrence: LevelRecurrenceRead;
  /**
   * Today's marked lines, one row each, with what the record says happened at each one.
   *
   * The bucket counts above answer "which charts get reached". This answers the entry question:
   * which named lines sit around a price right now, and what each of those lines did.
   */
  todayLevels: TodayLevelsRead;
  /**
   * What the trader expected each instrument to do, written down before the session. Read as
   * the trader's own opinion, never as a market fact.
   */
  levelOutlooks: LevelOutlookRead;
  /**
   * The last seven days, one setup at a time: what its trades did and what its levels did.
   *
   * All-time figures blend a setup's good month with its bad one; this is the window a
   * trader can still act on, with the verdict computed here rather than by the model.
   */
  setupWeek: SetupWeek;
  /**
   * Where each session's high and low printed on the clock, as the trader logged them:
   * the one place the coach can answer "when my overnight extreme prints at 3am, has the
   * open kept it?".
   */
  extremeRead: ExtremeRead;
  /**
   * The lessons the trader wrote for themselves, with notes, tags and media counts. Read
   * only by the dedicated lessons mode; other reads are not shown them.
   */
  lessonRead: LessonRead;
  /**
   * The coach's own past plans, with the trader's grades and feedback. Read only by the
   * self-plan mode, so a plan the trader marked down shapes the next plan and nothing else.
   */
  coachPlanRead: CoachPlanRead;
  /**
   * The most recent closed trades, one entry each, newest first.
   *
   * This is what the setup learner reads. The grouped figures above can say how a setup the
   * trader already labelled performed; only the individual trades can show a pattern they
   * have been trading all along without ever naming it.
   */
  tradeSamples: DigestTradeSample[];
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
const MAX_RECENT_TOUCHES = 12;
/**
 * Trades the setup learner is shown.
 *
 * A repeated pattern is visible in a dozen trades; the same fields for a hundred would
 * crowd every other section out of the prompt without adding signal.
 */
const MAX_TRADE_SAMPLES = 20;

/**
 * The whole-history window the picture search reads.
 *
 * A search is retrieval, not pattern-finding: the trader hands in one chart and wants back
 * the trades that resemble it, so recall rises with every row and the older trades are
 * exactly the ones a twenty-row window drops. It is still bounded, because a journal can
 * hold thousands of trades and the prompt is not free — a journal past this limit is told
 * so in the card rather than silently truncated.
 */
export const FULL_HISTORY_TRADE_SAMPLES = 300;

function round(value: number, dp = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
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
  const netPnL = trades.reduce((sum, t) => sum + realizedPnL(t), 0);
  const totalR = trades.reduce((sum, t) => sum + rMultiple(t), 0);
  const wins = trades.filter((t) => realizedPnL(t) > 0).length;
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

/**
 * Turns the raw touch log into the held/returned record the coach reasons about.
 *
 * The two bucket lists are the whole point of splitting it: `conditions` holds only the
 * buckets with a real decided sample, while `thinConditions` keeps the ones that are
 * logged but not yet decidable. That separation is what lets the coach say "your
 * overnight support is 80% over 5 decided touches" without also saying "your London
 * resistance is 100% over one".
 */
function buildLevelEdge(
  touches: LevelTouch[],
  instruments: Instrument[],
  setups: Setup[]
): LevelEdge {
  const stats = summarizeTouches(touches);

  // Every bucket that has any data, then split by whether it carries a real sample. Built
  // with a zero floor so the thin buckets are visible at all — `findLevelEdges` keeps only
  // readable ones by default, which would hide exactly the counts worth reporting.
  const allBuckets = findLevelEdges(touches, 0);
  const conditions = allBuckets.filter((b) => b.stats.decided >= MIN_DECIDED);
  const thinConditions = allBuckets
    .filter((b) => b.stats.touches > 0 && b.stats.decided < MIN_DECIDED)
    .sort((a, b) => b.stats.touches - a.stats.touches || b.stats.decided - a.stats.decided)
    .slice(0, 8);

  const setupNameById = new Map(setups.map((s) => [s.id, s.name]));
  const recentTouches = [...touches]
    .sort((a, b) => (b.touchedAt ?? b.createdAt).localeCompare(a.touchedAt ?? a.createdAt))
    .slice(0, MAX_RECENT_TOUCHES)
    .map((touch) => ({
      date: touch.tradeDate,
      symbol: instrumentSymbol(instruments, touch.instrumentId),
      kind: touch.kind,
      price: touch.price,
      zonePoints: touch.zonePoints,
      label: touch.label?.trim() || null,
      session: touch.session,
      setupName:
        touch.setupName ?? (touch.setupId ? setupNameById.get(touch.setupId) ?? null : null),
      outcome: touch.outcome,
      maxExcursionPoints:
        typeof touch.maxExcursionPoints === 'number' ? round(touch.maxExcursionPoints) : null,
      maxReturnPoints:
        typeof touch.maxReturnPoints === 'number' ? round(touch.maxReturnPoints) : null,
      breakDirection: touch.breakDirection ?? null,
      decidedAt:
        touch.outcome === 'returned'
          ? touch.returnedAt ?? null
          : touch.outcome === 'never-returned'
          ? touch.checkedAt ?? null
          : null,
      checks: touch.checks,
      notes: trimWord(touch.notes),
    }));

  return {
    touches: stats.touches,
    decided: stats.decided,
    neverReturned: stats.neverReturned,
    returned: stats.returned,
    watching: stats.watching,
    invalid: stats.invalid,
    holdRate: stats.holdRate,
    enoughData: stats.enoughData,
    minDecided: MIN_DECIDED,
    avgExcursionPoints: stats.avgExcursionPoints,
    conditions,
    thinConditions,
    recentTouches,
  };
}

/** How many timeframe rows the digest carries before the rest are only counted. */
const MAX_LEVEL_TIMEFRAME_ROWS = 24;

/**
 * Turns the marked levels into the timeframe record the coach reasons about.
 *
 * The row cap is deliberate and reported: a full day of levels across four instruments, six
 * timeframes and two sides is a lot of rows, and a prompt that silently dropped the tail would
 * let the coach claim it had seen everything. `rowsOmitted` says how many were left out.
 */
function buildLevelTimeframes(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  instruments: Instrument[]
): LevelTimeframesRead {
  const coverage = summarizeMarkedLevels(levels, touches);
  const buckets = summarizeTimeframeEdges(levels, touches);
  const rows: LevelTimeframeRow[] = buckets.map((bucket) => ({
    symbol: instrumentSymbol(instruments, bucket.instrumentId),
    timeframe: bucket.timeframe,
    kind: bucket.kind,
    marked: bucket.marked,
    tested: bucket.tested,
    untested: bucket.untested,
    neverTouched: bucket.neverTouched,
    testRate: bucket.testRate,
    decided: bucket.stats.decided,
    holdRate: bucket.stats.holdRate,
    // Carried explicitly so the prompt can withhold a rate from a row whose sample is too
    // thin, instead of every renderer having to re-derive the floor.
    enoughData: bucket.stats.enoughData,
    watching: bucket.stats.watching,
  }));

  return {
    marked: coverage.marked,
    tested: coverage.tested,
    untested: coverage.untested,
    neverTouched: coverage.neverTouched,
    voided: coverage.voided,
    testRate: coverage.testRate,
    minDecided: MIN_DECIDED,
    rows: rows.slice(0, MAX_LEVEL_TIMEFRAME_ROWS),
    rowsOmitted: Math.max(0, rows.length - MAX_LEVEL_TIMEFRAME_ROWS),
  };
}

/** How many recurring lines the digest carries before the rest are only counted. */
const MAX_REPEATED_LEVELS = 12;

/**
 * Turns the touch record into the repetition read the coach reasons about.
 *
 * Kept deliberately close to the raw buckets: the digest does not decide what the pattern is,
 * it hands the counts to the model with the readability floor attached, exactly as the edge
 * read does. Only lines reached on more than one day become rows; a line reached once is the
 * ordinary case and not a recurrence.
 */
function buildLevelRecurrence(
  touches: LevelTouch[],
  instruments: Instrument[],
  timezone: string
): LevelRecurrenceRead {
  const report: LevelRecurrenceReport = summarizeLevelRecurrence(touches, timezone, instruments);
  const bucket = (read: RecurrenceBucket): LevelRecurrenceBucketRead => ({
    label: read.label,
    touches: read.stats.touches,
    decided: read.stats.decided,
    holdRate: read.stats.holdRate,
    enoughData: read.stats.enoughData,
  });

  const rows: LevelRecurrenceRowRead[] = report.repeatedLevels.map((row) => ({
    symbol: row.symbol,
    kind: row.kind,
    price: row.price,
    days: row.days,
    touches: row.touches,
    weekdays: row.weekdays,
    decided: row.stats.decided,
    holdRate: row.stats.holdRate,
    enoughData: row.stats.enoughData,
  }));

  return {
    minDecided: report.minDecided,
    repeatedLevels: rows.slice(0, MAX_REPEATED_LEVELS),
    repeatedOmitted: Math.max(0, rows.length - MAX_REPEATED_LEVELS),
    byOrdinal: report.byOrdinal.map(bucket),
    byHour: report.byHour.map(bucket),
    byWeekday: report.byWeekday.map(bucket),
  };
}

/** How many of today's lines the digest carries before the rest are only counted. */
const MAX_TODAY_LEVELS = 48;

/**
 * Turns today's marked lines into one row each, with the state of each line attached.
 *
 * A line's state comes from the touch that links back to it by id, and from nothing else: a
 * touch logged the old way, with no level behind it, cannot be attributed to a line and so
 * never changes one. The order is symbol, chart, side, then price — the way the trader reads
 * their own card — so the coach sees one chart at a time rather than a shuffled list.
 */
function buildTodayLevels(
  levels: MarkedLevel[],
  touches: LevelTouch[],
  instruments: Instrument[],
  todayTradeDate: string
): TodayLevelsRead {
  // Every touch per line, not just the last: a line reached three times has three answers, and
  // collapsing them into one would hide the sequence the entry read is asking about.
  const touchesByLevel = new Map<string, LevelTouch[]>();
  for (const touch of touches) {
    if (!touch.levelId) continue;
    const list = touchesByLevel.get(touch.levelId);
    if (list) list.push(touch);
    else touchesByLevel.set(touch.levelId, [touch]);
  }
  for (const list of touchesByLevel.values()) {
    list.sort((a, b) => (a.touchedAt ?? a.createdAt).localeCompare(b.touchedAt ?? b.createdAt));
  }

  const symbolOf = (level: MarkedLevel) => instrumentSymbol(instruments, level.instrumentId);
  const today = levels
    // A line the trader set aside is not part of today's read: it is not a line price is
    // watching, and quoting it as never-touched would put a discarded level in front of them.
    .filter((level) => level.tradeDate === todayTradeDate && level.resolution !== 'void')
    .sort((a, b) => {
      const symbol = symbolOf(a).localeCompare(symbolOf(b));
      if (symbol !== 0) return symbol;
      const frame = (a.timeframe ?? '').localeCompare(b.timeframe ?? '');
      if (frame !== 0) return frame;
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      // Support reads upward from the lowest line, resistance downward from the highest, which
      // is the direction price would travel through them.
      const direction = a.kind === 'support' ? 1 : -1;
      return (a.price - b.price) * direction;
    });

  const rows: TodayLevelRead[] = today.map((level) => {
    const linked = touchesByLevel.get(level.id) ?? [];
    // The latest touch carries the line's current state; the whole list travels beside it.
    const touch = linked.length ? linked[linked.length - 1] : undefined;
    return {
      symbol: symbolOf(level),
      timeframe: level.timeframe ?? null,
      kind: level.kind,
      price: level.price,
      zonePoints: level.zonePoints,
      label: level.label?.trim() || null,
      // No linked touch is a fact about the record, not an outcome: never-touched, stated as
      // its own status so it can never be read as a line that held. `confirmed` marks the ones
      // the trader closed out themselves, so the coach can quote their own answer.
      status: touch ? touch.outcome : 'never-touched',
      confirmed: !touch && level.resolution === 'never-touched',
      session: touch ? touch.session : null,
      touchedAt: touch ? touch.touchedAt ?? null : null,
      maxExcursionPoints:
        touch && typeof touch.maxExcursionPoints === 'number'
          ? round(touch.maxExcursionPoints)
          : null,
      breakDirection: touch?.breakDirection ?? null,
      checks: touch ? touch.checks : null,
      touchCount: linked.length,
      touches: linked.slice(-6).map((entry) => ({
        at: entry.touchedAt ?? entry.createdAt,
        outcome: entry.outcome,
        breakDirection: entry.breakDirection ?? null,
      })),
    };
  });

  return {
    date: todayTradeDate,
    symbols: [...new Set(today.map(symbolOf))],
    levels: rows.slice(0, MAX_TODAY_LEVELS),
    omitted: Math.max(0, rows.length - MAX_TODAY_LEVELS),
  };
}

/**
 * Turns the daily outlooks into the read the coach reasons about.
 *
 * Today's leans are the ones being tested by the session, so they lead; the most recent earlier
 * lean per instrument rides along beside them so a change of mind is visible. Both are the
 * trader's own words, quoted back rather than interpreted.
 */
function buildLevelOutlooks(
  outlooks: LevelOutlook[],
  instruments: Instrument[],
  todayTradeDate: string
): LevelOutlookRead {
  const today = outlooks.filter((outlook) => outlook.tradeDate === todayTradeDate);

  const latestEarlier = new Map<string, LevelOutlook>();
  for (const outlook of [...outlooks]
    .filter((entry) => entry.tradeDate < todayTradeDate)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))) {
    latestEarlier.set(outlook.instrumentId, outlook);
  }

  return {
    today: today.map((outlook) => ({
      symbol: instrumentSymbol(instruments, outlook.instrumentId),
      bias: outlook.bias,
      notes: trimWord(outlook.notes),
    })),
    previous: [...latestEarlier.values()].map((outlook) => ({
      symbol: instrumentSymbol(instruments, outlook.instrumentId),
      date: outlook.tradeDate,
      bias: outlook.bias,
      notes: trimWord(outlook.notes),
    })),
  };
}

export /**
 * Turns the raw session-extreme log into the hour tally the coach reasons about.
 *
 * The two lists are the whole point of splitting it, exactly as the level-touch record is
 * split: `patterns` holds only the hours with a real decided sample, `thinPatterns` keeps
 * the ones that are logged but not yet decidable, so the coach can say "the MES overnight
 * high printed at 3am and the open kept it in 4 of 5 sessions" without also saying
 * "2 of 2" as if it were a rate.
 */
function buildExtremeRead(extremes: SessionExtreme[], todayTradeDate: string): ExtremeRead {
  const summary = summarizeExtremes(extremes);
  // Keep the newest observations from the active session available to the coach without
  // letting a long-running or restored log make every prompt unbounded.
  const todays = extremes
    .filter((extreme) => extreme?.tradeDate === todayTradeDate && Number.isFinite(extreme.price))
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const maxTodayObservations = 60;
  const todayObservations = todays.slice(-maxTodayObservations).map((extreme) => ({
    symbol: extreme.symbol,
    date: extreme.tradeDate,
    time: extreme.time,
    price: extreme.price,
    kind: extreme.kind,
    timeframe: extreme.timeframe ?? '1m',
    levelType: extreme.levelType ?? (extreme.kind === 'high' ? 'resistance' : 'support'),
    ratings: (extreme.ratings ?? []).map((rating) => ({
      horizon: rating.horizon,
      outcome: rating.outcome,
      grade: typeof rating.grade === 'number' && Number.isFinite(rating.grade) ? rating.grade : null,
    })),
    notes: extreme.notes ? extreme.notes.slice(0, 160) : null,
  }));
  // Read one chart at a time, then pooled: a print only means something inside the timeframe
  // it came off, so the pattern read never mixes two resolutions into one rate.
  const days = buildDaysByTimeframe(extremes);
  const all = buildOvernightHourPatterns(days);
  // Every bucket, thin ones included, so the split into readable and counted is made here
  // rather than by a floor that would hide the conditions worth reporting as counts.
  const ratingEdges = findRatingEdges(extremes, { minRated: 0 });
  const timeframes = [...new Set(days.map((day) => day.timeframe))].sort();

  return {
    todayObservations,
    todayObservationsOmitted: todays.length - todayObservations.length,
    sessions: summary.sessions,
    points: summary.points,
    symbols: summary.symbols,
    timeframes,
    firstDate: summary.firstDate,
    lastDate: summary.lastDate,
    unreadable: summary.unreadable,
    minSessions: MIN_PATTERN_SESSIONS,
    patterns: all.filter((pattern) => pattern.enoughData),
    thinPatterns: all.filter((pattern) => !pattern.enoughData).slice(0, 8),
    ratings: summarizeRatings(extremes),
    ratingsByHorizon: RATING_HORIZONS.map((horizon) => ({
      horizon,
      stats: summarizeRatings(extremes, { horizon }),
    })),
    // Compared against the floor here rather than trusting `enoughData`, which is relative to
    // the floor the caller passed — the same way the level-touch buckets are split.
    ratingConditions: ratingEdges.filter((bucket) => bucket.stats.rated >= MIN_RATED),
    thinRatingConditions: ratingEdges
      .filter((bucket) => bucket.key !== 'all' && bucket.stats.rated < MIN_RATED)
      .slice(0, 8),
    minRated: MIN_RATED,
  };
}

/**
 * Bounds one lesson's notes so a long written note cannot fill the whole prompt.
 *
 * The trader's own words are the point of the read, so this trims rather than drops, on a
 * character boundary and at a word where possible.
 */
function buildLessonRead(lessons: Lesson[], setups: Setup[]): LessonRead {
  const maxLessons = 40;
  const maxNotes = 1500;
  // Repeats are the headline of the read, so a handful is plenty; the rest of the library is
  // still in the list, and a short list keeps the prompt focused on the strongest finding.
  const maxRepeats = 6;
  const maxMemberRefs = 8;
  const setupNameById = new Map(setups.map((setup) => [setup.id, setup.name]));
  // A local test rather than the media helper: that module imports the Supabase client, and
  // this one is bundled into the dependency-free coach function, so it must not pull it in.
  const looksLikeVideo = (url: string) =>
    url.startsWith('data:video/') || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i.test(url);

  const newestFirst = [...lessons]
    .filter((lesson) => lesson && typeof lesson.title === 'string')
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const bounded = newestFirst.slice(0, maxLessons);
  const listed = bounded.map((lesson): DigestLesson => {
    const rawNotes = (lesson.notes ?? '').trim();
    const notes =
      rawNotes.length > maxNotes
        ? `${(trimWord(rawNotes.slice(0, maxNotes)) ?? '').trimEnd()}…`
        : rawNotes;
    const media = lesson.media ?? [];
    const videoCount = media.filter((item) => looksLikeVideo(item)).length;
    return {
      date: (lesson.createdAt ?? '').slice(0, 10),
      title: lesson.title.trim().slice(0, 200),
      notes: notes || null,
      kind: lesson.kind ?? 'other',
      setupName:
        lesson.setupId ? setupNameById.get(lesson.setupId) ?? null : null,
      tags: (lesson.tags ?? []).slice(0, 8),
      imageCount: media.length - videoCount,
      videoCount,
    };
  });

  // The repeats are read from the same bounded set the coach is shown, so a group always has
  // its own lessons in the list rather than pointing at material the prompt does not carry.
  const lessonById = new Map(bounded.map((lesson) => [lesson.id, lesson]));
  const repeats = findLessonRecurrence(bounded).clusters
    .slice(0, maxRepeats)
    .map(
      (cluster): DigestLessonRepeat => ({
        title: cluster.representativeTitle || lessonById.get(cluster.representativeId)?.title.trim() || '',
        count: cluster.count,
        level: cluster.level,
        firstDate: cluster.firstDate,
        lastDate: cluster.lastDate,
        kind: cluster.dominantKind,
        sharedTags: cluster.sharedTags.slice(0, 8),
        members: cluster.lessonIds
          .map((id) => lessonById.get(id))
          .filter((lesson): lesson is Lesson => !!lesson)
          .slice(0, maxMemberRefs)
          .map((lesson) => ({
            title: lesson.title.trim(),
            date: (lesson.createdAt ?? '').slice(0, 10),
          })),
      })
    );

  return {
    lessons: listed,
    total: newestFirst.length,
    omitted: Math.max(0, newestFirst.length - listed.length),
    withImages: listed.filter((lesson) => lesson.imageCount > 0).length,
    repeats,
  };
}

/**
 * Bounds the coach's own plan history so a long record cannot fill the prompt.
 *
 * The plans carry levels, so this keeps a readable recent window; the feedback is listed
 * separately because it is the trader's voice, which is what the model is meant to learn
 * from, and it is quoted in full length up to a bound rather than counted.
 */
function buildCoachPlanRead(plans: CoachPlan[]): CoachPlanRead {
  const maxPlans = 12;
  const maxFeedback = 10;
  const maxFeedbackChars = 600;

  const newestFirst = [...plans]
    .filter((plan) => plan && typeof plan.symbol === 'string')
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const listed = newestFirst.slice(0, maxPlans).map((plan): DigestCoachPlan => ({
    date: (plan.createdAt ?? '').slice(0, 10),
    symbol: plan.symbol,
    direction: plan.direction,
    entry: plan.entry,
    stop: plan.stop,
    target: plan.target,
    confidence: plan.confidence,
    grade: plan.grade ?? null,
    feedback: plan.feedback?.trim() || null,
  }));

  const feedback = listed
    .map((plan) =>
      plan.feedback
        ? `${plan.symbol} ${plan.direction} on ${plan.date} ` +
          `(${plan.grade ? `graded ${plan.grade}` : 'no grade'}): ${plan.feedback}`
        : ''
    )
    .filter(Boolean)
    .slice(0, maxFeedback)
    .map((line) =>
      line.length > maxFeedbackChars ? `${line.slice(0, maxFeedbackChars).trimEnd()}…` : line
    );

  return {
    plans: listed,
    total: newestFirst.length,
    graded: newestFirst.filter((plan) => plan.grade).length,
    omitted: Math.max(0, newestFirst.length - listed.length),
    feedback,
  };
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
  /**
   * The trader's level-touch log: levels they marked as touched and whether price ever
   * came back. Optional so a caller with no touch data — and every older test — still
   * builds a digest; absent is read as "nothing logged", never as a rate of zero.
   */
  levelTouches?: LevelTouch[];
  /**
   * The prices the trader marked before any of them was touched, with their timeframes.
   *
   * Optional for the same reason as the touches above: absent is read as "nothing marked",
   * never as a test rate of zero.
   */
  markedLevels?: MarkedLevel[];
  /**
   * The trader's own daily read of each instrument — bullish, bearish or neutral.
   *
   * Optional: absent is read as "no outlook written", never as neutral.
   */
  levelOutlooks?: LevelOutlook[];
  /**
   * The trader's session-extreme log: where each session's high and low printed on the
   * clock, overnight and regular, for the instruments they trade.
   *
   * Optional for the same reason as the touches above: a caller with no extreme data — and
   * every older test — still builds a digest, and absent is read as "nothing logged", never
   * as a finding.
   */
  sessionExtremes?: SessionExtreme[];
  /**
   * The trader's own written lessons, with the media counts. Read only by the dedicated
   * lessons mode; absent is read as "nothing written down", never as an empty finding.
   */
  lessons?: Lesson[];
  /**
   * The plans the coach made on its own, with the trader's grades and feedback. Read only by
   * the self-plan mode; absent is read as "no plans made yet".
   */
  coachPlans?: CoachPlan[];
  /**
   * How many per-trade rows the digest carries, newest first.
   *
   * Defaults to the learner's window. The picture search passes the whole-history window,
   * because it is resolving one chart against every trade rather than looking for a pattern
   * that only a handful of rows would show.
   */
  tradeSampleLimit?: number;
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
  const wins = closed.filter((t) => realizedPnL(t) > 0);
  const losses = closed.filter((t) => realizedPnL(t) < 0);
  const scratches = closed.length - wins.length - losses.length;

  const netPnL = closed.reduce((sum, t) => sum + realizedPnL(t), 0);
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
    dayPnLById.set(trade.tradingDayId, (dayPnLById.get(trade.tradingDayId) ?? 0) + realizedPnL(trade));
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

  // ---- Trade samples -------------------------------------------------------
  // The setup learner's raw material, newest first. A trade whose day is missing falls back
  // to the date on its own timestamp, the same rule the recent-form windows use.
  // Bounded on both ends: a caller cannot ask for fewer than one or more than the whole-
  // history ceiling, so a bad number from a client cannot blow up the prompt.
  const sampleLimit = Number.isFinite(input.tradeSampleLimit)
    ? Math.min(Math.max(1, Math.floor(input.tradeSampleLimit as number)), FULL_HISTORY_TRADE_SAMPLES)
    : MAX_TRADE_SAMPLES;
  const tradeSamples: DigestTradeSample[] = closedNewestFirst
    .slice(0, sampleLimit)
    .map((trade) => {
      const day = dayById.get(trade.tradingDayId);
      return {
        date:
          day?.tradeDate ??
          (trade.entryTime ? trade.entryTime.slice(0, 10) : 'date not recorded'),
        symbol: instrumentSymbol(instruments, trade.instrumentId),
        direction: trade.direction,
        session: trade.session,
        setupName: trade.setupName?.trim() || null,
        entryTime: trade.entryTime,
        rMultiple: round(rMultiple(trade)),
        netPnL: round(realizedPnL(trade)),
        entryReason: trimWord(trade.entryReason),
        notes: trimWord(trade.notes),
        tags: trade.tags ?? [],
        imageCount: trade.images?.length ?? 0,
      };
    });

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
        netPnL: realizedPnL(trade),
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
  // ---- The break-and-run record -------------------------------------------
  const levelEdge = buildLevelEdge(input.levelTouches ?? [], instruments, setups);
  const levelTimeframes = buildLevelTimeframes(
    input.markedLevels ?? [],
    input.levelTouches ?? [],
    instruments
  );
  const levelRecurrence = buildLevelRecurrence(
    input.levelTouches ?? [],
    instruments,
    input.timezone
  );
  const todayLevels = buildTodayLevels(
    input.markedLevels ?? [],
    input.levelTouches ?? [],
    instruments,
    todayTradeDate
  );
  const levelOutlooks = buildLevelOutlooks(
    input.levelOutlooks ?? [],
    instruments,
    todayTradeDate
  );

  // ---- Where the session extremes printed --------------------------------
  const extremeRead = buildExtremeRead(input.sessionExtremes ?? [], todayTradeDate);

  // ---- The trader's own written lessons -----------------------------------
  const lessonRead = buildLessonRead(input.lessons ?? [], setups);

  // ---- The coach's own plans, and how the trader judged them ---------------
  const coachPlanRead = buildCoachPlanRead(input.coachPlans ?? []);

  // ---- The week, one setup at a time --------------------------------------
  // The same seven days read twice: what each setup's trades paid, and how its levels held.
  // Built here rather than per mode so the numbers the coach writes about are the numbers
  // the card shows, from one pass over one window.
  const setupWeek = buildSetupWeek({
    trades,
    tradingDays,
    touches: input.levelTouches ?? [],
    todayTradeDate,
    focusSetupNames: setups.map((setup) => setup.name),
  });

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

  // A level touch only becomes a result once price has broken the level and either
  // returned or not, so a small decided count is the normal state early on. Said here, at
  // the top, so the coach cannot quote a hold rate from two observations without the
  // caveat in front of it.
  if (levelEdge.touches > 0 && levelEdge.decided < MIN_DECIDED) {
    caveats.push(
      `Only ${levelEdge.decided} of ${levelEdge.touches} logged level touch(es) have a decided ` +
        `outcome (price broke the level and was watched from there). ${MIN_DECIDED} decided ` +
        `touches are needed before a hold rate means anything.`
    );
  }

  // The same warning for the session-extreme log, for the same reason: an hour that has
  // been logged a few times is a tally, and the coach must not dress it up as a pattern.
  if (extremeRead.points > 0 && extremeRead.patterns.length === 0) {
    caveats.push(
      `No session-extreme hour has a readable sample yet: ${extremeRead.sessions} session(s) ` +
        `logged, and ${MIN_PATTERN_SESSIONS} decided sessions are needed for any hour before ` +
        `it means anything. The extreme counts are a tally of what was logged so far, not a ` +
        `pattern.`
    );
  }
  if (extremeRead.ratings.rated > 0 && extremeRead.ratingConditions.length === 0) {
    caveats.push(
      `Only ${extremeRead.ratings.rated} rated print(s) so far and no condition has ` +
        `${MIN_RATED}. The trader's own ratings are a record of what happened to the levels ` +
        `they marked, not a rate, until a condition reaches that floor.`
    );
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
      largestWin: round(closed.reduce((m, t) => Math.max(m, realizedPnL(t)), 0)),
      largestLoss: round(closed.reduce((m, t) => Math.min(m, realizedPnL(t)), 0)),
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
      pnlOf: realizedPnL,
    }),
    recentDays,
    recentForm,
    behavior,
    levelEdge,
    levelTimeframes,
    levelRecurrence,
    todayLevels,
    levelOutlooks,
    extremeRead,
    lessonRead,
    coachPlanRead,
    setupWeek,
    tradeSamples,
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
      netPnL: round(todayTrades.reduce((sum, t) => sum + realizedPnL(t), 0)),
      openTrades: todayTrades.filter((t) => !isClosed(t)).length,
    },
  };
}
