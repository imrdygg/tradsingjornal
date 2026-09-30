import React, { useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Clock, Trash2 } from 'lucide-react';
import { ExtremeKind, Instrument, SessionExtreme, SessionWindow, TradingDay } from '../../types';
import { CoachCard } from '../coach/coach-ui';
import { formatTradingDate } from '../../lib/storage/date-utils';
import { instrumentSymbol, trackedExtremeInstruments } from '../../lib/trading/instruments';
import {
  buildExtremeDays,
  buildExtremeHourHistogram,
  buildOvernightHourPatterns,
  hourLabel,
  MIN_PATTERN_SESSIONS,
  sessionWindowForTime,
  summarizeExtremes,
} from '../../lib/analytics/session-extremes';

/**
 * The session-extremes log.
 *
 * The trader writes down where each session's high and low printed on the clock, for the
 * instruments they actually trade: the overnight high and low, and the regular session's.
 * Nothing in this app can fetch those times — the quote read gives a day's range with no
 * clock on it — so this is their own record, exactly like the level-touch log.
 *
 * Two windows, because the question is about the open. An extreme that prints at 3am is a
 * different fact from one printed at 11am, and only the first says anything about how the
 * regular session met the level. The window is derived from the clock time rather than
 * chosen, so a 3am entry can never be filed as a regular-session print, and the 4pm–6pm
 * halt is refused outright instead of being counted as one session or the other.
 *
 * The picture underneath is the point of collecting: for each instrument, which clock hours
 * its overnight extremes actually print in, and then whether the regular session kept them.
 * It is counts over the trader's own logged sessions and nothing more — no forecast, and no
 * rate until there are enough sessions behind it to mean something.
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

/** Short badge for a logged row, so the window is never ambiguous on screen. */
const WINDOW_BADGE: Record<SessionWindow, string> = {
  overnight: 'overnight',
  regular: 'regular',
};

const KIND_BADGE: Record<ExtremeKind, string> = {
  high: 'bg-amber-950/70 text-amber-300 border-amber-900',
  low: 'bg-sky-950/70 text-sky-300 border-sky-900',
};

/** How many session dates the log list shows. The rest are counted, never dropped silently. */
const MAX_DATES = 7;

/** The overnight window in the order it happens: 6pm through 11pm, then midnight to 9am. */
const OVERNIGHT_HOURS: number[] = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** A trade date without its year: `Tue, Sep 22`. */
function shortDate(date: string): string {
  return formatTradingDate(date).replace(/,\s*\d{4}$/, '');
}

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
  const [kind, setKind] = useState<ExtremeKind>('high');
  const [time, setTime] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const summary = useMemo(() => summarizeExtremes(extremes), [extremes]);
  const days = useMemo(() => buildExtremeDays(extremes), [extremes]);
  const histogram = useMemo(() => buildExtremeHourHistogram(days), [days]);
  const patterns = useMemo(() => buildOvernightHourPatterns(days), [days]);
  const readable = patterns.filter((pattern) => pattern.enoughData);
  const thin = patterns.filter((pattern) => !pattern.enoughData);

  // The window the typed time lands in, shown live so a 4pm entry is refused before the
  // trader presses save rather than after. Named around the global `window` on purpose.
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
          (a, b) => a.symbol.localeCompare(b.symbol) || a.kind.localeCompare(b.kind)
        ),
      }));
  }, [extremes]);

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
      notes: notes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    // The date, instrument and window are usually the same for the next print, so only the
    // time, price and note are cleared.
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
            Log the clock time of each session's high and low — overnight and regular. The
            picture below counts your own logged sessions, so the more you fill in, the more
            it can say.
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Which extreme
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              {(['high', 'low'] as ExtremeKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  id={`extreme-kind-${value}`}
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
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
        </div>

        <div>
          <label htmlFor="extreme-notes" className="mb-1 block text-xs font-medium text-zinc-300">
            Note
          </label>
          <input
            id="extreme-notes"
            type="text"
            placeholder="anything worth remembering about that print"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
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
          Nothing logged yet. Start with one session: the overnight high and low, then the
          regular session's. The picture needs a handful of sessions before it can say anything
          about how the open treats an overnight extreme.
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

          <div id="extremes-hour-histogram" className="grid gap-3 sm:grid-cols-2">
            {histogram.map((row) => (
              <HourBars
                key={`${row.symbol}-${row.kind}`}
                symbol={row.symbol}
                kind={row.kind}
                hours={row.hours}
                sessions={row.sessions}
                busiestHour={row.busiestHour}
              />
            ))}
          </div>

          {summary.unreadable > 0 && (
            <p className="text-[10px] text-amber-300/80">
              {summary.unreadable} logged extreme{summary.unreadable === 1 ? '' : 's'} could not
              be read, so they are left out of the counts above.
            </p>
          )}

          {/* The pattern read: counts over the trader's own sessions, never a forecast. */}
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

          <div id="extremes-log" className="space-y-2 border-t border-zinc-800 pt-3">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
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
                    <div
                      key={extreme.id}
                      data-extreme-row={extreme.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5"
                    >
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
                      <span className="font-mono text-[11px] text-zinc-300">{extreme.time}</span>
                      <span className="font-mono text-[11px] font-semibold text-zinc-100">
                        {extreme.price}
                      </span>
                      <span className="font-mono text-[9px] uppercase text-zinc-600">
                        {WINDOW_BADGE[extreme.window]}
                      </span>
                      {extreme.notes && (
                        <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">
                          {extreme.notes}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(extreme.id)}
                        title="Delete this extreme"
                        className="ml-auto rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
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
