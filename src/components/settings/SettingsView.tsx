import React, { useState, useMemo } from 'react';
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
  AlertTriangle,
  X,
  RotateCcw,
  Trash2,
  ShieldAlert,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';
import { UserProfile, Instrument, Setup } from '../../types';
import { riskTierAmounts } from '../../lib/trading/risk-tiers';
import { SyncStatusBadge, SyncStatus } from '../layout/SyncStatusBadge';
import { ModalOverlay } from '../common/ModalOverlay';
import { StorageHealthRow } from '../common/StorageWarningBanner';
import { measureJournalBytes } from '../../lib/storage';
import type { CsvImportSummary } from '../../lib/trading/tradovate-import';

/**
 * The catalog with one setup moved a place, as the id order the storage layer expects.
 *
 * Written out rather than a sort so the move is exactly one swap: the trader nudged a row,
 * and nothing else changes order. Out-of-range moves return the list as it is.
 */
function move(setups: Setup[], index: number, delta: number): string[] {
  const target = index + delta;
  const ids = setups.map((setup) => setup.id);
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;

  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

/** Result banner shown after an import, so failures are never reported as success. */
interface ImportNotice {
  tone: 'ok' | 'warn' | 'error';
  title: string;
  details: string[];
}

interface SettingsViewProps {
  profile: UserProfile;
  instruments: Instrument[];
  onUpdateProfile: (profile: UserProfile) => void;
  onExportData: () => void;
  onImportData: (jsonData: string) => void;
  /** Returns a summary of what was read so problems can be shown inline. */
  onTradovateImport?: (csvContent: string) => CsvImportSummary;
  /** How many trades still carry a placeholder stop from an import. */
  assumedRiskCount?: number;
  /** Opens the bulk risk fix-up dialog. */
  onOpenRiskFixup?: () => void;
  /** The playbook catalog, in the order it is shown and offered when recording a trade. */
  setups?: Setup[];
  /**
   * Renames a setup, keeping its place. Returns null for an empty or duplicated name — the
   * row shows its own warning, and this is the guard behind it.
   */
  onRenameSetup?: (id: string, name: string) => Setup[] | null;
  /** Applies a new order, given as the full list of setup ids. */
  onReorderSetups?: (orderedIds: string[]) => void;
  /** Moves the journal entries that refer to a setup onto its new name. */
  onRelabelSetup?: (oldName: string, newName: string) => void;
  /**
   * What the journal already records under each setup name, keyed by its lowercase name.
   * Counted before a rename, so the offer to bring those entries along can be honest.
   */
  setupUsage?: Record<string, { trades: number; days: number }>;
  /** Wipes trades, plans and reviews (keeping settings) and starts fresh. */
  onResetJournal?: () => Promise<void> | void;
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
  assumedRiskCount = 0,
  onOpenRiskFixup,
  setups = [],
  onRenameSetup,
  onReorderSetups,
  onRelabelSetup,
  setupUsage,
  onResetJournal,
  userEmail,
  onSignOut,
  signingOut = false,
  syncStatus,
}) => {
  /**
   * The name as it is being typed, so a half-finished name is never saved.
   *
   * A rename is committed on blur or Enter rather than on every keystroke: saving per
   * character would leave the journal answering to "Engulfin" in between, and the stored
   * name is what trades are logged against.
   */
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  /**
   * The risk ladder being typed into, before a slot is saved.
   *
   * A number input that writes on every keystroke would rewrite the ladder to 2 while the
   * trader types 250, so the value is held here and committed on blur or Enter — the same
   * reason a setup rename is committed that way.
   */
  const [tierDrafts, setTierDrafts] = useState<Record<number, string>>({});
  const tierAmounts = useMemo(() => riskTierAmounts(profile), [profile]);

  const commitTier = (index: number, raw: string) => {
    const parsed = parseFloat(raw);
    const next = [...tierAmounts];
    // A blank or nonsensical slot keeps what was there rather than becoming $0 risk.
    next[index] =
      Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : tierAmounts[index];
    onUpdateProfile({ ...profile, riskTierAmounts: next });
    setTierDrafts((prev) => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
  };
  /**
   * A rename that left journal entries behind.
   *
   * Held here rather than in the parent because the offer belongs to one row and only
   * lives until the trader answers it.
   */
  const [relabelOffer, setRelabelOffer] = useState<{
    setupId: string;
    oldName: string;
    newName: string;
    trades: number;
    days: number;
  } | null>(null);

  const usage = useMemo(() => setupUsage ?? {}, [setupUsage]);
  const tradesLoggedUnder = (name: string) => usage[name.trim().toLowerCase()]?.trades ?? 0;
  const daysPlannedWith = (name: string) => usage[name.trim().toLowerCase()]?.days ?? 0;

  /** Why a typed name cannot be saved, or null when it can. */
  const renameProblem = (setup: Setup, draft: string): string | null => {
    const trimmed = draft.trim();
    if (draft !== setup.name && !trimmed) return 'A setup needs a name.';
    if (!trimmed || trimmed === setup.name) return null;
    const taken = setups.some(
      (other) => other.id !== setup.id && other.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    return taken ? `Another setup is already called “${trimmed}”.` : null;
  };

  const commitRename = (setup: Setup, draft: string) => {
    const trimmed = draft.trim();
    setDraftNames((prev) => ({ ...prev, [setup.id]: trimmed || setup.name }));
    if (!onRenameSetup || !trimmed || trimmed === setup.name) return;
    if (renameProblem(setup, draft)) return;

    const result = onRenameSetup(setup.id, trimmed);
    if (!result) return;

    // The old name is what the journal recorded, so the offer is measured against it.
    const trades = tradesLoggedUnder(setup.name);
    const days = daysPlannedWith(setup.name);
    setRelabelOffer(
      trades || days
        ? { setupId: setup.id, oldName: setup.name, newName: trimmed, trades, days }
        : null
    );
  };
  // Recomputed on each visit rather than held in state: reading the keys is
  // cheap, and nothing else in this tab changes what they weigh.
  const storageBytes = useMemo(() => measureJournalBytes(), []);

  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

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
        setImportNotice({
          tone: 'ok',
          title: 'Backup restored. Your journal has been replaced with the file contents.',
          details: [],
        });
      } catch (err) {
        setImportNotice({
          tone: 'error',
          title: 'Failed to import that JSON backup.',
          details: [],
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so choosing the same file again re-triggers onChange.
    e.target.value = '';
    if (!file || !onTradovateImport) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const summary = onTradovateImport(text);
        const details = [...summary.errors, ...summary.warnings];

        if (summary.imported === 0) {
          setImportNotice({
            tone: 'error',
            title: 'No trades were imported from that CSV.',
            details,
          });
        } else {
          setImportNotice({
            tone: summary.errors.length > 0 ? 'warn' : 'ok',
            title: `Imported ${summary.imported} trade${summary.imported === 1 ? '' : 's'}.`,

            details,
          });
        }
      } catch {
        setImportNotice({
          tone: 'error',
          title: 'Failed to read that CSV file.',
          details: [],
        });
      }
    };
    reader.readAsText(file);
  };

  const handleReset = async () => {
    if (!onResetJournal) return;
    setIsResetting(true);
    try {
      await onResetJournal();
      setImportNotice({
        tone: 'ok',
        title: 'Journal reset. Trades, plans and reviews are gone — you are starting fresh.',
        details: ['Your profile, instruments and playbook set-ups were kept.'],
      });
    } catch {
      setImportNotice({
        tone: 'error',
        title: 'Reset failed. Nothing was deleted.',
        details: [],
      });
    } finally {
      setIsResetting(false);
      setIsResetOpen(false);
      setResetConfirmText('');
    }
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
            {/* The storage limit is worth showing before it is hit, and this is
                where the "export a backup" advice actually applies. Measured
                once per visit: the tab remounts every time it is opened. */}
            {!onSignOut && <div className="mt-1.5"><StorageHealthRow usageBytes={storageBytes} /></div>}
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

      {importNotice && (
        <div
          id="import-notice"
          className={`rounded-xl border p-3 text-xs space-y-1.5 ${
            importNotice.tone === 'ok'
              ? 'border-emerald-800/80 bg-emerald-950/40 text-emerald-200'
              : importNotice.tone === 'warn'
              ? 'border-amber-800/80 bg-amber-950/40 text-amber-200'
              : 'border-rose-800/80 bg-rose-950/40 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2 font-medium">
            {importNotice.tone === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{importNotice.title}</span>
            <button
              type="button"
              onClick={() => setImportNotice(null)}
              className="ml-auto shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {importNotice.details.length > 0 && (
            <ul className="list-disc list-inside space-y-1 pl-5 leading-relaxed opacity-90">
              {importNotice.details.map((detail, idx) => (
                <li key={idx}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 1. Default Risk Guardrails */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Shield className="w-4 h-4 text-zinc-400" />
          Default Daily Risk Guardrails
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
              Max Account Drawdown ($)
            </label>
            <input
              id="settings-max-drawdown"
              type="number"
              min="0"
              step="100"
              value={profile.maxDrawdown ?? ''}
              placeholder="not set"
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                // Live-editable and deliberately not defensive about the size: the number
                // is the trader's own funding rule and it changes as they grow the account.
                onUpdateProfile({
                  ...profile,
                  maxDrawdown: Number.isFinite(next) && next > 0 ? next : 0,
                });
              }}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed">
              The account-level floor, measured from your equity high-water mark. Analytics
              reads today's risk against it and the coach is told what is left.
            </p>
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

        {/* The numbered risk ladder every trade is recorded against. */}
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-zinc-500" />
              Trade Ladder — risk per trade #
            </h3>
            <p className="text-[10px] text-zinc-500">
              Pick a slot when you record a trade, or enter a custom risk if none fits.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {tierAmounts.map((amount, index) => {
              const draft = tierDrafts[index] ?? String(amount);
              return (
                <div key={index}>
                  <label
                    htmlFor={`settings-risk-tier-${index}`}
                    className="text-xs font-medium text-zinc-400 block mb-1"
                  >
                    Trade #{index + 1} risk ($)
                    {index === 0 && (
                      <span className="ml-1 text-[10px] font-mono text-zinc-500">default</span>
                    )}
                  </label>
                  <input
                    id={`settings-risk-tier-${index}`}
                    type="number"
                    min="1"
                    step="5"
                    value={draft}
                    onChange={(e) =>
                      setTierDrafts((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    onBlur={(e) => commitTier(index, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. Playbook setups — rename & order */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-zinc-400" />
              Playbook Setups — Rename &amp; Order
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500 leading-relaxed max-w-xl">
              This order is the order of the Playbook and of the setup dropdown when you
              record a trade. Renaming keeps the built-in study guide and example charts,
              and the journal keeps saying what each past trade was logged as until you
              choose to bring those entries along.
            </p>
          </div>
          {onReorderSetups && setups.length > 1 && (
            <span className="text-[10px] font-mono text-zinc-500">{setups.length} setups</span>
          )}
        </div>

        {setups.length === 0 ? (
          <p className="text-xs text-zinc-400">
            No setups yet. Add them from the Playbook tab — or restore a backup that has them.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/70 rounded-xl border border-zinc-800 bg-zinc-950">
            {setups.map((setup, index) => {
              const draft = draftNames[setup.id] ?? setup.name;
              const problem = renameProblem(setup, draft);
              const offer = relabelOffer?.setupId === setup.id ? relabelOffer : null;

              return (
                <li key={setup.id} className="px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    {/* Order controls. Disabled at the ends rather than hidden, so the row
                        height never changes as a setup moves. */}
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={!onReorderSetups || index === 0}
                        onClick={() => onReorderSetups?.(move(setups, index, -1))}
                        title="Move up"
                        aria-label={`Move ${setup.name} up`}
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!onReorderSetups || index === setups.length - 1}
                        onClick={() => onReorderSetups?.(move(setups, index, 1))}
                        title="Move down"
                        aria-label={`Move ${setup.name} down`}
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={draft}
                      aria-label={`Rename ${setup.name}`}
                      data-testid={`setup-name-${setup.id}`}
                      onChange={(e) =>
                        setDraftNames((prev) => ({ ...prev, [setup.id]: e.target.value }))
                      }
                      onBlur={() => commitRename(setup, draft)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') {
                          setDraftNames((prev) => ({ ...prev, [setup.id]: setup.name }));
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className={`w-full min-w-0 rounded-lg border bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none ${
                        problem
                          ? 'border-rose-800 focus:border-rose-700'
                          : 'border-zinc-800 focus:border-zinc-600'
                      }`}
                    />

                    {!setup.active && (
                      <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono uppercase text-zinc-400">
                        off
                      </span>
                    )}

                    {setup.builtinName && setup.builtinName !== setup.name && (
                      <span
                        className="shrink-0 rounded border border-emerald-900/70 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300"
                        title={`Study guide and example charts for ${setup.builtinName} follow this setup`}
                      >
                        guide: {setup.builtinName}
                      </span>
                    )}

                    <span className="shrink-0 text-[10px] font-mono text-zinc-500">
                      {tradesLoggedUnder(setup.name)} trades
                    </span>
                  </div>

                  {problem && (
                    <p className="mt-1 pl-7 text-[10px] text-rose-300" role="alert">
                      {problem}
                    </p>
                  )}

                  {/* Offered only after a rename, and only when it would change something:
                      rewriting what the journal recorded is the trader's call, not a
                      side effect of tidying a name. */}
                  {offer && (
                    <div className="mt-1 ml-7 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                      <span>
                        {offer.trades} logged trade{offer.trades === 1 ? '' : 's'}
                        {offer.days > 0
                          ? ` and ${offer.days} planned day${offer.days === 1 ? '' : 's'}`
                          : ''}{' '}
                        still say “{offer.oldName}”.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onRelabelSetup?.(offer.oldName, offer.newName);
                          setRelabelOffer(null);
                        }}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-medium text-zinc-200 hover:border-zinc-600"
                      >
                        Update them to “{offer.newName}”
                      </button>
                      <button
                        type="button"
                        onClick={() => setRelabelOffer(null)}
                        className="text-zinc-500 hover:text-zinc-300"
                      >
                        Leave history as it was
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Deleting a setup, toggling one off, and attaching your own charts all live in the
          Playbook tab, on the setup's own card.
        </p>
      </div>

      {/* 3. Supported Futures Instruments */}
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

      {/* 4. Data Backup, Export & Tradovate CSV Staging */}
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
          CSV import reads your broker's fill price (not the order price), matches partial fills and
          scale-ins into one position, and prices each trade with its own instrument. Anything it
          has to assume is listed in the result above.
        </p>

        {/* A CSV has no stop, so imported risk is invented until the trader replaces it. */}
        {assumedRiskCount > 0 && onOpenRiskFixup && (
          <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 sm:p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p id="assumed-risk-summary" className="text-xs font-semibold text-amber-100">
                    {assumedRiskCount} trade{assumedRiskCount === 1 ? '' : 's'} still use an assumed
                    stop
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/80">
                    Their risk, R-multiple and expectancy are placeholders until you set the real
                    stop. Applying a stop here also tells your coach this risk is trustworthy.
                  </p>
                </div>
              </div>
              <button
                id="open-risk-fixup"
                onClick={onOpenRiskFixup}
                className="shrink-0 rounded-xl bg-amber-500/90 px-3.5 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-amber-400 active:scale-[0.98]"
              >
                Fix imported risk
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. Start Fresh — journal reset */}
      {onResetJournal && (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/20 p-4 sm:p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-rose-300 font-mono flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Start Fresh
          </h2>

          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Deletes every trade, daily plan and review
            {onSignOut ? ', on this device and in your cloud journal,' : ''} and gives you a clean
            journal. Your profile, instruments and playbook set-ups are kept, and nothing can be
            undone — export a backup first if you might want this data later.
          </p>

          <button
            type="button"
            id="reset-journal-button"
            onClick={() => {
              setResetConfirmText('');
              setIsResetOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl border border-rose-700/70 bg-rose-950/50 px-3.5 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset journal &amp; start fresh
          </button>
        </div>
      )}

      {/* Reset confirmation — typed phrase so it cannot happen by accident */}
      {isResetOpen && (
        <ModalOverlay
          onRequestClose={() => setIsResetOpen(false)}
          label="Reset your journal"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-rose-900/70 bg-zinc-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400">
                  <Trash2 className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-100">Reset your journal?</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsResetOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-zinc-400">
              <p className="leading-relaxed">This permanently deletes:</p>
              <ul className="list-disc list-inside space-y-1 text-zinc-300">
                <li>Every recorded trade, including charts and videos</li>
                <li>Every daily plan and its change history</li>
                <li>Every daily review and discipline score</li>
              </ul>
              <p className="leading-relaxed text-zinc-500">
                Kept: your profile, instruments and playbook set-ups.
              </p>

              <div className="pt-1">
                <label
                  htmlFor="reset-confirm-input"
                  className="block text-xs font-medium text-zinc-300 mb-1"
                >
                  Type <span className="font-mono text-rose-300">RESET</span> to confirm
                </label>
                <input
                  id="reset-confirm-input"
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="RESET"
                  autoComplete="off"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-rose-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4">
              <button
                type="button"
                onClick={() => setIsResetOpen(false)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                id="reset-confirm-button"
                disabled={resetConfirmText.trim().toUpperCase() !== 'RESET' || isResetting}
                onClick={handleReset}
                className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isResetting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isResetting ? 'Resetting…' : 'Delete everything & reset'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Lightbox for setup reference charts is now in the Playbook tab */}
    </div>
  );
};
