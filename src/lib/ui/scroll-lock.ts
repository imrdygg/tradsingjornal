/**
 * Shared body scroll lock.
 *
 * While any modal/overlay is open, the page behind it must not scroll —
 * otherwise the user's scroll position shifts and the modal can drift off
 * screen, which is especially disorienting on mobile. A plain
 * `document.body.style.overflow = 'hidden'` breaks when overlays stack
 * (e.g. trade modal -> image lightbox): the first overlay to close would
 * unlock the body while the second is still open. This module therefore
 * reference-counts lock requests.
 */

let lockCount = 0;
let previousHtmlOverflow = '';
let previousBodyOverflow = '';
let previousPaddingRight = '';

/**
 * Prevents background scrolling. Safe to call multiple times — each call
 * must be paired with exactly one {@link unlockBodyScroll}.
 */
export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (typeof window === 'undefined') return;

  if (lockCount === 0) {
    const { documentElement, body } = document;
    previousHtmlOverflow = documentElement.style.overflow;
    previousBodyOverflow = body.style.overflow;
    previousPaddingRight = body.style.paddingRight;

    // Locking <html> as well as <body> is required on iOS Safari, where a
    // body-only lock still lets the page rubber-band scroll.
    documentElement.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    // Compensate for the disappearing scrollbar so the page doesn't shift.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }

  lockCount += 1;
}

/**
 * Releases one scroll-lock request made via {@link lockBodyScroll}.
 * The page style is only restored once every lock has been released.
 */
export function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;

  lockCount = Math.max(0, lockCount - 1);

  if (lockCount === 0) {
    const { documentElement, body } = document;
    documentElement.style.overflow = previousHtmlOverflow;
    body.style.overflow = previousBodyOverflow;
    body.style.paddingRight = previousPaddingRight;
    previousHtmlOverflow = '';
    previousBodyOverflow = '';
    previousPaddingRight = '';
  }
}
