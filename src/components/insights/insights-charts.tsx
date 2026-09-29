import React from 'react';
import { Info } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DailyPnLPoint,
  HourlyRow,
  RDistributionBucket,
  SegmentRow,
  TapeEntry,
  UnderwaterPoint,
} from '../../lib/analytics/insights-series';

/**
 * The pictures the Insights tab is read through.
 *
 * The tab used to be cards of prose: every finding was a sentence with a number buried in it,
 * which is the one shape a reader cannot compare at a glance. None of these components decide
 * anything — the numbers all arrive already computed from the same deterministic helpers the
 * observations are written from — so the bars and the words can never disagree about what
 * happened. They only answer a different question: not "what does the record say" but "which
 * one is bigger, and by how much".
 *
 * Everything is drawn with plain elements rather than a charting library. These are a handful
 * of named rows, not a series: a recharts bar per segment would put a legend, an axis and a
 * tooltip between the trader and six comparisons they could otherwise read in one look.
 */

/** Money with its sign kept in front of the dollar mark, the way the observations write it. */
export function signedMoney(value: number, dp = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

/** The colour a figure is written in: earned, lost, or neither. */
export function moneyTone(value: number): string {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-rose-400';
  return 'text-zinc-300';
}

/** The bar colour to match, one shade of the same reading. */
export function moneyBar(value: number): string {
  if (value > 0) return 'bg-emerald-500/80';
  if (value < 0) return 'bg-rose-500/80';
  return 'bg-zinc-600';
}

const clamp = (pct: number) => Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));

/** An axis tick as money, rounded: the axis gridlines are thousands, not cents. */
const axisMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** The axis/tooltip styling every chart here shares, so they read as one set. */
const TOOLTIP_STYLE = {
  backgroundColor: '#18181b',
  borderColor: '#27272a',
  borderRadius: '8px',
  fontSize: '11px',
  fontFamily: 'monospace',
} as const;

/**
 * One figure at the top of the tab, with the meter that makes it a picture.
 *
 * `marker` is the line the share is read against — 50% for a win rate, 1.0 for a profit
 * factor — drawn rather than described, because "below average" is a different sentence for
 * every metric here.
 */
export const StatTile: React.FC<{
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  /** Share to fill, 0–100. Omitted means this tile is a plain number. */
  meter?: number;
  meterClass?: string;
  /** Where the reference line sits on the meter, 0–100. */
  marker?: number;
}> = ({
  label,
  value,
  valueClass = 'text-zinc-100',
  sub,
  meter,
  meterClass = 'bg-sky-400',
  marker,
}) => (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3">
    <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
      {label}
    </span>
    <span className={`mt-0.5 block font-mono text-lg font-bold leading-tight ${valueClass}`}>
      {value}
    </span>
    {typeof meter === 'number' && (
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${meterClass}`} style={{ width: `${clamp(meter)}%` }} />
        {typeof marker === 'number' && (
          <span
            className="absolute inset-y-0 w-px bg-zinc-400/80"
            style={{ left: `${clamp(marker)}%` }}
            aria-hidden
          />
        )}
      </div>
    )}
    {sub && <span className="mt-1 block text-[10px] leading-snug text-zinc-500">{sub}</span>}
  </div>
);

/**
 * P&L per segment, drawn around a zero line.
 *
 * The sign is the thing being read, so it is the shape of the bar rather than a colour
 * applied to a bar that always grows the same way: profits run right from the centre, losses
 * run left. Sorted by the figure itself, so the row the trader should look at is the top one
 * — and scaled against the largest row in its own group, because two groups with very
 * different sizes still have to be comparable within themselves.
 */
export const DivergingBars: React.FC<{ rows: SegmentRow[]; id?: string }> = ({ rows, id }) => {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.pnl)));

  return (
    <ul id={id} className="space-y-3">
      {rows.map((row) => {
        const width = (Math.abs(row.pnl) / max) * 100;
        return (
          <li key={row.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-semibold text-zinc-200">{row.label}</span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                {row.trades} · {row.winRate}% win · {row.avgR}R avg
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex h-2 flex-1 items-center gap-0.5">
                {/* Losses: grown from the centre outwards to the left. */}
                <div className="flex h-full flex-1 justify-end">
                  {row.pnl < 0 && (
                    <span
                      className="h-full rounded-l-full bg-rose-500/80"
                      style={{ width: `${width}%` }}
                    />
                  )}
                </div>
                <span className="h-3.5 w-px shrink-0 bg-zinc-700" aria-hidden />
                {/* Profits: the same bar facing the other way. */}
                <div className="flex h-full flex-1">
                  {row.pnl > 0 && (
                    <span
                      className="h-full rounded-r-full bg-emerald-500/80"
                      style={{ width: `${width}%` }}
                    />
                  )}
                </div>
              </div>
              <span
                className={`w-24 shrink-0 text-right font-mono text-xs font-semibold ${moneyTone(row.pnl)}`}
              >
                {signedMoney(row.pnl)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

/**
 * How often a level was hit, as a ring.
 *
 * A share of a whole reads faster as an arc than as a sentence, and the empty part of the
 * ring is the point: it is the work that did not happen rather than a number to decode. The
 * ring is drawn with `pathLength={100}` so the dash is written in the same percentage that is
 * printed in the middle of it.
 */
export const ShareRing: React.FC<{
  /** Share to fill, 0–100. */
  pct: number;
  /** Written inside the ring. */
  center: string;
  /** Ring colour, as a hex — the SVG cannot take a Tailwind class. */
  color: string;
  /** Said underneath the ring. */
  caption: string;
  size?: string;
}> = ({ pct, center, color, caption, size = 'h-20 w-20' }) => (
  <div className="flex shrink-0 flex-col items-center gap-1">
    <div className={`relative ${size}`}>
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          stroke="#27272a"
          strokeWidth="3.5"
          pathLength={100}
        />
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clamp(pct)} ${100 - clamp(pct)}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-zinc-100">
        {center}
      </span>
    </div>
    <span className="max-w-[6.5rem] text-center font-mono text-[10px] leading-tight text-zinc-500">
      {caption}
    </span>
  </div>
);

/** One labelled bar, for comparing a pair of readings on the same scale. */
export const LabelledBar: React.FC<{
  label: string;
  display: string;
  /** Share of the row's own maximum to fill, 0–100. */
  pct: number;
  barClass: string;
  valueClass?: string;
  /** True for a bar that is drawn faint: the reference rather than the finding. */
  muted?: boolean;
}> = ({ label, display, pct, barClass, valueClass = 'text-zinc-200', muted = false }) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between gap-2">
      <span className={`font-mono text-[10px] uppercase tracking-wider ${muted ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {label}
      </span>
      <span className={`font-mono text-xs font-semibold ${valueClass}`}>{display}</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full ${barClass}`} style={{ width: `${clamp(pct)}%` }} />
    </div>
  </div>
);

/**
 * One risk mode, as a tile of the numbers that describe a day in it.
 *
 * Both modes are rendered by the same component so the two columns are the same shape, which
 * is what makes the comparison a comparison: the only thing that differs between them is the
 * data.
 */
export const ModeTile: React.FC<{
  name: string;
  /** The behaviour the mode is, said plainly. */
  blurb: string;
  days: number;
  trades: number;
  avgDailyPnL: number;
  winningDayRate: number;
  /** The two modes' shared maximum, so the bars are drawn on one scale. */
  maxAbsAvg: number;
  barClass: string;
  ringColor: string;
}> = ({ name, blurb, days, trades, avgDailyPnL, winningDayRate, maxAbsAvg, barClass, ringColor }) => (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3.5 space-y-3">
    <div className="flex items-start justify-between gap-2">
      <div>
        <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-200">
          {name}
        </h4>
        <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{blurb}</p>
      </div>
      <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-zinc-400">
        {days} day{days === 1 ? '' : 's'}
      </span>
    </div>

    <div className="flex items-center gap-3">
      <ShareRing
        pct={winningDayRate}
        center={`${winningDayRate}%`}
        color={ringColor}
        caption="winning days"
        size="h-16 w-16"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Average day
          </span>
          <span className={`font-mono text-base font-bold ${moneyTone(avgDailyPnL)}`}>
            {signedMoney(avgDailyPnL)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full ${barClass}`}
            style={{ width: `${clamp((Math.abs(avgDailyPnL) / Math.max(1, maxAbsAvg)) * 100)}%` }}
          />
        </div>
        <span className="block font-mono text-[10px] text-zinc-500">
          {trades} trade{trades === 1 ? '' : 's'} over {days} day{days === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  </div>
);

/**
 * Every trading day as its own column, with the running total drawn over them.
 *
 * Two readings on one picture on purpose. The columns are how each day went — the question a
 * trader asks about a day — and the line is what those days added up to, which no single
 * column can answer. They sit on separate axes because a $400 day and a $400 total are the
 * same number and completely different news.
 *
 * A column is coloured by its own sign rather than the window's, so a losing day inside a
 * winning month still reads as a losing day.
 */
export const DailyPnlChart: React.FC<{ points: DailyPnLPoint[] }> = ({ points }) => (
  <div id="insights-daily-chart" className="h-56 w-full">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={points} margin={{ top: 8, right: 2, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} minTickGap={18} />
        <YAxis
          yAxisId="day"
          stroke="#71717a"
          fontSize={10}
          tickLine={false}
          width={58}
          tickFormatter={(value) => axisMoney(Number(value))}
        />
        <YAxis
          yAxisId="total"
          orientation="right"
          stroke="#38bdf8"
          fontSize={10}
          tickLine={false}
          width={62}
          tickFormatter={(value) => axisMoney(Number(value))}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload || !payload.length) return null;
            const point = payload[0]?.payload as DailyPnLPoint | undefined;
            if (!point) return null;
            return (
              <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 font-mono text-[11px] text-zinc-200">
                <div className="text-zinc-400">
                  {point.date} · {point.trades} trade{point.trades === 1 ? '' : 's'}
                </div>
                <div className={moneyTone(point.pnl)}>{signedMoney(point.pnl)} that day</div>
                <div className="text-sky-300">{signedMoney(point.cumulative)} running</div>
              </div>
            );
          }}
        />
        <ReferenceLine yAxisId="day" y={0} stroke="#3f3f46" />
        <Bar yAxisId="day" dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={30}>
          {points.map((point) => (
            <Cell key={point.date} fill={point.pnl >= 0 ? '#10b981' : '#f43f5e'} />
          ))}
        </Bar>
        <Line
          yAxisId="total"
          type="monotone"
          dataKey="cumulative"
          stroke="#38bdf8"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  </div>
);

/**
 * The shape of the record, as a histogram of R.
 *
 * An average R hides the distribution behind it: winning small and often and losing small and
 * often while catching one big one are the same average and different businesses. The bars are
 * rose below zero and emerald above it, so the first thing visible is which side of the record
 * the weight of the trades sits on.
 */
export const RDistributionChart: React.FC<{
  buckets: RDistributionBucket[];
  measured: number;
  excluded: number;
}> = ({ buckets, measured, excluded }) => (
  <div className="space-y-2">
    <div id="insights-r-chart" className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" stroke="#71717a" fontSize={9} tickLine={false} interval={0} />
          <YAxis allowDecimals={false} stroke="#71717a" fontSize={10} tickLine={false} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const bucket = payload[0]?.payload as RDistributionBucket | undefined;
              if (!bucket) return null;
              const shareOfMeasured = measured > 0 ? Math.round((bucket.count / measured) * 100) : 0;
              return (
                <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 font-mono text-[11px] text-zinc-200">
                  <div className="text-zinc-400">{bucket.label}</div>
                  <div className={bucket.loss ? 'text-rose-300' : 'text-emerald-300'}>
                    {bucket.count} trade{bucket.count === 1 ? '' : 's'}
                  </div>
                  <div className="text-zinc-500">
                    {shareOfMeasured}% of {measured} measured
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={46}>
            {buckets.map((bucket) => (
              <Cell key={bucket.key} fill={bucket.loss ? '#f43f5e' : '#10b981'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    {excluded > 0 && (
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {excluded} closed trade{excluded === 1 ? '' : 's'} left out: their stop was never
        recorded, so their risk — and therefore their R — is a placeholder rather than a fact.
      </p>
    )}
  </div>
);

/**
 * How far below its own best the record sat, trade by trade.
 *
 * The equity line goes up and to the right; this is what it cost to hold. A record can double
 * over a year and spend four months underwater, and both statements are true of the same
 * trades — one is the destination, the other is the ride, and a trader who only ever looks at
 * the first is the one who quits at the bottom of the second.
 *
 * Drawn downward from zero because that is what the number is: the depth behind the
 * high-water mark. The worst point is printed above it, since a shape without its scale is
 * just a colour.
 */
export const UnderwaterChart: React.FC<{ points: UnderwaterPoint[] }> = ({ points }) => {
  const worst = points.reduce<UnderwaterPoint | null>(
    (low, point) => (!low || point.drawdown < low.drawdown ? point : low),
    null
  );
  // A curve that never went underwater still needs a floor to be drawn against.
  const floor = Math.min(-1, (worst?.drawdown ?? 0) * 1.15);

  return (
    <div id="insights-underwater-chart" className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id="underwaterGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} minTickGap={28} />
          <YAxis
            domain={[floor, 0]}
            stroke="#71717a"
            fontSize={10}
            tickLine={false}
            width={62}
            tickFormatter={(value) => axisMoney(Number(value))}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const point = payload[0]?.payload as UnderwaterPoint | undefined;
              if (!point) return null;
              return (
                <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 font-mono text-[11px] text-zinc-200">
                  <div className="text-zinc-400">
                    Trade {point.label} · {point.date}
                  </div>
                  <div className="text-rose-300">
                    {signedMoney(point.drawdown)} behind the peak
                  </div>
                  <div className="text-zinc-500">
                    This trade left you at {signedMoney(point.cumulative)}; your best was{' '}
                    {signedMoney(point.peak)}.
                  </div>
                </div>
              );
            }}
          />
          <ReferenceLine y={0} stroke="#3f3f46" />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke="#f43f5e"
            strokeWidth={2}
            fill="url(#underwaterGrad)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

/** One trade as a dot: a horizontal measure against the R it returned. */
export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  win: boolean;
  label: string;
}

/**
 * Trades as dots, split into the ones that made money and the ones that did not.
 *
 * A scatter is the only picture here that can show a relationship rather than a ranking: how
 * long a trade was held against what it returned, or how big it was against what it returned.
 * The two series are drawn separately — wins emerald, losses rose — because the question is
 * almost always whether the two clouds sit in different places, and a single colour would hide
 * exactly that.
 *
 * No line is fitted. A trend line through twenty trades invites the reader to trade the line,
 * and this journal tells a trader what happened rather than what to do next.
 */
export const TradeScatter: React.FC<{
  points: ScatterPoint[];
  xLabel: string;
  /** Written beside the value on the x axis, e.g. `min`. */
  xUnit?: string;
  xFormatter?: (value: number) => string;
}> = ({ points, xLabel, xUnit = '', xFormatter }) => {
  const wins = points.filter((point) => point.win);
  const losses = points.filter((point) => !point.win);

  const renderSeries = (data: ScatterPoint[], color: string, name: string) =>
    data.length > 0 && (
      <Scatter name={name} data={data} fill={color} fillOpacity={0.85}>
        {data.map((point) => (
          <Cell key={point.id} fill={color} />
        ))}
      </Scatter>
    );

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            stroke="#71717a"
            fontSize={10}
            tickLine={false}
            tickFormatter={(value) => (xFormatter ? xFormatter(Number(value)) : String(value))}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="R"
            stroke="#71717a"
            fontSize={10}
            tickLine={false}
            tickFormatter={(value) => `${Number(value)}R`}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const point = payload[0]?.payload as ScatterPoint | undefined;
              if (!point) return null;
              return (
                <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 font-mono text-[11px] text-zinc-200">
                  <div className="text-zinc-400">{point.label}</div>
                  <div className="text-zinc-300">
                    {xFormatter ? xFormatter(point.x) : point.x}
                    {xUnit ? ` ${xUnit}` : ''}
                  </div>
                  <div className={moneyTone(point.y)}>{point.y}R</div>
                </div>
              );
            }}
          />
          <ReferenceLine y={0} stroke="#3f3f46" />
          {renderSeries(wins, '#10b981', 'Made money')}
          {renderSeries(losses, '#f43f5e', 'Lost money')}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * P&L by the hour the trade was entered, as a grid of cells.
 *
 * Three sessions cannot show that the money in a session is made in its first twenty minutes
 * and given back over the next two hours. The hour can, and each cell carries its own figure
 * as well as its colour — the colour is for finding the cell, the number is for reading it.
 *
 * Cell colour is the size of the result against the biggest hour in the window, so the shape
 * of the day is visible at a glance; only hours that were traded appear, because an empty
 * hour is not a flat one.
 */
export const HourHeatmap: React.FC<{ rows: HourlyRow[] }> = ({ rows }) => {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.pnl)));

  return (
    <div id="insights-hours" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
      {rows.map((row) => {
        const intensity = 0.1 + (Math.abs(row.pnl) / max) * 0.5;
        return (
          <div
            key={row.hour}
            data-hour={row.label}
            style={{ backgroundColor: `rgba(${row.pnl >= 0 ? '16, 185, 129' : '244, 63, 94'}, ${intensity})` }}
            className="space-y-0.5 rounded-xl border border-zinc-800 p-2"
          >
            <span className="block font-mono text-[10px] text-zinc-300">{row.label}</span>
            <span className={`block font-mono text-sm font-bold ${moneyTone(row.pnl)}`}>
              {signedMoney(row.pnl, 0)}
            </span>
            <span className="block font-mono text-[9px] leading-tight text-zinc-400">
              {row.trades} trade{row.trades === 1 ? '' : 's'} · {row.winRate}% win
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** One square of the tape: the colour the result, nothing else. */
const TAPE_CHIP: Record<TapeEntry['result'], string> = {
  win: 'bg-emerald-500/80',
  loss: 'bg-rose-500/80',
  flat: 'bg-zinc-600',
};

/**
 * The last few closed trades, as a row of results.
 *
 * The one thing a P&L curve cannot show is sequence: three losses in a row that end flat is a
 * different month from three losses spread across it, and the difference only appears when
 * the trades are laid beside each other in the order they happened. Oldest on the left, so
 * the newest trade is always the last square — where the eye already is.
 */
export const ResultTape: React.FC<{ entries: TapeEntry[] }> = ({ entries }) => {
  if (!entries.length) return null;

  const latest = entries[entries.length - 1].result;
  let run = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].result !== latest) break;
    run += 1;
  }

  const runLabel =
    latest === 'win'
      ? `${run} win${run === 1 ? '' : 's'} in a row`
      : latest === 'loss'
      ? `${run} loss${run === 1 ? '' : 'es'} in a row`
      : `${run} flat in a row`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Oldest → newest
        </span>
        <span
          className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
            latest === 'win'
              ? 'border-emerald-800 bg-emerald-950/70 text-emerald-300'
              : latest === 'loss'
              ? 'border-rose-800/80 bg-rose-950/70 text-rose-300'
              : 'border-zinc-700 bg-zinc-800 text-zinc-400'
          }`}
        >
          {runLabel}
        </span>
      </div>

      <div id="insights-tape" className="flex flex-wrap gap-1">
        {entries.map((entry) => (
          <span
            key={entry.id}
            title={`${entry.label} · ${entry.r > 0 ? '+' : ''}${entry.r}R`}
            className={`h-4 w-4 rounded-[3px] ${TAPE_CHIP[entry.result]}`}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
        {(['win', 'loss', 'flat'] as const).map((result) => (
          <span key={result} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-[2px] ${TAPE_CHIP[result]}`} />
            {result}
          </span>
        ))}
        <span className="text-zinc-600">{entries.length} most recent closed trades</span>
      </div>
    </div>
  );
};
