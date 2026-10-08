import React, { useState } from 'react';
import { Clock, Pencil, Trash2 } from 'lucide-react';
import type {
  BreakDirection,
  LevelKind,
  LevelPatch,
  LevelRecord,
  SetupTag,
  Timeframe,
} from '../../lib/mes/types';
import { outcomeOfLevel } from '../../lib/mes/analytics';
import { SETUP_LABELS, SETUP_TAGS, TIMEFRAMES } from '../../lib/mes/constants';
import { formatClock, formatPrice, formatShortDate, nowClock } from '../../lib/mes/utils';
import { Badge, DirectionBadge, KindBadge, OutcomeBadge, Segmented } from './mes-ui';

/**
 * One level: read-only until Edit, and per-record when it is not.
 *
 * Nothing is written on a keystroke. Edit reveals the fields, Save changes writes exactly
 * this one row, and Cancel discards — which is what makes a mis-tapped price a two-second
 * fix rather than a re-entry. Deleting always asks first, in place, so an accidental ✕ does
 * not take a session's line with it.
 *
 * The view is read-only on purpose: it renders a level that was never reached differently
 * from one that was reached and held, and from one that was reached and broke, so the record
 * reads at a glance without opening anything.
 */
interface MesLevelRowProps {
  record: LevelRecord;
  onSave: (id: string, patch: LevelPatch) => void;
  onDelete: (id: string) => void;
  showDate?: boolean;
  showTimeframe?: boolean;
}

export const MesLevelRow: React.FC<MesLevelRowProps> = ({
  record,
  onSave,
  onDelete,
  showDate = false,
  showTimeframe = true,
}) => {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<LevelRecord>(record);

  const outcome = outcomeOfLevel(record);

  const beginEdit = () => {
    setDraft(record);
    setConfirming(false);
    setEditing(true);
  };

  const handleSave = () => {
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const patch: LevelPatch = {
      date: draft.date,
      timeframe: draft.timeframe,
      kind: draft.kind,
      price,
      touches: draft.touches,
      holds: draft.holds,
      breaks: draft.breaks,
      setup: draft.touches <= 0 ? '' : draft.setup,
      hitTime: draft.touches <= 0 ? '' : draft.hitTime,
      breakTime: draft.breaks <= 0 ? '' : draft.breakTime,
      breakDirection: draft.breaks <= 0 ? '' : draft.breakDirection,
      notes: draft.notes,
    };
    onSave(record.id, patch);
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        data-mes-row-edit={record.id}
        className="space-y-3 rounded-xl border border-sky-800/60 bg-zinc-950/70 p-3"
      >
        <div className="flex flex-wrap items-end gap-2">
          {showDate && (
            <Field label="Date">
              <input
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                className={inputClass}
              />
            </Field>
          )}
          <Field label="Chart">
            <select
              value={draft.timeframe}
              onChange={(event) =>
                setDraft({ ...draft, timeframe: event.target.value as Timeframe })
              }
              className={inputClass}
            >
              {TIMEFRAMES.map((timeframe) => (
                <option key={timeframe} value={timeframe}>
                  {timeframe}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price">
            <input
              type="number"
              step="0.25"
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) })}
              className={`${inputClass} w-28`}
            />
          </Field>
          <Field label="Side">
            <Segmented
              ariaLabel="Support or resistance"
              value={draft.kind}
              onChange={(value) => setDraft({ ...draft, kind: value as LevelKind })}
              options={[
                { value: 'support', label: 'Support' },
                { value: 'resistance', label: 'Resistance' },
              ]}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {(
            [
              ['touches', 'Tests'],
              ['holds', 'Held'],
              ['breaks', 'Broke'],
            ] as const
          ).map(([field, label]) => (
            <Field key={field} label={label}>
              <input
                type="number"
                min={0}
                value={draft[field]}
                onChange={(event) =>
                  setDraft({ ...draft, [field]: Math.max(0, Number(event.target.value) || 0) })
                }
                className={`${inputClass} w-16`}
              />
            </Field>
          ))}

          <Field label="Setup">
            <select
              value={draft.setup}
              disabled={draft.touches <= 0}
              onChange={(event) => setDraft({ ...draft, setup: event.target.value as SetupTag | '' })}
              className={`${inputClass} disabled:opacity-40`}
            >
              <option value="">Untagged</option>
              {SETUP_TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  {SETUP_LABELS[tag]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <EditTime
            label="Hit time"
            value={draft.hitTime}
            disabled={draft.touches <= 0}
            onChange={(hitTime) => setDraft({ ...draft, hitTime })}
          />
          <EditTime
            label="Break time"
            value={draft.breakTime}
            disabled={draft.breaks <= 0}
            onChange={(breakTime) => setDraft({ ...draft, breakTime })}
          />
          <Field label="Broke to the…">
            <Segmented
              ariaLabel="Break direction"
              value={draft.breakDirection}
              onChange={(value) =>
                setDraft({ ...draft, breakDirection: value as BreakDirection | '' })
              }
              options={[
                { value: 'up', label: '▲ Upside' },
                { value: 'down', label: '▼ Downside' },
              ]}
              className={draft.breaks <= 0 ? 'pointer-events-none opacity-40' : undefined}
            />
          </Field>
          <Field label="Notes">
            <input
              type="text"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              className={`${inputClass} min-w-40`}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <button
            data-mes-save-changes={record.id}
            onClick={handleSave}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-white"
          >
            Save changes
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-mes-row={record.id}
      data-mes-outcome={outcome}
      className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        {showDate && (
          <span className="font-mono text-[10px] text-zinc-500">
            {formatShortDate(record.date)}
          </span>
        )}
        {showTimeframe && (
          <span className="rounded border border-zinc-700/60 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
            {record.timeframe}
          </span>
        )}
        <span className="font-mono text-sm font-bold tabular-nums text-zinc-100">
          {formatPrice(record.price)}
        </span>
        <KindBadge kind={record.kind} />
        <OutcomeBadge outcome={outcome} />
        <span className="font-mono text-[10px] text-zinc-500">
          {record.touches}× · {record.holds}H · {record.breaks}B
        </span>
        {record.setup && <Badge>{SETUP_LABELS[record.setup]}</Badge>}
        {record.hitTime && (
          <Badge className="border-zinc-700/60 bg-zinc-900/50 text-zinc-300">
            Hit {formatClock(record.hitTime)}
          </Badge>
        )}
        {record.breakTime && (
          <Badge className="border-zinc-700/60 bg-zinc-900/50 text-zinc-300">
            Broke {formatClock(record.breakTime)}
          </Badge>
        )}
        {record.breakDirection && <DirectionBadge direction={record.breakDirection} />}

        <span className="ml-auto flex items-center gap-1">
          <button
            data-mes-edit={record.id}
            onClick={beginEdit}
            aria-label="Edit this level"
            className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          {confirming ? (
            <>
              <button
                data-mes-confirm-delete={record.id}
                onClick={() => onDelete(record.id)}
                className="rounded-lg border border-rose-800/70 bg-rose-950/50 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:bg-rose-900/50"
              >
                Confirm delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              data-mes-delete={record.id}
              onClick={() => setConfirming(true)}
              aria-label="Delete this level"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-400 hover:bg-rose-950/40 hover:text-rose-300"
            >
              ✕
            </button>
          )}
        </span>
      </div>

      {record.notes && (
        <p className="mt-1 text-[11px] italic leading-snug text-zinc-500">{record.notes}</p>
      )}
    </div>
  );
};

const inputClass =
  'rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100 outline-none focus:border-sky-600';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1">
    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
    {children}
  </label>
);

const EditTime: React.FC<{
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}> = ({ label, value, disabled, onChange }) => (
  <Field label={label}>
    <span className="flex items-center gap-1">
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} disabled:opacity-40`}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(nowClock())}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
      >
        <Clock className="h-3 w-3" />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('')}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
      >
        Clear
      </button>
    </span>
  </Field>
);

