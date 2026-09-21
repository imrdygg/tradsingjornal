import { describe, it, expect } from 'vitest';
import { parseTagInput } from '../tags';

/**
 * Tag parsing, which is silent when it goes wrong: a duplicated tag shows up as two
 * identical chips and a duplicate React key, and nothing tells the trader why.
 */
describe('parseTagInput', () => {
  it('splits on commas and trims each tag', () => {
    expect(parseTagInput(' liquidity , news ')).toEqual(['liquidity', 'news']);
  });

  it('drops empty entries, so a trailing comma is harmless', () => {
    expect(parseTagInput('liquidity,,   ,news,')).toEqual(['liquidity', 'news']);
  });

  it('returns an empty list for empty or comma-only input', () => {
    expect(parseTagInput('')).toEqual([]);
    expect(parseTagInput('  ,  , ')).toEqual([]);
  });

  it('keeps a typed tag once, whichever casing it was typed in twice', () => {
    // Two identical tags would render as two chips keyed by the same string.
    expect(parseTagInput('Key, key, KEY')).toEqual(['Key']);
  });

  it('keeps the spelling of the first occurrence', () => {
    // The trader's own wording wins; only the comparison is case-insensitive.
    expect(parseTagInput('Overnight High, overnight high')).toEqual(['Overnight High']);
  });

  it('leaves distinct tags alone, in the order they were typed', () => {
    expect(parseTagInput('liquidity, key, news')).toEqual(['liquidity', 'key', 'news']);
  });
});
