import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSTRUMENTS,
  activeInstruments,
  defaultLevelZonePoints,
  findInstrument,
  findInstrumentByContract,
  formatLevelPrice,
  formatPoints,
  instrumentKind,
  instrumentSymbol,
  normalizeInstrument,
  sizeUnit,
} from '../instruments';

/**
 * A root that is genuinely absent from the catalog. It has to be something a trader would
 * plausibly name, or the unknown-instrument cases prove nothing: `NG` used to serve this
 * purpose until natural gas was added, and `TSLA` is the stock case now.
 */
const NOT_IN_THE_CATALOG = 'TSLA';

describe('instrumentSymbol', () => {
  it('resolves a stored instrument id to its display symbol', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'mes')).toBe('MES');
  });

  it('accepts a symbol as well as an id', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'MES')).toBe('MES');
  });

  it('never labels an unknown instrument as MES', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, NOT_IN_THE_CATALOG)).toBe('TSLA');
  });

  it('shows a dash rather than inventing a contract when no id is given', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, undefined)).toBe('—');
  });
});

describe('findInstrument', () => {
  it('prices an unknown symbol neutrally, never as MES', () => {
    const resolved = findInstrument(DEFAULT_INSTRUMENTS, NOT_IN_THE_CATALOG);

    expect(resolved.symbol).toBe('TSLA');
    expect(resolved.pointValue).toBe(1);
    expect(resolved.tickValue).toBe(0.01);
    expect(resolved.active).toBe(false);
    expect(resolved.pointValue).not.toBe(5);
  });
});

/**
 * Every figure in the journal — risk, R multiples, P&L — is derived from a contract's four
 * numbers, so a wrong one is quietly expensive rather than loudly broken. These are the
 * invariants that catch a bad entry, and the spot checks are the values a trader would
 * recognise well enough to object to.
 */
describe('the built-in catalog', () => {
  it('has a tick worth exactly its point value times its tick size', () => {
    for (const instrument of DEFAULT_INSTRUMENTS) {
      expect(
        `${instrument.symbol} ${instrument.pointValue * instrument.tickSize}`,
        `${instrument.symbol}'s tick value disagrees with its point value and tick size`
      ).toBe(`${instrument.symbol} ${instrument.tickValue}`);
    }
  });

  it('covers the futures complexes a trader actually records', () => {
    const symbols = DEFAULT_INSTRUMENTS.map((instrument) => instrument.symbol);

    for (const symbol of ['ES', 'MES', 'NQ', 'MNQ', 'YM', 'RTY', 'CL', 'MCL', 'NG', 'GC', 'MGC', 'SI', 'ZN', 'ZC', '6E', 'BTC']) {
      expect(symbols, `${symbol} is missing from the built-in catalog`).toContain(symbol);
    }
    expect(DEFAULT_INSTRUMENTS.length).toBeGreaterThanOrEqual(30);
  });

  it('matches the dollar figures a trader would check by hand', () => {
    const spec = (symbol: string) => findInstrument(DEFAULT_INSTRUMENTS, symbol);

    expect(spec('MES').pointValue).toBe(5);
    expect(spec('MES').tickValue).toBe(1.25);
    expect(spec('ES').pointValue).toBe(50);
    expect(spec('ES').tickValue).toBe(12.5);
    expect(spec('MNQ').pointValue).toBe(2);
    expect(spec('MNQ').tickValue).toBe(0.5);
    expect(spec('CL').pointValue).toBe(1000);
    expect(spec('CL').tickValue).toBe(10);
    expect(spec('GC').pointValue).toBe(100);
    expect(spec('GC').tickValue).toBe(10);
    expect(spec('ZN').pointValue).toBe(1000);
    expect(spec('ZN').tickValue).toBeCloseTo(15.625, 6);
    expect(spec('BTC').pointValue).toBe(5);
    expect(spec('BTC').tickValue).toBe(25);
  });

  it('marks every built-in as a futures contract', () => {
    for (const instrument of DEFAULT_INSTRUMENTS) {
      expect(instrumentKind(instrument)).toBe('future');
      expect(sizeUnit(instrument)).toBe('contracts');
    }
  });
});

describe('instrumentKind and sizeUnit', () => {
  it('reads a share-like instrument as a stock', () => {
    const stock = normalizeInstrument({
      id: 'aapl',
      symbol: 'AAPL',
      name: 'Apple',
      kind: 'stock',
      pointValue: 1,
      tickSize: 0.01,
      tickValue: 0,
      active: true,
    });

    expect(instrumentKind(stock)).toBe('stock');
    expect(sizeUnit(stock)).toBe('shares');
  });

  it('infers a stock for a stored record saved before kinds existed', () => {
    const legacy = {
      id: 'spy',
      symbol: 'SPY',
      name: 'SPY',
      pointValue: 1,
      tickSize: 0.01,
      tickValue: 0.01,
      active: true,
    };

    expect(instrumentKind(legacy)).toBe('stock');
  });
});

describe('activeInstruments', () => {
  it('moves the focus contract to the front without hiding the rest', () => {
    const list = activeInstruments(DEFAULT_INSTRUMENTS, 'NQ');

    expect(list[0].symbol).toBe('NQ');
    expect(list).toHaveLength(DEFAULT_INSTRUMENTS.length);
  });

  it('leaves out an instrument the trader turned off', () => {
    const list = activeInstruments(
      DEFAULT_INSTRUMENTS.map((instrument) =>
        instrument.symbol === 'SI' ? { ...instrument, active: false } : instrument
      )
    );

    expect(list.some((instrument) => instrument.symbol === 'SI')).toBe(false);
  });
});

describe('defaultLevelZonePoints', () => {
  const zone = (symbol: string) =>
    defaultLevelZonePoints(findInstrument(DEFAULT_INSTRUMENTS, symbol));

  it('derives the level width from the contract tick, not one figure for all', () => {
    // 4 points is sixteen ticks of MES. A contract trading in a smaller tick gets a narrower
    // band, which is what keeps one width from being copied onto a market it does not fit.
    expect(zone('MES')).toBe(4);
    expect(zone('ES')).toBe(4);
    expect(zone('CL')).toBe(0.16);
    expect(defaultLevelZonePoints({ ...DEFAULT_INSTRUMENTS[0], tickSize: 0.01 })).toBe(0.16);
  });

  it('falls back to four points when the instrument or its tick is unusable', () => {
    expect(defaultLevelZonePoints(undefined)).toBe(4);
    expect(defaultLevelZonePoints({ ...DEFAULT_INSTRUMENTS[0], tickSize: 0 })).toBe(4);
  });
});

describe('formatPoints', () => {
  it('trims trailing zeros so a band reads as prices do', () => {
    expect(formatPoints(7702.5)).toBe('7702.5');
    expect(formatPoints(7702.0)).toBe('7702');
  });
});

describe('formatLevelPrice', () => {
  it('keeps the trailing zero a stored number drops', () => {
    // Stored as numbers, a line entered at 80.80 and one at 89.30 come back as 80.8 and 89.3;
    // showing them that way reads as different prices. Two decimals restores them.
    expect(formatLevelPrice(80.8)).toBe('80.80');
    expect(formatLevelPrice(89.3)).toBe('89.30');
    expect(formatLevelPrice(88.88)).toBe('88.88');
  });

  it('shows a whole number at two decimals rather than none', () => {
    expect(formatLevelPrice(7700)).toBe('7700.00');
  });

  it('reports a dash for a price that is not a number', () => {
    expect(formatLevelPrice(Number.NaN)).toBe('—');
  });
});

describe('findInstrumentByContract', () => {
  it('matches the full broker contract month code', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MESZ5')?.symbol).toBe('MES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MESU6')?.symbol).toBe('MES');
  });

  it('resolves the other contracts a broker export can name', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MNQU6')?.symbol).toBe('MNQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MCLZ5')?.symbol).toBe('MCL');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'ESH4')?.symbol).toBe('ES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'GCZ5')?.symbol).toBe('GC');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'CLZ5')?.symbol).toBe('CL');
  });

  it('matches the longest root, so a micro is never read as its full-size contract', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MESZ5')?.symbol).toBe('MES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MNQZ5')?.symbol).toBe('MNQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'M2KZ5')?.symbol).toBe('M2K');
  });

  it('is case insensitive and returns undefined for a contract it does not hold', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'mesu6')?.symbol).toBe('MES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'ZZZU6')).toBeUndefined();
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, '')).toBeUndefined();
  });
});
