import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Clock, Info, Target } from 'lucide-react';
import {
  averageClockMinutes,
  directionStats,
  outcomeSplit,
  peakBucket,
  reliabilitySeries,
  statsByTimeframe,
  statsFor,
  timingHistogram,
  totals,
} from '../../lib/mes/analytics';
import { TIMEFRAME_COLORS, TIMEFRAMES } from '../../lib/mes/constants';
import { formatPct, formatPct100, formatShortDate, minutesToClockLabel } from '../../lib/mes/utils';
import {
  DirectionSummary,
  EmptyState,
  GradeChip,
  SectionCard,
  Stat,
} from './mes-ui';
import { useMesJournal } from './mes-store';

/**
 * The Dashboard: the record in one screen.
 *
 * Six headline figures, then the four pictures that explain them — reliability by chart,
 * reliability over time, the outcome mix, and when the levels are hit. Every rating shown is
 * the SHRUNK strength (with its grade and confidence beside it), never the raw hold rate,
 * because a one-test line at 100% is the most misread figure in a small journal.
 */
export const MesDashboard: React.FC = () => {
  const { records } = useMesJournal();

  if (records.length === 0) {
    return (
      <SectionCard title="Nothing logged yet">
        <EmptyState>
          Log the levels you are watching on the Daily Log tab and this screen fills in — how
          often each chart held, what the mix of outcomes looks like, and when your lines get hit.
        </EmptyState>
      </SectionCard>
    );
  }

  const overall = statsFor('all', 'All levels', records);
  const summary = totals(records);
  const byTimeframe = statsByTimeframe(records).map((stats) => ({
    label: stats.label,
    key: stats.key,
    strength: stats.strength,
    reliability: stats.reliability,
    holds: stats.holds,
    breaks: stats.breaks,
    sampleSize: stats.sampleSize,
    logged: stats.logged,
    tested: stats.tested,
  }));
  const series = reliabilitySeries(records);
  const mix = outcomeSplit(records);
  const direction = directionStats(records);
  const buckets = timingHistogram(records);
  const peak = peakBucket(buckets, 'hit');
  const avgHit = averageClockMinutes(records, 'hitTime');
  const avgBroke = averageClockMinutes(records, 'breakTime');

  const donut = [
    { name: 'Held', value: mix.held, color: '#34d399' },
    { name: 'Broke', value: mix.broke, color: '#fb7185' },
    { name: 'Untested', value: mix.untested, color: '#71717a' },
  ].filter((slice) => slice.value > 0);

  return (
    <div className="space-y-4">
      {/* ---- KPIs -------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Sessions logged" value={summary.sessions} sub={`${summary.records} levels recorded`} />
        <Stat
          label="Levels tested"
          value={overall.tested}
          sub={`of ${overall.logged} logged`}
        />
        <Stat
          label="Hit rate"
          value={formatPct(overall.hitRate)}
          meter={overall.hitRate === null ? null : overall.hitRate * 100}
          meterClass="bg-sky-400"
          sub="Share of logged levels price actually reached"
        />
        <Stat
          label="Reliability rating"
          value={formatPct100(overall.strength)}
          meter={overall.strength}
          meterClass="bg-emerald-400"
          sub={
            <span className="inline-flex items-center gap-1.5">
              <GradeChip grade={overall.grade} confidence={overall.confidence} />
              {overall.sampleSize} decisive tests
            </span>
          }
        />
        <Stat
          label="Avg tests per hit"
          value={overall.avgTouches === null ? '—' : overall.avgTouches.toFixed(1)}
          sub="How many times a reached level was tested"
        />
        <Stat label="Decisive tests" value={overall.sampleSize} sub="Holds plus breaks" />
      </div>

      {/* ---- Reliability by timeframe ------------------------------------ */}
      <SectionCard
        title="Reliability by timeframe"
        subtitle="Shrunk strength per chart, 0–100. The dashed line is 50%, a coin flip."
        icon={<Activity className="h-4 w-4 text-sky-300" />}
      >
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byTimeframe} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#1f2937" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#8ea0b8', fontSize: 11 }} stroke="#334155" />
              <YAxis domain={[0, 100]} tick={{ fill: '#8ea0b8', fontSize: 11 }} stroke="#334155" />
              <Tooltip content={<TimeframeTooltip />} />
              <ReferenceLine
                y={50}
                stroke="#64748b"
                strokeDasharray="4 4"
                label={{ value: 'coin flip', position: 'insideTopRight', fill: '#64748b', fontSize: 10 }}
              />
              <Bar dataKey="strength" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                {byTimeframe.map((row, index) => (
                  <Cell
                    key={row.key}
                    fill={TIMEFRAME_COLORS[TIMEFRAMES[index]] ?? '#38bdf8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* ---- Reliability over time --------------------------------------- */}
      <SectionCard
        title="Reliability over time"
        subtitle="Each session's own hold rate against the rolling rate across every session to date."
      >
        {series.length === 0 ? (
          <EmptyState>No sessions to plot yet.</EmptyState>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#1f2937" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fill: '#8ea0b8', fontSize: 11 }}
                  stroke="#334155"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#8ea0b8', fontSize: 11 }}
                  stroke="#334155"
                />
                <Tooltip content={<SeriesTooltip />} />
                <Line
                  name="Session"
                  type="monotone"
                  dataKey="reliability"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                  dot={{ r: 2 }}
                />
                <Line
                  name="Cumulative"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#a3e635"
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      {/* ---- Outcome mix -------------------------------------------------- */}
      <SectionCard
        title="Outcome mix"
        subtitle="Every level, as what happened when price reached it. Mixed levels are split between the two."
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div style={{ height: 220, width: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donut}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  isAnimationActive={false}
                >
                  {donut.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} stroke="#0a0e14" />
                  ))}
                </Pie>
                <Tooltip content={<MixTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full flex-1 space-y-2">
            {[
              { name: 'Held', value: mix.held, bar: 'bg-emerald-400' },
              { name: 'Broke', value: mix.broke, bar: 'bg-rose-400' },
              { name: 'Untested', value: mix.untested, bar: 'bg-zinc-500' },
            ].map((item) => (
              <li key={item.name} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${item.bar}`} aria-hidden />
                <span className="w-20 text-xs text-zinc-300">{item.name}</span>
                <span className="w-20 font-mono text-xs tabular-nums text-zinc-200">
                  {Math.round(item.value * 10) / 10}
                </span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {mix.total > 0 ? formatPct(item.value / mix.total) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SectionCard>

      {/* ---- Session timing and break direction --------------------------- */}
      <SectionCard
        title="Session timing & break direction"
        subtitle="When your levels get reached, and which way they give."
        icon={<Clock className="h-4 w-4 text-amber-300" />}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Avg hit time
            </span>
            <span className="font-mono text-lg font-bold text-zinc-100">
              {avgHit === null ? '—' : minutesToClockLabel(avgHit)}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Avg break time
            </span>
            <span className="font-mono text-lg font-bold text-zinc-100">
              {avgBroke === null ? '—' : minutesToClockLabel(avgBroke)}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Busiest hit window
            </span>
            <span className="font-mono text-lg font-bold text-zinc-100">
              {peak ? peak.label : '—'}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <span className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            <Target className="h-3.5 w-3.5" /> Break direction
          </span>
          <DirectionSummary stats={direction} />
          <p className="mt-2 text-[11px] leading-snug text-zinc-400">
            {direction.total > 0
              ? `Your levels broke to the upside ${formatPct(direction.upShare)} of the time ` +
                `(${direction.total} tagged break${direction.total === 1 ? '' : 's'}).`
              : 'No breaks have a direction tagged yet, so there is no split to read.'}
          </p>
        </div>
      </SectionCard>

      {/* ---- What this means ---------------------------------------------- */}
      <SectionCard
        title="What this means"
        subtitle="How to read the rating, in plain English."
        icon={<Info className="h-4 w-4 text-zinc-400" />}
      >
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-400">
          <li>
            <span className="text-zinc-200">Hit rate</span> is the share of the levels you logged
            that price actually reached. It answers "did I pick lines that mattered", not "were
            they good".
          </li>
          <li>
            <span className="text-zinc-200">Reliability</span> is the raw hold rate: holds divided
            by holds plus breaks, with the levels price never reached left out. It never counts an
            untested line as a win.
          </li>
          <li>
            <span className="text-zinc-200">Strength</span> is what the grade is based on. It
            shrinks the raw rate toward 50% with a small prior, so one lucky hold reads about 60%
            instead of a misleading 100%, and only a real sample earns a high grade.
          </li>
          <li>
            Grades run <span className="text-zinc-200">A (68+)</span>,{' '}
            <span className="text-zinc-200">B (58+)</span>,{' '}
            <span className="text-zinc-200">C (48+)</span>, then D. The coloured dot beside the
            grade is confidence: below 5 decisive tests is low, 5–14 medium, 15 or more high — so a
            strong rating on a thin sample still says so.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
};

interface TimeframeRow {
  key: string;
  label: string;
  strength: number | null;
  reliability: number | null;
  holds: number;
  breaks: number;
  sampleSize: number;
}

const TimeframeTooltip: React.FC<{ active?: boolean; payload?: Array<{ payload: TimeframeRow }> }> = ({
  active,
  payload,
}) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] shadow-lg">
      <div className="font-mono font-bold text-zinc-100">{row.label}</div>
      <div className="mt-1 font-mono text-zinc-300">
        strength {formatPct100(row.strength)} · raw {formatPct(row.reliability)}
      </div>
      <div className="font-mono text-zinc-500">
        {row.holds} held · {row.breaks} broke · {row.sampleSize} decisive
      </div>
    </div>
  );
};

const SeriesTooltip: React.FC<{
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number | null; color?: string }>;
}> = ({ active, label, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] shadow-lg">
      <div className="font-mono font-bold text-zinc-100">{label ? formatShortDate(label) : ''}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="font-mono" style={{ color: entry.color }}>
          {entry.name}: {entry.value === null || entry.value === undefined ? '—' : `${entry.value}%`}
        </div>
      ))}
    </div>
  );
};

const MixTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
}> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] shadow-lg">
      <span className="font-mono text-zinc-100">{item.name}</span>
      <span className="ml-2 font-mono text-zinc-400">
        {Math.round((item.value ?? 0) * 10) / 10} levels
      </span>
    </div>
  );
};
