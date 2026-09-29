import React from 'react';

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

/** One thing the record can be split by, reduced to the four figures worth comparing. */
export interface SegmentRow {
  /** Stable key: the same bucket keeps the same row across renders. */
  key: string;
  /** What the segment is, in the trader's words. */
  label: string;
  /** Closed trades in it. */
  trades: number;
  /** Wins as a share of those trades, 0–100. */
  winRate: number;
  /** Mean R across them. */
  avgR: number;
  /** Gross P&L across them. */
  pnl: number;
}

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
