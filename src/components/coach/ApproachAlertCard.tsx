import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import type { ImportantLevel } from '../../types';
import type { InstrumentQuote } from '../../lib/ai/market-data';
import { fetchInstrumentQuote, formatQuotePrice } from '../../lib/ai/plan-coach';
import { formatLevelPrice } from '../../lib/trading/instruments';
import {
  findLevelApproaches,
  NEAR_LEVEL_POINTS,
  type ApproachState,
} from '../../lib/analytics/level-approach';
import { CoachCard, CoachFact } from './coach-ui';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * Which of today's levels price is closing on.
 *
 * The trader's setups are conditions on a level, so the useful warning is never "a setup
 * is about to happen" in the abstract — it is "price is six points under the level you
 * wrote down this morning". This card is the measurement behind that sentence.
 *
 * It reads today's marked levels, not the touch log, and that is the whole point: a touch is
 * written down once price is already there, which is too late to be a warning. The levels on
 * the Today tab are the only forward-looking record the journal has.
 *
 * Nothing here is a prediction and nothing here is the model. It is arithmetic against a
 * live price, and when the price is missing it says so rather than implying a distance.
 */

export interface ApproachAlertCardProps {
  /** Today's marked levels, as set on the Today tab. */
  levels: ImportantLevel[];
  /** The contract the levels are measured against, e.g. MES. */
  symbol: string;
  /** The trader's own zone, so the time the price was read is their local one. */
  timezone: string;
}

/** How close counts as what, said in words rather than implied by a colour alone. */
const STATE_STYLE: Record<ApproachState, { label: string; className: string }> = {
  at: { label: 'at the level', className: 'bg-amber-950/80 text-amber-300 border-amber-800' },
  near: { label: 'close', className: 'bg-emerald-950/80 text-emerald-300 border-emerald-800' },
  further: { label: 'further out', className: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
};

export const ApproachAlertCard: React.FC<ApproachAlertCardProps> = ({
  levels,
  symbol,
  timezone,
}) => {
  const [quote, setQuote] = useState<InstrumentQuote | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(async () => {
    setLoading(true);
    const read = await fetchInstrumentQuote(symbol);
    setQuote(read);
    setCheckedAt(new Date().toISOString());
    setLoading(false);
  }, [symbol]);

  /**
   * One read as the tab opens, so the trader is met with a measurement rather than a
   * button. The request is free and the reading is time-sensitive, unlike the coach's
   * writing, which is only ever spent on a deliberate click.
   */
  useEffect(() => {
    void check();
  }, [check]);

  const approaches = useMemo(() => findLevelApproaches(levels, quote), [levels, quote]);
  const price = quote?.ok ? quote.price : null;
  const nearest = approaches[0];

  /** Why there is no price to measure against, once a read has actually been attempted. */
  const failure =
    checkedAt && !loading
      ? !quote
        ? 'Live prices could not be reached from this environment. This needs the deployed site, where the market endpoint runs.'
        : !quote.ok
        ? quote.note ?? 'The live read came back without a price.'
        : null
      : null;

  return (
    <CoachCard id="coach-approach" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <BellRing className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Setups about to happen
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Where price is against the levels you set for today. Read once when this tab opens
            and any time you press the button — pure arithmetic, no forecast, and nothing
            watched in the background.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CoachFact label="Levels today" value={`${levels.length}`} />
        <CoachFact label="Live price" value={price === null ? '—' : formatQuotePrice(price)} />
        <CoachFact label="Nearest" value={nearest ? `${nearest.distancePoints} pts` : '—'} />
        <CoachFact
          label="Checked"
          value={checkedAt ? formatTimestamp(checkedAt, timezone) : 'not yet'}
        />
      </div>

      {levels.length === 0 ? (
        <p id="coach-approach-empty" className="text-xs italic text-zinc-500">
          No levels are set for today. Mark the prices you are watching on the Today tab and
          this will measure price against them.
        </p>
      ) : (
        <>
          {nearest && price !== null && (
            <p id="coach-approach-nearest" className="text-xs leading-relaxed text-zinc-300">
              Closest is{' '}
              <span className="font-mono text-zinc-100">{formatLevelPrice(nearest.price)}</span>
              {nearest.label ? ` (${nearest.label})` : ''} —{' '}
              <span className="font-mono">{nearest.distancePoints}</span> points{' '}
              {nearest.above ? 'above' : 'below'} {symbol} at{' '}
              <span className="font-mono">{formatQuotePrice(price)}</span>.
            </p>
          )}

          {failure && (
            <div
              id="coach-approach-error"
              className="rounded-xl border border-amber-900/60 bg-amber-950/20 px-3.5 py-2.5"
            >
              <p className="text-[11px] leading-relaxed text-amber-200/90">{failure}</p>
            </div>
          )}

          <button
            id="coach-approach-check"
            type="button"
            onClick={check}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {loading ? 'Reading the price…' : checkedAt ? 'Check again' : 'Check the live price'}
          </button>

          {price !== null && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Your levels, nearest first
              </span>
              <ul id="coach-approach-list" className="space-y-1.5">
                {approaches.map((approach) => (
                  <li
                    key={approach.id}
                    id={`coach-approach-${approach.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {approach.above ? (
                        <ArrowUp className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-zinc-200">
                          {approach.label || 'Level'}
                        </span>
                        <span className="block font-mono text-[10px] text-zinc-500">
                          level {formatLevelPrice(approach.price)} · {approach.distancePoints} pts{' '}
                          {approach.above ? 'above' : 'below'} price
                        </span>
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase font-bold ${
                        STATE_STYLE[approach.state].className
                      }`}
                    >
                      {STATE_STYLE[approach.state].label}
                    </span>
                  </li>
                ))}
              </ul>
              {approaches.some((approach) => approach.state === 'further') && (
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Levels beyond {NEAR_LEVEL_POINTS} points are still listed, with their true
                  distance — the threshold only picks the word, never what you can see.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </CoachCard>
  );
};
