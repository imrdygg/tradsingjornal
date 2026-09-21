import { PatternSetup } from './pattern-types';

/**
 * The 10 continuation patterns from the source cheat sheet, in sheet order.
 *
 * The sheet repeats two labels across its bullish and bearish rows and prints one
 * non-standard name. All three are kept exactly as printed: the repeated labels get
 * unique ids and a disambiguating `displayName`, and each mismatch between a label and the
 * drawing beside it is written down in `sourceNote` rather than corrected in silence.
 */
export const CONTINUATION_PATTERNS: PatternSetup[] = [
  {
    id: 'continuation-bullish-flag',
    sourceName: 'Bullish Flag Pattern',
    displayName: 'Bullish Flag Pattern',
    category: 'continuation',
    bias: 'bullish',
    sourcePosition: 11,
    summary:
      'A strong bullish impulse followed by a smaller orderly downward or sideways channel, then an upside break in the direction of the original move.',
    marketStory: [
      'Buyers create a strong flagpole.',
      'Price pauses and pulls back in a controlled way.',
      'The correction stays contained relative to the impulse.',
      'Buyers regain control and break the flag boundary.',
    ],
    requiredStructure: [
      'A strong upward flagpole/impulse.',
      'A small corrective phase.',
      'Usually two roughly parallel downward or sideways boundaries.',
      'A correction that looks weaker than the initial impulse.',
      'An upside break through the upper flag boundary.',
    ],
    formationSequence: [
      'A fast bullish impulse prints the flagpole.',
      'Price slows and turns into a controlled pullback.',
      'Two parallel boundaries form the flag channel.',
      'Price oscillates inside the channel.',
      'Buyers step back in and the channel tightens against its upper boundary.',
      'The upper boundary breaks and the trend resumes.',
    ],
    confirmation: [
      'A close above the upper flag boundary.',
      'Stronger if price also clears the most recent corrective swing high.',
    ],
    invalidation: [
      'The pullback becomes too deep and destroys the original impulse structure.',
      'Price breaks below the lower flag boundary and keeps going down.',
    ],
    targetConcepts: [
      'Project part or all of the flagpole length from the breakout.',
      'Map nearby resistance as the practical reference.',
    ],
    commonMistakes: [
      'Calling a deep trend reversal a flag.',
      'Entering in the middle of the pullback.',
      'Drawing a flag with no clear flagpole.',
    ],
    checklist: [
      'There is a clear flagpole, not just a drift up.',
      'The correction is small relative to the impulse.',
      'The two flag boundaries are roughly parallel.',
    ],
    animation: {
      priorTrend: 'The bullish impulse prints quickly as the flagpole.',
      formation: 'A compact parallel channel drifts down from the flagpole high.',
      trigger: 'Price oscillates inside the channel and reaches the upper edge.',
      breakout: 'The upper boundary breaks, then the bullish continuation arrow.',
      retest: 'Optional: the broken boundary is retested and holds.',
      target: 'Optional: flagpole length projected from the break.',
    },
  },

  {
    id: 'continuation-bullish-pennant',
    sourceName: 'Bullish Pennant Pattern',
    displayName: 'Bullish Pennant Pattern',
    category: 'continuation',
    bias: 'bullish',
    sourcePosition: 12,
    summary:
      'A strong bullish impulse followed by a small converging consolidation, then an upside continuation break.',
    marketStory: [
      'Buyers create a strong impulse.',
      'Price pauses and compresses.',
      'Highs and lows converge toward an apex.',
      'A break above the upper boundary resumes the original bullish direction.',
    ],
    requiredStructure: [
      'A strong bullish flagpole.',
      'A small converging consolidation.',
      'Lower highs and higher lows inside the pennant.',
      'A pennant that is compact relative to the flagpole.',
      'An upside break.',
    ],
    formationSequence: [
      'A sharp move up prints the flagpole.',
      'A contracting mini triangle forms.',
      'Lower highs and higher lows narrow the range.',
      'Oscillations get progressively smaller.',
      'Price reaches the apex with the flagpole intact.',
      'The upper line breaks and the move continues.',
    ],
    confirmation: [
      'A close above the upper pennant line.',
      'Optional secondary confirmation: a breakout retest.',
    ],
    invalidation: [
      'Price breaks through the lower boundary and accepts below it.',
      'The consolidation becomes too large or too long relative to the impulse.',
    ],
    targetConcepts: [
      'Flagpole length projected from the breakout.',
      'Nearby resistance as the practical reference.',
    ],
    commonMistakes: [
      'Confusing a large symmetrical triangle with a small pennant.',
      'Forgetting that the preceding impulse is part of the setup.',
    ],
    checklist: [
      'The consolidation converges — a pennant, not a channel.',
      'The pennant is small relative to the flagpole.',
      'The flagpole is a real impulse, not a slow grind.',
    ],
    animation: {
      priorTrend: 'A sharp move up prints the flagpole.',
      formation: 'A contracting mini triangle pulls highs and lows together.',
      trigger: 'Oscillations shrink toward the apex.',
      breakout: 'The upper line breaks, then the bullish continuation arrow.',
      target: 'Optional: flagpole length projected from the break.',
    },
  },

  {
    id: 'continuation-bullish-falling-village',
    sourceName: 'Bullish Falling Village',
    displayName: 'Bullish Falling Village',
    category: 'continuation',
    bias: 'bullish',
    sourcePosition: 13,
    sourceNote:
      'The source sheet prints "Bullish Falling Village", which is not a standard chart-pattern name. The label is preserved exactly as printed and the geometry taught here is the one the sheet draws beside it: a bullish impulse, a descending consolidation bounded by two sloping lines, then an upside continuation. "Falling consolidation / bullish channel-style continuation" is an alias added by this playbook, not a name from the source.',
    aliases: ['Falling consolidation / bullish channel-style continuation'],
    summary:
      'A bullish continuation built from the source geometry: a strong move up, a descending consolidation between two sloping boundaries, then an upside break that resumes the trend.',
    marketStory: [
      'Buyers create an impulse higher.',
      'Price pulls back in a controlled descending structure.',
      'Selling pressure does not erase the original impulse.',
      'Price breaks above the descending structure and resumes higher.',
    ],
    requiredStructure: [
      'A clear bullish impulse before the pattern.',
      'A descending correction with multiple swings.',
      'Two sloping boundaries matching the source drawing.',
      'An upside break of the upper boundary.',
    ],
    formationSequence: [
      'A strong bullish impulse prints.',
      'Sellers push the correction down without erasing the impulse.',
      'A descending zig-zag correction develops.',
      'The two sloping boundaries are drawn.',
      'Price compresses against the upper descending boundary.',
      'Price breaks above the upper boundary.',
    ],
    confirmation: [
      'A close above the upper boundary.',
      'Optional secondary confirmation: reclaiming the most recent correction high.',
    ],
    invalidation: [
      'Price breaks below the lower boundary and continues lower.',
      'The pullback grows larger than the impulse context and behaves like a reversal.',
    ],
    targetConcepts: [
      'The prior high is the first reference.',
      'A flagpole-style projection is an optional visual guide.',
    ],
    commonMistakes: [
      'Renaming the source setup without recording the discrepancy.',
      'Treating any downward move after a rally as continuation.',
    ],
    checklist: [
      'I know the source label is unusual and is being preserved deliberately.',
      'The descending structure is a correction, not a reversal.',
      'The upper boundary is drawn from real reactions.',
    ],
    animation: {
      priorTrend: 'A strong bullish impulse prints the pole.',
      formation: 'A descending zig-zag correction builds inside two sloping boundaries.',
      trigger: 'Price reaches the upper boundary as the correction matures.',
      breakout: 'The upper boundary breaks, then the bullish arrow.',
      target: 'Optional: prior high, then a flagpole-style projection.',
    },
  },

  {
    id: 'continuation-descending-triangle-bullish-source',
    sourceName: 'Descending Triangle',
    displayName: 'Descending Triangle — bullish source illustration',
    category: 'continuation',
    bias: 'bullish',
    sourcePosition: 14,
    sourceNote:
      'The source illustration in the bullish row is labelled "Descending Triangle" but draws flat upper resistance with RISING lows and an upside break, which is not the geometry usually implied by that name. The label is preserved; the geometry taught here is what the sheet draws. An alias is recorded for clarity.',
    aliases: ['Bullish triangle - source geometry uses rising support'],
    summary:
      'Taught as drawn in the source: flat upper resistance, rising lower support, increasing compression, then an upside break through the ceiling.',
    marketStory: [
      'Price repeatedly tests the same resistance ceiling.',
      'Pullbacks become shallower as buyers step in at progressively higher prices.',
      'Pressure builds underneath resistance.',
      'The source drawing resolves with a break above the flat ceiling.',
    ],
    requiredStructure: [
      'Horizontal upper resistance.',
      'A rising sequence of lows.',
      'Compression toward the upper boundary.',
      'Multiple reactions at or near resistance.',
      'An upside break above resistance.',
    ],
    formationSequence: [
      'A bullish approach into resistance.',
      'Horizontal resistance is drawn.',
      'First pullback forms.',
      'Progressively higher lows follow.',
      'Rising support is drawn.',
      'Price compresses into the apex under the ceiling.',
      'Resistance breaks upward.',
    ],
    confirmation: [
      'A close above the horizontal resistance.',
      'Optional secondary confirmation: a retest of the former resistance as support.',
    ],
    invalidation: [
      'Price loses the rising support line and accepts lower.',
      'Repeated rejection at resistance turns into a larger reversal instead of a break.',
    ],
    targetConcepts: [
      'The height of the widest part of the triangle projected above the break.',
      'Nearby resistance zones as context.',
    ],
    commonMistakes: [
      'Hiding the source-label inconsistency instead of noting it.',
      'Assuming compression under resistance must break upward.',
    ],
    checklist: [
      'I can see the source geometry: flat ceiling, rising lows.',
      'I know this is not the textbook "descending triangle" shape.',
      'I am waiting for a close above the ceiling.',
    ],
    animation: {
      priorTrend: 'A bullish approach into resistance.',
      formation: 'Flat resistance, then a first pullback and progressively higher lows.',
      trigger: 'Rising support is drawn and price compresses into the apex.',
      breakout: 'A close above resistance, then the bullish arrow.',
      retest: 'Optional: the broken ceiling is retested as support.',
      target: 'Optional: widest triangle height projected up.',
    },
  },

  {
    id: 'continuation-symmetrical-expanding-triangle-upper-source',
    sourceName: 'Symmetrical Expanding Triangle',
    displayName: 'Symmetrical Expanding Triangle — upper / two-direction source illustration',
    category: 'continuation',
    bias: 'neutral',
    sourcePosition: 15,
    sourceNote:
      'The source row labels this "Symmetrical Expanding Triangle" while the drawing beside it looks more convergent than expanding, and it shows BOTH an upward and a downward arrow. The label is preserved and the illustration is animated exactly as drawn. The bias is therefore two-directional: the sheet itself does not pick a direction here.',
    summary:
      'A triangle-style consolidation where price oscillates between two boundaries before a directional break — the source illustration shows both directions as possible.',
    marketStory: [
      'Price alternates between two boundaries.',
      'Swings become organised toward a decision point.',
      'Direction is not assumed while price remains inside.',
      'Confirmation comes only after price exits and closes beyond a boundary.',
    ],
    requiredStructure: [
      'Multiple alternating swings.',
      'Clearly defined upper and lower boundaries.',
      'A compression/decision area matching the source geometry.',
      'No directional assumption before the break.',
    ],
    formationSequence: [
      'Price enters the consolidation.',
      'The upper and lower boundaries are drawn from real reactions.',
      'Alternating swings test both sides.',
      'Neither boundary has been broken yet.',
      'Price reaches the decision point.',
      'Price exits one way and closes beyond that boundary.',
    ],
    confirmation: [
      'Bullish case: a close above the upper boundary.',
      'Bearish case: a close below the lower boundary.',
      'Either outcome can be replayed, because the source shows both.',
    ],
    invalidation: [
      'A break immediately fails and price closes back inside the structure.',
      'The boundaries are arbitrary and the swings do not respect them.',
    ],
    targetConcepts: [
      'The width of the structure projected in the direction of the break.',
      'Nearby support and resistance as context.',
    ],
    commonMistakes: [
      'Guessing a direction before the break.',
      'Treating a wick outside the boundary as confirmation.',
    ],
    checklist: [
      'I have not picked a direction yet.',
      'Both boundaries are drawn from real reactions.',
      'I know the close beyond the boundary is what confirms it.',
    ],
    animation: {
      priorTrend: 'Price enters the consolidation.',
      formation: 'Two boundaries and alternating swings, matching the source geometry.',
      trigger: 'Price arrives at the decision point inside the structure.',
      breakout: 'Both possibilities are shown, then the default replay resolves upward.',
      retest: 'Optional: the broken boundary is retested.',
      target: 'Optional: structure width projected in the breakout direction.',
    },
  },

  {
    id: 'continuation-bearish-flag',
    sourceName: 'Bearish Flag Pattern',
    displayName: 'Bearish Flag Pattern',
    category: 'continuation',
    bias: 'bearish',
    sourcePosition: 16,
    summary:
      'A strong bearish impulse followed by a smaller upward or sideways corrective channel, then a downside break in the direction of the original move.',
    marketStory: [
      'Sellers create a strong bearish flagpole.',
      'Buyers produce a controlled rebound.',
      'The rebound is weaker than the original decline.',
      'Sellers regain control and break the lower flag boundary.',
    ],
    requiredStructure: [
      'A strong bearish flagpole.',
      'A controlled corrective bounce.',
      'Usually two roughly parallel upward or sideways boundaries.',
      'A downside break through the lower boundary.',
    ],
    formationSequence: [
      'A fast bearish drop prints the flagpole.',
      'Price slows into a rising parallel channel.',
      'Buyers fail to reclaim the flagpole low.',
      'Price oscillates inside the channel.',
      'The channel tightens against its lower boundary.',
      'The lower channel line breaks.',
    ],
    confirmation: [
      'A close below the lower flag boundary.',
      'Stronger if price also breaks the most recent corrective swing low.',
    ],
    invalidation: [
      'Price breaks above the upper flag boundary and continues higher.',
      'The correction retraces too much of the original bearish impulse.',
    ],
    targetConcepts: [
      'Flagpole-style projection downward.',
      'Prior support below as the practical reference.',
    ],
    commonMistakes: [
      'Shorting during the first bounce without waiting for the flag structure.',
      'Calling a full bullish reversal a bearish flag.',
    ],
    checklist: [
      'There is a clear bearish flagpole.',
      'The bounce is contained relative to the decline.',
      'The two boundaries are roughly parallel.',
    ],
    animation: {
      priorTrend: 'A fast bearish drop prints the flagpole.',
      formation: 'A compact parallel channel drifts up from the low.',
      trigger: 'Price reaches the lower boundary as the bounce matures.',
      breakout: 'The lower boundary breaks, then the bearish continuation arrow.',
      target: 'Optional: flagpole length projected down.',
    },
  },

  {
    id: 'continuation-bearish-pennant',
    sourceName: 'Bearish Pennant Pattern',
    displayName: 'Bearish Pennant Pattern',
    category: 'continuation',
    bias: 'bearish',
    sourcePosition: 17,
    summary:
      'A strong bearish impulse followed by a small converging consolidation, then a downside continuation break.',
    marketStory: [
      'Sellers create a sharp decline.',
      'Price compresses into a small triangle.',
      'The consolidation fails to reclaim the lost ground.',
      'Sellers break the lower pennant boundary.',
    ],
    requiredStructure: [
      'A strong bearish flagpole.',
      'A compact converging consolidation.',
      'Lower highs and higher lows inside the pennant.',
      'A downside break.',
    ],
    formationSequence: [
      'A sharp decline prints the flagpole.',
      'A small contracting triangle forms.',
      'Lower highs and higher lows narrow the range.',
      'Swings get progressively smaller.',
      'Price reaches the apex with the decline intact.',
      'The lower line breaks.',
    ],
    confirmation: [
      'A close below the lower pennant line.',
      'Optional secondary confirmation: a retest from underneath.',
    ],
    invalidation: [
      'Price breaks above the upper pennant boundary and accepts higher.',
      'The consolidation becomes too large relative to the flagpole.',
    ],
    targetConcepts: [
      'Flagpole length projected from the breakdown.',
      'Nearby support as the practical reference.',
    ],
    commonMistakes: [
      'Ignoring the need for a strong prior impulse.',
      'Confusing a large range with a compact pennant.',
    ],
    checklist: [
      'The consolidation converges — a pennant, not a range.',
      'The pennant is compact relative to the decline.',
      'I am waiting for a close below the lower line.',
    ],
    animation: {
      priorTrend: 'A sharp decline prints the flagpole.',
      formation: 'A small contracting triangle forms.',
      trigger: 'Swings shrink toward the apex.',
      breakout: 'The lower line breaks, then the bearish continuation arrow.',
      target: 'Optional: flagpole length projected down.',
    },
  },

  {
    id: 'continuation-bearish-rising-wedge',
    sourceName: 'Bearish Rising Wedge',
    displayName: 'Bearish Rising Wedge (continuation)',
    category: 'continuation',
    bias: 'bearish',
    sourcePosition: 18,
    sourceNote:
      'The sheet uses the label "Bearish Rising Wedge" in both its reversal and continuation rows. This is the continuation version: a wedge that forms as a correction after a bearish impulse. The reversal version is a separate card, and both keep the source label.',
    summary:
      'Price drops, then recovers inside a narrowing rising structure, then breaks lower and resumes the prior bearish move.',
    marketStory: [
      'Sellers create the initial decline.',
      'Buyers stage a rebound.',
      'The rebound rises but compresses and loses efficiency.',
      'Sellers break the lower wedge boundary and the original direction resumes.',
    ],
    requiredStructure: [
      'A prior bearish impulse.',
      'A rising correction after that impulse.',
      'Higher highs and higher lows during the correction.',
      'Converging rising boundaries.',
      'A downside break of the lower boundary.',
    ],
    formationSequence: [
      'A bearish impulse prints.',
      'A rising correction develops.',
      'Higher highs and higher lows compress into a narrowing rise.',
      'The rebound fails to reclaim the prior impulse.',
      'Converging boundaries are drawn.',
      'The lower boundary breaks.',
    ],
    confirmation: [
      'A close below the lower wedge boundary.',
      'Prefer a break of the most recent corrective swing low as added structural confirmation.',
    ],
    invalidation: [
      'Price breaks the upper wedge and sustains a bullish continuation.',
      'The structure is a parallel channel rather than a converging wedge.',
    ],
    targetConcepts: [
      'The prior low is the first reference.',
      'The widest wedge width or the prior impulse leg as a contextual projection.',
    ],
    commonMistakes: [
      'Ignoring the bearish impulse that precedes the wedge.',
      'Shorting simply because price is rising inside the correction.',
    ],
    checklist: [
      'There is a bearish impulse before this correction.',
      'The rising boundaries converge.',
      'I know which corrective swing low would add confirmation.',
    ],
    animation: {
      priorTrend: 'A bearish impulse prints.',
      formation: 'A rising correction builds inside converging boundaries.',
      trigger: 'Price reaches the lower boundary as the correction matures.',
      breakout: 'The lower boundary breaks, then the bearish continuation arrow.',
      target: 'Optional: prior low, then a width-based projection.',
    },
  },

  {
    id: 'continuation-descending-triangle-bearish-source',
    sourceName: 'Descending Triangle',
    displayName: 'Descending Triangle — bearish source illustration',
    category: 'continuation',
    bias: 'bearish',
    sourcePosition: 19,
    sourceNote:
      'The same source label appears a second time in the bearish row, where the drawing is flat support with descending highs and a downside break. Preserved as printed, with a unique id so the two do not collide.',
    summary:
      'Flat support with a descending sequence of highs that compresses price toward support before a downside break.',
    marketStory: [
      'Sellers repeatedly press the same support floor.',
      'Buyers still create rebounds, but each one reaches a lower high.',
      'Selling pressure builds against support.',
      'A break beneath support confirms the bearish resolution drawn in the source.',
    ],
    requiredStructure: [
      'Horizontal support.',
      'Descending highs.',
      'Downward-sloping resistance.',
      'Multiple tests of the support zone.',
      'A breakdown below support.',
    ],
    formationSequence: [
      'A bearish approach into support.',
      'Horizontal support is drawn.',
      'A first bounce forms.',
      'Lower highs follow each bounce.',
      'Descending resistance is drawn.',
      'Price compresses into support.',
      'Support breaks downward.',
    ],
    confirmation: [
      'A close below horizontal support.',
      'Optional secondary confirmation: a retest of former support from underneath.',
    ],
    invalidation: [
      'Price breaks above the descending resistance and sustains higher.',
      'A breakdown immediately reclaims support and accepts back inside.',
    ],
    targetConcepts: [
      'The widest part of the triangle projected down from the support break.',
      'Nearby historical support as context.',
    ],
    commonMistakes: [
      'Shorting before the support floor actually breaks.',
      'Using a single wick through support as confirmation without context.',
    ],
    checklist: [
      'Support is horizontal and has been tested more than once.',
      'The highs are genuinely stepping lower.',
      'I am waiting for a close below support.',
    ],
    animation: {
      priorTrend: 'A bearish approach into support.',
      formation: 'Flat support, a first bounce, then progressively lower highs.',
      trigger: 'Descending resistance is drawn and price compresses into support.',
      breakout: 'Support breaks, then the bearish arrow.',
      retest: 'Optional: former support is retested from underneath.',
      target: 'Optional: widest triangle height projected down.',
    },
  },

  {
    id: 'continuation-symmetrical-expanding-triangle-bearish-source',
    sourceName: 'Symmetrical Expanding Triangle',
    displayName: 'Symmetrical Expanding Triangle — bearish / lower source illustration',
    category: 'continuation',
    bias: 'bearish',
    sourcePosition: 20,
    sourceNote:
      'The source label appears a second time in the bearish row, where the geometry widens and resolves to the downside. Preserved as printed, with a unique id. As above, the pattern is two-directional in general; the direction here is the sheet drawing.',
    summary:
      'A broadening two-sided structure where swings expand in size; the source lower example resolves to the downside.',
    marketStory: [
      'Volatility widens.',
      'Highs and lows spread farther apart.',
      'Control is unstable while price remains inside.',
      'The bearish example is confirmed only after a break below the lower boundary.',
    ],
    requiredStructure: [
      'An expanding swing range.',
      'Diverging upper and lower boundaries.',
      'Multiple reactions on both sides.',
      'A downside exit for the bearish version.',
    ],
    formationSequence: [
      'Price enters broadening action.',
      'Progressively larger swings develop.',
      'Each swing overshoots the last on both sides.',
      'Diverging boundaries are drawn.',
      'Price reaches a decision point with no direction assumed.',
      'The lower boundary breaks.',
    ],
    confirmation: [
      'A close below the lower expanding boundary.',
      'Optional secondary confirmation: a retest from underneath.',
    ],
    invalidation: [
      'Price returns and holds inside the structure.',
      'The structure compresses instead of broadening.',
    ],
    targetConcepts: [
      'The nearest major support is the first reference.',
      'A width-based projection is an optional guide only.',
    ],
    commonMistakes: [
      'Predicting a direction while price is still expanding inside the pattern.',
      'Confusing it with a symmetrical contracting triangle.',
    ],
    checklist: [
      'The swings are genuinely getting wider.',
      'I have not assumed the downside before a close below the boundary.',
      'I know the nearest major support.',
    ],
    animation: {
      priorTrend: 'Price enters broadening action.',
      formation: 'Progressively larger swings on both sides.',
      trigger: 'Diverging boundaries are drawn.',
      breakout: 'A break below the lower boundary, then the bearish arrow.',
      target: 'Optional: width projected down toward major support.',
    },
  },
];
