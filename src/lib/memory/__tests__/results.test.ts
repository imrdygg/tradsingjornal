import { describe, expect, it } from 'vitest';
import {
  buildMemoryEvidence,
  marketOutcomeSample,
  tradeResultSample,
  type MemoryMatchedCase,
} from '../results';
import type { MemoryImage, Trade, TradingObservation } from '../../../types';

/**
 * The evidence assembly.
 *
 * These tests exist to pin down the one thing the feature can get wrong and still look right: a
 * number that quietly blends what the market did with what the trader did, or a missing value
 * that gets counted as a real one. Both produce a panel that reads perfectly and means nothing.
 */

const NOW = '2026-03-01T14:00:00.000Z';

function makeImage(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: 'img-1',
    observationId: 'obs-1',
    role: 'before-setup',
    indexStatus: 'completed',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'user-1',
    observedAt: NOW,
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    images: [makeImage()],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    userId: 'user-1',
    tradingDayId: 'day-1',
    instrumentId: 'mes',
    source: 'manual',
    direction: 'long',
    contracts: 1,
    entryPrice: 5000,
    initialStop: 4995,
    entryTime: NOW,
    session: 'Regular Session',
    initialRisk: 25,
    grossPnL: 0,
    pointsPnL: 0,
    rMultiple: 0,
    status: 'closed',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCase(overrides: Partial<MemoryMatchedCase> = {}): MemoryMatchedCase {
  return {
    observation: makeObservation(),
    resemblance: 80,
    ...overrides,
  };
}

describe('marketOutcomeSample', () => {
  it('reports an absent outcome as unknown rather than inferring one', () => {
    expect(marketOutcomeSample(undefined)).toBe('unknown');
  });

  it('refuses to read a continuation off a record that is still marked unknown', () => {
    // A freshly seen setup carries `status: 'unknown'` and may well already have a guess typed
    // into `continuation`. The status is what says whether it is a reading.
    expect(
      marketOutcomeSample({
        status: 'unknown',
        continuation: 'continuation',
        source: 'trader-recorded',
      })
    ).toBe('unknown');
  });

  it('treats a record with no continuation named as unknown, not as a reversal', () => {
    expect(marketOutcomeSample({ status: 'recorded', source: 'trader-recorded' })).toBe('unknown');
  });

  it('maps each recorded continuation through unchanged', () => {
    expect(marketOutcomeSample({ status: 'recorded', continuation: 'continuation', source: 'trader-recorded' })).toBe(
      'continuation'
    );
    expect(marketOutcomeSample({ status: 'recorded', continuation: 'reversal', source: 'trader-recorded' })).toBe(
      'reversal'
    );
    expect(marketOutcomeSample({ status: 'recorded', continuation: 'unclear', source: 'trader-recorded' })).toBe(
      'unclear'
    );
  });
});

describe('tradeResultSample', () => {
  it('reports no trade as no result, which is not the same as a scratch', () => {
    expect(tradeResultSample(undefined)).toBeUndefined();
  });

  it('reports an open trade as open, never as a win or a loss', () => {
    expect(tradeResultSample(makeTrade({ status: 'open', grossPnL: 500, netPnL: 480 }))).toBe('open');
  });

  it('reads a closed trade off its stored result', () => {
    expect(tradeResultSample(makeTrade({ status: 'closed', netPnL: 120 }))).toBe('win');
    expect(tradeResultSample(makeTrade({ status: 'closed', netPnL: -80 }))).toBe('loss');
  });

  it('counts exactly zero as a scratch', () => {
    expect(tradeResultSample(makeTrade({ status: 'closed', netPnL: 0 }))).toBe('breakeven');
  });

  it('prefers net over gross, because fees are part of what was kept', () => {
    // A trade that looks like a winner before fees is a loser after them.
    expect(tradeResultSample(makeTrade({ status: 'closed', grossPnL: 100, netPnL: -50 }))).toBe('loss');
  });

  it('falls back to gross when net was never recorded', () => {
    expect(tradeResultSample(makeTrade({ status: 'closed', grossPnL: 60, netPnL: undefined }))).toBe('win');
  });

  it('reports an unreadable figure as absent rather than as break-even', () => {
    expect(tradeResultSample(makeTrade({ status: 'closed', grossPnL: Number.NaN }))).toBeUndefined();
    expect(tradeResultSample(makeTrade({ status: 'closed', netPnL: Number.NaN, grossPnL: 10 }))).toBeUndefined();
  });
});

describe('buildMemoryEvidence', () => {
  it('reports an empty match set as nothing to read', () => {
    const evidence = buildMemoryEvidence([]);
    expect(evidence.counts.matched).toBe(0);
    expect(evidence.summary.continuationRate).toBeNull();
    expect(evidence.summary.winRate).toBeNull();
    expect(evidence.warnings.join(' ')).toContain('nothing to read yet');
  });

  it('shows a continuation rate and a win rate that disagree', () => {
    // The case the whole split exists for: price continued every single time, and the trader lost
    // money on every single one of them.
    const cases: MemoryMatchedCase[] = Array.from({ length: 5 }, (_, i) =>
      makeCase({
        observation: makeObservation({
          id: `obs-${i}`,
          outcome: { status: 'recorded', continuation: 'continuation', source: 'trader-recorded' },
        }),
        trade: makeTrade({ id: `trade-${i}`, netPnL: -50 }),
      })
    );

    const evidence = buildMemoryEvidence(cases);

    expect(evidence.summary.continuationRate).toBe(100);
    expect(evidence.summary.winRate).toBe(0);
    expect(evidence.summary.continuations).toBe(5);
    expect(evidence.summary.losses).toBe(5);
    // Both are true at once and neither is derivable from the other.
    expect(evidence.summary.continuationRate).not.toBe(evidence.summary.winRate);
  });

  it('keeps an open trade out of both the wins and the losses', () => {
    const evidence = buildMemoryEvidence([
      makeCase({
        observation: makeObservation({
          outcome: { status: 'recorded', continuation: 'continuation', source: 'trader-recorded' },
        }),
        trade: makeTrade({ status: 'open', netPnL: 900 }),
      }),
    ]);

    expect(evidence.summary.traded).toBe(1);
    expect(evidence.summary.openTrades).toBe(1);
    expect(evidence.summary.wins).toBe(0);
    expect(evidence.summary.losses).toBe(0);
    expect(evidence.summary.winRate).toBeNull();
    expect(evidence.warnings.join(' ')).toContain('still open');
  });

  it('keeps a scratch out of the win rate rather than counting it as a win', () => {
    const cases: MemoryMatchedCase[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeCase({
          observation: makeObservation({ id: `win-${i}` }),
          trade: makeTrade({ id: `win-trade-${i}`, netPnL: 100 }),
        })
      ),
      makeCase({
        observation: makeObservation({ id: 'scratch' }),
        trade: makeTrade({ id: 'scratch-trade', netPnL: 0 }),
      }),
    ];

    const evidence = buildMemoryEvidence(cases);

    expect(evidence.summary.traded).toBe(6);
    expect(evidence.summary.wins).toBe(5);
    expect(evidence.summary.breakeven).toBe(1);
    // 5 of 5 decided, not 5 of 6 and not 6 of 6.
    expect(evidence.summary.winRate).toBe(100);
  });

  it('does not count an unknown outcome as a case with a recorded outcome', () => {
    const evidence = buildMemoryEvidence([
      makeCase({
        observation: makeObservation({
          id: 'recorded',
          outcome: { status: 'recorded', continuation: 'reversal', source: 'trader-recorded' },
        }),
      }),
      makeCase({
        observation: makeObservation({
          id: 'still-unknown',
          outcome: { status: 'unknown', continuation: 'reversal', source: 'trader-recorded' },
        }),
      }),
      makeCase({ observation: makeObservation({ id: 'none' }) }),
    ]);

    expect(evidence.counts.matched).toBe(3);
    expect(evidence.counts.withRecordedOutcome).toBe(1);
    expect(evidence.counts.withoutRecordedOutcome).toBe(2);
    // The guess on the still-unknown record never reaches the counts.
    expect(evidence.summary.reversals).toBe(1);
    expect(evidence.summary.marketUnknown).toBe(2);
  });

  it('counts a case as indexed only when one of its pictures finished indexing', () => {
    const evidence = buildMemoryEvidence([
      makeCase({ observation: makeObservation({ id: 'a', images: [makeImage()] }) }),
      makeCase({
        observation: makeObservation({
          id: 'b',
          images: [makeImage({ indexStatus: 'pending' }), makeImage({ id: 'img-2', indexStatus: 'failed' })],
        }),
      }),
      makeCase({ observation: makeObservation({ id: 'c', images: [] }) }),
      makeCase({
        observation: makeObservation({
          id: 'd',
          // One post-decision picture that indexed does not make the case searchable, but the
          // count here is about indexing, and the role filter is enforced at search time.
          images: [makeImage({ role: 'after-setup', indexStatus: 'completed' })],
        }),
      }),
    ]);

    expect(evidence.counts.indexed).toBe(2);
    expect(evidence.counts.notIndexed).toBe(2);
  });

  it('links a trade to its own case rather than to the set', () => {
    const cases: MemoryMatchedCase[] = [
      makeCase({
        observation: makeObservation({
          id: 'continued',
          outcome: { status: 'recorded', continuation: 'continuation', source: 'trader-recorded' },
        }),
        trade: makeTrade({ netPnL: -40 }),
      }),
      makeCase({
        observation: makeObservation({
          id: 'reversed',
          outcome: { status: 'recorded', continuation: 'reversal', source: 'trader-recorded' },
        }),
        trade: makeTrade({ netPnL: 70 }),
      }),
    ];

    const evidence = buildMemoryEvidence(cases);
    expect(evidence.summary.continuations).toBe(1);
    expect(evidence.summary.reversals).toBe(1);
    expect(evidence.summary.wins).toBe(1);
    expect(evidence.summary.losses).toBe(1);
  });

  it('counts a linked trade even when its own result cannot be read', () => {
    const evidence = buildMemoryEvidence([
      makeCase({ trade: makeTrade({ status: 'closed', grossPnL: Number.NaN, netPnL: undefined }) }),
    ]);

    // The link exists, so the record has a trade in it; the result does not, so no rate is built
    // from it. Counting the one as the other is how an empty column starts looking complete.
    expect(evidence.counts.withTrade).toBe(1);
    expect(evidence.summary.traded).toBe(0);
  });

  it('passes through every warning the outcome summary produced', () => {
    const evidence = buildMemoryEvidence([
      makeCase({
        observation: makeObservation({
          outcome: { status: 'recorded', continuation: 'continuation', source: 'trader-recorded' },
        }),
      }),
      makeCase({
        observation: makeObservation({
          id: 'obs-2',
          outcome: { status: 'recorded', continuation: 'continuation', source: 'trader-recorded' },
        }),
      }),
    ]);

    expect(evidence.summary.continuationRate).toBeNull();
    for (const warning of evidence.summary.warnings) {
      expect(evidence.warnings).toContain(warning);
    }
    expect(evidence.warnings.length).toBeGreaterThanOrEqual(evidence.summary.warnings.length);
  });

  it('says when nothing in the set was ever traded', () => {
    const evidence = buildMemoryEvidence([makeCase(), makeCase({ observation: makeObservation({ id: 'obs-2' }) })]);
    expect(evidence.counts.withTrade).toBe(0);
    expect(evidence.warnings.join(' ')).toContain('empty by construction');
  });

  it('says when nothing in the set has an outcome recorded', () => {
    const evidence = buildMemoryEvidence([makeCase()]);
    expect(evidence.counts.withRecordedOutcome).toBe(0);
    expect(evidence.warnings.join(' ')).toContain('nothing about what followed');
  });

  it('hands back the cases in the order it was given them', () => {
    const cases = [
      makeCase({ observation: makeObservation({ id: 'first' }), resemblance: 60 }),
      makeCase({ observation: makeObservation({ id: 'second' }), resemblance: 95 }),
    ];
    expect(buildMemoryEvidence(cases).cases.map((entry) => entry.observation.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('reflects the sample floor it was given', () => {
    const cases: MemoryMatchedCase[] = Array.from({ length: 3 }, (_, i) =>
      makeCase({
        observation: makeObservation({
          id: `obs-${i}`,
          outcome: { status: 'recorded', continuation: 'continuation', source: 'trader-recorded' },
        }),
      })
    );

    expect(buildMemoryEvidence(cases).summary.continuationRate).toBeNull();
    expect(buildMemoryEvidence(cases, { minSample: 3 }).summary.continuationRate).toBe(100);
  });

  it('is a pure read: the cases it was handed are not modified', () => {
    const cases = [makeCase({ trade: makeTrade({ netPnL: 100 }) })];
    const snapshot = JSON.stringify(cases);
    buildMemoryEvidence(cases);
    expect(JSON.stringify(cases)).toBe(snapshot);
  });
});
