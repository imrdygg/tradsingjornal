import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Plus,
  AlertCircle,
  AlertTriangle,
  Calculator,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ChevronDown,
  Info,
  Target,
} from 'lucide-react';
import {
  Trade,
  TradeDirection,
  TradingSession,
  Instrument,
  Setup,
  TradingDay,
} from '../../types';
import { calculateInitialRisk } from '../../lib/trading/calculate-risk';
import { hasAssumedRisk } from '../../lib/trading/risk-fixup';
import { calculatePnL } from '../../lib/trading/calculate-pnl';
import { calculateRMultiple } from '../../lib/trading/calculate-r';
import { findInstrument } from '../../lib/trading/instruments';
import {
  DEFAULT_RISK_TIER_AMOUNTS,
  RISK_TIER_COUNT,
  countTradesByTier,
  normalizeTierCaps,
  riskTierAmount,
  riskTierLabel,
  sizeForRisk,
} from '../../lib/trading/risk-tiers';
import { ImageUploader } from '../common/ImageUploader';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { ModalOverlay } from '../common/ModalOverlay';

interface TradeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tradeData: Partial<Trade>) => void;
  day: TradingDay;
  instruments: Instrument[];
  setups: Setup[];
  editingTrade?: Trade | null;
  /**
   * Seeds a NEW trade from partial data — used by the break-even calculator's
   * "log this add" action so a scale-in is recorded as its own entry.
   */
  prefill?: Partial<Trade> | null;
  /**
   * The trader's risk ladder — what trade #1 through #4 each risk.
   *
   * Absent falls back to the built-in ladder, so the form works before Settings has been
   * touched and in tests that do not care about the ladder.
   */
  riskTiers?: number[];
  /**
   * Every trade recorded on this day, so a slot's cap can be checked before saving.
   *
   * Absent means no cap can be checked, which is how the form still works from callers that
   * have no day list to hand.
   */
  todayTrades?: Trade[];
}

export const TradeFormModal: React.FC<TradeFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  day,
  instruments,
  setups,
  editingTrade,
  prefill,
  riskTiers = DEFAULT_RISK_TIER_AMOUNTS,
  todayTrades = [],
}) => {
  const [instrumentId, setInstrumentId] = useState('mes');
  const [direction, setDirection] = useState<TradeDirection>('long');
  const [entryPrice, setEntryPrice] = useState('');
  const [initialStop, setInitialStop] = useState('');
  const [contracts, setContracts] = useState('1');
  const [session, setSession] = useState<TradingSession>('Regular Session');
  const [setupName, setSetupName] = useState('Engulfing');
  const [entryTime, setEntryTime] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [exitTime, setExitTime] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [exitNote, setExitNote] = useState('');
  const [entryReason, setEntryReason] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  /**
   * Whether the optional half of the form is on screen.
   *
   * The five fields a trade is actually made of — entry, exit, why, note, tags — are all
   * that show by default. Instrument, contracts-by-plan, sessions, setups, the risk ladder,
   * times, the target and the charts are real features, but none of them is needed to write
   * down a trade, so they are folded away rather than deleted and stay one click from the
   * form. Reset to closed on every open so a trader is never met by a form they left long.
   */
  const [moreOptions, setMoreOptions] = useState(false);
  /**
   * Which numbered slot of the risk plan this trade is taken against.
   *
   * `null` is the custom option — the risk is then whatever the trader types. Undefined is
   * never used here; a legacy trade with no slot is edited as custom and left alone unless
   * the trader chooses otherwise.
   */
  const [riskTier, setRiskTier] = useState<number | null>(1);
  /** The dollar risk for the custom option. */
  const [customRisk, setCustomRisk] = useState('');
  /** The plan's per-slot trade caps, and how many today's trades have used. */
  const tierCaps = useMemo(() => normalizeTierCaps(day.riskTierCaps), [day.riskTierCaps]);
  const tierUsage = useMemo(
    // The trade being edited is not counted against its own slot.
    () => countTradesByTier(todayTrades, editingTrade?.id),
    [todayTrades, editingTrade?.id]
  );
  /**
   * Whether the contracts field is still following the chosen risk slot.
   *
   * A slot sizes the position from the stop distance, which is the whole point of picking
   * one. Typing a size by hand is the trader taking over, and from then on the field is
   * theirs — including through any later edit to the entry or stop.
   */
  const autoSizeRef = useRef(true);

  const selectedInstrument = useMemo(
    () => findInstrument(instruments, instrumentId),
    [instruments, instrumentId]
  );

  // Every playbook setup is selectable — active ones are listed first, but a
  // setup marked "off" in the Playbook is never hidden from a trade record.
  //
  // Otherwise the list keeps the catalog's order rather than re-sorting by name: the
  // order is the trader's, set in Settings → Playbook Setups, and it is the order they
  // pick in. Sorting alphabetically here would quietly discard that choice.
  const sortedSetups = useMemo(
    () => [...setups].sort((a, b) => Number(b.active) - Number(a.active)),
    [setups]
  );
  const setupNameIsListed = useMemo(
    () => sortedSetups.some((s) => s.name === setupName),
    [sortedSetups, setupName]
  );

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (editingTrade) {
      setInstrumentId(editingTrade.instrumentId || 'mes');
      setDirection(editingTrade.direction);
      setEntryPrice(editingTrade.entryPrice.toString());
      setInitialStop(editingTrade.initialStop.toString());
      setContracts(editingTrade.contracts.toString());
      setSession(editingTrade.session);
      setSetupName(editingTrade.setupName || 'Engulfing');
      setEntryTime(editingTrade.entryTime ? editingTrade.entryTime.slice(0, 16) : '');
      setExitPrice(editingTrade.exitPrice ? editingTrade.exitPrice.toString() : '');
      setExitTime(editingTrade.exitTime ? editingTrade.exitTime.slice(0, 16) : '');
      setTargetPrice(
        editingTrade.targetPrice !== undefined ? editingTrade.targetPrice.toString() : ''
      );
      setExitReason(editingTrade.exitReason || '');
      setExitNote(editingTrade.exitNote || '');
      setEntryReason(editingTrade.entryReason || '');
      setNotes(editingTrade.notes || '');
      setTags(editingTrade.tags ? editingTrade.tags.join(', ') : '');
      setImages(
        editingTrade.images && editingTrade.images.length > 0
          ? editingTrade.images
          : editingTrade.screenshotPath
          ? [editingTrade.screenshotPath]
          : []
      );
      // A stored slot is shown as-is. A trade recorded before the ladder existed is edited
      // as custom rather than being handed a number it never had.
      const storedTier = editingTrade.riskTier;
      setRiskTier(storedTier === undefined ? null : storedTier);
      setCustomRisk(
        (storedTier === undefined || storedTier === null) && editingTrade.plannedRisk
          ? String(editingTrade.plannedRisk)
          : ''
      );
    } else if (prefill) {
      // Pre-filled from the break-even calculator's scale-in action. The stop is
      // deliberately left as-is (usually blank) — the trader must choose the
      // level that invalidates the new, larger position.
      const now = new Date();
      const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);

      setInstrumentId(prefill.instrumentId || 'mes');
      setDirection(prefill.direction || 'long');
      setEntryPrice(prefill.entryPrice !== undefined ? prefill.entryPrice.toString() : '');
      setInitialStop(prefill.initialStop !== undefined ? prefill.initialStop.toString() : '');
      setContracts(prefill.contracts !== undefined ? prefill.contracts.toString() : '1');
      setSession(prefill.session || (day.allowedSessions?.[0] ?? 'Regular Session'));
      setSetupName(prefill.setupName || (day.watchedSetups?.[0] ?? 'Engulfing'));
      setEntryTime(prefill.entryTime ? prefill.entryTime.slice(0, 16) : localISO);
      setExitPrice('');
      setExitTime('');
      setTargetPrice(
        prefill.targetPrice !== undefined ? prefill.targetPrice.toString() : ''
      );
      setExitReason(prefill.exitReason || '');
      setExitNote(prefill.exitNote || '');
      setEntryReason(prefill.entryReason || '');
      setNotes(prefill.notes || '');
      setTags(prefill.tags ? prefill.tags.join(', ') : '');
      setImages(prefill.images && prefill.images.length > 0 ? prefill.images : []);
      // A scale-in carries no slot of its own unless the caller set one, so it inherits
      // today's default without disturbing the size the calculator worked out.
      const prefillTier = prefill.riskTier;
      setRiskTier(
        prefillTier === undefined || prefillTier === null
          ? day.defaultRiskTier ?? 1
          : prefillTier
      );
      setCustomRisk(
        (prefillTier === undefined || prefillTier === null) && prefill.plannedRisk
          ? String(prefill.plannedRisk)
          : ''
      );
    } else {
      // Defaults for fast entry (< 1 min)
      const now = new Date();
      // Format as YYYY-MM-DDTHH:mm
      const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);

      setInstrumentId('mes');
      setDirection('long');
      setEntryPrice('');
      setInitialStop('');
      setContracts(day.contractsPlanned ? day.contractsPlanned.toString() : '1');
      setSession(
        day.allowedSessions && day.allowedSessions[0]
          ? day.allowedSessions[0]
          : 'Regular Session'
      );
      setSetupName(
        day.watchedSetups && day.watchedSetups[0] ? day.watchedSetups[0] : 'Engulfing'
      );
      setEntryTime(localISO);
      setExitPrice('');
      setExitTime('');
      setTargetPrice('');
      setExitReason('');
      setExitNote('');
      setEntryReason('');
      setNotes('');
      setTags('');
      setImages([]);
      // Opens on the day's default slot, so a recorded trade always has a risk attached.
      setRiskTier(day.defaultRiskTier ?? 1);
      setCustomRisk('');
    }
    setPreviewIndex(null);
    setError('');
    // Every open starts from the five fields, whatever was expanded last time.
    setMoreOptions(false);
    // Only a fresh, hand-entered trade has its size derived from its slot. An edit keeps
    // the size that was actually filled, and a scale-in keeps the calculator's size.
    autoSizeRef.current = !editingTrade && !prefill;
  }, [isOpen, editingTrade, prefill, day]);

  // Live Calculations Preview
  const calculations = useMemo(() => {
    const entry = parseFloat(entryPrice);
    const qty = parseInt(contracts, 10);
    //
    // The stop is optional. Without one there is no risk figure to record and no R to
    // divide by — but the fills, and the P&L they produce, are still worth showing while
    // the trade is being typed in, so they are computed either way.
    const hasStop = initialStop.trim() !== '' && !isNaN(parseFloat(initialStop));
    const stop = hasStop ? parseFloat(initialStop) : NaN;

    if (isNaN(entry) || isNaN(qty) || qty <= 0) {
      return null;
    }

    // A stop sitting on the entry is not a stop: it prices no risk, so it is treated as
    // no stop at all rather than as a confident zero.
    const riskKnown = hasStop && entry !== stop;

    const initialRisk = riskKnown
      ? calculateInitialRisk({
          entryPrice: entry,
          stopPrice: stop,
          contracts: qty,
          instrument: selectedInstrument,
        })
      : 0;

    const stopDistance = riskKnown ? Math.round(Math.abs(entry - stop) * 100) / 100 : null;

    const exit = parseFloat(exitPrice);
    let pnlResult = null;
    let rMultiple: number | null = null;

    if (!isNaN(exit) && exit > 0) {
      pnlResult = calculatePnL({
        direction,
        entryPrice: entry,
        exitPrice: exit,
        contracts: qty,
        instrument: selectedInstrument,
      });

      rMultiple = riskKnown ? calculateRMultiple(pnlResult.grossPnL, initialRisk) : null;
    }

    // The planned exit, measured in the same R units as the actual one, so a target can
    // be judged before the trade is over: a target 1R out is a different trade from one
    // 3R out, and the form should say which this is while the plan is still being set.
    const targetExit = parseFloat(targetPrice);
    let targetR: number | null = null;

    if (riskKnown && !isNaN(targetExit) && targetExit > 0 && targetExit !== entry) {
      const targetPnL = calculatePnL({
        direction,
        entryPrice: entry,
        exitPrice: targetExit,
        contracts: qty,
        instrument: selectedInstrument,
      });
      targetR = calculateRMultiple(targetPnL.grossPnL, initialRisk);
    }

    return {
      riskKnown,
      initialRisk,
      stopDistance,
      pnlResult,
      rMultiple,
      targetR,
      /** What the actual exit was worth against the target, in R. */
      targetGapR: rMultiple !== null && targetR !== null ? rMultiple - targetR : null,
    };
  }, [
    entryPrice,
    initialStop,
    contracts,
    exitPrice,
    targetPrice,
    direction,
    selectedInstrument,
  ]);

  /** The dollar risk the chosen slot commits to, or null while the custom amount is blank. */
  const targetRisk = useMemo(() => {
    if (riskTier !== null) return riskTierAmount(riskTier, riskTiers);
    const parsed = parseFloat(customRisk);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
  }, [riskTier, customRisk, riskTiers]);

  /** The size this slot needs at the stop distance entered, when both are known. */
  const sizing = useMemo(() => {
    if (targetRisk === null) return null;
    const entry = parseFloat(entryPrice);
    const stop = parseFloat(initialStop);
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry === stop) return null;
    return sizeForRisk({
      risk: targetRisk,
      entryPrice: entry,
      stopPrice: stop,
      pointValue: selectedInstrument.pointValue,
    });
  }, [targetRisk, entryPrice, initialStop, selectedInstrument.pointValue]);

  // Sizes the position to the chosen slot as the numbers are typed. `autoSizeRef` is
  // cleared by the contracts field itself, so a size typed by hand is never overwritten.
  useEffect(() => {
    if (!autoSizeRef.current || !sizing) return;
    setContracts(String(sizing.contracts));
  }, [sizing, isOpen]);

  /**
   * Picking a slot with 1–4 (or 0 / C for custom) while the modal is open.
   *
   * Keystrokes inside a field are left alone: the entry price and stop are full of digits,
   * and hijacking them would make the form unusable. This only fires when focus is on the
   * form itself, which is where it lands after the entry price is typed.
   */
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= RISK_TIER_COUNT) {
        autoSizeRef.current = true;
        setRiskTier(digit);
        return;
      }
      if (event.key === '0' || event.key.toLowerCase() === 'c') {
        autoSizeRef.current = true;
        setRiskTier(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  // The chosen slot's cap, and what the day has already spent on it.
  const activeCap = riskTier !== null ? tierCaps[riskTier - 1] : 0;
  const activeUsage = riskTier !== null ? tierUsage[riskTier - 1] : 0;
  const overCap = riskTier !== null && activeCap > 0 && activeUsage >= activeCap;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const entry = parseFloat(entryPrice);
    const qty = parseInt(contracts, 10);
    //
    // The stop is optional. A trade without one records its fills and nothing about risk,
    // which is the honest thing to store when the trader never gave a level to lose at —
    // the alternative is inventing a stop, and every risk statistic downstream would then
    // be fiction. The entry price stands in for it so the record still has a number there.
    const stopEntered = initialStop.trim() !== '';
    const stop = stopEntered ? parseFloat(initialStop) : entry;
    const riskKnown = stopEntered && entry !== stop;

    if (isNaN(entry) || entry <= 0) {
      setError('Entry price must be a valid positive number.');
      return;
    }

    if (stopEntered && (isNaN(stop) || stop <= 0)) {
      setError('Initial stop must be a valid positive number, or left blank.');
      return;
    }

    if (stopEntered && entry === stop) {
      setError('Initial stop price cannot equal entry price.');
      return;
    }

    if (isNaN(qty) || qty <= 0) {
      setError('Contracts count must be at least 1.');
      return;
    }

    if (!entryTime) {
      setError('Entry date and time is required.');
      return;
    }

    // A new trade that records a stop must say which risk slot it belongs to. An edit is
    // allowed to leave a pre-ladder trade alone rather than forcing a number onto it, and
    // a trade with no stop has no risk for a slot to describe.
    if (!editingTrade && riskKnown && targetRisk === null) {
      setError('Pick a Trade # for this trade, or enter the custom risk amount.');
      return;
    }

    const exit = exitPrice.trim() ? parseFloat(exitPrice) : undefined;
    if (exit !== undefined && (isNaN(exit) || exit <= 0)) {
      setError('Exit price must be a valid positive number.');
      return;
    }

    const target = targetPrice.trim() ? parseFloat(targetPrice) : undefined;
    if (target !== undefined && (isNaN(target) || target <= 0)) {
      setError('Target price must be a valid positive number.');
      return;
    }

    if (exitTime && entryTime) {
      const entryDate = new Date(entryTime).getTime();
      const exitDate = new Date(exitTime).getTime();
      if (exitDate < entryDate) {
        setError('Exit time cannot precede entry time.');
        return;
      }
    }

    const initialRisk = riskKnown
      ? calculateInitialRisk({
          entryPrice: entry,
          stopPrice: stop,
          contracts: qty,
          instrument: selectedInstrument,
        })
      : 0;

    let grossPnL = 0;
    let pointsPnL = 0;
    let rMultiple = 0;
    const isClosed = exit !== undefined;

    if (isClosed && exit !== undefined) {
      const res = calculatePnL({
        direction,
        entryPrice: entry,
        exitPrice: exit,
        contracts: qty,
        instrument: selectedInstrument,
      });
      grossPnL = res.grossPnL;
      pointsPnL = res.pointsPnL;
      rMultiple = calculateRMultiple(grossPnL, initialRisk);
    }

    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    onSave({
      instrumentId: selectedInstrument.id,
      direction,
      contracts: qty,
      entryPrice: entry,
      initialStop: stop,
      exitPrice: exit,
      entryTime: new Date(entryTime).toISOString(),
      exitTime: exitTime ? new Date(exitTime).toISOString() : undefined,
      session,
      setupName,
      entryReason: entryReason.trim() || undefined,
      targetPrice: target,
      exitReason: exitReason.trim() || undefined,
      exitNote: exitNote.trim() || undefined,
      notes: notes.trim() || undefined,
      tags: parsedTags.length ? parsedTags : undefined,
      initialRisk,
      // The slot this trade was taken against, and the risk it committed to. Null is the
      // custom option; undefined is left only for a pre-ladder trade being edited. With no
      // stop there is nothing measured, so the slot is left off entirely: a planned amount
      // beside a risk of zero would read as a plan that was followed.
      riskTier: !riskKnown
        ? undefined
        : riskTier === null && targetRisk === null && editingTrade?.riskTier === undefined
        ? undefined
        : riskTier,
      plannedRisk: riskKnown ? targetRisk ?? undefined : undefined,
      grossPnL,
      pointsPnL,
      rMultiple,
      status: isClosed ? 'closed' : 'open',
      // Carries the scale-in link through save so the legs stay grouped.
      positionId: prefill?.positionId ?? editingTrade?.positionId,
      // Saving a changed stop is the trader supplying the real one. Saving without
      // touching it leaves an imported placeholder marked as a placeholder, so an
      // unrelated edit (a note, a tag) cannot launder invented risk into real risk.
      riskSource:
        editingTrade && hasAssumedRisk(editingTrade) && editingTrade.initialStop === stop
          ? 'assumed'
          : 'recorded',
      images: images.length > 0 ? images : undefined,
      screenshotPath: images[0] || undefined,
    });

    onClose();
  };

  return (
    <ModalOverlay
      onRequestClose={onClose}
      label={editingTrade ? 'Edit trade execution' : 'Record futures trade'}
    >
      <div className="relative my-6 w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold text-zinc-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-zinc-300" />
              {editingTrade ? 'Edit Trade' : 'Log a Trade'}
            </h3>
            <span className="hidden text-[10px] font-mono text-zinc-500 sm:inline">
              entry · exit · why · note · tags
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-800/80 bg-rose-950/40 p-3 text-xs text-rose-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Scale-in context: this is a second entry, not an edit. */}
          {prefill && !editingTrade && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-900/70 bg-emerald-950/30 p-3 text-xs text-emerald-200">
              <Info className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span className="leading-relaxed">
                Pre-filled from the break-even calculator as a{' '}
                <strong>separate open trade</strong>. Check the entry price and set the{' '}
                <strong>initial stop</strong> for this add before saving.
              </span>
            </div>
          )}

          {/*
            Direction is the one thing about an entry that cannot be defaulted: it decides
            which side the P&L falls on. Everything else on this form has a sensible value
            already, so the trader only has to spell out what they alone know.
          */}
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Direction</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-950 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => setDirection('long')}
                className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  direction === 'long'
                    ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" /> Long
              </button>
              <button
                type="button"
                onClick={() => setDirection('short')}
                className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  direction === 'short'
                    ? 'bg-rose-950/90 text-rose-300 border border-rose-800 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <ArrowDownRight className="w-3.5 h-3.5" /> Short
              </button>
            </div>
          </div>

          {/*
            The optional half of the form.

            Every field below this toggle is a real feature — the instrument, the plan's
            risk slot, sessions, setups, the target, the charts — but none of them is needed
            to write a trade down. They are folded, not removed, so the form opens as the five
            things a trade is, and the depth is still one click away for the days it is wanted.
          */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <span className="text-[11px] leading-relaxed text-zinc-500">
              Optional, for the days you want them: the instrument, your plan's risk slot,
              the timing, the target and your charts.
            </span>
            <button
              type="button"
              id="trade-more-options-toggle"
              onClick={() => setMoreOptions((open) => !open)}
              aria-expanded={moreOptions}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${moreOptions ? '' : '-rotate-90'}`}
              />
              More options
            </button>
          </div>

          {/* Which market — only worth changing when it is not the day's primary. */}
          {moreOptions && (
            <div>
              <label
                htmlFor="trade-instrument-select"
                className="text-xs font-medium text-zinc-300 block mb-1"
              >
                Instrument
              </label>
              <select
                id="trade-instrument-select"
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                {instruments.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.symbol} — {inst.name} (${inst.pointValue}/pt)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Trade # — the numbered risk slot this trade is taken against. */}
          {moreOptions && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-300">
                Trade # <span className="text-rose-400">*</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                risk per trade · press 1–4, 0 for custom
              </span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {riskTiers.map((amount, index) => {
                const tier = index + 1;
                const isSelected = riskTier === tier;
                const cap = tierCaps[index];
                const used = tierUsage[index];
                const atCap = cap > 0 && used >= cap;
                return (
                  <button
                    key={tier}
                    type="button"
                    data-testid={`trade-risk-tier-${tier}`}
                    aria-pressed={isSelected}
                    title={`Press ${tier} to pick this slot`}
                    onClick={() => {
                      autoSizeRef.current = true;
                      setRiskTier(tier);
                    }}
                    className={`flex flex-col items-center rounded-lg border px-2 py-1.5 transition-all ${
                      isSelected
                        ? 'border-emerald-700 bg-emerald-950/50 text-emerald-200'
                        : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span className="text-[10px] font-mono uppercase tracking-wider">
                      #{tier}
                    </span>
                    <span className="text-xs font-bold font-mono">${amount}</span>
                    {cap > 0 && (
                      <span
                        data-testid={`trade-tier-usage-${tier}`}
                        className={`text-[9px] font-mono ${atCap ? 'text-amber-300' : 'text-zinc-500'}`}
                      >
                        {used}/{cap}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                data-testid="trade-risk-tier-custom"
                aria-pressed={riskTier === null}
                onClick={() => {
                  autoSizeRef.current = true;
                  setRiskTier(null);
                }}
                className={`flex flex-col items-center rounded-lg border px-2 py-1.5 transition-all ${
                  riskTier === null
                    ? 'border-amber-700 bg-amber-950/50 text-amber-200'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="text-[10px] font-mono uppercase tracking-wider">custom</span>
                <span className="text-xs font-bold font-mono">$?</span>
              </button>
            </div>

            {/*
              The plan's cap for the chosen slot, said plainly. It warns rather than
              blocks: a form that refuses a trade is one the trader works around, and a
              trade recorded past its cap is exactly the evidence this journal is for.
            */}
            {overCap && (
              <p
                data-testid="trade-risk-cap-warning"
                role="alert"
                className="flex items-start gap-1.5 rounded-lg border border-amber-800/70 bg-amber-950/40 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                <span>
                  Trade #{riskTier} is capped at {activeCap} for today and {activeUsage}{' '}
                  {activeUsage === 1 ? 'trade already uses' : 'trades already use'} it
                  {editingTrade ? ' (not counting this one)' : ''} — this would be number{' '}
                  {activeUsage + 1}. It is still recorded; the plan is what you are breaking.
                </span>
              </p>
            )}

            {riskTier === null && (
              <input
                id="trade-custom-risk"
                type="number"
                min="1"
                // Any amount, deliberately. A fixed step would make the browser reject
                // perfectly good risks — `min="1" step="5"` refuses $40 — and the form
                // would silently refuse to save with no error to explain why.
                step="any"
                placeholder="Custom risk ($) — e.g. 40"
                value={customRisk}
                onChange={(e) => {
                  autoSizeRef.current = true;
                  setCustomRisk(e.target.value);
                }}
                className="w-full rounded-xl border border-amber-900/70 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
              />
            )}

            {/*
              What the slot actually costs at the stop distance entered. Futures trade in
              whole contracts, so the target is often unreachable exactly; saying so here
              is the difference between a plan and a number the trader cannot take.
            */}
            {targetRisk !== null &&
              (sizing ? (
                <p
                  data-testid="trade-risk-sizing"
                  className={`text-[10px] font-mono leading-relaxed ${
                    sizing.rounded ? 'text-amber-300' : 'text-emerald-300'
                  }`}
                >
                  {sizing.rounded
                    ? `Closest size to ${riskTierLabel(
                        riskTier,
                        targetRisk,
                        riskTiers
                      )}: ${sizing.contracts} @ ${sizing.stopPoints}pt stop risks $${sizing.actualRisk.toFixed(
                        2
                      )} ($${sizing.riskPerContract.toFixed(2)}/contract).`
                    : `${riskTierLabel(
                        riskTier,
                        targetRisk,
                        riskTiers
                      )}: ${sizing.contracts} @ ${sizing.stopPoints}pt stop risks $${sizing.actualRisk.toFixed(
                        2
                      )} exactly.`}
                </p>
              ) : (
                <p className="text-[10px] font-mono text-zinc-500">
                  Enter the entry and stop and the size will be set for{' '}
                  {riskTierLabel(riskTier, targetRisk, riskTiers)}.
                </p>
              ))}
          </div>
          )}

          {/*
            Entry. Price, size and stop are one subject, so they sit under one heading with
            the reason and the note — the trader is answering "what did I take" once, rather
            than hunting for the reason field at the bottom of the form.
          */}
          <div className="flex flex-wrap items-baseline gap-x-2 pt-2 border-t border-zinc-800/80">
            <span className="text-xs font-semibold text-emerald-400/90 uppercase tracking-wider font-mono">
              Entry
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">price · size · stop · why</span>
          </div>

          {/* Row 2: Entry Price, Initial Stop, Contracts */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="trade-entry-price"
                className="text-xs font-medium text-zinc-300 block mb-1"
              >
                Entry Price <span className="text-rose-400">*</span>
              </label>
              <input
                id="trade-entry-price"
                type="number"
                step="0.25"
                placeholder="6702.25"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                required
              />
            </div>

            <div>
              <label
                htmlFor="trade-initial-stop"
                className="text-xs font-medium text-zinc-300 block mb-1 flex items-center justify-between"
              >
                <span>Stop</span>
                <span className="text-[10px] font-normal text-zinc-500">optional</span>
              </label>
              <input
                id="trade-initial-stop"
                type="number"
                step="0.25"
                placeholder="6692.25"
                value={initialStop}
                onChange={(e) => setInitialStop(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="trade-contracts"
                className="text-xs font-medium text-zinc-300 block mb-1"
              >
                Contracts <span className="text-rose-400">*</span>
              </label>
              <input
                id="trade-contracts"
                type="number"
                min="1"
                max="50"
                value={contracts}
                onChange={(e) => {
                  // The trader is taking the size over by hand; stop deriving it.
                  autoSizeRef.current = false;
                  setContracts(e.target.value);
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Row 3: Session & Setup */}
          {moreOptions && (
          <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Session</label>
              <select
                value={session}
                onChange={(e) => setSession(e.target.value as TradingSession)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                <option value="Overnight">Overnight</option>
                <option value="Premarket">Premarket</option>
                <option value="Regular Session">Regular Session</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="trade-setup-select"
                className="text-xs font-medium text-zinc-300 block mb-1"
              >
                Setup{' '}
                <span className="text-[10px] font-normal text-zinc-500 font-mono">
                  ({sortedSetups.length} in playbook)
                </span>
              </label>
              <select
                id="trade-setup-select"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                {/* Keep an unlisted current value visible instead of blank. */}
                {!setupNameIsListed && setupName && (
                  <option value={setupName}>{setupName}</option>
                )}
                {sortedSetups.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                    {s.active ? '' : ' — off'}
                  </option>
                ))}
                {sortedSetups.length === 0 && (
                  <option value="">No setups yet — add one in the Playbook</option>
                )}
              </select>
            </div>
          </div>

          {/* Row 4: Entry Time */}
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              <span>Entry Date / Time</span> <span className="text-rose-400">*</span>
            </label>
            <input
              id="trade-entry-time"
              type="datetime-local"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              required
            />
          </div>
          </>
          )}

          <div>
            <label
              htmlFor="trade-entry-reason"
              className="text-xs font-medium text-zinc-300 block mb-1"
            >
              Why
            </label>
            <input
              id="trade-entry-reason"
              type="text"
              placeholder="What made you take it?"
              value={entryReason}
              onChange={(e) => setEntryReason(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="trade-entry-note"
              className="text-xs font-medium text-zinc-300 block mb-1"
            >
              Note
            </label>
            <textarea
              id="trade-entry-note"
              rows={2}
              placeholder="Anything else worth remembering — what you saw, how you felt"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* Live Calculations Preview Card */}
          {calculations && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-xs space-y-1 font-mono">
              <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] uppercase font-semibold">
                <Calculator className="w-3.5 h-3.5 text-zinc-300" />
                Live {selectedInstrument.symbol} Calculation
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-zinc-300">
                <div>
                  <span className="text-zinc-500 block text-[10px]">Stop Distance</span>
                  <span>
                    {calculations.stopDistance !== null
                      ? `${calculations.stopDistance} pts`
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">Initial Risk</span>
                  <span className="font-bold text-rose-300">
                    {calculations.riskKnown ? `$${calculations.initialRisk.toFixed(2)}` : '—'}
                  </span>
                </div>
                {calculations.pnlResult && (
                  <>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">Gross P&L</span>
                      <span
                        className={`font-bold ${
                          calculations.pnlResult.grossPnL > 0
                            ? 'text-emerald-400'
                            : calculations.pnlResult.grossPnL < 0
                            ? 'text-rose-400'
                            : 'text-zinc-300'
                        }`}
                      >
                        {calculations.pnlResult.grossPnL > 0 ? '+' : ''}$
                        {calculations.pnlResult.grossPnL.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">R Multiple</span>
                      <span className="font-bold text-zinc-200">
                        {calculations.rMultiple === null
                          ? '—'
                          : `${calculations.rMultiple > 0 ? '+' : ''}${calculations.rMultiple.toFixed(
                              2
                            )}R`}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/*
                Said once, plainly: the stop is what makes risk and R exist, and a trade
                without one is still a complete record of the fills.
              */}
              {!calculations.riskKnown && (
                <p className="pt-1.5 mt-1 border-t border-zinc-800/60 text-[11px] text-zinc-500">
                  Add a stop to record risk and R. The fills stand on their own without one.
                </p>
              )}

              {/*
                The planned exit measured in R, beside what the trade actually did. A target
                is only meaningful against the risk being taken, and the gap says at a glance
                whether the exit met the plan or left R on the table.
              */}
              {calculations.targetR !== null && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 mt-1 border-t border-zinc-800/60 text-[11px]">
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Target className="w-3 h-3 shrink-0 text-zinc-300" />
                    Target {targetPrice} ={' '}
                    <span
                      className={
                        calculations.targetR > 0
                          ? 'text-emerald-300'
                          : calculations.targetR < 0
                          ? 'text-rose-300'
                          : 'text-zinc-200'
                      }
                    >
                      {calculations.targetR > 0 ? '+' : ''}
                      {calculations.targetR.toFixed(2)}R
                    </span>
                  </span>

                  {calculations.rMultiple !== null && calculations.targetGapR !== null && (
                    <span className="text-zinc-400">
                      Exit {exitPrice} ={' '}
                      <span
                        className={
                          calculations.rMultiple > 0
                            ? 'text-emerald-300'
                            : calculations.rMultiple < 0
                            ? 'text-rose-300'
                            : 'text-zinc-200'
                        }
                      >
                        {calculations.rMultiple > 0 ? '+' : ''}
                        {calculations.rMultiple.toFixed(2)}R
                      </span>{' '}
                      ·{' '}
                      <span
                        className={
                          calculations.targetGapR >= 0 ? 'text-emerald-400' : 'text-amber-300'
                        }
                      >
                        {calculations.targetGapR >= 0
                          ? `${calculations.targetGapR.toFixed(2)}R past target`
                          : `${Math.abs(calculations.targetGapR).toFixed(2)}R short of target`}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/*
            Exit. The fill is the one thing worth asking for — a trade with an exit price is a
            closed trade. The target and the timing are plan detail, so they live with the rest
            of the optional fields; the fill is left blank while the trade is still running.
          */}
          <div className="flex flex-wrap items-baseline gap-x-2 pt-2 border-t border-zinc-800/80">
            <span className="text-xs font-semibold text-amber-400/90 uppercase tracking-wider font-mono">
              Exit
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              leave it blank while the trade is still open
            </span>
          </div>

          <div>
            <label
              htmlFor="trade-exit-price"
              className="text-xs font-medium text-zinc-300 block mb-1"
            >
              Exit Price
            </label>
            <input
              id="trade-exit-price"
              type="number"
              step="0.25"
              placeholder="6732.25"
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {moreOptions && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="trade-target-price"
                    className="text-xs font-medium text-zinc-300 block mb-1"
                  >
                    Target Price
                  </label>
                  <input
                    id="trade-target-price"
                    type="number"
                    step="0.25"
                    placeholder="6742.25"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-300 block mb-1">
                    Exit Date / Time
                  </label>
                  <input
                    id="trade-exit-time"
                    type="datetime-local"
                    value={exitTime}
                    onChange={(e) => setExitTime(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="trade-exit-reason"
                  className="text-xs font-medium text-zinc-300 block mb-1"
                >
                  Exit Reason
                </label>
                <input
                  id="trade-exit-reason"
                  type="text"
                  placeholder="e.g. Hit the target into resistance and momentum stalled"
                  value={exitReason}
                  onChange={(e) => setExitReason(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="trade-exit-note"
                  className="text-xs font-medium text-zinc-300 block mb-1"
                >
                  Exit Note
                </label>
                <textarea
                  id="trade-exit-note"
                  rows={2}
                  placeholder="Anything else about getting out — what you saw, what you would do differently"
                  value={exitNote}
                  onChange={(e) => setExitNote(e.target.value)}
                  className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Tags belong to the trade as a whole, so they are shared, not split by subject. */}
          <div className="pt-2 border-t border-zinc-800/80">
            <label
              htmlFor="trade-tags"
              className="text-xs font-medium text-zinc-300 block mb-1"
            >
              Tags{' '}
              <span className="text-[10px] font-normal text-zinc-500 font-mono">
                (comma separated)
              </span>
            </label>
            <input
              id="trade-tags"
              type="text"
              placeholder="clean, morning, trend-aligned"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/*
            Chart Screenshot Attachments — optional, and hidden with the rest of the depth.
            Images already on the trade are held in state regardless, so folding this away
            and saving never drops a chart.
          */}
          {moreOptions && (
            <div className="pt-2 border-t border-zinc-800/80">
              <ImageUploader
                images={images}
                onChange={setImages}
                onPreviewImage={(idx) => setPreviewIndex(idx)}
                maxImages={6}
                label="Trade Charts & Video"
                helperText="Attach entry chart setup, execution context or result screenshots — or a quick 30-60 second clip of the trade."
                idPrefix="trade-modal-images"
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 px-5 py-2 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {editingTrade ? 'Update Trade' : exitPrice ? 'Save Completed Trade' : 'Save Open Trade'}
            </button>
          </div>
        </form>
      </div>

      {/* Full-size Image Lightbox */}
      <ImageLightboxModal
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        images={images}
        initialIndex={previewIndex !== null ? previewIndex : 0}
        title={`${direction.toUpperCase()} ${selectedInstrument.symbol} @ ${
          entryPrice || 'Trade'
        } Chart`}
        subtitle={`${session} • ${setupName || 'Setup'}`}
      />
    </ModalOverlay>
  );
};
