import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, Clock, Info, ArrowLeftRight } from 'lucide-react';
import { DailyReview, Instrument, Setup, Trade, TradingDay } from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { PostCloseResponse, PrepResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, requestCoach } from '../../lib/ai/coach-client';
import {
  CachedCheckpointNote,
  CHECKPOINTS,
  CheckpointId,
  checkpointWindowNote,
  isNoteStale,
  journalFingerprint,
  otherCheckpoint,
  readCachedNote,
  resolveCheckpoint,
  writeCachedNote,
} from '../../lib/ai/checkpoints';
import { formatTimestamp } from '../../lib/storage/date-utils';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachLabel,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
  money,
} from '../coach/coach-ui';

interface CoachCheckpointCardProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
}

/** Runtime guards so a cached note from an older build cannot break rendering. */
const isPrep = (data: unknown): data is PrepResponse =>
  !!data && typeof data === 'object' && 'yesterdayLesson' in data && 'howToApproach' in data;

const isPostClose = (data: unknown): data is PostCloseResponse =>
  !!data && typeof data === 'object' && 'whatHappened' in data && 'tomorrowAction' in data;

export const CoachCheckpointCard: React.FC<CoachCheckpointCardProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
}) => {
  // Which checkpoint applies now, refreshed as the clock crosses a boundary. The
  // trader can always switch manually, so a timezone quirk never blocks them.
  const [auto, setAuto] = useState<CheckpointId>(() => resolveCheckpoint(timezone));
  useEffect(() => {
    const tick = () => {
      const next = resolveCheckpoint(timezone);
      // Bailing out when unchanged means this does not re-render every minute.
      setAuto((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [timezone]);

  const [override, setOverride] = useState<CheckpointId | null>(null);
  const checkpoint = override ?? auto;
  const info = CHECKPOINTS[checkpoint];

  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays,
        reviews,
        setups,
        instruments,
        todayTradeDate,
      }),
    [trades, tradingDays, reviews, setups, instruments, todayTradeDate]
  );

  const fingerprint = useMemo(
    () => journalFingerprint({ trades, tradingDays, reviews }),
    [trades, tradingDays, reviews]
  );

  const [note, setNote] = useState<CachedCheckpointNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ code: CoachErrorCode; message: string } | null>(null);

  useEffect(() => {
    // A cached note is per trading date and per checkpoint, so switching checkpoints
    // never shows the wrong day's writing.
    setNote(readCachedNote(todayTradeDate, checkpoint));
    setFailure(null);
  }, [todayTradeDate, checkpoint]);

  const generate = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    const result = await requestCoach(checkpoint, digest);
    setBusy(false);

    if (!result.ok) {
      setFailure({ code: result.code, message: result.message });
      return;
    }

    const fresh: CachedCheckpointNote = {
      checkpoint,
      date: todayTradeDate,
      generatedAt: new Date().toISOString(),
      fingerprint,
      data: result.data,
    };
    writeCachedNote(fresh);
    setNote(fresh);
  }, [checkpoint, digest, fingerprint, todayTradeDate]);

  const stale = note ? isNoteStale(note, fingerprint) : false;
  const showResult = !!note && (checkpoint === 'prep' ? isPrep(note.data) : isPostClose(note.data));
  // A failed attempt must still leave a way to retry.
  const actionText = failure ? 'Try again' : note ? 'Regenerate' : info.actionLabel;

  return (
    <CoachCard id="coach-checkpoint-card" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-amber-400 uppercase">
                Coach
              </span>
              <span
                id="coach-checkpoint-label"
                className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-800 bg-amber-950/50 text-amber-300"
              >
                {info.label}
              </span>
              <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-500">
                <Clock className="h-3 w-3" />
                {info.windowLabel}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{info.description}</p>
          </div>
        </div>

      </div>

      {/* The grade of evidence, shown before the advice so it can be judged. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          id="coach-checkpoint-evidence"
          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
            digest.dataSufficiency.hasEnoughForPatterns
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
              : 'bg-amber-950/80 text-amber-300 border-amber-800'
          }`}
        >
          {digest.dataSufficiency.hasEnoughForPatterns ? 'Enough to see patterns' : 'Thin evidence'}
        </span>
        <span className="text-[10px] font-mono text-zinc-500">
          {digest.dataSufficiency.closedTrades} closed · {digest.dataSufficiency.reviewedDays} reviewed
          {digest.streaks.consecutiveLosingDays > 0
            ? ` · ${digest.streaks.consecutiveLosingDays} losing day(s) in a row`
            : ''}
        </span>
      </div>

      {stale && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 px-3.5 py-2.5">
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            Your journal has changed since this was written
            {note ? ` (${formatTimestamp(note.generatedAt, timezone)})` : ''}. It may refer to trades
            you have since edited — regenerate for advice on the current state.
          </p>
        </div>
      )}

      {!busy && (
        <button
          id="coach-checkpoint-generate"
          onClick={generate}
          className="flex items-center gap-2 rounded-xl bg-amber-500/90 hover:bg-amber-400 text-zinc-950 px-4 py-2 text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Sparkles className="w-4 h-4" />
          {actionText}
        </button>
      )}

      {busy && <CoachLoading label={info.loadingLabel} />}

      {failure && (
        <CoachErrorPanel code={failure.code} message={failure.message} idSuffix="checkpoint" />
      )}

      {showResult && note && (
        <CoachResultPanel
          id="coach-checkpoint-result"
          heading="Result"
          meta={`written ${formatTimestamp(note.generatedAt, timezone)}`}
          // A regenerated note carries a new timestamp, which re-opens a folded panel.
          resultKey={note.generatedAt}
        >
          {checkpoint === 'prep' && isPrep(note.data) ? (
            <>
              <p className="text-sm font-semibold text-zinc-100 leading-snug">{note.data.headline}</p>

              <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3.5 py-3">
                <CoachLabel text="Yesterday's lesson" tone="bad" />
                <p className="mt-1 text-xs text-amber-100/90 leading-relaxed italic">
                  {note.data.yesterdayLesson}
                </p>
              </div>

              <div>
                <CoachLabel text="How to approach today" />
                <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                  {note.data.howToApproach}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <CoachLabel text="Watch out for" tone="bad" />
                  <div className="mt-1.5">
                    <CoachBullets
                      items={note.data.watchOutFor}
                      tone="bad"
                      emptyLabel="Nothing repeated enough to warn you about."
                    />
                  </div>
                </div>
                <div>
                  <CoachLabel text="Still missing from today's plan" />
                  <div className="mt-1.5">
                    <CoachBullets
                      items={note.data.planGaps}
                      tone="neutral"
                      emptyLabel="Your plan has no obvious gaps."
                    />
                  </div>
                </div>
              </div>

              <CoachMotivation text={note.data.motivation} />
            </>
          ) : isPostClose(note.data) ? (
            <>
              <p className="text-sm font-semibold text-zinc-100 leading-snug">{note.data.headline}</p>
              <p className="text-xs text-zinc-300 leading-relaxed">{note.data.whatHappened}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <CoachFact label="Today's result" value={money(digest.today.netPnL)} />
                <CoachFact label="Trades today" value={`${digest.today.tradesTaken}`} />
                <CoachFact
                  label="Discipline"
                  value={
                    digest.discipline.reviewedDays
                      ? `${digest.discipline.avgScore}/100`
                      : 'no reviews'
                  }
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <CoachLabel text="Went well" tone="good" />
                  <div className="mt-1.5">
                    <CoachBullets
                      items={note.data.wentWell}
                      tone="good"
                      emptyLabel="Nothing in the record went well today."
                    />
                  </div>
                </div>
                <div>
                  <CoachLabel text="Went wrong" tone="bad" />
                  <div className="mt-1.5">
                    <CoachBullets
                      items={note.data.wentWrong}
                      tone="bad"
                      emptyLabel="Nothing in the record went wrong today."
                    />
                  </div>
                </div>
              </div>

              <div>
                <CoachLabel text="Rules broken today" tone="bad" />
                <div className="mt-1.5">
                  <CoachBullets
                    items={note.data.rulesBroken}
                    tone="bad"
                    emptyLabel="None — or your end-of-day review is not done yet."
                  />
                </div>
              </div>

              <CoachAction label="Change for tomorrow" text={note.data.tomorrowAction} />
              <CoachMotivation text={note.data.motivation} />
            </>
          ) : null}
        </CoachResultPanel>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2.5">
        <button
          id="coach-checkpoint-switch"
          onClick={() => setOverride(override ? null : otherCheckpoint(auto))}
          className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <ArrowLeftRight className="h-3 w-3" />
          {override ? 'Back to now' : `Show ${CHECKPOINTS[otherCheckpoint(checkpoint)].label.toLowerCase()} instead`}
        </button>
        <span className="flex items-center gap-1 text-[10px] text-zinc-600">
          <Info className="h-3 w-3" />
          Reads only your journal — no market data or predictions.
        </span>
      </div>

      {/* Both boundaries, so the schedule is discoverable rather than implied. */}
      <p id="coach-checkpoint-schedule" className="text-[10px] text-zinc-600">
        {checkpointWindowNote()}
      </p>
    </CoachCard>
  );
};
