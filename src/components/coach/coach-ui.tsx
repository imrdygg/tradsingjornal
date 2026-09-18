import React from 'react';
import { Sparkles, MessageSquareQuote, Target, AlertTriangle, CheckCircle2, Settings2 } from 'lucide-react';
import { CoachErrorCode } from '../../lib/ai/coach-client';

/**
 * Presentational pieces shared by the Coach tab and the Today checkpoint card.
 * Kept in one place so a fix to the error or empty states lands in both.
 */

export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

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
  <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
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
 * Renders the coach's failure honestly, and distinguishes "not deployed here" from a
 * real error: they need completely different actions from the trader.
 */
export const CoachErrorPanel: React.FC<{
  code: CoachErrorCode;
  message: string;
  idSuffix: string;
}> = ({ code, message, idSuffix }) => {
  const notConfigured = code === 'unconfigured';
  const Icon = notConfigured ? Settings2 : AlertTriangle;
  return (
    <div
      id={`coach-error-${idSuffix}`}
      className={`rounded-xl border px-3.5 py-3 ${
        notConfigured ? 'border-zinc-700 bg-zinc-800/40' : 'border-rose-900/60 bg-rose-950/30'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3.5 h-3.5 ${notConfigured ? 'text-zinc-400' : 'text-rose-400'}`} />
        <span
          className={`text-[10px] font-mono uppercase font-bold ${
            notConfigured ? 'text-zinc-400' : 'text-rose-400'
          }`}
        >
          {notConfigured ? 'Coach not available here' : 'Coach error'}
        </span>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed">{message}</p>
    </div>
  );
};
