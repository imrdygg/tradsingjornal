import React, { useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import type { BreakDirection, LevelKind, NewLevelInput, SetupTag, Timeframe } from '../../lib/mes/types';
import { QUICK_PICKS, SETUP_LABELS, SETUP_TAGS } from '../../lib/mes/constants';
import { nowClock } from '../../lib/mes/utils';
import { OutcomeBadge, Segmented } from './mes-ui';

/**
 * The inline add form for one timeframe card.
 *
 * The conditional behaviour is the subtle part, and it is enforced here rather than only on
 * save: a level with no tests cannot carry a hit time, and one that never broke cannot carry
 * a break time or a direction. Those controls are disabled AND pruned the moment the tallies
 * change, so reversing `Broke` back to `Not hit` clears the timing instead of quietly
 * keeping it. The store sanitises again on write, so nothing can slip through by another path.
 */
interface MesLevelFormProps {
  date: string;
  timeframe: Timeframe;
  onAdd: (input: NewLevelInput) => void;
  onCancel: () => void;
}

interface FormState {
  priceText: string;
  kind: LevelKind;
  touches: number;
  holds: number;
  breaks: number;
  setup: SetupTag | '';
  hitTime: string;
  breakTime: string;
  breakDirection: BreakDirection | '';
  notes: string;
}

const INITIAL: FormState = {
  priceText: '',
  kind: 'resistance',
  touches: 0,
  holds: 0,
  breaks: 0,
  setup: '',
  hitTime: '',
  breakTime: '',
  breakDirection: '',
  notes: '',
};

/** Sets the tallies and prunes any field they have just made impossible. */
function withTallies(
  base: FormState,
  tallies: Pick<FormState, 'touches' | 'holds' | 'breaks'>
): FormState {
  const next = { ...base, ...tallies };
  if (next.touches <= 0) next.hitTime = '';
  if (next.breaks <= 0) {
    next.breakTime = '';
    next.breakDirection = '';
  }
  return next;
}

export const MesLevelForm: React.FC<MesLevelFormProps> = ({
  date,
  timeframe,
  onAdd,
  onCancel,
}) => {
  const [state, setState] = useState<FormState>(INITIAL);
  const [showFineTune, setShowFineTune] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setState((prev) => ({ ...prev, ...patch }));
  const setTallies = (tallies: Pick<FormState, 'touches' | 'holds' | 'breaks'>) =>
    setState((prev) => withTallies(prev, tallies));

  const notHit = state.touches <= 0;
  const neverBroke = state.breaks <= 0;

  /** Which quick-pick, if any, matches the current tallies. */
  const activeQuickPick = (Object.keys(QUICK_PICKS) as Array<keyof typeof QUICK_PICKS>).find(
    (key) => {
      const pick = QUICK_PICKS[key];
      return (
        pick.touches === state.touches && pick.holds === state.holds && pick.breaks === state.breaks
      );
    }
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const price = Number(state.priceText);
    if (!Number.isFinite(price) || price <= 0) {
      setError('Enter a price above 0.');
      return;
    }
    onAdd({
      date,
      timeframe,
      kind: state.kind,
      price,
      touches: state.touches,
      holds: state.holds,
      breaks: state.breaks,
      setup: notHit ? '' : state.setup,
      hitTime: state.hitTime,
      breakTime: state.breakTime,
      breakDirection: state.breakDirection,
      notes: state.notes.trim(),
    });
    // Stay open, ready for the next level: the chart and the outcome reset, the level does not.
    setState({ ...INITIAL, kind: state.kind });
    setShowFineTune(false);
    setError(null);
  };

  return (
    <form
      data-mes-form={timeframe}
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-zinc-700/70 bg-zinc-950/70 p-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Price</span>
          <input
            id={`mes-price-${timeframe}`}
            type="number"
            step="0.25"
            inputMode="decimal"
            autoFocus
            value={state.priceText}
            onChange={(event) => {
              set({ priceText: event.target.value });
              if (error) setError(null);
            }}
            placeholder="5823.25"
            className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-sky-600"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Side</span>
          <Segmented
            ariaLabel="Support or resistance"
            value={state.kind}
            onChange={(value) => set({ kind: value as LevelKind })}
            options={[
              { value: 'support', label: 'Support' },
              { value: 'resistance', label: 'Resistance' },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Outcome
          </span>
          <Segmented
            ariaLabel="Outcome"
            value={activeQuickPick ?? 'custom'}
            onChange={(value) => {
              const pick = QUICK_PICKS[value as keyof typeof QUICK_PICKS];
              if (!pick) return;
              setTallies({ touches: pick.touches, holds: pick.holds, breaks: pick.breaks });
            }}
            options={[
              { value: 'not-hit', label: 'Not hit' },
              { value: 'held', label: 'Held' },
              { value: 'broke', label: 'Broke' },
              { value: 'mixed', label: 'Mixed' },
            ]}
          />
        </div>

        <span className="ml-auto flex items-center gap-1.5">
          <OutcomeBadge
            outcome={
              notHit
                ? 'untested'
                : state.breaks > 0 && state.holds === 0
                ? 'broke'
                : state.holds > 0 && state.breaks === 0
                ? 'held'
                : 'mixed'
            }
          />
          <span className="font-mono text-[10px] text-zinc-500">
            {state.touches}× · {state.holds}H · {state.breaks}B
          </span>
        </span>
      </div>

      {/* Fine-tune: the raw tallies, for when a quick-pick is not enough. */}
      <div>
        <button
          type="button"
          onClick={() => setShowFineTune((open) => !open)}
          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showFineTune ? 'rotate-180' : ''}`}
          />
          Fine-tune tests
        </button>
        {showFineTune && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ['touches', 'Tests'],
                ['holds', 'Held'],
                ['breaks', 'Broke'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {label}
                </span>
                <input
                  id={`mes-${field}-${timeframe}`}
                  type="number"
                  min={0}
                  step={1}
                  value={state[field]}
                  onChange={(event) =>
                    setTallies({
                      touches: field === 'touches' ? Number(event.target.value) || 0 : state.touches,
                      holds: field === 'holds' ? Number(event.target.value) || 0 : state.holds,
                      breaks: field === 'breaks' ? Number(event.target.value) || 0 : state.breaks,
                    })
                  }
                  className="w-16 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-sky-600"
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Timing */}
      <div className="flex flex-wrap items-end gap-3">
        <TimeField
          id={`mes-hit-${timeframe}`}
          label="Hit time"
          value={state.hitTime}
          disabled={notHit}
          disabledHint="A level that was never reached has no hit time."
          onChange={(hitTime) => set({ hitTime })}
        />
        <TimeField
          id={`mes-break-${timeframe}`}
          label="Break time"
          value={state.breakTime}
          disabled={neverBroke}
          disabledHint="A level that never broke has no break time."
          onChange={(breakTime) => set({ breakTime })}
        />
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Broke to the…
          </span>
          <Segmented
            ariaLabel="Break direction"
            value={state.breakDirection}
            onChange={(value) => set({ breakDirection: value as BreakDirection | '' })}
            options={[
              { value: 'up', label: '▲ Upside' },
              { value: 'down', label: '▼ Downside' },
            ]}
            className={neverBroke ? 'pointer-events-none opacity-40' : undefined}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Setup</span>
          <select
            id={`mes-setup-${timeframe}`}
            disabled={notHit}
            value={state.setup}
            onChange={(event) => set({ setup: event.target.value as SetupTag | '' })}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600 disabled:opacity-40"
          >
            <option value="">Untagged</option>
            {SETUP_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {SETUP_LABELS[tag]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-40 flex-[2] flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Notes</span>
          <input
            id={`mes-notes-${timeframe}`}
            type="text"
            value={state.notes}
            onChange={(event) => set({ notes: event.target.value })}
            placeholder="What you saw at this line"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-2 py-1 text-[11px] text-rose-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          id={`mes-save-${timeframe}`}
          type="submit"
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-white"
        >
          Save level
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

/** A clock field with the Now and Clear helpers, disabled when the outcome forbids it. */
const TimeField: React.FC<{
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  disabledHint: string;
  onChange: (value: string) => void;
}> = ({ id, label, value, disabled, disabledHint, onChange }) => (
  <div className="flex flex-col gap-1" title={disabled ? disabledHint : undefined}>
    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
    <div className="flex items-center gap-1">
      <input
        id={id}
        type="time"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-sky-600 disabled:opacity-40"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(nowClock())}
        className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
      >
        <Clock className="h-3 w-3" /> Now
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('')}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  </div>
);
