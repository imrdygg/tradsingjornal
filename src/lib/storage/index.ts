import {
  Instrument,
  Setup,
  TradingDay,
  Trade,
  DailyReview,
  LessonAcknowledgement,
  UserProfile,
  PlanChange,
  PlanSnapshot,
  PatternStudy,
  LevelTouch,
  SessionExtreme,
  ChartSearch,
  Lesson,
  CoachPlan,
  FeedbackNote,
  MarkedLevel,
  LevelOutlook,
} from '../../types';
import {
  DEFAULT_INSTRUMENTS,
  INSTRUMENT_CATALOG_VERSION,
  RETIRED_INSTRUMENT_IDS,
} from '../trading/instruments';
import { DEFAULT_RISK_TIER_AMOUNTS } from '../trading/risk-tiers';
import { FOCUS_SETUP_NAMES } from '../playbook/focus-setups';
import { timeframeOf } from '../analytics/session-extremes';
import { clearCachedNotes } from '../ai/checkpoints';
import { getCurrentTradingSessionDate } from './date-utils';

/**
 * The built-in setup catalog: exactly two setups.
 *
 * This journal belongs to one trader and is built around one idea — price reaching a
 * level and either holding there or breaking through it. So the catalog is Support and
 * Resistance and nothing else. The pattern library the app used to ship was removed on
 * purpose: this is a journal for finding YOUR setups, not a browser of thirty textbook
 * patterns, and a wall of built-ins only buries the two that matter.
 *
 * Both names have a full study guide (setup-guides.ts) and bullish/bearish example charts
 * (SetupDiagram.tsx) keyed to exactly this spelling, so the cards teach rather than fall
 * back to the generic diagrams.
 *
 * `since` marks the catalog version a setup arrived in, and it is what lets the catalog
 * grow for a journal that already exists: see `ensureSetupCatalog`. Entries without it
 * predate the versioning and are never re-added once a trader has removed them. Neither
 * setup here carries one, so the merge has nothing to add today — it stays for the next
 * addition, and for journals that already stored their own list.
 */

/**
 * The current built-in catalog version. Bump it, and tag the new setups with the new
 * number, when adding setups that existing journals should receive.
 *
 * Version 3 was the release of the two break-and-run set-ups, which the catalog no longer
 * carries. The number is not wound back: a journal that already received them keeps them,
 * which is the rule for every removal — a release adds, it never deletes.
 */
export const SETUP_CATALOG_VERSION = 3;

/**
 * Keeps a saved setup pointed at the built-in it came from.
 *
 * The study guide and example charts are keyed by the built-in's name, so a rename would
 * otherwise cost the trader the material that teaches the setup they renamed. The link is
 * recorded once, from whatever the setup answered to before the save, and from then on it
 * survives any number of further renames.
 *
 * It is also what stops `ensureSetupCatalog` from adding a built-in back under its original
 * name after it has been renamed — the renamed copy still counts as that setup.
 */
function keepBuiltinLink(next: Setup, previous?: Setup): Setup {
  if (next.builtinName) return next;

  const source = (previous?.builtinName ?? previous?.name ?? next.name).trim().toLowerCase();
  const match = DEFAULT_SETUPS.find((builtin) => builtin.name.toLowerCase() === source);
  if (match) return { ...next, builtinName: match.name };

  // A setup typed by hand under a built-in's name ("VWAP Reclaim") links to it as well, so
  // it picks up the guide instead of falling back to the empty personal-notes card.
  const direct = DEFAULT_SETUPS.find(
    (builtin) => builtin.name.toLowerCase() === next.name.trim().toLowerCase()
  );
  return direct ? { ...next, builtinName: direct.name } : next;
}
export const DEFAULT_SETUPS: Setup[] = [
  // The two the whole app is built around. They lead the catalog, they are what a fresh
  // day's plan watches, and they are what the Playbook shows by default — see
  // `focus-setups.ts`. Anything the coach learns from the journal is added on top of these
  // as an editable AI draft, never in place of them.
  { id: 'support', name: 'Support', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'resistance', name: 'Resistance', active: true, createdAt: '2026-01-01T00:00:00Z' },
];

export const DEFAULT_PROFILE: UserProfile = {
  id: 'solo-trader-01',
  displayName: 'Solo MES Trader',
  timezone: 'America/New_York',
  defaultInstrument: 'MES',
  defaultDailyLossLimit: 100,
  // Four fixed risk slots plus a custom amount, editable in Settings.
  riskTierAmounts: [...DEFAULT_RISK_TIER_AMOUNTS],
  // A starting figure the trader is expected to change to their own funding-firm rule.
  // It is a limit, not a target: the panel reports room against it either way.
  maxDrawdown: 1000,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const STORAGE_KEYS = {
  PROFILE: 'ptj_profile_v1',
  INSTRUMENTS: 'ptj_instruments_v1',
  INSTRUMENT_CATALOG: 'ptj_instrument_catalog_v1',
  SETUPS: 'ptj_setups_v1',
  DAYS: 'ptj_trading_days_v1',
  TRADES: 'ptj_trades_v1',
  REVIEWS: 'ptj_reviews_v1',
  PATTERN_STUDIES: 'ptj_pattern_studies_v1',
  LEVEL_TOUCHES: 'ptj_level_touches_v1',
  MARKED_LEVELS: 'ptj_marked_levels_v1',
  LEVEL_OUTLOOKS: 'ptj_level_outlooks_v1',
  SESSION_EXTREMES: 'ptj_session_extremes_v1',
  CHART_SEARCHES: 'ptj_chart_searches_v1',
  LESSONS: 'ptj_lessons_v1',
  COACH_PLANS: 'ptj_coach_plans_v1',
  FEEDBACK: 'ptj_feedback_v1',
  SETUP_CATALOG: 'ptj_setup_catalog_v1',
  LESSON_ACK: 'ptj_lesson_ack_v1',
  RECOVERY: 'ptj_recovery_v1',
  SEEDED: 'ptj_seeded_v1',
  AUTH: 'ptj_auth_status_v1',
  SUPABASE_CONFIG: 'ptj_supabase_config_v1',
};

/**
 * A copy of the journal kept aside when a cloud sync replaced this device's own.
 *
 * A sync decides which copy survives, and the copy it does not keep is the only thing in
 * the app that can destroy a session's work. Keeping it here means that decision is never
 * final: the trader can download what was set aside, however long ago the sync ran.
 *
 * Best-effort by design. Storage is finite and the journal already lives in it, so a
 * snapshot that will not fit is skipped rather than allowed to break the save that is
 * trying to happen.
 */
export interface RecoveryCopy {
  /** The whole journal, exactly as it was held, ready to import again. */
  json: string;
  savedAt: string;
  /** Why it was set aside, so the UI can say what happened. */
  reason: string;
}

/**
 * Above this, no recovery copy is kept.
 *
 * A journal at this size is one carrying chart screenshots, and duplicating it is more
 * likely to fill the browser (and so break every later write) than to save anyone.
 */
const RECOVERY_COPY_LIMIT_BYTES = 2_000_000;

/**
 * How many picture searches are kept.
 *
 * Each saved search carries a thumbnail of the chart it was run against, so this is the
 * number that keeps the history from becoming the largest thing in storage. Thirty is a few
 * weeks of looking at charts — long enough for the record to show which of them matched the
 * trader's own trades — and anything past it drops oldest-first.
 */
const MAX_CHART_SEARCHES = 30;

export interface StorageState {
  profile: UserProfile;
  instruments: Instrument[];
  setups: Setup[];
  tradingDays: TradingDay[];
  trades: Trade[];
  reviews: DailyReview[];
  /**
   * The trader's own material for the Chart Pattern playbook: statuses, checklists,
   * notes and logged examples with screenshots.
   *
   * Optional so a snapshot saved before the feature existed still loads: everything
   * reading it treats a missing list as empty rather than as an error.
   */
  patternStudies?: PatternStudy[];
  /**
   * The break-and-run journal: every level touch the trader logged, with what price
   * did afterwards.
   *
   * Optional for the same reason as the pattern studies above — a snapshot saved
   * before this feature existed must still load, and every reader treats a missing
   * list as empty rather than as an error.
   */
  levelTouches?: LevelTouch[];
  /**
   * The prices the trader marked before any of them was touched.
   *
   * Optional for the same reason as the lists around it — a snapshot saved before this
   * feature existed must still load, and every reader treats a missing list as empty. It is
   * a record of one session's levels, so a journal reset clears it with the touches.
   */
  markedLevels?: MarkedLevel[];
  /**
   * What the trader thought each instrument would do, written down with its levels.
   *
   * Optional for the same reason as the lists around it — a snapshot saved before this feature
   * existed must still load, and every reader treats a missing list as empty. It is a record
   * about one day's market, so a journal reset clears it with the touched levels.
   */
  levelOutlooks?: LevelOutlook[];
  /**
   * The trader's own record of where each session's high and low printed on the clock,
   * for the instruments they trade.
   *
   * Optional for the same reason as the lists above — a snapshot saved before this feature
   * existed must still load, and every reader treats a missing list as empty rather than as
   * an error. It is journal data, not playbook material, so a reset clears it with the days
   * it belongs to.
   */
  sessionExtremes?: SessionExtreme[];
  /**
   * The saved picture searches: which charts the trader uploaded and what they matched.
   *
   * Optional for the same reason as the lists above — a snapshot saved before this feature
   * existed must still load, and every reader treats a missing list as empty. It is the
   * trader's own material, so a reset clears it with the journal it was searched against.
   */
  chartSearches?: ChartSearch[];
  /**
   * The lessons the trader has written down for themselves, with their own media.
   *
   * Playbook material rather than journal entries: a lesson is what the trader concluded,
   * not a record of one session, so a reset keeps it and only a sign-out clears it. Optional
   * so a snapshot saved before the feature existed still loads, and every reader treats a
   * missing list as empty rather than as an error.
   */
  lessons?: Lesson[];
  /**
   * The plans the coach made on its own, with the trader's grades and feedback.
   *
   * Optional for the same reason as the lists above. Journal material rather than settings:
   * a plan is tied to the market it was made against, so a reset clears it with the days.
   */
  coachPlans?: CoachPlan[];
  /**
   * Notes the trader left about the app itself: what is broken, confusing or missing.
   *
   * Optional for the same reason as the lists above — a snapshot saved before this feature
   * existed must still load, and every reader treats a missing list as empty rather than as
   * an error. It is the trader's own material about the app, not about a trade, so a journal
   * reset keeps it while a sign-out clears it with everything else on the device.
   */
  feedback?: FeedbackNote[];
  /**
   * The carried-forward lesson the trader has acknowledged, if any.
   *
   * Synced with the journal so acknowledging on the phone holds on the desktop: the
   * acknowledgement is about the lesson, not about the device it was read on.
   */
  lessonAck?: LessonAcknowledgement | null;
  /**
   * The built-in catalog version this copy of the journal has been brought up to.
   *
   * It travels with the instruments because the two must agree: the merge adds a contract
   * only when its `since` is newer than this number, so a snapshot that carries an
   * instrument list without the marker it was brought to would keep reintroducing the very
   * contract it is missing — the marker stays current on the device and the merge returns
   * early. Optional for the same reason as the lists above; a snapshot without it is read
   * as version 1, which brings the whole built-in catalog up to date rather than trusting
   * a marker that would skip it.
   */
  instrumentCatalogVersion?: number;
}

/**
 * Why a journal read or write did not do what it was asked to.
 *
 * - `quota`: the journal no longer fits in this browser's storage.
 * - `unavailable`: storage exists but is blocked (private browsing, disabled cookies).
 * - `corrupt`: stored JSON could not be parsed, so a default was used instead.
 * - `unknown`: anything else.
 */
export type StorageFailureKind = 'quota' | 'unavailable' | 'corrupt' | 'unknown';

export interface StorageFailure {
  kind: StorageFailureKind;
  /** The storage key involved, for the console and the report. */
  key: string;
  /** What the browser said, kept verbatim so nothing is lost in translation. */
  detail: string;
  at: number;
}

/**
 * The most recent failure, kept until the trader dismisses it.
 *
 * It is deliberately sticky: a failed write means that change is gone, and
 * clearing the warning on the next successful (smaller) write would hide the
 * one loss that matters. Only `dismissStorageFailure` clears it.
 */
let lastFailure: StorageFailure | null = null;
const failureListeners = new Set<(failure: StorageFailure | null) => void>();

/**
 * Separates "the journal filled the browser" from every other write error.
 * Quota is the one the trader can act on — attach fewer screenshots, export a
 * backup — so it is named precisely rather than reported as a generic failure.
 */
function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: string; code?: number };
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 || // Chrome / Edge legacy code
    candidate.code === 1014 // Firefox legacy code
  );
}

function isStorageBlockedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: string };
  return (
    candidate.name === 'SecurityError' ||
    candidate.name === 'InvalidStateError' ||
    candidate.name === 'NS_ERROR_FILE_CORRUPTED'
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function notifyFailureListeners(): void {
  for (const listener of failureListeners) listener(lastFailure);
}

function reportFailure(kind: StorageFailureKind, key: string, err: unknown): void {
  const detail = describeError(err);
  lastFailure = { kind, key, detail, at: Date.now() };
  console.error(`Journal storage failure (${kind}) on ${key}:`, err);
  notifyFailureListeners();
}

/** The unresolved storage failure, or null when the journal is saving cleanly. */
export function getStorageFailure(): StorageFailure | null {
  return lastFailure;
}

/** Acknowledges the warning. The failed write itself cannot be replayed. */
export function dismissStorageFailure(): void {
  if (!lastFailure) return;
  lastFailure = null;
  notifyFailureListeners();
}

/**
 * Subscribes to failure changes so the UI can react. Exists mainly so a React
 * component can read this through `useSyncExternalStore`.
 */
export function subscribeToStorageFailure(
  listener: (failure: StorageFailure | null) => void
): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/**
 * Rough size of everything this app keeps in localStorage, in bytes. Used to
 * show the trader how close the journal is to the browser's limit, since the
 * limit itself differs per browser and is not queryable.
 */
export function measureJournalBytes(): number {
  if (typeof window === 'undefined') return 0;
  let total = 0;
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) total += raw.length + key.length;
    } catch {
      // An unreadable key contributes nothing to the total.
    }
  }
  return total;
}

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    // A parse failure is not harmless: the journal silently looks empty and
    // fresh defaults get written back over it on the next edit. Say so.
    console.warn(`Error reading ${key} from storage:`, err);
    reportFailure(err instanceof SyntaxError ? 'corrupt' : 'unavailable', key, err);
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Swallowing this used to lose the write with nothing but a console line:
    // the trader kept working while every save silently stopped landing.
    const kind: StorageFailureKind = isQuotaError(err)
      ? 'quota'
      : isStorageBlockedError(err)
      ? 'unavailable'
      : 'unknown';
    reportFailure(kind, key, err);
  }
}

export const storage = {
  getProfile(): UserProfile {
    return getItem<UserProfile>(STORAGE_KEYS.PROFILE, DEFAULT_PROFILE);
  },

  updateProfile(profile: Partial<UserProfile>): UserProfile {
    const current = this.getProfile();
    const updated: UserProfile = {
      ...current,
      ...profile,
      updatedAt: new Date().toISOString(),
    };
    setItem(STORAGE_KEYS.PROFILE, updated);
    return updated;
  },

  getInstruments(): Instrument[] {
    return getItem<Instrument[]>(STORAGE_KEYS.INSTRUMENTS, DEFAULT_INSTRUMENTS);
  },

  saveInstrument(instrument: Instrument): Instrument[] {
    const list = this.getInstruments();
    const idx = list.findIndex((i) => i.id === instrument.id);
    let updated: Instrument[];
    if (idx >= 0) {
      updated = [...list];
      updated[idx] = instrument;
    } else {
      updated = [...list, instrument];
    }
    setItem(STORAGE_KEYS.INSTRUMENTS, updated);
    return updated;
  },

  /**
   * Merges built-in instruments that arrived after this journal last looked.
   *
   * The same problem the setup catalog has, and the same answer: a stored instrument list
   * wins over the defaults, so a contract added to `DEFAULT_INSTRUMENTS` would otherwise
   * only ever appear on a fresh install. It adds strictly by version, so:
   *
   * - the trader's own contracts, and any edits they made to the built-ins, are untouched,
   *   because nothing already in the list is rewritten, and
   * - a built-in they removed on purpose stays removed: the version it arrived in has
   *   already been recorded, so it is never offered a second time.
   *
   * A contract already in the list is never doubled — matched on symbol or id, since the
   * two are kept in step for the built-ins but a hand-added contract may only have one.
   *
   * Returns the full catalog. On a journal that has never stored one, the defaults are
   * returned and only the version marker is written — the list itself lands in storage the
   * first time the trader actually changes it.
   */
  /** The catalog version this device has been brought up to, or 1 before it was recorded. */
  getInstrumentCatalogVersion(): number {
    const stored = getItem<number>(STORAGE_KEYS.INSTRUMENT_CATALOG, 1);
    return Number.isFinite(stored) && stored > 0 ? stored : 1;
  },

  ensureInstrumentCatalog(): Instrument[] {
    const stored = getItem<Instrument[] | null>(STORAGE_KEYS.INSTRUMENTS, null);
    const current = getItem<number>(STORAGE_KEYS.INSTRUMENT_CATALOG, 1);
    const version = Number.isFinite(current) && current > 0 ? current : 1;

    if (!stored) {
      setItem(STORAGE_KEYS.INSTRUMENT_CATALOG, INSTRUMENT_CATALOG_VERSION);
      return DEFAULT_INSTRUMENTS;
    }

    // Strip contracts that are no longer in the catalog before anything else. The merge
    // below only ever adds, so a journal that received the full complex would keep it for
    // good; this is what brings it back to the three the trader actually uses. It runs on
    // every read, whatever the marker says, because a stale cloud copy can reintroduce the
    // whole list.
    const retired = new Set(RETIRED_INSTRUMENT_IDS.map((id) => id.toLowerCase()));
    const kept = stored.filter((instrument) => !retired.has(instrument.id.trim().toLowerCase()));
    const pruned = kept.length !== stored.length;

    if (version >= INSTRUMENT_CATALOG_VERSION) {
      if (pruned) setItem(STORAGE_KEYS.INSTRUMENTS, kept);
      return kept;
    }

    const known = new Set<string>();
    for (const instrument of kept) {
      known.add(instrument.symbol.trim().toLowerCase());
      known.add(instrument.id.trim().toLowerCase());
    }
    const arrivals = DEFAULT_INSTRUMENTS.filter(
      (instrument) =>
        (instrument.since ?? 1) > version &&
        !known.has(instrument.symbol.trim().toLowerCase()) &&
        !known.has(instrument.id.trim().toLowerCase())
    );

    const merged = arrivals.length ? [...kept, ...arrivals] : kept;
    if (arrivals.length || pruned) setItem(STORAGE_KEYS.INSTRUMENTS, merged);
    setItem(STORAGE_KEYS.INSTRUMENT_CATALOG, INSTRUMENT_CATALOG_VERSION);
    return merged;
  },

  getSetups(): Setup[] {
    return getItem<Setup[]>(STORAGE_KEYS.SETUPS, DEFAULT_SETUPS);
  },

  /**
   * Merges built-in setups that arrived after this journal last looked.
   *
   * Without this, a catalog addition is invisible to anyone who already has a journal: the
   * stored setup list wins over the defaults, so new built-ins would only ever appear on a
   * fresh install. It adds strictly by version, and only what is missing by name, so:
   *
   * - a trader's own setups are untouched, and
   * - a built-in they deleted on purpose stays deleted, because the version it arrived in
   *   has already been recorded and it is never offered again.
   *
   * Returns the full catalog. On a journal that has never stored one, the defaults are
   * returned and only the version marker is written — the catalog itself lands in storage
   * the first time the trader actually changes it.
   */
  ensureSetupCatalog(): Setup[] {
    const stored = getItem<Setup[] | null>(STORAGE_KEYS.SETUPS, null);
    const current = getItem<number>(STORAGE_KEYS.SETUP_CATALOG, 1);
    const version = Number.isFinite(current) && current > 0 ? current : 1;

    if (!stored) {
      setItem(STORAGE_KEYS.SETUP_CATALOG, SETUP_CATALOG_VERSION);
      return DEFAULT_SETUPS;
    }
    if (version >= SETUP_CATALOG_VERSION) return stored;

    // Both names count as "already here": a setup the trader renamed still occupies the
    // built-in it came from, so a later release must not add that built-in back.
    const known = new Set<string>();
    for (const setup of stored) {
      known.add(setup.name.trim().toLowerCase());
      if (setup.builtinName) known.add(setup.builtinName.trim().toLowerCase());
    }
    const arrivals = DEFAULT_SETUPS.filter(
      (setup) => (setup.since ?? 1) > version && !known.has(setup.name.trim().toLowerCase())
    );

    const merged = arrivals.length ? [...stored, ...arrivals] : stored;
    if (arrivals.length) setItem(STORAGE_KEYS.SETUPS, merged);
    setItem(STORAGE_KEYS.SETUP_CATALOG, SETUP_CATALOG_VERSION);
    return merged;
  },

  saveSetup(setupOrName: Setup | string): Setup[] {
    const list = this.getSetups();
    if (typeof setupOrName === 'string') {
      const trimmed = setupOrName.trim();
      if (!trimmed) return list;
      const exists = list.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
      if (exists) return list;

      const newSetup: Setup = {
        id: `setup-${Date.now()}`,
        name: trimmed,
        active: true,
        createdAt: new Date().toISOString(),
      };
      const updated = [...list, newSetup];
      setItem(STORAGE_KEYS.SETUPS, updated);
      return updated;
    } else {
      const idx = list.findIndex((s) => s.id === setupOrName.id);
      const previous = idx >= 0 ? list[idx] : undefined;
      // Every save goes through here, including the Playbook's edit sheet, so a rename
      // cannot slip past the one place that keeps the built-in link alive.
      const next = keepBuiltinLink(setupOrName, previous);
      let updated: Setup[];
      if (idx >= 0) {
        updated = [...list];
        updated[idx] = next;
      } else {
        updated = [...list, next];
      }
      setItem(STORAGE_KEYS.SETUPS, updated);
      return updated;
    }
  },

  /**
   * Renames one setup, keeping its place in the order.
   *
   * Returns null when the name is empty, or when another setup already answers to it — the
   * caller shows its own message for both, and this is the guard behind it. Names are
   * compared case-insensitively because two setups that differ only by case are the same
   * setup as far as the dropdown and the analytics are concerned.
   */
  renameSetup(id: string, name: string): Setup[] | null {
    const list = this.getSetups();
    const index = list.findIndex((setup) => setup.id === id);
    if (index < 0) return null;

    const trimmed = name.trim();
    if (!trimmed) return null;
    const taken = list.some(
      (setup) => setup.id !== id && setup.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (taken) return null;
    if (list[index].name === trimmed) return list;

    return this.saveSetup({ ...list[index], name: trimmed });
  },

  /**
   * Reorders the catalog to the given ids.
   *
   * Anything not named is appended in its current order rather than dropped, so a caller
   * working from a stale list can never delete a setup by reordering.
   */
  reorderSetups(orderedIds: string[]): Setup[] {
    const list = this.getSetups();
    const byId = new Map(list.map((setup) => [setup.id, setup]));
    const reordered: Setup[] = [];

    for (const id of orderedIds) {
      const setup = byId.get(id);
      if (setup) {
        reordered.push(setup);
        byId.delete(id);
      }
    }
    for (const setup of list) {
      if (byId.has(setup.id)) reordered.push(setup);
    }

    setItem(STORAGE_KEYS.SETUPS, reordered);
    return reordered;
  },

  /**
   * How many logged trades and planned days still refer to a setup by name.
   *
   * Counted before a rename is applied, because a rename does not touch the journal: a
   * trade records the name it was logged with, which is deliberate. It means history keeps
   * saying what it said at the time, and the count is what lets the trader decide whether
   * to bring the old entries along.
   */
  countSetupReferences(name: string): { trades: number; days: number } {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return { trades: 0, days: 0 };

    const trades = this.getTrades().filter(
      (trade) => (trade.setupName ?? '').trim().toLowerCase() === wanted
    ).length;
    const days = this.getTradingDays().filter((day) =>
      (day.watchedSetups ?? []).some((entry) => entry.trim().toLowerCase() === wanted)
    ).length;

    return { trades, days };
  },

  /**
   * Moves the entries that refer to a setup onto its new name.
   *
   * Separate from the rename on purpose: renaming a setup and rewriting what the journal
   * already recorded are different decisions, and this one is only made when the trader
   * asks for it.
   */
  relabelSetupReferences(oldName: string, newName: string): { trades: number; days: number } {
    const from = oldName.trim().toLowerCase();
    const to = newName.trim();
    if (!from || !to || from === to.toLowerCase()) return { trades: 0, days: 0 };

    const trades = this.getTrades();
    let tradesChanged = 0;
    const nextTrades = trades.map((trade) => {
      if ((trade.setupName ?? '').trim().toLowerCase() !== from) return trade;
      tradesChanged += 1;
      return { ...trade, setupName: to, updatedAt: new Date().toISOString() };
    });
    if (tradesChanged) setItem(STORAGE_KEYS.TRADES, nextTrades);

    const days = this.getTradingDays();
    let daysChanged = 0;
    const nextDays = days.map((day) => {
      const watched = day.watchedSetups ?? [];
      if (!watched.some((entry) => entry.trim().toLowerCase() === from)) return day;
      daysChanged += 1;
      return {
        ...day,
        watchedSetups: watched.map((entry) =>
          entry.trim().toLowerCase() === from ? to : entry
        ),
        updatedAt: new Date().toISOString(),
      };
    });
    if (daysChanged) setItem(STORAGE_KEYS.DAYS, nextDays);

    return { trades: tradesChanged, days: daysChanged };
  },

  deleteSetup(id: string): Setup[] {
    const list = this.getSetups().filter((s) => s.id !== id);
    setItem(STORAGE_KEYS.SETUPS, list);
    return list;
  },

  toggleSetupActive(id: string): Setup[] {
    const list = this.getSetups();
    const updated = list.map((s) => (s.id === id ? { ...s, active: !s.active } : s));
    setItem(STORAGE_KEYS.SETUPS, updated);
    return updated;
  },

  getTradingDays(): TradingDay[] {
    return getItem<TradingDay[]>(STORAGE_KEYS.DAYS, []);
  },

  getTradingDayById(id: string): TradingDay | undefined {
    return this.getTradingDays().find((d) => d.id === id);
  },

  getTradingDayByDate(dateStr: string): TradingDay | undefined {
    return this.getTradingDays().find((d) => d.tradeDate === dateStr);
  },

  getOrCreateToday(): TradingDay {
    const profile = this.getProfile();
    // The session date, not the calendar date: a Saturday rolls back to Friday so the app never
    // opens a day the market cannot trade on.
    const todayStr = getCurrentTradingSessionDate(profile.timezone);
    const existing = this.getTradingDayByDate(todayStr);

    if (existing) {
      return existing;
    }

    const newDay: TradingDay = {
      id: `day-${todayStr}`,
      userId: profile.id,
      tradeDate: todayStr,
      status: 'planning',
      riskMode: 'normal',
      normalLossLimit: profile.defaultDailyLossLimit || 100,
      plannedLossLimit: profile.defaultDailyLossLimit || 100,
      contractsPlanned: 1,
      primaryInstrument: profile.defaultInstrument || 'MES',
      allowedSessions: ['Regular Session'],
      marketBias: 'neutral',
      // A fresh day watches the two set-ups the app is built around — the trader's own
      // level plays — rather than a mix of a catalog: the plan should start pointed at
      // what they actually trade.
      watchedSetups: [...FOCUS_SETUP_NAMES],
      // Trade #1 is the default slot, so recording a trade always has a risk attached.
      defaultRiskTier: 1,
      importantLevels: [],
      waitingFor: '',
      stayOutIf: '',
      notes: '',
      planChanges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const days = this.getTradingDays();
    const updated = [newDay, ...days];
    setItem(STORAGE_KEYS.DAYS, updated);
    return newDay;
  },

  deleteTradingDay(dayId: string): void {
    setItem(
      STORAGE_KEYS.DAYS,
      this.getTradingDays().filter((day) => day.id !== dayId)
    );
    setItem(
      STORAGE_KEYS.TRADES,
      this.getTrades().filter((trade) => trade.tradingDayId !== dayId)
    );
    setItem(
      STORAGE_KEYS.REVIEWS,
      this.getReviews().filter((review) => review.tradingDayId !== dayId)
    );
  },

  saveTradingDay(day: TradingDay): TradingDay {
    const days = this.getTradingDays();
    const idx = days.findIndex((d) => d.id === day.id);
    const updatedDay: TradingDay = {
      ...day,
      updatedAt: new Date().toISOString(),
    };

    let updatedList: TradingDay[];
    if (idx >= 0) {
      updatedList = [...days];
      updatedList[idx] = updatedDay;
    } else {
      updatedList = [updatedDay, ...days];
    }

    setItem(STORAGE_KEYS.DAYS, updatedList);
    return updatedDay;
  },

  /**
   * Undoes a plan lock so the trader can carry on planning, or unlock after
   * locking by mistake. Returns the reopened day.
   */
  unlockPlan(dayId: string): TradingDay | undefined {
    const day = this.getTradingDayById(dayId);
    if (!day) return undefined;

    return this.saveTradingDay({
      ...day,
      status: day.status === 'active' ? 'planning' : day.status,
      lockedAt: undefined,
      lockedSnapshot: undefined,
    });
  },

  lockPlan(dayId: string): TradingDay | undefined {
    const day = this.getTradingDayById(dayId);
    if (!day) return undefined;

    const lockedAt = new Date().toISOString();
    const lockedSnapshot: PlanSnapshot = {
      riskMode: day.riskMode,
      normalLossLimit: day.normalLossLimit,
      plannedLossLimit: day.plannedLossLimit,
      contractsPlanned: day.contractsPlanned,
      primaryInstrument: day.primaryInstrument,
      allowedSessions: [...day.allowedSessions],
      marketBias: day.marketBias,
      defaultRiskTier: day.defaultRiskTier,
      riskTierCaps: day.riskTierCaps ? [...day.riskTierCaps] : undefined,
      lockedAt,
    };

    const updated: TradingDay = {
      ...day,
      status: day.status === 'planning' ? 'active' : day.status,
      lockedAt,
      lockedSnapshot,
      updatedAt: lockedAt,
    };

    return this.saveTradingDay(updated);
  },

  recordPlanChange(
    dayId: string,
    change: { fieldName: string; oldValue: string; newValue: string; reason: string }
  ): TradingDay | undefined {
    const day = this.getTradingDayById(dayId);
    if (!day) return undefined;

    const newRecord: PlanChange = {
      id: `pc-${Date.now()}`,
      tradingDayId: dayId,
      fieldName: change.fieldName,
      oldValue: change.oldValue,
      newValue: change.newValue,
      reason: change.reason,
      changedAt: new Date().toISOString(),
    };

    const updated: TradingDay = {
      ...day,
      planChanges: [...(day.planChanges || []), newRecord],
      updatedAt: new Date().toISOString(),
    };

    return this.saveTradingDay(updated);
  },

  getTrades(): Trade[] {
    return getItem<Trade[]>(STORAGE_KEYS.TRADES, []);
  },

  getTradesForDay(dayId: string): Trade[] {
    return this.getTrades().filter((t) => t.tradingDayId === dayId);
  },

  saveTrade(trade: Trade): Trade {
    const trades = this.getTrades();
    const idx = trades.findIndex((t) => t.id === trade.id);
    const updatedTrade: Trade = {
      ...trade,
      updatedAt: new Date().toISOString(),
    };

    let updatedList: Trade[];
    if (idx >= 0) {
      updatedList = [...trades];
      updatedList[idx] = updatedTrade;
    } else {
      updatedList = [updatedTrade, ...trades];
    }

    setItem(STORAGE_KEYS.TRADES, updatedList);
    return updatedTrade;
  },

  deleteTrade(tradeId: string): void {
    const trades = this.getTrades().filter((t) => t.id !== tradeId);
    setItem(STORAGE_KEYS.TRADES, trades);
  },

  getReviews(): DailyReview[] {
    return getItem<DailyReview[]>(STORAGE_KEYS.REVIEWS, []);
  },

  getReviewForDay(dayId: string): DailyReview | undefined {
    return this.getReviews().find((r) => r.tradingDayId === dayId);
  },

  saveDailyReview(review: DailyReview): DailyReview {
    const reviews = this.getReviews();
    const idx = reviews.findIndex((r) => r.id === review.id || r.tradingDayId === review.tradingDayId);
    const updatedReview: DailyReview = {
      ...review,
      updatedAt: new Date().toISOString(),
    };

    let updatedList: DailyReview[];
    if (idx >= 0) {
      updatedList = [...reviews];
      updatedList[idx] = updatedReview;
    } else {
      updatedList = [updatedReview, ...reviews];
    }

    setItem(STORAGE_KEYS.REVIEWS, updatedList);

    // Also mark the corresponding trading day as completed
    const day = this.getTradingDayById(review.tradingDayId);
    if (day) {
      this.saveTradingDay({
        ...day,
        status: 'completed',
        endedAt: new Date().toISOString(),
      });
    }

    return updatedReview;
  },

  /**
   * The lesson the trader acknowledged, or null. Shape-validated on read: a stored ack
   * missing its date or text is treated as no acknowledgement rather than as a match for
   * whatever lesson happens to be showing.
   */
  /**
   * Sets aside a journal copy a sync is about to replace. Returns whether it was kept.
   *
   * Only the most recent copy is held: this is a safety net for the work that was just
   * displaced, not a version history, and keeping several copies of a journal full of
   * base64 charts would be what fills the browser up.
   */
  saveRecoveryCopy(json: string, reason: string): boolean {
    if (typeof window === 'undefined') return false;
    if (json.length > RECOVERY_COPY_LIMIT_BYTES) {
      console.warn('Skipped the recovery copy: the journal is too large to hold twice.');
      return false;
    }
    const copy: RecoveryCopy = { json, savedAt: new Date().toISOString(), reason };
    try {
      localStorage.setItem(STORAGE_KEYS.RECOVERY, JSON.stringify(copy));
      return true;
    } catch (err) {
      // Deliberately not reported through the storage-failure banner: the trader did not
      // lose anything here, they simply have no extra copy, and a failed write is already
      // reported by whatever was writing.
      console.warn('Could not set aside a recovery copy:', err);
      return false;
    }
  },

  /** The copy set aside by the last sync, or null when there is none. */
  getRecoveryCopy(): RecoveryCopy | null {
    const copy = getItem<RecoveryCopy | null>(STORAGE_KEYS.RECOVERY, null);
    if (!copy || typeof copy.json !== 'string' || !copy.json) return null;
    return {
      json: copy.json,
      savedAt: typeof copy.savedAt === 'string' ? copy.savedAt : '',
      reason: typeof copy.reason === 'string' ? copy.reason : '',
    };
  },

  /** Remembers that the trader has seen the recovery copy. */
  clearRecoveryCopy(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(STORAGE_KEYS.RECOVERY);
    } catch (err) {
      console.warn('Could not clear the recovery copy:', err);
    }
  },

  getLessonAck(): LessonAcknowledgement | null {
    const ack = getItem<LessonAcknowledgement | null>(STORAGE_KEYS.LESSON_ACK, null);
    if (!ack || typeof ack.date !== 'string' || typeof ack.focus !== 'string') return null;
    return {
      date: ack.date,
      focus: ack.focus,
      acknowledgedAt:
        typeof ack.acknowledgedAt === 'string' ? ack.acknowledgedAt : new Date().toISOString(),
    };
  },

  saveLessonAck(ack: LessonAcknowledgement): LessonAcknowledgement {
    setItem(STORAGE_KEYS.LESSON_ACK, ack);
    return ack;
  },

  /**
   * The lesson carried forward from the most recent completed review.
   *
   * Carries the review's own media as well as its focus, so the banner that shows the
   * lesson can also show the screenshots and the clip the trader attached to it. The
   * acknowledgement still keys on the date and the focus text, so extra fields here do not
   * disturb which lesson counts as accepted.
   */
  getYesterdayFocus(): { date: string; focus: string; reviewId: string; media: string[] } | null {
    const days = this.getTradingDays()
      .filter((d) => d.status === 'completed')
      .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));

    const reviews = this.getReviews();
    for (const day of days) {
      const rev = reviews.find((r) => r.tradingDayId === day.id);
      if (rev && rev.tomorrowFocus && rev.tomorrowFocus.trim()) {
        return {
          date: day.tradeDate,
          focus: rev.tomorrowFocus.trim(),
          reviewId: rev.id,
          media: rev.media ?? [],
        };
      }
    }
    return null;
  },

  /**
   * The whole journal as one object, built the same way the export is.
   *
   * Exists so a bulk rewrite — the media migration, which has to replace a picture on every
   * record at once — can read the journal, hand it to a transform and adopt the result, rather
   * than each caller reassembling the snapshot and missing a key. Writing it back is the
   * existing `importData`, so there is one path that replaces a whole journal and not two.
   */
  readState(): StorageState {
    return {
      profile: this.getProfile(),
      instruments: this.getInstruments(),
      instrumentCatalogVersion: this.getInstrumentCatalogVersion(),
      setups: this.getSetups(),
      tradingDays: this.getTradingDays(),
      trades: this.getTrades(),
      reviews: this.getReviews(),
      patternStudies: this.getPatternStudies(),
      levelTouches: this.getLevelTouches(),
      markedLevels: this.getMarkedLevels(),
      levelOutlooks: this.getLevelOutlooks(),
      sessionExtremes: this.getSessionExtremes(),
      chartSearches: this.getChartSearches(),
      lessons: this.getLessons(),
      coachPlans: this.getCoachPlans(),
      feedback: this.getFeedback(),
      lessonAck: this.getLessonAck(),
    };
  },

  exportAllData(): string {
    return JSON.stringify(this.readState(), null, 2);
  },

  importData(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr) as Partial<StorageState>;
      if (parsed.profile) setItem(STORAGE_KEYS.PROFILE, parsed.profile);
      if (parsed.instruments) {
        setItem(STORAGE_KEYS.INSTRUMENTS, parsed.instruments);
        // The version must move with the instruments, or the merge in
        // `ensureInstrumentCatalog` reads the device's own current marker against a list
        // that never reached it and skips exactly the contracts the snapshot is missing.
        // A snapshot that carries no version predates the field, so it is read as 1 and
        // the whole built-in catalog is brought up to date.
        const version =
          typeof parsed.instrumentCatalogVersion === 'number' &&
          parsed.instrumentCatalogVersion > 0
            ? parsed.instrumentCatalogVersion
            : 1;
        setItem(STORAGE_KEYS.INSTRUMENT_CATALOG, version);
      }
      if (parsed.setups) setItem(STORAGE_KEYS.SETUPS, parsed.setups);
      if (parsed.tradingDays) setItem(STORAGE_KEYS.DAYS, parsed.tradingDays);
      if (parsed.trades) setItem(STORAGE_KEYS.TRADES, parsed.trades);
      if (parsed.reviews) setItem(STORAGE_KEYS.REVIEWS, parsed.reviews);
      // Only touched when the file actually carries it, so importing an older backup
      // cannot wipe study notes that are already here.
      if (parsed.patternStudies) setItem(STORAGE_KEYS.PATTERN_STUDIES, parsed.patternStudies);
      if (parsed.levelTouches) setItem(STORAGE_KEYS.LEVEL_TOUCHES, parsed.levelTouches);
      if (parsed.markedLevels) setItem(STORAGE_KEYS.MARKED_LEVELS, parsed.markedLevels);
      if (parsed.levelOutlooks) setItem(STORAGE_KEYS.LEVEL_OUTLOOKS, parsed.levelOutlooks);
      if (parsed.sessionExtremes) setItem(STORAGE_KEYS.SESSION_EXTREMES, parsed.sessionExtremes);
      if (parsed.chartSearches) setItem(STORAGE_KEYS.CHART_SEARCHES, parsed.chartSearches);
      if (parsed.lessons) setItem(STORAGE_KEYS.LESSONS, parsed.lessons);
      if (parsed.coachPlans) setItem(STORAGE_KEYS.COACH_PLANS, parsed.coachPlans);
      if (parsed.feedback) setItem(STORAGE_KEYS.FEEDBACK, parsed.feedback);
      // Written even when null (an explicit "nothing acknowledged"), so adopting a snapshot
      // carries that state across too. A backup taken before this existed has no key at
      // all and leaves what is here untouched.
      if (parsed.lessonAck !== undefined) setItem(STORAGE_KEYS.LESSON_ACK, parsed.lessonAck);
      return true;
    } catch (err) {
      console.error('Import failed:', err);
      return false;
    }
  },

  getPatternStudies(): PatternStudy[] {
    return getItem<PatternStudy[]>(STORAGE_KEYS.PATTERN_STUDIES, []);
  },

  getPatternStudy(patternId: string): PatternStudy | undefined {
    return this.getPatternStudies().find((study) => study.patternId === patternId);
  },

  /**
   * Upserts one pattern's study row. Rows are keyed by pattern, so this is both the
   * create and the update path and there is never a duplicate row to reconcile.
   */
  savePatternStudy(study: PatternStudy): PatternStudy[] {
    const studies = this.getPatternStudies();
    const index = studies.findIndex((existing) => existing.patternId === study.patternId);
    const updated: PatternStudy = { ...study, updatedAt: new Date().toISOString() };
    const next =
      index >= 0
        ? [...studies.slice(0, index), updated, ...studies.slice(index + 1)]
        : [...studies, updated];
    setItem(STORAGE_KEYS.PATTERN_STUDIES, next);
    return next;
  },

  getLevelTouches(): LevelTouch[] {
    return getItem<LevelTouch[]>(STORAGE_KEYS.LEVEL_TOUCHES, []);
  },

  getLevelTouchesForDay(dayId: string): LevelTouch[] {
    return this.getLevelTouches().filter((touch) => touch.tradingDayId === dayId);
  },

  /**
   * Upserts one level touch, newest first.
   *
   * A touch is edited as it is watched — the outcome moves from `watching` to
   * `never-returned` or `returned` as price either stays away or comes back — so this
   * is both the create and the update path, keyed by id rather than a separate pair.
   */
  saveLevelTouch(touch: LevelTouch): LevelTouch {
    const touches = this.getLevelTouches();
    const index = touches.findIndex((existing) => existing.id === touch.id);
    const updated: LevelTouch = { ...touch, updatedAt: new Date().toISOString() };
    const next =
      index >= 0
        ? [...touches.slice(0, index), updated, ...touches.slice(index + 1)]
        : [updated, ...touches];
    setItem(STORAGE_KEYS.LEVEL_TOUCHES, next);
    return updated;
  },

  deleteLevelTouch(id: string): void {
    setItem(
      STORAGE_KEYS.LEVEL_TOUCHES,
      this.getLevelTouches().filter((touch) => touch.id !== id)
    );
  },

  /** Every level the trader has marked, newest first. */
  getMarkedLevels(): MarkedLevel[] {
    return getItem<MarkedLevel[]>(STORAGE_KEYS.MARKED_LEVELS, []);
  },

  getMarkedLevelsForDay(dayId: string): MarkedLevel[] {
    return this.getMarkedLevels().filter((level) => level.tradingDayId === dayId);
  },

  /**
   * Upserts one marked level, newest first, keyed by id.
   *
   * A level is edited after it is written down — a price is corrected, a label is added — so
   * this is both the create and the update path, the same way every other record here is.
   */
  saveMarkedLevel(level: MarkedLevel): MarkedLevel[] {
    const levels = this.getMarkedLevels();
    const index = levels.findIndex((existing) => existing.id === level.id);
    const updated: MarkedLevel = { ...level, updatedAt: new Date().toISOString() };
    const next =
      index >= 0
        ? [...levels.slice(0, index), updated, ...levels.slice(index + 1)]
        : [updated, ...levels];
    setItem(STORAGE_KEYS.MARKED_LEVELS, next);
    return next;
  },

  /**
   * Adds a batch of levels at once, which is how the indicator's lines arrive.
   *
   * Re-pasting the same lines must not pile up duplicates, so a level whose day, instrument,
   * side, timeframe and price are already on the record is skipped rather than added a second
   * time. The timeframe is part of that key on purpose: the same price can be a real support line
   * on the 5m chart and again on the 1h chart, and the two are different records — the trader
   * marks each chart separately. The list is returned rather than only written because the
   * caller shows what was actually kept.
   */
  saveMarkedLevels(levels: MarkedLevel[]): MarkedLevel[] {
    const existing = this.getMarkedLevels();
    // Legacy levels marked before timeframes existed carry none; `''` buckets them together
    // rather than letting a missing label collide with a real chart.
    const keyOf = (level: MarkedLevel) =>
      `${level.tradingDayId}|${level.instrumentId}|${level.timeframe ?? ''}|${level.kind}|${level.price}`;
    const seen = new Set(existing.map(keyOf));
    const added: MarkedLevel[] = [];
    for (const level of levels) {
      const key = keyOf(level);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(level);
    }
    if (added.length === 0) return existing;
    const next = [...added, ...existing];
    setItem(STORAGE_KEYS.MARKED_LEVELS, next);
    return next;
  },

  deleteMarkedLevel(id: string): MarkedLevel[] {
    const next = this.getMarkedLevels().filter((level) => level.id !== id);
    setItem(STORAGE_KEYS.MARKED_LEVELS, next);
    return next;
  },

  /** Every daily outlook the trader has written, newest first. */
  getLevelOutlooks(): LevelOutlook[] {
    return getItem<LevelOutlook[]>(STORAGE_KEYS.LEVEL_OUTLOOKS, []);
  },

  getLevelOutlook(dayId: string, instrumentId: string): LevelOutlook | undefined {
    return this.getLevelOutlooks().find(
      (outlook) => outlook.tradingDayId === dayId && outlook.instrumentId === instrumentId
    );
  },

  /**
   * Upserts one outlook, keyed by day and instrument as well as id.
   *
   * Chosen once and changed as the day's read firms up, so this is both the create and the
   * edit path. Matching on the day and instrument as well as the id means a record written by
   * an older client under a different id is corrected rather than duplicated.
   */
  saveLevelOutlook(outlook: LevelOutlook): LevelOutlook[] {
    const outlooks = this.getLevelOutlooks();
    const index = outlooks.findIndex(
      (existing) =>
        existing.id === outlook.id ||
        (existing.tradingDayId === outlook.tradingDayId &&
          existing.instrumentId === outlook.instrumentId)
    );
    const updated: LevelOutlook = { ...outlook, updatedAt: new Date().toISOString() };
    const next =
      index >= 0
        ? [...outlooks.slice(0, index), updated, ...outlooks.slice(index + 1)]
        : [updated, ...outlooks];
    setItem(STORAGE_KEYS.LEVEL_OUTLOOKS, next);
    return next;
  },

  deleteLevelOutlook(id: string): LevelOutlook[] {
    const next = this.getLevelOutlooks().filter((outlook) => outlook.id !== id);
    setItem(STORAGE_KEYS.LEVEL_OUTLOOKS, next);
    return next;
  },

  getSessionExtremes(): SessionExtreme[] {
    return getItem<SessionExtreme[]>(STORAGE_KEYS.SESSION_EXTREMES, []);
  },

  /**
   * Upserts one session extreme, newest first.
   *
   * A record replaces the reading it is the SAME reading of, and nothing else. That is the
   * whole identity of a print: symbol, date, kind, window, chart and the clock time it
   * printed at. Passing in the same one again corrects it — a typo in the price is fixed
   * rather than sitting beside its fix — while two different prints are both kept.
   *
   * The clock time is part of that identity. It was left out once, on the reasoning that a
   * window holds a single high or low; but a trader watching a session logs the level every
   * time price leaves one, and the log exists precisely to keep every print the coach is to
   * watch. Without the time, the second print in a window silently overwrote the first, and
   * a level the trader had entered simply disappeared.
   *
   * The chart is part of the identity too, and not part of the label: a 30-minute high and a
   * 1-minute high in the same hour are two different readings of the session, and saving one
   * over the other would quietly delete a print the trader drew a line from.
   */
  saveSessionExtreme(extreme: SessionExtreme): SessionExtreme {
    const extremes = this.getSessionExtremes();
    const updated: SessionExtreme = { ...extreme, updatedAt: new Date().toISOString() };
    const at = (value: string | undefined) => (value ?? '').trim();
    const next = extremes.filter(
      (existing) =>
        existing.id !== extreme.id &&
        !(
          existing.symbol === extreme.symbol &&
          existing.tradeDate === extreme.tradeDate &&
          existing.kind === extreme.kind &&
          existing.window === extreme.window &&
          timeframeOf(existing) === timeframeOf(extreme) &&
          at(existing.time) === at(extreme.time)
        )
    );
    setItem(STORAGE_KEYS.SESSION_EXTREMES, [updated, ...next]);
    return updated;
  },

  deleteSessionExtreme(id: string): void {
    setItem(
      STORAGE_KEYS.SESSION_EXTREMES,
      this.getSessionExtremes().filter((extreme) => extreme.id !== id)
    );
  },

  getChartSearches(): ChartSearch[] {
    return getItem<ChartSearch[]>(STORAGE_KEYS.CHART_SEARCHES, []);
  },

  /**
   * Adds one picture search, newest first, and drops the oldest past the cap.
   *
   * Every run is its own record rather than an upsert by chart: the trader is asking the
   * same question of a different picture, or a different question of the same one, and the
   * point of the history is to compare searches over time. The cap is what keeps a list of
   * charts — each carrying a thumbnail — from filling the browser's storage on its own.
   */
  saveChartSearch(search: ChartSearch): ChartSearch[] {
    const next = [search, ...this.getChartSearches()].slice(0, MAX_CHART_SEARCHES);
    setItem(STORAGE_KEYS.CHART_SEARCHES, next);
    return next;
  },

  deleteChartSearch(id: string): ChartSearch[] {
    const next = this.getChartSearches().filter((search) => search.id !== id);
    setItem(STORAGE_KEYS.CHART_SEARCHES, next);
    return next;
  },

  clearChartSearches(): void {
    setItem(STORAGE_KEYS.CHART_SEARCHES, []);
  },

  getLessons(): Lesson[] {
    return getItem<Lesson[]>(STORAGE_KEYS.LESSONS, []);
  },

  /**
   * Upserts one lesson, newest first, keyed by id.
   *
   * A lesson is edited as it grows — the note gets rewritten, a second clip is attached, a
   * tag is added — so this is both the create and the update path, the same way the
   * level-touch log is. The list is not capped: these are the trader's own findings, and
   * dropping the oldest to make room would delete the very material the feature exists to
   * keep. Charts attached as screenshots are data URLs, so storage pressure is handled
   * where every other attachment is, by the failure report rather than by silent deletion.
   */
  saveLesson(lesson: Lesson): Lesson[] {
    const lessons = this.getLessons();
    const index = lessons.findIndex((existing) => existing.id === lesson.id);
    const updated: Lesson = { ...lesson, updatedAt: new Date().toISOString() };
    const next =
      index >= 0
        ? [...lessons.slice(0, index), updated, ...lessons.slice(index + 1)]
        : [updated, ...lessons];
    setItem(STORAGE_KEYS.LESSONS, next);
    return next;
  },

  deleteLesson(id: string): Lesson[] {
    const next = this.getLessons().filter((lesson) => lesson.id !== id);
    setItem(STORAGE_KEYS.LESSONS, next);
    return next;
  },

  /**
   * Stamps the lessons the coach just read with the moment it happened.
   *
   * A separate write from `saveLesson` on purpose: it only touches `lastReadAt` on the ids
   * that were in the read, so it can never rewrite a note or drop media, and it leaves
   * `updatedAt` alone because nothing the trader wrote changed.
   */
  markLessonsRead(ids: string[], at: string): Lesson[] {
    const wanted = new Set(ids);
    const next = this.getLessons().map((lesson) =>
      wanted.has(lesson.id) ? { ...lesson, lastReadAt: at } : lesson
    );
    setItem(STORAGE_KEYS.LESSONS, next);
    return next;
  },

  /** The coach's own plans, newest first. */
  getCoachPlans(): CoachPlan[] {
    return getItem<CoachPlan[]>(STORAGE_KEYS.COACH_PLANS, []);
  },

  /**
   * Upserts one coach plan, newest first.
   *
   * The create path and the grading path are the same write on purpose: grading a plan is
   * not a new record, it is the trader's judgement landing on the plan they were shown, and
   * it has to keep the levels and reasoning that were actually on screen.
   */
  saveCoachPlan(plan: CoachPlan): CoachPlan[] {
    const plans = this.getCoachPlans();
    const index = plans.findIndex((existing) => existing.id === plan.id);
    const next =
      index >= 0
        ? [...plans.slice(0, index), plan, ...plans.slice(index + 1)]
        : [plan, ...plans];
    setItem(STORAGE_KEYS.COACH_PLANS, next);
    return next;
  },

  deleteCoachPlan(id: string): CoachPlan[] {
    const next = this.getCoachPlans().filter((plan) => plan.id !== id);
    setItem(STORAGE_KEYS.COACH_PLANS, next);
    return next;
  },

  /** The notes the trader left about the app itself, newest first. */
  getFeedback(): FeedbackNote[] {
    return getItem<FeedbackNote[]>(STORAGE_KEYS.FEEDBACK, []);
  },

  /**
   * Upserts one note, newest first, keyed by id.
   *
   * Writing a note and marking one fixed are the same write on purpose: resolving a note is
   * a change to the note that was already written, so it keeps its place in the list rather
   * than jumping to the front as if it were new.
   */
  saveFeedback(note: FeedbackNote): FeedbackNote[] {
    const notes = this.getFeedback();
    const index = notes.findIndex((existing) => existing.id === note.id);
    const updated: FeedbackNote = { ...note, updatedAt: new Date().toISOString() };
    const next =
      index >= 0
        ? [...notes.slice(0, index), updated, ...notes.slice(index + 1)]
        : [updated, ...notes];
    setItem(STORAGE_KEYS.FEEDBACK, next);
    return next;
  },

  deleteFeedback(id: string): FeedbackNote[] {
    const next = this.getFeedback().filter((note) => note.id !== id);
    setItem(STORAGE_KEYS.FEEDBACK, next);
    return next;
  },

  /**
   * Clears every journal entry — trades, daily plans and reviews — while
   * keeping the trader's settings, instruments and playbook set-ups. This is
   * the "start fresh" reset, and it cannot be undone.
   *
   * Pattern study rows are deliberately kept: they are playbook material, like the
   * set-ups and their reference charts, not journal entries. Sign-out clears them with
   * everything else, because they belong to the account rather than to the device.
   */
  resetJournal(): void {
    if (typeof window === 'undefined') return;
    // The acknowledgement goes with the reviews it came from: leaving it behind would have
    // the app report a lesson as accepted that no longer exists anywhere in the journal.
    for (const key of [
      STORAGE_KEYS.DAYS,
      STORAGE_KEYS.TRADES,
      STORAGE_KEYS.REVIEWS,
      // The touches are the record of what a level did; they go with the days they
      // were taken on, unlike the playbook material that survives a reset.
      STORAGE_KEYS.LEVEL_TOUCHES,
      // The levels themselves were marked for the same sessions the touches were logged
      // on, so they go with the touches rather than outliving the journal they described.
      STORAGE_KEYS.MARKED_LEVELS,
      // The outlooks describe the same day's market as the levels they were written beside.
      STORAGE_KEYS.LEVEL_OUTLOOKS,
      // The extremes are the same kind of thing: a record of one session, not material
      // about the trader's setups.
      STORAGE_KEYS.SESSION_EXTREMES,
      // The picture searches matched against the trades that are about to be deleted, so
      // they go with them rather than outliving the journal they describe.
      STORAGE_KEYS.CHART_SEARCHES,
      // A coach plan is tied to the day's market, so it goes with the days it was made for.
      STORAGE_KEYS.COACH_PLANS,
      STORAGE_KEYS.LESSON_ACK,
      // "Nothing can be undone" is the promise this reset makes, so the copy set aside
      // from before it goes too rather than becoming a way to undo it after all.
      STORAGE_KEYS.RECOVERY,
    ]) {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.warn(`Error resetting ${key}:`, err);
      }
    }
    // Saved coach notes describe the trades that just got deleted, so they go too.
    clearCachedNotes();
  },

  /** Removes the journal from this device. Used on sign-out so the next
   *  account on this browser never inherits the previous user's data. */
  clearJournal(): void {
    if (typeof window === 'undefined') return;
    for (const key of [
      STORAGE_KEYS.PROFILE,
      STORAGE_KEYS.INSTRUMENTS,
      STORAGE_KEYS.INSTRUMENT_CATALOG,
      STORAGE_KEYS.SETUPS,
      STORAGE_KEYS.DAYS,
      STORAGE_KEYS.TRADES,
      STORAGE_KEYS.REVIEWS,
      STORAGE_KEYS.PATTERN_STUDIES,
      STORAGE_KEYS.LEVEL_TOUCHES,
      STORAGE_KEYS.MARKED_LEVELS,
      STORAGE_KEYS.LEVEL_OUTLOOKS,
      STORAGE_KEYS.SESSION_EXTREMES,
      STORAGE_KEYS.CHART_SEARCHES,
      STORAGE_KEYS.LESSONS,
      STORAGE_KEYS.COACH_PLANS,
      STORAGE_KEYS.FEEDBACK,
      STORAGE_KEYS.SETUP_CATALOG,
      STORAGE_KEYS.LESSON_ACK,
      STORAGE_KEYS.RECOVERY,
      STORAGE_KEYS.SEEDED,
    ]) {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.warn(`Error clearing ${key} from storage:`, err);
      }
    }
    // Coach notes are per-account; the next user must not inherit them.
    clearCachedNotes();
  },

};
