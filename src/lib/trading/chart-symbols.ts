/**
 * The chartable futures, in one place.
 *
 * The journal names instruments the trader uses ("MES", "MNQ"); the chart provider
 * (TradingView) names the front-month continuous contract ("CME_MINI:MES1!"). The mapping
 * lives here rather than being derived, because a wrong guess would silently chart a
 * different market — the same deliberate rule the live-quote mapping follows.
 *
 * Every contract the journal records is chartable, so a trade in any of them can be looked
 * at beside the numbers logged against it. The journal records three contracts — micro
 * S&P, micro Nasdaq and micro WTI — and so this list holds the same three.
 *
 * Where a micro's own contract has no data on the provider's free embed — the chart draws
 * its empty state whatever the mount options — its chip charts the full-size contract
 * instead, which is the same market at the same price: MCL draws CL1!. The live-quote
 * mapping below reads micro crude through its full-size sibling for the same reason.
 */

export interface ChartSymbol {
  /** Journal-style root, e.g. MES. Also the id used in UI state and e2e selectors. */
  id: string;
  /** Display name, e.g. "Micro E-mini S&P 500". */
  name: string;
  /** The provider's symbol for the continuous front month, e.g. "CME_MINI:MES1!". */
  tvSymbol: string;
  /** Short badge text shown on the chip. */
  label: string;
  /** Which complex it belongs to, so the chips read as groups. */
  group: 'index' | 'energy' | 'metals';
}

export const CHART_SYMBOLS: readonly ChartSymbol[] = [
  { id: 'MES', name: 'Micro E-mini S&P 500', tvSymbol: 'CME_MINI:MES1!', label: 'MES', group: 'index' },
  { id: 'MNQ', name: 'Micro E-mini Nasdaq-100', tvSymbol: 'CME_MINI:MNQ1!', label: 'MNQ', group: 'index' },
  // Micro crude shares full-size WTI's chart for the reason given at the top: the micro
  // contract is the same market at the same price, only a tenth the size.
  { id: 'MCL', name: 'Micro WTI Crude Oil', tvSymbol: 'NYMEX:CL1!', label: 'MCL', group: 'energy' },
];

/** The symbol a chart shows, by journal root. Defaults to MES. */
export function findChartSymbol(id: string | undefined | null): ChartSymbol {
  const key = (id ?? '').trim().toUpperCase();
  return CHART_SYMBOLS.find((s) => s.id === key) ?? CHART_SYMBOLS[0];
}

/**
 * The live-quote source for a chartable symbol, or null when unmapped.
 *
 * The opinion flow reads the day's numbers from Yahoo through the existing
 * `/api/market?symbol=` endpoint, which maps journal roots to Yahoo tickers via
 * `FUTURES_QUOTE_SYMBOLS` — which covers every chartable root here, micro contracts
 * included. Symbols absent from that map fail loudly (null) rather than inventing a
 * ticker, exactly as the quote path does.
 */
export function chartQuoteSymbol(id: string): string | null {
  const known = new Set(['MES', 'MNQ', 'MCL']);
  const key = (id ?? '').trim().toUpperCase();
  return known.has(key) ? key : null;
}
