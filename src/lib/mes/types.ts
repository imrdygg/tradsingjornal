/**
 * The MES Indicator Level Tracker's own domain model.
 *
 * Kept in its own module rather than in `src/types.ts` because the app's shared type
 * file is the journal's vocabulary, and this is a self-contained feature: one record
 * per level per session, on one instrument, across six charts. The math that reads it
 * (`analytics.ts`) stays pure, so the numbers can be asserted without a browser.
 *
 * Instrument: $MES (Micro E-mini S&P 500 futures) only. Timeframes: 1m, 3m, 5m, 15m,
 * 30m, 1h.
 */

/** The only instrument this tracker records. */
export const MES_INSTRUMENT = 'MES';

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h';
export type LevelKind = 'support' | 'resistance';
export type BreakDirection = 'up' | 'down';
export type SetupTag =
  | 'rejection'
  | 'break-retest'
  | 'failed-breakout'
  | 'breakout-continuation'
  | 'liquidity-sweep'
  | 'balance-rotate'
  | 'trend-continuation'
  | 'other';

export type Grade = 'A' | 'B' | 'C' | 'D' | '—';
export type Confidence = 'low' | 'medium' | 'high';

/** What happened at a level, as the trader recorded it. */
export type LevelOutcome = 'untested' | 'held' | 'broke' | 'mixed';

/**
 * One level, on one session date, on one timeframe.
 *
 * A level can be tested several times intraday, so the tallies (`touches`/`holds`/`breaks`)
 * are stored separately from the level itself: one row, read once, and the tests counted on
 * it rather than duplicated into several rows.
 */
export interface LevelRecord {
  /** uuid */
  id: string;
  /** Session date, ISO 'YYYY-MM-DD' local to the trader (never `toISOString`). */
  date: string;
  timeframe: Timeframe;
  kind: LevelKind;
  /** MES points, e.g. 5823.25 */
  price: number;
  /** Times price tested the level. 0 = never reached. */
  touches: number;
  /** Of those tests, how many respected / rejected it. */
  holds: number;
  /** Of those tests, how many broke through it. */
  breaks: number;
  /** Optional pattern tag. */
  setup: SetupTag | '';
  /** 'HH:MM' 24h, '' when untested. */
  hitTime: string;
  /** 'HH:MM' 24h, '' when never broke. */
  breakTime: string;
  /** '' when no break or not noted. */
  breakDirection: BreakDirection | '';
  notes: string;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
}

/**
 * The backup file envelope.
 *
 * `version` and `app` are checked on restore so a foreign JSON file (or one from a
 * future schema) is refused with an explanation rather than half-imported.
 */
export interface JournalFile {
  version: 1;
  app: 'mes-level-tracker';
  /** ISO timestamp */
  exportedAt: string;
  records: LevelRecord[];
}

/** Everything an add needs, before the store stamps id and timestamps on it. */
export interface NewLevelInput {
  date: string;
  timeframe: Timeframe;
  kind: LevelKind;
  price: number;
  touches: number;
  holds: number;
  breaks: number;
  setup: SetupTag | '';
  hitTime: string;
  breakTime: string;
  breakDirection: BreakDirection | '';
  notes: string;
}

/** A partial edit. Identity and provenance are never the form's to change. */
export type LevelPatch = Partial<Omit<LevelRecord, 'id' | 'createdAt'>>;
