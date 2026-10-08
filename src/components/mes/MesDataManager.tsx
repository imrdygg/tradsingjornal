import React, { useState } from 'react';
import { Database, Download, FlaskConical, Info, Trash2, Upload } from 'lucide-react';
import type { JournalFile } from '../../lib/mes/types';
import { totals } from '../../lib/mes/analytics';
import { STORAGE_KEY } from '../../lib/mes/constants';
import { downloadText, formatShortDate, recordsToCsv } from '../../lib/mes/utils';
import { useMesJournal } from './mes-store';
import { MesPlaybookCard } from './MesPlaybookCard';
import { Badge, EmptyState, SectionCard, Stat } from './mes-ui';

/**
 * The Data tab: how the rating works, where the record lives, and the way out of a browser.
 *
 * Two things this screen insists on. First, the rating explainer, because a percentage that
 * hides its sample is the single most over-read figure a trader keeps. Second, a real
 * export, because localStorage is per-browser and dies with site data — the backup here is
 * the only copy that survives a cleared profile.
 *
 * It is also where the record meets the playbook's own marked lines, because moving lines
 * between the two records is a data operation like the rest of this screen: the trader decides
 * when it happens, and it is reported the same way a restore or a clear is.
 */
export const MesDataManager: React.FC = () => {
  const { records, clearAll, loadDemo, importFile } = useMesJournal();
  const [status, setStatus] = useState<string | null>(null);

  const summary = totals(records);

  const handleDownloadJson = () => {
    const file: JournalFile = {
      version: 1,
      app: 'mes-level-tracker',
      exportedAt: new Date().toISOString(),
      records,
    };
    downloadText(
      `mes-levels-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(file, null, 2),
      'application/json'
    );
    setStatus(`Backed up ${records.length} level${records.length === 1 ? '' : 's'}.`);
  };

  const handleDownloadCsv = () => {
    downloadText('mes-levels.csv', recordsToCsv(records), 'text/csv');
    setStatus(`Exported ${records.length} level${records.length === 1 ? '' : 's'} as CSV.`);
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (
      !window.confirm(
        'Restoring a backup REPLACES every level currently in the tracker. This cannot be undone. Continue?'
      )
    ) {
      return;
    }
    try {
      const count = await importFile(file);
      setStatus(`Restored ${count} level${count === 1 ? '' : 's'} from ${file.name}.`);
    } catch (error) {
      setStatus(
        `That file could not be read: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleLoadDemo = () => {
    if (
      !window.confirm(
        'Load demo data? This REPLACES every level currently in the tracker with a few weeks of sample sessions.'
      )
    ) {
      return;
    }
    loadDemo();
    setStatus('Demo data loaded: a few weeks of sample MES levels across all six charts.');
  };

  const handleClearAll = () => {
    if (!window.confirm('Clear all levels? This removes every session in the tracker. It cannot be undone.')) {
      return;
    }
    clearAll();
    setStatus('All levels cleared.');
  };

  return (
    <div className="space-y-4">
      <SectionCard title="How the rating works" icon={<Info className="h-4 w-4 text-sky-400" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
              Reliability
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              The share of the tests that were DECIDED where price respected the level:{' '}
              <span className="font-mono text-zinc-200">holds / (holds + breaks)</span>. A level
              nobody reached is left out entirely — it is never counted as a win. With nothing
              decided the figure is a dash, not a zero, because a level that was never tested has
              no opinion about whether it holds.
            </p>
          </div>
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
              Strength (the headline figure)
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Raw reliability on a one-test level reads 100% and looks like a brick wall. So every
              headline rating is shrunk toward 50% with a small prior:{' '}
              <span className="font-mono text-zinc-200">(holds + 2) / (holds + breaks + 4)</span>.
              A single hold therefore reads <span className="font-mono text-zinc-200">60</span>, not
              100 — the number has to earn its rating.
            </p>
          </div>
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
              Grade
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Applied to STRENGTH, never to raw reliability: 68 or above is an A, 58 a B, 48 a C,
              and below that a D. Nothing decisive grades as a dash.
            </p>
          </div>
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
              Confidence
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              A coloured dot on how much is behind the figure, counted in decisive tests (holds plus
              breaks): 15 or more is high, 5 or more is medium, and below that the read is thin.
              Five tests at 80% and twenty at 80% are not the same statement, and they no longer
              look the same.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Storage"
        subtitle="Where this record actually lives."
        icon={<Database className="h-4 w-4 text-emerald-400" />}
      >
        {summary.records === 0 ? (
          <EmptyState>
            Nothing tracked yet. Log your first level on the Daily Log, or load the demo data
            below to see the charts.
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Levels" value={summary.records} />
              <Stat label="Sessions" value={summary.sessions} />
              <Stat label="Holds" value={summary.holds} />
              <Stat label="Breaks" value={summary.breaks} />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-400">
              <span className="font-mono text-zinc-200">
                {summary.firstDate ? formatShortDate(summary.firstDate) : '—'}
              </span>{' '}
              to{' '}
              <span className="font-mono text-zinc-200">
                {summary.lastDate ? formatShortDate(summary.lastDate) : '—'}
              </span>{' '}
              · {summary.touches} total test{summary.touches === 1 ? '' : 's'}.
            </p>
          </>
        )}

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3">
          <span className="text-[11px] leading-relaxed text-amber-200/90">
            This record is kept in one browser&apos;s localStorage (
            <Badge className="border-amber-800/60 bg-amber-950/40 text-amber-200">
              {STORAGE_KEY}
            </Badge>
            ) and is also carried in the journal&apos;s own backup and cloud sync, so it follows the
            account rather than the laptop. localStorage on its own is not a backup: it is wiped
            when site data is cleared. Download a copy from here if it matters.
          </span>
        </div>
      </SectionCard>

      {/* The playbook's own marked lines, and the way across in each direction. */}
      <MesPlaybookCard />

      <SectionCard
        title="Backup and restore"
        subtitle="A JSON copy is the one thing that survives a cleared browser."
        icon={<Download className="h-4 w-4 text-sky-400" />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            id="mes-download-json"
            type="button"
            onClick={handleDownloadJson}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-white"
          >
            Download JSON
          </button>
          <button
            id="mes-download-csv"
            type="button"
            onClick={handleDownloadCsv}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
          >
            Download CSV
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800">
            <Upload className="h-3.5 w-3.5" />
            Restore from file
            <input
              id="mes-restore-input"
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleRestore}
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          Restoring REPLACES everything, so you are asked to confirm first. The CSV carries the
          timing columns in 24h so a spreadsheet sorts them correctly.
        </p>
        {status && (
          <p
            id="mes-data-status"
            className="mt-2 rounded-lg border border-zinc-700/60 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-300"
          >
            {status}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Danger zone"
        subtitle="Both of these replace or remove the whole record."
        icon={<Trash2 className="h-4 w-4 text-rose-400" />}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-52 flex-1 space-y-2">
            <button
              id="mes-load-demo"
              type="button"
              onClick={handleLoadDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Load demo data
            </button>
            <p className="text-[11px] leading-snug text-zinc-500">
              Replaces the record with a few weeks of sample sessions, so the charts and the
              reliability read have something to show.
            </p>
          </div>

          <div className="min-w-52 flex-1 space-y-2">
            <button
              id="mes-clear-all"
              type="button"
              onClick={handleClearAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/70 bg-rose-950/50 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear all levels
            </button>
            <p className="text-[11px] leading-snug text-zinc-500">
              Removes every session in the tracker. Backup first if you want it back — this cannot
              be undone.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
