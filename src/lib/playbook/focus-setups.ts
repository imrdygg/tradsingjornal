/**
 * The two set-ups this journal is built around: the trader's own level plays.
 *
 * Support and Resistance are the only two setups in the built-in catalog — every other
 * pattern the app used to ship was deliberately cut, because this journal is one trader's
 * and they trade levels, not a library of thirty textbook patterns. The rest of the app
 * leans on this list rather than on a name spelled out at each call site: a fresh day's
 * plan watches these two, and the Playbook leads with them (a journal that still carries
 * setups from before the cut keeps them behind the "Show all setups" control).
 *
 * Kept as names, like every other setup reference in the app (`watchedSetups`, a trade's
 * `setupName`), so a match works whether a caller holds ids or names. Matching is
 * case-insensitive and trimmed, the same rule `storage.renameSetup` uses.
 */
export const FOCUS_SETUP_NAMES = ['Support', 'Resistance'] as const;

/** The ids the two built-ins are seeded under, so a caller can match either way. */
export const FOCUS_SETUP_IDS = ['support', 'resistance'] as const;

/**
 * True when a setup name is one of the two the app is focused on.
 *
 * A missing name is not a match: an unlabelled touch or setup should never be pulled into
 * the focus bucket by accident.
 */
export function isFocusSetup(name: string | null | undefined): boolean {
  if (!name) return false;
  const wanted = name.trim().toLowerCase();
  return FOCUS_SETUP_NAMES.some((focus) => focus.toLowerCase() === wanted);
}

/** True when a setup id is one of the two built-ins. */
export function isFocusSetupId(id: string | null | undefined): boolean {
  if (!id) return false;
  return (FOCUS_SETUP_IDS as readonly string[]).includes(id.trim());
}

/**
 * Splits a list of setups into the focus pair and everything else, in their existing
 * order. Order is preserved on purpose: the caller owns the catalog's ordering, and this
 * only decides which part of it is shown by default.
 */
export function splitFocusSetups<T extends { name: string }>(
  setups: T[]
): { focus: T[]; rest: T[] } {
  const focus: T[] = [];
  const rest: T[] = [];
  for (const setup of setups) (isFocusSetup(setup.name) ? focus : rest).push(setup);
  return { focus, rest };
}
