import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, Search, Trash2, Upload } from 'lucide-react';
import type { DailyReview, Instrument, LevelTouch, Setup, Trade, TradingDay } from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { MatchItem, MatchResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  MAX_COACH_IMAGES,
  MAX_COACH_IMAGE_TOTAL_CHARS,
  isCoachImageDataUrl,
} from '../../lib/ai/coach-images';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { compressAndReadImage, getImageFromPasteEvent } from '../../lib/utils/image-utils';
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

/** How much the resemblance is worth to the trader, said plainly rather than implied. */
function confidenceTone(confidence: MatchItem['confidence']): string {
  if (confidence === 'high') return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
  if (confidence === 'medium') return 'bg-zinc-800 text-zinc-300 border-zinc-700';
  return 'bg-amber-950/60 text-amber-300/90 border-amber-900/70';
}

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
      setState({ loading: false, result, failure: null, writtenAt: new Date().toISOString() });
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
            trades in your own log that look like it. It searches what you have already done
            — it is not a signal, and never a forecast.
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
              The coach reads your {searched} most recent closed trades out of{' '}
              {digest.dataSufficiency.closedTrades} logged. Older trades are not in this
              search yet.
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

              {answer.matches.length === 0 ? (
                <p id="chart-match-empty" className="text-xs text-zinc-400 leading-relaxed">
                  Nothing in your log resembles this chart yet. That is a real answer, not a
                  failure — {answer.nextStep}
                </p>
              ) : (
                <div id="chart-match-matches" className="space-y-2">
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Your trades that look like it ({answer.matches.length})
                  </span>
                  {answer.matches.map((match, index) => {
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
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${confidenceTone(
                                match.confidence
                              )}`}
                            >
                              {match.confidence}
                            </span>
                            <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 text-[10px] font-mono uppercase text-zinc-400">
                              {match.compared === 'their-screenshot'
                                ? 'picture compared'
                                : 'written record'}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-300 leading-relaxed">{match.why}</p>
                          {!trade && (
                            <p className="text-[10px] text-amber-300/80">
                              This trade could not be matched to a row in your log, so it is
                              shown as quoted.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
    </CoachCard>
  );
};
