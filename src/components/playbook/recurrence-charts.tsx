import React from 'react';
import {
  RATE_STRENGTH_LABEL,
  type LevelEdgeStats,
  type RateInterval,
  type RateStrength,
} from '../../lib/analytics/level-edge';
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
 *
 * The same bar language carries through the rest of the card: `MeterRow` for the measures that are
 * not a bucket's hold rate, `EdgeBar` for one bucket per row, and `StackedBar` for what the marked
 * lines turned into. One rule holds across all of them — green is a rate that may be read, grey is
 * a sample still being collected — so the trader learns the colours once.
 *
 * A green bar carries two more things, because a percentage on its own is the most over-read figure
 * in a small journal: the pale band behind it is the range the true rate could sit in at this
 * sample size, and the tier word under the figure names how much is behind it. Five touches at 80%
 * and twenty at 80% are not the same statement, and they no longer look the same.
 */

const clampPct = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

/**
 * The range a rate could sit in, painted behind its bar.
 *
 * Drawn before the fill so the observed rate covers the middle of it: what stays visible is the
 * part of the range the figure does not already claim, which is the thing a bare percentage hides.
 */
const RateBand: React.FC<{ interval: RateInterval | null }> = ({ interval }) =>
  interval ? (
    <span
      data-rate-band={`${interval.low}-${interval.high}`}
      className="absolute inset-y-0 rounded-full bg-emerald-400/30"
      style={{
        left: `${clampPct(interval.low)}%`,
        width: `${clampPct(interval.high) - clampPct(interval.low)}%`,
      }}
      aria-hidden
    />
  ) : null;

/**
 * How much is behind a rate, as a word.
 *
 * Given rather than derived so a caller that has no rate to read simply renders nothing, and no
 * component can invent a tier for a sample the floor has not let through.
 */
const RateTier: React.FC<{ strength: RateStrength | null }> = ({ strength }) =>
  strength ? (
    <span className="rounded border border-zinc-700 px-1 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
      {RATE_STRENGTH_LABEL[strength]}
    </span>
  ) : null;

/** True when this bucket has enough decided touches for its hold rate to be read at all. */
function isReadable(stats: LevelEdgeStats): boolean {
  return stats.enoughData && stats.holdRate !== null;
}

/** The figure on the bucket: a rate once it may be read, the plain count before that. */
function figureOf(stats: LevelEdgeStats): string {
  if (isReadable(stats)) return `${stats.holdRate}%`;
  return stats.decided > 0 ? `${stats.decided} decided` : '—';
}

/** How far a sample has come toward the decided touches a rate needs, 0-100. */
export function samplePct(decided: number, minDecided: number): number {
  return minDecided > 0 ? clampPct((decided / minDecided) * 100) : 0;
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
  return samplePct(stats.decided, minDecided);
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
          data-rate-strength={stats.strength ?? 'none'}
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
          <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <RateBand interval={stats.holdInterval} />
            <div
              className={`h-full rounded-full ${readable ? 'bg-emerald-400' : 'bg-zinc-600'}`}
              style={{ width: `${barPct(stats, minDecided)}%` }}
            />
          </div>
          <span className="block font-mono text-[9px] leading-tight text-zinc-500">
            {sampleNote(stats)}
            {stats.strength ? ` · ${RATE_STRENGTH_LABEL[stats.strength]}` : ''}
          </span>
        </div>
      );
    })}
  </div>
);

/**
 * One headline finding as a tile: the figure, the share behind it, and the condition it is about.
 *
 * The callouts at the top of the card were sentences that had to be read to the end before they
 * could be compared. The figures are the same; drawn now, the finding is the number, the bar is
 * the share it came from, and the condition is named above it. The detail line carries the raw
 * counts, so nothing in the sentence is lost.
 *
 * `tone` is only ever colour and never changes what is claimed — the caller keeps thin samples
 * out of here, so a tile that is drawn at all is a finding the record supports.
 */
export const HighlightTile: React.FC<{
  /** The callout name, e.g. "Most reached". */
  label: string;
  /** The condition it is about, e.g. "MES 3 min support". */
  condition: string;
  /** The headline figure, already formatted. */
  value: string;
  /** What that figure counts, e.g. "lines reached". */
  unit: string;
  /** Where the bar fills to, 0-100. */
  meter: number;
  /** Colour only: `good` is a finding to lean on, `watch` one to look at. */
  tone?: 'good' | 'watch';
  /** The counts behind the figure. */
  detail: string;
  /** Optional reference tick on the bar, 0-100, with its meaning given by the caller. */
  marker?: number;
  /** The range the figure could sit in, for the tiles that carry a rate. */
  interval?: RateInterval | null;
  /** How much is behind the figure, for the tiles that carry a rate. */
  strength?: RateStrength | null;
  /** Test hook; also the `data-highlight` value. */
  name: string;
}> = ({
  label,
  condition,
  value,
  unit,
  meter,
  tone = 'good',
  detail,
  marker,
  interval,
  strength,
  name,
}) => {
  const good = tone === 'good';
  return (
    <div
      data-highlight={name}
      data-highlight-tone={tone}
      className={`space-y-1.5 rounded-xl border p-2.5 ${
        good ? 'border-emerald-900/60 bg-emerald-950/25' : 'border-amber-900/60 bg-amber-950/20'
      }`}
    >
      <span
        className={`block font-mono text-[10px] font-bold uppercase tracking-wide ${
          good ? 'text-emerald-300/90' : 'text-amber-300/90'
        }`}
      >
        {label}
      </span>
      <span className="block truncate text-xs text-zinc-200" title={condition}>
        {condition}
      </span>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span
          className={`font-mono text-xl font-bold leading-none ${
            good ? 'text-emerald-300' : 'text-amber-300'
          }`}
        >
          {value}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">{unit}</span>
        <RateTier strength={strength ?? null} />
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-zinc-800">
        <RateBand interval={interval ?? null} />
        <div
          data-highlight-meter={Math.round(clampPct(meter))}
          className={`h-full rounded-full ${good ? 'bg-emerald-400' : 'bg-amber-400'}`}
          style={{ width: `${clampPct(meter)}%` }}
        />
        {typeof marker === 'number' && (
          <span
            data-highlight-marker={Math.round(clampPct(marker))}
            className="absolute inset-y-0 w-px bg-zinc-300/80"
            style={{ left: `${clampPct(marker)}%` }}
            aria-hidden
          />
        )}
      </div>
      <span className="block text-[10px] leading-snug text-zinc-500">{detail}</span>
    </div>
  );
};

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
              {stats.strength ? ` · ${RATE_STRENGTH_LABEL[stats.strength]}` : ''}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-zinc-800">
            <RateBand interval={stats.holdInterval} />
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

/**
 * One labelled meter: the name on the left, the bar in the middle, the figure at the end of it.
 *
 * For the measures that are not a bucket's hold rate — how much of an instrument's marked record
 * is reached at all, how many of the tested lines are decided. Same bar language as the tiles, so
 * a coverage figure and a rate are read the same way rather than one as a bar and one as a wall of
 * counts. A `thin` row is grey and fills against the rate's floor, because its figure is a sample
 * still being collected and must not look like a reading.
 */
export const MeterRow: React.FC<{
  label: string;
  /** The figure at the end of the bar, already formatted. */
  value: string;
  /** Where the bar fills to, 0-100. */
  meter: number;
  /** True while the sample is too thin for the figure to be a rate. */
  thin?: boolean;
  /** Reference tick, 0-100 — drawn only when the row is not `thin`. */
  marker?: number;
  /** The range the figure could sit in, drawn behind the bar. Only ever given for a rate. */
  interval?: RateInterval | null;
  /** How much is behind the figure, named under it. Only ever given for a rate. */
  strength?: RateStrength | null;
  /** Test hook; also the `data-meter` value. */
  name: string;
}> = ({ label, value, meter, thin = false, marker, interval, strength, name }) => (
  <div data-meter={name} data-rate-strength={strength ?? 'none'} className="flex items-center gap-2">
    <span
      className="w-24 shrink-0 truncate font-mono text-[10px] text-zinc-500 sm:w-32"
      title={label}
    >
      {label}
    </span>
    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
      <RateBand interval={interval ?? null} />
      <div
        data-meter-value={Math.round(clampPct(meter))}
        className={`h-full rounded-full ${thin ? 'bg-zinc-600' : 'bg-emerald-400'}`}
        style={{ width: `${clampPct(meter)}%` }}
      />
      {!thin && typeof marker === 'number' && (
        <span
          data-meter-marker={Math.round(clampPct(marker))}
          className="absolute inset-y-0 w-px bg-zinc-300/80"
          style={{ left: `${clampPct(marker)}%` }}
          aria-hidden
        />
      )}
    </div>
    <span className="flex w-20 shrink-0 flex-col items-end sm:w-32">
      <span
        className={`font-mono text-[10px] ${thin ? 'text-zinc-500' : 'text-emerald-300'}`}
      >
        {value}
      </span>
      {strength && (
        <span className="font-mono text-[9px] text-zinc-500">
          {RATE_STRENGTH_LABEL[strength]}
        </span>
      )}
    </span>
  </div>
);

/** One slice of a stacked bar. */
export interface StackedSegment {
  key: string;
  /** Named in the legend under the bar. */
  label: string;
  count: number;
  /** Background class for this slice and, unless overridden, its legend swatch. */
  barClass: string;
}

/**
 * One bar split into what the marked lines turned into.
 *
 * Five figures in a row — marked, tested, never tested, closed out, test rate — left the trader
 * adding them up to see the shape of their own record. One bar shows the shape; the legend keeps
 * the exact counts, because a bar can show a proportion but never a number. Slices with nothing in
 * them are dropped from the legend rather than listed as a row of zeroes.
 */
export const StackedBar: React.FC<{
  segments: StackedSegment[];
  /** The whole the slices divide — the marked lines. */
  total: number;
  /** One extra item on the legend line, e.g. the rate the split implies. */
  note?: string;
}> = ({ segments, total, note }) => (
  <div className="space-y-1.5">
    <div
      data-coverage-bar={total}
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800"
    >
      {segments.map((segment) => (
        <div
          key={segment.key}
          data-coverage-segment={segment.key}
          data-coverage-count={segment.count}
          className={segment.barClass}
          style={{ width: `${total > 0 ? clampPct((segment.count / total) * 100) : 0}%` }}
        />
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {segments
        .filter((segment) => segment.count > 0)
        .map((segment) => (
          <span
            key={segment.key}
            className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500"
          >
            <span className={`h-2 w-2 shrink-0 rounded-sm ${segment.barClass}`} aria-hidden />
            {segment.count} {segment.label}
          </span>
        ))}
      {note && <span className="font-mono text-[10px] text-zinc-400">{note}</span>}
    </div>
  </div>
);

/**
 * One bucket on its own row: the label, the figure, the bar, and the counts behind it.
 *
 * Used where a name needs the width — a chart and a side, or a price line — so the bar sits under
 * the label rather than beside it. The figure is the hold rate once there is one, and the plain
 * count before that, in the same words the text rows used.
 */
export const EdgeBar: React.FC<{
  label: string;
  /** The counts under the bar, e.g. `7 marked · 5 touched · held 40% of 5`. */
  detail: string;
  stats: LevelEdgeStats;
  minDecided: number;
  /** Reference tick, 0-100, drawn only once the rate may be read. */
  marker?: number;
}> = ({ label, detail, stats, minDecided, marker }) => {
  const readable = isReadable(stats);
  return (
    <div
      data-edge-bar={readable ? 'rate' : 'thin'}
      data-rate-strength={stats.strength ?? 'none'}
      className="space-y-1"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-zinc-200" title={label}>
          {label}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5">
          <span
            className={`font-mono text-[10px] ${
              readable ? 'text-emerald-300' : 'text-zinc-500'
            }`}
          >
            {figureOf(stats)}
            {readable ? '' : ' — too thin for a rate'}
          </span>
          <RateTier strength={stats.strength} />
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-zinc-800">
        <RateBand interval={stats.holdInterval} />
        <div
          data-edge-meter={Math.round(barPct(stats, minDecided))}
          className={`h-full rounded-full ${readable ? 'bg-emerald-400' : 'bg-zinc-600'}`}
          style={{ width: `${barPct(stats, minDecided)}%` }}
        />
        {readable && typeof marker === 'number' && (
          <span
            data-edge-marker={Math.round(clampPct(marker))}
            className="absolute inset-y-0 w-px bg-zinc-300/80"
            style={{ left: `${clampPct(marker)}%` }}
            aria-hidden
          />
        )}
      </div>
      <span className="block font-mono text-[10px] leading-snug text-zinc-500">{detail}</span>
    </div>
  );
};

/**
 * The one-line key that belongs under any block of these bars.
 *
 * Every bar in the card shares a scale, so the key is shared too: green is a rate that may be read,
 * the tick is the coin flip a hold rate is worth comparing to, and grey is a sample still being
 * collected. Written once so a grey bar can never be mistaken for a weak edge.
 */
export const EdgeBarKey: React.FC<{ minDecided: number }> = ({ minDecided }) => (
  <p className="text-[10px] leading-relaxed text-zinc-500">
    Green is a hold rate — the share of decided touches where price never came back. The pale band
    behind it is the range that rate could sit in at this sample size: five touches at 80% could
    honestly be anywhere from 38% to 96%, where twenty at the same 80% is 61% to 91%. The word
    under the figure names how much is behind it. The tick is 50%, the coin flip worth comparing
    to. Grey is a sample still being collected, filled to the {minDecided} decided touches a rate
    needs, so a short grey bar is a young record and not a weak line.
  </p>
);
