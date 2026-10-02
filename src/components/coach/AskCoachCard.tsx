import React, { useMemo, useState } from 'react';
import { BookmarkPlus, MessageSquare } from 'lucide-react';
import {
  CoachPlan,
  DailyReview,
  Instrument,
  Lesson,
  LevelOutlook,
  LevelTouch,
  MarkedLevel,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { AskResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachGenerateButton,
  CoachLoading,
  CoachResultPanel,
} from './coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The one coach surface the trader drives: a box for their own question about their own
 * trading.
 *
 * The one question box in the app, on the Coach tab. It was briefly mirrored on Today so a
 * question could be asked mid-record, and that turned out to be a second copy of the trade
 * form's own page for no gain: the Coach tab is a tab switch away, and answering is not
 * something done between two price entries.
 *
 * It builds its own digest from the same records every other coach card takes, the pattern
 * the checkpoint card follows. The question itself is fenced into the prompt on the server
 * as the thing being answered rather than as an instruction, and the `ask` mode keeps the
 * strict no-market guardrails, so the box cannot become a way around them.
 */
interface AskCoachCardProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  maxDrawdown?: number | null;
  /** The level-touch log, so a question like "what is my overnight hold rate?" is answerable. */
  levelTouches?: LevelTouch[];
  /** The marked levels, so a question about a timeframe or a never-tested line is answerable. */
  markedLevels?: MarkedLevel[];
  /** The daily outlooks, so the answer can weigh what the trader expected against the record. */
  levelOutlooks?: LevelOutlook[];
  /** The account a saved lesson belongs to. */
  userId?: string;
  /**
   * Writes the answer into the trader's own lessons, so a question asked once becomes material
   * the coach can read back later. Omitted hides the save action.
   */
  onSaveLesson?: (lesson: Lesson) => void;
  /**
   * The coach's own plans with the trader's grades and feedback, when there are any.
   *
   * Carried into the digest so the answer can learn from what the trader keeps telling the
   * coach about how it plans; the guardrails keep a grade from being read as market data.
   */
  coachPlans?: CoachPlan[];
  /** Heading and blurb above the box, so the card can be labelled by its caller. */
  title?: string;
  description?: string;
}

/** A stable empty list, so an omitted prop does not rebuild the digest on every render. */
const NO_TOUCHES: LevelTouch[] = [];

interface AskState {
  loading: boolean;
  /** The last answer that arrived, kept while a retry runs so nothing is blanked. */
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  writtenAt?: string;
}

const IDLE: AskState = { loading: false, result: null, failure: null };

/** Matches the ceiling the endpoint applies, so the box cannot hold text never shown. */
const MAX_QUESTION_LENGTH = 800;

export const AskCoachCard: React.FC<AskCoachCardProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
  maxDrawdown,
  levelTouches = NO_TOUCHES,
  markedLevels,
  levelOutlooks,
  userId,
  onSaveLesson,
  coachPlans,
  title,
  description,
}) => {
  const ids = {
    input: 'coach-ask-input',
    generate: 'coach-ask-generate',
    result: 'coach-ask-result',
    errorSuffix: 'ask',
  };
  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays,
        reviews,
        setups,
        instruments,
        todayTradeDate,
        timezone,
        maxDrawdown,
        levelTouches,
        markedLevels,
        levelOutlooks,
        coachPlans,
      }),
    [
      trades,
      tradingDays,
      reviews,
      setups,
      instruments,
      todayTradeDate,
      timezone,
      maxDrawdown,
      levelTouches,
      markedLevels,
      levelOutlooks,
      coachPlans,
    ]
  );

  const [state, setState] = useState<AskState>(IDLE);
  // Kept as the trader typed it. Deliberately not cleared when an answer lands: the usual
  // next move is to sharpen the question, not to start again from a blank box.
  const [question, setQuestion] = useState('');
  const trimmed = question.trim();
  /** The title of the answer already written into the lessons, if any. */
  const [savedLesson, setSavedLesson] = useState<string | null>(null);

  async function ask() {
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    // A fresh answer is a fresh finding: the previous save confirmation belongs to the old one.
    setSavedLesson(null);
    const result = await requestCoach('ask', digest, undefined, { question: trimmed });

    if (result.ok) {
      setState({
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
      });
      return;
    }
    // Shown alongside whatever was already answered, not instead of it.
    setState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const answer = state.result?.ok ? (state.result.data as AskResponse) : null;

  /**
   * Turns the answer into a lesson the trader owns.
   *
   * The question is kept at the top of the note because a finding read back weeks later means
   * nothing without the question it answered, and the evidence the answer cited is carried
   * with it rather than left behind — a lesson the coach later reads should say what it stood
   * on, not just what it concluded. Filed as 'other' and tagged, so it is easy to find and
   * rename in the library.
   */
  const saveAsLesson = (response: AskResponse) => {
    if (!onSaveLesson) return;
    const now = new Date().toISOString();
    const notes = [
      trimmed ? `Asked: ${trimmed}` : '',
      response.answer,
      response.evidence.length
        ? `\nEvidence from your own record:\n${response.evidence.map((item) => `• ${item}`).join('\n')}`
        : '',
      response.notInJournal ? `\nNot in the journal: ${response.notInJournal}` : '',
      response.nextStep ? `\nNext step: ${response.nextStep}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const lesson: Lesson = {
      id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: userId ?? 'local',
      title: (response.headline || trimmed || 'Coach research').slice(0, 120),
      notes,
      kind: 'other',
      tags: ['coach-research'],
      createdAt: now,
      updatedAt: now,
    };
    onSaveLesson(lesson);
    setSavedLesson(lesson.title);
  };

  return (
    <CoachCard className="space-y-3.5">
      {title && (
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <MessageSquare className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-100 tracking-tight">{title}</h2>
            {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
          </div>
        </div>
      )}

      <label htmlFor={ids.input} className="sr-only">
        Your question about your trading
      </label>
      <textarea
        id={ids.input}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        maxLength={MAX_QUESTION_LENGTH}
        placeholder="e.g. Why do I keep giving back the morning?"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none resize-y"
      />

      {!answer && (
        <CoachGenerateButton
          id={ids.generate}
          label={state.failure ? 'Try again' : 'Ask the coach'}
          loadingLabel="Answering your question…"
          loading={state.loading}
          disabled={!trimmed}
          onClick={ask}
        />
      )}

      {state.loading && (
        <CoachLoading
          label="Searching your own records for the answer…"
          steps={COACH_WAIT_STEPS('trades you asked about')}
        />
      )}

      {state.failure && (
        <CoachErrorPanel
          code={state.failure.code}
          message={state.failure.message}
          idSuffix={ids.errorSuffix}
        />
      )}

      {answer && (
        <CoachResultPanel
          id={ids.result}
          heading="Answer"
          meta={state.writtenAt ? `written ${formatTimestamp(state.writtenAt, timezone)}` : undefined}
          resultKey={state.writtenAt}
          busy={state.loading}
          // Reads the box as it stands right now, so editing the question and asking again
          // asks the edited one rather than repeating the first.
          onRegenerate={ask}
          regenerateLabel="Ask again"
        >
          <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>
          <p className="text-xs text-zinc-300 leading-relaxed">{answer.answer}</p>
          <div>
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              What it leaned on
            </span>
            <div className="mt-1.5">
              <CoachBullets
                items={answer.evidence}
                tone="neutral"
                emptyLabel="It answered without citing a single figure, so treat it with suspicion."
              />
            </div>
          </div>
          {answer.notInJournal && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-3">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Not in your journal
              </span>
              <p className="mt-1 text-xs text-zinc-300 leading-relaxed">{answer.notInJournal}</p>
            </div>
          )}
          {answer.nextStep && <CoachAction label="Next step" text={answer.nextStep} />}

          {/*
            The answer becomes material the coach can read back later. This is what makes the
            box a research tool rather than a one-off: a finding asked once and saved is in the
            library for the lessons read and for the trader to build a setup from.
          */}
          {onSaveLesson && (
            <div className="space-y-1.5 border-t border-zinc-800/70 pt-3">
              <button
                type="button"
                id="coach-ask-save-lesson"
                onClick={() => saveAsLesson(answer)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-amber-400" />
                Save this as a lesson
              </button>
              {savedLesson ? (
                <p className="text-[11px] text-emerald-300/90">
                  Saved to your lessons as “{savedLesson}”. Edit or tag it in the Playbook.
                </p>
              ) : (
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Writes the question, the answer and the figures it stood on into your lessons,
                  so the coach reads it back later and you can build a setup from it.
                </p>
              )}
            </div>
          )}
        </CoachResultPanel>
      )}
    </CoachCard>
  );
};
