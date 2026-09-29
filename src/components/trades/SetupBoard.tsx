import React from 'react';
import { ArrowDownRight, ArrowUpRight, Trophy } from 'lucide-react';
import { ShareRing, moneyTone, signedMoney } from '../insights/insights-charts';

/**
 * Which setups are winning, as a board rather than a dropdown.
 *
 * A setup name in a select tells a trader nothing: the question behind the tab is which of
 * these two patterns is worth the screen time, and that is a comparison — a number against a
 * number, side by side. Each setup gets a card carrying the three readings that decide it —
 * what it paid, how often it paid, and what a trade in it is worth on average — scaled against
 * the best setup in the journal so the gap between first and second is the thing the eye
 * catches first.
 *
 * The cards are the filter: picking one isolates that setup in the log below, which keeps the
 * two halves of the tab talking about the same trades. Nothing here predicts which setup will
 * keep working — it is the same closing record the rest of the app counts from.
 */

export interface SetupBoardRow {
  /** The setup's name, as the playbook spells it. */
  name: string;
  /** Closed trades taken under it. */
  trades: number;
  /** Wins as a share of those trades, 0–100. */
  winRate: number;
  /** Mean R across them. */
  avgR: number;
  /** Gross P&L across them. */
  pnl: number;
  /** Gross wins over gross losses, or null with nothing to divide by. */
  profitFactor: number | null;
}

export const SetupBoard: React.FC<{
  rows: SetupBoardRow[];
  /** The setup currently isolated in the log, if any. */
  activeSetup: string | null;
  onSelectSetup: (name: string) => void;
  id?: string;
}> = ({ rows, activeSetup, onSelectSetup, id = 'setup-board' }) => {
  const sorted = [...rows].sort((a, b) => b.pnl - a.pnl);
  const max = Math.max(1, ...sorted.map((row) => Math.abs(row.pnl)));
  // The best of the board, not merely the first: a journal with only losing setups has no
  // winner to crown, and inventing one would be the flattering read this tab exists to avoid.
  const best = sorted.find((row) => row.pnl > 0) ?? null;

  return (
    <section id={id} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
            Which setups are winning
          </h2>
        </div>
        <span className="font-mono text-[10px] text-zinc-500">
          biggest first · pick one to filter the log
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((row) => {
          const active = activeSetup === row.name;
          const isBest = best !== null && best.name === row.name;
          const barWidth = (Math.abs(row.pnl) / max) * 100;

          return (
            <button
              key={row.name}
              type="button"
              data-setup-board={row.name}
              aria-pressed={active}
              onClick={() => onSelectSetup(row.name)}
              title={
                active
                  ? `Stop filtering the log to ${row.name}`
                  : `Show only ${row.name} trades in the log`
              }
              className={`space-y-2.5 rounded-2xl border p-3.5 text-left transition-all ${
                active
                  ? 'border-emerald-600/70 bg-emerald-950/30 shadow-sm'
                  : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900/80'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-zinc-100">
                      {row.name}
                    </span>
                    {isBest && (
                      <span className="shrink-0 rounded border border-amber-800 bg-amber-950/70 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-amber-300">
                        Best
                      </span>
                    )}
                  </div>
                  <span className="mt-0.5 flex items-baseline gap-1 font-mono">
                    {row.pnl >= 0 ? (
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    )}
                    <span className={`text-base font-bold leading-tight ${moneyTone(row.pnl)}`}>
                      {signedMoney(row.pnl)}
                    </span>
                  </span>
                </div>

                <ShareRing
                  pct={row.winRate}
                  center={`${row.winRate}%`}
                  color={row.pnl > 0 ? '#10b981' : row.pnl < 0 ? '#f43f5e' : '#a1a1aa'}
                  caption="win rate"
                  size="h-14 w-14"
                />
              </div>

              {/* The result, scaled against the best setup in the journal. */}
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${
                    row.pnl > 0 ? 'bg-emerald-500/80' : 'bg-rose-500/80'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10px] text-zinc-500">
                <span>
                  {row.trades} trade{row.trades === 1 ? '' : 's'}
                </span>
                <span>·</span>
                <span>{row.avgR}R avg</span>
                <span>·</span>
                <span>
                  PF {row.profitFactor === null ? '—' : row.profitFactor.toFixed(2)}
                </span>
              </div>

              <span
                className={`inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                  active ? 'text-emerald-300' : 'text-zinc-500'
                }`}
              >
                {active ? 'Showing only these' : 'Show these trades'}
              </span>
            </button>
          );
        })}
      </div>

      {sorted.length === 1 && (
        <p className="text-[10px] leading-relaxed text-zinc-500">
          One setup on the board, so there is nothing to compare it against yet. A second one —
          taken, logged and closed — is what turns this into a ranking.
        </p>
      )}
    </section>
  );
};
