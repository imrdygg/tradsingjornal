import { describe, expect, it } from 'vitest';
import { buildJournalDigest } from '../journal-digest';
import { coachGuardrails, formatDigestForPrompt } from '../coach-prompt';
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

/**
 * A group figure is a statement about a bucket, and a read cannot point at one. The lines
 * underneath it travel with the read, each carrying its own counts, so the coach can say which
 * line it means instead of describing the trader's levels as a class.
 */
describe('the digest names the individual lines behind a rate', () => {
  it('leads with the lines that have the most decided tests behind them', () => {
    const digest = digestWith([
      mesRecord({ id: 'a', touches: 5, holds: 4, breaks: 1 }),
      mesRecord({ id: 'b', kind: 'resistance', price: 5860, touches: 3, holds: 1, breaks: 2 }),
    ]);

    const notable = digest.mesRead.notable ?? [];
    expect(notable).toHaveLength(2);
    expect(notable[0].label).toBe('30m support 5820.00');
    expect(notable[0].date).toBe('2026-09-22');
    expect(notable[0].holds).toBe(4);
    expect(notable[0].breaks).toBe(1);
    expect(notable[0].reliability).toBe(0.8);
    // (4 + 2) / (5 + 4) * 100
    expect(notable[0].strength).toBe(66.7);
    expect(notable[0].grade).toBe('B');
    expect(notable[1].label).toBe('30m resistance 5860.00');
  });

  it('leaves out a line price never reached, which has no figure to quote', () => {
    const digest = digestWith([
      mesRecord({ id: 'a', touches: 5, holds: 4, breaks: 1 }),
      mesRecord({ id: 'never', price: 5700 }),
    ]);

    const notable = digest.mesRead.notable ?? [];
    expect(notable).toHaveLength(1);
    expect(notable[0].price).toBe(5820);
    // The untouched line is still counted, just never named as if it had a rate.
    expect(digest.mesRead.records).toBe(2);
    expect(digest.mesRead.tested).toBe(1);
  });

  it('carries the trader’s own note and pattern tag beside the line', () => {
    const digest = digestWith([
      mesRecord({ id: 'a', setup: 'rejection', notes: 'overnight high', touches: 2, holds: 2 }),
    ]);

    expect(digest.mesRead.notable?.[0].setup).toBe('rejection');
    expect(digest.mesRead.notable?.[0].notes).toBe('overnight high');
  });

  it('emits the named lines and the rule to name one into the prompt', () => {
    const text = formatDigestForPrompt(
      digestWith([
        mesRecord({ id: 'a', touches: 5, holds: 4, breaks: 1, notes: 'overnight high' }),
        mesRecord({ id: 'b', kind: 'resistance', price: 5860, touches: 3, holds: 1, breaks: 2 }),
      ])
    );

    expect(text).toContain('Lines worth naming');
    expect(text).toContain('30m support 5820.00');
    expect(text).toContain('30m resistance 5860.00');
    expect(text).toContain('4 held');
    expect(text).toContain('their own note: "overnight high"');
  });
});

/**
 * The list of named lines only becomes a named read if the rules say so, which is why the naming
 * rule rides with the record rather than sitting in the section it applies to.
 */
describe('the guardrails tell the coach to name a line', () => {
  /**
   * `withMesLevels` is the twelfth and last of the flags — eleven falses before it — so the rest
   * of the modes are left off and only the tracker's own rules can appear in the result.
   */
  const guardrails = (withMesLevels: boolean) =>
    coachGuardrails(
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      withMesLevels
    );

  it('appends the naming rule whenever the tracker’s record is in the prompt', () => {
    const text = guardrails(true);
    expect(text).toContain('M6. NAME THE LINE');
    expect(text).toContain('chart, side and price');
    expect(text).toContain('never rank two named lines');
  });

  it('leaves the rule out when the tracker holds nothing', () => {
    expect(guardrails(false)).not.toContain('M6. NAME THE LINE');
  });
});
