import React, { useState } from 'react';
import { Lightbulb, Check, Pin, Image as ImageIcon, Play, Video } from 'lucide-react';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { isVideoUrl } from '../../lib/media/media-utils';

interface YesterdayFocusBannerProps {
  yesterdayFocus: { date: string; focus: string; media?: string[] } | null;
  /** Whether this exact lesson has been accepted. Persisted, not component state. */
  acknowledged?: boolean;
  /** When it was accepted, for the line that says it is being held. */
  acknowledgedAt?: string | null;
  onAcknowledge?: () => void;
}

/**
 * The lesson carried forward from the last review.
 *
 * It used to vanish on the click that acknowledged it, which made the acknowledgement a
 * way of clearing the screen rather than a commitment to hold one thing. Now accepting the
 * lesson keeps it on the page for the rest of the day — the banner turns steady instead of
 * disappearing, and says which lesson is being held and since when.
 *
 * The acknowledgement belongs to the lesson, not to the day: a different lesson (tomorrow's
 * review rewrites the focus) comes back unacknowledged, because nobody has agreed to it.
 */
export const YesterdayFocusBanner: React.FC<YesterdayFocusBannerProps> = ({
  yesterdayFocus,
  acknowledged = false,
  acknowledgedAt = null,
  onAcknowledge,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (!yesterdayFocus || !yesterdayFocus.focus) return null;

  const media = yesterdayFocus.media ?? [];

  /**
   * The media the trader attached to last night's review.
   *
   * It sits inside the lesson on purpose: the sentence says what to hold, and the
   * screenshots and the clip say what it looked like and what they meant by it. A clip is
   * the trader talking to themselves, so it is shown here rather than hidden behind a click
   * into the review form.
   */
  const mediaStrip = media.length > 0 && (
    <div className="mt-2.5 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px] font-mono opacity-70">
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
              className="group relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-current/20 bg-black/40 transition-transform hover:scale-105 active:scale-95"
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
                  alt={`Lesson attachment ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                {video ? (
                  <Play className="h-4 w-4 fill-current" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const lightbox = lightboxIndex !== null && (
    <ImageLightboxModal
      isOpen={true}
      onClose={() => setLightboxIndex(null)}
      images={media}
      initialIndex={lightboxIndex}
      title="Yesterday's lesson"
      subtitle={yesterdayFocus.focus}
    />
  );

  const heldSince = acknowledgedAt
    ? new Date(acknowledgedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  if (acknowledged) {
    return (
      <div
        className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3 sm:p-4 text-emerald-100"
        data-lesson-state="acknowledged"
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Check className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-emerald-400 uppercase">
                Yesterday's Lesson
              </span>
              <span className="text-[10px] text-emerald-300/60 font-mono">
                ({yesterdayFocus.date})
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-emerald-700/60 bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                <Pin className="h-2.5 w-2.5" />
                Held for today{heldSince ? ` · from ${heldSince}` : ''}
              </span>
            </div>
            <p className="mt-1 text-xs sm:text-sm font-medium text-emerald-50/90 italic">
              "{yesterdayFocus.focus}"
            </p>
            {mediaStrip}
            <p className="mt-1.5 text-[10px] text-emerald-300/60 leading-relaxed">
              Acknowledged, so it stays on this page for the rest of the day. A new lesson
              replaces it once the next end-of-day review is written.
            </p>
          </div>
        </div>
        {lightbox}
      </div>
    );
  }

  return (
    <div
      className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 sm:p-4 text-amber-200"
      data-lesson-state="new"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
            <Lightbulb className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-amber-400 uppercase">
                Yesterday's Lesson
              </span>
              <span className="text-[10px] text-amber-300/60 font-mono">
                ({yesterdayFocus.date})
              </span>
            </div>
            <p className="mt-1 text-xs sm:text-sm font-medium text-amber-100 italic">
              "{yesterdayFocus.focus}"
            </p>
            {mediaStrip}
            <p className="mt-1.5 text-[10px] text-amber-300/60 leading-relaxed">
              Acknowledging holds this on the page for the day, and opens your review trend
              underneath it.
            </p>
          </div>
        </div>

        {onAcknowledge && (
          <button
            onClick={onAcknowledge}
            data-testid="acknowledge-lesson"
            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition-colors shrink-0"
          >
            <Check className="w-3 h-3" />
            Acknowledge
          </button>
        )}
      </div>
      {lightbox}
    </div>
  );
};
