import { describe, it, expect } from 'vitest';
import { CHART_SYMBOLS, chartQuoteSymbol, findChartSymbol } from '../chart-symbols';
import { DEFAULT_INSTRUMENTS } from '../instruments';
import { futuresQuoteSymbol } from '../../ai/market-data';

/**
 * The chart list and the instrument catalog are two deliberate hand-written mappings of the
 * same markets, which is exactly the kind of pair that drifts: a contract added to the
 * catalog and forgotten here would leave the trader unable to chart a market they record
 * trades in. These lock the two together by assertion rather than by comment.
 */

describe('chart symbols', () => {
  it('can chart every contract the journal records', () => {
    for (const instrument of DEFAULT_INSTRUMENTS) {
      // findChartSymbol falls back to MES for an unknown id, so the id has to be compared
      // rather than merely looked up — otherwise a missing chip would silently pass.
      expect(
        findChartSymbol(instrument.symbol).id,
        `${instrument.symbol} is an instrument but has no chart`
      ).toBe(instrument.symbol);
    }
  });

  it('maps every chip to a journal root, so a chart always names a market the journal knows', () => {
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
});
