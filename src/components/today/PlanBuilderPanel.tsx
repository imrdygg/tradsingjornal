import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  Wand2,
  Check,
  X,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import type { PlanBuildResponse } from '../../lib/ai/coach-types';
import type { CoachResult } from '../../lib/ai/coach-client';
import { AiThinking } from '../common/AiThinking';
import {
  askPlanBuild,
  fetchInstrumentQuote,
  formatQuotePercent,
  formatQuotePrice,
  type PlanCoachContext,
} from '../../lib/ai/plan-coach';
import type { InstrumentQuote } from '../../lib/ai/market-data';

/**
 * One click, a whole draft plan.
 *
 * The coach reads the trader's own journal for style and risk, then uses a live read of
 * the instrument they actually trade to make its own call: side, entry, stop, target and
 * a size that fits the day's loss limit. Everything lands in a preview — nothing is
 * written into the plan until the trader presses "Use this plan", and the draft says
 * plainly that it is one opinion and can be wrong.
 */

interface PlanBuilderPanelProps {
  context: PlanCoachContext;
  /** No draft is offered for a locked plan: changes there need a recorded reason. */
  disabled?: boolean;
  onApply: (draft: PlanBuildResponse) => void;
}

const BIAS_STYLES: Record<PlanBuildResponse['bias'], string> = {
  bullish: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
  bearish: 'bg-rose-950/80 text-rose-300 border-rose-800',
  neutral: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  unsure: 'bg-amber-950/80 text-amber-300 border-amber-800',
};

const CONFIDENCE_STYLES: Record<PlanBuildResponse['confidence'], string> = {
  high: 'text-emerald-300',
  medium: 'text-amber-300',
  low: 'text-zinc-400',
};

export const PlanBuilderPanel: React.FC<PlanBuilderPanelProps> = ({
  context,
  disabled = false,
  onApply,
}) => {
  const symbol = context.day.primaryInstrument;
  const [quote, setQuote] = useState<InstrumentQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CoachResult | null>(null);

  // The live price is context for the button, never a requirement: a failed read just
  // leaves the price off the header.
  useEffect(() => {
    let cancelled = false;
    void fetchInstrumentQuote(symbol).then((read) => {
      if (!cancelled) setQuote(read);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const draft: PlanBuildResponse | null =
    result?.ok && 'headline' in result.data && 'direction' in result.data
      ? (result.data as PlanBuildResponse)
      : null;

  const handleBuild = async () => {
    setLoading(true);
    setResult(null);
    const outcome = await askPlanBuild(context);
    setLoading(false);
    setResult(outcome);
  };

  const riskPoints =
    draft && draft.entry !== null && draft.stop !== null
      ? Math.abs(draft.entry - draft.stop)
      : null;
  const rewardPoints =
    draft && draft.entry !== null && draft.target !== null
      ? Math.abs(draft.target - draft.entry)
      : null;
  const rMultiple =
    riskPoints && rewardPoints && riskPoints > 0
      ? Math.round((rewardPoints / riskPoints) * 100) / 100
      : null;

  const priceInput = (value: number | null) => (value === null ? '—' : formatQuotePrice(value));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5 text-amber-400" />
          One-click plan from the coach
        </span>
        <span className="text-[11px] font-mono text-zinc-400" id="plan-build-live-price">
          {quote && quote.ok ? (
            <>
              live {quote.symbol} {formatQuotePrice(quote.price)}{' '}
              <span
                className={
                  (quote.changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                {formatQuotePercent(quote.changePercent)}
              </span>
            </>
          ) : (
            <span className="text-zinc-500">live price unavailable</span>
          )}
        </span>
      </div>

      <p className="text-[11px] text-zinc-400 leading-relaxed">
        The coach reads your own style, size and past mistakes, pulls a live read of{' '}
        <span className="font-mono text-zinc-300">{symbol}</span>, then drafts a whole plan:
        bias, side, entry, stop, target and size — with its reasoning, so you can check it.
        It is one opinion and it can be wrong.
      </p>

      <button
        type="button"
        id="plan-build-btn"
        onClick={handleBuild}
        disabled={loading || disabled}
        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 px-3.5 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
      >
        {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {loading ? 'Reading the market and your journal…' : "Build today's plan"}
      </button>

      {loading && (
        <AiThinking
          label="Reading the market and your journal…"
          steps={[
            'Reading your journal…',
            'Pulling a live read of the market…',
            'Drafting bias, entry, stop and size…',
            'Writing the reasoning…',
          ]}
        />
      )}

      {disabled && (
        <p className="text-[11px] text-zinc-500">
          The plan is locked, so a coach draft is not offered — unlock it to plan from scratch.
        </p>
      )}

      {!loading && draft && (
        <div id="plan-build-draft" className="space-y-3 rounded-xl border border-amber-900/50 bg-amber-950/10 p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-100 leading-snug flex-1 min-w-[12rem]">
              {draft.headline}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase font-mono ${BIAS_STYLES[draft.bias]}`}
              >
                {draft.bias}
              </span>
              <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase font-mono text-zinc-300 flex items-center gap-1">
                {draft.direction === 'long' ? (
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                ) : draft.direction === 'short' ? (
                  <TrendingDown className="w-3 h-3 text-rose-400" />
                ) : (
                  <Minus className="w-3 h-3 text-zinc-400" />
                )}
                {draft.direction === 'skip' ? 'stand aside' : draft.direction}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {[
              { label: 'Entry', value: priceInput(draft.entry) },
              { label: 'Stop', value: priceInput(draft.stop) },
              { label: 'Target', value: priceInput(draft.target) },
              { label: 'Contracts', value: String(draft.contracts) },
              { label: 'R:R', value: rMultiple === null ? '—' : `${rMultiple}R` },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-2 py-1.5">
                <span className="text-[10px] text-zinc-500 block uppercase font-mono">
                  {stat.label}
                </span>
                <span className="text-zinc-100 font-mono font-bold">{stat.value}</span>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <p className="text-[11px] text-zinc-300 leading-relaxed">
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                What am I waiting for?
              </span>
              {draft.waitingFor}
            </p>
            <p className="text-[11px] text-zinc-300 leading-relaxed">
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                Stay out if
              </span>
              {draft.stayOutIf}
            </p>
          </div>

          {draft.setups.length > 0 && (
            <p className="text-[11px] text-zinc-300 leading-relaxed">
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">Setups</span>
              {draft.setups.join(', ')}
            </p>
          )}

          {draft.levels.length > 0 && (
            <div>
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                Levels to mark
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.levels.map((level, index) => (
                  <span
                    key={`${level.price}-${index}`}
                    className="inline-flex items-baseline gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px]"
                  >
                    <span className="font-mono font-bold text-zinc-100">
                      {formatQuotePrice(level.price)}
                    </span>
                    {level.label && <span className="text-zinc-400">{level.label}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-zinc-500 uppercase font-mono text-[10px] block">
              The coach's reasoning ·{' '}
              <span className={`font-bold ${CONFIDENCE_STYLES[draft.confidence]}`}>
                {draft.confidence} confidence
              </span>
            </span>
            <p className="text-[11px] text-zinc-300 leading-relaxed">{draft.rationale}</p>
          </div>

          {draft.basedOn.length > 0 && (
            <ul className="space-y-0.5">
              <li className="text-[10px] font-mono uppercase text-zinc-500">Based on</li>
              {draft.basedOn.map((item, index) => (
                <li key={index} className="text-[11px] text-zinc-400 leading-relaxed">
                  · {item}
                </li>
              ))}
            </ul>
          )}

          <p className="text-[10px] text-zinc-500 leading-relaxed border-t border-zinc-800/70 pt-2">
            The coach's opinion, not advice — you decide whether this is the day you trade. Applying
            it fills in the plan fields; it does not lock anything.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="plan-build-apply"
              onClick={() => {
                onApply(draft);
                setResult(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-colors"
            >
              <Check className="w-3 h-3 stroke-[3]" />
              Use this plan
            </button>
            <button
              type="button"
              onClick={handleBuild}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <RefreshCw className="w-3 h-3" />
              Ask again
            </button>
            <button
              type="button"
              id="plan-build-dismiss"
              onClick={() => setResult(null)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!loading && result && !result.ok && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-3 space-y-2">
          <p className="text-[11px] text-zinc-300 leading-relaxed flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              {result.code === 'unconfigured'
                ? 'The coach is not available in this environment, so no plan could be drafted.'
                : `The coach could not draft a plan (${result.code}). ${result.message}`}
            </span>
          </p>
          <button
            type="button"
            onClick={handleBuild}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <RefreshCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      )}
    </div>
  );
};
