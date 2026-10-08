import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Gauge,
  Plus,
  Target,
} from 'lucide-react';
import type { Timeframe } from '../../lib/mes/types';
import { statsFor, sortByPriceDesc } from '../../lib/mes/analytics';
import { KIND_LABELS, TIMEFRAMES, TIMEFRAME_COLORS } from '../../lib/mes/constants';
import { formatDateLabel, shiftISODate, todayISO } from '../../lib/mes/utils';
import { useMesJournal } from './mes-store';
import { MesLevelForm } from './MesLevelForm';
import { MesLevelRow } from './MesLevelRow';
import { Badge, EmptyState, GradeChip, SectionCard, Stat } from './mes-ui';

/**
 * The primary entry screen: one session, six charts, every panel always rendered.
 *
 * The panels do not appear only when they hold something — an empty 1h panel with its own
 * Add button is how a trader learns the tracker wants all six, and it is what makes a chart
 * that was never touched distinguishable from one that was simply not opened.
 *
 * The add form stays open after saving and keeps the chart selected, so a run of levels can
 * be keyed in without re-opening anything.
 */
export const MesDailyLog: React.FC = () => {
  const { records, addLevel, updateLevel, deleteLevel } = useMesJournal();
  const [date, setDate] = useState<string>(todayISO());
  const [openFormFor, setOpenFormFor] = useState<Timeframe | null>(null);

  const dayRecords = useMemo(
    () => records.filter((record) => record.date === date),
    [records, date]
  );
  const session = useMemo(() => statsFor('session', date, dayRecords), [dayRecords, date]);

  const step = (delta: number) => {
    setOpenFormFor(null);
    setDate((current) => shiftISODate(current, delta));
  };

  return (
    <div className="space-y-5">
      {/* Date picker + session KPIs */}
      <SectionCard
        id="mes-daily-header"
        title={formatDateLabel(date)}
        subtitle="Log the levels you marked on each chart, then what price did at them."
        icon={<Gauge className="h-4 w-4 text-zinc-300" />}
        actions={
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous day"
              onClick={() => step(-1)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              id="mes-date"
              type="date"
              value={date}
              onChange={(event) => {
                setOpenFormFor(null);
                setDate(event.target.value || todayISO());
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-sky-600"
            />
            <button
              aria-label="Next day"
              onClick={() => step(1)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-300 hover:bg-zinc-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              id="mes-today"
              onClick={() => {
                setOpenFormFor(null);
                setDate(todayISO());
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              Today
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Levels logged" value={session.logged} />
          <Stat label="Levels hit" value={session.tested} sub={`${session.touches} tests total`} />
          <Stat
            label="Hit rate"
            value={session.hitRate === null ? '—' : `${Math.round(session.hitRate * 100)}%`}
            meter={session.hitRate === null ? null : session.hitRate * 100}
            meterClass="bg-sky-400"
          />
          <Stat
            label="Session reliability"
            value={session.strength === null ? '—' : `${session.strength.toFixed(1)}%`}
            meter={session.strength}
            meterClass="bg-emerald-400"
            sub={
              <span className="inline-flex items-center gap-1">
                <GradeChip grade={session.grade} confidence={session.confidence} />
                {session.sampleSize} decisive
              </span>
            }
          />
        </div>
      </SectionCard>

      {/* Six timeframe panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        {TIMEFRAMES.map((timeframe) => {
          const levels = sortByPriceDesc(
            dayRecords.filter((record) => record.timeframe === timeframe)
          );
          return (
            <section
              key={timeframe}
              data-mes-tf-card={timeframe}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm"
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: TIMEFRAME_COLORS[timeframe] }}
                  aria-hidden
                />
                <h3 className="font-mono text-sm font-semibold text-zinc-100">{timeframe}</h3>
                <Badge>{levels.length}</Badge>
                <button
                  id={`mes-add-${timeframe}`}
                  onClick={() =>
                    setOpenFormFor((current) => (current === timeframe ? null : timeframe))
                  }
                  className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>

              {openFormFor === timeframe && (
                <div className="mb-3">
                  <MesLevelForm
                    date={date}
                    timeframe={timeframe}
                    onAdd={addLevel}
                    onCancel={() => setOpenFormFor(null)}
                  />
                </div>
              )}

              {levels.length === 0 ? (
                <EmptyState>
                  No {timeframe} levels for {formatDateLabel(date)} yet.
                </EmptyState>
              ) : (
                <div className="space-y-2">
                  {levels.map((record) => (
                    <MesLevelRow
                      key={record.id}
                      record={record}
                      onSave={updateLevel}
                      onDelete={deleteLevel}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-500">
        <Target className="h-3.5 w-3.5" />
        Support is green, resistance is red. {KIND_LABELS.support} and {KIND_LABELS.resistance}{' '}
        levels are listed strongest price first, and the outcome you pick sets the tallies.
      </p>
    </div>
  );
};
