import React, { useState } from 'react';
import { Plus, Trash2, Tag } from 'lucide-react';
import { ImportantLevel } from '../../types';

interface ImportantLevelsEditorProps {
  levels: ImportantLevel[];
  onChange: (levels: ImportantLevel[]) => void;
  disabled?: boolean;
}

export const ImportantLevelsEditor: React.FC<ImportantLevelsEditorProps> = ({
  levels,
  onChange,
  disabled = false,
}) => {
  const [newPrice, setNewPrice] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const handleAddLevel = () => {
    const priceNum = parseFloat(newPrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    const newLevel: ImportantLevel = {
      id: `level-${Date.now()}`,
      tradingDayId: '',
      price: priceNum,
      label: newLabel.trim() || undefined,
      notes: newNotes.trim() || undefined,
    };

    onChange([...levels, newLevel]);
    setNewPrice('');
    setNewLabel('');
    setNewNotes('');
  };

  const handleRemoveLevel = (id: string) => {
    onChange(levels.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-zinc-400" />
          Important Price Levels
        </label>
        <span className="text-[11px] text-zinc-400 font-mono">
          {levels.length} level{levels.length === 1 ? '' : 's'} tracked
        </span>
      </div>

      {/* Existing Levels List */}
      {levels.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {levels.map((lvl) => (
            <div
              key={lvl.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-zinc-100 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                  {lvl.price.toFixed(2)}
                </span>
                {lvl.label && (
                  <span className="font-medium text-zinc-300 truncate max-w-[120px]">
                    {lvl.label}
                  </span>
                )}
                {lvl.notes && (
                  <span className="text-zinc-400 truncate max-w-[120px] italic">
                    — {lvl.notes}
                  </span>
                )}
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveLevel(lvl.id)}
                  className="text-zinc-400 hover:text-rose-400 p-1 transition-colors rounded hover:bg-zinc-900"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add New Level Input Bar */}
      {!disabled && (
        <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
          <input
            type="number"
            step="0.25"
            placeholder="Price (e.g. 6715.50)"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="w-full sm:w-36 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Label (e.g. Overnight High, VWAP)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full sm:flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            className="w-full sm:w-44 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddLevel}
            disabled={!newPrice}
            className="w-full sm:w-auto flex items-center justify-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 px-3 py-1.5 text-xs font-medium transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Level
          </button>
        </div>
      )}
    </div>
  );
};
