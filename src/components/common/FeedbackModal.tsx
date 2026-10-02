import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  MessageSquarePlus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { FeedbackNote } from '../../types';
import { ModalOverlay } from './ModalOverlay';
import { formatTimestamp } from '../../lib/storage/date-utils';

export interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The notes the trader has left, in any order; the list is sorted for display here. */
  notes: FeedbackNote[];
  /** Records one new note, in the trader's own words, with where they were when they wrote it. */
  onAdd: (text: string, context?: string) => void;
  /** Marks a note fixed, or reopens one that was. */
  onToggleStatus: (note: FeedbackNote) => void;
  onDelete: (id: string) => void;
  /** The tab or screen the trader is looking at, so a new note can record where it came from. */
  context?: string;
  timezone: string;
}

/**
 * Where the trader writes down what needs fixing in the app itself.
 *
 * It exists because the thought arrives while using the app — a chart in the wrong place, a
 * row that will not open — and by the time there is somewhere else to write it, it is gone.
 * So the button is in the header, the note takes one box, and the list beside it keeps what
 * has already been written and what has been dealt with.
 *
 * A note is deliberately not tied to a trade or a day: it is about the app, not the market.
 * Marking one fixed keeps it rather than deleting it, so the list reads as a record of what
 * was raised and what was done about it.
 */
export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  onClose,
  notes,
  onAdd,
  onToggleStatus,
  onDelete,
  context,
  timezone,
}) => {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Start each visit with a clean box, focused, so writing a note is one gesture.
  useEffect(() => {
    if (!isOpen) return;
    setDraft('');
    const timeout = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  const { open, fixed } = useMemo(() => {
    // Newest first within each group, and open notes above the ones already handled, so the
    // thing still to do is always the first thing on screen.
    const byNewest = (a: FeedbackNote, b: FeedbackNote) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    return {
      open: notes.filter((note) => note.status === 'open').sort(byNewest),
      fixed: notes.filter((note) => note.status === 'fixed').sort(byNewest),
    };
  }, [notes]);

  const canSave = draft.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onAdd(draft.trim(), context);
    setDraft('');
    textareaRef.current?.focus();
  };

  if (!isOpen) return null;

  const renderNote = (note: FeedbackNote) => {
    const isFixed = note.status === 'fixed';
    return (
      <div
        key={note.id}
        data-feedback-note={note.id}
        className={`flex items-start gap-2.5 rounded-xl border p-3 ${
          isFixed
            ? 'border-zinc-800 bg-zinc-950/40'
            : 'border-zinc-700 bg-zinc-900/60'
        }`}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <p
            className={`whitespace-pre-wrap text-xs leading-relaxed ${
              isFixed ? 'text-zinc-400 line-through decoration-zinc-600' : 'text-zinc-200'
            }`}
          >
            {note.text}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
            <span className="font-mono">{formatTimestamp(note.createdAt, timezone)}</span>
            {note.context && (
              <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 font-mono uppercase tracking-wide text-zinc-400">
                {note.context}
              </span>
            )}
            {isFixed && <span className="text-emerald-400/90 font-semibold">Fixed</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleStatus(note)}
            title={isFixed ? 'Reopen this note' : 'Mark this note fixed'}
            className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
              isFixed
                ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                : 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
            }`}
          >
            {isFixed ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(note.id)}
            title="Delete this note"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 transition-colors hover:bg-rose-950/40 hover:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <ModalOverlay
      label="Feedback on the app"
      onBackdropClick={onClose}
      onRequestClose={onClose}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
              <MessageSquarePlus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-zinc-100">
                Feedback on the app
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Write down anything that needs fixing or changing while you are looking at it.
                {context && (
                  <>
                    {' '}
                    This note is filed under{' '}
                    <span className="font-mono text-zinc-300">{context}</span>.
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="feedback-close-btn"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            Close
          </button>
        </div>

        <div className="space-y-2 px-4 py-3.5">
          <label htmlFor="feedback-input" className="block text-[10px] font-mono uppercase font-bold text-zinc-400">
            What needs fixing?
          </label>
          <textarea
            id="feedback-input"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter alone keeps the note multi-line; the shortcut is deliberate.
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                save();
              }
            }}
            rows={3}
            placeholder="e.g. Search history with a chart shows on the Trades tab — it should only be on the Coach tab."
            className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-amber-600"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-500">⌘/Ctrl + Enter to save</span>
            <button
              type="button"
              id="feedback-save-btn"
              onClick={save}
              disabled={!canSave}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              Save note
            </button>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto border-t border-zinc-800 px-4 py-3.5">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              Open ({open.length})
            </span>
            {fixed.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                {fixed.length} fixed
              </span>
            )}
          </div>

          {open.length === 0 ? (
            <p className="text-xs italic text-zinc-500">
              Nothing open. Write the next thing you notice in the box above.
            </p>
          ) : (
            <div className="space-y-2">{open.map(renderNote)}</div>
          )}

          {fixed.length > 0 && (
            <>
              <div className="mb-2 mt-4 text-[10px] font-mono uppercase font-bold text-zinc-500">
                Fixed ({fixed.length})
              </div>
              <div className="space-y-2">{fixed.map(renderNote)}</div>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};
