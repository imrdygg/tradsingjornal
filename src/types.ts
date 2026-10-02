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
   * `'ai-chart'` is the same, except the coach was handed a chart the trader uploaded and
   * the trades it matched, and named the pattern from that — badged separately so a setup a
   * chart search produced can be told from one the journal read produced. Absent means the
   * trader's own — a built-in they kept, or one they typed by hand. A draft is an ordinary
   * Setup everywhere else: the same edit, rename, disable and delete paths apply, and
   * nothing treats it as read-only.
   */
  origin?: 'ai' | 'ai-chart';
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
  /**
   * Which side of price the level is expected to act on.
   *
   * Optional, and absent means unclassified: the level is a price and nothing is claimed
   * about it. Where it is set, the level is tinted so a screen of them reads by colour —
   * resistance in red, support in green — without reading a single label.
   */
  side?: 'support' | 'resistance';
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

/**
 * The chart timeframe the print was read off, tightest first.
 *
 * The trader draws their lines on three charts and an extreme is only meaningful inside the
 * one it came from: a 30-minute high and a 1-minute high in the same hour are different
 * facts, and comparing across them would mix two resolutions into one rate. Grouping is what
 * makes the log comparable, so the timeframe travels with every print.
 */
export type ExtremeTimeframe = '1m' | '30m' | '1h';

/**
 * Which side of price the print is acting as.
 *
 * Not the same thing as `kind`. A high is a resistance level by default and a low is support,
 * but price reclaims and retests constantly: a low that gets broken and then holds from above
 * is a support that has turned resistance. The trader picks the side the level is acting as,
 * one at a time, and the stats read by it — which is the whole point of keeping it separate
 * from where the print happened.
 */
export type ExtremeLevelType = 'support' | 'resistance';

/** What price did to the level by the time the trader rated it. */
export type ExtremeOutcome = 'held' | 'taken-out' | 'chopped';

/**
 * When the reading was taken.
 *
 * `eod` is the end of the session, which is the one horizon that can be filled in after the
 * fact for every print. The two intraday ones are what the trader saw while it was live, and
 * having them separately is what lets the log say whether a level that held for an hour was
 * still holding at the close.
 */
export type ExtremeRatingHorizon = '30m' | '1h' | 'eod';

/** One reading of what a logged print did, at one horizon. */
export interface ExtremeRating {
  horizon: ExtremeRatingHorizon;
  outcome: ExtremeOutcome;
  /**
   * 1–5: how clean the level behaved, or absent when it was not graded.
   *
   * Kept apart from the outcome on purpose. "Taken out" and "a mess" are different
   * findings: a level can be taken out cleanly by a real break, and it can hold while
   * chopping through everyone's stops. Only the trader can tell those apart, so they are
   * recorded as two answers rather than averaged into one.
   */
  grade?: number;
  /** When the reading was taken, so a rating's own age is visible. */
  ratedAt: string;
}

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
  /**
   * The chart the print was read off.
   *
   * Optional because records saved before the log carried a timeframe are read as the
   * 1-minute print, which is what a session high or low is. See `DEFAULT_TIMEFRAME`.
   */
  timeframe?: ExtremeTimeframe;
  /**
   * The side the level was acting as when it was logged.
   *
   * Optional for the same reason: a record saved before this existed is read as the
   * default for its kind — a high as resistance, a low as support. See `defaultLevelType`.
   */
  levelType?: ExtremeLevelType;
  /**
   * What price did to the level, read at up to three horizons. One entry per horizon, so
   * re-rating an hour later replaces that reading rather than piling up a second one.
   */
  ratings?: ExtremeRating[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One trade the picture search matched to a chart the trader uploaded.
 *
 * The recorded fields are copied off the trade at the moment of the search rather than
 * resolved later, so a search stays a record of what the coach actually returned even if the
 * trade is edited or deleted afterwards. `tradeId` is kept only where the client could
 * resolve the match back to a real trade, which is what lets an old search still open it.
 */
export interface ChartSearchMatch {
  date: string;
  symbol: string;
  direction: string;
  setupName: string | null;
  /** How closely this trade resembled the uploaded chart, 0-100. */
  score: number;
  compared: 'written-record' | 'their-screenshot';
  /** The stored trade this match resolved to, when one was found. */
  tradeId?: string;
}

/**
 * One saved picture search: the chart that was uploaded and the trades it matched.
 *
 * Kept so the trader can look back over what they have searched for and which of their own
 * charts found real matches, rather than losing every search the moment the tab closes. It is
 * the trader's own material — their picture and their trades — so a reset clears it with the
 * journal and a sign-out removes it from the device.
 */
export interface ChartSearch {
  id: string;
  userId: string;
  /** When the search was run, so the history can be read in order. */
  createdAt: string;
  /** What the uploaded chart showed, in the coach's structural words. */
  patternRead: string;
  /**
   * A downscaled copy of the uploaded chart, so a past search can be recognised at a glance.
   *
   * Optional: a list of thumbnails is what makes this storage-heavy, so a search saved
   * without one is still a valid record with its scores intact.
   */
  thumbnail?: string;
  /** The trades the search matched, closest first. */
  matches: ChartSearchMatch[];
}

/** Whether a note the trader left about the app itself is still to do or handled. */
export type FeedbackStatus = 'open' | 'fixed';

/**
 * One note the trader left about something to fix or change in the app itself.
 *
 * Deliberately about the app, not about a trade: it is the trader writing down what is
 * broken, confusing or missing while they are looking at it, so it does not get lost
 * before it can be raised. The `context` records where they were when they wrote it, and
 * the status lets a note be marked handled rather than only deleted — a list that can only
 * forget is not a list of what is still to do.
 */
export interface FeedbackNote {
  id: string;
  userId: string;
  /** What needs fixing or changing, in the trader's own words. */
  text: string;
  /** The tab or screen they were on, so a note can be found again in context. */
  context?: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  /** When the note was marked fixed, so the list can be read in order. */
  resolvedAt?: string;
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
  /**
   * Screenshots and short clips attached to this review.
   *
   * The trader's own record of the session, in pictures and their own voice: screenshots
   * of what they saw, and a clip of them talking themselves through it. Images are data
   * URLs, clips are cloud URLs, the same shape a trade's media takes. It travels with the
   * carried-forward lesson, so tomorrow morning's "Yesterday's Lesson" box can show the
   * media behind the focus and not only the sentence.
   */
  media?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The trade plan the coach made entirely on its own.
 *
 * Different from the day's plan the trader writes: this one is the coach's own call, from
 * the live market read alone, and the trader does not set its levels. It is kept as a record
 * so it can be graded after the fact — the grade and the trader's written feedback are the
 * only things that tell the coach whether its plans are any good, and they travel back into
 * its next one.
 */
export type CoachPlanGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type CoachPlanConfidence = 'low' | 'medium' | 'high';

/**
 * What actually happened to a call the coach made.
 *
 * The coach plans against the live market and the journal records no price history for it, so
 * the only honest way to know whether a call was right is for the trader to mark it. That mark
 * is what turns a pile of graded opinions into a win rate and an R result.
 */
export type CoachPlanOutcome =
  /** Price reached the target first. */
  | 'target'
  /** Price reached the stop first. */
  | 'stopped'
  /** Price never came to the entry, so the call was never in play. */
  | 'no-fill'
  /** Still waiting: neither level has been reached. */
  | 'open';

export interface CoachPlan {
  id: string;
  userId: string;
  /** The coach's one-line summary of the call. */
  headline?: string;
  /** The moment the plan was made, so a graded plan keeps the market it was made against. */
  createdAt: string;
  /** The instrument the plan is for, by symbol. */
  symbol: string;
  /** The live price the call was made against, when the read worked. */
  marketPrice: number | null;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  confidence: CoachPlanConfidence;
  /** Why it would take the trade. */
  entryReason: string;
  /** Why it would get out, in its own words. */
  exitReason: string;
  /** What would prove the call wrong. */
  invalidation: string;
  /** The plan in its own words, plainly labelled as an opinion. */
  rationale: string;
  /** The trader's own grade of the plan, once they have judged it. */
  grade?: CoachPlanGrade;
  /** The trader's written feedback, fed back into the coach's later plans. */
  feedback?: string;
  gradedAt?: string;
  /** What the call did in the market, as the trader recorded it. */
  outcome?: CoachPlanOutcome;
  /** When the outcome was marked, so a settled call reads as settled. */
  outcomeAt?: string;
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
// Lessons — the trader's own documented findings
//
// The playbook holds two things the trader makes: the setups they trade, and the reference
// material behind them. A lesson is a third thing and deliberately different: something the
// trader noticed while watching the market and wrote down for themselves, with the media that
// shows it. It is their own note first — the coach may read it on request, but it is not a
// signal, a setup or a claim about the future.
// ---------------------------------------------------------------------------

/** What a saved lesson is mainly about, so a growing library can be filtered. */
export type LessonKind = 'pattern' | 'behavior' | 'mistake' | 'psychology' | 'other';

export interface Lesson {
  id: string;
  userId: string;
  /** The trader's own title: what they noticed. */
  title: string;
  /** What they wrote down about it, in their own words. */
  notes: string;
  kind: LessonKind;
  /** The setup this lesson was noticed on, when it relates to one the trader trades. */
  setupId?: string;
  /**
   * Attached media: images as data URLs, video clips as cloud URLs.
   *
   * Videos are the trader's own to review. The coach can read text and images but cannot
   * watch a clip, so only notes and images are ever sent to it and a saved video never
   * leaves the device except to the trader's own media bucket.
   */
  media?: string[];
  /** Free-form labels, stored the same way a trade's tags are. */
  tags?: string[];
  /** When the coach last read this lesson, so the card can show what is new since then. */
  lastReadAt?: string;
  createdAt: string;
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
 * The chart timeframe a marked level was read off.
 *
 * The trader's indicator draws support and resistance on several resolutions at once, and the
 * same price means something different on a 1-minute chart than on a 1-hour one. The timeframe
 * is the trader's own label for which line a price came from — the app never sees the chart —
 * and it is what lets the record compare, say, how often the 5-minute resistance is reached
 * against the 30-minute one.
 */
export type LevelTimeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h';

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
  /**
   * The timeframe carried over from the marked level this touch came from, when it did.
   *
   * Stored on the touch as well as the level so a touch stays self-describing: the record can
   * be grouped by timeframe without joining every touch back to the level it was struck from.
   */
  timeframe?: LevelTimeframe;
  /**
   * The marked level this touch was struck from, when it came from one.
   *
   * A touch can be logged straight, but the way the journal prefers is to write the levels
   * down first and tap the one price reached. This link is what lets the record say which of
   * the marked levels were ever tested and which were not — the untouched ones are a real
   * observation about the trader, not a gap.
   */
  levelId?: string;
  notes?: string;
  images?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One price the trader marked on the chart before anything happened at it.
 *
 * The touch log can only describe a level once price has reached it, which loses the thing
 * the trader actually knows at the open: the two, four or six lines their indicator is
 * showing, before any of them is tested. This is that record. Levels are written down for a
 * session, kept whether or not price ever comes near them, and a level that is reached turns
 * into a {@link LevelTouch} through {@link LevelTouch.levelId} — so the same tap that logs a
 * touch also says which of the marked lines it came from.
 *
 * Keeping the untouched ones matters: a level the indicator keeps offering that price never
 * tests is a fact about how the trader reads their own chart, and it only exists if the
 * levels are recorded before they are touched.
 */
export interface MarkedLevel {
  id: string;
  userId: string;
  /** The trading day the level was marked on. */
  tradingDayId: string;
  /** YYYY-MM-DD, denormalised so a level stays readable and countable without its day. */
  tradeDate: string;
  instrumentId: string;
  /** Which side of price the level sits on. */
  kind: LevelKind;
  price: number;
  /** The zone width to carry onto the touch, in points. */
  zonePoints: number;
  /** Where the level came from — "overnight high", "prior day low", "indicator R1". */
  label?: string;
  /** The session the trader was watching the levels for. Carried onto the touch. */
  session: TradingSession;
  /**
   * Which chart the level came off — 1m, 3m, 5m, 15m, 30m or 1h.
   *
   * Optional so a level logged before the trader tracked timeframes still reads: absent is
   * treated as "no timeframe recorded", never as a timeframe of its own.
   */
  timeframe?: LevelTimeframe;
  /**
   * Whether the trader typed this level by hand or pasted it from their indicator.
   *
   * Kept so the record can tell the two apart later; both are the trader's own level and
   * neither is treated as better than the other.
   */
  source?: 'indicator' | 'manual';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the trader expects an instrument to do with the day.
 *
 * Three states, deliberately: a lean up, a lean down, or no lean at all. `neutral` is a real
 * answer — "I have no read today" — and is not the same as an unset outlook, so the record
 * can tell a considered flat day from one nobody wrote down.
 */
export type MarketOutlookBias = 'bullish' | 'bearish' | 'neutral';

/**
 * One instrument's outlook for one trading day.
 *
 * Written at the level-marking step, beside the lines it goes with: the trader looks at MES's
 * timeframes and says which way they think it leans, then does the same for MCL, MNQ and VIX.
 * The instruments can disagree — MES bullish while MCL is bearish — which is exactly why the
 * outlook is per instrument and per day rather than one note for the whole session.
 *
 * It is the trader's own opinion, recorded before the session, so the record can later show
 * what they expected against what price did. Nothing here is a market read by the app, and the
 * coach is told so explicitly.
 */
export interface LevelOutlook {
  /** Stable per day and instrument, so re-choosing today's bias edits rather than adds. */
  id: string;
  userId: string;
  tradingDayId: string;
  /** YYYY-MM-DD, carried on the outlook itself so it reads without its day. */
  tradeDate: string;
  instrumentId: string;
  bias: MarketOutlookBias;
  /** Why they think so, in their own words. Optional. */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
