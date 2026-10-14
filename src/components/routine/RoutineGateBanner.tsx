import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DayRoutine } from '../../types';
import { routineProgress } from '../../lib/routine/routine-progress';

/**
 * The routine, in the form where the trade is actually recorded.
 *
 * The checklist on Today is the trader's own screen; this is the same reading placed at the
 * one moment it can still do something about it. It is a warning and never a wall, for the
 * reason the plan's cap warning gives: a form that refuses a trade is one the trader works
 * around, and a trade recorded through an incomplete routine is the most useful entry the
 * journal can hold, because it is the one that makes the comparison at the top of the Today
 * card mean anything.
 *
 * Nothing is rendered when there is nothing to say. A prepared day shows a quiet line, an
 * unprepared one shows which critical steps are missing by name, and a day whose routine was
 * never opened shows the plain statement that it was never opened.
 */
export interface RoutineGateBannerProps {
  /** Today's routine record, when the day has one. */
  routine?: DayRoutine | null;
}

export const RoutineGateBanner: React.FC<RoutineGateBannerProps> = ({ routine }) => {
  const progress = useMemo(() => routineProgress(routine), [routine]);
  const outstanding = progress.criticalOutstanding;

  if (outstanding.length === 0) {
    return (
      <p
        data-testid="routine-gate-ok"
        className="flex items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-2.5 py-1.5 text-[10px] leading-relaxed text-emerald-300"
      >
        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
        <span>
          Desk routine prepared — every critical step is done ({progress.done}/{progress.total}{' '}
          steps ticked).
        </span>
      </p>
    );
  }

  return (
    <p
      data-testid="routine-gate-warning"
      role="alert"
      className="flex items-start gap-1.5 rounded-lg border border-amber-800/70 bg-amber-950/40 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
      <span>
        {/*
          The steps are named in both states, not only when the routine is half done. A day
          nobody has opened and a day half-prepared call for the same action, and the trader
          should be able to read what is missing without leaving the form to go and look.
        */}
        <strong className="font-semibold">
          {progress.readiness === 'not-started'
            ? `The desk routine has not been started today — ${outstanding.length} critical routine step${
                outstanding.length === 1 ? '' : 's'
              } outstanding: `
            : `${outstanding.length} critical routine step${
                outstanding.length === 1 ? '' : 's'
              } outstanding: `}
        </strong>
        {outstanding.map((step) => step.label).join(' · ')}. It is still recorded — the plan is
        what you are trading without.
      </span>
    </p>
  );
};
