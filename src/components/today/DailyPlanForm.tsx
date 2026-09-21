import React, { useState } from 'react';
import {
  Lock,
  Unlock,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Compass,
  FileText,
  AlertCircle,
  History,
  CheckCircle2,
  ImageIcon,
  Calendar,
  BookOpen,
} from 'lucide-react';
import {
  TradingDay,
  RiskMode,
  MarketBias,
  TradingSession,
  Setup,
  Instrument,
  Trade,
} from '../../types';
import { ImportantLevelsEditor } from './ImportantLevelsEditor';
import { PlanChangeDialog } from './PlanChangeDialog';
import { formatTimestamp } from '../../lib/storage/date-utils';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { MesScaleInBreakevenCalculator } from './MesScaleInBreakevenCalculator';

interface DailyPlanFormProps {
  day: TradingDay;
  setups: Setup[];
  instruments: Instrument[];
  openTrades?: Trade[];
  onSaveDay: (updated: TradingDay) => void;
  /** Opens the lock preview modal; the plan locks only after the trader confirms there. */
  onLockPlan: () => void;
  /** True while the lock preview modal is open, so the button shows the pressed state. */
  lockPreviewOpen?: boolean;
  onRecordPlanChange: (change: {
    fieldName: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }) => void;
  /** Opens the Playbook tab, focused on the setups watched today. */
  onOpenPlaybook?: () => void;
  /** Opens the record-trade form pre-filled with a scale-in add. */
  onLogScaleInTrade?: (draft: Partial<Trade>) => void;
  /** Undoes today's plan lock, recording the reason in the audit trail. */
  onUnlockPlan?: (reason?: string) => void;
}

export const DailyPlanForm: React.FC<DailyPlanFormProps> = ({
  day,
  setups,
  instruments,
  openTrades,
  onSaveDay,
  onLockPlan,
  lockPreviewOpen = false,
  onRecordPlanChange,
  onOpenPlaybook,
  onLogScaleInTrade,
  onUnlockPlan,
}) => {
  const isLocked = !!day.lockedAt;
  const [isUnlockDialogOpen, setIsUnlockDialogOpen] = useState(false);

  // State for pending plan change dialog
  const [changeDialogState, setChangeDialogState] = useState<{
    isOpen: boolean;
    fieldName: string;
    oldValue: string;
    newValue: string;
    pendingApply?: () => void;
  }>({
    isOpen: false,
    fieldName: '',
    oldValue: '',
    newValue: '',
  });

  const [setupLightbox, setSetupLightbox] = useState<{
    images: string[];
    title: string;
    subtitle?: string;
  } | null>(null);

  const availableSessions: TradingSession[] = [
    'Overnight',
    'Premarket',
    'Regular Session',
  ];
  const biases: MarketBias[] = ['bullish', 'bearish', 'neutral', 'unsure'];

  const handleFieldChange = (
    fieldName: string,
    oldVal: string,
    newVal: string,
    updater: () => void
  ) => {
    if (isLocked) {
      // Need change record with reason
      setChangeDialogState({
        isOpen: true,
        fieldName,
        oldValue: oldVal,
        newValue: newVal,
        pendingApply: updater,
      });
    } else {
      updater();
    }
  };

  const handleConfirmPlanChange = (reason: string) => {
    onRecordPlanChange({
      fieldName: changeDialogState.fieldName,
      oldValue: changeDialogState.oldValue,
      newValue: changeDialogState.newValue,
      reason,
    });
    if (changeDialogState.pendingApply) {
      changeDialogState.pendingApply();
    }
    setChangeDialogState((prev) => ({ ...prev, isOpen: false }));
  };

  const toggleSession = (sess: TradingSession) => {
    const current = day.allowedSessions || [];
    const next = current.includes(sess)
      ? current.filter((s) => s !== sess)
      : [...current, sess];

    // Must have at least one session
    if (next.length === 0) return;

    handleFieldChange(
      'Allowed Sessions',
      current.join(', '),
      next.join(', '),
      () => {
        onSaveDay({ ...day, allowedSessions: next });
      }
    );
  };

  const toggleSetup = (name: string) => {
    const current = day.watchedSetups || [];
    const next = current.includes(name)
      ? current.filter((s) => s !== name)
      : [...current, name];

    onSaveDay({ ...day, watchedSetups: next });
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6 backdrop-blur-sm space-y-6">
      {/* Header bar of Plan */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-zinc-100 tracking-tight flex items-center gap-2">
              <Compass className="w-5 h-5 text-emerald-400" />
              <span>Morning Plan</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-xs font-mono text-zinc-200">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                {day.tradeDate}
              </span>
            </h2>
            {isLocked && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-300 font-mono">
                <Lock className="w-3 h-3" /> Locked at {formatTimestamp(day.lockedAt || '')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {isLocked
              ? 'Plan is locked. Changes to risk parameters require an explicit reason.'
              : 'Complete your morning plan (2–3 mins) and lock it before placing trades.'}
          </p>
        </div>

        {!isLocked ? (
          <button
            id="lock-plan-btn"
            onClick={onLockPlan}
            className={`flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-semibold text-zinc-950 transition-all shadow-sm ${
              lockPreviewOpen ? 'opacity-70 ring-2 ring-emerald-300' : ''
            }`}
          >
            <Lock className="w-4 h-4" />
            LOCK TODAY'S PLAN
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>Immutable Baseline Stored</span>
            </div>
            {onUnlockPlan && (
              <button
                type="button"
                id="unlock-plan-btn"
                onClick={() => setIsUnlockDialogOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-amber-800/70 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/40 transition-colors"
                title="Reopen today's plan for editing"
              >
                <Unlock className="w-3.5 h-3.5" />
                Undo lock
              </button>
            )}
          </div>
        )}
      </div>

      {/* 1. Risk Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-zinc-300" />
            1. Risk Parameters
          </h3>
          <span className="text-[11px] text-zinc-400 font-mono">
            Default Limit: ${day.normalLossLimit || 100} •{' '}
            {instrumentSymbol(instruments, day.primaryInstrument)} Futures
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Risk Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Risk Mode</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-950 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  if (day.riskMode !== 'normal') {
                    handleFieldChange(
                      'Risk Mode',
                      day.riskMode,
                      'normal',
                      () => {
                        onSaveDay({
                          ...day,
                          riskMode: 'normal',
                          plannedLossLimit: day.normalLossLimit || 100,
                        });
                      }
                    );
                  }
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                  day.riskMode === 'normal'
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (day.riskMode !== 'expanded') {
                    handleFieldChange(
                      'Risk Mode',
                      day.riskMode,
                      'expanded',
                      () => {
                        onSaveDay({
                          ...day,
                          riskMode: 'expanded',
                        });
                      }
                    );
                  }
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                  day.riskMode === 'expanded'
                    ? 'bg-amber-950/80 text-amber-300 border border-amber-800'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Expanded
              </button>
            </div>
          </div>

          {/* Daily Max Loss */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
              <span>Daily Max Loss ($)</span>
              <span className="text-[10px] text-zinc-400">Hard stop</span>
            </label>
            <input
              type="number"
              min="1"
              step="10"
              value={day.plannedLossLimit}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                handleFieldChange(
                  'Daily Max Loss',
                  `$${day.plannedLossLimit}`,
                  `$${val}`,
                  () => {
                    onSaveDay({
                      ...day,
                      plannedLossLimit: val,
                      normalLossLimit: day.riskMode === 'normal' ? val : day.normalLossLimit,
                    });
                  }
                );
              }}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* Planned Contracts */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
              <span>Planned Contracts</span>
              <span className="text-[10px] text-zinc-400">Default 1</span>
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={day.contractsPlanned}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 1;
                handleFieldChange(
                  'Planned Contracts',
                  `${day.contractsPlanned}`,
                  `${val}`,
                  () => {
                    onSaveDay({ ...day, contractsPlanned: val });
                  }
                );
              }}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          {/* Primary Instrument */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Primary Instrument</label>
            <select
              value={day.primaryInstrument}
              onChange={(e) => {
                const val = e.target.value;
                handleFieldChange(
                  'Primary Instrument',
                  day.primaryInstrument,
                  val,
                  () => {
                    onSaveDay({ ...day, primaryInstrument: val });
                  }
                );
              }}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {instruments.map((inst) => (
                <option key={inst.id} value={inst.symbol}>
                  {inst.symbol} — {inst.name} (${inst.pointValue}/pt)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Expanded Risk Details Sub-panel (if Expanded) */}
        {day.riskMode === 'expanded' && (
          <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Expanded Risk Mode Active — Context & Required Reason
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-zinc-300 block mb-1">
                  Normal Loss Limit Baseline ($)
                </label>
                <input
                  type="number"
                  value={day.normalLossLimit}
                  onChange={(e) =>
                    onSaveDay({ ...day, normalLossLimit: parseFloat(e.target.value) || 100 })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-100"
                />
              </div>
              <div>
                <label className="text-[11px] text-zinc-300 block mb-1">
                  Profit Cushion / Context
                </label>
                <input
                  type="text"
                  placeholder="e.g. +$320 accumulated profit this week"
                  value={day.profitCushionContext || ''}
                  onChange={(e) =>
                    onSaveDay({ ...day, profitCushionContext: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-amber-200 block mb-1 font-medium">
                Required Written Reason for Increasing Risk:
                <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={2}
                value={day.riskIncreaseReason || ''}
                onChange={(e) =>
                  onSaveDay({ ...day, riskIncreaseReason: e.target.value })
                }
                placeholder="Specific justification: exceptional market structure, earned risk cushion, high probability setup alignment..."
                className="w-full rounded-lg border border-amber-900/80 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-600 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Market Plan Section */}
      <div className="space-y-4 pt-2 border-t border-zinc-800/80">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-zinc-300" />
          2. Market Plan
        </h3>

        {/* Sessions & Bias */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Allowed Sessions */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">
              Sessions Allowed for Trading:
            </label>
            <div className="flex flex-wrap gap-2">
              {availableSessions.map((sess) => {
                const isSelected = (day.allowedSessions || []).includes(sess);
                return (
                  <button
                    key={sess}
                    type="button"
                    onClick={() => toggleSession(sess)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      isSelected
                        ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
                        : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {sess}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Market Bias */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Daily Market Bias:</label>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-950 p-1 border border-zinc-800">
              {biases.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => onSaveDay({ ...day, marketBias: b })}
                  className={`py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                    day.marketBias === b
                      ? b === 'bullish'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                        : b === 'bearish'
                        ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
                        : 'bg-zinc-800 text-zinc-100 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Setups Watched */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium text-zinc-300">
              Setups Being Watched Today:
            </label>
            {onOpenPlaybook && (
              <button
                type="button"
                onClick={onOpenPlaybook}
                className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1 hover:underline"
                title="Open the Playbook tab focused on the setups watched today"
              >
                <BookOpen className="w-3 h-3" />
                Study in Playbook
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...setups]
              .sort(
                (a, b) =>
                  Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)
              )
              .map((s) => {
                const isWatched = (day.watchedSetups || []).includes(s.name);
                const hasImages = s.images && s.images.length > 0;
                return (
                  <div
                    key={s.id}
                    className={`inline-flex items-center rounded-lg border text-xs font-medium transition-all ${
                      isWatched
                        ? 'bg-zinc-800 text-zinc-100 border-zinc-700'
                        : 'bg-zinc-950/40 text-zinc-500 border-zinc-800/80 hover:text-zinc-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSetup(s.name)}
                      className="px-2.5 py-1"
                      title={
                        s.active
                          ? s.name
                          : `${s.name} (marked off in the Playbook — still available)`
                      }
                    >
                      {s.name}
                      {!s.active && <span className="text-zinc-600"> ·off</span>}
                    </button>
                    {hasImages && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSetupLightbox({
                            images: s.images!,
                            title: `${s.name} Playbook`,
                            subtitle: s.description || 'Reference Chart Model',
                          });
                        }}
                        className="pr-2 pl-0.5 py-1 text-emerald-400 hover:text-emerald-300 transition-colors"
                        title={`View ${s.name} playbook chart big`}
                      >
                        <ImageIcon className="w-3 h-3 hover:scale-110 transition-transform" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Important Price Levels */}
        <ImportantLevelsEditor
          levels={day.importantLevels || []}
          onChange={(levels) => onSaveDay({ ...day, importantLevels: levels })}
        />

        {/* Questions: What am I waiting for? & What will keep me out? */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <span>What am I waiting for?</span>
            </label>
            <textarea
              rows={3}
              value={day.waitingFor || ''}
              onChange={(e) => onSaveDay({ ...day, waitingFor: e.target.value })}
              placeholder="E.g. Clean test and rejection of overnight low with volume delta confirmation..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <span>What will keep me out of a trade?</span>
            </label>
            <textarea
              rows={3}
              value={day.stayOutIf || ''}
              onChange={(e) => onSaveDay({ ...day, stayOutIf: e.target.value })}
              placeholder="E.g. Price chopping inside the 20-point opening range; immediate high-impact CPI release..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Optional Notes */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            <span>Optional Notes & General Observations</span>
          </label>
          <input
            type="text"
            value={day.notes || ''}
            onChange={(e) => onSaveDay({ ...day, notes: e.target.value })}
            placeholder="Macro themes, FED speaker schedules, correlation notes..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>
      </div>

      {/* 3. Position Scaling & Breakeven Calculator */}
      <div className="pt-2 border-t border-zinc-800/80">
        <MesScaleInBreakevenCalculator
          openTrades={openTrades}
          plannedLossLimit={day.plannedLossLimit || 100}
          instruments={instruments}
          onLogScaleIn={onLogScaleInTrade}
        />
      </div>

      {/* Plan Changes Audit History (if any recorded changes exist) */}
      {day.planChanges && day.planChanges.length > 0 && (
        <div className="pt-3 border-t border-zinc-800/80 space-y-2.5">
          <h4 className="text-xs font-semibold text-amber-300 flex items-center gap-1.5 font-mono">
            <History className="w-3.5 h-3.5" />
            Plan Change Audit Trail ({day.planChanges.length})
          </h4>
          <div className="space-y-2">
            {day.planChanges.map((change) => (
              <div
                key={change.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                  <span className="font-semibold text-zinc-200 font-mono uppercase">
                    {change.fieldName}
                  </span>
                  <span className="font-mono text-zinc-400">
                    {formatTimestamp(change.changedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-rose-400 line-through">{change.oldValue}</span>
                  <span className="text-zinc-500">→</span>
                  <span className="text-emerald-400 font-semibold">{change.newValue}</span>
                </div>
                <p className="text-zinc-300 italic pt-0.5 text-[11px]">
                  Reason: "{change.reason}"
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan Change Dialog Modal */}
      <PlanChangeDialog
        isOpen={changeDialogState.isOpen}
        fieldName={changeDialogState.fieldName}
        oldValue={changeDialogState.oldValue}
        newValue={changeDialogState.newValue}
        onClose={() => setChangeDialogState((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmPlanChange}
      />

      {/* Undo plan lock — requires a reason so the audit trail stays complete */}
      <PlanChangeDialog
        isOpen={isUnlockDialogOpen}
        fieldName="Plan Lock"
        oldValue="Locked"
        newValue="Unlocked"
        title="Undo today's plan lock"
        description="Unlocking reopens today's plan for editing. The reason below is saved to the plan change history so the record stays honest."
        confirmLabel="Unlock plan"
        placeholder="E.g., Locked too early — still setting my key levels for the open."
        onClose={() => setIsUnlockDialogOpen(false)}
        onConfirm={(reason) => {
          onUnlockPlan?.(reason);
          setIsUnlockDialogOpen(false);
        }}
      />

      {/* Setup Playbook Lightbox Modal */}
      {setupLightbox && (
        <ImageLightboxModal
          isOpen={true}
          onClose={() => setSetupLightbox(null)}
          images={setupLightbox.images}
          initialIndex={0}
          title={setupLightbox.title}
          subtitle={setupLightbox.subtitle}
        />
      )}
    </div>
  );
};
