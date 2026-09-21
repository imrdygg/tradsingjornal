import React from 'react';
import { AlertTriangle, ShieldCheck, ChevronRight } from 'lucide-react';
import {
  drawdownShortfall,
  type PlannedSizeRisk,
  type RiskCapacity,
  type RiskStance,
} from '../../lib/analytics/risk-capacity';

interface DrawdownRoomStripProps {
  capacity: RiskCapacity;
  /**
   * The day's planned size measured against the room, when it does not fit. Null means the
   * size is affordable, or that there is no stop distance to judge it by.
   */
  plannedSize?: PlannedSizeRisk | null;
  /** Opens the full risk panel. The strip is a reminder, not the place to edit numbers. */
  onOpenRisk?: () => void;
}

const TONES: Record<RiskStance, { badge: string; label: string }> = {
  'limit-reached': {
    badge: 'border-rose-800/70 bg-rose-950/50 text-rose-200',
    label: 'Limit reached',
  },
  defensive: {
    badge: 'border-amber-800/70 bg-amber-950/50 text-amber-200',
    label: 'Tight room',
  },
  normal: {
    badge: 'border-zinc-700 bg-zinc-900/70 text-zinc-300',
    label: 'Normal room',
  },
  ample: {
    badge: 'border-emerald-800/70 bg-emerald-950/50 text-emerald-200',
    label: 'Ample room',
  },
};

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * The account's remaining drawdown room, sitting beside today's plan.
 *
 * The plan says what today is allowed to risk; this says whether the account can still
 * afford it. They are different questions and the second one is invisible from the Today
 * tab — the plan's loss limit can look unchanged while the room behind it is nearly gone.
 *
 * Deliberately one line, and deliberately read-only: it is a reminder on the screen the
 * trader already opens every morning, and editing the limit belongs where the numbers that
 * explain it are.
 */
export const DrawdownRoomStrip: React.FC<DrawdownRoomStripProps> = ({
  capacity,
  plannedSize,
  onOpenRisk,
}) => {
  const {
    maxDrawdown,
    headroom,
    headroomPct,
    daysOfHeadroom,
    dailyLossLimit,
    stance,
    drawdownUsed,
  } = capacity;
  const tone = TONES[stance];
  // Today's plan against the room behind it — the one comparison neither number makes alone.
  const shortfall = drawdownShortfall(capacity, dailyLossLimit);

  if (maxDrawdown === null) {
    return (
      <button
        type="button"
        id="drawdown-room"
        onClick={onOpenRisk}
        className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5 text-left transition-colors hover:border-zinc-700"
      >
        <span className="flex flex-wrap items-center gap-2 text-[11px]">
          <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
          <span className="font-mono uppercase tracking-wider text-[10px] text-zinc-400">
            Account drawdown
          </span>
          <span className="text-zinc-300">
            No max drawdown set, so today's risk has nothing to be measured against.
          </span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
            Set it in Analytics
            <ChevronRight className="h-3 w-3" />
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      id="drawdown-room"
      className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5"
      data-stance={stance}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
          <span className="uppercase tracking-wider text-[10px] text-zinc-400">
            Drawdown room
          </span>
        </span>

        <span className="text-zinc-100">
          <span className="font-bold text-sky-300">{money(headroom ?? 0)}</span>
          <span className="text-zinc-500"> left of {money(maxDrawdown)}</span>
        </span>

        <span className="text-zinc-400">
          used {money(drawdownUsed)}
          {headroomPct === null ? '' : ` (${headroomPct}% left)`}
        </span>

        {daysOfHeadroom !== null && dailyLossLimit !== null && (
          <span className="text-zinc-400">
            ≈ <span className="text-zinc-200 font-bold">{daysOfHeadroom}</span> more losing day
            {daysOfHeadroom === 1 ? '' : 's'} at today's {money(dailyLossLimit)} limit
          </span>
        )}

        <span
          className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${tone.badge}`}
        >
          {tone.label}
        </span>
      </div>

      {/* The day's own limit against the floor — the plan's numbers, read first. */}
      {shortfall && (
        <div
          className="mt-2 flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200"
          role="alert"
          data-testid="drawdown-shortfall"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
          <span>
            <span className="font-bold uppercase tracking-wider text-[10px] block">
              Today's plan exceeds the drawdown room
            </span>
            {shortfall.limitReached
              ? `The agreed ${money(maxDrawdown)} drawdown is already spent, so today's ${money(
                  shortfall.plannedLoss
                )} plan has no room behind it at all.`
              : `Today's plan allows a ${money(
                  shortfall.plannedLoss
                )} loss, but only ${money(
                  shortfall.headroom
                )} of drawdown room is left. One full losing day at the plan would take the account ${money(
                  shortfall.over
                )} through the agreed ${money(maxDrawdown)}.`}
          </span>
        </div>
      )}

      {/*
        Then the size that plan describes, priced at the trader's own stop distance. A
        different failure: the limit is what they are willing to lose, this is what the
        position would actually cost if their own stop got hit.
      */}
      {plannedSize && (
        <div
          className="mt-2 flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200"
          role="alert"
          data-testid="planned-size-over-room"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
          <span>
            <span className="font-bold uppercase tracking-wider text-[10px] block">
              Today's size is larger than the drawdown room
            </span>
            {plannedSize.contracts} {plannedSize.symbol} at{' '}
            {plannedSize.stopPoints}-point stop risk{' '}
            {money(plannedSize.dollarsAtRisk)} if the stop is honoured, and only{' '}
            {money(plannedSize.headroom)} of drawdown room is left —{' '}
            {money(plannedSize.over)} of it has nothing behind it.{' '}
            <span className="text-rose-300/70">
              {plannedSize.stopSource === 'open-position'
                ? `Stop distance taken from the ${plannedSize.symbol} position you have open now.`
                : `Stop distance from your median across ${plannedSize.stopSample} recent ${plannedSize.symbol} trades.`}
            </span>
          </span>
        </div>
      )}

    </div>
  );
};
