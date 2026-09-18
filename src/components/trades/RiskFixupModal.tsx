import React, { useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, X, Pencil, Check } from 'lucide-react';
import { Instrument, Trade } from '../../types';
import { ModalOverlay } from '../common/ModalOverlay';
import {
  findAssumedRiskTrades,
  previewRiskFix,
  RiskFixItem,
  RiskFixMode,
} from '../../lib/trading/risk-fixup';

interface RiskFixupModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: Trade[];
  instruments: Instrument[];
  /** Applies the previewed changes. Only non-skipped items are passed. */
  onApply: (items: RiskFixItem[]) => void;
  /** Opens the normal trade form so a stop can be typed exactly. */
  onEditTrade: (trade: Trade) => void;
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

/**
 * Replaces the placeholder risk on imported trades with real numbers.
 *
 * A broker CSV has no stop, so the importer invents one, and that invented stop drives
 * initial risk, the R-multiple and every risk statistic downstream. This dialog is the
 * only sanctioned way to fix that in bulk, and it always previews the resulting stops
 * and R-multiples before anything is written.
 */
export const RiskFixupModal: React.FC<RiskFixupModalProps> = ({
  isOpen,
  onClose,
  trades,
  instruments,
  onApply,
  onEditTrade,
}) => {
  const [mode, setMode] = useState<RiskFixMode>('points');
  const [pointsInput, setPointsInput] = useState('10');
  const [dollarsInput, setDollarsInput] = useState('100');

  const needingFix = useMemo(() => findAssumedRiskTrades(trades), [trades]);

  const parsedPoints = pointsInput.trim() === '' ? undefined : Number(pointsInput);
  const parsedDollars = dollarsInput.trim() === '' ? undefined : Number(dollarsInput);

  const preview = useMemo(
    () =>
      previewRiskFix({
        trades,
        instruments,
        plan:
          mode === 'points'
            ? { mode: 'points', points: parsedPoints }
            : { mode: 'dollars', dollars: parsedDollars },
      }),
    [trades, instruments, mode, parsedPoints, parsedDollars]
  );

  if (!isOpen) return null;

  const canApply = !preview.planError && preview.items.length > 0;

  const modeButton = (id: string, value: RiskFixMode, label: string, hint: string) => (
    <button
      id={id}
      type="button"
      onClick={() => setMode(value)}
      className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${
        mode === value
          ? 'border-amber-700 bg-amber-950/30'
          : 'border-zinc-700 bg-zinc-900 hover:bg-zinc-800/60'
      }`}
    >
      <span className="block text-xs font-semibold text-zinc-100">{label}</span>
      <span className="mt-0.5 block text-[10px] text-zinc-400">{hint}</span>
    </button>
  );

  return (
    <ModalOverlay onBackdropClick={onClose}>
      <div
        id="risk-fixup-modal"
        className="relative w-full max-w-2xl rounded-2xl border border-zinc-700/80 bg-zinc-900 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Fix imported risk</h3>
              <p className="mt-0.5 text-xs text-zinc-400">
                A broker CSV carries no stop price, so the importer had to invent one. Until you
                replace it, the risk and R-multiple on these trades are not yours.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {needingFix.length === 0 ? (
          <div id="risk-fixup-empty" className="py-6 text-center">
            <Check className="mx-auto mb-2 h-5 w-5 text-emerald-400" />
            <p className="text-xs text-zinc-300">
              Every trade has a real stop. Nothing here needs fixing.
            </p>
          </div>
        ) : (
          <div className="space-y-3.5 pt-3.5">
            <p className="text-xs text-zinc-300">
              <span className="font-mono font-semibold text-amber-300">{needingFix.length}</span>{' '}
              trade{needingFix.length === 1 ? '' : 's'} still use a placeholder stop. Apply one
              stop rule to all of them, or edit a single trade to type an exact stop.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              {modeButton(
                'risk-fixup-mode-points',
                'points',
                'Stop distance in points',
                'You know how many points you give a trade.'
              )}
              {modeButton(
                'risk-fixup-mode-dollars',
                'dollars',
                'Dollar risk per trade',
                'Converted using each instrument and its size.'
              )}
            </div>

            {mode === 'points' ? (
              <label className="block">
                <span className="text-[10px] font-mono uppercase text-zinc-500">
                  Stop distance (points)
                </span>
                <input
                  id="risk-fixup-points"
                  type="number"
                  min="0"
                  step="0.25"
                  value={pointsInput}
                  onChange={(e) => setPointsInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-600 focus:outline-none"
                />
              </label>
            ) : (
              <label className="block">
                <span className="text-[10px] font-mono uppercase text-zinc-500">
                  Risk per trade (dollars)
                </span>
                <input
                  id="risk-fixup-dollars"
                  type="number"
                  min="0"
                  step="1"
                  value={dollarsInput}
                  onChange={(e) => setDollarsInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-600 focus:outline-none"
                />
              </label>
            )}

            {preview.planError && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 px-3.5 py-2.5">
                <p className="text-xs text-rose-200">{preview.planError}</p>
              </div>
            )}

            {!preview.planError && (
              <>
                <div
                  id="risk-fixup-summary"
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                >
                  <Stat label="Trades" value={`${preview.summary.count}`} />
                  <Stat label="Average risk" value={money(preview.summary.averageRisk)} />
                  <Stat label="Total risk" value={money(preview.summary.totalRisk)} />
                  <Stat label="R changes" value={`${preview.summary.rChanged}`} />
                </div>

                {preview.items.length > 0 && (
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {preview.items.map((item) => (
                      <div
                        key={item.tradeId}
                        className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-100">
                            {item.symbol} {item.direction} {item.contracts} @ {item.entryPrice}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const trade = trades.find((t) => t.id === item.tradeId);
                              if (trade) onEditTrade(trade);
                            }}
                            className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800"
                          >
                            <Pencil className="h-3 w-3" />
                            Exact stop
                          </button>
                        </div>
                        <div className="mt-1 grid grid-cols-1 gap-0.5 font-mono text-[11px] text-zinc-400 sm:grid-cols-3">
                          <span>
                            stop {item.previousStop} →{' '}
                            <span className="text-zinc-100">{item.stop}</span>
                          </span>
                          <span>
                            risk {money(item.previousRisk)} →{' '}
                            <span className="text-zinc-100">{money(item.risk)}</span>
                          </span>
                          <span>
                            R {item.previousR} → <span className="text-zinc-100">{item.rMultiple}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {preview.skipped.length > 0 && (
                  <div
                    id="risk-fixup-skipped"
                    className="rounded-xl border border-amber-900/60 bg-amber-950/20 px-3.5 py-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                        {preview.skipped.length} left alone
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {preview.skipped.map((skip) => (
                        <li key={skip.tradeId} className="text-[11px] text-amber-100/80">
                          {skip.symbol}: {skip.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.items.length === 0 && preview.skipped.length === 0 && (
                  <p className="text-xs text-zinc-500 italic">
                    Nothing to change with these numbers.
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                id="risk-fixup-apply"
                type="button"
                disabled={!canApply}
                onClick={() => onApply(preview.items)}
                className="rounded-xl bg-amber-500/90 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-amber-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply to {preview.items.length} trade{preview.items.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span className="text-[11px] text-zinc-500">
    {label}: <span className="font-mono font-semibold text-zinc-200">{value}</span>
  </span>
);
