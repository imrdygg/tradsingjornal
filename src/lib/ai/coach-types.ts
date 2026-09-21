import type { CoachEntryCall, QuestionAnswer } from '../../types';

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
  | 'entrycall';

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

/** The entry the trader has just recorded, described for the coach's own call. */
export interface CoachEntryFacts {
  symbol: string;
  direction: 'long' | 'short';
  contracts: number;
  entryPrice: number;
  initialStop: number;
  setupName?: string;
  entryReason?: string;
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

/** A whole draft plan for the day. */
export interface PlanBuildResponse {
  headline: string;
  bias: 'bullish' | 'bearish' | 'neutral' | 'unsure';
  /** Which side the coach would take today, or 'skip' when it would stand aside. */
  direction: 'long' | 'short' | 'skip';
  /** The level it would enter at, quoting the live read. Null when it would skip. */
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Contracts the risk limit and the trader's own sizing history support. */
  contracts: number;
  waitingFor: string;
  stayOutIf: string;
  /** Setup names from the trader's own playbook that fit today. */
  setups: string[];
  levels: PlannedLevel[];
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

export type CoachResponse =
  | BriefResponse
  | WeeklyResponse
  | TradeCritiqueResponse
  | PrepResponse
  | PostCloseResponse
  | PlanReviewResponse
  | PlanFieldResponse
  | PlanBuildResponse
  | ScaleInResponse
  | EntryCallResponse;

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
  notes?: string;
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
