import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CHECKPOINTS,
  CachedCheckpointNote,
  checkpointWindowNote,
  clearCachedNotes,
  hourInTimezone,
  isNoteStale,
  journalFingerprint,
  noteKey,
  otherCheckpoint,
  readCachedNote,
  resolveCheckpoint,
  writeCachedNote,
} from '../checkpoints';
import { Trade, TradingDay, DailyReview } from '../../../types';

// ---------------------------------------------------------------------------
// A minimal localStorage so the cache can be exercised. Vitest runs in the node
// environment, where `window` does not exist, so the module correctly no-ops.
// ---------------------------------------------------------------------------

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

let storage: FakeStorage;

function installStorage() {
  storage = new FakeStorage();
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
}

beforeEach(installStorage);

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

function note(overrides: Partial<CachedCheckpointNote> = {}): CachedCheckpointNote {
  return {
    checkpoint: 'prep',
    date: '2026-09-18',
    generatedAt: '2026-09-18T12:00:00.000Z',
    fingerprint: 'fp-1',
    data: {
      headline: 'h',
      yesterdayLesson: 'l',
      howToApproach: 'a',
      watchOutFor: [],
      planGaps: [],
      motivation: 'm',
    },
    ...overrides,
  };
}

describe('hourInTimezone', () => {
  it('reads the hour in the requested timezone, not the host timezone', () => {
    // 13:00 UTC is 09:00 in New York during daylight saving.
    const at = new Date('2026-09-18T13:00:00.000Z');
    expect(hourInTimezone(at, 'America/New_York')).toBe(9);
    // The same instant is 15:00 in Berlin.
    expect(hourInTimezone(at, 'Europe/Berlin')).toBe(15);
  });

  it('normalises midnight to hour 0 rather than 24', () => {
    const midnightEt = new Date('2026-09-18T04:00:00.000Z');
    expect(hourInTimezone(midnightEt, 'America/New_York')).toBe(0);
  });

  it('falls back to the host clock instead of throwing on a bad timezone', () => {
    const at = new Date('2026-09-18T13:00:00.000Z');
    expect(() => hourInTimezone(at, 'Not/AZone')).not.toThrow();
    expect(hourInTimezone(at, 'Not/AZone')).toBe(at.getHours());
  });
});

describe('resolveCheckpoint', () => {
  const at = (etHour: number, etMinute = 0) => {
    // September in New York is UTC-4, so ET + 4h gives the UTC instant. Hours past
    // 20 roll into the next UTC day, which Date handles once the string is built.
    const utcHour = etHour + 4;
    const day = utcHour >= 24 ? 19 : 18;
    const hour = utcHour % 24;
    return new Date(
      `2026-09-${day}T${String(hour).padStart(2, '0')}:${String(etMinute).padStart(2, '0')}:00.000Z`
    );
  };

  it('selects prep from 08:00 through the trading day', () => {
    expect(resolveCheckpoint('America/New_York', at(8))).toBe('prep');
    expect(resolveCheckpoint('America/New_York', at(9))).toBe('prep');
    expect(resolveCheckpoint('America/New_York', at(13, 30))).toBe('prep');
  });

  it('includes the start of the prep window and excludes its end', () => {
    expect(resolveCheckpoint('America/New_York', at(8))).toBe('prep');
    expect(resolveCheckpoint('America/New_York', at(15, 59))).toBe('prep');
    expect(resolveCheckpoint('America/New_York', at(16))).toBe('postclose');
  });

  it('still offers the review in the hour before prep opens', () => {
    expect(resolveCheckpoint('America/New_York', at(7, 59))).toBe('postclose');
    expect(resolveCheckpoint('America/New_York', at(5))).toBe('postclose');
  });

  it('selects the review after the session and overnight', () => {
    expect(resolveCheckpoint('America/New_York', at(16, 30))).toBe('postclose');
    expect(resolveCheckpoint('America/New_York', at(23, 30))).toBe('postclose');
    expect(resolveCheckpoint('America/New_York', at(0))).toBe('postclose');
    expect(resolveCheckpoint('America/New_York', at(3, 59))).toBe('postclose');
  });
});

describe('checkpoint metadata', () => {
  it('switches to the other checkpoint and back', () => {
    expect(otherCheckpoint('prep')).toBe('postclose');
    expect(otherCheckpoint('postclose')).toBe('prep');
  });

  it('states both windows so they are never a mystery to the trader', () => {
    const text = checkpointWindowNote();
    expect(text).toContain('08:00–16:00');
    expect(text).toContain('16:00–08:00');
    expect(text).toContain('local time');
  });

  it('names each checkpoint the same way in the label and the schedule line', () => {
    const text = checkpointWindowNote();
    // Derived from the labels, so renaming a checkpoint cannot leave stale wording.
    expect(text).toContain(CHECKPOINTS.prep.label);
    expect(text).toContain(CHECKPOINTS.postclose.label.toLowerCase());
  });

  it('describes each checkpoint in its own terms', () => {
    expect(CHECKPOINTS.prep.label).toBe('Pre-session prep');
    expect(CHECKPOINTS.postclose.label).toBe('Post-session review');
    expect(CHECKPOINTS.prep.actionLabel).not.toBe(CHECKPOINTS.postclose.actionLabel);
  });

  it('does not imply a time of day, so the hours can change without misleading', () => {
    expect(CHECKPOINTS.prep.label).not.toMatch(/morning|evening|overnight/i);
    expect(CHECKPOINTS.postclose.label).not.toMatch(/morning|close/i);
  });
});

describe('journalFingerprint', () => {
  const trade = (overrides: Partial<Trade> = {}): Trade =>
    ({
      id: 't1',
      updatedAt: '2026-09-18T12:00:00.000Z',
      ...overrides,
    }) as Trade;
  const day = (overrides: Partial<TradingDay> = {}): TradingDay =>
    ({ id: 'd1', updatedAt: '2026-09-18T12:00:00.000Z', ...overrides }) as TradingDay;
  const review = (overrides: Partial<DailyReview> = {}): DailyReview =>
    ({ id: 'r1', updatedAt: '2026-09-18T12:00:00.000Z', ...overrides }) as DailyReview;

  it('is stable for the same journal state', () => {
    const input = { trades: [trade()], tradingDays: [day()], reviews: [review()] };
    expect(journalFingerprint(input)).toBe(journalFingerprint(input));
  });

  it('changes when a trade is added', () => {
    const before = journalFingerprint({ trades: [trade()], tradingDays: [], reviews: [] });
    const after = journalFingerprint({
      trades: [trade(), trade({ id: 't2' })],
      tradingDays: [],
      reviews: [],
    });
    expect(after).not.toBe(before);
  });

  it('changes when a trade is edited, without its count changing', () => {
    const before = journalFingerprint({ trades: [trade()], tradingDays: [], reviews: [] });
    const after = journalFingerprint({
      trades: [trade({ updatedAt: '2026-09-18T18:00:00.000Z' })],
      tradingDays: [],
      reviews: [],
    });
    expect(after).not.toBe(before);
  });
});

describe('checkpoint note cache', () => {
  it('round-trips a note', () => {
    writeCachedNote(note());
    expect(readCachedNote('2026-09-18', 'prep')?.data).toEqual(note().data);
  });

  it('keeps the checkpoints separate for the same day', () => {
    writeCachedNote(note({ checkpoint: 'prep', fingerprint: 'prep-fp' }));
    expect(readCachedNote('2026-09-18', 'postclose')).toBeNull();

    writeCachedNote(note({ checkpoint: 'postclose', fingerprint: 'close-fp' }));
    expect(readCachedNote('2026-09-18', 'prep')?.fingerprint).toBe('prep-fp');
    expect(readCachedNote('2026-09-18', 'postclose')?.fingerprint).toBe('close-fp');
  });

  it('keeps days separate', () => {
    writeCachedNote(note({ date: '2026-09-17' }));
    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();
    expect(readCachedNote('2026-09-17', 'prep')).not.toBeNull();
  });

  it('ignores an entry whose stored checkpoint does not match its key', () => {
    // Simulates a corrupted or hand-edited cache: a prep key holding a post-close note.
    storage.setItem(
      'ptj_coach_checkpoints_v1',
      JSON.stringify({
        version: 1,
        notes: { [noteKey('2026-09-18', 'prep')]: note({ checkpoint: 'postclose' }) },
      })
    );

    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();
  });

  it('returns null for an empty cache and for corrupt json', () => {
    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();

    storage.setItem('ptj_coach_checkpoints_v1', '{not json');
    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();

    storage.setItem('ptj_coach_checkpoints_v1', JSON.stringify({ version: 2, notes: {} }));
    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();
  });

  it('prunes the oldest notes so the cache cannot grow forever', () => {
    for (let i = 0; i < 30; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      writeCachedNote(
        note({ date: `2026-09-${day}`, generatedAt: `2026-09-${day}T12:00:00.000Z` })
      );
    }

    // The two oldest are dropped, the newest survive.
    expect(readCachedNote('2026-09-01', 'prep')).toBeNull();
    expect(readCachedNote('2026-09-02', 'prep')).toBeNull();
    expect(readCachedNote('2026-09-03', 'prep')).not.toBeNull();
    expect(readCachedNote('2026-09-30', 'prep')).not.toBeNull();
  });

  it('clears every note', () => {
    writeCachedNote(note());
    clearCachedNotes();
    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();
  });

  it('does not throw when storage is unavailable or full', () => {
    (globalThis as unknown as { window: unknown }).window = undefined;
    expect(() => writeCachedNote(note())).not.toThrow();
    expect(readCachedNote('2026-09-18', 'prep')).toBeNull();
    expect(() => clearCachedNotes()).not.toThrow();

    installStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => writeCachedNote(note())).not.toThrow();
  });
});

describe('isNoteStale', () => {
  it('is stale only when the journal changed since it was written', () => {
    expect(isNoteStale(note({ fingerprint: 'fp-1' }), 'fp-1')).toBe(false);
    expect(isNoteStale(note({ fingerprint: 'fp-1' }), 'fp-2')).toBe(true);
  });
});
