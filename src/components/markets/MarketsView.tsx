import React, { useEffect, useMemo, useState } from 'react';
import {
  CandlestickChart,
  Check,
  Lock,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
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
import type { ChartReadResponse, CoachPlanFields } from '../../lib/ai/coach-types';
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
  /**
   * Writes a coach-drafted plan into today's plan, for the symbol it was drafted from.
   *
   * The plan is always for the one instrument on screen: the trader charts a single
   * symbol at a time, so the coach is never asked for a plan across every market.
   */
  onApplyPlan: (draft: CoachPlanFields, symbol: string) => void;
  /** A locked plan needs a recorded reason to change, so nothing is offered for it. */
  planLocked?: boolean;
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
  onApplyPlan,
  planLocked = false,
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
  // Set when the trader accepts the drafted plan, so the card can confirm it once.
  const [planAppliedAt, setPlanAppliedAt] = useState<string | null>(null);

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

  // Switching instruments clears the previous read: it described a different chart. The
  // applied note goes with it — it was about the plan for the symbol just left.
  useEffect(() => {
    setOpinion(IDLE_OPINION);
    setPlanAppliedAt(null);
  }, [symbolId]);

  const data: ChartReadResponse | null =
    opinion.result?.ok && opinion.result.data
      ? (opinion.result.data as ChartReadResponse)
      : null;

  /**
   * The plan half of the read, with defaults filled in.
   *
   * The chart read is the older half of this response and the plan fields are new, so a
   * deployment still running the previous function would answer without them. Reading
   * them through defaults keeps the Markets tab working against either shape — a missing
   * plan shows as nothing to apply rather than crashing the view.
   */
  const planFields: CoachPlanFields | null = data
    ? {
        bias: data.bias ?? 'unsure',
        contracts: typeof data.contracts === 'number' ? data.contracts : 0,
        setups: Array.isArray(data.setups) ? data.setups : [],
        waitingFor: typeof data.waitingFor === 'string' ? data.waitingFor : '',
        stayOutIf: typeof data.stayOutIf === 'string' ? data.stayOutIf : '',
        levels: Array.isArray(data.levels) ? data.levels : [],
      }
    : null;

  // Whether the coach drafted anything worth writing into the plan. A bias on its own is
  // not a plan, so it does not count.
  const planWritable = !!planFields && (
    planFields.contracts >= 1 ||
    planFields.setups.length > 0 ||
    planFields.waitingFor.length > 0 ||
    planFields.stayOutIf.length > 0 ||
    planFields.levels.length > 0
  );

  /**
   * Whether the charted symbol is one the journal can price.
   *
   * A symbol the catalog does not hold still gets its plan drafted, but it must not become
   * today's primary instrument: the app would then size and price the day on a contract it
   * does not know.
   */
  const chartedInstrument = instruments.find(
    (inst) =>
      inst.symbol.toLowerCase() === symbol.id.toLowerCase() ||
      inst.id.toLowerCase() === symbol.id.toLowerCase()
  );

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

            {/*
              The same read, as a draft of today's plan.

              Deliberately about this chart only: one symbol is on screen, so the coach is
              asked to plan for that one instrument and never for the journal's whole list.
              It fills the plan fields and stops there — locking the day stays the trader's
              own click, on the same plan they can edit first.
            */}
            {planFields && (
              <div
                className="space-y-3 rounded-xl border border-amber-900/50 bg-amber-950/10 p-3.5"
                data-testid="chart-read-plan"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                    Today's plan for {symbol.label}
                  </span>
                  {planAppliedAt ? (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      Written into today's plan
                    </span>
                  ) : (
                    <button
                      id="markets-apply-plan"
                      onClick={() => {
                        onApplyPlan(planFields, symbol.id);
                        setPlanAppliedAt(new Date().toISOString());
                      }}
                      disabled={planLocked || !planWritable}
                      className="flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 px-3.5 py-2 text-[11px] font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                      Use as today's plan
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Drafted from the {symbol.label} chart alone. Applying it fills today's plan
                  fields for this instrument — it does not lock anything, and the plan stays
                  yours to edit.
                </p>

                {planWritable ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-2 py-1.5">
                        <span className="text-[10px] text-zinc-500 block uppercase font-mono">
                          Bias
                        </span>
                        <span className="text-zinc-100 font-mono font-bold text-xs">
                          {planFields.bias}
                        </span>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-2 py-1.5">
                        <span className="text-[10px] text-zinc-500 block uppercase font-mono">
                          Contracts
                        </span>
                        <span className="text-zinc-100 font-mono font-bold text-xs">
                          {planFields.contracts >= 1 ? planFields.contracts : 'unchanged'}
                        </span>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-2 py-1.5">
                        <span className="text-[10px] text-zinc-500 block uppercase font-mono">
                          Setups
                        </span>
                        <span className="text-zinc-100 font-mono font-bold text-xs">
                          {planFields.setups.length ? planFields.setups.join(', ') : 'unchanged'}
                        </span>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <p className="text-[11px] text-zinc-300 leading-relaxed">
                        <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                          What am I waiting for?
                        </span>
                        {planFields.waitingFor || (
                          <span className="text-zinc-500">unchanged from your plan</span>
                        )}
                      </p>
                      <p className="text-[11px] text-zinc-300 leading-relaxed">
                        <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                          Stay out if
                        </span>
                        {planFields.stayOutIf || (
                          <span className="text-zinc-500">unchanged from your plan</span>
                        )}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    The coach drafted no plan fields from this chart, so there is nothing to write
                    into today's plan.
                  </p>
                )}

                {planFields.levels.length > 0 && (
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    The {planFields.levels.length} level
                    {planFields.levels.length === 1 ? '' : 's'} above become today's planned levels.
                  </p>
                )}

                {planLocked && (
                  <p className="text-[11px] text-zinc-400 leading-relaxed flex items-start gap-1.5">
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                    Today's plan is locked, so it cannot be filled from here. Unlock it first if you
                    want to plan around this chart.
                  </p>
                )}

                {!chartedInstrument && (
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    {symbol.label} is not one of your journal instruments, so today's primary
                    instrument keeps its current setting.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CoachCard>
    </div>
  );
};
