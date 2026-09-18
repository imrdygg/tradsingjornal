import { QuestionAnswer } from '../../types';

/**
 * Types shared between the browser and the coach serverless function.
 *
 * This module is deliberately types-only, so it contributes no runtime code to either
 * bundle. The function's runtime logic lives in `src/lib/ai/coach-prompt.ts`, imported by
 * the serverless function and by nothing else — which keeps the guardrails out of the
 * browser bundle entirely.
 */

export type CoachMode = 'brief' | 'weekly' | 'trade' | 'prep' | 'postclose';

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
  | PostCloseResponse;

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
