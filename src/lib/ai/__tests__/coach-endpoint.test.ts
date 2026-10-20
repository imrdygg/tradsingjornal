import { describe, it, expect } from 'vitest';
import {
  isRetryable,
  modelChain,
  readEntryEdgeFacts,
  readSightingNotes,
} from '../../../../src/api/coach';
import { COACH_MODES } from '../coach-prompt';

/**
 * The endpoint used to call one model and give up. On this key `gemini-flash-latest`
 * returned 503 "high demand" while the lite model served fine, so a single model meant a
 * dead coach. These cover the fallback that replaced it.
 */

describe('modelChain', () => {
  it('falls back through several models by default', () => {
    const chain = modelChain({});
    expect(chain.length).toBeGreaterThan(1);
    expect(chain).toContain('gemini-flash-lite-latest');
  });

  it('tries a configured model first', () => {
    const chain = modelChain({ GEMINI_MODEL: 'my-pinned-model' });
    expect(chain[0]).toBe('my-pinned-model');
    // The built-in fallbacks stay available behind it.
    expect(chain).toContain('gemini-flash-lite-latest');
  });

  it('does not retry a model twice when it is already in the fallback list', () => {
    const chain = modelChain({ GEMINI_MODEL: 'gemini-flash-lite-latest' });
    expect(chain.filter((m) => m === 'gemini-flash-lite-latest')).toHaveLength(1);
  });

  it('ignores a blank or whitespace-only configured model', () => {
    expect(modelChain({ GEMINI_MODEL: '   ' })[0]).toBe('gemini-flash-lite-latest');
  });
});

describe('isRetryable', () => {
  it('retries when the model is overloaded', () => {
    expect(isRetryable(503, 'This model is currently experiencing high demand.')).toBe(true);
    expect(isRetryable(429, 'Resource has been exhausted')).toBe(true);
    expect(isRetryable(500, 'internal')).toBe(true);
  });

  it('retries when a model has been retired, since another one will work', () => {
    expect(
      isRetryable(404, 'This model models/gemini-2.5-flash is no longer available to new users.')
    ).toBe(true);
  });

  it('does not retry a request the model rejected as malformed', () => {
    expect(isRetryable(400, 'Invalid JSON payload received. Unknown name "foo".')).toBe(false);
  });

  it('treats a transport failure as worth retrying', () => {
    expect(isRetryable(0, 'network: fetch failed')).toBe(true);
  });
});

describe('readEntryEdgeFacts', () => {
  it('accepts a symbol, a side and a price', () => {
    expect(readEntryEdgeFacts({ symbol: ' MES ', direction: 'long', entryPrice: 7745 })).toEqual({
      symbol: 'MES',
      direction: 'long',
      entryPrice: 7745,
      contracts: undefined,
    });
  });

  it('refuses anything it could not read an entry out of', () => {
    expect(readEntryEdgeFacts(null)).toBeNull();
    expect(readEntryEdgeFacts({ symbol: 'MES', direction: 'sideways', entryPrice: 1 })).toBeNull();
    expect(readEntryEdgeFacts({ symbol: '', direction: 'long', entryPrice: 1 })).toBeNull();
    // A zero or negative entry is not a price, and would corrupt every distance computed from it.
    expect(readEntryEdgeFacts({ symbol: 'MES', direction: 'long', entryPrice: 0 })).toBeNull();
    expect(readEntryEdgeFacts({ symbol: 'MES', direction: 'long' })).toBeNull();
  });
});

describe('readSightingNotes', () => {
  it('keeps the notes under each picture and drops a sighting with no words', () => {
    const facts = readSightingNotes({
      total: 3,
      sightings: [
        {
          date: '2026-10-01',
          symbol: 'MES',
          timeframe: '15m',
          notes: ['Held the shelf for two days.', 'Lost it on the third.'],
        },
        { date: '2026-10-02', symbol: 'MES', notes: ['   '] },
      ],
    });

    expect(facts?.listed).toBe(1);
    expect(facts?.total).toBe(3);
    expect(facts?.sightings[0].notes).toHaveLength(2);
  });

  it('refuses a request with nothing readable rather than letting the model invent sightings', () => {
    expect(readSightingNotes(undefined)).toBeNull();
    expect(readSightingNotes({ sightings: [] })).toBeNull();
    expect(readSightingNotes({ sightings: [{ date: '2026-10-01', notes: [] }] })).toBeNull();
  });

  it('caps how many notes one sighting contributes', () => {
    const facts = readSightingNotes({
      sightings: [
        {
          date: '2026-10-01',
          symbol: 'MES',
          notes: ['a', 'b', 'c', 'd', 'e'],
        },
      ],
    });
    expect(facts?.sightings[0].notes).toEqual(['a', 'b', 'c']);
  });
});

describe('mode coverage', () => {
  it('keeps the runtime mode list in step with the supported modes', () => {
    // COACH_MODES is a plain array because the union lives in a types-only module, so
    // this is what stops the two drifting apart.
    expect([...COACH_MODES].sort()).toEqual(
      [
        'brief',
        'form',
        'edge',
        'learn',
        'match',
        'extremes',
        'extremecall',
        'setups',
        'planreview',
        'postclose',
        'prep',
        'trade',
        'weekly',
        'planfield',
        'planbuild',
        'scalein',
        'entrycall',
        'chartread',
        'ask',
        'lessons',
        'mindset',
        'sightings',
        'selfplan',
        'entryedge',
      ].sort()
    );
  });
});
