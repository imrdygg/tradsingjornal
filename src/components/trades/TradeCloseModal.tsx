import React, { useState, useMemo, useEffect } from 'react';
import { X, Check, Calculator, AlertCircle, ShieldCheck, Calendar } from 'lucide-react';
import {
  Trade,
  TradeExecutionReview,
  TradeManagement,
  QuestionAnswer,
  TrailingMethod,
  Instrument,
} from '../../types';
import { calculatePnL } from '../../lib/trading/calculate-pnl';
import { calculateRMultiple } from '../../lib/trading/calculate-r';
import { findInstrument } from '../../lib/trading/instruments';
import { ImageUploader } from '../common/ImageUploader';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { ModalOverlay } from '../common/ModalOverlay';

interface TradeCloseModalProps {
  isOpen: boolean;
  onClose: () => void;
  trade: Trade | null;
  instruments: Instrument[];
  onConfirmClose: (
    tradeId: string,
    exitData: {
      exitPrice: number;
      exitTime: string;
      pointsPnL: number;
      grossPnL: number;
      rMultiple: number;
      executionReview: TradeExecutionReview;
      tradeManagement?: TradeManagement;
      images?: string[];
    }
  ) => void;
}

export const TradeCloseModal: React.FC<TradeCloseModalProps> = ({
  isOpen,
  onClose,
  trade,
  instruments,
  onConfirmClose,
}) => {
  const [exitPrice, setExitPrice] = useState('');
  const [exitTime, setExitTime] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  });

  // Execution Review Questions
  const [followedSetup, setFollowedSetup] = useState<QuestionAnswer>('yes');
  const [followedStop, setFollowedStop] = useState<QuestionAnswer>('yes');
  const [chasedEntry, setChasedEntry] = useState<QuestionAnswer>('no');
  const [revengeTrade, setRevengeTrade] = useState<QuestionAnswer>('no');
  const [addedUnnecessaryRisk, setAddedUnnecessaryRisk] = useState<QuestionAnswer>('no');
  const [movedStopEmotion, setMovedStopEmotion] = useState<QuestionAnswer>('no');
  const [letWinnerWork, setLetWinnerWork] = useState<QuestionAnswer>('yes');
  const [wouldTakeAgain, setWouldTakeAgain] = useState<QuestionAnswer>('yes');

  // Profit Management Tracking
  const [trailingMethod, setTrailingMethod] = useState<TrailingMethod>('None');
  const [breakevenPrice, setBreakevenPrice] = useState('');
  const [profitSecured, setProfitSecured] = useState('');
  const [managementNotes, setManagementNotes] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState('');

  // Sync images and defaults when trade opens
  useEffect(() => {
    if (isOpen && trade) {
      setImages(
        trade.images && trade.images.length > 0
          ? trade.images
          : trade.screenshotPath
          ? [trade.screenshotPath]
          : []
      );
      setPreviewIndex(null);
    }
  }, [isOpen, trade]);

  const instrument = useMemo(() => {
    if (!trade) return instruments[0];
    return findInstrument(instruments, trade.instrumentId);
  }, [trade, instruments]);

  // Calculations
  const calculations = useMemo(() => {
    if (!trade) return null;
    const exit = parseFloat(exitPrice);
    if (isNaN(exit) || exit <= 0) return null;

    const pnl = calculatePnL({
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: exit,
      contracts: trade.contracts,
      instrument,
    });

    const rMultiple = calculateRMultiple(pnl.grossPnL, trade.initialRisk);

    let durationStr = '—';
    if (exitTime && trade.entryTime) {
      try {
        const start = new Date(trade.entryTime).getTime();
        const end = new Date(exitTime).getTime();
        const diffMinutes = Math.round((end - start) / (1000 * 60));
        if (diffMinutes < 60) {
          durationStr = `${diffMinutes} mins`;
        } else {
          durationStr = `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;
        }
      } catch {
        durationStr = '—';
      }
    }

    return {
      points: pnl.pointsPnL,
      grossPnL: pnl.grossPnL,
      rMultiple,
      durationStr,
    };
  }, [trade, exitPrice, exitTime, instrument]);

  if (!isOpen || !trade) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const exit = parseFloat(exitPrice);
    if (isNaN(exit) || exit <= 0) {
      setError('Please provide a valid exit price.');
      return;
    }

    if (exitTime && trade.entryTime) {
      const entryDate = new Date(trade.entryTime).getTime();
      const exitDate = new Date(exitTime).getTime();
      if (exitDate < entryDate) {
        setError('Exit time cannot precede entry time.');
        return;
      }
    }

    const pnl = calculatePnL({
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: exit,
      contracts: trade.contracts,
      instrument,
    });

    const rMultiple = calculateRMultiple(pnl.grossPnL, trade.initialRisk);

    const executionReview: TradeExecutionReview = {
      id: `rev-${Date.now()}`,
      tradeId: trade.id,
      followedSetup,
      followedStop,
      chasedEntry,
      revengeTrade,
      addedUnnecessaryRisk,
      movedStopEmotion,
      letWinnerWork,
      wouldTakeAgain,
    };

    let tradeManagement: TradeManagement | undefined = undefined;
    if (
      trailingMethod !== 'None' ||
      breakevenPrice ||
      profitSecured ||
      managementNotes
    ) {
      tradeManagement = {
        id: `tm-${Date.now()}`,
        tradeId: trade.id,
        trailingMethod,
        breakevenPrice: breakevenPrice ? parseFloat(breakevenPrice) : undefined,
        profitSecured: profitSecured ? parseFloat(profitSecured) : undefined,
        notes: managementNotes.trim() || undefined,
      };
    }

    onConfirmClose(trade.id, {
      exitPrice: exit,
      exitTime: new Date(exitTime).toISOString(),
      pointsPnL: pnl.pointsPnL,
      grossPnL: pnl.grossPnL,
      rMultiple,
      executionReview,
      tradeManagement,
      images: images.length > 0 ? images : undefined,
    });

    onClose();
  };

  const renderQuestionButtons = (
    value: QuestionAnswer,
    setter: (val: QuestionAnswer) => void
  ) => {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-zinc-950 p-1 border border-zinc-800">
        {(['yes', 'no', 'na'] as QuestionAnswer[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setter(opt)}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold uppercase transition-all ${
              value === opt
                ? opt === 'yes'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : opt === 'no'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                  : 'bg-zinc-800 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {opt === 'na' ? 'N/A' : opt}
          </button>
        ))}
      </div>
    );
  };

  return (
    <ModalOverlay>
      <div className="relative my-6 w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              Close Trade & Execution Review
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              {trade.direction.toUpperCase()} {trade.contracts}x {instrument.symbol} @{' '}
              {trade.entryPrice.toFixed(2)} (Stop: {trade.initialStop.toFixed(2)})
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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

          {/* Exit Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">
                Exit Price <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="0.25"
                placeholder="6732.25"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>Exit Time</span> <span className="text-rose-400">*</span>
              </label>
              <input
                type="datetime-local"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Live Outcome Calculations */}
          {calculations && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
              <div className="flex items-center gap-1.5 text-zinc-400 text-[11px] uppercase font-semibold mb-2">
                <Calculator className="w-3.5 h-3.5 text-zinc-300" />
                Outcome Calculations
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <span className="text-zinc-500 block text-[10px]">Points</span>
                  <span className="font-bold text-zinc-200">
                    {calculations.points > 0 ? '+' : ''}
                    {calculations.points.toFixed(2)} pts
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">Realized P&L</span>
                  <span
                    className={`font-bold ${
                      calculations.grossPnL > 0
                        ? 'text-emerald-400'
                        : calculations.grossPnL < 0
                        ? 'text-rose-400'
                        : 'text-zinc-200'
                    }`}
                  >
                    {calculations.grossPnL > 0 ? '+' : ''}$
                    {calculations.grossPnL.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">R Multiple</span>
                  <span className="font-bold text-zinc-200">
                    {calculations.rMultiple > 0 ? '+' : ''}
                    {calculations.rMultiple.toFixed(2)}R
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[10px]">Duration</span>
                  <span className="text-zinc-300">{calculations.durationStr}</span>
                </div>
              </div>
            </div>
          )}

          {/* Quick Execution Review Questions (Yes / No / N/A) */}
          <div className="pt-2 border-t border-zinc-800 space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-zinc-300" />
              Quick Execution Review
            </h4>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Followed setup?</span>
                {renderQuestionButtons(followedSetup, setFollowedSetup)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Followed initial stop?</span>
                {renderQuestionButtons(followedStop, setFollowedStop)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Chased entry?</span>
                {renderQuestionButtons(chasedEntry, setChasedEntry)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Revenge traded?</span>
                {renderQuestionButtons(revengeTrade, setRevengeTrade)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Added unnecessary risk?</span>
                {renderQuestionButtons(addedUnnecessaryRisk, setAddedUnnecessaryRisk)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Moved stop because of emotion?</span>
                {renderQuestionButtons(movedStopEmotion, setMovedStopEmotion)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Let winner work?</span>
                {renderQuestionButtons(letWinnerWork, setLetWinnerWork)}
              </div>

              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-zinc-300">Would take this setup again?</span>
                {renderQuestionButtons(wouldTakeAgain, setWouldTakeAgain)}
              </div>
            </div>
          </div>

          {/* Optional Profit-Management Tracking */}
          <div className="pt-2 border-t border-zinc-800 space-y-3">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider font-mono block">
              Optional Profit Management
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Trailing Method</label>
                <select
                  value={trailingMethod}
                  onChange={(e) => setTrailingMethod(e.target.value as TrailingMethod)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100"
                >
                  <option value="None">None</option>
                  <option value="Manual">Manual</option>
                  <option value="Structure">Structure</option>
                  <option value="Fixed Points">Fixed Points</option>
                  <option value="Moving Average">Moving Average</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Breakeven Price</label>
                <input
                  type="number"
                  step="0.25"
                  placeholder="e.g. 6705.25"
                  value={breakevenPrice}
                  onChange={(e) => setBreakevenPrice(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-100"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Profit Secured ($)</label>
                <input
                  type="number"
                  step="5"
                  placeholder="e.g. 75"
                  value={profitSecured}
                  onChange={(e) => setProfitSecured(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-100"
                />
              </div>
            </div>

            {/* Exit / Result Chart Screenshots */}
            <div className="pt-2 border-t border-zinc-800/80">
              <ImageUploader
                images={images}
                onChange={setImages}
                onPreviewImage={(idx) => setPreviewIndex(idx)}
                maxImages={6}
                label="Result Charts & Video"
                helperText="Attach exit chart, execution notes or P&L screenshots — or a quick clip of how the exit played out."
                idPrefix="trade-close-images"
              />
            </div>
          </div>

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
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-5 py-2 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Complete Trade & Save Review
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
        title={
          trade ? `${trade.direction.toUpperCase()} ${instrument.symbol} Result Chart` : 'Trade Chart'
        }
        subtitle={trade ? `${trade.setupName || 'Setup'} • Realized: $${calculations?.grossPnL?.toFixed(2) ?? '0.00'}` : undefined}
      />
    </ModalOverlay>
  );
};
