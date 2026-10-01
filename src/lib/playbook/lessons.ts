import type { Lesson, LessonKind } from '../../types';
import { isVideoUrl } from '../media/media-utils';

/**
 * Shared helpers for the trader's own lessons.
 *
 * A lesson is something the trader noticed while watching the market and wrote down for
 * themselves, with the media that shows it. The pieces all live here so the library view, the
 * coach card and the storage digest agree on what a lesson is and how it is labelled — the
 * same way the setup focus rules are shared rather than restated.
 */

/** The kinds a lesson can be filed under, in the order they are offered. */
export const LESSON_KINDS: readonly LessonKind[] = [
  'pattern',
  'behavior',
  'mistake',
  'psychology',
  'other',
];

/** What each kind is called in the UI. */
export const LESSON_KIND_LABEL: Record<LessonKind, string> = {
  pattern: 'Pattern',
  behavior: 'Behaviour',
  mistake: 'Mistake',
  psychology: 'Psychology',
  other: 'Other',
};

/** How a lesson is tinted, so a wall of them reads by colour. */
export const LESSON_KIND_TONE: Record<LessonKind, string> = {
  pattern: 'bg-sky-950/70 text-sky-300 border-sky-900',
  behavior: 'bg-violet-950/70 text-violet-300 border-violet-900',
  mistake: 'bg-amber-950/70 text-amber-300 border-amber-900',
  psychology: 'bg-rose-950/70 text-rose-300 border-rose-900',
  other: 'bg-zinc-800/80 text-zinc-300 border-zinc-700',
};

/** What a lesson with no kind recorded is read as, for records saved before the field. */
export const DEFAULT_LESSON_KIND: LessonKind = 'other';

/** Every kind a lesson may be saved under, with a fallback for a missing or unknown value. */
export function lessonKindOf(lesson: { kind?: LessonKind }): LessonKind {
  return lesson.kind && LESSON_KINDS.includes(lesson.kind) ? lesson.kind : DEFAULT_LESSON_KIND;
}

/** Newest first. Lessons are dates, so a string sort on the ISO stamp is chronological. */
export function sortLessonsNewestFirst(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** The still images attached to a lesson, video clips excluded. */
export function lessonImages(lesson: Lesson): string[] {
  return (lesson.media ?? []).filter((item) => !isVideoUrl(item));
}

/** The video clips attached to a lesson. */
export function lessonVideos(lesson: Lesson): string[] {
  return (lesson.media ?? []).filter((item) => isVideoUrl(item));
}

/** True when a lesson carries a title, a note or media worth showing. */
export function lessonHasContent(lesson: Lesson): boolean {
  return !!lesson.title.trim() || !!lesson.notes.trim() || (lesson.media ?? []).length > 0;
}
