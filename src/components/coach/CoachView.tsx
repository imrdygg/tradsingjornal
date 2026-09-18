import React, { useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, TrendingUp, BookOpenCheck, Target } from 'lucide-react';
import {
  DailyReview,
  Instrument,
  Setup,
  Trade,
  TradingDay,
} from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import {
  BriefResponse,
  CoachMode,
  TradeCritiqueResponse,
  WeeklyResponse,
} from '../../lib/ai/coach-prompts';
import { buildTradeFacts, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  CoachAction,
  CoachBullets,
  CoachCard,
  CoachErrorPanel,
  CoachFact,
  CoachLoading,
  CoachMotivation,
  money,
} from './coach-ui';
import { instrumentSymbol } from '../../lib/trading/instruments';

interface CoachViewProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
}

interface RequestState {
  loading: boolean;
  result: CoachResult | null;
}

const IDLE: RequestState = { loading: false, result: null };

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
    <Sparkles className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
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
      }),
    [trades, tradingDays, reviews, setups, instruments, todayTradeDate]
  );

  const [briefState, setBriefState] = useState<RequestState>(IDLE);
  const [weeklyState, setWeeklyState] = useState<RequestState>(IDLE);
  const [tradeState, setTradeState] = useState<RequestState>(IDLE);

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

  async function run(mode: CoachMode, setState: (s: RequestState) => void, trade?: Trade) {
    setState({ loading: true, result: null });
    const day = trade ? tradingDays.find((d) => d.id === trade.tradingDayId) : undefined;
    const facts =
      trade && mode === 'trade'
        ? buildTradeFacts(trade, { instruments, day, allTrades: trades })
        : undefined;
    const result = await requestCoach(mode, digest, facts);
    setState({ loading: false, result });
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

        <GenerateButton
          id="coach-brief-generate"
          label="Write today's brief"
          loadingLabel="Reading your journal…"
          loading={briefState.loading}
          onClick={() => run('brief', setBriefState)}
        />

        {briefState.loading && <CoachLoading label="Reading your plan, trades and reviews…" />}

        {briefState.result && !briefState.result.ok && (
          <CoachErrorPanel
            code={briefState.result.code}
            message={briefState.result.message}
            idSuffix="brief"
          />
        )}

        {briefState.result?.ok && (
          <div id="coach-brief-result" className="space-y-3 pt-1">
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
          </div>
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

            <GenerateButton
              id="coach-trade-generate"
              label="Critique this trade"
              loadingLabel="Reviewing the trade…"
              loading={tradeState.loading}
              disabled={!selectedTrade}
              onClick={() => selectedTrade && run('trade', setTradeState, selectedTrade)}
            />

            {tradeState.loading && <CoachLoading label="Reading the trade, its plan and your review…" />}

            {tradeState.result && !tradeState.result.ok && (
              <CoachErrorPanel
                code={tradeState.result.code}
                message={tradeState.result.message}
                idSuffix="trade"
              />
            )}

            {tradeState.result?.ok && (
              <div id="coach-trade-result" className="space-y-3 pt-1">
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
              </div>
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

        <GenerateButton
          id="coach-weekly-generate"
          label="Review my performance"
          loadingLabel="Finding the patterns…"
          loading={weeklyState.loading}
          onClick={() => run('weekly', setWeeklyState)}
        />

        {weeklyState.loading && <CoachLoading label="Comparing your days, rules and risk…" />}

        {weeklyState.result && !weeklyState.result.ok && (
          <CoachErrorPanel
            code={weeklyState.result.code}
            message={weeklyState.result.message}
            idSuffix="weekly"
          />
        )}

        {weeklyState.result?.ok && (
          <div id="coach-weekly-result" className="space-y-3 pt-1">
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
          </div>
        )}
      </CoachCard>
    </div>
  );
};
