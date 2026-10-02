import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Crosshair, Layers, ListPlus, Trash2 } from 'lucide-react';
import {
  Instrument,
  LevelKind,
  LevelOutlook,
  LevelTimeframe,
  LevelTouch,
  MarkedLevel,
  MarketOutlookBias,
  TouchOutcome,
  TradingDay,
  TradingSession,
} from '../../types';
import { CoachCard } from '../coach/coach-ui';
import {
  defaultLevelZonePoints,
  formatPoints,
  instrumentSymbol,
} from '../../lib/trading/instruments';
import {
  LEVEL_TIMEFRAMES,
  TIMEFRAME_LABEL,
  diffLevelPrices,
  previousLevelDate,
  summarizeTimeframeEdges,
} from '../../lib/analytics/level-timeframes';
import {
  groupTaggedLevels,
  parsePastedPrices,
  parseTaggedLevels,
} from '../../lib/trading/level-paste';

/**
 * Where the trader writes their levels down before any of them is tested.
 *
 * The touch log next door can only describe a level once price has reached it, which loses the
 * thing the trader knows at the open: the lines their indicator is showing right now, on each
 * timeframe, for each instrument. This card is that first step. The prices go in as a list —
 * pasted, one per line — tagged with the instrument, the chart they came off and the side they
 * lean. They are kept for the day whether or not price ever comes near them, and yesterday's
 * same lines are shown beside them so a level that moved is visible at a glance.
 *
 * When a level is reached, one tap turns it into the same {@link LevelTouch} the touch log
 * decides later, so the record says which of the marked lines it came from and on which
 * timeframe. The untouched lines are kept on purpose: a level the trader marks and never tests
 * is a fact about how they read their own chart, and the break-and-run finder reports it.
 */

export interface MarkedLevelsCardProps {
  /** Every level on the record; the card shows today's and counts the rest. */
  levels: MarkedLevel[];
  /** Every touch, so a marked level can show how its touch ended. */
  touches: LevelTouch[];
  /** The trading day new levels belong to, and the source of their date and user. */
  todayTradingDay: TradingDay;
  /** The instruments to offer — the trader's tracked four, including any levels-only symbol. */
  instruments: Instrument[];
  /** What the trader expects each instrument to do today, written beside its levels. */
  outlooks: LevelOutlook[];
  /** Adds a batch of levels, skipping any already marked for the same day, instrument and price. */
  onSaveLevels: (levels: MarkedLevel[]) => void;
  onDeleteLevel: (levelId: string) => void;
  /** Logs the touch a marked level produced. The same write the touch log uses. */
  onSaveTouch: (touch: LevelTouch) => void;
  /** Writes or edits today's outlook for one instrument. */
  onSaveOutlook: (outlook: LevelOutlook) => void;
}

/** The sessions a level can be marked for, in the order they happen. */
const SESSIONS: TradingSession[] = ['Overnight', 'Premarket', 'Regular Session'];

/** The empty draft for a chart nothing has been typed into yet. */
const EMPTY_DRAFT = { support: '', resistance: '' };

/**
 * The chart the card opens on, and where a level marked before timeframes existed is shown.
 *
 * Levels from the first version of this card carry no timeframe. They are real records, so they
 * are shown under this default rather than hidden, and their own timeframe stays unset — the
 * card never rewrites a record to invent one.
 */
const DEFAULT_TIMEFRAME: LevelTimeframe = '5m';

const OUTCOME_BADGE: Record<TouchOutcome, string> = {
  watching: 'bg-zinc-800/80 text-zinc-300 border-zinc-700',
  'never-returned': 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
  returned: 'bg-rose-950/70 text-rose-300 border-rose-900/80',
  invalid: 'bg-zinc-900 text-zinc-500 border-zinc-800',
};

const OUTCOME_LABEL: Record<TouchOutcome, string> = {
  watching: 'Watching',
  'never-returned': 'Never came back',
  returned: 'Came back',
  invalid: 'Void',
};

/**
 * The colour each outlook reads as.
 *
 * Green up, red down, grey flat — spent on the bias and nothing else, so the three states are
 * told apart at a glance beside the levels. The dot is used wherever the outlook is only
 * mentioned in passing, so a bias stays visible without a second full control.
 */
const BIAS_STYLE: Record<MarketOutlookBias, { active: string; dot: string; text: string }> = {
  bullish: {
    active: 'border-emerald-700 bg-emerald-950/70 text-emerald-300',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
  },
  bearish: {
    active: 'border-rose-800 bg-rose-950/70 text-rose-300',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
  },
  neutral: {
    active: 'border-zinc-600 bg-zinc-800 text-zinc-200',
    dot: 'bg-zinc-400',
    text: 'text-zinc-300',
  },
};

/** Re-exported so the card's public surface is unchanged; the parser lives in a lib so it can be tested on its own. */
export { parsePastedPrices } from '../../lib/trading/level-paste';

/** A compact list of prices for the "what changed" line, e.g. "7742.25, 7735". */
function priceList(prices: number[]): string {
  return prices.map((price) => String(price)).join(', ');
}

export const MarkedLevelsCard: React.FC<MarkedLevelsCardProps> = ({
  levels,
  touches,
  todayTradingDay,
  instruments,
  outlooks,
  onSaveLevels,
  onDeleteLevel,
  onSaveTouch,
  onSaveOutlook,
}) => {
  const [instrumentId, setInstrumentId] = useState(() => {
    const wanted = (todayTradingDay.primaryInstrument ?? '').trim().toLowerCase();
    const primary = instruments.find((inst) => inst.symbol.toLowerCase() === wanted);
    return primary?.id ?? instruments[0]?.id ?? 'mes';
  });
  const [timeframe, setTimeframe] = useState<LevelTimeframe>(DEFAULT_TIMEFRAME);
  const [session, setSession] = useState<TradingSession>(
    SESSIONS.find((value) => todayTradingDay.allowedSessions?.includes(value)) ?? 'Regular Session'
  );
  /**
   * The level width, kept per instrument rather than shared.
   *
   * The width has a sensible default that differs by contract — 4 points is sixteen ticks of
   * MES but $400 of crude — so carrying one instrument's custom width onto another would be
   * wrong in both directions. Each instrument holds its own, defaulted from its tick size.
   */
  const [zoneByInstrument, setZoneByInstrument] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  /**
   * The two paste boxes, kept per instrument and timeframe rather than shared.
   *
   * A line belongs to one chart, so the box it is typed into does too. A shared box made a
   * list pasted for the 5m chart look like it was about to be added to the 1m chart as well —
   * switching the timeframe now switches the box with it, and a half-typed list for one chart
   * is still there when the trader comes back to it.
   */
  const [drafts, setDrafts] = useState<Record<string, { support: string; resistance: string }>>(
    {}
  );
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  /** Whether the paste-all-timeframes box is open. Collapsed by default to keep the card short. */
  const [bulkOpen, setBulkOpen] = useState(false);
  /** The bulk paste itself, kept while the trader builds it up across several indicator copies. */
  const [bulkText, setBulkText] = useState('');
  /** The side an untagged bulk line falls back to; its timeframe falls back to the open chart. */
  const [bulkDefaultSide, setBulkDefaultSide] = useState<LevelKind>('support');

  const currentInstrument = instruments.find((inst) => inst.id === instrumentId);
  const defaultZone = defaultLevelZonePoints(currentInstrument);
  const zone = zoneByInstrument[instrumentId] ?? String(defaultZone);
  const setZone = (value: string) =>
    setZoneByInstrument((prev) => ({ ...prev, [instrumentId]: value }));

  // The draft on screen belongs to exactly this instrument and timeframe.
  const draftKey = `${instrumentId}|${timeframe}`;
  const draft = drafts[draftKey] ?? EMPTY_DRAFT;
  const supportText = draft.support;
  const resistanceText = draft.resistance;

  const supportCount = useMemo(() => parsePastedPrices(draft.support).length, [draft.support]);
  const resistanceCount = useMemo(() => parsePastedPrices(draft.resistance).length, [draft.resistance]);

  const symbol = instrumentSymbol(instruments, instrumentId);

  /** Writes one side's box for the chart on screen, leaving every other chart's box alone. */
  const setSideText = (side: LevelKind, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: { ...(prev[draftKey] ?? EMPTY_DRAFT), [side]: value },
    }));
    setAdded(null);
  };

  // Switching instrument or chart is switching which record is on screen, so the previous
  // chart's confirmation must not sit under the new one looking like it belongs to it.
  const chooseInstrument = (id: string) => {
    setInstrumentId(id);
    setError('');
    setAdded(null);
  };
  const chooseTimeframe = (frame: LevelTimeframe) => {
    setTimeframe(frame);
    setError('');
    setAdded(null);
  };

  // The bulk paste reads against the chart on screen, so an untagged line still lands somewhere
  // sensible rather than being refused: the open timeframe, and a side picked right there.
  const bulkPreview = useMemo(
    () => parseTaggedLevels(bulkText, { timeframe, kind: bulkDefaultSide }),
    [bulkText, timeframe, bulkDefaultSide]
  );
  const bulkGroups = useMemo(() => groupTaggedLevels(bulkPreview.levels), [bulkPreview]);

  const touchByLevel = useMemo(() => {
    const map = new Map<string, LevelTouch>();
    for (const touch of touches) {
      if (touch.levelId) map.set(touch.levelId, touch);
    }
    return map;
  }, [touches]);

  const todayLevels = useMemo(
    () => levels.filter((level) => level.tradingDayId === todayTradingDay.id),
    [levels, todayTradingDay.id]
  );
  const earlierCount = levels.length - todayLevels.length;

  const view = useMemo(
    () =>
      todayLevels.filter(
        (level) =>
          level.instrumentId === instrumentId &&
          (level.timeframe ?? DEFAULT_TIMEFRAME) === timeframe
      ),
    [todayLevels, instrumentId, timeframe]
  );

  const byKind = (which: LevelKind) =>
    view
      .filter((level) => level.kind === which)
      .sort((a, b) => (which === 'support' ? a.price - b.price : b.price - a.price));

  const testedInView = view.filter((level) => touchByLevel.has(level.id)).length;

  // Today's outlook for the instrument on screen, and the last one written before today, so a
  // changed read is visible without leaving the card.
  const outlook = outlooks.find(
    (entry) => entry.tradingDayId === todayTradingDay.id && entry.instrumentId === instrumentId
  );
  const previousOutlook = useMemo(() => {
    const earlier = outlooks
      .filter(
        (entry) => entry.instrumentId === instrumentId && entry.tradeDate < todayTradingDay.tradeDate
      )
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
    return earlier[0];
  }, [outlooks, instrumentId, todayTradingDay.tradeDate]);

  const saveOutlook = (bias: MarketOutlookBias, notes?: string) => {
    const now = new Date().toISOString();
    onSaveOutlook({
      id: outlook?.id ?? `outlook-${todayTradingDay.tradeDate}-${instrumentId}`,
      userId: todayTradingDay.userId,
      tradingDayId: todayTradingDay.id,
      tradeDate: todayTradingDay.tradeDate,
      instrumentId,
      bias,
      notes: notes !== undefined ? notes.trim() || undefined : outlook?.notes,
      createdAt: outlook?.createdAt ?? now,
      updatedAt: now,
    });
  };

  // Yesterday's same instrument and timeframe, so what moved is visible beside today's entry.
  const yesterdayDate = useMemo(
    () => previousLevelDate(levels, instrumentId, todayTradingDay.tradeDate),
    [levels, instrumentId, todayTradingDay.tradeDate]
  );
  const yesterdayView = useMemo(
    () =>
      yesterdayDate
        ? levels.filter(
            (level) =>
              level.instrumentId === instrumentId &&
              level.tradeDate === yesterdayDate &&
              (level.timeframe ?? DEFAULT_TIMEFRAME) === timeframe
          )
        : [],
    [levels, instrumentId, timeframe, yesterdayDate]
  );

  const diffFor = (which: LevelKind) =>
    diffLevelPrices(
      view.filter((level) => level.kind === which).map((level) => level.price),
      yesterdayView.filter((level) => level.kind === which).map((level) => level.price)
    );

  // Today's record, one row per timeframe, for the instrument being looked at. Lets the
  // trader see which of their timeframes they have actually marked and tested today.
  const todayOverview = useMemo(
    () => summarizeTimeframeEdges(todayLevels, touches).filter((bucket) => bucket.instrumentId === instrumentId),
    [todayLevels, touches, instrumentId]
  );

  /**
   * Today's mark coverage by timeframe, for the instrument on screen.
   *
   * The grid below exists to answer "what have I not filled in yet", so the counts are kept
   * per side as well as per timeframe: a chart with support marked and resistance blank is not
   * filled in either, and saying so is more useful than a single number that hides it.
   */
  const frameCoverage = useMemo(() => {
    const map = new Map<
      LevelTimeframe,
      { marked: number; tested: number; support: number; resistance: number }
    >();
    for (const frame of LEVEL_TIMEFRAMES) {
      map.set(frame, { marked: 0, tested: 0, support: 0, resistance: 0 });
    }
    for (const bucket of todayOverview) {
      const entry = map.get(bucket.timeframe ?? DEFAULT_TIMEFRAME);
      if (!entry) continue;
      entry.marked += bucket.marked;
      entry.tested += bucket.tested;
      if (bucket.kind === 'support') entry.support += bucket.marked;
      else entry.resistance += bucket.marked;
    }
    return map;
  }, [todayOverview]);

  /** Charts with nothing at all marked today — the ones a daily sweep still has to cover. */
  const missingFrames = LEVEL_TIMEFRAMES.filter(
    (frame) => (frameCoverage.get(frame)?.marked ?? 0) === 0
  );
  /** Charts with only one side marked: present, but not finished. */
  const partialFrames = LEVEL_TIMEFRAMES.filter((frame) => {
    const entry = frameCoverage.get(frame);
    return !!entry && entry.marked > 0 && (entry.support === 0 || entry.resistance === 0);
  });
  const markedFrameCount = LEVEL_TIMEFRAMES.length - missingFrames.length;

  const addSide = (side: LevelKind) => {
    setError('');
    setAdded(null);

    const prices = parsePastedPrices(side === 'support' ? supportText : resistanceText);
    if (prices.length === 0) {
      setError(
        `Paste at least one ${side} price into the ${side} box — one per line, or separated by commas.`
      );
      return;
    }

    const width = zone.trim() === '' ? defaultZone : parseFloat(zone);
    if (!Number.isFinite(width) || width < 0) {
      setError('The level width has to be zero or more points.');
      return;
    }

    const now = new Date().toISOString();
    const stamp = Date.now();
    const batch: MarkedLevel[] = prices.map((price, index) => ({
      id: `level-${stamp}-${side}-${index}`,
      userId: todayTradingDay.userId,
      tradingDayId: todayTradingDay.id,
      tradeDate: todayTradingDay.tradeDate,
      instrumentId,
      kind: side,
      timeframe,
      price,
      zonePoints: Math.round(width * 100) / 100,
      label: label.trim() || undefined,
      session,
      source: 'indicator',
      createdAt: now,
      updatedAt: now,
    }));

    onSaveLevels(batch);
    // Clear the box first: setSideText also clears the confirmation, so the message has to be
    // the last state write of the two or it would be wiped out before it ever rendered.
    setSideText(side, '');
    setAdded(
      `Added ${batch.length} ${side} level${batch.length === 1 ? '' : 's'} to ` +
        `${symbol} · ${TIMEFRAME_LABEL[timeframe]}. They are listed under Today below.`
    );
  };

  /**
   * Saves every level the bulk paste named, across however many timeframes it covered.
   *
   * One write for the whole paste, so a half-applied sweep is not left on the record if the
   * trader closes the tab mid-save. The chart and side of every line are the ones parsed from
   * the line itself, or the ones on screen for an untagged line.
   */
  const addBulk = () => {
    setError('');
    setAdded(null);

    const { levels: parsed, issues } = bulkPreview;
    if (parsed.length === 0) {
      setError(
        issues.length > 0
          ? `Nothing could be read — “${issues[0].line}” has ${issues[0].reason}.`
          : 'Paste at least one line with a price, like “5m R 7760”.'
      );
      return;
    }

    const width = zone.trim() === '' ? defaultZone : parseFloat(zone);
    if (!Number.isFinite(width) || width < 0) {
      setError('The level width has to be zero or more points.');
      return;
    }

    const now = new Date().toISOString();
    const stamp = Date.now();
    const batch: MarkedLevel[] = parsed.map((level, index) => ({
      id: `level-${stamp}-bulk-${index}`,
      userId: todayTradingDay.userId,
      tradingDayId: todayTradingDay.id,
      tradeDate: todayTradingDay.tradeDate,
      instrumentId,
      kind: level.kind,
      timeframe: level.timeframe,
      price: level.price,
      zonePoints: Math.round(width * 100) / 100,
      label: label.trim() || undefined,
      session,
      source: 'indicator',
      createdAt: now,
      updatedAt: now,
    }));

    onSaveLevels(batch);
    setBulkText('');
    const frames = new Set(batch.map((level) => level.timeframe)).size;
    setAdded(
      `Added ${batch.length} level${batch.length === 1 ? '' : 's'} across ${frames} ` +
        `timeframe${frames === 1 ? '' : 's'} for ${symbol}.` +
        (issues.length > 0 ? ` ${issues.length} line(s) were skipped.` : '')
    );
  };

  const markTouched = (level: MarkedLevel) => {
    const now = new Date().toISOString();
    onSaveTouch({
      id: `touch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: level.userId,
      tradingDayId: todayTradingDay.id,
      tradeDate: todayTradingDay.tradeDate,
      instrumentId: level.instrumentId,
      kind: level.kind,
      price: level.price,
      zonePoints: level.zonePoints,
      label: level.label,
      timeframe: level.timeframe,
      touchedAt: now,
      session: level.session,
      // A fresh touch is undecided on purpose: price has reached the level, but whether it
      // stays away is the answer the touch log is for.
      outcome: 'watching',
      checks: 0,
      levelId: level.id,
      createdAt: now,
      updatedAt: now,
    });
  };

  const renderLevel = (level: MarkedLevel) => {
    const touch = touchByLevel.get(level.id);
    const isSupport = level.kind === 'support';
    return (
      <div
        key={level.id}
        data-marked-level={level.id}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5"
      >
        <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono uppercase font-bold text-zinc-300">
          {isSupport ? (
            <ArrowDown className="h-3 w-3 text-sky-300" />
          ) : (
            <ArrowUp className="h-3 w-3 text-amber-300" />
          )}
          {level.timeframe ?? timeframe}
        </span>
        <span className="font-mono text-sm font-semibold text-zinc-100">{level.price}</span>
        <span
          className="font-mono text-[10px] text-zinc-500"
          title={`A break counts once price leaves ${formatPoints(
            level.price - level.zonePoints / 2
          )}–${formatPoints(level.price + level.zonePoints / 2)}`}
        >
          ±{level.zonePoints}pts
        </span>
        {level.label && (
          <span className="truncate rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
            {level.label}
          </span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          {touch ? (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase font-bold ${
                OUTCOME_BADGE[touch.outcome]
              }`}
            >
              {OUTCOME_LABEL[touch.outcome]}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => markTouched(level)}
              title="Price reached this level — log the touch and decide it later"
              className="flex items-center gap-1 rounded-lg border border-sky-700/60 bg-sky-950/40 px-2 py-0.5 text-[10px] font-semibold text-sky-300 transition-colors hover:bg-sky-900/50 hover:text-sky-200"
            >
              <Crosshair className="h-3 w-3" />
              Touched
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteLevel(level.id)}
            title="Remove this level from the record"
            className="rounded-lg p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-rose-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
    );
  };

  const renderSideBlock = (side: LevelKind) => {
    const list = byKind(side);
    const diff = diffFor(side);
    const label = side === 'support' ? 'Support' : 'Resistance';
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">
            {label} ({list.length})
          </span>
          {yesterdayDate && (diff.added.length > 0 || diff.removed.length > 0) && (
            <span className="text-[10px] text-zinc-500">
              vs {yesterdayDate}:{' '}
              {diff.added.length > 0 && (
                <span className="text-emerald-400/90">+{priceList(diff.added)}</span>
              )}
              {diff.added.length > 0 && diff.removed.length > 0 && ' · '}
              {diff.removed.length > 0 && (
                <span className="text-rose-400/90">−{priceList(diff.removed)}</span>
              )}
            </span>
          )}
          {yesterdayDate && diff.added.length === 0 && diff.removed.length === 0 && list.length > 0 && (
            <span className="text-[10px] text-zinc-600">unchanged from {yesterdayDate}</span>
          )}
        </div>
        {list.length === 0 ? (
          <p className="text-[11px] italic text-zinc-600">None marked today.</p>
        ) : (
          list.map(renderLevel)
        )}
      </div>
    );
  };

  return (
    <CoachCard id="playbook-marked-levels" className="space-y-3.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
          <ListPlus className="h-3.5 w-3.5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100 tracking-tight">
            Today's levels by timeframe
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Write the lines your indicator shows for each instrument and chart — 1m, 3m, 5m, 15m,
            30m and 1h. Keep them all, even the ones price never reaches; when price reaches one,
            tap Touched and it becomes a touch you decide below.
          </p>
        </div>
      </div>

      {/*
        Today's outlook for the instrument on screen.

        Written beside the levels it goes with, because the read and the lines are one decision:
        MES can lean up while MCL leans down, so the outlook is per instrument. Three states —
        up, down, or no lean at all — and the colour is spent on nothing else on this card.
      */}
      <div
        id="level-outlook"
        className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
            {symbol} · today's outlook
          </span>
          {previousOutlook && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
              {previousOutlook.tradeDate}:{' '}
              <span className={`inline-flex items-center gap-1 font-semibold capitalize ${BIAS_STYLE[previousOutlook.bias].text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${BIAS_STYLE[previousOutlook.bias].dot}`} />
                {previousOutlook.bias}
              </span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {(['bullish', 'bearish', 'neutral'] as MarketOutlookBias[]).map((bias) => {
            const active = outlook?.bias === bias;
            return (
              <button
                key={bias}
                type="button"
                id={`level-outlook-${bias}`}
                aria-pressed={active}
                onClick={() => saveOutlook(bias)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors ${
                  active
                    ? BIAS_STYLE[bias].active
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${BIAS_STYLE[bias].dot}`} />
                {bias}
              </button>
            );
          })}
        </div>

        {/* Remounted per instrument, so switching instruments swaps the note with it. */}
        <input
          key={instrumentId}
          id="level-outlook-note"
          type="text"
          defaultValue={outlook?.notes ?? ''}
          disabled={!outlook}
          placeholder={outlook ? 'Why — one line, in your own words' : 'Pick a lean above first'}
          onBlur={(event) => {
            if (outlook) saveOutlook(outlook.bias, event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50"
        />
      </div>

      <form
        onSubmit={(event) => event.preventDefault()}
        className="space-y-3"
      >
        {/* ---- Instrument + timeframe ---- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="level-instrument" className="mb-1 block text-xs font-medium text-zinc-300">
              Instrument
            </label>
            <select
              id="level-instrument"
              value={instrumentId}
              onChange={(event) => chooseInstrument(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {instruments.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.symbol}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-zinc-300">Timeframe</label>
            <div className="grid grid-cols-6 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
              {LEVEL_TIMEFRAMES.map((frame) => (
                <button
                  key={frame}
                  type="button"
                  aria-pressed={timeframe === frame}
                  id={`level-tf-${frame}`}
                  onClick={() => chooseTimeframe(frame)}
                  className={`rounded-lg py-1.5 text-[11px] font-mono font-semibold transition-all ${
                    timeframe === frame
                      ? 'border border-indigo-500/70 bg-indigo-500/20 text-indigo-200 shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {frame}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="level-zone" className="mb-1 block text-xs font-medium text-zinc-300">
              Width ± pts
            </label>
            <input
              id="level-zone"
              type="number"
              min="0"
              step="0.25"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              title={`How wide the level is. Default for ${symbol}: ${defaultZone} pts.`}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {/*
          What the width actually does, said where the setting is.

          The number is load-bearing — it decides whether a touch gets graded as a break or as
          still inside the level — so it cannot be left as an unexplained field a trader has to
          guess at, and it cannot be removed without silently changing every hold rate.
        */}
        <p className="text-[10px] leading-relaxed text-zinc-500">
          <span className="font-semibold text-zinc-400">Width</span> is how thick each line is. A
          touch only counts as a break once price leaves this band, and a step back inside it
          counts as the level failing — so a width of 0 makes almost every touch look like a clean
          break. {symbol} starts at {defaultZone} pts.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label htmlFor="level-label" className="mb-1 block text-xs font-medium text-zinc-300">
              Label
            </label>
            <input
              id="level-label"
              type="text"
              placeholder="indicator R1, prior day low, range high"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div className="col-span-2">
            <label htmlFor="level-session" className="mb-1 block text-xs font-medium text-zinc-300">
              Session you are watching
            </label>
            <select
              id="level-session"
              value={session}
              onChange={(event) => setSession(event.target.value as TradingSession)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-zinc-600 focus:outline-none"
            >
              {SESSIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/*
          Paste support and resistance lines for the chart on screen.

          The heading names the instrument and timeframe the prices will be tagged with, and
          the box below is that chart's own box — so it is never ambiguous where an added line
          lands, or which chart a list belongs to.
        */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
            Paste prices for {symbol} · {TIMEFRAME_LABEL[timeframe]}
          </span>
          <span className="text-[10px] text-zinc-500">
            Each chart keeps its own boxes — switching the timeframe switches these.
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              { side: 'support' as LevelKind, text: supportText, count: supportCount },
              { side: 'resistance' as LevelKind, text: resistanceText, count: resistanceCount },
            ]
          ).map(({ side, text, count }) => (
            <div
              key={side}
              className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5"
            >
              <label
                htmlFor={`level-prices-${side}`}
                className="flex items-center gap-1.5 text-[11px] font-semibold capitalize text-zinc-300"
              >
                {side === 'support' ? (
                  <ArrowDown className="h-3 w-3 text-sky-300" />
                ) : (
                  <ArrowUp className="h-3 w-3 text-amber-300" />
                )}
                {side} prices
              </label>
              <textarea
                id={`level-prices-${side}`}
                rows={3}
                placeholder={'7742.25\n7735.00\n7721.50'}
                value={text}
                onChange={(event) => setSideText(side, event.target.value)}
                className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <button
                type="button"
                id={`level-add-${side}`}
                disabled={count === 0}
                onClick={() => addSide(side)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ListPlus className="h-3.5 w-3.5" />
                {count === 0
                  ? `Add ${side} levels`
                  : `Save ${count} ${side} ${count === 1 ? 'level' : 'levels'} to ${TIMEFRAME_LABEL[timeframe]}`}
              </button>
              {count > 0 ? (
                <p className="text-[10px] text-emerald-400/90">
                  {count} price{count === 1 ? '' : 's'} ready — press the button to record{' '}
                  {count === 1 ? 'it' : 'them'}.
                </p>
              ) : (
                <p className="text-[10px] text-zinc-600">
                  Paste prices above to turn this button on.
                </p>
              )}
            </div>
          ))}
        </div>

        {/* ---- Bulk paste: all six charts in one box ---- */}
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
          <button
            type="button"
            id="level-bulk-toggle"
            aria-expanded={bulkOpen}
            onClick={() => setBulkOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 text-[11px] font-semibold text-zinc-300 transition-colors hover:text-zinc-100"
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-300" />
              Paste all timeframes at once
            </span>
            <span className="text-[10px] font-mono text-zinc-500">
              {bulkOpen ? 'hide' : 'tag each line'}
            </span>
          </button>

          {bulkOpen && (
            <div className="space-y-2">
              <p className="text-[10px] leading-relaxed text-zinc-500">
                One level per line, tags in any order: a timeframe (
                <span className="font-mono text-zinc-400">1m 3m 5m 15m 30m 1h</span>) and a side (
                <span className="font-mono text-zinc-400">S</span>/
                <span className="font-mono text-zinc-400">support</span>,{' '}
                <span className="font-mono text-zinc-400">R</span>/
                <span className="font-mono text-zinc-400">resistance</span>) before the price. E.g.{' '}
                <span className="font-mono text-zinc-400">5m R 7760</span>. An untagged line uses
                the chart and side below.
              </p>

              <textarea
                id="level-bulk-paste"
                rows={5}
                value={bulkText}
                onChange={(event) => {
                  setBulkText(event.target.value);
                  setAdded(null);
                }}
                placeholder={'5m R 7760\n5m R 7765\n15m S 7700\n30m R 7680\n1h support 7650'}
                className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              />

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">Untagged lines are</span>
                {(['support', 'resistance'] as LevelKind[]).map((side) => (
                  <button
                    key={side}
                    type="button"
                    id={`level-bulk-default-${side}`}
                    aria-pressed={bulkDefaultSide === side}
                    onClick={() => setBulkDefaultSide(side)}
                    className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold capitalize transition-colors ${
                      bulkDefaultSide === side
                        ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                        : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {side}
                  </button>
                ))}
                <span className="text-[10px] text-zinc-500">
                  on {TIMEFRAME_LABEL[timeframe]}.
                </span>
              </div>

              {/* What the paste will actually save, grouped, so a mistyped tag is caught first. */}
              {bulkGroups.length > 0 && (
                <div id="level-bulk-preview" className="space-y-0.5">
                  {bulkGroups.map((group) => (
                    <p
                      key={`${group.timeframe}|${group.kind}`}
                      className="text-[10px] text-zinc-400"
                    >
                      <span className="font-mono text-zinc-300">
                        {TIMEFRAME_LABEL[group.timeframe]}
                      </span>{' '}
                      · <span className="capitalize">{group.kind}</span> · {group.count}
                    </p>
                  ))}
                </div>
              )}
              {bulkPreview.issues.length > 0 && (
                <div id="level-bulk-issues" className="space-y-0.5">
                  {bulkPreview.issues.slice(0, 4).map((issue) => (
                    <p key={issue.line} className="text-[10px] text-amber-300/90">
                      Skipped “{issue.line}” — {issue.reason}.
                    </p>
                  ))}
                </div>
              )}

              <button
                type="button"
                id="level-bulk-add"
                disabled={bulkPreview.levels.length === 0}
                onClick={addBulk}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ListPlus className="h-3.5 w-3.5" />
                {bulkPreview.levels.length === 0
                  ? 'Save all levels'
                  : `Save all ${bulkPreview.levels.length} level${bulkPreview.levels.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] text-zinc-500">
          Paste the lines straight from your indicator — one per line, or comma-separated.
          Anything that is not a number is ignored. Each saved line is tagged{' '}
          <span className="font-mono text-zinc-400">
            {symbol} · {TIMEFRAME_LABEL[timeframe]}
          </span>{' '}
          and appears under Today below.
        </p>

        {error && (
          <p className="rounded-xl border border-rose-900/70 bg-rose-950/50 px-2.5 py-2 text-[11px] text-rose-200">
            {error}
          </p>
        )}
        {!error && added && (
          <p
            id="level-added"
            className="flex items-start gap-1.5 rounded-xl border border-emerald-800/80 bg-emerald-950/50 px-2.5 py-2 text-[11px] font-medium text-emerald-200"
          >
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            {added}
          </p>
        )}
      </form>

      {/* ---- Today, for the selected instrument and timeframe ---- */}
      <div className="space-y-2.5 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[10px] font-mono uppercase font-bold text-zinc-400">
            {symbol} · {TIMEFRAME_LABEL[timeframe]} · today
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {view.length} marked · {testedInView} touched
            {earlierCount > 0 ? ` · ${earlierCount} on earlier days` : ''}
          </span>
        </div>

        {view.length === 0 ? (
          <p className="text-xs italic text-zinc-500">
            Nothing marked for {symbol} on the {TIMEFRAME_LABEL[timeframe]} chart today.
          </p>
        ) : (
          <div className="space-y-2.5">
            {renderSideBlock('resistance')}
            {renderSideBlock('support')}
          </div>
        )}
      </div>

      {/* ---- Today's other timeframes for this instrument ---- */}
      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase font-bold text-zinc-400">
            {symbol} · today by timeframe
            {outlook && (
              <span className={`inline-flex items-center gap-1 normal-case ${BIAS_STYLE[outlook.bias].text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${BIAS_STYLE[outlook.bias].dot}`} />
                {outlook.bias}
              </span>
            )}
          </span>
          {/* How much of the daily sweep is done, at a glance — amber until all six are in. */}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              missingFrames.length === 0
                ? 'border-emerald-800/80 bg-emerald-950/50 text-emerald-300'
                : 'border-amber-900/70 bg-amber-950/40 text-amber-300'
            }`}
          >
            {markedFrameCount} of {LEVEL_TIMEFRAMES.length} charts marked
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {LEVEL_TIMEFRAMES.map((frame) => {
            const entry =
              frameCoverage.get(frame) ?? { marked: 0, tested: 0, support: 0, resistance: 0 };
            const active = timeframe === frame;
            const empty = entry.marked === 0;
            return (
              <button
                key={frame}
                type="button"
                onClick={() => chooseTimeframe(frame)}
                aria-pressed={active}
                title={
                  empty
                    ? `Nothing marked on the ${TIMEFRAME_LABEL[frame]} chart yet today`
                    : `Open the ${TIMEFRAME_LABEL[frame]} chart`
                }
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                  active
                    ? 'border-indigo-500/70 bg-indigo-500/15'
                    : empty
                    ? 'border-dashed border-amber-900/60 bg-amber-950/20 hover:bg-amber-950/30'
                    : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/60'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${empty ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  />
                  <span className="font-mono text-[11px] font-semibold text-zinc-200">
                    {TIMEFRAME_LABEL[frame]}
                  </span>
                </span>
                <span
                  className={`font-mono text-[10px] ${empty ? 'text-amber-400/90' : 'text-zinc-500'}`}
                >
                  {empty ? 'not marked' : `${entry.marked}w · ${entry.tested}t`}
                </span>
              </button>
            );
          })}
        </div>

        {/*
          The "still to fill" line names the charts rather than counting them, so the grid
          answers the question outright instead of leaving the trader to find the empty chip.
        */}
        {missingFrames.length > 0 && (
          <p id="level-missing-timeframes" className="text-[10px] text-amber-300/90">
            Still to fill: {missingFrames.map((frame) => TIMEFRAME_LABEL[frame]).join(', ')}.
          </p>
        )}
        {partialFrames.length > 0 && (
          <p id="level-partial-timeframes" className="text-[10px] text-zinc-500">
            Only one side marked:{' '}
            {partialFrames.map((frame) => TIMEFRAME_LABEL[frame]).join(', ')}.
          </p>
        )}
        {missingFrames.length === 0 && partialFrames.length === 0 && (
          <p id="level-all-timeframes" className="text-[10px] text-emerald-400/90">
            All six charts marked today, on both sides.
          </p>
        )}

        <p className="text-[10px] text-zinc-600">
          w = marked · t = touched, today · tap a chart to open it.
        </p>
      </div>
    </CoachCard>
  );
};
