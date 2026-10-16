import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Images, Info, Loader2 } from 'lucide-react';
import type { Instrument, Trade, TradingObservation } from '../../types';
import { countUnlabelledImages, planJournalImport } from '../../lib/memory/journal-import';
import {
  importJournalScreenshots,
  type JournalImportResult,
} from '../../lib/memory/journal-import-runner';

/**
 * Bringing the journal's own screenshots into the memory library.
 *
 * The screen exists because of one confusing, completely honest state: a journal holding hundreds of
 * trade charts beside a library that searches nothing. Every number on the Indexing tab is correct
 * in that state, and it still reads as a broken feature, because nothing on screen says that the
 * library only ever reads sightings. This panel says it, and then offers the one action that closes
 * the gap.
 *
 * The action deliberately does not promise a searchable result. An imported picture arrives UNLABELLED
 * — a chart attached to a trade cannot be shown to be from before the decision, and only a picture
 * from before the decision may be matched on — so the panel's promise is smaller and true: the
 * pictures are here, they can be read, and each one is waiting for a single answer before it can be
 * found.
 *
 * The counts are all derived from the journal and the library on every render, so the panel is also
 * how a trader checks what happened: after an import the "ready" number falls to zero and the
 * pictures appear below as cards asking what they show.
 */

export interface JournalImportPanelProps {
  trades: Trade[];
  observations: TradingObservation[];
  instruments: Instrument[];
  userId: string;
  timezone: string;
  /** Whether the trader has consented to cloud image processing. Decides a picture's queue state. */
  consentToIndex: boolean;
  /** False in a local-only build, where there is no bucket to upload into. */
  cloudEnabled: boolean;
  onSave: (observation: TradingObservation) => void;
}

/** Reads the panel's numbers off a plan, named once so the wording and the arithmetic cannot drift. */
function summarise(plan: ReturnType<typeof planJournalImport>, unlabelled: number) {
  return {
    total: plan.totalJournalImages,
    alreadyHere: plan.skippedByReason['already-imported'],
    ready: plan.imagesToImport,
    // The page's own size, which is what the button actually does. The plan stays as it is: a label
    // that said "24 ready" while the button brought in 400 would be the same class of wrong number
    // this panel exists to fix.
    page: plan.candidates.reduce((sum, candidate) => sum + candidate.images.length, 0),
    trades: plan.candidates.length,
    unlabelled,
  };
}

export const JournalImportPanel: React.FC<JournalImportPanelProps> = ({
  trades,
  observations,
  instruments,
  userId,
  timezone,
  consentToIndex,
  cloudEnabled,
  onSave,
}) => {
  const plan = useMemo(() => planJournalImport({ trades, observations }), [trades, observations]);
  const unlabelled = useMemo(() => countUnlabelledImages(observations), [observations]);
  const facts = summarise(plan, unlabelled);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JournalImportResult | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await importJournalScreenshots({
        plan,
        trades,
        observations,
        instruments,
        userId,
        timezone,
        consent: consentToIndex,
        cloudEnabled,
      });
      // Persisted one record at a time: this component does not own the journal, and an import that
      // uploaded pictures but forgot the records would leave the bucket holding work nobody can see.
      for (const observation of outcome.observations) onSave(observation);
      setResult(outcome);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'The import could not be completed. Nothing already in your library was changed.'
      );
    } finally {
      setBusy(false);
    }
  }

  const nothingToDo = facts.ready === 0;

  return (
    <section
      id="memory-journal-import"
      className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
          <Images className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold tracking-tight text-zinc-100">
            Bring in the charts your journal already has
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
            A chart attached to a trade belongs to that trade, and this library only searches your
            recorded sightings — which is why a journal full of screenshots can sit beside a search
            that finds nothing. Bring them across and they arrive{' '}
            <span className="text-zinc-300">unlabelled</span>, because a chart attached to a trade
            does not say whether it was taken before or after the decision. Only a picture from
            before the decision may ever be matched on, so each one waits for that one answer.
          </p>
        </div>
      </div>

      {facts.total === 0 ? (
        <p
          id="memory-journal-import-empty"
          className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-500"
        >
          No trade in this journal has a chart attached, so there is nothing to bring in. A sighting
          recorded here is the other way into the library, and it is the one this screen is named
          after.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { id: 'total', label: 'Trade screenshots', value: facts.total },
              { id: 'already', label: 'Already imported', value: facts.alreadyHere },
              { id: 'ready', label: 'Ready to bring in', value: facts.ready },
              { id: 'unlabelled', label: 'Waiting for a label', value: facts.unlabelled },
            ].map((fact) => (
              <div
                key={fact.id}
                id={`memory-journal-import-${fact.id}`}
                data-value={fact.value}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-center"
              >
                <div className="font-mono text-base font-semibold text-zinc-100">{fact.value}</div>
                <div className="text-[9px] uppercase tracking-wide text-zinc-500">{fact.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="memory-journal-import-run"
              onClick={() => void run()}
              disabled={busy || nothingToDo}
              className="flex items-center gap-2 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy
                ? 'Bringing them in…'
                : nothingToDo
                ? 'Nothing left to bring in'
                : `Bring in ${facts.page} picture${facts.page === 1 ? '' : 's'}`}
            </button>
            <span className="text-[10px] leading-relaxed text-zinc-500">
              {cloudEnabled
                ? 'Stored in your private storage.'
                : 'No cloud is configured, so they are kept in this browser.'}{' '}
              {consentToIndex
                ? 'Labelling one is what queues it to be indexed.'
                : 'Nothing is sent to the model while indexing is switched off.'}
            </span>
          </div>

          {plan.truncated && !nothingToDo && (
            <p className="text-[10px] leading-relaxed text-zinc-500">
              One page at a time, so a large backlog is not one press away from hundreds of uploads.
              Press again after this page for the rest.
            </p>
          )}

          {plan.skippedByReason['no-decision-time'] > 0 && (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {plan.skippedByReason['no-decision-time']} picture(s) are on trades with no recorded
                entry time. There is nothing to place them at, so they are left where they are rather
                than given a time nobody entered. Adding the entry time to the trade brings them in.
              </span>
            </p>
          )}

          {plan.skippedByReason['unreadable-source'] > 0 && (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {plan.skippedByReason['unreadable-source']} attachment(s) are not pictures this
                import can store — a clip, or a reference it cannot read.
              </span>
            </p>
          )}

          {error && (
            <p
              id="memory-journal-import-error"
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-300"
            >
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {result && (
            <div
              id="memory-journal-import-result"
              className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3"
            >
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-300">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                <span>
                  Brought in {result.imported} picture{result.imported === 1 ? '' : 's'} from{' '}
                  {result.created + result.updated} trade
                  {result.created + result.updated === 1 ? '' : 's'}
                  {result.updated > 0
                    ? `, ${result.updated} of which already had a sighting and had these added to it`
                    : ''}
                  . Each one is unlabelled below, waiting for you to say what it shows.
                  {result.cancelled ? ' The run was stopped before it finished.' : ''}
                </span>
              </p>
              {result.failures.length > 0 && (
                <p className="text-[10px] leading-relaxed text-amber-300/90">
                  {result.failures.length} picture(s) could not be brought in:{' '}
                  {result.failures
                    .slice(0, 3)
                    .map((failure) => failure.reason)
                    .join(' ')}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};
