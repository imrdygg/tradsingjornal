import React, { useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Edit2,
  Trash2,
  Check,
  ZoomIn,
  Play,
  Video,
  Layers,
} from 'lucide-react';
import { Trade, Instrument } from '../../types';
import { calculateTradeRuleFollowing } from '../../lib/analytics/discipline';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { CoachEntryCallBadge } from './CoachEntryCallBadge';
import { formatTimestamp } from '../../lib/storage/date-utils';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { isVideoUrl } from '../../lib/media/media-utils';
import type { TradePositionGroup } from '../../lib/trading/position-groups';
import { hasAssumedRisk } from '../../lib/trading/risk-fixup';

interface TradeCardProps {
  trade: Trade;
  /** Used to resolve the trade's real instrument symbol (MES, MNQ, ES, ...). */
  instruments: Instrument[];
  /** Blended view of the position when this card is one leg of a scale-in. */
  positionGroup?: TradePositionGroup;
  /** Opens the full trade detail view. */
  onView?: (trade: Trade) => void;
  onEdit?: (trade: Trade) => void;
  onCloseTrade?: (trade: Trade) => void;
  onDelete?: (tradeId: string) => void;
}

export const TradeCard: React.FC<TradeCardProps> = ({
  trade,
  instruments,
  positionGroup,
  onView,
  onEdit,
  onCloseTrade,
  onDelete,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const symbol = instrumentSymbol(instruments, trade.instrumentId);

  /**
   * The whole card is clickable to open the trade's details, but nothing
   * interactive inside it (buttons, media, links) should trigger that.
   *
   * The card deliberately has no role="button": it contains its own buttons,
   * and nesting interactive elements inside a button is invalid for assistive
   * tech. The explicit "Details" button below is the accessible entry point.
   */
  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onView) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, video, audio, input, select, textarea, label')) return;
    onView(trade);
  };

  const isLong = trade.direction === 'long';
  const isClosed = trade.status === 'closed';

  const tradeImages =
    trade.images && trade.images.length > 0
      ? trade.images
      : trade.screenshotPath
      ? [trade.screenshotPath]
      : [];

  const pnlColor =
    trade.grossPnL > 0
      ? 'text-emerald-400'
      : trade.grossPnL < 0
      ? 'text-rose-400'
      : 'text-zinc-400';

  const pnlSign = trade.grossPnL > 0 ? '+' : '';

  // Rule discipline score if execution review completed
  const ruleFollowing = calculateTradeRuleFollowing(trade.executionReview);
  // Imported trades carry a stop the app had to invent, so their risk and R are not
  // the trader's numbers. Say so rather than presenting them as real.
  const assumedRisk = hasAssumedRisk(trade);

  // Calculate duration if both entry & exit times are present
  let durationStr = 'Open';
  if (isClosed && trade.entryTime && trade.exitTime) {
    try {
      const start = new Date(trade.entryTime).getTime();
      const end = new Date(trade.exitTime).getTime();
      const diffMinutes = Math.round((end - start) / (1000 * 60));
      if (diffMinutes < 60) {
        durationStr = `${diffMinutes}m`;
      } else {
        const hours = Math.floor(diffMinutes / 60);
        const mins = diffMinutes % 60;
        durationStr = `${hours}h ${mins}m`;
      }
    } catch {
      durationStr = '-';
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-all space-y-3 ${
        onView ? 'cursor-pointer hover:border-emerald-700/70 hover:bg-zinc-900/80' : 'hover:border-zinc-700/80'
      }`}
    >
      {/* Top Row: Symbol, Direction, Setup, Status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
              isLong
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                : 'bg-rose-950/80 text-rose-300 border border-rose-800'
            }`}
          >
            {isLong ? (
              <ArrowUpRight className="w-3.5 h-3.5" />
            ) : (
              <ArrowDownRight className="w-3.5 h-3.5" />
            )}
            {trade.direction}
          </span>
          <span className="font-mono font-bold text-sm text-zinc-100">
            {symbol} ({trade.contracts}x)
          </span>
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-[11px] font-medium text-zinc-300">
            {trade.setupName || 'Setup'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 font-mono">
            {trade.session}
          </span>
          {!isClosed ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 font-mono animate-pulse">
              Open
            </span>
          ) : (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">
              Closed
            </span>
          )}
        </div>
      </div>

      {/* Blended position summary when this is one leg of a scale-in */}
      {positionGroup && positionGroup.legCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-2 text-[11px] font-mono">
          <span className="flex items-center gap-1.5 text-emerald-300">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            Combined position · {positionGroup.legCount} legs
            {!positionGroup.allClosed && (
              <span className="text-emerald-400/70">(leg {positionGroup.legIndex(trade.id)})</span>
            )}
          </span>
          <span className="text-zinc-300">
            {positionGroup.totalContracts} {symbol} · avg entry{' '}
            <strong className="text-emerald-300 font-bold">
              {positionGroup.averageEntry.toFixed(2)}
            </strong>
            {positionGroup.allClosed && (
              <>
                {' '}
                · P&amp;L{' '}
                <strong
                  className={
                    positionGroup.realizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }
                >
                  {positionGroup.realizedPnL >= 0 ? '+' : ''}${positionGroup.realizedPnL.toFixed(2)}
                </strong>
              </>
            )}
          </span>
        </div>
      )}

      {/* Pricing and P&L Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg bg-zinc-950/80 border border-zinc-800/80 p-2.5 font-mono text-xs">
        <div>
          <span className="text-[10px] text-zinc-400 uppercase block">Entry / Stop</span>
          <span className="text-zinc-200 font-medium">
            {trade.entryPrice.toFixed(2)}
          </span>
          <span className="text-zinc-400 text-[11px] block">
            Stop: {trade.initialStop.toFixed(2)}
          </span>
          {/* The coach's call at entry, directly under the fill it is compared with. */}
          <CoachEntryCallBadge trade={trade} className="mt-1" />
        </div>

        <div>
          <span className="text-[10px] text-zinc-400 uppercase block">Exit Price</span>
          <span className="text-zinc-200 font-medium">
            {trade.exitPrice !== undefined && trade.exitPrice !== null
              ? trade.exitPrice.toFixed(2)
              : '—'}
          </span>
          <span className="text-zinc-400 text-[11px] block">
            {trade.pointsPnL !== undefined
              ? `${trade.pointsPnL > 0 ? '+' : ''}${trade.pointsPnL.toFixed(2)} pts`
              : '—'}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-zinc-400 uppercase block">Initial Risk</span>
          <span className="text-zinc-200 font-medium">
            ${trade.initialRisk.toFixed(2)}
            {assumedRisk && (
              // A data attribute rather than an id: the trades view renders this card
              // and the desktop table at once, so an id here would appear twice.
              <span
                data-assumed-risk="true"
                title="Imported from a CSV, which has no stop price. Set the real stop in Settings → Fix imported risk."
                className="ml-1.5 align-middle rounded border border-amber-800 bg-amber-950/60 px-1 py-px text-[9px] font-mono uppercase text-amber-300"
              >
                assumed
              </span>
            )}
          </span>
          <span className="text-zinc-400 text-[11px] block">
            {durationStr}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-zinc-400 uppercase block">Realized P&L</span>
          <span className={`font-bold text-sm ${pnlColor}`}>
            {isClosed ? `${pnlSign}$${trade.grossPnL.toFixed(2)}` : 'In Trade'}
          </span>
          {isClosed && (
            <span className="text-zinc-400 text-[11px] block">
              {trade.rMultiple !== undefined ? `${trade.rMultiple > 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Attached Chart Screenshots (Click to see big) */}
      {tradeImages.length > 0 && (
        <div className="pt-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1">
              <Video className="w-3 h-3 text-zinc-400" />
              Attached Charts & Video ({tradeImages.length})
            </span>
            <button
              type="button"
              onClick={() => setLightboxIndex(0)}
              className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 hover:underline"
            >
              <ZoomIn className="w-3 h-3" />
              View full size
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {tradeImages.map((img, idx) => {
              const isVideo = isVideoUrl(img);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className="group relative rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden h-14 w-20 shrink-0 hover:border-emerald-500/70 transition-all hover:scale-105 active:scale-95 shadow-sm"
                  title={isVideo ? 'Click to play video' : 'Click to view big'}
                >
                  {isVideo ? (
                    <video
                      src={img}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={img}
                      alt={`Trade chart ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                    {isVideo ? (
                      <Play className="w-4 h-4 text-emerald-400 fill-current drop-shadow" />
                    ) : (
                      <ZoomIn className="w-4 h-4 text-emerald-400 drop-shadow" />
                    )}
                  </div>
                  <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono font-bold bg-black/70 text-zinc-300 px-1 rounded">
                    #{idx + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Execution review status & notes */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 pt-1 border-t border-zinc-800/60">
        <div className="flex items-center gap-2">
          {ruleFollowing ? (
            <span
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${
                ruleFollowing.followedAll
                  ? 'bg-emerald-950/50 border-emerald-800/80 text-emerald-300'
                  : 'bg-amber-950/50 border-amber-800/80 text-amber-300'
              }`}
            >
              {ruleFollowing.followedAll ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <ShieldAlert className="w-3 h-3" />
              )}
              {ruleFollowing.score}% Execution Discipline
            </span>
          ) : isClosed ? (
            <span className="text-[11px] text-zinc-400 italic flex items-center gap-1">
              <HelpCircle className="w-3 h-3" /> Review pending
            </span>
          ) : null}

          {trade.entryReason && (
            <span className="truncate max-w-[200px] text-[11px] text-zinc-400 italic">
              "{trade.entryReason}"
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {onView && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onView(trade);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold border border-zinc-700 transition-colors"
              title="Open the full trade record"
            >
              <ZoomIn className="w-3 h-3" />
              Details
            </button>
          )}

          {!isClosed && onCloseTrade && (
            <button
              onClick={() => onCloseTrade(trade)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-semibold border border-emerald-800/80 transition-colors"
            >
              <Check className="w-3 h-3" />
              Close Trade
            </button>
          )}

          {onEdit && (
            <button
              onClick={() => onEdit(trade)}
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Edit Trade"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}

          {onDelete && (
            <button
              onClick={() => onDelete(trade.id)}
              className="p-1 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
              title="Delete Trade"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Lightbox for seeing chart big */}
      <ImageLightboxModal
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        images={tradeImages}
        initialIndex={lightboxIndex !== null ? lightboxIndex : 0}
        title={`${trade.direction.toUpperCase()} ${symbol} @ ${trade.entryPrice.toFixed(2)}`}
        subtitle={`${trade.session} • ${trade.setupName || 'Setup'} • ${isClosed ? `Realized: ${pnlSign}$${trade.grossPnL.toFixed(2)}` : 'In Trade'}`}
      />
    </div>
  );
};
