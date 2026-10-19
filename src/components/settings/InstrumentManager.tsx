import React, { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Instrument, InstrumentKind } from '../../types';
import {
  INSTRUMENT_KINDS,
  draftInstrument,
  instrumentKind,
  instrumentProblem,
  normalizeInstrument,
  sizeUnit,
} from '../../lib/trading/instruments';

/**
 * The instrument catalog, editable.
 *
 * The app ships a futures catalog but no longer decides what a trader may record, so this is
 * the screen that makes the catalog theirs: add a contract that is not in the list, add a stock
 * or ETF and record it in shares, correct a multiplier to match a broker's spec, retire one that
 * is not traded any more, or delete one that was never traded.
 *
 * Two things it deliberately does not do. It never rewrites history — a deleted or renamed
 * instrument keeps the symbol its trades were recorded with, and the P&L already stored is not
 * recalculated behind the trader's back. And it never trusts a typed tick value: that number is
 * derived from dollars-per-point and tick size, because two fields that can disagree is one
 * field too many.
 */

export interface InstrumentManagerProps {
  instruments: Instrument[];
  /** Adds or updates one instrument. The parent persists and echoes the new catalog back. */
  onSave: (instrument: Instrument) => void;
  /** Removes one. Returns false when it is the last active instrument, which cannot go. */
  onDelete: (id: string) => boolean;
}

const kindLabel = (kind: InstrumentKind): string =>
  INSTRUMENT_KINDS.find((entry) => entry.kind === kind)?.label ?? 'Custom';

const money = (value: number): string => {
  const rounded = Math.round(value * 10000) / 10000;
  return `$${rounded.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
};

export const InstrumentManager: React.FC<InstrumentManagerProps> = ({
  instruments,
  onSave,
  onDelete,
}) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Instrument>(() => draftInstrument('future'));
  const [problem, setProblem] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Instrument | null>(null);
  const [editProblem, setEditProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeCount = useMemo(
    () => instruments.filter((instrument) => instrument.active !== false).length,
    [instruments]
  );

  const startAdd = (kind: InstrumentKind = 'future') => {
    setAdding(true);
    setDraft(draftInstrument(kind));
    setProblem(null);
    setNotice(null);
  };

  const changeKind = (kind: InstrumentKind) => {
    const spec = INSTRUMENT_KINDS.find((entry) => entry.kind === kind);
    setDraft((current) => ({
      ...current,
      kind,
      pointValue: spec?.pointValue ?? current.pointValue,
      tickSize: spec?.tickSize ?? current.tickSize,
      tickValue:
        Math.round((spec?.pointValue ?? current.pointValue) * (spec?.tickSize ?? current.tickSize) * 1e6) /
        1e6,
    }));
    setProblem(null);
  };

  const commitAdd = () => {
    const clean = normalizeInstrument({ ...draft, id: '' });
    const issue = instrumentProblem(clean, instruments);
    if (issue) {
      setProblem(issue);
      return;
    }
    onSave(clean);
    setAdding(false);
    setDraft(draftInstrument('future'));
    setProblem(null);
    setNotice(`${clean.symbol} added to the catalog.`);
  };

  const startEdit = (instrument: Instrument) => {
    setEditingId(instrument.id);
    setEditDraft({ ...instrument, kind: instrumentKind(instrument) });
    setEditProblem(null);
    setNotice(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
    setEditProblem(null);
  };

  const commitEdit = () => {
    if (!editDraft) return;
    const clean = normalizeInstrument(editDraft);
    const others = instruments.filter((instrument) => instrument.id !== clean.id);
    const issue = instrumentProblem(clean, others);
    if (issue) {
      setEditProblem(issue);
      return;
    }
    onSave(clean);
    cancelEdit();
    setNotice(`${clean.symbol} updated. Past trades keep the spec they were priced with.`);
  };

  const toggleActive = (instrument: Instrument) => {
    if (instrument.active !== false && activeCount <= 1) {
      setNotice('The last active instrument cannot be turned off — the journal needs one to record against.');
      return;
    }
    onSave({ ...instrument, active: instrument.active === false });
    setNotice(
      instrument.active === false
        ? `${instrument.symbol} is back in the pickers.`
        : `${instrument.symbol} is hidden from the pickers. Its history stays readable.`
    );
  };

  const remove = (instrument: Instrument) => {
    if (!window.confirm(`Remove ${instrument.symbol} from the catalog?\n\nTrades and levels already recorded under it keep their symbol and their P&L.`)) {
      return;
    }
    const removed = onDelete(instrument.id);
    if (!removed) {
      setNotice('That is the last active instrument, so it cannot be removed. Add another first.');
      return;
    }
    if (editingId === instrument.id) cancelEdit();
    setNotice(`${instrument.symbol} removed from the catalog. Its history stays as recorded.`);
  };

  const fields = (
    value: Instrument,
    onChange: (next: Instrument) => void,
    options: { prefix: string; kinds?: boolean }
  ) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
      <label className="col-span-1 text-[10px] text-zinc-500">
        Symbol
        <input
          id={`${options.prefix}-symbol`}
          type="text"
          value={value.symbol}
          maxLength={12}
          placeholder="ES"
          onChange={(event) => onChange({ ...value, symbol: event.target.value.toUpperCase() })}
          className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs uppercase text-zinc-100 focus:border-zinc-600 focus:outline-none"
        />
      </label>

      <label className="col-span-1 text-[10px] text-zinc-500 sm:col-span-2">
        Name
        <input
          id={`${options.prefix}-name`}
          type="text"
          value={value.name}
          placeholder="E-mini S&P 500"
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
        />
      </label>

      <label className="col-span-1 text-[10px] text-zinc-500">
        $ per point
        <input
          id={`${options.prefix}-point-value`}
          type="number"
          min="0"
          step="any"
          value={value.pointValue}
          onChange={(event) => onChange({ ...value, pointValue: Number(event.target.value) })}
          className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
        />
      </label>

      <label className="col-span-1 text-[10px] text-zinc-500">
        Tick size
        <input
          id={`${options.prefix}-tick-size`}
          type="number"
          min="0"
          step="any"
          value={value.tickSize}
          onChange={(event) => onChange({ ...value, tickSize: Number(event.target.value) })}
          className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
        />
      </label>

      {options.kinds && (
        <label className="col-span-2 text-[10px] text-zinc-500 sm:col-span-1">
          Kind
          <select
            id={`${options.prefix}-kind`}
            value={instrumentKind(value)}
            onChange={(event) => onChange({ ...value, kind: event.target.value as InstrumentKind })}
            className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
          >
            {INSTRUMENT_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="col-span-2 self-end text-[10px] leading-snug text-zinc-500 sm:col-span-6">
        Tick value is derived: {money(value.pointValue)} per point × {value.tickSize} points ={' '}
        <span className="font-mono text-zinc-300">
          {money(value.pointValue * value.tickSize)} per tick
        </span>{' '}
        per {instrumentKind(value) === 'stock' ? 'share' : 'contract'}. Size is recorded in{' '}
        {sizeUnit(value)}.
      </p>
    </div>
  );

  return (
    <div id="instrument-manager" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
            <Check className="h-4 w-4 text-zinc-400" />
            Instruments — what you trade
          </h2>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-zinc-500">
            This catalog is what every picker, P&amp;L calculation and coach read uses. The app
            ships the liquid futures contracts with their exchange specs; add a stock, an ETF, a
            contract that is not listed, or anything else by its own spec. Dollars per point for
            one unit is the only number that prices a trade, so get it from your broker's
            contract specifications if it differs.
          </p>
        </div>
      {!adding && (
          <button
            type="button"
            id="instrument-add-open"
            onClick={() => startAdd('future')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/70 bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-600"
          >
            <Plus className="h-3.5 w-3.5" /> Add instrument
          </button>
        )}
      </div>

      {notice && (
        <p
          id="instrument-manager-notice"
          role="status"
          className="rounded-lg border border-zinc-700/70 bg-zinc-950/70 px-2.5 py-1.5 text-[11px] text-zinc-300"
        >
          {notice}
        </p>
      )}

      {adding && (
        <div className="space-y-3 rounded-xl border border-emerald-900/60 bg-emerald-950/10 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
              New instrument
            </span>
            <div className="flex flex-wrap gap-1">
              {INSTRUMENT_KINDS.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  id={`instrument-add-kind-${entry.kind}`}
                  onClick={() => changeKind(entry.kind)}
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                    instrumentKind(draft) === entry.kind
                      ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {fields(draft, setDraft, { prefix: 'instrument-add', kinds: false })}

          {problem && (
            <p id="instrument-add-error" role="alert" className="text-[11px] text-rose-300">
              {problem}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="instrument-add-save"
              onClick={commitAdd}
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-white"
            >
              Add to catalog
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setProblem(null);
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-zinc-800/70 rounded-xl border border-zinc-800 bg-zinc-950">
        {instruments.length === 0 && (
          <li className="px-3 py-4 text-xs text-zinc-400">
            No instruments yet. Add one above — the journal needs at least one to record a trade.
          </li>
        )}
        {instruments.map((instrument) => {
          const kind = instrumentKind(instrument);
          const editing = editingId === instrument.id;
          return (
            <li key={instrument.id} className="px-2.5 py-2.5" data-instrument-row={instrument.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-sm font-bold text-zinc-100">
                  {instrument.symbol}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                  {instrument.name}
                </span>
                <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                  {kindLabel(kind)}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-emerald-400">
                  {money(instrument.pointValue)}/pt
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                  {money(instrument.tickValue)}/tick
                </span>
                {instrument.active === false && (
                  <span className="shrink-0 rounded border border-amber-800/70 bg-amber-950/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-300">
                    off
                  </span>
                )}

                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    id={`instrument-${instrument.id}-active`}
                    onClick={() => toggleActive(instrument)}
                    className="rounded px-1.5 py-1 text-[10px] font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    {instrument.active === false ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    type="button"
                    id={`instrument-${instrument.id}-edit`}
                    onClick={() => (editing ? cancelEdit() : startEdit(instrument))}
                    aria-label={`Edit ${instrument.symbol}`}
                    title="Edit this instrument"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    id={`instrument-${instrument.id}-delete`}
                    onClick={() => remove(instrument)}
                    aria-label={`Delete ${instrument.symbol}`}
                    title="Remove from the catalog"
                    className="rounded p-1 text-zinc-500 hover:bg-rose-950/40 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {editing && editDraft && (
                <div className="mt-2 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                  {fields(editDraft, setEditDraft, { prefix: `instrument-${instrument.id}`, kinds: true })}
                  {editProblem && (
                    <p role="alert" className="text-[11px] text-rose-300">
                      {editProblem}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      id={`instrument-${instrument.id}-save`}
                      onClick={commitEdit}
                      className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-white"
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                    <span className="text-[10px] text-zinc-500">
                      Past trades keep the symbol and the point value they were recorded with.
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[10px] leading-relaxed text-zinc-500">
        Deleting an instrument is a catalog change, not a history rewrite: trades, marked levels
        and session extremes keep the symbol they were recorded with, and the coach is told when a
        trade&apos;s symbol is no longer in the catalog so it never quietly re-prices it.
      </p>
    </div>
  );
};
