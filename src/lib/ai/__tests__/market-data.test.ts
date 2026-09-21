import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SECTOR_ETFS,
  getMarketBrief,
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
