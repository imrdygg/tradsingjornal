import React from 'react';
import { Check, AlertTriangle, Loader2, HardDrive } from 'lucide-react';

export type SyncStatus = 'local' | 'loading' | 'saving' | 'saved' | 'error';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  /** Timestamp of the last confirmed cloud save. */
  lastSyncedAt?: Date | null;
  /** Re-attempts the save; only shown when status is 'error'. */
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

  const baseClass =
    'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono border whitespace-nowrap';

  if (status === 'local') {
    return (
      <div
        className={`hidden sm:flex ${baseClass} bg-zinc-900 border-zinc-800 text-zinc-400`}
        title="Cloud sync is off because Supabase is not configured. Your journal is saved in this browser only."
      >
        <HardDrive className="w-3.5 h-3.5" />
        <span>Local only</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        id="sync-status-badge"
        onClick={onRetry}
        className={`${baseClass} bg-rose-950/40 border-rose-800/60 text-rose-300 hover:bg-rose-900/40 transition-colors`}
        title="Cloud save failed. Click to retry. Your journal is still saved in this browser."
        aria-label="Cloud sync failed. Retry."
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Retry sync</span>
      </button>
    );
  }

  if (status === 'saved') {
    return (
      <div
        className={`hidden sm:flex ${baseClass} bg-emerald-950/30 border-emerald-800/50 text-emerald-300`}
        title={syncedTime ? `All changes saved to the cloud at ${syncedTime}.` : 'All changes saved to the cloud.'}
        role="status"
        aria-live="polite"
      >
        <Check className="w-3.5 h-3.5" />
        <span>Saved{syncedTime ? ` ${syncedTime}` : ''}</span>
      </div>
    );
  }

  // 'loading' (first restore) and 'saving' (a write is in flight)
  return (
    <div
      className={`hidden sm:flex ${baseClass} bg-zinc-900 border-zinc-800 text-zinc-300`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span>{status === 'loading' ? 'Loading…' : 'Saving…'}</span>
    </div>
  );
};
