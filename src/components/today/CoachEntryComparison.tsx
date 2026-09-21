import React from 'react';
import { ArrowLeftRight, Check, X, Minus, Scale } from 'lucide-react';
import type { Instrument, Trade } from '../../types';
import {
  summariseEntryComparisons,
  verdictLabel,
  type ComparisonVerdict,
} from '../../lib/ai/entry-comparison';
import { formatQuotePrice } from '../../lib/ai/plan-coach';
import { instrumentSymbol } from '../../lib/trading/instruments';

/**
 * The day's scoreboard: the coach's call on each entry against the trader's own.
 *
 * It is shown without a verdict on who "won", because the honest answer is not in the
 * price alone — agreeing on direction and still losing is a different lesson from being
 * opposed and right. The card reports direction agreement and the fill difference and
 * leaves the reading to the trader.
 */

interface CoachEntryComparisonProps {
  trades: Trade[];
  instruments: Instrument[];
}

const VERDICT_STYLES: Record<ComparisonVerdict, { className: string; icon: React.ReactNode }> = {
  agreed: {
    className: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
    icon: <Check className="w-3 h-3" />,
  },
  opposed: {
    className: 'bg-rose-950/70 text-rose-300 border-rose-800',
    icon: <X className="w-3 h-3" />,
  },
  'coach-flat': {
    className: 'bg-amber-950/70 text-amber-300 border-amber-800',
    icon: <Minus className="w-3 h-3" />,
  },
  'no-call': {
    className: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    icon: <Minus className="w-3 h-3" />,
  },
};

export const CoachEntryComparison: React.FC<CoachEntryComparisonProps> = ({
  trades,
  instruments,
}) => {
  const summary = summariseEntryComparisons(trades);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5 backdrop-blur-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-2">
          <Scale className="w-4 h-4 text-zinc-300" />
          Coach vs your entries
        </h3>
        {summary.compared > 0 && (
          <span className="text-[11px] font-mono text-zinc-400" id="coach-comparison-summary">
            {summary.agreed} agreed · {summary.opposed} opposed
            {summary.coachFlat > 0 ? ` · ${summary.coachFlat} flat` : ''}
            {summary.agreementRate !== null ? ` · ${summary.agreementRate}% same side` : ''}
            {summary.avgTraderEdgePoints !== null
              ? ` · you filled ${summary.avgTraderEdgePoints >= 0 ? '+' : ''}${summary.avgTraderEdgePoints} pts better on average`
              : ''}
          </span>
        )}
      </div>

      {summary.compared === 0 ? (
        <p className="text-xs text-zinc-400 leading-relaxed">
          The coach records its own call — side, entry, stop and target — every time you save a
          new entry, and compares it with yours here. Nothing is recorded yet
          {trades.length > 0 ? ' for today\u2019s trades' : ''}; this needs the coach service, so
          it works on the deployed site rather than a local dev server.
        </p>
      ) : (
        <ul className="space-y-2" id="coach-comparison-list">
          {summary.comparisons.map((comparison) => {
            const style = VERDICT_STYLES[comparison.verdict];
            const trade = trades.find((t) => t.id === comparison.tradeId);
            const label = trade?.setupName ? ` · ${trade.setupName}` : '';
            return (
              <li
                key={comparison.tradeId}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-zinc-300 flex items-center gap-1.5">
                    <ArrowLeftRight className="w-3 h-3 text-zinc-500" />
                    {trade
                      ? `${comparison.traderDirection.toUpperCase()} ${trade.contracts} ${instrumentSymbol(instruments, trade.instrumentId)}`
                      : comparison.traderDirection.toUpperCase()}
                    <span className="text-zinc-500">
                      @ {formatQuotePrice(comparison.traderEntry)}
                      {label}
                    </span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase font-mono ${style.className}`}
                  >
                    {style.icon}
                    {verdictLabel(comparison.verdict)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-zinc-400">
                  <span>
                    coach:{' '}
                    <span className="text-zinc-200 font-bold">
                      {comparison.coachDirection === 'flat'
                        ? 'would stand aside'
                        : `${comparison.coachDirection?.toUpperCase() ?? '—'} ${
                            comparison.coachEntry === null
                              ? ''
                              : `@ ${formatQuotePrice(comparison.coachEntry)}`
                          }`}
                    </span>
                  </span>
                  {comparison.priceEdge !== null && (
                    <span>
                      your fill:{' '}
                      <span
                        className={
                          comparison.priceEdge >= 0
                            ? 'text-emerald-400 font-bold'
                            : 'text-rose-400 font-bold'
                        }
                      >
                        {comparison.priceEdge >= 0 ? '+' : ''}
                        {comparison.priceEdge} pts {comparison.priceEdge >= 0 ? 'better' : 'worse'}
                      </span>
                    </span>
                  )}
                </div>

                {comparison.rationale && (
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{comparison.rationale}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] text-zinc-500 leading-relaxed">
        Direction agreement and fill difference only — being on the same side is not the same as
        being right, and the coach's call is one opinion from one moment.
      </p>
    </div>
  );
};
