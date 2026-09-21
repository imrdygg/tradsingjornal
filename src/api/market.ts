import { getInstrumentQuote, getMarketBrief } from '../lib/ai/market-data';

/** Bumped whenever the endpoint's contract changes, so a live check is conclusive. */
const ENDPOINT_VERSION = 2;

/**
 * Public market data endpoint.
 *
 * GET only, no auth: the data is public and keyless, and the response is cached, so the
 * exposure is the upstream provider's to see, not a secret to protect.
 *
 * Two shapes, chosen by the query:
 * - no `symbol`: the sector ETF + SPY brief behind the plan lock preview heat map;
 * - `?symbol=MES`: the live read of that one futures contract, for the plan panel and
 *   the coach's opinion modes.
 *
 * Both degrade rather than error: a dead provider or an unmapped symbol returns a
 * payload the UI can render as "could not load", because the plan form must never break
 * because a quote did.
 */

interface ApiRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** Reads one query parameter, which some hosts deliver as an array. */
function readQuery(req: ApiRequest, name: string): string {
  const raw = req.query?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=40');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  const symbol = readQuery(req, 'symbol');

  try {
    if (symbol) {
      const quote = await getInstrumentQuote(symbol);
      res.status(200).json({
        ok: quote.ok,
        service: 'market',
        version: ENDPOINT_VERSION,
        kind: 'instrument',
        note: quote.note,
        fetchedAt: quote.fetchedAt,
        instrument: quote,
      });
      return;
    }

    const brief = await getMarketBrief();
    res.status(200).json({
      ok: brief.ok,
      service: 'market',
      version: ENDPOINT_VERSION,
      kind: 'sectors',
      note: brief.note,
      fetchedAt: brief.fetchedAt,
      maxAgeSeconds: brief.maxAgeSeconds,
      quotes: brief.quotes,
    });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error:
        'Market data could not be loaded' +
        (err instanceof Error ? ` (${err.message})` : '') +
        '.',
    });
  }
}
