import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { storage } from '../index';
import {
  DEFAULT_INSTRUMENTS,
  INSTRUMENT_CATALOG_VERSION,
  instrumentKind,
  findInstrument,
  instrumentProblem,
  normalizeInstrument,
  unknownInstrument,
} from '../../trading/instruments';
import type { Instrument } from '../../../types';

/**
 * The instrument catalog is now a starting list rather than a gate: the built-ins are the
 * liquid futures contracts, and the trader adds, edits or retires anything else.
 *
 * Two properties matter and are tested here: the read never deletes what the trader put in the
 * catalog, and it never re-adds a built-in the trader removed once the marker says that release
 * has already arrived. The third property is the one that used to be a lie — an unknown symbol
 * is priced neutrally, never as MES.
 *
 * Vitest runs in node, so a fake localStorage is installed before each test, the same approach
 * the storage-failure and setup-catalog tests use.
 */

/** The two keys involved, spelled out because the key map is private to storage. */
const INSTRUMENTS_KEY = 'ptj_instruments_v1';
const VERSION_KEY = 'ptj_instrument_catalog_v1';

class FakeStorage {
  map = new Map<string, string>();

  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.map.set(key, value);
  }

  removeItem(key: string) {
    this.map.delete(key);
  }

  get length() {
    return this.map.size;
  }

  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }

  clear() {
    this.map.clear();
  }
}

let fake: FakeStorage;

function installStorage(target: FakeStorage) {
  (globalThis as unknown as { window: unknown }).window = { localStorage: target };
  (globalThis as unknown as { localStorage: unknown }).localStorage = target;
}

function removeStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

/** Writes a journal that was created before this catalog version. */
function seedJournal(instruments: Array<Partial<Instrument> & { symbol: string }>, version?: number) {
  fake.setItem(
    INSTRUMENTS_KEY,
    JSON.stringify(
      instruments.map((instrument, index) => ({
        id: instrument.id ?? `inst-${index}`,
        symbol: instrument.symbol,
        name: instrument.name ?? instrument.symbol,
        pointValue: instrument.pointValue ?? 1,
        tickSize: instrument.tickSize ?? 0.01,
        tickValue: instrument.tickValue ?? 1,
        active: instrument.active ?? true,
        ...(instrument.kind === undefined ? {} : { kind: instrument.kind }),
        ...(instrument.since === undefined ? {} : { since: instrument.since }),
      }))
    )
  );
  if (version !== undefined) fake.setItem(VERSION_KEY, JSON.stringify(version));
}

const symbols = (list: Instrument[]) => list.map((instrument) => instrument.symbol);
const listInStorage = (): Instrument[] => JSON.parse(fake.getItem(INSTRUMENTS_KEY) ?? '[]');

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(removeStorage);

describe('ensureInstrumentCatalog', () => {
  it('brings the whole built-in futures catalog to an old MES-only journal', () => {
    seedJournal([{ id: 'mes', symbol: 'MES' }], 1);

    const result = storage.ensureInstrumentCatalog();

    // The contract it already had keeps its place, and every built-in arrives beside it.
    expect([...symbols(result)].sort()).toEqual([...symbols(DEFAULT_INSTRUMENTS)].sort());
    expect([...symbols(listInStorage())].sort()).toEqual([...symbols(DEFAULT_INSTRUMENTS)].sort());
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(INSTRUMENT_CATALOG_VERSION);
  });

  it('does not double a contract the journal already holds', () => {
    seedJournal([{ id: 'es', symbol: 'ES' }, { id: 'mes', symbol: 'MES' }], 1);

    const result = storage.ensureInstrumentCatalog();

    expect(result.filter((instrument) => instrument.symbol === 'ES')).toHaveLength(1);
    expect(result.filter((instrument) => instrument.symbol === 'MES')).toHaveLength(1);
  });

  it('keeps the contract the trader added themselves, spec and all', () => {
    seedJournal(
      [
        { id: 'mine', symbol: 'ZZZ', name: 'My own contract', pointValue: 3, tickSize: 0.5 },
        { id: 'mes', symbol: 'MES' },
      ],
      1
    );

    const result = storage.ensureInstrumentCatalog();
    const mine = result.find((instrument) => instrument.symbol === 'ZZZ');

    expect(mine).toBeDefined();
    expect(mine?.id).toBe('mine');
    expect(mine?.pointValue).toBe(3);
    expect(mine?.tickSize).toBe(0.5);
  });

  it('does not overwrite a built-in the trader corrected', () => {
    // A trader who fixed ES's point value to match their broker's contract spec.
    seedJournal([{ id: 'es', symbol: 'ES', pointValue: 55 }], 1);

    const result = storage.ensureInstrumentCatalog();

    expect(result.find((instrument) => instrument.symbol === 'ES')?.pointValue).toBe(55);
  });

  it('does not bring back a contract whose release the marker already recorded', () => {
    // The marker says this journal has seen the current catalog, so a missing built-in is the
    // trader's decision — they removed it — not an oversight.
    seedJournal([{ id: 'mes', symbol: 'MES' }], INSTRUMENT_CATALOG_VERSION);

    const result = storage.ensureInstrumentCatalog();

    expect(symbols(result)).toEqual(['MES']);
    expect(symbols(listInStorage())).toEqual(['MES']);
  });

  it('is idempotent, so a second read changes nothing', () => {
    seedJournal([{ id: 'mes', symbol: 'MES' }], 1);

    const first = storage.ensureInstrumentCatalog();
    const second = storage.ensureInstrumentCatalog();

    expect(symbols(second)).toEqual(symbols(first));
  });

  it('hands a journal with no stored list the defaults, and writes only the marker', () => {
    const result = storage.ensureInstrumentCatalog();

    expect(symbols(result)).toEqual(symbols(DEFAULT_INSTRUMENTS));
    expect(fake.getItem(INSTRUMENTS_KEY)).toBeNull();
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(INSTRUMENT_CATALOG_VERSION);
  });
});

describe('saveInstrument', () => {
  it('derives the tick value instead of trusting the typed one', () => {
    storage.saveInstrument({
      id: 'msft',
      symbol: 'msft',
      name: 'Microsoft',
      kind: 'stock',
      pointValue: 1,
      tickSize: 0.01,
      tickValue: 999,
      active: true,
    });
    const msft = storage.getInstruments().find((instrument) => instrument.id === 'msft');

    expect(msft?.symbol).toBe('MSFT');
    expect(msft?.tickValue).toBe(0.01);
    expect(instrumentKind(msft)).toBe('stock');
  });

  it('keeps the stored id when a symbol is edited, so history is not orphaned', () => {
    storage.saveInstrument({
      id: 'custom',
      symbol: 'ABC',
      name: 'First name',
      pointValue: 2,
      tickSize: 0.25,
      tickValue: 0.5,
      active: true,
    });

    const list = storage.saveInstrument({
      id: 'custom',
      symbol: 'XYZ',
      name: 'Renamed',
      pointValue: 2,
      tickSize: 0.25,
      tickValue: 0.5,
      active: true,
    });

    expect(list.filter((instrument) => instrument.id === 'custom')).toHaveLength(1);
    expect(list.find((instrument) => instrument.id === 'custom')?.symbol).toBe('XYZ');
  });
});

describe('deleteInstrument', () => {
  it('removes one and leaves the rest', () => {
    storage.saveInstrument({
      id: 'abc',
      symbol: 'ABC',
      name: 'Test',
      pointValue: 1,
      tickSize: 0.01,
      tickValue: 0.01,
      active: true,
    });

    const result = storage.deleteInstrument('abc');

    expect(result.some((instrument) => instrument.id === 'abc')).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });

  it('refuses to remove the last active instrument', () => {
    fake.setItem(
      INSTRUMENTS_KEY,
      JSON.stringify([
        { id: 'only', symbol: 'ONLY', name: 'Only', pointValue: 1, tickSize: 0.01, tickValue: 0.01, active: true },
      ])
    );

    const result = storage.deleteInstrument('only');

    expect(result.map((instrument) => instrument.id)).toEqual(['only']);
  });
});

describe('unknown symbols', () => {
  it('prices an unknown symbol neutrally rather than as MES', () => {
    const resolved = findInstrument(DEFAULT_INSTRUMENTS, 'TSLA');

    expect(resolved.symbol).toBe('TSLA');
    expect(resolved.pointValue).toBe(1);
    expect(resolved.active).toBe(false);
    expect(resolved).not.toEqual(DEFAULT_INSTRUMENTS.find((i) => i.symbol === 'MES'));
  });

  it('carries the asked-for symbol on the neutral fallback', () => {
    expect(unknownInstrument('abc').symbol).toBe('ABC');
  });
});

describe('instrumentProblem', () => {
  const base: Instrument = {
    id: 'test',
    symbol: 'TST',
    name: 'Test',
    pointValue: 5,
    tickSize: 0.25,
    tickValue: 1.25,
    active: true,
  };

  it('accepts a well-formed contract', () => {
    expect(instrumentProblem(base, [])).toBeNull();
  });

  it('rejects a duplicate symbol', () => {
    expect(instrumentProblem(base, [{ ...base, id: 'other' }])).toMatch(/already in the catalog/);
  });

  it('rejects a zero multiplier and a zero tick', () => {
    expect(instrumentProblem({ ...base, pointValue: 0 }, [])).toMatch(/per point/);
    expect(instrumentProblem({ ...base, tickSize: 0 }, [])).toMatch(/Tick size/);
  });

  it('normalises a draft into a well-formed instrument', () => {
    const clean = normalizeInstrument({ ...base, symbol: ' tst ', tickValue: 0 });

    expect(clean.symbol).toBe('TST');
    expect(clean.tickValue).toBe(1.25);
  });
});
