import { describe, it, expect } from 'vitest';
import {
  FOCUS_SETUP_IDS,
  FOCUS_SETUP_NAMES,
  isFocusSetup,
  isFocusSetupId,
  splitFocusSetups,
} from '../focus-setups';

/**
 * The focus pair is what the Playbook trims to and what a fresh day watches, so the match
 * rule matters: a near-miss name would either hide a set-up the trader uses or pull an
 * unrelated one into the trimmed view.
 */
describe('focus setups', () => {
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
    // The pattern is a break-and-run, not any setup containing "Break".
    expect(isFocusSetup('Failed Breakout')).toBe(false);
  });

  it('matches the two seeded ids', () => {
    expect(isFocusSetupId(FOCUS_SETUP_IDS[0])).toBe(true);
    expect(isFocusSetupId(FOCUS_SETUP_IDS[1])).toBe(true);
    expect(isFocusSetupId('breakout')).toBe(false);
    expect(isFocusSetupId(undefined)).toBe(false);
  });

  it('splits a catalog into the pair and the rest, preserving order', () => {
    const setups = [
      { name: 'Session Break & Run' },
      { name: 'Engulfing' },
      { name: 'Overnight Break & Run' },
      { name: 'Breakout' },
    ];

    const { focus, rest } = splitFocusSetups(setups);

    expect(focus.map((s) => s.name)).toEqual(['Session Break & Run', 'Overnight Break & Run']);
    expect(rest.map((s) => s.name)).toEqual(['Engulfing', 'Breakout']);
  });
});
