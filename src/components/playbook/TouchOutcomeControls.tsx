import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { LevelTouch, TouchBreakDirection, TouchOutcome } from '../../types';

/**
 * Deciding what a level touch did.
 *
 * A touch cannot be judged when it happens. It is written down the moment price reaches a
 * line, while the answer still lies ahead: price either breaks away and stays away, or comes
 * back inside the level's zone. So this is the second half of the record — the controls that
 * turn a `watching` touch into one of the two answers the whole edge read is built on, plus the
 * direction price left in and the time the answer was reached.
 *
 * `watching` and `void` are as reachable as the two answers on purpose. A trader who can only
 * record a finished outcome starts deciding early, and a record of premature calls is worse
 * than a short one.
 *
 * Shared so the same controls appear wherever a touch can be decided — inline on a marked line,
 * and in the standalone touch log.
 */

export const TOUCH_OUTCOME_BUTTONS: Array<{
  value: TouchOutcome;
  label: string;
  title: string;
  tone: string;
}> = [
  {
    value: 'watching',
    label: 'Still watching',
    title: 'Price has not broken the level yet, or you have not looked again',
    tone: 'bg-zinc-800 text-zinc-200 border-zinc-700',
  },
  {
    value: 'never-returned',
    label: 'Never came back',
    title: 'Price broke the level and has not traded back inside the zone since',
    tone: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
  },
  {
    value: 'returned',
    label: 'Came back',
    title: 'Price broke the level and then traded back inside the zone — the break did not hold',
    tone: 'bg-rose-950/70 text-rose-300 border-rose-900/80',
  },
  {
    value: 'invalid',
    label: 'Void',
    title: 'Set aside — a mis-marked level or a bad print. Excluded from every rate',
    tone: 'bg-zinc-900 text-zinc-400 border-zinc-800',
  },
];

/**
 * Where price went when it left the level, as the trader records it.
 *
 * Offered instead of assuming the direction from the level's own side: price breaks a support
 * upward and a resistance downward often enough that the record has to be able to say which
 * happened, not infer it. Neither is preselected — a guess the trader did not make would be
 * quoted back as their own observation.
 */
export const TOUCH_BREAK_DIRECTIONS: Array<{
  value: TouchBreakDirection;
  label: string;
  title: string;
  tone: string;
}> = [
  {
    value: 'up',
    label: 'Broke up',
    title: 'Price left the level to the upside, above the zone',
    tone: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
  },
  {
    value: 'down',
    label: 'Broke down',
    title: 'Price left the level to the downside, below the zone',
    tone: 'bg-rose-950/70 text-rose-300 border-rose-900/80',
  },
];

export const TOUCH_OUTCOME_LABEL: Record<TouchOutcome, string> = {
  watching: 'Watching',
  'never-returned': 'Never came back',
  returned: 'Came back',
  invalid: 'Void',
};

export const TOUCH_OUTCOME_BADGE: Record<TouchOutcome, string> = {
  watching: 'bg-zinc-800/80 text-zinc-300 border-zinc-700',
  'never-returned': 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
  returned: 'bg-rose-950/70 text-rose-300 border-rose-900/80',
  invalid: 'bg-zinc-900 text-zinc-500 border-zinc-800',
};

export interface TouchOutcomeControlsProps {
  touch: LevelTouch;
  /** Writes the decided touch back. The same upsert the touch log uses. */
  onSave: (touch: LevelTouch) => void;
  /** Shown only when the host offers it — not every surface needs a delete here. */
  onDelete?: (touchId: string) => void;
  /** Tightens the spacing for use inline inside a level’s row. */
  compact?: boolean;
}

/** An ISO stamp as a `datetime-local` value in the browser's own zone, or '' when unset. */
function isoToLocalInput(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const TouchOutcomeControls: React.FC<TouchOutcomeControlsProps> = ({
  touch,
  onSave,
  onDelete,
  compact = false,
}) => {
  const decided = touch.outcome === 'never-returned' || touch.outcome === 'returned';
  // The time under a decided touch means a different thing either side of the outcome, so the
  // box is seeded from whichever field that outcome uses: when price came back for a return,
  // and the moment the call was made for a touch that never came back.
  const storedAt = touch.outcome === 'returned' ? touch.returnedAt : touch.checkedAt;
  const [decidedAt, setDecidedAt] = useState(() => isoToLocalInput(storedAt));

  useEffect(() => {
    setDecidedAt(isoToLocalInput(storedAt));
    // Re-seeded when the row changes outcome, or when a different touch takes its place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch.id, touch.outcome]);

  /**
   * Marks the outcome, and counts the look.
   *
   * `checks` is what makes a long watch mean something — a touch looked at five times and
   * still not returned is a stronger observation than one glanced at once — so it moves only
   * on a real change of state. Re-tapping the outcome already set is ignored, which stops an
   * accidental double click from inflating the count.
   */
  const setOutcome = (outcome: TouchOutcome) => {
    if (outcome === touch.outcome) return;
    const now = new Date().toISOString();
    onSave({
      ...touch,
      outcome,
      checks: (touch.checks ?? 0) + 1,
      checkedAt: now,
      ...(outcome === 'returned' && !touch.returnedAt ? { returnedAt: now } : {}),
    });
  };

  /** Records which way price left the level, or clears it when the same one is tapped again. */
  const setBreakDirection = (direction: TouchBreakDirection) => {
    const next = touch.breakDirection === direction ? undefined : direction;
    onSave({ ...touch, breakDirection: next });
  };

  /** Saves the time the answer was settled, on blur rather than per keystroke. */
  const saveDecidedAt = () => {
    if (!decidedAt) return;
    const when = new Date(decidedAt);
    if (Number.isNaN(when.getTime())) return;
    const iso = when.toISOString();
    if (touch.outcome === 'returned') {
      if (iso === touch.returnedAt) return;
      onSave({ ...touch, returnedAt: iso });
    } else if (touch.outcome === 'never-returned') {
      if (iso === touch.checkedAt) return;
      onSave({ ...touch, checkedAt: iso });
    }
  };

  const buttonClass = compact ? 'px-1.5 py-0.5' : 'px-2 py-1';

  return (
    <div
      data-touch-outcome-controls={touch.id}
      className={`flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 ${
        compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
      }`}
    >
      {TOUCH_OUTCOME_BUTTONS.map((option) => {
        const active = touch.outcome === option.value;
        return (
          <button
            key={option.value}
            type="button"
            id={`touch-outcome-${option.value}-${touch.id}`}
            title={option.title}
            aria-pressed={active}
            onClick={() => setOutcome(option.value)}
            className={`rounded-lg border text-[10px] font-semibold transition-colors ${buttonClass} ${
              active
                ? option.tone
                : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {option.label}
          </button>
        );
      })}

      {/*
        Which way price left, when it actually left. Recorded on the trader's word rather than
        assumed from the level's side, because price can break either way and the direction is
        the thing a hold-by-direction read is built on.
      */}
      {decided && (
        <div
          data-touch-direction={touch.id}
          className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-500"
        >
          Left
          {TOUCH_BREAK_DIRECTIONS.map((option) => {
            const active = touch.breakDirection === option.value;
            return (
              <button
                key={option.value}
                type="button"
                id={`touch-direction-${option.value}-${touch.id}`}
                title={option.title}
                aria-pressed={active}
                onClick={() => setBreakDirection(option.value)}
                className={`rounded-lg border text-[10px] font-semibold transition-colors ${buttonClass} ${
                  active
                    ? option.tone
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {/*
        The time the answer was settled. A return is stamped with when price traded back
        inside the zone; a break that broke away and held is stamped with the moment the call
        was made, so the record says when the question closed rather than only how it closed.
        Which way it broke away to is recorded just above, on the direction buttons.
      */}
      {decided && (
        <label className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-500">
          {touch.outcome === 'returned' ? 'Came back at' : 'Broke away at'}
          <input
            id={`touch-decided-at-${touch.id}`}
            type="datetime-local"
            value={decidedAt}
            onChange={(event) => setDecidedAt(event.target.value)}
            onBlur={saveDecidedAt}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
            title={
              touch.outcome === 'returned'
                ? 'The time price traded back inside the level'
                : 'The time you made the call that price broke away and did not come back'
            }
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
          />
        </label>
      )}

      {onDelete && (
        <button
          type="button"
          id={`touch-outcome-delete-${touch.id}`}
          onClick={() => onDelete(touch.id)}
          title="Delete this touch"
          className="ml-auto rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};
