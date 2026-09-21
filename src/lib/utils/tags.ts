/**
 * Tag text, as a clean list.
 *
 * Tags are typed by hand into a single comma-separated box, on trades and on the plan's
 * important price levels alike. This turns that one line into the array the journal
 * stores, and it exists as a function rather than a line inside a form for two reasons:
 *
 *  - A tag that was typed twice must not be stored twice. The chips that render tags are
 *    keyed by their own text, so a duplicate is a duplicate React key as well as two
 *    identical chips the trader has to delete one at a time.
 *  - The rule is worth stating in one place and testing, because it is invisible when it
 *    is wrong: nothing on screen tells you a tag was silently duplicated.
 *
 * The typed spelling of the first occurrence is kept, since it is the trader's own
 * wording; only the comparison is case-insensitive.
 */
export function parseTagInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const part of input.split(',')) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}
