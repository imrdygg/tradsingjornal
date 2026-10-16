import React, { useMemo, useState } from 'react';
import { AlertCircle, BarChart3, CandlestickChart, Info, Search, Target } from 'lucide-react';
import type { Trade, TradingObservation } from '../../types';
import { MEMORY_MIN_OUTCOME_SAMPLE, formatMemoryRate } from '../../lib/memory/outcomes';
import {
  buildSetupResearch,
  describeSeenVersusTaken,
  type MemorySetupResearch,
} from '../../lib/memory/research';

/**
 * The research read: what the record says about a setup, seen against taken.
 *
 * This screen exists because the journal can answer a question a trade log cannot. A trade log
 * holds the setups that were executed, so the only question it can answer is *"what happened when I
 * traded this"* — which is precisely the wrong sample when the trader's own selection is the thing
 * under examination. The observations hold the setups that were *seen*, traded or not, so the
 * comparison this screen puts side by side is the honest one: forty sightings beside three trades.
 *
 * Three presentation rules are load-bearing rather than cosmetic:
 *
 *   1. **Every rate is printed with its denominator.** "60%" is not a finding; "3 of 5 recorded
 *      readings" is. The counts are shown at full precision (they are always knowable) while the
 *      percentage is the part that gets withheld, and it is withheld through
 *      `formatMemoryRate` — one place decides how "not enough cases" reads, so it can never be
 *      rendered as a zero somewhere the percentages were formatted by hand.
 *   2. **The two populations are visually separate.** Market behaviour sits under a heading that
 *      names the sightings it is over; execution sits under one that names the trades. They are
 *      never summed, averaged, or placed in one column under one heading.
 *   3. **A gap is never drawn as a zero.** A trade taken with no result reads "no result recorded",
 *      a sighting with nothing written down reads "nothing written down", and a rate that cannot be
 *      computed reads "not enough cases". A screen full of zeroes is a screen claiming a losing run
 *      nobody had.
 *
 * Nothing here forecasts. It reports what was written down about what already happened, and the
 * per-setup lines that say what the numbers cannot support are shown rather than hidden behind a
 * tooltip, because they are the part a reader is most likely to skip past.
 */

export interface MemoryResearchViewProps {
  observations: TradingObservation[];
  trades: Trade[];
  /** Opens a sighting's own record. Optional: the dashboard stands alone without it. */
  onOpenObservation?: (observationId: string) => void;
  /** Opens the linked trade. Optional, for the same reason. */
  onViewTrade?: (trade: Trade) => void;
}

const Card: React.FC<{
  id?: string;
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ id, title, icon, subtitle, children }) => (
  <section
    id={id}
    className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5"
  >
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold tracking-tight text-zinc-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{subtitle}</p>}
        <div className="mt-3">{children}</div>
      </div>
    </div>
  </section>
);

/**
 * The day a sighting is filed under, taken straight off the stored instant.
 *
 * Deliberately NOT run through a locale formatter: the record is stored as ISO 8601 and its day is
 * already settled, whereas a formatted date can shift by one depending on the reader's timezone and
 * would then disagree with the day the trader filed the sighting under. Slicing cannot drift.
 */
function formatDay(iso: string | undefined): string | null {
  if (!iso) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

/** One figure, always with the denominator it is over. */
const Figure: React.FC<{
  label: string;
  value: string;
  detail: string;
  /** When true the figure is a withheld rate rather than a count. */
  withheld?: boolean;
  id?: string;
}> = ({ label, value, detail, withheld = false, id }) => (
  <div id={id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-2">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
    <div
      className={`mt-0.5 text-sm font-bold tabular-nums ${
        withheld ? 'text-zinc-500 italic' : 'text-zinc-100'
      }`}
    >
      {value}
    </div>
    <div className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{detail}</div>
  </div>
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
    <Info className="mt-0.5 h-3 w-3 shrink-0 text-zinc-600" />
    <span className="min-w-0">{children}</span>
  </p>
);

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * The trade log's win-rate denominator: wins plus losses, exactly as `summarizeMemoryOutcomes`
 * defines it — a scratch is a result and is deliberately not in it, and an open trade has no result
 * yet.
 */
function takenLogDecided(entry: MemorySetupResearch): number {
  return entry.tradeLog.outcomes.wins + entry.tradeLog.outcomes.losses;
}

/** The flags that say a setup's window is not its whole history, or that a count is not reachable. */
const SetupFlags: React.FC<{ entry: MemorySetupResearch }> = ({ entry }) => (
  <div className="mt-2 flex flex-wrap gap-1.5">
    {entry.truncated && (
      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
        cut off — older sightings not counted
      </span>
    )}
    {entry.taken > 0 && entry.takenWithoutResult > 0 && (
      <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
        {entry.takenWithoutResult} of {entry.taken} {plural(entry.taken, 'trade', 'trades')} with no
        result yet
      </span>
    )}
    {entry.untrustedTime > 0 && (
      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
        {entry.untrustedTime} {plural(entry.untrustedTime, 'time', 'times')} unsure — cannot be placed
        in a replay
      </span>
    )}
    {entry.searchable < entry.seen && (
      <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
        {entry.searchable} of {entry.seen} searchable
      </span>
    )}
  </div>
);

/** One setup: the sightings it appeared in, and what the trader did about them. */
const SetupRow: React.FC<{
  entry: MemorySetupResearch;
  onOpenObservation?: (observationId: string) => void;
}> = ({ entry, onOpenObservation }) => {
  const { outcomes } = entry;
  const first = formatDay(entry.firstSeenAt);
  const last = formatDay(entry.lastSeenAt);

  return (
    <div
      id={`memory-research-setup-${entry.setupKey}`}
      data-seen={entry.seen}
      data-taken={entry.taken}
      data-thin-sample={entry.thinSample}
      className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-bold text-zinc-100">{entry.setupName}</h3>
          {entry.setupCategory && (
            <span className="text-[10px] text-zinc-500">{entry.setupCategory}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Search className="h-3 w-3 text-zinc-500" />
            seen <span className="font-bold tabular-nums text-zinc-200">{entry.seen}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Target className="h-3 w-3 text-zinc-500" />
            taken <span className="font-bold tabular-nums text-zinc-200">{entry.taken}</span>
          </span>
        </div>
      </div>

      {onOpenObservation && entry.newestObservationId ? (
        <button
          type="button"
          id={`memory-research-open-${entry.setupKey}`}
          onClick={() => {
            if (entry.newestObservationId) onOpenObservation(entry.newestObservationId);
          }}
          className="mt-1 text-[10px] font-semibold text-sky-400 hover:text-sky-300"
        >
          Open the most recent sighting
        </button>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-300">
        {describeSeenVersusTaken(entry)}
      </p>

      {(first || last) && (
        <p className="mt-1 text-[10px] text-zinc-500">
          {first && last
            ? first === last
              ? `Recorded on ${first}.`
              : `Recorded from ${first} to ${last}.`
            : `Recorded on ${last ?? first}.`}
        </p>
      )}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Figure
          id={`memory-research-market-${entry.setupKey}`}
          label="What price did"
          value={
            outcomes.continuationRate === null
              ? formatMemoryRate(null)
              : `${outcomes.continuationRate}% continued`
          }
          detail={
            `${outcomes.continuations} continued and ${outcomes.reversals} reversed out of ` +
            `${outcomes.marketDecided} recorded ${plural(outcomes.marketDecided, 'reading', 'readings')}` +
            `${outcomes.marketUnknown > 0 ? `, ${outcomes.marketUnknown} with nothing written down` : ''}` +
            ` — over the ${entry.seen} ${plural(entry.seen, 'sighting', 'sightings')}.`
          }
          withheld={outcomes.continuationRate === null}
        />
        <Figure
          id={`memory-research-execution-${entry.setupKey}`}
          label="Your execution"
          value={entry.taken === 0 ? 'no trades taken' : formatMemoryRate(outcomes.winRate)}
          detail={
            entry.taken === 0
              ? `No trade was taken under any of the ${entry.seen} ${plural(
                  entry.seen,
                  'sighting',
                  'sightings'
                )}, so there is nothing to report here.`
              : `${outcomes.wins} won and ${outcomes.losses} lost out of ${
                  outcomes.wins + outcomes.losses
                } decided ${plural(outcomes.wins + outcomes.losses, 'trade', 'trades')}` +
                `${outcomes.breakeven > 0 ? `, ${outcomes.breakeven} broke even` : ''}` +
                `${outcomes.openTrades > 0 ? `, ${outcomes.openTrades} still open` : ''}` +
                ` — over the ${entry.taken} ${plural(entry.taken, 'trade', 'trades')} taken.`
          }
          withheld={entry.taken > 0 && outcomes.winRate === null}
        />
        {/*
          The journal's own trades for this setup, which the sightings above cannot see on their
          own: a setup traded thirty times and photographed twice would otherwise report a win rate
          over two trades.

          Rendered only when the log is WIDER than the sighting record. When the two agree it
          would print the same figures twice, and a number shown twice reads as two measurements.
        */}
        {entry.tradeLog.trades > entry.taken && (
          <Figure
            id={`memory-research-trade-log-${entry.setupKey}`}
            label="Your trade log"
            value={formatMemoryRate(entry.tradeLog.outcomes.winRate)}
            detail={
              `${entry.tradeLog.outcomes.wins} won and ${entry.tradeLog.outcomes.losses} lost out of ${
                entry.tradeLog.outcomes.wins + entry.tradeLog.outcomes.losses
              } decided ${plural(
                entry.tradeLog.outcomes.wins + entry.tradeLog.outcomes.losses,
                'trade',
                'trades'
              )}` +
              `${entry.tradeLog.outcomes.breakeven > 0 ? `, ${entry.tradeLog.outcomes.breakeven} broke even` : ''}` +
              `${entry.tradeLog.outcomes.openTrades > 0 ? `, ${entry.tradeLog.outcomes.openTrades} still open` : ''}` +
              ` — over the ${entry.tradeLog.trades} ${plural(
                entry.tradeLog.trades,
                'trade',
                'trades'
              )} logged under this setup` +
              `${
                entry.tradeLog.untracked > 0
                  ? `, of which ${entry.tradeLog.untracked} ${plural(
                      entry.tradeLog.untracked,
                      'has',
                      'have'
                    )} no sighting recorded`
                  : ''
              }. Against the ${entry.taken} ${plural(entry.taken, 'trade', 'trades')} a sighting points at.`
            }
            withheld={entry.tradeLog.outcomes.winRate === null}
          />
        )}
      </div>

      <SetupFlags entry={entry} />

      {/*
        One note per withheld rate, each naming its OWN denominator. `thinSample` cannot drive a
        single sentence: it is true when either rate was withheld, and a setup with thirty recorded
        readings and one taken trade would otherwise be told that its thirty readings are too few.
      */}
      {outcomes.continuationRate === null && (
        <p className="mt-2 text-[10px] leading-relaxed text-amber-300/90">
          {outcomes.marketDecided} recorded{' '}
          {plural(outcomes.marketDecided, 'reading', 'readings')} is below the {entry.minSample} a
          market percentage needs, so the counts above are shown and the percentage is not. That is
          arithmetic noise rather than a finding either way.
        </p>
      )}
      {entry.taken > 0 && outcomes.winRate === null && (
        <p className="mt-2 text-[10px] leading-relaxed text-amber-300/90">
          {outcomes.wins + outcomes.losses} decided{' '}
          {plural(outcomes.wins + outcomes.losses, 'trade', 'trades')} out of the {entry.taken} taken
          is below the {entry.minSample} a win rate needs, so the counts above are shown and the
          percentage is not.
        </p>
      )}
      {entry.tradeLog.trades > entry.taken && entry.tradeLog.outcomes.winRate === null && (
        <p className="mt-2 text-[10px] leading-relaxed text-amber-300/90">
          {takenLogDecided(entry)} decided{' '}
          {plural(takenLogDecided(entry), 'trade', 'trades')} in the trade log is below the{' '}
          {entry.minSample} a win rate needs, so the log counts above are shown and the percentage is
          not.
        </p>
      )}

      {outcomes.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-zinc-800 pt-2">
          {outcomes.warnings.map((warning) => (
            <li key={warning} className="text-[10px] leading-relaxed text-zinc-500">
              {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const WINDOW_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'All history', value: undefined },
  { label: 'Last 20', value: 20 },
  { label: 'Last 10', value: 10 },
];

export const MemoryResearchView: React.FC<MemoryResearchViewProps> = ({
  observations,
  trades,
  onOpenObservation,
  onViewTrade,
}) => {
  const [windowSize, setWindowSize] = useState<number | undefined>(undefined);

  const research = useMemo(
    () => buildSetupResearch({ observations, trades, limitPerSetup: windowSize }),
    [observations, trades, windowSize]
  );

  const { totals, setups, warnings } = research;
  const tradeById = useMemo(() => {
    const map = new Map<string, Trade>();
    for (const trade of trades) map.set(trade.id, trade);
    return map;
  }, [trades]);

  if (totals.observations === 0) {
    return (
      <Card
        id="memory-research"
        title="Seen against taken"
        icon={<BarChart3 className="h-3.5 w-3.5" />}
      >
        {/*
         * Ided like the other empty states so "this screen has nothing to show" is one stable hook
         * a test can assert on, rather than a sentence that has to be kept in step with the copy.
         */}
        <p id="memory-research-empty" className="text-xs leading-relaxed text-zinc-400">
          There is no history to read yet. This screen compares how often each setup was <em>seen</em>{' '}
          with how often it was <em>taken</em>, and the first of those comes from recorded sightings
          rather than from executed trades — which is what makes the comparison worth having. Record
          a sighting in the library and it appears here.
        </p>
        {/*
          The record's own warning is rendered here too, because the sentence above is about the
          SIGHTINGS: a journal holding trades and no sightings at all would otherwise be told that
          nothing has been recorded, which is false of the trades it holds.
        */}
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="text-[10px] leading-relaxed text-zinc-500">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  const tradedSetupCount = setups.filter((entry) => entry.taken > 0).length;

  return (
    <div className="space-y-3">
      <Card
        id="memory-research"
        title="Seen against taken"
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        subtitle={
          'What your own record says about each setup. Sightings come from observations, including ' +
          'the ones you never traded, and each setup also carries the whole trade log under its name ' +
          '— so a setup traded far more often than it was photographed is not summarised by the two ' +
          'trades a sighting happens to point at. Every count below is over one population or the ' +
          'other, never both.'
        }
      >
        {/* The denominator of every market figure on this screen, stated once at the top. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure
            id="memory-research-total-observations"
            label="Sightings"
            value={String(totals.observations)}
            detail={`${totals.grouped} grouped under a setup${
              totals.unlabelled > 0 ? `, ${totals.unlabelled} with no setup named` : ''
            }.`}
          />
          <Figure
            id="memory-research-total-taken"
            label="Trades taken"
            value={String(totals.taken)}
            detail={`Across ${tradedSetupCount} of ${totals.setups} ${plural(
              totals.setups,
              'setup',
              'setups'
            )}. A sighting is not a trade.`}
          />
          <Figure
            id="memory-research-total-outcomes"
            label="With a reading"
            value={String(totals.withRecordedOutcome)}
            detail="Sightings with something written down about what price did afterwards."
          />
          <Figure
            id="memory-research-total-searchable"
            label="Reachable by search"
            value={String(totals.searchable)}
            detail="Sightings with an indexed chart from before the decision. Only these can be found by similarity."
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Window
          </span>
          {WINDOW_OPTIONS.map((option) => {
            const active = option.value === windowSize;
            return (
              <button
                key={option.label}
                id={`memory-research-window-${option.value ?? 'all'}`}
                type="button"
                onClick={() => setWindowSize(option.value)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition ${
                  active
                    ? 'border-sky-500/40 bg-sky-500/20 text-sky-200'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {warnings.length > 0 && (
          <ul id="memory-research-warnings" className="mt-3 space-y-1.5">
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="text-[10px] leading-relaxed text-amber-200/90">{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {setups.length === 0 ? (
        <Card
          id="memory-research-empty"
          title="Nothing grouped yet"
          icon={<AlertCircle className="h-3.5 w-3.5" />}
        >
          <p className="text-xs leading-relaxed text-zinc-400">
            {totals.unlabelled} {plural(totals.unlabelled, 'sighting names', 'sightings name')} no
            setup, so there is nothing to compare yet. Naming the setup on a sighting is what puts it
            in a group here — the name is only ever used for grouping, never as evidence about the
            setup.
          </p>
        </Card>
      ) : (
        <Card
          id="memory-research-setups"
          title={`By setup (${setups.length})`}
          icon={<CandlestickChart className="h-3.5 w-3.5" />}
          subtitle={`Ranked by how many sightings are recorded, most first. A rate needs ${MEMORY_MIN_OUTCOME_SAMPLE} recorded cases before it is a percentage rather than a count.`}
        >
          <div className="space-y-2">
            {setups.map((entry) => (
              <SetupRow
                key={entry.setupKey}
                entry={entry}
                onOpenObservation={onOpenObservation}
              />
            ))}
          </div>
        </Card>
      )}

      {onViewTrade && totals.taken > 0 && (
        <Card
          id="memory-research-trades"
          title="Open a trade from this record"
          icon={<Target className="h-3.5 w-3.5" />}
        >
          <div className="flex flex-wrap gap-1.5">
            {observations.flatMap((observation) => {
              const tradeId = observation.linkedTradeId;
              if (!tradeId) return [];
              const trade = tradeById.get(tradeId);
              if (!trade) return [];
              const day = formatDay(observation.observedAt);
              return [
                <button
                  key={trade.id}
                  id={`memory-research-trade-${trade.id}`}
                  type="button"
                  onClick={() => onViewTrade(trade)}
                  className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-300 hover:text-zinc-100"
                >
                  {`${observation.symbol}${day ? ` · ${day}` : ''}`}
                </button>,
              ];
            })}
          </div>
        </Card>
      )}

      <Note>
        Everything on this screen is a count of what you wrote down, read over the population named
        beside it: market figures over sightings, execution figures over trades. None of it is a
        forecast, and a percentage here describes the cases already recorded — it says nothing about
        what a setup will do next.
      </Note>
    </div>
  );
};
