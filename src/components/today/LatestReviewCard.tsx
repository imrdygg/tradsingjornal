import React, { useMemo, useState } from 'react';
import { Award, PenLine, Image as ImageIcon, Play, Video } from 'lucide-react';
import type { DailyReview, TradingDay } from '../../types';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { isVideoUrl } from '../../lib/media/media-utils';

interface LatestReviewCardProps {
  reviews: DailyReview[];
  tradingDays: TradingDay[];
  /** Today's trading date, so the card can tell whether the review on screen is today's. */
  todayTradeDate: string;
  /** Opens the end-of-day review form, which always writes to today. */
  onOpenReview: () => void;
}

/**
 * The most recently written end-of-day review, and the way to write the next one.
 *
 * The review is what the trader last told themselves about their own execution, and it was
 * only ever visible inside the form that writes it or in the History tab. On Today it is
 * the one panel that has to be in sight: the focus it carries is the thing the next session
 * is supposed to be run against, and a lesson nobody can re-read is a lesson nobody keeps.
 *
 * Ordered by the day each review belongs to rather than by when it was typed, because a
 * late-evening review belongs to the day that was traded. Two reviews on one day keep the
 * one written last.
 */
export const LatestReviewCard: React.FC<LatestReviewCardProps> = ({
  reviews,
  tradingDays,
  todayTradeDate,
  onOpenReview,
}) => {
  const latest = useMemo(() => {
    const dateByDayId = new Map(tradingDays.map((day) => [day.id, day.tradeDate]));
    let best: { review: DailyReview; date: string } | null = null;
    for (const review of reviews) {
      const date = dateByDayId.get(review.tradingDayId);
      if (!date) continue;
      if (
        !best ||
        date > best.date ||
        (date === best.date && (review.updatedAt ?? '') > (best.review.updatedAt ?? ''))
      ) {
        best = { review, date };
      }
    }
    return best;
  }, [reviews, tradingDays]);

  const isToday = latest?.date === todayTradeDate;
  const media = latest?.review.media ?? [];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div
      id="latest-review"
      className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-300">
            <Award className="h-4 w-4 text-amber-400" />
            {isToday ? "Today's end-of-day review" : 'End-of-day review'}
          </h3>
          <p className="mt-1 font-mono text-[11px] text-zinc-500">
            {latest
              ? isToday
                ? `recorded for today · ${latest.review.disciplineScore}/100 discipline`
                : `your last recorded review · ${latest.date} · ${latest.review.disciplineScore}/100 discipline`
              : 'no review written yet'}
          </p>
        </div>

        <button
          type="button"
          id="latest-review-open"
          onClick={onOpenReview}
          className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs font-semibold text-zinc-200 shadow-sm transition-all hover:bg-zinc-800"
        >
          <PenLine className="h-3.5 w-3.5 text-amber-400" />
          {isToday ? 'Update review' : 'Write end-of-day review'}
        </button>
      </div>

      {latest ? (
        <div className="space-y-2 text-xs">
          <div>
            <span className="block font-semibold text-zinc-400">What did I do well?</span>
            <p className="mt-0.5 text-zinc-200">{latest.review.didWell}</p>
          </div>
          <div>
            <span className="block font-semibold text-zinc-400">What did I do poorly?</span>
            <p className="mt-0.5 text-zinc-200">{latest.review.didPoorly}</p>
          </div>
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-2.5">
            <span className="block font-semibold text-amber-300">Focus carried forward</span>
            <p className="mt-0.5 font-medium italic text-amber-100">
              "{latest.review.tomorrowFocus}"
            </p>

            {/* The media attached to the review, shown with the focus it backs. */}
            {media.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2 font-mono text-[10px] text-amber-300/70">
                  <ImageIcon className="h-3 w-3" />
                  {media.filter((item) => !isVideoUrl(item)).length} image(s)
                  {media.some((item) => isVideoUrl(item)) && (
                    <span className="flex items-center gap-1">
                      <Video className="h-3 w-3" />
                      {media.filter((item) => isVideoUrl(item)).length} clip(s)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {media.map((item, index) => {
                    const video = isVideoUrl(item);
                    return (
                      <button
                        key={index}
                        type="button"
                        data-lesson-media={index}
                        onClick={() => setLightboxIndex(index)}
                        className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-amber-900/50 bg-black/40 transition-transform hover:scale-105 active:scale-95"
                        title={video ? 'Play clip' : 'View screenshot'}
                      >
                        {video ? (
                          <video
                            src={item}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <img
                            src={item}
                            alt={`Review attachment ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          {video ? (
                            <Play className="h-4 w-4 fill-current text-amber-200" />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-amber-200" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-zinc-400">
          Finish a review and it stays here, with the focus you set for the next session, until
          you write the next one.
        </p>
      )}

      {lightboxIndex !== null && media.length > 0 && (
        <ImageLightboxModal
          isOpen={true}
          onClose={() => setLightboxIndex(null)}
          images={media}
          initialIndex={lightboxIndex}
          title="End-of-day review"
          subtitle={latest?.review.tomorrowFocus}
        />
      )}
    </div>
  );
};
