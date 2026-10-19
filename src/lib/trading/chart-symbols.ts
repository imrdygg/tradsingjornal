/**
 * The chartable futures, in one place.
 *
 * The journal names instruments the trader uses ("MES"); the chart provider (TradingView)
 * names the front-month continuous contract ("CME_MINI:MES1!"). The mapping lives here
 * rather than being derived, because a wrong guess would silently chart a different market —
 * the same deliberate rule the live-quote mapping follows.
 *
 * This is the Markets board, not the catalog: every instrument a trader records can be
 * priced and journaled, and a contract without a chip here is simply not on the board. The
 * board is a curated set of the liquid contracts a discretionary futures trader actually
 * watches, which is why it is shorter than `DEFAULT_INSTRUMENTS`.
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
  // ---- Equity index -------------------------------------------------------
  { id: 'ES', name: 'E-mini S&P 500', tvSymbol: 'CME_MINI:ES1!', label: 'ES', group: 'index' },
  { id: 'MES', name: 'Micro E-mini S&P 500', tvSymbol: 'CME_MINI:MES1!', label: 'MES', group: 'index' },
  { id: 'NQ', name: 'E-mini Nasdaq-100', tvSymbol: 'CME_MINI:NQ1!', label: 'NQ', group: 'index' },
  { id: 'MNQ', name: 'Micro E-mini Nasdaq-100', tvSymbol: 'CME_MINI:MNQ1!', label: 'MNQ', group: 'index' },
  { id: 'YM', name: 'E-mini Dow ($5)', tvSymbol: 'CBOT_MINI:YM1!', label: 'YM', group: 'index' },
  { id: 'MYM', name: 'Micro E-mini Dow ($0.50)', tvSymbol: 'CBOT_MINI:MYM1!', label: 'MYM', group: 'index' },
  { id: 'RTY', name: 'E-mini Russell 2000', tvSymbol: 'CME_MINI:RTY1!', label: 'RTY', group: 'index' },
  { id: 'M2K', name: 'Micro E-mini Russell 2000', tvSymbol: 'CME_MINI:M2K1!', label: 'M2K', group: 'index' },

  // ---- Energy -------------------------------------------------------------
  { id: 'CL', name: 'Crude Oil (WTI)', tvSymbol: 'NYMEX:CL1!', label: 'CL', group: 'energy' },
  { id: 'MCL', name: 'Micro Crude Oil (WTI)', tvSymbol: 'NYMEX:MCL1!', label: 'MCL', group: 'energy' },
  { id: 'NG', name: 'Natural Gas (Henry Hub)', tvSymbol: 'NYMEX:NG1!', label: 'NG', group: 'energy' },
  { id: 'RB', name: 'RBOB Gasoline', tvSymbol: 'NYMEX:RB1!', label: 'RB', group: 'energy' },
  { id: 'HO', name: 'NY Harbor ULSD', tvSymbol: 'NYMEX:HO1!', label: 'HO', group: 'energy' },
  { id: 'BZ', name: 'Brent Crude Oil (last day)', tvSymbol: 'NYMEX:BZ1!', label: 'BZ', group: 'energy' },

  // ---- Metals -------------------------------------------------------------
  { id: 'GC', name: 'Gold', tvSymbol: 'COMEX:GC1!', label: 'GC', group: 'metals' },
  { id: 'MGC', name: 'Micro Gold', tvSymbol: 'COMEX:MGC1!', label: 'MGC', group: 'metals' },
  { id: 'SI', name: 'Silver', tvSymbol: 'COMEX:SI1!', label: 'SI', group: 'metals' },
  { id: 'SIL', name: 'Micro Silver', tvSymbol: 'COMEX:SIL1!', label: 'SIL', group: 'metals' },
  { id: 'HG', name: 'Copper', tvSymbol: 'COMEX:HG1!', label: 'HG', group: 'metals' },
  { id: 'PL', name: 'Platinum', tvSymbol: 'NYMEX:PL1!', label: 'PL', group: 'metals' },
];

/**
 * The symbol a chart shows, by journal root.
 *
 * Falls back to the first chip — the board always has something on it — but `findChartSymbol`
 * is only ever called with an id that came from the board or from the day's own instrument,
 * and the caller compares `.id` when it needs to know whether the lookup matched.
 */
export function findChartSymbol(id: string | undefined | null): ChartSymbol {
  const key = (id ?? '').trim().toUpperCase();
  return CHART_SYMBOLS.find((symbol) => symbol.id === key) ?? CHART_SYMBOLS[0];
}

/**
 * The live-quote source for a chartable symbol, or null when unmapped.
 *
 * The opinion flow reads the day's numbers from Yahoo through the existing
 * `/api/market?symbol=` endpoint, which maps journal roots to Yahoo tickers via
 * `FUTURES_QUOTE_SYMBOLS`. Symbols absent from that map fail loudly (null) rather than
 * inventing a ticker, exactly as the quote path does.
 */
export function chartQuoteSymbol(id: string): string | null {
  const key = (id ?? '').trim().toUpperCase();
  return CHART_SYMBOLS.some((symbol) => symbol.id === key) ? key : null;
}
