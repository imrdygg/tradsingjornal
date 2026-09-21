import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll, unlockBodyScroll } from '../../lib/ui/scroll-lock';

interface ModalOverlayProps {
  children: React.ReactNode;
  /** Replaces the default backdrop classes when provided. */
  backdropClassName?: string;
  /** When set, clicking the backdrop itself (not the panel) calls this. */
  onBackdropClick?: () => void;
  /**
   * Called when the user presses Escape. Usually the same handler as
   * `onBackdropClick`; a destructive confirm can leave this off to force a
   * deliberate choice.
   */
  onRequestClose?: () => void;
  /**
   * Accessible name for the dialog. Screen readers announce this instead of
   * reading the whole panel, so keep it to the dialog's title.
   */
  label?: string;
}

/**
 * Stack of mounted overlays, oldest first. Only the last entry is the one the
 * user is actually interacting with.
 *
 * This exists because overlays nest: the image lightbox opens on top of the
 * trade detail modal. Without a shared stack every mounted overlay would react
 * to the same Escape press and one key would close two things at once.
 */
const openDialogs: symbol[] = [];

function registerDialog(): symbol {
  const token = Symbol('dialog');
  openDialogs.push(token);
  return token;
}

function unregisterDialog(token: symbol): void {
  const index = openDialogs.indexOf(token);
  if (index >= 0) openDialogs.splice(index, 1);
}

/**
 * Joins this component to the overlay stack for as long as `active` is true.
 *
 * `isTopmost()` reports whether nothing has opened on top of it — the check
 * that keeps Escape and the focus trap from reaching through a nested overlay.
 * Use it in components that render their own overlay instead of ModalOverlay
 * (the lightbox does).
 */
export function useDialogLayer(active: boolean): { isTopmost: () => boolean } {
  const tokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (!active) return;
    const token = registerDialog();
    tokenRef.current = token;
    return () => {
      unregisterDialog(token);
      tokenRef.current = null;
    };
  }, [active]);

  const isTopmost = useCallback(
    () => tokenRef.current !== null && openDialogs[openDialogs.length - 1] === tokenRef.current,
    []
  );

  return { isTopmost };
}

/** Elements a Tab press can land on, minus anything not rendered. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * Shared modal shell.
 *
 * It exists because the previous per-modal markup was wrong in two ways:
 *
 * 1. It renders through a portal. `position: fixed` is positioned against the
 *    nearest ancestor that establishes a containing block - and a
 *    `backdrop-filter` (e.g. `backdrop-blur-sm` on a card) does exactly that.
 *    Dialogs rendered inside such a card were sized to the card, not the
 *    viewport, so they appeared far down the page instead of in front of the
 *    user. Portalling to <body> makes that impossible.
 *
 * 2. Scrolling and centring are split across two elements. Putting
 *    `overflow-y-auto` and `items-center` on the same node clips the top of
 *    any panel taller than the screen and leaves it unreachable, because the
 *    centred overflow sits above the scrollable origin.
 *
 * 3. The page behind the modal must not scroll (jarring on mobile, where the
 *    background drifts under the fixed overlay), so the body scroll is locked
 *    for as long as the modal is mounted.
 *
 * It is also the only place that has to get dialog semantics right, so the
 * accessibility behaviour lives here rather than in each modal:
 *
 * - `role="dialog"` + `aria-modal="true"` + an accessible name, so a screen
 *   reader announces a dialog instead of reading the page behind it.
 * - Tab and Shift+Tab cycle inside the panel, and Escape closes the topmost
 *   overlay, so keyboard users cannot tab out into the hidden page behind.
 * - Focus moves into the panel on open and returns to whatever opened it on
 *   close, so a keyboard user is not dropped back at the top of the document.
 */
export const ModalOverlay: React.FC<ModalOverlayProps> = ({
  children,
  backdropClassName,
  onBackdropClick,
  onRequestClose,
  label,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { isTopmost } = useDialogLayer(true);

  // Freeze the page behind the modal. Every mount pairs exactly one
  // lock/unlock, so stacked overlays (e.g. modal -> lightbox) stay correct.
  useEffect(() => {
    lockBodyScroll();
    return unlockBodyScroll;
  }, []);

  // Move focus in on open and hand it back on close.
  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;

    // A modal whose field autofocuses itself has already placed focus, and
    // yanking it to the first button would be worse than leaving it alone.
    if (panel && !panel.contains(document.activeElement)) {
      const first = focusableElements(panel)[0];
      (first ?? panel).focus();
    }

    return () => {
      // The opener can be gone by now — a deleted trade's row, for instance.
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  // Escape closes this overlay, but only while nothing sits on top of it.
  useEffect(() => {
    if (!onRequestClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopmost()) return;
      event.stopPropagation();
      onRequestClose();
    };
    // Capture phase: the overlay gets the key before a child that also listens
    // for Escape (an inline search field, say) can act on a stale dialog.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onRequestClose, isTopmost]);

  // Keep Tab inside the dialog.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !isTopmost()) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = focusableElements(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (!active || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Client-only app, but never assume a DOM exists at module evaluation time.
  if (typeof document === 'undefined') return null;

  const backdrop = backdropClassName ?? 'bg-black/80 backdrop-blur-sm';

  return createPortal(
    <div
      className={`fixed inset-0 z-50 overflow-y-auto overscroll-contain ${backdrop}`}
      onClick={(event) => {
        if (event.target === event.currentTarget && onBackdropClick) {
          onBackdropClick();
        }
      }}
    >
      {/* `my-auto` inside a full-height flex row is the safe centring pattern:
          short panels stay truly centred in the viewport, tall panels keep
          their top edge pinned just below the safe-area padding so the header
          is always the first thing on screen, reachable by scrolling up. */}
      <div className="flex min-h-full justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="my-auto flex w-full justify-center outline-none"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
