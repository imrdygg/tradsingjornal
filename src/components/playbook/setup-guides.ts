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

  'VWAP Reclaim': {
    summary:
      'Price loses VWAP, flushes the stops below it, then closes back above — the session has reclaimed its fair value and buyers are back in control.',
    formation: [
      'Price trades below VWAP and makes a clear lower low, often on an open flush or a news spike.',
      'The flush stalls: the next candle wicks below that low and cannot hold there.',
      'Price closes back above VWAP with a full body, confirming the failed downside break.',
      'The honest version of this setup needs a close above VWAP, not merely a wick through it.',
    ],
    howToTrade: [
      'Wait for the close back above VWAP, then enter on the hold or the first shallow retest of VWAP from above.',
      'Stop goes under the low of the flush. If that low is taken out, the reclaim was a fake.',
      'First target is the day high or the last lower high, with VWAP becoming the line that has to keep holding.',
      'Take it in the direction of the daily bias passing the reclaim. Reclaims against a strong downtrend are where these fail.',
    ],
    invalidation:
      'Price closing back below VWAP after the reclaim, or the flush low being taken out — fair value was never reclaimed.',
  },

  'VWAP Rejection': {
    summary:
      'Price pulls back to VWAP in an established trend and is turned away from it, so the average keeps acting as the trend support or ceiling.',
    formation: [
      'A trend is underway and price is trading on one side of VWAP — above it in an uptrend, below it in a downtrend.',
      'Price drifts back to VWAP in a controlled pullback with shrinking candles rather than a fast counter-move.',
      'VWAP holds: a wick into it is rejected and the candle closes back in the trend direction.',
    ],
    howToTrade: [
      'Enter on the rejection candle close, or on a break of its extreme in the trend direction.',
      'Stop goes through VWAP, on the far side of the rejection wick.',
      'Target the prior swing extreme, then trail behind structure while VWAP keeps holding.',
      'The stronger the trend, the shallower the touch. A deep VWAP touch late in the session is the weakest version of this.',
    ],
    invalidation:
      'A close through VWAP followed by a hold on the new side — the average has flipped sides or the trend is finished.',
  },

  'Opening Range Breakout': {
    summary:
      'Trade the first expansion out of the opening range — the tight band the first minutes of the regular session establish.',
    formation: [
      'The first candles of the regular session print inside a narrow band while both sides fight for control.',
      'The band holds at least two touches on each side, which is what makes it a real opening range.',
      'An expansion candle closes beyond one edge of the band with a full body.',
    ],
    howToTrade: [
      'Mark both range edges before the break, then take the close beyond one of them or the first pullback that holds.',
      'Stop goes back inside the opening range, past the far side of the breakout candle.',
      'Target the measured move — the range height projected from the breakout — then the prior day high or low.',
      'The first attempt often fails in a balanced market. A retest that holds is the higher-quality entry.',
    ],
    invalidation:
      'Price closing back inside the opening range after the break — the expansion failed and the range is still in charge.',
  },

  'Failed Breakout': {
    summary:
      'Trade the trap: price breaks a level, cannot hold it, then snaps back the other way, usually faster than the break itself.',
    formation: [
      'A well-watched level breaks — a range edge, the prior day high or low, an opening range edge.',
      'Follow-through never arrives: the next candle stalls, then closes back inside the old range.',
      'Trapped traders are offside, and their stops sit just beyond the level they broke. That is the fuel for the move back.',
    ],
    howToTrade: [
      'Wait for the close back inside the level, then enter on that close or on the level being retested from the failed side.',
      'Stop goes just beyond the extreme of the failed break. If that extreme is taken out, the break was genuine.',
      'Target the opposite edge of the range, then structure beyond it.',
      'Strongest at the extremes of a range, weakest in a strong trend, where a break that looks failed often just reloads.',
    ],
    invalidation:
      'Price recovering and closing beyond the broken level again — the trap has failed and the break is back on.',
  },

  'Retest of Broken Level': {
    summary:
      'Break a level, then wait for price to come back and prove it before committing — the retest is the confirmation the breakout never had.',
    formation: [
      'A level breaks with a full-bodied close, obvious enough that everyone can see it.',
      'Price pulls back toward the level instead of running away from it.',
      'The level holds from the new side: buyers defend old resistance, or sellers defend old support.',
    ],
    howToTrade: [
      'Wait for the retest rather than chasing the break — the retest is the whole point of this setup.',
      'Enter on a hold or rejection candle at the level, never in the middle of the pullback.',
      'Stop goes back through the level on the wrong side. A valid retest does not close through it.',
      'If the retest never comes and price runs, accept the miss. It is a better miss than a chased break.',
    ],
    invalidation:
      'A close back through the level after the retest — the break was a fake and the level never flipped.',
  },

  'Trendline Break': {
    summary:
      'A trend line gives way and the market prints its first change of character, marking the start of a reversal or a deeper pullback.',
    formation: [
      'Price has respected a drawn trend line across several touches, so the line means something rather than being arbitrary.',
      'Momentum into the line fades: the final push is weaker than the ones before it.',
      'Price closes through the line, then fails to reclaim it, and the last swing inside the trend breaks too.',
    ],
    howToTrade: [
      'Wait for the line break AND the structure break. A trend line break alone is a warning, not an entry.',
      'Enter on the first pullback into the broken line once structure has confirmed.',
      'Stop goes beyond the last swing extreme the old trend made.',
      'Draw lines off real swings. A line with a single touch is not a trend line and proves nothing when it breaks.',
    ],
    invalidation:
      'Price reclaiming the broken line and making a new trend extreme — the pullback is over and the trend has resumed.',
  },

  'Liquidity Sweep': {
    summary:
      'Price runs an obvious pool of stops — a prior day low, an equal low, a round number — then rejects it and moves the other way.',
    formation: [
      'A level sits where stops cluster: equal lows, a prior session extreme, an obvious round number.',
      'Price spikes through that level to take the stops, usually fast and often far outside the range of the candles before it.',
      'The same candle or the next one closes back inside the range, leaving the takeout as a wick rather than a break.',
    ],
    howToTrade: [
      'Wait for the close back inside the range. A sweep is not confirmed while price is still outside.',
      'Stop goes beyond the wick of the sweep — that extreme is the line that defines the idea.',
      'Target the opposite side of the range or the nearest opposing level, then trail behind structure.',
      'A takeout that closes beyond the level is a breakout, not a sweep. Never treat the two as the same trade.',
    ],
    invalidation:
      'Price closing and holding beyond the taken level — real supply or demand is there, and the range has genuinely broken.',
  },

  'Opening Gap Fill': {
    summary:
      'Trade the fill of the overnight gap: price opens away from the prior close and works back toward it during the session.',
    formation: [
      'The session opens above or below the prior close, leaving a visible gap on the chart.',
      'The gap is not driven by a durable catalyst — index futures gaps are usually noise rather than news.',
      'Price starts rotating back toward the prior close instead of extending further away from it.',
    ],
    howToTrade: [
      'Wait for price to turn back toward the gap before entering, rather than assuming every gap fills.',
      'Stop goes beyond the session extreme that started the move away from the gap.',
      'Target the prior close, then the far edge of the gap where the fill is complete.',
      'Gaps driven by a real catalyst extend rather than fill. If price is holding new ground an hour in, stand aside.',
    ],
    invalidation:
      'Price extending away from the gap and holding, which turns the gap into a genuine level rather than a hole to fill.',
  },

  'Range Fade': {
    summary:
      'A balanced market pays the trader who sells the top and buys the bottom of the range instead of the one who tries to break it.',
    formation: [
      'Price is clearly range-bound: two or more touches at each edge, with overlapping candles in between.',
      'Approaches to each edge slow down rather than accelerate, so the range is being respected rather than tested.',
      'Price rotates away from the edge on a rejection candle, back toward the middle.',
    ],
    howToTrade: [
      'Enter on the rejection at the edge, with the stop just beyond the range boundary.',
      'Target the opposite side of the range, or the midpoint when the range is wide.',
      'Size smaller. Fading is a higher-frequency, lower-reward-per-trade style that punishes over-sizing badly.',
      'Stop fading the moment a candle closes decisively outside the range — that is balance turning into expansion.',
    ],
    invalidation:
      'A close beyond the range edge with follow-through — the market has resolved and directional trading is back.',
  },

  'Fair Value Gap': {
    summary:
      'A displacement move leaves an imbalance with no trading behind it, and price often returns to fill that gap before continuing.',
    formation: [
      'A fast one-sided displacement candle prints, so large and quick that it leaves a hole between it and its neighbours.',
      'That hole is the gap — the range between the first candle high and the third candle low, mirrored for a down move.',
      'Price later retraces into the gap, where the orders that caused the displacement are assumed to still sit.',
    ],
    howToTrade: [
      'Mark the gap as a zone rather than a line, then wait for price to trade into it.',
      'Enter on a reaction inside the zone, or on a lower-timeframe confirmation candle instead of a blind limit order.',
      'Stop goes beyond the far edge of the gap. A close through it means the imbalance has been repaired and the idea is dead.',
      'A gap left by high-volume displacement holds far better than one left by thin, holiday-hour drift.',
    ],
    invalidation:
      'Price closing fully through the far side of the gap and holding there — the imbalance is filled and the level has stopped working.',
  },

  'Order Block': {
    summary:
      'The last opposing candle before an aggressive move often marks where size entered, and price frequently reacts when it is revisited.',
    formation: [
      'A move is underway when a single opposite candle prints, usually the low of a swing before a rally.',
      'The next candles push away aggressively, leaving that opposite candle isolated as the origin of the move.',
      'Price later returns to that origin candle, where the imbalance began.',
    ],
    howToTrade: [
      'Mark the body of the origin candle as the zone and let price come to it rather than chasing it.',
      'Enter on a hold inside the zone, with a rejection wick or an engulfing candle as the trigger.',
      'Stop goes below the zone, past the origin candle low, so noise inside the zone does not stop the trade.',
      'Only count blocks that produced real displacement. A block followed by choppy overlap is just another candle.',
    ],
    invalidation:
      'Price clearing the entire origin candle and holding on the other side — the orders that created the move are gone.',
  },

  'Pullback to EMA': {
    summary:
      'In a trend, price regularly returns to the moving average it has been respecting, and the average is where the trend is rejoined.',
    formation: [
      'An established trend is holding above a moving average such as the 9 or 21 EMA, or below it in a downtrend.',
      'Price pulls back into the average with shrinking candles rather than a violent counter-leg.',
      'The average holds and a candle closes back in the trend direction.',
    ],
    howToTrade: [
      'Enter on the first close back in the trend direction after the average is touched.',
      'Stop goes below the average and the pullback low — the level that defines the trend.',
      'Target the prior extreme, then trail behind the average once the trade is underway.',
      'The average being sliced through on a big counter-candle is the warning. Stand aside instead of averaging into a dying trend.',
    ],
    invalidation:
      'A close and hold on the wrong side of the average, with the pullback taking out the last swing — the trend structure is broken.',
  },

  'Double Top': {
    summary:
      'Two failed attempts at the same high show supply above that level, and the break of the low between them confirms the turn.',
    formation: [
      'Price makes a high, pulls back, then returns to the same high and is rejected again, often with a visible wick.',
      'The low between the two highs holds as the neckline and defines the pattern.',
      'Price closes below the neckline, confirming the double top.',
    ],
    howToTrade: [
      'Enter on the neckline break, or on the retest of the neckline that follows it.',
      'Stop goes above the second high, or tighter above the neckline retest candle.',
      'Target the measured move: the height of the pattern projected down from the neckline.',
      'The two highs need not be identical. Rejection at roughly the same price is the point, not a tick-for-tick match.',
    ],
    invalidation:
      'Price closing back above the second high after the neckline breaks — the pattern failed and the level is being taken out.',
  },

  'Double Bottom': {
    summary:
      'Two failed attempts at the same low show demand below that level, and the break of the high between them confirms the turn up.',
    formation: [
      'Price makes a low, bounces, then returns to the same low and is bought again, often with a long lower wick.',
      'The high between the two lows holds as the neckline.',
      'Price closes above the neckline, confirming the double bottom.',
    ],
    howToTrade: [
      'Enter on the neckline break, or on the first retest of the neckline from above.',
      'Stop goes below the second low, so the level that defined the pattern has to break for the trade to be wrong.',
      'Target the measured move: the pattern height projected up from the neckline.',
      'A second low that comes in slightly higher after a sweep of the first is the stronger version — the stops were already taken.',
    ],
    invalidation:
      'Price closing below the second low — demand that looked twice-proven has failed.',
  },

  'Head and Shoulders': {
    summary:
      'A high, a higher high that fails, then a lower high: a distribution pattern whose neckline break marks the trend change.',
    formation: [
      'Price rallies, pulls back to form the left shoulder, then rallies into a new extreme — the head.',
      'Price pulls back and rallies again, but the right shoulder fails below the head, so buyers are visibly weaker.',
      'The neckline drawn through the two pullback lows breaks, confirming the pattern.',
    ],
    howToTrade: [
      'Do not short the right shoulder on faith. Wait for the neckline break, or the retest of it.',
      'Stop goes above the right shoulder, the last place this pattern would be invalidated.',
      'Target the measured move: the distance from head to neckline, projected from the break.',
      'This shape appears on every timeframe and the small ones fail the most, so give a five-minute version far less trust than a daily one.',
    ],
    invalidation:
      'A recovery through the right shoulder on the way to new highs — the distribution failed.',
  },

  'Bull Flag': {
    summary:
      'A sharp advance followed by tight drift lower — a pause that usually resolves in the direction of the advance.',
    formation: [
      'An impulse leg marks a clear advance, ideally on expanding volume.',
      'Price drifts sideways to lower in a tight channel, candles overlapping and volume falling.',
      'The flag breaks upward and the trend resumes from where it paused.',
    ],
    howToTrade: [
      'Enter on the break of the flag high, or on the first pullback that holds above it.',
      'Stop goes below the flag low. A flag that breaks its own floor is not a flag any more.',
      'Target the measured move: the pole height projected from the break.',
      'The tighter and shorter the pause, the more reliable it is. Wide, sloppy flags are usually just ranges.',
    ],
    invalidation:
      'Price breaking the flag floor and holding below it — the pause has become a reversal and the impulse is spent.',
  },

  'Bear Flag': {
    summary:
      'A sharp decline followed by tight drift higher — a pause that usually resolves in the direction of the decline.',
    formation: [
      'An impulse leg marks a clear decline, ideally on expanding volume.',
      'Price drifts sideways to higher in a tight channel, candles overlapping and volume falling.',
      'The flag breaks downward and the downtrend resumes.',
    ],
    howToTrade: [
      'Enter on the break of the flag low, or on the first retest of it from below.',
      'Stop goes above the flag high, the level that defines the pause.',
      'Target the measured move: the pole height projected from the break.',
      'A bear flag into major support is a trap. Check what sits below before pressing the short.',
    ],
    invalidation:
      'Price reclaiming the flag high and holding above it — the pause has turned into a reversal.',
  },

  'Inside Bar Break': {
    summary:
      'A bar fully contained inside the previous one marks compression, and the break of the mother bar usually resolves with expansion.',
    formation: [
      'A wide-range candle — the mother bar — prints on a burst of volatility.',
      'The next candle trades entirely inside its range, high to low: indecision inside the new range.',
      'Price breaks one edge of the mother bar and the compression resolves.',
    ],
    howToTrade: [
      'Enter on the break of the mother bar edge, in the direction of the break.',
      'Stop goes on the far side of the mother bar, or tighter beyond the inside bar.',
      'Target the next structure level, or a measured move of the mother bar range.',
      'Direction matters: an inside bar after a strong impulse breaks with the impulse far more often than against it.',
    ],
    invalidation:
      'Price wandering back into the middle of the mother bar without resolving either edge — the compression meant nothing.',
  },

  'Three-Bar Reversal': {
    summary:
      'A push, a stall, and a push back the other way in three candles — the smallest complete reversal shape, the morning and evening star.',
    formation: [
      'A candle continues the existing trend with a decent body.',
      'A small-bodied candle follows, printing a lower low or higher high that fails to hold.',
      'A third candle closes back the other way with a full body, past the midpoint of the first candle.',
    ],
    howToTrade: [
      'Enter on the close of the third candle, or on a retrace into its body.',
      'Stop goes beyond the extreme of the middle candle — the wick that failed is the line.',
      'Target the nearest opposing structure, and treat the midpoint of the first candle as the minimum confirmation.',
      'The smallest reversal pattern is also the most common false one, so demand it at a level and never in the middle of a range.',
    ],
    invalidation:
      'Price taking out the extreme of the middle candle and holding there — the reversal never took control.',
  },
};

/**
 * Lookup for a setup name. The exact catalog name always wins; the loose substring
 * matchers after it exist only for names the trader typed themselves.
 *
 * Order matters more than it looks: the fuzzy rules would happily send a failed
 * breakout to the breakout guide, and Bull Flag to the first guide containing
 * "flag", so the catalog is checked before any of them get a say.
 */
export function resolveSetupGuide(setupName: string): SetupGuide | undefined {
  const cleaned = setupName.trim().toLowerCase();

  const exact = Object.entries(SETUP_GUIDES).find(([name]) => name.toLowerCase() === cleaned);
  if (exact) return exact[1];

  if (cleaned.includes('engulf')) return SETUP_GUIDES.Engulfing;
  if (cleaned === 'support') return SETUP_GUIDES.Support;
  if (cleaned === 'resistance') return SETUP_GUIDES.Resistance;
  if (cleaned.includes('breakout')) return SETUP_GUIDES.Breakout;
  if (cleaned.includes('reversal')) return SETUP_GUIDES.Reversal;
  if (cleaned.includes('continuation')) return SETUP_GUIDES['Trend Continuation'];
  if (cleaned === 'other') return SETUP_GUIDES.Other;
  return undefined;
}
