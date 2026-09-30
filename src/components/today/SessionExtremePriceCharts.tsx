import React, { useMemo } from 'react';
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExtremeKind, ExtremeLevelType, ExtremeRating, ExtremeTimeframe, Instrument, SessionExtreme } from '../../types';
import { HORIZON_LABEL, OUTCOME_LABEL, defaultLevelType, parseClock, TIMEFRAME_LABEL } from '../../lib/analytics/session-extremes';

interface PricePoint {
  id: string;
  x: number;
  y: number;
  time: string;
  symbol: string;
  kind: ExtremeKind;
  timeframe: ExtremeTimeframe;
  levelType: ExtremeLevelType;
  ratings: ExtremeRating[];
  notes?: string;
}

interface SessionExtremePriceChartsProps {
  extremes: SessionExtreme[];
  tradeDate: string;
  timeframe: ExtremeTimeframe;
  instruments: Instrument[];
}

/** Places the futures session's 6pm reopen before midnight on the horizontal axis. */
function sessionMinute(clockMinute: number): number {
  return clockMinute >= 18 * 60 ? clockMinute - 24 * 60 : clockMinute;
}

function timeLabel(value: number): string {
  const minute = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:00`;
}

/** Sparse user-entered extremes for each market, deliberately not connected into a line. */
export const SessionExtremePriceCharts: React.FC<SessionExtremePriceChartsProps> = ({
  extremes,
  tradeDate,
  timeframe,
  instruments,
}) => {
  const series = useMemo(() => {
    const bySymbol = new Map<string, PricePoint[]>();
    for (const extreme of extremes) {
      if (extreme.tradeDate !== tradeDate || extreme.symbol === '') continue;
      if ((extreme.timeframe ?? '1m') !== timeframe || !Number.isFinite(extreme.price)) continue;
      const minute = parseClock(extreme.time);
      if (minute === null) continue;
      const point: PricePoint = {
        id: extreme.id,
        x: sessionMinute(minute),
        y: extreme.price,
        time: extreme.time,
        symbol: extreme.symbol,
        kind: extreme.kind,
        timeframe: extreme.timeframe ?? '1m',
        levelType: extreme.levelType ?? defaultLevelType(extreme.kind),
        ratings: extreme.ratings ?? [],
        notes: extreme.notes,
      };
      const points = bySymbol.get(point.symbol) ?? [];
      points.push(point);
      bySymbol.set(point.symbol, points);
    }
    for (const points of bySymbol.values()) points.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    return bySymbol;
  }, [extremes, tradeDate, timeframe]);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {instruments.map((instrument) => {
        const points = series.get(instrument.symbol) ?? [];
        const highs = points.filter((point) => point.kind === 'high');
        const lows = points.filter((point) => point.kind === 'low');
        return (
          <div
            key={instrument.id}
            data-extreme-price-chart={instrument.symbol}
            data-extreme-chart-count={points.length}
            className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2"
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="font-mono text-xs font-bold text-zinc-200">{instrument.symbol}</span>
              <span className="font-mono text-[9px] text-zinc-500">
                {points.length} point{points.length === 1 ? '' : 's'}
              </span>
            </div>
            {points.length === 0 ? (
              <p className="flex h-36 items-center justify-center text-[10px] italic text-zinc-600">
                No points for this session
              </p>
            ) : (
              <div className="h-36 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Time (ET)"
                      domain={[-360, 960]}
                      ticks={[-360, 0, 360, 720, 960]}
                      tickFormatter={(value) => timeLabel(Number(value))}
                      stroke="#71717a"
                      fontSize={9}
                      tickLine={false}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Price"
                      domain={['auto', 'auto']}
                      tickFormatter={(value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      stroke="#71717a"
                      fontSize={9}
                      tickLine={false}
                      width={58}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        const point = payload?.[0]?.payload as PricePoint | undefined;
                        if (!active || !point) return null;
                        return (
                          <div className="max-w-56 space-y-0.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 font-mono text-[10px] text-zinc-200 shadow-xl">
                            <div>{point.time} ET · {point.symbol} {point.kind} · {point.y}</div>
                            <div className="text-zinc-400">{point.levelType} · {TIMEFRAME_LABEL[point.timeframe]}</div>
                            {point.ratings.map((rating) => (
                              <div key={rating.horizon} className="text-emerald-300">
                                {HORIZON_LABEL[rating.horizon]}: {OUTCOME_LABEL[rating.outcome]}{rating.grade ? ` · ${rating.grade}/5` : ''}
                              </div>
                            ))}
                            {point.notes && <div className="text-zinc-500">{point.notes}</div>}
                          </div>
                        );
                      }}
                    />
                    <Scatter name="High" data={highs} fill="#fbbf24" fillOpacity={0.9} />
                    <Scatter name="Low" data={lows} fill="#38bdf8" fillOpacity={0.9} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex justify-center gap-3 font-mono text-[9px] text-zinc-500">
              <span className="text-amber-300">● High</span>
              <span className="text-sky-300">● Low</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
