import React from 'react';
import { Clock, Gauge, Radar, Timer } from 'lucide-react';
import type { BehaviorBucket, BehaviorFacts } from '../../lib/analytics/behavior';
import { CoachCard, CoachFact, money } from './coach-ui';

/**
 * The behavioural facts the coach reasons about, shown to the trader directly.
 *
 * These figures are computed from the trader's own timestamps and sizes — no AI, no
 * market data — and the coach is fed exactly these numbers. Showing them here is what
 * makes the coach's claims checkable instead of a black box: if the writing says the
 * trader keeps re-entering after a loss, this is the count it came from.
 *
 * Nothing is invented to fill space. A section with too small a sample says so.
 */

const BucketRows: React.FC<{ buckets: BehaviorBucket[]; emptyLabel: string }> = ({
  buckets,
  emptyLabel,
}) => {
  if (!buckets.length) {
    return <p className="text-[11px] text-zinc-500 italic">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1">
      {buckets.map((bucket) => (
        <li
          key={bucket.label}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]"
        >
          <span className="font-mono text-zinc-400">{bucket.label}</span>
          <span className="font-mono text-zinc-500">{bucket.trades} trades</span>
          <span
            className={`font-mono font-semibold ${
              bucket.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {money(bucket.netPnL)}
          </span>
          <span className="font-mono text-zinc-500">
            {bucket.avgR}R · {bucket.winRate}% win
          </span>
        </li>
      ))}
    </ul>
  );
};

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">{title}</span>
    </div>
    {children}
  </div>
);

export const BehaviorCard: React.FC<{ behavior: BehaviorFacts }> = ({ behavior }) => {
  const { timeOfDay, holdTime, afterLoss, sizeDiscipline, activity } = behavior;

  const hasAnything =
    timeOfDay.buckets.length > 0 ||
    holdTime.buckets.length > 0 ||
    afterLoss.afterLoss !== null ||
    activity.daysWithTrades > 0;

  return (
    <CoachCard id="coach-behavior-card" className="space-y-3.5">
      <div>
        <h2 className="text-sm font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Radar className="w-4 h-4 text-amber-400" />
          What your own timing and sizing show
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Read from the times and sizes you logged — nothing about the market. The coach
          gets these same numbers, so you can check any claim it makes.
        </p>
      </div>

      {!hasAnything ? (
        <p className="text-xs text-zinc-500 italic">
          Not enough logged trades with times yet to show a pattern. Nothing is reported
          until there is a real sample behind it.
        </p>
      ) : (
        <>
          {afterLoss.afterLoss && (
            <div
              id="coach-behavior-after-loss"
              className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3.5 py-3 space-y-2"
            >
              <span className="text-[10px] font-mono uppercase font-bold text-amber-400">
                Entries taken right after a loss
              </span>
              <p className="text-xs text-zinc-200 leading-relaxed">
                {afterLoss.afterLoss.trades} trade(s) were opened within{' '}
                {afterLoss.windowMinutes} minutes of a losing exit, across{' '}
                {afterLoss.daysAffected} day(s). They produced{' '}
                <span className="font-mono">{money(afterLoss.afterLoss.netPnL)}</span> at{' '}
                {afterLoss.afterLoss.avgR}R average and a {afterLoss.afterLoss.winRate}% win rate.
                {afterLoss.other && (
                  <>
                    {' '}
                    Everything else: <span className="font-mono">{afterLoss.other.trades}</span>{' '}
                    trade(s), <span className="font-mono">{money(afterLoss.other.netPnL)}</span> at{' '}
                    {afterLoss.other.avgR}R and a {afterLoss.other.winRate}% win rate.
                  </>
                )}
              </p>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <Section
              icon={<Clock className="w-3.5 h-3.5 text-zinc-400" />}
              title={`Entry hour (${behavior.timezone})`}
            >
              <BucketRows
                buckets={timeOfDay.buckets}
                emptyLabel="No hour has a real enough sample yet."
              />
              {timeOfDay.best && timeOfDay.worst && (
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Best {timeOfDay.best.label} ({money(timeOfDay.best.netPnL)}), worst{' '}
                  {timeOfDay.worst.label} ({money(timeOfDay.worst.netPnL)}). That is when you
                  traded, not when the market is good.
                </p>
              )}
            </Section>

            <Section
              icon={<Timer className="w-3.5 h-3.5 text-zinc-400" />}
              title="How long you held"
            >
              <BucketRows
                buckets={holdTime.buckets}
                emptyLabel="Not enough closed trades with both times recorded."
              />
              {holdTime.averageMinutes !== null && (
                <p className="text-[11px] text-zinc-500 font-mono">
                  Average hold {holdTime.averageMinutes} min
                </p>
              )}
            </Section>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <CoachFact
              label="Larger than the day's plan"
              value={
                sizeDiscipline.daysWithPlannedContracts === 0
                  ? 'no plan to compare'
                  : `${sizeDiscipline.tradesOverPlannedSize} trade(s)` +
                    (sizeDiscipline.overPlannedSizeAfterLoss > 0
                      ? ` · ${sizeDiscipline.overPlannedSizeAfterLoss} after a loss`
                      : '')
              }
            />
            <CoachFact
              label="Busiest day"
              value={
                activity.busiestDay
                  ? `${activity.busiestDay.trades} trades · ${money(activity.busiestDay.netPnL)}`
                  : 'not enough days'
              }
            />
          </div>

          {activity.busyAvgPnL !== null && activity.quietAvgPnL !== null && (
            <Section
              icon={<Gauge className="w-3.5 h-3.5 text-zinc-400" />}
              title="Busy days against quiet ones"
            >
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                Your median day is{' '}
                <span className="font-mono">{activity.medianTradesPerDay}</span> trade(s). The{' '}
                {activity.busyDays} busier day(s) averaged{' '}
                <span className="font-mono">{money(activity.busyAvgPnL)}</span>; the{' '}
                {activity.quietDays} quieter day(s) averaged{' '}
                <span className="font-mono">{money(activity.quietAvgPnL)}</span>.
              </p>
            </Section>
          )}
        </>
      )}

      {(timeOfDay.unreadableEntries > 0 || holdTime.unreadable > 0) && (
        <p className="text-[10px] text-zinc-600 leading-relaxed border-t border-zinc-800/80 pt-2">
          {timeOfDay.unreadableEntries + holdTime.unreadable} trade(s) have a missing or
          unreadable time, so they are not counted in the timing figures above.
        </p>
      )}
    </CoachCard>
  );
};
