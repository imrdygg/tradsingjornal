import React, { useState } from 'react';
import { Plus, Trash2, Tag, X, Pencil, Check } from 'lucide-react';
import { ImportantLevel } from '../../types';
import { parseTagInput } from '../../lib/utils/tags';

/**
 * The prices today is read against.
 *
 * A level carries three pieces of writing, which do different jobs: the price is where it
 * is, the label names it ("Overnight High", "VWAP"), and the tags classify it so a screen
 * of levels can be read at a glance and searched later ("liquidity", "news", "key").
 * Tags are free-form and comma-separated, the same habit as a trade's tags.
 *
 * Nothing here is a view on direction, which is why it is the one piece of morning writing
 * that survived the plan's removal: the coach's warning and the Playbook's level log both
 * need a list of prices, and neither needs an opinion to go with them.
 *
 * A level can be edited in place as well as added and removed. A mistyped price used to
 * mean deleting the level and typing all four fields again, which is a lot of retyping for
 * one wrong digit — and the wrong digit is exactly the kind of thing that gets left in
 * because fixing it is annoying.
 */

interface ImportantLevelsEditorProps {
  levels: ImportantLevel[];
  onChange: (levels: ImportantLevel[]) => void;
  disabled?: boolean;
  /**
   * The editor's own heading row. On by default; off for a caller that titles the section
   * itself, so the page does not read its own title back twice.
   */
  showHeading?: boolean;
}

export const ImportantLevelsEditor: React.FC<ImportantLevelsEditorProps> = ({
  levels,
  onChange,
  disabled = false,
  showHeading = true,
}) => {
  const [newPrice, setNewPrice] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newTags, setNewTags] = useState('');

  /** The level currently open for editing, and the draft its fields are typed into. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState('');

  const handleAddLevel = () => {
    const priceNum = parseFloat(newPrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    const tags = parseTagInput(newTags);
    const newLevel: ImportantLevel = {
      id: `level-${Date.now()}`,
      tradingDayId: '',
      price: priceNum,
      label: newLabel.trim() || undefined,
      notes: newNotes.trim() || undefined,
      tags: tags.length ? tags : undefined,
    };

    onChange([...levels, newLevel]);
    setNewPrice('');
    setNewLabel('');
    setNewNotes('');
    setNewTags('');
  };

  const handleRemoveLevel = (id: string) => {
    // Removing the level being edited closes the draft with it, rather than leaving the
    // editor open against an id that no longer exists.
    if (editingId === id) setEditingId(null);
    onChange(levels.filter((l) => l.id !== id));
  };

  /** Opens one level for editing, seeding the draft from what it currently holds. */
  const startEdit = (level: ImportantLevel) => {
    setEditingId(level.id);
    setEditPrice(String(level.price));
    setEditLabel(level.label ?? '');
    setEditNotes(level.notes ?? '');
    setEditTags((level.tags ?? []).join(', '));
  };

  const cancelEdit = () => setEditingId(null);

  /**
   * Writes the draft back onto the level. The fields are stored the same way an added level
   * is — an emptied label, note or tag list becomes undefined rather than an empty string or
   * array — so an edited level cannot end up with a different shape from a typed one.
   */
  const saveEdit = (id: string) => {
    const priceNum = parseFloat(editPrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    const tags = parseTagInput(editTags);
    onChange(
      levels.map((level) =>
        level.id === id
          ? {
              ...level,
              price: priceNum,
              label: editLabel.trim() || undefined,
              notes: editNotes.trim() || undefined,
              tags: tags.length ? tags : undefined,
            }
          : level
      )
    );
    setEditingId(null);
  };

  /**
   * Drops one tag from a level.
   *
   * A typo in a tag would otherwise mean deleting the level and typing it all again, which
   * is the kind of friction that stops people using the field at all. The level's price,
   * label and notes are untouched, and the list is cleared to undefined rather than left
   * as an empty array, matching how a level is stored when it carries no tags.
   */
  const handleRemoveTag = (levelId: string, tag: string) => {
    onChange(
      levels.map((level) => {
        if (level.id !== levelId) return level;
        const remaining = (level.tags ?? []).filter((existing) => existing !== tag);
        return { ...level, tags: remaining.length ? remaining : undefined };
      })
    );
  };

  const fieldClass =
    'rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none';

  return (
    <div className="space-y-3">
      {showHeading && (
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-zinc-400" />
            Important Price Levels
          </label>
          <span className="text-[11px] text-zinc-400 font-mono">
            {levels.length} level{levels.length === 1 ? '' : 's'} tracked
          </span>
        </div>
      )}

      {/* Existing Levels List */}
      {levels.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {levels.map((lvl) =>
            editingId === lvl.id ? (
              /* ---- Editing one level ---- */
              <div
                key={lvl.id}
                data-level-editing={lvl.id}
                className="rounded-lg border border-sky-800/70 bg-zinc-950/60 p-2.5 text-xs space-y-2"
              >
                <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                  <input
                    id={`level-edit-price-${lvl.id}`}
                    type="number"
                    step="0.25"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    autoFocus
                    aria-label="Price"
                    className={`${fieldClass} w-full sm:w-28 font-mono`}
                  />
                  <input
                    id={`level-edit-label-${lvl.id}`}
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder="Label"
                    aria-label="Label"
                    className={`${fieldClass} w-full sm:flex-1`}
                  />
                </div>
                <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
                  <input
                    id={`level-edit-notes-${lvl.id}`}
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    aria-label="Notes"
                    className={`${fieldClass} w-full sm:flex-1`}
                  />
                  <input
                    id={`level-edit-tags-${lvl.id}`}
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="Tags — e.g. liquidity, news"
                    aria-label="Tags"
                    className={`${fieldClass} w-full sm:w-48`}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    id={`level-edit-cancel-${lvl.id}`}
                    onClick={cancelEdit}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id={`level-edit-save-${lvl.id}`}
                    onClick={() => saveEdit(lvl.id)}
                    disabled={!editPrice || !(parseFloat(editPrice) > 0)}
                    className="flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-100 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                  >
                    <Check className="w-3 h-3" />
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={lvl.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-zinc-100 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {lvl.price.toFixed(2)}
                    </span>
                    {lvl.label && (
                      <span className="font-medium text-zinc-300 truncate">{lvl.label}</span>
                    )}
                  </div>
                  {!disabled && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        id={`level-edit-${lvl.id}`}
                        onClick={() => startEdit(lvl)}
                        title={`Edit the ${lvl.price.toFixed(2)} level`}
                        aria-label={`Edit the ${lvl.price.toFixed(2)} level`}
                        className="text-zinc-400 hover:text-sky-400 p-1 transition-colors rounded hover:bg-zinc-900"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveLevel(lvl.id)}
                        title={`Remove the ${lvl.price.toFixed(2)} level`}
                        aria-label={`Remove the ${lvl.price.toFixed(2)} level`}
                        className="text-zinc-400 hover:text-rose-400 p-1 transition-colors rounded hover:bg-zinc-900"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {lvl.notes && (
                  <p className="text-zinc-400 italic truncate">— {lvl.notes}</p>
                )}

                {lvl.tags && lvl.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {lvl.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300"
                      >
                        {tag}
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(lvl.id, tag)}
                            title={`Remove the "${tag}" tag`}
                            aria-label={`Remove the "${tag}" tag from the ${lvl.price.toFixed(2)} level`}
                            className="text-zinc-500 hover:text-rose-400 transition-colors"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* Add New Level Input Bar */}
      {!disabled && (
        <div className="space-y-2">
          <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
            <input
              id="level-price"
              type="number"
              step="0.25"
              placeholder="Price (e.g. 6715.50)"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className={`${fieldClass} w-full sm:w-36 font-mono`}
            />
            <input
              id="level-label"
              type="text"
              placeholder="Label (e.g. Overnight High, VWAP)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className={`${fieldClass} w-full sm:flex-1`}
            />
            <input
              id="level-notes"
              type="text"
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className={`${fieldClass} w-full sm:w-44`}
            />
          </div>

          {/* Its own row: tags are the one field here that is easier to type a list into. */}
          <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
            <input
              id="level-tags"
              type="text"
              placeholder="Tags (optional) — e.g. liquidity, news, key"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              className={`${fieldClass} w-full sm:flex-1`}
            />
            <button
              id="level-add"
              type="button"
              onClick={handleAddLevel}
              disabled={!newPrice}
              className="w-full sm:w-auto flex items-center justify-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Level
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
