/**
 * The tracker's fixed vocabulary: labels, colours and thresholds.
 *
 * Everything that names a timeframe, a side, a direction or a pattern lives here once, so
 * the form, the tables and every chart agree on what a thing is called and what colour it
 * is. Colour semantics are deliberately fixed across the whole tab:
 *
 *   support / held / upside   → green
 *   resistance / broke / down → red
 *   grades A→D               → green → blue → amber → red
 */
import type { BreakDirection, Grade, LevelKind, SetupTag, Timeframe } from './types';

/** The six charts tracked, in ascending order. */
export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h'] as const;

/** Minutes per timeframe, for a stable sort regardless of string order. */
export const TIMEFRAME_ORDER: Record<Timeframe, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
};

export const LEVEL_KINDS = ['support', 'resistance'] as const;
export const BREAK_DIRECTIONS = ['up', 'down'] as const;

export const SETUP_TAGS = [
  'rejection',
  'break-retest',
  'failed-breakout',
  'breakout-continuation',
  'liquidity-sweep',
  'balance-rotate',
  'trend-continuation',
  'other',
] as const;

export const SETUP_LABELS: Record<SetupTag, string> = {
  rejection: 'Rejection',
  'break-retest': 'Break & retest',
  'failed-breakout': 'Failed breakout',
  'breakout-continuation': 'Breakout continuation',
  'liquidity-sweep': 'Liquidity sweep',
  'balance-rotate': 'Balance rotate',
  'trend-continuation': 'Trend continuation',
  other: 'Other',
};

export const KIND_LABELS: Record<LevelKind, string> = {
  support: 'Support',
  resistance: 'Resistance',
};

export const DIRECTION_LABELS: Record<BreakDirection, string> = {
  up: 'Upside',
  down: 'Downside',
};

/**
 * One stable colour per timeframe, shared by every chart.
 *
 * Held as hex rather than a Tailwind class because Recharts draws in SVG and needs a real
 * colour value for a `fill`/`stroke`; the class strings below cover the HTML chips.
 */
export const TIMEFRAME_COLORS: Record<Timeframe, string> = {
  '1m': '#38bdf8',
  '3m': '#22d3ee',
  '5m': '#34d399',
  '15m': '#a3e635',
  '30m': '#fbbf24',
  '1h': '#c084fc',
};

/** The grade thresholds, applied to SHRUNK strength rather than raw reliability. */
export const GRADE_A = 68;
export const GRADE_B = 58;
export const GRADE_C = 48;

/** Confidence floors, in decisive tests (holds + breaks). */
export const CONFIDENCE_HIGH = 15;
export const CONFIDENCE_MEDIUM = 5;

/** Histogram bucket width for the timing charts. */
export const BUCKET_MINUTES = 30;

/**
 * The versioned storage key exported in the Data tab's explainer.
 *
 * The records are stored inside the journal snapshot (`ptj_mes_levels_v1`) so they sync
 * and back up with everything else, but this is the key a trader would find in devtools.
 */
export const STORAGE_KEY = 'ptj_mes_levels_v1';

export const OUTCOME_LABELS = {
  held: 'Held',
  broke: 'Broke',
  untested: 'Untested',
  mixed: 'Mixed',
} as const;

export const GRADE_CLASS: Record<Grade, string> = {
  A: 'border-emerald-700/60 bg-emerald-950/50 text-emerald-300',
  B: 'border-sky-700/60 bg-sky-950/50 text-sky-300',
  C: 'border-amber-700/60 bg-amber-950/50 text-amber-300',
  D: 'border-rose-700/60 bg-rose-950/50 text-rose-300',
  '—': 'border-zinc-700/60 bg-zinc-900/50 text-zinc-500',
};

export const CONFIDENCE_CLASS: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-rose-400',
  medium: 'bg-amber-400',
  high: 'bg-emerald-400',
};

export const KIND_CLASS: Record<LevelKind, string> = {
  support: 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
  resistance: 'border-rose-800/60 bg-rose-950/40 text-rose-300',
};

export const OUTCOME_CLASS: Record<'held' | 'broke' | 'mixed' | 'untested', string> = {
  held: 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
  broke: 'border-rose-800/60 bg-rose-950/40 text-rose-300',
  mixed: 'border-amber-800/60 bg-amber-950/40 text-amber-300',
  untested: 'border-zinc-700/60 bg-zinc-900/50 text-zinc-400',
};

export const DIRECTION_CLASS: Record<BreakDirection, string> = {
  up: 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
  down: 'border-rose-800/60 bg-rose-950/40 text-rose-300',
};

/** Outcome quick-picks, mapping to the tallies the spec fixes. */
export const QUICK_PICKS = {
  'not-hit': { label: 'Not hit', touches: 0, holds: 0, breaks: 0 },
  held: { label: 'Held', touches: 1, holds: 1, breaks: 0 },
  broke: { label: 'Broke', touches: 1, holds: 0, breaks: 1 },
  mixed: { label: 'Mixed', touches: 2, holds: 1, breaks: 1 },
} as const;

export type QuickPick = keyof typeof QUICK_PICKS;
