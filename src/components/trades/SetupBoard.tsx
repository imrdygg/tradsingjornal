import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Trophy } from 'lucide-react';
import { ShareRing, moneyTone, signedMoney } from '../insights/insights-charts';
import type { EquityPoint } from '../../lib/analytics/insights-series';

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

/** The box a sparkline is drawn in, in its own viewBox units. */
const SPARK_W = 100;
const SPARK_H = 30;
const SPARK_PAD = 3;

/**
 * One setup's own record, as a line small enough to sit inside its card.
 *
 * Hand-drawn rather than put through the charting library: this is a few dozen points read as
 * a shape, and a chart instance per card would spend an axis, a tooltip and a legend to say
 * what one stroke already says. Faint at rest and solid on hover, so a sweep across the board
 * reads each setup's own story without the trader having to leave the tab.
 *
 * Two things are deliberate. Zero is always in frame, so a setup that spent its whole record
 * under water looks like that rather than like a curve that merely slopes the other way. And
 * the fill is drawn between the line and zero, not down to the bottom of the box, because a
 * filled area below a losing line reads as profit at a glance — which is the one impression
 * this board must never give.
 */
const SetupSparkline: React.FC<{ points: EquityPoint[]; name: string }> = ({ points, name }) => {
  const geo = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((point) => point.cumulative);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    // A curve that never moved still gets a line rather than a division by zero.
    const span = max - min || 1;
    const sx = (index: number) => (index / (points.length - 1)) * SPARK_W;
    const sy = (value: number) => SPARK_PAD + ((max - value) / span) * (SPARK_H - SPARK_PAD * 2);

    const line = values
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${sx(index).toFixed(2)},${sy(value).toFixed(2)}`)
      .join(' ');
    const zero = Number(sy(0).toFixed(2));
    // The best this setup ever stood at, taken from its own values rather than from the box:
    // a setup that only ever lost money has no peak at zero, and looking for one there would
    // put the marker on a point that does not exist.
    const bestValue = Math.max(...values);
    const peakIndex = values.indexOf(bestValue);

    return {
      line,
      area: `${line} L${SPARK_W},${zero} L0,${zero} Z`,
      zero,
      crosses: min < 0,
      peak: points[peakIndex],
      /** The peak marker, as percentages of the strip it is drawn over. */
      peakLeft: (sx(peakIndex) / SPARK_W) * 100,
      peakTop: (sy(bestValue) / SPARK_H) * 100,
    };
  }, [points]);

  if (!geo) {
    return (
      <p className="font-mono text-[9px] leading-8 text-zinc-600">
        {points.length === 1 ? 'One trade so far — no curve to draw yet' : 'No closed trades yet'}
      </p>
    );
  }

  return (
    <div data-setup-spark={name} className="space-y-1">
      <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600 transition-colors group-hover:text-zinc-400 group-focus-visible:text-zinc-400">
        <span>its own curve</span>
        <span>
          peak <span className={moneyTone(geo.peak.cumulative)}>{signedMoney(geo.peak.cumulative)}</span>
        </span>
      </div>

      <div className="relative h-8">
        <svg
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          className={`h-8 w-full ${points[points.length - 1].cumulative >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}
          aria-hidden="true"
        >
          <path
            d={geo.area}
            fill="currentColor"
            className="opacity-0 transition-opacity group-hover:opacity-15 group-focus-visible:opacity-15"
          />
          <path
            d={geo.line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className="opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
          {geo.crosses && (
            <line
              x1={0}
              x2={SPARK_W}
              y1={geo.zero}
              y2={geo.zero}
              stroke="#52525b"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          )}
        </svg>

        {/* Where this setup's best moment was, marked only while the card is being read. */}
        <span
          title={`Best point: ${signedMoney(geo.peak.cumulative)} on trade ${geo.peak.index}`}
          className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ left: `${geo.peakLeft}%`, top: `${geo.peakTop}%` }}
        />
      </div>
    </div>
  );
};

export const SetupBoard: React.FC<{
  rows: SetupBoardRow[];
  /** Each setup's own equity sequence, keyed by setup name. */
  curves?: Record<string, EquityPoint[]>;
  /** The setup currently isolated in the log, if any. */
  activeSetup: string | null;
  onSelectSetup: (name: string) => void;
  id?: string;
}> = ({ rows, curves, activeSetup, onSelectSetup, id = 'setup-board' }) => {
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
          biggest first · hover one for its own curve · pick one to filter the log
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
              className={`group space-y-2.5 rounded-2xl border p-3.5 text-left transition-all ${
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

              {/* How this setup got to that number, not just where it ended up. */}
              <SetupSparkline points={curves?.[row.name] ?? []} name={row.name} />

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
