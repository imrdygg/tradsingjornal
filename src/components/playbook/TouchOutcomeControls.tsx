import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { LevelTouch, TouchOutcome } from '../../types';

/**
 * Deciding what a level touch did.
 *
 * A touch cannot be judged when it happens. It is written down the moment price reaches a
 * line, while the answer still lies ahead: price either breaks away and stays away, or comes
 * back inside the level's zone. So this is the second half of the record — the controls that
 * turn a `watching` touch into one of the two answers the whole edge read is built on, plus the
 * optional distance that sharpens it.
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

export const TouchOutcomeControls: React.FC<TouchOutcomeControlsProps> = ({
  touch,
  onSave,
  onDelete,
  compact = false,
}) => {
  const decided = touch.outcome === 'never-returned' || touch.outcome === 'returned';
  // The number under a decided touch means a different thing either side of the outcome, so
  // the box is seeded from whichever field that outcome uses.
  const storedPoints =
    touch.outcome === 'returned' ? touch.maxReturnPoints : touch.maxExcursionPoints;
  const [points, setPoints] = useState(() => (storedPoints == null ? '' : String(storedPoints)));

  useEffect(() => {
    setPoints(storedPoints == null ? '' : String(storedPoints));
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

  /** Saves the optional distance, on blur rather than per keystroke. */
  const savePoints = () => {
    const parsed = parseFloat(points);
    const value =
      Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : undefined;
    if (touch.outcome === 'returned') {
      if (value === touch.maxReturnPoints) return;
      onSave({ ...touch, maxReturnPoints: value });
    } else if (touch.outcome === 'never-returned') {
      if (value === touch.maxExcursionPoints) return;
      onSave({ ...touch, maxExcursionPoints: value });
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
        The distance is optional on purpose: it sharpens the average run in the record, but a
        trader who does not remember it exactly should leave it blank rather than guess a number
        the coach would then quote back as a measurement.
      */}
      {decided && (
        <label className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-500">
          {touch.outcome === 'returned' ? 'Came back in' : 'Ran away'}
          <input
            id={`touch-points-${touch.id}`}
            type="number"
            min="0"
            step="0.25"
            value={points}
            placeholder="—"
            onChange={(event) => setPoints(event.target.value)}
            onBlur={savePoints}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            }}
            className="w-16 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          pts
          <span className="normal-case text-zinc-600">optional</span>
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
