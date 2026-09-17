import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll, unlockBodyScroll } from '../../lib/ui/scroll-lock';

interface ModalOverlayProps {
  children: React.ReactNode;
  /** Replaces the default backdrop classes when provided. */
  backdropClassName?: string;
  /** When set, clicking the backdrop itself (not the panel) calls this. */
  onBackdropClick?: () => void;
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
 */
export const ModalOverlay: React.FC<ModalOverlayProps> = ({
  children,
  backdropClassName,
  onBackdropClick,
}) => {
  // Freeze the page behind the modal. Every mount pairs exactly one
  // lock/unlock, so stacked overlays (e.g. modal -> lightbox) stay correct.
  useEffect(() => {
    lockBodyScroll();
    return unlockBodyScroll;
  }, []);

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
        <div className="my-auto w-full flex justify-center">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
