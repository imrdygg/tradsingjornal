import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

/**
 * The one "the coach is working" animation, used everywhere the AI is asked for something.
 *
 * The old state was a single pulsing icon, which read as "finished" or "broken" as easily
 * as "working" — a pulse is indistinguishable from a fade, and nothing moved anywhere.
 * This reads as activity three ways at once, so there is never a doubt:
 *
 * - three dots sweep through a wave (the classic "typing" signal),
 * - a soft shimmer travels across the label text,
 * - the status line itself cycles through staged messages, so progress is legible on
 *   long waits (a coach answer can take ten-plus seconds; a frozen sentence reads as a hang).
 *
 * The label is in normal document flow and the whole thing is a few pixels tall, so it
 * never blocks the page: the trader can keep scrolling, typing and recording while it runs.
 * All motion is guarded by prefers-reduced-motion, where the state degrades to a calm
 * static label with a single steady dot — still clearly labelled, just not animated.
 */

export const AiThinking: React.FC<{
  label: string;
  /** Staged messages cycled while waiting; defaults to just the label. */
  steps?: string[];
  className?: string;
}> = ({ label, steps, className = '' }) => {
  const messages = steps && steps.length > 0 ? steps : [label];
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const id = window.setInterval(
      () => setStep((prev) => (prev + 1) % messages.length),
      3200
    );
    return () => window.clearInterval(id);
    // `messages` is derived; the identity changes every render but its length is what matters.
  }, [messages.length]);

  return (
    <div
      className={`flex items-center gap-2.5 text-xs text-zinc-400 py-1.5 ${className}`}
      role="status"
      aria-live="polite"
      data-ai-thinking="true"
    >
      {/* The amber spark, kept from the coach's identity but moving in a small orbit
          so even the icon reads as active rather than idle. */}
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="ai-thinking-ring absolute inset-0 rounded-full border border-amber-500/30" />
        <Sparkles className="h-3.5 w-3.5 text-amber-400 ai-thinking-spark" />
      </span>

      {/* The three-dot wave: each dot rises and falls on a shared keyframe with a
          per-dot delay, which is what produces the left-to-right sweep. */}
      <span className="flex items-end gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-amber-400/90"
            style={{ animationDelay: `${dot * 0.18}s` }}
          />
        ))}
      </span>

      {/* Shimmering, cycling status text. The shimmer is a background-clip gradient
          sliding under the text, so the words themselves appear to be lighting up.
          The modulo keeps a stale index (from a longer step list before a re-render)
          from ever rendering undefined. */}
      <span className="ai-thinking-text min-w-0 flex-1 leading-relaxed">
        {messages[step % messages.length]}
      </span>
    </div>
  );
};

/** Staged copy for the coach's longer jobs, so waiting feels described rather than frozen. */
export const COACH_WAIT_STEPS = (subject: string): string[] => [
  `Reading your journal…`,
  `Reading the ${subject}…`,
  `Weighing the evidence…`,
  `Writing the answer…`,
];
