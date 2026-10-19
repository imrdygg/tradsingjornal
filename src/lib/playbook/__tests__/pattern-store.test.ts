import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PATTERN_STUDIES_KEY,
  buildPatternExport,
  mergePatternStudies,
  normalisePatternStudies,
  parsePatternImport,
  readPatternStudies,
  savePatternStudy,
  upsertPatternStudy,
  writePatternStudies,
} from '../pattern-store';
import type { PatternStudy } from '../pattern-study-types';

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

let fake: FakeStorage;

beforeEach(() => {
  fake = new FakeStorage();
  installStorage(fake);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

function study(patternId: string, overrides: Partial<PatternStudy> = {}): PatternStudy {
  return {
    patternId,
    status: 'watching',
    checklist: [],
    notes: '',
    entries: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pattern studies slice', () => {
  it('reads an empty slice when nothing has been written', () => {
    expect(readPatternStudies()).toEqual([]);
  });

  it('round-trips a study through the journal key', () => {
    const saved = study('reversal-bearish-double-top', {
      status: 'confirmed',
      notes: 'August top on MES.',
      checklist: ['universal:0'],
    });
    expect(writePatternStudies([saved])).toBe(true);

    // The key is shared with the journal on purpose, so an export can move both ways.
    expect(fake.getItem(PATTERN_STUDIES_KEY)).toContain('reversal-bearish-double-top');
    expect(readPatternStudies()).toEqual([saved]);
  });

  it('upserts by pattern id and stamps updatedAt', () => {
    writePatternStudies([study('a', { notes: 'first' })]);

    const next = savePatternStudy(study('a', { notes: 'second' }));
    expect(next).toHaveLength(1);
    expect(next[0].notes).toBe('second');
    expect(next[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z');

    const added = savePatternStudy(study('b'));
    expect(added.map((row) => row.patternId)).toEqual(['a', 'b']);
  });

  it('keeps the first row position when an existing study is updated', () => {
    const next = upsertPatternStudy(
      [study('a'), study('b'), study('c')],
      study('b', { notes: 'updated' })
    );
    expect(next.map((row) => row.patternId)).toEqual(['a', 'b', 'c']);
    expect(next[1].notes).toBe('updated');
  });

  it('treats corrupt JSON as an empty slice rather than crashing', () => {
    fake.setItem(PATTERN_STUDIES_KEY, '{not json');
    expect(readPatternStudies()).toEqual([]);
  });

  it('normalises an older row and refuses one with no pattern id', () => {
    const normalised = normalisePatternStudies([
      { patternId: 'a', notes: 'kept' },
      { notes: 'no id' },
      { patternId: 'a', notes: 'later wins' },
    ]);

    expect(normalised).toEqual([
      {
        patternId: 'a',
        status: 'watching',
        checklist: [],
        notes: 'later wins',
        entries: [],
        updatedAt: new Date(0).toISOString(),
      },
    ]);
  });
});

describe('playbook import and export', () => {
  it('writes an envelope that names the product', () => {
    const json = buildPatternExport([study('a', { notes: 'x' })], '2026-02-01T00:00:00.000Z');
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.app).toBe('chart-pattern-playbook');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(parsed.studies).toHaveLength(1);
  });

  it('reads its own export back', () => {
    const imported = parsePatternImport(
      JSON.parse(buildPatternExport([study('a', { notes: 'x' })]))
    );
    expect(imported?.source).toBe('export');
    expect(imported?.studies[0].notes).toBe('x');
  });

  it("reads a full journal backup, so a bundle buyer's notes can move", () => {
    const imported = parsePatternImport({
      profile: { id: 'solo' },
      patternStudies: [study('a', { notes: 'from the journal' })],
    });
    expect(imported?.source).toBe('journal');
    expect(imported?.studies[0].notes).toBe('from the journal');
  });

  it('reads a bare array, which is what the storage key holds', () => {
    const imported = parsePatternImport([study('a')]);
    expect(imported?.source).toBe('list');
    expect(imported?.studies).toHaveLength(1);
  });

  it('rejects a JSON file that is not a playbook export', () => {
    expect(parsePatternImport({ trades: [] })).toBeNull();
    expect(parsePatternImport('nope')).toBeNull();
    expect(parsePatternImport(null)).toBeNull();
  });

  it('merges an import without dropping what is already here, imported rows winning', () => {
    const merged = mergePatternStudies(
      [study('a', { notes: 'local' }), study('b', { notes: 'untouched' })],
      [study('a', { notes: 'imported' }), study('c')]
    );

    expect(merged.map((row) => row.patternId)).toEqual(['a', 'b', 'c']);
    expect(merged[0].notes).toBe('imported');
    expect(merged[1].notes).toBe('untouched');
  });
});
