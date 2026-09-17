import React, { useState } from 'react';
import { Lightbulb, Check } from 'lucide-react';

interface YesterdayFocusBannerProps {
  yesterdayFocus: { date: string; focus: string } | null;
}

export const YesterdayFocusBanner: React.FC<YesterdayFocusBannerProps> = ({ yesterdayFocus }) => {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!yesterdayFocus || !yesterdayFocus.focus || acknowledged) {
    return null;
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 sm:p-4 text-amber-200">
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
          </div>
        </div>

        <button
          onClick={() => setAcknowledged(true)}
          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition-colors shrink-0"
        >
          <Check className="w-3 h-3" />
          Acknowledge
        </button>
      </div>
    </div>
  );
};
