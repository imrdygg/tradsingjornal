import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { storage } from '../index';

// ---------------------------------------------------------------------------
// The copy a sync sets aside is the only thing standing between a resolved
// conflict and lost work, so it is worth proving the history behaves: newest
// first, capped, readable from the single-copy shape older builds wrote, and
// discardable one at a time.
// ---------------------------------------------------------------------------

const RECOVERY_KEY = 'ptj_recovery_v1';

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

/**
 * Installs the fake on both globals: the storage module guards on `window` and
 * then uses the bare `localStorage` identifier, which in node resolves against
 * globalThis rather than window.
 */
function installStorage(target: FakeStorage) {
  (globalThis as unknown as { window: unknown }).window = { localStorage: target };
  (globalThis as unknown as { localStorage: unknown }).localStorage = target;
}

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

/** A journal payload of a given size, so the oversized case can be reproduced. */
function journal(size = 10): string {
  return JSON.stringify({ trades: [{ id: 'trade-1', notes: 'x'.repeat(size) }] });
}

describe('recovery copies', () => {
  it('keeps the most recent copy first', () => {
    storage.saveRecoveryCopy(journal(1), 'first');
    storage.saveRecoveryCopy(journal(2), 'second');

    const copies = storage.getRecoveryCopies();
    expect(copies).toHaveLength(2);
    expect(copies[0].reason).toBe('second');
    expect(copies[1].reason).toBe('first');
    // The single-copy accessor still names the newest one.
    expect(storage.getRecoveryCopy()?.reason).toBe('second');
  });

  it('caps the history and drops the oldest copy first', () => {
    for (const reason of ['one', 'two', 'three', 'four']) {
      storage.saveRecoveryCopy(journal(1), reason);
    }

    const copies = storage.getRecoveryCopies();
    expect(copies.map((copy) => copy.reason)).toEqual(['four', 'three', 'two']);
  });

  it('reads the single-object shape an older build wrote', () => {
    fake.setItem(
      RECOVERY_KEY,
      JSON.stringify({
        json: journal(1),
        savedAt: '2026-09-19T13:05:00.000Z',
        reason: 'A save from this device replaced it while syncing.',
      })
    );

    const copies = storage.getRecoveryCopies();
    expect(copies).toHaveLength(1);
    expect(copies[0].reason).toContain('replaced it while syncing');
  });

  it('discards one copy without disturbing the others', () => {
    storage.saveRecoveryCopy(journal(1), 'older');
    storage.saveRecoveryCopy(journal(2), 'newer');

    const older = storage.getRecoveryCopies()[1];
    const remaining = storage.discardRecoveryCopy(older.id);

    expect(remaining.map((copy) => copy.reason)).toEqual(['newer']);
    expect(storage.getRecoveryCopies()).toHaveLength(1);
  });

  it('forgets every copy on clear', () => {
    storage.saveRecoveryCopy(journal(1), 'one');
    storage.saveRecoveryCopy(journal(2), 'two');

    storage.clearRecoveryCopy();

    expect(storage.getRecoveryCopies()).toEqual([]);
    expect(fake.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('skips a journal too large to hold twice', () => {
    const kept = storage.saveRecoveryCopy('x'.repeat(2_000_001), 'huge');

    expect(kept).toBe(false);
    expect(storage.getRecoveryCopies()).toEqual([]);
  });
});
