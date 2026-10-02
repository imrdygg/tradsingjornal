import { LevelKind, LevelTimeframe } from '../../types';

/**
 * Reading levels out of what the trader pastes.
 *
 * Two jobs, both about not making the trader clean up their own indicator's output by hand:
 * a flat list of prices for one chart and side, and a tagged list that carries its own
 * timeframe and side per line so all six charts can go in at once. Both drop anything that is
 * not a number rather than erroring, because an indicator copy-paste almost always carries the
 * line's wording beside its price.
 */

/**
 * Reads one token as a price, or null when it is not one.
 *
 * The token has to *be* a number, not merely contain one. Stripping every non-digit, as this
 * once did, turned the label "R1" into a level at price 1 and the word "1h" into a level at
 * price 1 as well — a real MES level of 1 is not a thing, but a bogus one would sit on the
 * record and be counted. Surrounding punctuation and a currency sign are still tolerated, so
 * "(7742.25)" and "$7742.25" both read; a token with a letter anywhere in it is a word.
 */
function readPrice(token: string): number | null {
  if (/[a-z]/i.test(token)) return null;
  const trimmed = token.replace(/^[^0-9.\-]+/, '').replace(/[^0-9]+$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = parseFloat(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Reads a pasted block of prices into the distinct numbers in it.
 *
 * Newlines, commas, spaces, tabs and semicolons all separate, and anything that is not a
 * number is dropped rather than errored on. Duplicates collapse, so pasting the same list
 * twice adds nothing the second time.
 */
export function parsePastedPrices(text: string): number[] {
  const tokens = text.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
  const values: number[] = [];
  for (const token of tokens) {
    const value = readPrice(token);
    if (value === null) continue;
    if (!values.includes(value)) values.push(value);
  }
  return values.sort((a, b) => a - b);
}

/** Words a tagged line may use to name the chart it came off. */
const TIMEFRAME_WORDS: Record<string, LevelTimeframe> = {
  '1m': '1m',
  '1min': '1m',
  '1minute': '1m',
  '3m': '3m',
  '3min': '3m',
  '3minute': '3m',
  '5m': '5m',
  '5min': '5m',
  '5minute': '5m',
  '15m': '15m',
  '15min': '15m',
  '15minute': '15m',
  '30m': '30m',
  '30min': '30m',
  '30minute': '30m',
  '1h': '1h',
  '1hr': '1h',
  '1hour': '1h',
  '60m': '1h',
};

/** Words a tagged line may use to name the side it leans. */
const SIDE_WORDS: Record<string, LevelKind> = {
  s: 'support',
  sup: 'support',
  supp: 'support',
  support: 'support',
  r: 'resistance',
  res: 'resistance',
  resis: 'resistance',
  resist: 'resistance',
  resistance: 'resistance',
};

/** One level read out of a tagged paste. */
export interface TaggedLevel {
  timeframe: LevelTimeframe;
  kind: LevelKind;
  price: number;
}

/** A line that could not become a level, kept so the trader can be told why. */
export interface TaggedLevelIssue {
  /** The line as written, trimmed. */
  line: string;
  /** Plain-language reason it was skipped. */
  reason: string;
}

export interface ParsedTaggedLevels {
  levels: TaggedLevel[];
  issues: TaggedLevelIssue[];
}

/**
 * Reads a paste where each line tags its own timeframe, side and price.
 *
 * A line is any order of an optional timeframe word, an optional side word, and one or more
 * prices — so `5m R 7760`, `R 5m 7760` and `5m resistance 7760 7765` all read the same. A line
 * with no tag falls back to the defaults passed in, which is what makes a plain pasted list
 * still work when the trader already has the right chart open. A line whose every token is
 * unreadable is reported as an issue rather than dropped, so a bulk save can never look like it
 * stored more than it did.
 *
 * Duplicate timeframe/side/price triples collapse inside one paste.
 */
export function parseTaggedLevels(
  text: string,
  defaults: { timeframe?: LevelTimeframe; kind?: LevelKind } = {}
): ParsedTaggedLevels {
  const levels: TaggedLevel[] = [];
  const issues: TaggedLevelIssue[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    // Blank lines and `#` comments are the trader's own headings, not levels.
    if (!line || line.startsWith('#')) continue;
    // A line with no digit at all is a heading like "5m resistance" — skipped, not reported.
    if (!/\d/.test(line)) continue;

    let timeframe = defaults.timeframe;
    let kind = defaults.kind;
    const prices: number[] = [];

    for (const token of line.split(/[\s,;]+/).filter(Boolean)) {
      const lower = token.toLowerCase();
      if (TIMEFRAME_WORDS[lower]) {
        timeframe = TIMEFRAME_WORDS[lower];
        continue;
      }
      if (SIDE_WORDS[lower]) {
        kind = SIDE_WORDS[lower];
        continue;
      }
      const value = readPrice(token);
      if (value !== null) prices.push(value);
    }

    if (prices.length === 0) {
      issues.push({ line, reason: 'no readable price' });
      continue;
    }
    if (!kind) {
      issues.push({ line, reason: 'no side — add S or R, or pick a default side' });
      continue;
    }
    if (!timeframe) {
      issues.push({ line, reason: 'no timeframe — add one like 5m, or open a chart first' });
      continue;
    }

    for (const price of prices) {
      const key = `${timeframe}|${kind}|${price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      levels.push({ timeframe, kind, price });
    }
  }

  return { levels, issues };
}

/** Groups a parsed paste by timeframe and side, for the "what will be saved" preview. */
export function groupTaggedLevels(
  levels: TaggedLevel[]
): { timeframe: LevelTimeframe; kind: LevelKind; count: number }[] {
  const map = new Map<string, { timeframe: LevelTimeframe; kind: LevelKind; count: number }>();
  for (const level of levels) {
    const key = `${level.timeframe}|${level.kind}`;
    const entry = map.get(key) ?? { timeframe: level.timeframe, kind: level.kind, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()];
}
