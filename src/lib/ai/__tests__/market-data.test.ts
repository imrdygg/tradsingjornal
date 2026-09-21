import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SECTOR_ETFS,
  futuresQuoteSymbol,
  getInstrumentQuote,
  getMarketBrief,
  formatInstrumentQuoteForPrompt,
  resetInstrumentQuoteCache,
  resetMarketCache,
  heatBand,
  formatSignedPercent,
  formatMarketBriefForPrompt,
  type MarketBrief,
  type SectorQuote,
} from '../market-data';

/**
 * The market brief is the one place the app touches live market data, so the failure
 * paths matter as much as the happy path: a dead provider must degrade to a usable
 * `ok: false` brief rather than an exception, because the plan lock preview must open
 * even when Yahoo is down.
 */

function yahooPayload(changePercent: number, price: number, prevClose: number): string {
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: {
            symbol: 'X',
            regularMarketPrice: price,
            regularMarketChangePercent: changePercent,
            chartPreviousClose: prevClose,
          },
        },
      ],
      error: null,
    },
  });
}

function installFetch(
  responder: (url: string) => { status: number; text: string } | Promise<{ status: number; text: string }>
) {
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
    const res = await responder(url);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => JSON.parse(res.text),
      text: async () => res.text,
    };
  };
}

const okJson = yahooPayload(0.82, 189.6, 188.06);

beforeEach(() => {
  resetMarketCache();
  resetInstrumentQuoteCache();
  vi.restoreAllMocks();
});

describe('SECTOR_ETFS', () => {
  it('tracks the 11 sector ETFs plus SPY', () => {
    expect(SECTOR_ETFS).toHaveLength(12);
    expect(SECTOR_ETFS[0].symbol).toBe('SPY');
    expect(new Set(SECTOR_ETFS.map((s) => s.symbol)).size).toBe(12);
  });
});

describe('heatBand', () => {
  it('bands the tile colours symmetrically around flat', () => {
    expect(heatBand(1.5)).toBe('up-strong');
    expect(heatBand(0.5)).toBe('up');
    expect(heatBand(0.05)).toBe('flat');
    expect(heatBand(-0.5)).toBe('down');
    expect(heatBand(-1.5)).toBe('down-strong');
    expect(heatBand(null)).toBe('unknown');
    expect(heatBand(Number.NaN)).toBe('unknown');
  });
});

describe('formatSignedPercent', () => {
  it('signs the number and em-dashes the unknowns', () => {
    expect(formatSignedPercent(1.2)).toBe('+1.20%');
    expect(formatSignedPercent(-0.4)).toBe('-0.40%');
    expect(formatSignedPercent(0)).toBe('0.00%');
    expect(formatSignedPercent(null)).toBe('—');
  });
});

describe('getMarketBrief', () => {
  it('returns a quote for every tracked symbol on the happy path', async () => {
    installFetch(() => ({ status: 200, text: okJson }));

    const brief = await getMarketBrief();
    expect(brief.ok).toBe(true);
    expect(brief.quotes).toHaveLength(12);
    expect(brief.quotes[0].changePercent).toBeCloseTo(0.82);
    expect(brief.note).toBeUndefined();
  });

  it('survives a provider outage: every failure still yields a usable brief', async () => {
    installFetch(() => ({ status: 503, text: 'unavailable' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const brief = await getMarketBrief();
    expect(brief.ok).toBe(false);
    expect(brief.quotes).toHaveLength(12);
    expect(brief.quotes.every((q) => q.changePercent === null)).toBe(true);
    expect(brief.note).toMatch(/could not be loaded/i);
  });

  it('keeps the symbols that answered when only some fail', async () => {
    let call = 0;
    installFetch(() => {
      call += 1;
      return call % 2 === 0
        ? { status: 500, text: 'boom' }
        : { status: 200, text: okJson };
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const brief = await getMarketBrief();
    expect(brief.ok).toBe(false);
    expect(brief.quotes.filter((q) => q.changePercent !== null).length).toBeGreaterThan(0);
    expect(brief.note).toMatch(/of 12 symbols could not be loaded/);
  });

  it('serves the second caller from the cache without refetching', async () => {
    let fetchCount = 0;
    installFetch(() => {
      fetchCount += 1;
      return { status: 200, text: okJson };
    });

    await getMarketBrief();
    const first = fetchCount;
    await getMarketBrief();
    expect(fetchCount).toBe(first);
  });

  it('computes the change from price and previous close when the percentage is missing', async () => {
    installFetch(() => ({
      status: 200,
      text: JSON.stringify({
        chart: {
          result: [{ meta: { regularMarketPrice: 105, chartPreviousClose: 100 } }],
          error: null,
        },
      }),
    }));

    const brief = await getMarketBrief();
    expect(brief.quotes[0].changePercent).toBeCloseTo(5);
  });
});

describe('formatMarketBriefForPrompt', () => {
  const quote = (symbol: string, label: string, changePercent: number | null): SectorQuote => ({
    symbol,
    label,
    changePercent,
    price: null,
    previousClose: null,
  });

  const brief: MarketBrief = {
    ok: true,
    fetchedAt: new Date().toISOString(),
    maxAgeSeconds: 60,
    quotes: [
      quote('SPY', 'S&P 500', 0.4),
      quote('XLK', 'Technology', 1.2),
      quote('XLE', 'Energy', -1.1),
      quote('XLF', 'Financials', -0.2),
    ],
  };

  it('quotes breadth, leaders and laggards as plain numbers', () => {
    const text = formatMarketBriefForPrompt(brief);
    expect(text).toContain("TODAY'S MARKET READ");
    expect(text).toContain('SPY (S&P 500 ETF): +0.40%');
    expect(text).toContain('Strongest: Technology +1.20%');
    expect(text).toContain('Weakest: Energy -1.10%');
    expect(text).toContain('Breadth: 2 of 4 sectors up, 2 down');
  });

  it('says plainly when the data could not be loaded', () => {
    const failed: MarketBrief = {
      ok: false,
      note: 'Market data could not be loaded right now.',
      fetchedAt: new Date().toISOString(),
      maxAgeSeconds: 60,
      quotes: [quote('SPY', 'S&P 500', null)],
    };
    const text = formatMarketBriefForPrompt(failed);
    expect(text).toContain('DATA STATUS: unavailable');
    expect(text).toContain('could not be loaded');
  });
});

describe('futuresQuoteSymbol', () => {
  it('maps the journal’s instrument names to the provider’s front-month contract', () => {
    expect(futuresQuoteSymbol('MES')).toBe('MES=F');
    expect(futuresQuoteSymbol('mnq')).toBe('MNQ=F');
    expect(futuresQuoteSymbol('  es  ')).toBe('ES=F');
  });

  it('refuses to guess a ticker it does not know', () => {
    // A wrong guess would put another market's price in front of the coach, so an
    // unmapped symbol has to fail rather than fall back to anything.
    expect(futuresQuoteSymbol('TSLA')).toBeNull();
    expect(futuresQuoteSymbol('')).toBeNull();
  });
});

describe('getInstrumentQuote', () => {
  function instrumentPayload(price: number, prevClose: number) {
    return JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              symbol: 'MES=F',
              regularMarketPrice: price,
              chartPreviousClose: prevClose,
              regularMarketDayHigh: price + 4,
              regularMarketDayLow: price - 10,
              regularMarketVolume: 58591,
            },
          },
        ],
        error: null,
      },
    });
  }

  it('returns the price, day range and change from the live read', async () => {
    installFetch(() => ({ status: 200, text: instrumentPayload(7740, 7712.5) }));

    const quote = await getInstrumentQuote('MES');
    expect(quote.ok).toBe(true);
    expect(quote.symbol).toBe('MES');
    expect(quote.yahooSymbol).toBe('MES=F');
    expect(quote.price).toBe(7740);
    expect(quote.dayHigh).toBe(7744);
    expect(quote.dayLow).toBe(7730);
    expect(quote.volume).toBe(58591);
    // (7740 - 7712.5) / 7712.5 * 100
    expect(quote.changePercent).toBeCloseTo(0.36, 1);
  });

  it('degrades to ok:false with a reason when the provider is down', async () => {
    installFetch(() => ({ status: 503, text: 'unavailable' }));

    const quote = await getInstrumentQuote('MES');
    expect(quote.ok).toBe(false);
    expect(quote.price).toBeNull();
    expect(quote.note).toMatch(/could not be loaded/i);
  });

  it('says so plainly when the symbol has no live source at all', async () => {
    const quote = await getInstrumentQuote('NOPE');
    expect(quote.ok).toBe(false);
    expect(quote.yahooSymbol).toBeNull();
    expect(quote.note).toMatch(/no live quote source/i);
  });

  it('serves a repeated read from the cache instead of refetching', async () => {
    let fetchCount = 0;
    installFetch(() => {
      fetchCount += 1;
      return { status: 200, text: instrumentPayload(7740, 7712.5) };
    });

    await getInstrumentQuote('MES');
    const first = fetchCount;
    await getInstrumentQuote('MES');
    expect(fetchCount).toBe(first);
  });
});

describe('formatInstrumentQuoteForPrompt', () => {
  it('hands the model only numbers it is allowed to quote', () => {
    const text = formatInstrumentQuoteForPrompt({
      ok: true,
      symbol: 'MES',
      yahooSymbol: 'MES=F',
      price: 7740,
      previousClose: 7712.5,
      changePercent: 0.36,
      dayHigh: 7744,
      dayLow: 7730,
      volume: 58591,
      fetchedAt: new Date().toISOString(),
    });

    expect(text).toContain('LIVE READ: MES');
    expect(text).toContain('7,740.00');
    expect(text).toContain('7,730.00 to 7,744.00');
    expect(text).toContain('+0.36%');
    expect(text).toContain('These are the only prices you have');
  });

  it('forbids a direction or level when the read failed', () => {
    const text = formatInstrumentQuoteForPrompt({
      ok: false,
      symbol: 'MES',
      yahooSymbol: 'MES=F',
      price: null,
      previousClose: null,
      changePercent: null,
      dayHigh: null,
      dayLow: null,
      volume: null,
      fetchedAt: new Date().toISOString(),
      note: 'Live data for MES could not be loaded right now.',
    });

    expect(text).toContain('DATA STATUS: unavailable');
    expect(text).toContain('do not state, estimate or recall any price');
  });
});
