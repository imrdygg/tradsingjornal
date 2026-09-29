import { describe, it, expect } from 'vitest';
import {
  FOCUS_SETUP_IDS,
  FOCUS_SETUP_NAMES,
  isFocusSetup,
  isFocusSetupId,
  splitFocusSetups,
} from '../focus-setups';

/**
 * The focus pair is the trader's own two level plays, and it is what the Playbook trims to
 * and what a fresh day watches. The match rule matters: a near-miss name would either hide
 * a set-up the trader uses or pull an unrelated one into the trimmed view.
 */
describe('focus setups', () => {
  it('is Support and Resistance, in that order', () => {
    expect([...FOCUS_SETUP_NAMES]).toEqual(['Support', 'Resistance']);
    expect([...FOCUS_SETUP_IDS]).toEqual(['support', 'resistance']);
  });

  it('matches the two names, case-insensitively and trimmed', () => {
    for (const name of FOCUS_SETUP_NAMES) {
      expect(isFocusSetup(name)).toBe(true);
      expect(isFocusSetup(`  ${name.toLowerCase()}  `)).toBe(true);
    }
  });

  it('does not match a missing name or a near-miss', () => {
    expect(isFocusSetup(undefined)).toBe(false);
    expect(isFocusSetup(null)).toBe(false);
    expect(isFocusSetup('')).toBe(false);
    expect(isFocusSetup('Breakout')).toBe(false);
    // A setup that merely contains the word is not the level play itself.
    expect(isFocusSetup('Resistance Break')).toBe(false);
    expect(isFocusSetup('Support Tweak')).toBe(false);
  });

  it('matches the two seeded ids', () => {
    expect(isFocusSetupId(FOCUS_SETUP_IDS[0])).toBe(true);
    expect(isFocusSetupId(FOCUS_SETUP_IDS[1])).toBe(true);
    expect(isFocusSetupId('breakout')).toBe(false);
    expect(isFocusSetupId(undefined)).toBe(false);
  });

  it('splits a catalog into the pair and the rest, preserving order', () => {
    const setups = [
      { name: 'Resistance' },
      { name: 'Engulfing' },
      { name: 'Support' },
      { name: 'Breakout' },
    ];

    const { focus, rest } = splitFocusSetups(setups);

    expect(focus.map((s) => s.name)).toEqual(['Resistance', 'Support']);
    expect(rest.map((s) => s.name)).toEqual(['Engulfing', 'Breakout']);
  });
});
