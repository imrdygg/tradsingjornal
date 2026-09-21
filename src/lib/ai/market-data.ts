/**
 * Sector heat map data for the plan lock preview.
 *
 * When the trader locks today's plan, the serverless function fetches how the 11
 * US sector ETFs and SPY are trading relative to their prior close — breadth of
 * green versus red, which sectors lead and lag — and hands that to the coach as a
 * factual brief, so its opinion on the plan is grounded in something real about
 * today's market rather than a guess.
 *
 * Lives with the coach's server-side modules because only the function should talk
 * to the market. The client gets its own endpoint: /api/market.
 *
 * Keyless by design (the user chose this): Yahoo's chart API needs no API key. The
 * trade-off is that it is unofficial and could change, so every failure path
 * degrades to `ok: false` with a reason — the UI shows a heat map that says it
 * could not load, and the coach's opinion is still written, only without market
 * context.
 */

/** The 11 SPDR sector ETFs plus SPY as the broad-market anchor. */
export const SECTOR_ETFS: ReadonlyArray<{ symbol: string; label: string }> = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'XLK', label: 'Technology' },
  { symbol: 'XLC', label: 'Comms' },
  { symbol: 'XLY', label: 'Cons. Disc.' },
  { symbol: 'XLP', label: 'Cons. Staples' },
  { symbol: 'XLE', label: 'Energy' },
  { symbol: 'XLF', label: 'Financials' },
  { symbol: 'XLI', label: 'Industrials' },
  { symbol: 'XLV', label: 'Health Care' },
  { symbol: 'XLU', label: 'Utilities' },
  { symbol: 'XLB', label: 'Materials' },
  { symbol: 'XLRE', label: 'Real Estate' },
];

/** One sector's read, as the heatmap tile and the coach brief both show it. */
export interface SectorQuote {
  symbol: string;
  label: string;
  /** Percent change versus the previous close, rounded to 2dp. Null when unknown. */
  changePercent: number | null;
  /** Last traded price. Null when unknown. */
  price: number | null;
  /** Previous session's closing price. Null when unknown. */
  previousClose: null | number;
}

export interface MarketBrief {
  ok: boolean;
  /** Why the data is missing or stale, in trader-readable language. */
  note?: string;
  /** When the underlying quotes were fetched, ISO 8601. */
  fetchedAt: string;
  /** Seconds a caller may treat this response as fresh. */
  maxAgeSeconds: number;
  quotes: SectorQuote[];
}

/** Percent change a tile gets, colour-banded from -2% to +2%. */
export function heatBand(changePercent: number | null): 'up-strong' | 'up' | 'flat' | 'down' | 'down-strong' | 'unknown' {
  if (changePercent === null || !Number.isFinite(changePercent)) return 'unknown';
  if (changePercent >= 1) return 'up-strong';
  if (changePercent > 0.1) return 'up';
  if (changePercent >= -0.1) return 'flat';
  if (changePercent >= -1) return 'down';
  return 'down-strong';
}

/** Draws the -2%..+2% band a percent change lands in, with its heatmap colour. */
const bandStyles: Record<string, string> = {
  'up-strong': 'bg-emerald-500/80 text-emerald-50 border-emerald-400',
  up: 'bg-emerald-800/60 text-emerald-200 border-emerald-700',
  flat: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  down: 'bg-rose-900/60 text-rose-200 border-rose-800',
  'down-strong': 'bg-rose-600/80 text-rose-50 border-rose-500',
  unknown: 'bg-zinc-900 text-zinc-500 border-zinc-800',
};

/** Tile styling for a band, so UIs agree on what each colour means. */
export function heatBandStyle(band: ReturnType<typeof heatBand>): string {
  return bandStyles[band];
}

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'] as const;

const FETCH_TIMEOUT_MS = 4_000;

/** One quote fetched live, or the reason it failed. */
type QuoteAttempt =
  | { symbol: string; ok: true; changePercent: number; price: number | null; previousClose: number | null }
  | { symbol: string; ok: false };

/**
 * Reads the percent change out of Yahoo's chart payload.
 *
 * `regularMarketChangePercent` is the cleanest source; the fallback computes it from
 * the regular price against `chartPreviousClose`, which survives variants of the
 * payload that omit the percentage. Returns null rather than 0 so a missing number
 * never masquerades as a flat session.
 */
function extractChangePercent(meta: Record<string, unknown>): number | null {
  const direct = meta['regularMarketChangePercent'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  const price = meta['regularMarketPrice'];
  const prev = meta['chartPreviousClose'] ?? meta['previousClose'];
  if (typeof price === 'number' && Number.isFinite(price) && typeof prev === 'number' && prev !== 0) {
    return ((price - prev) / prev) * 100;
  }
  return null;
}

async function fetchOneQuote(symbol: string): Promise<QuoteAttempt> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  let lastError = '';

  for (const host of YAHOO_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (journal plan preview)' },
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const payload = (await res.json()) as {
        chart?: {
          result?: Array<{ meta?: Record<string, unknown> }>;
          error?: unknown;
        };
      };
      const meta = payload.chart?.result?.[0]?.meta;
      if (!meta) {
        lastError = 'no meta in chart payload';
        continue;
      }
      const changePercent = extractChangePercent(meta);
      if (changePercent === null) {
        lastError = 'no change percent in chart payload';
        continue;
      }
      const price = meta['regularMarketPrice'];
      const prev = meta['chartPreviousClose'] ?? meta['previousClose'];
      return {
        symbol,
        ok: true,
        changePercent,
        price: typeof price === 'number' && Number.isFinite(price) ? price : null,
        previousClose: typeof prev === 'number' && Number.isFinite(prev) ? prev : null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }
  return { symbol, ok: false };
}

/** How many ticks a stale-but-real answer is still shown for, before refetching. */
const CACHE_TTL_MS = 60_000;
/** Live quotes older than this are labelled stale in the note, not silently trusted. */
const STALE_AFTER_MS = 10 * 60_000;

interface CacheEntry {
  brief: MarketBrief;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

/** Test hook: clears the module-level cache between specs. */
export function resetMarketCache(): void {
  cache = null;
}

/**
 * Market briefs are rendered into a modal and quoted by the coach, so failures
 * degrade instead of erroring: a partial answer keeps the symbols that answered,
 * and an empty answer keeps `ok: false` with a reason.
 */
export async function getMarketBrief(): Promise<MarketBrief> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.brief;

  const settled = await Promise.all(
    SECTOR_ETFS.map(async ({ symbol, label }) => {
      const attempt = await fetchOneQuote(symbol);
      const quote: SectorQuote = attempt.ok
        ? {
            symbol,
            label,
            changePercent: Math.round(attempt.changePercent * 100) / 100,
            price: attempt.price,
            previousClose: attempt.previousClose,
          }
        : { symbol, label, changePercent: null, price: null, previousClose: null };
      return quote;
    })
  );

  const quotes = settled;
  const failures = quotes.filter((q) => q.changePercent === null).length;

  const brief: MarketBrief = {
    ok: failures === 0,
    fetchedAt: new Date().toISOString(),
    maxAgeSeconds: Math.round(CACHE_TTL_MS / 1000),
    quotes,
  };
  if (failures === quotes.length) {
    brief.note = 'Market data could not be loaded right now.';
  } else if (failures > 0) {
    brief.note = `${failures} of ${quotes.length} symbols could not be loaded.`;
  }

  cache = { brief, expiresAt: now + CACHE_TTL_MS };
  return brief;
}

/** Formats a signed percent for tiles and the coach brief. */
export function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Turns the brief into the compact factual block the coach prompt quotes from.
 *
 * Deliberately numbers-only: no interpretation the model could mistake for its own
 * observation, and no wording that invites a prediction. The coach is told the
 * direction of breadth and the leaders/laggards, which is all the data actually shows.
 */
export function formatMarketBriefForPrompt(brief: MarketBrief): string {
  const lines: string[] = [];
  lines.push('=== TODAY\'S MARKET READ (sector ETFs vs their previous close, live data) ===');
  lines.push(
    'This is the only market data you have. It shows relative sector strength today, ' +
      'nothing more. It is not a forecast, and it says nothing about futures or the ' +
      'trader\'s instrument specifically unless the plan names one of these sectors.'
  );

  if (!brief.ok) {
    lines.push(`DATA STATUS: unavailable. ${brief.note ?? ''}`.trim());
    lines.push('Say plainly in marketRead that today\'s sector data could not be loaded.');
    return lines.join('\n');
  }

  const known = brief.quotes.filter((q) => q.changePercent !== null);
  const spy = brief.quotes.find((q) => q.symbol === 'SPY');
  if (spy && spy.changePercent !== null) {
    lines.push(`SPY (S&P 500 ETF): ${formatSignedPercent(spy.changePercent)}.`);
  }

  const up = known.filter((q) => (q.changePercent ?? 0) > 0.1);
  const down = known.filter((q) => (q.changePercent ?? 0) < -0.1);
  lines.push(`Breadth: ${up.length} of ${known.length} sectors up, ${down.length} down.`);

  const ranked = [...known].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  const leaders = ranked.slice(0, 3).map((q) => `${q.label} ${formatSignedPercent(q.changePercent)}`);
  const laggards = ranked.slice(-3).reverse().map((q) => `${q.label} ${formatSignedPercent(q.changePercent)}`);
  lines.push(`Strongest: ${leaders.join(', ')}.`);
  lines.push(`Weakest: ${laggards.join(', ')}.`);

  lines.push('Every sector vs previous close:');
  for (const q of brief.quotes) {
    lines.push(`- ${q.label} (${q.symbol}): ${formatSignedPercent(q.changePercent)}`);
  }

  const age = Date.now() - Date.parse(brief.fetchedAt);
  if (Number.isFinite(age) && age > STALE_AFTER_MS) {
    lines.push(
      `NOTE: these quotes are about ${Math.round(age / 60000)} minute(s) old. Mention the age if the number could have moved.`
    );
  }
  return lines.join('\n');
}
