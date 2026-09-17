import React, { useEffect, useRef, useState } from 'react';
import { LogOut, Loader2, Cloud, User } from 'lucide-react';

interface AccountMenuProps {
  email?: string | null;
  onSignOut: () => void;
  signingOut?: boolean;
}

/**
 * Compact account control: an avatar button that opens a small panel holding
 * the signed-in email and Sign out. Keeps the header narrow so it cannot
 * overflow on laptop widths, where a full-width email + button did.
 */
export const AccountMenu: React.FC<AccountMenuProps> = ({
  email,
  onSignOut,
  signingOut = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Fall back to a neutral icon rather than a bare "?" when no email is known.
  const initial = (email || '').trim().charAt(0).toUpperCase();

  return (
    <div className="relative" ref={containerRef}>
      <button
        id="account-menu-btn"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={email ?? 'Account'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
      >
        {signingOut ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : initial ? (
          initial
        ) : (
          <User className="h-4 w-4 text-zinc-400" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        >
          <div className="border-b border-zinc-800 px-3 py-2.5">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
              <Cloud className="h-3 w-3" />
              Signed in
            </div>
            <p
              className="mt-1 truncate text-xs text-zinc-300"
              title={email ?? undefined}
            >
              {email ?? 'Local journal'}
            </p>
          </div>

          <button
            id="header-sign-out-btn"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            disabled={signingOut}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4 text-zinc-400" />
            )}
            {signingOut ? 'Saving…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
};
