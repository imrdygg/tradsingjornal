import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  LineChart as LineChartIcon,
  ScatterChart as ScatterIcon,
  Wrench,
} from 'lucide-react';
import type { Instrument, LevelTouch, MarkedLevel, TradingDay } from '../../types';
import { CoachCard } from '../coach/coach-ui';
import { formatLevelPrice, instrumentSymbol } from '../../lib/trading/instruments';
import { MIN_DECIDED } from '../../lib/analytics/level-edge';
import {
  buildEdgeCurve,
  buildLevelFixup,
  buildSessionCoverage,
  buildSymbolComparison,
  buildSymbolCoverage,
  buildTouchTimeline,
} from '../../lib/analytics/level-charts';

/**
 * The level record, drawn.
 *
 * The two cards above read the marked lines and the logged touches as counts and rates. This
 * one puts the same record on axes, because what a level journal says is far easier to see
 * than to read:
 *
 * 1. **Coverage by symbol** — how much of each contract's marked lines price ever reached, with
 *    the lines the trader closed out as never reached shown separately from the ones still open.
 * 2. **Edge over time** — the hold rate as decided touches accumulate. A rate that only moves
 *    when the sample grows is worth watching; one that collapses after the first few good
 *    touches was never an edge.
 * 3. **Touch timeline** — every touch placed at its clock time and price, coloured by what price
 *    did afterwards: green held, red came back, grey still being watched.
 * 4. **Coverage by session** — per day, how many lines were marked and how many were reached, so
 *    a run of sessions with many lines and no touches stands out.
 * 5. **Two contracts side by side** — the same counts opposite each other on one shared scale,
 *    with the hold rate both contracts are judged by, so the comparison needs no selector swap.
 *
 * Every number is the trader's own record. Nothing here is fetched and nothing is predicted, and
 * the thin-sample rules the rest of the app follows still hold: the hold-rate line is drawn as a
 * running tally until the decided count clears {@link MIN_DECIDED}.
 */

export interface LevelChartCardProps {
  /** Every marked line, across all days — the coverage is read over the whole history. */
  levels: MarkedLevel[];
  /** Every logged touch, so reach, hold and the timeline can be built. */
  touches: LevelTouch[];
  /** The instruments to name, and to offer in the selector. */
  instruments: Instrument[];
  /** The trading day in view; its primary instrument is the card's default. */
  todayTradingDay: TradingDay;
  /** The trader's own timezone, so the timeline reads on their clock. */
  timezone: string;
  /** The instrument open, when a parent owns the selection. */
  instrumentId?: string;
  onInstrumentChange?: (instrumentId: string) => void;
}

type ChartView = 'coverage' | 'compare' | 'edge' | 'timeline' | 'sessions';

const VIEWS: Array<{ id: ChartView; label: string; icon: React.ReactNode }> = [
  { id: 'coverage', label: 'Reach by symbol', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: 'compare', label: 'Compare symbols', icon: <ArrowLeftRight className="h-3.5 w-3.5" /> },
  { id: 'edge', label: 'Edge over time', icon: <LineChartIcon className="h-3.5 w-3.5" /> },
  { id: 'timeline', label: 'Touch timeline', icon: <ScatterIcon className="h-3.5 w-3.5" /> },
  { id: 'sessions', label: 'Coverage by session', icon: <Activity className="h-3.5 w-3.5" /> },
];

/** Fill for each part of the coverage bars. */
const COVERAGE_FILL = {
  tested: '#34d399',
  open: '#52525b',
  neverTouched: '#f59e0b',
} as const;

/** Fill for a timeline dot, by what price did after the touch. */
const OUTCOME_FILL: Record<LevelTouch['outcome'], string> = {
  'never-returned': '#34d399',
  returned: '#fb7185',
  watching: '#a1a1aa',
  invalid: '#71717a',
};

const OUTCOME_WORD: Record<LevelTouch['outcome'], string> = {
  'never-returned': 'Held — never came back',
  returned: 'Came back',
  watching: 'Still watching',
  invalid: 'Set aside',
};

/** The tooltip's own chrome, shared by every chart here. */
const TooltipShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 font-mono text-[11px] text-zinc-200">
    {children}
  </div>
);

export const LevelChartCard: React.FC<LevelChartCardProps> = ({
  levels,
  touches,
  instruments,
  todayTradingDay,
  timezone,
  instrumentId: controlledInstrumentId,
  onInstrumentChange,
}) => {
  const [ownInstrumentId, setOwnInstrumentId] = useState(() => {
    const wanted = (todayTradingDay.primaryInstrument ?? '').trim().toLowerCase();
    const primary = instruments.find(
      (inst) => inst.symbol.toLowerCase() === wanted || inst.id.toLowerCase() === wanted
    );
    return primary?.id ?? instruments[0]?.id ?? 'mes';
  });
  const instrumentId = controlledInstrumentId ?? ownInstrumentId;
  const symbol = instrumentSymbol(instruments, instrumentId);

  const [view, setView] = useState<ChartView>('coverage');

  /** The contract the compare view measures the selected one against. */
  const [ownCompareId, setOwnCompareId] = useState<string | undefined>(undefined);
  // A symbol is never compared with itself: fall back to the first other contract until the
  // trader picks one, and again if the selected contract changes to the one being compared.
  const compareInstrumentId =
    ownCompareId && ownCompareId !== instrumentId
      ? ownCompareId
      : (instruments.find((inst) => inst.id !== instrumentId)?.id ?? instruments[0]?.id ?? 'mnq');

  // Every series is derived from the same two records. The symbol coverage is deliberately over
  // the WHOLE record — it is the one view that compares contracts — while the other three are
  // scoped to the contract on screen.
  const symbolCoverage = useMemo(
    () => buildSymbolCoverage(levels, touches, instruments),
    [levels, touches, instruments]
  );
  const scopedTouches = useMemo(
    () => touches.filter((touch) => touch.instrumentId === instrumentId),
    [touches, instrumentId]
  );
  const scopedLevels = useMemo(
    () => levels.filter((level) => level.instrumentId === instrumentId),
    [levels, instrumentId]
  );
  const edgeCurve = useMemo(() => buildEdgeCurve(scopedTouches), [scopedTouches]);
  const timeline = useMemo(
    () => buildTouchTimeline(scopedTouches, timezone),
    [scopedTouches, timezone]
  );
  const sessionCoverage = useMemo(
    () => buildSessionCoverage(scopedLevels, scopedTouches, 14),
    [scopedLevels, scopedTouches]
  );
  const comparison = useMemo(
    () => buildSymbolComparison(levels, touches, instruments, instrumentId, compareInstrumentId),
    [levels, touches, instruments, instrumentId, compareInstrumentId]
  );

  const hasAnyLevel = symbolCoverage.length > 0;
  const canCompare = symbolCoverage.length > 1;

  // The one blind spot worth naming: the line the trader keeps marking and price keeps missing.
  // Read over the whole record, not the selected contract, because that is the question the
  // callout answers — where is the marking effort going that price never rewards.
  const fixup = useMemo(
    () => buildLevelFixup(levels, touches, instruments),
    [levels, touches, instruments]
  );

  /** The timeline's axes, padded so points on the edge are not clipped. */
  const timelineDomains = useMemo(() => {
    if (!timeline.length)
      return { x: [0, 1] as [number, number], y: [0, 1] as [number, number] };
    const xs = timeline.map((point) => point.x);
    const ys = timeline.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padY = Math.max(1, (maxY - minY) * 0.15);
    return {
      x: [minX === maxX ? minX - 3_600_000 : minX, maxX === minX ? maxX + 3_600_000 : maxX] as [number, number],
      y: [minY - padY, maxY + padY] as [number, number],
    };
  }, [timeline]);

  const formatAxisDate = (value: number) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: timezone }).format(
      new Date(value)
    );

  const empty = (message: string) => (
    <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-[11px] italic text-zinc-500">
      {message}
    </p>
  );

  return (
    <CoachCard id="playbook-level-charts" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
          <Activity className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">Your level record, drawn</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            The same marked lines and logged touches as a picture: what price reaches, how the hold
            rate is building, where every touch printed, and how your coverage moves session to
            session. Your own record — nothing fetched, nothing predicted.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="level-chart-instrument" className="mb-1 block text-xs font-medium text-zinc-300">
          Instrument
        </label>
        <select
          id="level-chart-instrument"
          value={instrumentId}
          onChange={(event) => {
            const id = event.target.value;
            if (controlledInstrumentId === undefined) setOwnInstrumentId(id);
            onInstrumentChange?.(id);
          }}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
        >
          {instruments.map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrument.symbol}
            </option>
          ))}
        </select>
      </div>

      {/* The four views, one at a time, so each gets the whole width of a phone. */}
      <div
        role="tablist"
        aria-label="Level chart views"
        className="grid grid-cols-2 gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-1.5 sm:grid-cols-5"
      >
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`level-chart-tab-${entry.id}`}
            aria-selected={view === entry.id}
            onClick={() => setView(entry.id)}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              view === entry.id
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {entry.icon}
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
      </div>

      {!hasAnyLevel && (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-4 text-[11px] italic text-zinc-500">
          Nothing to chart yet. Mark some lines above and log what price did with them — these
          charts fill in as the record grows.
        </p>
      )}

      {/*
        What to fix: the line the trader keeps marking that price never reaches. The same count
        floors the edge finder uses hold here, so a thin sample leaves this as a tally rather
        than a finding — which is why it simply does not appear until something qualifies.
      */}
      {fixup && (
        <div
          id="level-chart-what-to-fix"
          className="flex items-start gap-2.5 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3"
        >
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <div className="space-y-0.5">
            <span className="block text-[10px] font-mono uppercase font-bold text-amber-300/90">
              What to fix
            </span>
            <p className="text-[11px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-amber-200">{fixup.label}</span> — you keep
              marking here and price never reaches it:{' '}
              {fixup.untested} of {fixup.marked} lines have not been tested
              {fixup.neverTouched > 0
                ? `, ${fixup.neverTouched} of them closed out as never touched`
                : ''}
              {fixup.testRate === null ? '' : ` (${fixup.tested} of ${fixup.marked} reached)`}.
            </p>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Named only because enough of these lines have accumulated for the count to mean
              something. A thinner sample would stay a tally, not a callout.
            </p>
          </div>
        </div>
      )}

      {hasAnyLevel && view === 'coverage' && (
        <div id="level-chart-coverage" className="space-y-2">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={symbolCoverage} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="symbol" stroke="#71717a" fontSize={10} tickLine={false} />
                <YAxis
                  allowDecimals={false}
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  width={28}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Tooltip
                  cursor={{ fill: '#27272a55' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload as (typeof symbolCoverage)[number];
                    return (
                      <TooltipShell>
                        <div className="text-zinc-300">{row.symbol}</div>
                        <div className="text-emerald-300">Reached {row.tested}</div>
                        <div className="text-zinc-400">Still open {row.open}</div>
                        <div className="text-amber-300">Never touched {row.neverTouched}</div>
                        <div className="text-zinc-500">
                          {row.tested} of {row.marked} lines
                          {row.testRate === null ? '' : ` (${row.testRate}%)`}
                        </div>
                      </TooltipShell>
                    );
                  }}
                />
                <Bar dataKey="tested" name="Reached" stackId="lines" fill={COVERAGE_FILL.tested} />
                <Bar dataKey="open" name="Still open" stackId="lines" fill={COVERAGE_FILL.open} />
                <Bar
                  dataKey="neverTouched"
                  name="Never touched"
                  stackId="lines"
                  fill={COVERAGE_FILL.neverTouched}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Each bar is every active line you have marked for that contract. Green is a line price
            reached and you logged a touch against; amber is a line you closed out as never reached;
            grey is a line still waiting on an answer.
          </p>
        </div>
      )}

      {/*
        Two contracts against each other. The coverage view already puts every contract on one
        axis, but only as totals; this pairs two chosen ones so their counts sit next to each
        other and their hold rates read without swapping the selector between them.
      */}
      {hasAnyLevel && view === 'compare' && (
        <div id="level-chart-compare" className="space-y-2">
          {!canCompare ? (
            empty(
              'Mark lines for a second contract and both sides appear here, measured on the same scale.'
            )
          ) : (
            <>
              <div>
                <label
                  htmlFor="level-chart-compare-instrument"
                  className="mb-1 block text-xs font-medium text-zinc-300"
                >
                  Compare {symbol} with
                </label>
                <select
                  id="level-chart-compare-instrument"
                  value={compareInstrumentId}
                  onChange={(event) => setOwnCompareId(event.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                >
                  {instruments
                    .filter((instrument) => instrument.id !== instrumentId)
                    .map((instrument) => (
                      <option key={instrument.id} value={instrument.id}>
                        {instrument.symbol}
                      </option>
                    ))}
                </select>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparison.rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="metric" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis
                      allowDecimals={false}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      width={28}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Tooltip
                      cursor={{ fill: '#27272a55' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as (typeof comparison.rows)[number];
                        return (
                          <TooltipShell>
                            <div className="text-zinc-300">{row.metric}</div>
                            <div style={{ color: '#818cf8' }}>
                              {comparison.left.symbol} {row.left}
                            </div>
                            <div style={{ color: '#34d399' }}>
                              {comparison.right.symbol} {row.right}
                            </div>
                          </TooltipShell>
                        );
                      }}
                    />
                    <Bar
                      dataKey="left"
                      name={comparison.left.symbol}
                      fill="#818cf8"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="right"
                      name={comparison.right.symbol}
                      fill="#34d399"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[comparison.left, comparison.right].map((side) => (
                  <div
                    key={side.instrumentId}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2"
                  >
                    <p className="font-mono text-[11px] font-bold text-zinc-200">{side.symbol}</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                      {side.tested} of {side.marked} lines reached
                      {side.testRate === null ? '' : ` (${side.testRate}%)`}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                      {side.decided === 0
                        ? 'No decided touches yet.'
                        : side.enoughData
                          ? `Hold rate ${side.holdRate}% over ${side.decided} decided touches`
                          : `Tally: ${side.neverReturned} held of ${side.decided} decided — under ${MIN_DECIDED}, so read the count, not a rate.`}
                    </p>
                  </div>
                ))}
              </div>

              <p className="text-[10px] leading-relaxed text-zinc-500">
                Both contracts on one scale, so the taller bar is genuinely more. The counts are
                the same ones drawn above; the hold rate is decided touches where price never came
                back, and it stays a tally until the sample clears {MIN_DECIDED}.
              </p>
            </>
          )}
        </div>
      )}

      {hasAnyLevel && view === 'edge' && (
        <div id="level-chart-edge" className="space-y-2">
          {edgeCurve.length < 2 ? (
            empty(
              edgeCurve.length === 0
                ? `No decided touches for ${symbol} yet. Once a touch is marked "never came back" or "returned", the hold rate starts here.`
                : `One decided touch so far for ${symbol}. A second one puts a second point on this line.`
            )
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={edgeCurve}
                    margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="index" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tickFormatter={(value) => `${value}%`}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      width={38}
                    />
                    <ReferenceLine y={50} stroke="#52525b" strokeDasharray="4 4" />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as (typeof edgeCurve)[number];
                        return (
                          <TooltipShell>
                            <div className="text-zinc-400">{point.date}</div>
                            <div className="text-indigo-300">Hold rate {point.holdRate}%</div>
                            <div className="text-zinc-500">{point.decided} decided touches so far</div>
                          </TooltipShell>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="holdRate"
                      name="Hold rate"
                      stroke="#818cf8"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: '#818cf8' }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                The share of decided touches where price never came back,{' '}
                {edgeCurve.length < MIN_DECIDED
                  ? `accumulating over ${edgeCurve.length} touches — under ${MIN_DECIDED}, so read the tally, not the line.`
                  : `accumulating over ${edgeCurve.length} touches.`}{' '}
                Each point is one more decided touch in the order it happened.
              </p>
            </>
          )}
        </div>
      )}

      {hasAnyLevel && view === 'timeline' && (
        <div id="level-chart-timeline" className="space-y-2">
          {timeline.length === 0 ? (
            empty(`No touches logged for ${symbol} yet. Each touch places a dot at its time and price.`)
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={timelineDomains.x}
                      tickFormatter={formatAxisDate}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      domain={timelineDomains.y}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      width={44}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as (typeof timeline)[number];
                        return (
                          <TooltipShell>
                            <div className="text-zinc-300">
                              {point.date} · {point.time}
                            </div>
                            <div className="text-zinc-100">{formatLevelPrice(point.priceLabel)}</div>
                            <div style={{ color: OUTCOME_FILL[point.outcome] }}>
                              {OUTCOME_WORD[point.outcome]}
                            </div>
                          </TooltipShell>
                        );
                      }}
                    />
                    <Scatter data={timeline} isAnimationActive={false}>
                      {timeline.map((point) => (
                        <Cell key={point.id} fill={OUTCOME_FILL[point.outcome]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              {/* The legend is drawn by hand: a scatter with per-point colours has no legend of
                  its own, and the colour is the whole point of this view. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-400">
                {(Object.keys(OUTCOME_FILL) as Array<LevelTouch['outcome']>)
                  .filter((outcome) => outcome !== 'invalid')
                  .map((outcome) => (
                    <span key={outcome} className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: OUTCOME_FILL[outcome] }}
                      />
                      {OUTCOME_WORD[outcome]}
                    </span>
                  ))}
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Every touch for {symbol} at the time it printed (your clock) and the price of the
                line. Each dot is one touch, so a line tested repeatedly shows as a cluster.
              </p>
            </>
          )}
        </div>
      )}

      {hasAnyLevel && view === 'sessions' && (
        <div id="level-chart-sessions" className="space-y-2">
          {sessionCoverage.length === 0 ? (
            empty(`No marked lines for ${symbol} yet, so there is no session coverage to show.`)
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sessionCoverage} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#71717a"
                      fontSize={10}
                      tickLine={false}
                      width={28}
                    />
                    <Tooltip
                      cursor={{ fill: '#27272a55' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as (typeof sessionCoverage)[number];
                        return (
                          <TooltipShell>
                            <div className="text-zinc-300">{row.label}</div>
                            <div className="text-emerald-300">Reached {row.tested}</div>
                            <div className="text-zinc-400">Not reached {row.untested}</div>
                            {row.neverTouched > 0 && (
                              <div className="text-amber-300">
                                Closed out as never touched {row.neverTouched}
                              </div>
                            )}
                          </TooltipShell>
                        );
                      }}
                    />
                    <Bar dataKey="tested" name="Reached" stackId="day" fill={COVERAGE_FILL.tested} />
                    <Bar
                      dataKey="untested"
                      name="Not reached"
                      stackId="day"
                      fill={COVERAGE_FILL.open}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                The last {sessionCoverage.length} session{sessionCoverage.length === 1 ? '' : 's'} you
                marked lines for {symbol}, oldest first. Green is lines price reached, grey is lines
                it did not — a run of grey is the trader marking lines the market never visited.
              </p>
            </>
          )}
        </div>
      )}

      <p className="border-t border-zinc-800 pt-2.5 text-[10px] leading-relaxed text-zinc-600">
        Drawn from your own marked lines and logged touches. A rate is a count of what already
        happened, never a prediction, and a thin sample stays a tally rather than a percentage.
        {symbolCoverage.length > 1 && view === 'coverage'
          ? ' Use the instrument selector for the per-contract views.'
          : ''}
      </p>
    </CoachCard>
  );
};
