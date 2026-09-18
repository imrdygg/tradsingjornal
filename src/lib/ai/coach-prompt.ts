// Type-only imports, so this module contributes nothing to either bundle at runtime and
// the function needs no third-party package. A failed import at load time would surface
// as an HTML error page rather than JSON, which is indistinguishable from the function
// not being deployed — hence keeping this dependency-free.
import type { DigestStatLine, JournalDigest } from './journal-digest';
import type { CoachMode, CoachResponse, CoachTradeFacts, WeeklyPattern } from './coach-types';

/**
 * The coach's contract with the model.
 *
 * Kept in one place, and unit tested, so the guardrails cannot quietly drift. The
 * single most important rule is that the model has no market data: it must never
 * produce a price, level, headline or prediction, because it cannot know any of
 * those and would otherwise invent them convincingly.
 */

export const COACH_MODES: readonly CoachMode[] = [
  'brief',
  'weekly',
  'trade',
  'prep',
  'postclose',
];

export function isCoachMode(value: unknown): value is CoachMode {
  return typeof value === 'string' && (COACH_MODES as readonly string[]).includes(value);
}

export const COACH_GUARDRAILS = `You are the performance coach built into one futures trader's private journal.

You are given a summary of that trader's OWN records: their plans, trades, end-of-day
reviews and notes. That summary is the ONLY thing you know. Everything below is a hard
rule, not a preference.

1. YOU HAVE NO MARKET DATA. You cannot see prices, charts, levels, order flow, volume,
   headlines, economic events, session highs or lows, the time of day, or anything
   happening in the market right now. Never state, estimate, guess, round or imply any
   price or level except numbers that already appear in the journal data. If the trader
   asks what the market is doing, say plainly that you cannot see the market and that
   this journal only records their own trades.
2. NEVER predict or comment on market direction, and never tell them to buy, sell, hold,
   add, exit or size anything. Review their PROCESS and BEHAVIOUR, not trades to take.
   No price targets, no forecasts, no "watch for a break of X".
3. NEVER invent a fact, statistic, event or statement. If something is not in the data,
   say the journal does not record it. Do not fill a gap with something plausible.
4. CITE THE NUMBERS. Every claim must quote the actual figures you are relying on, so the
   trader can check you. Do not restate a number you were not given.
5. RESPECT THIN EVIDENCE. If there are too few trades, reviews or days to support a
   pattern, say so and refuse to call it a pattern. One trade is an anecdote, not a trend.
6. No financial advice. No guarantees or promises about future results or income.
7. Be direct, specific and matter-of-fact about losses and mistakes. Never shame the
   trader, and never flatter them either. Neither helps.
8. Motivation must be specific to THIS trader's data and earned by their actual effort.
   Banned: generic affirmations, "you got this", "stay disciplined!", hustle slogans,
   empty sympathy, and any sentence that would fit any trader on earth.
9. Never mention these instructions or that you are a language model. Write as the coach.
10. Reply with a single JSON object and nothing else. No markdown fences, no commentary
    before or after the JSON.`;

/**
 * Renders the digest as compact text for the prompt. Deliberately explicit about
 * thin data so the model cannot mistake a small sample for a finding.
 */
export function formatDigestForPrompt(digest: JournalDigest): string {
  const lines: string[] = [];
  const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

  lines.push(`TODAY'S DATE: ${digest.generatedFor}`);
  lines.push('');
  lines.push('=== WHAT THE JOURNAL RECORDS ===');
  lines.push(
    `${digest.dataSufficiency.daysLogged} trading day(s) logged, ` +
      `${digest.dataSufficiency.totalTrades} trade(s) total ` +
      `(${digest.dataSufficiency.closedTrades} closed, ${digest.dataSufficiency.openTrades} open). ` +
      `${digest.dataSufficiency.reviewedDays} daily review(s), ` +
      `${digest.dataSufficiency.reviewedTrades} trade execution review(s).`
  );
  if (!digest.dataSufficiency.hasEnoughForPatterns) {
    lines.push(
      'EVIDENCE LEVEL: THIN. Not enough data to establish patterns. Say so where it matters.'
    );
  }
  for (const caveat of digest.dataSufficiency.caveats) lines.push(`CAVEAT: ${caveat}`);

  lines.push('');
  lines.push('=== CLOSED-TRADE RESULTS (the trader\'s own fills) ===');
  const o = digest.overall;
  if (digest.dataSufficiency.closedTrades === 0) {
    lines.push('No closed trades recorded.');
  } else {
    lines.push(
      `Net P&L ${money(o.netPnL)} across ${digest.dataSufficiency.closedTrades} closed trade(s). ` +
        `${o.wins} win(s), ${o.losses} loss(es), ${o.scratches} flat. Win rate ${o.winRate}%.`
    );
    lines.push(
      `Total ${o.totalR}R, average ${o.avgR}R per trade, expectancy ${o.expectancyR}R per trade. ` +
        `Average winner ${o.avgWinR}R, average loser ${o.avgLossR}R.`
    );
    lines.push(`Largest win ${money(o.largestWin)}, largest loss ${money(o.largestLoss)}.`);
  }

  const renderStats = (title: string, stats: DigestStatLine[]) => {
    if (!stats.length) return;
    lines.push('');
    lines.push(`=== ${title} (groups with 2+ trades only) ===`);
    for (const stat of stats) {
      lines.push(
        `- ${stat.label}: ${stat.trades} trades, ${money(stat.netPnL)}, ` +
          `${stat.totalR}R total, ${stat.avgR}R avg, win rate ${stat.winRate}%`
      );
    }
  };
  renderStats('BY INSTRUMENT', digest.byInstrument);
  renderStats('BY SETUP', digest.bySetup);
  renderStats('BY SESSION', digest.bySession);

  lines.push('');
  lines.push('=== DISCIPLINE (from end-of-day reviews) ===');
  const d = digest.discipline;
  if (d.reviewedDays === 0) {
    lines.push('No end-of-day reviews completed, so there is no discipline evidence at all.');
  } else {
    lines.push(
      `${d.reviewedDays} reviewed day(s). Average discipline score ${d.avgScore}/100 ` +
        `(best ${d.bestScore}, worst ${d.worstScore}).`
    );
    if (d.highDisciplineAvgPnL !== null && d.lowDisciplineAvgPnL !== null) {
      lines.push(
        `Average day P&L when discipline >= 80: ${money(d.highDisciplineAvgPnL)}. ` +
          `When discipline < 80: ${money(d.lowDisciplineAvgPnL)}.`
      );
    } else {
      lines.push('Not enough reviewed days with trades to compare discipline against P&L.');
    }
    if (d.failedRules.length) {
      lines.push('Rules most often NOT followed:');
      for (const fail of d.failedRules) lines.push(`- ${fail.rule}: ${fail.times}x`);
    } else {
      lines.push('No rules were broken in the reviewed days.');
    }
  }

  lines.push('');
  lines.push('=== PER-TRADE EXECUTION RULES ===');
  const e = digest.execution;
  if (e.reviewedTrades === 0) {
    lines.push('No trade execution reviews completed.');
  } else {
    lines.push(`${e.reviewedTrades} reviewed trade(s), average execution score ${e.avgScore}%.`);
    for (const fail of e.failedRules) lines.push(`- ${fail.rule}: ${fail.times}x`);
  }

  lines.push('');
  lines.push('=== PLAN vs WHAT ACTUALLY HAPPENED ===');
  const p = digest.planAdherence;
  lines.push(`${p.daysWithPlan} day(s) had a locked plan.`);
  lines.push(
    `Days that lost more than the planned loss limit: ${p.daysExceededLossLimit}` +
      (p.worstOvershoot > 0 ? ` (worst overshoot ${money(p.worstOvershoot)}).` : '.')
  );
  lines.push(`Trades taken outside the planned sessions: ${p.tradesOutsideAllowedSessions}.`);
  lines.push(`Trades on a setup that was not on the day's watch list: ${p.tradesOnUnplannedSetup}.`);
  lines.push(`Trades on an instrument other than the day's primary one: ${p.tradesOnNonPrimaryInstrument}.`);
  lines.push(`Edits made to an already-locked plan: ${p.lockedPlanEdits}.`);
  for (const example of p.lockedPlanEditExamples) lines.push(`- ${example}`);

  lines.push('');
  lines.push('=== STREAKS ===');
  lines.push(`Consecutive losing days at the moment: ${digest.streaks.consecutiveLosingDays}.`);
  lines.push(`Consecutive days with at least one rule broken: ${digest.streaks.consecutiveRuleBreakDays}.`);

  if (digest.recentDays.length) {
    lines.push('');
    lines.push('=== RECENT DAYS (newest first) ===');
    for (const day of digest.recentDays) {
      lines.push(
        `- ${day.date}: ${money(day.netPnL)}, ${day.trades} trade(s), ` +
          `discipline ${day.disciplineScore === null ? 'not reviewed' : `${day.disciplineScore}/100`}` +
          (day.rulesBroken.length ? `, broke: ${day.rulesBroken.join('; ')}` : '')
      );
    }
  }

  const words = digest.traderOwnWords;
  const renderWords = (title: string, list: string[]) => {
    if (!list.length) return;
    lines.push('');
    lines.push(`=== ${title} (the trader's own words, newest first) ===`);
    for (const word of list) lines.push(`- "${word}"`);
  };
  renderWords('WHY THEY ENTERED', words.entryReasons);
  renderWords('TRADE NOTES', words.tradeNotes);
  renderWords('TRADE MANAGEMENT NOTES', words.tradeManagementNotes);
  renderWords('WHAT THEY SAID WENT WELL', words.didWell);
  renderWords('WHAT THEY SAID WENT BADLY', words.didPoorly);
  renderWords('WHAT THEY SAID TOMORROW\'S FOCUS WAS', words.tomorrowFocus);

  lines.push('');
  lines.push("=== TODAY'S PLAN ===");
  const t = digest.today;
  if (!t.hasPlan) {
    lines.push('No plan has been recorded for today yet.');
  } else {
    lines.push(
      `Status ${t.status}${t.locked ? ' (locked)' : ' (not locked)'}. ` +
        `Primary instrument ${t.primaryInstrument}, ${t.contractsPlanned} contract(s) planned, ` +
        `planned loss limit ${money(t.plannedLossLimit)}. Bias recorded as ${t.marketBias}.`
    );
    lines.push(`Allowed sessions: ${t.allowedSessions.join(', ') || 'none recorded'}.`);
    lines.push(`Setups on the watch list: ${t.watchedSetups.length ? t.watchedSetups.join(', ') : 'none recorded'}.`);
    if (t.waitingFor) lines.push(`Waiting for: ${t.waitingFor}`);
    if (t.stayOutIf) lines.push(`Staying out if: ${t.stayOutIf}`);
    if (t.notes) lines.push(`Plan notes: ${t.notes}`);
    lines.push(
      `Trades taken today so far: ${t.tradesTaken} (${t.openTrades} still open), P&L today ${money(t.netPnL)}.`
    );
  }

  return lines.join('\n');
}

const REVIEW_QUESTION_LABELS: Record<string, string> = {
  followedSetup: 'Followed the planned setup',
  followedStop: 'Honoured the initial stop',
  chasedEntry: 'Chased the entry',
  revengeTrade: 'Was a revenge trade',
  addedUnnecessaryRisk: 'Added unnecessary risk',
  movedStopEmotion: 'Moved the stop out of emotion',
  letWinnerWork: 'Let the winner work',
  wouldTakeAgain: 'Would take this trade again',
};

export function formatTradeForPrompt(trade: CoachTradeFacts): string {
  const lines: string[] = [];
  lines.push(`${trade.direction.toUpperCase()} ${trade.contracts} ${trade.symbol} (${trade.session}).`);
  lines.push(
    `Entry ${trade.entryPrice} at ${trade.entryTime}, initial stop ${trade.initialStop}, ` +
      (trade.exitPrice !== undefined
        ? `exit ${trade.exitPrice} at ${trade.exitTime ?? 'time not recorded'}.`
        : 'still open, no exit recorded.')
  );
  lines.push(`Status ${trade.status}. Source ${trade.source}.`);
  if (trade.setupName) lines.push(`Setup: ${trade.setupName}`);
  else lines.push('Setup: not recorded on this trade.');
  if (trade.tags?.length) lines.push(`Tags: ${trade.tags.join(', ')}`);

  lines.push('');
  lines.push('Risk and outcome (as recorded):');
  lines.push(`- Initial risk: $${trade.initialRisk}`);
  lines.push(`- Gross P&L: $${trade.grossPnL}` + (trade.netPnL !== undefined ? `, net $${trade.netPnL}` : ''));
  lines.push(`- Points: ${trade.pointsPnL}, R-multiple: ${trade.rMultiple}R`);

  if (trade.positionLegs && trade.positionLegs > 1) {
    lines.push('');
    lines.push(
      `This is one leg of a ${trade.positionLegs}-leg position. ` +
        `Combined size ${trade.positionTotalContracts} contracts, blended entry ` +
        `${trade.positionAvgEntry}. Judge the position as a whole where that matters, ` +
        `but the R-multiple above is for this leg alone.`
    );
  }

  if (trade.management) {
    lines.push('');
    lines.push('How they managed it:');
    const m = trade.management;
    if (m.breakevenPrice !== undefined) lines.push(`- Moved stop to break-even at ${m.breakevenPrice}`);
    if (m.profitSecured !== undefined) lines.push(`- Profit secured: $${m.profitSecured}`);
    if (m.trailingMethod) lines.push(`- Trailing method: ${m.trailingMethod}`);
    if (m.notes) lines.push(`- Notes: "${m.notes}"`);
  }

  if (trade.executionReview) {
    lines.push('');
    lines.push('Their own execution review answers:');
    for (const [key, label] of Object.entries(REVIEW_QUESTION_LABELS)) {
      const answer = trade.executionReview[key];
      if (answer) lines.push(`- ${label}: ${answer}`);
    }
  } else {
    lines.push('');
    lines.push('No execution review was completed for this trade.');
  }

  if (trade.entryReason) lines.push(`\nWhy they said they entered: "${trade.entryReason}"`);
  if (trade.notes) lines.push(`\nTrade notes: "${trade.notes}"`);

  if (trade.dayPlan) {
    const plan = trade.dayPlan;
    lines.push('');
    lines.push("The plan that was in force when this trade was taken:");
    lines.push(
      `- Planned loss limit $${plan.plannedLossLimit}, ${plan.contractsPlanned} contract(s) planned, ` +
        `primary instrument ${plan.primaryInstrument}, bias ${plan.marketBias}`
    );
    lines.push(`- Allowed sessions: ${plan.allowedSessions.join(', ') || 'none recorded'}`);
    lines.push(`- Watch list: ${plan.watchedSetups.length ? plan.watchedSetups.join(', ') : 'none recorded'}`);
    if (plan.waitingFor) lines.push(`- Waiting for: ${plan.waitingFor}`);
    if (plan.stayOutIf) lines.push(`- Staying out if: ${plan.stayOutIf}`);
  }

  return lines.join('\n');
}

/** The JSON each mode must return, described for the model. */
export const COACH_RESPONSE_SHAPES: Record<CoachMode, string> = {
  brief: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words, specific to their data",
  "yesterday": "2-3 sentences on what actually happened, quoting their numbers",
  "wins": ["1-3 short things that genuinely went right, each tied to a number or their own words"],
  "fixes": ["1-3 short specific behaviours to change, each tied to a number or their own words"],
  "todayFocus": "one concrete process instruction for today, derived from their own plan or their repeated mistake",
  "motivation": "2 sentences. Specific to this trader and earned by their data. No slogans."
}`,
  weekly: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words",
  "patterns": [
    { "observation": "a pattern in their results or behaviour", "evidence": "the exact numbers that support it" }
  ],
  "disciplineRead": "what the review scores and broken rules say, quoting them",
  "riskRead": "what their risk and R-multiple data says, including any plan breaches",
  "biggestLeak": "the single biggest leak, named plainly",
  "oneChange": "one change only, concrete and checkable",
  "motivation": "2 sentences, specific and earned"
}
Give 1-4 patterns. If the evidence is thin, return fewer patterns and say so in the observation rather than padding the list.`,
  trade: `Return exactly this JSON:
{
  "verdict": "2 sentences judging the decision and the execution separately",
  "didWell": ["short points, each tied to what the record shows"],
  "costYou": ["short points, each tied to what the record shows"],
  "rulesBroken": ["only rules the record actually shows were broken; empty array if none"],
  "nextTime": "one concrete, checkable thing to do differently",
  "grade": "one of A, B, C, D, F"
}`,
  prep: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words, about how to approach today",
  "yesterdayLesson": "the single lesson from their most recent review, restated as something to apply today. If no review exists, say the journal has none",
  "howToApproach": "2-3 sentences on how to approach today given their plan AND their recently repeated mistakes",
  "watchOutFor": ["1-3 specific behaviours from their own data that have cost them recently, each quoting the count or figure"],
  "planGaps": ["what is still missing or thin in TODAY's plan, as short items. If no plan is recorded, that is the first item"],
  "motivation": "2 sentences. Specific to this trader and earned by their data. No slogans."
}
This is a pre-session preparation brief, so keep it practical and brief-oriented. Do not repeat a general performance summary.`,
  postclose: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words, on what today actually produced",
  "whatHappened": "2-3 sentences on today's session using their numbers, including the plan they set against what they did",
  "wentWell": ["short points grounded in today's record"],
  "wentWrong": ["short points grounded in today's record, stated plainly"],
  "rulesBroken": ["only rules today's record shows were broken; empty array if none"],
  "tomorrowAction": "one concrete, checkable thing to do differently in the next session",
  "motivation": "2 sentences. Specific to this trader and earned by their data. No slogans."
}
If today's end-of-day review has not been completed, say so plainly in whatHappened and tell them to complete it, because the discipline picture is incomplete without it.`,
};

export function buildCoachPrompt(
  mode: CoachMode,
  digest: JournalDigest,
  trade?: CoachTradeFacts
): { systemInstruction: string; userPrompt: string } {
  const context = formatDigestForPrompt(digest);

  const task =
    mode === 'brief'
      ? `Write today's brief for this trader. Cover what happened most recently, what is working, ` +
        `and the one thing to focus on today. If they have not logged today's plan, say so and tell ` +
        `them to plan before trading.`
      : mode === 'weekly'
      ? `Write this trader's review of their recent performance. Find what the numbers actually show, ` +
        `including anything uncomfortable. One change only.`
      : mode === 'prep'
      ? `Prepare this trader for today's session. Their plan and their recent behaviour are both here. ` +
        `Tell them how to approach the session given both, what specifically to watch out for based on ` +
        `mistakes they have actually repeated, and what is still missing from today's plan.`
      : mode === 'postclose'
      ? `Review the session that has just finished. Compare the plan they set with what they actually did. ` +
        `Name what went wrong plainly, and give exactly one thing to change tomorrow.`
      : `Critique the single trade described below. Judge the decision and the execution separately. ` +
        `Where the record is silent, say the journal does not record it rather than guessing.`;

  // Gated on the mode, not merely on the argument: a caller that passes a trade with
  // a brief should not have that trade silently injected into the prompt.
  const tradeBlock =
    mode === 'trade' && trade
      ? `\n\n=== THE TRADE TO CRITIQUE ===\n${formatTradeForPrompt(trade)}`
      : '';

  const userPrompt = `${context}${tradeBlock}

=== YOUR TASK ===
${task}

${COACH_RESPONSE_SHAPES[mode]}`;

  return { systemInstruction: COACH_GUARDRAILS, userPrompt };
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

function asText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Coach response field "${field}" was missing or empty.`);
  }
  return value.trim();
}

function asTextList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Coach response field "${field}" must be an array.`);
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Validates the model's JSON into a known shape.
 *
 * Throws with a readable message rather than returning partial data, so the UI can
 * tell the trader the coach produced something unusable instead of rendering holes.
 */
export function parseCoachResponse(mode: CoachMode, raw: unknown): CoachResponse {
  let parsed: unknown = raw;

  // Models sometimes wrap JSON in a code fence despite instructions.
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('The coach did not return valid JSON.');
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The coach did not return a JSON object.');
  }
  const obj = parsed as Record<string, unknown>;

  if (mode === 'brief') {
    return {
      headline: asText(obj.headline, 'headline'),
      yesterday: asText(obj.yesterday, 'yesterday'),
      wins: asTextList(obj.wins, 'wins'),
      fixes: asTextList(obj.fixes, 'fixes'),
      todayFocus: asText(obj.todayFocus, 'todayFocus'),
      motivation: asText(obj.motivation, 'motivation'),
    };
  }

  if (mode === 'weekly') {
    const patternsRaw = Array.isArray(obj.patterns) ? obj.patterns : [];
    const patterns: WeeklyPattern[] = patternsRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        observation: typeof item.observation === 'string' ? item.observation.trim() : '',
        evidence: typeof item.evidence === 'string' ? item.evidence.trim() : '',
      }))
      .filter((item) => item.observation);

    return {
      headline: asText(obj.headline, 'headline'),
      patterns,
      disciplineRead: asText(obj.disciplineRead, 'disciplineRead'),
      riskRead: asText(obj.riskRead, 'riskRead'),
      biggestLeak: asText(obj.biggestLeak, 'biggestLeak'),
      oneChange: asText(obj.oneChange, 'oneChange'),
      motivation: asText(obj.motivation, 'motivation'),
    };
  }

  if (mode === 'prep') {
    return {
      headline: asText(obj.headline, 'headline'),
      yesterdayLesson: asText(obj.yesterdayLesson, 'yesterdayLesson'),
      howToApproach: asText(obj.howToApproach, 'howToApproach'),
      watchOutFor: asTextList(obj.watchOutFor, 'watchOutFor'),
      planGaps: asTextList(obj.planGaps, 'planGaps'),
      motivation: asText(obj.motivation, 'motivation'),
    };
  }

  if (mode === 'postclose') {
    return {
      headline: asText(obj.headline, 'headline'),
      whatHappened: asText(obj.whatHappened, 'whatHappened'),
      wentWell: asTextList(obj.wentWell, 'wentWell'),
      wentWrong: asTextList(obj.wentWrong, 'wentWrong'),
      rulesBroken: asTextList(obj.rulesBroken, 'rulesBroken'),
      tomorrowAction: asText(obj.tomorrowAction, 'tomorrowAction'),
      motivation: asText(obj.motivation, 'motivation'),
    };
  }

  const grade = asText(obj.grade, 'grade').toUpperCase().slice(0, 2);
  return {
    verdict: asText(obj.verdict, 'verdict'),
    didWell: asTextList(obj.didWell, 'didWell'),
    costYou: asTextList(obj.costYou, 'costYou'),
    rulesBroken: asTextList(obj.rulesBroken, 'rulesBroken'),
    nextTime: asText(obj.nextTime, 'nextTime'),
    grade: /^[ABCDF][+-]?$/.test(grade) ? grade : '—',
  };
}
