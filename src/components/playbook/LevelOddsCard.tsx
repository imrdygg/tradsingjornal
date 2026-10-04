import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Clock, History, Info } from 'lucide-react';
import {
  Instrument,
  LevelTimeframe,
  LevelTouch,
  MarkedLevel,
  TradingDay,
  TradingSession,
} from '../../types';
import { CoachCard } from '../coach/coach-ui';
import { Collapse } from '../common/Collapse';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { MIN_DECIDED } from '../../lib/analytics/level-edge';
import { TIMEFRAME_LABEL } from '../../lib/analytics/level-timeframes';
import {
  mostReachedLine,
  summarizeLevelOdds,
  todayProjection,
  WEEKDAY_LABELS,
  type LevelOddsCondition,
  type LevelOddsRow,
} from '../../lib/analytics/level-odds';

/** The sessions a condition can narrow to, in the order they happen. */
const SESSIONS: TradingSession[] = ['Overnight', 'Premarket', 'Regular Session'];

/**
 * What the trader's own record says usually happens at each of their indicator lines.
 *
 * The card sits under Today's levels and reads the levels they have marked and the touches they
 * have logged — nothing else. For the instrument on screen it shows, per timeframe and side, how
 * many days they marked that line, how many of those days price reached it, how it behaved after
 * a touch, and the hour and weekday it tends to print at. A final section reads which other lines
 * price reached *later the same day*, which is the trader's own answer to "does it go on to the
 * 15m line or reverse".
 *
 * The wording is deliberate: this is a count of what already happened in their journal, never a
 * forecast and never a promise. Every rate carries the days behind it, and a thin sample is shown
 * as a tally rather than a percentage so it cannot be read as an edge.
 */

export interface LevelOddsCardProps {
  /** Every marked level, across all days — the odds are read over the whole history. */
  levels: MarkedLevel[];
  /** Every touch, so reach, hold and the when-read can be built. */
  touches: LevelTouch[];
  /** The instruments to offer, in a fixed order. */
  instruments: Instrument[];
  /** The trading day in view; its primary instrument is the card's default. */
  todayTradingDay: TradingDay;
  /** The trader's own timezone, so hours and weekdays read on their clock. */
  timezone: string;
  /**
   * The instrument currently open, when a parent owns the selection.
   *
   * Left undefined the card keeps its own, which is how it works alone. When a parent owns
   * it — so this card stays in step with the levels card above — it passes the value and hears
   * every change through `onInstrumentChange`.
   */
  instrumentId?: string;
  onInstrumentChange?: (instrumentId: string) => void;
  /** The timeframe open on the levels card, whose two rows are highlighted here. */
  timeframe?: LevelTimeframe;
}

export const LevelOddsCard: React.FC<LevelOddsCardProps> = ({
  levels,
  touches,
  instruments,
  todayTradingDay,
  timezone,
  instrumentId: controlledInstrumentId,
  onInstrumentChange,
  timeframe,
}) => {
  const [ownInstrumentId, setOwnInstrumentId] = useState(() => {
    const wanted = (todayTradingDay.primaryInstrument ?? '').trim().toLowerCase();
    const primary = instruments.find(
      (inst) => inst.symbol.toLowerCase() === wanted || inst.id.toLowerCase() === wanted
    );
    return primary?.id ?? instruments[0]?.id ?? 'mes';
  });
  const instrumentId = controlledInstrumentId ?? ownInstrumentId;

  /**
   * The narrowing on the full read: "Mondays", "the overnight session", "around 03:00".
   *
   * Empty fields mean "all", so the card opens on the whole record and the trader narrows it.
   * The today block below is separate and always reads against today's own weekday.
   */
  const [condition, setCondition] = useState<LevelOddsCondition>({});
  /** The "how this works" note is folded away by default so it costs no space until asked for. */
  const [helpOpen, setHelpOpen] = useState(false);
  const hasCondition =
    condition.weekday != null || condition.session != null || condition.hour != null;
  const conditionLabel = [
    condition.weekday != null ? WEEKDAY_LABELS[condition.weekday] : null,
    condition.session ?? null,
    condition.hour != null ? `${String(condition.hour).padStart(2, '0')}:00` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const report = useMemo(
    () => summarizeLevelOdds(levels, touches, instrumentId, timezone, condition),
    [levels, touches, instrumentId, timezone, condition]
  );
  const symbol = instrumentSymbol(instruments, instrumentId);
  // The single line the card leads with: the one price reaches most, with its counts.
  const headline = useMemo(() => mostReachedLine(report.rows), [report.rows]);

  // The lines marked today, read against the same weekday in the record.
  const projection = useMemo(
    () => todayProjection(levels, touches, todayTradingDay, instrumentId, timezone),
    [levels, touches, todayTradingDay, instrumentId, timezone]
  );

  const setWeekday = (value: string) =>
    setCondition((prev) => ({ ...prev, weekday: value === '' ? null : Number(value) }));
  const setSession = (value: string) =>
    setCondition((prev) => ({
      ...prev,
      session: value === '' ? null : (value as TradingSession),
    }));
  const setHour = (value: string) =>
    setCondition((prev) => ({ ...prev, hour: value === '' ? null : Number(value) }));

  /** The highlighting and the today block both need the side icon, kept in one place. */
  const SideIcon: React.FC<{ kind: LevelOddsRow['kind'] }> = ({ kind }) =>
    kind === 'support' ? (
      <ArrowDown className="h-3 w-3 text-sky-300" />
    ) : (
      <ArrowUp className="h-3 w-3 text-amber-300" />
    );

  /** The one-line read of what price did after a touch on this line. */
  const holdLine = (row: LevelOddsRow): string => {
    if (row.stats.touches === 0) return 'No touch logged against this line yet.';
    if (row.stats.decided >= MIN_DECIDED) {
      return `After a touch: ${row.stats.neverReturned} of ${row.stats.decided} decided held (${row.stats.holdRate}% never came back).`;
    }
    return `After ${row.stats.touches} touch${row.stats.touches === 1 ? '' : 'es'}: ${row.stats.decided} decided — need ${MIN_DECIDED} for a hold rate.`;
  };

  /** When the touches on this line printed, if any did. */
  const whenLine = (row: LevelOddsRow): string => {
    if (row.stats.touches === 0) return '';
    const parts: string[] = [];
    if (row.weekdays.length) parts.push(`most often on ${row.weekdays[0].name}`);
    if (row.hours.length) parts.push(`around ${String(row.hours[0].hour).padStart(2, '0')}:00`);
    return parts.length ? `Touches land ${parts.join(', ')} (your time).` : '';
  };

  const renderRow = (row: LevelOddsRow) => {
    const rate = row.reachRate ?? 0;
    const when = whenLine(row);
    // The chart open on the levels card above, so the two read as one selection.
    const isCurrent = timeframe === row.timeframe;
    return (
      <div
        key={row.key}
        data-level-odds={row.key}
        className={`space-y-1.5 rounded-xl border px-2.5 py-2 ${
          isCurrent
            ? 'border-indigo-500/60 bg-indigo-500/10'
            : 'border-zinc-800 bg-zinc-900/50'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-200">
            {row.kind === 'support' ? (
              <ArrowDown className="h-3 w-3 text-sky-300" />
            ) : (
              <ArrowUp className="h-3 w-3 text-amber-300" />
            )}
            {TIMEFRAME_LABEL[row.timeframe]}{' '}
            <span className="capitalize text-zinc-400">{row.kind}</span>
          </span>
          <span className="font-mono text-[11px] font-semibold text-zinc-200">
            {row.enoughDays ? `${row.reachRate}%` : `${row.daysReached}/${row.daysMarked} days`}
          </span>
        </div>

        {/* The reach bar fills with how often the line was reached; a thin sample shows the
            empty track rather than a misleadingly full one. */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-indigo-400/80"
            style={{ width: `${row.enoughDays ? rate : 0}%` }}
          />
        </div>

        <p className="text-[10px] text-zinc-500">
          Reached on {row.daysReached} of {row.daysMarked} day
          {row.daysMarked === 1 ? '' : 's'} you marked it
          {row.enoughDays ? '' : ' — still collecting; a tally, not a rate'}.
        </p>
        <p className="text-[10px] text-zinc-500">{holdLine(row)}</p>
        {row.neverTouched > 0 && (
          <p className="text-[10px] text-amber-300/80">
            {row.neverTouched} of these you closed out as never touched.
          </p>
        )}
        {when && <p className="text-[10px] text-zinc-600">{when}</p>}
      </div>
    );
  };

  return (
    <CoachCard id="playbook-level-odds" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
          <History className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">What usually happens</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Read from your own marked lines and logged touches, per timeframe and side. How often
            price reached each line, how it behaved after a touch, when it tends to happen, and
            what else got reached next. Narrow it to a weekday, session or hour to isolate a
            pattern, and see today's own weekday read above. History from your record — not a
            forecast.
          </p>
        </div>
      </div>

      {/*
        The explanation, folded away so it takes no space until asked for. Collapsed by default
        because the card is read for its numbers, not its manual — but the assumptions here are
        load-bearing, so they have to be reachable without a wiki.
      */}
      <div>
        <button
          type="button"
          id="level-odds-help-toggle"
          aria-expanded={helpOpen}
          aria-controls="level-odds-help"
          onClick={() => setHelpOpen((open) => !open)}
          className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${helpOpen ? '' : '-rotate-90'}`}
          />
          <Info className="h-3 w-3" />
          How this works
        </button>

        <Collapse open={helpOpen} bodyId="level-odds-help">
          <ul className="mt-2 space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5 text-[10px] leading-relaxed text-zinc-400">
            <li>
              <span className="font-semibold text-zinc-300">Where it comes from.</span> Your own
              marked lines and logged touches only — no market feed. A touch counts only when it
              links back to a marked level.
            </li>
            <li>
              <span className="font-semibold text-zinc-300">Reach.</span> Of the days you marked
              this line, how many price reached. A day counts when a touch on it links back to the
              line.
            </li>
            <li>
              <span className="font-semibold text-zinc-300">Hold.</span> Of the decided touches
              (never came back vs returned), the share where price never came back. Under five
              decided it shows a count, not a rate.
            </li>
            <li>
              <span className="font-semibold text-zinc-300">When.</span> The hour and weekday your
              touches printed at, on your own clock.
            </li>
            <li>
              <span className="font-semibold text-zinc-300">What happened next.</span> On days a
              line was reached, the other lines price reached later that same day, ordered by the
              touch times.
            </li>
            <li>
              <span className="font-semibold text-zinc-300">Narrow the record</span> to a weekday,
              session or hour to isolate a pattern like a line only reached on Mondays around
              03:00. A thin slice stays a tally rather than a percentage.
            </li>
            <li className="text-zinc-500">
              It grows as you keep marking lines and tapping Touched. Nothing here is a prediction —
              every number is a count of what your journal already recorded.
            </li>
          </ul>
        </Collapse>
      </div>

      <div>
        <label htmlFor="level-odds-instrument" className="mb-1 block text-xs font-medium text-zinc-300">
          Instrument
        </label>
        <select
          id="level-odds-instrument"
          value={instrumentId}
          onChange={(event) => {
            const id = event.target.value;
            if (controlledInstrumentId === undefined) setOwnInstrumentId(id);
            onInstrumentChange?.(id);
          }}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
        >
          {instruments.map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrument.symbol}
            </option>
          ))}
        </select>
      </div>

      {/* What today's own weekday says about the lines marked today. */}
      {projection.rows.length > 0 && (
        <div
          id="level-odds-today"
          className="space-y-2 rounded-xl border border-sky-900/50 bg-sky-950/20 p-3"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-sky-300">
            <Clock className="h-3 w-3" />
            Today · {projection.weekdayName}
          </span>
          <p className="text-[10px] text-zinc-400">
            On {projection.weekdayName}s before, the lines you have marked today:
          </p>
          <div className="space-y-1.5">
            {projection.rows.map((row) => (
              <div
                key={row.key}
                data-level-today={row.key}
                className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
              >
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <SideIcon kind={row.kind} />
                  {TIMEFRAME_LABEL[row.timeframe]}{' '}
                  <span className="capitalize text-zinc-400">{row.kind}</span>
                </span>
                <span className="font-mono text-zinc-300">
                  {row.daysReached} of {row.daysMarked} {projection.weekdayName} days
                  {row.enoughDays ? ` · ${row.reachRate}%` : ' · tally'}
                  {row.hours.length
                    ? ` · ~${String(row.hours[0].hour).padStart(2, '0')}:00`
                    : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600">
            Counted from your own record for this weekday — what happened, not a prediction.
          </p>
        </div>
      )}

      {/* Narrow the whole read to a weekday, session or hour. */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
          Narrow the record
        </span>
        <div className="grid grid-cols-3 gap-2">
          <select
            id="level-odds-weekday"
            aria-label="Weekday"
            value={condition.weekday == null ? '' : String(condition.weekday)}
            onChange={(event) => setWeekday(event.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 focus:border-zinc-600 focus:outline-none"
          >
            <option value="">Any day</option>
            {WEEKDAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
          <select
            id="level-odds-session"
            aria-label="Session"
            value={condition.session ?? ''}
            onChange={(event) => setSession(event.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 focus:border-zinc-600 focus:outline-none"
          >
            <option value="">Any session</option>
            {SESSIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            id="level-odds-hour"
            aria-label="Hour of day"
            value={condition.hour == null ? '' : String(condition.hour)}
            onChange={(event) => setHour(event.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 focus:border-zinc-600 focus:outline-none"
          >
            <option value="">Any hour</option>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
      </div>

      {report.daysMarked === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-4 text-[11px] italic text-zinc-500">
          {hasCondition
            ? 'No marked lines match this narrowing. Widen the day, session or hour, or log more of the record.'
            : `Nothing to read yet for ${symbol}. Mark some lines for it on a day or two and log what price did — this fills in as your record grows.`}
        </p>
      ) : (
        <>
          {headline && (
            <p
              id="level-odds-headline"
              className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-[11px] leading-relaxed text-emerald-100/90"
            >
              <span className="font-mono text-[10px] font-bold uppercase text-emerald-400">
                Most reached
              </span>{' '}
              —{' '}
              <span className="font-semibold">
                {TIMEFRAME_LABEL[headline.timeframe]} {headline.kind}
              </span>
              {headline.enoughDays
                ? `, reached on ${headline.daysReached} of ${headline.daysMarked} days you marked it (${headline.reachRate}%).`
                : `, reached on ${headline.daysReached} of ${headline.daysMarked} day${headline.daysMarked === 1 ? '' : 's'} so far — a tally, not a rate yet.`}
            </p>
          )}

          <p className="text-[10px] text-zinc-500">
            Read across {report.daysMarked} day{report.daysMarked === 1 ? '' : 's'} you marked{' '}
            {symbol} lines{conditionLabel ? `, narrowed to ${conditionLabel}` : ''}.
          </p>

          <div className="space-y-2">{report.rows.map(renderRow)}</div>

          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400">
              <Clock className="h-3 w-3" />
              What happened next
            </span>
            {report.sequences.length === 0 ? (
              <p className="text-[10px] text-zinc-500">
                Once a line has been reached on at least {report.minDaysForSequence} days, this
                shows which other lines price reached later the same day.
              </p>
            ) : (
              <div className="space-y-2.5">
                {report.sequences.slice(0, 6).map((seq) => (
                  <div key={seq.key} data-level-sequence={seq.key} className="space-y-1">
                    <p className="text-[11px] leading-relaxed text-zinc-300">
                      After the{' '}
                      <span className="font-semibold">
                        {TIMEFRAME_LABEL[seq.timeframe]} {seq.kind}
                      </span>{' '}
                      was reached ({seq.fromDays} days in your record), price went on to reach:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {seq.also.slice(0, 5).map((other) => (
                        <span
                          key={other.key}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300"
                        >
                          {TIMEFRAME_LABEL[other.timeframe]}{' '}
                          <span className="capitalize text-zinc-400">{other.kind}</span>
                          <span className="font-bold text-indigo-300">{other.rate}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <p className="border-t border-zinc-800 pt-2.5 text-[10px] leading-relaxed text-zinc-600">
        A percentage here is how often it already happened in your journal, with the days behind it
        shown. It is not a prediction, and a thin sample is left as a count on purpose.
      </p>
    </CoachCard>
  );
};
