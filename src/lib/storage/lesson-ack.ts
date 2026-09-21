import type { LessonAcknowledgement } from '../../types';

/**
 * The carried-forward lesson as the journal hands it over: yesterday's written focus, with
 * the date it was written for.
 */
export interface CarriedLesson {
  date: string;
  focus: string;
}

/**
 * Whether the trader has already acknowledged THIS lesson.
 *
 * The acknowledgement is tied to the lesson's date and text rather than to a day or a
 * clock, which is what makes it hold for the rest of the day and stop applying the moment
 * a different lesson replaces it. Two consequences worth being explicit about:
 *
 * - Reloading, or switching tabs, does not bring the banner back. An acknowledgement that
 *   evaporated on refresh was never an acknowledgement.
 * - Editing yesterday's focus in the review DOES bring it back, deliberately: the lesson
 *   that was acknowledged is no longer the lesson on screen, and pretending otherwise
 *   would quietly drop the new one.
 */
export function isLessonAcknowledged(
  ack: LessonAcknowledgement | null | undefined,
  lesson: CarriedLesson | null | undefined
): boolean {
  if (!ack || !lesson || !lesson.focus.trim()) return false;
  return ack.date === lesson.date && ack.focus.trim() === lesson.focus.trim();
}

/** The acknowledgement to store for a lesson the trader just accepted. */
export function acknowledgementFor(
  lesson: CarriedLesson,
  at: Date = new Date()
): LessonAcknowledgement {
  return {
    date: lesson.date,
    focus: lesson.focus.trim(),
    acknowledgedAt: at.toISOString(),
  };
}
