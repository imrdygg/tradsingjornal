import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSTRUMENTS,
  findInstrument,
  findInstrumentByContract,
  instrumentSymbol,
} from '../instruments';
import { futuresQuoteSymbol } from '../../ai/market-data';

/**
 * Natural gas: a contract a trader would plausibly name and this journal deliberately does
 * not record. The unknown-instrument cases below need a root that is genuinely absent from
 * the catalog — CL used to serve that purpose until full-size crude was added, at which
 * point the test would have started asserting the opposite of what it means.
 */
const NOT_IN_THE_CATALOG = 'ng';

describe('instrumentSymbol', () => {
  it('resolves a stored instrument id to its display symbol', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'mes')).toBe('MES');
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'mnq')).toBe('MNQ');
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'es')).toBe('ES');
  });

  it('accepts a symbol as well as an id', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'MNQ')).toBe('MNQ');
  });

  it('never falls back to MES for an unknown instrument', () => {
    // findInstrument would say MES here, which would mislabel the trade.
    expect(findInstrument(DEFAULT_INSTRUMENTS, NOT_IN_THE_CATALOG).symbol).toBe('MES');
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, NOT_IN_THE_CATALOG)).toBe('NG');
  });

  it('falls back to the first instrument when no id is given', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, undefined)).toBe('MES');
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

  it('holds exactly the three contracts this journal is for', () => {
    expect(DEFAULT_INSTRUMENTS.map((instrument) => instrument.symbol)).toEqual([
      'MES',
      'MNQ',
      'MCL',
    ]);
  });

  it('matches the dollar figures a trader would check by hand', () => {
    const pointValue = (symbol: string) => findInstrument(DEFAULT_INSTRUMENTS, symbol).pointValue;

    expect(pointValue('MES')).toBe(5);
    expect(pointValue('MNQ')).toBe(2);
    expect(pointValue('MCL')).toBe(100);
  });

  it('can quote every contract it records, so no instrument silently has no live read', () => {
    // The live read fails loudly on an unmapped symbol, but loudly is still a dead end for
    // the trader: an instrument in the catalog with no quote source would mean a plan or an
    // entry call about it could never see the market.
    for (const instrument of DEFAULT_INSTRUMENTS) {
      expect(
        futuresQuoteSymbol(instrument.symbol),
        `${instrument.symbol} is in the catalog but has no live-quote source`
      ).not.toBeNull();
    }
  });
});

describe('findInstrumentByContract', () => {
  it('matches the full broker contract month code', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MESZ5')?.symbol).toBe('MES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MNQU6')?.symbol).toBe('MNQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MCLZ5')?.symbol).toBe('MCL');
  });

  it('does not resolve a contract the journal no longer records', () => {
    // ES, GC, CL and the rest were retired, so a broker export naming one must not be read
    // as some other instrument just because its root is a prefix of a tracked symbol.
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'ESH4')).toBeUndefined();
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'GCZ5')).toBeUndefined();
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'CLZ5')).toBeUndefined();
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MCLZ5')?.symbol).toBe('MCL');
  });

  it('is case insensitive and returns undefined for unknown contracts', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'mnqu6')?.symbol).toBe('MNQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'NGZ5')).toBeUndefined();
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, '')).toBeUndefined();
  });
});
