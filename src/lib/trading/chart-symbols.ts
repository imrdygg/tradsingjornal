/**
 * The chartable futures, in one place.
 *
 * The journal names instruments the trader uses ("MES", "MNQ"); the chart provider
 * (TradingView) names the front-month continuous contract ("CME_MINI:MES1!"). The mapping
 * lives here rather than being derived, because a wrong guess would silently chart a
 * different market — the same deliberate rule the live-quote mapping follows.
 *
 * Every contract the journal records is chartable, so a trade in any of them can be looked
 * at beside the numbers logged against it: the equity index, metals and energy complexes
 * the journal covers, micro and full size.
 *
 * Where a micro's own contract has no data on the provider's free embed — the chart draws
 * its empty state whatever the mount options — its chip charts the full-size contract
 * instead, which is the same market at the same price: MGC draws GC1!, MCL draws CL1! and
 * micro silver draws SI1!. The live-quote mapping below reads those same micros through
 * their full-size sibling for the same reason.
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
  { id: 'ES', name: 'E-mini S&P 500', tvSymbol: 'CME_MINI:ES1!', label: 'ES', group: 'index' },
  { id: 'NQ', name: 'E-mini Nasdaq-100', tvSymbol: 'CME_MINI:NQ1!', label: 'NQ', group: 'index' },
  { id: 'MYM', name: 'Micro E-mini Dow', tvSymbol: 'CBOT_MINI:MYM1!', label: 'MYM', group: 'index' },
  { id: 'YM', name: 'E-mini Dow', tvSymbol: 'CBOT_MINI:YM1!', label: 'YM', group: 'index' },
  { id: 'M2K', name: 'Micro E-mini Russell 2000', tvSymbol: 'CME_MINI:M2K1!', label: 'M2K', group: 'index' },
  { id: 'RTY', name: 'E-mini Russell 2000', tvSymbol: 'CME_MINI:RTY1!', label: 'RTY', group: 'index' },
  // Micro gold has no chartable data on the free embed (MG1! renders the empty
  // state), so it charts full-size gold — the same market the MGC quote already reads.
  { id: 'MGC', name: 'Micro Gold', tvSymbol: 'COMEX:GC1!', label: 'MGC', group: 'metals' },
  { id: 'GC', name: 'Gold', tvSymbol: 'COMEX:GC1!', label: 'Gold', group: 'metals' },
  // Micro silver follows micro gold: one chart for the silver market, the full-size one.
  { id: 'SIL', name: 'Micro Silver', tvSymbol: 'COMEX:SI1!', label: 'SIL', group: 'metals' },
  { id: 'SI', name: 'Silver', tvSymbol: 'COMEX:SI1!', label: 'SI', group: 'metals' },
  { id: 'CL', name: 'WTI Crude Oil', tvSymbol: 'NYMEX:CL1!', label: 'WTI', group: 'energy' },
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
  const known = new Set([
    'MES',
    'MNQ',
    'ES',
    'NQ',
    'MYM',
    'YM',
    'M2K',
    'RTY',
    'MGC',
    'GC',
    'SIL',
    'SI',
    'CL',
    'MCL',
  ]);
  const key = (id ?? '').trim().toUpperCase();
  return known.has(key) ? key : null;
}
