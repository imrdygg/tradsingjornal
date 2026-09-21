import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  PencilLine,
  Trash2,
  Check,
  Layers,
  ImageIcon,
  ZoomIn,
  Play,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  NotebookPen,
  Target,
  TrendingUp,
  TrendingDown,
  HelpCircle,
  Clock,
  BookOpen,
  Scale,
  Minus,
} from 'lucide-react';
import {
  Trade,
  Instrument,
  TradeExecutionReview,
  QuestionAnswer,
  TradeManagement,
} from '../../types';
import { ModalOverlay } from '../common/ModalOverlay';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { calculateTradeRuleFollowing } from '../../lib/analytics/discipline';
import { findInstrument } from '../../lib/trading/instruments';
import { formatTimestamp } from '../../lib/storage/date-utils';
import { isVideoUrl } from '../../lib/media/media-utils';
import type { TradePositionGroup } from '../../lib/trading/position-groups';
import { hasAssumedRisk } from '../../lib/trading/risk-fixup';
import { compareEntry, verdictLabel, type ComparisonVerdict } from '../../lib/ai/entry-comparison';

/**
 * The execution review questions, in the order they are asked when closing a
 * trade. `wouldTakeAgain` is collected but deliberately excluded from the
 * discipline score (see calculateTradeRuleFollowing).
 */
const REVIEW_QUESTIONS: Array<{
  key: keyof Omit<TradeExecutionReview, 'id' | 'tradeId'>;
  label: string;
  desired: 'yes' | 'no';
}> = [
  { key: 'followedSetup', label: 'Followed the setup?', desired: 'yes' },
  { key: 'followedStop', label: 'Followed the initial stop?', desired: 'yes' },
  { key: 'chasedEntry', label: 'Chased the entry?', desired: 'no' },
  { key: 'revengeTrade', label: 'Revenge traded?', desired: 'no' },
  { key: 'addedUnnecessaryRisk', label: 'Added unnecessary risk?', desired: 'no' },
  { key: 'movedStopEmotion', label: 'Moved the stop out of emotion?', desired: 'no' },
  { key: 'letWinnerWork', label: 'Let a valid winner work?', desired: 'yes' },
  { key: 'wouldTakeAgain', label: 'Would you take this trade again?', desired: 'yes' },
];

import { findPatternBySetupName } from '../../lib/playbook/patterns';

interface TradeDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  trade: Trade | null;
  instruments: Instrument[];
  positionGroup?: TradePositionGroup;
  onEdit?: (trade: Trade) => void;
  onCloseTrade?: (trade: Trade) => void;
  onDelete?: (tradeId: string) => void;
  /** Saves a freshly completed execution review for a closed trade. */
  onSaveExecutionReview?: (tradeId: string, review: TradeExecutionReview) => void;
  /** Opens the matching chart pattern in the Playbook, when this trade's setup has one. */
  onStudyPattern?: (patternId: string) => void;
}

const money = (value: number) =>
  `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const answerCopy = (answer: QuestionAnswer) =>
  answer === 'yes' ? 'Yes' : answer === 'no' ? 'No' : 'N/A';

/** A price for the record, or a dash when the coach gave none. */
const figure = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toFixed(2);

const COACH_VERDICTS: Record<
  ComparisonVerdict,
  { className: string; icon: React.ReactNode }
> = {
  agreed: {
    className: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
    icon: <Check className="w-3.5 h-3.5" strokeWidth={3} />,
  },
  opposed: {
    className: 'bg-rose-950/70 text-rose-300 border-rose-800',
    icon: <X className="w-3.5 h-3.5" strokeWidth={3} />,
  },
  'coach-flat': {
    className: 'bg-amber-950/70 text-amber-300 border-amber-800',
    icon: <Minus className="w-3.5 h-3.5" strokeWidth={3} />,
  },
  'no-call': {
    className: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    icon: <Minus className="w-3.5 h-3.5" />,
  },
};

function formatDuration(startIso?: string, endIso?: string): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return null;
  const minutes = Math.round((end - start) / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Small labelled block used throughout the detail view. */
const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'emerald' | 'amber';
}> = ({ title, icon, children, tone = 'default' }) => (
  <div
    className={`rounded-xl border p-3.5 space-y-2.5 ${
      tone === 'emerald'
        ? 'border-emerald-900/60 bg-emerald-950/15'
        : tone === 'amber'
        ? 'border-amber-900/50 bg-amber-950/15'
        : 'border-zinc-800 bg-zinc-950/60'
    }`}
  >
    <h4 className="text-[11px] font-bold uppercase tracking-wider font-mono text-zinc-300 flex items-center gap-1.5">
      {icon}
      {title}
    </h4>
    {children}
  </div>
);

const Metric: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({
  label,
  value,
  sub,
}) => (
  <div className="rounded-lg bg-zinc-950/80 border border-zinc-800/80 p-2.5">
    <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
      {label}
    </span>
    <span className="text-sm font-bold font-mono text-zinc-100 block">{value}</span>
    {sub && <span className="text-[10px] text-zinc-500 font-mono block">{sub}</span>}
  </div>
);

export const TradeDetailModal: React.FC<TradeDetailModalProps> = ({
  isOpen,
  onClose,
  trade,
  instruments,
  positionGroup,
  onEdit,
  onCloseTrade,
  onDelete,
  onSaveExecutionReview,
  onStudyPattern,
}) => {
  // A trade's setup links to a playbook pattern only on an exact source-label match.
  const canStudyPattern = useMemo(
    () => (onStudyPattern ? findPatternBySetupName(trade?.setupName) : undefined),
    [onStudyPattern, trade?.setupName]
  );

  // Draft answers for completing a missing review.
  const [draft, setDraft] = useState<Record<string, QuestionAnswer>>({});
  // A CSV has no stop, so an imported trade's risk is a placeholder until it is set.
  const assumedRisk = trade ? hasAssumedRisk(trade) : false;
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the per-trade UI whenever a different trade is opened.
  useEffect(() => {
    if (!isOpen) return;
    setDraft({});
    setIsReviewOpen(false);
    setLightboxIndex(null);
    setConfirmDelete(false);
  }, [isOpen, trade?.id]);

  const instrument = useMemo(
    () => (trade ? findInstrument(instruments, trade.instrumentId) : instruments[0]),
    [instruments, trade]
  );

  if (!isOpen || !trade) return null;

  const isClosed = trade.status === 'closed';
  const isLong = trade.direction === 'long';
  const review = trade.executionReview;
  const ruleFollowing = calculateTradeRuleFollowing(review);
  const management: TradeManagement | undefined = trade.tradeManagement;

  const attachments =
    trade.images && trade.images.length > 0
      ? trade.images
      : trade.screenshotPath
      ? [trade.screenshotPath]
      : [];

  const duration = formatDuration(trade.entryTime, trade.exitTime);
  const pnlPositive = trade.grossPnL > 0;

  const handleSaveReview = () => {
    if (!onSaveExecutionReview) return;
    const answers = REVIEW_QUESTIONS.reduce((acc, q) => {
      acc[q.key] = draft[q.key] ?? q.desired;
      return acc;
    }, {} as Record<string, QuestionAnswer>);

    onSaveExecutionReview(trade.id, {
      id: review?.id ?? `review-${trade.id}`,
      tradeId: trade.id,
      ...answers,
    } as TradeExecutionReview);
    setIsReviewOpen(false);
  };

  const legs = positionGroup?.trades ?? [];
  const isMultiLeg = (positionGroup?.legCount ?? 1) > 1;

  /** The coach's recorded call on this entry, or null when it never made one. */
  const coachComparison = compareEntry(trade);

  /**
   * The risk slot this trade was recorded against, and how close the size came to it.
   *
   * `riskTier` is a number for slots #1–#4 and null for a custom amount; undefined means
   * the trade predates the ladder (an import, or an older record), so no slot is shown
   * rather than one being guessed at.
   */
  const hasRiskSlot = typeof trade.riskTier === 'number' || trade.riskTier === null;
  const slotName = typeof trade.riskTier === 'number' ? `Trade #${trade.riskTier}` : 'Custom risk';
  const riskTarget = trade.plannedRisk ?? null;
  const riskDiff =
    riskTarget !== null ? Math.round((trade.initialRisk - riskTarget) * 100) / 100 : null;
  // An invented stop makes the actual risk a placeholder, so it is never called on-plan.
  const riskOnPlan = riskDiff !== null && !assumedRisk && Math.abs(riskDiff) <= 0.01;

  return (
    <ModalOverlay onRequestClose={onClose} label="Trade detail">
      <div
        id="trade-detail-modal"
        className="relative my-6 w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                  isLong
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                }`}
              >
                {isLong ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {trade.direction}
              </span>
              <h2 className="text-sm sm:text-base font-bold text-zinc-100">
                {instrument.symbol} {trade.contracts}x
              </h2>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full font-mono ${
                  isClosed
                    ? 'bg-zinc-800 text-zinc-300'
                    : 'bg-amber-950/80 border border-amber-800 text-amber-300'
                }`}
              >
                {isClosed ? 'Closed' : 'Open'}
              </span>
              {hasRiskSlot && (
                <span
                  data-trade-risk-slot={typeof trade.riskTier === 'number' ? trade.riskTier : 'custom'}
                  title="The risk slot this trade was taken against"
                  className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-900 font-mono text-zinc-300"
                >
                  {slotName}
                  {riskTarget !== null ? ` · $${riskTarget}` : ''}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400">
              {trade.setupName ? `${trade.setupName} · ` : ''}
              {trade.session} · Entered {formatTimestamp(trade.entryTime)}
              {trade.exitTime ? ` · Exited ${formatTimestamp(trade.exitTime)}` : ''}
            </p>
            {/*
              Where the setup this trade was logged under is also a chart pattern in the
              playbook, offer the study page. Matched on the exact source label only: a
              near-match would send the trader to the wrong chart, which is worse than no
              link at all.
            */}
            {canStudyPattern && (
              <button
                type="button"
                id="trade-study-pattern"
                onClick={() => onStudyPattern?.(canStudyPattern.id)}
                className="flex items-center gap-1 text-[11px] text-emerald-400 transition-colors hover:text-emerald-300"
              >
                <BookOpen className="h-3 w-3" />
                Study this pattern
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {/* Blended position summary */}
          {isMultiLeg && positionGroup && (
            <Section title="This position" icon={<Layers className="w-3.5 h-3.5 text-emerald-400" />} tone="emerald">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric label="Legs" value={positionGroup.legCount} />
                <Metric label="Total size" value={`${positionGroup.totalContracts} ${instrument.symbol}`} />
                <Metric label="Avg entry" value={positionGroup.averageEntry.toFixed(2)} />
                <Metric
                  label={positionGroup.allClosed ? 'Combined P&L' : 'Combined risk'}
                  value={
                    positionGroup.allClosed
                      ? money(positionGroup.realizedPnL)
                      : money(positionGroup.totalInitialRisk)
                  }
                />
              </div>

              <div className="space-y-1.5 pt-1">
                {legs.map((leg) => (
                  <div
                    key={leg.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono ${
                      leg.id === trade.id
                        ? 'border-emerald-800/70 bg-emerald-950/20 text-emerald-200'
                        : 'border-zinc-800 bg-zinc-950/60 text-zinc-400'
                    }`}
                  >
                    <span>
                      Leg {positionGroup.legIndex(leg.id)} · {leg.contracts}x @{' '}
                      {leg.entryPrice.toFixed(2)}
                      {leg.exitPrice !== undefined
                        ? ` → ${leg.exitPrice.toFixed(2)}`
                        : ' (open)'}
                    </span>
                    <span className={leg.grossPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {leg.status === 'closed' ? money(leg.grossPnL) : 'In trade'}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* The numbers */}
          <Section title="Execution" icon={<Target className="w-3.5 h-3.5 text-zinc-400" />}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Entry" value={trade.entryPrice.toFixed(2)} />
              <Metric label="Initial stop" value={trade.initialStop.toFixed(2)} />
              <Metric
                label="Exit"
                value={trade.exitPrice !== undefined ? trade.exitPrice.toFixed(2) : '—'}
                sub={
                  trade.pointsPnL !== undefined && isClosed
                    ? `${trade.pointsPnL > 0 ? '+' : ''}${trade.pointsPnL.toFixed(2)} pts`
                    : undefined
                }
              />
              <Metric
                label="Gross P&L"
                value={
                  <span className={pnlPositive ? 'text-emerald-400' : trade.grossPnL < 0 ? 'text-rose-400' : ''}>
                    {isClosed ? money(trade.grossPnL) : 'Open'}
                  </span>
                }
                sub={
                  isClosed && trade.rMultiple !== undefined
                    ? `${trade.rMultiple > 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R`
                    : undefined
                }
              />
              <Metric
                label="Initial risk"
                value={
                  <span className={assumedRisk ? 'text-amber-300' : undefined}>
                    {money(trade.initialRisk)}
                  </span>
                }
                sub={assumedRisk ? 'assumed stop — not real' : undefined}
              />
              <Metric label="Duration" value={duration ?? '—'} />
              <Metric
                label="Instrument"
                value={instrument.symbol}
                sub={`${money(instrument.pointValue)}/pt`}
              />
              <Metric
                label="Source"
                value={trade.source === 'tradovate_csv' ? 'CSV import' : 'Manual'}
              />
            </div>
          </Section>

          {/*
            The slot the trade was taken against and what it actually cost. Kept apart from
            the execution numbers above because this is the discipline question — did the
            size match the plan — rather than a description of the fill.
          */}
          {hasRiskSlot && (
            <Section
              title="Risk plan"
              icon={<ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />}
              tone={assumedRisk ? 'default' : riskOnPlan ? 'emerald' : 'amber'}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric
                  label="Trade #"
                  value={typeof trade.riskTier === 'number' ? `#${trade.riskTier}` : 'Custom'}
                  sub={typeof trade.riskTier === 'number' ? 'fixed slot' : 'custom amount'}
                />
                <Metric
                  label="Target risk"
                  value={riskTarget !== null ? money(riskTarget) : '—'}
                  sub={riskTarget === null ? 'no amount recorded' : 'from your plan'}
                />
                <Metric
                  label="Actual risk"
                  value={
                    <span className={assumedRisk ? 'text-amber-300' : undefined}>
                      {money(trade.initialRisk)}
                    </span>
                  }
                  sub={assumedRisk ? 'assumed stop — not real' : undefined}
                />
                <Metric
                  label="Vs. target"
                  value={
                    riskDiff === null ? (
                      '—'
                    ) : (
                      <span className={riskOnPlan ? 'text-emerald-400' : 'text-amber-300'}>
                        {riskDiff > 0 ? '+' : ''}
                        {money(riskDiff)}
                      </span>
                    )
                  }
                  sub={
                    riskDiff === null
                      ? undefined
                      : riskOnPlan
                      ? 'on plan'
                      : riskDiff > 0
                      ? 'over the slot'
                      : 'under the slot'
                  }
                />
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-400">
                {assumedRisk
                  ? 'This trade came from a broker CSV, which carries no stop, so its risk is a placeholder and cannot be compared with its slot yet. Set the real stop in Settings → Fix imported risk.'
                  : riskDiff === null || riskTarget === null
                  ? `No target amount was recorded against this ${slotName.toLowerCase()}.`
                  : riskOnPlan
                  ? `Sized to its slot — the risk on this trade matches the ${money(
                      riskTarget
                    )} the slot allows.`
                  : riskDiff > 0
                  ? `Took ${money(riskDiff)} more risk than the ${money(
                      riskTarget
                    )} its slot allows.`
                  : `Took ${money(Math.abs(riskDiff))} less risk than the ${money(
                      riskTarget
                    )} its slot allows.`}
              </p>
            </Section>
          )}

          {/*
            The coach's call at entry, laid out against the fill it was compared with.

            Shown in full here rather than as the chip the log uses, because this is the
            view you open to read the record: the reasoning, the levels it was built from
            and the moment it was made all belong together, and the call is labelled as one
            opinion rather than a verdict on the trade.
          */}
          {coachComparison ? (
            <Section
              title="Coach's call on this entry"
              icon={<Scale className="w-3.5 h-3.5 text-amber-400" />}
              tone={coachComparison.verdict === 'opposed' ? 'default' : 'amber'}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold uppercase font-mono ${COACH_VERDICTS[coachComparison.verdict].className}`}
                >
                  {COACH_VERDICTS[coachComparison.verdict].icon}
                  {verdictLabel(coachComparison.verdict)}
                </span>
                <span className="text-[11px] text-zinc-300">
                  {coachComparison.coachDirection === 'flat'
                    ? `You took the ${trade.direction} at ${figure(trade.entryPrice)}; the coach would have stood aside.`
                    : `You took the ${trade.direction} at ${figure(
                        trade.entryPrice
                      )}; the coach was ${coachComparison.coachDirection?.toUpperCase()} at ${figure(
                        coachComparison.coachEntry
                      )}.`}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Metric label="Your fill" value={figure(trade.entryPrice)} />
                <Metric
                  label="Coach entry"
                  value={
                    coachComparison.coachDirection === 'flat'
                      ? 'stood aside'
                      : figure(coachComparison.coachEntry)
                  }
                />
                <Metric
                  label="Your edge"
                  value={
                    coachComparison.priceEdge === null ? (
                      '—'
                    ) : (
                      <span
                        className={
                          coachComparison.priceEdge >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {coachComparison.priceEdge >= 0 ? '+' : ''}
                        {coachComparison.priceEdge} pts
                      </span>
                    )
                  }
                  sub={
                    coachComparison.priceEdge === null
                      ? undefined
                      : coachComparison.priceEdge >= 0
                      ? 'your fill was better'
                      : 'your fill was worse'
                  }
                />
                <Metric label="Coach stop" value={figure(trade.coachCall?.stop)} />
                <Metric label="Coach target" value={figure(trade.coachCall?.target)} />
              </div>

              {trade.coachCall?.rationale && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2.5">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
                    Its reasoning
                  </span>
                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-line">
                    {trade.coachCall.rationale}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-zinc-500">
                {trade.coachCall?.createdAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Called at entry · {formatTimestamp(trade.coachCall.createdAt)}
                  </span>
                )}
                {trade.coachCall?.marketPrice !== null &&
                  trade.coachCall?.marketPrice !== undefined && (
                    <span>
                      Live {instrument.symbol} at the time: {figure(trade.coachCall.marketPrice)}
                    </span>
                  )}
              </div>

              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Recorded at the moment you saved the entry, so it was made without knowing how the
                trade ended. It is one opinion drawn from the live numbers above — not advice, and
                not a verdict on the trade. The P&amp;L is decided by what you did next.
              </p>
            </Section>
          ) : trade.source === 'manual' ? (
            <Section
              title="Coach's call on this entry"
              icon={<Scale className="w-3.5 h-3.5 text-zinc-400" />}
            >
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                No call was recorded for this entry. One is stored automatically when you save a
                new entry with the coach service available, and compared with your fill here and in
                Analytics.
              </p>
            </Section>
          ) : null}

          {/* What the trader wrote */}
          <Section title="Your notes" icon={<NotebookPen className="w-3.5 h-3.5 text-amber-400" />}>
            {trade.entryReason || trade.notes || (trade.tags && trade.tags.length > 0) ? (
              <div className="space-y-2.5 text-xs">
                {trade.entryReason && (
                  <div>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
                      Entry reason
                    </span>
                    <p className="text-zinc-200 leading-relaxed whitespace-pre-line">
                      {trade.entryReason}
                    </p>
                  </div>
                )}
                {trade.notes && (
                  <div>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 block">
                      Notes
                    </span>
                    <p className="text-zinc-300 leading-relaxed whitespace-pre-line">
                      {trade.notes}
                    </p>
                  </div>
                )}
                {trade.tags && trade.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {trade.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Nothing written for this trade yet. Use <strong className="text-zinc-300">Edit</strong>{' '}
                to add an entry reason and notes — future-you will want to know why you took it.
              </p>
            )}
          </Section>

          {/* Management */}
          {management &&
            (management.breakevenPrice !== undefined ||
              management.profitSecured !== undefined ||
              management.trailingMethod ||
              management.notes) && (
              <Section
                title="Trade management"
                icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {management.breakevenPrice !== undefined && (
                    <Metric
                      label="Moved to break-even"
                      value={management.breakevenPrice.toFixed(2)}
                      sub={management.breakevenTime ? formatTimestamp(management.breakevenTime) : undefined}
                    />
                  )}
                  {management.profitSecured !== undefined && (
                    <Metric label="Profit secured" value={money(management.profitSecured)} />
                  )}
                  {management.trailingMethod && (
                    <Metric label="Trailing" value={management.trailingMethod} />
                  )}
                </div>
                {management.notes && (
                  <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-line">
                    {management.notes}
                  </p>
                )}
              </Section>
            )}

          {/* Attachments */}
          <Section
            title={`Charts & video (${attachments.length})`}
            icon={<ImageIcon className="w-3.5 h-3.5 text-zinc-400" />}
          >
            {attachments.length > 0 ? (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {attachments.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 hover:border-emerald-500/70 transition-all"
                    title={isVideoUrl(item) ? 'Play video' : 'View chart'}
                  >
                    {isVideoUrl(item) ? (
                      <>
                        <video
                          src={item}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-emerald-300">
                          <Play className="w-4 h-4 fill-current" />
                        </span>
                      </>
                    ) : (
                      <>
                        <img
                          src={item}
                          alt={`Attachment ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 text-emerald-400">
                          <ZoomIn className="w-4 h-4" />
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500">
                No charts or clips attached to this trade.
              </p>
            )}
          </Section>

          {/* Discipline / execution review */}
          <Section
            title="Execution review & discipline"
            icon={<ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />}
            tone={ruleFollowing ? (ruleFollowing.followedAll ? 'emerald' : 'amber') : 'default'}
          >
            {ruleFollowing && review ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold font-mono border ${
                      ruleFollowing.followedAll
                        ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                        : 'bg-amber-950/70 text-amber-300 border-amber-800'
                    }`}
                  >
                    {ruleFollowing.followedAll ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    {ruleFollowing.score}% discipline
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    {ruleFollowing.followedAll
                      ? 'Every scored rule followed.'
                      : 'Some rules were broken — that is what this journal is for.'}
                  </span>
                </div>

                <div className="space-y-1">
                  {REVIEW_QUESTIONS.map((question) => {
                    const answer = review[question.key];
                    const scored = question.key !== 'wouldTakeAgain';
                    const followed = answer === question.desired;
                    return (
                      <div
                        key={question.key}
                        className="flex items-center justify-between gap-2 text-[11px] py-0.5"
                      >
                        <span className="text-zinc-400">{question.label}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          {scored && answer !== 'na' && (
                            <span
                              className={
                                followed ? 'text-emerald-400' : 'text-amber-400'
                              }
                              title={followed ? 'Followed' : 'Broken'}
                            >
                              {followed ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <AlertTriangle className="w-3 h-3" />
                              )}
                            </span>
                          )}
                          <span className="font-mono text-zinc-300 w-8 text-right">
                            {answerCopy(answer)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : !isClosed ? (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                This trade is still open. You will be asked these questions when you close it.
              </p>
            ) : !onSaveExecutionReview ? (
              <p className="text-[11px] text-amber-300 leading-relaxed">
                Review pending — no discipline score yet.
              </p>
            ) : isReviewOpen ? (
              <div className="space-y-2.5">
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Answer honestly — the score only means something if it reflects what you really
                  did.
                </p>
                {REVIEW_QUESTIONS.map((question) => {
                  const value = draft[question.key] ?? question.desired;
                  return (
                    <div
                      key={question.key}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs py-0.5"
                    >
                      <span className="text-zinc-300">{question.label}</span>
                      <div className="flex items-center gap-1">
                        {(['yes', 'no', 'na'] as QuestionAnswer[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() =>
                              setDraft((prev) => ({ ...prev, [question.key]: option }))
                            }
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase font-mono border transition-colors ${
                              value === option
                                ? option === 'yes'
                                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700'
                                  : option === 'no'
                                  ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                                  : 'bg-zinc-800 text-zinc-300 border-zinc-600'
                                : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'
                            }`}
                            aria-label={`${question.label} ${answerCopy(option)}`}
                          >
                            {answerCopy(option)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setIsReviewOpen(false)}
                    className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="save-execution-review"
                    onClick={handleSaveReview}
                    className="rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 px-3.5 py-1.5 text-[11px] font-bold"
                  >
                    Save review
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  <HelpCircle className="w-3 h-3 inline mr-1" />
                  Review pending — no discipline score for this trade yet.
                </p>
                <button
                  type="button"
                  id="start-execution-review"
                  onClick={() => setIsReviewOpen(true)}
                  className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-600/70 px-3 py-1.5 text-[11px] font-semibold transition-colors"
                >
                  Complete review
                </button>
              </div>
            )}
          </Section>

          {/* Timestamps for the record */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Created {formatTimestamp(trade.createdAt)}
            </span>
            <span>Updated {formatTimestamp(trade.updatedAt)}</span>
            <span className="truncate">ID {trade.id}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-3">
          <div className="flex items-center gap-2">
            {!isClosed && onCloseTrade && (
              <button
                type="button"
                onClick={() => onCloseTrade(trade)}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-700/70 px-3 py-2 text-xs font-semibold transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Close trade
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(trade)}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors"
              >
                <PencilLine className="w-3.5 h-3.5" />
                Edit trade
              </button>
            )}
          </div>

          {onDelete && (
            <div className="flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-[11px] text-rose-300">Delete permanently?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(trade.id);
                      onClose();
                    }}
                    className="rounded-xl bg-rose-600 hover:bg-rose-500 text-white px-3 py-2 text-xs font-semibold transition-colors"
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-500 hover:text-rose-400 hover:border-rose-900/70 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full-size charts / video */}
      <ImageLightboxModal
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        images={attachments}
        initialIndex={lightboxIndex !== null ? lightboxIndex : 0}
        title={`${trade.direction.toUpperCase()} ${instrument.symbol} @ ${trade.entryPrice.toFixed(2)}`}
        subtitle={`${trade.session}${trade.setupName ? ` • ${trade.setupName}` : ''}`}
      />
    </ModalOverlay>
  );
};
