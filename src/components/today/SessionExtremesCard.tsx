import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Pencil,
  Star,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  ExtremeKind,
  ExtremeLevelType,
  ExtremeOutcome,
  ExtremeRating,
  ExtremeRatingHorizon,
  ExtremeTimeframe,
  Instrument,
  SessionExtreme,
  SessionWindow,
  TradingDay,
} from '../../types';
import { CoachCard } from '../coach/coach-ui';
import { formatTradingDate } from '../../lib/storage/date-utils';
import { instrumentSymbol, trackedExtremeInstruments } from '../../lib/trading/instruments';
import {
  buildExtremeDays,
  buildExtremeHourHistogram,
  buildOvernightHourPatterns,
  defaultLevelType,
  EXTREME_TIMEFRAMES,
  findRatingEdges,
  HORIZON_LABEL,
  hourLabel,
  LEVEL_TYPE_LABEL,
  MIN_PATTERN_SESSIONS,
  MIN_RATED,
  OUTCOME_LABEL,
  RATING_HORIZONS,
  sessionWindowForTime,
  summarizeExtremes,
  summarizeRatings,
  TIMEFRAME_LABEL,
} from '../../lib/analytics/session-extremes';

/**
 * The session-extremes log.
 *
 * The trader draws support and resistance lines on three charts, so the log records the
 * extremes the way they read them: one print per session, symbol, side of the range and
 * CHART, tagged with the side the level is acting as, and then rated afterwards against what
 * price actually did. Nothing here is fetched — every number is one they chose, which is what
 * lets the coach quote the whole thing as their own record.
 *
 * Three things are deliberate:
 *
 * - **The window is derived, the timeframe is chosen.** A 3am entry can never be filed as a
 *   regular-session print, and the 4pm–6pm halt is refused outright; but which chart a print
 *   came off is the trader's own call, because it changes what the print means.
 * - **The side is a pick, not a calculation.** A high is resistance and a low is support by
 *   default, and the pick overrides that, because a broken low that now holds from above is
 *   support turned resistance — the case worth recording.
 * - **The rating is two answers.** What price did (held, taken out, chopped) at each of three
 *   horizons, and optionally how cleanly the level behaved. They are kept apart because a
 *   level taken out by a real break is not the same finding as one that held through a mess.
 */

export interface SessionExtremesCardProps {
  extremes: SessionExtreme[];
  /** The trading day a new entry belongs to by default, and the source of its user. */
  todayTradingDay: TradingDay;
  instruments: Instrument[];
  onSave: (extreme: SessionExtreme) => void;
  onDelete: (extremeId: string) => void;
  /** The ids of the trades taken on a session date, for linking a sample back to them. */
  tradesForDate?: (date: string) => string[];
  /** Opens the Trades tab on a set of trades. */
  onOpenTrades?: (label: string, tradeIds: string[]) => void;
}

/** What each window is, in the trader's own clock. */
const WINDOW_LABEL: Record<SessionWindow, string> = {
  overnight: 'Overnight 6pm–9:30am ET',
  regular: 'Regular 9:30am–4pm ET',
};

const WINDOW_BADGE: Record<SessionWindow, string> = {
  overnight: 'overnight',
  regular: 'regular',
};

const KIND_BADGE: Record<ExtremeKind, string> = {
  high: 'bg-amber-950/70 text-amber-300 border-amber-900',
  low: 'bg-sky-950/70 text-sky-300 border-sky-900',
};

const LEVEL_BADGE: Record<ExtremeLevelType, string> = {
  resistance: 'bg-rose-950/60 text-rose-300 border-rose-900/80',
  support: 'bg-emerald-950/60 text-emerald-300 border-emerald-900/80',
};

const OUTCOME_TONE: Record<ExtremeOutcome, string> = {
  held: 'border-emerald-800 bg-emerald-950/80 text-emerald-300',
  'taken-out': 'border-amber-800 bg-amber-950/80 text-amber-300',
  chopped: 'border-zinc-700 bg-zinc-800/80 text-zinc-300',
};

/** How many session dates the log list shows. The rest are counted, never dropped silently. */
const MAX_DATES = 7;

/** How many rated conditions to show. The rest stay in the log and still count. */
const MAX_RATED_ROWS = 6;

/** The overnight window in the order it happens: 6pm through 11pm, then midnight to 9am. */
const OVERNIGHT_HOURS: number[] = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** A trade date without its year: `Tue, Sep 22`. */
function shortDate(date: string): string {
  return formatTradingDate(date).replace(/,\s*\d{4}$/, '');
}

/**
 * Replaces one horizon's reading on a print, leaving the others alone.
 *
 * The same rule the storage save follows for the print itself: a horizon holds one answer, so
 * re-rating an hour later corrects that reading instead of piling up a second.
 */
function withRating(
  extreme: SessionExtreme,
  horizon: ExtremeRatingHorizon,
  patch: Partial<ExtremeRating>
): SessionExtreme {
  const existing = extreme.ratings ?? [];
  const current = existing.find((rating) => rating.horizon === horizon);
  const merged: ExtremeRating = {
    horizon,
    outcome: patch.outcome ?? current?.outcome ?? 'held',
    grade: patch.grade ?? current?.grade,
    ratedAt: new Date().toISOString(),
  };
  const others = existing.filter((rating) => rating.horizon !== horizon);
  return { ...extreme, ratings: [...others, merged] };
}

/**
 * One horizon's reading: what price did, and how cleanly.
 *
 * Both answers save on the click that sets them, so the log never holds a half-filled
 * reading the trader thought they had written down.
 */
const RatingRow: React.FC<{
  extreme: SessionExtreme;
  horizon: ExtremeRatingHorizon;
  onSave: (extreme: SessionExtreme) => void;
}> = ({ extreme, horizon, onSave }) => {
  const rating = (extreme.ratings ?? []).find((entry) => entry.horizon === horizon);

  return (
    <div className="flex flex-wrap items-center gap-2" data-extreme-rating={horizon}>
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-zinc-500">
        {HORIZON_LABEL[horizon]}
      </span>

      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(OUTCOME_LABEL) as ExtremeOutcome[]).map((outcome) => {
          const active = rating?.outcome === outcome;
          return (
            <button
              key={outcome}
              type="button"
              aria-pressed={active}
              onClick={() => onSave(withRating(extreme, horizon, { outcome }))}
              className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                active ? OUTCOME_TONE[outcome] : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {OUTCOME_LABEL[outcome]}
            </button>
          );
        })}
      </div>

      {/* The grade is optional on purpose: a trader who is not sure should leave it blank
          rather than hand the stats a number they guessed. */}
      <div className="flex items-center gap-0.5" title="How cleanly the level behaved (optional)">
        {[1, 2, 3, 4, 5].map((value) => {
          const active = (rating?.grade ?? 0) >= value;
          return (
            <button
              key={value}
              type="button"
              aria-label={`Grade ${value} of 5`}
              aria-pressed={(rating?.grade ?? 0) === value}
              onClick={() =>
                onSave(
                  withRating(extreme, horizon, {
                    grade: rating?.grade === value ? undefined : value,
                  })
                )
              }
              className="p-0.5"
            >
              <Star
                className={`h-3 w-3 ${
                  active ? 'fill-amber-400 text-amber-400' : 'text-zinc-700 hover:text-zinc-500'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * One logged print, editable in place, with its rating controls folded away until they are
 * wanted.
 *
 * A print was write-once: a wrong time, a mistyped price or the wrong instrument meant
 * deleting it and entering the whole thing again, rating include. Editing rewrites the same
 * record — the id travels with it — so nothing is duplicated and the ratings already given
 * stay attached to the print they were about.
 */
const ExtremeRow: React.FC<{
  extreme: SessionExtreme;
  instruments: Instrument[];
  onSave: (extreme: SessionExtreme) => void;
  onDelete: (extremeId: string) => void;
}> = ({ extreme, instruments, onSave, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');

  const levelType = extreme.levelType ?? defaultLevelType(extreme.kind);
  const timeframe = extreme.timeframe ?? '1m';
  const rated = (extreme.ratings ?? []).length;
  const options = useMemo(() => trackedExtremeInstruments(instruments), [instruments]);

  const [editInstrumentId, setEditInstrumentId] = useState(extreme.instrumentId);
  const [editKind, setEditKind] = useState<ExtremeKind>(extreme.kind);
  const [editLevelType, setEditLevelType] = useState<ExtremeLevelType>(levelType);
  const [editTimeframe, setEditTimeframe] = useState<ExtremeTimeframe>(timeframe);
  const [editTime, setEditTime] = useState(extreme.time);
  const [editPrice, setEditPrice] = useState(String(extreme.price));
  const [editNotes, setEditNotes] = useState(extreme.notes ?? '');

  /** Seeds every draft from the record, so an edit always starts from what is stored. */
  const startEdit = () => {
    setEditInstrumentId(extreme.instrumentId);
    setEditKind(extreme.kind);
    setEditLevelType(levelType);
    setEditTimeframe(timeframe);
    setEditTime(extreme.time);
    setEditPrice(String(extreme.price));
    setEditNotes(extreme.notes ?? '');
    setEditError('');
    setEditing(true);
  };

  /** Writes the draft back onto the same print, re-deriving the window from the new time. */
  const saveEdit = () => {
    const window = sessionWindowForTime(editTime);
    if (window === null) {
      setEditError(
        editTime.trim() === ''
          ? 'Enter the clock time this print was at.'
          : 'The contract is halted between 4pm and 6pm ET — that print is not in a session.'
      );
      return;
    }
    const level = parseFloat(editPrice);
    if (!Number.isFinite(level) || level <= 0) {
      setEditError('Enter the price this extreme printed at.');
      return;
    }
    const instrument = options.find((option) => option.id === editInstrumentId);
    if (!instrument) {
      setEditError('Pick the instrument this print is for.');
      return;
    }

    onSave({
      ...extreme,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      kind: editKind,
      levelType: editLevelType,
      timeframe: editTimeframe,
      time: editTime.trim(),
      price: Math.round(level * 100) / 100,
      window,
      notes: editNotes.trim() || undefined,
    });
    setEditing(false);
  };

  const fieldClass =
    'rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none';

  return (
    <div
      data-extreme-row={extreme.id}
      className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5 space-y-1.5"
    >
      {editing ? (
        <div data-extreme-editing={extreme.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              id={`extreme-edit-instrument-${extreme.id}`}
              value={editInstrumentId}
              onChange={(e) => setEditInstrumentId(e.target.value)}
              aria-label="Instrument"
              className={fieldClass}
            >
              {options.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.symbol}
                </option>
              ))}
            </select>
            <select
              id={`extreme-edit-kind-${extreme.id}`}
              value={editKind}
              onChange={(e) => {
                const next = e.target.value as ExtremeKind;
                setEditKind(next);
                // The side follows the kind until the trader overrides it, as when adding.
                setEditLevelType(defaultLevelType(next));
              }}
              aria-label="Kind"
              className={fieldClass}
            >
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
            <select
              id={`extreme-edit-level-${extreme.id}`}
              value={editLevelType}
              onChange={(e) => setEditLevelType(e.target.value as ExtremeLevelType)}
              aria-label="Level type"
              className={fieldClass}
            >
              <option value="resistance">Resistance</option>
              <option value="support">Support</option>
            </select>
            <select
              id={`extreme-edit-timeframe-${extreme.id}`}
              value={editTimeframe}
              onChange={(e) => setEditTimeframe(e.target.value as ExtremeTimeframe)}
              aria-label="Chart"
              className={fieldClass}
            >
              {EXTREME_TIMEFRAMES.map((value) => (
                <option key={value} value={value}>
                  {TIMEFRAME_LABEL[value] ?? value}
                </option>
              ))}
            </select>
            <input
              id={`extreme-edit-time-${extreme.id}`}
              type="time"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              aria-label="Time"
              className={fieldClass}
            />
            <input
              id={`extreme-edit-price-${extreme.id}`}
              type="number"
              step="0.01"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              aria-label="Price"
              className={`${fieldClass} w-24`}
            />
          </div>
          <input
            id={`extreme-edit-notes-${extreme.id}`}
            type="text"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Notes (optional)"
            aria-label="Notes"
            className={`${fieldClass} w-full text-xs`}
          />
          {editError && (
            <p className="text-[11px] text-rose-300" id={`extreme-edit-error-${extreme.id}`}>
              {editError}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              id={`extreme-edit-cancel-${extreme.id}`}
              onClick={() => setEditing(false)}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              id={`extreme-edit-save-${extreme.id}`}
              onClick={saveEdit}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
            >
              <Check className="w-3 h-3" />
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-10 font-mono text-[11px] font-bold text-zinc-200">
          {extreme.symbol || instrumentSymbol(instruments, extreme.instrumentId)}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold ${
            KIND_BADGE[extreme.kind]
          }`}
        >
          {extreme.kind}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold ${
            LEVEL_BADGE[levelType]
          }`}
        >
          {LEVEL_TYPE_LABEL[levelType]}
        </span>
        <span className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
          {timeframe}
        </span>
        <span className="font-mono text-[11px] text-zinc-300">{extreme.time}</span>
        <span className="font-mono text-[11px] font-semibold text-zinc-100">{extreme.price}</span>
        <span className="font-mono text-[9px] uppercase text-zinc-600">
          {WINDOW_BADGE[extreme.window]}
        </span>
        {extreme.notes && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">{extreme.notes}</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              rated > 0
                ? 'border-emerald-900 bg-emerald-950/50 text-emerald-300'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {rated > 0 ? `Rated ${rated}` : 'Rate it'}
          </button>
          <button
            type="button"
            id={`extreme-edit-${extreme.id}`}
            onClick={startEdit}
            title="Edit this extreme"
            aria-label={`Edit the ${extreme.time} ${extreme.kind}`}
            className="rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-sky-400"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(extreme.id)}
            title="Delete this extreme"
            className="rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-1 border-t border-zinc-800/80 pt-1.5">
          {RATING_HORIZONS.map((horizon) => (
            <RatingRow key={horizon} extreme={extreme} horizon={horizon} onSave={onSave} />
          ))}
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Held means the level was not taken out; chopped means it never really decided, which
            counts against it. The grade is how clean it was, and is optional.
          </p>
        </div>
      )}
        </>
      )}
    </div>
  );
};

/** One instrument's overnight extremes, hour by hour, as bars ending at the open. */
const HourBars: React.FC<{
  symbol: string;
  kind: ExtremeKind;
  hours: number[];
  sessions: number;
  busiestHour: number | null;
}> = ({ symbol, kind, hours, sessions, busiestHour }) => {
  const tallest = Math.max(1, ...hours);

  return (
    <div data-extremes-histogram={`${symbol}-${kind}`} className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-zinc-300">
          {kind === 'high' ? (
            <ArrowUp className="h-3 w-3 text-amber-300" />
          ) : (
            <ArrowDown className="h-3 w-3 text-sky-300" />
          )}
          {symbol} overnight {kind}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          {sessions} session{sessions === 1 ? '' : 's'}
          {busiestHour === null ? '' : ` · usually ${hourLabel(busiestHour)}`}
        </span>
      </div>

      <div className="flex items-end gap-[2px] h-12">
        {OVERNIGHT_HOURS.map((hour) => {
          const count = hours[hour] ?? 0;
          // Zero keeps a visible stub, so a gap in the record reads as a gap rather than as
          // a bar that failed to render.
          const height = count === 0 ? 2 : Math.max(4, Math.round((count / tallest) * 100));
          return (
            <div
              key={hour}
              title={`${hourLabel(hour)} — ${count} session${count === 1 ? '' : 's'}`}
              className={`flex-1 rounded-sm ${
                count === 0
                  ? 'bg-zinc-800/60'
                  : kind === 'high'
                  ? 'bg-amber-500/70'
                  : 'bg-sky-500/70'
              }`}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>

      <div className="flex justify-between font-mono text-[9px] uppercase text-zinc-600">
        <span>6pm</span>
        <span>midnight</span>
        <span>6am</span>
        <span className="text-zinc-500">9:30 open</span>
      </div>
    </div>
  );
};

export const SessionExtremesCard: React.FC<SessionExtremesCardProps> = ({
  extremes,
  todayTradingDay,
  instruments,
  onSave,
  onDelete,
  tradesForDate,
  onOpenTrades,
}) => {
  const options = useMemo(() => trackedExtremeInstruments(instruments), [instruments]);

  const [tradeDate, setTradeDate] = useState(todayTradingDay.tradeDate);
  const [instrumentId, setInstrumentId] = useState(() => {
    const wanted = (todayTradingDay.primaryInstrument ?? '').trim().toLowerCase();
    const primary = options.find((instrument) => instrument.symbol.toLowerCase() === wanted);
    return primary?.id ?? options[0]?.id ?? '';
  });
  const [timeframe, setTimeframe] = useState<ExtremeTimeframe>('1m');
  const [kind, setKind] = useState<ExtremeKind>('high');
  // Follows the kind until the trader picks a side by hand. A high prints as resistance and a
  // low as support, so the default needs no thought; the flip is the case worth recording.
  const [levelType, setLevelType] = useState<ExtremeLevelType>('resistance');
  const [time, setTime] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  /** Which chart the picture and the pattern read below are showing. */
  const [viewTimeframe, setViewTimeframe] = useState<ExtremeTimeframe>('1m');

  const summary = useMemo(() => summarizeExtremes(extremes), [extremes]);
  const days = useMemo(
    () => buildExtremeDays(extremes, { timeframe: viewTimeframe }),
    [extremes, viewTimeframe]
  );
  const histogram = useMemo(() => buildExtremeHourHistogram(days), [days]);
  const patterns = useMemo(() => buildOvernightHourPatterns(days), [days]);
  const readable = patterns.filter((pattern) => pattern.enoughData);
  const thin = patterns.filter((pattern) => !pattern.enoughData);

  const ratingStats = useMemo(() => summarizeRatings(extremes), [extremes]);
  // Built with no floor so the conditions that are still tallies can be reported as counts
  // instead of vanishing; the split into readable and counted happens here.
  const ratingEdges = useMemo(() => findRatingEdges(extremes, { minRated: 0 }), [extremes]);
  const ratedConditions = ratingEdges.filter((bucket) => bucket.key !== 'all');
  // Compared against the floor rather than `enoughData`, which is relative to the floor the
  // builder was given.
  const readableRatings = ratedConditions.filter((bucket) => bucket.stats.rated >= MIN_RATED);
  const talliedRatings = ratedConditions.filter((bucket) => bucket.stats.rated < MIN_RATED);

  const timeWindow = sessionWindowForTime(time);

  const dates = useMemo(() => {
    const byDate = new Map<string, SessionExtreme[]>();
    for (const extreme of extremes) {
      const list = byDate.get(extreme.tradeDate) ?? [];
      list.push(extreme);
      byDate.set(extreme.tradeDate, list);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({
        date,
        list: [...list].sort(
          (a, b) =>
            a.symbol.localeCompare(b.symbol) ||
            (a.timeframe ?? '1m').localeCompare(b.timeframe ?? '1m') ||
            a.kind.localeCompare(b.kind)
        ),
      }));
  }, [extremes]);

  /** Changing the side of the range re-derives the default level type with it. */
  const pickKind = (next: ExtremeKind) => {
    setKind(next);
    setLevelType(defaultLevelType(next));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!tradeDate) {
      setError('Pick the session this print belongs to.');
      return;
    }
    const resolved = sessionWindowForTime(time);
    if (resolved === null) {
      setError(
        time.trim() === ''
          ? 'Enter the clock time the extreme printed at.'
          : 'The contract is halted between 4pm and 6pm ET — that print is not in a session.'
      );
      return;
    }
    const level = parseFloat(price);
    if (!Number.isFinite(level) || level <= 0) {
      setError('Enter the price the extreme printed at.');
      return;
    }
    const instrument = options.find((option) => option.id === instrumentId);
    if (!instrument) {
      setError('Pick the instrument this print is for.');
      return;
    }

    const now = new Date().toISOString();
    onSave({
      id: `extreme-${Date.now()}`,
      userId: todayTradingDay.userId,
      tradeDate,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      kind,
      time: time.trim(),
      price: Math.round(level * 100) / 100,
      window: resolved,
      timeframe,
      levelType,
      notes: notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    // The date, instrument, window and chart are usually the same for the next print, so
    // only the time, price and note are cleared.
    setTime('');
    setPrice('');
    setNotes('');
  };

  return (
    <CoachCard id="session-extremes" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
          <Clock className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Where the session extremes printed
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Log the clock time of each extreme off the chart you drew it on, say whether it is
            support or resistance, then rate what price did with it.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label htmlFor="extreme-date" className="mb-1 block text-xs font-medium text-zinc-300">
              Session date <span className="text-rose-400">*</span>
            </label>
            <input
              id="extreme-date"
              type="date"
              value={tradeDate}
              onChange={(event) => setTradeDate(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <label
              htmlFor="extreme-instrument"
              className="mb-1 block text-xs font-medium text-zinc-300"
            >
              Instrument
            </label>
            <select
              id="extreme-instrument"
              value={instrumentId}
              onChange={(event) => setInstrumentId(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {options.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Chart</label>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              {EXTREME_TIMEFRAMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  id={`extreme-timeframe-${value}`}
                  aria-pressed={timeframe === value}
                  onClick={() => setTimeframe(value)}
                  className={`rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
                    timeframe === value
                      ? 'border border-violet-800 bg-violet-950/80 text-violet-200 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {TIMEFRAME_LABEL[value]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Which extreme</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              {(['high', 'low'] as ExtremeKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  id={`extreme-kind-${value}`}
                  aria-pressed={kind === value}
                  onClick={() => pickKind(value)}
                  className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold capitalize transition-all ${
                    kind === value
                      ? value === 'high'
                        ? 'border border-amber-800 bg-amber-950/90 text-amber-300 shadow-sm'
                        : 'border border-sky-800 bg-sky-950/90 text-sky-300 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {value === 'high' ? (
                    <ArrowUp className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" />
                  )}
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Acting as
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              {(['support', 'resistance'] as ExtremeLevelType[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  id={`extreme-level-${value}`}
                  aria-pressed={levelType === value}
                  title={
                    value === 'support'
                      ? 'Price is holding above this level'
                      : 'Price is being capped by this level'
                  }
                  onClick={() => setLevelType(value)}
                  className={`rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
                    levelType === value
                      ? value === 'support'
                        ? 'border border-emerald-800 bg-emerald-950/90 text-emerald-300 shadow-sm'
                        : 'border border-rose-800 bg-rose-950/90 text-rose-300 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {LEVEL_TYPE_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="extreme-time" className="mb-1 block text-xs font-medium text-zinc-300">
              Time it printed <span className="text-rose-400">*</span>
            </label>
            <input
              id="extreme-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="extreme-price" className="mb-1 block text-xs font-medium text-zinc-300">
              Price <span className="text-rose-400">*</span>
            </label>
            <input
              id="extreme-price"
              type="number"
              step="0.25"
              placeholder="6012.25"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <label htmlFor="extreme-notes" className="mb-1 block text-xs font-medium text-zinc-300">
              Note
            </label>
            <input
              id="extreme-notes"
              type="text"
              placeholder="what you saw at that level"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {error ? (
            <span className="text-[11px] text-rose-300" id="extreme-error">
              {error}
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500" id="extreme-window-hint">
              {time === ''
                ? 'The window is read from the time, not chosen.'
                : timeWindow === 'overnight'
                ? WINDOW_LABEL.overnight
                : timeWindow === 'regular'
                ? WINDOW_LABEL.regular
                : 'That time is in the 4pm–6pm ET halt, which belongs to neither session.'}
            </span>
          )}
          <button
            type="submit"
            id="extreme-save"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
          >
            <Clock className="h-3.5 w-3.5" />
            Log the extreme
          </button>
        </div>
      </form>

      {summary.points === 0 ? (
        <p className="border-t border-zinc-800 pt-3 text-xs italic text-zinc-500">
          Nothing logged yet. Start with one session on the chart you trade off: its overnight
          high and low, then the regular session's, and rate what price did with each one.
        </p>
      ) : (
        <div className="space-y-3 border-t border-zinc-800 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400">
              <Activity className="h-3 w-3 text-violet-300" />
              When the overnight extremes print
            </span>
            <span className="font-mono text-[10px] text-zinc-500">
              {summary.sessions} session{summary.sessions === 1 ? '' : 's'} · {summary.points}{' '}
              extreme{summary.points === 1 ? '' : 's'}
              {summary.firstDate && summary.lastDate
                ? ` · ${shortDate(summary.firstDate)} → ${shortDate(summary.lastDate)}`
                : ''}
            </span>
          </div>

          {/* One chart at a time: a rate read across two resolutions would mean nothing. */}
          <div
            id="extremes-tf-tabs"
            className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1"
          >
            {EXTREME_TIMEFRAMES.map((value) => (
              <button
                key={value}
                type="button"
                id={`extremes-tf-${value}`}
                aria-pressed={viewTimeframe === value}
                onClick={() => setViewTimeframe(value)}
                className={`rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
                  viewTimeframe === value
                    ? 'border border-zinc-700 bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {TIMEFRAME_LABEL[value]}
              </button>
            ))}
          </div>

          {histogram.length === 0 ? (
            <p className="text-xs italic text-zinc-500">
              Nothing logged off the {TIMEFRAME_LABEL[viewTimeframe]} chart yet.
            </p>
          ) : (
            <div id="extremes-hour-histogram" className="grid gap-3 sm:grid-cols-2">
              {histogram.map((row) => (
                <HourBars
                  key={`${row.symbol}-${row.timeframe}-${row.kind}`}
                  symbol={row.symbol}
                  kind={row.kind}
                  hours={row.hours}
                  sessions={row.sessions}
                  busiestHour={row.busiestHour}
                />
              ))}
            </div>
          )}

          {summary.unreadable > 0 && (
            <p className="text-[10px] text-amber-300/80">
              {summary.unreadable} logged extreme{summary.unreadable === 1 ? '' : 's'} could not
              be read, so they are left out of the counts above.
            </p>
          )}

          {/* Did the open keep the overnight extreme, on this chart. */}
          {patterns.length > 0 && (
            <div id="extremes-patterns" className="space-y-1.5 pt-1">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Did the open keep the overnight extreme?
              </span>

              {readable.map((pattern) => {
                const decided = pattern.held + pattern.takenOut;
                const ids = tradesForDate
                  ? [...new Set(pattern.tradeDates.flatMap((date) => tradesForDate(date)))]
                  : [];
                return (
                  <div
                    key={pattern.key}
                    data-extremes-pattern={pattern.key}
                    className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 space-y-1"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-xs font-bold text-zinc-100">
                        {pattern.symbol}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold ${
                          KIND_BADGE[pattern.kind]
                        }`}
                      >
                        {pattern.kind}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-300">
                        printed {hourLabel(pattern.hour)}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-zinc-200">
                        <span
                          className={
                            pattern.heldRate !== null && pattern.heldRate >= 50
                              ? 'font-bold text-emerald-300'
                              : 'font-bold text-rose-300'
                          }
                        >
                          {pattern.heldRate}%
                        </span>{' '}
                        <span className="text-zinc-500">kept</span>
                      </span>
                    </div>
                    <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
                      {pattern.held} of {decided} session{decided === 1 ? '' : 's'} held it,{' '}
                      {pattern.takenOut} took it out
                      {pattern.medianExtensionPoints !== null
                        ? ` (median ${pattern.medianExtensionPoints} pts past it)`
                        : ''}
                      {pattern.undecided > 0
                        ? ` · ${pattern.undecided} not judged (no regular extreme logged)`
                        : ''}
                    </p>
                    {onOpenTrades && ids.length > 0 && (
                      <button
                        type="button"
                        id={`extremes-pattern-trades-${pattern.symbol}-${pattern.kind}-${pattern.hour}`}
                        onClick={() =>
                          onOpenTrades(
                            `${pattern.symbol} ${pattern.kind} at ${hourLabel(pattern.hour)}`,
                            ids
                          )
                        }
                        className="font-mono text-[10px] font-bold text-amber-300 transition-colors hover:text-amber-200"
                      >
                        {ids.length} trade{ids.length === 1 ? '' : 's'} on those sessions ↗
                      </button>
                    )}
                  </div>
                );
              })}

              {thin.map((pattern) => {
                const decided = pattern.held + pattern.takenOut;
                return (
                  <div
                    key={pattern.key}
                    data-extremes-pattern={pattern.key}
                    className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 px-3 py-2"
                  >
                    <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
                      <span className="font-bold text-zinc-400">{pattern.symbol}</span>{' '}
                      {pattern.kind} printed {hourLabel(pattern.hour)} · {decided} of{' '}
                      {pattern.sessions} session{pattern.sessions === 1 ? '' : 's'} judged (
                      {pattern.held} held, {pattern.takenOut} taken out)
                      {pattern.undecided > 0 ? `, ${pattern.undecided} not judged` : ''} —{' '}
                      {MIN_PATTERN_SESSIONS} are needed before this is a rate, so this stays a
                      tally for now.
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* What the trader's own readings say about the levels they marked. */}
          <div id="extremes-ratings" className="space-y-1.5 border-t border-zinc-800 pt-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400">
              <Star className="h-3 w-3 text-amber-300" />
              What your levels did
            </span>

            {ratingStats.rated === 0 ? (
              <p className="text-xs italic text-zinc-500">
                Nothing rated yet. Open a logged print and say what price did with it — that is
                what turns this log into evidence about your own lines.
              </p>
            ) : (
              <>
                <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
                  {ratingStats.rated} reading{ratingStats.rated === 1 ? '' : 's'} ·{' '}
                  {ratingStats.held} held · {ratingStats.takenOut} taken out ·{' '}
                  {ratingStats.chopped} chopped
                  {ratingStats.avgGrade === null
                    ? ''
                    : ` · average grade ${ratingStats.avgGrade} of 5 on ${ratingStats.graded} graded`}
                  {ratingStats.rated < 5
                    ? ' — a few more readings are needed before this is a rate.'
                    : ''}
                </p>

                {readableRatings.length > 0 && (
                  <ul className="space-y-1">
                    {readableRatings.slice(0, MAX_RATED_ROWS).map((bucket) => (
                      <li
                        key={bucket.key}
                        data-rating-bucket={bucket.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                      >
                        <span className="min-w-0 text-xs text-zinc-200">{bucket.label}</span>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-mono font-semibold text-emerald-400">
                            {bucket.stats.heldRate}%
                          </span>
                          <span className="block text-[10px] text-zinc-500">
                            held {bucket.stats.held} of {bucket.stats.rated}
                            {bucket.stats.avgGrade === null
                              ? ''
                              : ` · grade ${bucket.stats.avgGrade}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/*
                  The conditions that are still tallies are listed whatever else is on screen,
                  not only when nothing is readable: a count is what the trader is collecting
                  towards a rate, and hiding it while another condition is readable would make
                  the log look thinner than it is.
                */}
                {talliedRatings.length > 0 && (
                  <ul className="space-y-1">
                    {talliedRatings.slice(0, 4).map((bucket) => (
                      <li
                        key={bucket.key}
                        data-rating-tally={bucket.key}
                        className="font-mono text-[10px] leading-relaxed text-zinc-500"
                      >
                        <span className="font-bold text-zinc-400">{bucket.label}</span> ·{' '}
                        {bucket.stats.rated} reading{bucket.stats.rated === 1 ? '' : 's'},{' '}
                        {bucket.stats.held} held — {MIN_RATED} are needed before this is a rate.
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-[10px] leading-relaxed text-zinc-600">
                  A chopped reading counts against the level: it never really decided, which is
                  not a hold. The grade is kept apart from the outcome — a level can be taken out
                  cleanly by a real break, which is not the same as one that failed messily.
                </p>
              </>
            )}
          </div>

          <div id="extremes-log" className="space-y-2 border-t border-zinc-800 pt-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400">
              <TrendingUp className="h-3 w-3" />
              Logged extremes
            </span>

            {dates.slice(0, MAX_DATES).map(({ date, list }) => {
              const ids = tradesForDate ? tradesForDate(date) : [];
              return (
                <div key={date} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-bold uppercase text-zinc-400">
                      {shortDate(date)}
                    </span>
                    {onOpenTrades && ids.length > 0 && (
                      <button
                        type="button"
                        id={`extremes-day-trades-${date}`}
                        onClick={() => onOpenTrades(shortDate(date), ids)}
                        className="font-mono text-[10px] text-zinc-500 transition-colors hover:text-amber-300"
                      >
                        {ids.length} trade{ids.length === 1 ? '' : 's'} ↗
                      </button>
                    )}
                  </div>

                  {list.map((extreme) => (
                    <ExtremeRow
                      key={extreme.id}
                      extreme={extreme}
                      instruments={instruments}
                      onSave={onSave}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              );
            })}

            {dates.length > MAX_DATES && (
              <p className="text-[10px] text-zinc-500">
                Showing the {MAX_DATES} most recent of {dates.length} sessions. The rest still
                count towards the picture above.
              </p>
            )}
          </div>
        </div>
      )}
    </CoachCard>
  );
};
