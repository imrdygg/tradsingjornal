import React from 'react';
import { Check, AlertTriangle, Loader2, HardDrive } from 'lucide-react';

export type SyncStatus = 'local' | 'loading' | 'saving' | 'saved' | 'error' | 'conflict';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  /** Timestamp of the last confirmed cloud save. */
  lastSyncedAt?: Date | null;
  /** Re-attempts the save; only used when status is 'error'. */
  onRetry?: () => void;
}

function formatTime(date: Date): string {
  try {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return date.toISOString();
  }
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  status,
  lastSyncedAt,
  onRetry,
}) => {
  const syncedTime = lastSyncedAt ? formatTime(lastSyncedAt) : null;

  // Sized to sit alongside the other compact status chips in the header strip.
  const baseClass =
    'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] whitespace-nowrap';

  if (status === 'local') {
    return (
      <div
        className={`${baseClass} border-zinc-800 bg-zinc-900 text-zinc-400`}
        title="Cloud sync is off because Supabase is not configured. Your journal is saved in this browser only."
      >
        <HardDrive className="h-3 w-3" />
        <span>Local only</span>
      </div>
    );
  }

  // A conflict is not a failure: both copies exist and the trader has to pick
  // one. The chip only flags it; the banner holds the two choices.
  if (status === 'conflict') {
    return (
      <div
        className={`${baseClass} border-amber-800/60 bg-amber-950/40 text-amber-300`}
        role="status"
        aria-live="polite"
        title="Another device changed this journal. Choose which copy to keep in the banner above."
      >
        <AlertTriangle className="h-3 w-3" />
        <span>Review sync</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        id="sync-status-badge"
        onClick={onRetry}
        className={`${baseClass} border-rose-800/60 bg-rose-950/40 text-rose-300 transition-colors hover:bg-rose-900/40`}
        title="Cloud save failed. Click to retry. Your journal is still saved in this browser."
        aria-label="Cloud sync failed. Retry."
      >
        <AlertTriangle className="h-3 w-3" />
        <span>Retry sync</span>
      </button>
    );
  }

  if (status === 'saved') {
    return (
      <div
        className={`${baseClass} border-emerald-800/50 bg-emerald-950/30 text-emerald-300`}
        role="status"
        aria-live="polite"
        title={syncedTime ? `All changes saved to the cloud at ${syncedTime}.` : 'All changes saved to the cloud.'}
      >
        <Check className="h-3 w-3" />
        <span>Saved{syncedTime ? ` ${syncedTime}` : ''}</span>
      </div>
    );
  }

  // 'loading' (first restore) and 'saving' (a write is in flight)
  return (
    <div
      className={`${baseClass} border-zinc-800 bg-zinc-900 text-zinc-300`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{status === 'loading' ? 'Loading…' : 'Saving…'}</span>
    </div>
  );
};
