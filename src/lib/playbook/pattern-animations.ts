import { PatternPhase } from './pattern-types';

/**
 * Geometry for the 20 PatternAnimation illustrations.
 *
 * Why data and not 20 components: the drawing rules are the same for every pattern (a
 * price path drawn in sequence, blue structure lines revealed as the pattern forms, a
 * breakout arrow, an optional retest and measured move), and only the coordinates differ.
 * One engine plus 20 coordinate sets is what keeps the illustrations consistent and makes
 * a geometry fix a one-line change.
 *
 * Coordinate space: x runs 0 (oldest) to 100 (newest), y runs 0 (bottom of the chart) to
 * 100 (top). Higher y is a higher price, so these numbers read like the chart they draw.
 * The renderer flips y for SVG.
 *
 * Honesty note on `target` arrows: a measured move that would leave the illustration is
 * drawn truncated to the canvas rather than scaled down to fit. Every target is a
 * reference for scale, never a destination, and the caption says so.
 */

export interface PatternPoint {
  x: number;
  y: number;
}

/** Blue structure: support/resistance/neckline are horizontal-ish, trend lines slope. */
export interface StructureLine {
  kind: 'level' | 'trendline';
  from: PatternPoint;
  to: PatternPoint;
  /** Revealed at the start of this phase of the storyboard. */
  phase: PatternPhase;
  label?: string;
}

/** Amber dashed line: the price that proves this pattern wrong. */
export interface InvalidationLine {
  kind: 'invalidation';
  from: PatternPoint;
  to: PatternPoint;
  phase: PatternPhase;
  label?: string;
}

/** Dotted measured move, drawn from the break. */
export interface TargetArrow {
  kind: 'target';
  from: PatternPoint;
  to: PatternPoint;
  phase: PatternPhase;
  label?: string;
}

export interface BreakoutMarker {
  kind: 'breakout';
  at: PatternPoint;
  direction: 'up' | 'down';
  phase: PatternPhase;
  label?: string;
}

export interface RetestMarker {
  kind: 'retest';
  at: PatternPoint;
  phase: PatternPhase;
  label?: string;
}

/** Translucent fill marking where the formation lives. */
export interface FormationZone {
  kind: 'zone';
  points: PatternPoint[];
  phase: PatternPhase;
}

export interface TeachingLabel {
  kind: 'label';
  at: PatternPoint;
  text: string;
  phase: PatternPhase;
}

/**
 * A dashed arrow that is deliberately faded: the source illustration for the two-direction
 * triangle shows both possible exits, and this is how the playbook reproduces that without
 * pretending the pattern picked a side.
 */
export interface GhostArrow {
  kind: 'ghost';
  at: PatternPoint;
  direction: 'up' | 'down';
  phase: PatternPhase;
  label?: string;
}

export type PatternFeature =
  | StructureLine
  | InvalidationLine
  | TargetArrow
  | BreakoutMarker
  | RetestMarker
  | FormationZone
  | TeachingLabel
  | GhostArrow;

export interface PatternAnimationSpec {
  /** The price path, drawn left to right as the animation progresses. */
  path: PatternPoint[];
  features: PatternFeature[];
}

export const PATTERN_ANIMATIONS: Record<string, PatternAnimationSpec> = {
  // ---------------------------------------------------------------- reversal row
  'reversal-bearish-double-top': {
    path: [
      { x: 4, y: 18 },
      { x: 10, y: 38 },
      { x: 16, y: 30 },
      { x: 22, y: 50 },
      { x: 28, y: 76 },
      { x: 34, y: 62 },
      { x: 40, y: 52 },
      { x: 46, y: 74 },
      { x: 52, y: 58 },
      { x: 58, y: 52 },
      { x: 64, y: 40 },
      { x: 68, y: 49 },
      { x: 76, y: 28 },
      { x: 86, y: 18 },
      { x: 94, y: 12 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 24, y: 76 }, { x: 48, y: 76 }, { x: 48, y: 52 }, { x: 24, y: 52 }], phase: 'formation' },
      { kind: 'level', from: { x: 40, y: 52 }, to: { x: 80, y: 52 }, phase: 'formation', label: 'Neckline' },
      { kind: 'label', at: { x: 28, y: 82 }, text: 'First top', phase: 'formation' },
      { kind: 'label', at: { x: 46, y: 80 }, text: 'Second top', phase: 'formation' },
      { kind: 'invalidation', from: { x: 24, y: 79 }, to: { x: 52, y: 79 }, phase: 'trigger', label: 'Invalid above the tops' },
      { kind: 'breakout', at: { x: 58, y: 52 }, direction: 'down', phase: 'breakout', label: 'Close below the neckline' },
      { kind: 'retest', at: { x: 68, y: 49 }, phase: 'retest', label: 'Retest from below' },
      { kind: 'target', from: { x: 58, y: 52 }, to: { x: 80, y: 26 }, phase: 'target', label: 'Measured move' },
    ],
  },

  'reversal-bearish-head-shoulders': {
    path: [
      { x: 4, y: 32 },
      { x: 10, y: 46 },
      { x: 16, y: 64 },
      { x: 22, y: 52 },
      { x: 28, y: 50 },
      { x: 34, y: 56 },
      { x: 40, y: 78 },
      { x: 46, y: 60 },
      { x: 52, y: 50 },
      { x: 58, y: 58 },
      { x: 64, y: 66 },
      { x: 70, y: 56 },
      { x: 76, y: 44 },
      { x: 84, y: 30 },
      { x: 92, y: 20 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 14, y: 78 }, { x: 68, y: 78 }, { x: 68, y: 50 }, { x: 14, y: 50 }], phase: 'formation' },
      { kind: 'level', from: { x: 26, y: 50 }, to: { x: 84, y: 50 }, phase: 'formation', label: 'Neckline' },
      { kind: 'label', at: { x: 16, y: 72 }, text: 'Left shoulder', phase: 'formation' },
      { kind: 'label', at: { x: 40, y: 86 }, text: 'Head', phase: 'formation' },
      { kind: 'label', at: { x: 64, y: 74 }, text: 'Right shoulder', phase: 'formation' },
      { kind: 'invalidation', from: { x: 34, y: 82 }, to: { x: 50, y: 82 }, phase: 'trigger', label: 'Invalid above the head' },
      { kind: 'breakout', at: { x: 76, y: 50 }, direction: 'down', phase: 'breakout', label: 'Close below the neckline' },
      { kind: 'target', from: { x: 76, y: 50 }, to: { x: 92, y: 22 }, phase: 'target', label: 'Head to neckline' },
    ],
  },

  'reversal-bearish-rising-wedge': {
    path: [
      { x: 4, y: 18 },
      { x: 12, y: 46 },
      { x: 20, y: 28 },
      { x: 30, y: 60 },
      { x: 40, y: 50 },
      { x: 50, y: 70 },
      { x: 58, y: 64 },
      { x: 66, y: 76 },
      { x: 74, y: 62 },
      { x: 82, y: 48 },
      { x: 90, y: 36 },
      { x: 96, y: 28 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 12, y: 46 }, { x: 66, y: 76 }, { x: 58, y: 64 }, { x: 20, y: 28 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 12, y: 46 }, to: { x: 72, y: 79 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 20, y: 28 }, to: { x: 72, y: 77 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 34, y: 66 }, text: 'Swings compress', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 56, y: 88 }, to: { x: 74, y: 88 }, phase: 'trigger', label: 'Invalid above the upper line' },
      { kind: 'breakout', at: { x: 70, y: 66 }, direction: 'down', phase: 'breakout', label: 'Close below the lower line' },
      { kind: 'target', from: { x: 70, y: 66 }, to: { x: 92, y: 34 }, phase: 'target', label: 'Widest width' },
    ],
  },

  'reversal-bearish-expanding-triangle': {
    path: [
      { x: 4, y: 42 },
      { x: 12, y: 32 },
      { x: 22, y: 58 },
      { x: 32, y: 24 },
      { x: 42, y: 64 },
      { x: 52, y: 20 },
      { x: 62, y: 70 },
      { x: 70, y: 44 },
      { x: 78, y: 26 },
      { x: 88, y: 14 },
      { x: 96, y: 8 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 12, y: 32 }, { x: 62, y: 72 }, { x: 62, y: 20 }, { x: 12, y: 32 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 22, y: 58 }, to: { x: 62, y: 72 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 12, y: 30 }, to: { x: 62, y: 20 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 30, y: 82 }, text: 'Swings widen', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 20, y: 72 }, to: { x: 40, y: 78 }, phase: 'trigger', label: 'Invalid above the upper line' },
      { kind: 'breakout', at: { x: 88, y: 14 }, direction: 'down', phase: 'breakout', label: 'Close below the lower line' },
      { kind: 'target', from: { x: 88, y: 14 }, to: { x: 96, y: 6 }, phase: 'target', label: 'Width, as a guide only' },
    ],
  },

  'reversal-bearish-triple-top': {
    path: [
      { x: 4, y: 20 },
      { x: 10, y: 38 },
      { x: 16, y: 58 },
      { x: 22, y: 74 },
      { x: 28, y: 64 },
      { x: 34, y: 52 },
      { x: 40, y: 70 },
      { x: 46, y: 74 },
      { x: 52, y: 62 },
      { x: 58, y: 52 },
      { x: 64, y: 68 },
      { x: 70, y: 74 },
      { x: 76, y: 64 },
      { x: 82, y: 52 },
      { x: 88, y: 40 },
      { x: 96, y: 26 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 18, y: 74 }, { x: 74, y: 74 }, { x: 74, y: 52 }, { x: 18, y: 52 }], phase: 'formation' },
      { kind: 'level', from: { x: 16, y: 74 }, to: { x: 78, y: 74 }, phase: 'formation', label: 'Resistance' },
      { kind: 'level', from: { x: 30, y: 52 }, to: { x: 86, y: 52 }, phase: 'formation', label: 'Support' },
      { kind: 'label', at: { x: 22, y: 80 }, text: 'Three rejections', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 62, y: 82 }, to: { x: 80, y: 82 }, phase: 'trigger', label: 'Invalid above resistance' },
      { kind: 'breakout', at: { x: 82, y: 52 }, direction: 'down', phase: 'breakout', label: 'Support breaks' },
      { kind: 'target', from: { x: 82, y: 52 }, to: { x: 96, y: 30 }, phase: 'target', label: 'Measured move' },
    ],
  },

  'reversal-bullish-double-bottom': {
    path: [
      { x: 4, y: 84 },
      { x: 10, y: 66 },
      { x: 16, y: 50 },
      { x: 22, y: 26 },
      { x: 28, y: 38 },
      { x: 34, y: 52 },
      { x: 40, y: 24 },
      { x: 46, y: 38 },
      { x: 52, y: 52 },
      { x: 58, y: 66 },
      { x: 66, y: 80 },
      { x: 76, y: 88 },
      { x: 88, y: 94 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 18, y: 26 }, { x: 44, y: 26 }, { x: 44, y: 52 }, { x: 18, y: 52 }], phase: 'formation' },
      { kind: 'level', from: { x: 30, y: 52 }, to: { x: 68, y: 52 }, phase: 'formation', label: 'Neckline' },
      { kind: 'label', at: { x: 22, y: 18 }, text: 'First low', phase: 'formation' },
      { kind: 'label', at: { x: 40, y: 16 }, text: 'Second low', phase: 'formation' },
      { kind: 'invalidation', from: { x: 28, y: 18 }, to: { x: 46, y: 18 }, phase: 'trigger', label: 'Invalid below the lows' },
      { kind: 'breakout', at: { x: 56, y: 54 }, direction: 'up', phase: 'breakout', label: 'Close above the neckline' },
      { kind: 'retest', at: { x: 58, y: 60 }, phase: 'retest', label: 'Optional retest' },
      { kind: 'target', from: { x: 56, y: 52 }, to: { x: 84, y: 78 }, phase: 'target', label: 'Measured move' },
    ],
  },

  'reversal-bullish-inverted-head-shoulder': {
    path: [
      { x: 4, y: 80 },
      { x: 10, y: 68 },
      { x: 16, y: 52 },
      { x: 22, y: 40 },
      { x: 28, y: 50 },
      { x: 34, y: 58 },
      { x: 40, y: 44 },
      { x: 46, y: 24 },
      { x: 52, y: 46 },
      { x: 58, y: 58 },
      { x: 64, y: 50 },
      { x: 70, y: 42 },
      { x: 76, y: 54 },
      { x: 82, y: 70 },
      { x: 90, y: 84 },
      { x: 96, y: 92 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 14, y: 58 }, { x: 84, y: 58 }, { x: 84, y: 24 }, { x: 14, y: 24 }], phase: 'formation' },
      { kind: 'level', from: { x: 30, y: 58 }, to: { x: 88, y: 58 }, phase: 'formation', label: 'Neckline' },
      { kind: 'label', at: { x: 18, y: 34 }, text: 'Left shoulder', phase: 'formation' },
      { kind: 'label', at: { x: 44, y: 16 }, text: 'Head', phase: 'formation' },
      { kind: 'label', at: { x: 68, y: 34 }, text: 'Right shoulder', phase: 'formation' },
      { kind: 'invalidation', from: { x: 40, y: 16 }, to: { x: 54, y: 16 }, phase: 'trigger', label: 'Invalid below the head' },
      { kind: 'breakout', at: { x: 80, y: 60 }, direction: 'up', phase: 'breakout', label: 'Close above the neckline' },
      { kind: 'target', from: { x: 80, y: 58 }, to: { x: 94, y: 86 }, phase: 'target', label: 'Head to neckline' },
    ],
  },

  'reversal-bullish-falling-wedge': {
    path: [
      { x: 4, y: 88 },
      { x: 12, y: 56 },
      { x: 20, y: 72 },
      { x: 30, y: 48 },
      { x: 40, y: 58 },
      { x: 50, y: 38 },
      { x: 58, y: 44 },
      { x: 66, y: 32 },
      { x: 74, y: 54 },
      { x: 82, y: 68 },
      { x: 90, y: 80 },
      { x: 96, y: 88 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 12, y: 56 }, { x: 66, y: 32 }, { x: 58, y: 44 }, { x: 20, y: 72 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 12, y: 56 }, to: { x: 74, y: 28 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 20, y: 72 }, to: { x: 74, y: 64 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 32, y: 32 }, text: 'Swings compress', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 56, y: 60 }, to: { x: 74, y: 56 }, phase: 'trigger', label: 'Invalid below the lower line' },
      { kind: 'breakout', at: { x: 70, y: 48 }, direction: 'up', phase: 'breakout', label: 'Close above the upper line' },
      { kind: 'target', from: { x: 70, y: 48 }, to: { x: 92, y: 76 }, phase: 'target', label: 'Widest width' },
    ],
  },

  'reversal-bullish-expanding-triangle': {
    path: [
      { x: 4, y: 58 },
      { x: 12, y: 68 },
      { x: 22, y: 40 },
      { x: 32, y: 74 },
      { x: 42, y: 34 },
      { x: 52, y: 78 },
      { x: 62, y: 28 },
      { x: 72, y: 58 },
      { x: 82, y: 84 },
      { x: 92, y: 94 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 12, y: 68 }, { x: 62, y: 78 }, { x: 62, y: 28 }, { x: 12, y: 68 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 12, y: 68 }, to: { x: 62, y: 80 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 22, y: 40 }, to: { x: 62, y: 28 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 26, y: 22 }, text: 'Swings widen', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 22, y: 32 }, to: { x: 42, y: 26 }, phase: 'trigger', label: 'Invalid below the lower line' },
      { kind: 'breakout', at: { x: 82, y: 84 }, direction: 'up', phase: 'breakout', label: 'Close above the upper line' },
      { kind: 'target', from: { x: 82, y: 84 }, to: { x: 94, y: 94 }, phase: 'target', label: 'Width, as a guide only' },
    ],
  },

  'reversal-bullish-triple-bottom': {
    path: [
      { x: 4, y: 92 },
      { x: 10, y: 74 },
      { x: 16, y: 54 },
      { x: 22, y: 26 },
      { x: 28, y: 38 },
      { x: 34, y: 48 },
      { x: 40, y: 30 },
      { x: 46, y: 26 },
      { x: 52, y: 40 },
      { x: 58, y: 48 },
      { x: 64, y: 32 },
      { x: 70, y: 26 },
      { x: 76, y: 40 },
      { x: 82, y: 54 },
      { x: 88, y: 68 },
      { x: 96, y: 80 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 18, y: 26 }, { x: 74, y: 26 }, { x: 74, y: 48 }, { x: 18, y: 48 }], phase: 'formation' },
      { kind: 'level', from: { x: 16, y: 26 }, to: { x: 78, y: 26 }, phase: 'formation', label: 'Support' },
      { kind: 'level', from: { x: 30, y: 48 }, to: { x: 86, y: 48 }, phase: 'formation', label: 'Resistance' },
      { kind: 'label', at: { x: 22, y: 16 }, text: 'Three holds', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 62, y: 18 }, to: { x: 80, y: 18 }, phase: 'trigger', label: 'Invalid below support' },
      { kind: 'breakout', at: { x: 84, y: 52 }, direction: 'up', phase: 'breakout', label: 'Resistance breaks' },
      { kind: 'target', from: { x: 84, y: 48 }, to: { x: 96, y: 68 }, phase: 'target', label: 'Measured move' },
    ],
  },

  // ------------------------------------------------------------ continuation row
  'continuation-bullish-flag': {
    path: [
      { x: 4, y: 16 },
      { x: 10, y: 40 },
      { x: 16, y: 66 },
      { x: 22, y: 58 },
      { x: 28, y: 62 },
      { x: 34, y: 52 },
      { x: 40, y: 56 },
      { x: 46, y: 46 },
      { x: 54, y: 64 },
      { x: 62, y: 78 },
      { x: 72, y: 88 },
      { x: 84, y: 94 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 22, y: 65 }, { x: 50, y: 51 }, { x: 50, y: 44 }, { x: 22, y: 58 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 22, y: 65 }, to: { x: 62, y: 45 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 22, y: 58 }, to: { x: 62, y: 38 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 10, y: 74 }, text: 'Flagpole', phase: 'priorTrend' },
      { kind: 'invalidation', from: { x: 26, y: 40 }, to: { x: 52, y: 30 }, phase: 'trigger', label: 'Invalid below the flag' },
      { kind: 'breakout', at: { x: 52, y: 62 }, direction: 'up', phase: 'breakout', label: 'Close above the flag' },
      { kind: 'target', from: { x: 52, y: 56 }, to: { x: 84, y: 88 }, phase: 'target', label: 'Flagpole projection' },
    ],
  },

  'continuation-bullish-pennant': {
    path: [
      { x: 4, y: 16 },
      { x: 10, y: 42 },
      { x: 16, y: 68 },
      { x: 22, y: 60 },
      { x: 28, y: 64 },
      { x: 34, y: 54 },
      { x: 40, y: 58 },
      { x: 46, y: 50 },
      { x: 52, y: 66 },
      { x: 60, y: 80 },
      { x: 70, y: 90 },
      { x: 82, y: 94 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 20, y: 64 }, { x: 48, y: 54 }, { x: 48, y: 49 }, { x: 20, y: 60 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 20, y: 64 }, to: { x: 52, y: 50 }, phase: 'formation', label: 'Upper line' },
      { kind: 'trendline', from: { x: 20, y: 60 }, to: { x: 52, y: 44 }, phase: 'formation', label: 'Lower line' },
      { kind: 'label', at: { x: 10, y: 76 }, text: 'Flagpole', phase: 'priorTrend' },
      { kind: 'invalidation', from: { x: 24, y: 42 }, to: { x: 50, y: 32 }, phase: 'trigger', label: 'Invalid below the pennant' },
      { kind: 'breakout', at: { x: 52, y: 66 }, direction: 'up', phase: 'breakout', label: 'Close above the pennant' },
      { kind: 'target', from: { x: 52, y: 62 }, to: { x: 84, y: 90 }, phase: 'target', label: 'Flagpole projection' },
    ],
  },

  'continuation-bullish-falling-village': {
    path: [
      { x: 4, y: 18 },
      { x: 10, y: 46 },
      { x: 16, y: 70 },
      { x: 24, y: 58 },
      { x: 32, y: 64 },
      { x: 40, y: 52 },
      { x: 48, y: 58 },
      { x: 56, y: 46 },
      { x: 64, y: 66 },
      { x: 72, y: 80 },
      { x: 82, y: 90 },
      { x: 92, y: 94 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 22, y: 67 }, { x: 58, y: 52 }, { x: 58, y: 46 }, { x: 22, y: 58 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 22, y: 67 }, to: { x: 64, y: 52 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 22, y: 58 }, to: { x: 64, y: 44 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 10, y: 78 }, text: 'Impulse', phase: 'priorTrend' },
      { kind: 'label', at: { x: 66, y: 84 }, text: 'Prior high', phase: 'breakout' },
      { kind: 'invalidation', from: { x: 26, y: 44 }, to: { x: 56, y: 32 }, phase: 'trigger', label: 'Invalid below the lower line' },
      { kind: 'breakout', at: { x: 64, y: 66 }, direction: 'up', phase: 'breakout', label: 'Close above the upper line' },
      { kind: 'target', from: { x: 64, y: 62 }, to: { x: 88, y: 88 }, phase: 'target', label: 'Projection' },
    ],
  },

  'continuation-descending-triangle-bullish-source': {
    path: [
      { x: 4, y: 28 },
      { x: 10, y: 48 },
      { x: 16, y: 68 },
      { x: 22, y: 52 },
      { x: 28, y: 62 },
      { x: 34, y: 68 },
      { x: 40, y: 58 },
      { x: 46, y: 66 },
      { x: 52, y: 68 },
      { x: 58, y: 66 },
      { x: 66, y: 80 },
      { x: 72, y: 70 },
      { x: 80, y: 84 },
      { x: 88, y: 92 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 16, y: 68 }, { x: 60, y: 68 }, { x: 60, y: 52 }, { x: 16, y: 52 }], phase: 'formation' },
      { kind: 'level', from: { x: 12, y: 68 }, to: { x: 86, y: 68 }, phase: 'formation', label: 'Flat resistance' },
      { kind: 'trendline', from: { x: 22, y: 52 }, to: { x: 58, y: 64 }, phase: 'formation', label: 'Rising support' },
      { kind: 'label', at: { x: 30, y: 52 }, text: 'Higher lows', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 26, y: 46 }, to: { x: 54, y: 56 }, phase: 'trigger', label: 'Invalid below rising support' },
      { kind: 'breakout', at: { x: 62, y: 72 }, direction: 'up', phase: 'breakout', label: 'Close above the ceiling' },
      { kind: 'retest', at: { x: 72, y: 70 }, phase: 'retest', label: 'Ceiling holds as support' },
      { kind: 'target', from: { x: 62, y: 68 }, to: { x: 88, y: 88 }, phase: 'target', label: 'Widest height' },
    ],
  },

  'continuation-symmetrical-expanding-triangle-upper-source': {
    path: [
      { x: 4, y: 44 },
      { x: 12, y: 36 },
      { x: 20, y: 56 },
      { x: 28, y: 32 },
      { x: 36, y: 60 },
      { x: 44, y: 28 },
      { x: 52, y: 62 },
      { x: 60, y: 44 },
      { x: 68, y: 60 },
      { x: 78, y: 74 },
      { x: 88, y: 86 },
      { x: 94, y: 92 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 12, y: 36 }, { x: 56, y: 64 }, { x: 56, y: 26 }, { x: 12, y: 36 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 12, y: 55 }, to: { x: 60, y: 64 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 12, y: 38 }, to: { x: 60, y: 26 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 30, y: 34 }, text: 'Decision area', phase: 'trigger' },
      { kind: 'ghost', at: { x: 62, y: 20 }, direction: 'down', phase: 'breakout', label: 'Downside is possible too' },
      { kind: 'breakout', at: { x: 60, y: 44 }, direction: 'up', phase: 'breakout', label: 'Replay: the close decides' },
      // With no direction assumed, the failure rule is the same for both readings: an
      // exit that closes straight back inside the structure is a failed break.
      { kind: 'invalidation', from: { x: 52, y: 44 }, to: { x: 76, y: 44 }, phase: 'retest', label: 'Failed break: back inside' },
      { kind: 'target', from: { x: 60, y: 44 }, to: { x: 88, y: 88 }, phase: 'target', label: 'Width, either direction' },
    ],
  },

  'continuation-bearish-flag': {
    path: [
      { x: 4, y: 90 },
      { x: 10, y: 66 },
      { x: 16, y: 38 },
      { x: 22, y: 46 },
      { x: 30, y: 56 },
      { x: 38, y: 50 },
      { x: 46, y: 60 },
      { x: 54, y: 42 },
      { x: 62, y: 28 },
      { x: 72, y: 18 },
      { x: 84, y: 10 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 20, y: 63 }, { x: 52, y: 45 }, { x: 52, y: 38 }, { x: 20, y: 56 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 20, y: 63 }, to: { x: 62, y: 53 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 20, y: 56 }, to: { x: 62, y: 46 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 10, y: 30 }, text: 'Flagpole', phase: 'priorTrend' },
      { kind: 'invalidation', from: { x: 26, y: 70 }, to: { x: 54, y: 60 }, phase: 'trigger', label: 'Invalid above the flag' },
      { kind: 'breakout', at: { x: 52, y: 46 }, direction: 'down', phase: 'breakout', label: 'Close below the flag' },
      { kind: 'target', from: { x: 52, y: 46 }, to: { x: 84, y: 12 }, phase: 'target', label: 'Flagpole projection' },
    ],
  },

  'continuation-bearish-pennant': {
    path: [
      { x: 4, y: 92 },
      { x: 10, y: 66 },
      { x: 16, y: 40 },
      { x: 22, y: 48 },
      { x: 30, y: 46 },
      { x: 38, y: 54 },
      { x: 46, y: 55 },
      { x: 52, y: 36 },
      { x: 60, y: 24 },
      { x: 70, y: 16 },
      { x: 82, y: 8 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 20, y: 52 }, { x: 48, y: 58 }, { x: 48, y: 54 }, { x: 20, y: 42 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 20, y: 50 }, to: { x: 52, y: 58 }, phase: 'formation', label: 'Upper line' },
      { kind: 'trendline', from: { x: 20, y: 42 }, to: { x: 52, y: 54 }, phase: 'formation', label: 'Lower line' },
      { kind: 'label', at: { x: 10, y: 28 }, text: 'Flagpole', phase: 'priorTrend' },
      { kind: 'invalidation', from: { x: 24, y: 66 }, to: { x: 50, y: 70 }, phase: 'trigger', label: 'Invalid above the pennant' },
      { kind: 'breakout', at: { x: 52, y: 40 }, direction: 'down', phase: 'breakout', label: 'Close below the pennant' },
      { kind: 'target', from: { x: 52, y: 42 }, to: { x: 84, y: 14 }, phase: 'target', label: 'Flagpole projection' },
    ],
  },

  'continuation-bearish-rising-wedge': {
    path: [
      { x: 4, y: 88 },
      { x: 10, y: 64 },
      { x: 16, y: 40 },
      { x: 24, y: 50 },
      { x: 32, y: 46 },
      { x: 40, y: 58 },
      { x: 48, y: 55 },
      { x: 56, y: 64 },
      { x: 62, y: 48 },
      { x: 70, y: 36 },
      { x: 80, y: 24 },
      { x: 90, y: 14 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 22, y: 50 }, { x: 58, y: 64 }, { x: 58, y: 58 }, { x: 22, y: 46 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 22, y: 50 }, to: { x: 62, y: 66 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 22, y: 46 }, to: { x: 62, y: 60 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 10, y: 74 }, text: 'Bearish impulse', phase: 'priorTrend' },
      { kind: 'invalidation', from: { x: 28, y: 72 }, to: { x: 58, y: 82 }, phase: 'trigger', label: 'Invalid above the wedge' },
      { kind: 'breakout', at: { x: 62, y: 50 }, direction: 'down', phase: 'breakout', label: 'Close below the lower line' },
      { kind: 'target', from: { x: 62, y: 48 }, to: { x: 88, y: 16 }, phase: 'target', label: 'Prior low, then the impulse' },
    ],
  },

  'continuation-descending-triangle-bearish-source': {
    path: [
      { x: 4, y: 74 },
      { x: 10, y: 58 },
      { x: 16, y: 46 },
      { x: 22, y: 32 },
      { x: 28, y: 48 },
      { x: 34, y: 40 },
      { x: 40, y: 32 },
      { x: 46, y: 42 },
      { x: 52, y: 35 },
      { x: 58, y: 32 },
      { x: 64, y: 24 },
      { x: 72, y: 14 },
      { x: 82, y: 8 },
      { x: 92, y: 4 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 16, y: 48 }, { x: 60, y: 48 }, { x: 60, y: 32 }, { x: 16, y: 32 }], phase: 'formation' },
      { kind: 'level', from: { x: 12, y: 32 }, to: { x: 70, y: 32 }, phase: 'formation', label: 'Flat support' },
      { kind: 'trendline', from: { x: 28, y: 48 }, to: { x: 60, y: 37 }, phase: 'formation', label: 'Descending highs' },
      { kind: 'label', at: { x: 34, y: 52 }, text: 'Lower highs', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 28, y: 54 }, to: { x: 58, y: 44 }, phase: 'trigger', label: 'Invalid above the highs' },
      { kind: 'breakout', at: { x: 62, y: 30 }, direction: 'down', phase: 'breakout', label: 'Close below support' },
      { kind: 'retest', at: { x: 68, y: 30 }, phase: 'retest', label: 'Support from below' },
      { kind: 'target', from: { x: 62, y: 32 }, to: { x: 86, y: 12 }, phase: 'target', label: 'Widest height' },
    ],
  },

  'continuation-symmetrical-expanding-triangle-bearish-source': {
    path: [
      { x: 4, y: 52 },
      { x: 12, y: 44 },
      { x: 22, y: 62 },
      { x: 32, y: 38 },
      { x: 42, y: 68 },
      { x: 52, y: 34 },
      { x: 60, y: 72 },
      { x: 68, y: 52 },
      { x: 76, y: 34 },
      { x: 84, y: 20 },
      { x: 92, y: 12 },
    ],
    features: [
      { kind: 'zone', points: [{ x: 12, y: 44 }, { x: 60, y: 72 }, { x: 60, y: 32 }, { x: 12, y: 44 }], phase: 'formation' },
      { kind: 'trendline', from: { x: 12, y: 44 }, to: { x: 62, y: 72 }, phase: 'formation', label: 'Upper boundary' },
      { kind: 'trendline', from: { x: 12, y: 44 }, to: { x: 62, y: 32 }, phase: 'formation', label: 'Lower boundary' },
      { kind: 'label', at: { x: 30, y: 80 }, text: 'Swings widen', phase: 'trigger' },
      { kind: 'invalidation', from: { x: 22, y: 74 }, to: { x: 46, y: 82 }, phase: 'trigger', label: 'Invalid above the upper line' },
      { kind: 'breakout', at: { x: 84, y: 20 }, direction: 'down', phase: 'breakout', label: 'Close below the lower line' },
      { kind: 'target', from: { x: 84, y: 20 }, to: { x: 96, y: 8 }, phase: 'target', label: 'Nearest major support' },
    ],
  },
};

/**
 * Geometry for a pattern, or null when there is none.
 *
 * A null is a data bug (the pattern tests assert full coverage), so the caller shows a
 * quiet placeholder rather than inventing a diagram that might teach the wrong shape.
 */
export function getPatternAnimation(id: string | undefined | null): PatternAnimationSpec | null {
  if (!id) return null;
  return PATTERN_ANIMATIONS[id] ?? null;
}
