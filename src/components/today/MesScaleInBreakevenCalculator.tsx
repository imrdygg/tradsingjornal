import React, { useState, useEffect, useMemo } from 'react';
import {
  Calculator,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  Target,
  Scale,
  Zap,
  Info,
  Wand2,
  MoveDown,
  Plus,
} from 'lucide-react';
import { Trade, Instrument } from '../../types';
import { findInstrument, DEFAULT_INSTRUMENTS } from '../../lib/trading/instruments';
import {
  calculateScaleInPlan,
  calculateScaleInScenarios,
} from '../../lib/trading/scale-in';

interface MesScaleInBreakevenCalculatorProps {
  /** Open trades for today. The calculator fills itself from the newest one. */
  openTrades?: Trade[];
  plannedLossLimit?: number;
  /** Instrument list, used for the true point / tick value (MES is $5/pt, MNQ $2/pt, ...). */
  instruments?: Instrument[];
  /**
   * Called with a ready-to-save draft when the trader logs the add as its own
   * trade. The journal opens the record form pre-filled so the stop and setup
   * can be confirmed before saving.
   */
  onLogScaleIn?: (draft: Partial<Trade>) => void;
}

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const price = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const contractWord = (n: number) => (n === 1 ? 'contract' : 'contracts');

export const MesScaleInBreakevenCalculator: React.FC<MesScaleInBreakevenCalculatorProps> = ({
  openTrades = [],
  plannedLossLimit = 100,
  instruments = DEFAULT_INSTRUMENTS,
  onLogScaleIn,
}) => {
  // Newest open trade first — that is the position the trader is managing.
  const sortedOpenTrades = useMemo(
    () =>
      [...openTrades].sort(
        (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
      ),
    [openTrades]
  );

  const [selectedTradeId, setSelectedTradeId] = useState<string>('');
  /** False once the trader clears the form to type their own numbers. */
  const [autoFill, setAutoFill] = useState(true);
  const [instrumentId, setInstrumentId] = useState<string>('mes');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [initialContracts, setInitialContracts] = useState<number>(1);
  const [initialEntryPrice, setInitialEntryPrice] = useState<string>('');
  const [currentMarketPrice, setCurrentMarketPrice] = useState<string>('');
  const [contractsToAdd, setContractsToAdd] = useState<number>(2);
  const [addPrice, setAddPrice] = useState<string>('');
  const [desiredBouncePts, setDesiredBouncePts] = useState<number>(5);

  const instrument = useMemo(
    () => findInstrument(instruments, instrumentId),
    [instruments, instrumentId]
  );
  const pointValue = instrument.pointValue;
  const tickSize = instrument.tickSize || 0.25;
  const symbol = instrument.symbol;

  /** Loads a real open trade into every field. */
  const applyTrade = (trade: Trade) => {
    setAutoFill(true);
    setSelectedTradeId(trade.id);
    setInstrumentId(trade.instrumentId || 'mes');
    setDirection(trade.direction);
    setInitialContracts(Math.max(1, trade.contracts || 1));
    const entry = trade.entryPrice > 0 ? trade.entryPrice.toFixed(2) : '';
    setInitialEntryPrice(entry);
    // You know the live price and you know where you plan to add — we do not.
    // Start both at the entry price so the numbers are valid, then the trader
    // updates "current market price" to whatever the market is doing now.
    setCurrentMarketPrice(entry);
    setAddPrice(entry);
  };

  // Auto-fill from the newest open trade. Keyed on the trade ids (not the array
  // identity) so typing in the form is never overwritten by a re-render.
  const openTradesKey = sortedOpenTrades.map((t) => t.id).join('|');
  useEffect(() => {
    if (!autoFill) return;
    if (sortedOpenTrades.length === 0) {
      setSelectedTradeId('');
      return;
    }
    const target =
      sortedOpenTrades.find((t) => t.id === selectedTradeId) || sortedOpenTrades[0];
    applyTrade(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTradesKey, selectedTradeId, autoFill]);

  // A genuinely new open trade always becomes the position we calculate from,
  // even if the trader had switched to typing their own numbers.
  useEffect(() => {
    if (sortedOpenTrades.length > 0) setAutoFill(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTradesKey]);

  const handleSelectTrade = (tradeId: string) => {
    if (!tradeId) return;
    const trade = sortedOpenTrades.find((t) => t.id === tradeId);
    if (trade) applyTrade(trade);
  };

  const resetToBlank = () => {
    setAutoFill(false);
    setSelectedTradeId('');
    setInitialContracts(1);
    setInitialEntryPrice('');
    setCurrentMarketPrice('');
    setContractsToAdd(2);
    setAddPrice('');
  };

  // ---------------------------------------------------------------------------
  // The maths (pure functions, unit tested in src/lib/trading/scale-in.ts)
  // ---------------------------------------------------------------------------
  const p1Raw = parseFloat(initialEntryPrice) || 0;
  const pCurrentRaw = parseFloat(currentMarketPrice);
  const hasPosition = p1Raw > 0;
  const hasMarket = !isNaN(pCurrentRaw) && pCurrentRaw > 0;

  const plan = useMemo(
    () =>
      calculateScaleInPlan({
        direction,
        contracts: initialContracts,
        entryPrice: p1Raw,
        currentPrice: hasMarket ? pCurrentRaw : undefined,
        addContracts: contractsToAdd,
        addPrice: parseFloat(addPrice) || undefined,
        pointValue,
        tickSize,
        desiredBouncePts,
      }),
    [
      direction,
      initialContracts,
      p1Raw,
      hasMarket,
      pCurrentRaw,
      contractsToAdd,
      addPrice,
      pointValue,
      tickSize,
      desiredBouncePts,
    ]
  );

  // Aliased to the short names the JSX below uses.
  const calculations = {
    ...plan,
    c1: plan.contracts,
    p1: plan.entryPrice,
    pCurrent: plan.currentPrice,
    c2: plan.addContracts,
    p2: plan.addPrice,
    hasPosition,
    hasMarket,
  };

  const scenarioMatrix = useMemo(
    () =>
      calculateScaleInScenarios({
        direction,
        contracts: initialContracts,
        entryPrice: p1Raw,
        currentPrice: hasMarket ? pCurrentRaw : undefined,
        addPrice: parseFloat(addPrice) || undefined,
        pointValue,
      }),
    [direction, initialContracts, p1Raw, hasMarket, pCurrentRaw, addPrice, pointValue]
  );

  const canCalculate = calculations.hasPosition && calculations.p2 > 0;

  const sourceTrade = sortedOpenTrades.find((t) => t.id === selectedTradeId);

  /**
   * Turns the current scale-in into a draft for a NEW open trade. It stays a
   * separate journal entry (the original position is untouched) so the R
   * multiple and risk of this add are measured on their own.
   */
  const handleLogScaleIn = () => {
    if (!onLogScaleIn || !canCalculate) return;

    const note =
      `Scale-in add. Position was ${calculations.c1} ${contractWord(calculations.c1)} ` +
      `@ ${price(calculations.p1)}; added ${calculations.c2} @ ${price(calculations.p2)} ` +
      `→ new average ${price(calculations.newAveragePrice)} ` +
      `(needs ${Math.max(0, calculations.pointsToNewBreakeven).toFixed(2)} pts from the add to break even).`;

    onLogScaleIn({
      instrumentId: instrument.id,
      direction,
      contracts: calculations.c2,
      entryPrice: calculations.p2,
      session: sourceTrade?.session ?? 'Regular Session',
      setupName: sourceTrade?.setupName,
      entryReason: sourceTrade?.entryReason,
      notes: note,
      status: 'open',
      // Links this leg to the position it was added to, so the trade list can
      // show one blended entry/size. Falls back to the opening trade's own id
      // when it is the first leg of the position.
      positionId: sourceTrade ? sourceTrade.positionId || sourceTrade.id : undefined,
    });
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-5">
      {/* Header */}
      <div className="space-y-3 border-b border-zinc-800/80 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Calculator className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-zinc-100 font-mono tracking-tight">
                Position Scale-In &amp; Break-Even Calculator
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 font-semibold border border-zinc-700">
                {symbol} · {money(pointValue)}/pt · {money(pointValue * tickSize)}/tick
              </span>
            </div>
            <p className="text-xs text-zinc-400 max-w-2xl">
              Enter your real position and the price you would add at. You get the new average
              entry (= your break-even price), how far price must bounce to reach it, and the risk
              you take on by sizing up.
            </p>
          </div>

          {/* Instrument selector — drives every dollar figure below */}
          <div className="shrink-0">
            <label className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">
              Instrument
            </label>
            <select
              value={instrument.id}
              onChange={(e) => setInstrumentId(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {instruments.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.symbol} — {money(inst.pointValue)}/pt
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Real-position loader */}
        <div className="flex flex-wrap items-center gap-2">
          {sortedOpenTrades.length > 0 ? (
            <>
              <span className="text-[11px] text-zinc-400 font-mono uppercase tracking-wider">
                My open position:
              </span>
              {sortedOpenTrades.length === 1 ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-xs font-medium">
                  <Zap className="w-3.5 h-3.5" />
                  {sortedOpenTrades[0].direction.toUpperCase()}{' '}
                  {sortedOpenTrades[0].contracts}x @ {price(sortedOpenTrades[0].entryPrice)}
                </span>
              ) : (
                <select
                  value={selectedTradeId}
                  onChange={(e) => handleSelectTrade(e.target.value)}
                  className="rounded-lg border border-emerald-800/70 bg-emerald-950/50 px-2.5 py-1.5 text-xs font-mono text-emerald-200 focus:outline-none"
                >
                  {sortedOpenTrades.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.direction.toUpperCase()} {t.contracts}x @ {price(t.entryPrice)}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-[11px] text-zinc-500">
                (filled in automatically — just update the current price)
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Info className="w-3.5 h-3.5 text-zinc-500" />
              No open trades today, so enter your numbers below manually.
            </span>
          )}

          <button
            type="button"
            onClick={resetToBlank}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
            title="Clear every field and type your own numbers"
          >
            <Wand2 className="w-3 h-3" />
            Clear &amp; enter manually
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: the calculator */}
        <div className="lg:col-span-7 space-y-4">
          {/* Step 1 — current position */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-zinc-400" />
                Step 1: Your Open Position
              </span>
              <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setDirection('long')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                    direction === 'long'
                      ? 'bg-emerald-500 text-zinc-950 font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Long
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('short')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                    direction === 'short'
                      ? 'bg-rose-500 text-zinc-950 font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Short
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="breakeven-contracts-held"
                  className="text-[11px] font-medium text-zinc-400 block mb-1"
                >
                  Contracts held
                </label>
                <input
                  id="breakeven-contracts-held"
                  type="number"
                  min={1}
                  max={200}
                  value={initialContracts}
                  onChange={(e) => setInitialContracts(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="breakeven-entry-price"
                  className="text-[11px] font-medium text-zinc-400 block mb-1"
                >
                  Entry price
                </label>
                <input
                  id="breakeven-entry-price"
                  type="number"
                  step="0.25"
                  value={initialEntryPrice}
                  onChange={(e) => setInitialEntryPrice(e.target.value)}
                  placeholder="your fill"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="breakeven-current-price"
                  className="text-[11px] font-medium text-zinc-400 block mb-1"
                >
                  Current market price
                </label>
                <input
                  id="breakeven-current-price"
                  type="number"
                  step="0.25"
                  value={currentMarketPrice}
                  onChange={(e) => setCurrentMarketPrice(e.target.value)}
                  placeholder="live price"
                  className="w-full rounded-lg border border-amber-900/50 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/90 border border-zinc-800/80 text-xs">
              <span className="text-zinc-400 text-[11px]">
                {calculations.hasPosition ? (
                  <>
                    Open P&amp;L on {calculations.c1} {contractWord(calculations.c1)} @{' '}
                    {price(calculations.p1)}:
                  </>
                ) : (
                  'Enter your entry price to see the open P&L'
                )}
              </span>
              {calculations.hasPosition && (
                <span
                  className={`font-mono font-semibold ${
                    calculations.currentPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {calculations.currentPointsDiff >= 0 ? '+' : ''}
                  {calculations.currentPointsDiff.toFixed(2)} pts ({money(calculations.currentPnL)})
                </span>
              )}
            </div>
          </div>

          {/* Step 2 — the add */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-3.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-emerald-400" />
                Step 2: The Add (Scale-In)
              </span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5, 10].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setContractsToAdd(qty)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all ${
                      contractsToAdd === qty
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                        : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                    }`}
                  >
                    +{qty}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="breakeven-contracts-to-add"
                  className="text-[11px] font-medium text-zinc-400 block mb-1"
                >
                  Contracts to add
                </label>
                <input
                  id="breakeven-contracts-to-add"
                  type="number"
                  min={1}
                  max={200}
                  value={contractsToAdd}
                  onChange={(e) => setContractsToAdd(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="breakeven-add-price"
                    className="text-[11px] font-medium text-zinc-400"
                  >
                    Price you would add at
                  </label>
                  {calculations.hasMarket && (
                    <button
                      type="button"
                      onClick={() => setAddPrice(currentMarketPrice)}
                      className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline"
                      title="Copy the current market price into the add price"
                    >
                      = current
                    </button>
                  )}
                </div>
                <input
                  id="breakeven-add-price"
                  type="number"
                  step="0.25"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                  placeholder="planned add level"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-900/30 pb-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Results
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                Total position:{' '}
                <strong className="text-zinc-200">
                  {calculations.totalContracts} {symbol}
                </strong>
              </span>
            </div>

            {!canCalculate ? (
              <p className="text-xs text-zinc-400 py-3 text-center">
                Fill in your entry price (and the price you would add at) to see the new break-even.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 space-y-1">
                    <div className="text-[10px] uppercase font-mono text-zinc-400">
                      New Average Entry = Break-Even Price
                    </div>
                    <div className="text-xl font-bold font-mono text-emerald-400">
                      {price(calculations.newAveragePrice)}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Improved from{' '}
                      <span className="line-through text-zinc-500 font-mono">
                        {price(calculations.p1)}
                      </span>{' '}
                      by{' '}
                      <span className="text-emerald-300 font-mono font-medium">
                        {calculations.averageImprovedBy.toFixed(2)} pts
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 space-y-1">
                    <div className="text-[10px] uppercase font-mono text-zinc-400">
                      Bounce Needed For $0 Break-Even
                    </div>
                    <div className="text-xl font-bold font-mono text-amber-300">
                      {calculations.pointsToNewBreakeven.toFixed(2)} pts
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {calculations.hasMarket ? (
                        <>
                          Down from{' '}
                          <span className="line-through text-zinc-500 font-mono">
                            {calculations.originalPointsToBreakeven.toFixed(2)} pts
                          </span>{' '}
                          ({calculations.percentDistanceReduced.toFixed(0)}% less distance)
                        </>
                      ) : (
                        'Enter the current market price to compare'
                      )}
                    </div>
                  </div>
                </div>

                {/* Risk exposure */}
                <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-[11px] flex-wrap gap-1">
                    <span className="text-zinc-400 flex items-center gap-1 font-mono">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      Risk exposure:
                    </span>
                    <span className="font-mono text-zinc-300">
                      {money(calculations.dollarPerPointBefore)}/pt →{' '}
                      <strong className="text-amber-300 font-bold">
                        {money(calculations.dollarPerPointAfter)}/pt
                      </strong>{' '}
                      ({money(calculations.dollarPerTickAfter)}/tick)
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 border-t border-zinc-800/60">
                    <div className="text-emerald-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />+{calculations.movePts} pts ={' '}
                      {money(calculations.favorableMovePnL)}
                    </div>
                    <div className="text-rose-400 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" />-{calculations.movePts} pts ={' '}
                      {money(calculations.adverseMovePnL)}
                    </div>
                  </div>

                  {Math.abs(calculations.adverseMovePnL) > plannedLossLimit && (
                    <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded px-2 py-1 flex items-start gap-1 mt-1">
                      <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">
                        A {calculations.movePts}-point move against {calculations.totalContracts}{' '}
                        {contractWord(calculations.totalContracts)} costs{' '}
                        {money(Math.abs(calculations.adverseMovePnL))} — more than your planned
                        daily loss limit of {money(plannedLossLimit)}.
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Log the add as its own trade */}
          {onLogScaleIn && (
            <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-semibold text-emerald-200">
                  Going ahead with this add?
                </p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  {canCalculate ? (
                    <>
                      Record it as a second open trade — {calculations.c2}{' '}
                      {contractWord(calculations.c2)} {symbol} @ {price(calculations.p2)}. Your
                      original position stays untouched, so the risk on this add is tracked on its
                      own.
                    </>
                  ) : (
                    'Fill in the entry price and the price you would add at to log this add.'
                  )}
                </p>
              </div>

              <button
                type="button"
                id="breakeven-log-scale-in"
                disabled={!canCalculate}
                onClick={handleLogScaleIn}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-3.5 py-2 text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                Log this add as a trade
              </button>
            </div>
          )}

          {/* Scenario matrix */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2.5">
            <span className="text-xs font-semibold text-zinc-400 font-mono uppercase tracking-wider block">
              If I add a different size
              {canCalculate ? ` at ${price(calculations.p2)}` : ''}
            </span>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                    <th className="pb-1.5 font-medium">Add</th>
                    <th className="pb-1.5 font-medium">Total</th>
                    <th className="pb-1.5 font-medium">New Avg / B/E</th>
                    <th className="pb-1.5 font-medium">Bounce to $0</th>
                    <th className="pb-1.5 font-medium text-right">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {scenarioMatrix.map((row) => {
                    const isCurrent = row.addQty === contractsToAdd;
                    return (
                      <tr
                        key={row.addQty}
                        onClick={() => setContractsToAdd(row.addQty)}
                        className={`cursor-pointer hover:bg-zinc-900 transition-colors ${
                          isCurrent ? 'bg-emerald-950/30 text-emerald-300 font-semibold' : 'text-zinc-300'
                        }`}
                      >
                        <td className="py-1.5 font-bold">
                          +{row.addQty} {isCurrent && '★'}
                        </td>
                        <td className="py-1.5 text-zinc-400">
                          {row.totalQty} {symbol}
                        </td>
                        <td className="py-1.5">{row.avgPrice > 0 ? price(row.avgPrice) : '—'}</td>
                        <td className="py-1.5 text-amber-300">
                          {row.avgPrice > 0 ? `${row.bounceNeeded.toFixed(2)} pts` : '—'}
                        </td>
                        <td className="py-1.5 text-right text-zinc-400">
                          {money(row.dollarPt)}/pt
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: explanation + goal solver */}
        <div className="lg:col-span-5 space-y-4">
          {/* Live formula */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex items-center gap-2 text-zinc-200">
              <HelpCircle className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono">
                How the number is worked out
              </h4>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Adding to a position does not erase the loss — it{' '}
              <strong className="text-emerald-400">spreads it over more contracts</strong>, which
              pulls your average entry (your break-even price) closer to where price is now.
            </p>

            <div className="rounded-lg bg-zinc-900 p-2.5 border border-zinc-800 text-[11px] font-mono text-zinc-300 space-y-1">
              <div className="text-zinc-400 text-[10px] uppercase font-bold">
                Weighted average:
              </div>
              <div className="text-emerald-300 text-xs py-1">
                New Avg = (Qty₁ × Price₁ + Qty₂ × Price₂) ÷ Total Qty
              </div>
              {canCalculate ? (
                <div className="text-zinc-300 text-[11px] pt-1 border-t border-zinc-800 leading-relaxed">
                  ({calculations.c1} × {price(calculations.p1)} + {calculations.c2} ×{' '}
                  {price(calculations.p2)}) ÷ {calculations.totalContracts} ={' '}
                  <strong className="text-emerald-400">{price(calculations.newAveragePrice)}</strong>
                </div>
              ) : (
                <div className="text-zinc-500 text-[11px] pt-1 border-t border-zinc-800">
                  Enter your numbers and the live formula appears here.
                </div>
              )}
            </div>

            {canCalculate && (
              <p className="text-xs text-zinc-400 leading-relaxed">
                With {calculations.totalContracts} {contractWord(calculations.totalContracts)},{' '}
                {symbol} needs to move{' '}
                <span className="text-emerald-300 font-mono">
                  {Math.max(0, calculations.pointsToNewBreakeven).toFixed(2)} pts
                </span>{' '}
                from your add price to get you back to $0
                {calculations.distanceSavedPts > 0
                  ? `, ${calculations.distanceSavedPts.toFixed(2)} pts less than before.`
                  : '.'}
              </p>
            )}
          </div>

          {/* Goal solver */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-200 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                Work backwards
              </span>
              <span className="text-[10px] font-mono text-zinc-500">by bounce size</span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              “Price usually gives me a small bounce here. How many must I add to get out at $0?”
            </p>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-mono text-zinc-400 block mb-1">
                  Expected bounce (points)
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={desiredBouncePts}
                  onChange={(e) => setDesiredBouncePts(Math.max(0.25, parseFloat(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>
              <button
                type="button"
                disabled={calculations.neededContractsForTarget <= 0}
                onClick={() => setContractsToAdd(calculations.neededContractsForTarget)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Add +{calculations.neededContractsForTarget || 0}
              </button>
            </div>

            <div className="text-[11px] text-zinc-400 leading-relaxed">
              {calculations.neededContractsForTarget > 0 ? (
                <>
                  To break even within{' '}
                  <strong className="text-amber-300 font-mono">{desiredBouncePts} pts</strong> of
                  your add price, you need{' '}
                  <strong className="text-emerald-300 font-mono">
                    {calculations.neededContractsForTarget}{' '}
                    {contractWord(calculations.neededContractsForTarget)}
                  </strong>{' '}
                  at {price(calculations.p2)}.
                </>
              ) : (
                <>
                  Enter your entry price, the live market price and an add price. If the bounce you
                  expect is already bigger than the gap, the solver will tell you no add is needed.
                </>
              )}
            </div>
          </div>

          {/* Guard rails */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Before you press the button
            </h4>

            <div className="space-y-2.5 text-xs">
              <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-900/40 space-y-1">
                <div className="text-emerald-300 font-semibold flex items-center gap-1.5">
                  <ArrowRight className="w-3 h-3" />
                  Plan the exit, not the homerun
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Scaling in is a tool for turning a losing trade into a{' '}
                  <strong className="text-zinc-200">scratch</strong> on the first relief bounce — not
                  for doubling down hoping for a big win.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-1">
                <div className="text-zinc-200 font-semibold flex items-center gap-1.5">
                  <MoveDown className="w-3 h-3" />
                  Only add at a level you already planned
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Support, prior day low, VWAP, the level you wrote down this morning. Adding into
                  open air is how a small loss becomes a large one.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-900/40 space-y-1">
                <div className="text-rose-300 font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-3 h-3" />
                  Decide the stop before the size
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  A bigger position means every point costs more. Pick the price that proves the add
                  wrong, check the dollar loss against your daily limit, and only then size up.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
