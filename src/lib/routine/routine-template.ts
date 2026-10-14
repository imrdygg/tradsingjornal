import type { RoutineSection } from '../../types';

/**
 * The desk routine: the operating checklist a session is run against.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * There is no secret in it. Nobody's private edge is printed here, because the documented
 * public record of consistently profitable discretionary traders is not a set of entries —
 * it is a set of habits around entries. The traders who last are, almost without exception,
 * the ones who (a) define their risk before the market opens rather than after it moves,
 * (b) take a small number of written-down setups and refuse the rest, and (c) review
 * themselves honestly afterwards. That is the whole of the tea. Mark Douglas's work on
 * probabilistic thinking, Alexander Elder's "three M's" (mind, method, money), Van Tharp's
 * insistence on position sizing before prediction, the Turtles' fully-written rule set, and
 * Paul Tudor Jones's line about playing great defence all describe the same loop from
 * different seats. This file encodes that loop as something that can actually be ticked.
 *
 * WHAT MAKES IT WORTH DOING
 *
 * The value is not in reading the steps once. It is in the app's ability to say, later and
 * with the trader's own money attached: on the days you ran the routine you averaged X, and
 * on the days you skipped it you averaged Y. That comparison is in `routine-consistency.ts`
 * and it is the only part of this feature that can change behaviour, because it is the only
 * part that is evidence rather than instruction.
 *
 * HOW STEPS EVOLVE
 *
 * Steps are template content, like the built-in setups and instruments: identical for every
 * install, and only the day's ticks are persisted. A step added or removed in a later release
 * therefore does not invalidate any day already on the record, and a day is always scored
 * against the template as it stands.
 *
 * `critical` marks the steps without which the trader is genuinely trading blind: no defined
 * risk, no marked levels, no named setups, no written reason to stand down, or not fit to
 * trade. Those are what the pre-trade gate measures. It warns and never blocks — a form that
 * refuses a trade is one the trader works around, and the record of having traded through an
 * incomplete routine is exactly the evidence this journal exists to keep.
 */

export interface RoutineStep {
  /** Stable key. Persisted on the day, so it must never be derived from the label. */
  key: string;
  section: RoutineSection;
  /** What is being ticked, in as few words as fit on one line. */
  label: string;
  /** What "done" actually means, so the tick is not a judgement call. */
  detail: string;
  /**
   * Whether this step is one of the few that gate a trade (see {@link ROUTINE_CRITICAL_KEYS}).
   *
   * Kept deliberately rare. A checklist where everything is critical has no critical steps,
   * because the trader learns within a week that the warning is always on.
   */
  critical: boolean;
  /** Why this step is on the list at all, in the trader's own terms. Shown on request. */
  why: string;
}

export const ROUTINE_SECTION_ORDER: readonly RoutineSection[] = [
  'premarket',
  'session',
  'postmarket',
] as const;

export const ROUTINE_SECTION_LABEL: Record<RoutineSection, string> = {
  premarket: 'Before the open',
  session: 'During the session',
  postmarket: 'After the close',
};

export const ROUTINE_SECTION_BLURB: Record<RoutineSection, string> = {
  premarket:
    'Done once, deliberately, before the bell. Every decision here is made with a calm head and no position on — which is the only time a risk decision is worth anything.',
  session:
    'Behavioural rules, not tasks. These are the ones that have to hold while money is moving, so they are written as promises rather than to-dos.',
  postmarket:
    'Written the same day, while the reasoning is still recoverable. Tomorrow\'s trader has no memory of why today\'s trader did what they did.',
};

/**
 * The steps, in the order they are shown.
 *
 * Ordered by when they happen, not by importance: the routine is executed top to bottom, so
 * the list has to match the clock.
 */
export const ROUTINE_TEMPLATE: readonly RoutineStep[] = [
  // -------------------------------------------------------------------------
  // Before the open
  // -------------------------------------------------------------------------
  {
    key: 'premarket-state',
    section: 'premarket',
    label: 'Am I fit to trade today?',
    detail:
      'Slept, fed, not sick, not trading to fix yesterday or to pay for something. If the honest answer is no, the correct size today is zero and that is a completed step, not a failed one.',
    critical: true,
    why: 'Mark Douglas\'s point that the market is a mirror: a trader who needs the money is already making decisions for the wrong reason. This is the one step whose "pass" can be "I am not trading", and treating a genuine no-trade day as a routine success is what stops this list becoming an invitation to gamble.',
  },
  {
    key: 'premarket-context',
    section: 'premarket',
    label: 'Read where price actually is',
    detail:
      'Prior day high, low and close. Overnight high and low. Where the overnight range sits inside yesterday\'s — above, inside, below. Not a prediction, a location.',
    critical: false,
    why: 'A level is only meaningful relative to the range it is in. Two traders marking the same number read it completely differently if one knows it is yesterday\'s high and the other does not. This is the cheapest way to stop trading a chart you have not looked at.',
  },
  {
    key: 'premarket-news',
    section: 'premarket',
    label: 'Check the calendar, and note the clock',
    detail:
      'FOMC, CPI, NFP, any release for your instrument, and the exact time. Written down, not remembered: a scheduled 8:30 print turns a valid setup into a coin flip, and knowing it in advance is the difference between being flat and being surprised.',
    critical: false,
    why: 'The turtles and every desk since keep a rule about scheduled releases, because it is the one risk that arrives on a timetable. You cannot avoid what you have not looked at.',
  },
  {
    key: 'premarket-levels',
    section: 'premarket',
    label: 'Mark the levels',
    detail:
      'The two to six lines you will actually trade against, written down with prices — the ones in the MES tracker and the day\'s levels card. A screen of nine levels is a screen you will not act on; the limit is the point.',
    critical: true,
    why: 'The whole app is built around a level being touched and price not coming back. None of that record can exist if the levels are never written down before they are tested, and a level drawn after the fact is a level you have already traded.',
  },
  {
    key: 'premarket-bias',
    section: 'premarket',
    label: 'Write the bias — and what would prove it wrong',
    detail:
      'One lean per instrument, plus one sentence on the price that would falsify it. Written before the open, when it is a view rather than a justification.',
    critical: false,
    why: 'A view with no invalidation is not a view, it is a position waiting to happen. Writing the falsifier down is the cheapest available defence against holding a losing trade because the story still sounds good.',
  },
  {
    key: 'premarket-plan',
    section: 'premarket',
    label: 'Set the risk before the bell',
    detail:
      'Max loss for the day and where it comes from, contracts planned, the session windows allowed, and the risk-ladder slot each trade will take. Numbers, not intentions.',
    critical: true,
    why: 'Van Tharp\'s central claim, and the one every blown account contradicts: position size, not entry quality, determines whether you survive long enough for the edge to show up. Deciding it before the open is what makes it a rule instead of a reaction.',
  },
  {
    key: 'premarket-setups',
    section: 'premarket',
    label: 'Name the setups that count today',
    detail:
      'The one or two you are hunting, picked from the Watch list on the plan form. Anything that is not one of these is a no-trade, and saying so in advance is what makes the refusal possible in the moment.',
    critical: true,
    why: 'The Turtles traded one fully-specified system between them and shared it. The specificity is the edge: a setup you cannot name is one you cannot lose fairly, and an unlosable setup is one you will keep taking.',
  },
  {
    key: 'premarket-no-trade',
    section: 'premarket',
    label: 'Write the stay-out condition',
    detail:
      'The one thing that makes today a no-trade day — range too tight, price mid-range with no level near, a red-folder release in the window, first day back after a bad session. Written as a condition you can recognise from the screen.',
    critical: true,
    why: 'Most of a professional\'s activity is not trading. A written stand-down condition is the only mechanism by which "I will be patient today" becomes a decision rather than a hope, because it can be checked against the chart instead of against a feeling.',
  },
  {
    key: 'premarket-mechanics',
    section: 'premarket',
    label: 'Check the plumbing',
    detail:
      'Platform up, data live, order-entry panel open, default size correct, the instrument loaded, connectivity confirmed. Thirty seconds that prevents the worst trade of the year being an accident.',
    critical: true,
    why: 'Every serious operational failure in trading is boring: wrong contract, wrong size, an order that did not route. It is the one class of loss that is entirely avoidable, and it is avoidable before the open and not during it.',
  },

  // -------------------------------------------------------------------------
  // During the session
  // -------------------------------------------------------------------------
  {
    key: 'session-only-planned',
    section: 'session',
    label: 'Only the setups named this morning',
    detail:
      'Nothing else, however good it looks. If it is not on the list, the correct action is to write it down as a lesson for tomorrow rather than to take it today.',
    critical: false,
    why: 'This is the rule that separates a strategy from a hobby. An unlisted trade is untested, so its result teaches nothing and cannot be improved on — it only adds noise to the sample you are trying to read.',
  },
  {
    key: 'session-stop-first',
    section: 'session',
    label: 'Stop in before the entry fills',
    detail:
      'The stop order goes in with or before the entry, never after. If the platform will not let you, size down until you can.',
    critical: false,
    why: 'The distance between "I will put the stop in after" and an unbounded loss is one fast candle. Placing it first is what converts your risk number from a claim into a fact.',
  },
  {
    key: 'session-size-by-ladder',
    section: 'session',
    label: 'Size from the ladder, not from conviction',
    detail:
      'Trade #1 through #4 use their slot\'s amount. A trade you feel strongly about uses the same slot amount. Conviction is not a risk input.',
    critical: false,
    why: 'Confidence is the least reliable signal a trader has and the one most often used to justify size. Fixing size to the slot means the feeling can express itself in the entry decision without being able to reach the account.',
  },
  {
    key: 'session-reset-after-loss',
    section: 'session',
    label: 'Reset after every loss',
    detail:
      'Stand up, step away from the screen, and re-read the plan before the next order. That is the whole of it, and it is not optional after a stop-out.',
    critical: false,
    why: 'Revenge is not a character flaw, it is what a loss does to a nervous system. The only defence that works is a physical interruption inserted between the loss and the next click, which is why this step is written as a movement rather than as an intention.',
  },
  {
    key: 'session-loss-limit',
    section: 'session',
    label: 'Stop at the daily limit, no negotiation',
    detail:
      'When the day\'s max loss is hit, the session is over whichever way it happened. The next trade after the limit is the one that turns a bad day into a bad month.',
    critical: false,
    why: 'The daily loss limit is the only number in the plan that protects tomorrow\'s ability to trade. Every catastrophic account curve is a series of days where the limit was a suggestion.',
  },
  {
    key: 'session-no-averaging-down',
    section: 'session',
    label: 'Never add to a losing position',
    detail:
      'No exceptions, no "it is at a better price now". A losing position may be exited or held to its stop, never enlarged.',
    critical: false,
    why: 'Adding to a loser is the single mechanism by which a defined risk becomes an undefined one, and it is the trade most often responsible for accounts ending rather than drawing down. It is on the list because it is the mistake that feels most like skill while it is happening.',
  },
  {
    key: 'session-log-while-fresh',
    section: 'session',
    label: 'Log the trade while it is fresh',
    detail:
      'Entry, exit, why, note, tags, screenshot — recorded the same session, not reconstructed at the weekend. The exit note is the one that ages worst.',
    critical: false,
    why: 'A record written from memory is a record of what you would like to have done. The reasoning behind an exit is unrecoverable within hours, and it is the only input that can ever improve the exit.',
  },

  // -------------------------------------------------------------------------
  // After the close
  // -------------------------------------------------------------------------
  {
    key: 'postmarket-flat',
    section: 'postmarket',
    label: 'Flat and squared away',
    detail:
      'No position you did not consciously choose to carry, no resting orders left in the market, the platform closed.',
    critical: false,
    why: 'Carrying a position you forgot about is the same as taking one you never planned. It is a two-second check on a rule that decides whether your overnight risk was a decision or an oversight.',
  },
  {
    key: 'postmarket-reconcile',
    section: 'postmarket',
    label: 'Reconcile the numbers',
    detail:
      'Every fill in the journal matches the broker statement for the day — count, size, entry and exit. Differences get investigated now, while the reason is still findable.',
    critical: false,
    why: 'Every statistic in the Analytics tab, and every conclusion drawn from it, rests on the journal being the same record as the account. An unreconciled journal is a confident answer to the wrong question.',
  },
  {
    key: 'postmarket-grade-execution',
    section: 'postmarket',
    label: 'Grade the execution, not the P&L',
    detail:
      'The end-of-day review scores process: were the setups followed, was the risk predetermined, were stops moved. A green day taken badly is a bad day, and the review has to be able to say so.',
    critical: false,
    why: 'Result-based feedback trains you toward whatever happened to work, which in a sample of tens of trades is mostly luck. Process-based feedback is trainable, and it is the only kind that compounds.',
  },
  {
    key: 'postmarket-review',
    section: 'postmarket',
    label: 'Write the day\'s review',
    detail:
      'The nine-question review on this tab: what was done well, what was done poorly, and the one thing to fix tomorrow.',
    critical: false,
    why: 'The review is what turns a day of trades into a data point. Without it the day produces a number; with it, the day produces a lesson, and only the lessons accumulate.',
  },
  {
    key: 'postmarket-lesson',
    section: 'postmarket',
    label: 'One lesson, in one sentence',
    detail:
      'Something specific enough to act on tomorrow — captured as a lesson or as tomorrow\'s focus. If it cannot be said in a sentence, it is not a lesson yet, it is still a feeling.',
    critical: false,
    why: 'Carried forward, this is the only part of today that reaches tomorrow. The banner at the top of the Today tab is fed by it, which is why the step insists on one sentence rather than a page.',
  },
  {
    key: 'postmarket-close-out',
    section: 'postmarket',
    label: 'Shut the desk down',
    detail:
      'Charts closed, notifications off, tomorrow\'s levels noted if they already exist. Trading is finished for the day, including in the evening session.',
    critical: false,
    why: 'An evening session entered out of boredom is the most common unplanned trade there is. Closing the desk is what makes the day have an end, which is what makes it reviewable at all.',
  },
];

/** The template keyed by step, for the UI and the progress maths. */
export const ROUTINE_STEP_BY_KEY: ReadonlyMap<string, RoutineStep> = new Map(
  ROUTINE_TEMPLATE.map((step) => [step.key, step])
);

/**
 * The steps that gate a trade.
 *
 * Derived from the template rather than listed again, so the two can never disagree about
 * which steps matter.
 */
export const ROUTINE_CRITICAL_STEPS: readonly RoutineStep[] = ROUTINE_TEMPLATE.filter(
  (step) => step.critical
);

/** The steps in one phase, in template order. */
export function routineStepsInSection(section: RoutineSection): RoutineStep[] {
  return ROUTINE_TEMPLATE.filter((step) => step.section === section);
}

/** Every template key, in order. Used to ignore ticks for steps that no longer exist. */
export const ROUTINE_TEMPLATE_KEYS: readonly string[] = ROUTINE_TEMPLATE.map((step) => step.key);
