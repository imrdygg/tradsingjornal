import { PatternBias, PatternCategory, PatternSetup } from './pattern-types';
import { REVERSAL_PATTERNS } from './patterns-reversal';
import { CONTINUATION_PATTERNS } from './patterns-continuation';

/**
 * The Chart Patterns registry.
 *
 * One ordered list is the single source of truth for the whole section: the grid, the
 * filters, the detail view and the animation lookup all read it, so a pattern is a data
 * change rather than a new component. Content lives in the two row modules because the
 * source sheet is organised as a reversal row and a continuation row, and keeping that
 * split makes the file-to-sheet mapping obvious.
 *
 * Order is the source order (`sourcePosition`), not alphabetical: the sheet's sequence is
 * the intended study sequence, and the reversals-first grouping is how the grid presents
 * the two categories.
 */
export const PATTERNS: PatternSetup[] = [...REVERSAL_PATTERNS, ...CONTINUATION_PATTERNS].sort(
  (a, b) => a.sourcePosition - b.sourcePosition
);

const BY_ID = new Map(PATTERNS.map((pattern) => [pattern.id, pattern]));

/** Lookup by stable id. Returns undefined rather than throwing, for bad deep links. */
export function getPattern(id: string | undefined | null): PatternSetup | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function isPatternId(id: string | undefined | null): boolean {
  return !!id && BY_ID.has(id);
}

export const PATTERN_IDS: string[] = PATTERNS.map((pattern) => pattern.id);

export interface PatternFilters {
  category?: PatternCategory | 'all';
  bias?: PatternBias | 'all';
}

/**
 * Applies the grid's filters. Kept here rather than in the component so the filter
 * behaviour is unit-testable without rendering anything.
 */
export function filterPatterns(filters: PatternFilters = {}): PatternSetup[] {
  const { category = 'all', bias = 'all' } = filters;
  return PATTERNS.filter(
    (pattern) =>
      (category === 'all' || pattern.category === category) &&
      (bias === 'all' || pattern.bias === bias)
  );
}

/**
 * Patterns worth reading next to this one.
 *
 * Same category first, ranked by how much of the source name they share: the two flags,
 * the two pennants and the two wedges genuinely belong together, and a double top belongs
 * next to a triple top. Deliberately not a graph — a scoring pass over names is enough to
 * be useful, and it cannot quietly invent a relationship that is not there.
 */
export function relatedPatterns(pattern: PatternSetup, limit = 3): PatternSetup[] {
  // Direction and filler words carry no structural meaning: 'Bullish Double Bottom' is
  // related to 'Bearish Double Top' through "double", and counting "bullish" would rank a
  // bearish head-and-shoulders above it instead.
  const STOPWORDS = new Set(['bullish', 'bearish', 'pattern', 'and', 'the', 'for']);

  const words = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word));

  const own = new Set(words(pattern.sourceName));

  return PATTERNS.filter((candidate) => candidate.id !== pattern.id)
    .map((candidate) => {
      const overlap = words(candidate.sourceName).filter((word) => own.has(word)).length;
      return {
        candidate,
        score: overlap * 2 + (candidate.category === pattern.category ? 1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.candidate.sourcePosition - b.candidate.sourcePosition)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/**
 * The pattern taught by a trade's setup name, if the trader's own setup names line up with
 * the playbook. Only exact, case-insensitive matches on the source label count: a fuzzy
 * match here would attach the wrong chart to a trade, which is precisely the failure the
 * rest of this app works to avoid.
 */
export function findPatternBySetupName(setupName: string | undefined): PatternSetup | undefined {
  if (!setupName) return undefined;
  const wanted = setupName.trim().toLowerCase();
  return PATTERNS.find((pattern) => pattern.sourceName.toLowerCase() === wanted);
}
