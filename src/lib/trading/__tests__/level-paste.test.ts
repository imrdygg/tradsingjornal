import { describe, it, expect } from 'vitest';
import {
  groupTaggedLevels,
  parsePastedPrices,
  parseTaggedLevels,
} from '../level-paste';

describe('parsePastedPrices', () => {
  it('reads a newline-separated list in ascending order', () => {
    expect(parsePastedPrices('7742.25\n7735\n7721.5')).toEqual([7721.5, 7735, 7742.25]);
  });

  it('splits on commas, spaces, semicolons and tabs', () => {
    expect(parsePastedPrices('7700, 7705;7710\t7715')).toEqual([7700, 7705, 7710, 7715]);
  });

  it('keeps a price that sits beside its label, and drops a line with no number', () => {
    expect(parsePastedPrices('indicator R1 7742.25\nprior day low\n7735')).toEqual([7735, 7742.25]);
  });

  it('does not turn a label into a price', () => {
    // "R1" and "1h" both contain a digit; stripping the letters made them levels at price 1.
    expect(parsePastedPrices('R1\nS2\n1h\n7742.25')).toEqual([7742.25]);
  });

  it('tolerates surrounding punctuation and a currency sign', () => {
    expect(parsePastedPrices('(7700)\n$7705\n7710%')).toEqual([7700, 7705, 7710]);
  });

  it('collapses duplicates so re-pasting adds nothing', () => {
    expect(parsePastedPrices('7742.25\n7742.25\n7742.25')).toEqual([7742.25]);
  });

  it('ignores zero and negative values, which are never a price', () => {
    expect(parsePastedPrices('0\n-5\n7700')).toEqual([7700]);
  });
});

describe('parseTaggedLevels', () => {
  it('reads a timeframe and side off each line', () => {
    const { levels, issues } = parseTaggedLevels('5m R 7760\n15m S 7700');

    expect(issues).toEqual([]);
    expect(levels).toEqual([
      { timeframe: '5m', kind: 'resistance', price: 7760 },
      { timeframe: '15m', kind: 'support', price: 7700 },
    ]);
  });

  it('reads the tags in any order', () => {
    const { levels } = parseTaggedLevels('R 5m 7760\nsupport 15m 7700');
    expect(levels).toEqual([
      { timeframe: '5m', kind: 'resistance', price: 7760 },
      { timeframe: '15m', kind: 'support', price: 7700 },
    ]);
  });

  it('accepts the long side words and the abbreviations', () => {
    const { levels } = parseTaggedLevels('5m resistance 7760\n15m sup 7700\n1h R 7650');
    expect(levels.map((level) => level.kind)).toEqual(['resistance', 'support', 'resistance']);
  });

  it("gives every price on a line the line's tags", () => {
    const { levels } = parseTaggedLevels('5m R 7760 7765');
    expect(levels).toEqual([
      { timeframe: '5m', kind: 'resistance', price: 7760 },
      { timeframe: '5m', kind: 'resistance', price: 7765 },
    ]);
  });

  it('falls back to the defaults for an untagged line', () => {
    const { levels } = parseTaggedLevels('7742.25', { timeframe: '30m', kind: 'support' });
    expect(levels).toEqual([{ timeframe: '30m', kind: 'support', price: 7742.25 }]);
  });

  it('lets a tagged line override a default', () => {
    const { levels } = parseTaggedLevels('1h R 7650', { timeframe: '5m', kind: 'support' });
    expect(levels).toEqual([{ timeframe: '1h', kind: 'resistance', price: 7650 }]);
  });

  it('reports a tagged line with no price rather than dropping it silently', () => {
    const { levels, issues } = parseTaggedLevels('5m R 7760\n5m R');
    expect(levels).toEqual([{ timeframe: '5m', kind: 'resistance', price: 7760 }]);
    expect(issues).toEqual([{ line: '5m R', reason: 'no readable price' }]);
  });

  it('ignores a label token instead of reading a price out of it', () => {
    const { levels } = parseTaggedLevels('5m R R1 7760');
    expect(levels).toEqual([{ timeframe: '5m', kind: 'resistance', price: 7760 }]);
  });

  it('reports a line with digits but no usable price', () => {
    const { levels, issues } = parseTaggedLevels('5m R 0');
    expect(levels).toEqual([]);
    expect(issues).toEqual([{ line: '5m R 0', reason: 'no readable price' }]);
  });

  it('skips blank lines and # comments', () => {
    const { levels, issues } = parseTaggedLevels('\n# MES levels\n5m R 7760\n\n');
    expect(levels).toEqual([{ timeframe: '5m', kind: 'resistance', price: 7760 }]);
    expect(issues).toEqual([]);
  });

  it('collapses duplicates inside one paste', () => {
    const { levels } = parseTaggedLevels('5m R 7760\n5m R 7760\n5m R 7760');
    expect(levels).toEqual([{ timeframe: '5m', kind: 'resistance', price: 7760 }]);
  });

  it('keeps the same price on two different charts — they are different records', () => {
    const { levels } = parseTaggedLevels('5m R 7760\n1h R 7760');
    expect(levels).toEqual([
      { timeframe: '5m', kind: 'resistance', price: 7760 },
      { timeframe: '1h', kind: 'resistance', price: 7760 },
    ]);
  });

  it('is case insensitive', () => {
    const { levels } = parseTaggedLevels('5M r 7760\n15M Support 7700');
    expect(levels).toEqual([
      { timeframe: '5m', kind: 'resistance', price: 7760 },
      { timeframe: '15m', kind: 'support', price: 7700 },
    ]);
  });
});

describe('groupTaggedLevels', () => {
  it('counts levels per timeframe and side', () => {
    const { levels } = parseTaggedLevels('5m R 7760\n5m R 7765\n15m S 7700');
    const grouped = groupTaggedLevels(levels).sort(
      (a, b) => a.timeframe.localeCompare(b.timeframe) || a.kind.localeCompare(b.kind)
    );
    expect(grouped).toEqual([
      { timeframe: '15m', kind: 'support', count: 1 },
      { timeframe: '5m', kind: 'resistance', count: 2 },
    ]);
  });
});
