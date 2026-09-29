import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Crosshair, Trash2 } from 'lucide-react';
import {
  Instrument,
  LevelKind,
  LevelTouch,
  TouchOutcome,
  TradingDay,
  TradingSession,
} from '../../types';
import { CoachCard } from '../coach/coach-ui';
import { formatTimestamp } from '../../lib/storage/date-utils';
import { instrumentSymbol } from '../../lib/trading/instruments';

/**
 * The level-touch log.
 *
 * The edge finder above can only answer the one question the whole journal is built around —
 * which of the trader's level conditions actually see price not come back — if there is a
 * record for it to read. This is where that record comes from.
 *
 * The shape of the thing is deliberate, and it follows from the fact that a touch cannot be
 * judged when it happens. A touch is written down the moment price reaches a level, with what
 * price was doing at the time; the answer comes later, when price has either broken away and
 * stayed away or come back inside the level's zone. So there are two jobs on this card and
 * they are separate: log the touch now, decide it later. Nothing here guesses the outcome and
 * nothing expires: a touch left `watching` is exactly as true as the day it was logged.
 *
 * Every touch is kept, including the ones that fail. A record of only the winners would make
 * the hold rate meaningless — the returns are the control that gives the holds their meaning.
 */

export interface LevelTouchLogProps {
  touches: LevelTouch[];
  /** The trading day a new touch belongs to, and the source of its date and user. */
  todayTradingDay: TradingDay;
  instruments: Instrument[];
  timezone: string;
  onSave: (touch: LevelTouch) => void;
  onDelete: (touchId: string) => void;
}

/** The sessions a touch can fall in, in the order they happen. */
const SESSIONS: TradingSession[] = ['Overnight', 'Premarket', 'Regular Session'];

/**
 * How wide a level is by default, in points.
 *
 * A level is a zone, not a tick: price has to leave this band and stay out of it to be a
 * break, so a zone of zero would make almost every touch look like a clean break.
 */
const DEFAULT_ZONE_POINTS = 4;

/** Most touches to render at once. The rest are counted, never silently dropped. */
const MAX_VISIBLE = 40;

/** The `datetime-local` value for right now, in the browser's own zone. */
function localDateTimeInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * The four things a touch can be, as buttons.
 *
 * `watching` and `void` are deliberately as reachable as the two answers: a trader who can
 * only record a decided outcome will start deciding early, and a record of premature calls is
 * worse than a short one.
 */
const OUTCOME_BUTTONS: Array<{
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

const OUTCOME_LABEL: Record<TouchOutcome, string> = {
  watching: 'Watching',
  'never-returned': 'Never came back',
  returned: 'Came back',
  invalid: 'Void',
};

const OUTCOME_BADGE: Record<TouchOutcome, string> = {
  watching: 'bg-zinc-800/80 text-zinc-300 border-zinc-700',
  'never-returned': 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
  returned: 'bg-rose-950/70 text-rose-300 border-rose-900/80',
  invalid: 'bg-zinc-900 text-zinc-500 border-zinc-800',
};

/** One logged touch, with its own controls for saying how it ended. */
const TouchCard: React.FC<{
  touch: LevelTouch;
  instruments: Instrument[];
  timezone: string;
  onSave: (touch: LevelTouch) => void;
  onDelete: (touchId: string) => void;
}> = ({ touch, instruments, timezone, onSave, onDelete }) => {
  const decided = touch.outcome === 'never-returned' || touch.outcome === 'returned';
  // The number under a decided touch means a different thing either side of the outcome, so
  // the box is seeded from whichever field that outcome uses.
  const storedPoints = touch.outcome === 'returned' ? touch.maxReturnPoints : touch.maxExcursionPoints;
  const [points, setPoints] = useState(() => String(storedPoints ?? ''));

  useEffect(() => {
    setPoints(String(storedPoints ?? ''));
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

  const isSupport = touch.kind === 'support';

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* The side of the level, not the outcome: colour is spent on how it ended. */}
          <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-0.5 text-[10px] font-mono uppercase font-bold text-zinc-300">
            {isSupport ? (
              <ArrowDown className="h-3 w-3 text-sky-300" />
            ) : (
              <ArrowUp className="h-3 w-3 text-amber-300" />
            )}
            {touch.kind}
          </span>
          <span className="font-mono text-sm font-semibold text-zinc-100">{touch.price}</span>
          <span className="font-mono text-[10px] text-zinc-500">±{touch.zonePoints}pts</span>
        </div>
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase font-bold ${
            OUTCOME_BADGE[touch.outcome]
          }`}
        >
          {OUTCOME_LABEL[touch.outcome]}
        </span>
      </div>

      <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
        {formatTimestamp(touch.touchedAt, timezone)} · {touch.session} ·{' '}
        {instrumentSymbol(instruments, touch.instrumentId)}
        {touch.label ? ` · ${touch.label}` : ''}
        {touch.checks > 0 ? ` · looked at ${touch.checks}×` : ''}
      </p>

      {touch.notes && (
        <p className="text-[11px] leading-relaxed text-zinc-400">{touch.notes}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {OUTCOME_BUTTONS.map((option) => {
          const active = touch.outcome === option.value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.title}
              aria-pressed={active}
              onClick={() => setOutcome(option.value)}
              className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                active
                  ? option.tone
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {option.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onDelete(touch.id)}
          title="Delete this touch"
          className="ml-auto rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/*
        The distance is optional on purpose: it sharpens the average run in the record above,
        but a trader who does not remember it exactly should leave it blank rather than guess a
        number the coach would then quote back as a measurement.
      */}
      {decided && (
        <label className="flex flex-wrap items-center gap-2 pt-0.5 text-[10px] font-mono uppercase text-zinc-500">
          {touch.outcome === 'returned' ? 'Came back in' : 'Ran away'}
          <input
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
          <span className="normal-case text-zinc-600">optional — leave blank if unsure</span>
        </label>
      )}
    </div>
  );
};

export const LevelTouchLog: React.FC<LevelTouchLogProps> = ({
  touches,
  todayTradingDay,
  instruments,
  timezone,
  onSave,
  onDelete,
}) => {
  const [kind, setKind] = useState<LevelKind>('support');
  const [price, setPrice] = useState('');
  const [zone, setZone] = useState(String(DEFAULT_ZONE_POINTS));
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [session, setSession] = useState<TradingSession>(
    SESSIONS.find((value) => todayTradingDay.allowedSessions?.includes(value)) ?? 'Regular Session'
  );
  // Today's own primary instrument leads, so the common case needs no choice at all.
  const [instrumentId, setInstrumentId] = useState(() => {
    const wanted = (todayTradingDay.primaryInstrument ?? '').trim().toLowerCase();
    const primary = instruments.find((inst) => inst.symbol.toLowerCase() === wanted);
    return primary?.id ?? instruments[0]?.id ?? 'mes';
  });
  const [touchedAt, setTouchedAt] = useState(localDateTimeInput);
  const [error, setError] = useState('');

  const sorted = useMemo(
    () =>
      [...touches].sort((a, b) =>
        (b.touchedAt ?? b.createdAt).localeCompare(a.touchedAt ?? a.createdAt)
      ),
    [touches]
  );
  const visible = sorted.slice(0, MAX_VISIBLE);
  const watching = touches.filter((touch) => touch.outcome === 'watching').length;
  const decided = touches.filter(
    (touch) => touch.outcome === 'never-returned' || touch.outcome === 'returned'
  ).length;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const level = parseFloat(price);
    if (!Number.isFinite(level) || level <= 0) {
      setError('Enter the price the level sits at.');
      return;
    }

    const width = zone.trim() === '' ? DEFAULT_ZONE_POINTS : parseFloat(zone);
    if (!Number.isFinite(width) || width < 0) {
      setError('The zone width has to be zero or more points.');
      return;
    }

    const when = touchedAt ? new Date(touchedAt) : new Date();
    if (Number.isNaN(when.getTime())) {
      setError('That touch time could not be read.');
      return;
    }

    const now = new Date().toISOString();
    onSave({
      id: `touch-${Date.now()}`,
      userId: todayTradingDay.userId,
      tradingDayId: todayTradingDay.id,
      tradeDate: todayTradingDay.tradeDate,
      instrumentId,
      kind,
      price: Math.round(level * 100) / 100,
      zonePoints: Math.round(width * 100) / 100,
      label: label.trim() || undefined,
      touchedAt: when.toISOString(),
      session,
      // Every touch starts undecided. That is the honest state, and it is what keeps the
      // hold rate from counting an outcome nobody has watched for yet.
      outcome: 'watching',
      checks: 0,
      notes: notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    // The level, its name and its note belong to this touch alone; the time and session are
    // usually the same again, so they stay as they were.
    setPrice('');
    setLabel('');
    setNotes('');
    setTouchedAt(localDateTimeInput());
  };

  return (
    <CoachCard id="playbook-level-log" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Crosshair className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">Log a level touch</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Write a touch down when price reaches one of your levels, then come back and say
            whether price ever came back. That answer is the whole record the finder reads.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-zinc-300">Level</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              {(['support', 'resistance'] as LevelKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold capitalize transition-all ${
                    kind === value
                      ? 'border border-emerald-800 bg-emerald-950/90 text-emerald-300 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {value === 'support' ? (
                    <ArrowDown className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )}
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="touch-price" className="mb-1 block text-xs font-medium text-zinc-300">
              Price <span className="text-rose-400">*</span>
            </label>
            <input
              id="touch-price"
              type="number"
              step="0.25"
              placeholder="7742.25"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="touch-zone" className="mb-1 block text-xs font-medium text-zinc-300">
              Zone ± pts
            </label>
            <input
              id="touch-zone"
              type="number"
              min="0"
              step="0.25"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label htmlFor="touch-label" className="mb-1 block text-xs font-medium text-zinc-300">
              Label
            </label>
            <input
              id="touch-label"
              type="text"
              placeholder="overnight high, prior day low, 4h supply"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="touch-session"
              className="mb-1 block text-xs font-medium text-zinc-300"
            >
              Session
            </label>
            <select
              id="touch-session"
              value={session}
              onChange={(event) => setSession(event.target.value as TradingSession)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {SESSIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="touch-instrument"
              className="mb-1 block text-xs font-medium text-zinc-300"
            >
              Instrument
            </label>
            <select
              id="touch-instrument"
              value={instrumentId}
              onChange={(event) => setInstrumentId(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {instruments.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label
              htmlFor="touch-touched-at"
              className="mb-1 block text-xs font-medium text-zinc-300"
            >
              Price reached the level at
            </label>
            <input
              id="touch-touched-at"
              type="datetime-local"
              value={touchedAt}
              onChange={(event) => setTouchedAt(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="touch-notes" className="mb-1 block text-xs font-medium text-zinc-300">
            Note
          </label>
          <textarea
            id="touch-notes"
            rows={2}
            placeholder="What price was doing as it arrived — the shape of the approach, what you expected next"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {error ? (
            <span className="text-[11px] text-rose-300">{error}</span>
          ) : (
            <span className="text-[11px] text-zinc-500">
              It is logged as watching, and stays that way until you say how it ended.
            </span>
          )}
          <button
            type="submit"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
          >
            <Crosshair className="h-3.5 w-3.5" />
            Log the touch
          </button>
        </div>
      </form>

      {touches.length > 0 ? (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              Logged touches
            </span>
            <span className="text-[10px] font-mono text-zinc-500">
              {touches.length} logged · {watching} watching · {decided} decided
            </span>
          </div>

          {visible.map((touch) => (
            <TouchCard
              key={touch.id}
              touch={touch}
              instruments={instruments}
              timezone={timezone}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}

          {touches.length > visible.length && (
            <p className="text-[10px] text-zinc-500">
              Showing the {visible.length} most recent of {touches.length}. The rest still count
              towards the record above.
            </p>
          )}
        </div>
      ) : (
        <p className="border-t border-zinc-800 pt-3 text-xs italic text-zinc-500">
          Nothing logged yet. Log every touch, including the ones that come straight back — the
          ones that fail are what make a hold rate mean anything.
        </p>
      )}
    </CoachCard>
  );
};
