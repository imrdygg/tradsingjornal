import { getMarketBrief } from '../lib/ai/market-data';

/** Bumped whenever the endpoint's contract changes, so a live check is conclusive. */
const ENDPOINT_VERSION = 1;

/**
 * Public market data endpoint for the plan lock preview heat map.
 *
 * GET only. Returns the sector ETF + SPY brief, or an error JSON the UI renders as a
 * heat map that could not load. No auth: the data is public and keyless, and the
 * response is cached for a minute, so the exposure is the upstream provider's to see,
 * not a secret to protect.
 */

interface ApiRequest {
  method?: string;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  try {
    const brief = await getMarketBrief();
    res.status(200).json({
      ok: brief.ok,
      service: 'market',
      version: ENDPOINT_VERSION,
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
