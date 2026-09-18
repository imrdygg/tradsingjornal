import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AppShell,
  NavTab,
} from './components/layout/AppShell';
import { YesterdayFocusBanner } from './components/today/YesterdayFocusBanner';
import { TodaySummary } from './components/today/TodaySummary';
import { DailyPlanForm } from './components/today/DailyPlanForm';
import { TradeCard } from './components/trades/TradeCard';
import { TradeFormModal } from './components/trades/TradeFormModal';
import { TradeCloseModal } from './components/trades/TradeCloseModal';
import { RiskFixupModal } from './components/trades/RiskFixupModal';
import { TradeDetailModal } from './components/trades/TradeDetailModal';
import { DailyReviewModal } from './components/review/DailyReviewModal';
import { TradesView } from './components/trades/TradesView';
import { HistoryView } from './components/history/HistoryView';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { InsightsView } from './components/insights/InsightsView';
import { CoachView } from './components/coach/CoachView';
import { CoachCheckpointCard } from './components/today/CoachCheckpointCard';
import { SettingsView } from './components/settings/SettingsView';
import { PlaybookView } from './components/playbook/PlaybookView';
import {
  TradingDay,
  Trade,
  DailyReview,
  Setup,
  UserProfile,
  Instrument,
  TradeExecutionReview,
  TradeManagement,
} from './types';
import type { SyncStatus } from './components/layout/SyncStatusBadge';
import { storage } from './lib/storage';
import type { StorageState } from './lib/storage';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { loadOrMigrateJournal, saveJournal } from './lib/cloud-sync';
import { parseTradovateCSV } from './lib/trading/tradovate-import';
import type { CsvImportSummary } from './lib/trading/tradovate-import';
import { buildPositionGroups, findPositionGroup } from './lib/trading/position-groups';
import { findAssumedRiskTrades, RiskFixItem } from './lib/trading/risk-fixup';
import { instrumentSymbol } from './lib/trading/instruments';
import { Plus, Award, Sparkles, Layers, Cloud, CloudOff, Loader2 } from 'lucide-react';

function AuthScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === 'sign-up' && !result.data.session) setMessage('Check your email to confirm your account, then sign in.');
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-2xl space-y-5">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 mb-3"><Cloud className="w-5 h-5" /><span className="text-xs font-mono uppercase tracking-wider">Private cloud journal</span></div>
          <h1 className="text-2xl font-bold">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="text-sm text-zinc-400 mt-1">Your journal syncs securely across your phone and computer.</p>
        </div>
        {message && <div className="rounded-xl border border-amber-800/70 bg-amber-950/40 p-3 text-xs text-amber-200">{message}</div>}
        <label className="block text-xs text-zinc-400">Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-600" /></label>
        <label className="block text-xs text-zinc-400">Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={6} required className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-600" /></label>
        <button disabled={busy} className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50 flex items-center justify-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'sign-in' ? 'Log in' : 'Sign up'}</button>
        <button type="button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(null); }} className="w-full text-xs text-zinc-400 hover:text-zinc-200">{mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Log in'}</button>
      </form>
    </div>
  );
}

interface JournalAppProps {
  userId: string;
  userEmail?: string | null;
  /** Omitted in local-only mode, which hides the sign-out control entirely. */
  onSignOut?: () => Promise<void> | void;
}

function JournalApp({ userId, userEmail, onSignOut }: JournalAppProps) {
  const cloudEnabled = isSupabaseConfigured;

  const [profile, setProfile] = useState<UserProfile>(() => ({ ...storage.getProfile(), id: userId }));
  const [instruments, setInstruments] = useState<Instrument[]>(() => storage.getInstruments());
  const [setups, setSetups] = useState<Setup[]>(() => storage.getSetups());
  const [tradingDays, setTradingDays] = useState<TradingDay[]>(() => storage.getTradingDays());
  const [trades, setTrades] = useState<Trade[]>(() => storage.getTrades());
  const [reviews, setReviews] = useState<DailyReview[]>(() => storage.getReviews());

  const [activeTab, setActiveTab] = useState<NavTab>('today');

  // Theme state: default to dark, supports light mode toggle
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ptj_theme_mode');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark';
  });

  // Apply theme class to <html> element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    try {
      localStorage.setItem('ptj_theme_mode', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Modals state
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  // Partial seed for a NEW trade — the scale-in calculator sends one over so an
  // add is recorded as its own entry without retyping the numbers.
  const [tradePrefill, setTradePrefill] = useState<Partial<Trade> | null>(null);

  const openAddTrade = useCallback((prefill?: Partial<Trade>) => {
    setEditingTrade(null);
    setTradePrefill(prefill ?? null);
    setIsTradeModalOpen(true);
  }, []);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  // Trade detail view is stored as an id so it re-renders from live state and
  // immediately reflects a saved execution review.
  const [viewingTradeId, setViewingTradeId] = useState<string | null>(null);
  const [isRiskFixupOpen, setIsRiskFixupOpen] = useState(false);
  const [importNotification, setImportNotification] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudEnabled ? 'loading' : 'local');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const currentState = useMemo<StorageState>(() => ({ profile, instruments, setups, tradingDays, trades, reviews }), [profile, instruments, setups, tradingDays, trades, reviews]);

  // Keep the latest state reachable from the sign-out handler without re-running effects.
  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;

  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    (async () => {
      try {
        const cloudState = await loadOrMigrateJournal(userId, currentStateRef.current);
        if (!active) return;
        storage.importData(JSON.stringify(cloudState));
        setProfile({ ...cloudState.profile, id: userId });
        setInstruments(cloudState.instruments);
        setSetups(cloudState.setups);
        setTradingDays(cloudState.tradingDays);
        setTrades(cloudState.trades);
        setReviews(cloudState.reviews);
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } catch (error) {
        console.error('Cloud journal load failed:', error);
        setSyncStatus('error');
        setImportNotification('Cloud sync is unavailable. Your local journal is still available.');
      } finally {
        if (active) setCloudReady(true);
      }
    })();
    return () => { active = false; };
  }, [cloudEnabled, userId]);

  useEffect(() => {
    if (!cloudEnabled || !cloudReady) return;
    setSyncStatus('saving');
    const timeout = window.setTimeout(async () => {
      try {
        await saveJournal(userId, currentState);
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } catch (error) {
        console.error('Cloud journal save failed:', error);
        setSyncStatus('error');
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cloudEnabled, cloudReady, userId, currentState]);

  const retrySave = useCallback(async () => {
    if (!cloudEnabled) return;
    setSyncStatus('saving');
    try {
      await saveJournal(userId, currentStateRef.current);
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error('Cloud journal retry failed:', error);
      setSyncStatus('error');
    }
  }, [cloudEnabled, userId]);

  const handleSignOut = async () => {
    setSigningOut(true);
    let flushed = true;
    if (cloudEnabled && cloudReady) {
      setSyncStatus('saving');
      try {
        await saveJournal(userId, currentStateRef.current);
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } catch (error) {
        flushed = false;
        setSyncStatus('error');
        console.error('Final cloud save failed:', error);
      }
    }
    // Only wipe the local journal once the cloud copy is safely up to date,
    // so a second account on this device can never inherit this user's data.
    if (cloudEnabled && flushed) storage.clearJournal();
    await onSignOut?.();
    setSigningOut(false);
  };

  // Today's Trading Day (get or create for today)
  const todayTradingDay = useMemo(() => {
    return storage.getOrCreateToday();
  }, [tradingDays]);

  // Yesterday's Focus
  const yesterdayFocus = useMemo(() => {
    return storage.getYesterdayFocus();
  }, [reviews, tradingDays]);

  // Today's Trades
  const todayTrades = useMemo(() => {
    return trades.filter((t) => t.tradingDayId === todayTradingDay.id);
  }, [trades, todayTradingDay.id]);

  // Scale-in legs grouped so cards can show the blended size and average entry.
  const positionGroups = useMemo(() => buildPositionGroups(trades), [trades]);
  // Imported trades whose stop — and therefore risk and R — is still a placeholder.
  const assumedRiskTrades = useMemo(() => findAssumedRiskTrades(trades), [trades]);
  const viewingTrade = useMemo(
    () => trades.find((t) => t.id === viewingTradeId) ?? null,
    [trades, viewingTradeId]
  );

  // Today's Realized Metrics
  const todayClosedTrades = useMemo(() => {
    return todayTrades.filter((t) => t.status === 'closed');
  }, [todayTrades]);

  const todayRealizedPnL = useMemo(() => {
    return Math.round(todayClosedTrades.reduce((s, t) => s + t.grossPnL, 0) * 100) / 100;
  }, [todayClosedTrades]);

  const todayWins = useMemo(() => {
    return todayClosedTrades.filter((t) => t.grossPnL > 0).length;
  }, [todayClosedTrades]);

  const todayLosses = useMemo(() => {
    return todayClosedTrades.filter((t) => t.grossPnL < 0).length;
  }, [todayClosedTrades]);

  // Today's Review (if any)
  const todayReview = useMemo(() => {
    return reviews.find((r) => r.tradingDayId === todayTradingDay.id);
  }, [reviews, todayTradingDay.id]);

  // Plan actions
  const handleSaveDay = (updated: TradingDay) => {
    storage.saveTradingDay(updated);
    setTradingDays(storage.getTradingDays());
  };

  const handleLockPlan = () => {
    storage.lockPlan(todayTradingDay.id);
    setTradingDays(storage.getTradingDays());
  };

  /**
   * Undoes today's plan lock. The reason is recorded in the plan change audit
   * trail first, so unlocking leaves the same paper trail as any other edit to
   * a locked plan.
   */
  const handleUnlockPlan = (reason?: string) => {
    if (reason) {
      storage.recordPlanChange(todayTradingDay.id, {
        fieldName: 'Plan Lock',
        oldValue: 'Locked',
        newValue: 'Unlocked',
        reason,
      });
    }
    storage.unlockPlan(todayTradingDay.id);
    setTradingDays(storage.getTradingDays());
  };

  const handleRecordPlanChange = (change: {
    fieldName: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }) => {
    storage.recordPlanChange(todayTradingDay.id, change);
    setTradingDays(storage.getTradingDays());
  };

  /**
   * Adds or updates a trade from the record form.
   *
   * On an edit the stored trade is the base and only the fields the form actually owns
   * are replaced. Rebuilding the record from the form alone used to reassign a past
   * trade to today's session, relabel an import as hand-recorded, and drop the
   * assumed-risk flag — the last of which turned an invented stop price, and the risk
   * and R derived from it, into numbers the app presented as real.
   */
  const handleSaveTrade = (tradeData: Partial<Trade>) => {
    const stored = editingTrade;
    const now = new Date().toISOString();

    const tradeToSave: Trade = {
      // Identity and provenance are not the form's to change.
      id: stored?.id ?? `trade-${Date.now()}`,
      userId: profile.id,
      // A trade stays on the day it was taken. Editing last week's note must not move it
      // into today, which would corrupt both days' figures at once.
      tradingDayId: stored?.tradingDayId ?? todayTradingDay.id,
      // An import stays an import, so the risk fix-up flow can still tell which stops
      // were invented for it.
      source: stored?.source ?? 'manual',
      importId: stored?.importId,

      // Fields the form owns. It sends all of them on every save, including undefined
      // when a value was cleared, so they are taken as given rather than merged.
      instrumentId: tradeData.instrumentId || 'mes',
      direction: tradeData.direction || 'long',
      contracts: tradeData.contracts || 1,
      entryPrice: tradeData.entryPrice || 0,
      initialStop: tradeData.initialStop || 0,
      exitPrice: tradeData.exitPrice,
      entryTime: tradeData.entryTime || now,
      exitTime: tradeData.exitTime,
      session: tradeData.session || 'Regular Session',
      setupName: tradeData.setupName || 'Engulfing',
      entryReason: tradeData.entryReason,
      notes: tradeData.notes,
      tags: tradeData.tags,
      initialRisk: tradeData.initialRisk || 50,
      // The form decides this: it reports 'assumed' while an imported stop is still the
      // placeholder the CSV never carried, so a note-only edit cannot launder invented
      // risk into real risk.
      riskSource: tradeData.riskSource ?? stored?.riskSource,
      grossPnL: tradeData.grossPnL || 0,
      pointsPnL: tradeData.pointsPnL || 0,
      rMultiple: tradeData.rMultiple !== undefined ? tradeData.rMultiple : 0,
      status: tradeData.status || (tradeData.exitPrice ? 'closed' : 'open'),
      // Preserved on edit; a scale-in sets it so the legs can be shown as one position.
      positionId: tradeData.positionId ?? stored?.positionId,
      images: tradeData.images !== undefined ? tradeData.images : stored?.images,
      screenshotPath:
        tradeData.screenshotPath !== undefined ? tradeData.screenshotPath : stored?.screenshotPath,

      // Nothing on this form edits these, so they carry over untouched.
      netPnL: stored?.netPnL,
      fees: stored?.fees,
      tradeManagement: stored?.tradeManagement,
      executionReview: stored?.executionReview,

      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
    };

    storage.saveTrade(tradeToSave);

    // A scale-in points at the opening trade's id as its position anchor. Stamp
    // that anchor with the same positionId so both legs group from now on.
    if (tradeToSave.positionId && tradeToSave.positionId !== tradeToSave.id) {
      const anchor = trades.find((t) => t.id === tradeToSave.positionId);
      if (anchor && anchor.positionId !== tradeToSave.positionId) {
        storage.saveTrade({ ...anchor, positionId: tradeToSave.positionId });
      }
    }

    setTrades(storage.getTrades());
    setEditingTrade(null);
    setTradePrefill(null);
  };

  const handleConfirmCloseTrade = (
    tradeId: string,
    exitData: {
      exitPrice: number;
      exitTime: string;
      pointsPnL: number;
      grossPnL: number;
      rMultiple: number;
      executionReview: TradeExecutionReview;
      tradeManagement?: TradeManagement;
      images?: string[];
    }
  ) => {
    const existing = trades.find((t) => t.id === tradeId);
    if (!existing) return;

    const closed: Trade = {
      ...existing,
      status: 'closed',
      exitPrice: exitData.exitPrice,
      exitTime: exitData.exitTime,
      pointsPnL: exitData.pointsPnL,
      grossPnL: exitData.grossPnL,
      rMultiple: exitData.rMultiple,
      executionReview: exitData.executionReview,
      tradeManagement: exitData.tradeManagement,
      images: exitData.images && exitData.images.length > 0 ? exitData.images : existing.images,
      screenshotPath:
        exitData.images && exitData.images.length > 0
          ? exitData.images[0]
          : existing.screenshotPath,
      updatedAt: new Date().toISOString(),
    };

    storage.saveTrade(closed);
    setTrades(storage.getTrades());
  };

  /**
   * Writes the real stops onto the imported trades and clears the assumed flag, so the
   * risk and R-multiple are the trader's own numbers from here on.
   */
  const handleApplyRiskFix = (items: RiskFixItem[]) => {
    const byId = new Map(items.map((item) => [item.tradeId, item]));
    const appliedAt = new Date().toISOString();

    for (const trade of trades) {
      const item = byId.get(trade.id);
      if (!item) continue;
      storage.saveTrade({
        ...trade,
        initialStop: item.stop,
        initialRisk: item.risk,
        rMultiple: item.rMultiple,
        riskSource: 'recorded',
        updatedAt: appliedAt,
      });
    }

    setTrades(storage.getTrades());
    setIsRiskFixupOpen(false);
  };

  const handleDeleteTrade = (tradeId: string) => {
    storage.deleteTrade(tradeId);
    setTrades(storage.getTrades());
    setViewingTradeId((current) => (current === tradeId ? null : current));
  };

  /**
   * Adds or replaces the execution review on an already-recorded trade — this
   * is how imported and closed trades get their discipline score.
   */
  const handleSaveExecutionReview = (tradeId: string, review: TradeExecutionReview) => {
    const existing = trades.find((t) => t.id === tradeId);
    if (!existing) return;

    storage.saveTrade({
      ...existing,
      executionReview: review,
      updatedAt: new Date().toISOString(),
    });
    setTrades(storage.getTrades());
  };

  // Review actions
  const handleSaveDailyReview = (review: DailyReview) => {
    storage.saveDailyReview(review);
    setReviews(storage.getReviews());
    setTradingDays(storage.getTradingDays());
  };

  // Settings actions
  const handleUpdateProfile = (newProfile: UserProfile) => {
    storage.updateProfile(newProfile);
    setProfile(storage.getProfile());
  };

  const handleAddSetup = (setup: Setup) => {
    storage.saveSetup(setup);
    setSetups(storage.getSetups());
  };

  const handleUpdateSetup = (setup: Setup) => {
    storage.saveSetup(setup);
    setSetups(storage.getSetups());
  };

  const handleDeleteSetup = (setupId: string) => {
    storage.deleteSetup(setupId);
    setSetups(storage.getSetups());
  };

  const handleToggleSetup = (setupId: string) => {
    storage.toggleSetupActive(setupId);
    setSetups(storage.getSetups());
  };

  // Deep-link from the Morning Plan: switching to the Playbook tab focused on
  // today's watched setups. Cleared on the next manual tab change so a later
  // visit to the Playbook starts clean at the top of the list.
  const [playbookFocusSetups, setPlaybookFocusSetups] = useState<string[] | null>(null);
  const handleOpenPlaybook = useCallback(() => {
    setPlaybookFocusSetups(todayTradingDay.watchedSetups || []);
    setActiveTab('playbook');
  }, [todayTradingDay.watchedSetups]);
  const handleSelectTab = useCallback(
    (tab: NavTab) => {
      setPlaybookFocusSetups(null);
      setActiveTab(tab);
    },
    []
  );

  const handleExportData = () => {
    const jsonStr = storage.exportAllData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading-journal-backup-${todayTradingDay.tradeDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * "Start fresh": clears trades, plans and reviews locally and overwrites the
   * cloud snapshot with the same empty journal, so the reset sticks on every
   * device. Profile, instruments and playbook set-ups are kept.
   */
  const handleResetJournal = async () => {
    storage.resetJournal();

    const fresh: StorageState = {
      profile,
      instruments,
      setups,
      tradingDays: [],
      trades: [],
      reviews: [],
    };

    if (cloudEnabled && cloudReady) {
      await saveJournal(userId, fresh);
    }

    setTrades([]);
    setReviews([]);
    // Recreate today's (empty) planning day so the app has somewhere to land.
    storage.getOrCreateToday();
    setTradingDays(storage.getTradingDays());
    setSyncStatus(cloudEnabled ? 'saved' : 'local');
    setLastSyncedAt(cloudEnabled ? new Date() : null);
  };

  const handleImportData = (jsonStr: string) => {
    const success = storage.importData(jsonStr);
    if (success) {
      setProfile(storage.getProfile());
      setInstruments(storage.getInstruments());
      setSetups(storage.getSetups());
      setTradingDays(storage.getTradingDays());
      setTrades(storage.getTrades());
      setReviews(storage.getReviews());
    }
  };

  const handleTradovateImport = (csvContent: string): CsvImportSummary => {
    const parsed = parseTradovateCSV(csvContent, instruments);

    if (parsed.trades.length === 0) {
      setImportNotification(parsed.errors[0] || 'No trades could be read from that CSV.');
      return { imported: 0, errors: parsed.errors, warnings: parsed.warnings };
    }

    const importedAt = new Date().toISOString();
    const newTrades: Trade[] = parsed.trades.map((pt, idx) => ({
      id: `tradovate-${Date.now()}-${idx}`,
      userId: profile.id,
      tradingDayId: todayTradingDay.id,
      // Instrument and point value come from the parsed contract, so MNQ/ES
      // imports are not silently priced as MES.
      instrumentId: pt.instrumentId || 'mes',
      source: 'tradovate_csv',
      direction: pt.direction || 'long',
      contracts: pt.contracts || 1,
      entryPrice: pt.entryPrice || 0,
      initialStop: pt.initialStop || 0,
      exitPrice: pt.exitPrice,
      entryTime: pt.entryTime || importedAt,
      exitTime: pt.exitTime,
      session: pt.session || 'Regular Session',
      // Left unset on purpose: the CSV has no setup data, and guessing one
      // would corrupt setup-level analytics.
      setupName: pt.setupName,
      positionId: pt.positionId,
      notes: 'Imported from broker CSV',
      initialRisk: pt.initialRisk || 0,
      grossPnL: pt.grossPnL || 0,
      pointsPnL: pt.pointsPnL || 0,
      rMultiple: pt.rMultiple !== undefined ? pt.rMultiple : 0,
      status: pt.status || 'closed',
      createdAt: importedAt,
      updatedAt: importedAt,
    }));

    for (const t of newTrades) {
      storage.saveTrade(t);
    }
    setTrades(storage.getTrades());

    setImportNotification(
      `Imported ${newTrades.length} trade${newTrades.length === 1 ? '' : 's'} from CSV.`
    );

    return {
      imported: newTrades.length,
      errors: parsed.errors,
      warnings: parsed.warnings,
    };
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'today':
        return (
          <div className="space-y-6">
            {/* Yesterday's Focus Lesson Banner */}
            {yesterdayFocus && (
              <YesterdayFocusBanner yesterdayFocus={yesterdayFocus} />
            )}

            {/* Coach checkpoint: morning prep before the close, review after it. */}
            <CoachCheckpointCard
              trades={trades}
              tradingDays={tradingDays}
              reviews={reviews}
              setups={setups}
              instruments={instruments}
              todayTradeDate={todayTradingDay.tradeDate}
              timezone={profile.timezone}
            />

            {/* Today's Risk & Performance Summary Card */}
            <TodaySummary
              realizedPnL={todayRealizedPnL}
              totalTrades={todayTrades.length}
              wins={todayWins}
              losses={todayLosses}
              plannedMaxLoss={todayTradingDay.plannedLossLimit}
              riskMode={todayTradingDay.riskMode}
              planStatus={todayTradingDay.status}
              onOpenAddTrade={openAddTrade}
              onOpenEndDay={() => setIsReviewModalOpen(true)}
              isPlanLocked={!!todayTradingDay.lockedAt}
            />

            {/* Quick Actions & Notification */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  id="btn-add-trade-top"
                  onClick={() => openAddTrade()}
                  className="flex items-center gap-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 px-4 py-2 text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  Add Trade (under 1 min)
                </button>

                <button
                  onClick={() => setIsReviewModalOpen(true)}
                  className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 transition-all shadow-sm"
                >
                  <Award className="w-4 h-4 text-amber-400" />
                  {todayReview ? 'Update Daily Review' : 'End-of-Day Review'}
                </button>
              </div>

              {importNotification && (
                <div className="text-xs text-emerald-400 font-mono bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{importNotification}</span>
                  <button
                    onClick={() => setImportNotification(null)}
                    className="text-zinc-400 hover:text-zinc-200 ml-2"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Morning Plan & Guardrails Form */}
            <DailyPlanForm
              day={todayTradingDay}
              setups={setups}
              instruments={instruments}
              openTrades={todayTrades.filter((t) => t.status === 'open')}
              onSaveDay={handleSaveDay}
              onLockPlan={handleLockPlan}
              onRecordPlanChange={handleRecordPlanChange}
              onOpenPlaybook={handleOpenPlaybook}
              onLogScaleInTrade={openAddTrade}
              onUnlockPlan={handleUnlockPlan}
            />

            {/* Today's Recorded Trades Section */}
            <div id="today-trades" className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-2">
                  <Layers className="w-4 h-4 text-zinc-300" />
                  Today's Trade Executions ({todayTrades.length})
                </h3>
                <span className="text-[11px] text-zinc-400 font-mono">
                  {todayTrades.filter((t) => t.status === 'open').length} Open •{' '}
                  {todayTrades.filter((t) => t.status === 'closed').length} Closed
                </span>
              </div>

              {todayTrades.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center space-y-3">
                  <p className="text-xs text-zinc-400">
                    No trades logged for today yet. Lock your morning plan first, then record executions cleanly.
                  </p>
                  <button
                    onClick={() => openAddTrade()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-medium hover:bg-zinc-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Record Trade
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayTrades.map((trade) => (
                    <TradeCard
                      key={trade.id}
                      trade={trade}
                      instruments={instruments}
                      positionGroup={findPositionGroup(positionGroups, trade)}
                      onView={(t) => setViewingTradeId(t.id)}
                      onEdit={(t) => {
                        setEditingTrade(t);
                        setIsTradeModalOpen(true);
                      }}
                      onCloseTrade={(t) => {
                        setClosingTrade(t);
                        setIsCloseModalOpen(true);
                      }}
                      onDelete={handleDeleteTrade}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case 'trades':
        return (
          <TradesView
            trades={trades}
            tradingDays={tradingDays}
            setups={setups}
            instruments={instruments}
            onOpenAddTrade={openAddTrade}
            onViewTrade={(t) => setViewingTradeId(t.id)}
            onEditTrade={(t) => {
              setEditingTrade(t);
              setIsTradeModalOpen(true);
            }}
            onCloseTrade={(t) => {
              setClosingTrade(t);
              setIsCloseModalOpen(true);
            }}
            onDeleteTrade={handleDeleteTrade}
          />
        );

      case 'history':
        return (
          <HistoryView
            tradingDays={tradingDays}
            trades={trades}
            reviews={reviews}
            setups={setups}
            instruments={instruments}
          />
        );

      case 'analytics':
        return (
          <AnalyticsView
            trades={trades}
            tradingDays={tradingDays}
            reviews={reviews}
            setups={setups}
            instruments={instruments}
          />
        );

      case 'insights':
        return <InsightsView trades={trades} tradingDays={tradingDays} />;

      case 'coach':
        return (
          <CoachView
            trades={trades}
            tradingDays={tradingDays}
            reviews={reviews}
            setups={setups}
            instruments={instruments}
            todayTradeDate={todayTradingDay.tradeDate}
            timezone={profile.timezone}
          />
        );

      case 'playbook':
        return (
          <PlaybookView
            setups={setups}
            onAddSetup={handleAddSetup}
            onUpdateSetup={handleUpdateSetup}
            onDeleteSetup={handleDeleteSetup}
            onToggleSetup={handleToggleSetup}
            focusSetupNames={playbookFocusSetups ?? undefined}
            watchedSetupNames={todayTradingDay.watchedSetups}
          />
        );

      case 'settings':
        return (
          <SettingsView
            profile={profile}
            instruments={instruments}
            onUpdateProfile={handleUpdateProfile}
            onExportData={handleExportData}
            onImportData={handleImportData}
            onTradovateImport={handleTradovateImport}
            assumedRiskCount={assumedRiskTrades.length}
            onOpenRiskFixup={() => setIsRiskFixupOpen(true)}
            onResetJournal={handleResetJournal}
            userEmail={userEmail}
            onSignOut={onSignOut ? handleSignOut : undefined}
            signingOut={signingOut}
            syncStatus={syncStatus}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AppShell
      currentTab={activeTab}
      onSelectTab={handleSelectTab}
      onOpenAddTrade={openAddTrade}
      riskMode={todayTradingDay.riskMode}
      dayStatus={todayTradingDay.status}
      realizedPnL={todayRealizedPnL}
      primaryInstrument={instrumentSymbol(instruments, todayTradingDay.primaryInstrument)}
      timezone={profile.timezone}
      theme={theme}
      onToggleTheme={handleToggleTheme}
      userEmail={userEmail}
      // Only offer sign-out when there is a real account behind it. Passing
      // handleSignOut unconditionally made local-only mode show a "?" avatar
      // and a Sign out button that silently did nothing.
      onSignOut={onSignOut ? handleSignOut : undefined}
      signingOut={signingOut}
      syncStatus={syncStatus}
      lastSyncedAt={lastSyncedAt}
      onRetrySync={retrySave}
    >
      {!cloudEnabled && <LocalOnlyNotice />}
      {renderTabContent()}

      {/* Trade Form Modal (Add / Edit) */}
      <TradeFormModal
        isOpen={isTradeModalOpen}
        onClose={() => {
          setIsTradeModalOpen(false);
          setEditingTrade(null);
          setTradePrefill(null);
        }}
        onSave={handleSaveTrade}
        day={todayTradingDay}
        instruments={instruments}
        setups={setups}
        editingTrade={editingTrade}
        prefill={tradePrefill}
      />

      {/* Trade Close Modal (Close + Execution Review) */}
      <TradeCloseModal
        isOpen={isCloseModalOpen}
        onClose={() => {
          setIsCloseModalOpen(false);
          setClosingTrade(null);
        }}
        trade={closingTrade}
        instruments={instruments}
        onConfirmClose={handleConfirmCloseTrade}
      />

      {/* Risk fix-up: replaces placeholder stops left by a broker CSV import. */}
      <RiskFixupModal
        isOpen={isRiskFixupOpen}
        onClose={() => setIsRiskFixupOpen(false)}
        trades={trades}
        instruments={instruments}
        onApply={handleApplyRiskFix}
        onEditTrade={(trade) => {
          setIsRiskFixupOpen(false);
          setEditingTrade(trade);
          setIsTradeModalOpen(true);
        }}
      />

      {/* Trade Detail Modal (read everything recorded about one trade) */}
      <TradeDetailModal
        isOpen={viewingTradeId !== null}
        onClose={() => setViewingTradeId(null)}
        trade={trades.find((t) => t.id === viewingTradeId) ?? null}
        instruments={instruments}
        positionGroup={
          viewingTrade
            ? findPositionGroup(positionGroups, viewingTrade)
            : undefined
        }
        onEdit={(t) => {
          setViewingTradeId(null);
          setEditingTrade(t);
          setIsTradeModalOpen(true);
        }}
        onCloseTrade={(t) => {
          setViewingTradeId(null);
          setClosingTrade(t);
          setIsCloseModalOpen(true);
        }}
        onDelete={handleDeleteTrade}
        onSaveExecutionReview={handleSaveExecutionReview}
      />

      {/* Daily Review Modal */}
      <DailyReviewModal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        day={todayTradingDay}
        trades={todayTrades}
        existingReview={todayReview}
        onSaveReview={handleSaveDailyReview}
      />
    </AppShell>
  );
}

/**
 * Shown when the build has no Supabase credentials. Without this the app just
 * quietly runs local-only and there is no way to discover why there is no
 * sign-in, or what to do about it.
 */
function LocalOnlyNotice() {
  return (
    <div className="mb-4 rounded-2xl border border-amber-800/60 bg-amber-950/30 p-3 sm:p-4">
      <div className="flex items-start gap-2.5">
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-amber-200">
            Cloud sync is off — this journal is saved in this browser only
          </p>
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            Signing in and syncing across devices are disabled because this build
            has no Supabase credentials. Add{' '}
            <code className="rounded bg-amber-900/50 px-1 py-0.5 font-mono">
              VITE_SUPABASE_URL
            </code>{' '}
            and{' '}
            <code className="rounded bg-amber-900/50 px-1 py-0.5 font-mono">
              VITE_SUPABASE_ANON_KEY
            </code>{' '}
            to this environment, then rebuild. For local development they belong
            in <span className="font-mono">.env.local</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-100">
      <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      <p className="text-xs font-mono text-zinc-400">Restoring your session…</p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setRestoring(false);
      })
      .catch((error) => {
        console.error('Session restore failed:', error);
        if (active) setRestoring(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setRestoring(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Sign out failed:', error);
  }, []);

  // Supabase isn't configured: keep the journal fully usable offline. No
  // onSignOut is passed, so there is no dead sign-out button in the header.
  if (!isSupabaseConfigured) {
    return <JournalApp userId={storage.getProfile().id} />;
  }

  if (restoring) return <SessionLoader />;

  if (session) {
    return (
      <JournalApp
        userId={session.user.id}
        userEmail={session.user.email}
        onSignOut={handleSignOut}
      />
    );
  }

  return <AuthScreen />;
}
