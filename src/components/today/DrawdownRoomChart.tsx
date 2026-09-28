import React, { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Info, ShieldCheck } from 'lucide-react';
import type { Trade } from '../../types';
import { buildRoomCurve } from '../../lib/analytics/risk-capacity';
import { realizedPnL } from '../../lib/analytics/realized-pnl';
import { money } from '../coach/coach-ui';

interface DrawdownRoomChartProps {
  /** The whole record; only the closed trades in it are plotted. */
  trades: Trade[];
  maxDrawdown?: number | null;
}

/**
 * How much drawdown room was left after each trade, so the strip above has a history.
 *
 * A single room figure answers \"what is left now\" and nothing else: it cannot show whether
 * this month's room was earned or inherited, and a number that only ever moves in one
 * direction is indistinguishable from one that is broken. The line puts the steps in order —
 * each win lifting the room, each loss pulling it back — which is what makes today's reading
 * mean something.
 *
 * Only closed trades are plotted: an open position has not booked anything, so it cannot
 * have left the account any room either way. The dashed line is the agreed drawdown, the
 * level the account has to stay above; the floor itself is at zero.
 *
 * Every step is net of fees, the reading the coach and the review trend use. A room limit is
 * enforced in the money that actually reached the account, so a line drawn on gross P&L
 * would credit the trader with fees they never kept.
 */
const THIN_SAMPLE = 5;

const axisMoney = (n: number) =>
  `$${Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export const DrawdownRoomChart: React.FC<DrawdownRoomChartProps> = ({
  trades,
  maxDrawdown,
}) => {
  const limit =
    typeof maxDrawdown === 'number' && Number.isFinite(maxDrawdown) && maxDrawdown > 0
      ? maxDrawdown
      : null;

  const points = useMemo(
    () =>
      buildRoomCurve(
        trades.filter((trade) => trade.status === 'closed'),
        maxDrawdown,
        realizedPnL
      ),
    [trades, maxDrawdown]
  );

  const current = points.length ? points[points.length - 1].room : null;
  const best = points.reduce<{ room: number; label: string } | null>(
    (top, point) => (!top || point.room > top.room ? { room: point.room, label: point.label } : top),
    null
  );
  const worst = points.reduce<{ room: number; label: string } | null>(
    (low, point) => (!low || point.room < low.room ? { room: point.room, label: point.label } : low),
    null
  );

  /**
   * The window the line is drawn in, kept close to the data rather than anchored at zero:
   * the moves worth seeing here are tens of dollars, and a domain starting at the floor
   * would flatten every one of them into a straight line.
   */
  const domain = useMemo<[number, number] | undefined>(() => {
    if (!points.length) return undefined;
    const values = points.map((point) => point.room);
    if (limit !== null) values.push(limit);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(25, Math.round((hi - lo) * 0.2));
    return [lo - pad, hi + pad];
  }, [points, limit]);

  const thin = points.length < THIN_SAMPLE;

  return (
    <div
      id="drawdown-room-chart"
      className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
          <ShieldCheck className="h-4 w-4 text-sky-400" />
          Drawdown room over time
        </h3>
        <span className="font-mono text-[11px] text-zinc-400">
          {points.length} closed trade{points.length === 1 ? '' : 's'}
        </span>
      </div>

      {limit === null ? (
        <p className="text-xs leading-relaxed text-zinc-400">
          No account drawdown is set, so there is no floor for room to be measured against. Set
          one in Analytics and the line starts here.
        </p>
      ) : points.length === 0 ? (
        <p className="text-xs leading-relaxed text-zinc-400">
          No closed trade yet, so there is nothing to chart. The first one puts a point on this
          line.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                Room now
              </span>
              <span className="font-mono text-sm font-bold text-sky-300">
                {money(current ?? 0)}
              </span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                Most room
              </span>
              <span className="font-mono text-sm font-bold text-emerald-300">
                {best ? money(best.room) : '—'}
              </span>
              <span className="block font-mono text-[10px] text-zinc-500">
                {best ? best.label : ''}
              </span>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                Least room
              </span>
              <span className="font-mono text-sm font-bold text-rose-300">
                {worst ? money(worst.room) : '—'}
              </span>
              <span className="block font-mono text-[10px] text-zinc-500">
                {worst ? worst.label : ''}
              </span>
            </div>
          </div>

          <div className="h-44 w-full" data-testid="room-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="roomGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={domain}
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  width={64}
                  tickFormatter={(value) => axisMoney(Number(value))}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const point = points.find((item) => item.label === String(label));
                    if (!point) return null;
                    return (
                      <div className="space-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 font-mono text-[11px] text-zinc-200">
                        <div className="text-zinc-400">{point.label}</div>
                        <div className="text-sky-300">Room {money(point.room)}</div>
                        <div className={point.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {money(point.pnl)} on this trade
                        </div>
                      </div>
                    );
                  }}
                />
                {/* The agreed figure: above it the account is on room it earned, below it on
                    the limit itself. */}
                <ReferenceLine
                  y={limit}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                  label={{
                    value: `agreed ${money(limit)}`,
                    position: 'insideTopRight',
                    fill: '#f59e0b',
                    fontSize: 10,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="room"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#roomGrad)"
                  dot={{ r: 2.5, fill: '#38bdf8', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[10px] leading-relaxed text-zinc-500">
            Room left after each closed trade, oldest first, net of fees. Above the dashed{' '}
            {money(limit)} the account is trading on room it earned; below it, on the limit it
            started with. The floor itself sits at zero.
          </p>

          {thin && (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-300/80">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Fewer than five closed trades behind this line, so its shape is not yet a finding.
            </p>
          )}
        </>
      )}
    </div>
  );
};
