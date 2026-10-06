import React, { useMemo, useState } from 'react';
import { Brain, Plus, Trash2 } from 'lucide-react';
import { MindsetMood, MindsetNote, TradingDay } from '../../types';
import type { MindsetResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode } from '../../lib/ai/coach-client';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachGenerateButton,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
} from './coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The trader's own mindset journal, under the Coach tab.
 *
 * Every other card on this tab reads what the trader DID — trades, plans, reviews, levels.
 * This is the one place they write what was going on in their head while they did it, in
 * their own words, as many times through the day as they need. The notes are theirs and are
 * kept as they wrote them; a feeling is optional and nothing is inferred when it is absent.
 *
 * The reflection below is asked for, never automatic: it reads the notes back, counts the
 * feelings, and — because the notes and the trades share a date — says whether a recorded
 * feeling tends to sit beside the trader's better or worse days. It is a mirror, not a signal,
 * and the coach is explicitly told never to diagnose or to turn a feeling into a trade.
 */

/** The feelings a note can carry, in the order they are offered. */
export const MINDSET_MOODS: Array<{ value: MindsetMood; label: string; tone: string }> = [
  { value: 'calm', label: 'Calm', tone: 'border-emerald-800 bg-emerald-950/60 text-emerald-300' },
  {
    value: 'confident',
    label: 'Confident',
    tone: 'border-emerald-800 bg-emerald-950/60 text-emerald-300',
  },
  { value: 'focused', label: 'Focused', tone: 'border-sky-800 bg-sky-950/60 text-sky-300' },
  { value: 'neutral', label: 'Neutral', tone: 'border-zinc-700 bg-zinc-900 text-zinc-300' },
  { value: 'anxious', label: 'Anxious', tone: 'border-amber-800 bg-amber-950/60 text-amber-300' },
  {
    value: 'frustrated',
    label: 'Frustrated',
    tone: 'border-amber-800 bg-amber-950/60 text-amber-300',
  },
  { value: 'fearful', label: 'Fearful', tone: 'border-rose-900 bg-rose-950/60 text-rose-300' },
  { value: 'tilted', label: 'Tilted', tone: 'border-rose-900 bg-rose-950/60 text-rose-300' },
];

const MOOD_BY_VALUE = new Map(MINDSET_MOODS.map((mood) => [mood.value, mood]));

/** How many notes are shown before the 'show all' toggle, so a long diary stays compact. */
const NOTES_SHOWN_AT_ONCE = 5;

export interface MindsetNoteCardProps {
  /** Every note on the record, newest first. */
  notes: MindsetNote[];
  /** The day a new note belongs to, and the source of its date and user. */
  todayTradingDay: TradingDay;
  timezone: string;
  /** The account a note belongs to. */
  userId?: string;
  /** Writes one note, new or edited. The same upsert storage uses. */
  onSaveNote: (note: MindsetNote) => void;
  onDeleteNote: (id: string) => void;
  loading: boolean;
  failure: { code: CoachErrorCode; message: string } | null;
  /** The reflection, once one has come back. */
  answer: MindsetResponse | null;
  writtenAt?: string;
  onRun: () => void;
}

export const MindsetNoteCard: React.FC<MindsetNoteCardProps> = ({
  notes,
  todayTradingDay,
  timezone,
  userId,
  onSaveNote,
  onDeleteNote,
  loading,
  failure,
  answer,
  writtenAt,
  onRun,
}) => {
  const [text, setText] = useState('');
  const [mood, setMood] = useState<MindsetMood | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);

  const canSave = text.trim().length > 0;

  const save = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    onSaveNote({
      id: `mindset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: userId ?? todayTradingDay.userId,
      tradeDate: todayTradingDay.tradeDate,
      tradingDayId: todayTradingDay.id,
      mood,
      text: trimmed,
      createdAt: now,
      updatedAt: now,
    });
    setText('');
    setMood(undefined);
  };

  /** How many of the listed notes carry each feeling. Nothing is inferred from a blank one. */
  const moodCounts = useMemo(() => {
    const counts = new Map<MindsetMood, number>();
    for (const note of notes) {
      if (!note.mood) continue;
      counts.set(note.mood, (counts.get(note.mood) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);

  const daysWithNotes = useMemo(() => new Set(notes.map((note) => note.tradeDate)).size, [notes]);

  const visible = showAll ? notes : notes.slice(0, NOTES_SHOWN_AT_ONCE);

  return (
    <CoachCard id="coach-mindset-card" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
          <Brain className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">Mindset check-in</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Write what you are thinking and feeling while you trade — as often through the day as
            you need. This is your own words, kept for you; the coach can read them back and tell
            you what keeps coming back, and whether a feeling tends to sit beside your better or
            worse days. It is a mirror, not a trade call, and it will never diagnose you.
          </p>
        </div>
      </div>

      {/* ---- Writing a note ---- */}
      <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
        <label htmlFor="mindset-note-input" className="text-[10px] font-mono uppercase text-zinc-400">
          What is going on in your head
        </label>
        <textarea
          id="mindset-note-input"
          rows={3}
          value={text}
          placeholder="Price ran right through my 5m line and I chased it. Feeling like I have to make it back before the close…"
          onChange={(event) => setText(event.target.value)}
          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase text-zinc-500">Feeling</span>
          {MINDSET_MOODS.map((option) => {
            const active = mood === option.value;
            return (
              <button
                key={option.value}
                type="button"
                id={`mindset-mood-${option.value}`}
                aria-pressed={active}
                title={active ? 'Clear this feeling' : `Mark this note as ${option.label.toLowerCase()}`}
                onClick={() => setMood(active ? undefined : option.value)}
                className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  active
                    ? option.tone
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {option.label}
              </button>
            );
          })}
          <span className="text-[10px] text-zinc-600">optional</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-600">
            Saved to {todayTradingDay.tradeDate} · it stays in your journal
          </span>
          <button
            type="button"
            id="mindset-save"
            disabled={!canSave}
            onClick={save}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Save note
          </button>
        </div>
      </div>

      {/* ---- What has been written ---- */}
      {notes.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          Nothing written yet. A note can be one line — what you are feeling and why, while it is
          still true. The more you write, the more the reflection below has to work with.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              {notes.length} note{notes.length === 1 ? '' : 's'} · {daysWithNotes} day
              {daysWithNotes === 1 ? '' : 's'}
            </span>
            {moodCounts.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                {moodCounts.map(([value, count]) => (
                  <span
                    key={value}
                    className={`rounded border px-1.5 py-0.5 font-mono ${
                      MOOD_BY_VALUE.get(value)?.tone ?? 'border-zinc-700 text-zinc-400'
                    }`}
                  >
                    {MOOD_BY_VALUE.get(value)?.label ?? value} ×{count}
                  </span>
                ))}
              </span>
            )}
          </div>

          {visible.map((note, index) => (
            <div
              key={note.id}
              data-mindset-note={note.id}
              className="flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-400">
                    {formatTimestamp(note.createdAt, timezone)}
                  </span>
                  {note.tradeDate !== todayTradingDay.tradeDate && (
                    <span className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      {note.tradeDate}
                    </span>
                  )}
                  {note.mood && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                        MOOD_BY_VALUE.get(note.mood)?.tone ?? 'border-zinc-700 text-zinc-400'
                      }`}
                    >
                      {MOOD_BY_VALUE.get(note.mood)?.label ?? note.mood}
                    </span>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-200 leading-relaxed">
                  {note.text}
                </p>
              </div>
              <button
                type="button"
                id={`mindset-delete-${note.id}`}
                onClick={() => onDeleteNote(note.id)}
                title="Delete this note"
                className="mt-0.5 shrink-0 rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          {notes.length > NOTES_SHOWN_AT_ONCE && (
            <button
              type="button"
              id="mindset-show-all"
              aria-pressed={showAll}
              onClick={() => setShowAll((value) => !value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 transition-colors hover:text-zinc-200"
            >
              {showAll ? 'Show fewer' : `Show all ${notes.length}`}
            </button>
          )}
        </div>
      )}

      {/* ---- The reflection ---- */}
      <div className="space-y-3 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
            What your notes might be saying
          </span>
          {notes.length > 0 && (
            <span className="text-[10px] text-zinc-600">
              reads the notes you have written, tied to your own logged days
            </span>
          )}
        </div>

        {notes.length === 0 ? (
          <p className="text-[11px] italic text-zinc-500">
            Write a note or two first — there is nothing to reflect on yet.
          </p>
        ) : (
          <>
            {!answer && (
              <CoachGenerateButton
                id="coach-mindset-generate"
                label={failure ? 'Try again' : 'Reflect on my notes'}
                loadingLabel="Reading what you wrote…"
                loading={loading}
                onClick={onRun}
              />
            )}

            {loading && (
              <CoachLoading
                label="Reading what you wrote…"
                steps={COACH_WAIT_STEPS('your notes')}
              />
            )}

            {failure && (
              <CoachErrorPanel code={failure.code} message={failure.message} idSuffix="mindset" />
            )}

            {answer && (
              <CoachResultPanel
                id="coach-mindset-result"
                heading="Reflection"
                meta={writtenAt ? `written ${formatTimestamp(writtenAt, timezone)}` : undefined}
                resultKey={writtenAt}
                busy={loading}
                onRegenerate={onRun}
                regenerateLabel="Reflect again"
              >
                <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>
                <p className="text-xs text-zinc-300 leading-relaxed">{answer.read}</p>

                {answer.patterns.length > 0 && (
                  <div className="space-y-2">
                    {answer.patterns.map((pattern, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                      >
                        <p className="text-xs font-semibold text-zinc-100 leading-snug">
                          {pattern.pattern}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">
                          Evidence: {pattern.evidence}
                        </p>
                        {pattern.whatItDoes && (
                          <p className="mt-1 text-[11px] text-zinc-400 leading-relaxed">
                            {pattern.whatItDoes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {answer.possibleCauses && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                      What may be behind it
                    </span>
                    <p className="text-xs text-zinc-300 leading-relaxed">{answer.possibleCauses}</p>
                  </div>
                )}

                {answer.whatToChange && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                      What to change
                    </span>
                    <p className="text-xs text-zinc-300 leading-relaxed">{answer.whatToChange}</p>
                  </div>
                )}

                {answer.notEnoughYet && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                      Not enough yet
                    </span>
                    <div className="mt-1.5">
                      <CoachBullets
                        items={answer.notEnoughYet ? [answer.notEnoughYet] : []}
                        tone="neutral"
                        emptyLabel="The notes cover what they need to."
                      />
                    </div>
                  </div>
                )}

                <CoachAction label="Write next" text={answer.nextStep} />
                <CoachMotivation text={answer.motivation} />
              </CoachResultPanel>
            )}
          </>
        )}
      </div>
    </CoachCard>
  );
};
