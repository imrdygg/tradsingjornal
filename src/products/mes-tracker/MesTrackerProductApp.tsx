import React, { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, KeyRound, ShieldCheck, Target } from 'lucide-react';
import { MesView } from '../../components/mes/MesView';
import { LicenseDialog, LicenseScreen } from '../../components/license/LicensePanel';
import { MES_LICENSE } from '../../lib/license/mes-license';
import type { LicenseState } from '../../lib/license/offline-license';
import type { LevelRecord } from '../../lib/mes/types';
import { buildMesExport, readMesLevels, writeMesLevels } from '../../lib/mes/storage';
import { downloadText } from '../../lib/mes/utils';

/**
 * The standalone MES Indicator Level Tracker.
 *
 * One record (`ptj_mes_levels_v1`), six charts, and no server: the six screens are the same
 * `MesView` the journal mounts, with `standalone` on so the copy does not promise cloud sync
 * and the cross-record playbook card is left out.
 */

interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

export const MesTrackerProductApp: React.FC = () => {
  const [license, setLicense] = useState<LicenseState>(() => MES_LICENSE.readState());
  const [records, setRecords] = useState<LevelRecord[]>(() => readMesLevels());
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const persist = useCallback((next: LevelRecord[]) => {
    if (!writeMesLevels(next)) {
      setNotice({
        tone: 'error',
        text: 'This browser refused the save. Check that storage is not full or blocked, then try again.',
      });
      return;
    }
    setRecords(next);
    setNotice(null);
  }, []);

  const handleExport = () => {
    downloadText(
      `mes-levels-${new Date().toISOString().slice(0, 10)}.json`,
      buildMesExport(records),
      'application/json'
    );
    setNotice({
      tone: 'ok',
      text: `Backed up ${records.length} level${records.length === 1 ? '' : 's'}.`,
    });
  };

  if (license.status === 'unlicensed') {
    return <LicenseScreen license={MES_LICENSE} onActivated={setLicense} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-400">
              <Target className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">MES Indicator Level Tracker</h1>
              <p id="mes-product-count" className="truncate text-[11px] text-zinc-400">
                $MES · 1m / 3m / 5m / 15m / 30m / 1h · {records.length} level
                {records.length === 1 ? '' : 's'} logged · offline
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              id="mes-export"
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <button
              id="product-license"
              type="button"
              onClick={() => setLicenseOpen(true)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                license.status === 'licensed'
                  ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300 hover:border-emerald-600'
                  : 'border-amber-800/70 bg-amber-950/30 text-amber-300 hover:border-amber-600'
              }`}
            >
              {license.status === 'licensed' ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" /> Licensed
                </>
              ) : (
                <>
                  <KeyRound className="h-3.5 w-3.5" /> Trial · {license.daysLeft}d
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div
          id="product-notice"
          role="status"
          className={`mx-auto mt-3 flex max-w-6xl items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
            notice.tone === 'ok'
              ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-200'
              : 'border-rose-800/70 bg-rose-950/30 text-rose-200'
          }`}
        >
          {notice.tone === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="leading-relaxed">{notice.text}</span>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6">
        <MesView records={records} persist={persist} standalone />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-[11px] leading-relaxed text-zinc-500">
        Your record stays in this browser. Export a backup here or from the Data tab; restore a
        backup from the Data tab. The storage key is the same one the full trading journal uses,
        so a backup can move between the two.
      </footer>

      <LicenseDialog
        license={MES_LICENSE}
        open={licenseOpen}
        onClose={() => setLicenseOpen(false)}
        onActivated={setLicense}
      />
    </div>
  );
};
