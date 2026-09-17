import React, { useState, useMemo } from 'react';
import {
  Calculator,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  RefreshCw,
  Target,
  Scale,
  Zap,
} from 'lucide-react';
import { Trade } from '../../types';

interface MesScaleInBreakevenCalculatorProps {
  openTrades?: Trade[];
  plannedLossLimit?: number;
}

export const MesScaleInBreakevenCalculator: React.FC<MesScaleInBreakevenCalculatorProps> = ({
  openTrades = [],
  plannedLossLimit = 100,
}) => {
  // Calculator inputs
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [initialContracts, setInitialContracts] = useState<number>(1);
  const [initialEntryPrice, setInitialEntryPrice] = useState<string>('7730.00');
  const [currentMarketPrice, setCurrentMarketPrice] = useState<string>('7700.00');
  const [contractsToAdd, setContractsToAdd] = useState<number>(5);
  const [addPrice, setAddPrice] = useState<string>('7700.00');

  // Reverse solver target bounce (points)
  const [desiredBouncePts, setDesiredBouncePts] = useState<number>(5);

  // Active open MES trades (if any)
  const openMesTrades = useMemo(() => {
    return openTrades.filter(
      (t) => t.status === 'open' && (!t.instrumentId || t.instrumentId.toLowerCase() === 'mes')
    );
  }, [openTrades]);

  // Handle loading an active trade
  const handleLoadActiveTrade = (trade: Trade) => {
    setDirection(trade.direction);
    setInitialContracts(trade.contracts || 1);
    setInitialEntryPrice(trade.entryPrice.toFixed(2));
    // Default current/add price to 10 points in adverse direction or user custom
    const adverseOffset = trade.direction === 'long' ? -10 : 10;
    const estimatedCurrent = (trade.entryPrice + adverseOffset).toFixed(2);
    setCurrentMarketPrice(estimatedCurrent);
    setAddPrice(estimatedCurrent);
  };

  // Preset example from user's scenario
  const handleLoadUserExample = () => {
    setDirection('long');
    setInitialContracts(1);
    setInitialEntryPrice('7730.00');
    setCurrentMarketPrice('7700.00');
    setContractsToAdd(5);
    setAddPrice('7700.00');
    setDesiredBouncePts(5);
  };

  // Preset down $50 example
  const handleLoad50DollarLossExample = () => {
    setDirection('long');
    setInitialContracts(1);
    setInitialEntryPrice('7730.00');
    // Down $50 on 1 MES contract ($5/pt) = down 10 points
    setCurrentMarketPrice('7720.00');
    setContractsToAdd(2);
    setAddPrice('7720.00');
    setDesiredBouncePts(3.33);
  };

  // Calculations
  const calculations = useMemo(() => {
    const c1 = Math.max(1, initialContracts || 1);
    const p1 = parseFloat(initialEntryPrice) || 0;
    const pCurrent = parseFloat(currentMarketPrice) || p1;
    const c2 = Math.max(1, contractsToAdd || 1);
    const p2 = parseFloat(addPrice) || pCurrent;

    const isLong = direction === 'long';

    // MES point value is $5.00 per point
    const pointValue = 5.0;

    // Current unadjusted position metrics
    const currentPointsDiff = isLong ? pCurrent - p1 : p1 - pCurrent;
    const currentPnL = currentPointsDiff * c1 * pointValue;
    const originalPointsToBreakeven = Math.abs(p1 - pCurrent);

    // After scaling in:
    // Weighted Average Entry: (c1 * p1 + c2 * p2) / (c1 + c2)
    const totalContracts = c1 + c2;
    const newAveragePrice = (c1 * p1 + c2 * p2) / totalContracts;

    // Required bounce / move to reach new breakeven from the add price:
    // For Long: needs price to rise to newAveragePrice from p2
    // For Short: needs price to drop to newAveragePrice from p2
    const pointsToNewBreakeven = isLong ? newAveragePrice - p2 : p2 - newAveragePrice;
    const distanceSavedPts = originalPointsToBreakeven - Math.max(0, pointsToNewBreakeven);
    const percentDistanceReduced =
      originalPointsToBreakeven > 0
        ? Math.max(0, Math.min(100, (distanceSavedPts / originalPointsToBreakeven) * 100))
        : 0;

    // Risk / Exposure metrics
    const dollarPerPointBefore = c1 * pointValue;
    const dollarPerPointAfter = totalContracts * pointValue;
    const dollarPerTickAfter = (dollarPerPointAfter / 4); // 0.25 tick size

    // Reverse Solver: How many contracts needed to achieve desired bounce?
    // Formula: We want pAvg such that |pAvg - p2| = desiredBouncePts
    // For long: pAvg = p2 + desiredBouncePts
    // (c1 * p1 + c2 * p2) / (c1 + c2) = pAvg
    // c1 * p1 + c2 * p2 = (c1 + c2) * pAvg
    // c1 * (p1 - pAvg) = c2 * (pAvg - p2)
    // c2 = c1 * (p1 - pAvg) / (pAvg - p2) = c1 * (p1 - (p2 + desiredBounce)) / desiredBounce
    const targetBounce = Math.max(0.25, desiredBouncePts || 1);
    let neededContractsForTarget = 0;
    if (originalPointsToBreakeven > targetBounce) {
      neededContractsForTarget = Math.ceil(
        (c1 * (originalPointsToBreakeven - targetBounce)) / targetBounce
      );
    }

    // Profit / Loss projection scenarios with the new 6-contract size:
    const favorable5PtsPnL = 5 * dollarPerPointAfter;
    const adverse5PtsPnL = -5 * dollarPerPointAfter;

    return {
      c1,
      p1,
      pCurrent,
      c2,
      p2,
      totalContracts,
      currentPointsDiff,
      currentPnL,
      originalPointsToBreakeven,
      newAveragePrice,
      pointsToNewBreakeven,
      percentDistanceReduced,
      dollarPerPointBefore,
      dollarPerPointAfter,
      dollarPerTickAfter,
      neededContractsForTarget,
      favorable5PtsPnL,
      adverse5PtsPnL,
    };
  }, [direction, initialContracts, initialEntryPrice, currentMarketPrice, contractsToAdd, addPrice, desiredBouncePts]);

  // Quick preset contract sizes comparison table
  const scenarioMatrix = useMemo(() => {
    const c1 = Math.max(1, initialContracts || 1);
    const p1 = parseFloat(initialEntryPrice) || 0;
    const p2 = parseFloat(addPrice) || p1;
    const isLong = direction === 'long';

    return [1, 2, 3, 5, 8, 10].map((addQty) => {
      const tot = c1 + addQty;
      const avg = (c1 * p1 + addQty * p2) / tot;
      const bounceNeeded = isLong ? avg - p2 : p2 - avg;
      const dollarPt = tot * 5;
      return {
        addQty,
        totalQty: tot,
        avgPrice: avg,
        bounceNeeded: Math.max(0, bounceNeeded),
        dollarPt,
      };
    });
  }, [initialContracts, initialEntryPrice, addPrice, direction]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-5">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Calculator className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-zinc-100 font-mono tracking-tight flex items-center gap-2">
              MES Position Averaging & Breakeven Calculator
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 font-semibold border border-zinc-700">
              $5/Point
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Calculate your new average entry price, required breakeven bounce, and risk exposure when adding to a position.
          </p>
        </div>

        {/* Action presets */}
        <div className="flex flex-wrap items-center gap-2">
          {openMesTrades.length > 0 && (
            <button
              type="button"
              onClick={() => handleLoadActiveTrade(openMesTrades[0])}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900 text-xs font-medium transition-all"
              title="Load your current active MES trade"
            >
              <Zap className="w-3.5 h-3.5" />
              Load Open Trade ({openMesTrades[0].direction.toUpperCase()} @ {openMesTrades[0].entryPrice})
            </button>
          )}

          <button
            type="button"
            onClick={handleLoadUserExample}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            Your Example (1 @ 7730, +5 @ 7700)
          </button>

          <button
            type="button"
            onClick={handleLoad50DollarLossExample}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
          >
            Down $50 Example
          </button>
        </div>
      </div>

      {/* Main Two-Column Layout: Calculator Inputs & Instant Results (Left) + Detailed Explanation & Strategy Guide (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Interactive Calculator & Live Metrics (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Position Setup Controls */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-zinc-400" />
                Step 1: Current Active Position
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
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  Current Contracts
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={initialContracts}
                  onChange={(e) => setInitialContracts(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  Initial Entry Price
                </label>
                <input
                  type="number"
                  step="0.25"
                  value={initialEntryPrice}
                  onChange={(e) => setInitialEntryPrice(e.target.value)}
                  placeholder="e.g. 7730.00"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  Current Market Price
                </label>
                <input
                  type="number"
                  step="0.25"
                  value={currentMarketPrice}
                  onChange={(e) => {
                    setCurrentMarketPrice(e.target.value);
                    setAddPrice(e.target.value); // Keep add price in sync by default
                  }}
                  placeholder="e.g. 7700.00"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Current P&L status badge */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/90 border border-zinc-800/80 text-xs">
              <span className="text-zinc-400 text-[11px]">
                Current Position Status ({initialContracts} MES @ {initialEntryPrice}):
              </span>
              <span
                className={`font-mono font-semibold ${
                  calculations.currentPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {calculations.currentPointsDiff >= 0 ? '+' : ''}
                {calculations.currentPointsDiff.toFixed(2)} pts (
                {calculations.currentPnL >= 0 ? '+' : ''}$
                {calculations.currentPnL.toFixed(2)})
              </span>
            </div>
          </div>

          {/* Scale-In / Addition Parameters */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-emerald-400" />
                Step 2: Add to Position (Scale-In)
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
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  Number of Contracts to Add
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={contractsToAdd}
                  onChange={(e) => setContractsToAdd(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  Price to Buy / Add at
                </label>
                <input
                  type="number"
                  step="0.25"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                  placeholder="e.g. 7700.00"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Core Results Card: New Average, Breakeven, & Bounce Needed */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-900/30 pb-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Calculation Results
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                Total Position: <strong className="text-zinc-200">{calculations.totalContracts} MES</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Metric 1: New Average Price */}
              <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 space-y-1">
                <div className="text-[10px] uppercase font-mono text-zinc-400">
                  New Average Entry (Breakeven Price)
                </div>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {calculations.newAveragePrice.toFixed(2)}
                </div>
                <div className="text-[11px] text-zinc-400">
                  Pulled down from{' '}
                  <span className="line-through text-zinc-500 font-mono">
                    {calculations.p1.toFixed(2)}
                  </span>{' '}
                  by{' '}
                  <span className="text-emerald-300 font-mono font-medium">
                    {Math.abs(calculations.p1 - calculations.newAveragePrice).toFixed(2)} pts
                  </span>
                </div>
              </div>

              {/* Metric 2: Required Bounce to Breakeven */}
              <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 space-y-1">
                <div className="text-[10px] uppercase font-mono text-zinc-400">
                  Required Bounce for $0 Breakeven
                </div>
                <div className="text-xl font-bold font-mono text-amber-300">
                  {calculations.pointsToNewBreakeven.toFixed(2)} pts
                </div>
                <div className="text-[11px] text-zinc-400">
                  Instead of needing{' '}
                  <span className="line-through text-zinc-500 font-mono">
                    {calculations.originalPointsToBreakeven.toFixed(2)} pts
                  </span>{' '}
                  ({calculations.percentDistanceReduced.toFixed(0)}% less distance!)
                </div>
              </div>
            </div>

            {/* Risk & Leverage Warning Meter */}
            <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 space-y-2 text-xs">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-400 flex items-center gap-1 font-mono">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  Risk Exposure Change:
                </span>
                <span className="font-mono text-zinc-300">
                  ${calculations.dollarPerPointBefore}/pt →{' '}
                  <strong className="text-amber-300 font-bold">${calculations.dollarPerPointAfter}/pt</strong> ($
                  {calculations.dollarPerTickAfter.toFixed(2)}/tick)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 border-t border-zinc-800/60">
                <div className="text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  +5 pt bounce = +${calculations.favorable5PtsPnL.toFixed(0)} profit
                </div>
                <div className="text-rose-400 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  -5 pt adverse = -${Math.abs(calculations.adverse5PtsPnL).toFixed(0)} loss
                </div>
              </div>

              {Math.abs(calculations.adverse5PtsPnL) > plannedLossLimit && (
                <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded px-2 py-1 flex items-center gap-1 mt-1">
                  <ShieldAlert className="w-3 h-3 shrink-0" />
                  Warning: A 5-point drop with {calculations.totalContracts} contracts exceeds your planned daily loss limit (${plannedLossLimit}).
                </div>
              )}
            </div>
          </div>

          {/* Quick Scenario Matrix: How adding different contract sizes changes the average */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2.5">
            <span className="text-xs font-semibold text-zinc-400 font-mono uppercase tracking-wider block">
              Quick Reference: Adding Different Contract Sizes at {addPrice}
            </span>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                    <th className="pb-1.5 font-medium">Add Qty</th>
                    <th className="pb-1.5 font-medium">Total Size</th>
                    <th className="pb-1.5 font-medium">New Avg</th>
                    <th className="pb-1.5 font-medium">Bounce to $0</th>
                    <th className="pb-1.5 font-medium text-right">$/Point Risk</th>
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
                        <td className="py-1.5 text-zinc-400">{row.totalQty} MES</td>
                        <td className="py-1.5">{row.avgPrice.toFixed(2)}</td>
                        <td className="py-1.5 text-amber-300">
                          {row.bounceNeeded.toFixed(2)} pts
                        </td>
                        <td className="py-1.5 text-right text-zinc-400">${row.dollarPt}/pt</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: In-Depth Explanation & Execution Guide (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Explanation Header Card */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex items-center gap-2 text-zinc-200">
              <HelpCircle className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono">
                How This Works & Math Formula
              </h4>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              When you scale into or average down an MES position, your new breakeven price is the{' '}
              <strong className="text-emerald-400">weighted average</strong> of all contracts bought.
            </p>

            {/* Formula Box */}
            <div className="rounded-lg bg-zinc-900 p-2.5 border border-zinc-800 text-[11px] font-mono text-zinc-300 space-y-1">
              <div className="text-zinc-400 text-[10px] uppercase font-bold">The Exact Formula:</div>
              <div className="text-emerald-300 text-xs py-1">
                New Avg = (Qty₁ × Price₁ + Qty₂ × Price₂) ÷ Total Qty
              </div>
              <div className="text-zinc-400 text-[10px] pt-1 border-t border-zinc-800">
                Example: (1 × 7,730 + 5 × 7,700) ÷ 6 = 46,230 ÷ 6 ={' '}
                <strong className="text-emerald-400">7,705.00</strong>
              </div>
            </div>

            <div className="space-y-2 pt-1 text-xs text-zinc-400 leading-relaxed">
              <p>
                <strong className="text-zinc-200">Why does this help?</strong> Originally at 7700, price needed a huge{' '}
                <span className="text-rose-400 font-mono">30-point rally</span> back to 7730 just to break even.
              </p>
              <p>
                By adding 5 contracts at 7700, <strong className="text-zinc-200">5 out of 6 contracts</strong> are entered at the bottom.
                Now price only needs a modest <span className="text-emerald-400 font-mono">+5.00 point bounce</span> to reach $0 P&L!
              </p>
            </div>
          </div>

          {/* Strategic Rules & "How to Use in Practice" */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Strategic Rules: When to Use & When Not To
            </h4>

            <div className="space-y-2.5 text-xs">
              <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-900/40 space-y-1">
                <div className="text-emerald-300 font-semibold flex items-center gap-1.5">
                  <ArrowRight className="w-3 h-3" />
                  1. The "Scratch" Trade Exit
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Professional traders do not average down hoping for huge wins. They scale in at support so they can{' '}
                  <strong className="text-zinc-200">exit for $0 (scratch) on the very first relief bounce</strong> if the market has lost momentum.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-1">
                <div className="text-zinc-200 font-semibold flex items-center gap-1.5">
                  <ArrowRight className="w-3 h-3" />
                  2. Only Add at Confirmed Key Levels
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Never add blindly while price is plunging into thin air. Only add at key levels established in your morning plan (e.g. Prior Day Low, major FVG, VWAP).
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-900/40 space-y-1">
                <div className="text-rose-300 font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-3 h-3" />
                  3. The Leverage Danger (Watch Daily Max Loss)
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Holding 6 MES contracts means every single point movement is{' '}
                  <strong className="text-rose-300">$30.00</strong> instead of $5.00. Set a strict hard stop below the add price so a failed bounce doesn't wipe out your account.
                </p>
              </div>
            </div>
          </div>

          {/* Goal Solver / Target Bounce Calculator */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider font-mono text-zinc-200 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                Target Bounce Solver
              </span>
              <span className="text-[10px] font-mono text-zinc-400">Reverse Goal</span>
            </div>

            <p className="text-xs text-zinc-400">
              "I only expect price to bounce a few points. How many contracts must I add to break even?"
            </p>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-mono text-zinc-400 block mb-1">
                  Desired Bounce Size (Pts)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="50"
                  value={desiredBouncePts}
                  onChange={(e) => setDesiredBouncePts(Math.max(0.25, parseFloat(e.target.value) || 1))}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (calculations.neededContractsForTarget > 0) {
                    setContractsToAdd(calculations.neededContractsForTarget);
                  }
                }}
                className="self-end px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-medium transition-colors"
              >
                Apply: Add +{calculations.neededContractsForTarget}
              </button>
            </div>

            <div className="text-[11px] text-zinc-400 pt-1">
              To get a breakeven within <strong className="text-amber-300 font-mono">{desiredBouncePts} points</strong>,
              you need to add <strong className="text-emerald-400 font-mono">{calculations.neededContractsForTarget} contracts</strong> at {addPrice}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
