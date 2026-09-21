import { describe, it, expect } from 'vitest';
import { isRetryable, modelChain } from '../../../../src/api/coach';
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

describe('mode coverage', () => {
  it('keeps the runtime mode list in step with the six supported modes', () => {
    // COACH_MODES is a plain array because the union lives in a types-only module, so
    // this is what stops the two drifting apart.
    expect([...COACH_MODES].sort()).toEqual(
      ['brief', 'planreview', 'postclose', 'prep', 'trade', 'weekly'].sort()
    );
  });
});
