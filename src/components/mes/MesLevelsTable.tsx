import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, ListFilter, RotateCcw } from 'lucide-react';
import type { BreakDirection, LevelKind, LevelRecord, SetupTag, Timeframe } from '../../lib/mes/types';
import { directionStats, statsFor } from '../../lib/mes/analytics';
import {
  DIRECTION_LABELS,
  KIND_LABELS,
  SETUP_LABELS,
  SETUP_TAGS,
  TIMEFRAMES,
  TIMEFRAME_ORDER,
} from '../../lib/mes/constants';
import { downloadText, formatPct, recordsToCsv } from '../../lib/mes/utils';
import { useMesJournal } from './mes-store';
import { MesLevelRow } from './MesLevelRow';
import {
  DirectionSummary,
  EmptyState,
  GradeChip,
  SectionCard,
  Stat,
} from './mes-ui';

/**
 * Every level ever logged: filter, sort, edit, delete, export.
 *
 * Rows are self-contained cards rather than a data table. An editable row inside a shared
 * table needs a single full-width cell, which breaks the header alignment above it — so the
 * list is a vertical stack with its own sort control instead, and each row owns its layout.
 *
 * The rendered list is capped: a couple of years of sessions is thousands of editable rows,
 * and the cap plus the filters is what keeps the page responsive. The trader is told how many
 * are hidden rather than left to wonder.
 */
const RENDER_CAP = 300;

type SortKey = 'date' | 'price' | 'timeframe' | 'tests';
type DirectionFilter = BreakDirection | 'none' | '';

export const MesLevelsTable: React.FC = () => {
  const { records, updateLevel, deleteLevel } = useMesJournal();

  const [timeframe, setTimeframe] = useState<Timeframe | ''>('');
  const [kind, setKind] = useState<LevelKind | ''>('');
  const [setup, setSetup] = useState<SetupTag | ''>('');
  const [direction, setDirection] = useState<DirectionFilter>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [ascending, setAscending] = useState(false);

  const anyFilter = Boolean(timeframe || kind || setup || direction || from || to);

  const clearFilters = () => {
    setTimeframe('');
    setKind('');
    setSetup('');
    setDirection('');
    setFrom('');
    setTo('');
  };

  const filtered = useMemo(() => {
    return records.filter((record) => {
      if (timeframe && record.timeframe !== timeframe) return false;
      if (kind && record.kind !== kind) return false;
      if (setup && record.setup !== setup) return false;
      if (from && record.date < from) return false;
      if (to && record.date > to) return false;
      if (direction === 'none') return record.breaks > 0 && record.breakDirection === '';
      if (direction && record.breakDirection !== direction) return false;
      return true;
    });
  }, [records, timeframe, kind, setup, direction, from, to]);

  const sorted = useMemo(() => {
    const compare = (a: LevelRecord, b: LevelRecord): number => {
      switch (sortKey) {
        case 'price':
          return a.price - b.price;
        case 'timeframe':
          return TIMEFRAME_ORDER[a.timeframe] - TIMEFRAME_ORDER[b.timeframe];
        case 'tests':
          return a.touches - b.touches;
        case 'date':
        default:
          return a.date.localeCompare(b.date) || a.price - b.price;
      }
    };
    const ordered = [...filtered].sort(compare);
    return ascending ? ordered : ordered.reverse();
  }, [filtered, sortKey, ascending]);

  const summary = useMemo(() => statsFor('filtered', 'Filtered', filtered), [filtered]);
  const visible = sorted.slice(0, RENDER_CAP);
  const hidden = sorted.length - visible.length;

  const exportCsv = () =>
    downloadText(`mes-levels-${new Date().toISOString().slice(0, 10)}.csv`, recordsToCsv(sorted), 'text/csv');

  return (
    <div className="space-y-5">
      {/* Filter toolbar */}
      <SectionCard
        title="Filters"
        icon={<ListFilter className="h-4 w-4 text-zinc-300" />}
        subtitle="Narrow the record; the summary below always describes what the filters left."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={clearFilters}
              disabled={!anyFilter}
              className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Clear filters
            </button>
            <button
              id="mes-download-csv"
              onClick={exportCsv}
              className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-bold text-zinc-950 hover:bg-white"
            >
              <Download className="h-3.5 w-3.5" /> Download CSV
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Filter label="Chart">
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as Timeframe | '')}
              className={selectClass}
            >
              <option value="">All charts</option>
              {TIMEFRAMES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Side">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as LevelKind | '')}
              className={selectClass}
            >
              <option value="">Both sides</option>
              <option value="support">{KIND_LABELS.support}</option>
              <option value="resistance">{KIND_LABELS.resistance}</option>
            </select>
          </Filter>
          <Filter label="Setup">
            <select
              value={setup}
              onChange={(event) => setSetup(event.target.value as SetupTag | '')}
              className={selectClass}
            >
              <option value="">Any setup</option>
              {SETUP_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {SETUP_LABELS[tag]}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Break direction">
            <select
              id="mes-filter-direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value as DirectionFilter)}
              className={selectClass}
            >
              <option value="">Any direction</option>
              <option value="up">{DIRECTION_LABELS.up}</option>
              <option value="down">{DIRECTION_LABELS.down}</option>
              <option value="none">Not tagged</option>
            </select>
          </Filter>
          <Filter label="From">
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={selectClass}
            />
          </Filter>
          <Filter label="To">
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={selectClass}
            />
          </Filter>
        </div>
      </SectionCard>

      {/* Summary + sort */}
      <SectionCard
        title={`${summary.logged} level${summary.logged === 1 ? '' : 's'}`}
        subtitle={anyFilter ? 'Describing the filtered set.' : 'Describing the whole record.'}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Levels" value={summary.logged} sub={`${summary.tested} reached`} />
          <Stat
            label="Hit rate"
            value={formatPct(summary.hitRate)}
            meter={summary.hitRate === null ? null : summary.hitRate * 100}
            meterClass="bg-sky-400"
          />
          <Stat
            label="Reliability"
            value={formatPct(summary.reliability)}
            meter={summary.strength}
            meterClass="bg-emerald-400"
            sub={
              <span className="inline-flex items-center gap-1">
                <GradeChip grade={summary.grade} confidence={summary.confidence} />
                {summary.sampleSize} decisive
              </span>
            }
          />
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Break direction
            </span>
            <div className="mt-2">
              <DirectionSummary stats={directionStats(filtered)} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Sort + rows */}
      <SectionCard
        title="Levels"
        actions={
          <div className="flex items-center gap-2">
            <select
              id="mes-sort"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className={selectClass}
            >
              <option value="date">Sort by date</option>
              <option value="price">Sort by price</option>
              <option value="timeframe">Sort by chart</option>
              <option value="tests">Sort by tests</option>
            </select>
            <button
              onClick={() => setAscending((value) => !value)}
              aria-label={ascending ? 'Ascending' : 'Descending'}
              className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              {ascending ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              {ascending ? 'Asc' : 'Desc'}
            </button>
          </div>
        }
      >
        {visible.length === 0 ? (
          <EmptyState>
            {records.length === 0
              ? 'No levels logged yet. Start on the Daily Log tab.'
              : 'No levels match these filters.'}
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {visible.map((record) => (
              <MesLevelRow
                key={record.id}
                record={record}
                onSave={updateLevel}
                onDelete={deleteLevel}
                showDate
                showTimeframe
              />
            ))}
          </div>
        )}
        {hidden > 0 && (
          <p className="mt-3 text-center text-[11px] text-zinc-500">
            {hidden} more row{hidden === 1 ? '' : 's'} hidden. Filter to narrow the list.
          </p>
        )}
      </SectionCard>
    </div>
  );
};

const selectClass =
  'rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-sky-600';

const Filter: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1">
    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
    {children}
  </label>
);
