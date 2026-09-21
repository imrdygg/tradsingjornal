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
} from '../../types';
import { DEFAULT_INSTRUMENTS } from '../trading/instruments';
import { DEFAULT_RISK_TIER_AMOUNTS } from '../trading/risk-tiers';
import { clearCachedNotes } from '../ai/checkpoints';
import { getCurrentTradingDate } from './date-utils';

/**
 * The built-in setup catalog, written out rather than generated so the order is a
 * deliberate rough priority: the level-based and structure setups a day trader reaches
 * for first, then the pattern and context ones, with 'Other' last because it is a
 * catch-all rather than a setup.
 *
 * Every name in this list has a study guide (setup-guides.ts) and bullish/bearish
 * examples (SetupDiagram.tsx) keyed to exactly this spelling. Renaming one here means
 * renaming it in both of those files, or the card falls back to the generic 'Other'
 * content.
 *
 * `since` marks the catalog version a setup arrived in, and it is what lets the catalog
 * grow for a journal that already exists: see `ensureSetupCatalog`. Entries without it
 * predate the versioning and are never re-added once a trader has removed them.
 */

/**
 * The current built-in catalog version. Bump it, and tag the new setups with the new
 * number, when adding setups that existing journals should receive.
 */
export const SETUP_CATALOG_VERSION = 2;

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
  { id: 'engulfing', name: 'Engulfing', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'support', name: 'Support', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'resistance', name: 'Resistance', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'breakout', name: 'Breakout', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'reversal', name: 'Reversal', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'trend-continuation', name: 'Trend Continuation', active: true, createdAt: '2026-01-01T00:00:00Z' },

  // Level and structure plays.
  { id: 'vwap-reclaim', name: 'VWAP Reclaim', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'vwap-rejection', name: 'VWAP Rejection', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'opening-range-breakout', name: 'Opening Range Breakout', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'failed-breakout', name: 'Failed Breakout', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'retest', name: 'Retest of Broken Level', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'trendline-break', name: 'Trendline Break', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'liquidity-sweep', name: 'Liquidity Sweep', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'opening-gap-fill', name: 'Opening Gap Fill', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'gap-and-go', name: 'Gap and Go', active: true, createdAt: '2026-09-20T00:00:00Z', since: 2 },
  { id: 'range-fade', name: 'Range Fade', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'prior-day-high-break', name: 'Prior Day High Break', active: true, createdAt: '2026-09-20T00:00:00Z', since: 2 },
  { id: 'fib-retracement', name: 'Fib Retracement', active: true, createdAt: '2026-09-20T00:00:00Z', since: 2 },

  // Imbalance and order-flow plays.
  { id: 'fair-value-gap', name: 'Fair Value Gap', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'order-block', name: 'Order Block', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'breaker-block', name: 'Breaker Block', active: true, createdAt: '2026-09-20T00:00:00Z', since: 2 },
  { id: 'pullback-to-ema', name: 'Pullback to EMA', active: true, createdAt: '2026-01-01T00:00:00Z' },

  // Classic chart patterns.
  { id: 'double-top', name: 'Double Top', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'double-bottom', name: 'Double Bottom', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'head-and-shoulders', name: 'Head and Shoulders', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'bull-flag', name: 'Bull Flag', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'bear-flag', name: 'Bear Flag', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'inside-bar-break', name: 'Inside Bar Break', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'three-bar-reversal', name: 'Three-Bar Reversal', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'pin-bar', name: 'Pin Bar', active: true, createdAt: '2026-09-20T00:00:00Z', since: 2 },
  { id: 'triangle-breakout', name: 'Triangle Breakout', active: true, createdAt: '2026-09-20T00:00:00Z', since: 2 },

  { id: 'other', name: 'Other', active: true, createdAt: '2026-01-01T00:00:00Z' },
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
  SETUPS: 'ptj_setups_v1',
  DAYS: 'ptj_trading_days_v1',
  TRADES: 'ptj_trades_v1',
  REVIEWS: 'ptj_reviews_v1',
  PATTERN_STUDIES: 'ptj_pattern_studies_v1',
  SETUP_CATALOG: 'ptj_setup_catalog_v1',
  LESSON_ACK: 'ptj_lesson_ack_v1',
  SEEDED: 'ptj_seeded_v1',
  AUTH: 'ptj_auth_status_v1',
  SUPABASE_CONFIG: 'ptj_supabase_config_v1',
};

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
   * The carried-forward lesson the trader has acknowledged, if any.
   *
   * Synced with the journal so acknowledging on the phone holds on the desktop: the
   * acknowledgement is about the lesson, not about the device it was read on.
   */
  lessonAck?: LessonAcknowledgement | null;
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
    const todayStr = getCurrentTradingDate(profile.timezone);
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
      watchedSetups: ['Engulfing', 'Support', 'Resistance'],
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

  getYesterdayFocus(): { date: string; focus: string } | null {
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
        };
      }
    }
    return null;
  },

  exportAllData(): string {
    const state: StorageState = {
      profile: this.getProfile(),
      instruments: this.getInstruments(),
      setups: this.getSetups(),
      tradingDays: this.getTradingDays(),
      trades: this.getTrades(),
      reviews: this.getReviews(),
      patternStudies: this.getPatternStudies(),
      lessonAck: this.getLessonAck(),
    };
    return JSON.stringify(state, null, 2);
  },

  importData(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr) as Partial<StorageState>;
      if (parsed.profile) setItem(STORAGE_KEYS.PROFILE, parsed.profile);
      if (parsed.instruments) setItem(STORAGE_KEYS.INSTRUMENTS, parsed.instruments);
      if (parsed.setups) setItem(STORAGE_KEYS.SETUPS, parsed.setups);
      if (parsed.tradingDays) setItem(STORAGE_KEYS.DAYS, parsed.tradingDays);
      if (parsed.trades) setItem(STORAGE_KEYS.TRADES, parsed.trades);
      if (parsed.reviews) setItem(STORAGE_KEYS.REVIEWS, parsed.reviews);
      // Only touched when the file actually carries it, so importing an older backup
      // cannot wipe study notes that are already here.
      if (parsed.patternStudies) setItem(STORAGE_KEYS.PATTERN_STUDIES, parsed.patternStudies);
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
      STORAGE_KEYS.LESSON_ACK,
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
      STORAGE_KEYS.SETUPS,
      STORAGE_KEYS.DAYS,
      STORAGE_KEYS.TRADES,
      STORAGE_KEYS.REVIEWS,
      STORAGE_KEYS.PATTERN_STUDIES,
      STORAGE_KEYS.SETUP_CATALOG,
      STORAGE_KEYS.LESSON_ACK,
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
