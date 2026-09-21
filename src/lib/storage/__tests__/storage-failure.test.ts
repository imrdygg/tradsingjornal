import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  storage,
  dismissStorageFailure,
  getStorageFailure,
  measureJournalBytes,
  subscribeToStorageFailure,
} from '../index';
import type { StorageFailure } from '../index';

// ---------------------------------------------------------------------------
// Vitest runs in the node environment, so a fake localStorage is installed on
// `window` before each test — the same approach the checkpoint cache tests use.
// The point of these tests is that a failed write is *reported*, not swallowed.
// ---------------------------------------------------------------------------

class FakeStorage {
  map = new Map<string, string>();
  /** Set by a test to simulate a full or blocked browser. */
  onSet: ((key: string, value: string) => void) | null = null;

  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.onSet?.(key, value);
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

/**
 * Installs the fake on both globals: the storage module guards on `window` and
 * then uses the bare `localStorage` identifier, which in node resolves against
 * globalThis rather than window.
 */
function installStorage(target: FakeStorage) {
  (globalThis as unknown as { window: unknown }).window = { localStorage: target };
  (globalThis as unknown as { localStorage: unknown }).localStorage = target;
}

function removeStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

/** A DOMException-shaped quota error, which is what Chrome actually throws. */
function quotaError(): Error {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
  dismissStorageFailure();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  dismissStorageFailure();
  removeStorage();
  vi.restoreAllMocks();
});

describe('storage failure reporting', () => {
  it('reports nothing while writes are succeeding', () => {
    storage.saveTrade({ id: 't1', tradingDayId: 'day-1' } as never);
    expect(getStorageFailure()).toBeNull();
  });

  it('names a full browser as a quota failure instead of a generic error', () => {
    fake.onSet = () => {
      throw quotaError();
    };

    storage.saveTrade({ id: 't1', tradingDayId: 'day-1' } as never);

    const failure = getStorageFailure();
    expect(failure?.kind).toBe('quota');
    expect(failure?.key).toBe('ptj_trades_v1');
  });

  it('reports blocked or private-mode storage separately from a full one', () => {
    const blocked = new Error('The operation is insecure.');
    blocked.name = 'SecurityError';
    fake.onSet = () => {
      throw blocked;
    };

    storage.updateProfile({ displayName: 'Blocked' });

    expect(getStorageFailure()?.kind).toBe('unavailable');
  });

  it('treats unreadable JSON as corruption, not as an empty journal', () => {
    fake.map.set('ptj_trades_v1', '{not json');

    expect(storage.getTrades()).toEqual([]);
    expect(getStorageFailure()?.kind).toBe('corrupt');
    expect(getStorageFailure()?.key).toBe('ptj_trades_v1');
  });

  it('notifies subscribers, and stops once they unsubscribe', () => {
    const seen: Array<StorageFailure | null> = [];
    const unsubscribe = subscribeToStorageFailure((failure) => seen.push(failure));

    fake.onSet = () => {
      throw quotaError();
    };
    storage.saveTrade({ id: 't1', tradingDayId: 'day-1' } as never);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('quota');

    dismissStorageFailure();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeNull();

    unsubscribe();
    fake.onSet = null;
    storage.saveTrade({ id: 't2', tradingDayId: 'day-1' } as never);
    expect(seen).toHaveLength(2);
  });

  it('keeps the warning until it is dismissed, so one lost write is never hidden', () => {
    fake.onSet = () => {
      throw quotaError();
    };
    storage.saveTrade({ id: 't1', tradingDayId: 'day-1' } as never);
    expect(getStorageFailure()?.kind).toBe('quota');

    // A later, smaller write that succeeds must not clear the report.
    fake.onSet = null;
    storage.saveTrade({ id: 't2', tradingDayId: 'day-1' } as never);
    expect(getStorageFailure()?.kind).toBe('quota');

    dismissStorageFailure();
    expect(getStorageFailure()).toBeNull();
  });

  it('does not throw out of a write when storage is missing entirely', () => {
    removeStorage();
    expect(() => storage.saveTrade({ id: 't1', tradingDayId: 'day-1' } as never)).not.toThrow();
    expect(getStorageFailure()).toBeNull();
  });
});

describe('measureJournalBytes', () => {
  it('grows as the journal grows, and ignores unrelated keys', () => {
    const empty = measureJournalBytes();

    storage.saveTrade({ id: 't1', tradingDayId: 'day-1', notes: 'x'.repeat(500) } as never);
    const withTrade = measureJournalBytes();

    fake.map.set('something-else', 'y'.repeat(5000));
    expect(measureJournalBytes()).toBe(withTrade);
    expect(withTrade).toBeGreaterThan(empty);
  });

  it('is safe to call when storage is unavailable', () => {
    removeStorage();
    expect(measureJournalBytes()).toBe(0);
  });
});
