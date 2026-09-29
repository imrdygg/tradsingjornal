import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETUPS, SETUP_CATALOG_VERSION, storage } from '../index';
import type { Setup } from '../../../types';

/**
 * The catalog is Support and Resistance and nothing else, and these tests pin both halves
 * of what that means.
 *
 * A fresh journal gets exactly the two built-ins. A journal that already stored a list —
 * every journal that existed before the catalog was cut — keeps it untouched: the merge
 * that lets the catalog grow only ever appends setups tagged with a version newer than the
 * one the device has seen, and nothing in the current catalog is tagged that way. So a
 * built-in the trader removed stays removed, and one they never had is not forced back in.
 *
 * The rest of the file covers the management that grew around it — renaming a setup while
 * keeping its study guide, reordering the catalog, and rewriting the journal entries that
 * refer to an old name.
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
        ...(setup.builtinName === undefined ? {} : { builtinName: setup.builtinName }),
      }))
    )
  );
  if (version !== undefined) fake.setItem(VERSION_KEY, JSON.stringify(version));
}

const names = (list: Setup[]) => list.map((setup) => setup.name);
const namesInStorage = (): Setup[] => JSON.parse(fake.getItem(SETUPS_KEY) ?? '[]');

/**
 * A logged trade and a planned day, written as the two things the rename cares about.
 *
 * Spelled out this small on purpose: `relabelSetupReferences` reads `setupName` and
 * `watchedSetups` and nothing else, and a full Trade here would hide which field is
 * actually under test.
 */
const TRADES_KEY = 'ptj_trades_v1';
const DAYS_KEY = 'ptj_trading_days_v1';

interface SeedTrade {
  id: string;
  setupName?: string;
}

interface SeedDay {
  id: string;
  watchedSetups?: string[];
}

function seedJournalEntries(trades: SeedTrade[], days: SeedDay[]) {
  fake.setItem(TRADES_KEY, JSON.stringify(trades));
  fake.setItem(DAYS_KEY, JSON.stringify(days));
}

const tradesInStorage = (): SeedTrade[] => JSON.parse(fake.getItem(TRADES_KEY) ?? '[]');
const daysInStorage = (): SeedDay[] => JSON.parse(fake.getItem(DAYS_KEY) ?? '[]');

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  removeStorage();
});

describe('the built-in catalog', () => {
  it('is exactly Support and Resistance', () => {
    expect(names(DEFAULT_SETUPS)).toEqual(['Support', 'Resistance']);
    // Neither carries a version marker, so the merge below has nothing to append until a
    // future release tags one.
    expect(DEFAULT_SETUPS.filter((setup) => (setup.since ?? 1) > 1)).toEqual([]);
  });
});

describe('ensureSetupCatalog', () => {
  it('returns the two built-ins for a journal that has never stored a catalog', () => {
    const result = storage.ensureSetupCatalog();

    expect(names(result)).toEqual(['Support', 'Resistance']);
    // Nothing is written over a journal that simply had no setup list: the defaults are
    // still the defaults, and the marker records that this device has seen them.
    expect(fake.getItem(SETUPS_KEY)).toBeNull();
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(SETUP_CATALOG_VERSION);
  });

  it('leaves a stored journal exactly as it is', () => {
    // A journal from before the cut, still holding the pattern library it was shipped.
    // With nothing tagged as a later arrival, the merge is a no-op — the stored list wins.
    seedJournal([{ name: 'Engulfing' }], 1);

    const result = storage.ensureSetupCatalog();

    expect(names(result)).toEqual(['Engulfing']);
    expect(names(namesInStorage())).toEqual(['Engulfing']);
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
    // A journal that has already been through the upgrade deletes 'Support' afterwards.
    seedJournal([{ name: 'Engulfing' }], SETUP_CATALOG_VERSION);

    const result = storage.ensureSetupCatalog();

    expect(names(result)).toEqual(['Engulfing']);
    expect(names(namesInStorage())).toEqual(['Engulfing']);
    expect(fake.getItem(SETUPS_KEY)).toContain('Engulfing');
  });

  it('records the current version without touching a stored list', () => {
    seedJournal([{ name: 'Support' }]);

    const result = storage.ensureSetupCatalog();

    expect(names(result)).toEqual(['Support']);
    expect(JSON.parse(fake.getItem(VERSION_KEY) ?? '0')).toBe(SETUP_CATALOG_VERSION);
  });

  it('leaves the catalog alone on a second call', () => {
    seedJournal([{ name: 'Support' }], 1);

    const first = storage.ensureSetupCatalog();
    const second = storage.ensureSetupCatalog();

    expect(names(second)).toEqual(names(first));
  });
});

describe('renameSetup', () => {
  it('renames in place and records the built-in it came from', () => {
    seedJournal([{ id: 'a', name: 'Support' }, { id: 'b', name: 'Resistance' }], SETUP_CATALOG_VERSION);

    const result = storage.renameSetup('a', 'Prior Day Low');

    expect(names(result ?? [])).toEqual(['Prior Day Low', 'Resistance']);
    // The guide and the charts are keyed by the built-in name, so the link is what keeps a
    // renamed setup teaching the same material.
    expect(result?.find((setup) => setup.id === 'a')?.builtinName).toBe('Support');
    expect(result?.find((setup) => setup.id === 'a')?.id).toBe('a');
    expect(names(namesInStorage())).toEqual(['Prior Day Low', 'Resistance']);
  });

  it('keeps the link through a second rename', () => {
    seedJournal([{ id: 'a', name: 'Support' }], SETUP_CATALOG_VERSION);

    storage.renameSetup('a', 'Prior Day Low');
    const result = storage.renameSetup('a', 'Prior Day Low II');

    // Recorded from the name it answered to before the save, which at this point is the
    // link itself — not "Prior Day Low", which is nobody's built-in.
    expect(result?.[0].builtinName).toBe('Support');
    expect(result?.[0].name).toBe('Prior Day Low II');
  });

  it('refuses an empty name and a name another setup already has', () => {
    seedJournal([{ id: 'a', name: 'Support' }, { id: 'b', name: 'Resistance' }], SETUP_CATALOG_VERSION);

    expect(storage.renameSetup('a', '   ')).toBeNull();
    expect(storage.renameSetup('a', 'resistance')).toBeNull();
    expect(storage.renameSetup('nope', 'Anything')).toBeNull();

    // Nothing was written, so the journal still answers to the names it did before.
    expect(names(namesInStorage())).toEqual(['Support', 'Resistance']);
  });

  it('trims the new name and treats a re-typed name as no change', () => {
    seedJournal([{ id: 'a', name: 'Support' }], SETUP_CATALOG_VERSION);

    expect(names(storage.renameSetup('a', '  Prior Day Low  ') ?? [])).toEqual(['Prior Day Low']);
    const unchanged = storage.renameSetup('a', 'Prior Day Low');

    expect(names(unchanged ?? [])).toEqual(['Prior Day Low']);
    expect(names(namesInStorage())).toEqual(['Prior Day Low']);
  });

  it('links a setup typed by hand under a built-in’s name', () => {
    // Typed by hand rather than added by the catalog, and still offered the guide.
    const result = storage.saveSetup({
      id: 'mine',
      name: 'Resistance',
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    });

    expect(result.find((setup) => setup.id === 'mine')?.builtinName).toBe('Resistance');
  });

  it('invents no link for a name that is nobody’s built-in', () => {
    const result = storage.saveSetup({
      id: 'mine',
      name: 'London Sweep',
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    });

    expect(result.find((setup) => setup.id === 'mine')?.builtinName).toBeUndefined();
  });
});

describe('ensureSetupCatalog after a rename', () => {
  it('does not add the built-in back under its old name', () => {
    // A journal created before the cut, which then renames 'Support' before it has been
    // through the merge — so the merge still runs and has to leave it alone.
    seedJournal([{ id: 'sup', name: 'Support' }], 1);
    storage.renameSetup('sup', 'Shelf');

    const result = storage.ensureSetupCatalog();

    expect(names(result)).not.toContain('Support');
    expect(names(result)).toContain('Shelf');
  });
});

describe('reorderSetups', () => {
  it('applies the given order', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }, { id: 'b', name: 'Support' }, { id: 'c', name: 'Gap' }], SETUP_CATALOG_VERSION);

    const result = storage.reorderSetups(['c', 'a', 'b']);

    expect(names(result)).toEqual(['Gap', 'Engulfing', 'Support']);
    expect(names(namesInStorage())).toEqual(['Gap', 'Engulfing', 'Support']);
  });

  it('appends anything the caller left out instead of dropping it', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }, { id: 'b', name: 'Support' }, { id: 'c', name: 'Gap' }], SETUP_CATALOG_VERSION);

    // A caller working from a stale list must not be able to delete a setup by reordering.
    const result = storage.reorderSetups(['c']);

    expect(names(result)).toEqual(['Gap', 'Engulfing', 'Support']);
  });

  it('ignores ids it does not know', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }, { id: 'b', name: 'Support' }], SETUP_CATALOG_VERSION);

    expect(names(storage.reorderSetups(['b', 'ghost', 'a']))).toEqual(['Support', 'Engulfing']);
  });
});

describe('relabelSetupReferences', () => {
  it('moves logged trades and planned days onto the new name', () => {
    seedJournal([{ id: 'a', name: 'Support' }], SETUP_CATALOG_VERSION);
    seedJournalEntries(
      [
        { id: 't1', setupName: 'Support' },
        { id: 't2', setupName: 'support' },
        { id: 't3', setupName: 'Resistance' },
        { id: 't4' },
      ],
      [{ id: 'd1', watchedSetups: ['Support', 'Resistance'] }, { id: 'd2', watchedSetups: ['Resistance'] }]
    );

    const result = storage.relabelSetupReferences('Support', 'Prior Day Low');

    expect(result).toEqual({ trades: 2, days: 1 });
    expect(tradesInStorage().map((trade) => trade.setupName)).toEqual([
      'Prior Day Low',
      'Prior Day Low',
      'Resistance',
      undefined,
    ]);
    expect(daysInStorage()[0].watchedSetups).toEqual(['Prior Day Low', 'Resistance']);
    expect(daysInStorage()[1].watchedSetups).toEqual(['Resistance']);
  });

  it('counts the same references without changing anything', () => {
    seedJournalEntries(
      [{ id: 't1', setupName: 'Support' }, { id: 't2' }],
      [{ id: 'd1', watchedSetups: ['Support'] }]
    );

    expect(storage.countSetupReferences('support')).toEqual({ trades: 1, days: 1 });
    expect(storage.countSetupReferences('Support')).toEqual({ trades: 1, days: 1 });
    expect(storage.countSetupReferences('')).toEqual({ trades: 0, days: 0 });
    expect(tradesInStorage()[0].setupName).toBe('Support');
  });

  it('does nothing when the names only differ by case', () => {
    seedJournalEntries([{ id: 't1', setupName: 'Support' }], []);

    expect(storage.relabelSetupReferences('Support', 'support')).toEqual({ trades: 0, days: 0 });
    expect(tradesInStorage()[0].setupName).toBe('Support');
  });
});
