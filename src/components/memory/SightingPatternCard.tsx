import React, { useMemo, useState } from 'react';
import { Brain } from 'lucide-react';
import type {
  Instrument,
  Setup,
  Trade,
  TradingDay,
  TradingObservation,
} from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { SightingsResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  buildSightingNotesFacts,
  countSightingNotes,
  MAX_SIGHTINGS_PER_READ,
} from '../../lib/memory/pattern-input';
import {
  CoachAction,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachGenerateButton,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
} from '../coach/coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The coach's read of the trader's own sighting notes.
 *
 * This is where the memory library stops being a folder and starts being a memory: the trader
 * photographed the market and wrote what they saw under each picture, and this card asks the
 * coach to name what keeps recurring across those notes.
 *
 * Three boundaries are deliberate:
 *
 *   1. **The pictures are not sent with this read.** They are embedded separately so a
 *      resemblance search can find them; re-reading every chart here would be a different
 *      question and a much larger request. The notes are the material, and the card says so
 *      rather than letting the answer quietly describe a chart it never saw.
 *   2. **Only sightings with a note are counted.** A picture with no words is still searchable,
 *      but it cannot contribute to a pattern, and a count that included it would overstate how
 *      much the trader had actually said.
 *   3. **The read is bounded and says so.** The newest sightings are sent, up to the same cap
 *      the endpoint enforces, and the card reports "listed X of Y" so a thin answer is
 *      understood as a thin read rather than a thin library.
 */
export interface SightingPatternCardProps {
  observations: TradingObservation[];
  instruments: Instrument[];
  setups: Setup[];
  trades: Trade[];
  tradingDays: TradingDay[];
  timezone: string;
  todayTradeDate: string;
}

interface PatternState {
  loading: boolean;
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  writtenAt?: string;
}

const IDLE: PatternState = { loading: false, result: null, failure: null };

export const SightingPatternCard: React.FC<SightingPatternCardProps> = ({
  observations,
  instruments,
  setups,
  trades,
  tradingDays,
  timezone,
  todayTradeDate,
}) => {
  /**
   * A digest is required by the coach endpoint on every call, and this is a real one built from
   * the journal the memory tab already holds. Its sections are withheld server-side for this
   * mode, so the answer is about the notes rather than about results.
   */
  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays,
        reviews: [],
        setups,
        instruments,
        todayTradeDate,
        timezone,
      }),
    [trades, tradingDays, setups, instruments, todayTradeDate, timezone]
  );

  const facts = useMemo(() => buildSightingNotesFacts(observations), [observations]);
  const noteCount = useMemo(() => countSightingNotes(observations), [observations]);
  const [state, setState] = useState<PatternState>(IDLE);

  const answer = state.result?.ok ? (state.result.data as SightingsResponse) : null;

  async function run() {
    setState((previous) => ({ ...previous, loading: true, failure: null }));
    const result = await requestCoach('sightings', digest, undefined, { sightings: facts });

    if (result.ok) {
      setState({
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
      });
      return;
    }
    setState((previous) => ({
      ...previous,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  return (
    <CoachCard id="memory-sighting-patterns" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Brain className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold tracking-tight text-zinc-100">
            What your notes keep saying
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
            Your coach reads the notes you wrote under your sighting pictures — what held, what
            broke, what you were waiting for — and names the patterns that keep recurring. It
            works from your words only. The pictures are not sent with this read, it cannot see
            the market, and it never turns a sighting into a trade call.
          </p>
        </div>
      </div>

      {noteCount === 0 ? (
        <p id="memory-sighting-patterns-empty" className="text-xs italic text-zinc-500">
          No notes written yet. Record a sighting and put one line under the picture — what you
          saw, in your own words. That note is the material this read works from.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CoachFact label="Sightings" value={String(facts.total)} />
            <CoachFact label="Notes written" value={String(noteCount)} />
            <CoachFact
              label="Sent to the read"
              value={`${facts.listed} of ${facts.total}`}
            />
            <CoachFact label="Cap per read" value={String(MAX_SIGHTINGS_PER_READ)} />
          </div>

          <p className="text-[11px] leading-relaxed text-zinc-500">
            {facts.listed < facts.total
              ? `Your newest ${facts.listed} sightings travel with this read; the rest of the library stays here. Only sightings that carry a note are counted.`
              : 'Every sighting that carries a note travels with this read. A picture with no words is still searchable by likeness, but it cannot contribute to a pattern.'}
          </p>

          {!answer && (
            <CoachGenerateButton
              id="memory-sighting-patterns-generate"
              label={state.failure ? 'Try again' : 'Read my notes for a pattern'}
              loadingLabel="Reading your sighting notes…"
              loading={state.loading}
              onClick={run}
            />
          )}

          {state.loading && (
            <CoachLoading
              label="Reading what you wrote under each chart…"
              steps={COACH_WAIT_STEPS('your sightings')}
            />
          )}

          {state.failure && (
            <CoachErrorPanel
              code={state.failure.code}
              message={state.failure.message}
              idSuffix="sightings"
            />
          )}

          {answer && (
            <CoachResultPanel
              id="memory-sighting-patterns-result"
              heading="Result"
              meta={
                state.writtenAt
                  ? `written ${formatTimestamp(state.writtenAt, timezone)}`
                  : undefined
              }
              resultKey={state.writtenAt}
              busy={state.loading}
              onRegenerate={run}
              regenerateLabel="Read again"
            >
              <p className="text-sm font-semibold leading-snug text-zinc-100">
                {answer.headline}
              </p>

              {answer.read && (
                <p className="text-xs leading-relaxed text-zinc-300">{answer.read}</p>
              )}

              {answer.patterns.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Patterns across your sightings
                  </span>
                  {answer.patterns.map((pattern, index) => (
                    <div
                      key={index}
                      id={`memory-sighting-pattern-${index}`}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-xs font-semibold text-zinc-200">{pattern.pattern}</p>
                        <span className="rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                          {pattern.sightings} sighting{pattern.sightings === 1 ? '' : 's'}
                        </span>
                      </div>
                      {pattern.evidence && (
                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                          {pattern.evidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {answer.method && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    How it read them
                  </span>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">{answer.method}</p>
                </div>
              )}

              {answer.notEnoughYet && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Not enough yet
                  </span>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                    {answer.notEnoughYet}
                  </p>
                </div>
              )}

              <CoachAction label="Next step" text={answer.nextStep} />
              <CoachMotivation text={answer.motivation} />
            </CoachResultPanel>
          )}
        </>
      )}
    </CoachCard>
  );
};
