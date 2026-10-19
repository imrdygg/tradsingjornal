import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { storage } from '../index';
import { DEFAULT_INSTRUMENTS } from '../../trading/instruments';

/**
 * A buyer's first run must be empty.
 *
 * The product is sold as software someone connects to their own accounts, and the fastest way
 * to look untrustworthy — or to leak a previous owner's data — is to open on sample trades or
 * someone else's journal. The MES tracker's demo data is opt-in for that reason; this test
 * locks the rest of the first run to the same rule.
 *
 * Settings are the exception, and only in the sense of defaults: a profile, the built-in
 * futures catalog and the two built-in setups exist so the app has something to record against.
 * None of them is a record of a trade.
 */

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

beforeEach(() => {
  fake = new FakeStorage();
  (globalThis as unknown as { window: unknown }).window = { localStorage: fake };
  (globalThis as unknown as { localStorage: unknown }).localStorage = fake;
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('a fresh install', () => {
  it('has no trades, days, reviews or levels until the trader records one', () => {
    expect(storage.getTrades()).toEqual([]);
    expect(storage.getTradingDays()).toEqual([]);
    expect(storage.getReviews()).toEqual([]);
    expect(storage.getMarkedLevels()).toEqual([]);
    expect(storage.getMesLevels()).toEqual([]);
    expect(storage.getSessionExtremes()).toEqual([]);
    expect(storage.getPatternStudies()).toEqual([]);
    expect(storage.getCoachPlans()).toEqual([]);
  });

  it('has the full built-in catalog and the two built-in setups', () => {
    expect(storage.ensureInstrumentCatalog().map((instrument) => instrument.symbol)).toEqual(
      DEFAULT_INSTRUMENTS.map((instrument) => instrument.symbol)
    );
    expect(storage.ensureSetupCatalog().length).toBeGreaterThan(0);
  });

  it('creates one empty day when the app asks for today, not a sample day', () => {
    const day = storage.getOrCreateToday();

    expect(storage.getTradingDays()).toHaveLength(1);
    expect(storage.getTrades()).toEqual([]);
    // A real session record has a date and a status, but no trade was invented for it.
    expect(day.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not write demo levels until the trader asks for them', () => {
    storage.getOrCreateToday();
    expect(storage.getMesLevels()).toEqual([]);
  });
});
