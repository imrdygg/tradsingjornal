import { describe, expect, it } from 'vitest';
import {
  PATTERNS,
  PATTERN_IDS,
  filterPatterns,
  findPatternBySetupName,
  getPattern,
  isPatternId,
  relatedPatterns,
} from '../patterns';
import { PATTERN_ANIMATIONS } from '../pattern-animations';
import {
  EDUCATIONAL_DISCLAIMER,
  STATUS_OPTIONS,
  STATUS_LABELS,
  UNIVERSAL_CHECKLIST,
  checklistKey,
} from '../pattern-types';
import type { PatternFeature } from '../pattern-animations';
import type { PatternBias, PatternPhase, PatternSetup } from '../pattern-types';

/**
 * These tests exist because the playbook's content is data: nothing else in the app would
 * fail if a pattern lost its confirmation rule, pointed at an illustration that does not
 * exist, or quietly invented a fourth "Descending Triangle". A type cannot say "every
 * pattern has something to look for", so this file does.
 */

/** The 20 ids, in source order, exactly as the build spec lists them. */
const EXPECTED_IDS = [
  'reversal-bearish-double-top',
  'reversal-bearish-head-shoulders',
  'reversal-bearish-rising-wedge',
  'reversal-bearish-expanding-triangle',
  'reversal-bearish-triple-top',
  'reversal-bullish-double-bottom',
  'reversal-bullish-inverted-head-shoulder',
  'reversal-bullish-falling-wedge',
  'reversal-bullish-expanding-triangle',
  'reversal-bullish-triple-bottom',
  'continuation-bullish-flag',
  'continuation-bullish-pennant',
  'continuation-bullish-falling-village',
  'continuation-descending-triangle-bullish-source',
  'continuation-symmetrical-expanding-triangle-upper-source',
  'continuation-bearish-flag',
  'continuation-bearish-pennant',
  'continuation-bearish-rising-wedge',
  'continuation-descending-triangle-bearish-source',
  'continuation-symmetrical-expanding-triangle-bearish-source',
];

const PHASES: PatternPhase[] = ['priorTrend', 'formation', 'trigger', 'breakout', 'retest', 'target'];

const featuresOf = (patternId: string, kind: PatternFeature['kind']): PatternFeature[] =>
  (PATTERN_ANIMATIONS[patternId]?.features ?? []).filter((feature) => feature.kind === kind);

/** Every string a pattern ships, so the "no blank content" rules can be written once. */
const allStrings = (pattern: PatternSetup): string[] => [
  pattern.summary,
  ...pattern.marketStory,
  ...pattern.requiredStructure,
  ...pattern.formationSequence,
  ...pattern.confirmation,
  ...pattern.invalidation,
  ...pattern.targetConcepts,
  ...pattern.commonMistakes,
  ...pattern.checklist,
  pattern.animation.priorTrend,
  pattern.animation.formation,
  pattern.animation.trigger,
  pattern.animation.breakout,
];

describe('pattern registry', () => {
  it('ships all 20 source setups under their specified ids', () => {
    expect(PATTERN_IDS).toEqual(EXPECTED_IDS);
    expect(PATTERNS).toHaveLength(20);
  });

  it('keeps the source sheet order via sourcePosition', () => {
    expect(PATTERNS.map((pattern) => pattern.sourcePosition)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1)
    );
  });

  it('has 10 reversal and 10 continuation setups', () => {
    expect(PATTERNS.filter((p) => p.category === 'reversal')).toHaveLength(10);
    expect(PATTERNS.filter((p) => p.category === 'continuation')).toHaveLength(10);
  });

  it('expects every setup to carry either one direction or both', () => {
    const counts = PATTERNS.reduce(
      (acc, pattern) => ({ ...acc, [pattern.bias]: acc[pattern.bias] + 1 }),
      { bullish: 0, bearish: 0, neutral: 0 } as Record<PatternBias, number>
    );
    expect(counts).toEqual({ bullish: 9, bearish: 10, neutral: 1 });
  });

  it('gives every setup a unique display name so duplicates can be told apart', () => {
    const names = PATTERNS.map((pattern) => pattern.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('preserves repeated source labels instead of rewriting them', () => {
    const bySourceName = new Map<string, PatternSetup[]>();
    PATTERNS.forEach((pattern) => {
      bySourceName.set(pattern.sourceName, [
        ...(bySourceName.get(pattern.sourceName) ?? []),
        pattern,
      ]);
    });

    const repeated = [...bySourceName.entries()].filter(([, list]) => list.length > 1);
    expect(repeated.map(([name]) => name).sort()).toEqual([
      'Bearish Rising Wedge',
      'Descending Triangle',
      'Symmetrical Expanding Triangle',
    ]);

    // A repeated label is only safe to ship when the later cards explain the difference
    // and the URLs still differ. The first occurrence needs no note — it is the plain
    // reading of the name — but every repeat has to say how it differs.
    repeated.forEach(([, list]) => {
      expect(new Set(list.map((pattern) => pattern.id)).size).toBe(list.length);
      list.slice(1).forEach((pattern) => {
        expect(pattern.sourceNote?.trim()).toBeTruthy();
        expect(pattern.displayName).not.toBe(pattern.sourceName);
        // An alias is optional but never empty, and never presented as the source label.
        (pattern.aliases ?? []).forEach((alias) => {
          expect(alias.trim().length).toBeGreaterThan(5);
          expect(alias).not.toBe(pattern.sourceName);
        });
      });
    });
  });

  it('says out loud that the source sheet contradicts itself', () => {
    // Each of these is documented in the build spec as a label/geometry mismatch.
    const documented = [
      'continuation-bullish-falling-village',
      'continuation-descending-triangle-bullish-source',
      'continuation-symmetrical-expanding-triangle-upper-source',
      'continuation-descending-triangle-bearish-source',
      'continuation-symmetrical-expanding-triangle-bearish-source',
    ];
    documented.forEach((id) => {
      const pattern = getPattern(id);
      expect(pattern?.sourceName).toBeTruthy();
      expect(pattern?.sourceNote?.length ?? 0).toBeGreaterThan(60);
    });
  });

  it('keeps the exact source wording where the spec requires it', () => {
    expect(getPattern('continuation-bullish-falling-village')?.sourceName).toBe(
      'Bullish Falling Village'
    );
    expect(getPattern('reversal-bearish-head-shoulders')?.sourceName).toBe(
      'Bearish Head Shoulders'
    );
  });
});

describe('pattern content', () => {
  PATTERNS.forEach((pattern) => {
    describe(pattern.displayName, () => {
      it('explains itself', () => {
        expect(pattern.summary.length).toBeGreaterThan(40);
        // One sentence, so the card stays readable.
        expect(pattern.summary.length).toBeLessThan(320);
        expect(pattern.marketStory.length).toBeGreaterThanOrEqual(4);
        expect(pattern.requiredStructure.length).toBeGreaterThanOrEqual(4);
        expect(pattern.formationSequence.length).toBeGreaterThanOrEqual(6);
        expect(pattern.confirmation.length).toBeGreaterThanOrEqual(2);
        expect(pattern.invalidation.length).toBeGreaterThanOrEqual(2);
        expect(pattern.targetConcepts.length).toBeGreaterThanOrEqual(2);
        expect(pattern.commonMistakes.length).toBeGreaterThanOrEqual(2);
        expect(pattern.checklist.length).toBeGreaterThanOrEqual(2);
      });

      it('has no blank or duplicated lines', () => {
        allStrings(pattern).forEach((line) => expect(line.trim().length).toBeGreaterThan(3));

        const lists = [
          pattern.marketStory,
          pattern.requiredStructure,
          pattern.formationSequence,
          pattern.confirmation,
          pattern.invalidation,
          pattern.targetConcepts,
          pattern.commonMistakes,
          pattern.checklist,
        ];
        lists.forEach((list) => expect(new Set(list).size).toBe(list.length));
      });

      it('teaches the difference between forming and confirmed', () => {
        // The spec's core teaching claim: a shape is not a signal.
        const joined = [...pattern.confirmation, ...pattern.invalidation].join(' ').toLowerCase();
        expect(joined).toMatch(/close|invalid|fail|reclaim|hold/);
      });

      it('describes the animation in the same order the timeline plays it', () => {
        expect(pattern.animation.priorTrend.trim()).toBeTruthy();
        expect(pattern.animation.formation.trim()).toBeTruthy();
        expect(pattern.animation.trigger.trim()).toBeTruthy();
        expect(pattern.animation.breakout.trim()).toBeTruthy();
      });
    });
  });
});

describe('pattern animations', () => {
  it('covers exactly the registered patterns', () => {
    expect(Object.keys(PATTERN_ANIMATIONS).sort()).toEqual([...PATTERN_IDS].sort());
  });

  PATTERNS.forEach((pattern) => {
    describe(pattern.displayName, () => {
      const spec = PATTERN_ANIMATIONS[pattern.id];
      const breakouts = featuresOf(pattern.id, 'breakout');
      const ghosts = featuresOf(pattern.id, 'ghost');

      it('draws a price path that runs left to right inside the canvas', () => {
        expect(spec.path.length).toBeGreaterThanOrEqual(8);
        spec.path.forEach((point) => {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(100);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(100);
        });
        const xs = spec.path.map((point) => point.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        expect(new Set(xs).size).toBe(xs.length);
      });

      it('breaks in the direction the bias claims', () => {
        expect(breakouts).toHaveLength(1);
        const breakout = breakouts[0] as Extract<PatternFeature, { kind: 'breakout' }>;
        if (pattern.bias === 'bullish') expect(breakout.direction).toBe('up');
        if (pattern.bias === 'bearish') expect(breakout.direction).toBe('down');
        // A two-direction setup must show both exits, not pick one and hope.
        if (pattern.bias === 'neutral') expect(ghosts.length).toBeGreaterThan(0);
      });

      it('marks what would prove it wrong', () => {
        expect(featuresOf(pattern.id, 'invalidation')).toHaveLength(1);
      });

      it('references the measured move as a reference, never a destination', () => {
        expect(featuresOf(pattern.id, 'target')).toHaveLength(1);
      });

      it('only uses phases the timeline knows, and reaches them in order', () => {
        spec.features.forEach((feature) => {
          expect(PHASES).toContain(feature.phase);
        });

        // The break cannot be annotated before the structure it breaks out of.
        const breakout = breakouts[0] as Extract<PatternFeature, { kind: 'breakout' }>;
        expect(breakout.phase).toBe('breakout');

        spec.features
          .filter((feature) => feature.kind === 'target')
          .forEach((feature) => expect(feature.phase).toBe('target'));
        spec.features
          .filter((feature) => feature.kind === 'retest')
          .forEach((feature) => expect(feature.phase).toBe('retest'));
      });

      it('shows real structure rather than a bare line', () => {
        const structure = spec.features.filter(
          (feature) => feature.kind === 'level' || feature.kind === 'trendline'
        );
        const zones = featuresOf(pattern.id, 'zone');
        expect(structure.length + zones.length).toBeGreaterThanOrEqual(2);
      });

      it('labels every structure line with two distinct points', () => {
        spec.features.forEach((feature) => {
          if (feature.kind === 'level' || feature.kind === 'trendline' || feature.kind === 'invalidation' || feature.kind === 'target') {
            expect(feature.from.x).not.toBe(feature.to.x);
            expect([feature.from.x, feature.to.x].every((x) => x >= 0 && x <= 100)).toBe(true);
            expect([feature.from.y, feature.to.y].every((y) => y >= 0 && y <= 100)).toBe(true);
          }
        });
      });

      it('writes real text into every teaching label', () => {
        spec.features
          .filter((feature) => feature.kind === 'label')
          .forEach((feature) => {
            expect(
              (feature as Extract<PatternFeature, { kind: 'label' }>).text.trim().length
            ).toBeGreaterThan(2);
          });
      });
    });
  });

  it('shows a retest where the storyboard promises one', () => {
    const withRetest = PATTERNS.filter((pattern) => featuresOf(pattern.id, 'retest').length > 0);
    expect(withRetest.length).toBeGreaterThanOrEqual(4);

    // A retest is optional content, so some patterns must deliberately not have one.
    expect(withRetest.length).toBeLessThan(PATTERNS.length);
  });
});

describe('grid filters', () => {
  it('returns everything when nothing is filtered', () => {
    expect(filterPatterns()).toHaveLength(20);
    expect(filterPatterns({ category: 'all', bias: 'all' })).toHaveLength(20);
  });

  it('splits by category', () => {
    expect(filterPatterns({ category: 'reversal' })).toHaveLength(10);
    expect(filterPatterns({ category: 'continuation' })).toHaveLength(10);
  });

  it('splits by bias', () => {
    expect(filterPatterns({ bias: 'bullish' }).map((p) => p.id)).toEqual([
      'reversal-bullish-double-bottom',
      'reversal-bullish-inverted-head-shoulder',
      'reversal-bullish-falling-wedge',
      'reversal-bullish-expanding-triangle',
      'reversal-bullish-triple-bottom',
      'continuation-bullish-flag',
      'continuation-bullish-pennant',
      'continuation-bullish-falling-village',
      'continuation-descending-triangle-bullish-source',
    ]);
    expect(filterPatterns({ bias: 'bearish' })).toHaveLength(10);
    expect(filterPatterns({ bias: 'neutral' }).map((p) => p.id)).toEqual([
      'continuation-symmetrical-expanding-triangle-upper-source',
    ]);
  });

  it('combines both filters', () => {
    const result = filterPatterns({ category: 'continuation', bias: 'bearish' });
    expect(result.map((p) => p.id)).toEqual([
      'continuation-bearish-flag',
      'continuation-bearish-pennant',
      'continuation-bearish-rising-wedge',
      'continuation-descending-triangle-bearish-source',
      'continuation-symmetrical-expanding-triangle-bearish-source',
    ]);
  });
});

describe('lookups', () => {
  it('resolves known ids and refuses everything else', () => {
    expect(getPattern('reversal-bearish-double-top')?.sourcePosition).toBe(1);
    expect(getPattern('not-a-pattern')).toBeUndefined();
    expect(getPattern(null)).toBeUndefined();
    expect(isPatternId('continuation-bullish-flag')).toBe(true);
    expect(isPatternId('continuation-bullish-flag ')).toBe(false);
    expect(isPatternId(undefined)).toBe(false);
  });

  it('only links a trade setup by exact source name', () => {
    expect(findPatternBySetupName('Bullish Flag Pattern')?.id).toBe('continuation-bullish-flag');
    expect(findPatternBySetupName('  bullish flag pattern  ')?.id).toBe(
      'continuation-bullish-flag'
    );
    // Fuzzy matching here would attach the wrong chart to a trade, so it must not.
    expect(findPatternBySetupName('flag')).toBeUndefined();
    expect(findPatternBySetupName('Bullish Flag')).toBeUndefined();
    expect(findPatternBySetupName(undefined)).toBeUndefined();
  });

  it('suggests related setups that never include the pattern itself', () => {
    PATTERNS.forEach((pattern) => {
      const related = relatedPatterns(pattern);
      expect(related).toHaveLength(3);
      expect(related.map((candidate) => candidate.id)).not.toContain(pattern.id);
      expect(new Set(related.map((candidate) => candidate.id)).size).toBe(3);
    });
  });

  it('pairs the setups that genuinely belong together', () => {
    const flag = getPattern('continuation-bullish-flag');
    expect(flag).toBeTruthy();
    expect(relatedPatterns(flag!).map((candidate) => candidate.id)).toContain(
      'continuation-bearish-flag'
    );

    // A double top and a double bottom are the same structure read from opposite sides,
    // and a direction word followed by "top" or "triple" is not a shared structure: the
    // ranking has to reflect that, not just count overlapping words.
    const doubleTop = relatedPatterns(getPattern('reversal-bearish-double-top')!);
    expect(doubleTop.map((candidate) => candidate.id)).toContain('reversal-bullish-double-bottom');
    expect(doubleTop.filter((candidate) => candidate.category === 'reversal').length).toBeGreaterThanOrEqual(2);

    const wedge = relatedPatterns(getPattern('continuation-bearish-rising-wedge')!);
    expect(wedge[0].id).toBe('reversal-bearish-rising-wedge');

    // Direction words must not create a relationship on their own.
    const pennant = relatedPatterns(getPattern('continuation-bearish-pennant')!);
    expect(pennant[0].id).toBe('continuation-bullish-pennant');
  });
});

describe('study vocabulary', () => {
  it('offers every pattern status exactly once, each with a reason to use it', () => {
    const values = STATUS_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toHaveLength(9);
    STATUS_OPTIONS.forEach((option) => {
      expect(option.label.trim()).toBeTruthy();
      expect(option.help.trim().length).toBeGreaterThan(10);
      expect(STATUS_LABELS[option.value]).toBe(option.label);
    });
  });

  it('separates a shape from a confirmed close', () => {
    const help = (value: string) =>
      STATUS_OPTIONS.find((option) => option.value === value)?.help.toLowerCase() ?? '';
    expect(help('confirmed')).toMatch(/clos/);
    expect(help('forming')).not.toMatch(/clos/);
  });

  it('gives every checklist row a stable, unique key', () => {
    const universalKeys = UNIVERSAL_CHECKLIST.map((_, index) => checklistKey('universal', index));
    expect(new Set(universalKeys).size).toBe(UNIVERSAL_CHECKLIST.length);
    expect(universalKeys).not.toContain(checklistKey('pattern', 0));
    UNIVERSAL_CHECKLIST.forEach((item) => expect(item.label.trim().length).toBeGreaterThan(10));
  });

  it('states that patterns are probabilistic, on the record', () => {
    expect(EDUCATIONAL_DISCLAIMER).toMatch(/probabilistic/i);
    expect(EDUCATIONAL_DISCLAIMER).toMatch(/not guarantees|not signals/i);
  });
});
