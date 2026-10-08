/**
 * The bridge between the tracker's own record and the playbook's marked lines.
 *
 * The trader writes their indicator's lines down twice over: once in the playbook's marked-level
 * card, before any of them is tested, and once in this tracker, with what price did when it
 * reached the line. They are the same read of the same charts, entered in two places, and this is
 * the path between them — the playbook's lines can be handed to the tracker, and the tracker's
 * lines can be marked in the playbook.
 *
 * Nothing here is a live link. A line crosses once, at the trader's ask, and after that the two
 * records are independent: editing the tracker's row does not rewrite the playbook's, and
 * deleting a marked line does not remove the tracker's level. That is deliberate. A level's
 * tallies are the trader's own account of what happened, and a silent rewrite from the other side
 * would change a figure they had already read. Each direction reports exactly what it did.
 *
 * Both directions skip what the destination already holds rather than duplicating it, keyed the
 * way the destination's own store keys its writes: the tracker on date + chart + side + price,
 * the playbook on day + instrument + chart + side + price. So the same button can be pressed
 * twice, or from both tabs, and the record only ever grows by what was genuinely new.
 *
 * One asymmetry is unavoidable and is stated rather than papered over. A playbook line carries
 * the trader's own touches, so the tests already logged against it are carried across as the
 * tracker's tallies. The tracker's tallies and its pattern tag have no home in the playbook —
 * the playbook's own rates are built from its touch log, not from a level's stored counts — so
 * pushing the tracker's lines across marks the lines and leaves those figures behind, where the
 * trader recorded them.
 */
import type {
  LevelKind,
  LevelTouch as PlaybookTouch,
  MarkedLevel,
  TradingSession,
} from '../../types';
import type { BreakDirection, LevelRecord, SetupTag, Timeframe } from './types';
import { DEFAULT_MES_TIMEFRAME, TIMEFRAME_ORDER } from './constants';
import { sanitizeLevel, strengthOf, gradeOf, confidenceOf, reliabilityOf } from './analytics';
import { newId } from './utils';
import { timeInTimezone } from '../storage/date-utils';

/**
 * One line as both records describe it: the fields the two agree on, and nothing else.
 *
 * It exists so neither store has to know the other's shape. Each side converts once on the way
 * in, and the two conversions are the only place a mismatch could hide.
 */
export interface BridgedLevel {
  /** The session the line belongs to, ISO 'YYYY-MM-DD' local to the trader. */
  date: string;
  /** The chart the line came off. Never empty — see `bridgeFromPlaybook`. */
  timeframe: Timeframe;
  kind: LevelKind;
  /** MES points. */
  price: number;
  /** Where the line came from — the playbook's own label, or '' when it never had one. */
  label: string;
  notes: string;
  /** Times price tested the line, as the origin record counted them. */
  touches: number;
  /** Of those tests, how many respected it. */
  holds: number;
  /** Of those tests, how many broke through it. */
  breaks: number;
  /** Which way price left the line, when the origin record agrees on one direction. */
  breakDirection: BreakDirection | '';
  /** First time price reached the line, 'HH:MM' 24h, or '' when it cannot be read. */
  hitTime: string;
}

/** A set of lines on their way across, with what the destination already holds. */
export interface BridgedBatch {
  levels: BridgedLevel[];
  /** Lines the destination already holds, so they will not be written a second time. */
  skipped: number;
}

/** What the playbook has that the tracker does not, ready to be logged. */
export interface PlaybookIncoming extends BridgedBatch {
  /**
   * Lines whose chart the playbook never recorded.
   *
   * They are filed on the tracker's default chart rather than dropped, because the line and its
   * price are the trader's own record either way and a missing label must not cost them the
   * level. Counted so the screen can say so instead of quietly inventing a chart.
   */
  untaggedCharts: number;
}

/** What a line needs to be read off the playbook: which instrument, and whose clock. */
export interface PlaybookSource {
  /** The playbook instrument the tracker records — MES. Lines on anything else cannot cross. */
  instrumentId: string;
  /** The trader's timezone, for reading a touch's own clock off its timestamp. */
  timezone: string;
}

/** What a bridged line needs to be written down as a playbook level. */
export interface MarkedLevelStamp {
  /** The account the line belongs to. */
  userId: string;
  /** The playbook instrument the tracker's lines are marked under. */
  instrumentId: string;
  /** Finds or creates the trading day for a date, so the line belongs to a session that exists. */
  dayIdOf: (date: string) => string;
  /** The zone width to carry onto the new line, in points. */
  zonePoints: number;
  /**
   * The session a line belongs to, from its own date.
   *
   * Asked per line rather than stamped once for the batch: a batch can span several sessions, and
   * a line filed under the wrong one would follow the trader into the touch log's own grouping.
   */
  sessionOf: (date: string) => TradingSession;
}

/** The key the tracker dedupes on: one line per date, chart, side and price. */
function mesKey(level: { date: string; timeframe: Timeframe; kind: LevelKind; price: number }): string {
  return `${level.date}|${level.timeframe}|${level.kind}|${level.price}`;
}

/** The key the playbook dedupes on, read off the date rather than a day id so no day is created. */
function markedKey(
  level: { date: string; timeframe: Timeframe | ''; kind: LevelKind; price: number },
  instrumentId: string
): string {
  return `${level.date}|${instrumentId}|${level.timeframe}|${level.kind}|${level.price}`;
}

/** A usable row: a real price on a real date, which is what the tracker can store. */
function isViable(date: string, price: number): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0;
}

/** Trims a free-text field, or '' when it holds nothing. */
function text(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * The trader's own words about a line, in the one free-text field the tracker keeps.
 *
 * The playbook keeps two: where the line came from, and whatever else was written against it. The
 * tracker keeps one. Folding them together is the only way both survive the crossing, and the
 * alternative is losing a line's provenance — "overnight high", "prior day low" — the moment it
 * is logged here. Nothing else is reworded: the two are joined as the trader wrote them.
 */
function joinNote(label: string | undefined, notes: string | undefined): string {
  return [text(label), text(notes)].filter(Boolean).join(' — ');
}

/** The earliest of a line's touches, which is when price first reached it. */
function firstTouch(touches: PlaybookTouch[]): PlaybookTouch | undefined {
  return [...touches].sort((a, b) =>
    (a.touchedAt ?? a.createdAt ?? '').localeCompare(b.touchedAt ?? b.createdAt ?? '')
  )[0];
}

/**
 * Which way price left a line, as far as the playbook's touches agree.
 *
 * The tracker holds one direction per line; the playbook records one per touch, and price can
 * take a line both ways across a session. A single direction is carried only when every tagged
 * break agrees on it — otherwise the line is left untagged, because picking one of two opposite
 * breaks would be a claim the record cannot support.
 */
function agreedBreakDirection(breaks: PlaybookTouch[]): BreakDirection | '' {
  const tagged = breaks.map((touch) => touch.breakDirection).filter(Boolean);
  if (tagged.length === 0) return '';
  const first = tagged[0];
  return tagged.every((direction) => direction === first) ? (first as BreakDirection) : '';
}

/**
 * The playbook's marked lines, ready to be logged in the tracker.
 *
 * Every test already logged against a line comes with it: a `returned` touch is a test price
 * respected, a `never-returned` one is a break, and a touch still `watching` counts as a test
 * that settled neither way — which is exactly the state the tracker holds as more tests than
 * decisions. An `invalid` touch is left out, the same way the playbook's own rates leave it out.
 * What the trader wrote about the line travels too, its label and its note folded into the one
 * free-text field the tracker keeps, so a line does not lose where it came from on the way across.
 *
 * A line with no chart of its own is filed on the tracker's default chart, and the count of
 * those is returned so the screen can say so. A line the trader set aside as void is not a level
 * and does not cross at all, and neither does one on another instrument: the tracker records
 * MES, and relabelling another market's line as MES would put a price on the record that the
 * trader never read off these charts.
 */
export function bridgeFromPlaybook(
  levels: MarkedLevel[],
  touches: PlaybookTouch[],
  existing: LevelRecord[],
  source: PlaybookSource
): PlaybookIncoming {
  const wanted = text(source.instrumentId).toLowerCase();
  const touchesByLevel = new Map<string, PlaybookTouch[]>();
  for (const touch of touches) {
    if (!touch.levelId || touch.outcome === 'invalid') continue;
    const linked = touchesByLevel.get(touch.levelId);
    if (linked) linked.push(touch);
    else touchesByLevel.set(touch.levelId, [touch]);
  }

  const seen = new Set(existing.map((record) => mesKey(record)));
  const out: BridgedLevel[] = [];
  let skipped = 0;
  let untaggedCharts = 0;

  for (const level of levels) {
    if (text(level.instrumentId).toLowerCase() !== wanted) continue;
    // A voided line is a line the trader struck off; it was never a level to be tested.
    if (level.resolution === 'void') continue;
    if (!isViable(level.tradeDate, level.price)) continue;

    const linked = touchesByLevel.get(level.id) ?? [];
    const breaks = linked.filter((touch) => touch.outcome === 'never-returned');
    const untagged = !level.timeframe;
    const bridged: BridgedLevel = {
      date: level.tradeDate,
      timeframe: level.timeframe ?? DEFAULT_MES_TIMEFRAME,
      kind: level.kind,
      price: level.price,
      label: text(level.label),
      notes: joinNote(level.label, level.notes),
      touches: linked.length,
      holds: linked.filter((touch) => touch.outcome === 'returned').length,
      breaks: breaks.length,
      breakDirection: agreedBreakDirection(breaks),
      hitTime: clockOf(firstTouch(linked), source.timezone),
    };

    const key = mesKey(bridged);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    if (untagged) untaggedCharts += 1;
    out.push(bridged);
  }

  // Strongest price first, the way the tracker lists its own levels.
  out.sort((a, b) => b.price - a.price || TIMEFRAME_ORDER[a.timeframe] - TIMEFRAME_ORDER[b.timeframe]);
  return { levels: out, skipped, untaggedCharts };
}

/**
 * The tracker's own lines, ready to be marked in the playbook.
 *
 * The tallies and the pattern tag stay behind: the playbook's rates are built from its touch log
 * rather than from a level's stored counts, so carrying a count across would either invent a test
 * that was never logged or double-count one that was. What crosses is the line itself — where and
 * when it was, its price and its side, its chart, and what the trader wrote against it.
 */
export function bridgeFromMes(
  records: LevelRecord[],
  marked: MarkedLevel[],
  options: { instrumentId: string }
): BridgedBatch {
  const instrumentId = text(options.instrumentId);
  const seen = new Set(
    marked.map((level) =>
      markedKey(
        {
          date: level.tradeDate,
          timeframe: level.timeframe ?? '',
          kind: level.kind,
          price: level.price,
        },
        text(level.instrumentId)
      )
    )
  );

  const out: BridgedLevel[] = [];
  let skipped = 0;

  for (const record of records) {
    const bridged: BridgedLevel = {
      date: record.date,
      timeframe: record.timeframe,
      kind: record.kind,
      price: record.price,
      // The tracker has no field for where a line came from; anything the trader wrote travels as
      // its own words rather than being reworded into the playbook's label.
      label: '',
      notes: text(record.notes),
      touches: record.touches,
      holds: record.holds,
      breaks: record.breaks,
      breakDirection: record.breakDirection,
      hitTime: record.hitTime,
    };

    const key = markedKey(bridged, instrumentId);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    out.push(bridged);
  }

  out.sort((a, b) => b.price - a.price || TIMEFRAME_ORDER[a.timeframe] - TIMEFRAME_ORDER[b.timeframe]);
  return { levels: out, skipped };
}

/** When price first reached a line, on the trader's own clock, or '' when it was never reached. */
function clockOf(touch: PlaybookTouch | undefined, timezone: string): string {
  if (!touch) return '';
  const stamp = touch.touchedAt ?? touch.createdAt;
  if (!stamp) return '';
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? '' : timeInTimezone(at, timezone);
}

/** Stamps bridged lines as the tracker's own rows, sanitised so an impossible row cannot land. */
export function mesRecordsFromBridged(levels: BridgedLevel[]): LevelRecord[] {
  const now = Date.now();
  return levels.map((level) =>
    sanitizeLevel({
      id: newId(),
      date: level.date,
      timeframe: level.timeframe,
      kind: level.kind,
      price: level.price,
      touches: level.touches,
      holds: level.holds,
      breaks: level.breaks,
      setup: '' as SetupTag | '',
      hitTime: level.hitTime,
      // The tracker holds the break's clock too, and the playbook records only that it broke, so
      // the time is left unset rather than guessed at.
      breakTime: '',
      breakDirection: level.breakDirection,
      notes: level.notes,
      createdAt: now,
      updatedAt: now,
    })
  );
}

/** Stamps bridged lines as the playbook's marked levels, each on a session that exists. */
export function markedLevelsFromBridged(
  levels: BridgedLevel[],
  stamp: MarkedLevelStamp
): MarkedLevel[] {
  const now = new Date().toISOString();
  return levels.map((level) => ({
    id: newId(),
    userId: stamp.userId,
    tradingDayId: stamp.dayIdOf(level.date),
    tradeDate: level.date,
    instrumentId: stamp.instrumentId,
    kind: level.kind,
    price: level.price,
    zonePoints: stamp.zonePoints,
    // The playbook's label means "where the line came from", and a line that came from the tracker
    // has no such answer; its own words travel in the notes instead.
    label: level.label || undefined,
    session: stamp.sessionOf(level.date),
    timeframe: level.timeframe,
    source: 'carried',
    notes: level.notes || undefined,
    createdAt: now,
    updatedAt: now,
  }));
}

/** One line, as the tracker's screens name it: '5m resistance 5823.25'.
 *
 * The crossing itself is owned by the app, because that is where both records are written and
 * where the playbook's own undo is armed. The tracker's screens are handed four calls instead of
 * the whole playbook, so nothing under this tab can reach into the playbook's state directly:
 * they ask what is waiting to come across, take it, ask how much is waiting to go back, and send
 * it. All four are answered from storage at the moment they are called, so a screen can never
 * show a count that the write behind it has already moved past.
 */
export interface MesPlaybookBridge {
  /** The playbook's lines that the tracker does not hold yet, ready to be logged. */
  incoming: () => PlaybookIncoming;
  /** Logs those lines in the tracker. Returns how many were added. */
  accept: (levels: BridgedLevel[]) => number;
  /** How many of the tracker's lines the playbook does not hold yet. */
  outgoing: () => number;
  /** Marks the tracker's lines in the playbook, skipping what is already marked there. */
  send: () => { added: number; skipped: number };
}

/** One line, as the tracker's screens name it: '5m resistance 5823.25'. */
export function bridgedLevelLabel(level: BridgedLevel): string {
  return `${level.timeframe} ${level.kind} ${level.price.toFixed(2)}`;
}

/**
 * The figures a bridged line carries, for a preview that has to stand on its own.
 *
 * Read through the tracker's own rating engine rather than recomputed, so a line previewed here
 * and the same line listed on the tracker's own screens can never disagree.
 */
export function bridgedLevelFigures(level: BridgedLevel): {
  reliability: number | null;
  strength: number | null;
  grade: ReturnType<typeof gradeOf>;
  confidence: ReturnType<typeof confidenceOf>;
} {
  const strength = strengthOf(level.holds, level.breaks);
  return {
    reliability: reliabilityOf(level.holds, level.breaks),
    strength,
    grade: gradeOf(strength),
    confidence: confidenceOf(level.holds + level.breaks),
  };
}
