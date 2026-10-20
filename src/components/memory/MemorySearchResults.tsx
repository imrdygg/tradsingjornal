import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarClock,
  ImageOff,
  Layers,
  Minus,
  Search,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  MemoryMatchFeedback,
  Trade,
  TradingObservation,
} from '../../types';
import { formatTimestamp } from '../../lib/storage/date-utils';
import {
  MEMORY_RESEMBLANCE_GOOD,
  MEMORY_RESEMBLANCE_STRONG,
  memoryResemblanceBand,
  type MemoryResemblanceBand,
  type RankedMemoryMatch,
} from '../../lib/memory/similarity';
import {
  buildMemoryEvidence,
  marketOutcomeSample,
  tradeResultSample,
  type MemoryEvidence,
} from '../../lib/memory/results';
import { formatMemoryRate } from '../../lib/memory/outcomes';
import { ImageLightboxModal } from '../common/ImageLightboxModal';

/**
 * The result of one similarity search, as the trader reads it.
 *
 * A presentation component on purpose: every fact here arrives as a prop, so the one thing this
 * file can get wrong is how something is *said*. That is deliberate, because what it says is the
 * part that matters. The engine upstream already decided which charts are close and how close;
 * this screen decides whether "close" is allowed to sound like "likely".
 *
 * Three lines are held here and nowhere else:
 *
 *   1. **A resemblance is a resemblance.** It is never a chance, a chance of success, a hit rate or
 *      a forecast. The score is rendered as a percentage of visual closeness beside a plain word for
 *      the band it falls in, and the copy says what it measured — two pictures — rather than what it
 *      might imply about the future. Nothing in this file suggests that a chart resembling a past
 *      one implies anything about the next trade.
 *   2. **What the market did and what the trader did are two separate facts.** They are shown in
 *      their own labelled slots and never averaged into one number or one verdict. A matched case
 *      found on a chart with no recorded outcome says so in words; it is never rendered as a zero,
 *      because a zero is a reading and this is the absence of one.
 *   3. **A resemblance is never shown without the floor to read it against.** The threshold that
 *      decided what counts as a match is displayed next to the scores it produced, so a 58% here
 *      cannot be compared against a 58% from a search that was configured differently.
 */

/** One ranked match together with everything the screen needs to describe it. */
export interface MemorySearchResult {
  /** The ranked match, carrying the resemblance it was shown at. */
  match: RankedMemoryMatch;
  /** The observation behind it, when the journal still holds it. */
  observation?: TradingObservation;
  /** The executed trade this observation was taken under, when there was one. */
  trade?: Trade;
  /**
   * A displayable URL for the matched picture.
   *
   * Passed in rather than resolved here: the picture lives in a private bucket and every read of it
   * is a short-lived signed URL, which is a fetch, and this component does none.
   */
  imageUrl?: string;
}

/**
 * Why a search came back with nothing.
 *
 * Four states rather than one, because they call for four different actions: index something, lower
 * the floor, loosen the filters, or accept that the library genuinely holds nothing like this. A
 * single "no results" panel would send the trader to the wrong one of those.
 */
export type MemorySearchEmptyReason =
  | 'nothing-searchable'
  | 'all-below-floor'
  | 'filters-excluded'
  | 'no-matches';

export interface MemorySearchResultsProps {
  results: MemorySearchResult[];
  /**
   * The resemblance a picture had to reach to be listed, as it was in force when the search ran.
   *
   * Required, not optional: a resemblance is only readable against the threshold that produced it,
   * and a default here would silently describe the search using a floor it did not use.
   */
  floor: number;
  /** A displayable URL for the chart that was searched with. */
  queryImageUrl?: string;
  /** What that chart is, in the trader's words. Used as its caption in the comparison. */
  queryLabel?: string;
  /** How many candidates scored under the floor and were therefore not listed. */
  belowFloor?: number;
  /** How many candidates were dropped because a closer picture of the same observation won. */
  duplicateObservations?: number;
  /** True while the search is still running. */
  busy?: boolean;
  /** How many pictures in the library are searchable at all, which the empty state reads. */
  searchableCount?: number;
  /** Whether any filter was narrowing the search, which the empty state reads. */
  filtersActive?: boolean;
  /** The trader's own verdicts, keyed by observation id. */
  verdicts?: Record<string, MemoryMatchFeedback | undefined>;
  /** Records the trader's verdict. Absent hides the verdict controls entirely. */
  onVerdict?: (observationId: string, verdict: MemoryMatchFeedback) => void;
  /** Opens the full record behind a match. */
  onOpenMatch?: (result: MemorySearchResult) => void;
  /** A symbol for an instrument id, so a trade can be described without a lookup table here. */
  symbolFor?: (instrumentId: string) => string;
  /** The trader's timezone, for the timestamps. */
  timezone?: string;
  /** Controlled selection for the comparison view. Uncontrolled when absent. */
  selectedObservationId?: string;
}

/**
 * Chooses the sentence for an empty search.
 *
 * Exported and pure so the choice can be asserted rather than eyeballed: the order of the checks is
 * the whole logic, and the interesting case is a library that has been indexed but whose only
 * pictures all scored under the floor — which is not the same as an empty library and must not say
 * so.
 */
export function memorySearchEmptyReason(input: {
  searchableCount?: number;
  belowFloor?: number;
  filtersActive?: boolean;
}): MemorySearchEmptyReason {
  if (!input.searchableCount) return 'nothing-searchable';
  if ((input.belowFloor ?? 0) > 0) return 'all-below-floor';
  if (input.filtersActive) return 'filters-excluded';
  return 'no-matches';
}

const EMPTY_COPY: Record<MemorySearchEmptyReason, string> = {
  'nothing-searchable':
    'No pictures in your library are searchable yet, so there is nothing to compare against. ' +
    'Indexing is what makes a chart findable, and it only happens for pictures you have allowed ' +
    'to be sent.',
  'all-below-floor':
    'Every candidate came back under the resemblance floor, so none is listed. The library does ' +
    'hold things that were compared — you can lower the floor to see the closer of them, and a ' +
    'low score is still just two charts looking unlike each other.',
  'filters-excluded':
    'The search found candidates but every one of them was filtered out. Widening the instrument, ' +
    'timeframe or date range is what changes that; lowering the floor will not.',
  'no-matches':
    'Nothing in the library scored high enough to be listed, and nothing scored just under the ' +
    'floor either. This is a real answer about what you have recorded, not a failure.',
};

/** The word shown beside a resemblance, so the number is never read as a verdict. */
const BAND_LABEL: Record<MemoryResemblanceBand, string> = {
  strong: 'very close',
  good: 'close',
  modest: 'loosely alike',
  below: 'below the floor',
};

/** How a band is coloured. Deliberately not green/red: nothing here is a pass or a fail. */
const BAND_CLASS: Record<MemoryResemblanceBand, string> = {
  strong: 'border-sky-900/70 bg-sky-950/50 text-sky-300',
  good: 'border-indigo-900/70 bg-indigo-950/50 text-indigo-300',
  modest: 'border-zinc-700 bg-zinc-800/70 text-zinc-300',
  below: 'border-zinc-800 bg-zinc-950/60 text-zinc-500',
};

/** The trader's own wording for a verdict, used on the buttons and on a recorded match. */
const VERDICT_LABEL: Record<MemoryMatchFeedback, string> = {
  strong: 'A real match',
  partial: 'Partly alike',
  wrong: 'Not the same thing',
};

function bandHint(band: MemoryResemblanceBand, floor: number): string {
  switch (band) {
    case 'strong':
      return `At or above ${MEMORY_RESEMBLANCE_STRONG}%: the two charts sit very close in the image model.`;
    case 'good':
      return `At or above ${MEMORY_RESEMBLANCE_GOOD}%: clearly alike, less so than the closest matches.`;
    case 'modest':
      return `Over the floor of ${floor}%, but only loosely alike.`;
    default:
      return `Under the floor of ${floor}%, so it is not listed as a match.`;
  }
}

/** One labelled fact about a matched case. */
const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-0.5">
    <div className="text-[10px] font-mono font-bold uppercase text-zinc-500">{label}</div>
    <div className="text-xs text-zinc-200">{children}</div>
  </div>
);

/** A picture slot that says what it is missing rather than collapsing to nothing. */
const PictureSlot: React.FC<{
  url?: string;
  alt: string;
  caption: string;
  remark?: string;
  onOpen?: (url: string) => void;
}> = ({ url, alt, caption, remark, onOpen }) => (
  <figure className="min-w-0 space-y-1.5">
    <figcaption className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase text-zinc-500">
      {caption}
    </figcaption>
    {url ? (
      <button
        type="button"
        onClick={() => onOpen?.(url)}
        className="block w-full cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        title="Click to view this chart larger"
      >
        <img
          src={url}
          alt={alt}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 object-contain"
        />
      </button>
    ) : (
      <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 px-3 text-center">
        <ImageOff className="h-4 w-4 text-zinc-600" />
        <span className="text-[10px] leading-relaxed text-zinc-600">
          {remark ?? 'This picture has no displayable copy right now.'}
        </span>
      </div>
    )}
  </figure>
);

export const MemorySearchResults: React.FC<MemorySearchResultsProps> = ({
  results,
  floor,
  queryImageUrl,
  queryLabel,
  belowFloor = 0,
  duplicateObservations = 0,
  busy = false,
  searchableCount,
  filtersActive = false,
  verdicts,
  onVerdict,
  onOpenMatch,
  symbolFor,
  timezone,
  selectedObservationId,
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selectedObservationId ?? selected;
  /** The chart being read at full size, in the compare panel or in a result row. */
  const [zoom, setZoom] = useState<{
    images: string[];
    index: number;
    title?: string;
    subtitle?: string;
  } | null>(null);

  /**
   * The evidence, assembled once for the whole set.
   *
   * Built here rather than in the parent so the summary strip and the list below it cannot describe
   * different things: both read the same call, over the same ranked matches, and the market and
   * execution columns come out of the module that owns their denominators.
   */
  const evidence: MemoryEvidence = useMemo(
    () =>
      buildMemoryEvidence(
        results.map((result) => ({
          observation: result.observation ?? placeholderObservation(result),
          resemblance: result.match.resemblance,
          trade: result.trade,
        }))
      ),
    [results]
  );

  const selectedResult = useMemo(
    () => results.find((result) => result.match.observationId === activeId),
    [results, activeId]
  );

  const emptyReason = memorySearchEmptyReason({ searchableCount, belowFloor, filtersActive });

  // The selected match's band, on the same floor the list used. Absent only while nothing is
  // selected, in which case the comparison panel is not rendered at all.
  const selectedBand: MemoryResemblanceBand = memoryResemblanceBand(
    selectedResult?.match.resemblance ?? 0,
    floor
  );

  if (busy) {
    return (
      <section id="memory-results" className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <Search className="h-4 w-4 animate-pulse text-sky-400" />
          <p className="text-xs text-zinc-300">
            Comparing this chart against your library. Nothing is being written and nothing is being
            indexed — this is a read of pictures you have already allowed to be compared.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="memory-results" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-100">
            <Layers className="h-4 w-4 text-sky-400" />
            Charts from your own library
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
            Each row is a picture of yours that looks like the one you searched with. The percentage
            is how close the two charts look to an image model and nothing else — it is not a
            forecast, and it says nothing about what either chart did afterwards.
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-right">
          <div className="font-mono text-lg font-semibold text-zinc-100">{results.length}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">
            {results.length === 1 ? 'match listed' : 'matches listed'}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            floor {floor}%
          </div>
        </div>
      </div>

      {/* ---- The evidence. Read before the list, because the list is only illustrations of it. */}
      {results.length > 0 && (
        <div
          id="memory-evidence"
          className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold tracking-tight text-zinc-100">What these cases amount to</h3>
            <span className="text-[10px] text-zinc-500">
              {evidence.counts.matched} matched
              {duplicateObservations > 0
                ? ` · ${duplicateObservations} more picture${
                    duplicateObservations === 1 ? '' : 's'
                  } of the same sightings, not counted twice`
                : ''}
              {belowFloor > 0 ? ` · ${belowFloor} under the floor` : ''}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-amber-400" />
                <h4 className="text-[11px] font-bold text-zinc-100">What the market did</h4>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Continued', value: evidence.summary.continuations },
                  { label: 'Reversed', value: evidence.summary.reversals },
                  { label: 'Not recorded', value: evidence.summary.marketUnknown },
                ].map((cell) => (
                  <div key={cell.label}>
                    <div className="font-mono text-base font-semibold text-zinc-100">{cell.value}</div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {cell.label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400">
                Continued in{' '}
                <span className="font-mono text-zinc-200">
                  {formatMemoryRate(evidence.summary.continuationRate)}
                </span>{' '}
                of the {evidence.summary.marketDecided} cases you classified either way.
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center gap-1.5">
                <ThumbsUp className="h-3.5 w-3.5 text-sky-400" />
                <h4 className="text-[11px] font-bold text-zinc-100">What you did on them</h4>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Won', value: evidence.summary.wins },
                  { label: 'Lost', value: evidence.summary.losses },
                  { label: 'No trade', value: evidence.counts.matched - evidence.counts.withTrade },
                ].map((cell) => (
                  <div key={cell.label}>
                    <div className="font-mono text-base font-semibold text-zinc-100">{cell.value}</div>
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {cell.label}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400">
                {evidence.summary.traded === 0
                  ? 'None of these sightings was traded, so this column is empty because nothing was taken — not because a result is missing.'
                  : `Won ${formatMemoryRate(evidence.summary.winRate)} of the ${
                      evidence.summary.wins + evidence.summary.losses
                    } decided trades.`}
              </p>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-zinc-500">
            The two panels above are deliberately separate numbers. A setup continuing while your own
            trade loses money is ordinary, and one rate covering both would report a market result
            that was never measured on top of an execution result that was.
          </p>

          {/* The warnings are the part that stops a thin sample reading as a finding. */}
          {evidence.warnings.length > 0 && (
            <ul id="memory-evidence-warnings" className="space-y-1 border-t border-zinc-800 pt-3">
              {evidence.warnings.map((warning) => (
                <li
                  key={warning}
                  className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-400"
                >
                  <Minus className="mt-1 h-2.5 w-2.5 shrink-0 text-zinc-600" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---- The comparison. The query chart beside the one it is being compared with. ---- */}
      {selectedResult && (
        <div
          id="memory-compare"
          className="space-y-3 rounded-2xl border border-sky-900/60 bg-zinc-900/70 p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-bold tracking-tight text-zinc-100">
                <ArrowLeftRight className="h-3.5 w-3.5 text-sky-400" />
                Side by side
              </h3>
              <p className="mt-0.5 max-w-2xl text-[10px] leading-relaxed text-zinc-500">
                These two pictures are next to each other because they look alike to an image model.
                That is the whole of the comparison — it is not a claim that what happened after the
                earlier chart will happen after yours.
              </p>
            </div>
            <button
              type="button"
              id="memory-compare-close"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <X className="h-3 w-3" /> Close
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <PictureSlot
                url={queryImageUrl}
                alt={queryLabel ?? 'The chart you searched with'}
                caption={queryLabel ?? 'The chart you searched with'}
                remark="The chart you searched with is no longer displayable. The matches are still real; only its preview is gone."
                onOpen={(url) =>
                  setZoom({
                    images: [url],
                    index: 0,
                    title: queryLabel ?? 'The chart you searched with',
                    subtitle: 'The picture this search was made with.',
                  })
                }
              />
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <Fact label="This one">Your current chart. Nothing about it has been recorded yet.</Fact>
              </div>
            </div>

            <div className="space-y-2">
              <PictureSlot
                url={selectedResult.imageUrl}
                alt={`The chart from ${selectedResult.match.instrument} observed on ${selectedResult.match.observedAt.slice(0, 10)}`}
                caption="The match from your library"
                remark="This picture is stored privately and its preview could not be loaded. Nothing else about the match has changed."
                onOpen={(url) =>
                  setZoom({
                    images: [url],
                    index: 0,
                    title: `${selectedResult.match.instrument} · ${selectedResult.match.observedAt.slice(0, 10)}`,
                    subtitle: 'The chart from your library that this search matched.',
                  })
                }
              />
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-zinc-100">
                    {selectedResult.match.resemblance}%
                  </span>
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                      BAND_CLASS[selectedBand]
                    }`}
                  >
                    {BAND_LABEL[selectedBand]}
                  </span>
                  <span className="text-[10px] text-zinc-500">against a floor of {floor}%</span>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Resemblance between two pictures. It is not a statement about what either chart did
                  afterwards.
                </p>
                {selectedResult.observation?.marketContext && (
                  <p className="text-[11px] leading-relaxed text-zinc-300">
                    {selectedResult.observation.marketContext}
                  </p>
                )}
                {/* What you wrote under each picture, so a match reads as a sighting rather
                    than as a score. */}
                {(selectedResult.observation?.images ?? []).map((image) =>
                  image.note ? (
                    <p
                      key={image.id}
                      className="border-l border-zinc-700 pl-2 text-[11px] leading-relaxed text-zinc-400"
                    >
                      {image.note}
                    </p>
                  ) : null
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Fact label="Market">
                    {recordedOutcomeWords(selectedResult.observation)}
                  </Fact>
                  <Fact label="You">
                    {tradeResultWords(selectedResult.observation, selectedResult.trade, symbolFor)}
                  </Fact>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- The list, or the reason there is none. ---- */}
      {results.length === 0 ? (
        <div
          id="memory-results-empty"
          className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span>{EMPTY_COPY[emptyReason]}</span>
          </p>
          <p className="pl-6 text-[10px] text-zinc-500">
            {emptyReason === 'nothing-searchable'
              ? 'Recorded pictures that were never sent to a model are still kept — they are just not comparable.'
              : `This search only listed pictures at ${floor}% or above. The floor is a display setting and can be moved.`}
          </p>
        </div>
      ) : (
        <div id="memory-results-list" className="space-y-2">
          {results.map((result) => {
            const { match } = result;
            const verdict = verdicts?.[match.observationId];
            const isSelected = match.observationId === activeId;
            // Recomputed from the floor this search actually ran with rather than read off the
            // match, so the word beside the number and the threshold quoted underneath it are
            // guaranteed to describe the same cut-off. The two are equal in practice; deriving
            // both from one input is what keeps them from drifting apart when the floor is moved.
            const band = memoryResemblanceBand(match.resemblance, floor);
            return (
              <article
                key={`${match.observationId}:${match.imageId}`}
                id={`memory-match-${match.observationId}`}
                data-observation-id={match.observationId}
                data-resemblance={match.resemblance}
                className={`rounded-xl border p-3 ${
                  isSelected ? 'border-sky-900/70 bg-zinc-900/80' : 'border-zinc-800 bg-zinc-900/60'
                }`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  {result.imageUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setZoom({
                          images: [result.imageUrl!],
                          index: 0,
                          title: `${match.instrument} · ${match.observedAt.slice(0, 10)}`,
                          subtitle: 'The chart from your library that this search matched.',
                        })
                      }
                      title="Click to view this chart larger"
                      className="h-16 w-24 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    >
                      <img
                        src={result.imageUrl}
                        alt={`Chart from ${match.instrument} observed on ${match.observedAt.slice(0, 10)}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-[9px] text-zinc-600">
                      no preview
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-100">
                        {match.resemblance}%
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                          BAND_CLASS[band]
                        }`}
                        title={bandHint(band, floor)}
                      >
                        {BAND_LABEL[band]}
                      </span>
                      <span className="text-[10px] text-zinc-500">floor {floor}%</span>
                      <span className="font-mono text-[11px] text-zinc-400">
                        {timezone
                          ? formatTimestamp(match.observedAt, timezone)
                          : match.observedAt.slice(0, 16).replace('T', ' ')}
                      </span>
                      <span className="rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                        {match.instrument || 'no contract'}
                      </span>
                      {match.timeframe && (
                        <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {match.timeframe}
                        </span>
                      )}
                      {match.session && (
                        <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {match.session}
                        </span>
                      )}
                      {match.setupName && (
                        <span className="rounded-md border border-sky-900/70 bg-sky-950/50 px-1.5 py-0.5 text-[10px] text-sky-300">
                          {match.setupName}
                        </span>
                      )}
                      <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                        {match.role}
                      </span>
                    </div>

                    {/* Two facts, two slots, never one blended verdict. */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Fact label="Market">
                        {recordedOutcomeWords(result.observation)}
                      </Fact>
                      <Fact label="You">
                        {tradeResultWords(result.observation, result.trade, symbolFor)}
                      </Fact>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        id={`memory-match-compare-${match.observationId}`}
                        onClick={() => setSelected(isSelected ? null : match.observationId)}
                        aria-expanded={isSelected}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        {isSelected ? 'Hide the comparison' : 'Compare side by side'}
                      </button>
                      {onOpenMatch && (
                        <button
                          type="button"
                          id={`memory-match-open-${match.observationId}`}
                          onClick={() => onOpenMatch(result)}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                        >
                          <Search className="h-3 w-3" /> Open the sighting
                        </button>
                      )}
                    </div>

                    {onVerdict && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
                        <span className="text-[10px] text-zinc-500">Your call:</span>
                        {(['strong', 'partial', 'wrong'] as MemoryMatchFeedback[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            id={`memory-verdict-${match.observationId}-${option}`}
                            onClick={() => onVerdict(match.observationId, option)}
                            aria-pressed={verdict === option}
                            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                              verdict === option
                                ? 'border-sky-700 bg-sky-950/60 text-sky-200'
                                : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                            }`}
                          >
                            {option === 'wrong' ? (
                              <ThumbsDown className="h-3 w-3" />
                            ) : (
                              <ThumbsUp className="h-3 w-3" />
                            )}
                            {VERDICT_LABEL[option]}
                          </button>
                        ))}
                        <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                          <TriangleAlert className="h-3 w-3" />
                          Kept as a note of what you judged. It does not train or change anything.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-zinc-600">
        A resemblance says two charts look alike. It does not say what either one did, and it does not
        say what yours will do.
      </p>

      <ImageLightboxModal
        isOpen={zoom !== null}
        onClose={() => setZoom(null)}
        images={zoom?.images ?? []}
        initialIndex={zoom?.index ?? 0}
        title={zoom?.title}
        subtitle={zoom?.subtitle}
      />
    </section>
  );
};

/**
 * A stand-in observation for a match the journal no longer holds.
 *
 * A search can return a picture whose observation was deleted on another device between the query
 * and the render. Dropping the row would silently shorten the list, and inventing a real-looking
 * record would be worse, so it is rendered as an empty shell: the resemblance is still true, the
 * facts about the case are simply absent, and every accessor below reads an absent field as "not
 * recorded" rather than as a zero.
 */
function placeholderObservation(result: MemorySearchResult): TradingObservation {
  const match = result.match;
  return {
    id: match.observationId,
    userId: '',
    observedAt: match.observedAt,
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: '',
    symbol: match.instrument,
    timeframe: match.timeframe as TradingObservation['timeframe'],
    session: match.session as TradingObservation['session'],
    setupName: match.setupName,
    linkedTradeId: match.linkedTradeId,
    images: [],
    createdAt: match.observedAt,
    updatedAt: match.observedAt,
  };
}

/** What the market did, in words, with absence said rather than shown as a zero. */
function recordedOutcomeWords(observation: TradingObservation | undefined): string {
  if (!observation) return 'no record of this sighting could be read';
  const sample = marketOutcomeSample(observation.outcome);
  switch (sample) {
    case 'continuation':
      return observation.outcome?.window
        ? `it continued — ${observation.outcome.window}`
        : 'it continued';
    case 'reversal':
      return observation.outcome?.window ? `it reversed — ${observation.outcome.window}` : 'it reversed';
    case 'unclear':
      return 'you watched it but could not classify it either way';
    default:
      return 'nothing recorded about what price did';
  }
}

/** What the trader's own trade did, kept apart from the market and never defaulted to a scratch. */
function tradeResultWords(
  observation: TradingObservation | undefined,
  trade: Trade | undefined,
  symbolFor?: (instrumentId: string) => string
): string {
  if (!trade) return 'no trade taken under it';
  const result = tradeResultSample(trade);
  const symbol = symbolFor && trade.instrumentId ? symbolFor(trade.instrumentId) : '';
  const opening = symbol ? `${symbol} ${trade.direction}` : `${trade.direction}`;
  switch (result) {
    case 'win':
      return `${opening} — won`;
    case 'loss':
      return `${opening} — lost`;
    case 'breakeven':
      return `${opening} — finished flat`;
    case 'open':
      return `${opening} — still open, so it has no result yet`;
    default:
      return `${opening} — no result recorded on the trade`;
  }
}
