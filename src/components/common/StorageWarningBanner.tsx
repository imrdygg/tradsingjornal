import React from 'react';
import { AlertTriangle, HardDrive, X } from 'lucide-react';
import type { StorageFailure } from '../../lib/storage';

interface StorageWarningBannerProps {
  failure: StorageFailure;
  /** Approximate size of the journal in localStorage, in bytes. */
  usageBytes: number;
  onDismiss: () => void;
}

/** Prints bytes the way a trader thinks about a file, not in raw digits. */
function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Where the failure message is built.
 *
 * The point of this banner is that a failed save is the one kind of error a
 * journal must never hide: the trader keeps working, believes everything is
 * recorded, and finds out later that the session is gone. So each kind says
 * plainly what was lost and what to do about it, rather than "an error
 * occurred".
 */
function describeFailure(failure: StorageFailure, usageBytes: number): { title: string; body: React.ReactNode } {
  if (failure.kind === 'quota') {
    return {
      title: 'This browser is full — your latest change was not saved',
      body: (
        <>
          Your journal is about{' '}
          <span className="font-mono">{formatMegabytes(usageBytes)}</span>, which has reached the
          storage limit this browser gives a site (usually around 5 MB). Trade screenshots are the
          bulk of it. Export a backup and keep it somewhere safe, then remove some screenshots from
          older trades — until there is room, new trades, plans and reviews in this browser will not
          persist.
        </>
      ),
    };
  }

  if (failure.kind === 'unavailable') {
    return {
      title: 'This browser is not letting the journal save',
      body: (
        <>
          Storage appears to be blocked — private browsing or disabled site data will do this. The
          app still works, but nothing you record will survive a reload until storage is available.
        </>
      ),
    };
  }

  if (failure.kind === 'corrupt') {
    return {
      title: 'Part of your saved journal could not be read',
      body: (
        <>
          Stored data for <span className="font-mono">{failure.key}</span> is unreadable, so the app
          has started that section from its defaults. Do not keep working over it: export a backup
          first, and restore from an earlier export or from the cloud copy if you have one.
        </>
      ),
    };
  }

  return {
    title: 'Your journal could not be saved to this browser',
    body: (
      <>
        The write to <span className="font-mono">{failure.key}</span> failed, so the most recent
        change was lost. Export a backup and reload before continuing.
      </>
    ),
  };
}

/**
 * Sticky warning shown on every tab while a journal write is failing.
 *
 * It is rendered above the tab content rather than inside a single view
 * because the failure is global: it affects every edit, on every screen.
 */
export const StorageWarningBanner: React.FC<StorageWarningBannerProps> = ({
  failure,
  usageBytes,
  onDismiss,
}) => {
  const { title, body } = describeFailure(failure, usageBytes);

  return (
    <div
      role="alert"
      className="mb-4 rounded-2xl border border-rose-800/70 bg-rose-950/40 p-3 sm:p-4"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold text-rose-100">{title}</p>
          <p className="text-[11px] leading-relaxed text-rose-200/80">{body}</p>
          <details className="pt-1">
            <summary className="cursor-pointer text-[11px] font-mono text-rose-300/80 hover:text-rose-200">
              Browser message
            </summary>
            <p className="mt-1 break-words font-mono text-[10px] text-rose-200/60">
              {failure.key}: {failure.detail}
            </p>
          </details>
        </div>
        <button
          type="button"
          id="dismiss-storage-warning"
          onClick={onDismiss}
          aria-label="Dismiss storage warning"
          className="rounded-lg p-1 text-rose-300/70 transition-colors hover:bg-rose-900/40 hover:text-rose-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/** Compact summary line for Settings, where there is no room for the full warning. */
export const StorageHealthRow: React.FC<{ usageBytes: number }> = ({ usageBytes }) => (
  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
    <HardDrive className="h-3.5 w-3.5" />
    <span>
      This browser holds <span className="font-mono">{formatMegabytes(usageBytes)}</span> of journal
      data (browsers usually allow about 5 MB).
    </span>
  </div>
);
