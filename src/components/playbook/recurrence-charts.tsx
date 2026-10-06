import React from 'react';
import type { LevelEdgeStats } from '../../lib/analytics/level-edge';
import type { RecurrenceBucket } from '../../lib/analytics/level-recurrence';

/**
 * The recurrence breakdowns as pictures.
 *
 * Three reads on this card — which touch in the day holds, which weekday, which hour — used to
 * be lists of `71.4% of 7` and `2 decided` that the eye had to compare down a column of text.
 * The figures are the same; they are drawn now, so the shape of the answer is visible before a
 * single number is read.
 *
 * Plain elements rather than a charting library, for the reason the Insights charts give: these
 * are a handful of named buckets, not a series, and a recharts bar per bucket would put an axis,
 * a legend and a tooltip between the trader and a comparison they can otherwise take in at once.
 *
 * The one rule the drawing keeps is the card's own: a bucket below the readability floor is NOT
 * given a rate. Its figure is the count, and its bar shows how far the sample has come against
 * the five decided touches a rate needs — so a thin bucket reads as "still collecting" rather
 * than as a percentage wearing a much bigger sample's clothes.
 */

const clampPct = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

/** True when this bucket has enough decided touches for its hold rate to be read at all. */
function isReadable(stats: LevelEdgeStats): boolean {
  return stats.enoughData && stats.holdRate !== null;
}

/** The figure on the bucket: a rate once it may be read, the plain count before that. */
function figureOf(stats: LevelEdgeStats): string {
  if (isReadable(stats)) return `${stats.holdRate}%`;
  return stats.decided > 0 ? `${stats.decided} decided` : '—';
}

/**
 * How far the bar is filled, 0-100.
 *
 * A readable bucket fills to its hold rate — that is the finding. A thin one fills to its
 * decided count against `minDecided`, which is the same scale the rate appears on, so the bar
 * means the same kind of thing in both states: how much of the answer is here yet.
 */
function barPct(stats: LevelEdgeStats, minDecided: number): number {
  if (isReadable(stats)) return clampPct(stats.holdRate ?? 0);
  return minDecided > 0 ? clampPct((stats.decided / minDecided) * 100) : 0;
}

/** The one line under the figure: how many touches the bucket holds, and any still watched. */
function sampleNote(stats: LevelEdgeStats): string {
  const touches = `${stats.touches} touch${stats.touches === 1 ? '' : 'es'}`;
  return stats.watching > 0 ? `${touches} · ${stats.watching} watching` : touches;
}

/**
 * Buckets as a grid of small tiles, for the reads whose labels are short — an hour, a weekday.
 *
 * A tile carries its own bar, so a whole day's hours can be scanned for the one that holds
 * without reading any of the figures, and the figure is still there when the eye stops.
 */
export const HoldRateTiles: React.FC<{
  buckets: RecurrenceBucket[];
  minDecided: number;
  /** Column count per breakpoint; hours need more room than weekdays. */
  gridClass?: string;
  id?: string;
}> = ({ buckets, minDecided, gridClass = 'grid-cols-3 sm:grid-cols-6', id }) => (
  <div id={id} className={`grid gap-1.5 ${gridClass}`}>
    {buckets.map((bucket) => {
      const { stats } = bucket;
      const readable = isReadable(stats);
      return (
        <div
          key={bucket.key}
          data-recurrence-bucket={bucket.key}
          data-recurrence-readable={readable ? 'true' : 'false'}
          className={`space-y-1 rounded-xl border p-2 ${
            readable ? 'border-emerald-900/60 bg-emerald-950/25' : 'border-zinc-800 bg-zinc-950/50'
          }`}
        >
          <span className="block font-mono text-[10px] text-zinc-300">{bucket.label}</span>
          <span
            className={`block font-mono text-sm font-bold leading-tight ${
              readable ? 'text-emerald-300' : 'text-zinc-500'
            }`}
          >
            {figureOf(stats)}
          </span>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full ${readable ? 'bg-emerald-400' : 'bg-zinc-600'}`}
              style={{ width: `${barPct(stats, minDecided)}%` }}
            />
          </div>
          <span className="block font-mono text-[9px] leading-tight text-zinc-500">
            {sampleNote(stats)}
          </span>
        </div>
      );
    })}
  </div>
);

/**
 * Buckets as stacked rows, for the read whose labels are sentences — the touch order in a day.
 *
 * The label needs the width, so the bar sits under it rather than beside it. Same scale as the
 * tiles: filled to the hold rate once there is one, and to the sample's progress before that.
 */
export const OrdinalBars: React.FC<{
  buckets: RecurrenceBucket[];
  minDecided: number;
}> = ({ buckets, minDecided }) => (
  <ul className="space-y-1.5">
    {buckets.map((bucket) => {
      const { stats } = bucket;
      const readable = isReadable(stats);
      return (
        <li
          key={bucket.key}
          data-recurrence-ordinal={bucket.key}
          data-recurrence-readable={readable ? 'true' : 'false'}
          className="space-y-1"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-zinc-200">{bucket.label}</span>
            <span
              className={`shrink-0 font-mono text-[10px] ${
                readable ? 'text-emerald-300' : 'text-zinc-500'
              }`}
            >
              {figureOf(stats)} · {sampleNote(stats)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full ${readable ? 'bg-emerald-400' : 'bg-zinc-600'}`}
              style={{ width: `${barPct(stats, minDecided)}%` }}
            />
          </div>
        </li>
      );
    })}
  </ul>
);
