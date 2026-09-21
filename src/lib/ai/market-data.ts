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

/**
 * The contract a journal instrument resolves to on the quote provider.
 *
 * The journal names instruments the way a trader does ("MES"); the provider names the
 * front-month future ("MES=F"). Keeping the mapping here — rather than deriving it —
 * is deliberate: a wrong guess would silently return some other market's price and the
 * coach would reason about the wrong instrument, which is worse than returning nothing.
 * An unmapped symbol therefore fails loudly (null) instead of inventing a ticker.
 */
export const FUTURES_QUOTE_SYMBOLS: Readonly<Record<string, string>> = {
  // Equity index futures, micro and full size.
  MES: 'MES=F',
  ES: 'ES=F',
  MNQ: 'MNQ=F',
  NQ: 'NQ=F',
  MYM: 'MYM=F',
  YM: 'YM=F',
  M2K: 'M2K=F',
  RTY: 'RTY=F',
  // Metals and energy.
  MGC: 'MGC=F',
  GC: 'GC=F',
  SIL: 'SIL=F',
  SI: 'SI=F',
  MCL: 'MCL=F',
  CL: 'CL=F',
  // FX.
  M6E: 'M6E=F',
  '6E': '6E=F',
};

/** The provider's ticker for a journal instrument, or null when it is not mapped. */
export function futuresQuoteSymbol(symbol: string): string | null {
  const key = (symbol || '').trim().toUpperCase();
  return FUTURES_QUOTE_SYMBOLS[key] ?? null;
}

/**
 * A live read of the contract the trader actually trades.
 *
 * The sector brief answers "what is the market doing"; this answers "where is the
 * instrument I am planning to trade right now". Every field is nullable because a
 * partial payload is still useful: a price with no day high is worth having, and the
 * UI says which parts are missing rather than pretending the number is not there.
 */
export interface InstrumentQuote {
  ok: boolean;
  /** The journal symbol, e.g. MES. */
  symbol: string;
  /** The provider's ticker, e.g. MES=F. Null when the symbol is not mapped. */
  yahooSymbol: string | null;
  price: number | null;
  previousClose: number | null;
  /** Same value as the sector quotes: percent versus the previous close. */
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fetchedAt: string;
  /** Why the read is missing, when it is, in trader-readable language. */
  note?: string;
}

/** How long a live instrument read is reused before refetching. */
const INSTRUMENT_CACHE_TTL_MS = 20_000;

interface InstrumentCacheEntry {
  quote: InstrumentQuote;
  expiresAt: number;
}

const instrumentCache = new Map<string, InstrumentCacheEntry>();

/** Test hook: clears the instrument cache between specs. */
export function resetInstrumentQuoteCache(): void {
  instrumentCache.clear();
}

function readNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One chart-meta fetch, tried against both hosts.
 *
 * Returns the raw `meta` rather than a shape of our own so the two callers here — the
 * sector brief, which only needs a percent change, and the instrument read, which needs
 * the day's range — can each take what they need from one request shape.
 */
async function fetchChartMeta(
  yahooSymbol: string
): Promise<{ ok: true; meta: Record<string, unknown> } | { ok: false }> {
  const path = `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=5m`;

  for (const host of YAHOO_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (journal coach)' },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const payload = (await res.json()) as {
        chart?: { result?: Array<{ meta?: Record<string, unknown> }> };
      };
      const meta = payload.chart?.result?.[0]?.meta;
      if (meta) return { ok: true, meta };
    } catch {
      // Try the next host; a failure here just means this one is unreachable.
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false };
}

/**
 * The live read of one instrument. Never throws: an unmapped symbol, a dead provider or
 * a malformed payload all degrade to `ok: false` with a reason, because every caller
 * (the coach prompt and the plan panel) must keep working without it.
 */
export async function getInstrumentQuote(symbol: string): Promise<InstrumentQuote> {
  const journalSymbol = (symbol || '').trim().toUpperCase();
  const yahooSymbol = futuresQuoteSymbol(journalSymbol);
  const now = Date.now();

  if (!journalSymbol) {
    return {
      ok: false,
      symbol: '',
      yahooSymbol: null,
      price: null,
      previousClose: null,
      changePercent: null,
      dayHigh: null,
      dayLow: null,
      volume: null,
      fetchedAt: new Date().toISOString(),
      note: 'No instrument was named, so no live read could be made.',
    };
  }

  const cached = instrumentCache.get(journalSymbol);
  if (cached && cached.expiresAt > now) return cached.quote;

  const base = {
    ok: false,
    symbol: journalSymbol,
    yahooSymbol,
    price: null,
    previousClose: null,
    changePercent: null,
    dayHigh: null,
    dayLow: null,
    volume: null,
    fetchedAt: new Date().toISOString(),
  } as const;

  if (!yahooSymbol) {
    const quote: InstrumentQuote = {
      ...base,
      note: `No live quote source is mapped for ${journalSymbol}, so no live read is available for it.`,
    };
    instrumentCache.set(journalSymbol, { quote, expiresAt: now + INSTRUMENT_CACHE_TTL_MS });
    return quote;
  }

  const attempt = await fetchChartMeta(yahooSymbol);
  if (!attempt.ok) {
    const quote: InstrumentQuote = {
      ...base,
      note: `Live data for ${journalSymbol} could not be loaded right now.`,
    };
    // Cached briefly even on failure, so a dead provider is not hammered for every
    // keystroke in the plan form.
    instrumentCache.set(journalSymbol, { quote, expiresAt: now + INSTRUMENT_CACHE_TTL_MS });
    return quote;
  }

  const meta = attempt.meta;
  const price = readNumber(meta, 'regularMarketPrice');
  const previousClose =
    readNumber(meta, 'chartPreviousClose') ?? readNumber(meta, 'previousClose');
  const directPercent = readNumber(meta, 'regularMarketChangePercent');
  const changePercent =
    directPercent ??
    (price !== null && previousClose ? ((price - previousClose) / previousClose) * 100 : null);

  const quote: InstrumentQuote = {
    ok: price !== null,
    symbol: journalSymbol,
    yahooSymbol,
    price,
    previousClose,
    changePercent: changePercent === null ? null : Math.round(changePercent * 100) / 100,
    dayHigh: readNumber(meta, 'regularMarketDayHigh'),
    dayLow: readNumber(meta, 'regularMarketDayLow'),
    volume: readNumber(meta, 'regularMarketVolume'),
    fetchedAt: new Date().toISOString(),
  };
  if (!quote.ok) {
    return {
      ...quote,
      note: `Live data for ${journalSymbol} came back without a price.`,
    };
  }
  instrumentCache.set(journalSymbol, { quote, expiresAt: now + INSTRUMENT_CACHE_TTL_MS });
  return quote;
}

const priceText = (n: number | null) =>
  n === null ? 'unknown' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Turns one instrument read into the factual block the coach quotes from.
 *
 * Numbers only, and the note saying which of them are missing, so the model can neither
 * misread an absent high as "none" nor round a level into something it was not given.
 */
export function formatInstrumentQuoteForPrompt(quote: InstrumentQuote): string {
  const lines: string[] = [];
  lines.push(`=== LIVE READ: ${quote.symbol} ===`);
  if (!quote.ok) {
    lines.push(`DATA STATUS: unavailable. ${quote.note ?? ''}`.trim());
    lines.push(
      'There is no live price for this instrument. Say so plainly and do not state, ' +
        'estimate or recall any price, level or direction for it; base your answer on ' +
        "the trader's own journal data alone."
    );
    return lines.join('\n');
  }

  lines.push(`Contract: ${quote.yahooSymbol ?? quote.symbol} (front month, live).`);
  lines.push(`Last price: ${priceText(quote.price)}.`);
  if (quote.previousClose !== null) {
    lines.push(`Previous settlement/close: ${priceText(quote.previousClose)}.`);
  }
  if (quote.changePercent !== null) {
    lines.push(`Change on the day: ${formatSignedPercent(quote.changePercent)}.`);
  }
  if (quote.dayLow !== null && quote.dayHigh !== null) {
    lines.push(`Day range so far: ${priceText(quote.dayLow)} to ${priceText(quote.dayHigh)}.`);
  } else if (quote.dayHigh !== null) {
    lines.push(`Day high so far: ${priceText(quote.dayHigh)} (day low not available).`);
  } else if (quote.dayLow !== null) {
    lines.push(`Day low so far: ${priceText(quote.dayLow)} (day high not available).`);
  } else {
    lines.push('Day range: not available in this read.');
  }
  if (quote.volume !== null) lines.push(`Volume so far: ${quote.volume}.`);

  const age = Date.now() - Date.parse(quote.fetchedAt);
  if (Number.isFinite(age) && age > STALE_AFTER_MS) {
    lines.push(
      `NOTE: this read is about ${Math.round(age / 60000)} minute(s) old. Say so, and treat the price as approximate.`
    );
  }
  lines.push(
    'These are the only prices you have. Every level you mention must be one of the numbers above.'
  );
  return lines.join('\n');
}

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

// ---------------------------------------------------------------------------
// Daily bars for the chart-opinion mode
//
// The chart itself is the provider's widget (visuals live on their infrastructure);
// the coach, however, needs the numbers behind what the trader is looking at, fetched
// server-side so the numbers it quotes are the numbers this app gave it — never ones
// recalled from training. One call, several daily bars, strictly numbers.
// ---------------------------------------------------------------------------

/** One recent daily bar, every field nullable because partial payloads are useful. */
export interface DailyBar {
  /** Session date (YYYY-MM-DD) in exchange terms. */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/** A short series of recent daily bars for one futures contract. */
export interface DailyBars {
  ok: boolean;
  symbol: string;
  /** The provider ticker the bars came from, e.g. MES=F. */
  yahooSymbol: string | null;
  bars: DailyBar[];
  fetchedAt: string;
  /** Why the series is missing or partial, in trader-readable language. */
  note?: string;
}

/**
 * The provider request for recent daily bars.
 *
 * `range=1mo` with `interval=1d` returns the last ~21 sessions: enough for the coach to
 * see the last few swings and the general level without the prompt ballooning.
 */
function dailyBarsPath(yahooSymbol: string): string {
  return `/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1mo&interval=1d`;
}

/** A finite number, or null — the same tolerance every quote read here applies. */
function readBarNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Recent daily bars for one futures contract, for the chart-opinion mode.
 *
 * Never throws: an unmapped symbol, a dead provider or a malformed payload degrade to
 * `ok: false` with a reason, and the chart guardrails make the model stand aside rather
 * than fill the gap from memory — the same contract the other reads here follow.
 */
export async function getDailyBars(symbol: string): Promise<DailyBars> {
  const journalSymbol = (symbol || '').trim().toUpperCase();
  const yahooSymbol = futuresQuoteSymbol(journalSymbol);
  const fetchedAt = new Date().toISOString();

  const empty: DailyBars = {
    ok: false,
    symbol: journalSymbol,
    yahooSymbol,
    bars: [],
    fetchedAt,
  };

  if (!journalSymbol) return { ...empty, note: 'No instrument was named.' };
  if (!yahooSymbol) {
    return {
      ...empty,
      note: `No live data source is mapped for ${journalSymbol}, so no chart read is available for it.`,
    };
  }

  const path = dailyBarsPath(yahooSymbol);
  for (const host of YAHOO_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (journal chart read)' },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const payload = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: Record<string, unknown>;
            timestamp?: number[];
            indicators?: {
              quote?: Array<{
                open?: (number | null)[];
                high?: (number | null)[];
                low?: (number | null)[];
                close?: (number | null)[];
                volume?: (number | null)[];
              }>;
            };
          }>;
        };
      };
      const result = payload.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const timestamps = result?.timestamp;
      if (!result || !timestamps || !quote) continue;

      const bars: DailyBar[] = [];
      for (let i = 0; i < timestamps.length; i += 1) {
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        const open = readBarNumber(quote.open?.[i]);
        const high = readBarNumber(quote.high?.[i]);
        const low = readBarNumber(quote.low?.[i]);
        const close = readBarNumber(quote.close?.[i]);
        // A bar with no close is not a session, it is a hole; skip it.
        if (close === null) continue;
        bars.push({ date, open, high, low, close, volume: readBarNumber(quote.volume?.[i]) });
      }

      if (bars.length === 0) continue;

      const series: DailyBars = {
        ok: true,
        symbol: journalSymbol,
        yahooSymbol,
        bars,
        fetchedAt,
      };
      return series;
    } catch {
      // Try the next host.
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ...empty,
    note: `Daily chart data for ${journalSymbol} could not be loaded right now.`,
  };
}

const price = (n: number | null) =>
  n === null
    ? 'n/a'
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Turns the daily series into the factual block the chart-opinion prompt quotes from.
 *
 * Numbers only, newest last (the order a chart reads in), with the series statistics —
 * ranges, average close, direction of the closes — computed here and labelled as
 * computed, so the model does arithmetic on exactly the numbers it was handed and no
 * others.
 */
export function formatDailyBarsForPrompt(bars: DailyBars): string {
  const lines: string[] = [];
  lines.push(`=== DAILY CHART DATA: ${bars.symbol} — recent daily bars, oldest first ===`);

  if (!bars.ok || bars.bars.length === 0) {
    lines.push(`DATA STATUS: unavailable. ${bars.note ?? ''}`.trim());
    lines.push(
      'There is no chart data for this instrument. Say so plainly, give no pattern read ' +
        'and no levels at all, and fall back to what the journal data alone supports.'
    );
    return lines.join('\n');
  }

  const closed = bars.bars.filter((b) => b.close !== null) as Array<DailyBar & { close: number }>;
  const highs = bars.bars.map((b) => b.high).filter((n): n is number => n !== null);
  const lows = bars.bars.map((b) => b.low).filter((n): n is number => n !== null);
  const periodHigh = highs.length ? Math.max(...highs) : null;
  const periodLow = lows.length ? Math.min(...lows) : null;
  const avgClose =
    closed.length > 0
      ? closed.reduce((sum, b) => sum + b.close, 0) / closed.length
      : null;

  lines.push(
    `Sessions in the series: ${bars.bars.length} daily bars ending ${bars.bars[bars.bars.length - 1].date}.`
  );
  lines.push('Every bar, as date: open / high / low / close (volume):');
  for (const bar of bars.bars) {
    lines.push(
      `- ${bar.date}: ${price(bar.open)} / ${price(bar.high)} / ${price(bar.low)} / ${price(bar.close)} (${bar.volume ?? 'n/a'})`
    );
  }

  if (periodHigh !== null && periodLow !== null) {
    lines.push(`Range of the series: low ${price(periodLow)} to high ${price(periodHigh)}.`);
  }
  if (avgClose !== null) {
    lines.push(`Average close of the series: ${price(Math.round(avgClose * 100) / 100)}.`);
  }
  if (closed.length >= 2) {
    const first = closed[0].close;
    const last = closed[closed.length - 1].close;
    const drift = last - first;
    lines.push(
      `Close moved from ${price(first)} to ${price(last)} across the series (${drift >= 0 ? '+' : ''}${price(Math.round(drift * 100) / 100)}).`
    );
    // Consecutive down closes at the tail — a factual count, not a forecast.
    let downStreak = 0;
    for (let i = closed.length - 1; i > 0; i -= 1) {
      if (closed[i].close < closed[i - 1].close) downStreak += 1;
      else break;
    }
    let upStreak = 0;
    for (let i = closed.length - 1; i > 0; i -= 1) {
      if (closed[i].close > closed[i - 1].close) upStreak += 1;
      else break;
    }
    if (downStreak >= 3) lines.push(`The last ${downStreak} sessions closed lower than the session before.`);
    if (upStreak >= 3) lines.push(`The last ${upStreak} sessions closed higher than the session before.`);
  }

  lines.push(
    'These are the only chart numbers you have. Every level you mention must be one of the numbers above; ' +
      'anything else (support, resistance, trendlines, patterns you were not given) would be invented.'
  );
  return lines.join('\n');
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
