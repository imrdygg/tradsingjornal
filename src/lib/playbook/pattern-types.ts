/**
 * The shape of a Chart Pattern Playbook entry, plus the shared vocabulary the
 * playbook UI needs.
 *
 * Kept separate from the content itself (`patterns.ts`) so the UI, the animation
 * layer and the tests all agree on one definition without importing 20 patterns'
 * worth of prose to get it.
 *
 * Source rule: pattern names come from the trader's chart-pattern cheat sheet and are
 * reproduced exactly, including the ones that are internally inconsistent with the
 * drawing next to them. `sourceName` is never "fixed"; a clearer industry name belongs
 * in `displayName` or `aliases`, and a discrepancy is explained in `sourceNote`.
 */

import type { PatternGrade, PatternStatus } from '../../types';

// The persisted unions live in types.ts with the rest of the data model; re-exported here
// so the playbook UI has one import for its vocabulary.
export type { PatternGrade, PatternStatus } from '../../types';

export type PatternBias = 'bullish' | 'bearish' | 'neutral';
export type PatternCategory = 'reversal' | 'continuation';

/**
 * The teaching beats of an illustration, in order. Every timed reveal is anchored to
 * one of these, so a pattern's geometry and its animation storyboard cannot drift apart.
 */
export type PatternPhase =
  | 'priorTrend'
  | 'formation'
  | 'trigger'
  | 'breakout'
  | 'retest'
  | 'target';


export interface PatternStoryboard {
  priorTrend: string;
  formation: string;
  trigger: string;
  breakout: string;
  retest?: string;
  target?: string;
}

export interface PatternSetup {
  /** Stable internal id. Required because the source repeats some labels twice. */
  id: string;
  /** Exactly as printed on the source sheet. Never rewritten. */
  sourceName: string;
  /** What the card and detail header show. Equal to `sourceName` unless disambiguated. */
  displayName: string;
  category: PatternCategory;
  bias: PatternBias;
  /** 1-based position on the source sheet, which is also the intended reading order. */
  sourcePosition: number;
  /** One sentence: what it is. */
  summary: string;
  /** What buyers and sellers are each doing while this forms. */
  marketStory: string[];
  /** The geometry that must actually be on the chart. */
  requiredStructure: string[];
  formationSequence: string[];
  confirmation: string[];
  invalidation: string[];
  targetConcepts: string[];
  commonMistakes: string[];
  /** Extra, pattern-specific checklist lines. Shown after the universal checklist. */
  checklist: string[];
  animation: PatternStoryboard;
  aliases?: string[];
  /** Explains a mismatch between a source label and the drawing beside it. */
  sourceNote?: string;
}

export const CATEGORY_LABELS: Record<PatternCategory, string> = {
  reversal: 'Reversal',
  continuation: 'Continuation',
};

export const BIAS_LABELS: Record<PatternBias, string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Two-direction',
};

/**
 * The checklist every pattern shares.
 *
 * These are the questions that decide whether the trader is reading a chart or talking
 * themselves into one, so they are worded as checks, not as encouragement.
 */
export const UNIVERSAL_CHECKLIST: Array<{ key: string; label: string }> = [
  { key: 'context', label: 'The prior trend/context this pattern needs actually exists.' },
  { key: 'geometry', label: 'The pattern geometry is really present, not approximated.' },
  { key: 'boundaries', label: 'At least two meaningful reactions define each required boundary.' },
  { key: 'not-forced', label: 'This is not being forced onto random noise.' },
  { key: 'at-decision', label: 'Price has reached the decision/breakout area.' },
  { key: 'closed-beyond', label: 'The break closed beyond the structure — a wick is not a close.' },
  { key: 'invalidation-known', label: 'I know what would invalidate this setup.' },
  { key: 'nearest-level', label: 'I know the nearest major support/resistance level.' },
  { key: 'measured-not-guaranteed', label: 'I am not treating the measured move as guaranteed.' },
  { key: 'example-saved', label: 'I saved a screenshot/example for review.' },
];

/**
 * The status picker.
 *
 * `help` is what stops the picker becoming a set of nine synonyms: each one names a
 * specific piece of evidence, and only two of them involve price having closed beyond
 * the structure.
 */
export const STATUS_OPTIONS: Array<{ value: PatternStatus; label: string; help: string }> = [
  { value: 'watching', label: 'Watching', help: 'On the list, nothing formed yet.' },
  { value: 'forming', label: 'Forming', help: 'Price is building the shape; no boundary yet.' },
  { value: 'near-breakout', label: 'Near breakout', help: 'Structure is complete and price is at the edge.' },
  { value: 'breakout-attempted', label: 'Breakout attempted', help: 'Price moved beyond the boundary but has not closed there.' },
  { value: 'confirmed', label: 'Confirmed', help: 'A candle CLOSED beyond the structure.' },
  { value: 'retest', label: 'Retest', help: 'Price came back to the broken boundary and held it.' },
  { value: 'failed-breakout', label: 'Failed breakout', help: 'Price closed back inside the pattern after breaking out.' },
  { value: 'invalidated', label: 'Invalidated', help: 'The setup is proven wrong by its own invalidation rule.' },
  { value: 'completed', label: 'Completed', help: 'The move played out; review it and log the lesson.' },
];

export const STATUS_LABELS: Record<PatternStatus, string> = STATUS_OPTIONS.reduce(
  (acc, option) => ({ ...acc, [option.value]: option.label }),
  {} as Record<PatternStatus, string>
);

export const GRADES: PatternGrade[] = ['A', 'B', 'C', 'D', 'F'];

/**
 * Shown on the section header and every detail view.
 *
 * The acceptance criteria require the playbook to say this plainly, and it is the one
 * claim that must never be softened: a pattern is a description of what price has done,
 * not a promise about what it will do.
 */
export const EDUCATIONAL_DISCLAIMER =
  'Chart patterns are probabilistic descriptions of price behaviour, not guarantees and not signals. ' +
  'Nothing in this playbook tells you to buy or sell: it is study material for your own decision-making, ' +
  'and a measured move is a reference, never a destination.';

/** Stable key for a checklist row, used as the key in stored study state. */
export function checklistKey(source: 'universal' | 'pattern', index: number): string {
  return `${source}:${index}`;
}
