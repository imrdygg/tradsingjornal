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
  /**
   * Built-in catalog version this instrument arrived in.
   *
   * Absent means it has been in the catalog since before it was versioned (treated as 1),
   * so a contract the trader removed on purpose is never resurrected by a later release.
   */
  since?: number;
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
   * renames "Support" to their own words would lose the guide and the chart that go with
   * it. Keeping the original name lets the renamed setup still find its teaching material,
   * and stops a later catalog release from adding the built-in back under its old name.
   */
  builtinName?: string;
  /**
   * Where this setup came from, when it was not the trader.
   *
   * `'ai'` marks a draft the coach wrote from their own trade history and entry charts, so
   * it can be badged in the Playbook and never mistaken for one of the setups they trade.
   * Absent means the trader's own — a built-in they kept, or one they typed by hand. A
   * draft is an ordinary Setup everywhere else: the same edit, rename, disable and delete
   * paths apply, and nothing treats it as read-only.
   */
  origin?: 'ai';
  createdAt: string;
}

export interface ImportantLevel {
  id: string;
  tradingDayId: string;
  price: number;
  label?: string;
  notes?: string;
  /**
   * Free-form labels for this level, entered comma-separated.
   *
   * Where `label` names the level itself ("Overnight High"), tags classify it so a set of
   * levels can be read at a glance and found later by search — "liquidity", "news",
   * "key". Stored the same way a trade's tags are, so one habit covers both.
   */
  tags?: string[];
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

// ---------------------------------------------------------------------------
// Session extremes — where each session's high and low printed on the clock
//
// The trader logs the extremes of the instruments they trade by hand: when the
// overnight high printed, when the overnight low did, and the same again for the
// regular session. Nothing in the app can fetch those times (the quote read gives a
// day's high and low with no clock on them), so the log is the trader's own record,
// exactly like the level-touch log beside it.
//
// Two windows, because the question being asked is about the open: an extreme that
// prints at 3am is a different fact from one that prints at 11am, and only the first
// says anything about how the regular session started.
// ---------------------------------------------------------------------------

/** The two windows an extreme can print in, in the order they happen. */
export type SessionWindow = 'overnight' | 'regular';

/** Which end of the range a logged extreme is. */
export type ExtremeKind = 'high' | 'low';

export interface SessionExtreme {
  id: string;
  userId: string;
  /**
   * YYYY-MM-DD — the session this extreme belongs to, in the trader's own calendar.
   *
   * Denormalised on purpose, like a level touch's date: the stats group extremes by
   * symbol, date and window without joining back to a day record, and a logged extreme
   * stays readable even if its day is ever deleted.
   */
  tradeDate: string;
  instrumentId: string;
  /**
   * The instrument's symbol at the time it was logged (`MES`, `MNQ`, `MCL`).
   *
   * Carried on the record rather than resolved from `instrumentId` so a renamed or
   * deleted instrument cannot quietly move a session's history onto something else.
   */
  symbol: string;
  kind: ExtremeKind;
  /** ET clock time the extreme printed at, `HH:MM`. */
  time: string;
  price: number;
  /**
   * Which window `time` falls in, derived when it was logged and then stored.
   *
   * Stored rather than recomputed so that a later change to the window boundaries
   * cannot silently reclassify a record the trader already made. `time` is still the
   * source of the clock hour the stats read.
   */
  window: SessionWindow;
  notes?: string;
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
  /**
   * The price the exit was planned around when the trade was entered.
   *
   * A plan, not a fill: it is what the trader intended to exit at, kept beside the actual
   * `exitPrice` so the two can be compared after the fact. Optional because it is not
   * every trade that has a fixed target.
   */
  targetPrice?: number;
  /**
   * Why the trade was actually exited, written after the fact.
   *
   * The exit counterpart to `entryReason`: what the trader says made them close, kept as
   * their own words rather than inferred from the price.
   */
  exitReason?: string;
  /**
   * The trader's own note on the ENTRY — free-form writing beside `entryReason`.
   *
   * Named plainly `notes` for the records written before notes were split by subject; it
   * is the entry-side note the form shows under "Entry note". The exit-side one is
   * `exitNote`.
   */
  notes?: string;
  /**
   * The trader's own note on the EXIT, written after the fact.
   *
   * The exit counterpart to `notes`, so the record of getting out has somewhere to live
   * that is not the entry note. Tags are shared between the two; notes are not.
   */
  exitNote?: string;
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
   * The floor it describes is fixed: it sits this far below the point the journal started
   * from, and it never moves. Profit therefore adds room dollar for dollar and a loss takes
   * it back the same way, which is what makes the number worth reading — a good run lifts
   * what is left above the agreed figure rather than leaving it parked on it.
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

// ---------------------------------------------------------------------------
// Level Watch — the break-and-run journal
//
// The whole app is organised around two set-ups, and both are the same idea read
// at different times: a support or resistance level is touched and price does NOT
// come back. That is a claim about the future, so a touch cannot be judged when it
// happens. A touch is therefore recorded at the moment price reaches the level and
// then left open, `watching`, while the app keeps asking whether price ever comes
// back. A touch price never revisits is the signal this journal exists to find; a
// touch price returns to is kept as the control that makes the rate mean something.
// ---------------------------------------------------------------------------

/** Which side of the level price approached from when it was touched. */
export type LevelKind = 'support' | 'resistance';

/**
 * What price did after the level was touched.
 *
 * `watching` is the honest state for a fresh touch: it is only a break-and-run once
 * enough time has passed with price never coming back, and until then the app must
 * be able to say it does not know yet rather than call the touch a winner. `invalid`
 * is for a touch the trader set aside — a mis-marked level, a data problem — so it is
 * excluded from every rate instead of quietly counting as a return.
 */
export type TouchOutcome = 'watching' | 'never-returned' | 'returned' | 'invalid';

export interface LevelTouch {
  id: string;
  userId: string;
  /** The trading day the touch happened on. */
  tradingDayId: string;
  /**
   * YYYY-MM-DD, carried on the touch itself.
   *
   * Denormalised on purpose: the stats group touches by session, set-up and level
   * without needing to join each one back to its day, and a touch stays readable if
   * its day is ever deleted.
   */
  tradeDate: string;
  instrumentId: string;

  /** The level price reached. */
  kind: LevelKind;
  price: number;
  /**
   * How wide the level is, in points, for judging whether price "came back".
   *
   * A level is a zone, not a tick. Price re-entering this band — the level price
   * plus or minus half the width on each side — is a return; only a price that
   * stays out of it is the break-and-run the set-ups are looking for.
   */
  zonePoints: number;
  /** Where the level came from — "overnight high", "prior day low", "4h supply". */
  label?: string;

  /** When price first reached the level. */
  touchedAt: string;
  /**
   * The session the touch fell in.
   *
   * This is the field the two set-ups differ by: an overnight level break and a
   * regular-session one are the same pattern at different times of day, and the
   * overnight read is the one the trader noticed first.
   */
  session: TradingSession;
  /** The instrument's price as close to the touch as the app could read it. */
  priceAtTouch?: number;

  /** The set-up this touch was taken under — one of the trader's two. */
  setupId?: string;
  setupName?: string;

  outcome: TouchOutcome;
  /** Best excursion away from the level after the touch, in points (favourable). */
  maxExcursionPoints?: number;
  /**
   * Deepest move back through the level after the touch, in points.
   *
   * Zero is the meaningful value: it is the record of price never returning, which
   * is exactly what the two set-ups are betting on.
   */
  maxReturnPoints?: number;
  /** When the outcome was last evaluated. */
  checkedAt?: string;
  /** The last price the evaluation saw, so a stale watch is visible as stale. */
  checkedPrice?: number;
  /** When price first came back through the level, for a `returned` touch. */
  returnedAt?: string;
  /**
   * How many times this touch has been evaluated against price so far.
   *
   * A `watching` touch with many checks and no return is a stronger read than one
   * that was only looked at once, and this is what lets the UI say which it is.
   */
  checks: number;

  /** The trade this touch became, when the trader actually took it. */
  tradeId?: string;
  notes?: string;
  images?: string[];
  createdAt: string;
  updatedAt: string;
}
