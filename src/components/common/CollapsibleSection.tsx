import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Collapse } from './Collapse';

const STORAGE_PREFIX = 'ptj_section_';

function readStoredOpen(key: string | undefined, fallback: boolean): boolean {
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // Storage can be blocked; the section just stops remembering, which is fine.
  }
  return fallback;
}

function writeStoredOpen(key: string | undefined, open: boolean): void {
  if (!key) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? '1' : '0');
  } catch {
    // As above: a blocked write costs nothing but the memory.
  }
}

/**
 * A hide/show wrapper for the big containers on the home page.
 *
 * Every panel on Today used to be permanently expanded, so the page was one long scroll
 * and every visit re-read every panel. This wraps the existing card — unchanged — with a
 * slim header row: the title (with its count or summary), and a Hide/Show toggle. The
 * body folds with the same animated grid collapse the coach panels use.
 *
 * State persists per section in localStorage, so a trader who hides the plan form today
 * does not have to hide it again tomorrow. Yesterday's Lesson banner is deliberately NOT
 * one of these — that lesson is the thing the day is supposed to be built around, and it
 * never folds away.
 *
 * The wrapped content stays mounted while hidden (the collapse needs something to animate
 * back to), so charts and forms keep their state; `Collapse` makes the hidden body inert
 * and invisible.
 */
export const CollapsibleSection: React.FC<{
  /** Stable id: used for aria-controls, and as the persistence key via `persistKey`. */
  id: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** Small summary beside the title (counts, statuses) that stays visible when hidden. */
  meta?: React.ReactNode;
  /** Persisted under `ptj_section_<persistKey>`; omitted means session-only. */
  persistKey?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({
  id,
  title,
  icon,
  meta,
  persistKey,
  defaultOpen = true,
  className = '',
  children,
}) => {
  const [open, setOpen] = useState(() => readStoredOpen(persistKey, defaultOpen));

  // Re-read when the key changes (never in practice, but keeps the hook honest) and
  // after mount, so a persisted choice wins over the default without a layout flash.
  useEffect(() => {
    setOpen(readStoredOpen(persistKey, defaultOpen));
    // defaultOpen is a constant per callsite; including it would only add noise.
  }, [persistKey]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      writeStoredOpen(persistKey, next);
      return next;
    });
  }, [persistKey]);

  return (
    <section id={id} data-section-open={open ? 'true' : 'false'} className={className}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left transition-colors hover:text-zinc-200"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
              open ? '' : '-rotate-90'
            }`}
          />
          {icon}
          <span className="min-w-0 truncate">{title}</span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {meta}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={`${id}-body`}
            title={open ? 'Hide this section' : 'Show this section'}
            className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
          >
            {open ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            <span className="hidden sm:inline">{open ? 'Hide' : 'Show'}</span>
          </button>
        </div>
      </div>

      <Collapse open={open} bodyId={`${id}-body`}>
        <div className="pt-2">{children}</div>
      </Collapse>
    </section>
  );
};
