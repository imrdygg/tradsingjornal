import {
  Instrument,
  Setup,
  TradingDay,
  Trade,
  DailyReview,
  UserProfile,
  PlanChange,
  PlanSnapshot,
} from '../../types';
import { DEFAULT_INSTRUMENTS } from '../trading/instruments';
import { getCurrentTradingDate } from './date-utils';

export const DEFAULT_SETUPS: Setup[] = [
  { id: 'engulfing', name: 'Engulfing', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'support', name: 'Support', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'resistance', name: 'Resistance', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'breakout', name: 'Breakout', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'reversal', name: 'Reversal', active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'trend-continuation', name: 'Trend Continuation', active: true, createdAt: '2026-01-01T00:00:00Z' },
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
}

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    console.warn(`Error reading ${key} from storage:`, err);
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Error saving ${key} to storage:`, err);
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
      return true;
    } catch (err) {
      console.error('Import failed:', err);
      return false;
    }
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
      STORAGE_KEYS.SEEDED,
    ]) {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.warn(`Error clearing ${key} from storage:`, err);
      }
    }
  },

  isLoggedIn(): boolean {
    return getItem<boolean>(STORAGE_KEYS.AUTH, true); // default authenticated for owner in personal journal
  },

  setLoggedIn(status: boolean): void {
    setItem(STORAGE_KEYS.AUTH, status);
  },
};
