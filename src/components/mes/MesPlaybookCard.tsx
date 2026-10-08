import React, { useMemo, useState } from 'react';
import { BookOpen, Download, Upload } from 'lucide-react';
import {
  bridgedLevelLabel,
  bridgedLevelFigures,
  type BridgedLevel,
} from '../../lib/mes/playbook-bridge';
import { DEFAULT_MES_TIMEFRAME } from '../../lib/mes/constants';
import { formatPct100, formatShortDate } from '../../lib/mes/utils';
import { useMesJournal } from './mes-store';
import { Badge, EmptyState, GradeChip, SectionCard } from './mes-ui';

/**
 * The way across to the Playbook tab, and back.
 *
 * The trader writes their indicator's lines down twice over — once as marked levels in the
 * Playbook, before any of them is tested, and once here with what price did at each — and this
 * is where the two records hand lines to each other. Both directions are one-way and happen only
 * when asked: a line crosses once and the two copies are then independent, so editing a level
 * here never quietly rewrites the marked line it came from. That is the honest shape. A level's
 * tallies are the trader's own account of what happened, and a record that could be rewritten
 * from the other side could change a figure they had already read and acted on.
 *
 * Both buttons are idempotent. The destination skips what it already holds, keyed the way its own
 * store keys its writes — so pressing either one twice, or from both tabs, only ever adds what
 * was genuinely new, and the counts on the screen say what the last press actually did.
 *
 * The screen is deliberately blunt about what does NOT cross. Going to the Playbook goes the
 * lines alone: the playbook builds its own rates from its touch log, so a stored hold/break count
 * would either invent a test that was never logged or double-count one that was — and the pattern
 * tag has no field to land in. Both stay here, where the trader recorded them.
 */
export const MesPlaybookCard: React.FC = () => {
  const { records, bridge } = useMesJournal();
  const [status, setStatus] = useState<string | null>(null);

  /**
   * Read on demand rather than held in state.
   *
   * Both counts are answered from storage at the moment the tab renders, and `records` is a
   * dependency on purpose: logging a level on the Daily Log or importing a backup moves what is
   * waiting to cross, and the counts have to move with it. The bridge itself never changes
   * identity, so this stays cheap.
   */
  const incoming = useMemo(() => (bridge ? bridge.incoming() : null), [bridge, records]);
  const outgoingCount = useMemo(() => (bridge ? bridge.outgoing() : 0), [bridge, records]);

  if (!bridge || !incoming) return null;

  const handlePull = () => {
    const added = bridge.accept(incoming.levels);
    const parts = [`Added ${added} line${added === 1 ? '' : 's'} from the Playbook.`];
    if (incoming.skipped > 0) {
      parts.push(
        `${incoming.skipped} ${incoming.skipped === 1 ? 'was' : 'were'} already logged here.`
      );
    }
    if (incoming.untaggedCharts > 0) {
      parts.push(
        `${incoming.untaggedCharts} had no chart recorded and ` +
          `${
            incoming.untaggedCharts === 1 ? 'was' : 'were'
          } filed on ${DEFAULT_MES_TIMEFRAME} — correct the chart on the All Levels screen if that is wrong.`
      );
    }
    setStatus(parts.join(' '));
  };

  const handlePush = () => {
    const { added, skipped } = bridge.send();
    setStatus(
      `Marked ${added} line${added === 1 ? '' : 's'} in the Playbook` +
        (skipped > 0
          ? `; ${skipped} ${skipped === 1 ? 'was' : 'were'} already marked there.`
          : '.')
    );
  };

  const waiting = incoming.levels.slice(0, 6);
  const nothingWaiting = incoming.levels.length === 0 && outgoingCount === 0;

  return (
    <SectionCard
      title="Playbook"
      subtitle="The marked levels on your Playbook tab, and the lines between the two records."
      icon={<BookOpen className="h-4 w-4 text-violet-400" />}
    >
      {nothingWaiting ? (
        <EmptyState>
          Nothing is waiting either way. Mark lines on the Playbook tab&apos;s marked-levels card
          and they can be logged here; log levels here and they can be marked there.
        </EmptyState>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-52 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-lg font-bold leading-none text-zinc-100">
                {incoming.levels.length}
              </span>
              <span className="text-xs font-semibold text-zinc-200">
                line{incoming.levels.length === 1 ? '' : 's'} in the Playbook the tracker does not
                hold yet
              </span>
            </div>
            <button
              id="mes-pull-playbook"
              type="button"
              onClick={handlePull}
              disabled={incoming.levels.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-900"
            >
              <Download className="h-3.5 w-3.5" />
              Add them to the tracker
            </button>
            <p className="text-[11px] leading-snug text-zinc-500">
              Every test already logged against a line comes with it: a touch price returned from
              counts as held, one that never came back counts as broke, and a touch still being
              watched counts as a test that settled neither way. Where you said the line came from
              travels with it too, folded into the note field — the only free-text field a level
              has here.
            </p>
          </div>

          <div className="min-w-52 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-lg font-bold leading-none text-zinc-100">
                {outgoingCount}
              </span>
              <span className="text-xs font-semibold text-zinc-200">
                of the tracker&apos;s lines are not marked in the Playbook yet
              </span>
            </div>
            <button
              id="mes-push-playbook"
              type="button"
              onClick={handlePush}
              disabled={outgoingCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-zinc-900"
            >
              <Upload className="h-3.5 w-3.5" />
              Mark them in the Playbook
            </button>
            <p className="text-[11px] leading-snug text-zinc-500">
              Sends the lines alone. Your hold and break tallies and the pattern tag stay here —
              the Playbook builds its own rates from its touch log, so carrying a count across
              would invent a test that was never logged.
            </p>
          </div>
        </div>
      )}

      {status && (
        <p
          id="mes-playbook-status"
          className="mt-3 rounded-lg border border-zinc-700/60 bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-300"
        >
          {status}
        </p>
      )}

      {waiting.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
            Waiting to come across
          </h3>
          {waiting.map((level) => (
            <PreviewRow key={previewKey(level)} level={level} />
          ))}
          {incoming.levels.length > waiting.length && (
            <p className="text-[11px] text-zinc-500">
              and {incoming.levels.length - waiting.length} more.
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
        <span className="text-[11px] leading-relaxed text-zinc-400">
          A line crosses once, when you ask it to. After that the two records are separate: editing
          a level here does not rewrite the marked line in the Playbook, and deleting a marked line
          does not remove the level here. Nothing on this screen is a forecast — a line&apos;s
          rate is a tally of the tests already logged against it.
        </span>
      </div>
    </SectionCard>
  );
};

/** A stable key for one line: its identity is the date, chart, side and price together. */
function previewKey(level: BridgedLevel): string {
  return `${level.date}|${level.timeframe}|${level.kind}|${level.price}`;
}

/**
 * One line that would come across, with the counts it would arrive carrying.
 *
 * The figures are read through the tracker's own rating engine, so a previewed line and the same
 * line on the All Levels screen can never disagree. A line with nothing decided reports a dash
 * rather than a zero: it has no opinion about whether it holds, and it is not shown as a failure.
 */
const PreviewRow: React.FC<{ level: BridgedLevel }> = ({ level }) => {
  const figures = bridgedLevelFigures(level);
  return (
    <div
      data-mes-pull-row
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2"
    >
      <span className="font-mono text-xs text-zinc-100">{bridgedLevelLabel(level)}</span>
      <span className="font-mono text-[10px] text-zinc-500">{formatShortDate(level.date)}</span>
      <span className="font-mono text-[10px] text-zinc-500">
        tests {level.touches} · held {level.holds} · broke {level.breaks}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-zinc-400">
          {formatPct100(figures.strength)}
        </span>
        <GradeChip grade={figures.grade} confidence={figures.confidence} />
      </span>
      {level.label && (
        <Badge className="border-zinc-700/60 bg-zinc-900/50 text-zinc-400" title="Where you said the line came from">
          {level.label}
        </Badge>
      )}
    </div>
  );
};
