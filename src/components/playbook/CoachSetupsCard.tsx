import React, { useMemo, useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { CoachPlan, DailyReview, Instrument, LevelTouch, Setup, Trade, TradingDay } from '../../types';
import { buildJournalDigest } from '../../lib/ai/journal-digest';
import type { LearnResponse, LearnedSetup } from '../../lib/ai/coach-types';
import { newSetupDrafts } from '../../lib/ai/setup-drafts';
import { CoachErrorCode, CoachResult, requestCoach } from '../../lib/ai/coach-client';
import {
  MAX_COACH_IMAGES,
  MAX_COACH_IMAGE_TOTAL_CHARS,
  isCoachImageDataUrl,
} from '../../lib/ai/coach-images';
import { instrumentSymbol } from '../../lib/trading/instruments';
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
} from '../coach/coach-ui';
import { COACH_WAIT_STEPS } from '../common/AiThinking';
import { formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The coach's own setups.
 *
 * The trader asked for the one thing a stats table cannot do: read their actual trades — the
 * entries, the reasons, the chart they screenshotted at the moment they pulled the trigger —
 * and name the patterns they repeat without ever having labelled them. That is this card.
 *
 * Everything it proposes lands in the playbook straight away, badged as an AI draft: the
 * trader asked for drafts they can edit or delete rather than a panel to approve, so there
 * is exactly one decision here — whether to ask — and the output is ordinary playbook
 * material from then on. Names that already exist are skipped, so asking twice cannot
 * quietly fill the catalog with near-duplicates.
 *
 * The read is fed by two things and nothing else: the journal digest, and up to a handful of
 * screenshots pulled from the trader's own closed trades. The images are data URLs the
 * browser already holds, so nothing is uploaded and nothing leaves the device except through
 * this one request.
 */
export interface CoachSetupsCardProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  setups: Setup[];
  instruments: Instrument[];
  todayTradeDate: string;
  timezone: string;
  maxDrawdown?: number | null;
  levelTouches?: LevelTouch[];
  /**
   * The coach's own plans with the trader's grades and feedback, when there are any.
   *
   * Carried into the digest so the read learns from what the trader keeps telling the coach
   * about how it plans; the guardrails keep a grade from being read as market data.
   */
  coachPlans?: CoachPlan[];
  /** Writes the drafts into the playbook. Called once per read, with only the new ones. */
  onAddSetups: (setups: Setup[]) => void;
}

interface LearnState {
  loading: boolean;
  /** The last answer that arrived, kept while a retry runs so nothing is blanked. */
  result: CoachResult | null;
  failure: { code: CoachErrorCode; message: string } | null;
  writtenAt?: string;
  /** Names of the drafts this read wrote into the playbook. */
  added: string[];
}

const IDLE: LearnState = { loading: false, result: null, failure: null, added: [] };

/**
 * Picks the screenshots worth sending, newest trade first.
 *
 * One image per trade: the entry is what the trader asked the coach to learn to read, and
 * several pictures of the same trade would spend the whole batch on one setup. Anything the
 * server would reject — a video's cloud URL, an oversized screenshot — is skipped here so the
 * request is never sent with something that will be silently dropped.
 */
function collectImages(trades: Trade[], instruments: Instrument[]): { label: string; dataUrl: string }[] {
  const out: { label: string; dataUrl: string }[] = [];
  let total = 0;

  const newestFirst = [...trades]
    .filter((trade) => trade.status === 'closed')
    .sort((a, b) =>
      (b.exitTime ?? b.entryTime ?? b.updatedAt).localeCompare(
        a.exitTime ?? a.entryTime ?? a.updatedAt
      )
    );

  for (const trade of newestFirst) {
    if (out.length >= MAX_COACH_IMAGES) break;
    const image = (trade.images ?? []).find((candidate) => isCoachImageDataUrl(candidate));
    if (!image) continue;
    if (total + image.length > MAX_COACH_IMAGE_TOTAL_CHARS) break;
    total += image.length;
    out.push({
      label:
        `${trade.entryTime ? trade.entryTime.slice(0, 10) : 'date not recorded'} ` +
        `${instrumentSymbol(instruments, trade.instrumentId)} ${trade.direction.toUpperCase()}` +
        (trade.setupName ? ` logged as ${trade.setupName}` : '') +
        `, ${trade.rMultiple}R`,
      dataUrl: image,
    });
  }
  return out;
}

/** How much the record supports a proposal, said plainly rather than implied. */
function confidenceTone(confidence: LearnedSetup['confidence']): string {
  if (confidence === 'high') return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
  if (confidence === 'medium') return 'bg-zinc-800 text-zinc-300 border-zinc-700';
  return 'bg-amber-950/60 text-amber-300/90 border-amber-900/70';
}

export const CoachSetupsCard: React.FC<CoachSetupsCardProps> = ({
  trades,
  tradingDays,
  reviews,
  setups,
  instruments,
  todayTradeDate,
  timezone,
  maxDrawdown,
  levelTouches,
  coachPlans,
  onAddSetups,
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
        timezone,
        maxDrawdown,
        levelTouches,
        coachPlans,
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
      coachPlans,
    ]
  );

  const images = useMemo(() => collectImages(trades, instruments), [trades, instruments]);
  const [state, setState] = useState<LearnState>(IDLE);

  async function run() {
    setState((prev) => ({ ...prev, loading: true, failure: null }));
    const result = await requestCoach('learn', digest, undefined, { images });

    if (result.ok) {
      const drafts = newSetupDrafts((result.data as LearnResponse).setups, setups);
      if (drafts.length) onAddSetups(drafts);
      setState({
        loading: false,
        result,
        failure: null,
        writtenAt: new Date().toISOString(),
        added: drafts.map((draft) => draft.name),
      });
      return;
    }
    setState((prev) => ({
      ...prev,
      loading: false,
      failure: { code: result.code, message: result.message },
    }));
  }

  const answer = state.result?.ok ? (state.result.data as LearnResponse) : null;
  const closedTrades = digest.dataSufficiency.closedTrades;
  const tooThin = closedTrades < 5;

  return (
    <CoachCard id="playbook-coach-setups" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
          <Wand2 className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Setups your coach found in your journal
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Your coach reads your logged trades and the chart you attached to each entry, then
            writes down the setups it thinks are actually yours. They land in your playbook as
            AI drafts you can edit or delete.
          </p>
        </div>
      </div>

      {/* What the read is standing on, shown before it runs so it can be checked. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CoachFact label="Closed trades" value={`${closedTrades}`} />
        <CoachFact label="Entry charts sent" value={`${images.length}`} />
        <CoachFact label="Setups you keep" value={`${setups.length}`} />
        <CoachFact
          label="AI drafts so far"
          value={`${setups.filter((setup) => Boolean(setup.origin)).length}`}
        />
      </div>

      {tooThin && (
        <p className="text-[11px] text-amber-300/90 leading-relaxed">
          {closedTrades === 0
            ? 'No closed trades logged yet. Log a few — with the chart you entered on — and your coach will have something real to read.'
            : `Only ${closedTrades} closed trade(s) so far. A pattern needs several, so expect the coach to say the record is still too thin rather than name a setup.`}
        </p>
      )}

      {images.length === 0 && closedTrades > 0 && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          None of your recent entries has a chart screenshot attached, so the read will use your
          written reasons and numbers only. Attach the chart to a trade and the coach can look
          at the entry itself.
        </p>
      )}

      {!answer && (
        <CoachGenerateButton
          id="playbook-coach-generate"
          label={state.failure ? 'Try again' : 'Find my setups'}
          loadingLabel="Reading your trades and entries…"
          loading={state.loading}
          onClick={run}
        />
      )}

      {state.loading && (
        <CoachLoading label="Reading your trades and entries…" steps={COACH_WAIT_STEPS('trades')} />
      )}

      {state.failure && (
        <CoachErrorPanel
          code={state.failure.code}
          message={state.failure.message}
          idSuffix="learn"
        />
      )}

      {answer && (
        <CoachResultPanel
          id="playbook-coach-result"
          heading="Result"
          meta={state.writtenAt ? `written ${formatTimestamp(state.writtenAt, timezone)}` : undefined}
          resultKey={state.writtenAt}
          busy={state.loading}
          onRegenerate={run}
          regenerateLabel="Find again"
        >
          <p className="text-sm font-semibold text-zinc-100 leading-snug">{answer.headline}</p>

          {state.added.length > 0 ? (
            <p className="text-[11px] text-emerald-300/90 leading-relaxed">
              Added to your playbook as AI drafts:{' '}
              <span className="font-semibold">{state.added.join(', ')}</span>. They are badged
              “AI draft” and behave like any other setup from here — rename, edit or delete them
              freely.
            </p>
          ) : answer.setups.length > 0 ? (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Every setup it named is already in your playbook, so nothing new was added.
            </p>
          ) : null}

          {answer.setups.length > 0 && (
            <div className="space-y-2">
              {answer.setups.map((setup, index) => (
                <div
                  key={`${index}-${setup.name}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-zinc-200">{setup.name}</span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase font-bold ${confidenceTone(
                        setup.confidence
                      )}`}
                    >
                      {setup.confidence} confidence
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed">{setup.description}</p>
                  {setup.entryRules.length > 0 && (
                    <ul className="space-y-1 list-disc list-inside text-zinc-400 leading-relaxed">
                      {setup.entryRules.map((rule, ruleIndex) => (
                        <li key={ruleIndex} className="text-[11px]">
                          {rule}
                        </li>
                      ))}
                    </ul>
                  )}
                  {setup.evidence && (
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Evidence: {setup.evidence}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-zinc-300 leading-relaxed">{answer.method}</p>

          {answer.notInJournal && (
            <div>
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Not in your journal
              </span>
              <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{answer.notInJournal}</p>
            </div>
          )}

          {answer.setups.length === 0 && (
            <CoachBullets
              items={[]}
              tone="neutral"
              emptyLabel="The coach did not name a setup this time — the record is too thin, or every pattern it saw is one you already keep."
            />
          )}

          <CoachAction label="Next step" text={answer.nextStep} />
          <CoachMotivation text={answer.motivation} />
        </CoachResultPanel>
      )}
    </CoachCard>
  );
};
