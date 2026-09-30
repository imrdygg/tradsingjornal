import type { ChartSearch } from '../../types';

/**
 * The picture-search history, reduced to numbers.
 *
 * A saved search is a picture, a structural read and a handful of scored matches. What the
 * trader actually wants from the history is the shape of it: which of the charts they have
 * searched with found real matches, and how strong those matches were. That is a read over
 * their own saved searches, so it is computed here, deterministically, rather than asked of
 * the coach — the same rule every other count in the app follows.
 *
 * Nothing in here knows about the coach or the UI. It takes saved searches and returns
 * counts, so the ranking can be unit-tested without a browser.
 */

/** The resemblance a match must reach to count as shown. Mirrored by the card's floor. */
export const CHART_MATCH_FLOOR = 55;

/** The bands a resemblance score is sorted into, strongest first. */
export const CHART_MATCH_STRONG = 80;
export const CHART_MATCH_GOOD = 60;

/** Which band a score falls in, given the floor that decides what is "shown". */
export type ChartMatchBand = 'strong' | 'good' | 'modest' | 'below';

export function chartMatchBand(score: number, floor = CHART_MATCH_FLOOR): ChartMatchBand {
  if (score >= CHART_MATCH_STRONG) return 'strong';
  if (score >= CHART_MATCH_GOOD) return 'good';
  if (score >= floor) return 'modest';
  return 'below';
}

/** How many matches of a search fell in each band. */
export interface ChartMatchBands {
  strong: number;
  good: number;
  modest: number;
  /** Below the floor: found, but loose enough that the card keeps them folded away. */
  below: number;
  total: number;
}

const EMPTY_BANDS: ChartMatchBands = { strong: 0, good: 0, modest: 0, below: 0, total: 0 };

function countBands(scores: number[], floor: number): ChartMatchBands {
  const bands: ChartMatchBands = { ...EMPTY_BANDS };
  for (const score of scores) {
    bands[chartMatchBand(score, floor)] += 1;
    bands.total += 1;
  }
  return bands;
}

/** One saved search, read as numbers rather than as a picture and some prose. */
export interface ChartSearchSummary {
  id: string;
  createdAt: string;
  patternRead: string;
  thumbnail?: string;
  /** How many trades the search matched in total, including the ones below the floor. */
  matches: number;
  /** The strongest resemblance in this search, or null when it matched nothing. */
  best: number | null;
  /** The mean score across this search's matches, or null when there are none. */
  average: number | null;
  bands: ChartMatchBands;
}

/**
 * Reads one saved search.
 *
 * `best` and `average` are null — not zero — for a search that matched nothing. Zero is a
 * score a match can actually have, so using it for "there were no matches" would let an
 * empty search sort alongside a genuinely poor one.
 */
export function summarizeChartSearch(
  search: ChartSearch,
  floor = CHART_MATCH_FLOOR
): ChartSearchSummary {
  const scores = (search.matches ?? []).map((match) => match.score);
  const bands = countBands(scores, floor);
  return {
    id: search.id,
    createdAt: search.createdAt,
    patternRead: search.patternRead,
    thumbnail: search.thumbnail,
    matches: scores.length,
    best: scores.length ? Math.max(...scores) : null,
    average: scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null,
    bands,
  };
}

/**
 * The searches, strongest first.
 *
 * "Strongest" is the best match a search found, because that is the thing the trader is
 * asking about: which chart looks most like something they have actually traded. A search
 * with no matches sorts last whatever its date, and an exact tie falls back to the average,
 * then to the newest — so the order is total and never depends on the sort being stable.
 */
export function rankChartSearchesByStrength(
  summaries: ChartSearchSummary[]
): ChartSearchSummary[] {
  return [...summaries].sort((a, b) => {
    const bestDiff = (b.best ?? -1) - (a.best ?? -1);
    if (bestDiff !== 0) return bestDiff;
    const averageDiff = (b.average ?? -1) - (a.average ?? -1);
    if (averageDiff !== 0) return averageDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** The whole history, read as one distribution rather than search by search. */
export interface ChartSearchHistory {
  /** How many searches have been saved. */
  searches: number;
  /** How many of those matched at least one trade. */
  withMatches: number;
  /** Every match across every search, counted by band. */
  bands: ChartMatchBands;
  /** The strongest resemblance anywhere in the history, or null when there are no matches. */
  best: number | null;
  /** The search holding that strongest match, so the trader can go back to it. */
  bestSearchId: string | null;
  /** The mean score across every match in the history, or null when there are none. */
  average: number | null;
}

export function summarizeChartSearchHistory(
  summaries: ChartSearchSummary[]
): ChartSearchHistory {
  const bands: ChartMatchBands = { ...EMPTY_BANDS };
  let best: number | null = null;
  let bestSearchId: string | null = null;
  let scoreSum = 0;

  for (const summary of summaries) {
    bands.strong += summary.bands.strong;
    bands.good += summary.bands.good;
    bands.modest += summary.bands.modest;
    bands.below += summary.bands.below;
    bands.total += summary.bands.total;
    scoreSum +=
      summary.matches > 0 && summary.average !== null ? summary.average * summary.matches : 0;

    if (summary.best !== null && (best === null || summary.best > best)) {
      best = summary.best;
      bestSearchId = summary.id;
    }
  }

  return {
    searches: summaries.length,
    withMatches: summaries.filter((summary) => summary.matches > 0).length,
    bands,
    best,
    bestSearchId,
    average: bands.total > 0 ? Math.round(scoreSum / bands.total) : null,
  };
}
