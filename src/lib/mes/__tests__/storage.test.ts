import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MES_LEVELS_KEY,
  buildMesExport,
  normalizeMesRecords,
  parseMesImport,
  readMesLevels,
  writeMesLevels,
} from '../storage';
import type { LevelRecord } from '../types';

class FakeStorage {
  map = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
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

let fake: FakeStorage;

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

function level(overrides: Partial<LevelRecord> = {}): LevelRecord {
  return {
    id: 'lvl-1',
    date: '2026-10-16',
    timeframe: '5m',
    kind: 'support',
    price: 5823.25,
    touches: 3,
    holds: 2,
    breaks: 1,
    setup: 'rejection',
    hitTime: '09:35',
    breakTime: '11:05',
    breakDirection: 'down',
    notes: 'Held twice, broke on the third test.',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('MES storage slice', () => {
  it('reads an empty record when nothing is stored', () => {
    expect(readMesLevels()).toEqual([]);
  });

  it('round-trips through the journal key', () => {
    expect(writeMesLevels([level()])).toBe(true);
    expect(fake.getItem(MES_LEVELS_KEY)).toContain('5823.25');
    expect(readMesLevels()).toEqual([level()]);
  });

  it('drops a row with no usable date or price', () => {
    const kept = normalizeMesRecords([
      level(),
      level({ id: 'bad-date', date: '16/10/2026' }),
      level({ id: 'bad-price', price: 0 }),
      'not a record',
    ]);
    expect(kept.map((row) => row.id)).toEqual(['lvl-1']);
  });

  it('dedupes by id, last row winning', () => {
    const kept = normalizeMesRecords([
      level({ notes: 'first' }),
      level({ notes: 'second' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].notes).toBe('second');
  });

  it('treats corrupt JSON as an empty record rather than crashing', () => {
    fake.setItem(MES_LEVELS_KEY, '{not json');
    expect(readMesLevels()).toEqual([]);
  });

  it('reports a refused write instead of pretending it saved', () => {
    fake.failWrites = true;
    expect(writeMesLevels([level()])).toBe(false);
  });
});

describe('MES backup files', () => {
  it('writes the tracker envelope', () => {
    const parsed = JSON.parse(
      buildMesExport([level()], '2026-02-01T00:00:00.000Z')
    ) as Record<string, unknown>;

    expect(parsed.app).toBe('mes-level-tracker');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(parsed.records).toHaveLength(1);
  });

  it('reads its own backup back', () => {
    const imported = parseMesImport(JSON.parse(buildMesExport([level()])));
    expect(imported?.source).toBe('export');
    expect(imported?.records[0].id).toBe('lvl-1');
  });

  it('reads a bare array, which is what the storage key holds', () => {
    const imported = parseMesImport([level()]);
    expect(imported?.source).toBe('list');
    expect(imported?.records).toHaveLength(1);
  });

  it('reads a full journal backup, so a journal owner can move their levels in', () => {
    const imported = parseMesImport({ profile: { id: 'solo' }, mesLevels: [level()] });
    expect(imported?.source).toBe('journal');
    expect(imported?.records).toHaveLength(1);
  });

  it('refuses a JSON file that is not a level backup', () => {
    expect(parseMesImport({ trades: [] })).toBeNull();
    expect(parseMesImport('nope')).toBeNull();
    expect(parseMesImport(null)).toBeNull();
  });
});
