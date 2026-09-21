import React from 'react';
import { AlertTriangle, CloudDownload, HardDrive } from 'lucide-react';

interface CloudConflictBannerProps {
  /** True while one of the two choices is being applied. */
  busy?: boolean;
  /** Replaces this device's journal with the cloud copy. */
  onUseCloudCopy: () => void;
  /** Overwrites the cloud copy with this device's journal. */
  onKeepThisDevice: () => void;
}

/**
 * Shown when a save was refused because another device wrote to the journal
 * first.
 *
 * The two copies cannot be merged here: the journal stores whole trades, plans
 * and reviews, and a deletion on one device is indistinguishable from a trade
 * that device never had. Merging on `updatedAt` would quietly resurrect deleted
 * trades, which is worse than asking. So the banner states the trade-off in the
 * trader's terms and makes them choose.
 */
export const CloudConflictBanner: React.FC<CloudConflictBannerProps> = ({
  busy = false,
  onUseCloudCopy,
  onKeepThisDevice,
}) => (
  <div
    role="alert"
    className="mb-4 rounded-2xl border border-amber-800/70 bg-amber-950/40 p-3 sm:p-4"
  >
    <div className="flex items-start gap-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs font-semibold text-amber-100">
          This journal also changed on another device — nothing is saving until you choose
        </p>
        <p className="text-[11px] leading-relaxed text-amber-200/80">
          Your other device saved a newer copy, so this one&apos;s saves are being held back
          rather than overwriting it. Whichever you pick, the other copy is replaced, so pick the
          one with the work you want to keep.
        </p>

        <div className="flex flex-col gap-2 pt-0.5 sm:flex-row">
          <button
            type="button"
            id="conflict-use-cloud"
            disabled={busy}
            onClick={onUseCloudCopy}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            <CloudDownload className="h-3.5 w-3.5" />
            Use the cloud copy
          </button>
          <button
            type="button"
            id="conflict-keep-device"
            disabled={busy}
            onClick={onKeepThisDevice}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-700/70 bg-amber-950/40 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-900/40 disabled:opacity-50"
          >
            <HardDrive className="h-3.5 w-3.5" />
            Keep this device&apos;s copy
          </button>
        </div>

        <p className="text-[10px] leading-relaxed text-amber-200/60">
          &ldquo;Use the cloud copy&rdquo; discards the changes made here since this device last
          saved. &ldquo;Keep this device&apos;s copy&rdquo; discards the other device&apos;s.
        </p>
      </div>
    </div>
  </div>
);
