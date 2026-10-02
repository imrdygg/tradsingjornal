import React, { useMemo, useState } from 'react';
import { GraduationCap, Sparkles } from 'lucide-react';
import {
  CoachPlan,
  DailyReview,
  Instrument,
  Lesson,
  LevelOutlook,
  LevelTouch,
  MarkedLevel,
  SessionExtreme,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { LessonsResponse } from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  MAX_COACH_IMAGES,
  MAX_COACH_IMAGE_TOTAL_CHARS,
  isCoachImageDataUrl,
} from '../../lib/ai/coach-images';
import { lessonImages, sortLessonsNewestFirst } from '../../lib/playbook/lessons';
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
} from '../coach/coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The read of the trader's own lessons.
 *
 * This is the one place the coach looks at the lessons the trader wrote for themselves. It is
 * deliberately its own card and its own mode rather than being folded into every other coach
 * answer: the lessons are the trader's own material, and mixing a note they wrote about
 * themselves into a performance review would misread it as evidence about their results.
 *
 * Two things travel with the request and nothing else: the journal digest, which now carries
 * the lesson notes, tags and media counts, and up to a handful of the still images attached to
 * those lessons. Video clips are never sent — the model cannot watch them, and the card says so
 * rather than pretending otherwise.
 *
 * Like the setup learner, the read is a summary of their own material: themes their notes keep
 * returning to, where two of them disagree, and what the library does not cover. It is not a
 * market opinion and it does not turn a note into a trade.
 */
export interface CoachLessonsCardProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  maxDrawdown?: number | null;
  levelTouches?: LevelTouch[];
  /** The levels marked before any touch, so a theme can cite the untested ones too. */
  markedLevels?: MarkedLevel[];
  /** The trader's per-instrument outlooks, read as their own words rather than market fact. */
  levelOutlooks?: LevelOutlook[];
  sessionExtremes?: SessionExtreme[];
  lessons: Lesson[];
  /**
   * The coach's own plans with the trader's grades and feedback, when there are any.
   *
   * Carried into the digest so the read learns from what the trader keeps telling the coach
   * about how it plans; the guardrails keep a grade from being read as market data.
   */
  coachPlans?: CoachPlan[];
  /** Records that the coach has read these lessons, so the library can show what is new. */
  onMarkRead?: (lessonIds: string[], at: string) => void;
  /**
   * Opens a lesson in the library when a theme cites it, so the trader can read the exact
   * note the coach is summarising rather than taking the citation on trust.
   */
  onJumpToLesson?: (lessonId: string) => void;
}

interface ReadState {
  loading: boolean;
  /** The last answer that arrived, kept while a retry runs so nothing is blanked. */
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  writtenAt?: string;
}

const IDLE: ReadState = { loading: false, result: null, failure: null };

/**
 * Picks the still images worth sending, newest lesson first.
 *
 * One image per lesson: the trader may attach several, but the read is about the range of
 * lessons rather than about one of them in detail, so a single picture each covers more of the
 * library. Video clips are dropped here, and a lesson with no usable still is simply skipped —
 * the digest still tells the coach the lesson exists.
 */
/**
 * The lesson a theme cited, matched by its title and the day it was written.
 *
 * The read names lessons by title and date rather than by id, so this is how a citation is
 * resolved back to something clickable. A title alone would be ambiguous when a trader reuses
 * one, so the date is checked too when the model gave it. A citation that no longer matches a
 * saved lesson is simply not clickable.
 */
function resolveCitedLesson(
  lessons: Lesson[],
  ref: { title: string; date: string }
): Lesson | undefined {
  const title = ref.title.trim().toLowerCase();
  if (!title) return undefined;
  return lessons.find((lesson) => {
    if (lesson.title.trim().toLowerCase() !== title) return false;
    return !ref.date || (lesson.createdAt ?? '').slice(0, 10) === ref.date;
  });
}

function collectLessonImages(lessons: Lesson[]): { label: string; dataUrl: string }[] {
  const out: { label: string; dataUrl: string }[] = [];
  let total = 0;

  for (const lesson of sortLessonsNewestFirst(lessons)) {
    if (out.length >= MAX_COACH_IMAGES) break;
    const image = lessonImages(lesson).find((candidate) => isCoachImageDataUrl(candidate));
    if (!image) continue;
    if (total + image.length > MAX_COACH_IMAGE_TOTAL_CHARS) break;
    total += image.length;
    out.push({
      label: `${(lesson.createdAt ?? '').slice(0, 10)} lesson "${lesson.title.trim()}"`,
      dataUrl: image,
    });
  }
  return out;
}

export const CoachLessonsCard: React.FC<CoachLessonsCardProps> = ({
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
  sessionExtremes,
  lessons,
  coachPlans,
  onMarkRead,
  onJumpToLesson,
}) => {
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
        sessionExtremes,
        lessons,
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
      sessionExtremes,
      lessons,
      coachPlans,
    ]
  );

  const images = useMemo(() => collectLessonImages(lessons), [lessons]);
  const [state, setState] = useState<ReadState>(IDLE);

  const newCount = useMemo(
    () => lessons.filter((lesson) => !lesson.lastReadAt).length,
    [lessons]
  );

  async function run() {
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    const result = await requestCoach('lessons', digest, undefined, { images });

    if (result.ok) {
      const writtenAt = new Date().toISOString();
      onMarkRead?.(lessons.map((lesson) => lesson.id), writtenAt);
      setState({ loading: false, result, failure: null, writtenAt });
      return;
    }
    setState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const answer = state.result?.ok ? (state.result.data as LessonsResponse) : null;

  return (
    <CoachCard id="playbook-coach-lessons" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
          <GraduationCap className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">Read my lessons</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Your coach reads the lessons you have written for yourself — the notes, the tags and
            the screenshots attached — and tells you what they keep saying, where they disagree
            and what you have not covered yet. It never turns a lesson into a trade call, and it
            cannot watch your video clips.
          </p>
        </div>
      </div>

      {lessons.length === 0 ? (
        <p className="text-xs text-zinc-500 italic">
          Nothing written down yet. Add your first lesson below — write what you noticed, attach
          a screenshot or a short clip, and this card can read it back to you.
        </p>
      ) : (
        <>
          <div id="coach-lessons-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <CoachFact label="Lessons saved" value={`${lessons.length}`} />
            <CoachFact label="Not yet read" value={`${newCount}`} />
            <CoachFact
              label="With a picture"
              value={`${lessons.filter((lesson) => lessonImages(lesson).length > 0).length}`}
            />
            <CoachFact
              label="Screenshots sent"
              value={`${images.length}`}
            />
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            {images.length > 0
              ? `${images.length} still image(s) travel with the read, one per lesson. `
              : 'No lesson has a still image attached, so this read works from the written notes alone. '}
            Video clips stay on your device — the coach can read your words and your screenshots,
            but it cannot watch a clip, so write the point down where it matters.
          </p>

          {!answer && (
            <CoachGenerateButton
              id="coach-lessons-generate"
              label={state.failure ? 'Try again' : 'Read my lessons'}
              loadingLabel="Reading your lessons…"
              loading={state.loading}
              onClick={run}
            />
          )}

          {state.loading && (
            <CoachLoading
              label="Reading the lessons you wrote…"
              steps={COACH_WAIT_STEPS('your lessons')}
            />
          )}

          {state.failure && (
            <CoachErrorPanel
              code={state.failure.code}
              message={state.failure.message}
              idSuffix="lessons"
            />
          )}

          {answer && (
            <CoachResultPanel
              id="coach-lessons-result"
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
              <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>

              {answer.themes.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    <Sparkles className="mr-1 inline h-3 w-3 text-violet-300" />
                    Themes in your own notes
                  </span>
                  {onJumpToLesson &&
                    answer.themes.some((theme) => (theme.lessons ?? []).length > 0) && (
                      <p className="text-[10px] leading-relaxed text-zinc-500">
                        Tap a lesson to open it below — if it is part of a repeat, the whole
                        group lights up with it.
                      </p>
                    )}
                  {answer.themes.map((theme, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                    >
                      <p className="text-xs font-semibold text-zinc-200">{theme.theme}</p>
                      {theme.evidence && (
                        <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                          {theme.evidence}
                        </p>
                      )}
                      {/* The exact notes behind the theme, so it can be checked at a glance. */}
                      {(theme.lessons ?? []).length > 0 && (
                        <ul className="mt-2 space-y-0.5 border-t border-zinc-800/80 pt-2">
                          {(theme.lessons ?? []).map((lesson, lessonIndex) => {
                            const cited = resolveCitedLesson(lessons, lesson);
                            const body = (
                              <>
                                <span className="shrink-0 font-mono text-zinc-500">
                                  {lesson.date || '—'}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-zinc-400">
                                  {lesson.title}
                                </span>
                              </>
                            );
                            return (
                              <li key={`${lesson.title}-${lessonIndex}`}>
                                {cited && onJumpToLesson ? (
                                  <button
                                    type="button"
                                    data-coach-lesson-cite={cited.id}
                                    onClick={() => onJumpToLesson(cited.id)}
                                    title="Open this lesson in the library below"
                                    className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left text-[10px] leading-snug transition-colors hover:bg-zinc-800/60"
                                  >
                                    {body}
                                  </button>
                                ) : (
                                  <div className="flex items-baseline gap-2 px-1.5 py-1 text-[10px] leading-snug">
                                    {body}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {answer.reinforces && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    What your notes keep saying
                  </span>
                  <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                    {answer.reinforces}
                  </p>
                </div>
              )}

              {answer.contradictions.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Where two lessons disagree
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={answer.contradictions}
                      tone="neutral"
                      emptyLabel="No lesson pulls against another."
                    />
                  </div>
                </div>
              )}

              {answer.howToApply && (
                <p className="text-xs text-zinc-300 leading-relaxed">{answer.howToApply}</p>
              )}

              {answer.gaps.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Not covered yet
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={answer.gaps}
                      tone="neutral"
                      emptyLabel="Your library covers what it needs to."
                    />
                  </div>
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
