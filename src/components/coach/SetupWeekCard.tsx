import React from 'react';
import { CalendarRange } from 'lucide-react';
import {
  MIN_SETUP_WEEK_TRADES,
  type SetupVerdict,
  type SetupWeek,
  type SetupWeekRow,
} from '../../lib/analytics/setup-week';
import { CoachCard, CoachFact, money } from './coach-ui';

/**
 * The last seven days, one setup at a time.
 *
 * All-time figures blend a setup's good month with its bad one; this is the window a trader
 * can still act on. It is deliberately arithmetic only — no AI call, no network — so the
 * numbers the coach writes about are on screen before it writes anything, and the verdict on
 * each setup is the journal's own conclusion from the trader's own trades rather than the
 * model's.
 *
 * The two halves of each row are shown apart because they answer different questions. The
 * outcome says whether the setup earned its place in the week. The touch record says whether
 * the levels it trades at held — which explains an outcome, and can contradict one: a setup
 * whose levels held beautifully can still have lost money on sizing.
 */

/** The verdict, said in words, with the tone the rest of the tab uses for good and bad. */
const VERDICT: Record<SetupVerdict, { label: string; chip: string }> = {
  working: {
    label: 'Working',
    chip: 'border-emerald-800 bg-emerald-950/80 text-emerald-300',
  },
  'not-working': {
    label: 'Not working',
    chip: 'border-rose-800/80 bg-rose-950/70 text-rose-300',
  },
  'too-thin': {
    label: `Fewer than ${MIN_SETUP_WEEK_TRADES} trades`,
    chip: 'border-zinc-700 bg-zinc-800 text-zinc-400',
  },
};

/** The level-touch half of a row: counts first, and a rate only where one may be read. */
function touchLine(row: SetupWeekRow): string {
  const touch = row.touchRecord;
  if (!touch) return 'Not a level setup — no touch record to read.';
  if (touch.touches === 0) return 'No levels logged for it this week.';

  const counts =
    `${touch.decided} decided of ${touch.touches} touched · ` +
    `${touch.neverReturned} held, ${touch.returned} came back`;
  if (!touch.enoughData) return `${counts} · too thin to rate`;
  return `${counts} · ${touch.holdRate}% held`;
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
            its levels held behind them. Counted here, so the read below can be checked
            against it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <CoachFact label="Window" value={`${week.from} → ${week.to}`} />
        <CoachFact label="Days" value={`${week.days}`} />
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
