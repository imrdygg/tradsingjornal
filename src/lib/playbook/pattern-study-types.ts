/**
 * The Chart Pattern playbook study record: the trader's own material.
 *
 * Kept out of `src/types.ts` so the standalone playbook product can carry these four
 * types without importing the journal's whole data model. `src/types.ts` re-exports
 * them, so every existing `import { PatternStudy } from '../../types'` keeps working.
 */
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
  /** When this study's example images were moved to the media bucket. See `Trade.movedAt`. */
  movedAt?: string;
  updatedAt: string;
}
