import React from 'react';
import { Repeat2 } from 'lucide-react';
import type { Lesson } from '../../types';
import type {
  LessonRecurrenceLevel,
  LessonRecurrenceReport,
} from '../../lib/analytics/lesson-recurrence';
import { LESSON_KIND_LABEL, LESSON_KIND_TONE, lessonKindOf } from '../../lib/playbook/lessons';

/**
 * The repetition read of the lessons library.
 *
 * The library is a list of things the trader noticed, and its most useful property is not the
 * size of the list but the repeats inside it — the same finding written down a fourth time is
 * the one that has not been learned. This panel puts that read above the list, computed on the
 * device, so the trader sees what keeps coming back before they scroll past it.
 *
 * It is deliberately not the coach card. That card reads the lessons with a model, on request,
 * and costs a call; this is the free, always-on read of the same material, and the two are
 * allowed to disagree. Nothing here is a trade call: it is a reading of the trader's own notes.
 */
export interface LessonRecurrencePanelProps {
  report: LessonRecurrenceReport;
  /** The library the report was built from, so a cluster can show its members' titles. */
  lessons: Lesson[];
  /** Jumps to a lesson in the list below. Omitted leaves the members readable but inert. */
  onJumpToLesson?: (lessonId: string) => void;
}

const LEVEL_LABEL: Record<LessonRecurrenceLevel, string> = {
  emerging: 'Emerging',
  recurring: 'Recurring',
  chronic: 'Chronic',
};

/**
 * How strongly a repeat is tinted. The scale is severity, not goodness: a chronic repeat is the
 * loudest, because a finding the trader has written down five times is one they have not acted
 * on yet.
 */
const LEVEL_TONE: Record<LessonRecurrenceLevel, string> = {
  emerging: 'bg-sky-950/70 text-sky-300 border-sky-900',
  recurring: 'bg-amber-950/70 text-amber-300 border-amber-900',
  chronic: 'bg-rose-950/70 text-rose-300 border-rose-900',
};

/** A date without its year, for a compact member line. `2026-09-22` -> `Sep 22`. */
function shortDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The one-line summary under the heading, assembled from what the report actually found. */
function summaryLine(report: LessonRecurrenceReport): string {
  const findings = report.clusters.length;
  const terms = report.terms.length;
  const parts: string[] = [];
  if (findings > 0) {
    parts.push(
      `${findings} finding${findings === 1 ? '' : 's'} repeat${
        findings === 1 ? 's' : ''
      } across ${report.clusteredLessons} lesson${report.clusteredLessons === 1 ? '' : 's'}`
    );
  }
  if (terms > 0) {
    parts.push(
      `${terms} word${terms === 1 ? '' : 's'} keep${terms === 1 ? 's' : ''} coming back`
    );
  }
  return parts.join(', and ');
}

export const LessonRecurrencePanel: React.FC<LessonRecurrencePanelProps> = ({
  report,
  lessons,
  onJumpToLesson,
}) => {
  // Nothing repeats yet: the panel stays out of the way rather than drawing an empty box.
  if (report.empty) return null;

  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  return (
    <div
      id="lesson-recurrence"
      className="space-y-3 rounded-2xl border border-amber-900/40 bg-amber-950/10 p-4"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
          <Repeat2 className="h-3.5 w-3.5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-zinc-100">Repeating lessons</p>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            {summaryLine(report)}. Read from your own words on this device — the same note written
            down a second time is the one worth acting on.
          </p>
        </div>
      </div>

      {report.clusters.length > 0 && (
        <div className="space-y-2.5">
          {report.clusters.map((cluster) => (
            <div
              key={cluster.id}
              id={`lesson-repeat-${cluster.representativeId}`}
              data-lesson-repeat-cluster={cluster.representativeId}
              className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${LEVEL_TONE[cluster.level]}`}
                >
                  {LEVEL_LABEL[cluster.level]}
                </span>
                <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                  {cluster.count} lessons
                </span>
                {(cluster.firstDate || cluster.lastDate) && (
                  <span className="font-mono text-[10px] text-zinc-500">
                    {shortDay(cluster.firstDate)}
                    {cluster.spanDays > 0 ? ` → ${shortDay(cluster.lastDate)}` : ''}
                  </span>
                )}
                {cluster.sharedTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <p className="text-xs font-semibold leading-snug text-zinc-100">
                {cluster.representativeTitle}
              </p>

              <div className="space-y-1">
                {cluster.lessonIds.map((lessonId) => {
                  const member = lessonById.get(lessonId);
                  if (!member) return null;
                  const kind = lessonKindOf(member);
                  const row = (
                    <>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {shortDay(member.createdAt)}
                      </span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold ${LESSON_KIND_TONE[kind]}`}
                      >
                        {LESSON_KIND_LABEL[kind]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-300">
                        {member.title}
                      </span>
                    </>
                  );
                  return onJumpToLesson ? (
                    <button
                      key={lessonId}
                      type="button"
                      data-lesson-repeat-member={lessonId}
                      onClick={() => onJumpToLesson(lessonId)}
                      title="Open this lesson in the list below"
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-zinc-800/70"
                    >
                      {row}
                    </button>
                  ) : (
                    <div key={lessonId} className="flex items-center gap-2 px-1.5 py-1">
                      {row}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.terms.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">
            Words you keep reaching for
          </p>
          <div className="flex flex-wrap gap-1.5">
            {report.terms.map((term) => (
              <span
                key={term.term}
                data-lesson-repeat-term={term.term}
                title={`${term.lessons} lessons`}
                className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 font-mono text-[10px] text-zinc-400"
              >
                {term.label}
                <span className="ml-1 text-zinc-600">×{term.lessons}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
