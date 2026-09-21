import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  MessageSquareQuote,
  Target,
  AlertTriangle,
  CheckCircle2,
  Settings2,
  Lock,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { CoachErrorCode } from '../../lib/ai/coach-client';
import { Collapse } from '../common/Collapse';

/**
 * Presentational pieces shared by the Coach tab and the Today checkpoint card.
 * Kept in one place so a fix to the error or empty states lands in both.
 */

export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

/**
 * Wrapper for a piece of written coach output that the trader can fold away.
 *
 * The AI answers are long, and re-reading an old one while generating the next
 * means scrolling past text you have already read. Collapsing is per-section and
 * local, and a fresh answer always unfurls itself (`resultKey`), so folding a
 * result away never hides new output.
 */
export const CoachResultPanel: React.FC<{
  /** Kept from the pre-existing markup so the e2e specs can still find the result. */
  id: string;
  heading: string;
  /** Small "when was this written" note shown beside the heading. */
  meta?: string;
  /** Changes whenever new output lands; a changed value re-expands the panel. */
  resultKey?: string;
  busy?: boolean;
  onRegenerate?: () => void;
  regenerateLabel?: string;
  children: React.ReactNode;
}> = ({
  id,
  heading,
  meta,
  resultKey,
  busy = false,
  onRegenerate,
  regenerateLabel = 'Regenerate',
  children,
}) => {
  const [open, setOpen] = useState(true);

  // Regenerating while collapsed would otherwise leave the new answer hidden.
  useEffect(() => setOpen(true), [resultKey]);

  return (
    <div id={id} className="pt-1">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          id={`${id}-toggle`}
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-w-0 items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <span className="truncate">{heading}</span>
          {meta && (
            <span className="truncate font-normal normal-case text-zinc-500">· {meta}</span>
          )}
        </button>

        {onRegenerate && (
          <button
            type="button"
            id={`${id}-regenerate`}
            onClick={onRegenerate}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
            {regenerateLabel}
          </button>
        )}
      </div>

      {/* Collapsed this has a zero-height box, which is what the e2e spec asserts on. */}
      <Collapse open={open} bodyId={`${id}-body`}>
        <div className="space-y-3 pt-3">{children}</div>
      </Collapse>
    </div>
  );
};

export const CoachCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  id?: string;
}> = ({ children, className = '', id }) => (
  <div id={id} className={`rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 ${className}`}>
    {children}
  </div>
);

export const CoachBullets: React.FC<{
  items: string[];
  tone: 'good' | 'bad' | 'neutral';
  emptyLabel: string;
}> = ({ items, tone, emptyLabel }) => {
  if (!items.length) {
    return <p className="text-xs text-zinc-500 italic">{emptyLabel}</p>;
  }
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'bad' ? AlertTriangle : Target;
  const color =
    tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-amber-400' : 'text-zinc-400';
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 20)}`} className="flex items-start gap-2">
          <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
          <span className="text-xs text-zinc-300 leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
};

export const CoachMotivation: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3.5 py-3">
    <div className="flex items-center gap-1.5 mb-1">
      <MessageSquareQuote className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-[10px] font-mono uppercase font-bold text-amber-400">Coach</span>
    </div>
    <p className="text-xs text-amber-100/90 leading-relaxed">{text}</p>
  </div>
);

/** A single labelled instruction, used for the one action to take. */
export const CoachAction: React.FC<{ label: string; text: string }> = ({ label, text }) => (
  <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-3">
    <div className="flex items-center gap-1.5 mb-1">
      <Target className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-[10px] font-mono uppercase font-bold text-amber-400">{label}</span>
    </div>
    <p className="text-xs text-zinc-200 leading-relaxed">{text}</p>
  </div>
);

export const CoachFact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
    <div className="text-[10px] font-mono uppercase text-zinc-500">{label}</div>
    <div className="text-xs font-semibold text-zinc-200 font-mono mt-0.5">{value}</div>
  </div>
);

export const CoachLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-2 text-xs text-zinc-400 py-2" role="status">
    <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
    {label}
  </div>
);

export const CoachLabel: React.FC<{ text: string; tone?: 'good' | 'bad' | 'neutral' }> = ({
  text,
  tone = 'neutral',
}) => {
  const color =
    tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-amber-400' : 'text-zinc-400';
  return <span className={`text-[10px] font-mono uppercase font-bold ${color}`}>{text}</span>;
};

/**
 * Renders the coach's failure honestly, and distinguishes the three cases that need
 * different actions from the trader: not deployed here, not signed in, and an actual
 * error. Only the last one is a fault.
 */
export const CoachErrorPanel: React.FC<{
  code: CoachErrorCode;
  message: string;
  idSuffix: string;
}> = ({ code, message, idSuffix }) => {
  const notConfigured = code === 'unconfigured';
  const needsSignIn = code === 'unauthorized';
  // Setup and identity problems are calm and actionable; only a real failure is red.
  const calm = notConfigured || needsSignIn;
  const Icon = notConfigured ? Settings2 : needsSignIn ? Lock : AlertTriangle;
  const title = notConfigured
    ? 'Coach not available here'
    : needsSignIn
    ? 'Sign in required'
    : 'Coach error';
  return (
    <div
      id={`coach-error-${idSuffix}`}
      className={`rounded-xl border px-3.5 py-3 ${
        calm ? 'border-zinc-700 bg-zinc-800/40' : 'border-rose-900/60 bg-rose-950/30'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${calm ? 'text-zinc-400' : 'text-rose-400'}`} />
        <span
          className={`text-[10px] font-mono uppercase font-bold ${
            calm ? 'text-zinc-400' : 'text-rose-400'
          }`}
        >
          {title}
        </span>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed">{message}</p>
    </div>
  );
};
