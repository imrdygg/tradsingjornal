import { describe, expect, it } from 'vitest';
import { buildJournalDigest } from '../journal-digest';
import { formatDigestForPrompt } from '../coach-prompt';
import type { LevelRecord } from '../../mes/types';

/**
 * The AI coach must know about the MES indicator-level tracker: its record travels into the
 * digest, and the digest's own prompt section carries it with the shrunk strength and the
 * sample it rests on. This is the regression guard for that link.
 */

function mesRecord(overrides: Partial<LevelRecord> = {}): LevelRecord {
  return {
    id: overrides.id ?? 'm1',
    date: overrides.date ?? '2026-09-22',
    timeframe: overrides.timeframe ?? '30m',
    kind: overrides.kind ?? 'support',
    price: overrides.price ?? 5820,
    touches: overrides.touches ?? 0,
    holds: overrides.holds ?? 0,
    breaks: overrides.breaks ?? 0,
    setup: overrides.setup ?? '',
    hitTime: overrides.hitTime ?? '',
    breakTime: overrides.breakTime ?? '',
    breakDirection: overrides.breakDirection ?? '',
    notes: overrides.notes ?? '',
    createdAt: 0,
    updatedAt: 0,
  };
}

function digestWith(mesLevels?: LevelRecord[]) {
  return buildJournalDigest({
    trades: [],
    tradingDays: [],
    reviews: [],
    setups: [],
    instruments: [],
    todayTradeDate: '2026-09-22',
    timezone: 'America/New_York',
    mesLevels,
  });
}

describe('the coach digest carries the MES tracker', () => {
  it('reads the record back as reliability and a shrunk strength with its sample', () => {
    const digest = digestWith([
      mesRecord({ id: 'a', touches: 5, holds: 4, breaks: 1 }),
      mesRecord({ id: 'b', kind: 'resistance', touches: 3, holds: 1, breaks: 2, breakDirection: 'down' }),
    ]);
    expect(digest.mesRead.records).toBe(2);
    expect(digest.mesRead.sessions).toBe(1);
    expect(digest.mesRead.tested).toBe(2);
    expect(digest.mesRead.sampleSize).toBe(8); // 5 held + 3 broke
    // (5 + 2) / (8 + 4) * 100 = 58.3
    expect(digest.mesRead.strength).toBe(58.3);
    expect(digest.mesRead.grade).toBe('B');
    expect(digest.mesRead.byKind.length).toBeGreaterThan(0);
  });

  it('reads as empty, not as a zero rate, when nothing is logged', () => {
    const digest = digestWith(undefined);
    expect(digest.mesRead.records).toBe(0);
    expect(digest.mesRead.strength).toBeNull();
    expect(digest.mesRead.reliability).toBeNull();
    expect(digest.mesRead.grade).toBe('—');
  });
});

describe('the prompt explains the MES record to the model', () => {
  it('emits the section with the strength and its decisive-test count', () => {
    const text = formatDigestForPrompt(
      digestWith([
        mesRecord({ id: 'a', touches: 5, holds: 4, breaks: 1 }),
        mesRecord({ id: 'b', kind: 'resistance', touches: 3, holds: 1, breaks: 2 }),
      ])
    );
    expect(text).toContain('MES LEVELS');
    expect(text).toContain('58.3');
    expect(text).toContain('decisive test');
  });

  it('leaves the section out entirely when the tracker holds nothing', () => {
    expect(formatDigestForPrompt(digestWith(undefined))).not.toContain('MES LEVELS');
  });
});
