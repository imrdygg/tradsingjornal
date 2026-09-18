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
  createdAt: string;
  updatedAt: string;
}
