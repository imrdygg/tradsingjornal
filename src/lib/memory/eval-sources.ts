/**
 * Turning the trader's own saved searches into evaluation inputs.
 *
 * `evaluation.ts` is a harness: it scores a ranking against hand-written labels. It deliberately
 * knows nothing about where either came from, because a harness that reads its own inputs is a
 * harness that can quietly feed itself the answer. This module is the adapter, and it is where the
 * only real judgement in Phase 6 lives — deciding what a trader's verdict on a returned chart means
 * as a label.
 *
 * The verdicts map onto the harness's two label lists exactly:
 *
 *   - `'strong'` and `'partial'` say *this is the same setup*, so the observation is relevant.
 *   - `'wrong'` says *this looks like my chart but it is not the same setup*. That is not merely an
 *     irrelevant row — it is the precise failure the harness was built to detect, and the harness
 *     has a name for it: a lookalike. It goes in `lookalikeObservationIds`, so an intrusion is
 *     counted and named rather than disappearing into a list of rows nobody labelled.
 *
 * ## The one rule worth stating out loud
 *
 * **The ranking is exactly what the system returned, in the order it returned it. The verdicts only
 * label it.**
 *
 * Nothing is dropped, reordered or promoted between the saved answer and the ranking handed to the
 * harness — not the rows marked `'wrong'`, not the rows the trader never judged. This is not
 * tidiness. Removing a row marked `'wrong'` from a ranking would lift every row below it, which
 * means a search that put its only real match at rank 3 behind two lookalikes would be scored as
 * though it had returned that match at rank 1. The reciprocal rank would improve, the intrusion
 * count would fall to zero, and the report would read better for having had evidence removed from
 * it. There is no version of that which is measurement.
 *
 * The same reasoning applies to an unjudged row sitting between two judged ones: the trader did not
 * say what it was, so the harness scores it as neither a hit nor an intrusion — but it still
 * occupied a position, and a position is part of what is being measured.
 *
 * Pure: no supabase, no fetch, no React. Everything here is a function of the searches handed in,
 * so the adapter can be tested against fixtures and reasoned about on its own.
 */

import type { MemoryMatchFeedback, MemorySearch, MemorySearchMatch } from '../../types';
import type { MemoryEvalReference, MemoryEvalRun } from './evaluation';

/** The verdicts that mean "this is the same setup". */
export const MEMORY_EVAL_RELEVANT_VERDICTS: readonly MemoryMatchFeedback[] = ['strong', 'partial'];

/** The verdict that means "it looks similar and it is not the same setup". */
export const MEMORY_EVAL_LOOKALIKE_VERDICT: MemoryMatchFeedback = 'wrong';

/** The verdicts this module understands. Anything else is treated as no verdict at all. */
const KNOWN_VERDICTS: readonly MemoryMatchFeedback[] = [
  ...MEMORY_EVAL_RELEVANT_VERDICTS,
  MEMORY_EVAL_LOOKALIKE_VERDICT,
];

function isKnownVerdict(value: unknown): value is MemoryMatchFeedback {
  return typeof value === 'string' && (KNOWN_VERDICTS as readonly string[]).includes(value);
}

/** How many searches were read, judged, ignored, and what the verdicts came to. */
export interface MemoryEvaluationSourceCounts {
  /** Saved searches that could be read and considered. */
  searches: number;
  /** How many of those became a labelled example. */
  judged: number;
  /**
   * How many carried no verdict at all.
   *
   * Counted rather than ignored because it is the number that explains an empty report. A screen
   * that showed "0 examples" to a trader who has made thirty searches, without saying that none of
   * them was judged, would be blaming the retrieval system for a missing step the trader can take.
   */
  unjudged: number;
  /** Entries that were not readable as a search at all, so nothing could be said about them. */
  skipped: number;
  strong: number;
  partial: number;
  wrong: number;
  /** Result rows inside judged searches that the trader left alone. */
  unjudgedMatches: number;
}

export interface MemoryEvaluationSources {
  references: MemoryEvalReference[];
  /** One run per reference, aligned BY REFERENCE ID rather than by position. */
  runs: MemoryEvalRun[];
  counts: MemoryEvaluationSourceCounts;
  /** Plain-language notes about what the inputs do and do not support. */
  warnings: string[];
}

export interface MemoryEvaluationSourceOptions {
  /**
   * The most recent {@link limit} JUDGED searches to score.
   *
   * Capped rather than unlimited because the report is read by a person: past a few dozen cases the
   * figures stop moving and the per-case list stops being read, while the label set continues to be
   * dominated by whatever the trader happened to judge first.
   */
  limit?: number;
}

/** A list of verdict counts, plus the row count, for one search. */
interface SearchVerdicts {
  relevant: string[];
  lookalikes: string[];
  unjudged: number;
  strong: number;
  partial: number;
  wrong: number;
}

/**
 * Sorts with a total order, and puts an unreadable timestamp last.
 *
 * Total because the report has to be the same twice: a list that reshuffles between two identical
 * reads cannot be compared against a change that was made to the retrieval pipeline. An unparseable
 * date is not an error worth refusing a search over — it is only a sort key — so it goes to the end
 * rather than throwing the example away.
 */
function instantOf(value: unknown): number {
  if (typeof value !== 'string') return Number.POSITIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function isReadableSearch(value: unknown): value is MemorySearch {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MemorySearch>;
  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') return false;
  return Array.isArray(candidate.matches);
}

/**
 * Reads the verdicts off one search's matches, and the two label lists they imply.
 *
 * Rows with no verdict, or a verdict this build does not recognise, are counted as unjudged and
 * appear in neither list. An unrecognised value is deliberately NOT guessed at: a verdict written by
 * a newer build is not evidence for this one.
 */
function readVerdicts(matches: readonly MemorySearchMatch[]): SearchVerdicts {
  const relevant: string[] = [];
  const lookalikes: string[] = [];
  let unjudged = 0;
  let strong = 0;
  let partial = 0;
  let wrong = 0;

  for (const match of matches) {
    if (!match || typeof match.observationId !== 'string' || match.observationId === '') continue;
    const verdict = match.feedback;
    if (!isKnownVerdict(verdict)) {
      unjudged += 1;
      continue;
    }
    if (verdict === MEMORY_EVAL_LOOKALIKE_VERDICT) {
      wrong += 1;
      lookalikes.push(match.observationId);
      continue;
    }
    if (verdict === 'strong') strong += 1;
    else partial += 1;
    relevant.push(match.observationId);
  }

  return { relevant, lookalikes, unjudged, strong, partial, wrong };
}

/**
 * The ranked list, exactly as it was returned.
 *
 * Every readable row, in stored order, including the ones judged `'wrong'` and the ones never
 * judged. See the module header for why nothing is filtered out of here.
 */
function rankingOf(matches: readonly MemorySearchMatch[]): string[] {
  const ranked: string[] = [];
  for (const match of matches) {
    if (!match || typeof match.observationId !== 'string' || match.observationId === '') continue;
    ranked.push(match.observationId);
  }
  return ranked;
}

/**
 * What to call one example in the report.
 *
 * The date and the filters, because those are what the trader recognises a search by — a list of
 * opaque ids would be unreadable, and the per-case rows are the part of the report that says *where*
 * the ranking went wrong. The day is taken from the stored string rather than reformatted through a
 * locale, so the same search reads the same on every machine.
 */
export function savedSearchLabel(search: MemorySearch): string {
  const day =
    typeof search.searchedAt === 'string' && search.searchedAt.length >= 10
      ? search.searchedAt.slice(0, 10)
      : 'date not recorded';
  const filters = search.filters ?? {};
  const parts = [filters.instrument, filters.timeframe, filters.setupName].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  return parts.length > 0 ? `${day} — ${parts.join(' · ')}` : day;
}

/**
 * Builds the harness's inputs from the searches the trader has saved and judged.
 *
 * The two arrays are returned together and must be joined BY REFERENCE ID, never by position: the
 * harness throws when a run is scored against another example's reference, and one dropped or
 * reordered entry would otherwise pair every ranking with the wrong labels while the report went on
 * looking normal.
 */
export function evaluationSourcesFromSavedSearches(
  searches: readonly MemorySearch[] | null | undefined,
  options: MemoryEvaluationSourceOptions = {}
): MemoryEvaluationSources {
  const references: MemoryEvalReference[] = [];
  const runs: MemoryEvalRun[] = [];
  const warnings: string[] = [];

  const counts: MemoryEvaluationSourceCounts = {
    searches: 0,
    judged: 0,
    unjudged: 0,
    skipped: 0,
    strong: 0,
    partial: 0,
    wrong: 0,
    unjudgedMatches: 0,
  };

  if (!Array.isArray(searches)) {
    warnings.push(
      'No saved searches were handed in, so there is nothing to measure. This is a missing input ' +
        'rather than a result about the search.'
    );
    return { references, runs, counts, warnings };
  }

  // Ordered first, then deduplicated, so which copy of a repeated id survives does not depend on
  // the order the database happened to return the rows in.
  // `filter` already returns a new array, so sorting it does not touch the caller's list.
  const ordered = searches
    .filter(isReadableSearch)
    .sort((a, b) => instantOf(a.searchedAt) - instantOf(b.searchedAt) || a.id.localeCompare(b.id));

  counts.skipped = searches.length - ordered.length;
  if (counts.skipped > 0) {
    warnings.push(
      `${counts.skipped} saved ${
        counts.skipped === 1 ? 'search' : 'searches'
      } could not be read as a search and ${counts.skipped === 1 ? 'was' : 'were'} left out.`
    );
  }

  const seen = new Set<string>();
  const considered: MemorySearch[] = [];
  for (const search of ordered) {
    if (seen.has(search.id)) continue;
    seen.add(search.id);
    considered.push(search);
  }
  counts.searches = considered.length;

  for (const search of considered) {
    const matches = (search.matches ?? []).filter(
      (match): match is MemorySearchMatch => Boolean(match) && typeof match === 'object'
    );
    const verdicts = readVerdicts(matches);

    counts.strong += verdicts.strong;
    counts.partial += verdicts.partial;
    counts.wrong += verdicts.wrong;
    counts.unjudgedMatches += verdicts.unjudged;

    // A search the trader never judged is not evidence about retrieval quality. It is NOT turned
    // into a reference with no relevant ids either: that would make the harness count a miss the
    // system did not make, and warn about a labelling gap that does not exist. It is simply not an
    // example, and it is counted so the report can say so.
    if (verdicts.strong + verdicts.partial + verdicts.wrong === 0) {
      counts.unjudged += 1;
      continue;
    }

    references.push({
      id: search.id,
      label: savedSearchLabel(search),
      // Empty is a real outcome here — it is what a search whose every verdict was 'wrong' produces,
      // and it is the input that makes the harness mark the case `labelledWithNoRelevant` and keep
      // it out of the averages instead of scoring an inevitable zero as a retrieval failure.
      relevantObservationIds: verdicts.relevant,
      lookalikeObservationIds: verdicts.lookalikes,
    });

    runs.push({ referenceId: search.id, rankedObservationIds: rankingOf(matches) });
  }

  counts.judged = references.length;

  if (counts.judged === 0) {
    warnings.push(
      counts.unjudged > 0
        ? `None of your ${counts.unjudged} saved ${
            counts.unjudged === 1 ? 'search has' : 'searches have'
          } a verdict on any result, so there is nothing to measure yet. Mark a few results as a ` +
          'strong or partial match, or as the wrong setup, and they will be scored here.'
        : 'There are no saved searches to measure yet.'
    );
  }

  if (counts.unjudgedMatches > 0 && counts.judged > 0) {
    warnings.push(
      `${counts.unjudgedMatches} returned ${
        counts.unjudgedMatches === 1 ? 'result was' : 'results were'
      } left unjudged. They are counted as neither a hit nor a lookalike, but they keep their place ` +
        'in the ranking — a row that was never judged still occupied a position.'
    );
  }

  // Applied after the counts are taken, so the report never claims a total it did not read.
  const limit = options.limit;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0 && limit < references.length) {
    const keepFrom = references.length - Math.floor(limit);
    const keptReferences = references.slice(keepFrom);
    const keptIds = new Set(keptReferences.map((reference) => reference.id));
    const keptRuns = runs.filter((run) => keptIds.has(run.referenceId));
    if (limit < references.length) {
      warnings.push(
        `Showing the ${Math.floor(limit)} most recent of ${references.length} judged ${
          references.length === 1 ? 'search' : 'searches'
        }.`
      );
    }
    return { references: keptReferences, runs: keptRuns, counts, warnings };
  }

  return { references, runs, counts, warnings };
}

/**
 * Just the labelled examples, for a caller that only wants to score something else.
 *
 * Thin on purpose: it is the same slice the function above returns, so the two can never disagree
 * about which searches count as judged.
 */
export function referencesFromSavedSearches(
  searches: readonly MemorySearch[] | null | undefined,
  options: MemoryEvaluationSourceOptions = {}
): MemoryEvalReference[] {
  return evaluationSourcesFromSavedSearches(searches, options).references;
}

/** Just the rankings, aligned to {@link referencesFromSavedSearches} by reference id. */
export function runsFromSavedSearches(
  searches: readonly MemorySearch[] | null | undefined,
  options: MemoryEvaluationSourceOptions = {}
): MemoryEvalRun[] {
  return evaluationSourcesFromSavedSearches(searches, options).runs;
}
