import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Search, Sparkles, TriangleAlert } from 'lucide-react';
import type { MemorySearch } from '../../types';
import { listMemorySearches, pruneMemorySearches } from '../../lib/memory/db';
import {
  MEMORY_EVAL_K_VALUES,
  evaluateRun,
  summarizeEvaluation,
  type MemoryEvalCaseResult,
} from '../../lib/memory/evaluation';
import { evaluationSourcesFromSavedSearches } from '../../lib/memory/eval-sources';

/**
 * Whether the similarity search is actually finding anything, measured rather than assumed.
 *
 * A search that returns results always looks like it works. The failure it is prone to is silent:
 * it returns the trader's charts ranked by how much they LOOK alike, and the thing that most often
 * looks alike is another chart drawn in the same style rather than the same price structure. Nothing
 * errors, and the answer is about a different question than the one that was asked.
 *
 * The only way to notice that is to compare what the search returned against what a human said was
 * actually similar, which is what this screen does — using the verdicts the trader already gave on
 * their own past searches, so nothing extra has to be labelled by hand.
 *
 * Two things this screen is careful about:
 *
 *   1. **It reports, it does not congratulate.** Every figure is shown beside the number of examples
 *      it came from and beside the warnings the harness produced. A mean over three searches is
 *      arithmetic, not a finding, and the panel says so in the harness's own words rather than
 *      applying its own threshold — one place decides when a sample is too thin to mean anything.
 *      The thresholds are not duplicated here, because two copies of a floor eventually disagree.
 *   2. **None of this is about money.** The figures describe where a chart the trader called similar
 *      was found in a list. They say nothing about whether a setup makes money; that needs recorded
 *      outcomes, which the memory tab shows elsewhere and separately.
 */

export interface MemoryEvaluationViewProps {
  /**
   * The saved searches to score.
   *
   * Optional so the screen can be dropped in on its own: left out, it reads them from the journal's
   * own storage on mount, which is what lets it stand beside a container that already holds them
   * without fetching twice.
   */
  searches?: readonly MemorySearch[];
  /** How many saved searches to read when loading them itself. */
  limit?: number;
  /**
   * The retention window, in days. A number turns on the prune control, because clearing old
   * searches is a decision about the trader's own history and is only offered where the window it
   * would apply is known.
   */
  retentionDays?: number;
  /** Called after a prune, with how many searches went. */
  onPruned?: (removed: number) => void;
}

const Card: React.FC<{
  id?: string;
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ id, title, icon, subtitle, children }) => (
  <section
    id={id}
    className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5"
  >
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold tracking-tight text-zinc-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{subtitle}</p>}
        <div className="mt-3">{children}</div>
      </div>
    </div>
  </section>
);

/**
 * A share of a returned list, as a whole percentage.
 *
 * Deliberately not `formatMemoryRate` from the outcomes module: that formats an *outcome* rate and
 * renders a withheld one as "not enough cases". A precision is a share of a list and is never
 * withheld, so reusing that formatter would put one meaning's wording onto another meaning's number.
 */
function formatShare(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** The rank of the first real match, in words rather than as a bare number. */
function describeRank(rank: number | null): string {
  if (rank === null) return 'nothing similar was returned';
  if (rank === 1) return 'the closest chart';
  if (rank === 2) return 'the second chart';
  if (rank === 3) return 'the third chart';
  return `position ${rank}`;
}

export const MemoryEvaluationView: React.FC<MemoryEvaluationViewProps> = ({
  searches: providedSearches,
  limit = 50,
  retentionDays,
  onPruned,
}) => {
  const [loaded, setLoaded] = useState<MemorySearch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pruneNote, setPruneNote] = useState<string | null>(null);
  const [pruning, setPruning] = useState(false);

  useEffect(() => {
    // A container that already has the searches hands them over, and nothing is read again.
    if (providedSearches) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    listMemorySearches(limit)
      .then((rows) => {
        if (!cancelled) setLoaded(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Your saved searches could not be read, so nothing could be measured.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providedSearches, limit]);

  const searches = providedSearches ?? loaded ?? [];

  const sources = useMemo(() => evaluationSourcesFromSavedSearches(searches), [searches]);

  /**
   * Every judged example scored, and the report rolled up from them.
   *
   * The run for a reference is looked up BY ID rather than by position. The harness throws when a
   * ranking is scored against another example's labels, and one dropped entry would otherwise pair
   * every case with the wrong labels while the report went on looking normal.
   */
  const report = useMemo(() => {
    const runsById = new Map(sources.runs.map((run) => [run.referenceId, run]));
    const cases: MemoryEvalCaseResult[] = [];

    for (const reference of sources.references) {
      const run = runsById.get(reference.id);
      if (!run) continue;
      cases.push(evaluateRun(reference, run));
    }

    return summarizeEvaluation(cases, MEMORY_EVAL_K_VALUES);
  }, [sources]);

  // Warnings from both halves, in one list: the ones about the inputs (nothing judged, a malformed
  // row) and the ones about the measurement (too few examples, lookalikes returned). A screen that
  // showed only one kind would let the other go unread.
  const warnings = useMemo(
    () => [...sources.warnings, ...report.warnings],
    [sources.warnings, report.warnings]
  );

  const caseCount = report.cases.length;
  const judgedRatio = sources.counts.searches > 0 ? caseCount / sources.counts.searches : 0;

  async function handlePrune() {
    if (typeof retentionDays !== 'number') return;
    setPruning(true);
    setPruneNote(null);
    try {
      const removed = await pruneMemorySearches(retentionDays);
      setPruneNote(
        removed === 0
          ? `Nothing was older than ${retentionDays} days.`
          : `${removed} ${removed === 1 ? 'search' : 'searches'} older than ${retentionDays} days ${removed === 1 ? 'was' : 'were'} removed.`
      );
      onPruned?.(removed);
      // A pruned search is gone from the evidence too, so the list is re-read rather than left
      // showing rows that no longer exist.
      if (!providedSearches) setLoaded(await listMemorySearches(limit));
    } catch (err: unknown) {
      setPruneNote(
        err instanceof Error ? err.message : 'The old searches could not be removed just now.'
      );
    } finally {
      setPruning(false);
    }
  }

  return (
    <div id="memory-evaluation" className="space-y-5">
      {loading && (
        <p id="memory-evaluation-loading" className="px-1 text-xs text-zinc-400">
          Reading your saved searches…
        </p>
      )}

      {error && (
        <div
          id="memory-evaluation-error"
          className="flex items-start gap-2 rounded-2xl border border-rose-900/60 bg-rose-950/30 p-4"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-rose-200">
              Your saved searches could not be read
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-rose-200/80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && searches.length === 0 && (
        <Card
          id="memory-evaluation-empty-none"
          title="Nothing has been searched yet"
          icon={<Search className="h-3.5 w-3.5" />}
          subtitle="This screen measures the similarity search against your own verdicts on what it returned. It has nothing to read until you have run a search and said which results were the same setup."
        >
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Run a search from a chart you have already recorded, then mark its results as a{' '}
            <span className="text-zinc-300">strong match</span>, a{' '}
            <span className="text-zinc-300">partial match</span>, or{' '}
            <span className="text-zinc-300">the wrong setup</span>. Those verdicts are what this
            screen scores — nothing else is asked of you.
          </p>
        </Card>
      )}

      {!loading && !error && searches.length > 0 && caseCount === 0 && (
        <Card
          id="memory-evaluation-empty-unjudged"
          title="Saved searches, but no verdicts on them yet"
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          subtitle={`${sources.counts.searches} saved ${
            sources.counts.searches === 1 ? 'search has' : 'searches have'
          } no verdict on any result, so there is nothing yet that says what a correct answer would have been.`}
        >
          <p className="text-[11px] leading-relaxed text-zinc-400">
            A search nobody judged is not a search that failed — it is one that was never marked. Open
            a saved search and mark a few of its results; each verdict becomes a labelled example
            here. Marking a result as the wrong setup is as useful as marking one as a strong match,
            because it says what the search should not have returned.
          </p>
        </Card>
      )}

      {error === null && caseCount > 0 && (
        <>
          {/* ---- What these numbers are about ---- */}
          <Card
            id="memory-eval-scope"
            title="What is being measured"
            icon={<Info className="h-3.5 w-3.5" />}
            subtitle="Where a chart you called similar was found in the list the search returned."
          >
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Each example below is one of your saved searches, scored against the verdicts you gave
              its results. A <span className="text-zinc-300">strong</span> or{' '}
              <span className="text-zinc-300">partial</span> verdict says the search should have
              returned that chart; a <span className="text-zinc-300">wrong</span> verdict says it
              looks like your chart without being the same setup, which is the mistake this screen
              exists to notice. These figures describe ranking only — nothing here says whether a
              setup makes money, and nothing here is a prediction.
            </p>
          </Card>

          {/* ---- What the figures cannot support, said before the figures ---- */}
          {warnings.length > 0 && (
            <Card
              id="memory-eval-caveats"
              title="What these figures cannot support"
              icon={<TriangleAlert className="h-3.5 w-3.5" />}
              subtitle="Read with the numbers, not after them."
            >
              <ul id="memory-evaluation-warnings" className="space-y-2">
                {warnings.map((warning, index) => (
                  <li
                    key={`${index}-${warning.slice(0, 24)}`}
                    id={`memory-eval-warning-${index}`}
                    className="flex items-start gap-2 rounded-xl border border-amber-900/40 bg-amber-950/20 p-2.5"
                  >
                    <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                    <span className="min-w-0 text-[10px] leading-relaxed text-amber-100/90">
                      {warning}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ---- The figures ---- */}
          <Card
            id="memory-eval-figures"
            title="Retrieval quality"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            subtitle={`From ${caseCount} labelled ${
              caseCount === 1 ? 'example' : 'examples'
            } — ${sources.counts.judged} judged of ${sources.counts.searches} saved ${
              sources.counts.searches === 1 ? 'search' : 'searches'
            }.`}
          >
            <div id="memory-eval-figures-grid" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: 'Found something similar',
                  value: `${report.hits}`,
                  note: `of ${caseCount}`,
                },
                {
                  label: 'Found nothing similar',
                  value: `${report.misses}`,
                  note: `of ${caseCount}`,
                },
                {
                  label: 'Average placement',
                  value: report.meanReciprocalRank.toFixed(2),
                  note: '1.00 is always first',
                },
                {
                  label: 'Lookalikes returned',
                  value: `${report.lookalikeIntrusions}`,
                  note: `of ${caseCount}`,
                },
              ].map((figure) => (
                <div
                  key={figure.label}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-center"
                >
                  <div className="font-mono text-base font-semibold text-zinc-100">
                    {figure.value}
                  </div>
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">
                    {figure.label}
                  </div>
                  <div className="text-[9px] text-zinc-600">{figure.note}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Share of the first few results that were the same setup
              </p>
              <div className="grid grid-cols-4 gap-2">
                {report.meanPrecisionAtK.map((point) => (
                  <div
                    key={point.k}
                    id={`memory-eval-precision-${point.k}`}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1.5 text-center"
                  >
                    <div className="font-mono text-sm text-zinc-100">
                      {formatShare(point.precision)}
                    </div>
                    <div className="text-[9px] text-zinc-500">first {point.k}</div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                The divisor is the number of results asked for, not the number returned, so a list
                that came back short is not credited with filling it.{' '}
                <span className="text-zinc-400">Average placement</span> is the mean of 1 ÷ the
                position of the first genuinely similar chart: 1.00 means it was always the closest,
                and a search that found nothing counts as zero rather than being left out.
              </p>
            </div>
          </Card>

          {/* ---- Case by case ---- */}
          <Card
            id="memory-eval-cases"
            title="Example by example"
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            subtitle="The aggregate can hide one search that went badly. These are the cases it was built from."
          >
            <ul className="space-y-2">
              {report.cases.map((entry) => (
                <li
                  key={entry.referenceId}
                  id={`memory-eval-case-${entry.referenceId}`}
                  data-hit={entry.hit}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2.5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 text-[11px] font-semibold text-zinc-200">
                      {entry.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[10px]">
                      {entry.hit ? (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          {describeRank(entry.firstRelevantRank)}
                        </span>
                      ) : (
                        <span
                          id={`memory-eval-case-${entry.referenceId}-miss`}
                          className="flex items-center gap-1 text-rose-300"
                        >
                          <AlertCircle className="h-3 w-3" />
                          {entry.labelledWithNoRelevant
                            ? 'no result was marked similar'
                            : describeRank(null)}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-zinc-500">
                    <span>
                      placement:{' '}
                      <span className="font-mono text-zinc-300">
                        {entry.reciprocalRank.toFixed(2)}
                      </span>
                    </span>
                    {entry.precisionAtK
                      .filter((point) => point.k === 3)
                      .map((point) => (
                        <span key={point.k}>
                          first 3:{' '}
                          <span className="font-mono text-zinc-300">
                            {formatShare(point.precision)}
                          </span>
                        </span>
                      ))}
                    {entry.lookalikesReturned.length > 0 && (
                      <span className="text-amber-300">
                        {entry.lookalikesReturned.length} returned chart
                        {entry.lookalikesReturned.length === 1 ? '' : 's'} you called the wrong setup
                      </span>
                    )}
                    {entry.labelledWithNoRelevant && (
                      <span className="text-zinc-500">
                        nothing here was marked similar, so this example is not part of the averages
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* ---- Retention ---- */}
          {typeof retentionDays === 'number' && (
            <Card
              id="memory-eval-retention"
              title="Saved searches"
              icon={<Info className="h-3.5 w-3.5" />}
              subtitle={`Searches are kept for ${retentionDays} days so this screen has something to measure, then cleared.`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  id="memory-eval-prune"
                  onClick={handlePrune}
                  disabled={pruning}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
                >
                  {pruning ? 'Removing…' : `Remove searches older than ${retentionDays} days`}
                </button>
                {pruneNote && (
                  <span id="memory-eval-prune-note" className="text-[10px] text-zinc-400">
                    {pruneNote}
                  </span>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {error === null && caseCount > 0 && (
        <p className="px-1 text-[10px] leading-relaxed text-zinc-600">
          These figures describe how the search ordered the examples that were judged by hand
          ({Math.round(judgedRatio * 100)}% of your saved searches). A resemblance is not a
          probability, and nothing on this screen says anything about what a chart will do next.
        </p>
      )}
    </div>
  );
};
