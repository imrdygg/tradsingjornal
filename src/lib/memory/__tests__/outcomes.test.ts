import { describe, expect, it } from 'vitest';
import {
  MEMORY_MIN_OUTCOME_SAMPLE,
  MEMORY_OUTCOME_WINDOWS,
  formatMemoryRate,
  summarizeMemoryOutcomes,
  type MemoryOutcomeSample,
} from '../outcomes';

/**
 * The arithmetic behind the evidence sentence.
 *
 * Every test here is really about a denominator. The feature's whole claim is that it reports
 * what actually happened over the cases it actually found, so a rate whose bottom half is wrong
 * — or a rate shown at all when the sample is three cases — is the one thing that would make the
 * numbers less trustworthy than no numbers.
 */

function continuation(id: string): MemoryOutcomeSample {
  return { observationId: id, marketOutcome: 'continuation' };
}

describe('summarizeMemoryOutcomes', () => {
  it('reports the documented example: 12 cases, 8 continuations, 3 reversals, 1 unknown', () => {
    const samples: MemoryOutcomeSample[] = [
      ...Array.from({ length: 8 }, (_, i) => continuation(`cont-${i}`)),
      ...Array.from({ length: 3 }, (_, i) => ({
        observationId: `rev-${i}`,
        marketOutcome: 'reversal' as const,
      })),
      { observationId: 'unknown-1', marketOutcome: 'unknown' },
    ];

    const summary = summarizeMemoryOutcomes(samples);

    expect(summary.matched).toBe(12);
    expect(summary.continuations).toBe(8);
    expect(summary.reversals).toBe(3);
    expect(summary.marketUnknown).toBe(1);
    expect(summary.marketKnown).toBe(11);
    // 8 / 11 decided, not 8 / 12 matched: the unknown case is not evidence of anything.
    expect(summary.marketDecided).toBe(11);
    expect(summary.continuationRate).toBe(72.7);
  });

  it('never counts an unknown case as a reversal', () => {
    const summary = summarizeMemoryOutcomes([
      continuation('a'),
      { observationId: 'b', marketOutcome: 'unknown' },
    ]);
    expect(summary.reversals).toBe(0);
    expect(summary.marketUnknown).toBe(1);
    expect(summary.marketDecided).toBe(1);
  });

  it('leaves "unclear" out of the continuation rate but still counts it as known', () => {
    const samples: MemoryOutcomeSample[] = [
      ...Array.from({ length: 5 }, (_, i) => continuation(`c-${i}`)),
      ...Array.from({ length: 2 }, (_, i) => ({
        observationId: `r-${i}`,
        marketOutcome: 'reversal' as const,
      })),
      { observationId: 'unclear-1', marketOutcome: 'unclear' },
    ];

    const summary = summarizeMemoryOutcomes(samples);
    expect(summary.unclear).toBe(1);
    expect(summary.marketKnown).toBe(8);
    // 5 / 7, because a reading nobody could classify is not a reversal.
    expect(summary.marketDecided).toBe(7);
    expect(summary.continuationRate).toBe(71.4);
  });

  it('withholds a rate rather than reporting one from too few cases', () => {
    const summary = summarizeMemoryOutcomes([continuation('a'), continuation('b')]);
    expect(summary.continuationRate).toBeNull();
    expect(summary.continuations).toBe(2);
    expect(summary.marketDecided).toBe(2);
    expect(summary.warnings.join(' ')).toContain(`A rate needs ${MEMORY_MIN_OUTCOME_SAMPLE}`);
  });

  it('starts reporting a rate exactly at the sample floor', () => {
    const atFloor = Array.from({ length: MEMORY_MIN_OUTCOME_SAMPLE }, (_, i) => continuation(`c-${i}`));
    expect(summarizeMemoryOutcomes(atFloor).continuationRate).toBe(100);
    expect(summarizeMemoryOutcomes(atFloor.slice(0, -1)).continuationRate).toBeNull();
  });

  it('keeps market behaviour and trade execution as separate numbers', () => {
    // The case the whole split exists for: the market continued every time, and the trader's
    // own trades still lost money. Both facts are true and neither may be averaged into one.
    const samples: MemoryOutcomeSample[] = Array.from({ length: 6 }, (_, i) => ({
      observationId: `o-${i}`,
      marketOutcome: i < 5 ? ('continuation' as const) : ('reversal' as const),
      tradeResult: i < 4 ? ('loss' as const) : ('win' as const),
    }));

    const summary = summarizeMemoryOutcomes(samples);
    expect(summary.continuationRate).toBe(83.3);
    expect(summary.winRate).toBe(33.3);
    expect(summary.continuations).toBe(5);
    expect(summary.losses).toBe(4);
  });

  it('excludes scratches and open trades from the win rate', () => {
    const samples: MemoryOutcomeSample[] = [
      { observationId: 'a', marketOutcome: 'continuation', tradeResult: 'win' },
      { observationId: 'b', marketOutcome: 'continuation', tradeResult: 'win' },
      { observationId: 'c', marketOutcome: 'reversal', tradeResult: 'win' },
      { observationId: 'd', marketOutcome: 'reversal', tradeResult: 'win' },
      { observationId: 'e', marketOutcome: 'continuation', tradeResult: 'win' },
      { observationId: 'f', marketOutcome: 'continuation', tradeResult: 'breakeven' },
      { observationId: 'g', marketOutcome: 'unknown', tradeResult: 'open' },
    ];

    const summary = summarizeMemoryOutcomes(samples);
    expect(summary.traded).toBe(7);
    expect(summary.wins).toBe(5);
    expect(summary.breakeven).toBe(1);
    expect(summary.openTrades).toBe(1);
    // 5 wins / 5 decided trades. A scratch is not a win, and an open trade has no result yet.
    expect(summary.winRate).toBe(100);
    expect(summary.warnings.join(' ')).toContain('still open');
  });

  it('says when the window contains no execution record at all', () => {
    const summary = summarizeMemoryOutcomes([continuation('a'), continuation('b')]);
    expect(summary.traded).toBe(0);
    expect(summary.winRate).toBeNull();
    expect(summary.warnings.join(' ')).toContain('None of these setups was traded');
  });

  it('reports an empty match set as no evidence rather than as a zero', () => {
    const summary = summarizeMemoryOutcomes([]);
    expect(summary.matched).toBe(0);
    expect(summary.continuationRate).toBeNull();
    expect(summary.winRate).toBeNull();
    expect(summary.warnings).toEqual(['Nothing matched, so there is no evidence to read at all.']);
  });

  it('reflects the sample floor it was given', () => {
    const samples = [continuation('a'), continuation('b'), continuation('c')];
    expect(summarizeMemoryOutcomes(samples).continuationRate).toBeNull();
    expect(summarizeMemoryOutcomes(samples, { minSample: 3 }).continuationRate).toBe(100);
  });

  it('counts a re-read of the same samples identically', () => {
    const samples: MemoryOutcomeSample[] = [
      continuation('a'),
      { observationId: 'b', marketOutcome: 'reversal', tradeResult: 'loss' },
      { observationId: 'c', marketOutcome: 'unclear', tradeResult: 'breakeven' },
      { observationId: 'd', marketOutcome: 'unknown' },
      { observationId: 'e', marketOutcome: 'continuation', tradeResult: 'win' },
      { observationId: 'f', marketOutcome: 'continuation', tradeResult: 'win' },
    ];
    expect(summarizeMemoryOutcomes(samples)).toEqual(summarizeMemoryOutcomes(samples));
  });
});

describe('formatMemoryRate', () => {
  it('never renders a withheld rate as a percentage', () => {
    expect(formatMemoryRate(null)).toBe('not enough cases');
    expect(formatMemoryRate(0)).toBe('0%');
    expect(formatMemoryRate(72.7)).toBe('72.7%');
  });
});

describe('MEMORY_OUTCOME_WINDOWS', () => {
  it('offers horizons that group comparable cases together', () => {
    expect(MEMORY_OUTCOME_WINDOWS.length).toBeGreaterThan(0);
    expect(MEMORY_OUTCOME_WINDOWS).toContain('30 minutes after the open');
  });
});
