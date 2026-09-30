import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, Search, Trash2, Upload } from 'lucide-react';
import type {
  ChartSearch,
  DailyReview,
  Instrument,
  LevelTouch,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { buildJournalDigest, FULL_HISTORY_TRADE_SAMPLES } from '../../lib/ai/journal-digest';
import type { MatchItem, MatchResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  MAX_COACH_IMAGES,
  MAX_COACH_IMAGE_TOTAL_CHARS,
  isCoachImageDataUrl,
} from '../../lib/ai/coach-images';
import { instrumentSymbol } from '../../lib/trading/instruments';
import {
  CHART_MATCH_FLOOR,
  CHART_MATCH_GOOD,
  CHART_MATCH_STRONG,
  chartMatchBand,
  rankChartSearchesByStrength,
  summarizeChartSearch,
  summarizeChartSearchHistory,
  type ChartMatchBands,
} from '../../lib/analytics/chart-searches';
import {
  compressAndReadImage,
  downscaleDataUrl,
  getImageFromPasteEvent,
} from '../../lib/utils/image-utils';
import {
  CoachAction,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachGenerateButton,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
} from '../coach/coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The picture search.
 *
 * The trader asked to hand the coach a chart and be shown the trades in their OWN history
 * that look like it. This card is that: a single uploaded chart, read into plain structure,
 * matched against the per-trade record and — where one was attached — the screenshots of
 * those trades.
 *
 * It is built to stay a search of the record rather than a market read. The uploaded chart
 * is a picture the trader chose, not a live quote, and it carries no price scale the model
 * may read; the guardrails on the server forbid stating a price, a level or a direction from
 * it. The matches are the trader's own trades, quoted back and clickable, so the answer is
 * something they can open and check rather than believe.
 *
 * A match with no picture attached is labelled as resting on the written record, so a
 * written resemblance is never dressed up as a picture comparison.
 */

/** How many of the trader's own screenshots ride along with the uploaded chart. */
const MAX_TRADE_SHOTS = MAX_COACH_IMAGES - 1;

/** Names the first image, so the model knows which picture it is being asked about. */
const QUERY_LABEL = 'THE CHART THE TRADER IS ASKING ABOUT';

export interface ChartMatchCardProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  maxDrawdown?: number | null;
  levelTouches?: LevelTouch[];
  /** Opens the full detail view for a matched trade. Omitted hides the rows' click state. */
  onViewTrade?: (trade: Trade) => void;
  /**
   * The saved picture searches, newest first. Rendered as a history under the search, so the
   * trader can see which of their charts have matched their own trades most. Omitted hides
   * the history entirely.
   */
  chartSearches?: ChartSearch[];
  /** Records one completed search. Omitted means nothing is kept. */
  onSaveChartSearch?: (search: ChartSearch) => void;
  /** Removes one saved search. Omitted leaves the history read-only. */
  onDeleteChartSearch?: (id: string) => void;
  /** The account a saved search belongs to, carried onto the record. */
  userId?: string;
  /** A heading override, so the card can read naturally on the tab that hosts it. */
  heading?: string;
  className?: string;
}

interface MatchState {
  loading: boolean;
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  writtenAt?: string;
}

const IDLE: MatchState = { loading: false, result: null, failure: null };

/** The date the journal gives a trade, matching the rule the digest uses for a sample. */
function tradeDate(trade: Trade, dayById: Map<string, TradingDay>): string {
  const day = dayById.get(trade.tradingDayId);
  return day?.tradeDate ?? (trade.entryTime ? trade.entryTime.slice(0, 10) : 'date not recorded');
}

/**
 * The screenshots worth sending, newest trade first.
 *
 * One image per trade: the entry is what the trader asked to search, and several pictures of
 * one trade would spend the whole batch on it. Anything the server would reject is skipped
 * here so the request is never sent with something that will be silently dropped.
 */
function collectTradeShots(
  trades: Trade[],
  instruments: Instrument[],
  dayById: Map<string, TradingDay>
): { label: string; dataUrl: string; tradeId: string }[] {
  const out: { label: string; dataUrl: string; tradeId: string }[] = [];
  let total = 0;

  const newestFirst = [...trades]
    .filter((trade) => trade.status === 'closed')
    .sort((a, b) =>
      (b.exitTime ?? b.entryTime ?? b.updatedAt).localeCompare(
        a.exitTime ?? a.entryTime ?? a.updatedAt
      )
    );

  for (const trade of newestFirst) {
    if (out.length >= MAX_TRADE_SHOTS) break;
    const image = (trade.images ?? []).find((candidate) => isCoachImageDataUrl(candidate));
    if (!image) continue;
    if (total + image.length > MAX_COACH_IMAGE_TOTAL_CHARS) break;
    total += image.length;
    out.push({
      tradeId: trade.id,
      label:
        `${tradeDate(trade, dayById)} ` +
        `${instrumentSymbol(instruments, trade.instrumentId)} ${trade.direction.toUpperCase()}` +
        (trade.setupName ? ` logged as ${trade.setupName}` : '') +
        `, ${trade.rMultiple}R`,
      dataUrl: image,
    });
  }
  return out;
}

/**
 * The colour a resemblance score is shown in.
 *
 * Bands rather than a gradient because a gradient reads as a measurement the app made, and
 * the number is the coach's own estimate. The bands are only a quick read of the same number
 * spelled out beside them.
 */
function scoreTone(score: number): string {
  if (score >= CHART_MATCH_STRONG) return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
  if (score >= CHART_MATCH_GOOD) return 'bg-zinc-800 text-zinc-300 border-zinc-700';
  return 'bg-amber-950/60 text-amber-300/90 border-amber-900/70';
}

/** The fill for one match's bar in the distribution, banded the way the score chip is. */
function scoreBarClass(score: number, floor: number): string {
  if (score >= CHART_MATCH_STRONG) return 'bg-emerald-500';
  if (score >= CHART_MATCH_GOOD) return 'bg-sky-500';
  if (score >= floor) return 'bg-amber-500';
  return 'bg-rose-500/70';
}

/** How many of the closest matches are shown as the main answer. */
export const CLOSEST_MATCH_COUNT = 3;

/** How many past searches are shown before the history is folded. */
export const HISTORY_PREVIEW = 5;

/**
 * The resemblance floor, made the trader's to set.
 *
 * The floor is the score a match must reach to be shown as one. Fifty-five was chosen as the
 * default because it separates a real resemblance from a loose one, but "how close is close
 * enough" is a judgement about the trader's own setups, not a fact the app owns — so it is a
 * control rather than a constant. It is remembered under its own key so the same line holds
 * on every tab and across visits, and it only ever changes what is shown, never the score.
 */
export const MIN_MATCH_FLOOR = 20;
export const MAX_MATCH_FLOOR = 80;
const FLOOR_STEP = 5;
const FLOOR_STORAGE_KEY = 'ptj_chart_match_floor';

/** Snaps a chosen floor onto the control's steps and inside its range. */
function clampFloor(value: number): number {
  if (!Number.isFinite(value)) return CHART_MATCH_FLOOR;
  const snapped = Math.round(value / FLOOR_STEP) * FLOOR_STEP;
  return Math.min(MAX_MATCH_FLOOR, Math.max(MIN_MATCH_FLOOR, snapped));
}

/** The remembered floor, or the default when nothing valid has been stored. */
function readStoredFloor(): number {
  if (typeof window === 'undefined') return CHART_MATCH_FLOOR;
  try {
    const stored = window.localStorage.getItem(FLOOR_STORAGE_KEY);
    if (stored === null) return CHART_MATCH_FLOOR;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampFloor(parsed) : CHART_MATCH_FLOOR;
  } catch {
    return CHART_MATCH_FLOOR;
  }
}

function writeStoredFloor(floor: number): void {
  try {
    window.localStorage.setItem(FLOOR_STORAGE_KEY, String(floor));
  } catch {
    // A blocked write just means the choice is not remembered; the control still works.
  }
}

/** The four bands every distribution bar is drawn from, strongest first. */
const BAND_SEGMENTS: { key: keyof Omit<ChartMatchBands, 'total'>; label: string; bar: string }[] =
  [
    { key: 'strong', label: 'strong', bar: 'bg-emerald-500' },
    { key: 'good', label: 'good', bar: 'bg-sky-500' },
    { key: 'modest', label: 'below-standard', bar: 'bg-amber-500' },
    { key: 'below', label: 'below the floor', bar: 'bg-rose-500/70' },
  ];

/**
 * A stacked bar of one set of band counts.
 *
 * The whole point of the history is the shape of a run of searches, and four numbers side by
 * side are harder to read as a shape than four widths. Segments with no matches are dropped
 * so an all-strong history is one solid bar rather than a bar with invisible slices.
 */
const BandBar: React.FC<{ bands: ChartMatchBands; className?: string }> = ({
  bands,
  className = 'h-2',
}) => {
  if (bands.total === 0) {
    return <div className={`${className} rounded-full bg-zinc-800`} />;
  }
  return (
    <div className={`flex overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      {BAND_SEGMENTS.map((segment) => {
        const count = bands[segment.key];
        if (count === 0) return null;
        return (
          <div
            key={segment.key}
            data-band={segment.key}
            className={segment.bar}
            style={{ width: `${(count / bands.total) * 100}%` }}
            title={`${count} ${segment.label}`}
          />
        );
      })}
    </div>
  );
};

export const ChartMatchCard: React.FC<ChartMatchCardProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
  maxDrawdown,
  levelTouches,
  onViewTrade,
  chartSearches,
  onSaveChartSearch,
  onDeleteChartSearch,
  userId = 'local',
  heading = 'Search your history with a chart',
  className = '',
}) => {
  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays,
        reviews,
        setups,
        instruments,
        todayTradeDate,
        timezone,
        maxDrawdown,
        levelTouches,
        // This is the one mode that is a search rather than a pattern read, so it is handed
        // the whole history instead of the learner's twenty-row window.
        tradeSampleLimit: FULL_HISTORY_TRADE_SAMPLES,
      }),
    [
      trades,
      tradingDays,
      reviews,
      setups,
      instruments,
      todayTradeDate,
      timezone,
      maxDrawdown,
      levelTouches,
    ]
  );

  const dayById = useMemo(
    () => new Map(tradingDays.map((day) => [day.id, day])),
    [tradingDays]
  );

  const tradeShots = useMemo(
    () => collectTradeShots(trades, instruments, dayById),
    [trades, instruments, dayById]
  );

  /** Every closed trade, keyed by the date and symbol a match will be resolved against. */
  const closedByKey = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const trade of trades) {
      if (trade.status !== 'closed') continue;
      const key = `${tradeDate(trade, dayById)}|${instrumentSymbol(instruments, trade.instrumentId)}`;
      const list = map.get(key);
      if (list) list.push(trade);
      else map.set(key, [trade]);
    }
    return map;
  }, [trades, instruments, dayById]);

  const [queryImage, setQueryImage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [state, setState] = useState<MatchState>(IDLE);
  /** The score a match must reach to be shown. Remembered, and adjustable on the card. */
  const [resemblanceFloor, setResemblanceFloor] = useState(readStoredFloor);
  /** Whether the matches below the resemblance floor are revealed. */
  const [showWeaker, setShowWeaker] = useState(false);
  /** Whether the whole search history is shown, rather than the strongest few. */
  const [showAllHistory, setShowAllHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | File[] | null) {
    const file = files ? Array.from(files).find((f) => f.type.startsWith('image/')) : null;
    if (!file) {
      setPickError('That was not an image. Drop or paste a chart screenshot.');
      return;
    }
    setPickError(null);
    setReading(true);
    try {
      const dataUrl = await compressAndReadImage(file);
      if (!isCoachImageDataUrl(dataUrl)) {
        setPickError('That image could not be used — it was too large or the wrong format.');
        return;
      }
      setQueryImage(dataUrl);
      // A new chart is a new question: drop the previous answer rather than leaving it up.
      setState(IDLE);
    } catch (err) {
      setPickError(err instanceof Error ? err.message : 'Could not read that image.');
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function run() {
    if (!queryImage) return;
    setState((prev) => ({ ...prev, loading: true, failure: null }));

    const images = [
      { label: QUERY_LABEL, dataUrl: queryImage },
      ...tradeShots.map((shot) => ({ label: shot.label, dataUrl: shot.dataUrl })),
    ];

    const result = await requestCoach('match', digest, undefined, { images });
    if (result.ok) {
      // A new answer starts folded: the weaker list is a choice about the last search.
      setShowWeaker(false);
      setState({ loading: false, result, failure: null, writtenAt: new Date().toISOString() });
      // Saved after the answer is on screen, never before: drawing a thumbnail takes a beat
      // and the trader is waiting on the read, not on the history row.
      void saveSearch(result.data as MatchResponse, queryImage);
      return;
    }
    setState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const answer = state.result?.ok ? (state.result.data as MatchResponse) : null;

  /** Turns a match the model quoted back into the actual stored trade, when one exists. */
  const resolve = (match: MatchItem): Trade | null => {
    const key = `${match.date}|${match.symbol}`;
    const candidates = closedByKey.get(key);
    if (!candidates || candidates.length === 0) return null;
    const direction = match.direction.trim().toLowerCase();
    const setup = (match.setupName ?? '').trim().toLowerCase();
    return (
      candidates.find(
        (trade) =>
          trade.direction.toLowerCase() === direction &&
          (trade.setupName ?? '').trim().toLowerCase() === setup
      ) ??
      candidates.find((trade) => trade.direction.toLowerCase() === direction) ??
      candidates[0]
    );
  };

  /**
   * Records one completed search so the history can be read back.
   *
   * Best-effort and never awaited by the caller: a search the browser cannot shrink or store
   * must still leave the answer on screen. Matches are copied off the answer with the trade
   * they resolved to, so an old search can still open the trade it named.
   */
  const saveSearch = async (answer: MatchResponse, chart: string) => {
    if (!onSaveChartSearch) return;
    const thumbnail = await downscaleDataUrl(chart);
    onSaveChartSearch({
      id: `chart-search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      createdAt: new Date().toISOString(),
      patternRead: answer.patternRead,
      thumbnail: thumbnail ?? undefined,
      matches: answer.matches.map((match) => ({
        date: match.date,
        symbol: match.symbol,
        direction: match.direction,
        setupName: match.setupName,
        score: match.score,
        compared: match.compared,
        tradeId: resolve(match)?.id,
      })),
    });
  };

  /**
   * The saved searches, strongest first.
   *
   * Ranked by the best match each one found, which is the question the history answers: which
   * of the charts this trader has searched with looks most like something they actually
   * traded.
   */
  const historySummaries = useMemo(
    () => (chartSearches ?? []).map((search) => summarizeChartSearch(search, resemblanceFloor)),
    [chartSearches, resemblanceFloor]
  );
  const rankedHistory = useMemo(
    () => rankChartSearchesByStrength(historySummaries),
    [historySummaries]
  );
  const history = useMemo(
    () => summarizeChartSearchHistory(historySummaries),
    [historySummaries]
  );

  /**
   * The matches, ranked by how closely they resemble the chart.
   *
   * Ordered by the coach's own score, highest first, so the ranking is a number rather than a
   * felt order — and a tie keeps the order the answer arrived in, which the prompt asks to be
   * closest-first, so two trades scored alike are never scrambled against each other. The
   * closest three are lifted out as the answer; the rest stay beneath them, so nothing is
   * hidden but the best resemblances are never buried under weaker ones.
   */
  const rankedMatches = useMemo(() => {
    if (!answer) return [] as MatchItem[];
    return answer.matches
      .map((match, index) => ({ match, index }))
      .sort((a, b) => b.match.score - a.match.score || a.index - b.index)
      .map((entry) => entry.match);
  }, [answer]);

  // Only the matches at or above the trader's floor are shown by default; the weaker ones keep
  // their place behind a toggle, so a loose resemblance never sits level with a close one.
  const visibleMatches = rankedMatches.filter((match) => match.score >= resemblanceFloor);
  const weakerMatches = rankedMatches.filter((match) => match.score < resemblanceFloor);

  const closestMatches = visibleMatches.slice(0, CLOSEST_MATCH_COUNT);
  const alsoSimilar = visibleMatches.slice(CLOSEST_MATCH_COUNT);

  // The shape of one search, said in numbers rather than left to be guessed from the rows.
  // Counted through the same band function the history uses, so the header, the bars and the
  // history's shape all read one set of lines — including the trader's own floor.
  const bandCounts = useMemo(() => {
    const counts = { strong: 0, good: 0, modest: 0, below: 0 };
    for (const match of rankedMatches) counts[chartMatchBand(match.score, resemblanceFloor)] += 1;
    return counts;
  }, [rankedMatches, resemblanceFloor]);
  const strongCount = bandCounts.strong;
  const goodCount = bandCounts.good;

  /** One matched trade, rendered the same way in the closest list and the secondary one. */
  const renderMatchRow = (match: MatchItem, index: number) => {
    const trade = resolve(match);
    const shot = trade
      ? (trade.images ?? []).find((candidate) => isCoachImageDataUrl(candidate))
      : undefined;
    const openable = Boolean(trade && onViewTrade);
    return (
      <div
        key={`${match.date}-${match.symbol}-${index}`}
        data-match-row={trade ? trade.id : `unresolved-${index}`}
        role={openable ? 'button' : undefined}
        tabIndex={openable ? 0 : undefined}
        onClick={openable && trade ? () => onViewTrade?.(trade) : undefined}
        onKeyDown={
          openable && trade
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onViewTrade?.(trade);
                }
              }
            : undefined
        }
        className={`flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 ${
          openable ? 'cursor-pointer transition-colors hover:border-zinc-700 hover:bg-zinc-800/60' : ''
        }`}
        title={openable ? 'Click to open this trade' : undefined}
      >
        {shot && (
          <img
            src={shot}
            alt={`Screenshot of the ${match.date} ${match.symbol} trade`}
            className="h-14 w-20 shrink-0 rounded-lg border border-zinc-800 bg-zinc-950 object-cover"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-100">
              {match.date} · {match.symbol} · {match.direction.toUpperCase()}
            </span>
            {match.setupName && (
              <span className="rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 text-[10px] text-zinc-300">
                {match.setupName}
              </span>
            )}
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${scoreTone(
                match.score
              )}`}
              title="How closely this trade's pattern resembles your chart, 0-100. A resemblance, not a chance it works."
            >
              {match.score}% alike
            </span>
            <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 text-[10px] font-mono uppercase text-zinc-400">
              {match.compared === 'their-screenshot' ? 'picture compared' : 'written record'}
            </span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">{match.why}</p>
          {!trade && (
            <p className="text-[10px] text-amber-300/80">
              This trade could not be matched to a row in your log, so it is shown as quoted.
            </p>
          )}
        </div>
      </div>
    );
  };

  const searched = Math.min(digest.tradeSamples.length, digest.dataSufficiency.closedTrades);

  return (
    <CoachCard id="chart-match-card" className={`space-y-3.5 ${className}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Search className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">{heading}</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Drop a chart you are looking at and the coach reads its shape, then shows the
            trades in your own log that look like it — every closed trade you have recorded,
            not just the recent ones. It searches what you have already done — it is not a
            signal, and never a forecast.
          </p>
        </div>
      </div>

      {/* ---- The chart to search with ---- */}
      <div
        className="space-y-2"
        onPaste={(e) => {
          const file = getImageFromPasteEvent(e);
          if (file) {
            e.preventDefault();
            void handleFiles([file]);
          }
        }}
      >
        {queryImage ? (
          <div className="flex items-center gap-3">
            <img
              id="chart-match-preview"
              src={queryImage}
              alt="The chart you are searching with"
              className="h-24 w-40 rounded-xl border border-zinc-800 bg-zinc-950 object-cover"
            />
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-300">This is the chart the coach will search with.</p>
              <button
                type="button"
                id="chart-match-clear"
                onClick={() => {
                  setQueryImage(null);
                  setState(IDLE);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          </div>
        ) : (
          <div
            id="chart-match-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => !reading && fileInputRef.current?.click()}
            className={`relative cursor-pointer rounded-xl border border-dashed p-4 text-center transition-all ${
              dragging
                ? 'border-sky-500 bg-sky-950/20 text-sky-300'
                : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-950'
            }`}
          >
            <input
              id="chart-match-input"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleFiles(e.target.files)}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
              {reading ? (
                <>
                  <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
                  <span className="text-xs text-zinc-300 font-medium">Reading the chart…</span>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 shadow-sm">
                      <ImagePlus className="w-4 h-4" />
                    </div>
                    <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sky-400 shadow-sm">
                      <Upload className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="text-xs font-medium text-zinc-200">
                    <span className="text-sky-400 underline decoration-sky-500/40">
                      Click to browse
                    </span>{' '}
                    or drop a chart here
                  </div>
                  <p className="text-[11px] text-zinc-400 max-w-xs">
                    A screenshot of the setup you are looking at. It stays on your device until
                    you ask, and is only sent to read its shape.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {pickError && (
          <div
            id="chart-match-error"
            className="flex items-start gap-1.5 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/80 rounded-lg p-2"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{pickError}</span>
          </div>
        )}
      </div>

      {/* ---- What the search will actually read, said before it runs ---- */}
      <div id="chart-match-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CoachFact label="Trades searched" value={`${searched}`} />
        <CoachFact label="Pictures compared" value={`${tradeShots.length}`} />
        <CoachFact label="Screenshots you have" value={`${digest.tradeSamples.filter((s) => s.imageCount > 0).length}`} />
        <CoachFact label="Setup names" value={`${setups.length}`} />
      </div>

      {digest.dataSufficiency.closedTrades === 0 ? (
        <p className="text-xs text-zinc-500 italic">
          Nothing closed yet, so there is no history to search. Log a few trades and this can
          find them.
        </p>
      ) : (
        <>
          {searched < digest.dataSufficiency.closedTrades && (
            <p className="text-[11px] leading-relaxed text-amber-300/90">
              This search reads your {searched} most recent closed trades out of{' '}
              {digest.dataSufficiency.closedTrades} logged. The oldest ones are beyond what a
              single search can hold.
            </p>
          )}

          <CoachGenerateButton
            id="chart-match-generate"
            label={state.failure ? 'Try again' : 'Find my trades that look like this'}
            loadingLabel="Searching your history…"
            loading={state.loading}
            disabled={!queryImage}
            onClick={() => void run()}
          />

          {!queryImage && !state.loading && (
            <p className="text-[11px] text-zinc-500">
              Add a chart above first — the search needs something to look for.
            </p>
          )}

          {/*
            The resemblance floor, as the trader's own line.

            Everything below reads the same number: which matches are shown, the mark on the
            distribution, and the bands the search history is counted into. Changing it only
            changes what is shown — the coach's score for each match is untouched.
          */}
          <div
            id="chart-match-floor-control"
            className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label
                htmlFor="chart-match-floor"
                className="text-[10px] font-mono uppercase font-bold text-zinc-400"
              >
                Resemblance floor
              </label>
              <span className="flex items-center gap-2">
                {resemblanceFloor !== CHART_MATCH_FLOOR && (
                  <button
                    type="button"
                    id="chart-match-floor-reset"
                    onClick={() => {
                      setResemblanceFloor(CHART_MATCH_FLOOR);
                      writeStoredFloor(CHART_MATCH_FLOOR);
                    }}
                    className="text-[10px] font-semibold text-sky-400 underline decoration-sky-500/40 transition-colors hover:text-sky-300"
                  >
                    Reset to {CHART_MATCH_FLOOR}%
                  </button>
                )}
                <span
                  id="chart-match-floor-value"
                  data-floor={resemblanceFloor}
                  className="font-mono text-[11px] text-zinc-100"
                >
                  {resemblanceFloor}%
                </span>
              </span>
            </div>
            <input
              id="chart-match-floor"
              type="range"
              min={MIN_MATCH_FLOOR}
              max={MAX_MATCH_FLOOR}
              step={FLOOR_STEP}
              value={resemblanceFloor}
              onChange={(e) => {
                const next = clampFloor(Number(e.target.value));
                setResemblanceFloor(next);
                writeStoredFloor(next);
              }}
              aria-label="Resemblance floor"
              className="w-full accent-sky-500"
            />
            <p className="text-[10px] leading-relaxed text-zinc-500">
              A match must score at least this close to be shown as one. Lower it to see looser
              resemblances, raise it to keep only the closest. It changes what is shown, never the
              score.
            </p>
          </div>

          {state.loading && (
            <CoachLoading
              label="Reading the chart and searching your trades…"
              steps={COACH_WAIT_STEPS('your trades')}
            />
          )}

          {state.failure && (
            <CoachErrorPanel
              code={state.failure.code}
              message={state.failure.message}
              idSuffix="match"
            />
          )}

          {answer && (
            <CoachResultPanel
              id="chart-match-result"
              heading="What looks like this"
              meta={state.writtenAt ? `written ${formatTimestamp(state.writtenAt, timezone)}` : undefined}
              resultKey={state.writtenAt}
              busy={state.loading}
              onRegenerate={() => void run()}
              regenerateLabel="Search again"
            >
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  What the chart shows
                </span>
                <p id="chart-match-pattern" className="mt-1 text-xs text-zinc-300 leading-relaxed">
                  {answer.patternRead}
                </p>
              </div>

              {/*
                The shape of the search at a glance.

                Five rows of percentages are hard to read as a whole; a bar per match, longest
                first with the floor marked, shows in one look whether the search found real
                matches or a spread of loose ones.
              */}
              {answer.matches.length > 0 && (
                <div id="chart-match-distribution" className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                      How strong these matches are
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {strongCount} strong · {goodCount} good · {weakerMatches.length} below the{' '}
                      {resemblanceFloor}% floor
                    </span>
                  </div>
                  <div className="space-y-1">
                    {rankedMatches.map((match, index) => (
                      <div
                        key={`${match.date}-${match.symbol}-bar-${index}`}
                        data-score-bar={match.score}
                        className="flex items-center gap-2"
                      >
                        <span className="w-20 shrink-0 truncate font-mono text-[10px] text-zinc-500">
                          {match.date.slice(5)} {match.symbol}
                        </span>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className={`h-full rounded-full ${scoreBarClass(match.score, resemblanceFloor)}`}
                            style={{ width: `${match.score}%` }}
                          />
                          {/* Where the floor sits, so a bar's length is judged against it. */}
                          <div
                            className="absolute inset-y-0 w-px bg-zinc-500/80"
                            style={{ left: `${resemblanceFloor}%` }}
                            title={`The ${resemblanceFloor}% floor`}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right font-mono text-[10px] text-zinc-300">
                          {match.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    Each bar is one match's closeness score from the coach, longest first. The
                    mark is the {resemblanceFloor}% floor — the bars shorter than it are the ones
                    kept below.
                  </p>
                </div>
              )}

              {answer.matches.length === 0 ? (
                <p id="chart-match-empty" className="text-xs text-zinc-400 leading-relaxed">
                  Nothing in your log resembles this chart yet. That is a real answer, not a
                  failure — {answer.nextStep}
                </p>
              ) : visibleMatches.length === 0 ? (
                /*
                  Every match the coach found is below the floor. Saying that is the honest
                  answer: a resemblance this loose is not one, and padding the list with the
                  best of a weak set would make the search look better than it was.
                */
                <div id="chart-match-weak-only" className="space-y-2">
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Nothing scored above {resemblanceFloor}% alike, so nothing here is genuinely
                    close. The strongest resemblance is {rankedMatches[0].score}% — loose enough
                    that treating it as a match would be a stretch.
                  </p>
                  <button
                    type="button"
                    id="chart-match-show-weaker"
                    onClick={() => setShowWeaker((prev) => !prev)}
                    aria-expanded={showWeaker}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    {showWeaker ? 'Hide' : 'Show'} the {weakerMatches.length} weaker
                    resemblance{weakerMatches.length === 1 ? '' : 's'}
                  </button>
                  {showWeaker &&
                    weakerMatches.map((match, index) => renderMatchRow(match, index))}
                </div>
              ) : (
                <div id="chart-match-matches" className="space-y-3">
                  <div className="space-y-2">
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                      Closest matches ({closestMatches.length} of {answer.matches.length},
                      ranked by how closely they resemble your chart)
                    </span>
                    {closestMatches.map((match, index) => renderMatchRow(match, index))}
                  </div>
                  {alsoSimilar.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
                        Also similar ({alsoSimilar.length})
                      </span>
                      {alsoSimilar.map((match, index) =>
                        renderMatchRow(match, closestMatches.length + index)
                      )}
                    </div>
                  )}

                  {/*
                    The loose matches are hidden, not dropped. The count is always stated, so
                    the trader knows the search found more and chose to rank it below the line.
                  */}
                  {weakerMatches.length > 0 && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        id="chart-match-show-weaker"
                        onClick={() => setShowWeaker((prev) => !prev)}
                        aria-expanded={showWeaker}
                        className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        {showWeaker ? 'Hide' : 'Show'}                        {weakerMatches.length} weaker match
                        {weakerMatches.length === 1 ? '' : 'es'} (below {resemblanceFloor}%
                        alike)
                      </button>
                      {showWeaker &&
                        weakerMatches.map((match, index) =>
                          renderMatchRow(match, visibleMatches.length + index)
                        )}
                    </div>
                  )}
                </div>
              )}

              {answer.matches.length > 0 && (
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  A resemblance is not evidence a trade will work. It is a count of what your
                  own record shows you did — nothing here says the market will repeat it.
                </p>
              )}

              {answer.notInJournal && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Not in the journal
                  </span>
                  <p className="mt-1 text-xs text-zinc-300 leading-relaxed">{answer.notInJournal}</p>
                </div>
              )}

              {answer.nextStep && <CoachAction label="Next step" text={answer.nextStep} />}

              {answer.motivation && <CoachMotivation text={answer.motivation} />}
            </CoachResultPanel>
          )}
        </>
      )}

      {/*
        ---- Past searches ----

        The score distribution across every search the trader has run, strongest first, so
        the question "which of my charts match my own trading most" has an answer they can
        see. Ranked by each search's best match, because that is what makes a chart worth
        looking at again, with the whole history's shape drawn above the rows.
      */}
      {chartSearches && chartSearches.length > 0 && (
        <div id="chart-match-history" className="space-y-2.5 border-t border-zinc-800 pt-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              Past searches ({history.searches}, {history.bands.total} match
              {history.bands.total === 1 ? '' : 'es'})
            </span>
            <span className="text-[10px] text-zinc-500">
              strongest {history.best ?? '—'}% · average {history.average ?? '—'}%
            </span>
          </div>

          <div id="chart-match-history-bands">
            <BandBar bands={history.bands} className="h-2.5" />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {BAND_SEGMENTS.map((segment) => (
              <span
                key={segment.key}
                className="flex items-center gap-1 text-[10px] text-zinc-500"
              >
                <span className={`h-2 w-2 rounded-full ${segment.bar}`} />
                {history.bands[segment.key]} {segment.label}
              </span>
            ))}
          </div>

          <p className="text-[10px] leading-relaxed text-zinc-500">
            {history.withMatches === 0
              ? 'None of your saved searches has matched a trade yet — the shape fills in as you log and search.'
              : 'Your charts ranked by the closest match each one found against your own trades.'}
          </p>

          <div className="space-y-1.5">
            {(showAllHistory ? rankedHistory : rankedHistory.slice(0, HISTORY_PREVIEW)).map(
              (summary) => (
                <div
                  key={summary.id}
                  data-search-row={summary.id}
                  className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2.5"
                >
                  {summary.thumbnail ? (
                    <img
                      src={summary.thumbnail}
                      alt="A chart you searched with"
                      className="h-10 w-14 shrink-0 rounded-lg border border-zinc-800 bg-zinc-950 object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
                      <Search className="h-3.5 w-3.5 text-zinc-600" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-zinc-400">
                        {formatTimestamp(summary.createdAt, timezone)}
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          summary.best === null
                            ? 'border-zinc-700 bg-zinc-800 text-zinc-400'
                            : scoreTone(summary.best)
                        }`}
                      >
                        {summary.best === null ? 'no match' : `best ${summary.best}%`}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {summary.matches} match{summary.matches === 1 ? '' : 'es'}
                        {summary.average !== null ? ` · avg ${summary.average}%` : ''}
                      </span>
                    </div>
                    <BandBar bands={summary.bands} className="h-1.5" />
                    <p className="truncate text-[10px] text-zinc-500">{summary.patternRead}</p>
                  </div>
                  {onDeleteChartSearch && (
                    <button
                      type="button"
                      data-search-delete={summary.id}
                      onClick={() => onDeleteChartSearch(summary.id)}
                      title="Remove this search"
                      className="shrink-0 rounded-lg border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-rose-300"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          {rankedHistory.length > HISTORY_PREVIEW && (
            <button
              type="button"
              id="chart-match-history-toggle"
              onClick={() => setShowAllHistory((prev) => !prev)}
              aria-expanded={showAllHistory}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {showAllHistory ? 'Show fewer' : `Show all ${rankedHistory.length}`}
            </button>
          )}
        </div>
      )}
    </CoachCard>
  );
};
