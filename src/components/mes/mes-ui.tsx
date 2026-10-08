import React from 'react';
import type { BreakDirection, Grade, Confidence, LevelKind, LevelOutcome } from '../../lib/mes/types';
import type { GroupStats, DirectionStats } from '../../lib/mes/analytics';
import {
  CONFIDENCE_CLASS,
  DIRECTION_CLASS,
  DIRECTION_LABELS,
  GRADE_CLASS,
  KIND_CLASS,
  KIND_LABELS,
  OUTCOME_CLASS,
  OUTCOME_LABELS,
} from '../../lib/mes/constants';
import { formatPct, formatPct100 } from '../../lib/mes/utils';

/**
 * The tab's shared atoms.
 *
 * One vocabulary for the whole feature: stat tiles, a reliability chip that always shows its
 * sample size, the support/resistance and held/broke/untested badges, and the split bar. The
 * colours are fixed here — support/held/up green, resistance/broke/down red — so a green bar
 * means the same thing in the heat grid, the donut and the timing split.
 */

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

/** A titled panel. Every block on the tab is one of these. */
export const SectionCard: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, actions, id, className, children }) => (
  <section
    id={id}
    className={cx(
      'rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm',
      className
    )}
  >
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
    {children}
  </section>
);

/** A labelled figure, optionally with a meter under it. */
export const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** 0..100 where the meter fills to; omit for no meter. */
  meter?: number | null;
  meterClass?: string;
  id?: string;
}> = ({ label, value, sub, meter, meterClass = 'bg-sky-400', id }) => (
  <div
    id={id}
    className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
    data-stat={label}
  >
    <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
      {label}
    </span>
    <span className="mt-1 block font-mono text-xl font-bold leading-tight text-zinc-100 tabular-nums">
      {value}
    </span>
    {typeof meter === 'number' && <Meter value={meter} className={cx('mt-2', meterClass)} />}
    {sub && <span className="mt-1 block text-[10px] leading-snug text-zinc-500">{sub}</span>}
  </div>
);

/** A 0..100 progress bar. A null value renders an empty track, never a fake zero. */
export const Meter: React.FC<{ value: number | null; className?: string }> = ({
  value,
  className,
}) => {
  const pct = value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
      <div className={cx('h-full rounded-full', className)} style={{ width: `${pct}%` }} />
    </div>
  );
};

/** A small chip. */
export const Badge: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({
  children,
  className,
  title,
}) => (
  <span
    title={title}
    className={cx(
      'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] leading-tight',
      className ?? 'border-zinc-700/60 bg-zinc-900/50 text-zinc-400'
    )}
  >
    {children}
  </span>
);

export const KindBadge: React.FC<{ kind: LevelKind }> = ({ kind }) => (
  <Badge className={KIND_CLASS[kind]}>{KIND_LABELS[kind]}</Badge>
);

export const OutcomeBadge: React.FC<{ outcome: LevelOutcome }> = ({ outcome }) => (
  <Badge className={OUTCOME_CLASS[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>
);

export const DirectionBadge: React.FC<{ direction: BreakDirection }> = ({ direction }) => (
  <Badge className={DIRECTION_CLASS[direction]}>
    {direction === 'up' ? '▲' : '▼'} {DIRECTION_LABELS[direction]}
  </Badge>
);

/** The grade box with its confidence dot. */
export const GradeChip: React.FC<{ grade: Grade; confidence?: Confidence }> = ({
  grade,
  confidence,
}) => (
  <span className="inline-flex items-center gap-1">
    <span
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[11px] font-bold',
        GRADE_CLASS[grade]
      )}
      title={`Grade ${grade}`}
    >
      {grade}
    </span>
    {confidence && (
      <span
        className={cx('h-1.5 w-1.5 rounded-full', CONFIDENCE_CLASS[confidence])}
        title={`${confidence} confidence`}
        aria-label={`${confidence} confidence`}
      />
    )}
  </span>
);

/**
 * The one-line rating used everywhere a group is summarised: shrunk strength, its grade,
 * its confidence dot and the sample it rests on.
 */
export const RatingLine: React.FC<{ stats: GroupStats; showLabel?: boolean }> = ({
  stats,
  showLabel = false,
}) => (
  <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-zinc-400">
    {showLabel && <span className="text-zinc-300">{stats.label}</span>}
    <span className="font-bold text-zinc-100">{formatPct100(stats.strength)}</span>
    <GradeChip grade={stats.grade} confidence={stats.confidence} />
    <span className="text-zinc-500">
      {stats.sampleSize} decisive test{stats.sampleSize === 1 ? '' : 's'}
    </span>
    <span className="text-zinc-600">·</span>
    <span className="text-zinc-500">raw {formatPct(stats.reliability)}</span>
  </span>
);

/** A two-segment upside/downside bar with a legend. */
export const SplitBar: React.FC<{
  up: number;
  down: number;
  upLabel?: string;
  downLabel?: string;
}> = ({ up, down, upLabel = 'Upside', downLabel = 'Downside' }) => {
  const total = up + down;
  const upPct = total > 0 ? (up / total) * 100 : 0;
  const downPct = total > 0 ? (down / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-emerald-400" style={{ width: `${upPct}%` }} />
        <div className="bg-rose-400" style={{ width: `${downPct}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-400" aria-hidden />
          {up} {upLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-400" aria-hidden />
          {down} {downLabel}
        </span>
      </div>
    </div>
  );
};

/** The direction split from a set of records, with the untagged count left out and named. */
export const DirectionSummary: React.FC<{ stats: DirectionStats; className?: string }> = ({
  stats,
  className,
}) => (
  <div className={className}>
    <SplitBar up={stats.up} down={stats.down} />
    {stats.unknown > 0 && (
      <p className="mt-1 text-[10px] text-amber-300/90">
        {stats.unknown} break event{stats.unknown === 1 ? '' : 's'} have no direction tagged yet.
      </p>
    )}
  </div>
);

export const EmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-500">
    {children}
  </p>
);

/**
 * One segmented control, used for the support/resistance, outcome and direction toggles.
 *
 * `value` may be a value no option carries — the direction pick before a break is tagged,
 * or an outcome that matches no quick-pick — in which case nothing reads as active rather
 * than the first option lighting up on its own.
 */
export interface SegmentedOption {
  value: string;
  label: React.ReactNode;
}

export function Segmented({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx(
        'inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5',
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cx(
            'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
            value === option.value
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
