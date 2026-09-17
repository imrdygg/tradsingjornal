import React, { useState } from 'react';
import {
  Settings,
  Download,
  Upload,
  Shield,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  LogOut,
  Cloud,
  Loader2,
} from 'lucide-react';
import { UserProfile, Instrument } from '../../types';
import { SyncStatusBadge, SyncStatus } from '../layout/SyncStatusBadge';

interface SettingsViewProps {
  profile: UserProfile;
  instruments: Instrument[];
  onUpdateProfile: (profile: UserProfile) => void;
  onExportData: () => void;
  onImportData: (jsonData: string) => void;
  onTradovateImport?: (csvContent: string) => void;
  /** Signed-in email. Absent when the app is running local-only. */
  userEmail?: string | null;
  onSignOut?: () => void;
  signingOut?: boolean;
  syncStatus?: SyncStatus;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  instruments,
  onUpdateProfile,
  onExportData,
  onImportData,
  onTradovateImport,
  userEmail,
  onSignOut,
  signingOut = false,
  syncStatus,
}) => {
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const [lightboxState, setLightboxState] = useState<{
    images: string[];
    initialIndex: number;
    title: string;
    subtitle?: string;
  } | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        onImportData(text);
        setImportStatus('Data successfully restored!');
        setTimeout(() => setImportStatus(null), 3000);
      } catch (err) {
        setImportStatus('Failed to import JSON data.');
      }
    };
    reader.readAsText(file);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onTradovateImport) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        onTradovateImport(text);
        setImportStatus('Tradovate CSV parsed and staged!');
        setTimeout(() => setImportStatus(null), 3000);
      } catch {
        setImportStatus('Failed to parse Tradovate CSV file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-zinc-400" />
          Settings & Configuration
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Tune your default risk guardrails, trading setups catalog, instruments, and data backups.
        </p>
      </div>

      {/* 0. Account - the discoverable home for signing in and out */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Cloud className="w-4 h-4 text-zinc-400" />
          Account & Cloud Sync
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">
              {onSignOut ? 'Signed in as' : 'Local journal'}
            </p>
            <p
              className="text-sm font-medium text-zinc-200 truncate max-w-full"
              title={userEmail ?? undefined}
            >
              {userEmail ?? 'Not signed in'}
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {onSignOut
                ? 'Your journal syncs securely across every device you sign in on.'
                : 'Cloud sync is off. Your journal is saved in this browser only.'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {syncStatus && <SyncStatusBadge status={syncStatus} />}
            {onSignOut && (
              <button
                id="settings-sign-out-btn"
                type="button"
                onClick={onSignOut}
                disabled={signingOut}
                className="flex items-center gap-2 rounded-xl border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/40 disabled:opacity-50 transition-colors"
              >
                {signingOut ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                {signingOut ? 'Saving…' : 'Sign out'}
              </button>
            )}
          </div>
        </div>
      </div>

      {importStatus && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-800/80 bg-emerald-950/40 p-3 text-xs text-emerald-200 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{importStatus}</span>
        </div>
      )}

      {/* 1. Default Risk Guardrails */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Shield className="w-4 h-4 text-zinc-400" />
          Default Daily Risk Guardrails
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Default Daily Max Loss ($)
            </label>
            <input
              type="number"
              step="10"
              value={profile.defaultDailyLossLimit}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  defaultDailyLossLimit: parseFloat(e.target.value) || 100,
                })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Default Instrument
            </label>
            <select
              value={profile.defaultInstrument}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  defaultInstrument: e.target.value,
                })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            >
              {instruments.map((inst) => (
                <option key={inst.id} value={inst.symbol}>
                  {inst.symbol} — {inst.name} (${inst.pointValue}/pt)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Timezone
            </label>
            <input
              type="text"
              value={profile.timezone}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  timezone: e.target.value || 'America/New_York',
                })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 2. Supported Futures Instruments */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          Supported Futures Contracts Specifications
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
          {instruments.map((inst) => (
            <div
              key={inst.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1"
            >
              <div className="flex items-center justify-between text-zinc-100 font-bold">
                <span>{inst.symbol} — {inst.name}</span>
                <span className="text-emerald-400">${inst.pointValue}/pt</span>
              </div>
              <div className="flex items-center justify-between text-zinc-500 text-[11px]">
                <span>Tick Size: {inst.tickSize} pts</span>
                <span>Tick Value: ${inst.tickValue}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Data Backup, Export & Tradovate CSV Staging */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Download className="w-4 h-4 text-zinc-400" />
          Data Backup & Tradovate CSV Import
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Export JSON */}
          <button
            onClick={onExportData}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-medium text-zinc-200 hover:border-zinc-700 transition-colors"
          >
            <Download className="w-4 h-4 text-zinc-400" />
            Export Journal JSON
          </button>

          {/* Import JSON */}
          <label className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-medium text-zinc-200 hover:border-zinc-700 cursor-pointer transition-colors">
            <Upload className="w-4 h-4 text-zinc-400" />
            <span>Restore Backup JSON</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {/* Tradovate CSV Import */}
          <label className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-medium text-zinc-200 hover:border-zinc-700 cursor-pointer transition-colors">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Import Tradovate CSV</span>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="hidden"
            />
          </label>
        </div>
        <p className="text-[11px] text-zinc-400">
          Tradovate CSV import matches fills into trades, checks initial risk, and lets you review execution without silently guessing uncertain data.
        </p>
      </div>

      {/* Lightbox for setup reference charts is now in the Playbook tab */}
    </div>
  );
};
