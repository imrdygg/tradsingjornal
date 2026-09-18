import React from 'react';

/**
 * A region that opens and closes with an animated height instead of snapping.
 *
 * The height comes from a grid row that animates between `0fr` and `1fr` — the one
 * way to animate to a content height nobody had to measure in JavaScript, which
 * matters because these panels contain variable-length prose and charts.
 *
 * The children stay mounted while collapsed, because the transition needs something
 * to animate back down to. That makes them `inert` and `aria-hidden` so a folded
 * region cannot be tabbed into or read aloud, and `invisible` so the content is
 * genuinely hidden on screen too — not merely clipped.
 *
 * `visibility` is part of the transition on purpose: it flips to hidden only once
 * the height has finished collapsing, and becomes visible immediately on open, so
 * the content is there for the whole unfold.
 */
export const Collapse: React.FC<{
  open: boolean;
  /** Id for the inner body element, for callers (and tests) that need to address it. */
  bodyId?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ open, bodyId, className = '', children }) => (
  <div
    className={`grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out ${
      open ? 'grid-rows-[1fr] visible opacity-100' : 'grid-rows-[0fr] invisible opacity-0'
    } ${className}`}
    aria-hidden={!open}
    inert={!open}
  >
    {/* `overflow-hidden` is what lets the 0fr row really collapse: it makes the
        grid item's automatic minimum size resolve to 0 rather than to its content. */}
    <div id={bodyId} className="overflow-hidden">
      {children}
    </div>
  </div>
);
