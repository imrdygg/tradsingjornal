import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Award,
  TrendingUp,
  TrendingDown,
  Shield,
  HelpCircle,
} from 'lucide-react';
import {
  TradingDay,
  Trade,
  DailyReview,
  DailyReviewQuestions,
  QuestionAnswer,
} from '../../types';
import { calculateDisciplineScore } from '../../lib/analytics/discipline';
import { ModalOverlay } from '../common/ModalOverlay';

interface DailyReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  day: TradingDay;
  trades: Trade[];
  existingReview?: DailyReview;
  onSaveReview: (review: DailyReview) => void;
}

export const DailyReviewModal: React.FC<DailyReviewModalProps> = ({
  isOpen,
  onClose,
  day,
  trades,
  existingReview,
  onSaveReview,
}) => {
  // Questions state
  const [questions, setQuestions] = useState<DailyReviewQuestions>({
    followedSetups: 'yes',
    followedPredeterminedRisk: 'yes',
    followedStops: 'yes',
    chasedEntries: 'no',
    revengeTraded: 'no',
    addedUnnecessaryRisk: 'no',
    movedStopsEmotion: 'no',
    letWinnersWork: 'yes',
    stoppedWhenShould: 'yes',
  });

  // Three reflections
  const [didWell, setDidWell] = useState('');
  const [didPoorly, setDidPoorly] = useState('');
  const [tomorrowFocus, setTomorrowFocus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (existingReview) {
      setQuestions(existingReview.questions);
      setDidWell(existingReview.didWell || '');
      setDidPoorly(existingReview.didPoorly || '');
      setTomorrowFocus(existingReview.tomorrowFocus || '');
    } else {
      setQuestions({
        followedSetups: 'yes',
        followedPredeterminedRisk: 'yes',
        followedStops: 'yes',
        chasedEntries: 'no',
        revengeTraded: 'no',
        addedUnnecessaryRisk: 'no',
        movedStopsEmotion: 'no',
        letWinnersWork: 'yes',
        stoppedWhenShould: 'yes',
      });
      setDidWell('');
      setDidPoorly('');
      setTomorrowFocus('');
    }
    setError('');
  }, [isOpen, existingReview]);

  // Automated Metrics calculation
  const metrics = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'closed');
    const count = closed.length;
    const realizedPnL = Math.round(closed.reduce((s, t) => s + t.grossPnL, 0) * 100) / 100;
    const winners = closed.filter((t) => t.grossPnL > 0);
    const losers = closed.filter((t) => t.grossPnL < 0);
    const wins = winners.length;
    const loss = losers.length;
    const winRate = count > 0 ? Math.round((wins / count) * 1000) / 10 : 0;
    const avgWinner =
      wins > 0 ? Math.round((winners.reduce((s, t) => s + t.grossPnL, 0) / wins) * 100) / 100 : 0;
    const avgLoser =
      loss > 0 ? Math.round((losers.reduce((s, t) => s + t.grossPnL, 0) / loss) * 100) / 100 : 0;
    const largestWinner = wins > 0 ? Math.max(...winners.map((t) => t.grossPnL)) : 0;
    const largestLoss = loss > 0 ? Math.min(...losers.map((t) => t.grossPnL)) : 0;
    const sessions = Array.from(new Set(closed.map((t) => t.session)));

    return {
      realizedPnL,
      count,
      wins,
      loss,
      winRate,
      avgWinner,
      avgLoser,
      largestWinner,
      largestLoss,
      sessions,
    };
  }, [trades]);

  // Automated Discipline Score calculation
  const discipline = useMemo(() => {
    return calculateDisciplineScore(questions);
  }, [questions]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!didWell.trim() || !didPoorly.trim() || !tomorrowFocus.trim()) {
      setError('Please provide all three reflections: What went well, what went poorly, and your focus for tomorrow.');
      return;
    }

    const review: DailyReview = {
      id: existingReview ? existingReview.id : `review-${Date.now()}`,
      userId: day.userId,
      tradingDayId: day.id,
      questions,
      disciplineScore: discipline.score,
      scoringDetails: discipline.evaluations.map((e) => ({
        rule: e.label,
        answer: e.answer,
        isFollowed: e.isApplicable ? e.isFollowed : null,
      })),
      didWell: didWell.trim(),
      didPoorly: didPoorly.trim(),
      tomorrowFocus: tomorrowFocus.trim(),
      createdAt: existingReview ? existingReview.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveReview(review);
    onClose();
  };

  const updateQuestion = (key: keyof DailyReviewQuestions, val: QuestionAnswer) => {
    setQuestions((prev) => ({ ...prev, [key]: val }));
  };

  const renderQuestionRow = (
    key: keyof DailyReviewQuestions,
    label: string,
    desired: 'yes' | 'no'
  ) => {
    const current = questions[key];
    const isApplicable = current !== 'na';
    const isFollowed = isApplicable && current === desired;

    return (
      <div className="flex items-center justify-between text-xs py-1.5 border-b border-zinc-800/50 last:border-0">
        <div className="flex items-center gap-2">
          {isApplicable ? (
            isFollowed ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )
          ) : (
            <HelpCircle className="w-4 h-4 text-zinc-500 shrink-0" />
          )}
          <span className={isApplicable && !isFollowed ? 'text-rose-200' : 'text-zinc-200'}>
            {label}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-zinc-950 p-1 border border-zinc-800 shrink-0">
          {(['yes', 'no', 'na'] as QuestionAnswer[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => updateQuestion(key, opt)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold uppercase transition-all ${
                current === opt
                  ? opt === 'yes'
                    ? desired === 'yes'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                    : opt === 'no'
                    ? desired === 'no'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                    : 'bg-zinc-800 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {opt === 'na' ? 'N/A' : opt}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const pnlColor =
    metrics.realizedPnL > 0
      ? 'text-emerald-400'
      : metrics.realizedPnL < 0
      ? 'text-rose-400'
      : 'text-zinc-300';

  return (
    <ModalOverlay
      backdropClassName="bg-black/85 backdrop-blur-sm"
      onRequestClose={onClose}
      label={`End-of-day review — ${day.tradeDate}`}
    >
      <div className="relative my-6 w-full max-w-2xl space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              End-of-Day Review — {day.tradeDate}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Separate financial performance from execution quality. Be brutally honest.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-800/80 bg-rose-950/40 p-3 text-xs text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* 1. Automated Day Performance Metrics */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5 space-y-2 font-mono">
          <div className="text-[11px] uppercase font-semibold text-zinc-400 flex items-center justify-between">
            <span>Automated Day Metrics</span>
            <span className="text-zinc-500">
              Risk Mode: <span className="text-zinc-300 uppercase">{day.riskMode}</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
            <div>
              <span className="text-zinc-500 block text-[10px]">Realized P&L</span>
              <span className={`text-base font-bold ${pnlColor}`}>
                {metrics.realizedPnL > 0 ? '+' : ''}${metrics.realizedPnL.toFixed(2)}
              </span>
            </div>

            <div>
              <span className="text-zinc-500 block text-[10px]">Trades & Win Rate</span>
              <span className="font-bold text-zinc-200">
                {metrics.count} trades ({metrics.winRate}%)
              </span>
              <span className="text-zinc-500 block text-[10px]">
                {metrics.wins}W / {metrics.loss}L
              </span>
            </div>

            <div>
              <span className="text-zinc-500 block text-[10px]">Avg Win / Loss</span>
              <span className="text-emerald-400 block">+${metrics.avgWinner.toFixed(0)}</span>
              <span className="text-rose-400 block">-${Math.abs(metrics.avgLoser).toFixed(0)}</span>
            </div>

            <div>
              <span className="text-zinc-500 block text-[10px]">Largest Win / Loss</span>
              <span className="text-emerald-400 block">+${metrics.largestWinner.toFixed(0)}</span>
              <span className="text-rose-400 block">-${Math.abs(metrics.largestLoss).toFixed(0)}</span>
            </div>
          </div>
        </div>

        {/* 2. Automated Discipline Score Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono block">
                Execution Discipline Score
              </span>
              <span className="text-[11px] text-zinc-500">
                Formula: rules followed / applicable rules × 100 (N/A does not count; P&L never affects this)
              </span>
            </div>
            <div className="text-right font-mono">
              <span
                className={`text-2xl font-bold ${
                  discipline.score >= 90
                    ? 'text-emerald-400'
                    : discipline.score >= 70
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {discipline.score}%
              </span>
              <span className="text-[10px] text-zinc-500 block">
                {discipline.rulesFollowedCount}/{discipline.applicableRulesCount} rules followed
              </span>
            </div>
          </div>

          {/* 9 Execution Questions */}
          <div className="space-y-0.5 pt-1">
            {renderQuestionRow('followedSetups', 'Followed setups?', 'yes')}
            {renderQuestionRow('followedPredeterminedRisk', 'Followed predetermined risk?', 'yes')}
            {renderQuestionRow('followedStops', 'Followed initial stops?', 'yes')}
            {renderQuestionRow('chasedEntries', 'Chased entries?', 'no')}
            {renderQuestionRow('revengeTraded', 'Revenge traded?', 'no')}
            {renderQuestionRow('addedUnnecessaryRisk', 'Added unnecessary risk?', 'no')}
            {renderQuestionRow('movedStopsEmotion', 'Moved stops because of emotion?', 'no')}
            {renderQuestionRow('letWinnersWork', 'Let valid winners work?', 'yes')}
            {renderQuestionRow('stoppedWhenShould', 'Stopped trading when I should have?', 'yes')}
          </div>
        </div>

        {/* 3. The Three Required Daily Reflections */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono">
            Daily Reflections (Required)
          </h4>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">
              1. What did I do well? <span className="text-rose-400">*</span>
            </label>
            <textarea
              rows={2}
              value={didWell}
              onChange={(e) => setDidWell(e.target.value)}
              placeholder="e.g. Waited patiently for 9:30 AM open volatility to settle before executing the first engulfing setup..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">
              2. What did I do poorly? <span className="text-rose-400">*</span>
            </label>
            <textarea
              rows={2}
              value={didPoorly}
              onChange={(e) => setDidPoorly(e.target.value)}
              placeholder="e.g. Moved initial stop 2 ticks closer prematurely on the 2nd trade out of discomfort..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              required
            />
          </div>

          <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 space-y-1.5">
            <label className="text-xs font-semibold text-amber-200 flex items-center justify-between">
              <span>3. What will I do better tomorrow? (Tomorrow Focus) <span className="text-rose-400">*</span></span>
              <span className="text-[10px] text-amber-400 uppercase font-mono">Displayed tomorrow morning</span>
            </label>
            <textarea
              rows={2}
              value={tomorrowFocus}
              onChange={(e) => setTomorrowFocus(e.target.value)}
              placeholder="e.g. Honor original stop without manual touch; let winners breathe to first pivot level."
              className="w-full rounded-lg border border-amber-800/80 bg-zinc-950 p-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-amber-600 focus:outline-none"
              required
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 px-5 py-2 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Save Daily Review & Complete Day
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  );
};
