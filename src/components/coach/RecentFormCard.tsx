import React from 'react';
import { Activity, HelpCircle, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  MIN_FORM_WINDOW_TRADES,
  type FormTrend,
  type FormWindow,
  type RecentForm,
} from '../../lib/ai/journal-digest';
import { CoachCard, money } from './coach-ui';

/**
 * Where the trader's form is heading, computed from their own closed trades.
 *
 * The read below this card is written by the coach, but the comparison is not: it is two
 * equal windows of the trader's own fills, shown first and unchanged. That is what makes
 * the writing checkable — if it says the trader is giving back a good run, these are the
 * figures it came from, and the trader can disagree with the conclusion while seeing the
 * numbers are right.
 *
 * The direction badge only appears once both windows carry a real sample. A short window
 * is labelled as short rather than topped up from older trades, which would quietly turn a
 * change in form into a change in the sample.
 */

const TREND_STYLE: Record<
  FormTrend,
  { label: string; Icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  improving: {
    label: 'Improving',
    Icon: TrendingUp,
    className: 'border-emerald-800 bg-emerald-950/60 text-emerald-300',
  },
  declining: {
    label: 'Worsening',
    Icon: TrendingDown,
    className: 'border-rose-800 bg-rose-950/60 text-rose-300',
  },
  mixed: {
    label: 'Mixed',
    Icon: Minus,
    className: 'border-amber-800 bg-amber-950/60 text-amber-300',
  },
  steady: {
    label: 'Steady',
    Icon: Minus,
    className: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  },
  'not-enough-data': {
    label: 'Too few trades',
    Icon: HelpCircle,
    className: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  },
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-[10px] font-mono uppercase text-zinc-500">{label}</span>
    <span className="font-mono text-[11px] text-zinc-300">{value}</span>
  </div>
);

const WindowColumn: React.FC<{ title: string; stats: FormWindow }> = ({ title, stats }) => (
  <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
    <div className="text-[10px] font-mono uppercase font-bold text-zinc-400">{title}</div>
    <p className="text-[10px] font-mono text-zinc-500">
      {stats.from ? `${stats.from} → ${stats.to}` : 'no trades recorded'}
    </p>
    {stats.trades === 0 ? (
      <p className="text-[11px] italic text-zinc-500">Nothing to compare.</p>
    ) : (
      <>
        <Row label="Net" value={money(stats.netPnL ?? 0)} />
        <Row label="Avg R" value={`${stats.avgR ?? 0}R`} />
        <Row label="Win rate" value={`${stats.winRate ?? 0}%`} />
        <Row label="Per day" value={money(stats.netPnLPerDay ?? 0)} />
        <Row label="Days" value={String(stats.days)} />
        <Row
          label="Discipline"
          value={stats.disciplineScore === null ? 'not reviewed' : `${stats.disciplineScore}/100`}
        />
      </>
    )}
  </div>
);

/** One recent-minus-prior change, coloured by direction. A missing side renders as a dash. */
const Delta: React.FC<{ label: string; value: number | null; format: (n: number) => string }> = ({
  label,
  value,
  format,
}) => {
  const tone =
    value === null
      ? 'text-zinc-500'
      : value > 0
      ? 'text-emerald-400'
      : value < 0
      ? 'text-rose-400'
      : 'text-zinc-400';
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] font-mono uppercase text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xs font-semibold ${tone}`}>
        {value === null ? '—' : `${value > 0 ? '+' : ''}${format(value)}`}
      </div>
    </div>
  );
};

export const RecentFormCard: React.FC<{ form: RecentForm }> = ({ form }) => {
  const { label, Icon, className } = TREND_STYLE[form.trend];

  return (
    <CoachCard id="coach-form-card" className="space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" />
            Where your form is heading
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Your most recent {form.windowTrades} closed trade(s) against the {form.windowTrades}{' '}
            before them. Computed from your own fills, and the coach is given these same figures.
          </p>
        </div>
        <span
          id="coach-form-trend"
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono uppercase font-bold ${className}`}
        >
          <Icon className="h-3 w-3" />
          {label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <WindowColumn title={`Last ${form.recent.trades}`} stats={form.recent} />
        <WindowColumn title={`The ${form.prior.trades} before`} stats={form.prior} />
      </div>

      <div id="coach-form-facts" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Delta label="Avg R" value={form.avgRDelta} format={(n) => `${n.toFixed(2)}R`} />
        <Delta label="Per day" value={form.netPnLPerDayDelta} format={money} />
        <Delta label="Win rate" value={form.winRateDelta} format={(n) => `${n}%`} />
        <Delta label="Discipline" value={form.disciplineDelta} format={(n) => `${n}`} />
      </div>

      {!form.hasEnoughForTrend && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          A direction is only named once each window holds at least {MIN_FORM_WINDOW_TRADES} closed
          trades. Below that, a run of winners cannot be told apart from a lucky week.
        </p>
      )}
    </CoachCard>
  );
};
