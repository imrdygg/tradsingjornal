import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  BookOpenCheck,
  Activity,
  CalendarRange,
} from 'lucide-react';
import {
  ChartSearch,
  DailyReview,
  Instrument,
  LevelTouch,
  SessionExtreme,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type {
  BriefResponse,
  CoachExtras,
  CoachMode,
  ExtremeCallResponse,
  ExtremeResponse,
  FormResponse,
  SetupsResponse,
  WeeklyResponse,
} from '../../lib/ai/coach-types';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachGenerateButton,
  CoachLoading,
  CoachMotivation,
  CoachResultPanel,
  money,
} from './coach-ui';
import { AskCoachCard } from './AskCoachCard';
import { ApproachAlertCard } from './ApproachAlertCard';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { BehaviorCard } from './BehaviorCard';
import { RecentFormCard } from './RecentFormCard';
import { ExtremeReadCard } from './ExtremeReadCard';
import { ExtremeCallCard } from './ExtremeCallCard';
import { ChartMatchCard } from '../trades/ChartMatchCard';
import { SetupWeekCard } from './SetupWeekCard';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { formatTimestamp } from '../../lib/storage/date-utils';

interface CoachViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  /**
   * Today's own day, so the approach alert can read the levels the trader set for today and
   * the contract they set them for.
   */
  todayTradingDay: TradingDay;
  todayTradeDate: string;
  timezone: string;
  /** The account drawdown the trader has agreed to, so the read can weigh risk capacity. */
  maxDrawdown?: number | null;
  /** The level-touch log, so the coach can find the break-and-run edge. */
  levelTouches: LevelTouch[];
  /** The session-extreme log, so the coach can read where the highs and lows printed. */
  sessionExtremes: SessionExtreme[];
  /**
   * Opens the detail view for a trade the picture search matched. Omitted leaves the matches
   * readable but not clickable, which is what a caller with no detail view wants.
   */
  onViewTrade?: (trade: Trade) => void;
  /** The saved picture searches, so the search card can show its own history here. */
  chartSearches?: ChartSearch[];
  /** Records one completed picture search. */
  onSaveChartSearch?: (search: ChartSearch) => void;
  /** Removes one saved picture search. */
  onDeleteChartSearch?: (id: string) => void;
  /** The account a saved search belongs to. */
  userId?: string;
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

export const CoachView: React.FC<CoachViewProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradingDay,
  todayTradeDate,
  timezone,
  maxDrawdown,
  levelTouches,
  sessionExtremes,
  onViewTrade,
  chartSearches,
  onSaveChartSearch,
  onDeleteChartSearch,
  userId,
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
        levelTouches,
        sessionExtremes,
      }),
    [
      trades,
      tradingDays,
      reviews,
      setups,
      instruments,
      todayTradeDate,
      timezone,
      maxDrawdown,
      levelTouches,
      sessionExtremes,
    ]
  );

  const [briefState, setBriefState] = useState<RequestState>(IDLE);
  const [weeklyState, setWeeklyState] = useState<RequestState>(IDLE);
  const [formState, setFormState] = useState<RequestState>(IDLE);
  const [setupsState, setSetupsState] = useState<RequestState>(IDLE);
  const [extremesState, setExtremesState] = useState<RequestState>(IDLE);
  const [callState, setCallState] = useState<RequestState>(IDLE);

  /**
   * Runs one of the reads this tab keeps.
   *
   * All of them are answered from the journal digest alone — the two windows of trades, the
   * day's plan, the level-touch record and the week read from both — so nothing else travels
   * with the request.
   */
  async function run(
    mode: CoachMode,
    setState: React.Dispatch<React.SetStateAction<RequestState>>,
    extras?: CoachExtras
  ) {
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    const result = await requestCoach(mode, digest, undefined, extras);

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

  /** The week read, once one has come back. Null keeps the block from rendering at all. */
  const setupsRead =
    setupsState.result?.ok ? (setupsState.result.data as SetupsResponse) : null;
  /** The clock read, once one has come back. Null keeps the result block from rendering. */
  const extremesRead =
    extremesState.result?.ok ? (extremesState.result.data as ExtremeResponse) : null;
  /** The call, once one has come back. */
  const extremeCall = callState.result?.ok ? (callState.result.data as ExtremeCallResponse) : null;

  /**
   * The instrument the call is about.
   *
   * The one whose levels were logged most recently, because that is the log the trader is
   * working in right now; the plan's instrument is only a fallback for a journal that has
   * logged nothing yet.
   */
  const callSymbol = useMemo(() => {
    const newest = [...sessionExtremes].sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    )[0];
    if (newest?.symbol) return newest.symbol;
    const planned = (todayTradingDay.primaryInstrument ?? '').trim();
    if (planned) return instrumentSymbol(instruments, planned);
    return instruments[0]?.symbol ?? 'MES';
  }, [sessionExtremes, todayTradingDay, instruments]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-400" />
          Coach
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Writes about your process using only what you logged, so every claim it makes is
          traceable to your own records. The one number it reads from outside is your
          instrument's live price, and only to measure how far price is from your own levels.
        </p>
      </div>

      {/* Which of today's levels price is closing on. */}
      <ApproachAlertCard
        levels={todayTradingDay.importantLevels ?? []}
        symbol={instrumentSymbol(instruments, todayTradingDay.primaryInstrument)}
        timezone={timezone}
      />

      {/*
        The week, one setup at a time, before any writing about it.

        Deliberately the deterministic half of the pair below: the verdict on each setup is
        computed from the trader's own trades, so the read that follows can be checked
        against the numbers rather than believed.
      */}
      <SetupWeekCard week={digest.setupWeek} />

      {/* ------------------------------------------------------------------ */}
      {/* The week read                                                       */}
      {/* ------------------------------------------------------------------ */}
      <CoachCard className="space-y-3.5">
        <SectionHeader
          icon={<CalendarRange className="w-4 h-4 text-amber-400" />}
          title="Weekly setup read"
          description="Which of your setups earned its place this week, which way its last few weeks point, and the level record sitting behind each one."
        />

        {!setupsState.result && (
          <CoachGenerateButton
            id="coach-setups-generate"
            label={setupsState.failure ? 'Try again' : 'Read my week by setup'}
            loadingLabel="Reading the week…"
            loading={setupsState.loading}
            onClick={() => run('setups', setSetupsState)}
          />
        )}

        {setupsState.loading && (
          <CoachLoading
            label="Reading your setups against their levels…"
            steps={COACH_WAIT_STEPS('the last seven days')}
          />
        )}

        {setupsState.failure && (
          <CoachErrorPanel
            code={setupsState.failure.code}
            message={setupsState.failure.message}
            idSuffix="setups"
          />
        )}

        {setupsRead && (
          <CoachResultPanel
            id="coach-setups-result"
            heading="Result"
            meta={
              setupsState.writtenAt
                ? `written ${formatTimestamp(setupsState.writtenAt, timezone)}`
                : undefined
            }
            resultKey={setupsState.writtenAt}
            busy={setupsState.loading}
            onRegenerate={() => run('setups', setSetupsState)}
            regenerateLabel="Regenerate the week read"
          >
            <p className="text-sm font-semibold text-zinc-100 leading-snug">{setupsRead.headline}</p>
            <p className="text-xs text-zinc-300 leading-relaxed">{setupsRead.weekRead}</p>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                  Working
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={setupsRead.working}
                    tone="good"
                    emptyLabel="No setup was judged working this week."
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-rose-400">
                  Not working
                </span>
                <div className="mt-1.5">
                  <CoachBullets
                    items={setupsRead.notWorking}
                    tone="bad"
                    emptyLabel="No setup was judged not working this week."
                  />
                </div>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                What the levels did
              </span>
              <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">{setupsRead.levelsRead}</p>
            </div>

            {/*
              The week's own instruction, in two halves. Both are empty when the week judged
              no setup either way, which is a finding rather than a gap: the card above says
              which week it was, and that is what the trader needs to know.
            */}
            {(setupsRead.leanOn || setupsRead.shelve) && (
              <div className="grid sm:grid-cols-2 gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                    Lean on
                  </span>
                  <p className="mt-1 text-xs text-zinc-200">
                    {setupsRead.leanOn || 'nothing this week'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                    Shelve
                  </span>
                  <p className="mt-1 text-xs text-zinc-200">
                    {setupsRead.shelve || 'nothing this week'}
                  </p>
                </div>
              </div>
            )}

            <CoachAction label="Next week" text={setupsRead.nextWeek} />
            <CoachMotivation text={setupsRead.motivation} />
          </CoachResultPanel>
        )}
      </CoachCard>

      {/*
        Where the session extremes printed, read from the trader's own log.

        Placed straight after the weekly setup read because it is the same kind of thing: a
        deterministic count from their own records, with the coach's writing as an explanation
        of it rather than a replacement for it.
      */}
      <ExtremeReadCard
        read={digest.extremeRead}
        timezone={timezone}
        loading={extremesState.loading}
        failure={extremesState.failure}
        answer={extremesRead}
        writtenAt={extremesState.writtenAt}
        onRun={() => run('extremes', setExtremesState)}
      />

      {/*
        The one card that states a direction, and only because the trader asked for it.

        It sits after the clock read on purpose: the counts it leans on are directly above it,
        so the call can be judged against the same numbers the coach was handed.
      */}
      <ExtremeCallCard
        read={digest.extremeRead}
        symbol={callSymbol}
        timezone={timezone}
        loading={callState.loading}
        failure={callState.failure}
        answer={extremeCall}
        writtenAt={callState.writtenAt}
        onRun={() => run('extremecall', setCallState, { instrument: callSymbol })}
      />

      {/*
        The picture search, beside the other reads.

        Same card the trade log carries, so a chart can be chased back to the trades that
        look like it without leaving the coach, and a matched row opens the trade from here
        too.
      */}
      <ChartMatchCard
        trades={trades}
        tradingDays={tradingDays}
        reviews={reviews}
        setups={setups}
        instruments={instruments}
        todayTradeDate={todayTradeDate}
        timezone={timezone}
        maxDrawdown={maxDrawdown}
        levelTouches={levelTouches}
        onViewTrade={onViewTrade}
        chartSearches={chartSearches}
        onSaveChartSearch={onSaveChartSearch}
        onDeleteChartSearch={onDeleteChartSearch}
        userId={userId}
      />

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
          <CoachGenerateButton
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

      <AskCoachCard
        trades={trades}
        tradingDays={tradingDays}
        reviews={reviews}
        setups={setups}
        instruments={instruments}
        todayTradeDate={todayTradeDate}
        timezone={timezone}
        maxDrawdown={maxDrawdown}
        levelTouches={levelTouches}
        title="Ask about my trading"
        description="Put your own question to the coach. It answers from your records — your figures, or nothing."
      />

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
          <CoachGenerateButton
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
          <CoachGenerateButton
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
