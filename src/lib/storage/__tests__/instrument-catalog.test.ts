import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { storage } from '../index';
import { DEFAULT_INSTRUMENTS, INSTRUMENT_CATALOG_VERSION } from '../../trading/instruments';
import type { Instrument } from '../../../types';

/**
 * The instrument catalog has exactly the problem the setup catalog has: a stored list wins
 * over the defaults, so a contract added to `DEFAULT_INSTRUMENTS` in a release would only
 * ever appear on a journal that did not exist yet. Micro WTI is the contract that forced
 * this — the trader trades MCL and their journal predates it.
 *
 * The merge has to grow the catalog without ever overwriting what the trader has done to
 * it: not the contracts they added, not the prices they corrected on the built-ins, and
 * not resurrecting one they deliberately removed.
 *
 * Vitest runs in node, so a fake localStorage is installed before each test, the same
 * approach the storage-failure and setup-catalog tests use.
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

/**
 * Writes a journal that was created before the catalog was versioned.
 *
 * `since` is carried through deliberately: seeding a contract that already claims the
 * current version is how the "already arrived, do not offer it again" case is set up.
 */
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
  it('adds the contracts a stored journal is missing', () => {
    seedJournal([{ id: 'mes', symbol: 'MES' }], 1);

    const result = storage.ensureInstrumentCatalog();

    // Everything that arrived after this journal was created: micro WTI in one release,
    // then the rest of the index, metals and energy complexes in the next.
    expect(symbols(result)).toEqual(
      expect.arrayContaining(['MCL', 'CL', 'GC', 'MGC', 'SI', 'SIL', 'YM', 'M2K', 'RTY'])
    );
    expect(symbols(listInStorage())).toContain('MCL');
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(INSTRUMENT_CATALOG_VERSION);
  });

  it('adds only the newest release to a journal that already took the previous one', () => {
    // A journal that merged when micro WTI arrived: it has MCL, and must now receive the
    // release after it — once each, and without a second copy of the one it already has.
    seedJournal([{ id: 'mes', symbol: 'MES' }, { id: 'mcl', symbol: 'MCL' }], 2);

    const result = storage.ensureInstrumentCatalog();

    expect(symbols(result).filter((symbol) => symbol === 'MCL')).toHaveLength(1);
    expect(symbols(result)).toEqual(expect.arrayContaining(['CL', 'GC', 'RTY']));
  });

  it('keeps the contract the trader added themselves', () => {
    seedJournal([
      { id: 'mine', symbol: 'ZZZ', name: 'My own contract', pointValue: 3 },
      { id: 'mes', symbol: 'MES' },
    ], 1);

    const result = storage.ensureInstrumentCatalog();
    const mine = result.find((instrument) => instrument.symbol === 'ZZZ');

    expect(mine).toBeDefined();
    expect(mine?.id).toBe('mine');
    expect(mine?.pointValue).toBe(3);
  });

  it('does not overwrite a built-in the trader corrected', () => {
    // A trader who fixed MES's point value to match their broker's contract spec.
    seedJournal([{ id: 'mes', symbol: 'MES', pointValue: 50 }], 1);

    const result = storage.ensureInstrumentCatalog();

    expect(result.find((instrument) => instrument.symbol === 'MES')?.pointValue).toBe(50);
  });

  it('never doubles a contract that is already in the list', () => {
    seedJournal([{ id: 'mcl', symbol: 'MCL' }], 1);

    const result = storage.ensureInstrumentCatalog();

    expect(result.filter((instrument) => instrument.symbol === 'MCL')).toHaveLength(1);
  });

  it('gives micro WTI back to a journal whose marker had already passed it', () => {
    // The reported case: the marker says the catalog is current and MCL is missing, because
    // an earlier attempt announced it under a version the marker had already passed. Micro WTI
    // is announced again from a version this journal has not reached precisely so it receives
    // it, rather than the gap reading as a deliberate removal forever.
    seedJournal([{ id: 'mes', symbol: 'MES' }], 4);

    const result = storage.ensureInstrumentCatalog();

    expect(symbols(result)).toContain('MCL');
    expect(symbols(listInStorage())).toContain('MCL');
  });

  it('does not bring back a contract the version it arrived in already recorded', () => {
    // The marker says this journal has seen the catalog that MCL arrived in, so its absence
    // from the list is a decision — the trader removed it — not an oversight.
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
    // Nothing is written over a journal that simply had no instrument list: the defaults
    // are still the defaults, and the marker records that this device has seen them.
    expect(fake.getItem(INSTRUMENTS_KEY)).toBeNull();
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(INSTRUMENT_CATALOG_VERSION);
  });
});
