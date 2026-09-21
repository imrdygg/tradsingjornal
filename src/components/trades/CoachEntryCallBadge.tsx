import React from 'react';
import { Check, Minus, X } from 'lucide-react';
import type { Trade } from '../../types';
import { compareEntry, verdictLabel, type ComparisonVerdict } from '../../lib/ai/entry-comparison';

/**
 * The coach's call at entry, shown beside the fill it is being compared with.
 *
 * Small on purpose: it sits in a table cell next to the price, so it carries the verdict
 * and the coach's level, and puts the reasoning in the hover text. A trade with no stored
 * call renders nothing at all rather than a placeholder — imported trades and anything
 * recorded while the coach was unavailable have nothing to show, and a row of "no call"
 * chips would just be noise in the log.
 */

interface CoachEntryCallBadgeProps {
  trade: Trade;
  /** Right-aligned cells pass 'right' so the chip sits against the fill above it. */
  align?: 'left' | 'right';
  className?: string;
}

const TONES: Record<ComparisonVerdict, string> = {
  agreed: 'bg-emerald-950/70 text-emerald-300 border-emerald-800',
  opposed: 'bg-rose-950/70 text-rose-300 border-rose-800',
  'coach-flat': 'bg-amber-950/70 text-amber-300 border-amber-800',
  'no-call': 'bg-zinc-800 text-zinc-400 border-zinc-700',
};

export const CoachEntryCallBadge: React.FC<CoachEntryCallBadgeProps> = ({
  trade,
  align = 'left',
  className = '',
}) => {
  const comparison = compareEntry(trade);
  if (!comparison) return null;

  const Icon =
    comparison.verdict === 'agreed' ? Check : comparison.verdict === 'coach-flat' ? Minus : X;

  const callText =
    comparison.coachDirection === 'flat'
      ? 'flat'
      : `${comparison.coachDirection?.toUpperCase() ?? '—'} @ ${
          comparison.coachEntry === null ? '—' : comparison.coachEntry.toFixed(2)
        }`;

  // The numbers are in the chip; the reasoning and the caveat belong in the hover.
  const title = [
    `Coach's call at entry: ${callText}.`,
    `${verdictLabel(comparison.verdict)}.`,
    comparison.priceEdge === null
      ? null
      : `Your fill was ${Math.abs(comparison.priceEdge)} pts ${
          comparison.priceEdge >= 0 ? 'better' : 'worse'
        } than that level.`,
    comparison.rationale,
    'One opinion, recorded at the moment of entry — not advice.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono whitespace-nowrap ${TONES[comparison.verdict]} ${
        align === 'right' ? 'ml-auto' : ''
      } ${className}`}
      title={title}
      data-testid={`coach-call-${trade.id}`}
      data-coach-verdict={comparison.verdict}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" strokeWidth={3} />
      <span className="truncate">coach {callText}</span>
      {comparison.priceEdge !== null && (
        <span className="opacity-80">
          {comparison.priceEdge >= 0 ? '+' : ''}
          {comparison.priceEdge} pts
        </span>
      )}
    </span>
  );
};
