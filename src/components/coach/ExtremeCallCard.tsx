import React from 'react';
import { Compass, ShieldAlert, Target } from 'lucide-react';
import type { ExtremeRead } from '../../lib/ai/journal-digest';
import type { ExtremeCallResponse } from '../../lib/ai/coach-types';
import type { CoachErrorCode } from '../../lib/ai/coach-client';
import { hourLabel } from '../../lib/analytics/session-extremes';
import {
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachGenerateButton,
  CoachLoading,
  CoachResultPanel,
} from './coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The coach's call on the trader's logged levels.
 *
 * This is the one card in the journal that will state a direction, and it exists because the
 * trader asked for it in as many words. Everything about it is built to keep that honest:
 *
 * - It is an **opinion mode**, so the coach gets the live price and the narrowed rules: every
 *   level it names must be a number the trader recorded or a number from that one live read,
 *   and it must say plainly that it can be wrong.
 * - The call is **checkable or it does not arrive**. A stance, the level it is about, what
 *   makes it live, what would prove it wrong, and the counts from the trader's own log
 *   underneath — all required by the parser, so a vague hunch cannot render.
 * - **Standing aside is a complete answer.** With nothing logged, or a log too thin to carry a
 *   side, the button still works and the answer is "not here".
 *
 * The deterministic half is shown above the button: the readable conditions and the hours, so
 * the call can be judged against the same numbers the coach was handed rather than believed.
 */

export interface ExtremeCallCardProps {
  read: ExtremeRead;
  /** The instrument the call is about — the one whose levels were logged most recently. */
  symbol: string;
  timezone: string;
  loading: boolean;
  failure: { code: CoachErrorCode; message: string } | null;
  /** The last call that arrived, kept while a retry runs so nothing is blanked. */
  answer: ExtremeCallResponse | null;
  writtenAt?: string;
  onRun: () => void;
}

/** The side, as a chip: the only place in the app a direction is ever rendered. */
const STANCE: Record<
  ExtremeCallResponse['stance'],
  { label: string; chip: string; icon: React.ReactNode }
> = {
  long: {
    label: 'Long',
    chip: 'border-emerald-800 bg-emerald-950/70 text-emerald-300',
    icon: <Target className="h-3.5 w-3.5" />,
  },
  short: {
    label: 'Short',
    chip: 'border-rose-800 bg-rose-950/70 text-rose-300',
    icon: <Target className="h-3.5 w-3.5" />,
  },
  'stand-aside': {
    label: 'Stand aside',
    chip: 'border-zinc-700 bg-zinc-900/70 text-zinc-300',
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
  },
};

export const ExtremeCallCard: React.FC<ExtremeCallCardProps> = ({
  read,
  symbol,
  timezone,
  loading,
  failure,
  answer,
  writtenAt,
  onRun,
}) => {
  const stance = answer ? STANCE[answer.stance] : null;

  return (
    <CoachCard id="coach-extreme-call-card" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
          <Compass className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            My call on your levels
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            The one place you get a direction: the side the coach would be on for {symbol}, the
            level that call is about, and what would prove it wrong. It is an opinion built from
            your own log and the live price — never a forecast.
          </p>
        </div>
      </div>

      {read.points === 0 ? (
        <p className="text-xs text-zinc-500 italic">
          Nothing logged yet, so there are no levels for the coach to read. Log a session's
          extremes on Today — with the side each one is acting as — and this can call them.
        </p>
      ) : (
        <>
          {/* The same numbers the coach is handed, so the call can be checked rather than felt. */}
          <div id="coach-extreme-call-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <CoachFact label="Instrument" value={symbol} />
            <CoachFact label="Extremes logged" value={`${read.points}`} />
            <CoachFact label="Levels rated" value={`${read.ratings.rated}`} />
            <CoachFact
              label="Readable conditions"
              value={`${read.patterns.length + read.ratingConditions.length}`}
            />
          </div>

          {(read.ratingConditions.length > 0 || read.patterns.length > 0) && (
            <div className="space-y-1">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                What the call can lean on
              </span>
              <ul className="space-y-1">
                {read.ratingConditions.slice(0, 4).map((bucket) => (
                  <li
                    key={bucket.key}
                    data-call-condition={bucket.key}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-200"
                  >
                    {bucket.label} — {bucket.stats.heldRate}% held over {bucket.stats.rated}{' '}
                    reading{bucket.stats.rated === 1 ? '' : 's'}
                  </li>
                ))}
                {read.patterns.slice(0, 3).map((pattern) => (
                  <li
                    key={pattern.key}
                    data-call-condition={pattern.key}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-200"
                  >
                    {pattern.symbol} [{pattern.timeframe}] overnight {pattern.kind} at{' '}
                    {hourLabel(pattern.hour)} — {pattern.heldRate}% kept over{' '}
                    {pattern.held + pattern.takenOut} judged session
                    {pattern.held + pattern.takenOut === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {read.patterns.length === 0 && read.ratingConditions.length === 0 && (
            <p className="text-[11px] leading-relaxed text-amber-300/90">
              Nothing in the log is readable yet — no hour has enough judged sessions and no
              condition has enough ratings. The coach can still call it, and it should tell you
              it is standing aside rather than invent a side.
            </p>
          )}

          {!answer && (
            <CoachGenerateButton
              id="coach-extreme-call-generate"
              label={failure ? 'Try again' : 'Ask for my call'}
              loadingLabel="Reading your levels…"
              loading={loading}
              onClick={onRun}
            />
          )}

          {loading && (
            <CoachLoading
              label="Reading your levels against the live price…"
              steps={COACH_WAIT_STEPS('your levels')}
            />
          )}

          {failure && (
            <CoachErrorPanel
              code={failure.code}
              message={failure.message}
              idSuffix="extremecall"
            />
          )}

          {answer && stance && (
            <CoachResultPanel
              id="coach-extreme-call-result"
              heading="The call"
              meta={writtenAt ? `written ${formatTimestamp(writtenAt, timezone)}` : undefined}
              resultKey={writtenAt}
              busy={loading}
              onRegenerate={onRun}
              regenerateLabel="Call it again"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  id="coach-extreme-call-stance"
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${stance.chip}`}
                >
                  {stance.icon}
                  {stance.label}
                </span>
                {answer.level !== null && (
                  <span
                    id="coach-extreme-call-level"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 font-mono text-xs text-zinc-100"
                  >
                    {answer.level}
                    {answer.levelType ? ` · ${answer.levelType}` : ''}
                  </span>
                )}
                <span className="ml-auto font-mono text-[10px] uppercase text-zinc-500">
                  confidence {answer.confidence}
                </span>
              </div>

              <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>
              <p className="text-xs text-zinc-300 leading-relaxed">{answer.rationale}</p>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5">
                  <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                    Live when
                  </span>
                  <p className="mt-1 text-xs text-zinc-300 leading-relaxed">{answer.trigger}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5">
                  <span className="text-[10px] font-mono uppercase font-bold text-rose-400">
                    Wrong if
                  </span>
                  <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                    {answer.invalidation}
                  </p>
                </div>
              </div>

              {answer.basedOn.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    The counts behind it
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={answer.basedOn}
                      tone="neutral"
                      emptyLabel="Nothing in your log was quoted."
                    />
                  </div>
                </div>
              )}

              {/* Said on the card, not buried: the app does not know where price goes. */}
              <p className="text-[10px] leading-relaxed text-zinc-500">
                This is the coach's opinion from your own records and one live price, and it can
                be wrong. It is not a forecast, and it is not a reason to take a size you did not
                plan.
              </p>
            </CoachResultPanel>
          )}
        </>
      )}
    </CoachCard>
  );
};
