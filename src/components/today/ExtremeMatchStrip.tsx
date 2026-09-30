import React, { useMemo } from 'react';
import { AlarmClock } from 'lucide-react';
import { SessionExtreme } from '../../types';
import {
  buildExtremeDays,
  findExtremeMatches,
  hourLabel,
  type ExtremeLean,
} from '../../lib/analytics/session-extremes';

/**
 * The on-the-day heads-up.
 *
 * The hour record is only worth something while the session is still open: the one moment
 * it applies is when this morning's extreme prints in an hour that has already happened
 * often enough to be readable. So this strip watches today's own logged print against the
 * trader's log and says, in their own counts, what that hour has done before.
 *
 * Two rules keep it honest:
 *
 * - It speaks only from a readable record. A tally of two sessions is not a heads-up, so an
 *   hour below the sample floor says nothing at all rather than something quiet.
 * - A coin toss is not a heads-up either. The module reports every readable match with the
 *   direction it leans in, and only a real lean is rendered here; a split hour is left to
 *   the card below, which shows its counts without pretending they point anywhere.
 *
 * Nothing in it is a signal. It reads the trader's own recorded sessions back to them and
 * stops — which is why the disclaimer is part of the strip rather than a footnote.
 */

export interface ExtremeMatchStripProps {
  extremes: SessionExtreme[];
  /** Today's trading date, in the trader's own calendar. */
  todayTradeDate: string;
}

/** A lean as the row's colour: the "kept" case is the one the strip exists to raise. */
const LEAN_TONE: Record<Exclude<ExtremeLean, 'split'>, { row: string; rate: string }> = {
  kept: { row: 'border-amber-900/60 bg-amber-950/20', rate: 'text-amber-300' },
  'taken-out': { row: 'border-zinc-800 bg-zinc-900/40', rate: 'text-zinc-300' },
};

/** What the record says the open did, in the trader's own words. */
function leanSentence(match: {
  symbol: string;
  kind: 'high' | 'low';
  hour: number;
  lean: ExtremeLean;
  pattern: { held: number; takenOut: number; heldRate: number | null; undecided: number };
}): string {
  const { pattern } = match;
  const decided = pattern.held + pattern.takenOut;
  const rate = pattern.heldRate === null ? '' : ` (${pattern.heldRate}%)`;
  const notJudged = pattern.undecided > 0 ? ` · ${pattern.undecided} session(s) not judged` : '';

  if (match.lean === 'kept') {
    return (
      `${match.symbol} overnight ${match.kind} printed ${hourLabel(match.hour)} — the open kept ` +
      `it in ${pattern.held} of ${decided} logged sessions${rate}${notJudged}.`
    );
  }
  return (
    `${match.symbol} overnight ${match.kind} printed ${hourLabel(match.hour)} — the open took ` +
    `it out in ${pattern.takenOut} of ${decided} logged sessions${rate}${notJudged}.`
  );
}

/** What today's regular session has already done with the print, once it is logged. */
function todaySentence(match: {
  kind: 'high' | 'low';
  todayRegularPrice: number | null;
  todayTakenOut: boolean | null;
}): string | null {
  if (match.todayRegularPrice === null || match.todayTakenOut === null) return null;
  const above = match.kind === 'high' ? 'above' : 'below';
  return match.todayTakenOut
    ? `Today's regular ${match.kind} is already ${above} it (${match.todayRegularPrice}).`
    : `Today's regular ${match.kind} has not gone ${above} it (${match.todayRegularPrice}).`;
}

export const ExtremeMatchStrip: React.FC<ExtremeMatchStripProps> = ({
  extremes,
  todayTradeDate,
}) => {
  const matches = useMemo(() => {
    const all = findExtremeMatches(buildExtremeDays(extremes), todayTradeDate);
    // A split hour is reported by the card below with its counts; it is not a heads-up.
    return all.filter((match) => match.lean !== 'split');
  }, [extremes, todayTradeDate]);

  if (matches.length === 0) return null;

  return (
    <div
      id="today-extreme-match"
      data-extreme-lean={matches[0].lean}
      className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5"
    >
      <div className="flex items-center gap-1.5">
        <AlarmClock className="h-3.5 w-3.5 text-amber-300" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Your log on this morning
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {matches.map((match) => {
          const tone = LEAN_TONE[match.lean as Exclude<ExtremeLean, 'split'>];
          const today = todaySentence(match);
          return (
            <div
              key={`${match.symbol}-${match.kind}-${match.hour}`}
              data-extreme-match={`${match.symbol}|${match.kind}|${match.hour}`}
              className={`rounded-lg border px-2.5 py-1.5 ${tone.row}`}
            >
              <p className="text-[11px] leading-relaxed text-zinc-300">
                {leanSentence(match)}
              </p>
              {today && (
                <p className={`font-mono text-[10px] leading-relaxed ${tone.rate}`}>{today}</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        Read from your own logged sessions — a count of what has happened, not a forecast, and
        not a reason to take a trade.
      </p>
    </div>
  );
};
