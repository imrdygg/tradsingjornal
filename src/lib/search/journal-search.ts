import type { DailyReview, Instrument, Trade, TradingDay } from '../../types';

/**
 * Journal-wide search, used by the home page's search box.
 *
 * The whole thing is pure and synchronous: the journal is already in memory, so a search
 * is a filter, not a query. Every matcher here is deliberately forgiving — a trader who
 * types "president" should find the trade tagged "President speech" without knowing how
 * the tags were spelled, and one who types ">100" should get the same answer "winners"
 * would give.
 *
 * Trades are the headline results, but the journal's writing is searchable too: a day's
 * plan fields (waiting-for, stay-out-if, notes, watched setups) and the end-of-day review
 * (did well / did poorly / tomorrow focus) are indexed per trading day, so searching a
 * word you only wrote in a review finds the day you wrote it in.
 *
 * Kept out of the component so the rules can be unit tested without rendering anything.
 */

export interface SearchableTrade {
  trade: Trade;
  /** Trading date (YYYY-MM-DD) the trade belongs to, from its day. */
  tradeDate: string;
  /** Display symbol, e.g. 'MES'. */
  symbol: string;
  /** Every word the trade can be found by, lowercased. */
  haystack: string;
  /** Lowercased tags, matched whole so "win" does not silently match "winner". */
  tags: string[];
}

/**
 * One searchable trading day: the morning plan's own fields plus that day's review.
 *
 * Days are indexed even when they have no review — a plan's "stay out if" is exactly as
 * worth finding as a review's lesson, and most days have the former and not the latter.
 */
export interface SearchableDay {
  day: TradingDay;
  /** The day's review, when one was written. */
  review: DailyReview | null;
  /** Every word the plan's own fields can be found by, lowercased. */
  planHaystack: string;
  /** Every word the review's writing can be found by, lowercased; empty without one. */
  reviewHaystack: string;
  /** Both of the above joined — what a whole-day word search runs against. */
  haystack: string;
}

/**
 * Builds the text a trade is matched against, one lowercase blob.
 *
 * The trading date and entry time are part of it, so a pasted date ("2026-09-18") or a
 * typed hour ("09:35", "9:35") finds the trades from that moment — searching when is as
 * natural as searching what.
 */
function buildTradeHaystack(trade: Trade, symbol: string, tradeDate: string): string {
  return [
    trade.setupName,
    trade.entryReason,
    trade.notes,
    trade.session,
    trade.direction === 'long' ? 'long' : 'short',
    symbol.toLowerCase(),
    String(trade.grossPnL),
    tradeDate,
    trade.entryTime,
    trade.exitTime,
    ...(trade.tags ?? []),
  ]
    .filter((part): part is string => !!part)
    .join(' ')
    .toLowerCase();
}

/**
 * The plan's own written fields, as one lowercase blob.
 *
 * Numbers are included deliberately: the loss limit is something a trader remembers
 * ("the 200 limit day"). Level labels, watch-list names and the audit trail's reasons
 * are writing, and all of it is searchable.
 */
function buildPlanHaystack(day: TradingDay): string {
  return [
    day.waitingFor,
    day.stayOutIf,
    day.notes,
    day.profitCushionContext,
    day.riskIncreaseReason,
    ...(day.watchedSetups ?? []),
    ...(day.importantLevels ?? []).map((level) => level.label),
    ...(day.importantLevels ?? []).map((level) => String(level.price)),
    // A level's tags are its own way of being found: searching "liquidity" should surface
    // the day whose levels were tagged that way, the same as a trade's tags do.
    ...(day.importantLevels ?? []).flatMap((level) => level.tags ?? []),
    ...(day.importantLevels ?? []).map((level) => level.notes),
    ...(day.planChanges ?? []).map((change) => change.reason),
    day.tradeDate,
    String(day.plannedLossLimit),
  ]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

/**
 * The review's three written fields, as one lowercase blob.
 *
 * The per-question ticks are deliberately excluded — they are checkboxes, not writing,
 * and the discipline score is already searchable through the plan side's day number.
 */
function buildReviewHaystack(review: DailyReview): string {
  return [review.didWell, review.didPoorly, review.tomorrowFocus]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

/**
 * Pre-computes what search needs from each trade.
 *
 * Called once per journal change rather than once per keystroke: the per-trade text blob
 * is what makes typing feel instant, and rebuilding it on every keypress would waste that
 * head start.
 */
export function buildSearchIndex(
  trades: Trade[],
  instruments: Instrument[],
  dateByDayId: Map<string, string>
): SearchableTrade[] {
  return trades.map((trade) => {
    const symbol =
      instruments.find((i) => i.id === trade.instrumentId)?.symbol ??
      trade.instrumentId.toUpperCase();
    const tradeDate = dateByDayId.get(trade.tradingDayId) ?? '';
    return {
      trade,
      tradeDate,
      symbol,
      haystack: buildTradeHaystack(trade, symbol, tradeDate),
      tags: (trade.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    };
  });
}

/**
 * Indexes every trading day with its review, newest first.
 *
 * Reviews are attached by trading-day id — a review belongs to the day it reviews, the
 * same rule the trend chart uses.
 */
export function buildDaySearchIndex(
  tradingDays: TradingDay[],
  reviews: DailyReview[]
): SearchableDay[] {
  const reviewByDayId = new Map(reviews.map((review) => [review.tradingDayId, review]));

  return tradingDays
    .map((day) => {
      const review = reviewByDayId.get(day.id) ?? null;
      const planHaystack = buildPlanHaystack(day);
      const reviewHaystack = review ? buildReviewHaystack(review) : '';
      return {
        day,
        review,
        planHaystack,
        reviewHaystack,
        haystack: `${planHaystack} ${reviewHaystack}`.trim(),
      };
    })
    .sort((a, b) => b.day.tradeDate.localeCompare(a.day.tradeDate));
}

/** A trade that matched, with why it matched so the result card can say so. */
export interface SearchMatch {
  entry: SearchableTrade;
  reason: 'text' | 'tag' | 'pnl' | 'text+tag' | 'text+pnl';
}

/** A day (plan/review) that matched, with the field group that matched. */
export interface DayMatch {
  entry: SearchableDay;
  /** Which writing matched: the plan, the review, or both. */
  reason: 'plan' | 'review' | 'plan+review';
}

/**
 * Parses the raw query into what the matchers consume.
 *
 * Two forms are understood:
 * - "president speech"   → every word must appear somewhere (AND, not OR).
 * - ">100", "<-50", "pnl:75" → a P&L filter in dollars, with optional comparison.
 * A bare number ("75") is NOT a P&L filter — it stays text, so searching an entry price
 * or a numeric tag still works.
 */
export interface ParsedQuery {
  words: string[];
  pnlFilter: { op: '>' | '<' | '=' | '>=' | '<='; value: number } | null;
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim().toLowerCase();
  const pnlMatch = trimmed.match(/^(pnl:)?(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/);

  // "pnl:75" or ">75" or "<-50" is a money filter; "75" alone is text.
  if (pnlMatch && pnlMatch[1]) {
    return {
      words: [],
      pnlFilter: { op: (pnlMatch[2] as '>' | '<' | '=') ?? '=', value: Number(pnlMatch[3]) },
    };
  }
  if (pnlMatch && pnlMatch[2]) {
    return {
      words: [],
      pnlFilter: { op: pnlMatch[2] as '>' | '<' | '=', value: Number(pnlMatch[3]) },
    };
  }

  return { words: trimmed.split(/\s+/).filter(Boolean), pnlFilter: null };
}

function pnlMatches(pnl: number, filter: NonNullable<ParsedQuery['pnlFilter']>): boolean {
  switch (filter.op) {
    case '>':
      return pnl > filter.value;
    case '<':
      return pnl < filter.value;
    case '>=':
      return pnl >= filter.value;
    case '<=':
      return pnl <= filter.value;
    default:
      return Math.round(pnl * 100) / 100 === Math.round(filter.value * 100) / 100;
  }
}

/** Every word present in a lowercase blob. */
function allWordsIn(words: string[], haystack: string): boolean {
  return words.every((word) => haystack.includes(word));
}

/**
 * Runs the query against the trade index.
 *
 * Every word must match somewhere in the trade's text or tags; a P&L filter narrows
 * further. Words are also matched against tags as a whole phrase, so "president speech"
 * finds the trade tagged "President speech" even though no single field contains both
 * words in order.
 */
export function searchTrades(index: SearchableTrade[], query: string): SearchMatch[] {
  const parsed = parseQuery(query);
  if (parsed.words.length === 0 && !parsed.pnlFilter) return [];

  const matches: SearchMatch[] = [];

  for (const entry of index) {
    // A word is satisfied by the text blob, or by any tag containing it (which also
    // covers a multi-word tag matching its own words: "president speech" ⊇ "president").
    const wordsOk =
      parsed.words.length === 0 ||
      allWordsIn(parsed.words, entry.haystack) ||
      entry.tags.some((tag) => allWordsIn(parsed.words, tag));

    if (!wordsOk) continue;

    if (parsed.pnlFilter && !pnlMatches(entry.trade.grossPnL, parsed.pnlFilter)) continue;

    const byText = parsed.words.length > 0 && allWordsIn(parsed.words, entry.haystack);
    const byTag =
      parsed.words.length > 0 &&
      entry.tags.some((tag) => allWordsIn(parsed.words, tag));

    const reason: SearchMatch['reason'] = parsed.pnlFilter
      ? byText
        ? 'text+pnl'
        : 'pnl'
      : byTag && !byText
      ? 'tag'
      : 'text';

    matches.push({ entry, reason });
  }

  // Newest first: the journal is read most-recent-first everywhere else too.
  return matches.sort((a, b) => b.entry.trade.entryTime.localeCompare(a.entry.trade.entryTime));
}

/**
 * Runs the query against the day index (plan fields + review notes).
 *
 * P&L filters do not apply here — a day has no realized P&L of its own in this index;
 * trades already carry that. A plan or review matches only on words.
 */
export function searchDays(index: SearchableDay[], query: string): DayMatch[] {
  const parsed = parseQuery(query);
  if (parsed.words.length === 0) return [];

  const matches: DayMatch[] = [];

  for (const entry of index) {
    if (!allWordsIn(parsed.words, entry.haystack)) continue;

    // The two slices are stored separately, so "where did I write this" is exact:
    // a word in both lands as plan+review, not as whichever slice happened to be
    // searched first.
    const inPlan = allWordsIn(parsed.words, entry.planHaystack);
    const inReview =
      entry.reviewHaystack.length > 0 && allWordsIn(parsed.words, entry.reviewHaystack);

    const reason: DayMatch['reason'] = inPlan && inReview ? 'plan+review' : inReview ? 'review' : 'plan';
    matches.push({ entry, reason });
  }

  // buildDaySearchIndex already sorts newest first; keep that order.
  return matches;
}

// ---------------------------------------------------------------------------
// Autocomplete suggestions
// ---------------------------------------------------------------------------

export type SuggestionKind = 'tag' | 'setup' | 'symbol';

export interface SearchSuggestion {
  kind: SuggestionKind;
  /** What is inserted when chosen. */
  value: string;
  /** Extra context, e.g. "12 trades". */
  meta: string;
  /** Trades carrying this label, for the count and the result preview. */
  matchCount: number;
}

/**
 * Collects every searchable label in the journal, most-used first.
 *
 * Tags are the headline entry — that is the point of the feature — but setups and
 * symbols are offered too, because a trader remembers "that MNQ day" more often than
 * they remember which field they typed it into.
 */
export function buildSuggestions(index: SearchableTrade[]): SearchSuggestion[] {
  const tagCounts = new Map<string, number>();
  const setupCounts = new Map<string, number>();
  const symbolCounts = new Map<string, number>();

  for (const { trade, tags, symbol } of index) {
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    if (trade.setupName?.trim()) {
      const name = trade.setupName.trim();
      setupCounts.set(name, (setupCounts.get(name) ?? 0) + 1);
    }
    symbolCounts.set(symbol, (symbolCounts.get(symbol) ?? 0) + 1);
  }

  const suggestions: SearchSuggestion[] = [];

  for (const [tag, count] of tagCounts) {
    suggestions.push({
      kind: 'tag',
      value: tag,
      meta: `${count} trade${count === 1 ? '' : 's'}`,
      matchCount: count,
    });
  }
  for (const [name, count] of setupCounts) {
    suggestions.push({
      kind: 'setup',
      value: name,
      meta: `setup · ${count} trade${count === 1 ? '' : 's'}`,
      matchCount: count,
    });
  }
  for (const [symbol, count] of symbolCounts) {
    suggestions.push({
      kind: 'symbol',
      value: symbol,
      meta: `symbol · ${count} trade${count === 1 ? '' : 's'}`,
      matchCount: count,
    });
  }

  return suggestions.sort((a, b) => b.matchCount - a.matchCount || a.value.localeCompare(b.value));
}

/** Suggestions whose value contains the typed text, capped for a tidy dropdown. */
export function filterSuggestions(
  suggestions: SearchSuggestion[],
  query: string,
  limit = 8
): SearchSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return suggestions.slice(0, limit);
  return suggestions.filter((s) => s.value.toLowerCase().includes(q)).slice(0, limit);
}
