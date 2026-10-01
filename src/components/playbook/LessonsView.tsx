import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  GraduationCap,
  Image as ImageIcon,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Search,
  Tag,
  Trash2,
  Video,
  X,
  ZoomIn,
} from 'lucide-react';
import type { Lesson, LessonKind, Setup } from '../../types';
import { ImageUploader } from '../common/ImageUploader';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { isVideoUrl } from '../../lib/media/media-utils';
import {
  LESSON_KINDS,
  LESSON_KIND_LABEL,
  LESSON_KIND_TONE,
  lessonKindOf,
  sortLessonsNewestFirst,
} from '../../lib/playbook/lessons';
import {
  findLessonRecurrence,
  findSimilarLessons,
  lessonRepeatCounts,
  type LessonSimilarityMatch,
} from '../../lib/analytics/lesson-recurrence';
import { LessonRecurrencePanel } from './LessonRecurrencePanel';

/**
 * The lessons library.
 *
 * A lesson is something the trader noticed while watching the market and wrote down for
 * themselves — a pattern, a mistake they keep repeating, a note on how they behave — with the
 * screenshots and short clips that show it. It is their own material first: nothing here is a
 * setup, a signal or a claim about the future, and the coach only reads it when the trader asks
 * it to, through the card above this list.
 *
 * The form is deliberately plain. A lesson is a title, a note, a kind to file it under, an
 * optional setup it relates to, free-form tags for finding it later, and media. Screenshots are
 * compressed and stored inline; a video clip is uploaded to the trader's own media folder, the
 * same way a trade's clip is, so it plays back on any device they sign in on.
 */
export interface LessonsViewProps {
  lessons: Lesson[];
  setups: Setup[];
  /** The user a new lesson belongs to. */
  userId: string;
  onSave: (lesson: Lesson) => void;
  onDelete: (lessonId: string) => void;
  /**
   * A request to open one lesson, raised from outside the list — the coach card names the
   * lessons behind a theme and lets the trader jump straight to one.
   *
   * `at` is a timestamp so two requests for the same lesson still re-trigger the jump; the
   * value itself is never read.
   */
  jumpRequest?: { lessonId: string; at: number; highlightCluster?: boolean } | null;
}

/** One draft being typed, before it is saved as a lesson. */
interface LessonDraft {
  id: string | null;
  title: string;
  notes: string;
  kind: LessonKind;
  setupId: string;
  tags: string;
  media: string[];
  createdAt: string;
}

function emptyDraft(userId: string): LessonDraft {
  return {
    id: null,
    title: '',
    notes: '',
    kind: 'pattern',
    setupId: '',
    tags: '',
    media: [],
    createdAt: new Date().toISOString(),
  };
}

function draftFromLesson(lesson: Lesson): LessonDraft {
  return {
    id: lesson.id,
    title: lesson.title,
    notes: lesson.notes,
    kind: lessonKindOf(lesson),
    setupId: lesson.setupId ?? '',
    tags: (lesson.tags ?? []).join(', '),
    media: lesson.media ?? [],
    createdAt: lesson.createdAt,
  };
}

/** A trade date without its year, for the card header. `Tue, Sep 22` -> `Sep 22`. */
function shortDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const fieldClass =
  'w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none';

export const LessonsView: React.FC<LessonsViewProps> = ({
  lessons,
  setups,
  userId,
  onSave,
  onDelete,
  jumpRequest,
}) => {
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<LessonKind | 'all'>('all');
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
    title: string;
    subtitle?: string;
  } | null>(null);
  /**
   * The lessons just jumped to, briefly ringed so they are found. Usually one lesson; a jump
   * from the coach highlights the whole repeat the lesson belongs to, so the trader sees the
   * note they were pointed at together with everything that says the same thing.
   */
  const [highlightLessonIds, setHighlightLessonIds] = useState<string[]>([]);
  /** Existing lessons the draft reads like, shown as a warning until the trader confirms. */
  const [similar, setSimilar] = useState<LessonSimilarityMatch[]>([]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sortLessonsNewestFirst(lessons).filter((lesson) => {
      if (kindFilter !== 'all' && lessonKindOf(lesson) !== kindFilter) return false;
      if (!query) return true;
      const haystack = [
        lesson.title,
        lesson.notes,
        (lesson.tags ?? []).join(' '),
        LESSON_KIND_LABEL[lessonKindOf(lesson)],
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [lessons, kindFilter, search]);

  const counts = useMemo(() => {
    const byKind: Record<LessonKind, number> = {
      pattern: 0,
      behavior: 0,
      mistake: 0,
      psychology: 0,
      other: 0,
    };
    for (const lesson of lessons) byKind[lessonKindOf(lesson)] += 1;
    return byKind;
  }, [lessons]);

  // What keeps repeating, read from the whole library rather than only the visible page — filters
  // narrow what is shown, not what has been written down.
  const recurrence = useMemo(() => findLessonRecurrence(lessons), [lessons]);
  const repeatCounts = useMemo(() => lessonRepeatCounts(recurrence), [recurrence]);

  // The ring is a hint, not a state, so it fades on its own.
  useEffect(() => {
    if (highlightLessonIds.length === 0) return;
    const timer = setTimeout(() => setHighlightLessonIds([]), 2600);
    return () => clearTimeout(timer);
  }, [highlightLessonIds]);

  /**
   * Opens a lesson the repeat panel points at.
   *
   * The lesson may be hidden by the current search or kind filter, so both are cleared first;
   * the scroll then waits a frame for React to put the row back before it measures it.
   */
  const jumpToLesson = (lessonId: string, options: { withCluster?: boolean } = {}) => {
    setSearch('');
    setKindFilter('all');
    // A coach citation highlights the whole repeat the lesson belongs to, so the other notes
    // making the same point are found with it. The repeat panel's own members highlight alone.
    const cluster = options.withCluster
      ? recurrence.clusters.find((candidate) => candidate.lessonIds.includes(lessonId))
      : undefined;
    setHighlightLessonIds(cluster ? cluster.lessonIds : [lessonId]);
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-lesson-row="${lessonId}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // A jump asked for from outside the list runs the same path a row click does.
  useEffect(() => {
    if (!jumpRequest) return;
    jumpToLesson(jumpRequest.lessonId, { withCluster: jumpRequest.highlightCluster });
    // Keyed on the request's timestamp so repeating the same lesson still jumps.
  }, [jumpRequest?.at]);

  /**
   * Changes one field of the open draft.
   *
   * Every edit also clears the duplicate warning: once the trader touches the words again, the
   * warning is about a version of the note that no longer exists, so it is re-checked on saving.
   */
  const updateDraft = (patch: Partial<LessonDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSimilar([]);
  };

  const startAdd = () => {
    setError('');
    setSimilar([]);
    setDraft(emptyDraft(userId));
  };

  const startEdit = (lesson: Lesson) => {
    setError('');
    setSimilar([]);
    setDraft(draftFromLesson(lesson));
  };

  const closeDraft = () => {
    setDraft(null);
    setError('');
    setSimilar([]);
  };

  /** The record a draft becomes, whether it is brand new or an edit of an existing lesson. */
  const lessonFromDraft = (source: LessonDraft): Lesson => {
    const now = new Date().toISOString();
    const tags = source.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return {
      id: source.id ?? `lesson-${Date.now()}`,
      userId,
      title: source.title.trim(),
      notes: source.notes.trim(),
      kind: source.kind,
      setupId: source.setupId || undefined,
      tags: tags.length ? tags : undefined,
      media: source.media.length ? source.media : undefined,
      // An edit of an existing lesson keeps the moment it was recorded; a new one takes now.
      createdAt: source.id ? source.createdAt : now,
      updatedAt: now,
    };
  };

  const commitSave = () => {
    if (!draft) return;
    onSave(lessonFromDraft(draft));
    setDraft(null);
    setError('');
    setSimilar([]);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (!draft.title.trim()) {
      setError('Give the lesson a title — what did you notice?');
      setSimilar([]);
      return;
    }
    // The warning is already on screen and the trader submitted again: that is a yes.
    if (similar.length > 0) {
      commitSave();
      return;
    }
    const matches = findSimilarLessons(
      {
        id: draft.id ?? undefined,
        title: draft.title,
        notes: draft.notes,
        kind: draft.kind,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      },
      lessons
    );
    if (matches.length > 0) {
      setError('');
      setSimilar(matches);
      return;
    }
    commitSave();
  };

  return (
    <div className="space-y-5">
      {/* What a lesson is, said once so the section explains itself. */}
      <div className="rounded-2xl border border-violet-900/40 bg-violet-950/10 p-4">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
            <GraduationCap className="h-3.5 w-3.5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-100">
              Lessons you write for yourself
            </p>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Catch a pattern, a repeat mistake or a piece of market behaviour you want to
              remember? Write it down here and attach the screenshot or a short clip that shows
              it. File it under a kind and a tag so you can find it again, and use{' '}
              <span className="text-violet-300">Read my lessons</span> above to have your coach
              summarise what your own notes keep saying.
            </p>
          </div>
        </div>
      </div>

      {/* What keeps repeating, read from the notes themselves — above the list it reads. */}
      <LessonRecurrencePanel
        report={recurrence}
        lessons={lessons}
        onJumpToLesson={jumpToLesson}
      />

      {/* Add / edit form */}
      {draft ? (
        <form
          onSubmit={save}
          id="lesson-form"
          className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-zinc-300 font-mono">
              {draft.id ? 'Edit lesson' : 'New lesson'}
            </span>
            <button
              type="button"
              onClick={closeDraft}
              className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-800/80 bg-rose-950/50 p-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          {/* The same finding written down before — a warning, never a block. */}
          {similar.length > 0 && (
            <div
              id="lesson-duplicate-warning"
              className="space-y-2 rounded-xl border border-amber-800/80 bg-amber-950/40 p-2.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <p className="text-xs leading-relaxed text-amber-200">
                  You have already written this down. Open the note to compare, or add it anyway
                  if it is a new observation that deserves its own entry.
                </p>
              </div>

              <ul className="space-y-1.5">
                {similar.map((match) => (
                  <li
                    key={match.lesson.id}
                    data-lesson-duplicate={match.lesson.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-amber-100">
                        {match.lesson.title}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase text-amber-400/80">
                        <span>
                          {match.reason === 'wording'
                            ? `${Math.round(match.similarity * 100)}% same wording`
                            : 'same tags'}
                        </span>
                        {match.sharedTags.length > 0 && (
                          <span>· {match.sharedTags.join(', ')}</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      id={`lesson-duplicate-open-${match.lesson.id}`}
                      onClick={() => jumpToLesson(match.lesson.id)}
                      className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-amber-300 hover:bg-amber-900/50"
                    >
                      Review
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  id="lesson-duplicate-dismiss"
                  onClick={() => setSimilar([])}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  id="lesson-duplicate-confirm"
                  onClick={commitSave}
                  className="rounded-lg border border-amber-800/80 bg-amber-500/10 px-3.5 py-1.5 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/20"
                >
                  Add anyway
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300" htmlFor="lesson-title">
              Title <span className="text-rose-400">*</span>
            </label>
            <input
              id="lesson-title"
              type="text"
              value={draft.title}
              onChange={(event) => updateDraft({ title: event.target.value })}
              placeholder="e.g. Overnight high sweeps the pre-open range before reversing"
              className={fieldClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300" htmlFor="lesson-notes">
              What you noticed
            </label>
            <textarea
              id="lesson-notes"
              rows={4}
              value={draft.notes}
              onChange={(event) => updateDraft({ notes: event.target.value })}
              placeholder="Write it in your own words: what happened, why it caught your eye, and what you want to remember about it."
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300" htmlFor="lesson-kind">
                Kind
              </label>
              <select
                id="lesson-kind"
                value={draft.kind}
                onChange={(event) =>
                  updateDraft({ kind: event.target.value as LessonKind })
                }
                className={fieldClass}
              >
                {LESSON_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {LESSON_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="mb-1 block text-xs font-medium text-zinc-300"
                htmlFor="lesson-setup"
              >
                Relates to a setup
              </label>
              <select
                id="lesson-setup"
                value={draft.setupId}
                onChange={(event) => updateDraft({ setupId: event.target.value })}
                className={fieldClass}
              >
                <option value="">None</option>
                {setups.map((setup) => (
                  <option key={setup.id} value={setup.id}>
                    {setup.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300" htmlFor="lesson-tags">
                Tags (comma separated)
              </label>
              <input
                id="lesson-tags"
                type="text"
                value={draft.tags}
                onChange={(event) => updateDraft({ tags: event.target.value })}
                placeholder="liquidity, pre-open"
                className={fieldClass}
              />
            </div>
          </div>

          <ImageUploader
            images={draft.media}
            onChange={(media) => updateDraft({ media })}
            onPreviewImage={(index) =>
              setLightbox({
                images: draft.media,
                index,
                title: draft.title || 'Lesson media',
                subtitle: draft.notes || undefined,
              })
            }
            maxImages={6}
            label="Screenshots & video clips"
            helperText="Screenshots are stored in your journal; a clip uploads to your own media folder. Keep clips short — a quick walk-through, not a full review."
            idPrefix="lesson-media"
          />

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={closeDraft}
              className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="lesson-save"
              className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-5 py-2 text-xs font-semibold text-zinc-950 transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
            >
              <Check className="h-3.5 w-3.5" />
              {draft.id ? 'Save lesson' : 'Add lesson'}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          id="lesson-add"
          onClick={startAdd}
          className="flex items-center gap-1.5 rounded-xl border border-emerald-800/80 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a lesson
        </button>
      )}

      {/* Filters — only once there is something to filter. */}
      {lessons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              id="lesson-search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your lessons"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              id="lesson-filter-all"
              onClick={() => setKindFilter('all')}
              className={`rounded-lg border px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-colors ${
                kindFilter === 'all'
                  ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              All {lessons.length}
            </button>
            {LESSON_KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
              <button
                key={kind}
                type="button"
                id={`lesson-filter-${kind}`}
                onClick={() => setKindFilter(kind)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-mono font-bold uppercase transition-colors ${
                  kindFilter === kind
                    ? LESSON_KIND_TONE[kind]
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {LESSON_KIND_LABEL[kind]} {counts[kind]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The lessons themselves. */}
      {lessons.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-zinc-500" />
          <p className="mt-2 text-sm font-semibold text-zinc-300">No lessons saved yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-400">
            Write down the first thing you have noticed and attach the screenshot that shows it.
            A library of your own findings is what turns watching the market into something you
            can use again.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          No lesson matches that search or filter.
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((lesson) => {
            const kind = lessonKindOf(lesson);
            const media = lesson.media ?? [];
            const setupName = lesson.setupId
              ? setups.find((setup) => setup.id === lesson.setupId)?.name
              : undefined;
            return (
              <div
                key={lesson.id}
                data-lesson-row={lesson.id}
                className={`rounded-2xl border bg-zinc-900/50 p-3.5 space-y-2 transition-colors ${
                  highlightLessonIds.includes(lesson.id)
                    ? 'border-emerald-500/80 ring-2 ring-emerald-500/40'
                    : 'border-zinc-800/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold ${LESSON_KIND_TONE[kind]}`}
                      >
                        {LESSON_KIND_LABEL[kind]}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {shortDay(lesson.createdAt)}
                      </span>
                      {setupName && (
                        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                          {setupName}
                        </span>
                      )}
                      {repeatCounts[lesson.id] > 1 && (
                        <span
                          data-lesson-repeat-badge={lesson.id}
                          title={`This note is one of ${repeatCounts[lesson.id]} lessons that keep saying the same thing`}
                          className="inline-flex items-center gap-1 rounded border border-amber-900 bg-amber-950/70 px-1.5 py-0.5 font-mono text-[9px] uppercase font-bold text-amber-300"
                        >
                          <Repeat2 className="h-3 w-3" />
                          Repeats ×{repeatCounts[lesson.id]}
                        </span>
                      )}
                    </div>
                    <p className="break-words text-sm font-semibold leading-snug text-zinc-100">
                      {lesson.title}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      id={`lesson-edit-${lesson.id}`}
                      onClick={() => startEdit(lesson)}
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      title="Edit this lesson"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      id={`lesson-delete-${lesson.id}`}
                      onClick={() => onDelete(lesson.id)}
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400"
                      title="Delete this lesson"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {lesson.notes && (
                  <p className="whitespace-pre-line text-xs leading-relaxed text-zinc-300">
                    {lesson.notes}
                  </p>
                )}

                {(lesson.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag className="h-3 w-3 text-zinc-500" />
                    {(lesson.tags ?? []).map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {media.length > 0 && (
                  <div className="space-y-1.5 pt-0.5">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                      <ImageIcon className="h-3 w-3" />
                      {media.filter((item) => !isVideoUrl(item)).length} image(s)
                      {media.some((item) => isVideoUrl(item)) && (
                        <span className="flex items-center gap-1">
                          <Video className="h-3 w-3" />
                          {media.filter((item) => isVideoUrl(item)).length} clip(s)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {media.map((item, index) => {
                        const video = isVideoUrl(item);
                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() =>
                              setLightbox({
                                images: media,
                                index,
                                title: lesson.title,
                                subtitle: lesson.notes || undefined,
                              })
                            }
                            className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 transition-all hover:scale-105 hover:border-emerald-500/80 active:scale-95"
                            title={video ? 'Play clip' : 'View screenshot'}
                          >
                            {video ? (
                              <video
                                src={item}
                                muted
                                playsInline
                                preload="metadata"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <img
                                src={item}
                                alt={`${lesson.title} ${index + 1}`}
                                className="h-full w-full object-cover"
                              />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                              {video ? (
                                <Play className="h-4 w-4 fill-current text-emerald-400" />
                              ) : (
                                <ZoomIn className="h-4 w-4 text-emerald-400" />
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lightbox && (
        <ImageLightboxModal
          isOpen={true}
          onClose={() => setLightbox(null)}
          images={lightbox.images}
          initialIndex={lightbox.index}
          title={lightbox.title}
          subtitle={lightbox.subtitle}
        />
      )}
    </div>
  );
};
