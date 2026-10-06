/**
 * The one deep link this app has: a chart pattern's stable URL.
 *
 * Deliberately a string in and a string out, with no pattern data involved — the id is
 * validated in the playbook chunk, which is loaded on demand. Importing the pattern list
 * into the shell would drag all 20 patterns' prose into the first paint to check a hash.
 */
export const PATTERN_HASH_PREFIX = '#chart-patterns/';

export function readPatternFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith(PATTERN_HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(PATTERN_HASH_PREFIX.length)).trim();
  return id || null;
}
