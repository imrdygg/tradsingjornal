import { describe, it, expect } from 'vitest';
import { CHART_SYMBOLS, chartQuoteSymbol, findChartSymbol } from '../chart-symbols';
import { DEFAULT_INSTRUMENTS } from '../instruments';
import { futuresQuoteSymbol } from '../../ai/market-data';

/**
 * The chart board and the instrument catalog are two hand-written mappings of the same
 * markets, which is exactly the kind of pair that drifts. The board is deliberately shorter
 * than the catalog — a trader journals an illiquid contract they trade without needing it on
 * the Markets tab — so the invariant is not "everything is chartable" but "everything
 * chartable is a real instrument, and everything chartable has a live read".
 */

describe('chart symbols', () => {
  it('only charts markets the journal can also record', () => {
    const known = new Set(DEFAULT_INSTRUMENTS.map((instrument) => instrument.symbol));

    for (const symbol of CHART_SYMBOLS) {
      expect(known.has(symbol.id), `${symbol.id} is chartable but is not a journal instrument`).toBe(
        true
      );
    }
  });

  it('has both a live quote and a chartable root for every chip', () => {
    for (const symbol of CHART_SYMBOLS) {
      expect(chartQuoteSymbol(symbol.id)).toBe(symbol.id);
      expect(futuresQuoteSymbol(symbol.id)).not.toBeNull();
      // The provider symbol is always a continuous front month, never a dated contract.
      expect(symbol.tvSymbol.endsWith('1!')).toBe(true);
    }
  });

  it('leads the board with the index contracts and still offers energy and metals', () => {
    expect(CHART_SYMBOLS[0].id).toBe('ES');
    expect(CHART_SYMBOLS.some((symbol) => symbol.id === 'CL')).toBe(true);
    expect(CHART_SYMBOLS.some((symbol) => symbol.id === 'GC')).toBe(true);
  });

  it('falls back to the first chip rather than to an invented ticker', () => {
    expect(findChartSymbol('ZZZ').id).toBe(CHART_SYMBOLS[0].id);
    expect(chartQuoteSymbol('ZZZ')).toBeNull();
  });
});
