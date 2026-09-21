import React, { useState } from 'react';
import { Sparkles, RefreshCw, Check, X, AlertTriangle } from 'lucide-react';
import { AiThinking } from '../common/AiThinking';
import type { PlanFieldResponse } from '../../lib/ai/coach-types';
import type { CoachResult } from '../../lib/ai/coach-client';
import { askPlanField, type PlanCoachContext } from '../../lib/ai/plan-coach';
import type { PlanFieldName } from '../../lib/ai/coach-types';

/**
 * The on-demand coach for one plan field.
 *
 * Deliberately a button and not an autocomplete: the coach is spent only when the trader
 * asks for it, and nothing it writes reaches the plan until they press "Use this draft".
 * The suggestion is shown with the facts it leaned on, so it can be checked rather than
 * taken on faith, and a failure leaves the field exactly as it was.
 */

interface PlanFieldCoachProps {
  field: PlanFieldName;
  /** The text currently in the field, so the coach builds on it instead of repeating it. */
  currentValue: string;
  context: PlanCoachContext;
  /** Writes the draft into the field. Only ever called from the button below. */
  onApply: (text: string) => void;
  /** Kept for a future locked-plan guard; the field itself stays editable today. */
  disabled?: boolean;
}

export const PlanFieldCoach: React.FC<PlanFieldCoachProps> = ({
  field,
  currentValue,
  context,
  onApply,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CoachResult | null>(null);

  const draft: PlanFieldResponse | null =
    result?.ok && 'suggestion' in result.data ? (result.data as PlanFieldResponse) : null;

  const handleAsk = async () => {
    setLoading(true);
    setResult(null);
    const outcome = await askPlanField(context, field, currentValue);
    setLoading(false);
    setResult(outcome);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        id={`coach-${field}-ask`}
        onClick={handleAsk}
        disabled={loading || disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-zinc-800 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        title="Ask the coach to draft this field from your journal and the live market"
      >
        {loading ? (
          <RefreshCw className="w-3 h-3 animate-spin" />
        ) : (
          <Sparkles className="w-3 h-3" />
        )}
        {loading ? 'Drafting…' : 'Ask the coach to draft this'}
      </button>

      {loading && (
        <AiThinking
          label="Reading your plan, your results and today's live prices…"
          steps={[
            'Reading your plan…',
            'Reading your results…',
            'Checking today\'s live prices…',
            'Drafting…',
          ]}
        />
      )}

      {!loading && draft && (
        <div
          id={`coach-${field}-draft`}
          className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 space-y-2"
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] font-mono uppercase font-bold text-amber-300">
              Coach draft — edit before saving
            </span>
          </div>

          <p className="text-xs text-amber-50/90 leading-relaxed">{draft.suggestion}</p>

          {draft.rationale && (
            <p className="text-[11px] text-zinc-300 leading-relaxed">
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">Why</span>
              {draft.rationale}
            </p>
          )}

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

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              id={`coach-${field}-apply`}
              onClick={() => {
                onApply(draft.suggestion);
                setResult(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-zinc-950 transition-colors"
            >
              <Check className="w-3 h-3 stroke-[3]" />
              Use this draft
            </button>
            <button
              type="button"
              onClick={handleAsk}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <RefreshCw className="w-3 h-3" />
              Ask again
            </button>
            <button
              type="button"
              id={`coach-${field}-dismiss`}
              onClick={() => setResult(null)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
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
                ? 'The coach is not available in this environment, so no draft could be written. Write this field yourself.'
                : `The coach could not answer (${result.code}). ${result.message}`}
            </span>
          </p>
          <button
            type="button"
            onClick={handleAsk}
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
