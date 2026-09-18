import React, { useState } from 'react';
import { AlertCircle, History, X } from 'lucide-react';
import { ModalOverlay } from '../common/ModalOverlay';

interface PlanChangeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  fieldName: string;
  oldValue: string;
  newValue: string;
  /** Overridable copy so the same dialog can also undo a plan lock. */
  title?: string;
  description?: string;
  confirmLabel?: string;
  placeholder?: string;
}

export const PlanChangeDialog: React.FC<PlanChangeDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  fieldName,
  oldValue,
  newValue,
  title = 'Record Plan Change',
  description = 'A written reason is required when modifying a locked daily plan.',
  confirmLabel = 'Record Change & Update',
  placeholder = 'E.g., Market shifted from balance to high-volume expansion; increasing loss limit with accumulated buffer...',
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A written reason is required when modifying a locked daily plan.');
      return;
    }
    onConfirm(reason.trim());
    setReason('');
    setError('');
  };

  return (
    <ModalOverlay>
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-700/80 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <History className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">{description}</p>

          <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-3 text-xs space-y-1.5">
            <div className="flex justify-between text-zinc-400">
              <span>Field Modified:</span>
              <span className="font-semibold text-zinc-200 uppercase font-mono">{fieldName}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Original Value:</span>
              <span className="font-mono text-rose-300">{oldValue}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>New Value:</span>
              <span className="font-mono text-emerald-300">{newValue}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              Reason:
              <span className="text-rose-400">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError('');
              }}
              placeholder={placeholder}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
            {error && (
              <p className="text-[11px] text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400 transition-colors shadow-sm"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
};
