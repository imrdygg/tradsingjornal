import React, { useMemo, useState } from 'react';
import { ArrowRight, Info, Send, Target } from 'lucide-react';
import type { Instrument, LevelTouch, MarkedLevel } from '../../types';
import type { LevelRecord } from '../../lib/mes/types';
import { DEFAULT_MES_TIMEFRAME } from '../../lib/mes/constants';
import {
  bridgeFromMes,
  bridgeFromPlaybook,
  bridgedLevelFigures,
  bridgedLevelLabel,
  type BridgedLevel,
} from '../../lib/mes/playbook-bridge';
import { CoachCard } from '../coach/coach-ui';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { TIMEFRAME_LABEL } from '../../lib/analytics/level-timeframes';
import { formatTradingDate } from '../../lib/storage/date-utils';

/**
 * The way across from the lines written down here to the ones tracked on the MES tab.
 *
 * A line is the same line in both records — the same price off the same chart on the same session
 * — but it is entered in two places for two different reasons. The marked-level card above writes
 * the trader's lines down before any of them is tested, because an untested line is a fact about
 * how they read their chart. The MES tracker records the same lines with what price did when it
 * reached them, because which lines actually hold is the thing being counted.
 *
 * Typing them out twice is the whole problem this card solves. It hands the lines over in one
 * press, carrying every test already logged against them: a touch price came back off is a hold,
 * one that broke away is a break, and a touch still being watched counts as a test that settled
 * neither way. All three are the tracker's own vocabulary, so nothing is converted into a claim
 * the record does not support.
 *
 * The direction back is deliberately not here. The tracker's Data screen owns it, because the
 * lines that come back are the tracker's own record and it is where the trader can see what it
 * holds. This card only reports how many of them are not marked here yet, so the count is visible
 * from the side the trader is standing on.
 *
 * Nothing crosses silently and nothing crosses twice. A line already in the tracker is skipped
 * rather than duplicated, a line set aside as void is not a level and does not cross at all, and
 * a line on another instrument never crosses: the tracker records MES alone, and relabelling
 * another market's price as MES would put a number on the record the trader never read off these
 * charts.
 */

export interface MesTrackerCardProps {
  /** Every marked level on the record, across all days. */
  levels: MarkedLevel[];
  /** Every touch, so a line's own tests can travel with it. */
  touches: LevelTouch[];
  /** The tracker's own record, so the card can say what is already over there. */
  mesLevels: LevelRecord[];
  /** The playbook instruments, so both sides are named from the trader's own catalog. */
  instruments: Instrument[];
  /** The playbook instrument the tracker records — MES. */
  instrumentId: string;
  /** The instrument currently open in the marked-level card above. */
  openInstrumentId: string;
  /** The trader's own timezone, so a touch's clock is read on their own dial. */
  timezone: string;
  /** Writes the lines into the tracker. Returns how many the tracker actually added. */
  onSend: (levels: BridgedLevel[]) => number;
}

/** How many lines the preview lists before it stops being a preview. */
const PREVIEW_LIMIT = 6;

/** Case-insensitive instrument comparison, so a stray casing never blocks a real write. */
function sameInstrument(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A stable key for a preview row — never the array index, so a re-render cannot mix rows up. */
function rowKey(level: BridgedLevel): string {
  return `${level.date}|${level.timeframe}|${level.kind}|${level.price}`;
}

export const MesTrackerCard: React.FC<MesTrackerCardProps> = ({
  levels,
  touches,
  mesLevels,
  instruments,
  instrumentId,
  openInstrumentId,
  timezone,
  onSend,
}) => {
  const [status, setStatus] = useState<string | null>(null);

  /**
   * The lines waiting to cross, and the lines already there.
   *
   * Both directions are read from the records as they are right now rather than remembered in
   * state, so a line marked or deleted above is reflected the next time this renders instead of
   * sitting in a stale count.
   */
  const toTracker = useMemo(
    () => bridgeFromPlaybook(levels, touches, mesLevels, { instrumentId, timezone }),
    [levels, touches, mesLevels, instrumentId, timezone]
  );
  const toPlaybook = useMemo(
    () => bridgeFromMes(mesLevels, levels, { instrumentId }),
    [mesLevels, levels, instrumentId]
  );

  const symbol = instrumentSymbol(instruments, instrumentId);
  // The tracker records one instrument. Handing it another market's lines would put a price on
  // the record under the wrong symbol, so the button is held rather than quietly relabelling.
  const recordsOpenInstrument = sameInstrument(openInstrumentId, instrumentId);
  const waiting = toTracker.levels.length;
  const canSend = recordsOpenInstrument && waiting > 0;

  const handleSend = () => {
    const added = onSend(toTracker.levels);
    const parts: string[] = [];
    if (added > 0) {
      parts.push(`Added ${added} line${added === 1 ? '' : 's'} to the ${symbol} tracker.`);
    } else {
      parts.push('Nothing new landed — the tracker already held those lines.');
    }
    if (toTracker.skipped > 0) {
      parts.push(
        `${toTracker.skipped} ${toTracker.skipped === 1 ? 'was' : 'were'} already logged there.`
      );
    }
    if (toTracker.untaggedCharts > 0) {
      parts.push(
        `${toTracker.untaggedCharts} had no chart recorded and ${
          toTracker.untaggedCharts === 1 ? 'is' : 'are'
        } filed on ${TIMEFRAME_LABEL[DEFAULT_MES_TIMEFRAME]}.`
      );
    }
    setStatus(parts.join(' '));
  };

  return (
    <CoachCard id="playbook-mes-tracker" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
          <Target className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">MES Indicator Levels</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Hand the lines you marked here to the MES tab, so the same read is not typed out twice.
            Every touch already logged against a line goes with it — what price did when it reached
            the line is exactly what the tracker counts, and it must not be re-entered by hand into
            a different answer.
          </p>
        </div>
      </div>

      {/* What is waiting to cross, and the one press that moves it. */}
      <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
        <p className="text-[11px] leading-relaxed text-zinc-300">
          <span className="font-mono text-zinc-100">{waiting}</span> line
          {waiting === 1 ? '' : 's'} on {symbol} the tracker does not hold yet.
          {toTracker.skipped > 0 && (
            <span className="text-zinc-500">
              {' '}
              {toTracker.skipped} more {toTracker.skipped === 1 ? 'is' : 'are'} already logged
              there and will be left alone.
            </span>
          )}
        </p>

        {toTracker.untaggedCharts > 0 && (
          <p className="text-[10px] leading-relaxed text-amber-300/80">
            {toTracker.untaggedCharts} of them never had a chart recorded here. The tracker holds
            one chart per line, so {toTracker.untaggedCharts === 1 ? 'it is' : 'they are'} filed on{' '}
            {TIMEFRAME_LABEL[DEFAULT_MES_TIMEFRAME]} rather than dropped.
          </p>
        )}

        {!recordsOpenInstrument ? (
          <p className="text-[10px] leading-relaxed text-amber-300/80">
            The tracker records {symbol} alone, and {' '}
            {instrumentSymbol(instruments, openInstrumentId)} is open above. Switch to{' '}
            {symbol} to hand its lines across.
          </p>
        ) : (
          waiting === 0 && (
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Every line marked on {symbol} is already in the tracker. Mark another above and it
              will be waiting here.
            </p>
          )
        )}

        <button
          type="button"
          id="playbook-mes-send"
          onClick={handleSend}
          disabled={!canSend}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-800/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900/40 disabled:text-zinc-600"
        >
          <Send className="h-3.5 w-3.5" />
          Send to the MES tracker
        </button>

        {status && (
          <p
            id="playbook-mes-status"
            className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 px-2 py-1 text-[11px] leading-relaxed text-zinc-300"
          >
            {status}
          </p>
        )}
      </div>

      {/*
        What would cross, listed line by line. A count alone would hide the two things that make
        this press safe to make: which lines are moving, and what each one already has behind it.
        A line with nothing decided is shown as a tally, never as a rate of nothing.
      */}
      {waiting > 0 && (
        <ul className="space-y-1.5">
          {toTracker.levels.slice(0, PREVIEW_LIMIT).map((level) => {
            const figures = bridgedLevelFigures(level);
            const decided = level.holds + level.breaks;
            return (
              <li
                key={rowKey(level)}
                data-playbook-mes-row
                className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <span className="font-mono text-[11px] font-semibold text-zinc-200">
                    {bridgedLevelLabel(level)}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {formatTradingDate(level.date, timezone)}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
                  tests {level.touches} · held {level.holds} · broke {level.breaks}
                  {decided > 0 ? (
                    <>
                      {' '}
                      — strength <span className="font-mono text-zinc-300">{figures.strength}</span>{' '}
                      (grade {figures.grade})
                    </>
                  ) : (
                    <span className="text-zinc-500"> — no decided test yet, so no rate</span>
                  )}
                </p>
                {level.label && (
                  <p className="mt-0.5 text-[10px] text-zinc-500">Your label: {level.label}</p>
                )}
                {level.notes && (
                  <p className="mt-0.5 text-[10px] text-zinc-500">Your note: {level.notes}</p>
                )}
              </li>
            );
          })}
          {waiting > PREVIEW_LIMIT && (
            <li className="text-[10px] text-zinc-500">
              and {waiting - PREVIEW_LIMIT} more — all of them go across in the same press.
            </li>
          )}
        </ul>
      )}

      {/*
        The other direction, reported rather than offered. The lines that come back are the
        tracker's own record, so the tracker's Data screen is where that press lives — but the
        count belongs here too, or the trader would have to remember to go and look.
      */}
      <div className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5">
        <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
        <p className="text-[10px] leading-relaxed text-zinc-400">
          <span className="font-mono text-zinc-200">{toPlaybook.levels.length}</span> of the
          tracker&apos;s lines are not marked here yet. That direction is sent from the tracker&apos;s
          own <span className="font-semibold text-zinc-300">Data</span> screen, where the record it
          reads from is on screen. The tracker&apos;s tallies and its pattern tag stay over there —
          this tab&apos;s own rates are built from the touches you log, not from a level&apos;s
          stored counts, so nothing is double-counted either way.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5">
        <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
        <p className="text-[10px] leading-relaxed text-zinc-400">
          Lines you set aside as <span className="font-semibold text-zinc-300">void</span> are not
          levels and do not cross. Crossing is one-way and one-off: after a line moves it is two
          independent records, and editing one never rewrites the other. That is on purpose — a
          level&apos;s tallies are your own account of what happened, and nothing here predicts what
          a line does next.
        </p>
      </div>
    </CoachCard>
  );
};
