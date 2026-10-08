import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpDown, Clock3, ListChecks } from 'lucide-react';
import { useMesJournal } from './mes-store';
import {
  averageClockMinutes,
  directionStats,
  peakBucket,
  statsByKind,
  timingHistogram,
  type DirectionStats,
} from '../../lib/mes/analytics';
import { BUCKET_MINUTES, KIND_LABELS, TIMEFRAMES } from '../../lib/mes/constants';
import { formatPct, minutesToClockLabel } from '../../lib/mes/utils';
import type { LevelKind } from '../../lib/mes/types';
import {
  Badge,
  DirectionSummary,
  EmptyState,
  SectionCard,
  SplitBar,
  Stat,
} from './mes-ui';

/**
 * When levels get hit and broken, and which way they break.
 *
 * Everything here is a count of what the trader already logged; the page states that plainly
 * rather than letting an hour that has been logged twice read as a pattern. The direction
 * split counts tagged break EVENTS, so a record with many untagged breaks still reports a
 * meaningful split, and the untagged count becomes the nudge at the foot of the page.
 */
export const MesTiming: React.FC = () => {
  const { records } = useMesJournal();

  const view = useMemo(() => {
    const buckets = timingHistogram(records, BUCKET_MINUTES, true);
    const sideGroups = statsByKind(records);
    const sides = (['support', 'resistance'] as LevelKind[]).map((kind) => ({
      kind,
      label: KIND_LABELS[kind],
      group: sideGroups.find((group) => group.key === kind),
      stats: directionStats(records.filter((record) => record.kind === kind)),
    }));
    const timeframeRows = TIMEFRAMES.map((timeframe) => ({
      timeframe,
      ...directionStats(records.filter((record) => record.timeframe === timeframe)),
    })).filter((row) => row.total > 0 || row.unknown > 0);

    return {
      buckets,
      sides,
      timeframeRows,
      avgHit: averageClockMinutes(records, 'hitTime'),
      avgBreak: averageClockMinutes(records, 'breakTime'),
      hitPeak: peakBucket(buckets, 'hit'),
      overall: directionStats(records),
    };
  }, [records]);

  if (records.length === 0) {
    return (
      <SectionCard
        title="Timing"
        subtitle="When your levels get hit and broken — logged from your own sessions."
      >
        <EmptyState>No levels logged yet. Add them on the Daily Log tab and this fills in.</EmptyState>
      </SectionCard>
    );
  }

  const { buckets, sides, timeframeRows, avgHit, avgBreak, hitPeak, overall } = view;

  return (
    <div className="space-y-4">
      {/* ---- KPIs ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Avg hit time"
          value={avgHit === null ? '—' : minutesToClockLabel(avgHit)}
          sub={`${records.filter((record) => record.hitTime).length} timed hit${
            records.filter((record) => record.hitTime).length === 1 ? '' : 's'
          }`}
        />
        <Stat
          label="Avg break time"
          value={avgBreak === null ? '—' : minutesToClockLabel(avgBreak)}
          sub={`${records.filter((record) => record.breakTime).length} timed break${
            records.filter((record) => record.breakTime).length === 1 ? '' : 's'
          }`}
        />
        <Stat
          label="Busiest hit window"
          value={hitPeak ? hitPeak.label : '—'}
          sub={hitPeak ? `${hitPeak.hit} level(s) reached in this window` : 'No hit times logged yet'}
        />
        <Stat
          label="Direction split"
          value={overall.total > 0 ? formatPct(overall.upShare) : '—'}
          sub={
            overall.total > 0
              ? `${overall.up} up · ${overall.down} down (tagged breaks)`
              : 'No breaks have a direction tagged yet'
          }
          meter={overall.upShare === null ? null : overall.upShare * 100}
          meterClass="bg-emerald-400"
        />
      </div>

      {/* ---- When are levels hit? ---- */}
      <SectionCard
        title="When are levels hit?"
        subtitle={`Levels reached and levels broken, counted in ${BUCKET_MINUTES}-minute windows across every session you logged.`}
        icon={<Clock3 className="h-4 w-4 text-sky-400" />}
      >
        {buckets.length === 0 ? (
          <EmptyState>No hit or break times recorded yet.</EmptyState>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid stroke="#223044" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#8ea0b8', fontSize: 10 }}
                  interval="preserveStartEnd"
                  stroke="#223044"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: '#8ea0b8', fontSize: 10 }}
                  stroke="#223044"
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: '#0f1520',
                    border: '1px solid #223044',
                    borderRadius: 10,
                    fontSize: 11,
                  }}
                />
                <Bar
                  dataKey="hit"
                  name="Hit"
                  fill="#34d399"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="broke"
                  name="Broke"
                  fill="#fb7185"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {buckets.length > 0 && (
          <p className="mt-1 text-[10px] text-zinc-500">
            Green is a level reached in that window; red is a level that broke in it. A bar counts
            levels, not tests.
          </p>
        )}
      </SectionCard>

      {/* ---- Break direction by side ---- */}
      <SectionCard
        title="Break direction by side"
        subtitle="Which way price left each kind of line, counted in break events."
        icon={<ArrowUpDown className="h-4 w-4 text-amber-400" />}
      >
        <div className="mb-3">
          <DirectionSummary stats={overall} />
        </div>
        <ul className="space-y-3">
          {sides.map(({ kind, label, group, stats }) => (
            <li
              key={kind}
              data-mes-side={kind}
              className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">{label}</span>
                {stats.total > 0 && <DirectionBadgeFor stats={stats} />}
                <span className="font-mono text-[10px] text-zinc-500">
                  {group?.logged ?? 0} level(s) · {stats.total} tagged break(s)
                </span>
              </div>
              <SplitBar up={stats.up} down={stats.down} />
              <p className="mt-2 text-[11px] leading-snug text-zinc-400">
                {sentenceFor(label, stats)}
              </p>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* ---- Break direction by timeframe ---- */}
      <SectionCard
        title="Break direction by timeframe"
        subtitle="The same split, one chart at a time. A small sample is a tally, not a rate."
        icon={<ListChecks className="h-4 w-4 text-purple-400" />}
      >
        {timeframeRows.length === 0 ? (
          <EmptyState>No breaks logged yet.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="bg-zinc-950/60 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Chart</th>
                  <th className="px-3 py-2 font-medium">Upside</th>
                  <th className="px-3 py-2 font-medium">Downside</th>
                  <th className="px-3 py-2 font-medium">Untagged</th>
                  <th className="px-3 py-2 font-medium">Upside %</th>
                </tr>
              </thead>
              <tbody>
                {timeframeRows.map((row) => (
                  <tr key={row.timeframe} className="border-t border-zinc-800/70">
                    <td className="px-3 py-1.5 text-sky-300">{row.timeframe}</td>
                    <td className="px-3 py-1.5 text-emerald-300">{row.up}</td>
                    <td className="px-3 py-1.5 text-rose-300">{row.down}</td>
                    <td className="px-3 py-1.5 text-zinc-400">{row.unknown || '—'}</td>
                    <td className="px-3 py-1.5 text-zinc-200">
                      {row.total > 0 ? formatPct(row.upShare) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ---- The nudge ---- */}
      {overall.unknown > 0 ? (
        <p className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[11px] leading-snug text-amber-200">
          {overall.unknown} break event{overall.unknown === 1 ? '' : 's'} have no direction tagged
          yet. Editing a level lets you set "Broke to the…" so the split counts them.
        </p>
      ) : (
        <p className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-[11px] leading-snug text-emerald-200">
          Every logged break has a direction tagged. The split above is the whole picture.
        </p>
      )}
    </div>
  );
};

/** The dominant direction for one side, or a muted 'no breaks yet'. */
const DirectionBadgeFor: React.FC<{ stats: DirectionStats }> = ({ stats }) => {
  if (stats.total === 0) return <Badge>No breaks yet</Badge>;
  if (stats.up === stats.down) return <Badge>Even split</Badge>;
  const up = stats.up > stats.down;
  return (
    <Badge
      className={
        up
          ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
          : 'border-rose-800/60 bg-rose-950/40 text-rose-300'
      }
    >
      {up ? '▲ Mostly upside' : '▼ Mostly downside'}
    </Badge>
  );
};

/** The plain-language sentence under each side's bar. */
function sentenceFor(label: string, stats: DirectionStats): string {
  if (stats.total === 0) {
    return `${label} has no breaks with a direction recorded yet.`;
  }
  if (stats.up === stats.down) {
    return `${label} broke evenly, ${stats.up} to the upside and ${stats.down} to the downside (${stats.total} breaks).`;
  }
  const up = stats.up > stats.down;
  const share = up ? stats.upShare : stats.downShare;
  return `${label} broke to the ${up ? 'upside' : 'downside'} ${formatPct(share)} of the time (${stats.total} breaks).`;
}
