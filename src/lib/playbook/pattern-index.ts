/**
 * Source label -> pattern id, and nothing else.
 *
 * This exists for one reason: the trade detail view is in the eagerly loaded chunk and
 * offers a "study this pattern" link, but importing the pattern registry from there drags
 * all 20 patterns' prose, geometry and filters into the first paint — the whole point of
 * loading the playbook on demand. A few short strings cost nothing; the content stays in
 * the playbook chunk.
 *
 * It is not a second source of truth. `patterns.ts` derives `findPatternBySetupName` from
 * this table and the registry, and a unit test asserts the two agree label for label, so a
 * renamed pattern cannot silently leave a stale entry here.
 *
 * A label is an array because the source sheet prints three of them twice (Bearish Rising
 * Wedge, Descending Triangle, Symmetrical Expanding Triangle). Those are genuinely different
 * drawings, so a trade logged under one of those names cannot be resolved with certainty:
 * the first entry — the earlier source position — is offered, and its guide links to the twin.
 */
const PATTERN_LABEL_INDEX: Record<string, readonly string[]> = {
  'bearish double top': ['reversal-bearish-double-top'],
  'bearish head shoulders': ['reversal-bearish-head-shoulders'],
  'bearish rising wedge': ['reversal-bearish-rising-wedge', 'continuation-bearish-rising-wedge'],
  'bearish expanding triangle': ['reversal-bearish-expanding-triangle'],
  'bearish triple top': ['reversal-bearish-triple-top'],
  'bullish double bottom': ['reversal-bullish-double-bottom'],
  'bullish inverted head and shoulder': ['reversal-bullish-inverted-head-shoulder'],
  'bullish falling wedge': ['reversal-bullish-falling-wedge'],
  'bullish expanding triangle': ['reversal-bullish-expanding-triangle'],
  'bullish triple bottom': ['reversal-bullish-triple-bottom'],
  'bullish flag pattern': ['continuation-bullish-flag'],
  'bullish pennant pattern': ['continuation-bullish-pennant'],
  'bullish falling village': ['continuation-bullish-falling-village'],
  'descending triangle': [
    'continuation-descending-triangle-bullish-source',
    'continuation-descending-triangle-bearish-source',
  ],
  'symmetrical expanding triangle': [
    'continuation-symmetrical-expanding-triangle-upper-source',
    'continuation-symmetrical-expanding-triangle-bearish-source',
  ],
  'bearish flag pattern': ['continuation-bearish-flag'],
  'bearish pennant pattern': ['continuation-bearish-pennant'],
};

/** Every label this index knows, for the drift test and for diagnostics. */
export const INDEXED_PATTERN_LABELS: string[] = Object.keys(PATTERN_LABEL_INDEX);

/** The ids a label could mean: more than one only for a label the source repeats. */
export function findPatternIdsBySetupName(setupName: string | undefined): string[] {
  if (!setupName) return [];
  return [...(PATTERN_LABEL_INDEX[setupName.trim().toLowerCase()] ?? [])];
}

/**
 * The pattern a trade's setup name points at, if any.
 *
 * Exact, case-insensitive matches only. A fuzzy match here would attach the wrong chart to
 * a trade, which is the failure the rest of the journal works to avoid, so an unmatched name
 * returns nothing and the UI shows no link.
 */
export function findPatternIdBySetupName(setupName: string | undefined): string | undefined {
  return findPatternIdsBySetupName(setupName)[0];
}
