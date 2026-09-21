/**
 * The chartable futures, in one place.
 *
 * The journal names instruments the trader uses ("MES", "MNQ"); the chart provider
 * (TradingView) names the front-month continuous contract ("CME_MINI:MES1!"). The mapping
 * lives here rather than being derived, because a wrong guess would silently chart a
 * different market — the same deliberate rule the live-quote mapping follows.
 *
 * WTI and gold are included because the trader asked for them: energy and metals are the
 * other two complexes a futures desk watches beside the equity index futures the journal
 * already records. WTI has no micro contract on the provider under one symbol family, so
 * it charts the standard contract.
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
  { id: 'MGC', name: 'Micro Gold', tvSymbol: 'COMEX:MG1!', label: 'MGC', group: 'metals' },
  { id: 'GC', name: 'Gold', tvSymbol: 'COMEX:GC1!', label: 'Gold', group: 'metals' },
  { id: 'CL', name: 'WTI Crude Oil', tvSymbol: 'NYMEX:CL1!', label: 'WTI', group: 'energy' },
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
 * `FUTURES_QUOTE_SYMBOLS`. Gold maps to GC there, so the micro contract reuses the
 * full-size read: the market is the same market, and the chart is the visual while the
 * quote is the number. Symbols absent from that map fail loudly (null) rather than
 * inventing a ticker, exactly as the quote path does.
 */
export function chartQuoteSymbol(id: string): string | null {
  const known = new Set(['MES', 'MNQ', 'ES', 'NQ', 'MYM', 'GC', 'CL']);
  const key = (id ?? '').trim().toUpperCase();
  return known.has(key) ? key : null;
}
