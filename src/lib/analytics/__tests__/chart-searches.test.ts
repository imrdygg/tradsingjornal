import { describe, it, expect } from 'vitest';
import {
  CHART_MATCH_FLOOR,
  chartMatchBand,
  rankChartSearchesByStrength,
  summarizeChartSearch,
  summarizeChartSearchHistory,
} from '../chart-searches';
import type { ChartSearch, ChartSearchMatch } from '../../../types';

function match(score: number): ChartSearchMatch {
  return {
    date: '2026-09-18',
    symbol: 'MES',
    direction: 'long',
    setupName: null,
    score,
    compared: 'written-record',
  };
}

function search(id: string, scores: number[], createdAt = '2026-09-20T10:00:00.000Z'): ChartSearch {
  return {
    id,
    userId: 'u1',
    createdAt,
    patternRead: `read ${id}`,
    matches: scores.map(match),
  };
}

describe('chartMatchBand', () => {
  it('sorts a score into its band at the boundaries', () => {
    expect(chartMatchBand(90)).toBe('strong');
    expect(chartMatchBand(80)).toBe('strong');
    expect(chartMatchBand(79)).toBe('good');
    expect(chartMatchBand(60)).toBe('good');
    expect(chartMatchBand(59)).toBe('modest');
    expect(chartMatchBand(CHART_MATCH_FLOOR)).toBe('modest');
    expect(chartMatchBand(CHART_MATCH_FLOOR - 1)).toBe('below');
    expect(chartMatchBand(0)).toBe('below');
  });
});

describe('summarizeChartSearch', () => {
  it('reads the best, the mean and the band counts off one search', () => {
    const summary = summarizeChartSearch(search('a', [90, 70, 40]));

    expect(summary.best).toBe(90);
    expect(summary.average).toBe(67);
    expect(summary.matches).toBe(3);
    expect(summary.bands).toEqual({ strong: 1, good: 1, modest: 0, below: 1, total: 3 });
  });

  it('reads an empty search as nulls, not as zeros', () => {
    const summary = summarizeChartSearch(search('empty', []));

    // Zero is a score a match can have, so "no matches" must not be spelled as one.
    expect(summary.best).toBeNull();
    expect(summary.average).toBeNull();
    expect(summary.matches).toBe(0);
    expect(summary.bands.total).toBe(0);
  });
});

describe('rankChartSearchesByStrength', () => {
  it('puts the search with the strongest match first, and an empty one last', () => {
    const ranked = rankChartSearchesByStrength([
      summarizeChartSearch(search('weak', [60])),
      summarizeChartSearch(search('none', [])),
      summarizeChartSearch(search('strongest', [95, 20])),
    ]);

    expect(ranked.map((summary) => summary.id)).toEqual(['strongest', 'weak', 'none']);
  });

  it('breaks a tie on the mean, then on the newest', () => {
    const ranked = rankChartSearchesByStrength([
      // Same best (80), different mean: the search that is stronger on average leads.
      summarizeChartSearch(search('mixed', [80, 20])),
      summarizeChartSearch(search('solid', [80, 80])),
    ]);
    expect(ranked.map((summary) => summary.id)).toEqual(['solid', 'mixed']);

    // Same best and same mean: the newer search leads, so the order is never arbitrary.
    const dated = rankChartSearchesByStrength([
      summarizeChartSearch(search('older', [70], '2026-09-01T10:00:00.000Z')),
      summarizeChartSearch(search('newer', [70], '2026-09-25T10:00:00.000Z')),
    ]);
    expect(dated.map((summary) => summary.id)).toEqual(['newer', 'older']);
  });
});

describe('summarizeChartSearchHistory', () => {
  it('reads the whole run of searches as one distribution', () => {
    const summaries = [search('a', [90, 50]), search('b', [70])].map((item) =>
      summarizeChartSearch(item)
    );

    const history = summarizeChartSearchHistory(summaries);

    expect(history.searches).toBe(2);
    expect(history.withMatches).toBe(2);
    expect(history.bands).toEqual({ strong: 1, good: 1, modest: 0, below: 1, total: 3 });
    expect(history.average).toBe(70);
    expect(history.best).toBe(90);
    expect(history.bestSearchId).toBe('a');
  });

  it('reports no best and no mean when nothing has matched', () => {
    const history = summarizeChartSearchHistory(
      [search('a', []), search('b', [])].map((item) => summarizeChartSearch(item))
    );

    expect(history.searches).toBe(2);
    expect(history.withMatches).toBe(0);
    expect(history.best).toBeNull();
    expect(history.bestSearchId).toBeNull();
    expect(history.average).toBeNull();
    expect(history.bands.total).toBe(0);
  });

  it('is empty, not broken, for a journal that has never searched', () => {
    const history = summarizeChartSearchHistory([]);

    expect(history.searches).toBe(0);
    expect(history.best).toBeNull();
    expect(history.average).toBeNull();
  });
});
