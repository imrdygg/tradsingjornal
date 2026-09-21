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

describe('renameSetup', () => {
  it('renames in place and records the built-in it came from', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }, { id: 'b', name: 'Support' }], SETUP_CATALOG_VERSION);

    const result = storage.renameSetup('a', 'Body Swap');

    expect(names(result ?? [])).toEqual(['Body Swap', 'Support']);
    // The guide and the charts are keyed by the built-in name, so the link is what keeps a
    // renamed setup teaching the same material.
    expect(result?.find((setup) => setup.id === 'a')?.builtinName).toBe('Engulfing');
    expect(result?.find((setup) => setup.id === 'a')?.id).toBe('a');
    expect(names(namesInStorage())).toEqual(['Body Swap', 'Support']);
  });

  it('keeps the link through a second rename', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }], SETUP_CATALOG_VERSION);

    storage.renameSetup('a', 'Body Swap');
    const result = storage.renameSetup('a', 'Body Swap II');

    // Recorded from the name it answered to before the save, which at this point is the
    // link itself — not "Body Swap", which is nobody's built-in.
    expect(result?.[0].builtinName).toBe('Engulfing');
    expect(result?.[0].name).toBe('Body Swap II');
  });

  it('refuses an empty name and a name another setup already has', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }, { id: 'b', name: 'Support' }], SETUP_CATALOG_VERSION);

    expect(storage.renameSetup('a', '   ')).toBeNull();
    expect(storage.renameSetup('a', 'support')).toBeNull();
    expect(storage.renameSetup('nope', 'Anything')).toBeNull();

    // Nothing was written, so the journal still answers to the names it did before.
    expect(names(namesInStorage())).toEqual(['Engulfing', 'Support']);
  });

  it('trims the new name and treats a re-typed name as no change', () => {
    seedJournal([{ id: 'a', name: 'Engulfing' }], SETUP_CATALOG_VERSION);

    expect(names(storage.renameSetup('a', '  Body Swap  ') ?? [])).toEqual(['Body Swap']);
    const unchanged = storage.renameSetup('a', 'Body Swap');

    expect(names(unchanged ?? [])).toEqual(['Body Swap']);
    expect(names(namesInStorage())).toEqual(['Body Swap']);
  });

  it('links a setup typed by hand under a built-in’s name', () => {
    // Typed by hand rather than added by the catalog, and still offered the guide.
    const result = storage.saveSetup({
      id: 'mine',
      name: 'VWAP Reclaim',
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    });

    expect(result.find((setup) => setup.id === 'mine')?.builtinName).toBe('VWAP Reclaim');
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
    // A journal created before this release, which then renames 'Pin Bar' before it has
    // been through the merge — so the merge still runs and has to be told to leave it.
    seedJournal([{ id: 'pin', name: 'Pin Bar' }], 1);
    storage.renameSetup('pin', 'Wick Rejection');

    const result = storage.ensureSetupCatalog();

    // 'Pin Bar' is still taken by the renamed copy, so the release must not resurrect it —
    // the same rule that protects a deliberate delete.
    expect(names(result)).not.toContain('Pin Bar');
    expect(names(result)).toContain('Wick Rejection');
    // And the rename does not hold back the setups that same release does bring.
    for (const setup of DEFAULT_SETUPS.filter((entry) => (entry.since ?? 1) > 1)) {
      if (setup.name === 'Pin Bar') continue;
      expect(names(result)).toContain(setup.name);
    }
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
    seedJournal([{ id: 'a', name: 'Engulfing' }], SETUP_CATALOG_VERSION);
    seedJournalEntries(
      [
        { id: 't1', setupName: 'Engulfing' },
        { id: 't2', setupName: 'engulfing' },
        { id: 't3', setupName: 'Support' },
        { id: 't4' },
      ],
      [{ id: 'd1', watchedSetups: ['Engulfing', 'Support'] }, { id: 'd2', watchedSetups: ['Support'] }]
    );

    const result = storage.relabelSetupReferences('Engulfing', 'Body Swap');

    expect(result).toEqual({ trades: 2, days: 1 });
    expect(tradesInStorage().map((trade) => trade.setupName)).toEqual([
      'Body Swap',
      'Body Swap',
      'Support',
      undefined,
    ]);
    expect(daysInStorage()[0].watchedSetups).toEqual(['Body Swap', 'Support']);
    expect(daysInStorage()[1].watchedSetups).toEqual(['Support']);
  });

  it('counts the same references without changing anything', () => {
    seedJournalEntries(
      [{ id: 't1', setupName: 'Engulfing' }, { id: 't2' }],
      [{ id: 'd1', watchedSetups: ['Engulfing'] }]
    );

    expect(storage.countSetupReferences('engulfing')).toEqual({ trades: 1, days: 1 });
    expect(storage.countSetupReferences('Engulfing')).toEqual({ trades: 1, days: 1 });
    expect(storage.countSetupReferences('')).toEqual({ trades: 0, days: 0 });
    expect(tradesInStorage()[0].setupName).toBe('Engulfing');
  });

  it('does nothing when the names only differ by case', () => {
    seedJournalEntries([{ id: 't1', setupName: 'Engulfing' }], []);

    expect(storage.relabelSetupReferences('Engulfing', 'engulfing')).toEqual({ trades: 0, days: 0 });
    expect(tradesInStorage()[0].setupName).toBe('Engulfing');
  });
});
