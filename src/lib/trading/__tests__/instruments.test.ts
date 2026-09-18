import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSTRUMENTS,
  findInstrument,
  findInstrumentByContract,
  instrumentSymbol,
} from '../instruments';

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
    expect(findInstrument(DEFAULT_INSTRUMENTS, 'cl').symbol).toBe('MES');
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, 'cl')).toBe('CL');
  });

  it('falls back to the first instrument when no id is given', () => {
    expect(instrumentSymbol(DEFAULT_INSTRUMENTS, undefined)).toBe('MES');
  });
});

describe('findInstrumentByContract', () => {
  it('matches the full broker contract month code', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MESZ5')?.symbol).toBe('MES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'ESH4')?.symbol).toBe('ES');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MYMZ5')?.symbol).toBe('MYM');
  });

  it('prefers the longest matching symbol', () => {
    // MNQU6 must not be read as NQ, and MESZ5 must not be read as ES.
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MNQU6')?.symbol).toBe('MNQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'NQZ5')?.symbol).toBe('NQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'MESZ5')?.symbol).toBe('MES');
  });

  it('is case insensitive and returns undefined for unknown contracts', () => {
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'mnqu6')?.symbol).toBe('MNQ');
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, 'CLZ5')).toBeUndefined();
    expect(findInstrumentByContract(DEFAULT_INSTRUMENTS, '')).toBeUndefined();
  });
});
