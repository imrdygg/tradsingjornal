import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  KeyRound,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { ChartPatternsView } from '../../components/playbook/ChartPatternsView';
import { readPatternFromHash } from '../../lib/playbook/pattern-hash';
import {
  buildPatternExport,
  mergePatternStudies,
  parsePatternImport,
  readPatternStudies,
  upsertPatternStudy,
  writePatternStudies,
} from '../../lib/playbook/pattern-store';
import type { PatternStudy } from '../../lib/playbook/pattern-study-types';
import { PLAYBOOK_LICENSE, type LicenseState } from '../../lib/license/playbook-license';
import { LicenseDialog, LicenseScreen } from '../../components/license/LicensePanel';

/**
 * The standalone product: the chart-pattern library, its study journal, and nothing else.
 *
 * It owns one storage slice (`ptj_pattern_studies_v1`), needs no Supabase project, no
 * Gemini key and no server, and carries its own license check. The journal's Playbook tab
 * renders the same `ChartPatternsView`, so the content and the guardrails cannot drift
 * between the product and the app it was extracted from.
 */

interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

export const PlaybookProductApp: React.FC = () => {
  const [license, setLicense] = useState<LicenseState>(() => PLAYBOOK_LICENSE.readState());
  const [studies, setStudies] = useState<PatternStudy[]>(() => readPatternStudies());
  const [focusPatternId, setFocusPatternId] = useState<string | null>(() =>
    readPatternFromHash()
  );
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The same deep link the journal uses: `#chart-patterns/<patternId>`.
  useEffect(() => {
    const sync = () => setFocusPatternId(readPatternFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const handleOpenPattern = useCallback((patternId: string | null) => {
    setFocusPatternId(patternId);
    const next = patternId ? `#chart-patterns/${patternId}` : '';
    try {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${next}`
      );
    } catch {
      // A blocked history write must not stop the pattern from opening.
    }
  }, []);

  const handleSaveStudy = (study: PatternStudy) => {
    const next = upsertPatternStudy(studies, study);
    if (!writePatternStudies(next)) {
      setNotice({
        tone: 'error',
        text: 'This browser refused the save. Check that storage is not full or blocked, then try again.',
      });
      return;
    }
    setStudies(next);
    setNotice(null);
  };

  const handleExport = () => {
    const blob = new Blob([buildPatternExport(studies)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `chart-pattern-playbook-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice({
      tone: 'ok',
      text: `Exported ${studies.length} studied pattern${studies.length === 1 ? '' : 's'}.`,
    });
  };

  const handleImportFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setNotice({ tone: 'error', text: 'That file is not JSON. Import the .json file the playbook exports.' });
      return;
    }

    const imported = parsePatternImport(parsed);
    if (!imported) {
      setNotice({
        tone: 'error',
        text: 'That file has no pattern studies in it. Use a playbook export or a journal backup.',
      });
      return;
    }

    const next = mergePatternStudies(studies, imported.studies);
    if (!writePatternStudies(next)) {
      setNotice({ tone: 'error', text: 'This browser refused the import because storage is full or blocked.' });
      return;
    }

    setStudies(next);
    setNotice({
      tone: 'ok',
      text: `Imported ${imported.studies.length} studied pattern${
        imported.studies.length === 1 ? '' : 's'
      }${imported.source === 'journal' ? ' from a journal backup' : ''}.`,
    });
  };

  if (license.status === 'unlicensed') {
    return <LicenseScreen license={PLAYBOOK_LICENSE} onActivated={setLicense} />;
  }

  const studiedCount = studies.length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-400">
              <BookOpen className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Chart Pattern Playbook</h1>
              <p className="truncate text-[11px] text-zinc-400">
                20 reference setups · {studiedCount} studied · offline
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              id="product-import-file"
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file again still fires a change.
                event.target.value = '';
                if (file) void handleImportFile(file);
              }}
            />
            <button
              id="product-import"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
            >
              <Upload className="h-3.5 w-3.5" /> Import
            </button>
            <button
              id="product-export"
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
        <ChartPatternsView
          studies={studies}
          onSaveStudy={handleSaveStudy}
          focusPatternId={focusPatternId}
          onOpenPattern={handleOpenPattern}
        />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-[11px] leading-relaxed text-zinc-500">
        Your studies stay in this browser. Export them from the header to move to another
        device, or import them into the full trading journal — the storage key is the same.
      </footer>

      <LicenseDialog
        license={PLAYBOOK_LICENSE}
        open={licenseOpen}
        onClose={() => setLicenseOpen(false)}
        onActivated={setLicense}
      />
    </div>
  );
};
