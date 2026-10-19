import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MES_LICENSE, MES_LICENSE_STORAGE_KEY, MES_TRIAL_DAYS } from '../mes-license';
import { PLAYBOOK_LICENSE, LICENSE_STORAGE_KEY } from '../playbook-license';

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

const START = new Date('2026-01-01T00:00:00.000Z');
let fake: FakeStorage;

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('MES license', () => {
  it('uses its own storage keys and trial length', () => {
    expect(MES_LICENSE_STORAGE_KEY).toBe('ptj_mes_license_v1');
    expect(MES_LICENSE_STORAGE_KEY).not.toBe(LICENSE_STORAGE_KEY);
    expect(MES_TRIAL_DAYS).toBe(7);
  });

  it('activates with a Payhip-shaped key and remembers it', () => {
    const state = MES_LICENSE.saveKey('WTKP4-66NL5-HMKQW-GFSCZ', START);
    expect(state.status).toBe('licensed');
    expect(MES_LICENSE.readState().status).toBe('licensed');
    expect(fake.getItem(MES_LICENSE_STORAGE_KEY)).toContain('WTKP4-66NL5-HMKQW-GFSCZ');
  });

  it('keeps a trial per product, not shared with the playbook', () => {
    MES_LICENSE.startTrial(START);
    expect(MES_LICENSE.readState(START.getTime())).toMatchObject({
      status: 'trial',
      daysLeft: 7,
    });
    // Starting a playbook trial is a different device allowance and a different key.
    expect(PLAYBOOK_LICENSE.readState(START.getTime())).toEqual({ status: 'unlicensed' });
  });

  it("does not accept the playbook's activation", () => {
    PLAYBOOK_LICENSE.saveKey('WTKP4-66NL5-HMKQW-GFSCZ', START);
    expect(MES_LICENSE.readState(START.getTime())).toEqual({ status: 'unlicensed' });
  });
});
