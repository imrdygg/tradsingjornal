import React, { useMemo } from 'react';
import { Lightbulb, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Trade, TradingDay } from '../../types';
import { generateDeterministicInsights } from '../../lib/analytics/insights';

interface InsightsViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
}

export const InsightsView: React.FC<InsightsViewProps> = ({ trades, tradingDays }) => {
  const insights = useMemo(() => {
    return generateDeterministicInsights(trades, tradingDays);
  }, [trades, tradingDays]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          Deterministic Performance Insights
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Grounded historical observations based strictly on your recorded facts. Never makes market predictions or generates trade signals.
        </p>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-zinc-400 text-xs">
          Not enough historical trades to compute observations yet. Log more trades and reviews to surface patterns.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {insights.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                  {item.category}
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    item.sampleVariant === 'success'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                      : item.sampleVariant === 'warning'
                      ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                      : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                  }`}
                >
                  {item.sampleLabel} ({item.sampleSize} trades)
                </span>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{item.title}</h3>
                <p className="text-xs text-zinc-300 mt-1 leading-relaxed">
                  {item.statement}
                </p>
              </div>

              <div className="pt-1 font-mono text-xs font-semibold text-zinc-200 flex items-center justify-between border-t border-zinc-800/80">
                <span className="text-zinc-500 text-[11px]">Metric Highlight:</span>
                <span
                  className={
                    item.isPositive === true
                      ? 'text-emerald-400'
                      : item.isPositive === false
                      ? 'text-rose-400'
                      : 'text-zinc-300'
                  }
                >
                  {item.metricHighlight}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
