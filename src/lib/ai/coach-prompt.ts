// Type-only imports, so this module contributes nothing to either bundle at runtime and
// the function needs no third-party package. A failed import at load time would surface
// as an HTML error page rather than JSON, which is indistinguishable from the function
// not being deployed — hence keeping this dependency-free.
import type { DigestStatLine, JournalDigest } from './journal-digest';
import type { BehaviorBucket as DigestBehaviorBucket } from '../analytics/behavior';
import type {
  CoachExtras,
  CoachMode,
  CoachResponse,
  CoachTradeFacts,
  PlannedLevel,
  PlanFieldName,
  WeeklyPattern,
} from './coach-types';
import type { DailyBar, DailyBars, InstrumentQuote, MarketBrief } from './market-data';
import {
  formatDailyBarsForPrompt,
  formatInstrumentQuoteForPrompt,
  formatMarketBriefForPrompt,
} from './market-data';
import type { ChartReadResponse, PlanReviewResponse } from './coach-types';

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
  'planreview',
  'planfield',
  'planbuild',
  'scalein',
  'entrycall',
  'chartread',
];

/**
 * The modes where the coach is allowed a market opinion.
 *
 * Kept as an explicit list rather than a flag a caller passes, because this is the one
 * place the app departs from "the coach reviews process, never the market". A mode that
 * is not here gets the untouched, no-market guardrails no matter what data is attached.
 */
export const COACH_OPINION_MODES: readonly CoachMode[] = [
  'planfield',
  'planbuild',
  'scalein',
  'entrycall',
  'chartread',
];

export function isCoachMode(value: unknown): value is CoachMode {
  return typeof value === 'string' && (COACH_MODES as readonly string[]).includes(value);
}

/**
 * The modes whose prompt is built around a chart dataset rather than the journal digest
 * alone. These fetch daily bars server-side and always get a `chartSymbol` extra.
 */
export const COACH_CHART_MODES: readonly CoachMode[] = ['chartread'];

/** True when this mode may state a direction or an entry, from live data only. */
export function allowsMarketOpinion(mode: CoachMode): boolean {
  return (COACH_OPINION_MODES as readonly string[]).includes(mode);
}

/**
 * The system instruction for a coach call.
 *
 * The base guardrails ban market claims outright. Two narrow exceptions are appended,
 * never substituted, so a prompt can never lose the core rules:
 *
 * - `withMarketData`: the live sector read the plan-lock opinion quotes from.
 * - `withOpinion`: the trader has explicitly asked the coach for a directional call on
 *   their own instrument, which a strict reading of rule 2 would otherwise forbid.
 */
export function coachGuardrails(withMarketData: boolean, withOpinion = false): string {
  let text = COACH_GUARDRAILS;
  if (withMarketData) text += MARKET_GUARDRAILS_SUFFIX;
  if (withOpinion) text += OPINION_GUARDRAILS_SUFFIX;
  return text;
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
10. THE BEHAVIOUR SECTION IS ABOUT THEIR TIMING AND SIZING, NOT THE MARKET. Statistics such
    as the hour they entered or how long they held describe what THEY did. They are never
    evidence that a time of day, or a hold length, is good or bad. Never tell them to trade
    at a particular time, to hold longer, or to hold shorter — point out what their own
    results show and hand the observation back to them.
11. Reply with a single JSON object and nothing else. No markdown fences, no commentary
    before or after the JSON.`;

/**
 * Extra rules used only when live market data is attached (planreview mode). The
 * default guardrails forbid market claims because the coach normally has none; here it
 * has exactly one narrow feed, so the ban is replaced with a stricter contract about
 * what that feed may and may not support.
 */
const MARKET_GUARDRAILS_SUFFIX = `\n\nLIVE SECTOR DATA — SPECIAL RULES FOR THIS REQUEST ONLY.
You have been given one live dataset: today's percent change for SPY and the 11 US
sector ETFs versus their previous closes. It appears under TODAY'S MARKET READ. This is
the ONLY market data you have.

M1. Quote only numbers that appear in TODAY'S MARKET READ or in the journal data. Never
    state any other price, level or percentage. If the market read says it could not be
    loaded, say so in marketRead and give no market opinion at all.
M2. The data shows relative sector strength today. It is NOT a forecast and it does not
    tell you where any futures contract goes next. Describe what the numbers show —
    breadth, leaders, laggards, whether the plan's bias agrees or clashes with today's
    breadth — and stop there. No predictions, no "expect", no targets.
M3. An opinion on the PLAN means: does the plan's stated bias read as one-sided against
    today's breadth, is the plan specific enough to act on, and are its size and loss
    limit coherent with the trader's recent results. You never advise taking, sizing or
    skipping trades; you judge the written plan and hand the decision back.
M4. If the plan has no bias recorded, say the plan does not state a bias rather than
    inferring one from the market data.
M5. Honesty over comfort: if the plan is thin or the bias clashes badly with the data,
    say so plainly. Never flatter a plan into ready.`;

/**
 * The rules for the modes where the trader has asked for the coach's own market call.
 *
 * This is a deliberate, narrow exception to rule 2 above, and it is written to keep the
 * exception honest: the opinion must come only from numbers the coach was handed, it
 * must be labelled as an opinion, it must respect the trader's real risk limit, and
 * standing aside is a first-class answer rather than a failure. Nothing here removes
 * the ban on inventing a number.
 */
const OPINION_GUARDRAILS_SUFFIX = `\n\nYOUR OPINION WAS ASKED FOR — SPECIAL RULES FOR THIS REQUEST ONLY.
In this request only, the trader has explicitly asked for your own read: which side you
would take and where you would enter, stop and target. Rule 2 is narrowed, not lifted.

O1. You may state a DIRECTION and specific ENTRY, STOP and TARGET levels ONLY when they
    are numbers you were handed in the LIVE READ, or levels the trader recorded in their
    own journal. Never invent, recall, round or "roughly" a level. If you cannot build a
    level from the numbers you were given, say so and stand aside.
O2. This is an OPINION, not a prediction. Never claim certainty, an expected win rate,
    or that a level "will" hold. Say plainly that you can be wrong and that the numbers
    you have are one moment, not the session.
O3. SIZE MUST RESPECT THEIR RISK. The contracts you suggest, times the distance from the
    entry you suggest to the stop you suggest, may not exceed the planned loss limit in
    the journal data at the instrument's point value. If a sane stop does not fit the
    limit, say so and return a smaller size, or stand aside.
O4. STANDING ASIDE IS A REAL ANSWER. If the read does not support a clean entry, return
    the stand-aside value ("skip" or "flat"), keep the level fields null, and say why in
    the rationale. Never manufacture a trade to be helpful.
O5. The decision and the money are the trader's. Never phrase it as an instruction ("you
    should enter at..."). Write it as the call you would make and the reasoning behind
    it, then hand it back.
O6. If the LIVE READ says the data is unavailable, do NOT give a direction or any level
    at all. Return the stand-aside value and say the live read failed. Never fill in for
    missing data from memory.
O7. CHECK THE ACCOUNT'S DRAWDOWN ROOM, NOT JUST THE DAY'S. RISK CAPACITY reports how much
    of the agreed account drawdown is spent and what is left. When it says the limit is
    reached, or that one more day at the planned loss limit would breach it, say so
    plainly and make your suggestion smaller — never larger. When room is ample, you may
    note the room as a fact, but you never suggest raising size: growing risk is the
    trader's decision on their own equity, and it is never a reason you give for a trade.
O7. Keep the opinion short and checkable. Quote the actual numbers you used.`;

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

  // ---- Risk capacity ------------------------------------------------------
  // The size question is answered here rather than inferred from how the last few trades
  // went, because a trailing limit moves with the peak: a curve at a new high can still be
  // one ordinary losing day from the floor.
  lines.push('');
  lines.push('=== RISK CAPACITY (the account drawdown the trader agreed to) ===');
  const rc = digest.riskCapacity;
  if (rc.maxDrawdown === null) {
    lines.push(
      'NO ACCOUNT DRAWDOWN LIMIT IS RECORDED. Do not assume one and do not invent a figure. ' +
        'Say the limit is not set when the size of today\'s risk depends on it.'
    );
  } else {
    lines.push(
      `Agreed drawdown ${money(rc.maxDrawdown)}, measured from the equity high-water mark ` +
        `(currently ${money(rc.peak)}). Used so far ${money(rc.drawdownUsed)} ` +
        `(${rc.usedPct ?? 0}% of the limit, ${money(rc.headroom ?? 0)} left).`
    );
    lines.push(`Largest drawdown in the whole record so far ${money(rc.largestHistorical)}.`);
  }
  if (rc.dailyLossLimit !== null) {
    lines.push(
      `Today's planned loss limit ${money(rc.dailyLossLimit)}.` +
        (rc.daysOfHeadroom === null
          ? ''
          : ` The remaining room equals ${rc.daysOfHeadroom} full losing day(s) at that limit.`) +
        (rc.dailyLimitFits === false
          ? ' ONE MORE DAY AT THIS LIMIT WOULD BREACH THE ACCOUNT DRAWDOWN.'
          : '')
    );
  }
  lines.push(`Read: ${rc.note}`);

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

  // ---- Behaviour from the trader's own timestamps -------------------------
  // This is the only signal that does not depend on the trader noticing and admitting
  // something in a review. It is still their own data, never the market's.
  const b = digest.behavior;
  lines.push('');
  lines.push('=== BEHAVIOUR, READ FROM THEIR OWN TIMESTAMPS AND SIZES ===');
  lines.push(
    'These describe when and how the trader actually traded — not the market. Never turn ' +
      'them into advice about which time of day to trade or how long to hold a position.'
  );

  const renderBuckets = (title: string, buckets: DigestBehaviorBucket[]): boolean => {
    if (!buckets.length) return false;
    lines.push('');
    lines.push(`${title} (a real sample only):`);
    for (const bucket of buckets) {
      lines.push(
        `- ${bucket.label}: ${bucket.trades} trades, ${money(bucket.netPnL)}, ` +
          `avg ${bucket.avgR}R, win rate ${bucket.winRate}%`
      );
    }
    return true;
  };

  const hasTimeOfDay = renderBuckets(
    `Entry hour in their own timezone (${b.timezone})`,
    b.timeOfDay.buckets
  );
  if (hasTimeOfDay && b.timeOfDay.best && b.timeOfDay.worst) {
    lines.push(
      `Best entry hour by net P&L: ${b.timeOfDay.best.label} ` +
        `(${money(b.timeOfDay.best.netPnL)} over ${b.timeOfDay.best.trades} trades). ` +
        `Worst: ${b.timeOfDay.worst.label} ` +
        `(${money(b.timeOfDay.worst.netPnL)} over ${b.timeOfDay.worst.trades} trades).`
    );
  }

  renderBuckets('How long they held (entry to exit)', b.holdTime.buckets);
  if (b.holdTime.averageMinutes !== null) {
    lines.push(`Average hold: ${b.holdTime.averageMinutes} minute(s).`);
  }

  lines.push('');
  const loss = b.afterLoss;
  if (loss.afterLoss) {
    lines.push(
      `REACTION TO A LOSS: ${loss.afterLoss.trades} entry(ies) were opened within ` +
        `${loss.windowMinutes} minutes of a losing exit on the same day, across ` +
        `${loss.daysAffected} day(s). Those produced ${money(loss.afterLoss.netPnL)} ` +
        `(avg ${loss.afterLoss.avgR}R, win rate ${loss.afterLoss.winRate}%).`
    );
    if (loss.other) {
      lines.push(
        `Everything else: ${loss.other.trades} trade(s), ${money(loss.other.netPnL)} ` +
          `(avg ${loss.other.avgR}R, win rate ${loss.other.winRate}%).`
      );
    }
  } else if (loss.other) {
    lines.push(
      `REACTION TO A LOSS: none of the ${loss.other.trades} timed entry(ies) was opened ` +
        `within ${loss.windowMinutes} minutes of a losing exit.`
    );
  } else {
    lines.push('REACTION TO A LOSS: no timed entry to judge.');
  }

  const size = b.sizeDiscipline;
  if (size.daysWithPlannedContracts > 0) {
    lines.push(
      `SIZE AGAINST THEIR OWN PLAN: ${size.tradesOverPlannedSize} trade(s) were larger than ` +
        `the contracts planned for that day` +
        (size.worstOvershootContracts > 0
          ? ` (worst was ${size.worstOvershootContracts} contract(s) over the plan)`
          : '') +
        `. ${size.overPlannedSizeAfterLoss} of those came within ${loss.windowMinutes} minutes of a loss.`
    );
  }

  const activity = b.activity;
  if (activity.daysWithTrades > 0) {
    lines.push(
      `ACTIVITY: ${activity.daysWithTrades} day(s) had trades, median ` +
        `${activity.medianTradesPerDay} trade(s) per day.`
    );
    if (activity.busyAvgPnL !== null && activity.quietAvgPnL !== null) {
      lines.push(
        `Days above that median (${activity.busyDays}) averaged ${money(activity.busyAvgPnL)} per ` +
          `day; days at or below it (${activity.quietDays}) averaged ${money(activity.quietAvgPnL)} per day.`
      );
    }
    if (activity.busiestDay) {
      lines.push(
        `Busiest day ${activity.busiestDay.date}: ${activity.busiestDay.trades} trades, ` +
          `${money(activity.busiestDay.netPnL)}.`
      );
    }
  }

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
  renderWords('ENTRY NOTES', words.tradeNotes);
  renderWords('WHY THEY EXITED', words.exitReasons);
  renderWords('EXIT NOTES', words.exitNotes);
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
  if (trade.notes) lines.push(`\nEntry note: "${trade.notes}"`);
  if (trade.targetPrice !== undefined) lines.push(`\nExit price they planned around: ${trade.targetPrice}`);
  if (trade.exitReason) lines.push(`\nWhy they said they exited: "${trade.exitReason}"`);
  if (trade.exitNote) lines.push(`\nExit note: "${trade.exitNote}"`);

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

/** One plan field the coach is being asked to draft text for. */
export const PLAN_FIELD_LABELS: Record<PlanFieldName, string> = {
  waitingFor: 'What am I waiting for?',
  stayOutIf: 'What will keep me out of a trade?',
};

/**
 * Describes exactly which field is being drafted, and what is already in it, so the
 * model writes for that field rather than producing a general opinion.
 */
export function formatPlanFieldRequest(field: PlanFieldName, currentValue?: string): string {
  const lines: string[] = [];
  lines.push('=== THE FIELD TO DRAFT ===');
  lines.push(`TODAY'S PLAN FIELD: ${PLAN_FIELD_LABELS[field]} ("${field}")`);
  lines.push(
    field === 'waitingFor'
      ? 'This field answers: what must the market do before I am allowed to enter? Write it as a condition that can be watched in real time.'
      : 'This field answers: what would make me stand aside today? Write it as a condition the trader can recognise while the session is running.'
  );
  lines.push(
    currentValue && currentValue.trim()
      ? `What the trader has written there so far: "${currentValue.trim()}" — build on it; do not simply restate it.`
      : 'The trader has not written anything in this field yet.'
  );
  return lines.join('\n');
}

/**
 * The position already on, as the scale-in opinion needs it.
 *
 * The blended entry is computed here rather than left to the model: it is arithmetic
 * from numbers the trader recorded, and getting it wrong would put a bad break-even
 * level in front of them.
 */
export function formatPositionForPrompt(position: {
  symbol: string;
  direction: string;
  contracts: number;
  entryPrice: number;
  initialStop: number;
  currentPrice?: number;
  addContracts?: number;
  addPrice?: number;
  plannedLossLimit?: number;
  openPoints?: number;
}): string {
  const lines: string[] = [];
  const priceText = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  lines.push('=== THE POSITION ===');
  lines.push(
    `${position.contracts} ${position.symbol}, ${position.direction.toUpperCase()}, ` +
      `entry ${priceText(position.entryPrice)}, initial stop ${priceText(position.initialStop)}.`
  );
  if (position.currentPrice !== undefined) {
    lines.push(`Where the trader says the market is now: ${priceText(position.currentPrice)}.`);
  }
  if (position.openPoints !== undefined) {
    lines.push(`Open on the position at that price: ${position.openPoints.toFixed(2)} points.`);
  }
  if (position.plannedLossLimit !== undefined) {
    lines.push(`Today's planned loss limit: $${position.plannedLossLimit}.`);
  }
  if (position.addContracts !== undefined || position.addPrice !== undefined) {
    lines.push(
      'The add the trader is considering: ' +
        (position.addContracts !== undefined ? `${position.addContracts} contract(s)` : 'size not typed yet') +
        ' at ' +
        (position.addPrice !== undefined ? priceText(position.addPrice) : 'price not typed yet') +
        '.'
    );
    if (position.addContracts !== undefined && position.addPrice !== undefined) {
      const total = position.contracts + position.addContracts;
      const blended =
        (position.contracts * position.entryPrice + position.addContracts * position.addPrice) /
        total;
      lines.push(
        `If that add were filled, the position would be ${total} contract(s) at a blended entry of ` +
          `${priceText(blended)}. Use these exact figures (${total} and ${priceText(blended)}) if you ` +
          'discuss the blended entry — do not recompute them differently.'
      );
    }
  }
  return lines.join('\n');
}

/** The entry the trader has just recorded, for the coach's own call. */
export function formatEntryForPrompt(entry: {
  symbol: string;
  direction: string;
  contracts: number;
  entryPrice: number;
  initialStop: number;
  setupName?: string;
  entryReason?: string;
  targetPrice?: number;
  session: string;
}): string {
  const lines: string[] = [];
  lines.push('=== THE ENTRY THE TRADER JUST RECORDED ===');
  lines.push(
    `${entry.direction.toUpperCase()} ${entry.contracts} ${entry.symbol} in the ${entry.session}, ` +
      `entry ${entry.entryPrice}, initial stop ${entry.initialStop}.`
  );
  if (entry.setupName) lines.push(`Setup they logged it as: ${entry.setupName}.`);
  if (entry.entryReason) lines.push(`Their reason in their own words: "${entry.entryReason}".`);
  if (entry.targetPrice !== undefined) lines.push(`Their target price: ${entry.targetPrice}.`);
  lines.push(
    'Make YOUR OWN call on the live numbers, and do not simply agree with them — this is ' +
      'recorded beside their entry to compare the two, so agreeing out of politeness makes the ' +
      'comparison worthless.'
  );
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
  planreview: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words, on what today's plan reads like",
  "marketRead": "2-3 sentences on what TODAY'S MARKET READ shows — breadth, leaders, laggards, quoting the percentages — and how the plan's bias sits against it. If the market read says data is unavailable, say exactly that here and nothing more about the market",
  "alignment": "one or two sentences: does the plan's recorded bias agree or clash with today's breadth? If no bias is recorded, say the plan does not state one",
  "riskCheck": "one or two sentences judging the planned loss limit and contracts against the trader's own recent results and against the room left in RISK CAPACITY, quoting the figures",
  "planGaps": ["short, specific weaknesses in this plan — missing levels, vague waiting-for, a stay-out rule that cannot be checked, and so on. Empty only if the plan is genuinely complete"],
  "watchFor": ["1-3 things worth the trader's attention at the open, phrased as process checks, never as predictions or entry advice"],
  "verdict": "one of ready, workable, shaky — ready means specific and coherent with both the data and the trader's history",
  "oneFix": "the single highest-value change to make before locking. May be empty string only when verdict is ready"
}
Be honest, not encouraging. A thin plan gets shaky even when the trader is keen.`,
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
  planfield: `Return exactly this JSON:
{
  "field": "the field you were asked to draft: waitingFor or stayOutIf",
  "suggestion": "the text for that field: 1-2 sentences, first person, as the trader would write it. Specific and checkable, naming the condition that matters rather than a vague intention",
  "rationale": "1-2 sentences on why this suits THIS trader, quoting their own plan, results or repeated mistakes",
  "basedOn": ["the specific journal facts and live levels you used, one per item"]
}
This is a draft, not a decision: the trader edits it before saving. The text must be something that can be checked while the session is running — a condition of the market, not a feeling.`,
  planbuild: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words, on what today looks like to you",
  "bias": "one of bullish, bearish, neutral, unsure",
  "direction": "the side you would trade today: long, short, or skip",
  "entry": "the level you would enter at, as a number taken from the live read or the journal's own levels, or null when you would skip",
  "stop": "the level your stop would sit at, as a number, or null when you would skip",
  "target": "the level you would aim for, as a number, or null when you would skip",
  "contracts": "whole number of contracts that keeps entry-to-stop risk inside the planned loss limit",
  "waitingFor": "1-2 first-person sentences: the condition you would wait for before entering",
  "stayOutIf": "1-2 first-person sentences: what would keep you out",
  "setups": ["names of setups from the trader's own playbook that fit today; empty only if none do"],
  "levels": [{ "price": 0, "label": "overnight high" }],
  "rationale": "3-4 sentences: the read, why that side, why that size, and plainly that this is your opinion and can be wrong",
  "confidence": "one of low, medium, high",
  "basedOn": ["each live number and journal fact you used, one per item"]
}
Every price you return must be a number you were handed. If the live read failed, return skip with null levels, say the read failed in the rationale, and still draft the waitingFor and stayOutIf text from the journal alone.`,
  scalein: `Return exactly this JSON:
{
  "stance": "one of add, hold, do-not-add",
  "addPrice": "the level you would add at, a number from the read or the journal, or null when the stance is hold or do-not-add",
  "addContracts": "whole number of contracts to add, or null when the stance is hold or do-not-add",
  "stopAfterAdd": "where the stop belongs after the add so the extra risk is bounded, or null",
  "breakevenPrice": "the blended entry after that add, computed from the numbers you were given, or null",
  "rationale": "3-4 sentences: why that stance, what it does to the position's average and to the day's risk, and that this is your opinion",
  "risks": ["1-3 specific things that would make this add a mistake"]
}
The position's real numbers are in THE POSITION. Do the arithmetic from those numbers and show it in the rationale. Never suggest an add whose total risk, from the blended entry to the stop, exceeds the planned loss limit.`,
  entrycall: `Return exactly this JSON:
{
  "direction": "the side you would take at this moment: long, short, or flat when you would not be in a trade",
  "entry": "the level you would enter at, a number taken from the live read, or null when flat",
  "stop": "the level your stop would sit at, a number, or null when flat",
  "target": "the level you would aim for, a number, or null when flat",
  "rationale": "2-3 sentences: what you read in the live numbers and why that side, stated as your opinion"
}
This is recorded beside the trader's own entry and compared with it later, so be specific and be honest about what the numbers do and do not show.`,
  chartread: `Return exactly this JSON:
{
  "headline": "one sentence, under 16 words, on what this chart shows",
  "patternRead": "3-5 sentences on what the DAILY CHART DATA actually shows: direction of the closes, where the last close sits in the series range, streaks or contraction the numbers state. Name only levels that are numbers you were handed. If the data is unavailable, say exactly that and nothing more about the chart",
  "levels": [{ "price": 0, "label": "series high" }],
  "direction": "the side you would take looking at this chart: long, short, or skip",
  "entry": "the level you would enter at, a number from the data, or null when you would skip",
  "stop": "the level your stop would sit at, a number, or null when you would skip",
  "target": "the level you would aim for, a number, or null when you would skip",
  "bias": "one of bullish, bearish, neutral, unsure: the bias you would record for today's plan on this instrument",
  "contracts": "whole number of contracts for today's plan on this instrument, sized so entry-to-stop risk stays inside the planned loss limit AND inside the room left in RISK CAPACITY. Return 0 if you would not plan a size, and 0 when you would stand aside",
  "waitingFor": "1-2 first-person sentences on today's plan for this instrument: the condition to wait for before acting on this read",
  "stayOutIf": "1-2 first-person sentences on today's plan: what would keep you out today",
  "setups": ["names of setups from the trader's own playbook that fit this chart; empty only if none do"],
  "fitsTheirTrading": "1-3 sentences on how the trade you would consider squares with THIS trader's documented habits — setup record, discipline scores, repeated leaks. If it repeats one of their leaks, say so",
  "risks": ["1-3 specific things that would make acting on this read a mistake, including when the data is thin"],
  "rationale": "3-4 sentences: the read, the side, why that size fits their risk limit, and plainly that this is your opinion and can be wrong",
  "confidence": "one of low, medium, high",
  "basedOn": ["each bar, level and journal fact you used, one per item, quoting the numbers"]
}
Every level you return must be a number from DAILY CHART DATA or LIVE READ. If the chart data is unavailable, return skip with null levels, say so, and base fitsTheirTrading on the journal alone. Standing aside is a real answer.
You are also drafting TODAY'S PLAN around this one instrument: bias, contracts, waitingFor, stayOutIf, setups and levels above. They are for this instrument only — never for another market, and never a plan that covers several. They are written into the trader's plan only if the trader accepts them, so keep them about this chart and this trader's own playbook.`,
};

/**
 * The extras a prompt may carry: the wire-level `CoachExtras` plus the three things only
 * the server can attach — the live read it fetched, the field's current text, and the
 * daily-bar series behind a chart read.
 */
export type CoachPromptExtras = CoachExtras & {
  instrumentQuote?: InstrumentQuote;
  /** What the trader has already typed in the field being drafted. */
  currentFieldValue?: string;
  /** The daily-bar series the chart-read mode is asked to interpret. */
  chartSeries?: DailyBars;
};

export function buildCoachPrompt(
  mode: CoachMode,
  digest: JournalDigest,
  trade?: CoachTradeFacts,
  marketBrief?: MarketBrief,
  extras?: CoachPromptExtras
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
      : mode === 'planreview'
      ? `The trader is about to lock the plan shown under TODAY'S PLAN, and asked for your honest opinion ` +
        `of it before the session starts. Read it against their recent results AND today's live sector ` +
        `read. Say what holds up, what is thin, and whether the recorded bias sits comfortably or ` +
        `one-sided against today's breadth. Judge the written plan only — never tell them to take, ` +
        `size or skip trades, and never predict where anything goes next. If the market read or the ` +
        `plan is missing something you need, say exactly that instead of guessing.`
      : mode === 'planfield'
      ? `The trader is stuck on one field of today's plan and asked you to draft it. Write the text ` +
        `for that field only, in their voice, shaped by their own risk parameters, recent results and ` +
        `repeated mistakes, and by the live levels when you have them. It is a draft they will edit.`
      : mode === 'planbuild'
      ? `The trader asked for a whole draft plan for today, in one go. Read their style from the ` +
        `journal — instruments, sessions, setups, typical size, their risk limit and the mistakes they ` +
        `actually repeat — then use the LIVE READ to make your own call: which side, where you would ` +
        `enter, where the stop and target sit, and how many contracts keep that risk inside the ` +
        `planned loss limit AND inside the room left in RISK CAPACITY. ` +
        `Fill the plan fields too. State plainly that this is your opinion and can be wrong.`
      : mode === 'scalein'
      ? `The trader already has a position on and is considering adding to it. Give your own opinion ` +
        `on whether to add, where, how much, and where the stop belongs after the add. Work from the ` +
        `position's real numbers and the live read, keep the total risk inside the planned loss limit, ` +
        `and remember that adding to a loser is usually how a small loss becomes the day's loss.`
      : mode === 'entrycall'
      ? `The trader has just recorded an entry and asked for your own call at that same moment. Say ` +
        `which side you would be on right now, at what level, with what stop and target, from the live ` +
        `read. Do not anchor to their direction: make your own read, and be willing to be on the other ` +
        `side of them.`
      : mode === 'chartread'
      ? `The trader is looking at a chart of ${'{instrument}'} right now and asked for your read of it. ` +
        `You have been given the same recent daily bars the chart shows, under DAILY CHART DATA, plus ` +
        `a live quote under LIVE READ. Describe what the series actually shows — direction of the ` +
        `closes, where price sits inside the series range, any streak the data states — naming only ` +
        `levels that are numbers you were handed. Then say what YOU would do looking at it, or that ` +
        `you would stand aside. Read the journal digest the same way you always do: if the trade you ` +
        `would consider repeats one of this trader's documented leaks, say so under fitsTheirTrading. ` +
        `Then draft today's plan for THIS instrument alone: the bias you would record, a size that ` +
        `keeps entry-to-stop risk inside the planned loss limit and inside the room left in RISK ` +
        `CAPACITY, what you would wait for, what would keep you out, and which of the trader's own ` +
        `playbook setups fit this chart. The trader is charting one symbol at a time, so the plan is ` +
        `for that symbol only — do not plan for any other market, and do not assume they will trade ` +
        `several today.`
      : `Critique the single trade described below. Judge the decision and the execution separately. ` +
        `Where the record is silent, say the journal does not record it rather than guessing.`;

  // Gated on the mode, not merely on the argument: a caller that passes a trade with
  // a brief should not have that trade silently injected into the prompt.
  const tradeBlock =
    mode === 'trade' && trade
      ? `\n\n=== THE TRADE TO CRITIQUE ===\n${formatTradeForPrompt(trade)}`
      : '';

  // Same gating for the live sector read: only the planreview prompt carries it, so a
  // stray brief can never leak market data into a mode whose guardrails forbid it.
  const marketBlock =
    mode === 'planreview' && marketBrief
      ? `\n\n${formatMarketBriefForPrompt(marketBrief)}`
      : '';

  // The live futures read goes to the opinion modes and nowhere else, for the same
  // reason: it is the one dataset their narrowed guardrails allow them to quote.
  const instrumentBlock =
    allowsMarketOpinion(mode) && extras?.instrumentQuote
      ? `\n\n${formatInstrumentQuoteForPrompt(extras.instrumentQuote)}`
      : '';

  // Same per-mode gating again: a position is only ever injected into the scale-in
  // prompt, an entry only into the entry-call prompt, and the field request only into
  // the field prompt.
  const positionBlock =
    mode === 'scalein' && extras?.position
      ? `\n\n${formatPositionForPrompt(extras.position)}`
      : '';
  const entryBlock =
    mode === 'entrycall' && extras?.entry
      ? `\n\n${formatEntryForPrompt(extras.entry)}`
      : '';
  const fieldBlock =
    mode === 'planfield' && extras?.field
      ? `\n\n${formatPlanFieldRequest(extras.field, extras.currentFieldValue)}`
      : '';

  // The daily-bar series behind a chart read. Fetched server-side; a chart read without
  // the series degrades inside the formatter to a plain "data unavailable" block, and
  // the guardrails make the model stand aside rather than describe a chart it cannot see.
  const chartBlock =
    mode === 'chartread' && extras?.chartSeries
      ? `\n\n${formatDailyBarsForPrompt(extras.chartSeries)}`
      : '';

  const userPrompt =
    `${context}${marketBlock}${instrumentBlock}${chartBlock}${tradeBlock}${positionBlock}${entryBlock}${fieldBlock}` +
    `\n\n=== YOUR TASK ===\n${task.replace('{instrument}', extras?.instrument || 'the instrument')}\n\n${COACH_RESPONSE_SHAPES[mode]}`;

  return {
    systemInstruction: coachGuardrails(mode === 'planreview', allowsMarketOpinion(mode)),
    userPrompt,
  };
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
 * A price the model returned, or null.
 *
 * Models wrap numbers in currency strings and quotes often enough that accepting
 * `"7,740.25"` is worth the tolerance; anything that is not a number after that is an
 * error rather than a silent zero, because a wrong level is worse than a missing one.
 */
function asNumberOrNull(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Coach response field "${field}" must be a number or null.`);
}

/** A whole contract count, never below 1: zero contracts is not a plan. */
function asPositiveInt(value: unknown, field: string, fallback: number): number {
  const parsed = asNumberOrNull(value, field);
  if (parsed === null) return fallback;
  return Math.max(1, Math.round(parsed));
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Text that may be absent, for the fields a read fills only when it has something to say.
 *
 * Unlike `asText` this never throws: an omitted field stays empty, and the applier reads
 * an empty field as "leave what the trader already wrote".
 */
function asLooseText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Levels the draft plan wants marked; anything without a usable price is dropped. */
function asLevels(value: unknown): PlannedLevel[] {
  if (!Array.isArray(value)) return [];
  const levels: PlannedLevel[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    let price: number | null = null;
    try {
      price = asNumberOrNull(record.price, 'levels.price');
    } catch {
      price = null;
    }
    if (price === null) continue;
    levels.push({
      price,
      label: typeof record.label === 'string' ? record.label.trim() : '',
    });
  }
  return levels;
}

/**
 * Validates the model's JSON into a known shape.
 *
 * Throws with a readable message rather than returning partial data, so the UI can
 * tell the trader the coach produced something unusable instead of rendering holes.
 */
export function parseCoachResponse(
  mode: CoachMode,
  raw: unknown,
  extras?: CoachExtras
): CoachResponse {
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

  if (mode === 'planreview') {
    const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict.trim().toLowerCase() : '';
    const verdict: PlanReviewResponse['verdict'] =
      verdictRaw === 'ready' || verdictRaw === 'workable' ? verdictRaw : 'shaky';
    const oneFix = typeof obj.oneFix === 'string' ? obj.oneFix.trim() : '';
    return {
      headline: asText(obj.headline, 'headline'),
      marketRead: asText(obj.marketRead, 'marketRead'),
      alignment: asText(obj.alignment, 'alignment'),
      riskCheck: asText(obj.riskCheck, 'riskCheck'),
      planGaps: asTextList(obj.planGaps, 'planGaps'),
      watchFor: asTextList(obj.watchFor, 'watchFor'),
      verdict,
      oneFix: verdict === 'ready' ? oneFix : asText(obj.oneFix, 'oneFix'),
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

  if (mode === 'planfield') {
    // The trader asked for one specific field. Whatever the model labelled its answer,
    // the text is applied to the field that was actually requested, so a mislabelled
    // response can never write into the wrong field.
    const asked = extras?.field;
    const returned = asEnum(obj.field, ['waitingFor', 'stayOutIf'] as const, 'waitingFor');
    return {
      field: asked ?? returned,
      suggestion: asText(obj.suggestion, 'suggestion'),
      rationale: asText(obj.rationale, 'rationale'),
      basedOn: asTextList(obj.basedOn, 'basedOn'),
    };
  }

  if (mode === 'planbuild') {
    return {
      headline: asText(obj.headline, 'headline'),
      bias: asEnum(obj.bias, ['bullish', 'bearish', 'neutral', 'unsure'] as const, 'unsure'),
      direction: asEnum(obj.direction, ['long', 'short', 'skip'] as const, 'skip'),
      entry: asNumberOrNull(obj.entry, 'entry'),
      stop: asNumberOrNull(obj.stop, 'stop'),
      target: asNumberOrNull(obj.target, 'target'),
      contracts: asPositiveInt(obj.contracts, 'contracts', 1),
      waitingFor: asText(obj.waitingFor, 'waitingFor'),
      stayOutIf: asText(obj.stayOutIf, 'stayOutIf'),
      setups: asTextList(obj.setups, 'setups'),
      levels: asLevels(obj.levels),
      rationale: asText(obj.rationale, 'rationale'),
      confidence: asEnum(obj.confidence, ['low', 'medium', 'high'] as const, 'low'),
      basedOn: asTextList(obj.basedOn, 'basedOn'),
    };
  }

  if (mode === 'scalein') {
    const stance = asEnum(obj.stance, ['add', 'hold', 'do-not-add'] as const, 'hold');
    // A 'hold' or 'do-not-add' with levels attached would render an add the coach did
    // not actually ask for, so the levels are dropped rather than trusted.
    const adding = stance === 'add';
    return {
      stance,
      addPrice: adding ? asNumberOrNull(obj.addPrice, 'addPrice') : null,
      addContracts: adding ? asNumberOrNull(obj.addContracts, 'addContracts') : null,
      stopAfterAdd: adding ? asNumberOrNull(obj.stopAfterAdd, 'stopAfterAdd') : null,
      breakevenPrice: asNumberOrNull(obj.breakevenPrice, 'breakevenPrice'),
      rationale: asText(obj.rationale, 'rationale'),
      risks: asTextList(obj.risks, 'risks'),
    };
  }

  if (mode === 'entrycall') {
    const direction = asEnum(obj.direction, ['long', 'short', 'flat'] as const, 'flat');
    const inTrade = direction !== 'flat';
    return {
      direction,
      entry: inTrade ? asNumberOrNull(obj.entry, 'entry') : null,
      stop: inTrade ? asNumberOrNull(obj.stop, 'stop') : null,
      target: inTrade ? asNumberOrNull(obj.target, 'target') : null,
      rationale: asText(obj.rationale, 'rationale'),
    };
  }

  if (mode === 'chartread') {
    const direction = asEnum(obj.direction, ['long', 'short', 'skip'] as const, 'skip');
    const hasTrade = direction !== 'skip';
    return {
      headline: asText(obj.headline, 'headline'),
      patternRead: asText(obj.patternRead, 'patternRead'),
      levels: asLevels(obj.levels),
      direction,
      entry: hasTrade ? asNumberOrNull(obj.entry, 'entry') : null,
      stop: hasTrade ? asNumberOrNull(obj.stop, 'stop') : null,
      target: hasTrade ? asNumberOrNull(obj.target, 'target') : null,
      // The plan fields are parsed tolerantly, unlike the read above. A chart read is the
      // feature the trader asked for; a model that omits the plan half must not turn a
      // usable read into an error. An empty value means "write nothing for this field",
      // which the applier honours, and 0 contracts means the size is left alone.
      bias: asEnum(obj.bias, ['bullish', 'bearish', 'neutral', 'unsure'] as const, 'unsure'),
      contracts: asPositiveInt(obj.contracts, 'contracts', 0),
      waitingFor: asLooseText(obj.waitingFor),
      stayOutIf: asLooseText(obj.stayOutIf),
      setups: asTextList(obj.setups, 'setups'),
      fitsTheirTrading: asText(obj.fitsTheirTrading, 'fitsTheirTrading'),
      risks: asTextList(obj.risks, 'risks'),
      rationale: asText(obj.rationale, 'rationale'),
      confidence: asEnum(obj.confidence, ['low', 'medium', 'high'] as const, 'low'),
      basedOn: asTextList(obj.basedOn, 'basedOn'),
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
