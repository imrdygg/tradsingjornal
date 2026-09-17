/**
 * Educational content for the built-in setup catalog.
 *
 * The Playbook view renders this next to each setup so the trader can study
 * what the pattern is, how it forms, and how it is meant to be traded —
 * turning the setups list from a tagging system into a study tool.
 */

export interface SetupGuide {
  /** One-line "what it is". */
  summary: string;
  /** Step-by-step of how the pattern forms on the chart. */
  formation: string[];
  /** Practical execution notes for the journal's workflow. */
  howToTrade: string[];
  /** Typical invalidation idea — where the setup is proven wrong. */
  invalidation: string;
}

export const SETUP_GUIDES: Record<string, SetupGuide> = {
  Engulfing: {
    summary:
      'A two-candle reversal pattern where one candle fully "swallows" the body of the previous one, signaling that control flipped hands.',
    formation: [
      'Price is trending (downtrend for a bullish engulfing, uptrend for a bearish one).',
      'A small candle prints in the direction of the old trend — hesitation, fading momentum.',
      'The next candle opens beyond the previous close and closes beyond the previous OPEN, its body completely covering the prior body.',
      'Volume expanding on the engulfing candle strengthens the signal.',
    ],
    howToTrade: [
      'Enter on the close of the engulfing candle, or on a shallow retrace into its body (50% is common).',
      'Stop goes just beyond the engulfing candle\u2019s high/low — if that breaks, the swap of control failed.',
      'First target is the nearest opposing level (range high/low, prior swing); let the remainder run if momentum persists.',
      'Best on higher-timeframe levels: an engulfing AT a level is a setup; an engulfing in the middle of nowhere is noise.',
    ],
    invalidation:
      'Price closing back through the engulfing candle\u2019s origin side — the reversal failed and the old trend likely resumes.',
  },

  Support: {
    summary:
      'Buying a proven demand zone where price has repeatedly stopped falling and bounced, anticipating another rotation upward.',
    formation: [
      'Price declines into an area where it has bounced before (a visible shelf of prior lows or a high-volume node).',
      'Momentum visibly slows into the zone: candles get smaller, wicks start poking lower and failing.',
      'A reaction candle (hammer, engulfing) forms off the level and price rotates away from it.',
    ],
    howToTrade: [
      'Wait for price to reach the zone — never anticipate it mid-air.',
      'Require a reaction (a rejection wick or reversal candle) before entering; do not catch the knife blindly.',
      'Stop goes below the support shelf, beyond the wick extremes, with room for a retest.',
      'If support breaks and price retests it from beneath, the zone flips — the same level becomes resistance (see the red example).',
    ],
    invalidation:
      'A decisive close below the support shelf — demand failed, and broken support usually becomes overhead resistance.',
  },

  Resistance: {
    summary:
      'Selling (or standing aside) at a proven supply zone where price has repeatedly stalled and reversed, anticipating rotation back down.',
    formation: [
      'Price rallies into an area where it has been rejected before (prior highs, a supply shelf, or range extreme).',
      'Approach loses momentum: upper wicks grow, candles shrink against the level.',
      'A rejection candle forms at the zone and price rotates lower.',
    ],
    howToTrade: [
      'Let price come to the zone and show rejection — a wick or engulfing rejection is the trigger.',
      'Enter on the rejection candle close or a retest of its extreme.',
      'Stop above the resistance zone, beyond the rejection wick.',
      'If resistance breaks with a strong close above, flip bias: broken resistance tends to act as support on the retest (see the green example).',
    ],
    invalidation:
      'A decisive close above the resistance zone — supply has been absorbed and the level is likely to flip.',
  },

  Breakout: {
    summary:
      'Trading the expansion move when price escapes a tight consolidation through its boundary, riding the momentum that follows.',
    formation: [
      'Price coils in a tightening range — volatility contracts, candles overlap, direction is undecided.',
      'The range boundary (range high/low) is clearly defined by at least two touches.',
      'An expansion candle with a full body closes beyond the boundary, ideally on rising volume.',
    ],
    howToTrade: [
      'Enter on the close of the breakout candle, or on the first retest of the broken boundary from the new side.',
      'Stop inside the old range, just below/above the broken boundary — a valid breakout should not re-enter.',
      'Targets are measured moves (range height projected) or the next higher-timeframe level.',
      'Distrust breakouts without follow-through: many fail. The retest holding is the strongest confirmation.',
    ],
    invalidation:
      'Price closing back inside the range after the break — that is a failed breakout and often triggers a violent move across the range.',
  },

  Reversal: {
    summary:
      'A broader family of turn signals (long wicks, double tops/bottoms, structure flips) where an established trend ends and flips.',
    formation: [
      'An extended trend approaches a significant level or shows clear exhaustion.',
      'A tell prints: a long-wick candle (hammer / shooting star), a double top/bottom, or a break of the trend\u2019s own structure.',
      'The next candles confirm — higher lows after a low (or lower highs after a high) prove the turn.',
    ],
    howToTrade: [
      'Do not front-run the turn: wait for the confirming candle or the structure break.',
      'Enter after confirmation; stop beyond the extreme that created the pattern.',
      'Targets: the nearest opposing structure, then prior range extremes.',
      'Reversals against strong trends fail often — size smaller and demand cleaner confirmation than with other setups.',
    ],
    invalidation:
      'Price making a new trend extreme (beyond the wick or swing that defined the turn) — the trend resumed.',
  },

  'Trend Continuation': {
    summary:
      'Joining an established trend after a shallow pullback, entering where the trend pauses before resuming in its original direction.',
    formation: [
      'A clear trend is underway with consistent impulse legs.',
      'Price pulls back against the trend in a controlled way: small candles, often one to three legs, holding above/below the last impulse origin.',
      'A continuation signal prints — a trendline hold, a small flag breakout, or a resumption candle in the trend direction.',
    ],
    howToTrade: [
      'Enter at the pullback\u2019s end on the resumption trigger (flag break, engulfing in trend direction).',
      'Stop below/above the pullback structure — if that breaks, the pullback is actually a reversal.',
      'Targets: prior swing highs/lows, then trail behind structure to ride the trend.',
      'With-the-trend entries need less confirmation than reversal entries — the trend is the trader\u2019s edge here.',
    ],
    invalidation:
      'The pullback breaking the structure that defined it — what looked like a pause has become a reversal.',
  },

  Other: {
    summary:
      'A free-form bucket for executions that do not match a named setup. Use it honestly — a misc tag you review later still teaches.',
    formation: [
      'Anything that does not fit the defined catalog.',
      'Describe what you actually saw in the trade\u2019s entry reason and notes so the tag stays meaningful.',
    ],
    howToTrade: [
      'Log it, then review: if the same shape keeps landing here, it deserves its own named setup.',
      'Use the notes field to describe the pattern so future-you can decide whether to promote it to the catalog.',
      'Custom setups created in this Playbook get their own editable card — add one instead of overusing Other.',
    ],
    invalidation: 'Define one as you go — the point of journaling is turning patterns into rules.',
  },
};

/** Tolerant lookup: matches by exact id/name or loose substring (e.g. "VWAP Bounce" fallback). */
export function resolveSetupGuide(setupName: string): SetupGuide | undefined {
  const cleaned = setupName.trim().toLowerCase();
  if (cleaned.includes('engulf')) return SETUP_GUIDES.Engulfing;
  if (cleaned === 'support') return SETUP_GUIDES.Support;
  if (cleaned === 'resistance') return SETUP_GUIDES.Resistance;
  if (cleaned.includes('breakout')) return SETUP_GUIDES.Breakout;
  if (cleaned.includes('reversal')) return SETUP_GUIDES.Reversal;
  if (cleaned.includes('continuation')) return SETUP_GUIDES['Trend Continuation'];
  if (cleaned === 'other') return SETUP_GUIDES.Other;
  return undefined;
}
