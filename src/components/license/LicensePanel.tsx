import React, { useState } from 'react';
import { AlertTriangle, KeyRound, ShieldCheck } from 'lucide-react';
import { ModalOverlay } from '../common/ModalOverlay';
import type { LicenseState, OfflineLicense } from '../../lib/license/offline-license';

/**
 * The activation UI, in two shapes: a full screen on first run and a dialog from the
 * header once a product is open.
 *
 * The copy is deliberately plain about what the key is: an offline receipt check, not a
 * lock on the buyer's own data. Overclaiming here would be worse than the piracy it
 * pretends to stop.
 */

interface LicenseFormProps {
  license: OfflineLicense;
  onActivated: (state: LicenseState) => void;
  /** Hide the trial action inside the dialog once the product is already open. */
  showTrial: boolean;
}

const LicenseForm: React.FC<LicenseFormProps> = ({ license, onActivated, showTrial }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = license.readState();
  const trialEverStarted = license.readTrialStart() !== null;
  const trialDays = license.config.trialDays;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      onActivated(license.saveKey(value));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That key could not be used.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {state.status === 'licensed' && state.key && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-800/70 bg-emerald-950/30 p-2.5 text-[11px] text-emerald-200">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Activated on this device
            {state.key ? ` with ${license.maskKey(state.key)}` : ''}. Paste a different key
            below to replace it.
          </span>
        </div>
      )}

      {state.status === 'trial' && (
        <p className="text-[11px] text-amber-300">
          Trial active — {state.daysLeft} day{state.daysLeft === 1 ? '' : 's'} left. Activate
          any time; your records stay where they are.
        </p>
      )}

      {state.status === 'unlicensed' && trialEverStarted && (
        <p className="text-[11px] text-amber-300">
          The {trialDays}-day trial on this device has ended. Paste your license key to keep
          using {license.config.productName}.
        </p>
      )}

      <label className="block space-y-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          License key
        </span>
        <input
          id="license-key-input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="WTKP4-66NL5-HMKQW-GFSCZ"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
      </label>

      {error && (
        <p
          id="license-error"
          role="alert"
          className="flex items-start gap-1.5 text-[11px] text-rose-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <button
        id="license-activate"
        type="submit"
        className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400"
      >
        Activate this device
      </button>

      {showTrial && !trialEverStarted && (
        <button
          id="license-start-trial"
          type="button"
          onClick={() => onActivated(license.startTrial())}
          className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        >
          Try it for {trialDays} days first
        </button>
      )}
    </form>
  );
};

export const LicenseScreen: React.FC<{
  license: OfflineLicense;
  onActivated: (state: LicenseState) => void;
}> = ({ license, onActivated }) => (
  <div
    id="license-screen"
    className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100"
  >
    <div className="w-full max-w-md space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl">
      <div className="space-y-2">
        <span className="inline-flex rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-emerald-400">
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="text-lg font-semibold">Activate {license.config.productName}</h1>
        <p className="text-xs leading-relaxed text-zinc-400">
          Paste the license key from your Payhip receipt. The key is checked and stored in
          this browser only — there is no account and no server call, so this keeps working
          offline.
        </p>
      </div>

      <LicenseForm license={license} onActivated={onActivated} showTrial />

      <p className="border-t border-zinc-800 pt-3 text-[10px] leading-relaxed text-zinc-500">
        Your records never leave this device. Use the Data tab to export a backup.
      </p>
    </div>
  </div>
);

interface LicenseDialogProps {
  license: OfflineLicense;
  open: boolean;
  onClose: () => void;
  onActivated: (state: LicenseState) => void;
}

export const LicenseDialog: React.FC<LicenseDialogProps> = ({
  license,
  open,
  onClose,
  onActivated,
}) => {
  if (!open) return null;

  return (
    <ModalOverlay onBackdropClick={onClose} onRequestClose={onClose} label="License">
      <div
        id="license-dialog"
        className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">License</h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Checked offline and stored on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            Close
          </button>
        </div>

        <LicenseForm
          license={license}
          onActivated={(state) => {
            onActivated(state);
            onClose();
          }}
          showTrial={false}
        />
      </div>
    </ModalOverlay>
  );
};
