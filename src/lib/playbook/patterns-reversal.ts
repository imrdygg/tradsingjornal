import { PatternSetup } from './pattern-types';

/**
 * The 10 reversal patterns from the source cheat sheet, in sheet order.
 *
 * Wording note: every entry keeps the sheet's own label in `sourceName` and describes the
 * geometry the sheet draws next to it. Where the label and the drawing disagree, the
 * disagreement is recorded in `sourceNote` instead of being quietly resolved.
 */
export const REVERSAL_PATTERNS: PatternSetup[] = [
  {
    id: 'reversal-bearish-double-top',
    sourceName: 'Bearish Double Top',
    displayName: 'Bearish Double Top',
    category: 'reversal',
    bias: 'bearish',
    sourcePosition: 1,
    summary:
      'Price tests roughly the same resistance area twice, fails to continue higher, then breaks the swing low between the two peaks.',
    marketStory: [
      'Price arrives with bullish momentum.',
      'Buyers create the first major high.',
      'Sellers push price down and create a reaction low.',
      'Buyers make a second attempt at the same resistance area.',
      'The second attempt fails to establish acceptance above the first peak.',
      'A break below the middle reaction low suggests control is shifting to sellers.',
    ],
    requiredStructure: [
      'A visible prior advance or bullish leg.',
      'A first peak at a meaningful resistance area.',
      'A pullback that creates a clear swing low — this becomes the neckline.',
      'A second peak in approximately the same resistance zone, not above it.',
      'Rejection or failure to continue higher at that zone.',
      'For confirmation, price breaks and CLOSES below the neckline rather than only touching it.',
    ],
    formationSequence: [
      'Uptrend or impulse higher.',
      'First top forms.',
      'Price pulls back to form the swing low.',
      'Second top forms near the first.',
      'Price rolls over and the neckline is tested.',
      'A close below the neckline confirms the pattern idea.',
    ],
    confirmation: [
      'Strongest educational confirmation: a candle CLOSING below the neckline/swing low.',
      'Secondary confirmation: a break, a retest of the neckline from underneath, then a bearish rejection.',
      'The second top itself is never confirmation — it is only a bearish clue.',
    ],
    invalidation: [
      'Price decisively breaks and holds above both tops.',
      'The neckline breaks but price immediately reclaims it and accepts back inside the pattern.',
      'The two peaks are too far apart in price or structure to be the same resistance zone.',
    ],
    targetConcepts: [
      'Measure the vertical distance from the top zone to the neckline.',
      'Project that distance downward from the confirmed neckline break.',
      'The measured move is a reference; nearby prior support and liquidity usually matter sooner.',
    ],
    commonMistakes: [
      'Entering short before the neckline breaks.',
      'Calling any two highs a double top.',
      'Ignoring a strong higher-high breakout above resistance.',
      'Using one exact price for the top instead of a resistance zone.',
    ],
    checklist: [
      'The second peak failed to close above the first peak zone.',
      'The neckline is a real swing low, not the midpoint of two wicks.',
      'I have written down what a close above the tops would mean.',
    ],
    animation: {
      priorTrend: 'A rising price leg arrives into the resistance area.',
      formation: 'The first peak, the pullback and its neckline, then the second peak at the same zone.',
      trigger: 'Price rolls over from the second peak and returns to the neckline.',
      breakout: 'A close below the neckline is marked, then the bearish arrow.',
      retest: 'Optional: price returns to the broken neckline from below and is rejected.',
      target: 'Optional: the top-to-neckline height projected downward.',
    },
  },

  {
    id: 'reversal-bearish-head-shoulders',
    sourceName: 'Bearish Head Shoulders',
    displayName: 'Bearish Head Shoulders',
    category: 'reversal',
    bias: 'bearish',
    sourcePosition: 2,
    summary:
      'A left shoulder, a higher central head and a lower right shoulder, joined by a neckline connecting the reaction lows.',
    marketStory: [
      'Bulls create an initial high — the left shoulder.',
      'Price pulls back.',
      'Bulls make a stronger push and create the highest high — the head.',
      'Price falls back again.',
      'Another rally fails to reach the head — the right shoulder.',
      'That lower high suggests bullish momentum is weakening, and a neckline break provides the structure.',
    ],
    requiredStructure: [
      'A prior bullish trend or a strong advance.',
      'A left shoulder.',
      'A clearly higher head.',
      'A right shoulder that sits below the head and near or below the left shoulder.',
      'Two reaction lows that define a usable neckline.',
      'A break and close below the neckline for confirmation.',
    ],
    formationSequence: [
      'Uptrend into the pattern.',
      'Left shoulder forms.',
      'Pullback to the neckline area.',
      'Higher head forms.',
      'Second pullback to the neckline area.',
      'Lower right shoulder forms.',
      'Neckline breaks.',
    ],
    confirmation: [
      'A close below the neckline.',
      'Secondary confirmation: retest of the neckline from underneath.',
      'A rejection at the right shoulder is an early clue, not full confirmation.',
    ],
    invalidation: [
      'Price pushes above the head and holds there.',
      'A neckline break immediately reverses and price regains the whole structure.',
      'The shape has no meaningful head, or no neckline worth drawing.',
    ],
    targetConcepts: [
      'Measure from the head to the neckline.',
      'Project that distance down from the neckline break.',
      'Nearby support is the practical context for the projection.',
    ],
    commonMistakes: [
      'Treating an ordinary three-swing range as head and shoulders.',
      'Shorting before the neckline is broken.',
      'Ignoring a strongly rising neckline, which changes the geometry.',
    ],
    checklist: [
      'The head is clearly higher than both shoulders.',
      'The neckline connects two real reaction lows.',
      'The right shoulder is below the head, not above it.',
    ],
    animation: {
      priorTrend: 'A bullish impulse builds the left side of the structure.',
      formation: 'Left shoulder, first neckline anchor, higher head, second neckline anchor, lower right shoulder.',
      trigger: 'The neckline is extended across the pattern as price returns to it.',
      breakout: 'A close below the neckline, then the bearish arrow.',
      retest: 'Optional: price retests the broken neckline from underneath.',
      target: 'Optional: head-to-neckline height projected down.',
    },
  },

  {
    id: 'reversal-bearish-rising-wedge',
    sourceName: 'Bearish Rising Wedge',
    displayName: 'Bearish Rising Wedge',
    category: 'reversal',
    bias: 'bearish',
    sourcePosition: 3,
    summary:
      'A rising, narrowing structure where highs and lows keep rising but the two boundaries converge, suggesting weakening momentum before a downside break.',
    marketStory: [
      'Price is still printing higher highs and higher lows.',
      'Each push covers less distance and the swings compress.',
      'Buyers remain active, but upside progress becomes less efficient.',
      'A break below the lower wedge line signals the rising structure has failed.',
    ],
    requiredStructure: [
      'A prior advance or clear bullish context.',
      'Rising swing highs and rising swing lows.',
      'Two rising trend lines that converge rather than run parallel.',
      'Multiple touches showing the boundaries actually matter.',
      'A downside break of the lower wedge boundary.',
    ],
    formationSequence: [
      'A strong move up establishes the trend.',
      'Oscillating higher highs and higher lows develop.',
      'The upper and lower boundaries are drawn and converge.',
      'Each successive swing becomes smaller.',
      'Price fails to extend above the upper boundary again.',
      'Price breaks below the lower boundary.',
    ],
    confirmation: [
      'A close below the lower wedge line.',
      'Stronger if the breakdown also loses a recent swing low.',
      'Optional secondary confirmation: a retest of the broken lower boundary.',
    ],
    invalidation: [
      'Price breaks above the upper wedge resistance and sustains acceptance there.',
      'The boundaries do not converge — it was a channel.',
      'The pattern is too immature, with only one meaningful touch on a boundary.',
    ],
    targetConcepts: [
      'The first objective can be the most recent major swing low before the break.',
      'A wider measured concept uses the widest part of the wedge projected from the break.',
    ],
    commonMistakes: [
      'Confusing a rising channel with a rising wedge.',
      'Assuming every rising wedge must break down.',
      'Drawing trend lines through random wick extremes just to force convergence.',
    ],
    checklist: [
      'The two boundaries converge — this is a wedge, not a channel.',
      'Each swing is smaller than the one before it.',
      'I have marked the swing low that would confirm the break.',
    ],
    animation: {
      priorTrend: 'A strong move up.',
      formation: 'Oscillating higher highs and higher lows with shrinking swing size.',
      trigger: 'Converging upper and lower boundaries are drawn around the swings.',
      breakout: 'The lower boundary gives way: a pulse at the break, then the bearish arrow.',
      target: 'Optional: the widest wedge width projected down.',
    },
  },

  {
    id: 'reversal-bearish-expanding-triangle',
    sourceName: 'Bearish Expanding Triangle',
    displayName: 'Bearish Expanding Triangle',
    category: 'reversal',
    bias: 'bearish',
    sourcePosition: 4,
    sourceNote:
      'The source illustration is a bearish example: an expanding structure that resolves below the lower boundary. An expanding triangle is two-directional in general, so the direction here is the source drawing, not a claim about the pattern.',
    summary:
      'A broadening structure where swings get progressively wider; the source illustration resolves to the downside through the lower boundary.',
    marketStory: [
      'Volatility expands instead of compressing.',
      'Buyers push to larger highs while sellers push to deeper lows.',
      'The market becomes increasingly unstable and two-sided.',
      'The source example resolves with a break beneath the lower boundary.',
    ],
    requiredStructure: [
      'Alternating swings whose range keeps increasing.',
      'Diverging upper and lower boundaries.',
      'Clear expansion of range rather than compression.',
      'Bearish version: a downside break beneath the lower boundary.',
    ],
    formationSequence: [
      'A prior move establishes the starting point.',
      'Alternating swings widen on both sides.',
      'Diverging boundaries can be drawn.',
      'Volatility is visibly increasing.',
      'Neither side can hold an extreme for long.',
      'Price breaks below the lower boundary.',
    ],
    confirmation: [
      'A close outside and below the lower expanding boundary.',
      'Structural confirmation preferred: act on the exit, never inside the broadening range.',
    ],
    invalidation: [
      'Price re-enters and holds inside the formation after the breakdown.',
      'The structure is actually converging rather than expanding.',
      'There are too few swing points to define broadening boundaries.',
    ],
    targetConcepts: [
      'Prior swing low or support beneath the formation is the first reference.',
      'A width-based measured move may be shown as an educational projection only.',
    ],
    commonMistakes: [
      'Trading every touch inside a volatile broadening structure.',
      'Confusing an expanding triangle with a converging one.',
      'Assuming a direction before price leaves the range.',
    ],
    checklist: [
      'The boundaries diverge — swings are genuinely getting wider.',
      'I am waiting for a close outside the structure, not predicting it.',
      'I have accepted that either direction can resolve.',
    ],
    animation: {
      priorTrend: 'The prior move arrives into the broadening range.',
      formation: 'Alternating swings enlarge on both sides.',
      trigger: 'Diverging boundaries and a note that volatility is expanding.',
      breakout: 'A break below the lower boundary, then the bearish arrow.',
      target: 'Optional: width projected down toward prior support.',
    },
  },

  {
    id: 'reversal-bearish-triple-top',
    sourceName: 'Bearish Triple Top',
    displayName: 'Bearish Triple Top',
    category: 'reversal',
    bias: 'bearish',
    sourcePosition: 5,
    summary:
      'Price rejects approximately the same resistance zone three times, then breaks the support/neckline beneath the formation.',
    marketStory: [
      'Buyers test the same overhead area three times.',
      'Every attempt fails to produce sustainable acceptance higher.',
      'Repeated rejection can show exhausted demand at that resistance.',
      'A break of the support beneath the structure confirms the bearish idea.',
    ],
    requiredStructure: [
      'A prior advance.',
      'Three distinct peaks in approximately the same resistance zone.',
      'Reaction lows between those peaks.',
      'A usable support/neckline beneath the formation.',
      'A breakdown below that support for confirmation.',
    ],
    formationSequence: [
      'Rise into resistance.',
      'First top forms.',
      'Pullback, and the support line is drawn.',
      'Second top forms.',
      'Another pullback.',
      'Third top forms.',
      'Support breaks.',
    ],
    confirmation: [
      'A close below the neckline/support zone after the third rejection.',
      'Optional secondary confirmation: a retest from below.',
    ],
    invalidation: [
      'Price decisively breaks and holds above the triple-top resistance.',
      'The three peaks are not actually testing the same area.',
    ],
    targetConcepts: [
      'Top resistance to neckline height projected down from the break.',
      'Nearby historical support as practical context.',
    ],
    commonMistakes: [
      'Shorting the third peak without waiting for structural failure.',
      'Forcing three ordinary highs into one pattern.',
    ],
    checklist: [
      'All three peaks are in the same resistance zone.',
      'I am treating the third rejection as a clue, not a trigger.',
      'The support line under the formation is clearly drawn.',
    ],
    animation: {
      priorTrend: 'A rise into the resistance zone.',
      formation: 'First top, pullback and support line, then the second and third tops.',
      trigger: 'Price returns to the support line as the third rejection completes.',
      breakout: 'Support gives way, then the bearish arrow.',
      target: 'Optional: resistance-to-support height projected down.',
    },
  },

  {
    id: 'reversal-bullish-double-bottom',
    sourceName: 'Bullish Double Bottom',
    displayName: 'Bullish Double Bottom',
    category: 'reversal',
    bias: 'bullish',
    sourcePosition: 6,
    summary:
      'Price tests roughly the same support area twice, fails to continue lower, then breaks the swing high between the two lows.',
    marketStory: [
      'Sellers create the first major low.',
      'Buyers rally price to a reaction high.',
      'Sellers make another attempt at the low.',
      'The second attempt fails to create sustainable downside continuation.',
      'A break above the middle reaction high suggests buyers are taking control.',
    ],
    requiredStructure: [
      'A prior decline or bearish leg.',
      'A first low near support.',
      'A reaction high that becomes the neckline.',
      'A second low near the first low, not below it.',
      'Rejection or failure to continue lower.',
      'A break and close above the neckline for confirmation.',
    ],
    formationSequence: [
      'Decline into support.',
      'First bottom forms.',
      'Rally forms the neckline.',
      'Second bottom forms near the first.',
      'Price rallies back to the neckline.',
      'The neckline breaks.',
    ],
    confirmation: [
      'A close above the neckline.',
      'Optional secondary confirmation: a breakout-retest of the neckline from above.',
    ],
    invalidation: [
      'Price breaks and holds below both bottoms.',
      'The breakout above the neckline immediately fails and price falls back into or under the structure.',
    ],
    targetConcepts: [
      'Measure bottom-to-neckline height and project it above the breakout.',
      'Map the prior resistance above as the practical reference.',
    ],
    commonMistakes: [
      'Buying the second low before neckline confirmation.',
      'Requiring both lows to be the exact same price.',
    ],
    checklist: [
      'The second low held above or at the first low.',
      'The neckline is a real reaction high from between the lows.',
      'I have marked what a close below the lows would mean.',
    ],
    animation: {
      priorTrend: 'A decline into the support area.',
      formation: 'First bottom, rally to the neckline, second bottom near the first.',
      trigger: 'Price rallies back to the neckline from the second low.',
      breakout: 'A close above the neckline, then the bullish arrow.',
      retest: 'Optional: the broken neckline is retested from above and holds.',
      target: 'Optional: bottom-to-neckline height projected up.',
    },
  },

  {
    id: 'reversal-bullish-inverted-head-shoulder',
    sourceName: 'Bullish Inverted Head and Shoulder',
    displayName: 'Bullish Inverted Head and Shoulder',
    category: 'reversal',
    bias: 'bullish',
    sourcePosition: 7,
    summary:
      'A left shoulder low, a deeper head, a shallower right shoulder, and a neckline joining the reaction highs.',
    marketStory: [
      'Sellers create a first low.',
      'A rebound creates the first neckline point.',
      'Sellers force a deeper low — the head.',
      'Buyers rebound again.',
      'The final selloff fails to reach the head, creating the right shoulder.',
      'A neckline break suggests sellers are losing control.',
    ],
    requiredStructure: [
      'A prior bearish trend or a strong decline.',
      'A left shoulder low.',
      'A clearly lower head.',
      'A higher right shoulder that holds above the head.',
      'Two reaction highs that define the neckline.',
      'A break and close above the neckline for confirmation.',
    ],
    formationSequence: [
      'Decline into the pattern.',
      'Left shoulder low forms.',
      'Rally to the first neckline point.',
      'Deeper head forms.',
      'Rally to the second neckline point.',
      'Shallower right shoulder forms.',
      'Neckline breaks upward.',
    ],
    confirmation: [
      'A close above the neckline.',
      'Optional secondary confirmation: a retest from above that holds.',
    ],
    invalidation: [
      'Price breaks beneath the head and holds there.',
      'The breakout above the neckline fails and price falls back through the right-shoulder region.',
    ],
    targetConcepts: [
      'Head-to-neckline distance projected upward from the break.',
      'Nearby resistance zones as practical context.',
    ],
    commonMistakes: [
      'Buying simply because three lows exist.',
      'Ignoring a right shoulder that makes a new low below the head.',
    ],
    checklist: [
      'The head is clearly the lowest of the three lows.',
      'The right shoulder held above the head.',
      'The neckline joins two real reaction highs.',
    ],
    animation: {
      priorTrend: 'A decline into the structure.',
      formation: 'Left shoulder low, rally to the neckline, deeper head, rally, shallower right shoulder.',
      trigger: 'The neckline is drawn across both reaction highs.',
      breakout: 'A close above the neckline, then the bullish arrow.',
      retest: 'Optional: retest of the broken neckline from above.',
      target: 'Optional: head-to-neckline height projected up.',
    },
  },

  {
    id: 'reversal-bullish-falling-wedge',
    sourceName: 'Bullish Falling Wedge',
    displayName: 'Bullish Falling Wedge',
    category: 'reversal',
    bias: 'bullish',
    sourcePosition: 8,
    summary:
      'A declining but narrowing structure where lower highs and lower lows keep coming while the two descending boundaries converge before an upside break.',
    marketStory: [
      'Price continues moving lower.',
      'Sellers keep making new lows, but the distance of each move shrinks.',
      'Downside momentum becomes less efficient.',
      'A break above the upper wedge line signals the descending structure has failed.',
    ],
    requiredStructure: [
      'A prior decline or bearish context.',
      'Descending swing highs and descending swing lows.',
      'Two downward-sloping trend lines that converge.',
      'An upside break of the upper wedge boundary.',
    ],
    formationSequence: [
      'A decline establishes the trend.',
      'Lower highs and lower lows develop with shrinking swing size.',
      'Each push lower covers less ground than the one before it.',
      'Converging boundaries are drawn.',
      'Price reaches the narrowed tip of the wedge.',
      'Price breaks above the upper boundary.',
    ],
    confirmation: [
      'A close above the upper wedge line.',
      'Stronger if price also reclaims a recent swing high.',
      'Optional secondary confirmation: a retest of the broken wedge resistance from above.',
    ],
    invalidation: [
      'Price breaks below the lower wedge line and continues lower.',
      'The boundaries stay parallel instead of converging.',
    ],
    targetConcepts: [
      'The recent major swing high is the first reference.',
      'The widest part of the wedge projected upward is the wider measured concept.',
    ],
    commonMistakes: [
      'Confusing a descending channel with a falling wedge.',
      'Buying before the upper boundary is broken.',
    ],
    checklist: [
      'The boundaries converge — this is a wedge, not a channel.',
      'Each swing down is smaller than the one before it.',
      'I am waiting for a close above the upper boundary.',
    ],
    animation: {
      priorTrend: 'A decline into the pattern.',
      formation: 'Lower highs and lower lows with shrinking swing size.',
      trigger: 'Converging boundaries are drawn around the swings.',
      breakout: 'A close above the upper boundary and a pulse at the break, then the bullish arrow.',
      target: 'Optional: widest wedge width projected up.',
    },
  },

  {
    id: 'reversal-bullish-expanding-triangle',
    sourceName: 'Bullish Expanding Triangle',
    displayName: 'Bullish Expanding Triangle',
    category: 'reversal',
    bias: 'bullish',
    sourcePosition: 9,
    sourceNote:
      'The source illustration is a bullish example that resolves above the upper boundary. The pattern itself is two-directional; the direction here is the drawing, not a claim.',
    summary:
      'A broadening structure with increasingly wide swings; the source illustration resolves above the upper boundary.',
    marketStory: [
      'Volatility expands with larger alternating moves.',
      'Neither side controls the interior cleanly.',
      'Each swing overshoots the previous extreme on both sides.',
      'In the source example, buyers eventually break the upper expanding boundary.',
    ],
    requiredStructure: [
      'Alternating swings whose range keeps increasing.',
      'Diverging boundaries.',
      'Clear expansion in volatility.',
      'An upside break above the upper boundary for the bullish resolution.',
    ],
    formationSequence: [
      'Price transitions into broadening action.',
      'Larger alternating swings develop.',
      'Each swing overshoots the last on both sides.',
      'Diverging boundaries are drawn.',
      'Price reaches the widest part of the structure.',
      'Price breaks above the upper boundary.'
    ],
    confirmation: [
      'A close outside and above the upper boundary.',
      'An interior swing is not a breakout, however large it looks.',
    ],
    invalidation: [
      'Price re-enters and holds back inside the structure after the breakout.',
      'The pattern does not actually broaden.',
    ],
    targetConcepts: [
      'Prior resistance above is the first reference.',
      'A width-based projection is an optional educational guide only.',
    ],
    commonMistakes: [
      'Predicting the bullish resolution before the breakout.',
      'Confusing broadening with a converging triangle.',
    ],
    checklist: [
      'The boundaries diverge — swings are genuinely getting wider.',
      'I am waiting for a close outside the structure.',
      'I have accepted that either direction can resolve.',
    ],
    animation: {
      priorTrend: 'A decline or transition into broadening action.',
      formation: 'Larger and larger alternating swings.',
      trigger: 'Diverging boundaries are drawn.',
      breakout: 'A break above the upper boundary, then the bullish arrow.',
      target: 'Optional: width projected up toward prior resistance.',
    },
  },

  {
    id: 'reversal-bullish-triple-bottom',
    sourceName: 'Bullish Triple Bottom',
    displayName: 'Bullish Triple Bottom',
    category: 'reversal',
    bias: 'bullish',
    sourcePosition: 10,
    summary:
      'Price rejects approximately the same support zone three times, then breaks the resistance/neckline above the formation.',
    marketStory: [
      'Sellers test the same support area repeatedly.',
      'Three failures to continue lower suggest supply cannot achieve a clean breakdown.',
      'The third test fails to print a new low, which is the first real change of character.',
      'A break above the neckline shows improving buyer control.',
    ],
    requiredStructure: [
      'A prior decline.',
      'Three lows in approximately the same support zone.',
      'Reaction highs between those lows.',
      'A clear resistance/neckline above the formation.',
      'A break and close above the neckline for confirmation.',
    ],
    formationSequence: [
      'Decline into support.',
      'First bottom forms.',
      'Rally to resistance.',
      'Second bottom forms.',
      'Rally again.',
      'Third bottom forms.',
      'Resistance breaks upward.',
    ],
    confirmation: [
      'A close above the resistance/neckline after the third bottom.',
      'Optional secondary confirmation: a retest from above.',
    ],
    invalidation: [
      'Price decisively breaks and holds below triple-bottom support.',
      'The three lows are not testing the same structural zone.',
    ],
    targetConcepts: [
      'Support-to-neckline height projected upward.',
      'Prior resistance levels above as the practical reference.',
    ],
    commonMistakes: [
      'Buying the third low without waiting for a break above resistance.',
      'Treating a messy range as a triple bottom.',
    ],
    checklist: [
      'All three lows are in the same support zone.',
      'The third hold is a clue, not a trigger.',
      'Resistance above the formation is clearly drawn.',
    ],
    animation: {
      priorTrend: 'A decline into the support zone.',
      formation: 'First bottom, rally to resistance, second bottom, rally, third bottom.',
      trigger: 'Price returns to resistance as the third hold completes.',
      breakout: 'A close above resistance, then the bullish arrow.',
      target: 'Optional: support-to-resistance height projected up.',
    },
  },
];
