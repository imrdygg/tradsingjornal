import {
  Instrument,
  Setup,
  TradingDay,
  Trade,
  DailyReview,
  UserProfile,
  PlanChange,
  PlanSnapshot,
  PatternStudy,
} from '../../types';
import { DEFAULT_INSTRUMENTS } from '../trading/instruments';
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
 */
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
  { id: 'range-fade', name: 'Range Fade', active: true, createdAt: '2026-01-01T00:00:00Z' },

  // Imbalance and order-flow plays.
  { id: 'fair-value-gap', name: 'Fair Value Gap', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'order-block', name: 'Order Block', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'pullback-to-ema', name: 'Pullback to EMA', active: true, createdAt: '2026-01-01T00:00:00Z' },

  // Classic chart patterns.
  { id: 'double-top', name: 'Double Top', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'double-bottom', name: 'Double Bottom', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'head-and-shoulders', name: 'Head and Shoulders', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'bull-flag', name: 'Bull Flag', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'bear-flag', name: 'Bear Flag', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'inside-bar-break', name: 'Inside Bar Break', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'three-bar-reversal', name: 'Three-Bar Reversal', active: true, createdAt: '2026-01-01T00:00:00Z' },

  { id: 'other', name: 'Other', active: true, createdAt: '2026-01-01T00:00:00Z' },
];

export const DEFAULT_PROFILE: UserProfile = {
  id: 'solo-trader-01',
  displayName: 'Solo MES Trader',
  timezone: 'America/New_York',
  defaultInstrument: 'MES',
  defaultDailyLossLimit: 100,
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
      let updated: Setup[];
      if (idx >= 0) {
        updated = [...list];
        updated[idx] = setupOrName;
      } else {
        updated = [...list, setupOrName];
      }
      setItem(STORAGE_KEYS.SETUPS, updated);
      return updated;
    }
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
    for (const key of [STORAGE_KEYS.DAYS, STORAGE_KEYS.TRADES, STORAGE_KEYS.REVIEWS]) {
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
