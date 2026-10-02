import React, { useMemo, useState } from 'react';
import { Compass, Target, TrendingUp } from 'lucide-react';
import {
  CoachPlan,
  DailyReview,
  Instrument,
  LevelOutlook,
  LevelTouch,
  MarkedLevel,
  Setup,
  TouchOutcome,
  Trade,
  TradingDay,
} from '../../types';
import { summarizeMarkedLevels } from '../../lib/analytics/level-edge';
import {
  summarizeTimeframeEdges,
  timeframeBucketLabel,
  timeframeHighlights,
  type TimeframeEdgeBucket,
} from '../../lib/analytics/level-timeframes';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { EdgeResponse, EntryEdgeResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  CoachAction,
  CoachBullets,
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
import { instrumentSymbol } from '../../lib/trading/instruments';

/**
 * The break-and-run edge finder.
 *
 * This is where the level-touch journal pays off. The trader logs two setups — the same
 * pattern at different sessions — and this card answers the only question that matters for
 * them: of the conditions in their own record, which ones actually see price not come back.
 *
 * Two layers, deliberately:
 *
 * 1. The **record itself**, computed live from the touches with no AI. Counts, the hold
 *    rate, and every condition ranked. This is shown before any button is pressed so the
 *    trader can check the coach against the same numbers, exactly as the Coach tab shows
 *    its behaviour and form figures up front.
 * 2. The **coach's read**, on request, from the `edge` mode. Its guardrails forbid reading
 *    a rate off a thin bucket and forbid calling a hold a profit, so it points at the
 *    sample rather than at what to trade.
 */
export interface EdgeFinderCardProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  maxDrawdown?: number | null;
  levelTouches: LevelTouch[];
  /**
   * The levels the trader marked before any of them was touched.
   *
   * Fed into the coverage read below, which answers the question the hold rate cannot: how
   * many of the lines the trader wrote down were ever tested at all. Omitted leaves the
   * coverage block out, so a journal that only logs touches still reads as before.
   */
  markedLevels?: MarkedLevel[];
  /**
   * The trader's per-instrument outlooks for the day.
   *
   * Carried into the digest so an entry read can weigh it against what the trader expected,
   * and so the answer can say when the trader's own lean disagrees with the entry they are
   * asking about.
   */
  levelOutlooks?: LevelOutlook[];
  /**
   * The instruments to label the timeframe breakdown with — the trader's tracked four,
   * including any levels-only symbol like VIX that the trade catalog does not hold.
   * Omitted falls back to the catalog, which is right whenever every marked level is tradable.
   */
  levelInstruments?: Instrument[];
  /**
   * The coach's own plans with the trader's grades and feedback, when there are any.
   *
   * Carried into the digest so the read learns from what the trader keeps telling the coach
   * about how it plans; the guardrails keep a grade from being read as market data.
   */
  coachPlans?: CoachPlan[];
}

interface EdgeState {
  loading: boolean;
  /** The last answer that arrived, kept while a retry runs so nothing is blanked. */
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  writtenAt?: string;
}

const IDLE: EdgeState = { loading: false, result: null, failure: null };

/** A rate, or an honest dash while the sample is too thin to carry one. */
function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

/** Plain words for what a marked line's own record says, or that nothing says anything. */
function lineStatusWord(touch: LevelTouch | null): string {
  if (!touch) return 'never touched';
  switch (touch.outcome) {
    case 'never-returned':
      return 'broke away, never came back';
    case 'returned':
      return 'came back inside — did not hold';
    case 'watching':
      return 'touched, still watching';
    case 'invalid':
      return 'void';
    default:
      return 'touched';
  }
}

/**
 * The colour each logged state reads as.
 *
 * Grey for never-touched on purpose: it is the absence of an outcome, and colouring it green
 * or red would say something the record does not.
 */
const LINE_STATUS_STYLE: Record<'never-touched' | TouchOutcome, string> = {
  'never-touched': 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  watching: 'border-sky-800/70 bg-sky-950/40 text-sky-300',
  'never-returned': 'border-emerald-800 bg-emerald-950/60 text-emerald-300',
  returned: 'border-rose-900/80 bg-rose-950/50 text-rose-300',
  invalid: 'border-zinc-800 bg-zinc-900 text-zinc-500',
};

export const EdgeFinderCard: React.FC<EdgeFinderCardProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
  maxDrawdown,
  levelTouches,
  markedLevels,
  levelOutlooks,
  levelInstruments,
  coachPlans,
}) => {
  const labelInstruments = levelInstruments ?? instruments;
  const coverage = useMemo(
    () => summarizeMarkedLevels(markedLevels ?? [], levelTouches),
    [markedLevels, levelTouches]
  );
  const timeframeBuckets = useMemo(
    () => summarizeTimeframeEdges(markedLevels ?? [], levelTouches),
    [markedLevels, levelTouches]
  );
  // The three headline findings, computed here rather than asked of the coach: they are
  // arithmetic over the trader's own counts, so they are shown before any button is pressed.
  const highlights = useMemo(() => timeframeHighlights(timeframeBuckets), [timeframeBuckets]);
  const labelOf = (bucket: TimeframeEdgeBucket) =>
    timeframeBucketLabel(bucket, instrumentSymbol(labelInstruments, bucket.instrumentId));
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
        // The marked lines and the day's outlooks travel with this digest too. The entry read
        // is built on them, and the edge read above was previously blind to them.
        markedLevels,
        levelOutlooks,
        coachPlans,
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
      markedLevels,
      levelOutlooks,
      coachPlans,
    ]
  );

  const edge = digest.levelEdge;
  const [state, setState] = useState<EdgeState>(IDLE);

  // ---- The entry edge ------------------------------------------------------
  // A second, independent request: the trader names one entry and the coach reads it against
  // the lines marked today. Kept apart from the edge read above so neither answer overwrites
  // the other on screen.
  const symbols = labelInstruments.map((instrument) => instrument.symbol);
  const [entrySymbol, setEntrySymbol] = useState(() => symbols[0] ?? 'MES');
  const [entryDirection, setEntryDirection] = useState<'long' | 'short'>('long');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [entryState, setEntryState] = useState<EdgeState>(IDLE);

  /**
   * Today's own lines for the chosen symbol, each with the touch it links to.
   *
   * Computed here rather than asked of the coach, so the trader can see exactly which lines
   * the read will be about — and check the answer against the same list — before pressing
   * anything. A line with no linked touch is shown as never touched, never as held.
   */
  const todayLines = useMemo(() => {
    const touchByLevel = new Map<string, LevelTouch>();
    for (const touch of levelTouches) {
      if (touch.levelId) touchByLevel.set(touch.levelId, touch);
    }
    return (markedLevels ?? [])
      .filter(
        (level) =>
          level.tradeDate === todayTradeDate &&
          instrumentSymbol(labelInstruments, level.instrumentId).toUpperCase() ===
            entrySymbol.toUpperCase()
      )
      .map((level) => ({ level, touch: touchByLevel.get(level.id) ?? null }));
  }, [markedLevels, levelTouches, todayTradeDate, labelInstruments, entrySymbol]);

  const touchedToday = todayLines.filter((row) => row.touch).length;

  async function runEntryEdge() {
    setEntryError(null);
    const price = Number(entryPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setEntryError('Enter the price you are thinking of entering at.');
      return;
    }
    setEntryState((prev) => ({ ...prev, loading: true, failure: null }));
    const result = await requestCoach('entryedge', digest, undefined, {
      entryEdge: { symbol: entrySymbol, direction: entryDirection, entryPrice: price },
    });

    if (result.ok) {
      setEntryState({
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
      });
      return;
    }
    setEntryState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const entryAnswer = entryState.result?.ok
    ? (entryState.result.data as EntryEdgeResponse)
    : null;

  async function run() {
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    const result = await requestCoach('edge', digest);

    if (result.ok) {
      setState({
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
      });
      return;
    }
    setState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const answer = state.result?.ok ? (state.result.data as EdgeResponse) : null;

  return (
    <CoachCard id="playbook-edge-finder" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
          <Target className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Break-and-run edge finder
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Which of your level conditions actually see price not come back — from your own
            logged touches, not from a guess.
          </p>
        </div>
      </div>

      {/*
        How much of the marked-level record the touches actually cover.

        Shown before the touch count, because it is the thing the hold rate cannot say: a
        trader whose indicator offers six lines and who only ever tests two is leaving four
        out of the record, and that only exists because the levels were written down first.
      */}
      {coverage.marked > 0 && (
        <div
          id="playbook-edge-coverage"
          className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              Marked levels tested
            </span>
            <span className="text-[10px] text-zinc-500">
              {coverage.tested} of {coverage.marked} tested
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CoachFact label="Levels marked" value={`${coverage.marked}`} />
            <CoachFact label="Tested" value={`${coverage.tested}`} />
            <CoachFact label="Never tested" value={`${coverage.untested}`} />
            <CoachFact
              label="Test rate"
              value={coverage.testRate === null ? '—' : `${coverage.testRate}%`}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            The hold rate below is counted from every touch. Of the lines you marked,{' '}
            {coverage.testedStats.decided} of the tested ones are decided
            {coverage.testedStats.decided > 0
              ? `, holding ${formatRate(coverage.testedStats.holdRate)} of the time`
              : ''}
            . {coverage.untested} line{coverage.untested === 1 ? '' : 's'} you marked were never
            tested — worth noticing if your indicator keeps offering them.
          </p>
        </div>
      )}

      {/*
        Which timeframe and side price actually reaches.

        This is the comparison the trader marked the lines for: a 5-minute resistance that is
        reached every day against a 30-minute one that is not. Counts first — a bucket with no
        decided touch reports its watched lines, never a rate.
      */}
      {timeframeBuckets.length > 0 && (
        <div
          id="playbook-edge-timeframes"
          className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              By timeframe and side
            </span>
            <span className="text-[10px] text-zinc-500">
              which lines price reaches, and how they behaved
            </span>
          </div>
          <div className="space-y-1">
            {timeframeBuckets.slice(0, 12).map((bucket) => (
              <div
                key={bucket.key}
                data-timeframe-bucket={bucket.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-1.5"
              >
                <span className="truncate text-xs text-zinc-200">
                  {timeframeBucketLabel(
                    bucket,
                    instrumentSymbol(labelInstruments, bucket.instrumentId)
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {bucket.marked} marked · {bucket.tested} touched
                  {bucket.stats.decided === 0
                    ? ' · no decided touch yet'
                    : bucket.stats.enoughData
                    ? ` · held ${formatRate(bucket.stats.holdRate)} of ${bucket.stats.decided}`
                    : ` · ${bucket.stats.decided} decided — too thin for a rate`}
                </span>
              </div>
            ))}
          </div>
          {timeframeBuckets.length > 12 && (
            <p className="text-[10px] text-zinc-600">
              Showing the 12 busiest of {timeframeBuckets.length} instrument/timeframe/side records.
            </p>
          )}
        </div>
      )}

      {/*
        The record's own headline findings.

        Shown before any AI runs, and drawn only from buckets that clear a count floor, so
        each line is something the trader can check rather than a hunch dressed as a signal.
      */}
      {(highlights.mostReached || highlights.mostIgnored || highlights.bestHold) && (
        <div
          id="playbook-edge-highlights"
          className="space-y-1.5 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3"
        >
          <span className="text-[10px] font-mono uppercase font-bold text-emerald-300/90">
            What the record says
          </span>
          {highlights.mostReached && (
            <p className="text-[11px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-emerald-300">Most reached:</span>{' '}
              {labelOf(highlights.mostReached)} — price has reached{' '}
              {highlights.mostReached.tested} of its {highlights.mostReached.marked} marked
              lines.
            </p>
          )}
          {highlights.mostIgnored && (
            <p className="text-[11px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-amber-300">Marked but rarely tested:</span>{' '}
              {labelOf(highlights.mostIgnored)} — {highlights.mostIgnored.untested} of its{' '}
              {highlights.mostIgnored.marked} lines have never been logged as touched.
            </p>
          )}
          {highlights.bestHold && (
            <p className="text-[11px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-emerald-300">
                Strongest hold with a real sample:
              </span>{' '}
              {labelOf(highlights.bestHold)} — held{' '}
              {formatRate(highlights.bestHold.stats.holdRate)} of{' '}
              {highlights.bestHold.stats.decided} decided.
            </p>
          )}
        </div>
      )}

      {/*
        Read one entry against today's own lines.

        The trader names a side and a price; the coach reads that exact entry against the lines
        they wrote down today — each with its own logged state — and the live price. The list of
        lines is shown before any button is pressed, so the answer can be checked against the
        same list it was built from rather than taken on trust.
      */}
      <div
        id="playbook-entry-edge"
        className="space-y-2.5 rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-3"
      >
        <div className="flex items-start gap-2">
          <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
          <div>
            <span className="text-[10px] font-mono uppercase font-bold text-indigo-300/90">
              Read one entry against today's levels
            </span>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
              Name the side and the price you are thinking of entering at. The coach reads it
              against the lines you marked today — each with its own logged state — and the live
              price, and says what your own record does and does not support.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label
              htmlFor="entry-edge-symbol"
              className="mb-1 block text-[10px] font-medium text-zinc-400"
            >
              Instrument
            </label>
            <select
              id="entry-edge-symbol"
              value={entrySymbol}
              onChange={(event) => {
                setEntrySymbol(event.target.value);
                setEntryState(IDLE);
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {symbols.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-medium text-zinc-400">Side</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {(['long', 'short'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  id={`entry-edge-${side}`}
                  aria-pressed={entryDirection === side}
                  onClick={() => {
                    setEntryDirection(side);
                    setEntryState(IDLE);
                  }}
                  className={`rounded-md py-1 text-[11px] font-semibold capitalize transition-colors ${
                    entryDirection === side
                      ? side === 'long'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {side}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="entry-edge-price"
              className="mb-1 block text-[10px] font-medium text-zinc-400"
            >
              Entry price
            </label>
            <input
              id="entry-edge-price"
              type="number"
              step="0.25"
              inputMode="decimal"
              placeholder="7742.25"
              value={entryPrice}
              onChange={(event) => {
                setEntryPrice(event.target.value);
                setEntryError(null);
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              id="entry-edge-run"
              disabled={entryState.loading}
              onClick={runEntryEdge}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-700/70 bg-indigo-500/20 px-2.5 py-1.5 text-[11px] font-bold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {entryState.loading ? 'Reading…' : 'Read my edge'}
            </button>
          </div>
        </div>

        {entryError && <p className="text-[11px] text-rose-300">{entryError}</p>}

        {/*
          Today's lines for the chosen symbol, before any AI runs.

          This is the list the read is built from, shown so the trader can check it — and it is
          useful on its own, because "which of my lines did price actually reach today" is a
          question the record can answer without a model.
        */}
        <div id="entry-edge-levels" className="space-y-1.5 border-t border-indigo-900/40 pt-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              {entrySymbol} · lines marked today
            </span>
            <span className="text-[10px] text-zinc-500">
              {todayLines.length} marked · {touchedToday} touched
            </span>
          </div>
          {todayLines.length === 0 ? (
            <p className="text-[11px] italic text-zinc-500">
              Nothing marked for {entrySymbol} today. Mark its lines below first — the read can
              only be about lines you wrote down.
            </p>
          ) : (
            <div className="space-y-1">
              {todayLines.map(({ level, touch }) => (
                <div
                  key={level.id}
                  data-entry-level={level.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2 py-1"
                >
                  <span className="font-mono text-[10px] text-zinc-500">
                    {level.timeframe ?? '—'} · {level.kind}
                  </span>
                  <span className="font-mono text-xs font-semibold text-zinc-100">
                    {level.price}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase font-bold ${
                      LINE_STATUS_STYLE[touch?.outcome ?? 'never-touched']
                    }`}
                  >
                    {touch?.outcome ?? 'never-touched'}
                  </span>
                  <span className="text-[10px] text-zinc-500">{lineStatusWord(touch)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {entryState.loading && (
          <CoachLoading
            label="Reading your entry against your own lines…"
            steps={COACH_WAIT_STEPS('your marked lines')}
          />
        )}

        {entryState.failure && (
          <CoachErrorPanel
            code={entryState.failure.code}
            message={entryState.failure.message}
            idSuffix="entryedge"
          />
        )}

        {entryAnswer && (
          <CoachResultPanel
            id="playbook-entry-edge-result"
            heading="Entry read"
            meta={
              entryState.writtenAt
                ? `written ${formatTimestamp(entryState.writtenAt, timezone)}`
                : undefined
            }
            resultKey={entryState.writtenAt}
            busy={entryState.loading}
            onRegenerate={runEntryEdge}
            regenerateLabel="Read again"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                  entryAnswer.stance === 'with-the-record'
                    ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300'
                    : entryAnswer.stance === 'against-the-record'
                    ? 'border-rose-900/80 bg-rose-950/50 text-rose-300'
                    : 'border-amber-900/70 bg-amber-950/40 text-amber-300'
                }`}
              >
                {entryAnswer.stance.replace(/-/g, ' ')}
              </span>
              <span className="text-[10px] text-zinc-500">
                confidence {entryAnswer.confidence}
              </span>
            </div>

            <p className="text-sm font-semibold leading-snug text-zinc-100">
              {entryAnswer.headline}
            </p>
            <p className="text-xs leading-relaxed text-zinc-300">{entryAnswer.entryRead}</p>
            <p className="text-xs leading-relaxed text-zinc-300">{entryAnswer.levelRead}</p>

            {entryAnswer.watch.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  Lines to watch
                </span>
                {entryAnswer.watch.map((note, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-200">{note.level}</span>
                      {note.status && (
                        <span className="font-mono text-[10px] uppercase text-zinc-500">
                          {note.status}
                        </span>
                      )}
                    </div>
                    {note.note && (
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                        {note.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {entryAnswer.risks.length > 0 && (
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  What would make this a mistake
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={entryAnswer.risks}
                    tone="bad"
                    emptyLabel="Nothing specific was named."
                  />
                </div>
              </div>
            )}

            {entryAnswer.notInJournal && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-3">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  Your record does not settle
                </span>
                <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                  {entryAnswer.notInJournal}
                </p>
              </div>
            )}

            <p className="text-xs leading-relaxed text-zinc-300">{entryAnswer.rationale}</p>
            <CoachAction label="Next step" text={entryAnswer.nextStep} />

            {entryAnswer.basedOn.length > 0 && (
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  What it leaned on
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={entryAnswer.basedOn}
                    tone="neutral"
                    emptyLabel="It answered without citing a single figure, so treat it with suspicion."
                  />
                </div>
              </div>
            )}
          </CoachResultPanel>
        )}
      </div>

      {edge.touches === 0 ? (
        <p className="text-xs text-zinc-500 italic">
          No level touches logged yet. Mark today's levels, then tap Touched when price reaches
          one — this will show which conditions hold.
        </p>
      ) : (
        <>
          {/* The deterministic record. Shown before any AI so the read can be checked. */}
          <div id="playbook-edge-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <CoachFact label="Touches logged" value={`${edge.touches}`} />
            <CoachFact label="Decided" value={`${edge.decided}`} />
            <CoachFact
              label="Never came back"
              value={`${edge.neverReturned} / ${edge.decided}`}
            />
            <CoachFact
              label="Hold rate"
              value={edge.enoughData ? formatRate(edge.holdRate) : 'too thin'}
            />
          </div>

          {!edge.enoughData && (
            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              {edge.decided === 0
                ? 'No touch has a decided outcome yet — a touch only counts once price has broken the level and been watched from there.'
                : `${edge.decided} decided touch(es) so far. ${edge.minDecided} are needed before a hold rate means anything, so read the counts below, not a rate.`}
            </p>
          )}

          {edge.conditions.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Conditions with a readable rate
              </span>
              <ul className="space-y-1.5">
                {edge.conditions.map((bucket) => (
                  <li
                    key={bucket.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                  >
                    <span className="text-xs text-zinc-200 truncate">{bucket.label}</span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs font-mono font-semibold text-emerald-400">
                        {formatRate(bucket.stats.holdRate)}
                      </span>
                      <span className="block text-[10px] text-zinc-500">
                        {bucket.stats.decided} decided · {bucket.stats.watching} watching
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {edge.thinConditions.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Logged, not yet readable
              </span>
              <ul className="space-y-1">
                {edge.thinConditions.map((bucket) => (
                  <li key={bucket.key} className="flex items-start gap-2">
                    <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                    <span className="text-xs text-zinc-400 leading-relaxed">
                      {bucket.label}: {bucket.stats.touches} touch(es), {bucket.stats.decided}{' '}
                      decided, {bucket.stats.watching} watching
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!answer && (
            <CoachGenerateButton
              id="playbook-edge-generate"
              label={state.failure ? 'Try again' : 'Find my edge'}
              loadingLabel="Reading your level touches…"
              loading={state.loading}
              onClick={run}
            />
          )}

          {state.loading && (
            <CoachLoading
              label="Reading which conditions hold…"
              steps={COACH_WAIT_STEPS('level touches')}
            />
          )}

          {state.failure && (
            <CoachErrorPanel
              code={state.failure.code}
              message={state.failure.message}
              idSuffix="edge"
            />
          )}

          {answer && (
            <CoachResultPanel
              id="playbook-edge-result"
              heading="Result"
              meta={
                state.writtenAt ? `written ${formatTimestamp(state.writtenAt, timezone)}` : undefined
              }
              resultKey={state.writtenAt}
              busy={state.loading}
              onRegenerate={run}
              regenerateLabel="Find again"
            >
              <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>
              <p className="text-xs text-zinc-300 leading-relaxed">{answer.bestCondition}</p>

              {answer.conditions.length > 0 && (
                <div className="space-y-2">
                  {answer.conditions.map((condition, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-zinc-200">
                          {condition.condition}
                        </span>
                        <span className="shrink-0 text-xs font-mono text-emerald-400">
                          {condition.holdRate}
                        </span>
                      </div>
                      {condition.evidence && (
                        <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                          {condition.evidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {answer.notYetReadable.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Not yet readable
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={answer.notYetReadable}
                      tone="neutral"
                      emptyLabel="Every logged condition has enough decided touches."
                    />
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-300 leading-relaxed">{answer.whatItMeans}</p>
              <CoachAction label="Next step" text={answer.nextStep} />
              <CoachMotivation text={answer.motivation} />
            </CoachResultPanel>
          )}
        </>
      )}
    </CoachCard>
  );
};
