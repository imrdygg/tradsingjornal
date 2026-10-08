import React, { useMemo } from 'react';
import { Grid3x3, Tag } from 'lucide-react';
import type { LevelKind } from '../../lib/mes/types';
import { statsBySetup, statsByTimeframeKind, type GroupStats } from '../../lib/mes/analytics';
import { KIND_LABELS, SETUP_LABELS } from '../../lib/mes/constants';
import { formatPct, formatPct100 } from '../../lib/mes/utils';
import { EmptyState, Meter, RatingLine, SectionCard, Stat } from './mes-ui';
import { useMesJournal } from './mes-store';

/**
 * The Patterns tab: which setups hold, and which chart-and-side combinations do.
 *
 * Two reads on one page. The setup list answers "does my rejection trade actually work",
 * and the heat grid answers "where on the charts do my lines hold" without the trader
 * holding six charts in their head. The grid is shaded by SHRUNK strength, so a single
 * lucky test cannot paint a bright cell that looks like an edge.
 */

/** Shade for a heat cell: emerald for support, rose for resistance, heavier as strength rises. */
function heatStyle(kind: LevelKind, strength: number | null): React.CSSProperties {
  const alpha = strength === null ? 0.06 : Math.max(0.06, Math.min(1, strength / 100));
  const rgb = kind === 'support' ? '52, 211, 153' : '251, 113, 133';
  return { backgroundColor: `rgba(${rgb}, ${alpha * 0.85})` };
}

const HeatCell: React.FC<{
  kind: LevelKind;
  timeframe: string;
  stats: GroupStats;
}> = ({ kind, timeframe, stats }) => (
  <div
    data-heat-cell={`${timeframe}-${kind}`}
    data-heat-strength={stats.strength ?? 'none'}
    style={heatStyle(kind, stats.strength)}
    className="rounded-lg border border-zinc-800/80 px-2 py-1.5"
    title={`${stats.label} ${timeframe}: ${formatPct100(stats.strength)} · ${stats.sampleSize} decisive test(s)`}
  >
    <span className="block font-mono text-sm font-bold leading-tight tabular-nums text-zinc-50">
      {stats.strength === null ? '—' : stats.strength.toFixed(0)}
    </span>
    <span className="block font-mono text-[9px] leading-tight text-zinc-300/80">
      {stats.sampleSize} test{stats.sampleSize === 1 ? '' : 's'}
    </span>
  </div>
);

export const MesPatterns: React.FC = () => {
  const { records } = useMesJournal();

  const setups = useMemo(() => statsBySetup(records), [records]);
  const heat = useMemo(() => statsByTimeframeKind(records), [records]);
  const decisive = useMemo(
    () => records.reduce((sum, record) => sum + record.holds + record.breaks, 0),
    [records]
  );

  if (records.length === 0) {
    return (
      <SectionCard title="Patterns" subtitle="Setup performance and where your lines hold.">
        <EmptyState>
          Nothing logged yet. Mark a level on the Daily Log tab, tag its setup, and this page
          will start showing which patterns hold and which chart-and-side combinations do.
        </EmptyState>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Setup performance"
        subtitle="Each pattern's shrunk hold rate, with the sample behind it."
        icon={<Tag className="h-4 w-4 text-zinc-400" />}
      >
        {setups.length === 0 ? (
          <EmptyState>
            No level has a setup tag yet. Tag one on the Daily Log tab to see which patterns
            hold.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {setups.map((group) => (
              <li
                key={group.key}
                data-setup-row={group.key}
                className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-200">
                    {SETUP_LABELS[group.key as keyof typeof SETUP_LABELS] ?? group.key}
                  </span>
                  <RatingLine stats={group} />
                </div>
                <Meter value={group.strength} className="mt-2 bg-emerald-400" />
                <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
                  {group.logged} logged · {group.tested} reached · held {group.holds}, broke{' '}
                  {group.breaks} · raw {formatPct(group.reliability)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Timeframe × side"
        subtitle="Shrunk strength for each chart and side. Shade follows the rating."
        icon={<Grid3x3 className="h-4 w-4 text-zinc-400" />}
      >
        <div className="grid grid-cols-3 gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Chart
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400/80">
            {KIND_LABELS.support}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-rose-400/80">
            {KIND_LABELS.resistance}
          </span>

          {heat.map((row) => (
            <React.Fragment key={row.timeframe}>
              <span
                data-heat-label={row.timeframe}
                className="flex items-center font-mono text-xs text-zinc-300"
              >
                {row.timeframe}
              </span>
              <HeatCell kind="support" timeframe={row.timeframe} stats={row.support} />
              <HeatCell kind="resistance" timeframe={row.timeframe} stats={row.resistance} />
            </React.Fragment>
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
          Green is support, red is resistance. A cell's shade is the SHRUNK strength, pulled
          toward 50% until there is a sample behind it, so a single lucky test cannot paint a
          bright cell. The number is that rating and the line under it is how many decisive
          tests it rests on.
        </p>
      </SectionCard>

      <SectionCard title="At a glance">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Tagged setups"
            value={setups.length}
            sub="patterns with at least one level"
          />
          <Stat label="Levels" value={records.length} sub="across all charts" />
          <Stat
            label="With a setup"
            value={records.filter((record) => record.setup).length}
            sub="levels carrying a pattern tag"
          />
          <Stat label="Decisive tests" value={decisive} sub="holds plus breaks" />
        </div>
      </SectionCard>
    </div>
  );
};
