export type RiskMode = 'normal' | 'expanded';
export type DayStatus = 'planning' | 'active' | 'completed';
export type MarketBias = 'bullish' | 'bearish' | 'neutral' | 'unsure';
export type TradingSession = 'Overnight' | 'Premarket' | 'Regular Session';
export type TradeDirection = 'long' | 'short';
export type TradeStatus = 'open' | 'closed';
export type TrailingMethod = 'None' | 'Manual' | 'Structure' | 'Fixed Points' | 'Moving Average' | 'Other';
export type QuestionAnswer = 'yes' | 'no' | 'na';

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  pointValue: number; // e.g. $5 for MES
  tickSize: number;   // e.g. 0.25 for MES
  tickValue: number;  // e.g. $1.25 for MES
  active: boolean;
}

export interface Setup {
  id: string;
  name: string;
  active: boolean;
  description?: string;
  images?: string[]; // Array of chart screenshot data URLs / image URLs
  /**
   * Built-in catalog version this setup arrived in.
   *
   * Absent means it has been in the catalog since before it was versioned (treated as 1),
   * so a built-in the trader deleted on purpose is never resurrected by a later release.
   */
  since?: number;
  /**
   * The built-in name this setup came from, once it has been renamed.
   *
   * The study guide and the example charts are keyed by name, so without this a trader who
   * renames "Engulfing" to their own words would lose the guide and the chart that go with
   * it. Keeping the original name lets the renamed setup still find its teaching material,
   * and stops a later catalog release from adding the built-in back under its old name.
   */
  builtinName?: string;
  createdAt: string;
}

export interface ImportantLevel {
  id: string;
  tradingDayId: string;
  price: number;
  label?: string;
  notes?: string;
}

export interface PlanChange {
  id: string;
  tradingDayId: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  reason: string;
  changedAt: string;
}

export interface PlanSnapshot {
  riskMode: RiskMode;
  normalLossLimit: number;
  plannedLossLimit: number;
  contractsPlanned: number;
  primaryInstrument: string;
  allowedSessions: TradingSession[];
  marketBias: MarketBias;
  /** The Trade # that was pre-selected when the plan was locked, when there was one. */
  defaultRiskTier?: number;
  /** The per-slot trade caps that were in force when the plan was locked. */
  riskTierCaps?: number[];
  lockedAt: string;
}

export interface TradingDay {
  id: string;
  userId: string;
  tradeDate: string; // YYYY-MM-DD
  status: DayStatus;
  riskMode: RiskMode;
  normalLossLimit: number;
  plannedLossLimit: number; // In expanded mode, this is the expanded loss limit
  profitCushionContext?: string;
  riskIncreaseReason?: string;
  contractsPlanned: number;
  primaryInstrument: string; // e.g. 'MES'
  allowedSessions: TradingSession[];
  marketBias: MarketBias;
  watchedSetups: string[]; // setup ids or names
  /**
   * The Trade # the trade form opens on for this day.
   *
   * Only a starting point: all four slots and the custom option stay available when
   * recording a trade, so a plan that names #1 never blocks a #3 that the setup earns.
   */
  defaultRiskTier?: number;
  /**
   * How many trades the plan allows at each fixed slot, with 0 (or absent) meaning no cap.
   *
   * The cap is a warning rather than a wall: the trade form still records a trade that
   * goes past it, because a form that refuses is one the trader works around, and the
   * record of having broken the plan is exactly what this journal exists to keep.
   */
  riskTierCaps?: number[];
  importantLevels: ImportantLevel[];
  waitingFor: string;
  stayOutIf: string;
  notes?: string;
  lockedAt?: string;
  lockedSnapshot?: PlanSnapshot;
  planChanges: PlanChange[];
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeExecutionReview {
  id: string;
  tradeId: string;
  followedSetup: QuestionAnswer;
  followedStop: QuestionAnswer;
  chasedEntry: QuestionAnswer;
  revengeTrade: QuestionAnswer;
  addedUnnecessaryRisk: QuestionAnswer;
  movedStopEmotion: QuestionAnswer;
  letWinnerWork: QuestionAnswer;
  wouldTakeAgain: QuestionAnswer;
}

export interface TradeManagement {
  id: string;
  tradeId: string;
  breakevenPrice?: number;
  breakevenTime?: string;
  profitSecured?: number;
  trailingMethod?: TrailingMethod;
  notes?: string;
}

/**
 * The coach's own call on an entry, recorded beside the trade.
 *
 * It is stored (rather than recomputed) because the comparison is between two things
 * that happened at one moment: the coach's read then and the trader's entry then. Asking
 * again later, on different prices would compare the trader against an answer they were
 * never shown. Defined here, beside the trade it belongs to; the coach types re-export
 * it so there is one definition.
 */
export interface CoachEntryCall {
  direction: 'long' | 'short' | 'flat';
  entry: number | null;
  stop: number | null;
  target: number | null;
  rationale: string;
  /** The live price the call was made against, when the read worked. */
  marketPrice: number | null;
  createdAt: string;
}

export interface Trade {
  id: string;
  userId: string;
  tradingDayId: string;
  instrumentId: string; // refers to Instrument
  source: 'manual' | 'tradovate_csv';
  importId?: string;
  direction: TradeDirection;
  contracts: number;
  entryPrice: number;
  initialStop: number;
  exitPrice?: number;
  entryTime: string; // ISO string or time
  exitTime?: string;
  session: TradingSession;
  /**
   * Groups the legs of one position together.
   *
   * When a scale-in is logged from the break-even calculator the new leg is
   * given the opening trade's positionId (or its own id when it is the first
   * leg), so the journal can show the blended entry and combined size instead
   * of two unrelated rows. Standalone trades leave this undefined.
   */
  positionId?: string;
  setupId?: string;
  setupName?: string;
  entryReason?: string;
  notes?: string;
  tags?: string[];
  initialRisk: number; // $
  /**
   * Which numbered slot of the risk plan this trade was taken against.
   *
   * 1–4 is one of the fixed slots, null is the custom amount, and undefined means the
   * trade predates the ladder (an import, or an older record). The distinction matters:
   * undefined must not be read as "custom", or an imported trade would look like a
   * deliberate choice.
   */
  riskTier?: number | null;
  /** The dollar risk the slot committed to, including a custom amount. */
  plannedRisk?: number;
  /**
   * Where the stop — and therefore the risk and the R-multiple — came from.
   *
   * A broker CSV carries no stop price, so an import has to invent one and is marked
   * 'assumed'. Anything the trader entered or confirmed is 'recorded'. Undefined means
   * the trade predates this field: treated as recorded unless it was imported, since
   * an imported stop could only ever have been a guess. See `hasAssumedRisk`.
   */
  riskSource?: 'recorded' | 'assumed';
  grossPnL: number;    // $
  netPnL?: number;     // $
  fees?: number;       // $
  pointsPnL: number;   // points
  rMultiple: number;   // R
  status: TradeStatus;
  screenshotPath?: string;
  images?: string[]; // Array of chart screenshot data URLs / image URLs
  executionReview?: TradeExecutionReview;
  tradeManagement?: TradeManagement;
  /** The coach's direction and level for this entry, when it made a call. */
  coachCall?: CoachEntryCall;
  createdAt: string;
  updatedAt: string;
}

export interface DailyReviewQuestions {
  followedSetups: QuestionAnswer;
  followedPredeterminedRisk: QuestionAnswer;
  followedStops: QuestionAnswer;
  chasedEntries: QuestionAnswer;
  revengeTraded: QuestionAnswer;
  addedUnnecessaryRisk: QuestionAnswer;
  movedStopsEmotion: QuestionAnswer;
  letWinnersWork: QuestionAnswer;
  stoppedWhenShould: QuestionAnswer;
}

export interface DailyReview {
  id: string;
  userId: string;
  tradingDayId: string;
  questions: DailyReviewQuestions;
  disciplineScore: number; // 0 - 100
  scoringDetails: {
    rule: string;
    answer: QuestionAnswer;
    isFollowed: boolean | null; // null if N/A
  }[];
  didWell: string;
  didPoorly: string;
  tomorrowFocus: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  displayName: string;
  timezone: string; // e.g. 'America/New_York'
  defaultInstrument: string; // e.g. 'MES'
  defaultDailyLossLimit: number; // e.g. 100
  /**
   * The numbered risk ladder: what trade #1 through #4 are each allowed to risk.
   *
   * Four fixed slots plus a per-trade custom amount, so risk is chosen before a position
   * exists rather than typed to fit one. Optional because a profile saved before this
   * existed has no ladder, and the defaults ($25/$50/$75/$100) are used instead.
   */
  riskTierAmounts?: number[];
  /**
   * The account-level drawdown the trader has committed to, in dollars.
   *
   * It is measured from the equity high-water mark, the way a funding firm measures a
   * trailing drawdown, rather than from a fixed starting balance. That is the shape that
   * makes growing the number meaningful: a new high resets the room available, so risk can
   * grow with the account without the floor ever moving down.
   *
   * Optional because a profile saved before this existed has no number, and the app must
   * be able to say "no limit set" rather than invent one.
   */
  maxDrawdown?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * The trader's acknowledgement of one carried-forward lesson.
 *
 * Stored with the lesson's own date and text, not as a plain flag: the acknowledgement has
 * to hold for the rest of the day and then stop applying the moment a different lesson is
 * set up. Comparing the stored pair is what makes "until a new one is set up" exact
 * instead of a timer the app would have to guess at.
 */
export interface LessonAcknowledgement {
  /** The trading date the lesson came from. */
  date: string;
  /** The lesson text, as it read when it was acknowledged. */
  focus: string;
  acknowledgedAt: string;
}

// ---------------------------------------------------------------------------
// Chart Pattern playbook study data
//
// Two kinds of thing live here and they are deliberately different:
//
// - The pattern itself (name, geometry, explanation) is content, shipped in
//   src/lib/playbook/patterns*.ts and identical for every install.
// - `PatternStudy` is the trader's own material: status, checklist, notes and logged
//   examples with screenshots. Only this second part is persisted and synced.
// ---------------------------------------------------------------------------

/**
 * What a pattern is doing while the trader studies it.
 *
 * These are study-journal states, not trading instructions, and the distinction between
 * `forming`/`near-breakout` (structure exists) and `confirmed` (a candle CLOSED beyond it)
 * is the whole reason the list is this precise.
 */
export type PatternStatus =
  | 'watching'
  | 'forming'
  | 'near-breakout'
  | 'breakout-attempted'
  | 'confirmed'
  | 'retest'
  | 'failed-breakout'
  | 'invalidated'
  | 'completed';

export type PatternGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** One logged real-world example of a pattern, reviewed after the fact. */
export interface PatternStudyEntry {
  id: string;
  patternId: string;
  /** Instrument, date and timeframe the example was taken on. */
  instrument?: string;
  tradeDate?: string;
  timeframe?: string;
  /** Which stage the pattern was at when the trader acted, if they acted. */
  stageWhenActed?: PatternStatus;
  grade?: PatternGrade;
  /** Chart screenshots, stored inline as data URLs like the rest of the journal. */
  beforeImage?: string;
  afterImage?: string;
  whyValid?: string;
  whatInvalidated?: string;
  didWell?: string;
  didWrong?: string;
  nextTime?: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything the trader has recorded about one pattern. One row per pattern. */
export interface PatternStudy {
  patternId: string;
  status: PatternStatus;
  /** Keys of the checklist rows that are ticked. See `checklistKey`. */
  checklist: string[];
  notes: string;
  entries: PatternStudyEntry[];
  updatedAt: string;
}
