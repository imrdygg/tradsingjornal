import { DailyReviewQuestions, QuestionAnswer } from '../../types';

export interface RuleEvaluation {
  id: keyof DailyReviewQuestions;
  label: string;
  answer: QuestionAnswer;
  desiredAnswer: 'yes' | 'no';
  isApplicable: boolean;
  isFollowed: boolean;
}

export const DAILY_DISCIPLINE_RULES: Array<{
  id: keyof DailyReviewQuestions;
  label: string;
  desiredAnswer: 'yes' | 'no';
}> = [
  { id: 'followedSetups', label: 'Followed setups?', desiredAnswer: 'yes' },
  { id: 'followedPredeterminedRisk', label: 'Followed predetermined risk?', desiredAnswer: 'yes' },
  { id: 'followedStops', label: 'Followed initial stops?', desiredAnswer: 'yes' },
  { id: 'chasedEntries', label: 'Chased entries?', desiredAnswer: 'no' },
  { id: 'revengeTraded', label: 'Revenge traded?', desiredAnswer: 'no' },
  { id: 'addedUnnecessaryRisk', label: 'Added unnecessary risk?', desiredAnswer: 'no' },
  { id: 'movedStopsEmotion', label: 'Moved stops because of emotion?', desiredAnswer: 'no' },
  { id: 'letWinnersWork', label: 'Let valid winners work?', desiredAnswer: 'yes' },
  { id: 'stoppedWhenShould', label: 'Stopped trading when I should have?', desiredAnswer: 'yes' },
];

export interface DisciplineCalculationResult {
  score: number; // 0 to 100
  rulesFollowedCount: number;
  applicableRulesCount: number;
  evaluations: RuleEvaluation[];
}

/**
 * Calculates discipline score based on the 9 execution rules.
 * N/A does not count towards applicable rules.
 * Score = (rules_followed / applicable_rules) * 100.
 * P&L never affects this calculation.
 */
export function calculateDisciplineScore(
  questions: DailyReviewQuestions
): DisciplineCalculationResult {
  const evaluations: RuleEvaluation[] = DAILY_DISCIPLINE_RULES.map((rule) => {
    const answer = questions[rule.id];
    const isApplicable = answer !== 'na';
    const isFollowed = isApplicable && answer === rule.desiredAnswer;
    return {
      id: rule.id,
      label: rule.label,
      answer,
      desiredAnswer: rule.desiredAnswer,
      isApplicable,
      isFollowed,
    };
  });

  const applicable = evaluations.filter((e) => e.isApplicable);
  const followed = applicable.filter((e) => e.isFollowed);

  const score =
    applicable.length > 0
      ? Math.round((followed.length / applicable.length) * 100)
      : 100;

  return {
    score,
    rulesFollowedCount: followed.length,
    applicableRulesCount: applicable.length,
    evaluations,
  };
}

/**
 * Calculates trade-level rule following status.
 */
export function calculateTradeRuleFollowing(review?: {
  followedSetup: QuestionAnswer;
  followedStop: QuestionAnswer;
  chasedEntry: QuestionAnswer;
  revengeTrade: QuestionAnswer;
  addedUnnecessaryRisk: QuestionAnswer;
  movedStopEmotion: QuestionAnswer;
  letWinnerWork: QuestionAnswer;
  wouldTakeAgain: QuestionAnswer;
}): { score: number; followedAll: boolean } | null {
  if (!review) return null;

  const checks = [
    { ans: review.followedSetup, pass: 'yes' },
    { ans: review.followedStop, pass: 'yes' },
    { ans: review.chasedEntry, pass: 'no' },
    { ans: review.revengeTrade, pass: 'no' },
    { ans: review.addedUnnecessaryRisk, pass: 'no' },
    { ans: review.movedStopEmotion, pass: 'no' },
    { ans: review.letWinnerWork, pass: 'yes' },
  ];

  const applicable = checks.filter((c) => c.ans !== 'na');
  if (!applicable.length) return null;

  const passed = applicable.filter((c) => c.ans === c.pass);
  const score = Math.round((passed.length / applicable.length) * 100);
  return {
    score,
    followedAll: passed.length === applicable.length,
  };
}
