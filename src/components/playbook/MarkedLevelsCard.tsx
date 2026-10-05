import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronDown,
  Crosshair,
  EyeOff,
  Layers,
  ListPlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  Instrument,
  LevelKind,
  LevelResolution,
  LevelTimeframe,
  LevelTouch,
  MarkedLevel,
  TouchBreakDirection,
  TouchOutcome,
  TradingDay,
  TradingSession,
} from '../../types';
import { CoachCard } from '../coach/coach-ui';
import {
  formatTimestamp,
  formatTradingDate,
  tradingDateOf,
} from '../../lib/storage/date-utils';
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
import {
  TOUCH_OUTCOME_BADGE,
  TOUCH_OUTCOME_LABEL,
  TouchOutcomeControls,
} from './TouchOutcomeControls';

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
 *
 * A line nothing was logged against can also be closed out, because "price never reached it" and
 * "I never got to it" are different facts and the record should be able to say which it is. One
 * tap marks it never touched; another sets it aside as void, which drops it from every rate the
 * coach reads. Both marks are reversible — the line stays on the record until it is deleted.
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
  /** The trader's own timezone, so a repeated touch is stamped on their clock. */
  timezone: string;
  /** Adds a batch of levels, skipping any already marked for the same day, instrument and price. */
  onSaveLevels: (levels: MarkedLevel[]) => void;
  /** Rewrites one level in place — used to close it out as never touched or void. */
  onUpdateLevel: (level: MarkedLevel) => void;
  /**
   * Finds the trading day for a date, creating an empty one if it is not on the record.
   *
   * Needed when a line is moved to another day: the record has to belong to a session that
   * exists, or it would point at a day History never shows.
   */
  onResolveDay: (date: string) => TradingDay;
  onDeleteLevel: (levelId: string) => void;
  /** Logs the touch a marked level produced. The same write the touch log uses. */
  onSaveTouch: (touch: LevelTouch) => void;
  /**
   * Removes a touch logged against a level, for when one was struck by mistake.
   *
   * A touch is a claim price reached the line; if it was tapped in error, leaving it on the
   * record would count a reach that never happened and pollute every rate built from it.
   */
  onDeleteTouch: (touchId: string) => void;
  /**
   * The instrument and timeframe currently open, when a parent owns them.
   *
   * Left undefined the card keeps its own selection, which is how it works on its own. When a
   * parent owns them — so a sibling card stays in step — it passes the current value and hears
   * every change through the handlers beside it, and the card no longer keeps its own copy.
   */
  instrumentId?: string;
  onInstrumentChange?: (instrumentId: string) => void;
  timeframe?: LevelTimeframe;
  onTimeframeChange?: (timeframe: LevelTimeframe) => void;
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

/** A `datetime-local` value for right now, in the browser's own zone. */
function localDateTimeInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** The short outcome word under a touch time, so a row of repeats reads at a glance. */
const OUTCOME_SHORT: Record<TouchOutcome, string> = {
  watching: 'watching',
  'never-returned': 'held',
  returned: 'came back',
  invalid: 'void',
};

/** The arrow a decided touch badge carries once the trader has said which way price left. */
const BREAK_DIRECTION_SHORT: Record<TouchBreakDirection, string> = {
  up: '↑',
  down: '↓',
};

/**
 * The order the marked lines can be read in.
 *
 * Price order is the default and reads the way price would travel through the lines: support
 * low-to-high, resistance high-to-low. Newest-first is the other choice, for finding the line
 * just added without scrolling past the rest of the day's marks.
 */
const SORT_OPTIONS: Array<{ value: 'price' | 'newest'; label: string; title: string }> = [
  {
    value: 'price',
    label: 'By price',
    title: 'Resistance high to low, support low to high — the order price travels through the lines',
  },
  {
    value: 'newest',
    label: 'Newest first',
    title: 'The most recently added line first',
  },
];

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
  timezone,
  onSaveLevels,
  onUpdateLevel,
  onResolveDay,
  onDeleteLevel,
  onSaveTouch,
  onDeleteTouch,
  instrumentId: controlledInstrumentId,
  onInstrumentChange,
  timeframe: controlledTimeframe,
  onTimeframeChange,
}) => {
  const [ownInstrumentId, setOwnInstrumentId] = useState(() => {
    const wanted = (todayTradingDay.primaryInstrument ?? '').trim().toLowerCase();
    const primary = instruments.find((inst) => inst.symbol.toLowerCase() === wanted);
    return primary?.id ?? instruments[0]?.id ?? 'mes';
  });
  const [ownTimeframe, setOwnTimeframe] = useState<LevelTimeframe>(DEFAULT_TIMEFRAME);
  // Controlled by a parent when it passes a value, so a sibling card can share the selection.
  const instrumentId = controlledInstrumentId ?? ownInstrumentId;
  const timeframe = controlledTimeframe ?? ownTimeframe;
  const [session, setSession] = useState<TradingSession>(
    SESSIONS.find((value) => todayTradingDay.allowedSessions?.includes(value)) ?? 'Regular Session'
  );
  const [label, setLabel] = useState('');
  /**
   * The touch whose outcome controls are open, if any.
   *
   * A touch is written down as `watching` and decided later, so the row has to offer a place
   * to say how it ended. Only one is open at a time — the record is read a touch at a time, and
   * a wall of controls would bury the lines it sits between.
   */
  const [expandedTouchId, setExpandedTouchId] = useState<string | null>(null);
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
  /**
   * The level whose "touched again" form is open, and its draft time and note.
   *
   * A repeat is often written down after the fact — price tested the line while the trader was
   * watching something else — so the time is editable and defaults to now rather than being
   * forced to the moment the button was pressed.
   */
  const [touchFormLevelId, setTouchFormLevelId] = useState<string | null>(null);
  const [touchAt, setTouchAt] = useState(localDateTimeInput);
  const [touchNote, setTouchNote] = useState('');
  /** Whether the paste-all-timeframes box is open. Collapsed by default to keep the card short. */
  const [bulkOpen, setBulkOpen] = useState(false);
  /** The bulk paste itself, kept while the trader builds it up across several indicator copies. */
  const [bulkText, setBulkText] = useState('');
  /** The side an untagged bulk line falls back to; its timeframe falls back to the open chart. */
  const [bulkDefaultSide, setBulkDefaultSide] = useState<LevelKind>('support');
  /**
   * The level whose edit form is open, and its draft price, label and session.
   *
   * A line written down in a hurry is corrected here rather than deleted and re-pasted, so the
   * touches already logged against it keep pointing at it. The timeframe is deliberately not
   * editable: a line belongs to the chart it was read off, and moving it between charts would
   * silently rewrite which record its touches belong to.
   */
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    price: string;
    label: string;
    session: TradingSession;
    timeframe: LevelTimeframe;
    date: string;
  } | null>(null);
  /**
   * Whether the list reaches back past today.
   *
   * The card opens on today because that is the day being traded, but a line from an earlier
   * session is still the trader's own record and used to be unreachable once the day passed.
   * This reveals it, so a price can be corrected or a level deleted at any time.
   */
  const [showEarlier, setShowEarlier] = useState(false);
  /**
   * The order the lines are listed in.
   *
   * Price order is the default because it is the read the trader is actually after — the lines
   * in the sequence price would meet them — but the record is theirs, and finding a line just
   * added should not mean hunting down a price-sorted list.
   */
  const [sortMode, setSortMode] = useState<'price' | 'newest'>('price');

  const currentInstrument = instruments.find((inst) => inst.id === instrumentId);
  // The level width is the instrument's own default; it decides how a touch is graded later.
  const defaultZone = defaultLevelZonePoints(currentInstrument);

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
    if (controlledInstrumentId === undefined) setOwnInstrumentId(id);
    onInstrumentChange?.(id);
    setError('');
    setAdded(null);
  };
  const chooseTimeframe = (frame: LevelTimeframe) => {
    if (controlledTimeframe === undefined) setOwnTimeframe(frame);
    onTimeframeChange?.(frame);
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

  /**
   * Every touch struck from each marked level, oldest first.
   *
   * A list rather than one: the same line is routinely reached more than once in a day, and the
   * sequence — overnight, at the open, then midday — is the pattern the record is trying to
   * find. Keeping only the latest here would throw that away at the point of display.
   */
  const touchesByLevel = useMemo(() => {
    const map = new Map<string, LevelTouch[]>();
    for (const touch of touches) {
      if (!touch.levelId) continue;
      const list = map.get(touch.levelId);
      if (list) list.push(touch);
      else map.set(touch.levelId, [touch]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.touchedAt ?? a.createdAt).localeCompare(b.touchedAt ?? b.createdAt));
    }
    return map;
  }, [touches]);

  const todayLevels = useMemo(
    () => levels.filter((level) => level.tradingDayId === todayTradingDay.id),
    [levels, todayTradingDay.id]
  );

  /**
   * The lines on screen: today's, or every day's when the trader reaches back.
   *
   * Filtered by the instrument and chart being looked at either way, so the record stays one
   * chart at a time and a correction cannot be made against the wrong timeframe's numbers.
   */
  const view = useMemo(() => {
    const pool = showEarlier ? levels : todayLevels;
    return pool.filter(
      (level) =>
        level.instrumentId === instrumentId &&
        (level.timeframe ?? DEFAULT_TIMEFRAME) === timeframe
    );
  }, [levels, todayLevels, showEarlier, instrumentId, timeframe]);

  /** Earlier lines for this instrument and chart, so the toggle can say how many there are. */
  const earlierInScope = levels.filter(
    (level) =>
      level.instrumentId === instrumentId &&
      (level.timeframe ?? DEFAULT_TIMEFRAME) === timeframe &&
      level.tradingDayId !== todayTradingDay.id
  ).length;

  /**
   * One side's lines, today first and then newest day down, each day read low-to-high for
   * support and high-to-low for resistance — the order price would travel through them. When
   * the trader switches to newest-first, the day grouping is kept but the lines within it are
   * ordered by when they were added, so the line just entered is always at the top.
   */
  const byKind = (which: LevelKind) => {
    // The record is stored newest-first, so its own array order breaks a shared createdAt —
    // a batch pasted in one go carries a single timestamp and would otherwise fall through
    // to price order, hiding the line just added.
    const storedOrder = new Map(view.map((level, index) => [level.id, index]));
    return view
      .filter((level) => level.kind === which)
      .sort((a, b) => {
        const aToday = a.tradeDate === todayTradingDay.tradeDate ? 0 : 1;
        const bToday = b.tradeDate === todayTradingDay.tradeDate ? 0 : 1;
        if (aToday !== bToday) return aToday - bToday;
        if (a.tradeDate !== b.tradeDate) return b.tradeDate.localeCompare(a.tradeDate);
        if (sortMode === 'newest') {
          const byNewest = b.createdAt.localeCompare(a.createdAt);
          if (byNewest !== 0) return byNewest;
          return (storedOrder.get(a.id) ?? 0) - (storedOrder.get(b.id) ?? 0);
        }
        return which === 'support' ? a.price - b.price : b.price - a.price;
      });
  };

  const testedInView = view.filter((level) => touchesByLevel.has(level.id)).length;
  const neverTouchedInView = view.filter(
    (level) => !touchesByLevel.has(level.id) && level.resolution === 'never-touched'
  ).length;

  /**
   * Closes a level out, or clears the mark when it is already set.
   *
   * Only the untested lines are offered this: once a touch links back to a line, the answer
   * lives on the touch, and marking the level never-touched would contradict the record.
   */
  const setResolution = (level: MarkedLevel, resolution: LevelResolution) => {
    onUpdateLevel({
      ...level,
      resolution: level.resolution === resolution ? undefined : resolution,
    });
  };

  /** Opens the inline edit form on a line, seeded with what is on the record now. */
  const openEdit = (level: MarkedLevel) => {
    setEditingLevelId(level.id);
    setEditDraft({
      price: String(level.price),
      label: level.label ?? '',
      session: level.session,
      // A line marked before timeframes existed shows under the default chart; opening the
      // editor and saving is how it gets a real one.
      timeframe: level.timeframe ?? DEFAULT_TIMEFRAME,
      date: level.tradeDate,
    });
    // An edit and a touch form are two answers to the same row; only one may be open.
    setTouchFormLevelId(null);
  };

  const closeEdit = () => {
    setEditingLevelId(null);
    setEditDraft(null);
  };

  /**
   * Writes the corrected line back, moving its touches with it when the chart changes.
   *
   * The timeframe is denormalised onto every touch as well as the level, so a line moved to a
   * different chart has to carry its own touches across or the record would disagree with
   * itself — the line would sit under one chart and its touches under another.
   */
  const submitEdit = (event: React.FormEvent, level: MarkedLevel) => {
    event.preventDefault();
    if (!editDraft) return;
    const price = Number(editDraft.price);
    if (!Number.isFinite(price) || price <= 0) return;
    if (!editDraft.date) return;

    const timeframe = editDraft.timeframe;
    const dateChanged = editDraft.date !== level.tradeDate;
    // Re-home to the session for the new date, creating it if the trader never opened that day.
    const day = dateChanged ? onResolveDay(editDraft.date) : null;
    onUpdateLevel({
      ...level,
      price,
      label: editDraft.label.trim() || undefined,
      session: editDraft.session,
      timeframe,
      ...(day ? { tradeDate: editDraft.date, tradingDayId: day.id } : {}),
    });

    // A line's answer lives on its touches, and a touch is dated and timed too, so any change
    // to the line has to be carried across or the record would disagree with itself.
    const linked = touches.filter((entry) => entry.levelId === level.id);
    if (timeframe !== level.timeframe || day) {
      const daysMoved = day
        ? Math.round(
            (Date.parse(`${editDraft.date}T00:00:00Z`) -
              Date.parse(`${level.tradeDate}T00:00:00Z`)) /
              86_400_000
          )
        : 0;
      for (const touch of linked) {
        const patch: Partial<LevelTouch> = { timeframe };
        if (day) {
          // Move the touch's own date and time by the same number of days the line moved.
          const stamp = touch.touchedAt ?? touch.createdAt;
          const moved = new Date(stamp);
          if (!Number.isNaN(moved.getTime())) {
            moved.setUTCDate(moved.getUTCDate() + daysMoved);
            patch.touchedAt = moved.toISOString();
          }
          patch.tradeDate = editDraft.date;
          patch.tradingDayId = day.id;
        }
        onSaveTouch({ ...touch, ...patch });
      }
    }
    closeEdit();
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

  // Always today's lines on both sides of the comparison: when the list reaches back, the
  // "what moved" read must still be today against yesterday, not today against a mixed pile.
  const diffFor = (which: LevelKind) =>
    diffLevelPrices(
      todayLevels
        .filter(
          (level) =>
            level.instrumentId === instrumentId &&
            (level.timeframe ?? DEFAULT_TIMEFRAME) === timeframe &&
            level.kind === which
        )
        .map((level) => level.price),
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

  /**
   * Which boxes have prices in them, and how many each.
   *
   * Both sides are read together so one button saves whatever the trader filled in: a chart
   * usually has support and resistance at the same time, and making them click twice to record
   * one chart's read was the thing that made marking a day tedious.
   */
  const readySides = useMemo(
    () =>
      (
        [
          { side: 'support' as LevelKind, prices: parsePastedPrices(supportText) },
          { side: 'resistance' as LevelKind, prices: parsePastedPrices(resistanceText) },
        ]
      ).filter((part) => part.prices.length > 0),
    [supportText, resistanceText]
  );
  const readyCount = readySides.reduce((sum, part) => sum + part.prices.length, 0);

  /**
   * Saves everything pasted for the chart on screen in one write.
   *
   * Support and resistance go in together because they are one read of one chart: a single
   * click records both sides, tagged with the open instrument and timeframe. Either box on its
   * own still works — fill just support and only support is saved — and both boxes are cleared
   * and confirmed together, so there is one button and one message per chart.
   */
  const addBoth = () => {
    setError('');
    setAdded(null);

    if (readySides.length === 0) {
      setError(
        'Paste at least one support or resistance price — one per line, or separated by commas.'
      );
      return;
    }

    const width = defaultZone;

    const now = new Date().toISOString();
    const stamp = Date.now();
    const batch: MarkedLevel[] = [];
    for (const part of readySides) {
      part.prices.forEach((price, index) => {
        batch.push({
          id: `level-${stamp}-${part.side}-${index}`,
          userId: todayTradingDay.userId,
          tradingDayId: todayTradingDay.id,
          tradeDate: todayTradingDay.tradeDate,
          instrumentId,
          kind: part.side,
          timeframe,
          price,
          zonePoints: Math.round(width * 100) / 100,
          label: label.trim() || undefined,
          session,
          source: 'indicator',
          createdAt: now,
          updatedAt: now,
        });
      });
    }

    onSaveLevels(batch);
    // Clear both boxes first: setSideText also clears the confirmation, so the message has to be
    // the last state write or it would be wiped out before it ever rendered.
    setSideText('support', '');
    setSideText('resistance', '');
    const summary = readySides
      .map((part) => `${part.prices.length} ${part.side} level${part.prices.length === 1 ? '' : 's'}`)
      .join(' and ');
    setAdded(
      `Saved ${summary} to ${symbol} · ${TIMEFRAME_LABEL[timeframe]}. ` +
        'They are listed under Today below.'
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

    const width = defaultZone;

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

  /** Writes one touch from a marked level, at the moment given. Shared by both paths below. */
  const logTouch = (level: MarkedLevel, touchedAt: string, notes?: string) => {
    const now = new Date().toISOString();
    // The date follows the touch time the trader set, not the day the tab happens to be on — a
    // touch written down after the fact belongs to the session it actually printed in.
    const touchDate = tradingDateOf(touchedAt, timezone) || todayTradingDay.tradeDate;
    const day =
      touchDate === todayTradingDay.tradeDate ? todayTradingDay : onResolveDay(touchDate);
    const touch: LevelTouch = {
      id: `touch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: level.userId,
      tradingDayId: day.id,
      tradeDate: touchDate,
      instrumentId: level.instrumentId,
      kind: level.kind,
      price: level.price,
      zonePoints: level.zonePoints,
      label: level.label,
      timeframe: level.timeframe,
      touchedAt,
      session: level.session,
      // A fresh touch is undecided on purpose: price has reached the level, but whether it
      // stays away is the answer the touch log is for.
      outcome: 'watching',
      checks: 0,
      levelId: level.id,
      notes: notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    onSaveTouch(touch);
    // Open the controls on the touch just logged, because deciding it is the very next thing
    // the trader does — and leaving them to hunt for the row makes the whole record slower.
    setExpandedTouchId(touch.id);
  };

  /**
   * Opens the touch form on a line, seeded with right now.
   *
   * The first touch and every later one go through this same form, so the time is always the
   * trader's to set: a line is often reached while they were watching something else, and the
   * moment it printed is the whole point of the record. The default is now, so the quick case is
   * still two clicks.
   */
  const openTouchForm = (levelId: string) => {
    setTouchFormLevelId(levelId);
    setTouchAt(localDateTimeInput());
    setTouchNote('');
  };

  const closeTouchForm = () => setTouchFormLevelId(null);

  /** Submits a touch — the first one or a repeat — on the trader's chosen clock time. */
  const submitTouch = (event: React.FormEvent, level: MarkedLevel) => {
    event.preventDefault();
    const when = touchAt ? new Date(touchAt) : new Date();
    if (Number.isNaN(when.getTime())) return;
    logTouch(level, when.toISOString(), touchNote);
    closeTouchForm();
  };

  const renderLevel = (level: MarkedLevel) => {
    const levelTouches = touchesByLevel.get(level.id) ?? [];
    const latest = levelTouches[levelTouches.length - 1];
    const isSupport = level.kind === 'support';
    const formOpen = touchFormLevelId === level.id;
    const editOpen = editingLevelId === level.id;
    const isVoid = level.resolution === 'void';
    const isEarlier = level.tradeDate !== todayTradingDay.tradeDate;
    return (
      <div
        key={level.id}
        data-marked-level={level.id}
        data-level-resolution={level.resolution ?? 'open'}
        data-level-touch-state={latest ? 'touched' : 'untouched'}
        className={`space-y-1.5 rounded-xl border px-2.5 py-1.5 ${
          isVoid
            ? 'border-zinc-800/70 border-dashed bg-zinc-950/40 opacity-70'
            : 'border-zinc-800 bg-zinc-900/50'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono uppercase font-bold text-zinc-300">
            {isSupport ? (
              <ArrowDown className="h-3 w-3 text-sky-300" />
            ) : (
              <ArrowUp className="h-3 w-3 text-amber-300" />
            )}
            {level.timeframe ?? timeframe}
          </span>
          <span
            data-level-price={level.price}
            className="font-mono text-sm font-semibold text-zinc-100"
          >
            {level.price}
          </span>
          <span
            className="font-mono text-[10px] text-zinc-500"
            title={`A break counts once price leaves ${formatPoints(
              level.price - level.zonePoints / 2
            )}–${formatPoints(level.price + level.zonePoints / 2)}`}
          >
            ±{level.zonePoints}pts
          </span>
          {levelTouches.length > 1 && (
            <span
              className="rounded border border-sky-900 bg-sky-950/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300"
              title={`Price has reached this line ${levelTouches.length} times today`}
            >
              ×{levelTouches.length} touches
            </span>
          )}
          {/* Only on the lines reached back to: today's rows are the default and need no date. */}
          {isEarlier && (
            <span
              className="rounded border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400"
              title={`Marked on ${level.tradeDate}`}
            >
              {formatTradingDate(level.tradeDate, timezone)}
            </span>
          )}
          {level.label && (
            <span className="truncate rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {level.label}
            </span>
          )}
          {/*
            The default state, said out loud.

            A freshly marked line used to show only the buttons below, and the bright "Touched"
            button read as a status — as if the level had already been touched. So the line now
            names its own state: nothing has reached it until the trader says so.
          */}
          {!latest && !isVoid && level.resolution !== 'never-touched' && (
            <span
              id={`level-untouched-${level.id}`}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/60 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400"
              title="Price has not reached this line yet — mark it touched when it does"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
              Not touched yet
            </span>
          )}
          {level.resolution === 'never-touched' && (
            <span
              id={`level-never-touched-${level.id}`}
              className="rounded border border-amber-900/70 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
              title="You closed this line out — price never reached it"
            >
              Never touched
            </span>
          )}
          {isVoid && (
            <span
              id={`level-void-${level.id}`}
              className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500"
              title="Set aside — left out of every rate the coach reads"
            >
              Void
            </span>
          )}

          <span className="ml-auto flex items-center gap-1.5">
            {/*
              Closing out an untested line.

              Offered only before a touch links back to the line: once one does, the answer is
              the touch's own outcome and this would contradict it. Both marks toggle, so a line
              marked by mistake is one tap from being open again.
            */}
            {!latest && (
              <>
                <button
                  type="button"
                  id={`level-never-touched-btn-${level.id}`}
                  aria-pressed={level.resolution === 'never-touched'}
                  onClick={() => setResolution(level, 'never-touched')}
                  title={
                    level.resolution === 'never-touched'
                      ? 'Reopen this line — it is no longer closed out'
                      : 'Price never reached this line — close it out as never touched'
                  }
                  className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    level.resolution === 'never-touched'
                      ? 'border-amber-700/70 bg-amber-950/50 text-amber-200'
                      : 'border-zinc-700/60 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <Ban className="h-3 w-3" />
                  Never touched
                </button>
                <button
                  type="button"
                  id={`level-void-btn-${level.id}`}
                  aria-pressed={isVoid}
                  onClick={() => setResolution(level, 'void')}
                  title={
                    isVoid
                      ? 'Reopen this line — it counts in the record again'
                      : 'Set this line aside — it is left out of every rate'
                  }
                  className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    isVoid
                      ? 'border-zinc-600 bg-zinc-800 text-zinc-300'
                      : 'border-zinc-700/60 bg-zinc-950/40 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <EyeOff className="h-3 w-3" />
                  Void
                </button>
              </>
            )}
            {!latest ? (
              <button
                type="button"
                id={`level-touch-first-${level.id}`}
                aria-pressed={formOpen}
                onClick={() => (formOpen ? closeTouchForm() : openTouchForm(level.id))}
                title="Price reached this level — set the time it happened and what came of it"
                className="flex items-center gap-1 rounded-lg border border-sky-700/60 bg-sky-950/40 px-2 py-0.5 text-[10px] font-semibold text-sky-300 transition-colors hover:bg-sky-900/50 hover:text-sky-200"
              >
                <Crosshair className="h-3 w-3" />
                Mark touched
              </button>
            ) : (
              <button
                type="button"
                id={`level-touch-again-${level.id}`}
                aria-pressed={formOpen}
                onClick={() => (formOpen ? closeTouchForm() : openTouchForm(level.id))}
                title="Price reached this line again — set the time it happened and what came of it"
                className="flex items-center gap-1 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/50 hover:text-emerald-200"
              >
                <Crosshair className="h-3 w-3" />
                Touch again
              </button>
            )}
            <button
              type="button"
              id={`level-edit-${level.id}`}
              aria-pressed={editOpen}
              onClick={() => (editOpen ? closeEdit() : openEdit(level))}
              title="Edit this line's price, label or session"
              className={`rounded-lg p-1 transition-colors hover:bg-zinc-800 ${
                editOpen ? 'text-indigo-300' : 'text-zinc-600 hover:text-zinc-200'
              }`}
            >
              <Pencil className="h-3 w-3" />
            </button>
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

        {/*
          Every time price reached this exact line today, in order.

          This is the sequence the recurrence read is built from, shown where the trader records
          it: overnight, then the open, then midday, each with what came of it. It is deliberately
          the same list the coach sees, so a pattern quoted back can be checked against the times
          on screen.
        */}
        {levelTouches.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {levelTouches.map((touch, index) => {
              const expanded = expandedTouchId === touch.id;
              return (
                <span
                  key={touch.id}
                  data-level-touch={touch.id}
                  className={`inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-mono ${TOUCH_OUTCOME_BADGE[touch.outcome]}`}
                >
                  {/* The badge itself opens the controls: the outcome is the thing left to
                      say, so it is the thing that is clickable. */}
                  <button
                    type="button"
                    id={`level-touch-decide-${touch.id}`}
                    aria-expanded={expanded}
                    aria-label={`Decide touch ${index + 1} of ${levelTouches.length}`}
                    onClick={() =>
                      setExpandedTouchId((prev) => (prev === touch.id ? null : touch.id))
                    }
                    title={`Touch ${index + 1} of ${levelTouches.length}: ${TOUCH_OUTCOME_LABEL[touch.outcome]} — click to say how it ended`}
                    className="flex items-center gap-1 rounded p-0.5 text-left transition-colors hover:bg-black/20"
                  >
                    <span className="font-bold">{formatTimestamp(touch.touchedAt, timezone)}</span>
                    <span className="uppercase opacity-80">{OUTCOME_SHORT[touch.outcome]}</span>
                    {/* Which way price left, once the trader has said. Absent until then. */}
                    {touch.breakDirection && (
                      <span
                        id={`level-touch-direction-${touch.id}`}
                        className="font-bold"
                        title={`Price broke ${touch.breakDirection}`}
                      >
                        {BREAK_DIRECTION_SHORT[touch.breakDirection]}
                      </span>
                    )}
                    <ChevronDown
                      className={`h-2.5 w-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {/*
                    Removing a touch tapped by mistake.

                    A touch counts as a reach the moment it is logged, so an accidental one would
                    sit in every rate built from this line until it is taken off. Small and quiet
                    because it is an undo, not a main action.
                  */}
                  <button
                    type="button"
                    id={`level-touch-remove-${touch.id}`}
                    onClick={() => onDeleteTouch(touch.id)}
                    title="Remove this touch — for one logged by mistake"
                    className="ml-0.5 rounded p-0.5 text-current opacity-60 transition-colors hover:bg-black/30 hover:text-rose-300 hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Deciding the open touch: what price did after it reached the line, and when that
            answer was reached. Kept inline so it is recorded on the level it belongs to. */}
        {expandedTouchId &&
          (() => {
            const openTouch = levelTouches.find((touch) => touch.id === expandedTouchId);
            if (!openTouch) return null;
            return (
              <TouchOutcomeControls
                touch={openTouch}
                onSave={onSaveTouch}
                onDelete={onDeleteTouch}
                compact
              />
            );
          })()}

        {/*
          Correcting a line in place.

          The price, label and session are the things a hurried paste gets wrong, and fixing
          them here leaves the line where it is — so any touches already logged against it keep
          pointing at it instead of being orphaned by a delete-and-retype.
        */}
        {editOpen && editDraft && (
          <form
            onSubmit={(event) => submitEdit(event, level)}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-900/60 bg-indigo-950/20 px-2 py-1.5"
          >
            <label
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400"
              htmlFor={`level-edit-price-${level.id}`}
            >
              Price
              <input
                id={`level-edit-price-${level.id}`}
                type="number"
                step="0.25"
                inputMode="decimal"
                value={editDraft.price}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, price: event.target.value })
                }
                className="w-24 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <label
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400"
              htmlFor={`level-edit-timeframe-${level.id}`}
            >
              Chart
              <select
                id={`level-edit-timeframe-${level.id}`}
                value={editDraft.timeframe}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    timeframe: event.target.value as LevelTimeframe,
                  })
                }
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                {LEVEL_TIMEFRAMES.map((frame) => (
                  <option key={frame} value={frame}>
                    {TIMEFRAME_LABEL[frame]}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400"
              htmlFor={`level-edit-date-${level.id}`}
            >
              Date
              <input
                id={`level-edit-date-${level.id}`}
                type="date"
                value={editDraft.date}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, date: event.target.value })
                }
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <label
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400"
              htmlFor={`level-edit-label-${level.id}`}
            >
              Label
              <input
                id={`level-edit-label-${level.id}`}
                type="text"
                value={editDraft.label}
                placeholder="indicator R1, prior day low…"
                onChange={(event) =>
                  setEditDraft({ ...editDraft, label: event.target.value })
                }
                className="min-w-[120px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <label
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400"
              htmlFor={`level-edit-session-${level.id}`}
            >
              Session
              <select
                id={`level-edit-session-${level.id}`}
                value={editDraft.session}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, session: event.target.value as TradingSession })
                }
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                {SESSIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              id={`level-edit-save-${level.id}`}
              className="rounded-lg border border-indigo-700/60 bg-indigo-500/20 px-2.5 py-1 text-[10px] font-bold text-indigo-100 transition-colors hover:bg-indigo-500/30"
            >
              Save line
            </button>
            <button
              type="button"
              onClick={closeEdit}
              className="rounded-lg px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
          </form>
        )}

        {formOpen && (
          <form
            onSubmit={(event) => submitTouch(event, level)}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-2 py-1.5"
          >
            <label
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-zinc-400"
              htmlFor={`level-touch-at-${level.id}`}
            >
              Touched at
              <input
                id={`level-touch-at-${level.id}`}
                type="datetime-local"
                value={touchAt}
                onChange={(event) => setTouchAt(event.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-100 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <input
              id={`level-touch-note-${level.id}`}
              type="text"
              value={touchNote}
              placeholder="What happened — ran up, reversed at the open…"
              onChange={(event) => setTouchNote(event.target.value)}
              className="min-w-[140px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-emerald-700/60 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-100 transition-colors hover:bg-emerald-500/30"
            >
              Log touch
            </button>
            <button
              type="button"
              onClick={closeTouchForm}
              className="rounded-lg px-2 py-1 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
          </form>
        )}
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
            30m and 1h. Keep them all, even the ones price never reaches. A new line starts as{' '}
            <span className="font-semibold text-zinc-300">Not touched yet</span>: you say what
            happened to it, by tapping Mark touched or Never touched.
          </p>
        </div>
      </div>

      <form
        onSubmit={(event) => event.preventDefault()}
        className="space-y-3"
      >
        {/* ---- Instrument + timeframe ---- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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

        </div>

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
              {count > 0 ? (
                <p className="text-[10px] text-emerald-400/90">
                  {count} price{count === 1 ? '' : 's'} ready.
                </p>
              ) : (
                <p className="text-[10px] text-zinc-600">
                  Optional — leave blank when there is none today.
                </p>
              )}
            </div>
          ))}
        </div>

        {/*
          One button for the whole chart.

          Support and resistance for a timeframe are a single read, so they are saved together:
          one click records both sides, and whichever box is filled is what gets saved. This is
          the one thing that made marking a day tedious — two separate clicks per chart.
        */}
        <button
          type="button"
          id="level-add-both"
          disabled={readyCount === 0}
          onClick={addBoth}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-[11px] font-bold text-zinc-950 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ListPlus className="h-3.5 w-3.5" />
          {readyCount === 0
            ? `Add support and resistance to ${TIMEFRAME_LABEL[timeframe]}`
            : `Save ${readySides
                .map((part) => `${part.prices.length} ${part.side}`)
                .join(' + ')} to ${TIMEFRAME_LABEL[timeframe]}`}
        </button>

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
            {symbol} · {TIMEFRAME_LABEL[timeframe]} · {showEarlier ? 'all days' : 'today'}
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {view.length} marked · {testedInView} touched
            {neverTouchedInView > 0 ? ` · ${neverTouchedInView} never touched` : ''}
          </span>
        </div>

        {/*
          The order the lines are read in.

          Kept as its own quiet control so the two orders are visible without the trader having
          to know the list is sorted at all: price order is the default, and newest-first is one
          tap away when they are looking for the line they just added. Hidden with nothing on
          the chart, since there is no order to choose yet.
        */}
        {view.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase font-bold text-zinc-500">Order</span>
            {SORT_OPTIONS.map((option) => {
              const active = sortMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  id={`level-sort-${option.value}`}
                  title={option.title}
                  aria-pressed={active}
                  onClick={() => setSortMode(option.value)}
                  className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    active
                      ? 'border-indigo-500/70 bg-indigo-500/20 text-indigo-200'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
            <span className="text-[10px] text-zinc-600">
              resistance high→low · support low→high
            </span>
          </div>
        )}

        {
          /*
          Reaching back to earlier sessions.

          Shown only when this instrument and chart actually have history, so the control does
          not offer a view that would come back empty. Once on, every line is editable and
          deletable exactly as today's are.
        */}
        {earlierInScope > 0 && (
          <button
            type="button"
            id="level-show-earlier"
            aria-pressed={showEarlier}
            onClick={() => setShowEarlier((value) => !value)}
            className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              showEarlier
                ? 'border-indigo-600/70 bg-indigo-500/20 text-indigo-200'
                : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {showEarlier
              ? 'Hide earlier days'
              : `Show ${earlierInScope} earlier line${earlierInScope === 1 ? '' : 's'}`}
          </button>
        )}

        {view.length === 0 ? (
          <p className="text-xs italic text-zinc-500">
            Nothing marked for {symbol} on the {TIMEFRAME_LABEL[timeframe]} chart
            {showEarlier ? ' yet.' : ' today.'}
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
