import React from 'react';
import { CalendarRange } from 'lucide-react';
import {
  MIN_SETUP_WEEK_TRADES,
  type SetupDirection,
  type SetupVerdict,
  type SetupWeek,
  type SetupWeekRow,
} from '../../lib/analytics/setup-week';
import { RATE_STRENGTH_LABEL } from '../../lib/analytics/level-edge';
import { CoachCard, CoachFact, money } from './coach-ui';

/**
 * The last seven days, one setup at a time — and the weeks behind them, so the direction is
 * visible.
 *
 * All-time figures blend a setup's good month with its bad one; this is the window a trader
 * can still act on. One week of a two-setup journal is a handful of trades, though, so the
 * row also carries the same reading over the last few weeks: a single working week and a
 * setup finding its footing look identical in one number, and only the line tells them apart.
 *
 * It is deliberately arithmetic only — no AI call, no network — so the numbers the coach
 * writes about are on screen before it writes anything, and both the verdict and the
 * direction are the journal's own conclusions from the trader's own trades rather than the
 * model's.
 *
 * The two halves of each row are shown apart because they answer different questions. The
 * outcome says whether the setup earned its place in the week. The touch record says whether
 * the levels it trades at held — which explains an outcome, and can contradict one: a setup
 * whose levels held beautifully can still have lost money on sizing.
 */

/** The verdict, said in words, with the tone the rest of the tab uses for good and bad. */
const VERDICT: Record<SetupVerdict, { label: string; mark: string; chip: string }> = {
  working: {
    label: 'Working',
    mark: 'W',
    chip: 'border-emerald-800 bg-emerald-950/80 text-emerald-300',
  },
  'not-working': {
    label: 'Not working',
    mark: 'N',
    chip: 'border-rose-800/80 bg-rose-950/70 text-rose-300',
  },
  'too-thin': {
    label: `Fewer than ${MIN_SETUP_WEEK_TRADES} trades`,
    mark: '·',
    chip: 'border-zinc-700 bg-zinc-800 text-zinc-400',
  },
};

/**
 * The direction, said in words.
 *
 * `Steady` is the honest word for two judged weeks that paid the same — including two flat
 * ones, which is a setup going nowhere quietly rather than a setup improving.
 */
const DIRECTION: Record<SetupDirection, { label: string; chip: string }> = {
  improving: {
    label: 'Improving',
    chip: 'border-emerald-800 bg-emerald-950/80 text-emerald-300',
  },
  deteriorating: {
    label: 'Deteriorating',
    chip: 'border-rose-800/80 bg-rose-950/70 text-rose-300',
  },
  steady: {
    label: 'Steady',
    chip: 'border-zinc-700 bg-zinc-800 text-zinc-400',
  },
  'too-thin': {
    label: 'No direction yet',
    chip: 'border-zinc-800 bg-zinc-900 text-zinc-500',
  },
};

/** `2026-09-15` as `9/15`, short enough to sit under a week chip. */
function weekLabel(from: string): string {
  const parts = from.split('-');
  if (parts.length < 3) return from;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

/** The level-touch half of a row: counts first, and a rate only where one may be read. */
function touchLine(row: SetupWeekRow): string {
  const touch = row.touchRecord;
  if (!touch) return 'Not a level setup — no touch record to read.';
  if (touch.touches === 0) return 'No levels logged for it this week.';

  const counts =
    `${touch.decided} decided of ${touch.touches} touched · ` +
    `${touch.neverReturned} held, ${touch.returned} came back`;
  if (!touch.enoughData) return `${counts} · too thin to rate`;
  // The tier belongs on the rate for the same reason the counts do: a week of five touches and a
  // week of thirty can print the same percentage and mean different things.
  const tier = touch.strength ? ` (${RATE_STRENGTH_LABEL[touch.strength]})` : '';
  return `${counts} · ${touch.holdRate}% held${tier}`;
}

/** What one week of the strip is worth hovering: the window, its verdict and its P&L. */
function weekTitle(verdict: SetupVerdict, from: string, to: string, outcome: string): string {
  return `${from} → ${to} · ${VERDICT[verdict].label}${outcome ? ` · ${outcome}` : ''}`;
}

export const SetupWeekCard: React.FC<{ week: SetupWeek }> = ({ week }) => {
  const judged = week.rows.filter((row) => row.verdict !== 'too-thin');
  const workingCount = judged.filter((row) => row.verdict === 'working').length;

  return (
    <CoachCard id="coach-setup-week" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
          <CalendarRange className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Which setups are working
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Your last seven days, one setup at a time: what its own trades paid, and whether
            its levels held behind them.
            {week.trendWeeks > 1
              ? ` The strip under each one is the same reading over the previous ${
                  week.trendWeeks - 1
                } weeks, so one good week can be told from a setup on the way up.`
              : ''}{' '}
            Counted here, so the read below can be checked against it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <CoachFact label="Window" value={`${week.from} → ${week.to}`} />
        <CoachFact label="Days" value={`${week.days}`} />
        <CoachFact label="Weeks compared" value={`${week.trendWeeks}`} />
        <CoachFact label="Setups judged" value={`${judged.length} of ${week.rows.length}`} />
        <CoachFact label="Working" value={`${workingCount}`} />
      </div>

      {week.rows.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          Your playbook has no setups in it yet, so there is nothing to read a week against.
        </p>
      ) : (
        <ul id="coach-setup-week-rows" className="space-y-1.5">
          {week.rows.map((row) => (
            <li
              key={row.name}
              id={`coach-setup-week-${row.name.toLowerCase().replace(/\s+/g, '-')}`}
              data-verdict={row.verdict}
              data-direction={row.direction}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100">{row.name}</span>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${VERDICT[row.verdict].chip}`}
                >
                  {VERDICT[row.verdict].label}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-zinc-300">
                {row.hasOutcome
                  ? `${row.trades} closed · ${row.wins}W/${row.losses}L · ${money(
                      row.netPnL
                    )} · ${row.totalR}R total · ${row.avgR ?? 0}R avg`
                  : 'No closed trade in the window'}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{touchLine(row)}</p>

              {/*
                The trend, oldest week on the left and the window the read is about on the
                right, each chip coloured by the same verdict rule the row above uses. The
                direction is only shown when two weeks could be judged, because a slope drawn
                through one point is not a slope.
              */}
              <div id={`coach-setup-week-${row.name.toLowerCase().replace(/\s+/g, '-')}-trend`}
                className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-zinc-800/80 pt-2"
              >
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
                  Trend
                </span>
                {row.trend.map((point) => (
                  <span
                    key={point.from}
                    title={weekTitle(
                      point.verdict,
                      point.from,
                      point.to,
                      point.hasOutcome
                        ? `${point.trades} closed · ${money(point.netPnL)}`
                        : 'no closed trade'
                    )}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                      VERDICT[point.verdict].chip
                    } ${point.current ? 'ring-1 ring-zinc-600' : ''}`}
                  >
                    {weekLabel(point.from)} {VERDICT[point.verdict].mark}
                  </span>
                ))}
                <span
                  className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                    DIRECTION[row.direction].chip
                  }`}
                >
                  {DIRECTION[row.direction].label}
                </span>
              </div>
              {row.direction === 'too-thin' && row.judgedWeeks < 2 && row.hasOutcome && (
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  {row.judgedWeeks === 0
                    ? `No week in this stretch reached ${week.minTrades} closed trades, so there is no line to read yet.`
                    : 'Only one week in this stretch could be judged, so there is no direction to compare it to yet.'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {week.rows.length > 0 && !week.hasOutcome && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          No setup has a closed trade in this window, so none of them can be judged yet. The
          counts above are still yours — they just are not a result.
        </p>
      )}

      {week.rows.length > 0 && week.hasOutcome && judged.length === 0 && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Every setup is under {week.minTrades} closed trades in this window, so the week
          cannot say which is working. {week.minTrades} are needed before a verdict is named —
          below that a good week and a lucky one look identical.
        </p>
      )}
    </CoachCard>
  );
};
