import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Layers, Loader2, Search, ShieldAlert, X } from 'lucide-react';
import type {
  MemoryAiSettings,
  MemoryImage,
  MemoryMatchFeedback,
  MemorySearchFilters,
  MemorySearchMatch,
  Trade,
  TradingObservation,
} from '../../types';
import { compressAndReadImage, downscaleDataUrl } from '../../lib/utils/image-utils';
import { checksumDataUrl, createMemoryImageUrls, isMemoryStorageConfigured } from '../../lib/memory/storage';
import {
  MEMORY_ENDPOINT,
  requestChartEmbeddings,
} from '../../lib/memory/embedding-api';
import { searchMemoryImages, saveMemorySearch, setMatchFeedback, MEMORY_MATCH_ROLES } from '../../lib/memory/db';
import {
  MEMORY_RESEMBLANCE_FLOOR,
  rankMemoryMatches,
  type MemoryEmbeddingStamp,
  type MemoryRanking,
} from '../../lib/memory/similarity';
import { memorySearchExpiry } from '../../lib/memory/settings';
import {
  MemorySearchResults,
  type MemorySearchResult,
} from './MemorySearchResults';

/**
 * The similarity search screen: "have I seen this chart before?"
 *
 * The pipeline here is short and deliberately visible — compress the picked chart, embed it through
 * the endpoint, ask the database for the nearest stored pictures, rank them, render them. What this
 * file is really responsible for is the difference between the several ways a search can come back
 * without matches, because collapsing them into one panel is the failure mode that matters:
 *
 *   * there is no consent to send the query chart;
 *   * there is no cloud to search in;
 *   * the endpoint is not configured or not reachable;
 *   * the provider rate-limited us;
 *   * the schema has not been applied;
 *   * the library genuinely holds nothing like this;
 *   * everything that matched scored under the floor;
 *   * filters removed everything that matched.
 *
 * Eight states, eight different next actions. "No matches" is only ever the honest answer to the
 * last four, and the last three are rendered by `MemorySearchResults` from the counts handed to it
 * rather than by this file guessing.
 *
 * Two further lines are held here:
 *
 *   1. **The query chart is the trader's own private chart, so consent gates it too.** The picture
 *      they search WITH is not less private than the ones already in the library, and a search that
 *      quietly uploaded it while the consent switch was off would be the exact thing the switch
 *      exists to prevent. Without consent the search refuses and says why.
 *   2. **Nothing here talks to a model directly.** The key stays on the server, and this screen's
 *      only route out is `requestChartEmbeddings`.
 *
 * The picked chart is never stored and never becomes an observation. A search is a question about
 * the library, not an entry in it — recording every chart the trader happened to hold up against
 * their history would fill the library with queries.
 */

export interface MemorySearchViewProps {
  aiSettings: MemoryAiSettings;
  observations: readonly TradingObservation[];
  trades: readonly Trade[];
  /** True when a Supabase project is configured, which the search and the private bucket both need. */
  cloudEnabled: boolean;
  onViewTrade?: (trade: Trade) => void;
}

/** A generated id for one saved search. Same shape as the indexing job ids, for the same reason. */
function newSearchId(): string {
  return `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Turns an embedding failure into the sentence the trader can act on.
 *
 * Keyed on the code rather than on the message, because the message belongs to whatever answered:
 * the endpoint's own wording is right for a log and too long for a panel, and the one case that must
 * never be paraphrased is a rate limit, where the action is simply to wait.
 */
function describeEmbedFailure(code: string, message: string, retryAfterSeconds?: number): string {
  switch (code) {
    case 'unconfigured':
      return (
        'Chart embedding is not set up on the server, so nothing could be compared. Set ' +
        `GEMINI_API_KEY in the hosting environment variables and redeploy. A GET to ${MEMORY_ENDPOINT} ` +
        'reports whether the key is visible.'
      );
    case 'unauthorized':
      return 'Sign in first — the search runs against your own library, and it needs to know who you are.';
    case 'bad_key':
      return 'The embedding key was refused by the provider. It has probably been revoked or replaced.';
    case 'rate_limited':
      return retryAfterSeconds
        ? `The embedding provider is rate-limiting right now. Try again in about ${retryAfterSeconds} seconds.`
        : 'The embedding provider is rate-limiting right now. Try again in a minute.';
    case 'network':
      return `The embedding endpoint could not be reached at ${MEMORY_ENDPOINT}. Check your connection, then try again.`;
    case 'bad_request':
      return message;
    case 'bad_response':
      return (
        'The embedding service answered with a vector this build cannot use, so nothing was ' +
        'compared. That usually means the deployed endpoint and this app have drifted apart.'
      );
    default:
      return `The picture could not be embedded, so nothing was compared. ${message}`;
  }
}

/** One selectable filter, so three identical controls do not become three blocks of markup. */
const FilterSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}> = ({ id, label, value, options, onChange }) => (
  <label className="space-y-1" htmlFor={id}>
    <span className="block text-[10px] font-mono font-bold uppercase text-zinc-500">{label}</span>
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-xs text-zinc-200 focus:border-sky-500/60 focus:outline-none"
    >
      <option value="">Any</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </label>
);

export const MemorySearchView: React.FC<MemorySearchViewProps> = ({
  aiSettings,
  observations,
  trades,
  cloudEnabled,
  onViewTrade,
}) => {
  const [queryDataUrl, setQueryDataUrl] = useState<string | null>(null);
  const [queryLabel, setQueryLabel] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ranking, setRanking] = useState<MemoryRanking | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, MemoryMatchFeedback | undefined>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string | undefined>>({});
  const [filters, setFilters] = useState<MemorySearchFilters>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const consent = aiSettings.imageProcessingConsent;
  // Not `||`: zero is a legal floor meaning "show me everything that was compared", and coercing it
  // to the default would quietly re-apply a threshold the trader had deliberately removed.
  const floor = Number.isFinite(aiSettings.resemblanceFloor)
    ? aiSettings.resemblanceFloor
    : MEMORY_RESEMBLANCE_FLOOR;

  /** The library, indexed by what the ranking and the result rows need to look up. */
  const imagesById = useMemo(() => {
    const map = new Map<string, MemoryImage>();
    for (const observation of observations) {
      for (const image of observation.images ?? []) map.set(image.id, image);
    }
    return map;
  }, [observations]);

  const observationsById = useMemo(() => {
    const map = new Map<string, TradingObservation>();
    for (const observation of observations) map.set(observation.id, observation);
    return map;
  }, [observations]);

  const tradesById = useMemo(() => {
    const map = new Map<string, Trade>();
    for (const trade of trades) map.set(trade.id, trade);
    return map;
  }, [trades]);

  /**
   * A symbol for an instrument, so a matched trade can be named without this screen owning the
   * instrument table. Built from the observations in hand, because every observation already carries
   * the symbol as it was written on the day.
   */
  const symbolByInstrument = useMemo(() => {
    const map = new Map<string, string>();
    for (const observation of observations) {
      if (observation.instrumentId && observation.symbol) {
        map.set(observation.instrumentId, observation.symbol);
      }
    }
    return map;
  }, [observations]);

  /**
   * How many pictures are searchable at all.
   *
   * Only completed pictures in a pre-decision role count, because those are exactly the rows the
   * query can return. Counting every stored picture instead would tell a trader whose charts are all
   * `exit` shots that their library is searchable, and then show them an empty result with no
   * explanation — the empty state reads this number to choose its sentence.
   */
  const searchableCount = useMemo(() => {
    // The roles come from `db.ts` rather than being restated here, so this count and the query
    // itself cannot disagree about which pictures are reachable.
    const searchableRoles: readonly string[] = MEMORY_MATCH_ROLES;
    return observations.reduce(
      (sum, observation) =>
        sum +
        (observation.images ?? []).filter(
          (image) =>
            image.indexStatus === 'completed' && searchableRoles.includes(image.role)
        ).length,
      0
    );
  }, [observations]);

  const filtersActive = Boolean(
    filters.instrument || filters.timeframe || filters.session || filters.setupName || filters.fromDate || filters.toDate
  );

  // Filter options come from the trader's own record rather than a catalogue: offering an instrument
  // they have never recorded would only ever produce an empty result.
  const instrumentOptions = useMemo(
    () => Array.from(new Set(observations.map((o) => o.symbol).filter(Boolean))).sort(),
    [observations]
  );
  const timeframeOptions = useMemo(
    () => Array.from(new Set(observations.map((o) => o.timeframe).filter(Boolean) as string[])).sort(),
    [observations]
  );
  const sessionOptions = useMemo(
    () => Array.from(new Set(observations.map((o) => o.session).filter(Boolean) as string[])).sort(),
    [observations]
  );

  /**
   * Displayable URLs for the matched pictures.
   *
   * A picture kept inline draws from its own data URL; one in the private bucket needs a signed link,
   * which is fetched for the whole page in one round trip. Re-fetched on each new ranking rather than
   * cached, because a signed URL expires and holding one past its life is how a list of thumbnails
   * turns into a list of broken images.
   */
  useEffect(() => {
    if (!ranking || ranking.matches.length === 0) {
      setImageUrls({});
      return;
    }

    let active = true;
    const inline: Record<string, string | undefined> = {};
    const paths: string[] = [];
    const pathImageIds: string[] = [];

    for (const match of ranking.matches) {
      const image = imagesById.get(match.imageId);
      if (!image) continue;
      if (image.dataUrl) inline[match.imageId] = image.dataUrl;
      else if (image.storagePath) {
        paths.push(image.storagePath);
        pathImageIds.push(match.imageId);
      }
    }

    setImageUrls({ ...inline });

    if (paths.length === 0 || !isMemoryStorageConfigured()) return;

    void createMemoryImageUrls(paths).then((urls) => {
      if (!active) return;
      const next: Record<string, string | undefined> = { ...inline };
      pathImageIds.forEach((imageId, index) => {
        const url = urls[index];
        if (url) next[imageId] = url;
      });
      setImageUrls(next);
    });

    return () => {
      active = false;
    };
  }, [ranking, imagesById]);

  /** The rows handed to the results component, joined to the records behind them. */
  const results: MemorySearchResult[] = useMemo(() => {
    if (!ranking) return [];
    return ranking.matches.map((match) => {
      const observation = observationsById.get(match.observationId);
      const trade = observation?.linkedTradeId
        ? tradesById.get(observation.linkedTradeId)
        : undefined;
      return {
        match,
        observation,
        trade,
        imageUrl: imageUrls[match.imageId],
      };
    });
  }, [ranking, observationsById, tradesById, imageUrls]);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That is not an image. Drop a chart screenshot.');
      return;
    }
    setError(null);
    setNotice(null);
    try {
      // The chart is only held in memory for as long as this screen is open: it is a question, not a
      // record, so nothing about it is written to the journal or to storage.
      const dataUrl = await compressAndReadImage(file);
      setQueryDataUrl(dataUrl);
      setQueryLabel(file.name.replace(/\.[a-z0-9]+$/i, '') || undefined);
      // A new chart is a new question, so the previous answer goes with it. Leaving the old rows up
      // would invite reading them as an answer about the new picture.
      setRanking(null);
      setSearchId(null);
      setVerdicts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be read.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function runSearch() {
    // Consent, first and before any read: without it the query chart must not leave the browser, and
    // a search that sent it anyway would be the one thing the switch exists to prevent.
    if (!consent) {
      setError(
        'Searching needs your permission to send a chart to the embedding model, and the chart you ' +
          'search WITH is one of your own private charts too. Nothing was sent. You can turn this on ' +
          'in the settings above.'
      );
      return;
    }
    if (!cloudEnabled) {
      setError(
        'The similarity search needs connected storage. Your screenshots and their vectors live in ' +
          'your Supabase project, and there is none configured for this build. Recording and ' +
          'browsing still work without it.'
      );
      return;
    }
    if (!queryDataUrl) {
      setError('Pick the chart you want to ask about first.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const embedded = await requestChartEmbeddings([
        { label: queryLabel ?? 'chart to search with', dataUrl: queryDataUrl },
      ]);

      if (!embedded.ok) {
        // Reported as itself. A refusal, a rate limit and a dead endpoint must never be shown as
        // "no matches", because the trader would then believe their library holds nothing similar.
        setRanking(null);
        setError(describeEmbedFailure(embedded.code, embedded.message, embedded.retryAfterSeconds));
        return;
      }

      const embedding = embedded.results[0]?.embedding;
      if (!embedding) {
        setRanking(null);
        setError(
          'The embedding service returned no vector for that chart, so nothing was compared. Try ' +
            'the search again, or pick a different screenshot.'
        );
        return;
      }

      // The stamp the endpoint reported, not a local constant: if the deployment were ever on a
      // different model, the search must ask for vectors of ITS configuration rather than silently
      // ranking two generations against each other.
      const stamp: MemoryEmbeddingStamp = {
        model: embedded.model,
        version: embedded.version,
        dimension: embedded.dimension,
      };

      const matches = await searchMemoryImages(embedding, {
        filters,
        limit: aiSettings.resultCount,
        stamp,
      });

      const ranked = rankMemoryMatches(matches, {
        floor,
        limit: aiSettings.resultCount,
      });

      setRanking(ranked);

      // ---- Keeping the search ----
      // Saved with what it returned and which configuration produced it, so retrieval can be judged
      // later against the answer the trader actually saw. A failure to save is reported and the
      // results stay on screen: losing the history is not a reason to lose the answer.
      const savedSearchId = newSearchId();
      const searchedAt = new Date().toISOString();
      try {
        const thumbnail = await downscaleDataUrl(queryDataUrl, 320, 0.7);
        const queryChecksum = await checksumDataUrl(queryDataUrl);
        await saveMemorySearch({
          id: savedSearchId,
          // Required by the type because the same shape is read back off a row, where the column is
          // real. The write itself takes the owner from the session and refuses to accept one, so
          // this placeholder cannot take effect.
          userId: '',
          searchedAt,
          thumbnail: thumbnail ?? undefined,
          queryChecksum: queryChecksum ?? undefined,
          filters,
          matches: ranked.matches.map(
            (match): MemorySearchMatch => ({
              observationId: match.observationId,
              imageId: match.imageId,
              role: match.role,
              resemblance: match.resemblance,
              cosineDistance: match.cosineDistance,
              observedAt: match.observedAt,
              instrument: match.instrument,
              timeframe: match.timeframe,
              session: match.session,
              setupName: match.setupName,
              linkedTradeId: match.linkedTradeId,
            })
          ),
          embeddingModel: stamp.model,
          embeddingVersion: stamp.version,
          resemblanceFloor: floor,
          expiresAt: memorySearchExpiry(searchedAt, aiSettings.searchRetentionDays),
        });
        setSearchId(savedSearchId);
      } catch (saveError) {
        setSearchId(null);
        setNotice(
          'The search ran, but it could not be saved to your history, so your verdicts will only ' +
            'apply to this screen: ' +
            (saveError instanceof Error ? saveError.message : 'the write failed.')
        );
      }
    } catch (err) {
      setRanking(null);
      setError(
        err instanceof Error
          ? err.message
          : 'The search could not be completed. Nothing was changed.'
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records the trader's own verdict on a match.
   *
   * Persisted so retrieval can be judged later. It is a record and nothing else — no model is
   * retrained, no ranking is tuned, and the screen says so on the buttons themselves.
   */
  async function handleVerdict(observationId: string, verdict: MemoryMatchFeedback) {
    setVerdicts((prev) => ({ ...prev, [observationId]: verdict }));
    if (!searchId) {
      setNotice(
        'This search is not in your history, so the verdict is kept on this screen only. It is not ' +
          'used to change anything either way.'
      );
      return;
    }
    try {
      await setMatchFeedback(searchId, observationId, verdict);
    } catch (err) {
      setNotice(
        'That verdict could not be saved: ' +
          (err instanceof Error ? err.message : 'the write failed.') +
          ' It stays on this screen until you leave it.',
      );
    }
  }

  return (
    <section
      id="memory-search"
      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Search className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold tracking-tight text-zinc-100">
            Find charts like this one
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-400">
            Hold up a chart and this finds the closest pictures in your own library. What comes back
            is a measure of how alike two charts look to an image model — it is not a probability,
            not a win rate, and it says nothing about what this one will do.
          </p>

          <div className="mt-3 space-y-4">
            {/* ---- The query chart ---- */}
            <div className="space-y-2">
              {queryDataUrl ? (
                <div className="flex items-start gap-3">
                  <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                    <img
                      id="memory-search-preview"
                      src={queryDataUrl}
                      alt="The chart being searched with"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      {queryLabel ? `${queryLabel} — ` : ''}
                      kept in this browser only. A search is a question about your library, so the
                      chart you ask with is not stored as a record.
                    </p>
                    <button
                      type="button"
                      id="memory-search-clear"
                      onClick={() => {
                        setQueryDataUrl(null);
                        setQueryLabel(undefined);
                        setRanking(null);
                        setSearchId(null);
                        setVerdicts({});
                        setError(null);
                        setNotice(null);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <X className="h-3 w-3" /> Choose another
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  id="memory-search-dropzone"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void handleFile(event.dataTransfer.files?.[0] ?? null);
                  }}
                  onClick={() => !busy && fileInputRef.current?.click()}
                  className={`rounded-xl border border-dashed p-4 text-center transition-all ${
                    busy
                      ? 'cursor-wait border-zinc-800 bg-zinc-950/60'
                      : dragging
                      ? 'cursor-pointer border-sky-500 bg-sky-950/20'
                      : 'cursor-pointer border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                  }`}
                >
                  <input
                    id="memory-search-input"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                  />
                  <div className="pointer-events-none flex flex-col items-center justify-center gap-1">
                    <ImagePlus className="h-4 w-4 text-zinc-400" />
                    <span className="text-[11px] text-zinc-300">
                      <span className="text-sky-400 underline decoration-sky-500/40">
                        Click to browse
                      </span>{' '}
                      or drop today's chart here
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Compressed in your browser, held for this search only.
                    </span>
                  </div>
                </div>
              )}

              {/* ---- Filters ---- */}
              <div id="memory-search-filters" className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-500">
                    Narrow the search
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <FilterSelect
                    id="memory-search-filter-instrument"
                    label="Instrument"
                    value={filters.instrument ?? ''}
                    options={instrumentOptions}
                    onChange={(value) =>
                      setFilters((prev) => ({ ...prev, instrument: value || undefined }))
                    }
                  />
                  <FilterSelect
                    id="memory-search-filter-timeframe"
                    label="Timeframe"
                    value={filters.timeframe ?? ''}
                    options={timeframeOptions}
                    onChange={(value) =>
                      setFilters((prev) => ({
                        ...prev,
                        timeframe: (value || undefined) as MemorySearchFilters['timeframe'],
                      }))
                    }
                  />
                  <FilterSelect
                    id="memory-search-filter-session"
                    label="Session"
                    value={filters.session ?? ''}
                    options={sessionOptions}
                    onChange={(value) =>
                      setFilters((prev) => ({
                        ...prev,
                        session: (value || undefined) as MemorySearchFilters['session'],
                      }))
                    }
                  />
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  Filters narrow what may be returned. They never widen the boundary that keeps
                  pictures from after the decision out of a match — every candidate is a chart that
                  existed before its setup.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  id="memory-search-run"
                  onClick={() => void runSearch()}
                  disabled={busy || !queryDataUrl || !consent || !cloudEnabled}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    busy || !queryDataUrl || !consent || !cloudEnabled
                      ? 'cursor-not-allowed border border-zinc-800 bg-zinc-900 text-zinc-600'
                      : 'border border-sky-500/60 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                  }`}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  {busy ? 'Searching your library…' : 'Search my library'}
                </button>
                <span className="text-[10px] text-zinc-500">
                  Showing results at {floor}% resemblance or above.
                </span>
              </div>
            </div>

            {/* ---- Why the search cannot run, said before it is attempted ---- */}
            {!consent && (
              <div
                id="memory-search-consent-block"
                className="flex items-start gap-2 rounded-xl border border-amber-900/70 bg-amber-950/30 p-3"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-amber-200">
                    Searching is switched off until you allow image processing.
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-200/80">
                    A similarity search sends one chart to the embedding model — the one you pick
                    here. That picture is as private as the ones already in your library, so the
                    switch above covers it too, and nothing is sent while it is off. Your library
                    stays fully browsable and editable either way.
                  </p>
                </div>
              </div>
            )}

            {!cloudEnabled && (
              <div
                id="memory-search-cloud-block"
                className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Searching needs connected storage. The vectors it compares live in your Supabase
                  project, so this build can browse and record but cannot search by similarity.
                </p>
              </div>
            )}

            {error && (
              <div
                id="memory-search-error"
                className="flex items-start gap-2 rounded-xl border border-rose-800/80 bg-rose-950/40 p-3"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <p className="text-[11px] leading-relaxed text-rose-200">{error}</p>
              </div>
            )}

            {notice && (
              <p
                id="memory-search-notice"
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] leading-relaxed text-amber-200/90"
              >
                {notice}
              </p>
            )}

            {/* ---- The answer ---- */}
            {(ranking || busy) && (
              <MemorySearchResults
                results={results}
                floor={floor}
                queryImageUrl={queryDataUrl ?? undefined}
                queryLabel={queryLabel}
                belowFloor={ranking?.belowFloor}
                duplicateObservations={ranking?.duplicateObservations}
                busy={busy}
                searchableCount={searchableCount}
                filtersActive={filtersActive}
                verdicts={verdicts}
                onVerdict={(observationId, verdict) => void handleVerdict(observationId, verdict)}
                onOpenMatch={(result) => {
                  if (result.trade && onViewTrade) onViewTrade(result.trade);
                }}
                symbolFor={(instrumentId) => symbolByInstrument.get(instrumentId) ?? instrumentId}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
