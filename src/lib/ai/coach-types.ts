import type { CoachEntryCall, MarketBias, QuestionAnswer } from '../../types';

/** Re-exported so the coach's public surface stays one import for its callers. */
export type { CoachEntryCall } from '../../types';

/**
 * Types shared between the browser and the coach serverless function.
 *
 * This module is deliberately types-only, so it contributes no runtime code to either
 * bundle. The function's runtime logic lives in `src/lib/ai/coach-prompt.ts`, imported by
 * the serverless function and by nothing else — which keeps the guardrails out of the
 * browser bundle entirely.
 */

export type CoachMode =
  | 'brief'
  | 'weekly'
  /** Which way the trader's numbers say they are heading: recent window against the one before. */
  | 'form'
  /**
   * The weekly setup read: which setups the last seven days of trades say are working, each
   * with its level-touch record behind it. Journal data only; the verdict is computed from
   * the trader's own figures before the model is asked.
   */
  | 'setups'
  /**
   * The break-and-run finder: which sessions, level kinds or named levels the trader's own
   * level-touch log says price did not come back to. Journal data only; no market opinion.
   */
  | 'edge'
  /**
   * The setup learner: reads the trader's own logged trades — including, when they were
   * attached, the chart screenshots taken at entry — and proposes the setups they actually
   * repeat. Journal data and those images only; no market opinion.
   */
  | 'learn'
  /**
   * The picture search: the trader hands over a chart and asks which of their OWN logged
   * trades resemble it. The uploaded chart is read into a price-free pattern — what it looks
   * like, never what it will do — and that pattern is matched against their own trade record
   * and, where they exist, the screenshots attached to those trades. It returns their trades,
   * not a market opinion.
   */
  | 'match'
  /**
   * The clock read: where the trader's own logged session extremes printed, and how often
   * the regular session kept an overnight extreme that printed in a given hour. Journal data
   * only — the log is what they recorded, not a live market read, and no hour is ever
   * forecast forward.
   */
  | 'extremes'
  /**
   * The clock call: the coach's own read of the levels the trader logged, on request. This
   * is one of the opinion modes — the trader has explicitly asked for a side, a level and a
   * confidence — so it may state a direction, but only from the numbers it was handed.
   */
  | 'extremecall'
  | 'trade'
  | 'prep'
  | 'postclose'
  /** Opinion on today's plan at lock time, with live sector context. */
  | 'planreview'
  /** Draft text for one plan field the trader is stuck on. */
  | 'planfield'
  /** A whole draft plan for the day, from the trader's style plus a live instrument read. */
  | 'planbuild'
  /** Whether and where to add to a position already on, from a live instrument read. */
  | 'scalein'
  /**
   * The coach's own direction and entry for a position the trader has just opened,
   * stored beside the trade so the two calls can be compared later.
   */
  | 'entrycall'
  /** A read of an instrument's recent daily bars: what the data shows and what it would do. */
  | 'chartread'
  /**
   * An answer to a question the trader typed about their OWN trading, e.g. "why do I keep
   * giving back the morning?" — journal data only, no market opinion.
   */
  | 'ask'
  /**
   * A read of the lessons the trader wrote for themselves — their own notes, tags and
   * attached still images — asked for on its own. Journal material only, never folded into
   * the other reads, and no market opinion: it summarizes what the trader already concluded.
   */
  | 'lessons'
  /**
   * The coach's own trade plan for one instrument, made from the live market read alone.
   *
   * The trader does not set its levels: the coach commits to a direction, an entry, a stop
   * and a target from the quote and the recent daily bars, and the trader grades it and
   * writes feedback afterwards. An opinion mode, so it may name levels — but only numbers it
   * was handed, and it is stored so the grade has something to land on.
   */
  | 'selfplan'
  /**
   * The entry edge: the trader names a symbol, a side and the price they are thinking of
   * entering at, and the coach reads that entry against TODAY'S OWN MARKED LINES — the chart,
   * the side, the price, and what the record says happened at each one — plus the live read.
   *
   * The record is the point: every line the coach talks about is one the trader marked, with
   * its own logged state, so the answer is "here is what your own lines did around a price like
   * this", never a signal. An opinion mode, so it may name levels and a side, but only numbers
   * it was handed.
   */
  | 'entryedge';

/** The plan fields the coach will draft text for, one at a time. */
export type PlanFieldName = 'waitingFor' | 'stayOutIf';

/** A position already on, described for the scale-in opinion. */
export interface CoachPositionFacts {
  symbol: string;
  direction: 'long' | 'short';
  contracts: number;
  entryPrice: number;
  initialStop: number;
  /** Where the market is now, as the trader recorded it. */
  currentPrice?: number;
  /** The add the trader is considering, when they have already typed one. */
  addContracts?: number;
  addPrice?: number;
  /** Loss limit for the day, so the advice can be judged against real risk. */
  plannedLossLimit?: number;
  /** What the open position is worth right now, when the journal can compute it. */
  openPoints?: number;
}

/**
 * The entry the trader is weighing up, described for the entry-edge read.
 *
 * Deliberately thin: a symbol, a side and a price. Everything else the read needs is already in
 * the digest — the trader's own marked lines and what each one did — so this exists to say which
 * entry the question is about, not to hand the model a market view.
 */
export interface EntryEdgeFacts {
  symbol: string;
  direction: 'long' | 'short';
  /** The price the trader is thinking of entering at. */
  entryPrice: number;
  /** Contracts they are considering, when they have said. Bounded on the server. */
  contracts?: number;
}

/** One line the entry-edge read is told to watch, tied to the trader's own marked level. */
export interface EntryEdgeNote {
  /** The line it is about, named as the trader marked it, e.g. "MES 15m resistance 7760". */
  level: string;
  /** What the trader's own record says has happened at that line, or that nothing has. */
  note: string;
  /** The logged state of the line: touched, never-touched, held, failed, watching or void. */
  status: string;
}

/**
 * The read of one prospective entry against the trader's own marked lines.
 *
 * Not a signal and shaped so it cannot become one: `stance` may say the record sits against the
 * entry, the lines must be ones the trader marked or prices the read was handed, and the counts
 * behind any rate are required. `notInJournal` exists so the answer says plainly what the record
 * cannot settle instead of filling the gap.
 */
export interface EntryEdgeResponse {
  headline: string;
  /** The entry read back against the live price, using only the numbers it was handed. */
  entryRead: string;
  /** What the trader's marked lines say about a price like this one, counts quoted. */
  levelRead: string;
  /** Whether the trader's own record sits with the entry, against it, or splits. */
  stance: 'with-the-record' | 'against-the-record' | 'mixed';
  confidence: 'low' | 'medium' | 'high';
  /** The lines to watch, each tied to a level the trader actually marked today. */
  watch: EntryEdgeNote[];
  /** What would make this entry a mistake, or a thin record, stated plainly. */
  risks: string[];
  /** What the record does not settle, so the gap is named rather than guessed at. */
  notInJournal: string;
  /** One concrete thing to log that would sharpen the next read of an entry like this. */
  nextStep: string;
  /** The read in plain words, labelled as an opinion that can be wrong. */
  rationale: string;
  /** Each line, price and journal fact it used, one per item, quoted so it can be checked. */
  basedOn: string[];
}

/** The entry the trader has just recorded, described for the coach's own call. */
export interface CoachEntryFacts {
  symbol: string;
  direction: 'long' | 'short';
  contracts: number;
  entryPrice: number;
  initialStop: number;
  setupName?: string;
  entryReason?: string;
  /** The price the trader planned to exit at, when they set one. */
  targetPrice?: number;
  session: string;
}

/**
 * Everything beyond the journal digest that a coach call may carry.
 *
 * Passed as one object rather than a growing argument list, and gated per mode on the
 * server so a stray position can never leak into a prompt whose mode does not expect it.
 */
export interface CoachExtras {
  instrument?: string;
  field?: PlanFieldName;
  position?: CoachPositionFacts;
  entry?: CoachEntryFacts;
  /** The entry the trader is weighing up, for the entry-edge read. */
  entryEdge?: EntryEdgeFacts;
  /**
   * The trader's own words for the `ask` mode.
   *
   * Bounded by the endpoint before it reaches a prompt, and framed there as a question
   * rather than as an instruction, because it is the one piece of coach input the trader
   * types freely.
   */
  question?: string;
  /**
   * The chart screenshots the `learn` mode is asked to look at.
   *
   * Only ever attached to that one mode. The endpoint re-parses and re-validates each data
   * URL, caps how many it will accept and drops anything malformed, because a request body
   * is untrusted input no matter which client sent it.
   */
  images?: CoachImageInput[];
}

/**
 * A chart image the coach is asked to look at.
 *
 * Held as a data URL because that is how the journal stores a compressed screenshot: the
 * image never leaves the browser as a binary blob, and no upload or public URL is needed to
 * let the coach see the trader's own entry.
 */
export interface CoachImageInput {
  /** One line naming the trade it belongs to, so a picture can be tied to a record. */
  label: string;
  /** A `data:image/...;base64,...` URL, bounded and re-validated on the server. */
  dataUrl: string;
}

/** Text drafted for one plan field. Never written to the plan without the trader's say. */
export interface PlanFieldResponse {
  field: PlanFieldName;
  /** One or two sentences, ready to paste into the field. */
  suggestion: string;
  /** Why the coach suggests it, tied to the trader's own numbers. */
  rationale: string;
  /** The specific journal facts it leaned on, so the trader can check it. */
  basedOn: string[];
}

/** One price level the draft plan wants marked. */
export interface PlannedLevel {
  price: number;
  label: string;
}

/**
 * The plan fields a coach draft can write into TODAY'S plan.
 *
 * Shared by the two modes that draft a day — `planbuild` on the Today tab and `chartread`
 * in the Markets tab — so one applier fills the plan for both and the two can never write
 * the fields differently. Every field is a value the plan form itself accepts; nothing
 * here can lock a plan or touch a trade.
 *
 * `contracts` is 0 when the coach did not size the day, which the applier reads as "leave
 * the planned size alone" rather than as a plan for no contracts.
 */
export interface CoachPlanFields {
  bias: MarketBias;
  contracts: number;
  waitingFor: string;
  stayOutIf: string;
  /** Setup names from the trader's own playbook that fit today. */
  setups: string[];
  levels: PlannedLevel[];
}

/** A whole draft plan for the day. */
export interface PlanBuildResponse extends CoachPlanFields {
  headline: string;
  /** Which side the coach would take today, or 'skip' when it would stand aside. */
  direction: 'long' | 'short' | 'skip';
  /** The level it would enter at, quoting the live read. Null when it would skip. */
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Plainly labelled as an opinion, with the risk of being wrong stated. */
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  /** The live numbers the draft was built from, quoted back for checking. */
  basedOn: string[];
}

/** An opinion on adding to a position that is already on. */
export interface ScaleInResponse {
  stance: 'add' | 'hold' | 'do-not-add';
  /** Where it would add, when it would. Null on 'hold' / 'do-not-add'. */
  addPrice: number | null;
  /** Contracts to add, when it would. */
  addContracts: number | null;
  /** Where the stop belongs after the add, so the added risk is bounded. */
  stopAfterAdd: number | null;
  /** The blended entry after that add, from the numbers it was given. */
  breakevenPrice: number | null;
  rationale: string;
  /** What would make this add a mistake. */
  risks: string[];
}

/** The coach's own call on an entry the trader has just recorded. */
export interface EntryCallResponse {
  direction: 'long' | 'short' | 'flat';
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Short: why it read the moment the way it did. */
  rationale: string;
}

/**
 * A read of an instrument's recent daily bars, shown under the chart.
 *
 * It doubles as a draft of today's plan for the instrument being charted: besides the
 * read, it carries the `CoachPlanFields` a day plan needs, so the trader can turn the
 * read straight into the day's plan for that one symbol. The chart read is asked for one
 * instrument at a time, and the plan it drafts is always for that instrument — never for
 * every symbol the journal knows.
 */
export interface ChartReadResponse extends CoachPlanFields {
  headline: string;
  /** What the daily bars actually show: direction, ranges, streaks — quoting the numbers given. */
  patternRead: string;
  /** The trade it would consider from this chart, or 'skip' when it would stand aside. */
  direction: 'long' | 'short' | 'skip';
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** How that hypothetical trade squares with the trader's own process record. */
  fitsTheirTrading: string;
  /** What would make acting on this read a mistake. */
  risks: string[];
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  /** The exact bars and journal facts the read leaned on, quoted for checking. */
  basedOn: string[];
}

export interface BriefResponse {
  headline: string;
  yesterday: string;
  wins: string[];
  fixes: string[];
  todayFocus: string;
  motivation: string;
}

export interface WeeklyPattern {
  observation: string;
  evidence: string;
}

export interface WeeklyResponse {
  headline: string;
  patterns: WeeklyPattern[];
  disciplineRead: string;
  riskRead: string;
  biggestLeak: string;
  oneChange: string;
  motivation: string;
}

/**
 * An answer to a question the trader typed about their own trading.
 *
 * The question is free text, so the answer is prose — but held to the same standard as
 * every other mode: it may only claim what the journal records, it has to name the figures
 * it is standing on, and it has to say plainly what the question needed and the journal
 * does not hold.
 */
export interface AskResponse {
  headline: string;
  /** The answer itself: 3-6 sentences, quoting the trader's own figures. */
  answer: string;
  /** The journal facts and numbers the answer rests on, one per item, so it can be checked. */
  evidence: string[];
  /**
   * What the question needed that the journal does not record, in the trader's language.
   * Empty string when the journal covered the question.
   */
  notInJournal: string;
  /** One concrete, checkable thing to do differently, or empty when the question did not call for one. */
  nextStep: string;
}

/** One condition from the level-touch record, as the edge read reports it. */
export interface EdgeCondition {
  /** The session, level kind or named level the bucket covers. */
  condition: string;
  /** The hold rate and the counts it was drawn from, as text so the counts always travel with it. */
  holdRate: string;
  /** The held / came-back / watching numbers behind the rate. */
  evidence: string;
}

/**
 * The break-and-run edge read: what the trader's own touch log says about which conditions
 * see price not come back, and what is still too thin to say.
 *
 * Every field is about the recorded sample, never a prediction: a hold is a fact about
 * price, not about profit, and the fields are shaped so the counts cannot be dropped.
 */
export interface EdgeResponse {
  headline: string;
  /** The strongest readable condition, or a plain statement that nothing is readable yet. */
  bestCondition: string;
  /** Only conditions that carry a readable hold rate. */
  conditions: EdgeCondition[];
  /** Conditions that are logged but too thin to read, counts only. */
  notYetReadable: string[];
  /** What the record shows about their setups, stated as what has happened. */
  whatItMeans: string;
  /** One concrete thing to log or watch that would sharpen the record. */
  nextStep: string;
  motivation: string;
}

/** One hour from the session-extreme log, as the clock read reports it. */
export interface ExtremeCondition {
  /** The hour the bucket covers, e.g. "MES overnight high at 3am". */
  condition: string;
  /** The held rate and the counts it was drawn from, as text so the counts always travel with it. */
  heldRate: string;
  /** The held / taken-out / not-judged numbers behind the rate. */
  evidence: string;
}

/**
 * The clock read: what the trader's own session-extreme log says about the hours their
 * overnight extremes print in, and what is still too thin to say.
 *
 * Every field is about the recorded sessions, never a forecast. The log says where price
 * already printed and whether the regular session reached past it; it says nothing about
 * what any hour will do next, and the fields are shaped so the counts cannot be dropped.
 */
export interface ExtremeResponse {
  headline: string;
  /** The strongest readable hour, or a plain statement that nothing is readable yet. */
  bestPattern: string;
  /** Only hours that carry a readable held rate. */
  patterns: ExtremeCondition[];
  /** Hours that are logged but too thin to read, counts only. */
  notYetReadable: string[];
  /** Read of today's sparse manually entered points, never a price forecast. */
  currentSessionRead: string;
  /**
   * What the trader's own ratings say about the levels they marked: the held rate and counts
   * behind each condition, with the grades reported apart from the outcomes. Empty when
   * nothing has been rated.
   */
  levelsRead: string;
  /** Conditions that are rated but still below the readable floor, counts only. */
  notYetRated: string[];
  /** What the log shows has happened, stated as what has happened. */
  whatItMeans: string;
  /** One concrete thing to log that would sharpen the record. */
  nextStep: string;
  motivation: string;
}

/**
 * The coach's own call on the trader's logged levels: which side it would be on, the level
 * that call is about, and what would prove it wrong.
 *
 * An opinion, never a forecast, and the fields are shaped to keep it one: the level must be a
 * number the trader recorded or a live read, the counts behind it are required, and the
 * trigger and invalidation are required so a call can never arrive without the two things
 * that make it checkable. Standing aside is a complete answer.
 */
export interface ExtremeCallResponse {
  headline: string;
  /** The side the coach would be on right now, or that it would stand aside. */
  stance: 'long' | 'short' | 'stand-aside';
  /** The trader's own level the call is about, or null when it stands aside. */
  level: number | null;
  /** The side that level is being treated as. */
  levelType: 'support' | 'resistance' | null;
  /** What has to happen before the call is live, in plain words. */
  trigger: string;
  /**
   * What would prove the call wrong. For a stand-aside it is what would bring the coach in,
   * which is the same question read the other way.
   */
  invalidation: string;
  /** The counts from the trader's own log the call rests on. */
  basedOn: string[];
  confidence: 'low' | 'medium' | 'high';
  /** Said plainly: this is its opinion, and what it does not know. */
  rationale: string;
}

/**
 * The weekly setup read: which of the trader's setups the last seven days say is working.
 *
 * The verdict itself is not in here — it is computed from the recorded trades in the digest
 * before the model is asked anything, so the two can never disagree. These fields are the
 * explanation: what is working, what is not, whether the levels held behind it, and the one
 * thing to change next week.
 */
export interface SetupsResponse {
  headline: string;
  /** The week read back, quoting each judged setup's trades, net P&L and R. */
  weekRead: string;
  /** What is working, each tied to a setup and a figure. Empty when none was judged working. */
  working: string[];
  /** What is not working, same terms. Empty when none was judged not working. */
  notWorking: string[];
  /** Whether the levels behind those setups held, with the decided counts quoted first. */
  levelsRead: string;
  /** The setup to take more of, or an empty string when the week judged none. */
  leanOn: string;
  /** The setup to stop taking for now, or an empty string when the week judged none. */
  shelve: string;
  /** One concrete thing to do differently next week. */
  nextWeek: string;
  motivation: string;
}

/** One setup the coach proposes, learned from the trader's own trades. */
export interface LearnedSetup {
  /** A short name in the trader's own terms, not a textbook pattern name. */
  name: string;
  /** 1-2 sentences on what they actually do, tied to the trades it was drawn from. */
  description: string;
  /** The entry conditions, one per item, as concrete as the record allows. */
  entryRules: string[];
  /** The trades and figures behind it, so the trader can check the claim. */
  evidence: string;
  /** How much the record actually supports it, stated rather than implied. */
  confidence: 'low' | 'medium' | 'high';
}

/**
 * One of the trader's own logged trades that resembles the chart they uploaded.
 *
 * The recorded fields are quoted straight from the journal so the client can resolve the
 * match back to the real trade and open it. The resemblance is a likeness in setup, not a
 * claim that the trade will work, and `compared` says what the likeness rests on so a
 * written-record match is never passed off as a picture comparison.
 */
export interface MatchItem {
  /** The trade's date, exactly as the digest records it. */
  date: string;
  symbol: string;
  direction: string;
  /** The setup that trade was logged under, or null when it was left blank. */
  setupName: string | null;
  /** Why this trade resembles the uploaded chart, in the trader's own terms. */
  why: string;
  /**
   * What the resemblance rests on: the trade's written record, or a screenshot of it that
   * was actually sent alongside the uploaded chart.
   */
  compared: 'written-record' | 'their-screenshot';
  /**
   * How closely this trade resembles the uploaded chart, 0-100.
   *
   * A resemblance measure, never a probability: 100 means the record of this trade looks as
   * much like the chart as a trade can, and it says nothing about whether acting on the
   * pattern would work. The scale is the model's own, applied consistently across the matches
   * of one search so they can be ranked against each other — which is all it is for.
   */
  score: number;
}

/**
 * The picture search: the uploaded chart read back, and the trader's own trades that
 * resemble it.
 *
 * The uploaded chart is described structurally and never numerically — the model has no
 * market data and no price scale it may read off a picture. An empty `matches` array is a
 * real answer: it is what a chart resembling nothing in the record deserves.
 */
export interface MatchResponse {
  headline: string;
  /** What the uploaded chart shows in plain structure — never a price, level or forecast. */
  patternRead: string;
  /** The trader's own trades that resemble it, closest first. Empty when none does. */
  matches: MatchItem[];
  /** What the record does not hold that would have sharpened the search. */
  notInJournal: string;
  /** One concrete thing to log that would make the next picture search better. */
  nextStep: string;
  motivation: string;
}

/** One lesson a theme was drawn from, named as the trader wrote it. */
export interface LessonThemeLesson {
  /** The lesson's own title. */
  title: string;
  /** The day the trader wrote it, YYYY-MM-DD. */
  date: string;
}

/** One theme the coach found across the trader's own lessons. */
export interface LessonTheme {
  theme: string;
  /** Which lessons it was drawn from, by their own titles, with the counts behind it. */
  evidence: string;
  /**
   * The specific lessons behind the theme, oldest first, each with the day it was written.
   *
   * Naming them is what makes a theme checkable: the trader can open the exact notes the
   * coach is summarising and see the day each was recorded. Empty only when the model gave
   * no titles, which the read's own rules tell it not to do.
   */
  lessons: LessonThemeLesson[];
}

/**
 * The read of the trader's own written lessons.
 *
 * A summary of their OWN material, in their own terms — the themes their notes keep
 * returning to, where two notes disagree, and what the library does not yet cover. It never
 * predicts anything and never turns a note into advice about the market: the lessons are the
 * trader's findings, and the coach's job is to read them back and point at the gaps.
 */
export interface LessonsResponse {
  headline: string;
  /** The themes that hold across several lessons. Empty when the library is too thin. */
  themes: LessonTheme[];
  /** What the notes keep coming back to, in the trader's own terms. */
  reinforces: string;
  /** Where two lessons pull in different directions, naming both. Empty when none. */
  contradictions: string[];
  /** What the library does not cover yet that would sharpen it, counts only. */
  gaps: string[];
  /** How the trader could use their own notes, without predicting anything. */
  howToApply: string;
  /** One concrete thing to write down or tag next. */
  nextStep: string;
  motivation: string;
}

/**
 * The setups the coach read out of the trader's own trade history.
 *
 * Drafts, never pronouncements: they are written into the trader's playbook for them to
 * edit, rename or delete, so the fields say what was observed and how strongly, and nothing
 * here predicts that a setup will keep working. An empty `setups` list is a real answer — it
 * is what a record too thin to show a repeated pattern deserves.
 */
export interface LearnResponse {
  headline: string;
  /** The proposed setups, best-supported first. Empty when the record is too thin. */
  setups: LearnedSetup[];
  /** What it grouped the trades on and what that showed, so the read can be checked. */
  method: string;
  /** What the journal does not hold that would have sharpened the read. */
  notInJournal: string;
  /** One concrete thing to log that would make the next read better. */
  nextStep: string;
  motivation: string;
}

/**
 * Where the trader is heading right now, from the two windows in the digest's recent form.
 *
 * Deliberately narrower than the weekly review: this is not another summary of the record,
 * it is a read of the *trend*, so every field is about the difference between the two
 * windows rather than about the trader in general.
 */
export interface FormResponse {
  headline: string;
  /** 2-3 sentences comparing the two windows, quoting the figures from both. */
  trendRead: string;
  /** What is better in the recent window. Empty array when nothing is. */
  improved: string[];
  /** What is worse in the recent window. Empty array when nothing is. */
  declined: string[];
  /** What has held steady across both windows. */
  holding: string[];
  /** One concrete, checkable next step, matched to the direction they are heading. */
  nextStep: string;
  motivation: string;
}

export interface TradeCritiqueResponse {
  verdict: string;
  didWell: string[];
  costYou: string[];
  rulesBroken: string[];
  nextTime: string;
  grade: string;
}

/** Opinion on the day plan at lock time, with live sector context. */
export interface PlanReviewResponse {
  headline: string;
  marketRead: string;
  /** Sector or index the plan's bias most stands against, from the live data. */
  alignment: string;
  /** How the plan's size and loss limit read against the trader's own recent results. */
  riskCheck: string;
  /** Concrete, checkable weaknesses in today's plan. */
  planGaps: string[];
  /** What the data suggests watching, phrased as process, not predictions. */
  watchFor: string[];
  /** Plain verdict on whether the plan is ready, from 'ready' to 'shaky'. */
  verdict: 'ready' | 'workable' | 'shaky';
  /** One concrete fix, when the verdict is not 'ready'. */
  oneFix: string;
}

/** Morning preparation, generated before the session closes. */
export interface PrepResponse {
  headline: string;
  yesterdayLesson: string;
  howToApproach: string;
  watchOutFor: string[];
  planGaps: string[];
  motivation: string;
}

/** Post-close review of the session that just finished. */
export interface PostCloseResponse {
  headline: string;
  whatHappened: string;
  wentWell: string[];
  wentWrong: string[];
  rulesBroken: string[];
  tomorrowAction: string;
  motivation: string;
}

/**
 * The coach's own plan for one instrument.
 *
 * Every level is a number drawn from the live read it was handed. `direction` is always long
 * or short rather than skip: the plan exists to be graded, and a standing-aside answer cannot
 * be. When the read fails, the endpoint refuses the request instead of letting the model
 * invent prices.
 */
export interface SelfPlanResponse {
  headline: string;
  /** The instrument the plan is for, echoed back as it was handed in. */
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  confidence: 'low' | 'medium' | 'high';
  /** Why the coach would take this trade, in its own words. */
  entryReason: string;
  /** Why it would get out, whether by target or because the call is wrong. */
  exitReason: string;
  /** What would prove this plan wrong. */
  invalidation: string;
  /** The plan in plain words, labelled as an opinion. */
  rationale: string;
}

export type CoachResponse =
  | BriefResponse
  | WeeklyResponse
  | FormResponse
  | EdgeResponse
  | ExtremeResponse
  | ExtremeCallResponse
  | SetupsResponse
  | LearnResponse
  | MatchResponse
  | AskResponse
  | TradeCritiqueResponse
  | PrepResponse
  | PostCloseResponse
  | PlanReviewResponse
  | PlanFieldResponse
  | PlanBuildResponse
  | ScaleInResponse
  | EntryCallResponse
  | ChartReadResponse
  | LessonsResponse
  | SelfPlanResponse
  | EntryEdgeResponse;

export function isCoachEntryCall(value: unknown): value is CoachEntryCall {
  if (!value || typeof value !== 'object') return false;
  const call = value as Partial<CoachEntryCall>;
  return (
    (call.direction === 'long' || call.direction === 'short' || call.direction === 'flat') &&
    typeof call.rationale === 'string'
  );
}

/** Shape of a single trade, as sent for a critique. */
export interface CoachTradeFacts {
  symbol: string;
  direction: string;
  contracts: number;
  entryPrice: number;
  initialStop: number;
  exitPrice?: number;
  entryTime: string;
  exitTime?: string;
  session: string;
  setupName?: string;
  source: string;
  status: string;
  entryReason?: string;
  /** The exit price the trader planned around, when they set one. */
  targetPrice?: number;
  /** Why the trader actually exited, in their own words, on a closed trade. */
  exitReason?: string;
  /** The trader's own note on the entry. */
  notes?: string;
  /** The trader's own note on the exit, on a closed trade. */
  exitNote?: string;
  tags?: string[];
  initialRisk: number;
  grossPnL: number;
  netPnL?: number;
  pointsPnL: number;
  rMultiple: number;
  management?: {
    breakevenPrice?: number;
    profitSecured?: number;
    trailingMethod?: string;
    notes?: string;
  };
  executionReview?: Record<string, QuestionAnswer>;
  /** Other legs of the same position, when this trade is part of a scale-in. */
  positionLegs?: number;
  positionAvgEntry?: number;
  positionTotalContracts?: number;
  /** The plan that was in force when this trade was taken. */
  dayPlan?: {
    plannedLossLimit: number;
    contractsPlanned: number;
    allowedSessions: string[];
    watchedSetups: string[];
    primaryInstrument: string;
    marketBias: string;
    waitingFor?: string;
    stayOutIf?: string;
  };
}
