import React, { useEffect, useMemo, useState } from 'react';
import {
  Lock,
  AlertTriangle,
  RefreshCw,
  LayoutDashboard,
  ShieldCheck,
  Target,
  Eye,
  CalendarClock,
  Tag,
  ShieldAlert,
  FileText,
  Clock,
  Layers,
} from 'lucide-react';
import { TradingDay, Instrument, Trade, DailyReview, Setup } from '../../types';
import { ModalOverlay } from '../common/ModalOverlay';
import { findInstrument, instrumentSymbol } from '../../lib/trading/instruments';
import { DEFAULT_RISK_TIER_AMOUNTS, normalizeTierCaps } from '../../lib/trading/risk-tiers';
import { money } from '../coach/coach-ui';
import { requestCoach, CoachErrorCode, CoachResult } from '../../lib/ai/coach-client';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { PlanReviewResponse } from '../../lib/ai/coach-types';
import type { MarketBrief, SectorQuote } from '../../lib/ai/market-data';
import { heatBand, heatBandStyle, formatSignedPercent } from '../../lib/ai/market-data';
import {
  assessPlannedSize,
  assessRiskCapacity,
  drawdownShortfall,
  estimateStopDistance,
} from '../../lib/analytics/risk-capacity';

/**
 * The plan lock preview.
 *
 * Locking the plan is the moment the day's risk is committed, so the trader gets one
 * last look at what they are about to commit to, alongside two things the form cannot
 * tell them: how every sector is trading right now, and an honest coach opinion of the
 * plan built from that market read plus their own journal.
 *
 * Nothing here blocks the lock: if the market brief or the coach fails, the trader can
 * still lock, because locking must never depend on a network service being up.
 */

interface PlanLockPreviewModalProps {
  isOpen: boolean;
  day: TradingDay;
  instruments: Instrument[];
  trades: Trade[];
  reviews: DailyReview[];
  setups: Setup[];
  timezone: string;
  /** The account drawdown the trader has agreed to, so the review can weigh the plan's risk. */
  maxDrawdown?: number | null;
  /** The trader's risk ladder, so the lock shows what each Trade # risks. */
  riskTiers?: number[];
  onConfirm: () => void;
  onBack: () => void;
}

interface MarketState {
  loading: boolean;
  brief: MarketBrief | null;
  error: string | null;
}

interface ReviewState {
  loading: boolean;
  result: CoachResult | null;
}

const VERDICT_STYLES: Record<PlanReviewResponse['verdict'], { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-emerald-950/80 text-emerald-300 border-emerald-800' },
  workable: { label: 'Workable', className: 'bg-amber-950/80 text-amber-300 border-amber-800' },
  shaky: { label: 'Shaky', className: 'bg-rose-950/80 text-rose-300 border-rose-800' },
};

/** One tile of the sector heat map. */
const HeatTile: React.FC<{ quote: SectorQuote }> = ({ quote }) => {
  const band = heatBand(quote.changePercent);
  return (
    <div
      className={`rounded-lg border px-2 py-2 text-center ${heatBandStyle(band)}`}
      title={`${quote.label} (${quote.symbol}) ${formatSignedPercent(quote.changePercent)} vs previous close`}
      data-testid={`heat-${quote.symbol}`}
    >
      <div className="text-[10px] font-bold font-mono uppercase truncate">{quote.symbol}</div>
      <div className="text-[9px] opacity-70 truncate leading-tight">{quote.label}</div>
      <div className="text-xs font-bold font-mono mt-0.5">
        {formatSignedPercent(quote.changePercent)}
      </div>
    </div>
  );
};

export const PlanLockPreviewModal: React.FC<PlanLockPreviewModalProps> = ({
  isOpen,
  day,
  instruments,
  trades,
  reviews,
  setups,
  timezone,
  maxDrawdown,
  riskTiers = DEFAULT_RISK_TIER_AMOUNTS,
  onConfirm,
  onBack,
}) => {
  /** The per-slot caps in force, so the lock shows the whole risk plan it commits to. */
  const tierCaps = normalizeTierCaps(day.riskTierCaps);

  const [market, setMarket] = useState<MarketState>({ loading: false, brief: null, error: null });
  const [review, setReview] = useState<ReviewState>({ loading: false, result: null });

  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays: [day],
        reviews,
        setups,
        instruments,
        todayTradeDate: day.tradeDate,
        timezone,
        maxDrawdown,
      }),
    [trades, day, reviews, setups, instruments, timezone, maxDrawdown]
  );

  /**
   * The account's floor against the loss this lock would commit to.
   *
   * Computed from the whole closed record, like the Today strip and the Analytics panel, so
   * the three can never disagree about the same account.
   */
  const capacity = assessRiskCapacity({
    trades: trades.filter((t) => t.status === 'closed'),
    maxDrawdown: maxDrawdown ?? null,
    dailyLossLimit: day.plannedLossLimit,
  });
  const planShortfall = drawdownShortfall(capacity, day.plannedLossLimit);

  /**
   * The size this lock commits to, priced at the trader's own stop distance — the same
   * check the form and the Today strip run, from the same functions.
   */
  const instrument = findInstrument(instruments, day.primaryInstrument);
  const plannedSize = assessPlannedSize({
    capacity,
    contracts: day.contractsPlanned,
    pointValue: instrument.pointValue,
    symbol: instrumentSymbol(instruments, instrument.id),
    stopDistance: estimateStopDistance({
      openTrades: trades.filter((t) => t.status === 'open'),
      closedTrades: trades.filter((t) => t.status === 'closed'),
      instrumentId: instrument.id,
    }),
  });

  // The market grid and the coach opinion load in parallel; either can finish alone.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    setMarket({ loading: true, brief: null, error: null });
    setReview({ loading: true, result: null });

    const marketPromise = (async () => {
      try {
        const res = await fetch('/api/market');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as MarketBrief & { error?: string };
        if (payload && Array.isArray(payload.quotes)) {
          if (!cancelled) setMarket({ loading: false, brief: payload, error: null });
          return;
        }
        throw new Error(payload?.error || 'empty market payload');
      } catch (err) {
        if (!cancelled)
          setMarket({
            loading: false,
            brief: null,
            error:
              'Sector data could not be loaded. The coach will still review the plan — without today\'s market read.',
          });
      }
    })();

    const reviewPromise = (async () => {
      const result = await requestCoach('planreview', digest);
      if (!cancelled) setReview({ loading: false, result });
    })();

    void marketPromise;
    void reviewPromise;

    return () => {
      cancelled = true;
    };
    // Re-run only when the modal opens for a plan; the digest is rebuilt for each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, day.id]);

  const reviewData =
    review.result?.ok && 'verdict' in review.result.data
      ? (review.result.data as PlanReviewResponse)
      : null;

  const breadth = useMemo(() => {
    const quotes = market.brief?.quotes ?? [];
    return {
      up: quotes.filter((quote) => {
        const band = heatBand(quote.changePercent);
        return band === 'up' || band === 'up-strong';
      }).length,
      down: quotes.filter((quote) => {
        const band = heatBand(quote.changePercent);
        return band === 'down' || band === 'down-strong';
      }).length,
    };
  }, [market.brief]);

  // Nothing renders while closed — an always-mounted overlay would block the whole
  // page behind an invisible backdrop, which is exactly how the e2e suite caught it.
  if (!isOpen) return null;

  return (
    <ModalOverlay
      backdropClassName="bg-black/85 backdrop-blur-sm"
      onRequestClose={onBack}
      label={`Plan lock preview — ${day.tradeDate}`}
    >
      <div className="relative my-6 w-full max-w-3xl space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-2">
              <Lock className="w-5 h-5 text-emerald-400" />
              Before you lock — {day.tradeDate}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              A last look at the plan, the market's breadth right now, and an honest coach opinion.
            </p>
          </div>
        </div>

        {/* 1. The day's plan, read-only — the whole thing the lock commits to, not a summary */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-300" />
              The plan you are locking
            </span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">
              bias: <span className="text-zinc-300">{day.marketBias}</span> · risk mode:{' '}
              <span className="text-zinc-300">{day.riskMode}</span>
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase font-mono">Max loss</span>
              <span className="text-zinc-100 font-mono font-bold">
                {money(day.plannedLossLimit)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase font-mono">Contracts</span>
              <span className="text-zinc-100 font-mono font-bold">{day.contractsPlanned}</span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase font-mono">Primary</span>
              <span className="text-zinc-100 font-mono font-bold">
                {instrumentSymbol(instruments, day.primaryInstrument)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 block uppercase font-mono">Sessions</span>
              <span className="text-zinc-100 font-mono font-bold">
                {(day.allowedSessions || []).length}
              </span>
            </div>
          </div>

          {/* What each numbered slot risks, with the one the trade form will open on. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-2 border-t border-zinc-800/70">
            <span className="text-zinc-500 uppercase font-mono text-[10px] flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-zinc-400" />
              Trade ladder
            </span>
            {riskTiers.map((amount, index) => {
              const tier = index + 1;
              const isDefault = (day.defaultRiskTier ?? 1) === tier;
              const cap = tierCaps[index];
              return (
                <span
                  key={tier}
                  data-testid={`lock-trade-tier-${tier}`}
                  className={`rounded-lg border px-2 py-0.5 font-mono text-[11px] ${
                    isDefault
                      ? 'border-emerald-700 bg-emerald-950/50 text-emerald-200 font-bold'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-300'
                  }`}
                  title={isDefault ? 'Default Trade # when recording a trade' : undefined}
                >
                  #{tier} ${amount}
                  {isDefault ? ' · default' : ''}
                  {cap > 0 ? ` · max ${cap}` : ''}
                </span>
              );
            })}
            <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
              custom
            </span>
          </div>

          {/*
            The account's floor against the loss this lock commits to. Shown here because
            this is the last moment before the day's risk becomes a decision rather than a
            draft, and it is the one comparison the form's own limit cannot make.
          */}
          {planShortfall && (
            <div
              className="flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-2.5 py-2 text-[10px] leading-relaxed text-rose-200"
              role="alert"
              data-testid="lock-drawdown-warning"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
              <span>
                <span className="font-bold uppercase tracking-wider text-[10px] block">
                  This plan exceeds the drawdown room
                </span>
                {planShortfall.limitReached
                  ? `The agreed ${money(maxDrawdown ?? 0)} drawdown is already spent, so this ${money(planShortfall.plannedLoss)} loss has no room behind it.`
                  : `Locking a ${money(planShortfall.plannedLoss)} loss against ${money(
                      planShortfall.headroom
                    )} of remaining drawdown room leaves the account ${money(
                      planShortfall.over
                    )} short if the day goes to the limit.`}
              </span>
            </div>
          )}

          {plannedSize && (
            <div
              className="flex items-start gap-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-2.5 py-2 text-[10px] leading-relaxed text-rose-200"
              role="alert"
              data-testid="lock-size-drawdown-warning"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
              <span>
                <span className="font-bold uppercase tracking-wider text-[10px] block">
                  This size is larger than the drawdown room
                </span>
                Locking {plannedSize.contracts} {plannedSize.symbol} at your{' '}
                {plannedSize.stopPoints}-point stop risks {money(plannedSize.dollarsAtRisk)} if
                the stop is honoured, against {money(plannedSize.headroom)} of remaining room.
              </span>
            </div>
          )}

          {/* Sessions and the watch list, spelled out rather than counted. */}
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/70">
            <div>
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                Sessions allowed
              </span>
              <span className="text-[11px] text-zinc-300 leading-relaxed">
                {(day.allowedSessions || []).length
                  ? (day.allowedSessions || []).join(' · ')
                  : 'no session selected'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 uppercase font-mono text-[10px] block">
                Setups watched
              </span>
              <span className="text-[11px] text-zinc-300 leading-relaxed">
                {(day.watchedSetups || []).length
                  ? (day.watchedSetups || []).join(', ')
                  : 'no setups selected'}
              </span>
            </div>
          </div>

          {/* Key levels — the prices the plan is built around. */}
          <div className="pt-2 border-t border-zinc-800/70">
            <span className="text-zinc-500 uppercase font-mono text-[10px] flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-zinc-400" />
              Important price levels
            </span>
            {(day.importantLevels || []).length ? (
              <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {(day.importantLevels || []).map((level) => (
                  <li key={level.id} className="flex items-baseline gap-2 text-[11px]">
                    <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono font-bold text-zinc-100">
                      {level.price.toFixed(2)}
                    </span>
                    {level.label && <span className="text-zinc-300 truncate">{level.label}</span>}
                    {level.notes && (
                      <span className="text-zinc-500 italic truncate">— {level.notes}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-500">No key levels marked for today.</p>
            )}
          </div>

          {/* The two questions that decide whether a trade is taken at all. */}
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/70">
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              <span className="text-zinc-500 uppercase font-mono text-[10px] flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-zinc-400" />
                What am I waiting for?
              </span>
              {day.waitingFor ? day.waitingFor : 'nothing written'}
            </p>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              <span className="text-zinc-500 uppercase font-mono text-[10px] flex items-center gap-1.5">
                <ShieldAlert className="w-3 h-3 text-zinc-400" />
                Stay out if
              </span>
              {day.stayOutIf ? day.stayOutIf : 'no stay-out rule written'}
            </p>
          </div>

          <p className="text-[11px] text-zinc-400 leading-relaxed pt-2 border-t border-zinc-800/70">
            <span className="text-zinc-500 uppercase font-mono text-[10px] flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-zinc-400" />
              Notes
            </span>
            {day.notes ? day.notes : 'no notes for today'}
          </p>

          {/* Expanded risk: the written reason this day is allowed more than the normal limit. */}
          {day.riskMode === 'expanded' && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-2.5 space-y-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                Expanded risk — why this day is bigger
              </span>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                Normal limit {money(day.normalLossLimit)} → today {money(day.plannedLossLimit)}
              </p>
              {day.profitCushionContext && (
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Cushion: {day.profitCushionContext}
                </p>
              )}
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {day.riskIncreaseReason ? day.riskIncreaseReason : 'no written reason recorded'}
              </p>
            </div>
          )}
        </div>

        {/* 2. Sector heat map — what the market is doing right now */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 flex items-center gap-1.5">
              <LayoutDashboard className="w-3.5 h-3.5 text-zinc-300" />
              Sector heat map — live vs previous close
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500">
              <span className="inline-flex items-center gap-1" data-testid="heat-up-count">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80 inline-block" />
                up {market.brief ? breadth.up : '—'}
              </span>
              <span className="inline-flex items-center gap-1" data-testid="heat-down-count">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-600/80 inline-block" />
                down {market.brief ? breadth.down : '—'}
              </span>
            </div>
          </div>

          {market.loading && (
            <div className="flex items-center gap-2 py-6 justify-center text-xs text-zinc-400" role="status">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
              Collecting today's sector data…
            </div>
          )}

          {!market.loading && market.brief && (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {market.brief.quotes.map((quote) => (
                  <HeatTile key={quote.symbol} quote={quote} />
                ))}
              </div>
              {market.brief.note && (
                <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {market.brief.note}
                </p>
              )}
            </>
          )}

          {!market.loading && market.error && (
            <p className="text-xs text-zinc-400 flex items-center gap-2 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              {market.error}
            </p>
          )}
        </div>

        {/* 3. Coach opinion — honest, plan-focused */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-3">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-amber-400" />
            Coach opinion on this plan
          </span>

          {review.loading && (
            <div className="space-y-2 py-2" role="status">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                Reading your plan and today's market, then writing an honest opinion…
              </div>
              <p className="text-[10px] text-zinc-500 font-mono">
                Fetching sector data · comparing bias with breadth · checking size against your recent results
              </p>
            </div>
          )}

          {!review.loading && review.result?.ok && reviewData && (
            <div className="space-y-3" id="plan-lock-review">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-100 leading-snug">
                  {reviewData.headline}
                </p>
                <span
                  className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase font-mono ${VERDICT_STYLES[reviewData.verdict].className}`}
                >
                  {VERDICT_STYLES[reviewData.verdict].label}
                </span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">{reviewData.marketRead}</p>
              <p className="text-xs text-zinc-300 leading-relaxed">{reviewData.alignment}</p>
              <p className="text-xs text-zinc-300 leading-relaxed">{reviewData.riskCheck}</p>

              {reviewData.planGaps.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-400 block mb-1">
                    Gaps in this plan
                  </span>
                  <ul className="space-y-1">
                    {reviewData.planGaps.map((gap, index) => (
                      <li key={index} className="text-xs text-zinc-300 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                        {gap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewData.watchFor.length > 0 && (
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 block mb-1">
                    Worth watching at the open
                  </span>
                  <ul className="space-y-1">
                    {reviewData.watchFor.map((item, index) => (
                      <li key={index} className="text-xs text-zinc-300 flex items-start gap-2">
                        <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewData.oneFix && (
                <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-2.5">
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-400 block mb-0.5">
                    One fix before locking
                  </span>
                  <p className="text-xs text-zinc-200 leading-relaxed">{reviewData.oneFix}</p>
                </div>
              )}
            </div>
          )}

          {!review.loading && review.result && !review.result.ok && (
            <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-3">
              <p className="text-xs text-zinc-300 leading-relaxed">
                {review.result.code === 'unconfigured'
                  ? 'The coach is not available in this environment, so no opinion could be written. You can still lock the plan.'
                  : `The coach could not write an opinion (${review.result.code}). You can retry, or lock without it.`}
              </p>
              <button
                type="button"
                id="plan-lock-review-retry"
                onClick={() => {
                  setReview({ loading: true, result: null });
                  void requestCoach('planreview', digest).then((result) =>
                    setReview({ loading: false, result })
                  );
                }}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                <RefreshCw className="w-3 h-3" />
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-800">
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" />
            Locking stores this plan as the immutable baseline for the day.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="plan-lock-back-btn"
              onClick={onBack}
              className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              Back to plan
            </button>
            <button
              type="button"
              id="plan-lock-confirm-btn"
              onClick={onConfirm}
              className="flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2 text-xs font-semibold text-zinc-950 transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98]"
            >
              <Lock className="w-4 h-4" />
              Lock plan
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};
