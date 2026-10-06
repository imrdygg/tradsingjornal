import { CloudOff, Loader2 } from 'lucide-react';

/**
 * Shown when the build has no Supabase credentials. Without this the app just
 * quietly runs local-only and there is no way to discover why there is no
 * sign-in, or what to do about it.
 *
 * Extracted from App so the shell does not carry this notice's markup.
 */
export function LocalOnlyNotice() {
  return (
    <div className="mb-4 rounded-2xl border border-amber-800/60 bg-amber-950/30 p-3 sm:p-4">
      <div className="flex items-start gap-2.5">
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-amber-200">
            Cloud sync is off — this journal is saved in this browser only
          </p>
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            Signing in and syncing across devices are disabled because this build
            has no Supabase credentials. Add{' '}
            <code className="rounded bg-amber-900/50 px-1 py-0.5 font-mono">
              VITE_SUPABASE_URL
            </code>{' '}
            and{' '}
            <code className="rounded bg-amber-900/50 px-1 py-0.5 font-mono">
              VITE_SUPABASE_ANON_KEY
            </code>{' '}
            to this environment, then rebuild. For local development they belong
            in <span className="font-mono">.env.local</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Placeholder while a tab's code arrives, sized so the layout does not jump. */
export function TabLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-400">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      <p className="text-xs font-mono">Loading…</p>
    </div>
  );
}

/** The splash held while Supabase restores a saved session. */
export function SessionLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-100">
      <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      <p className="text-xs font-mono text-zinc-400">Restoring your session…</p>
    </div>
  );
}
