import React, { useEffect, useMemo, useState } from 'react';
import { CandlestickChart, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import {
  CHART_SYMBOLS,
  chartQuoteSymbol,
  findChartSymbol,
  type ChartSymbol,
} from '../../lib/trading/chart-symbols';
import { MarketChart } from './MarketChart';
import { AiThinking, COACH_WAIT_STEPS } from '../common/AiThinking';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import {
  requestCoach,
  type CoachErrorCode,
  type CoachResult,
} from '../../lib/ai/coach-client';
import type { ChartReadResponse } from '../../lib/ai/coach-types';
import {
  fetchInstrumentQuote,
  formatQuotePercent,
  formatQuotePrice,
} from '../../lib/ai/plan-coach';
import type { InstrumentQuote } from '../../lib/ai/market-data';
import type {
  DailyReview,
  Instrument,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { CoachCard, CoachErrorPanel } from '../coach/coach-ui';

/**
 * The Markets view: a live chart of the futures the trader watches, the live quote, and
 * the coach's opinion on what the chart shows.
 *
 * Deliberate boundaries, kept from the rest of the coach:
 * - The chart is the provider's widget; the numbers behind the opinion are fetched by
 *   the app's own server, so what the coach quotes is what this app handed it.
 * - The opinion is labelled as an opinion, and standing aside is a first-class answer.
 * - Nothing here runs on a timer: both the quote and the opinion load on request, the
 *   same way every coach call in the app works.
 */

interface MarketsViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  maxDrawdown?: number | null;
  /** Today's primary instrument, used as the default chart when it is chartable. */
  primaryInstrument?: string;
  theme: 'dark' | 'light';
}

const GROUP_LABELS: Record<ChartSymbol['group'], string> = {
  index: 'Index futures',
  metals: 'Metals',
  energy: 'Energy',
};

const GROUP_ORDER: readonly ChartSymbol['group'][] = ['index', 'metals', 'energy'];

interface OpinionState {
  loading: boolean;
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  /** Set on every successful run; keys the panel and re-expands it. */
  writtenAt?: string;
}

const IDLE_OPINION: OpinionState = { loading: false, result: null, failure: null };

const SymbolChip: React.FC<{
  symbol: ChartSymbol;
  active: boolean;
  onSelect: () => void;
}> = ({ symbol, active, onSelect }) => (
  <button
    onClick={onSelect}
    aria-pressed={active}
    className={`rounded-lg px-2.5 py-1 text-xs font-bold font-mono transition-colors ${
      active
        ? 'bg-amber-500/90 text-zinc-950'
        : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700/80'
    }`}
    title={symbol.name}
  >
    {symbol.label}
  </button>
);

export const MarketsView: React.FC<MarketsViewProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
  maxDrawdown,
  primaryInstrument,
  theme,
}) => {
  const [symbolId, setSymbolId] = useState<string>(() => findChartSymbol(primaryInstrument).id);
  const symbol = findChartSymbol(symbolId);

  // ---- Live quote, fetched on request and on symbol change ----
  const quoteChartable = chartQuoteSymbol(symbol.id) !== null;
  const [quote, setQuote] = useState<InstrumentQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (!quoteChartable) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    fetchInstrumentQuote(symbol.id).then((result) => {
      if (cancelled) return;
      setQuote(result);
      setQuoteLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol.id, quoteChartable]);

  const change = quote?.changePercent ?? null;
  const changeTone =
    change === null ? 'text-zinc-400' : change >= 0 ? 'text-emerald-400' : 'text-rose-400';

  // ---- The coach's read of the chart ----
  const [opinion, setOpinion] = useState<OpinionState>(IDLE_OPINION);

  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays,
        reviews,
        setups,
        instruments,
        todayTradeDate,
        maxDrawdown,
        timezone,
      }),
    [trades, tradingDays, reviews, setups, instruments, todayTradeDate, timezone, maxDrawdown]
  );

  async function runChartRead() {
    setOpinion((prev) => ({ ...prev, loading: true, failure: null }));
    const result = await requestCoach('chartread', digest, undefined, {
      instrument: symbol.id,
    });
    if (result.ok) {
      setOpinion((prev) => ({
        ...prev,
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
      }));
    } else {
      setOpinion((prev) => ({
        ...prev,
        loading: false,
        failure: { code: result.code, message: result.message },
      }));
    }
  }

  // Switching instruments clears the previous read: it described a different chart.
  useEffect(() => {
    setOpinion(IDLE_OPINION);
  }, [symbolId]);

  const data: ChartReadResponse | null =
    opinion.result?.ok && opinion.result.data
      ? (opinion.result.data as ChartReadResponse)
      : null;

  const directionStyle = data
    ? data.direction === 'long'
      ? { icon: <TrendingUp className="w-3.5 h-3.5" />, cls: 'bg-emerald-950/60 text-emerald-300 border-emerald-800' }
      : data.direction === 'short'
      ? { icon: <TrendingDown className="w-3.5 h-3.5" />, cls: 'bg-rose-950/60 text-rose-300 border-rose-800' }
      : { icon: <span className="w-3.5 h-3.5 inline-block" />, cls: 'bg-zinc-800/80 text-zinc-300 border-zinc-700' }
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <CandlestickChart className="w-5 h-5 text-amber-400" />
          Markets
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          The futures you trade, live. The coach's opinion on a chart is one view from one
          moment — it can be wrong, and the decision stays yours.
        </p>
      </div>

      {/* ---- Symbol picker ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
              {GROUP_LABELS[group]}
            </span>
            <div className="flex gap-1">
              {CHART_SYMBOLS.filter((s) => s.group === group).map((s) => (
                <SymbolChip
                  key={s.id}
                  symbol={s}
                  active={s.id === symbol.id}
                  onSelect={() => setSymbolId(s.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ---- Chart + live quote ---- */}
      <MarketChart symbol={symbol} theme={theme} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <span className="text-xs font-bold text-zinc-200">{symbol.name}</span>
        {quoteChartable ? (
          quoteLoading && !quote ? (
            <span className="text-xs text-zinc-500">Loading quote…</span>
          ) : quote?.ok ? (
            <>
              <span className="font-mono text-lg font-bold text-zinc-100">
                {formatQuotePrice(quote.price)}
              </span>
              <span className={`font-mono text-sm font-bold ${changeTone}`}>
                {formatQuotePercent(change)}
              </span>
              {(quote.dayLow !== null || quote.dayHigh !== null) && (
                <span className="text-xs text-zinc-400 font-mono">
                  Day {formatQuotePrice(quote.dayLow)}–{formatQuotePrice(quote.dayHigh)}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-zinc-500">
              {quote?.note ?? 'Live quote unavailable right now.'}
            </span>
          )
        ) : (
          <span className="text-xs text-zinc-500">
            No live quote is mapped for {symbol.label}; the chart above is the live view.
          </span>
        )}
      </div>

      {/* ---- The coach's read ---- */}
      <CoachCard className="space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
                What does the coach see?
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Reads the recent daily bars of {symbol.label} against your own journal — your
                setups, your discipline record, your repeated leaks. An opinion, not a signal.
              </p>
            </div>
          </div>
          {!opinion.loading && (
            <button
              id="markets-chart-read"
              onClick={runChartRead}
              className="flex items-center gap-2 rounded-xl bg-amber-500/90 hover:bg-amber-400 text-zinc-950 px-4 py-2 text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {data || opinion.failure ? 'Read it again' : 'Read the chart'}
            </button>
          )}
        </div>

        {opinion.loading && (
          <AiThinking
            label={`Reading the ${symbol.label} chart…`}
            steps={COACH_WAIT_STEPS(`${symbol.label} chart`)}
          />
        )}

        {opinion.failure && (
          <CoachErrorPanel code={opinion.failure.code} message={opinion.failure.message} idSuffix="chartread" />
        )}

        {data && !opinion.loading && (
          <div className="space-y-3" data-testid="chart-read-result">
            <div className="flex items-center gap-2 flex-wrap">
              {directionStyle && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase ${directionStyle.cls}`}
                >
                  {directionStyle.icon}
                  {data.direction === 'skip' ? 'Would stand aside' : data.direction}
                </span>
              )}
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
                confidence {data.confidence}
              </span>
            </div>

            <p className="text-sm font-semibold text-zinc-100 leading-snug">{data.headline}</p>
            <p className="text-xs text-zinc-300 leading-relaxed">{data.patternRead}</p>

            {data.levels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.levels.map((level, index) => (
                  <span
                    key={index}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-mono text-zinc-300"
                  >
                    {level.label ? `${level.label} ` : ''}
                    {formatQuotePrice(level.price)}
                  </span>
                ))}
              </div>
            )}

            {data.direction !== 'skip' && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Entry', value: data.entry },
                  { label: 'Stop', value: data.stop },
                  { label: 'Target', value: data.target },
                ].map((cell) => (
                  <div
                    key={cell.label}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                  >
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
                      {cell.label}
                    </span>
                    <p className="font-mono text-sm font-bold text-zinc-100">
                      {formatQuotePrice(cell.value)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Against your own record
              </span>
              <p className="text-xs text-zinc-300 leading-relaxed mt-1">{data.fitsTheirTrading}</p>
            </div>

            {data.risks.length > 0 && (
              <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 px-3.5 py-2.5">
                <span className="text-[10px] font-mono uppercase font-bold text-rose-400">
                  What would make this wrong
                </span>
                <ul className="mt-1 space-y-1">
                  {data.risks.map((risk, index) => (
                    <li key={index} className="text-xs text-zinc-300 leading-relaxed">
                      · {risk}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-zinc-300 leading-relaxed">{data.rationale}</p>

            {data.basedOn.length > 0 && (
              <div className="border-t border-zinc-800/80 pt-2">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
                  Based on
                </span>
                <ul className="mt-1 space-y-0.5">
                  {data.basedOn.map((item, index) => (
                    <li key={index} className="text-[11px] text-zinc-500 leading-relaxed">
                      · {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CoachCard>
    </div>
  );
};
