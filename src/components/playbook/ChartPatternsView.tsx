import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CheckSquare,
  Copy,
  ImageIcon,
  Layers,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Plus,
  Square,
  StickyNote,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { ModalOverlay } from '../common/ModalOverlay';
import { ImageUploader } from '../common/ImageUploader';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { PatternIllustration, PatternLegend } from './PatternAnimation';
import { PATTERNS, filterPatterns, getPattern, relatedPatterns } from '../../lib/playbook/patterns';
import {
  BIAS_LABELS,
  CATEGORY_LABELS,
  EDUCATIONAL_DISCLAIMER,
  GRADES,
  STATUS_LABELS,
  STATUS_OPTIONS,
  UNIVERSAL_CHECKLIST,
  checklistKey,
} from '../../lib/playbook/pattern-types';
import type { PatternBias, PatternCategory, PatternSetup } from '../../lib/playbook/pattern-types';
import type { PatternGrade, PatternStatus, PatternStudy, PatternStudyEntry } from '../../types';

export interface ChartPatternsViewProps {
  studies: PatternStudy[];
  onSaveStudy: (study: PatternStudy) => void;
  /** Pattern to open on mount, or when a deep link changes. */
  focusPatternId?: string | null;
  /** Reports the pattern being viewed so the app can keep the URL in step. */
  onOpenPattern?: (patternId: string | null) => void;
}

/** A brand-new study row for a pattern nobody has touched yet. */
function emptyStudy(patternId: string): PatternStudy {
  return {
    patternId,
    status: 'watching',
    checklist: [],
    notes: '',
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

function newEntry(patternId: string): PatternStudyEntry {
  const now = new Date().toISOString();
  return { id: `pse-${Date.now()}`, patternId, createdAt: now, updatedAt: now };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const CategoryBadge: React.FC<{ category: PatternCategory }> = ({ category }) => (
  <span
    className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
      category === 'reversal'
        ? 'border-violet-800/70 bg-violet-950/40 text-violet-300'
        : 'border-sky-800/70 bg-sky-950/40 text-sky-300'
    }`}
  >
    {CATEGORY_LABELS[category]}
  </span>
);

const BiasBadge: React.FC<{ bias: PatternBias }> = ({ bias }) => {
  const Icon = bias === 'bullish' ? TrendingUp : bias === 'bearish' ? TrendingDown : Layers;
  const tone =
    bias === 'bullish'
      ? 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300'
      : bias === 'bearish'
      ? 'border-rose-800/70 bg-rose-950/40 text-rose-300'
      : 'border-amber-800/70 bg-amber-950/40 text-amber-300';
  return (
    <span
      className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone}`}
    >
      <Icon className="h-3 w-3" />
      {BIAS_LABELS[bias]}
    </span>
  );
};

/** A titled block. Same shape as the setups' study guide sections. */
const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <section className="space-y-2">
    <h4 className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-400">
      {icon}
      {title}
    </h4>
    {children}
  </section>
);

const BulletList: React.FC<{ items: string[]; ordered?: boolean }> = ({ items, ordered }) =>
  ordered ? (
    <ol className="space-y-1.5">
      {items.map((item, index) => (
        <li key={item} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
          <span className="mt-0.5 shrink-0 font-mono text-[10px] text-zinc-500">
            {index + 1}.
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  ) : (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
          <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );

// ---------------------------------------------------------------------------
// Study journal
// ---------------------------------------------------------------------------

/** One logged example: chart before, chart after, and an honest review of it. */
const StudyEntryEditor: React.FC<{
  draft: PatternStudyEntry;
  onChange: (next: PatternStudyEntry) => void;
  onSave: () => void;
  onCancel: () => void;
  onPreview: (images: string[], index: number, title: string) => void;
}> = ({ draft, onChange, onSave, onCancel, onPreview }) => {
  const field = (label: string, value: string, key: keyof PatternStudyEntry, placeholder?: string) => (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <textarea
        value={value}
        rows={2}
        placeholder={placeholder}
        onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
        className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Instrument
          </span>
          <input
            value={draft.instrument ?? ''}
            onChange={(event) => onChange({ ...draft, instrument: event.target.value })}
            placeholder="MES"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
          />
        </label>
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Date</span>
          <input
            type="date"
            value={draft.tradeDate ?? ''}
            onChange={(event) => onChange({ ...draft, tradeDate: event.target.value })}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
          />
        </label>
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Timeframe
          </span>
          <input
            value={draft.timeframe ?? ''}
            onChange={(event) => onChange({ ...draft, timeframe: event.target.value })}
            placeholder="5m"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Stage when I acted
          </span>
          <select
            value={draft.stageWhenActed ?? ''}
            onChange={(event) =>
              onChange({ ...draft, stageWhenActed: (event.target.value || undefined) as PatternStatus })
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
          >
            <option value="">Not recorded</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            My grade for this example
          </span>
          <select
            value={draft.grade ?? ''}
            onChange={(event) =>
              onChange({ ...draft, grade: (event.target.value || undefined) as PatternGrade })
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
          >
            <option value="">Not graded</option>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Screenshot before entry
          </span>
          <ImageUploader
            images={draft.beforeImage ? [draft.beforeImage] : []}
            onChange={(next) => onChange({ ...draft, beforeImage: next[0] })}
            onPreviewImage={(index) =>
              onPreview(draft.beforeImage ? [draft.beforeImage] : [], index, 'Before entry')
            }
            maxImages={1}
            label="Before entry"
            helperText="One chart of the pattern before anything happened."
            idPrefix={`pattern-before-${draft.id}`}
            allowVideo={false}
          />
        </div>
        <div className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Screenshot after exit
          </span>
          <ImageUploader
            images={draft.afterImage ? [draft.afterImage] : []}
            onChange={(next) => onChange({ ...draft, afterImage: next[0] })}
            onPreviewImage={(index) =>
              onPreview(draft.afterImage ? [draft.afterImage] : [], index, 'After exit')
            }
            maxImages={1}
            label="After exit"
            helperText="One chart of how it actually resolved."
            idPrefix={`pattern-after-${draft.id}`}
            allowVideo={false}
          />
        </div>
      </div>

      {field('Why I believed it was valid', draft.whyValid ?? '', 'whyValid', 'What the chart showed.')}
      {field('What invalidated it (or would have)', draft.whatInvalidated ?? '', 'whatInvalidated')}
      {field('What I did well', draft.didWell ?? '', 'didWell')}
      {field('What I did wrong', draft.didWrong ?? '', 'didWrong')}
      {field('What I will do differently next time', draft.nextTime ?? '', 'nextTime')}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          id={`pattern-save-entry-${draft.id}`}
          onClick={onSave}
          className="rounded-xl bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-colors hover:bg-white"
        >
          Save example
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:text-zinc-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const StudyEntryCard: React.FC<{
  entry: PatternStudyEntry;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: (images: string[], index: number, title: string) => void;
}> = ({ entry, onEdit, onDelete, onPreview }) => {
  const rows: Array<[string, string | undefined]> = [
    ['Why it was valid', entry.whyValid],
    ['What invalidated it', entry.whatInvalidated],
    ['Did well', entry.didWell],
    ['Did wrong', entry.didWrong],
    ['Next time', entry.nextTime],
  ];

  return (
    <div
      id={`pattern-entry-${entry.id}`}
      className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-zinc-300">
          {[entry.instrument, entry.tradeDate, entry.timeframe].filter(Boolean).join(' • ') ||
            'Example'}
        </span>
        {entry.grade && (
          <span className="rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
            Grade {entry.grade}
          </span>
        )}
        {entry.stageWhenActed && (
          <span className="rounded-md border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
            {STATUS_LABELS[entry.stageWhenActed]}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:text-zinc-100"
          >
            Edit
          </button>
          <button
            type="button"
            id={`pattern-delete-entry-${entry.id}`}
            onClick={onDelete}
            aria-label="Delete this example"
            className="rounded-lg border border-rose-900/60 px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-950/40"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>

      {(entry.beforeImage || entry.afterImage) && (
        <div className="flex flex-wrap gap-2">
          {[
            { src: entry.beforeImage, label: 'Before' },
            { src: entry.afterImage, label: 'After' },
          ]
            .filter((item): item is { src: string; label: string } => !!item.src)
            .map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onPreview([item.src], 0, item.label)}
                className="group relative overflow-hidden rounded-xl border border-zinc-800"
              >
                <img src={item.src} alt={item.label} className="h-20 w-28 object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-200">
                  {item.label}
                </span>
              </button>
            ))}
        </div>
      )}

      <dl className="space-y-1">
        {rows
          .filter(([, value]) => !!value)
          .map(([label, value]) => (
            <div key={label} className="flex gap-2 text-[11px] leading-relaxed">
              <dt className="w-32 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {label}
              </dt>
              <dd className="text-zinc-300">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const PatternDetail: React.FC<{
  pattern: PatternSetup;
  study: PatternStudy;
  onSaveStudy: (study: PatternStudy) => void;
  onClose: () => void;
  onOpenPattern: (patternId: string) => void;
  onPreview: (images: string[], index: number, title: string) => void;
  startWithEntryEditor?: boolean;
}> = ({ pattern, study, onSaveStudy, onClose, onOpenPattern, onPreview, startWithEntryEditor }) => {
  const [notes, setNotes] = useState(study.notes);
  const [entryDraft, setEntryDraft] = useState<PatternStudyEntry | null>(
    startWithEntryEditor ? newEntry(pattern.id) : null
  );

  const notesDirty = notes !== study.notes;

  const saveNotes = () => onSaveStudy({ ...study, notes });

  const toggleChecklist = (key: string) => {
    const next = study.checklist.includes(key)
      ? study.checklist.filter((item) => item !== key)
      : [...study.checklist, key];
    onSaveStudy({ ...study, checklist: next });
  };

  const saveEntry = () => {
    if (!entryDraft) return;
    const exists = study.entries.some((entry) => entry.id === entryDraft.id);
    const entries = exists
      ? study.entries.map((entry) =>
          entry.id === entryDraft.id ? { ...entryDraft, updatedAt: new Date().toISOString() } : entry
        )
      : [...study.entries, entryDraft];
    onSaveStudy({ ...study, entries });
    setEntryDraft(null);
  };

  const deleteEntry = (entryId: string) =>
    onSaveStudy({ ...study, entries: study.entries.filter((entry) => entry.id !== entryId) });

  const related = useMemo(() => relatedPatterns(pattern), [pattern]);

  const checklistRows = [
    ...UNIVERSAL_CHECKLIST.map((item, index) => ({
      key: checklistKey('universal', index),
      label: item.label,
    })),
    ...pattern.checklist.map((label, index) => ({
      key: checklistKey('pattern', index),
      label,
    })),
  ];

  return (
    <div
      id={`pattern-detail-${pattern.id}`}
      className="relative my-6 w-full max-w-3xl space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-6"
    >
      {/* 1-3: name, category, bias. */}
      <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-base font-bold text-zinc-100 sm:text-lg">{pattern.displayName}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <CategoryBadge category={pattern.category} />
            <BiasBadge bias={pattern.bias} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Source #{pattern.sourcePosition}
            </span>
            {pattern.displayName !== pattern.sourceName && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                <Copy className="h-3 w-3" />
                Source label: {pattern.sourceName}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pattern"
          className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Where the label and the drawing disagree, say so instead of hiding it. */}
      {pattern.sourceNote && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-3">
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
            <Copy className="h-3 w-3" />
            Source note
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-200/90">{pattern.sourceNote}</p>
          {pattern.aliases?.length ? (
            <p className="mt-1 font-mono text-[10px] text-amber-200/70">
              Also described as: {pattern.aliases.join('; ')}
            </p>
          ) : null}
        </div>
      )}

      {/*
        Where this pattern is in the trader's own study of it. Nine statuses only earn
        their keep if the picker explains them, so the chosen one carries its own reason
        underneath — and the wording is what separates "a shape exists" from "a candle
        closed beyond it".
      */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <label
          htmlFor={`pattern-status-${pattern.id}`}
          className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400"
        >
          Study status
        </label>
        <select
          id={`pattern-status-${pattern.id}`}
          value={study.status}
          onChange={(event) =>
            onSaveStudy({ ...study, status: event.target.value as PatternStatus })
          }
          className="mt-1.5 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600 sm:w-64"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          {STATUS_OPTIONS.find((option) => option.value === study.status)?.help}
          {' '}These are study-journal states, not trading instructions.
        </p>
      </div>

      {/* 4: the animated illustration, with the legend and controls. */}
      <div className="space-y-1">
        <PatternIllustration
          patternId={pattern.id}
          title={`${pattern.displayName} formation, drawn in sequence`}
          mode="player"
          showLegend
        />
      </div>

      {/* 5: quick definition. */}
      <Section icon={<Lightbulb className="h-3.5 w-3.5" />} title="Quick definition">
        <p className="text-sm leading-relaxed text-zinc-200">{pattern.summary}</p>
      </Section>

      {/* 6: what buyers and sellers are each doing. */}
      <Section icon={<BookOpen className="h-3.5 w-3.5" />} title="Market story">
        <BulletList items={pattern.marketStory} />
      </Section>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section icon={<ListChecks className="h-3.5 w-3.5" />} title="What must be present">
          <BulletList items={pattern.requiredStructure} />
        </Section>
        <Section icon={<Layers className="h-3.5 w-3.5" />} title="Formation sequence">
          <BulletList items={pattern.formationSequence} ordered />
        </Section>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section icon={<ArrowUpRight className="h-3.5 w-3.5" />} title="Confirmation / trigger">
          <BulletList items={pattern.confirmation} />
        </Section>
        <Section icon={<AlertTriangle className="h-3.5 w-3.5" />} title="Invalidation / failure signs">
          <BulletList items={pattern.invalidation} />
        </Section>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section icon={<Target className="h-3.5 w-3.5" />} title="Potential target concepts">
          <BulletList items={pattern.targetConcepts} />
        </Section>
        <Section icon={<ArrowDownRight className="h-3.5 w-3.5" />} title="Common mistakes">
          <BulletList items={pattern.commonMistakes} />
        </Section>
      </div>

      {/* 13: the checklist the trader ticks while reading a live chart. */}
      <Section icon={<CheckSquare className="h-3.5 w-3.5" />} title="Playbook checklist">
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Ticked items are saved with this pattern and sync with the rest of your journal. A shape
          alone is not a confirmation: check the boxes you can actually see.
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {checklistRows.map((row) => {
            const checked = study.checklist.includes(row.key);
            return (
              <li key={row.key}>
                <button
                  type="button"
                  id={`pattern-check-${row.key.replace(':', '-')}`}
                  aria-pressed={checked}
                  onClick={() => toggleChecklist(row.key)}
                  className={`flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] leading-relaxed transition-colors ${
                    checked
                      ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-100'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  )}
                  <span>{row.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* 14: the trader's own examples. */}
      <Section icon={<ImageIcon className="h-3.5 w-3.5" />} title="My screenshots / examples">
        {entryDraft ? (
          <StudyEntryEditor
            draft={entryDraft}
            onChange={setEntryDraft}
            onSave={saveEntry}
            onCancel={() => setEntryDraft(null)}
            onPreview={onPreview}
          />
        ) : (
          <button
            type="button"
            id="pattern-add-example"
            onClick={() => setEntryDraft(newEntry(pattern.id))}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Add an example
          </button>
        )}

        {study.entries.length === 0 ? (
          <p className="text-[11px] text-zinc-500">
            No examples logged yet. One honest example teaches more than ten saved charts.
          </p>
        ) : (
          <div className="space-y-2">
            {study.entries.map((entry) => (
              <StudyEntryCard
                key={entry.id}
                entry={entry}
                onEdit={() => setEntryDraft(entry)}
                onDelete={() => deleteEntry(entry.id)}
                onPreview={onPreview}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 15: free notes. */}
      <Section icon={<StickyNote className="h-3.5 w-3.5" />} title="My notes">
        <textarea
          id="pattern-notes"
          value={notes}
          rows={4}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What this pattern looks like on the instruments you trade, and how you will recognise it next time."
          className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-zinc-600"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="pattern-save-notes"
            onClick={saveNotes}
            disabled={!notesDirty}
            className="rounded-xl bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-colors hover:bg-white disabled:opacity-40"
          >
            Save notes
          </button>
          {notesDirty && (
            <span className="font-mono text-[10px] text-amber-300">Unsaved changes</span>
          )}
        </div>
      </Section>

      {/* 16: where to go next. */}
      <Section icon={<Layers className="h-3.5 w-3.5" />} title="Related setups">
        <div className="flex flex-wrap gap-1.5">
          {related.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onOpenPattern(candidate.id)}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              {candidate.displayName}
              <span className="font-mono text-[10px] text-zinc-500">
                {CATEGORY_LABELS[candidate.category]}
              </span>
            </button>
          ))}
        </div>
      </Section>

      <p className="border-t border-zinc-800 pt-3 text-[11px] leading-relaxed text-zinc-500">
        {EDUCATIONAL_DISCLAIMER}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export const ChartPatternsView: React.FC<ChartPatternsViewProps> = ({
  studies,
  onSaveStudy,
  focusPatternId,
  onOpenPattern,
}) => {
  const [category, setCategory] = useState<PatternCategory | 'all'>('all');
  const [bias, setBias] = useState<PatternBias | 'all'>('all');
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
    title: string;
  } | null>(null);

  // The open pattern is derived from the focus prop so a deep link and a card click take
  // exactly the same path. `openedFor` remembers how it was opened, so "Add example" from
  // a card lands with the entry editor already out.
  const [openState, setOpenState] = useState<{ id: string | null; withEntry: boolean }>({
    id: focusPatternId ?? null,
    withEntry: false,
  });

  // Keep the URL-driven focus and the locally opened pattern in step without an effect.
  // Opening a pattern reports it upward, so the focus prop echoes straight back: an echo
  // must not disturb what is already open, or "Add example" would lose the empty editor
  // it just opened. Only a genuinely different focus (a pasted link, a hash edit) resets.
  const [lastFocus, setLastFocus] = useState<string | null>(focusPatternId ?? null);
  if ((focusPatternId ?? null) !== lastFocus) {
    const incoming = focusPatternId ?? null;
    setLastFocus(incoming);
    setOpenState((current) => (current.id === incoming ? current : { id: incoming, withEntry: false }));
  }

  const openPattern = (id: string | null, withEntry = false) => {
    setOpenState({ id, withEntry });
    onOpenPattern?.(id);
  };

  const visible = useMemo(() => filterPatterns({ category, bias }), [category, bias]);
  const studyFor = (patternId: string) =>
    studies.find((study) => study.patternId === patternId) ?? emptyStudy(patternId);
  const openPatternData = getPattern(openState.id);

  const counts = useMemo(
    () => ({
      reversal: PATTERNS.filter((pattern) => pattern.category === 'reversal').length,
      continuation: PATTERNS.filter((pattern) => pattern.category === 'continuation').length,
      bullish: PATTERNS.filter((pattern) => pattern.bias === 'bullish').length,
      bearish: PATTERNS.filter((pattern) => pattern.bias === 'bearish').length,
      neutral: PATTERNS.filter((pattern) => pattern.bias === 'neutral').length,
    }),
    []
  );

  const filterClass = (active: boolean) =>
    `rounded-xl border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
      active
        ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
        : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
    }`;

  return (
    <div id="chart-patterns-section" className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
          <BookOpen className="h-4 w-4 text-emerald-400" />
          Chart Patterns
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          All 20 setups from the chart-pattern sheet, in source order, each with the geometry
          drawn in sequence and the questions worth asking about it. {EDUCATIONAL_DISCLAIMER}
        </p>
        <PatternLegend className="mt-2" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Category
        </span>
        <button
          type="button"
          id="pattern-filter-category-all"
          aria-pressed={category === 'all'}
          onClick={() => setCategory('all')}
          className={filterClass(category === 'all')}
        >
          All {PATTERNS.length}
        </button>
        <button
          type="button"
          id="pattern-filter-category-reversal"
          aria-pressed={category === 'reversal'}
          onClick={() => setCategory('reversal')}
          className={filterClass(category === 'reversal')}
        >
          Reversal {counts.reversal}
        </button>
        <button
          type="button"
          id="pattern-filter-category-continuation"
          aria-pressed={category === 'continuation'}
          onClick={() => setCategory('continuation')}
          className={filterClass(category === 'continuation')}
        >
          Continuation {counts.continuation}
        </button>

        <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Bias
        </span>
        <button
          type="button"
          id="pattern-filter-bias-all"
          aria-pressed={bias === 'all'}
          onClick={() => setBias('all')}
          className={filterClass(bias === 'all')}
        >
          All
        </button>
        <button
          type="button"
          id="pattern-filter-bias-bullish"
          aria-pressed={bias === 'bullish'}
          onClick={() => setBias('bullish')}
          className={filterClass(bias === 'bullish')}
        >
          Bullish {counts.bullish}
        </button>
        <button
          type="button"
          id="pattern-filter-bias-bearish"
          aria-pressed={bias === 'bearish'}
          onClick={() => setBias('bearish')}
          className={filterClass(bias === 'bearish')}
        >
          Bearish {counts.bearish}
        </button>
        <button
          type="button"
          id="pattern-filter-bias-neutral"
          aria-pressed={bias === 'neutral'}
          onClick={() => setBias('neutral')}
          className={filterClass(bias === 'neutral')}
        >
          Two-direction {counts.neutral}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-6 text-center text-xs text-zinc-400">
          No patterns match those filters.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((pattern, index) => {
            const study = studyFor(pattern.id);
            const touched =
              study.entries.length > 0 ||
              study.checklist.length > 0 ||
              study.status !== 'watching' ||
              study.notes.trim().length > 0;
            return (
              <article
                key={pattern.id}
                id={`pattern-card-${pattern.id}`}
                className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <CategoryBadge category={pattern.category} />
                  <BiasBadge bias={pattern.bias} />
                  {touched && (
                    <span className="rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                      {STATUS_LABELS[study.status]}
                      {study.entries.length > 0 && ` • ${study.entries.length} example(s)`}
                    </span>
                  )}
                </div>

                <h4 className="text-sm font-semibold leading-tight text-zinc-100">
                  {pattern.displayName}
                </h4>

                {/* Cards show the shape only: labels and measured moves belong on the
                    detail view, where there is room to read them. */}
                <PatternIllustration
                  patternId={pattern.id}
                  title={`${pattern.displayName} mini illustration`}
                  mode="loop"
                  cardIndex={index}
                  showLabels={false}
                  showRetest={false}
                  showTarget={false}
                />

                <p className="text-[11px] leading-relaxed text-zinc-400">{pattern.summary}</p>

                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    id={`pattern-study-${pattern.id}`}
                    onClick={() => openPattern(pattern.id)}
                    className="rounded-xl bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-colors hover:bg-white"
                  >
                    Study setup
                  </button>
                  <button
                    type="button"
                    id={`pattern-add-example-${pattern.id}`}
                    onClick={() => openPattern(pattern.id, true)}
                    className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
                  >
                    <NotebookPen className="h-3.5 w-3.5" />
                    Add example
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {openPatternData && (
        <ModalOverlay
          onRequestClose={() => openPattern(null)}
          onBackdropClick={() => openPattern(null)}
          label={`${openPatternData.displayName} study guide`}
        >
          {/* Remounting per pattern resets the notes draft and any half-written example. */}
          <PatternDetail
            key={openPatternData.id}
            pattern={openPatternData}
            study={studyFor(openPatternData.id)}
            onSaveStudy={onSaveStudy}
            onClose={() => openPattern(null)}
            onOpenPattern={(id) => openPattern(id)}
            onPreview={(images, index, title) => setLightbox({ images, index, title })}
            startWithEntryEditor={openState.withEntry}
          />
        </ModalOverlay>
      )}

      <ImageLightboxModal
        isOpen={lightbox !== null}
        onClose={() => setLightbox(null)}
        images={lightbox?.images ?? []}
        initialIndex={lightbox?.index ?? 0}
        title={lightbox?.title}
      />
    </div>
  );
};

export default ChartPatternsView;
