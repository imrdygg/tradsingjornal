/**
 * Measuring retrieval quality instead of assuming it.
 *
 * A similarity search that returns results always looks like it works. The failure it is prone
 * to is quiet: it returns the trader's charts, ranked by how much they LOOK alike, and the thing
 * that usually looks most alike is another chart drawn in the same style — the same indicator
 * layout, the same colours, the same zoom — rather than the same price structure. Nothing errors.
 * The search simply answers a different question than the one it was asked.
 *
 * The only way to notice that is to label a handful of examples by hand and check where the
 * genuinely-similar ones land in the ranking. That is what this module does, and it is
 * deliberately small: it computes standard retrieval measures over hand-labelled examples, and
 * it refuses to dress them up as anything more.
 *
 * Three positions are built into the shapes below, and they matter more than the arithmetic:
 *
 *   1. **A miss is a miss.** When nothing relevant is returned, the rank is null and the
 *      reciprocal rank is 0. It is never `Infinity`, and never a number large enough to look
 *      like a bad score rather than an absent one — a value that flows into an average as if it
 *      were a measurement is worse than no value at all.
 *   2. **A lookalike is its own finding.** The examples may name charts that resemble the query
 *      for reasons that are not the setup. Returning one of those is not a partial success; it
 *      is precisely the failure being measured, so it is counted separately and named.
 *   3. **A small labelled set proves nothing.** Below a handful of examples the average moves by
 *      a large fraction per case, so the report says so in plain words rather than presenting
 *      two decimal places as though they were a measurement. Nothing in here is a claim about
 *      whether a matched setup makes money: that needs an outcome, and this is about ranking.
 *
 * This is a harness, not a feature. It runs over labelled examples in tests, so a change to the
 * retrieval pipeline can be judged against the same cases it was judged against before.
 */

/**
 * The cut-offs precision is reported at.
 *
 * Four, chosen to bracket where a trader actually reads: one row is "did it get the top match
 * right", three is what fits on screen as the closest matches, and the last two say whether a
 * real match was buried rather than missing.
 */
export const MEMORY_EVAL_K_VALUES: readonly number[] = [1, 3, 5, 10];

/**
 * The fewest labelled examples that could support any statement about retrieval quality.
 *
 * Five is the same floor the outcome statistics use, and for the same reason: below it a single
 * case moves the average by tens of points, so what reads as a finding is arithmetic noise. Under
 * the floor the figures are still reported — they are true of these examples — and the report
 * says plainly that they cannot be generalised.
 */
const MEMORY_EVAL_MIN_CASES = 5;

/**
 * One hand-labelled example: a chart whose correct answers a human has written down.
 *
 * `lookalikeObservationIds` is the part that makes this worth doing. Listing only the relevant
 * ids would score a system that returns the same-looking chart of an unrelated setup as a
 * success, because nothing in the labels says otherwise. Naming the lookalikes explicitly is what
 * turns "it returned something plausible" into a measurable failure.
 */
export interface MemoryEvalReference {
  id: string;
  /** What the trader called this example, for the report. */
  label: string;
  /** Observation ids a correct retrieval should return. */
  relevantObservationIds: string[];
  /** Observation ids that LOOK similar but are not the same setup (chart-UI lookalikes). */
  lookalikeObservationIds?: string[];
}

/** What the system actually returned for one reference, best first. */
export interface MemoryEvalRun {
  referenceId: string;
  /** The ranked observation ids the system actually returned, best first. */
  rankedObservationIds: string[];
}

export interface MemoryEvalCaseResult {
  referenceId: string;
  label: string;
  /** 1-based rank of the first relevant id, or null when none was returned. */
  firstRelevantRank: number | null;
  reciprocalRank: number;
  precisionAtK: { k: number; precision: number }[];
  lookalikesReturned: string[];
  /** True when at least one relevant id was returned at all. */
  hit: boolean;
  /**
   * True when the reference named no relevant observations, so it cannot be scored at all.
   *
   * Kept because "the system returned nothing relevant" and "nobody said what relevant would
   * have looked like" are different findings, and a report that cannot tell them apart will
   * eventually present an unlabelled example as a retrieval failure.
   */
  labelledWithNoRelevant?: boolean;
}

export interface MemoryEvalReport {
  cases: MemoryEvalCaseResult[];
  hits: number;
  misses: number;
  meanReciprocalRank: number;
  meanPrecisionAtK: { k: number; precision: number }[];
  /** How many runs returned a chart the labels called a lookalike. */
  lookalikeIntrusions: number;
  warnings: string[];
}

/**
 * Removes repeated ids, keeping the first occurrence.
 *
 * Deliberate, and not a tidiness step: a ranking that lists the same observation twice has
 * retrieved ONE record, and counting it twice would credit the system with a precision it did
 * not achieve — the second copy would occupy a slot in the top-k that some other record never
 * got. Position is preserved, so the first, best placement is the one that counts.
 */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Rounds to four decimal places, and turns anything non-finite into 0 rather than NaN. */
function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

/**
 * Scores one reference against one run.
 *
 * Throws when the run names a different reference than the one handed in. That check exists
 * because the alternative is silent and awful: the ranking would be graded against another
 * example's labels and the report would look entirely normal while being about nothing.
 *
 * A returned id that is neither relevant nor a listed lookalike is not counted anywhere. It is
 * not a hit, and it is not an intrusion — the labels did not claim to know what it was, and
 * inventing a verdict for it would put noise into the measures.
 */
export function evaluateRun(
  reference: MemoryEvalReference,
  run: MemoryEvalRun,
  kValues: readonly number[] = MEMORY_EVAL_K_VALUES
): MemoryEvalCaseResult {
  if (run.referenceId !== reference.id) {
    throw new Error(
      `Evaluation run "${run.referenceId}" cannot be scored against reference "${reference.id}": ` +
        'the ranking would be graded against another example\u2019s labels, and the report would ' +
        'look normal while being about nothing.'
    );
  }

  const relevant = new Set(reference.relevantObservationIds ?? []);
  const lookalikes = new Set(reference.lookalikeObservationIds ?? []);
  const ranked = dedupe(run.rankedObservationIds ?? []);

  const firstIndex = ranked.findIndex((id) => relevant.has(id));
  const firstRelevantRank = firstIndex >= 0 ? firstIndex + 1 : null;
  // A miss scores 0, never Infinity. An enormous reciprocal rank would average away to nothing
  // and quietly flatter the system, whereas 0 correctly drags the mean down.
  const reciprocalRank = firstIndex >= 0 ? round4(1 / (firstIndex + 1)) : 0;

  const precisionAtK = kValues.map((k) => {
    if (!Number.isFinite(k) || k <= 0) return { k, precision: 0 };
    const top = ranked.slice(0, k);
    const found = top.filter((id) => relevant.has(id)).length;
    // The denominator is k, not the number of ids returned. A run that returns two ids when ten
    // were asked for has not achieved perfect precision over the two it managed; it failed to
    // fill the list, and using the shorter denominator would hide exactly that.
    return { k, precision: round4(found / k) };
  });

  return {
    referenceId: reference.id,
    label: reference.label,
    firstRelevantRank,
    reciprocalRank,
    precisionAtK,
    lookalikesReturned: ranked.filter((id) => lookalikes.has(id)),
    hit: firstIndex >= 0,
    labelledWithNoRelevant: relevant.size === 0,
  };
}

/**
 * Rolls a set of scored cases into one report.
 *
 * The averages cover only the cases that could actually be scored. A reference labelled with no
 * relevant observations names nothing to find, so averaging its inevitable zero into the means
 * would report a retrieval failure that was really a labelling gap — it is counted as a miss,
 * kept out of the averages, and named in the warnings.
 *
 * An empty input yields 0 rather than NaN, because a report that renders as `NaN` on a fresh
 * install is a report nobody trusts on the day it has something to say.
 */
export function summarizeEvaluation(
  results: readonly MemoryEvalCaseResult[],
  kValues: readonly number[] = MEMORY_EVAL_K_VALUES
): MemoryEvalReport {
  const cases = [...results];
  const hits = cases.filter((entry) => entry.hit).length;
  const misses = cases.length - hits;

  const scoreable = cases.filter((entry) => entry.labelledWithNoRelevant !== true);
  const unscoreable = cases.length - scoreable.length;

  const meanReciprocalRank = scoreable.length
    ? round4(scoreable.reduce((total, entry) => total + entry.reciprocalRank, 0) / scoreable.length)
    : 0;

  const meanPrecisionAtK = kValues.map((k) => {
    if (scoreable.length === 0) return { k, precision: 0 };
    let total = 0;
    for (const entry of scoreable) {
      const measured = entry.precisionAtK.find((point) => point.k === k);
      total += measured ? measured.precision : 0;
    }
    return { k, precision: round4(total / scoreable.length) };
  });

  const lookalikeIntrusions = cases.filter((entry) => entry.lookalikesReturned.length > 0).length;

  const warnings: string[] = [];
  if (cases.length === 0) {
    warnings.push('There are no labelled examples, so nothing has been measured at all.');
  } else {
    if (cases.length < MEMORY_EVAL_MIN_CASES) {
      warnings.push(
        `Only ${cases.length} labelled ${cases.length === 1 ? 'example' : 'examples'}. A set this ` +
          'small cannot support any claim about retrieval quality: one case moves the average by ' +
          'a large fraction, so these figures describe these examples and nothing beyond them.'
      );
    }
    if (unscoreable > 0) {
      warnings.push(
        `${unscoreable} labelled ${unscoreable === 1 ? 'example names' : 'examples name'} no ` +
          'relevant observations, so there is nothing to score them against. They are counted as ' +
          'misses and left out of the averages.'
      );
    }
    if (lookalikeIntrusions > 0) {
      warnings.push(
        `${lookalikeIntrusions} ${lookalikeIntrusions === 1 ? 'run returned' : 'runs returned'} a ` +
          'chart that was labelled as a lookalike rather than the same setup. That is the failure ' +
          'this harness exists to notice, and it is not a partial hit.'
      );
    }
    warnings.push(
      'These figures describe how the system ranks the examples that were labelled by hand. They ' +
        'are not a measured edge: a resemblance is not a probability, and nothing here says ' +
        'whether a matched setup makes money. That would need recorded outcomes.'
    );
  }

  return {
    cases,
    hits,
    misses,
    meanReciprocalRank,
    meanPrecisionAtK,
    lookalikeIntrusions,
    warnings,
  };
}
