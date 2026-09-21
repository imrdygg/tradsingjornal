import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETUPS, SETUP_CATALOG_VERSION, storage } from '../index';
import type { Setup } from '../../../types';

/**
 * The catalog merge is the only thing standing between a new built-in setup and a journal
 * that already exists: a stored setup list wins over the defaults, so without it the new
 * setups would only ever appear on a fresh install.
 *
 * It has to grow the catalog without ever overwriting what the trader has done to it —
 * renaming nothing, deleting nothing, and above all not resurrecting a built-in they
 * deliberately removed.
 *
 * Vitest runs in node, so a fake localStorage is installed before each test, the same
 * approach the storage-failure tests use.
 */

/** The two keys involved, spelled out because the key map is private to storage. */
const SETUPS_KEY = 'ptj_setups_v1';
const VERSION_KEY = 'ptj_setup_catalog_v1';

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

/** Writes a journal that was created before the catalog was versioned. */
function seedJournal(setups: Array<Partial<Setup> & { name: string }>, version?: number) {
  fake.setItem(
    SETUPS_KEY,
    JSON.stringify(
      setups.map((setup, index) => ({
        id: setup.id ?? `setup-${index}`,
        name: setup.name,
        active: setup.active ?? true,
        createdAt: '2026-01-01T00:00:00Z',
        ...(setup.since === undefined ? {} : { since: setup.since }),
      }))
    )
  );
  if (version !== undefined) fake.setItem(VERSION_KEY, JSON.stringify(version));
}

const names = (list: Setup[]) => list.map((setup) => setup.name);
const namesInStorage = (): Setup[] => JSON.parse(fake.getItem(SETUPS_KEY) ?? '[]');

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  removeStorage();
});

describe('ensureSetupCatalog', () => {
  it('adds the built-ins a stored journal is missing', () => {
    seedJournal([{ name: 'Engulfing' }], 1);

    const result = storage.ensureSetupCatalog();

    // The setups that arrived after this journal was created, and only those. An old
    // built-in it simply never had is not forced back in — the trader may have removed it
    // before this release, and the version marker cannot tell those apart.
    const arrivals = DEFAULT_SETUPS.filter((setup) => (setup.since ?? 1) > 1);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const setup of arrivals) {
      expect(names(result)).toContain(setup.name);
    }
    expect(result).toHaveLength(1 + arrivals.length);
    expect(names(result)).not.toContain('Support');
    // The merge is persisted, so the app does not have to redo it on every read.
    expect(names(namesInStorage())).toContain('Pin Bar');
  });

  it('leaves the trader’s own setups untouched', () => {
    seedJournal([{ name: 'Engulfing' }, { id: 'mine', name: 'London Sweep', active: false }], 1);

    const result = storage.ensureSetupCatalog();
    const mine = result.find((setup) => setup.name === 'London Sweep');

    expect(mine).toBeDefined();
    expect(mine?.id).toBe('mine');
    // Their own "off" stays off: the merge only ever appends.
    expect(mine?.active).toBe(false);
  });

  it('never resurrects a built-in that was deleted on purpose', () => {
    // A journal that has already been through the upgrade deletes 'Pin Bar' afterwards.
    seedJournal([{ name: 'Engulfing' }], SETUP_CATALOG_VERSION);

    const result = storage.ensureSetupCatalog();

    expect(names(result)).toEqual(['Engulfing']);
    expect(names(namesInStorage())).toEqual(['Engulfing']);
    expect(fake.getItem(SETUPS_KEY)).toContain('Engulfing');
  });

  it('does not add a second copy when the name is already there in another case', () => {
    seedJournal([{ name: 'pin bar' }], 1);

    const result = storage.ensureSetupCatalog();
    const matching = result.filter((setup) => setup.name.trim().toLowerCase() === 'pin bar');

    expect(matching).toHaveLength(1);
    expect(matching[0].name).toBe('pin bar');
  });

  it('leaves the catalog alone on a second call', () => {
    seedJournal([{ name: 'Engulfing' }], 1);

    const first = storage.ensureSetupCatalog();
    const second = storage.ensureSetupCatalog();

    expect(names(second)).toEqual(names(first));
  });

  it('returns the full defaults for a journal that has never stored a catalog', () => {
    const result = storage.ensureSetupCatalog();

    expect(names(result)).toEqual(names(DEFAULT_SETUPS));
    // Nothing is written over a journal that simply had no setup list: the defaults are
    // still the defaults, and the marker records that this device has seen them.
    expect(fake.getItem(SETUPS_KEY)).toBeNull();
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(SETUP_CATALOG_VERSION);
  });

  it('treats a missing marker as the oldest version, so those journals still upgrade', () => {
    seedJournal([{ name: 'Engulfing' }]);

    const result = storage.ensureSetupCatalog();

    expect(names(result)).toContain('Breaker Block');
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(SETUP_CATALOG_VERSION);
  });
});
