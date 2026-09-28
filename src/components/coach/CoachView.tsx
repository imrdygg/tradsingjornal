import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  BookOpenCheck,
  Target,
  Activity,
  MessageSquare,
} from 'lucide-react';
import {
  DailyReview,
  Instrument,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type {
  AskResponse,
  BriefResponse,
  CoachExtras,
  CoachMode,
  FormResponse,
  TradeCritiqueResponse,
  WeeklyResponse,
} from '../../lib/ai/coach-types';
import {
  buildTradeFacts,
  CoachErrorCode,
  CoachResult,
  requestCoach,
} from '../../lib/ai/coach-client';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
  money,
} from './coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { BehaviorCard } from './BehaviorCard';
import { RecentFormCard } from './RecentFormCard';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { formatTimestamp } from '../../lib/storage/date-utils';

interface CoachViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  /** The account drawdown the trader has agreed to, so the read can weigh risk capacity. */
  maxDrawdown?: number | null;
}

interface RequestState {
  loading: boolean;
  /**
   * The last answer that actually arrived. Kept while a retry runs, so regenerating
   * never blanks the page: a failed or slow second attempt must not destroy the first
   * answer the trader was reading.
   */
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  /** Set on every successful run; labels the output and re-expands a folded panel. */
  writtenAt?: string;
}

const IDLE: RequestState = { loading: false, result: null, failure: null };

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="flex items-start gap-2.5">
    <div className="mt-0.5">{icon}</div>
    <div>
      <h2 className="text-sm font-bold text-zinc-100 tracking-tight">{title}</h2>
      <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
    </div>
  </div>
);

const GenerateButton: React.FC<{
  id: string;
  label: string;
  loadingLabel: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}> = ({ id, label, loadingLabel, loading, disabled, onClick }) => (
  <button
    id={id}
    onClick={onClick}
    disabled={loading || disabled}
    className="flex items-center gap-2 rounded-xl bg-amber-500/90 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-950 px-4 py-2 text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
  >
    <Sparkles
      className={`w-4 h-4 ${loading ? 'ai-button-spark' : ''}`}
    />
    {loading ? loadingLabel : label}
  </button>
);

export const CoachView: React.FC<CoachViewProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
  maxDrawdown,
}) => {
  const digest = useMemo(
    () =>
      buildJournalDigest({
        trades,
        tradingDays,
        reviews,
        setups,
        instruments,
        todayTradeDate,
        maxDrawdown,
        timezone,
      }),
    [trades, tradingDays, reviews, setups, instruments, todayTradeDate, timezone, maxDrawdown]
  );

  const [briefState, setBriefState] = useState<RequestState>(IDLE);
  const [weeklyState, setWeeklyState] = useState<RequestState>(IDLE);
  const [tradeState, setTradeState] = useState<RequestState>(IDLE);
  const [formState, setFormState] = useState<RequestState>(IDLE);
  const [askState, setAskState] = useState<RequestState>(IDLE);
  // Kept as the trader typed it. It is deliberately not cleared when an answer lands:
  // the usual next move is to sharpen the question, not to start from a blank box.
  const [askQuestion, setAskQuestion] = useState('');

  // Closed trades, newest first, for the critique picker.
  const criticableTrades = useMemo(
    () =>
      trades
        .filter((t) => t.status === 'closed')
        .sort((a, b) =>
          (b.exitTime ?? b.entryTime ?? b.updatedAt).localeCompare(
            a.exitTime ?? a.entryTime ?? a.updatedAt
          )
        )
        .slice(0, 25),
    [trades]
  );

  const [selectedTradeId, setSelectedTradeId] = useState<string>('');
  const effectiveTradeId = selectedTradeId || criticableTrades[0]?.id || '';
  const selectedTrade = criticableTrades.find((t) => t.id === effectiveTradeId);

  async function run(
    mode: CoachMode,
    setState: React.Dispatch<React.SetStateAction<RequestState>>,
    trade?: Trade,
    extras?: CoachExtras
  ) {
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    const day = trade ? tradingDays.find((d) => d.id === trade.tradingDayId) : undefined;
    const facts =
      trade && mode === 'trade'
        ? buildTradeFacts(trade, { instruments, day, allTrades: trades })
        : undefined;
    const result = await requestCoach(mode, digest, facts, extras);

    if (result.ok) {
      setState((prev) => ({
        ...prev,
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
      }));
      return;
    }

    // The error is shown alongside whatever was already written, not instead of it.
    setState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const planCaveat = digest.dataSufficiency.caveats;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-400" />
          Coach
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Reviews your process using only what you logged. It cannot see the market — no prices,
          levels, news or predictions — so every claim it makes is traceable to your own records.
        </p>
      </div>

      {/* What the coach is allowed to know. Shown up front so the advice can be judged. */}
      <CoachCard className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
            What the coach can see
          </span>
          <span
            id="coach-evidence-level"
            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
              digest.dataSufficiency.hasEnoughForPatterns
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                : 'bg-amber-950/80 text-amber-300 border-amber-800'
            }`}
          >
            {digest.dataSufficiency.hasEnoughForPatterns ? 'Enough to see patterns' : 'Thin evidence'}
          </span>
        </div>
        <p className="text-xs text-zinc-300">
          {digest.dataSufficiency.daysLogged} day(s) logged ·{' '}
          {digest.dataSufficiency.closedTrades} closed trade(s) ·{' '}
          {digest.dataSufficiency.reviewedDays} daily review(s) ·{' '}
          {digest.dataSufficiency.reviewedTrades} trade review(s)
        </p>
        {planCaveat.length > 0 && (
          <ul className="space-y-1 pt-1 border-t border-zinc-800/80">
            {planCaveat.map((caveat, index) => (
              <li key={index} className="text-[11px] text-zinc-500 leading-relaxed">
                · {caveat}
              </li>
            ))}
          </ul>
        )}
      </CoachCard>

      {/*
        The same behavioural numbers the prompts are built from. Deterministic and
        free to render, so the trader can check the coach's reasoning rather than
        take its word for it.
      */}
      <BehaviorCard behavior={digest.behavior} />

      {/* The two windows the form read is built from, before any AI call. */}
      <RecentFormCard form={digest.recentForm} />

      {/* ------------------------------------------------------------------ */}
      {/* Recent form read                                                    */}
      {/* ------------------------------------------------------------------ */}
      <CoachCard className="space-y-3.5">
        <SectionHeader
          icon={<Activity className="w-4 h-4 text-amber-400" />}
          title="Recent form"
          description="What changed between your most recent window and the one before it — and what did not."
        />

        {!formState.result && (
          <GenerateButton
            id="coach-form-generate"
            label={formState.failure ? 'Try again' : 'Read my recent form'}
            loadingLabel="Comparing the two windows…"
            loading={formState.loading}
            onClick={() => run('form', setFormState)}
          />
        )}

        {formState.loading && (
          <CoachLoading
            label="Comparing your recent trades with the ones before them…"
            steps={COACH_WAIT_STEPS('two windows')}
          />
        )}

        {formState.failure && (
          <CoachErrorPanel
            code={formState.failure.code}
            message={formState.failure.message}
            idSuffix="form"
          />
        )}

        {formState.result?.ok && (
          <CoachResultPanel
            id="coach-form-result"
            heading="Result"
            meta={
              formState.writtenAt
                ? `written ${formatTimestamp(formState.writtenAt, timezone)}`
                : undefined
            }
            resultKey={formState.writtenAt}
            busy={formState.loading}
            onRegenerate={() => run('form', setFormState)}
            regenerateLabel="Regenerate read"
          >
            <p className="text-sm font-semibold text-zinc-100 leading-snug">
              {(formState.result.data as FormResponse).headline}
            </p>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {(formState.result.data as FormResponse).trendRead}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                  Improved
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={(formState.result.data as FormResponse).improved}
                    tone="good"
                    emptyLabel="Nothing measurable has improved in the recent window."
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                  Declined
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={(formState.result.data as FormResponse).declined}
                    tone="bad"
                    emptyLabel="Nothing has got worse in the recent window."
                  />
                </div>
              </div>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Holding steady
              </span>
              <div className="mt-1.5">
                <CoachBullets
                  items={(formState.result.data as FormResponse).holding}
                  tone="neutral"
                  emptyLabel="Nothing logged as holding steady across both windows."
                />
              </div>
            </div>
            <CoachAction
              label="Next step"
              text={(formState.result.data as FormResponse).nextStep}
            />
            <CoachMotivation text={(formState.result.data as FormResponse).motivation} />
          </CoachResultPanel>
        )}
      </CoachCard>

      {/* ------------------------------------------------------------------ */}
      {/* Ask about my own trading                                            */}
      {/* ------------------------------------------------------------------ */}
      {/*
        The one coach surface the trader drives. It is still the same coach and the
        same records: the question text is fenced into the prompt as a question rather
        than an instruction, and the guardrails are untouched, so asking about the
        market gets an honest "I cannot see it" instead of a price.
      */}
      <CoachCard className="space-y-3.5">
        <SectionHeader
          icon={<MessageSquare className="w-4 h-4 text-amber-400" />}
          title="Ask about my trading"
          description="Put your own question to the coach. It answers from your records — your figures, or nothing."
        />

        <label htmlFor="coach-ask-input" className="sr-only">
          Your question about your trading
        </label>
        <textarea
          id="coach-ask-input"
          value={askQuestion}
          onChange={(e) => setAskQuestion(e.target.value)}
          rows={3}
          // Matches the ceiling the endpoint applies, so the box cannot hold text the
          // coach would never be shown.
          maxLength={800}
          placeholder="e.g. Why do I keep giving back the morning?"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none resize-y"
        />

        {!askState.result && (
          <GenerateButton
            id="coach-ask-generate"
            label={askState.failure ? 'Try again' : 'Ask the coach'}
            loadingLabel="Answering your question…"
            loading={askState.loading}
            disabled={!askQuestion.trim()}
            onClick={() => run('ask', setAskState, undefined, { question: askQuestion.trim() })}
          />
        )}

        {askState.loading && (
          <CoachLoading
            label="Searching your own records for the answer…"
            steps={COACH_WAIT_STEPS('trades you asked about')}
          />
        )}

        {askState.failure && (
          <CoachErrorPanel
            code={askState.failure.code}
            message={askState.failure.message}
            idSuffix="ask"
          />
        )}

        {askState.result?.ok && (
          <CoachResultPanel
            id="coach-ask-result"
            heading="Answer"
            meta={
              askState.writtenAt
                ? `written ${formatTimestamp(askState.writtenAt, timezone)}`
                : undefined
            }
            resultKey={askState.writtenAt}
            busy={askState.loading}
            // Reads the box as it stands right now, so editing the question and asking
            // again asks the edited one rather than repeating the first.
            onRegenerate={() =>
              run('ask', setAskState, undefined, { question: askQuestion.trim() })
            }
            regenerateLabel="Ask again"
          >
            <p className="text-sm font-semibold text-zinc-100 leading-snug">
              {(askState.result.data as AskResponse).headline}
            </p>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {(askState.result.data as AskResponse).answer}
            </p>
            <div>
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                What it leaned on
              </span>
              <div className="mt-1.5">
                <CoachBullets
                  items={(askState.result.data as AskResponse).evidence}
                  tone="neutral"
                  emptyLabel="It answered without citing a single figure, so treat it with suspicion."
                />
              </div>
            </div>
            {(askState.result.data as AskResponse).notInJournal && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 px-3.5 py-3">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  Not in your journal
                </span>
                <p className="mt-1 text-xs text-zinc-300 leading-relaxed">
                  {(askState.result.data as AskResponse).notInJournal}
                </p>
              </div>
            )}
            {(askState.result.data as AskResponse).nextStep && (
              <CoachAction
                label="Next step"
                text={(askState.result.data as AskResponse).nextStep}
              />
            )}
          </CoachResultPanel>
        )}
      </CoachCard>

      {/* ------------------------------------------------------------------ */}
      {/* Daily brief                                                         */}
      {/* ------------------------------------------------------------------ */}
      <CoachCard className="space-y-3.5">
        <SectionHeader
          icon={<BookOpenCheck className="w-4 h-4 text-amber-400" />}
          title="Daily brief"
          description="Where you actually stand against your own plan, and the one thing to focus on."
        />

        <div id="coach-brief-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <CoachFact label="Net P&L" value={money(digest.overall.netPnL)} />
          <CoachFact label="Avg R" value={`${digest.overall.avgR}R`} />
          <CoachFact label="Win rate" value={`${digest.overall.winRate}%`} />
          <CoachFact
            label="Discipline"
            value={
              digest.discipline.reviewedDays
                ? `${digest.discipline.avgScore}/100`
                : 'no reviews'
            }
          />
        </div>

        {digest.recentDays[0] && (
          <p className="text-xs text-zinc-400">
            Most recent session <span className="font-mono text-zinc-300">{digest.recentDays[0].date}</span>:{' '}
            <span
              className={
                digest.recentDays[0].netPnL >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'
              }
            >
              {money(digest.recentDays[0].netPnL)}
            </span>{' '}
            over {digest.recentDays[0].trades} trade(s)
            {digest.recentDays[0].rulesBroken.length > 0
              ? ` · broke: ${digest.recentDays[0].rulesBroken.join('; ')}`
              : ''}
          </p>
        )}

        {/*
          Once there is output, the panel header owns regeneration — right next to the
          writing it replaces, and still reachable when the panel is folded. Showing this
          button as well would put two "Regenerate" controls a line apart.
        */}
        {!briefState.result && (
          <GenerateButton
            id="coach-brief-generate"
            label={briefState.failure ? 'Try again' : "Write today's brief"}
            loadingLabel="Reading your journal…"
            loading={briefState.loading}
            onClick={() => run('brief', setBriefState)}
          />
        )}

        {briefState.loading && (
          <CoachLoading label="Reading your plan, trades and reviews…" steps={COACH_WAIT_STEPS('plan')} />
        )}

        {briefState.failure && (
          <CoachErrorPanel
            code={briefState.failure.code}
            message={briefState.failure.message}
            idSuffix="brief"
          />
        )}

        {briefState.result?.ok && (
          <CoachResultPanel
            id="coach-brief-result"
            heading="Result"
            meta={
              briefState.writtenAt
                ? `written ${formatTimestamp(briefState.writtenAt, timezone)}`
                : undefined
            }
            resultKey={briefState.writtenAt}
            busy={briefState.loading}
            onRegenerate={() => run('brief', setBriefState)}
            regenerateLabel="Regenerate brief"
          >
            <p className="text-sm font-semibold text-zinc-100 leading-snug">
              {(briefState.result.data as BriefResponse).headline}
            </p>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {(briefState.result.data as BriefResponse).yesterday}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                  What went right
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={(briefState.result.data as BriefResponse).wins}
                    tone="good"
                    emptyLabel="Nothing logged that went well yet."
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                  What to fix
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={(briefState.result.data as BriefResponse).fixes}
                    tone="bad"
                    emptyLabel="Nothing to correct in the data."
                  />
                </div>
              </div>
            </div>
            <CoachAction
              label="Today's focus"
              text={(briefState.result.data as BriefResponse).todayFocus}
            />
            <CoachMotivation text={(briefState.result.data as BriefResponse).motivation} />
          </CoachResultPanel>
        )}
      </CoachCard>

      {/* ------------------------------------------------------------------ */}
      {/* Trade critique                                                      */}
      {/* ------------------------------------------------------------------ */}
      <CoachCard className="space-y-3.5">
        <SectionHeader
          icon={<Target className="w-4 h-4 text-amber-400" />}
          title="Critique a trade"
          description="Picks apart the decision and the execution separately, using your own review answers."
        />

        {criticableTrades.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">
            No closed trades yet. Close a trade and the coach can review how you executed it.
          </p>
        ) : (
          <>
            <select
              id="coach-trade-select"
              value={effectiveTradeId}
              onChange={(e) => {
                setSelectedTradeId(e.target.value);
                setTradeState(IDLE);
              }}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200"
            >
              {criticableTrades.map((trade) => (
                <option key={trade.id} value={trade.id}>
                  {instrumentSymbol(instruments, trade.instrumentId)} {trade.direction}{' '}
                  {trade.contracts} · {trade.entryPrice}
                  {trade.exitPrice !== undefined ? ` → ${trade.exitPrice}` : ''} ·{' '}
                  {trade.rMultiple}R · {trade.status}
                </option>
              ))}
            </select>

            {selectedTrade && (
              <div id="coach-trade-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <CoachFact
                  label="Instrument"
                  value={instrumentSymbol(instruments, selectedTrade.instrumentId)}
                />
                <CoachFact label="R multiple" value={`${selectedTrade.rMultiple}R`} />
                <CoachFact label="Initial risk" value={money(selectedTrade.initialRisk)} />
                <CoachFact
                  label="Outcome"
                  value={money(selectedTrade.netPnL ?? selectedTrade.grossPnL)}
                />
              </div>
            )}

            {!tradeState.result && (
              <GenerateButton
                id="coach-trade-generate"
                label={tradeState.failure ? 'Try again' : 'Critique this trade'}
                loadingLabel="Reviewing the trade…"
                loading={tradeState.loading}
                disabled={!selectedTrade}
                onClick={() => selectedTrade && run('trade', setTradeState, selectedTrade)}
              />
            )}

            {tradeState.loading && (
              <CoachLoading
                label="Reading the trade, its plan and your review…"
                steps={COACH_WAIT_STEPS('trade')}
              />
            )}

            {tradeState.failure && (
              <CoachErrorPanel
                code={tradeState.failure.code}
                message={tradeState.failure.message}
                idSuffix="trade"
              />
            )}

            {tradeState.result?.ok && (
              <CoachResultPanel
                id="coach-trade-result"
                heading="Result"
                meta={
                  tradeState.writtenAt
                    ? `written ${formatTimestamp(tradeState.writtenAt, timezone)}`
                    : undefined
                }
                resultKey={tradeState.writtenAt}
                busy={tradeState.loading}
                onRegenerate={() => selectedTrade && run('trade', setTradeState, selectedTrade)}
                regenerateLabel="Regenerate critique"
              >
                <div className="flex items-start gap-3">
                  <span className="shrink-0 rounded-lg border border-amber-800 bg-amber-950/50 text-amber-300 font-mono text-sm font-bold px-2.5 py-1">
                    {(tradeState.result.data as TradeCritiqueResponse).grade}
                  </span>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {(tradeState.result.data as TradeCritiqueResponse).verdict}
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                      Done well
                    </span>
                    <div className="mt-1.5">
                      <CoachBullets
                        items={(tradeState.result.data as TradeCritiqueResponse).didWell}
                        tone="good"
                        emptyLabel="Nothing positive recorded on this trade."
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                      What it cost you
                    </span>
                    <div className="mt-1.5">
                      <CoachBullets
                        items={(tradeState.result.data as TradeCritiqueResponse).costYou}
                        tone="bad"
                        emptyLabel="Nothing logged that cost you here."
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                    Rules your review says you broke
                  </span>
                  <div className="mt-1.5">
                    <CoachBullets
                      items={(tradeState.result.data as TradeCritiqueResponse).rulesBroken}
                      tone="bad"
                      emptyLabel="None — your review shows you followed every applicable rule."
                    />
                  </div>
                </div>
                <CoachAction
                  label="Next time"
                  text={(tradeState.result.data as TradeCritiqueResponse).nextTime}
                />
              </CoachResultPanel>
            )}
          </>
        )}
      </CoachCard>

      {/* ------------------------------------------------------------------ */}
      {/* Weekly review                                                       */}
      {/* ------------------------------------------------------------------ */}
      <CoachCard className="space-y-3.5">
        <SectionHeader
          icon={<TrendingUp className="w-4 h-4 text-amber-400" />}
          title="Performance review"
          description="What your numbers across recent days actually show, including anything uncomfortable."
        />

        <div id="coach-weekly-facts" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <CoachFact label="Total R" value={`${digest.overall.totalR}R`} />
          <CoachFact label="Expectancy" value={`${digest.overall.expectancyR}R`} />
          <CoachFact
            label="Avg win / loss"
            value={`${digest.overall.avgWinR}R / ${digest.overall.avgLossR}R`}
          />
          <CoachFact
            label="Plan breaches"
            value={`${digest.planAdherence.daysExceededLossLimit} day(s)`}
          />
        </div>

        {digest.discipline.failedRules.length > 0 && (
          <p className="text-xs text-zinc-400">
            Rules most often broken:{' '}
            <span className="text-zinc-300">
              {digest.discipline.failedRules
                .slice(0, 3)
                .map((f) => `${f.rule} (${f.times}x)`)
                .join(', ')}
            </span>
          </p>
        )}

        {!weeklyState.result && (
          <GenerateButton
            id="coach-weekly-generate"
            label={weeklyState.failure ? 'Try again' : 'Review my performance'}
            loadingLabel="Finding the patterns…"
            loading={weeklyState.loading}
            onClick={() => run('weekly', setWeeklyState)}
          />
        )}

        {weeklyState.loading && (
          <CoachLoading label="Comparing your days, rules and risk…" steps={COACH_WAIT_STEPS('weeks')} />
        )}

        {weeklyState.failure && (
          <CoachErrorPanel
            code={weeklyState.failure.code}
            message={weeklyState.failure.message}
            idSuffix="weekly"
          />
        )}

        {weeklyState.result?.ok && (
          <CoachResultPanel
            id="coach-weekly-result"
            heading="Result"
            meta={
              weeklyState.writtenAt
                ? `written ${formatTimestamp(weeklyState.writtenAt, timezone)}`
                : undefined
            }
            resultKey={weeklyState.writtenAt}
            busy={weeklyState.loading}
            onRegenerate={() => run('weekly', setWeeklyState)}
            regenerateLabel="Regenerate review"
          >
            <p className="text-sm font-semibold text-zinc-100 leading-snug">
              {(weeklyState.result.data as WeeklyResponse).headline}
            </p>

            {(weeklyState.result.data as WeeklyResponse).patterns.length > 0 && (
              <div className="space-y-2">
                {(weeklyState.result.data as WeeklyResponse).patterns.map((pattern, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5"
                  >
                    <p className="text-xs text-zinc-200 leading-relaxed">{pattern.observation}</p>
                    {pattern.evidence && (
                      <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                        Evidence: {pattern.evidence}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  Discipline
                </span>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {(weeklyState.result.data as WeeklyResponse).disciplineRead}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                  Risk
                </span>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {(weeklyState.result.data as WeeklyResponse).riskRead}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 px-3.5 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-[10px] font-mono uppercase font-bold text-rose-400">
                  Biggest leak
                </span>
              </div>
              <p className="text-xs text-zinc-200 leading-relaxed">
                {(weeklyState.result.data as WeeklyResponse).biggestLeak}
              </p>
            </div>

            <CoachAction
              label="Change one thing"
              text={(weeklyState.result.data as WeeklyResponse).oneChange}
            />

            <CoachMotivation text={(weeklyState.result.data as WeeklyResponse).motivation} />
          </CoachResultPanel>
        )}
      </CoachCard>
    </div>
  );
};
