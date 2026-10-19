import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LICENSE_STORAGE_KEY,
  TRIAL_DAYS,
  clearLicenseKey,
  isValidLicenseKey,
  maskLicenseKey,
  normaliseLicenseKey,
  readLicenseState,
  saveLicenseKey,
  startTrial,
} from '../playbook-license';

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
}

function installStorage(target: FakeStorage) {
  (globalThis as unknown as { window: unknown }).window = { localStorage: target };
  (globalThis as unknown as { localStorage: unknown }).localStorage = target;
}

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-01-01T00:00:00.000Z');
const START_MS = START.getTime();

let fake: FakeStorage;

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('license key format', () => {
  it('accepts a Payhip-style key, case-insensitively and with stray spaces', () => {
    expect(isValidLicenseKey('WTKP4-66NL5-HMKQW-GFSCZ')).toBe(true);
    expect(isValidLicenseKey('  wtkp4-66nl5-hmkqw-gfscz  ')).toBe(true);
    expect(normaliseLicenseKey(' wtkp4 66nl5 ')).toBe('WTKP466NL5');
  });

  it('rejects an email, a short code and an empty paste', () => {
    expect(isValidLicenseKey('buyer@example.com')).toBe(false);
    expect(isValidLicenseKey('ABC-123')).toBe(false);
    expect(isValidLicenseKey('')).toBe(false);
  });

  it('stores a valid key and reports the device as licensed', () => {
    const state = saveLicenseKey('wtkp4-66nl5-hmkqw-gfscz', START);
    expect(state.status).toBe('licensed');
    expect(state.key).toBe('WTKP4-66NL5-HMKQW-GFSCZ');
    expect(readLicenseState(START_MS).status).toBe('licensed');
    expect(fake.getItem(LICENSE_STORAGE_KEY)).toContain('WTKP4-66NL5-HMKQW-GFSCZ');
  });

  it('throws on an invalid key and stores nothing', () => {
    expect(() => saveLicenseKey('nope', START)).toThrow(/license key/i);
    expect(fake.getItem(LICENSE_STORAGE_KEY)).toBeNull();
  });
});

describe('trial', () => {
  it('starts unlicensed when there is no key and no trial', () => {
    expect(readLicenseState(START_MS)).toEqual({ status: 'unlicensed' });
  });

  it(`gives ${TRIAL_DAYS} days and counts them down`, () => {
    startTrial(START);
    expect(readLicenseState(START_MS)).toMatchObject({ status: 'trial', daysLeft: 7 });
    expect(readLicenseState(START_MS + DAY)).toMatchObject({ status: 'trial', daysLeft: 6 });
    expect(readLicenseState(START_MS + 6.5 * DAY)).toMatchObject({
      status: 'trial',
      daysLeft: 1,
    });
  });

  it('ends the trial at the boundary and does not restart it', () => {
    startTrial(START);
    expect(readLicenseState(START_MS + TRIAL_DAYS * DAY)).toEqual({ status: 'unlicensed' });

    // Starting again on the same device must not hand out a second week.
    startTrial(new Date(START_MS + 10 * DAY));
    expect(readLicenseState(START_MS + 10 * DAY)).toEqual({ status: 'unlicensed' });
  });

  it('does not extend a trial that is already running', () => {
    startTrial(START);
    startTrial(new Date(START_MS + 2 * DAY));
    expect(readLicenseState(START_MS + 2 * DAY)).toMatchObject({
      status: 'trial',
      daysLeft: 5,
    });
  });

  it('leaves the trial alone when the key is removed', () => {
    startTrial(START);
    saveLicenseKey('WTKP4-66NL5-HMKQW-GFSCZ');
    expect(clearLicenseKey(START_MS).status).toBe('trial');
  });
});

describe('masking', () => {
  it('keeps the first and last group so a buyer can recognise the key', () => {
    expect(maskLicenseKey('WTKP4-66NL5-HMKQW-GFSCZ')).toBe('WTKP4-•••••-•••••-GFSCZ');
  });
});
