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
  const [newSide, setNewSide] = useState<ImportantLevel['side']>(undefined);

  /** The level currently open for editing, and the draft its fields are typed into. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editSide, setEditSide] = useState<ImportantLevel['side']>(undefined);

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
      side: newSide,
    };

    onChange([...levels, newLevel]);
    setNewPrice('');
    setNewLabel('');
    setNewNotes('');
    setNewTags('');
    setNewSide(undefined);
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
    setEditSide(level.side);
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
              side: editSide,
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

  /**
   * The card's colour says which side of price the level is expected to act on — red for
   * resistance, green for support. The tints are deliberately faint: a screen of levels is
   * read at a glance, and a saturated block behind every one would be hard on the eyes. An
   * unclassified level keeps the neutral card it always had.
   */
  const sideCardClass = (side: ImportantLevel['side']) => {
    if (side === 'resistance') return 'border-rose-900/70 bg-rose-950/25';
    if (side === 'support') return 'border-emerald-900/70 bg-emerald-950/25';
    return 'border-zinc-800 bg-zinc-950/60';
  };

  /** A two-way toggle. Pressing the active side again clears it back to unclassified. */
  const renderSideToggle = (
    value: ImportantLevel['side'],
    setValue: (next: ImportantLevel['side']) => void,
    idPrefix: string
  ) => (
    <div className="flex items-center gap-1" role="group" aria-label="Level side">
      {(['support', 'resistance'] as const).map((side) => {
        const active = value === side;
        const tone =
          side === 'support'
            ? active
              ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
              : 'border-zinc-700 text-zinc-400 hover:border-emerald-800 hover:text-emerald-300'
            : active
              ? 'border-rose-700 bg-rose-900/40 text-rose-200'
              : 'border-zinc-700 text-zinc-400 hover:border-rose-800 hover:text-rose-300';
        return (
          <button
            key={side}
            type="button"
            id={`${idPrefix}-${side}`}
            aria-pressed={active}
            onClick={() => setValue(active ? undefined : side)}
            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${tone}`}
          >
            {side}
          </button>
        );
      })}
    </div>
  );

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
                <div className="flex flex-wrap items-center gap-2">
                  {renderSideToggle(editSide, setEditSide, `level-edit-side-${lvl.id}`)}
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
                className={`rounded-lg border p-2.5 text-xs space-y-1.5 ${sideCardClass(lvl.side)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-zinc-100 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {lvl.price.toFixed(2)}
                    </span>
                    {lvl.label && (
                      <span className="font-medium text-zinc-300 truncate">{lvl.label}</span>
                    )}
                    {lvl.side && (
                      <span
                        className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                          lvl.side === 'resistance'
                            ? 'border-rose-800 bg-rose-950/50 text-rose-300'
                            : 'border-emerald-800 bg-emerald-950/50 text-emerald-300'
                        }`}
                      >
                        {lvl.side}
                      </span>
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

          {/* Which side of price this level is expected to hold, so it reads by colour. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Side
            </span>
            {renderSideToggle(newSide, setNewSide, 'level-side')}
            <span className="text-[10px] text-zinc-500">
              Colours the level — red for resistance, green for support.
            </span>
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
