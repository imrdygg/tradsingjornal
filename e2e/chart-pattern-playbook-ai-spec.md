# Chart Pattern Playbook - AI Build Specification

## Purpose

Build a complete **Chart Pattern Playbook** inside my trading website using every setup shown in the uploaded `chart-patterns-cheat-sheet.pdf`.

The PDF is the visual/source reference for the pattern names, grouping, basic geometry, and breakout direction shown in each illustration. The PDF itself is only a cheat sheet, so the detailed explanations, confirmation logic, invalidation ideas, measured-move concepts, UI behavior, and animation storyboards below are an educational expansion for the website.

**Important:** Chart patterns are probabilistic, not guarantees. The website must describe them as educational decision-support, not as automatic buy/sell signals or promises of profit.

---

# 1. Core Product Goal

Create a dedicated **Playbook > Chart Patterns** section that feels visual, interactive, and easy to study.

Every setup must have:

- A unique playbook card.
- The exact source label from the PDF.
- A category: `Reversal Pattern` or `Continuation Pattern`.
- A directional bias based on the PDF illustration: bullish, bearish, or two-direction/neutral where appropriate.
- A short one-sentence definition.
- A detailed explanation of what the pattern is trying to represent.
- A `What must be present` checklist.
- A `Formation sequence` section.
- A `Confirmation / trigger` section.
- An `Invalidation / failure` section.
- A `Potential target logic` section.
- A `Common mistakes` section.
- An interactive animated illustration.
- A static fallback illustration for reduced-motion users.
- A `Replay animation` control.
- A `Slow / Normal / Fast` animation-speed control.
- A legend explaining the illustration colors.
- Space for the user to add personal notes, screenshots, examples, and lessons learned.

Do not copy the HowToTrade logo or their exact artwork. Re-create original, simplified educational illustrations from the structural concepts.

---

# 2. Visual Language for Every Illustration

Use one consistent visual system across the entire playbook:

- **Price path:** thick dark/black zig-zag line.
- **Structure / trend lines:** blue lines.
- **Bullish breakout:** green upward arrow.
- **Bearish breakout:** red downward arrow in our website, even though the PDF uses green arrows for both directions.
- **Neckline / support / resistance:** blue horizontal or diagonal line.
- **Formation zone:** subtle translucent background fill.
- **Breakout point:** small bright marker or pulse.
- **Retest area:** optional dotted highlight.
- **Invalidation line:** optional dashed line.
- **Target projection:** optional dashed measured-move arrow.

Animations should use SVG, Canvas, or another lightweight browser-native approach. Prefer SVG because the lines can scale cleanly on desktop and mobile.

The animation must not just wiggle a completed drawing. It should **teach the formation by drawing it in sequence**.

Recommended timing per pattern:

1. Prior trend appears: 0% to 20%.
2. Pattern begins forming: 20% to 55%.
3. Pattern completes/compresses: 55% to 75%.
4. Breakout/breakdown occurs: 75% to 90%.
5. Optional retest and measured move: 90% to 100%.

Each animation should take about 4-7 seconds at normal speed, then pause for about 1 second before looping.

---

# 3. Shared Playbook Detail Layout

Each setup detail page or modal should use this order:

1. **Pattern name**
2. **Category badge** - Reversal / Continuation
3. **Bias badge** - Bullish / Bearish / Neutral
4. **Animated illustration**
5. **Quick definition**
6. **Market story** - explain what buyers and sellers are doing
7. **What must be present**
8. **Formation sequence**
9. **Confirmation / trigger**
10. **Invalidation / failure signs**
11. **Potential target concepts**
12. **Common mistakes**
13. **Playbook checklist**
14. **My screenshots / examples**
15. **My notes**
16. **Related setups**

A pattern should never be marked `confirmed` simply because its shape exists. The UI should teach the distinction between:

- `Forming`
- `Completed structure`
- `Breakout / breakdown attempt`
- `Confirmed close beyond structure`
- `Retest, if one occurs`
- `Failed breakout / invalidated`

---

# 4. Pattern Data Model

Implement all setups from a central data file rather than hard-coding 20 separate pages.

Suggested model:

```ts
export type PatternBias = 'bullish' | 'bearish' | 'neutral';
export type PatternCategory = 'reversal' | 'continuation';

export interface PatternSetup {
  id: string;
  sourceName: string;
  displayName: string;
  category: PatternCategory;
  bias: PatternBias;
  sourcePosition: number;
  summary: string;
  marketStory: string[];
  requiredStructure: string[];
  formationSequence: string[];
  confirmation: string[];
  invalidation: string[];
  targetConcepts: string[];
  commonMistakes: string[];
  checklist: string[];
  animation: {
    priorTrend: string;
    formation: string;
    trigger: string;
    breakout: string;
    retest?: string;
    target?: string;
  };
  aliases?: string[];
  sourceNote?: string;
}
```

Keep `sourceName` exactly as printed in the PDF. If we choose to display a corrected/common industry name later, use `displayName` or `aliases` without deleting the source label.

---

# 5. REVERSAL PATTERNS

The PDF shows 10 reversal setup illustrations. Add all 10.

---

## R1. Bearish Double Top

**Source label:** Bearish Double Top  
**Category:** Reversal  
**Bias:** Bearish

### Quick definition
A potential bearish reversal where price tests roughly the same resistance area twice, fails to continue higher, and later breaks the swing low/neckline between the two peaks.

### Market story
- Price arrives with bullish momentum.
- Buyers create the first major high.
- Sellers push price down and create a reaction low.
- Buyers make another attempt at the same resistance area.
- The second attempt fails to establish meaningful acceptance above the first peak.
- A break below the middle reaction low suggests control may be shifting to sellers.

### What must be present
- A visible prior advance or bullish leg.
- First peak near a meaningful resistance area.
- Pullback creating a clear swing low/neckline.
- Second peak in approximately the same resistance zone.
- Rejection or failure to continue higher.
- For confirmation, price should break/close below the neckline rather than only touching it.

### Formation sequence
1. Uptrend/impulse higher.
2. First top forms.
3. Price pulls back.
4. Second top forms near the first.
5. Price rolls over.
6. Neckline is tested.
7. Bearish breakdown confirms the pattern idea.

### Confirmation / trigger
- Strongest educational confirmation: candle close below the neckline/swing low.
- Optional secondary confirmation: breakdown, retest of the neckline from underneath, then bearish rejection.
- Do not treat the second top itself as confirmed reversal.

### Invalidation / failure
- Price decisively breaks and holds above both tops.
- The neckline breaks down but price immediately reclaims it and accepts back inside the pattern.
- The two peaks are too far apart in price or structure to reasonably form the same resistance zone.

### Potential target concepts
- Measure the approximate vertical distance from the top zone to the neckline.
- Project that distance downward from the confirmed neckline break.
- Also show nearby prior support/liquidity levels as context instead of assuming the measured move must complete.

### Common mistakes
- Entering short before the neckline breaks.
- Calling any two highs a double top.
- Ignoring a strong higher-high breakout above resistance.
- Using an exact single price for the top instead of a resistance zone.

### Animation storyboard
1. Draw a rising price leg.
2. Draw first peak.
3. Pull price down and draw the neckline in blue.
4. Draw second peak near the first peak.
5. Animate price falling toward the neckline.
6. Pulse the neckline as price closes below it.
7. Draw a red breakdown arrow.
8. Optionally animate a small retest from below.

---

## R2. Bearish Head Shoulders

**Source label:** Bearish Head Shoulders  
**Category:** Reversal  
**Bias:** Bearish

### Quick definition
A potential bearish reversal with a left shoulder, a higher central head, a lower right shoulder, and a neckline connecting the reaction lows.

### Market story
- Bulls create an initial high: left shoulder.
- Price pulls back.
- Bulls make a stronger push and create the highest high: head.
- Price falls back again.
- Another rally fails to reach the head: right shoulder.
- That lower high suggests bullish momentum may be weakening.
- A neckline break provides the structural confirmation.

### What must be present
- Prior bullish trend or strong advance.
- Left shoulder.
- Higher head.
- Right shoulder below or near the left-shoulder area, but clearly below the head.
- Two reaction lows forming a neckline.
- Break/close below neckline for confirmation.

### Formation sequence
1. Uptrend.
2. Left shoulder.
3. Pullback to neckline area.
4. Higher head.
5. Pullback to neckline area.
6. Lower right shoulder.
7. Neckline break.

### Confirmation / trigger
- Close below the neckline.
- Optional neckline retest from underneath.
- A right-shoulder rejection is an early clue, not full confirmation.

### Invalidation / failure
- Price pushes above the head and holds.
- Break below neckline immediately reverses and price regains the entire structure.
- The shape lacks a meaningful head or neckline.

### Potential target concepts
- Measure from the head to the neckline.
- Project that distance down from the neckline break.
- Treat nearby support as practical context.

### Common mistakes
- Treating an ordinary three-swing range as head and shoulders.
- Shorting before the neckline is broken.
- Ignoring a strongly rising neckline that changes the geometry.

### Animation storyboard
1. Draw bullish impulse.
2. Build left shoulder.
3. Draw first neckline anchor.
4. Build higher head.
5. Draw second neckline anchor.
6. Build lower right shoulder.
7. Extend the blue neckline.
8. Animate close below neckline and red arrow downward.

---

## R3. Bearish Rising Wedge

**Source label:** Bearish Rising Wedge  
**Category:** Reversal  
**Bias:** Bearish

### Quick definition
A rising, narrowing price structure where highs and lows continue upward but the two boundary lines converge, suggesting momentum may be weakening before a downside break.

### Market story
- Price is still making higher highs and higher lows.
- Each push covers less distance and the swings compress.
- Buyers remain active, but upside progress becomes less efficient.
- A break below the lower wedge line signals that the rising structure has failed.

### What must be present
- Prior advance or clear bullish context.
- Rising swing highs.
- Rising swing lows.
- Two rising trend lines that converge.
- Multiple touches or reactions showing the boundaries matter.
- Downside break of the lower wedge boundary.

### Confirmation / trigger
- Close below lower wedge line.
- Stronger confirmation if the breakdown also loses a recent swing low.
- Optional retest of the broken lower wedge boundary.

### Invalidation / failure
- Price breaks above upper wedge resistance and sustains acceptance.
- Trend lines do not converge.
- Pattern is too immature with only one meaningful touch on a boundary.

### Potential target concepts
- First objective can be the most recent major swing low before the break.
- A larger measured concept can use the widest part of the wedge projected from the break.

### Common mistakes
- Confusing a rising channel with a rising wedge.
- Assuming every rising wedge must break down.
- Drawing trend lines through random wick extremes just to make them converge.

### Animation storyboard
1. Draw a strong move up.
2. Draw oscillating higher highs/higher lows.
3. Animate upper and lower blue lines converging.
4. Make each price swing slightly smaller.
5. Break below lower boundary.
6. Pulse the break.
7. Draw red arrow down.

---

## R4. Bearish Expanding Triangle

**Source label:** Bearish Expanding Triangle  
**Category:** Reversal  
**Bias:** Bearish in the PDF illustration

### Quick definition
A broadening structure where price swings become progressively wider. The PDF illustrates a downside resolution from the expanding range.

### Market story
- Volatility expands instead of compressing.
- Buyers push to larger highs while sellers also push to deeper lows.
- The market becomes increasingly unstable and two-sided.
- The PDF's bearish version resolves with a break beneath the lower boundary.

### What must be present
- Alternating swings with increasing range.
- Diverging upper and lower boundaries.
- Clear expansion rather than compression.
- Bearish version: downside break beneath the lower boundary.

### Confirmation / trigger
- Close outside and below the lower expanding boundary.
- Prefer structural confirmation rather than acting inside the broadening range.

### Invalidation / failure
- Price re-enters and holds inside the formation after the breakdown.
- Structure is actually converging rather than expanding.
- Too few swing points to define broadening boundaries.

### Potential target concepts
- Prior swing low/support below the formation.
- Width-based measured move may be displayed only as an educational projection, not a guaranteed destination.

### Common mistakes
- Trading every touch inside a volatile broadening structure.
- Confusing an expanding triangle with a symmetrical/converging triangle.
- Assuming direction before price exits the range.

### Animation storyboard
1. Draw the prior up move.
2. Create alternating swings that widen.
3. Draw diverging blue boundary lines.
4. Highlight increasing volatility.
5. Price breaks below lower boundary.
6. Draw red arrow downward.

---

## R5. Bearish Triple Top

**Source label:** Bearish Triple Top  
**Category:** Reversal  
**Bias:** Bearish

### Quick definition
A bearish reversal structure where price rejects approximately the same resistance zone three times and then breaks support/neckline beneath the formation.

### Market story
- Buyers test the same overhead area three times.
- Every attempt fails to produce sustainable acceptance higher.
- The repeated rejection can show exhausted demand at resistance.
- A break of the support/neckline beneath the structure confirms the bearish idea.

### What must be present
- Prior advance.
- Three distinct peaks in approximately the same resistance zone.
- Reaction lows between the peaks.
- A usable support/neckline under the formation.
- Breakdown below support for confirmation.

### Confirmation / trigger
- Close below the neckline/support zone after the third rejection.
- Optional retest from below.

### Invalidation / failure
- Price decisively breaks and holds above the triple-top resistance.
- The peaks are not actually testing the same area.

### Potential target concepts
- Height from top resistance to neckline projected down from the break.
- Also map nearby historical support.

### Common mistakes
- Shorting the third peak without waiting for structural failure.
- Forcing three random highs into one pattern.

### Animation storyboard
1. Draw rise into resistance.
2. Form first top.
3. Pull back and draw support.
4. Form second top.
5. Pull back.
6. Form third top.
7. Break support and draw red arrow down.

---

## R6. Bullish Double Bottom

**Source label:** Bullish Double Bottom  
**Category:** Reversal  
**Bias:** Bullish

### Quick definition
A potential bullish reversal where price tests roughly the same support area twice, fails to continue lower, and breaks the swing high/neckline between the two lows.

### Market story
- Sellers create the first major low.
- Buyers rally price to a reaction high.
- Sellers make another attempt at the low.
- The second attempt fails to create sustainable downside continuation.
- A break above the middle reaction high suggests buyers are taking control.

### What must be present
- Prior decline or bearish leg.
- First low near support.
- Reaction high/neckline.
- Second low near the first low.
- Rejection/failure to continue lower.
- Break/close above neckline for confirmation.

### Confirmation / trigger
- Close above the neckline.
- Optional breakout-retest of neckline from above.

### Invalidation / failure
- Price breaks and holds below both bottoms.
- Breakout above neckline immediately fails and price falls back into/under the structure.

### Potential target concepts
- Measure bottom-to-neckline height and project it above the neckline breakout.
- Map prior resistance above.

### Common mistakes
- Buying the second low before neckline confirmation.
- Requiring both lows to be the exact same price.

### Animation storyboard
1. Draw decline.
2. Draw first bottom.
3. Rally and draw blue neckline.
4. Draw second bottom near first.
5. Rally back to neckline.
6. Break above neckline.
7. Draw green arrow upward.

---

## R7. Bullish Inverted Head and Shoulder

**Source label:** Bullish Inverted Head and Shoulder  
**Category:** Reversal  
**Bias:** Bullish

### Quick definition
A bullish reversal pattern with a left shoulder low, a deeper head, a shallower right shoulder, and a neckline connecting the reaction highs.

### Market story
- Sellers create a first low.
- A rebound creates a neckline point.
- Sellers force a deeper low: the head.
- Buyers rebound again.
- The final selloff fails to reach the head, creating the right shoulder.
- A neckline break suggests sellers are losing control.

### What must be present
- Prior bearish trend or strong decline.
- Left shoulder low.
- Lower head.
- Higher/right shoulder low.
- Two reaction highs creating a neckline.
- Break/close above neckline for confirmation.

### Confirmation / trigger
- Close above neckline.
- Optional retest from above with support holding.

### Invalidation / failure
- Price breaks beneath the head and holds.
- Breakout above neckline fails and price falls back through the right-shoulder region.

### Potential target concepts
- Measure head-to-neckline distance and project upward from neckline break.
- Display nearby resistance zones.

### Common mistakes
- Buying simply because three lows exist.
- Ignoring a right shoulder that makes a new low below the head.

### Animation storyboard
1. Draw decline.
2. Create left shoulder low.
3. Rally to neckline point.
4. Create deeper head.
5. Rally to second neckline point.
6. Create shallower right shoulder.
7. Draw neckline.
8. Break above and show green arrow.

---

## R8. Bullish Falling Wedge

**Source label:** Bullish Falling Wedge  
**Category:** Reversal  
**Bias:** Bullish

### Quick definition
A declining but narrowing structure where lower highs and lower lows continue, while the two descending boundaries converge before an upside break.

### Market story
- Price continues moving lower.
- Sellers keep making new lows, but the distance of each move shrinks.
- Downside momentum becomes less efficient.
- A break above the upper wedge line signals that the descending structure has failed.

### What must be present
- Prior decline/bearish context.
- Descending swing highs.
- Descending swing lows.
- Two downward-sloping trend lines that converge.
- Upside break of the upper wedge boundary.

### Confirmation / trigger
- Close above upper wedge line.
- Stronger confirmation if price also reclaims a recent swing high.
- Optional retest of broken wedge resistance from above.

### Invalidation / failure
- Price breaks below the lower wedge line and sustains continuation lower.
- Boundaries remain parallel instead of converging.

### Potential target concepts
- Recent major swing high.
- Width of the widest part of the wedge projected upward from breakout.

### Common mistakes
- Confusing a descending channel with a falling wedge.
- Buying before the upper boundary is broken.

### Animation storyboard
1. Draw decline.
2. Draw lower highs and lower lows with shrinking swing size.
3. Draw converging blue boundaries.
4. Break above upper boundary.
5. Pulse breakout point.
6. Draw green arrow up.

---

## R9. Bullish Expanding Triangle

**Source label:** Bullish Expanding Triangle  
**Category:** Reversal  
**Bias:** Bullish in the PDF illustration

### Quick definition
A broadening structure with increasingly wide swings. The PDF's bullish example resolves above the upper boundary.

### Market story
- Volatility expands with larger alternating moves.
- Neither side controls the interior cleanly.
- In the bullish version shown by the PDF, buyers eventually break the upper expanding boundary.

### What must be present
- Alternating swings with increasing range.
- Diverging boundaries.
- Clear expansion in volatility.
- Upside break above the upper boundary for bullish confirmation.

### Confirmation / trigger
- Close outside and above the upper boundary.
- Avoid treating an interior swing as a breakout.

### Invalidation / failure
- Price re-enters and holds back inside the structure after breakout.
- Pattern does not actually broaden.

### Potential target concepts
- Prior resistance above.
- Width-based projection as an optional educational guide.

### Common mistakes
- Predicting bullish resolution before breakout.
- Confusing broadening with a converging triangle.

### Animation storyboard
1. Draw decline or transition into broadening action.
2. Build larger alternating swings.
3. Draw diverging blue lines.
4. Break upper boundary.
5. Draw green arrow upward.

---

## R10. Bullish Triple Bottom

**Source label:** Bullish Triple Bottom  
**Category:** Reversal  
**Bias:** Bullish

### Quick definition
A bullish reversal structure where price rejects approximately the same support zone three times, then breaks the resistance/neckline above the formation.

### Market story
- Sellers test the same support area repeatedly.
- Three failures to continue lower suggest supply is not achieving a clean breakdown.
- A break above the neckline/resistance shows improving buyer control.

### What must be present
- Prior decline.
- Three lows in approximately the same support zone.
- Reaction highs between those lows.
- Clear resistance/neckline.
- Break/close above neckline for confirmation.

### Confirmation / trigger
- Close above resistance/neckline after the third bottom.
- Optional retest from above.

### Invalidation / failure
- Price decisively breaks and holds below triple-bottom support.
- The three lows are not testing the same structural zone.

### Potential target concepts
- Height from support to neckline projected upward.
- Prior resistance levels above.

### Common mistakes
- Buying the third low without waiting for a break above resistance.
- Treating a messy range as a triple bottom.

### Animation storyboard
1. Draw decline.
2. Form first bottom.
3. Rally to resistance.
4. Form second bottom.
5. Rally again.
6. Form third bottom.
7. Break resistance and show green arrow up.

---

# 6. CONTINUATION PATTERNS

The PDF shows 10 continuation setup illustrations. Add all 10 as separate cards, even when the source uses the same label in bullish and bearish-looking examples.

---

## C1. Bullish Flag Pattern

**Source label:** Bullish Flag Pattern  
**Category:** Continuation  
**Bias:** Bullish

### Quick definition
A strong bullish impulse followed by a smaller orderly downward/sideways channel, then an upside breakout in the direction of the original move.

### Market story
- Buyers create a strong flagpole.
- Price pauses and pulls back in a controlled way.
- The correction stays relatively contained compared with the impulse.
- Buyers regain control and break above the flag channel.

### What must be present
- Strong upward flagpole/impulse.
- Small corrective phase.
- Usually two roughly parallel downward or sideways boundaries.
- Correction should look weaker than the initial impulse.
- Upside breakout through the flag boundary.

### Confirmation / trigger
- Close above the upper flag boundary.
- Stronger if price also clears the most recent corrective swing high.

### Invalidation / failure
- Pullback becomes too deep and destroys the original impulse structure.
- Price breaks below the lower flag boundary and continues lower.

### Potential target concepts
- Project a portion or full length of the flagpole from the breakout.
- Map nearby resistance.

### Common mistakes
- Calling a deep trend reversal a flag.
- Entering during the middle of the pullback.
- Drawing a flag without a clear flagpole.

### Animation storyboard
1. Fast bullish flagpole.
2. Slow down animation.
3. Draw small descending parallel channel.
4. Oscillate price inside channel.
5. Break upper boundary.
6. Draw green continuation arrow.

---

## C2. Bullish Pennant Pattern

**Source label:** Bullish Pennant Pattern  
**Category:** Continuation  
**Bias:** Bullish

### Quick definition
A strong bullish impulse followed by a small converging consolidation, then an upside continuation breakout.

### Market story
- Buyers create a strong impulse.
- Price pauses and compresses.
- Highs and lows converge toward an apex.
- A breakout above the upper boundary resumes the original bullish direction.

### What must be present
- Strong bullish flagpole.
- Small converging consolidation.
- Lower highs and higher lows inside the pennant.
- The pennant should be relatively compact compared with the flagpole.
- Upside breakout.

### Confirmation / trigger
- Close above upper pennant line.
- Optional breakout-retest.

### Invalidation / failure
- Price breaks through the lower boundary and accepts below.
- Consolidation becomes too large or long relative to the impulse.

### Potential target concepts
- Flagpole-length projection from breakout.
- Nearby resistance.

### Common mistakes
- Confusing a large symmetrical triangle with a small pennant.
- Forgetting the preceding impulse is part of the setup.

### Animation storyboard
1. Draw sharp move up.
2. Draw contracting mini-triangle.
3. Animate smaller oscillations.
4. Break upper line.
5. Show green arrow continuing upward.

---

## C3. Bullish Falling Village

**Source label exactly as printed:** Bullish Falling Village  
**Category:** Continuation  
**Bias:** Bullish in the PDF illustration

### Source note
The PDF text says **"Bullish Falling Village."** That is not a standard chart-pattern name I should silently replace. The drawing itself shows a strong bullish impulse, followed by a descending/sloping consolidation, then an upside breakout. Keep the exact source label in the data. If desired, the UI can later show an alias such as `Falling consolidation / bullish channel-style continuation`, but do not pretend that alias came from the PDF.

### Quick definition for our playbook
A bullish continuation setup based on the **geometry shown in the PDF**: strong move up, descending consolidation bounded by blue lines, then upside continuation.

### Market story
- Buyers create an impulse higher.
- Price pulls back in a controlled descending structure.
- Selling pressure does not erase the original impulse.
- Price breaks above the descending structure and resumes higher.

### What must be present
- Clear bullish impulse before the pattern.
- Descending correction with multiple swings.
- Two sloping boundaries based on the source drawing.
- Upside break of the upper boundary.

### Confirmation / trigger
- Close above the upper blue boundary.
- Optional reclaim of the most recent correction high.

### Invalidation / failure
- Price breaks below the lower boundary and continues lower.
- Pullback becomes larger than the impulse context and behaves like reversal rather than continuation.

### Potential target concepts
- Prior high first.
- Optional flagpole-style projection as a visual educational reference.

### Common mistakes
- Renaming the source setup without noting the PDF discrepancy.
- Treating any downward move after a rally as continuation.

### Animation storyboard
1. Draw strong bullish impulse.
2. Build descending zig-zag correction.
3. Draw the two blue descending boundaries exactly like the source geometry.
4. Break above upper boundary.
5. Show green arrow higher.

---

## C4. Descending Triangle - Bullish Illustration from PDF

**Source label exactly as printed:** Descending Triangle  
**Category:** Continuation  
**Bias shown by the PDF illustration:** Bullish

### Source note
The bullish-row illustration labeled `Descending Triangle` visually shows **horizontal resistance with rising lows and an upside breakout**, which is not the usual geometry associated with the common term `descending triangle`. Do not silently correct the source. Preserve the source label and add an alias/note in our internal data such as `bullish triangle - source geometry uses rising support`.

### Quick definition for our playbook
Teach the pattern **as drawn in the PDF**: flat upper resistance, rising lower support, increasing compression, then an upside breakout.

### Market story
- Price repeatedly tests the same resistance ceiling.
- Pullbacks become shallower as buyers step in at progressively higher prices.
- Pressure builds underneath resistance.
- The PDF depicts price breaking above the flat ceiling.

### What must be present
- Horizontal upper resistance.
- Rising sequence of lows.
- Compression toward the upper boundary.
- Multiple reactions at/near resistance.
- Upside break above resistance.

### Confirmation / trigger
- Close above horizontal resistance.
- Optional retest of the former resistance as support.

### Invalidation / failure
- Price loses the rising support line and accepts lower.
- Repeated rejection at resistance turns into a larger reversal instead of breakout.

### Potential target concepts
- Height of the widest part of the triangle projected above the breakout.
- Nearby resistance zones.

### Common mistakes
- Hiding the source-label inconsistency.
- Assuming every compression under resistance will break upward.

### Animation storyboard
1. Draw bullish approach.
2. Draw horizontal blue resistance.
3. Create first pullback.
4. Create progressively higher lows.
5. Draw rising support.
6. Compress price into the apex/ceiling.
7. Break resistance and show green arrow up.

---

## C5. Symmetrical Expanding Triangle - Upper/Two-Direction Illustration

**Source label:** Symmetrical Expanding Triangle  
**Category:** Continuation in the PDF  
**Bias:** Two-direction / neutral until breakout; the PDF illustration shows both an upward and downward possibility.

### Source note
The upper source drawing appears visually convergent while the label says `Expanding`. Because the PDF is internally inconsistent, preserve the exact source name and animate the **actual geometry shown in the source**, while documenting the discrepancy in a small `Source note` section.

### Quick definition for our playbook
A triangle-style consolidation where price oscillates between two blue boundaries before a directional breakout. The source illustration explicitly shows both possible breakout directions.

### Market story
- Price alternates between two boundaries.
- Swings become organized toward a decision point.
- Direction is not assumed while price remains inside.
- Confirmation comes only after price exits and closes beyond a boundary.

### What must be present
- Multiple alternating swings.
- Clearly defined upper and lower blue boundaries.
- A compression/decision area based on the source geometry.
- No directional assumption before a break.

### Confirmation / trigger
- Bullish case: close above upper boundary.
- Bearish case: close below lower boundary.
- The UI should let the user replay either outcome.

### Invalidation / failure
- Breakout instantly fails and price closes back inside the structure.
- Boundary lines are arbitrary and not respected by price swings.

### Potential target concepts
- Width of the triangle/structure projected from breakout direction.
- Nearby support/resistance.

### Common mistakes
- Guessing direction before breakout.
- Treating a wick outside the boundary as automatic confirmation.

### Animation storyboard
1. Draw price entering consolidation.
2. Draw blue upper and lower boundaries matching the PDF geometry.
3. Draw alternating swings.
4. At the decision point, briefly show two ghost arrows: up and down.
5. Default replay can choose upside first; a toggle can replay downside.

---

## C6. Bearish Flag Pattern

**Source label:** Bearish Flag Pattern  
**Category:** Continuation  
**Bias:** Bearish

### Quick definition
A strong bearish impulse followed by a smaller upward/sideways corrective channel, then a downside continuation break.

### Market story
- Sellers create a strong bearish flagpole.
- Buyers produce a controlled rebound.
- The rebound is weaker than the original decline.
- Sellers regain control and break the lower flag boundary.

### What must be present
- Strong bearish flagpole.
- Controlled corrective bounce.
- Usually two roughly parallel upward or sideways boundaries.
- Breakdown through the lower boundary.

### Confirmation / trigger
- Close below lower flag boundary.
- Stronger if price also breaks the most recent corrective swing low.

### Invalidation / failure
- Price breaks above the upper flag boundary and continues higher.
- Correction retraces too much of the original bearish impulse.

### Potential target concepts
- Flagpole-style projection downward.
- Prior support below.

### Common mistakes
- Shorting during the first bounce without waiting for the flag structure.
- Calling a complete bullish reversal a bearish flag.

### Animation storyboard
1. Draw fast bearish drop.
2. Slow into a rising parallel channel.
3. Oscillate inside channel.
4. Break the lower channel line.
5. Show red continuation arrow down.

---

## C7. Bearish Pennant Pattern

**Source label:** Bearish Pennant Pattern  
**Category:** Continuation  
**Bias:** Bearish

### Quick definition
A strong bearish impulse followed by a small converging consolidation, then a downside continuation break.

### Market story
- Sellers create a sharp decline.
- Price compresses in a small triangle.
- The consolidation fails to reclaim the lost ground.
- Sellers break the lower pennant boundary.

### What must be present
- Strong bearish flagpole.
- Compact converging consolidation.
- Lower highs and higher lows inside pennant.
- Downside break.

### Confirmation / trigger
- Close below lower pennant line.
- Optional retest from underneath.

### Invalidation / failure
- Price breaks above the upper pennant boundary and accepts higher.
- Consolidation becomes too large relative to the flagpole.

### Potential target concepts
- Flagpole-length projection from breakdown.
- Nearby support.

### Common mistakes
- Ignoring the need for a strong prior impulse.
- Confusing a large range with a compact pennant.

### Animation storyboard
1. Draw sharp decline.
2. Build a small contracting triangle.
3. Animate progressively smaller swings.
4. Break lower line.
5. Show red arrow downward.

---

## C8. Bearish Rising Wedge

**Source label:** Bearish Rising Wedge  
**Category:** Continuation  
**Bias:** Bearish

### Quick definition
A bearish continuation setup where price drops, then recovers inside a narrowing rising structure before breaking lower and resuming the prior bearish move.

### Market story
- Sellers create the initial decline.
- Buyers stage a rebound.
- The rebound rises but compresses and loses efficiency.
- Sellers break the lower wedge boundary and resume the original direction.

### What must be present
- Prior bearish impulse.
- Rising correction after that impulse.
- Higher highs and higher lows during the correction.
- Converging rising boundaries.
- Downside break.

### Confirmation / trigger
- Close below lower wedge boundary.
- Prefer break of a recent corrective swing low as additional structure confirmation.

### Invalidation / failure
- Price breaks the upper wedge and sustains bullish continuation.
- Structure is a parallel channel rather than a converging wedge.

### Potential target concepts
- Prior low first.
- Widest wedge width or prior impulse leg as a contextual projection.

### Common mistakes
- Ignoring the bearish impulse that precedes the wedge.
- Shorting simply because the market is rising inside the correction.

### Animation storyboard
1. Draw bearish impulse.
2. Form rising corrective swings.
3. Draw converging blue wedge lines.
4. Break lower boundary.
5. Show red continuation arrow.

---

## C9. Descending Triangle - Bearish Illustration

**Source label:** Descending Triangle  
**Category:** Continuation  
**Bias:** Bearish

### Quick definition
A bearish continuation pattern with flat support and a descending sequence of highs that compresses price toward support before a downside break.

### Market story
- Sellers repeatedly press the same support floor.
- Buyers can still create rebounds, but each rebound reaches a lower high.
- Selling pressure builds against support.
- A break beneath support confirms the bearish resolution shown in the PDF.

### What must be present
- Horizontal support.
- Descending highs.
- Downward-sloping resistance.
- Multiple tests of the support zone.
- Breakdown below support.

### Confirmation / trigger
- Close below horizontal support.
- Optional retest of former support from underneath.

### Invalidation / failure
- Price breaks above descending resistance and sustains higher.
- Breakdown immediately reclaims support and accepts back inside.

### Potential target concepts
- Height of the widest part of the triangle projected down from the support break.
- Nearby historical support.

### Common mistakes
- Shorting before the support floor actually breaks.
- Using a single wick through support as confirmation without context.

### Animation storyboard
1. Draw bearish approach.
2. Draw horizontal blue support.
3. Create first bounce.
4. Create lower highs on each bounce.
5. Draw descending blue resistance.
6. Compress into support.
7. Break support and show red arrow down.

---

## C10. Symmetrical Expanding Triangle - Bearish/Lower Illustration

**Source label:** Symmetrical Expanding Triangle  
**Category:** Continuation in the PDF  
**Bias shown by the lower illustration:** Bearish

### Quick definition
A broadening two-sided structure where swings expand in size, with the PDF's lower example resolving to the downside.

### Market story
- Price volatility widens.
- Highs and lows spread farther apart.
- Control is unstable while price remains inside.
- The bearish version is confirmed only after a break under the lower boundary.

### What must be present
- Expanding swing range.
- Diverging upper and lower boundaries.
- Multiple reactions to both sides.
- Downside exit for the bearish version.

### Confirmation / trigger
- Close below the lower expanding boundary.
- Optional retest from underneath.

### Invalidation / failure
- Price returns and holds inside the structure.
- Structure compresses instead of broadening.

### Potential target concepts
- Nearest major support.
- Optional width-based projection.

### Common mistakes
- Predicting direction while price is still expanding inside the pattern.
- Confusing the setup with a symmetrical contracting triangle.

### Animation storyboard
1. Draw entry into broadening action.
2. Build progressively larger swings.
3. Draw diverging blue boundaries.
4. Break the lower boundary.
5. Show red arrow down.

---

# 7. Master Checklist Component

Every pattern page should include a compact checklist the user can manually check off while reviewing a real chart.

Suggested universal checklist:

- [ ] Correct prior trend/context exists.
- [ ] Pattern geometry is actually present.
- [ ] At least two meaningful reactions define each required boundary where applicable.
- [ ] Pattern is not being forced onto random noise.
- [ ] Price has reached the decision/breakout area.
- [ ] Breakout/breakdown has closed beyond the structure.
- [ ] I know what would invalidate this setup.
- [ ] I know the nearest major support/resistance level.
- [ ] I am not treating the measured move as guaranteed.
- [ ] I saved a screenshot/example for review.

Allow the user to add pattern-specific checklist items later.

---

# 8. Animation Component Requirements

Create a reusable component, for example:

```tsx
<PatternAnimation
  patternId="bearish-double-top"
  autoplay
  loop
  showLegend
  showBreakout
  showRetest
  showTarget={false}
/>
```

## Animation behavior

- Use `requestAnimationFrame`, CSS/SVG animation, Framer Motion, or the animation library already used by the site.
- Respect `prefers-reduced-motion`.
- Avoid heavy charting libraries just for these illustrations.
- Each pattern should be built from reusable primitives:
  - `PricePath`
  - `TrendLine`
  - `HorizontalLevel`
  - `BreakoutArrow`
  - `BreakoutPulse`
  - `RetestMarker`
  - `TargetProjection`
  - `Label`

## Controls

- Replay
- Pause / Play
- Speed: 0.5x / 1x / 1.5x
- Toggle labels
- Toggle retest
- Toggle target projection

## Teaching labels during animation

Show small temporary labels at key moments such as:

- First Top
- Second Top
- Neckline
- Left Shoulder
- Head
- Right Shoulder
- Support
- Resistance
- Upper Boundary
- Lower Boundary
- Compression
- Breakout
- Breakdown
- Retest
- Invalidation

Do not show every label at once. Reveal them as the setup forms.

---

# 9. Playbook Grid Page

Create a main page that displays all 20 source setups.

## Filters

- All
- Reversal
- Continuation
- Bullish
- Bearish
- Neutral / Two-direction

## Card contents

Each card should show:

- Pattern name.
- Category badge.
- Bias badge.
- Small looping mini-animation.
- One-line summary.
- `Study Setup` button.
- Optional `Add Example` button.

## Ordering

Keep the same broad source order:

### Reversal row/group
1. Bearish Double Top
2. Bearish Head Shoulders
3. Bearish Rising Wedge
4. Bearish Expanding Triangle
5. Bearish Triple Top
6. Bullish Double Bottom
7. Bullish Inverted Head and Shoulder
8. Bullish Falling Wedge
9. Bullish Expanding Triangle
10. Bullish Triple Bottom

### Continuation row/group
11. Bullish Flag Pattern
12. Bullish Pennant Pattern
13. Bullish Falling Village
14. Descending Triangle - bullish source illustration
15. Symmetrical Expanding Triangle - upper/two-direction source illustration
16. Bearish Flag Pattern
17. Bearish Pennant Pattern
18. Bearish Rising Wedge
19. Descending Triangle - bearish source illustration
20. Symmetrical Expanding Triangle - lower/bearish source illustration

---

# 10. User Study / Journal Integration

For each setup, support optional personal study data:

- `My grade for this example`
- `Screenshot before entry`
- `Screenshot after exit`
- `Ticker / instrument`
- `Date`
- `Timeframe`
- `Pattern stage when I acted`
- `Why I believed it was valid`
- `What invalidated it`
- `What I did well`
- `What I did wrong`
- `What I will do differently next time`

This makes the playbook more than a pattern encyclopedia: it becomes a learning system.

Do not automatically tell the user to trade solely because a pattern appears.

---

# 11. Pattern Status UI

When the user is studying or logging a live example, allow these statuses:

- Watching
- Forming
- Near breakout
- Breakout attempted
- Confirmed
- Retest
- Failed breakout
- Invalidated
- Completed

These are study/journal statuses, not trading commands.

---

# 12. Important Source Discrepancies to Preserve

The uploaded PDF contains a few labels/geometries that appear internally inconsistent. Do **not** silently rewrite them because the requirement is to include every setup shown in the PDF.

Preserve these explicitly:

1. `Bullish Falling Village` - exact wording from the PDF. Use the drawing's bullish impulse + falling consolidation + upside breakout geometry.
2. `Descending Triangle` in the bullish continuation row - the drawing appears to use flat resistance with rising lows and an upside breakout. Preserve the source label but document the geometry.
3. `Symmetrical Expanding Triangle` in the upper continuation row - the source drawing appears more convergent than expanding and shows both up/down breakout arrows. Preserve the source label and source geometry.
4. `Descending Triangle` appears again in the bearish continuation row and there the drawing uses flat support + descending highs + downside breakdown.
5. `Symmetrical Expanding Triangle` appears again in the bearish continuation row with broader/widening-looking geometry and a bearish resolution.

In the code, use unique IDs so duplicate source labels do not collide.

Suggested IDs:

```txt
reversal-bearish-double-top
reversal-bearish-head-shoulders
reversal-bearish-rising-wedge
reversal-bearish-expanding-triangle
reversal-bearish-triple-top
reversal-bullish-double-bottom
reversal-bullish-inverted-head-shoulder
reversal-bullish-falling-wedge
reversal-bullish-expanding-triangle
reversal-bullish-triple-bottom
continuation-bullish-flag
continuation-bullish-pennant
continuation-bullish-falling-village
continuation-descending-triangle-bullish-source
continuation-symmetrical-expanding-triangle-upper-source
continuation-bearish-flag
continuation-bearish-pennant
continuation-bearish-rising-wedge
continuation-descending-triangle-bearish-source
continuation-symmetrical-expanding-triangle-bearish-source
```

---

# 13. Acceptance Criteria

The feature is not complete until all of the following are true:

- [ ] All 20 source illustrations are represented as separate playbook setups.
- [ ] All 10 reversal setups are included.
- [ ] All 10 continuation setups are included.
- [ ] Every setup has a full written explanation.
- [ ] Every setup has a unique animated educational illustration.
- [ ] Animations teach the pattern in stages rather than only showing a finished shape.
- [ ] Every setup has confirmation, invalidation, target concept, and common mistakes.
- [ ] Source-label inconsistencies are preserved and documented rather than silently corrected.
- [ ] Duplicate source names use unique internal IDs.
- [ ] Mobile layout is fully responsive.
- [ ] Animations honor reduced-motion preferences.
- [ ] No HowToTrade logo or copied proprietary artwork is used.
- [ ] All illustrations are original recreations.
- [ ] The playbook clearly says chart patterns are probabilistic and educational.
- [ ] The user can save notes and chart examples to each pattern.
- [ ] The user can filter patterns by category and bias.
- [ ] Each pattern can be opened directly with a stable URL/route.

---

# 14. Final Instruction to the Coding AI

Implement this as a polished, reusable, data-driven feature inside the existing website. Do not create 20 isolated one-off components. Build shared primitives, shared layout components, one pattern data model, one animation system, and individual per-pattern geometry/configuration.

Before coding, inspect the existing project structure and design system so the feature matches the current site rather than creating a disconnected mini-app.

Work in phases:

1. Create the data model and add all 20 setups.
2. Create the playbook grid and filters.
3. Create the setup detail page/modal.
4. Build the reusable SVG animation engine/primitives.
5. Implement the 20 pattern animation configurations.
6. Add notes/screenshots/journal integration.
7. Add responsive behavior and accessibility.
8. Test every setup on desktop and mobile.
9. Verify the 20-source-setup checklist before calling the feature complete.

When a source label looks unusual, do not delete it or silently rename it. Preserve the source name, use a unique internal ID, and add a transparent source note or alias where useful.
