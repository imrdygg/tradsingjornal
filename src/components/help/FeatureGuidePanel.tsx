import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Info, X } from 'lucide-react';
import { FEATURE_GUIDES, guideFor, type GuideTopic } from '../../lib/help/feature-guides';

/**
 * The in-app guide.
 *
 * Opened from the header on any screen, and it opens on that screen's own guide. The topic
 * chips let a trader move to another feature without leaving the panel, which matters most on
 * the first run: the question is usually "how does this whole thing fit together", not "what
 * does this one button do".
 *
 * It is a plain overlay rather than a routed page so it can be opened mid-task without losing
 * a half-typed trade, and Escape closes it.
 */

export interface FeatureGuidePanelProps {
  open: boolean;
  /** The tab the trader is on, so the panel opens on the right guide. */
  topic: string;
  onClose: () => void;
}

export const FeatureGuidePanel: React.FC<FeatureGuidePanelProps> = ({ open, topic, onClose }) => {
  const [selected, setSelected] = useState<GuideTopic>(() => guideFor(topic).id);

  // Following the tab only while the panel is closed: once it is open, the trader may be
  // reading another topic, and yanking it away on a re-render would lose their place.
  useEffect(() => {
    if (open) setSelected(guideFor(topic).id);
  }, [open, topic]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const guide = useMemo(() => guideFor(selected), [selected]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-guide-title"
      id="feature-guide"
    >
      <button
        type="button"
        aria-label="Close the guide"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      />

      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-start gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="mt-0.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400">
            <BookOpen className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Guide</p>
            <h2 id="feature-guide-title" className="text-sm font-semibold text-zinc-100">
              {guide.title}
            </h2>
          </div>
          <button
            type="button"
            id="feature-guide-close"
            onClick={onClose}
            aria-label="Close the guide"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-zinc-800 px-3 py-2">
          {FEATURE_GUIDES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              id={`feature-guide-topic-${entry.id}`}
              onClick={() => setSelected(entry.id)}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                entry.id === selected
                  ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs leading-relaxed text-zinc-300">{guide.summary}</p>

          <section>
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              How to use it
            </h3>
            <ol className="mt-2 space-y-2">
              {guide.steps.map((step, index) => (
                <li key={index} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 font-mono text-[9px] text-zinc-400">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {guide.notes.length > 0 && (
            <section>
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                Good to know
              </h3>
              <ul className="mt-2 space-y-1.5">
                {guide.notes.map((note, index) => (
                  <li key={index} className="flex gap-2 text-[11px] leading-relaxed text-zinc-400">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {guide.requires && guide.requires.length > 0 && (
            <section className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
                <Info className="h-3.5 w-3.5" />
                This screen needs services you supply
              </h3>
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-amber-100/90">
                {guide.requires.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] leading-relaxed text-amber-200/70">
                This purchase is the software. You connect your own accounts; usage is billed to
                them. The step-by-step setup is in <code>docs/BUYER-SETUP.md</code> in the source
                you received.
              </p>
            </section>
          )}

          <p className="text-[10px] leading-relaxed text-zinc-500">
            Every screen has a guide. The ? button in the header opens the one for the tab you
            are on.
          </p>
        </div>
      </div>
    </div>
  );
};
