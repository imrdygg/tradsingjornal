import React from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import type { ExtremeRead } from '../../lib/ai/journal-digest';
import type { ExtremeResponse } from '../../lib/ai/coach-types';
import type { CoachErrorCode } from '../../lib/ai/coach-client';
import { hourLabel } from '../../lib/analytics/session-extremes';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachGenerateButton,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
} from './coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The clock read.
 *
 * The trader's own log of where each session's high and low printed, turned into the only
 * question it can honestly answer: when the overnight extreme printed in a given hour, did
 * the regular session keep it? This is the session-extreme counterpart of the break-and-run
 * edge finder, and it is built the same way:
 *
 * 1. The **record itself**, computed live from the log with no AI — counts, the held rate,
 *    every hour ranked. Shown before any button is pressed so the read can be checked
 *    against the same numbers.
 * 2. The **coach's read**, on request, from the `extremes` mode. Its guardrails forbid
 *    quoting a rate off a thin hour, forbid calling a hold a profit, and forbid saying an
 *    hour "tends to" do anything next session.
 */

export interface ExtremeReadCardProps {
  read: ExtremeRead;
  timezone: string;
  loading: boolean;
  failure: { code: CoachErrorCode; message: string } | null;
  /** The last answer that arrived, kept while a retry runs so nothing is blanked. */
  answer: ExtremeResponse | null;
  writtenAt?: string;
  onRun: () => void;
}

/** A rate, or an honest dash while the sample is too thin to carry one. */
function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

/** One hour from the log, as one line the trader can check. */
function conditionLine(symbol: string, kind: string, hour: number): string {
  return `${symbol} overnight ${kind} printed in the ${hourLabel(hour)} hour`;
}

export const ExtremeReadCard: React.FC<ExtremeReadCardProps> = ({
  read,
  timezone,
  loading,
  failure,
  answer,
  writtenAt,
  onRun,
}) => {
  return (
    <CoachCard id="coach-extremes-card" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
          <Clock className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Where your overnight extremes print
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            From the session extremes you log by hand: when an extreme printed in a given hour,
            did the regular session keep it — and how often.
          </p>
        </div>
      </div>

      {read.points === 0 ? (
        <p className="text-xs text-zinc-500 italic">
          Nothing logged yet. Log a session's overnight and regular high and low on the Today
          tab — under "Where the session extremes printed" — and this reads back which hours
          your extremes land in and whether the open keeps them.
        </p>
      ) : (
        <>
          {/* The deterministic record, shown before any AI so the read can be checked. */}
          <div id="coach-extremes-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <CoachFact label="Sessions logged" value={`${read.sessions}`} />
            <CoachFact label="Extremes logged" value={`${read.points}`} />
            <CoachFact label="Hours readable" value={`${read.patterns.length}`} />
            <CoachFact label="Levels rated" value={`${read.ratings.rated}`} />
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            {read.firstDate && read.lastDate
              ? `Sessions from ${read.firstDate} to ${read.lastDate}. `
              : ''}
            A session is judged only when both its overnight and its regular extreme are
            logged, and {read.minSessions} decided sessions are needed before an hour's rate
            means anything.
            {read.unreadable > 0
              ? ` ${read.unreadable} logged extreme(s) had an unreadable time and are absent from these counts.`
              : ''}
          </p>

          {read.patterns.length === 0 && (
            <p className="text-[11px] text-amber-300/90 leading-relaxed">
              No hour has a readable record yet, so there is nothing to rank — the counts below
              are a tally of what has been logged so far.
            </p>
          )}

          {read.patterns.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Hours with a readable record
              </span>
              <ul className="space-y-1.5">
                {read.patterns.map((pattern) => {
                  const decided = pattern.held + pattern.takenOut;
                  return (
                    <li
                      key={pattern.key}
                      data-extreme-condition={pattern.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                    >
                      <span className="min-w-0 text-xs text-zinc-200">
                        {conditionLine(pattern.symbol, pattern.kind, pattern.hour)}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs font-mono font-semibold text-emerald-400">
                          {formatRate(pattern.heldRate)}
                        </span>
                        <span className="block text-[10px] text-zinc-500">
                          {pattern.held} of {decided} kept
                          {pattern.undecided > 0 ? ` · ${pattern.undecided} not judged` : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {read.ratings.rated > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                What your levels did
              </span>
              <p className="font-mono text-[10px] leading-relaxed text-zinc-500">
                {read.ratings.held} held · {read.ratings.takenOut} taken out ·{' '}
                {read.ratings.chopped} chopped
                {read.ratings.avgGrade === null
                  ? ''
                  : ` · average grade ${read.ratings.avgGrade} of 5`}
                {read.ratings.rated < read.minRated
                  ? ` — ${read.minRated} readings are needed before this is a rate.`
                  : ''}
              </p>

              {read.ratingConditions.length > 0 ? (
                <ul className="space-y-1.5">
                  {read.ratingConditions.map((bucket) => (
                    <li
                      key={bucket.key}
                      data-rating-condition={bucket.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
                    >
                      <span className="min-w-0 text-xs text-zinc-200">{bucket.label}</span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs font-mono font-semibold text-emerald-400">
                          {formatRate(bucket.stats.heldRate)}
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
              ) : (
                <p className="text-[11px] leading-relaxed text-amber-300/90">
                  No condition has {read.minRated} readings yet, so there is no held rate to
                  read — the counts above are a tally of what has been rated so far.
                </p>
              )}
            </div>
          )}

          {read.thinPatterns.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Logged, not yet readable
              </span>
              <ul className="space-y-1">
                {read.thinPatterns.slice(0, 4).map((pattern) => (
                  <li key={pattern.key} className="flex items-start gap-2">
                    <TrendingUp className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                    <span className="text-xs text-zinc-400 leading-relaxed">
                      {conditionLine(pattern.symbol, pattern.kind, pattern.hour)}:{' '}
                      {pattern.held + pattern.takenOut} of {pattern.sessions} session(s) judged
                      {pattern.undecided > 0 ? `, ${pattern.undecided} not judged` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!answer && (
            <CoachGenerateButton
              id="coach-extremes-generate"
              label={failure ? 'Try again' : 'Read my extremes log'}
              loadingLabel="Reading your sessions…"
              loading={loading}
              onClick={onRun}
            />
          )}

          {loading && (
            <CoachLoading
              label="Reading where your extremes printed…"
              steps={COACH_WAIT_STEPS('session extremes')}
            />
          )}

          {failure && (
            <CoachErrorPanel code={failure.code} message={failure.message} idSuffix="extremes" />
          )}

          {answer && (
            <CoachResultPanel
              id="coach-extremes-result"
              heading="Result"
              meta={writtenAt ? `written ${formatTimestamp(writtenAt, timezone)}` : undefined}
              resultKey={writtenAt}
              busy={loading}
              onRegenerate={onRun}
              regenerateLabel="Read again"
            >
              <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>
              <p className="text-xs text-zinc-300 leading-relaxed">{answer.bestPattern}</p>

              {answer.patterns.length > 0 && (
                <div className="space-y-2">
                  {answer.patterns.map((pattern, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-zinc-200">
                          {pattern.condition}
                        </span>
                        <span className="shrink-0 text-xs font-mono text-emerald-400">
                          {pattern.heldRate}
                        </span>
                      </div>
                      {pattern.evidence && (
                        <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                          {pattern.evidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {answer.levelsRead && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    What your marked levels did
                  </span>
                  <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                    {answer.levelsRead}
                  </p>
                </div>
              )}

              {answer.notYetRated.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Rated, not yet readable
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={answer.notYetRated}
                      tone="neutral"
                      emptyLabel="Every rated condition has enough readings."
                    />
                  </div>
                </div>
              )}

              {answer.notYetReadable.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Not yet readable
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={answer.notYetReadable}
                      tone="neutral"
                      emptyLabel="Every logged hour has enough decided sessions."
                    />
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-300 leading-relaxed">{answer.whatItMeans}</p>
              <CoachAction label="Next step" text={answer.nextStep} />
              <CoachMotivation text={answer.motivation} />
            </CoachResultPanel>
          )}
        </>
      )}
    </CoachCard>
  );
};
