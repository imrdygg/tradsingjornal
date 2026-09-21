import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AppShell,
  NavTab,
} from './components/layout/AppShell';
import { YesterdayFocusBanner } from './components/today/YesterdayFocusBanner';
import { DrawdownRoomStrip } from './components/today/DrawdownRoomStrip';
import { TodaySummary } from './components/today/TodaySummary';
import { DailyPlanForm } from './components/today/DailyPlanForm';
import { TradeCard } from './components/trades/TradeCard';
import { TradeFormModal } from './components/trades/TradeFormModal';
import { TradeCloseModal } from './components/trades/TradeCloseModal';
import { RiskFixupModal } from './components/trades/RiskFixupModal';
import { TradeDetailModal } from './components/trades/TradeDetailModal';
import { DailyReviewModal } from './components/review/DailyReviewModal';
import { PlanLockPreviewModal } from './components/today/PlanLockPreviewModal';
import { CoachCheckpointCard } from './components/today/CoachCheckpointCard';
import { CoachEntryComparison } from './components/today/CoachEntryComparison';
import { askEntryCall, type PlanCoachContext } from './lib/ai/plan-coach';
import type { EntryCallResponse } from './lib/ai/coach-types';

/**
 * Tab views load on demand.
 *
 * Only Today is needed for the first paint, yet every tab used to be imported
 * eagerly, so a phone downloaded the charts, the coach and all 26 playbook
 * setups before showing today's plan. Each view is a named export, and
 * `lazy()` only understands default exports, hence the `.then()` hop.
 *
 * The modals stay eager on purpose: they open from a tap on the most common
 * path (recording a trade), and a suspense fallback flashing up in front of
 * that form would cost more than the bytes it saves.
 */
const TradesView = lazy(() =>
  import('./components/trades/TradesView').then((m) => ({ default: m.TradesView }))
);
const HistoryView = lazy(() =>
  import('./components/history/HistoryView').then((m) => ({ default: m.HistoryView }))
);
const AnalyticsView = lazy(() =>
  import('./components/analytics/AnalyticsView').then((m) => ({ default: m.AnalyticsView }))
);
const InsightsView = lazy(() =>
  import('./components/insights/InsightsView').then((m) => ({ default: m.InsightsView }))
);
const CoachView = lazy(() =>
  import('./components/coach/CoachView').then((m) => ({ default: m.CoachView }))
);
/**
 * The review trend chart loads with the click that reveals it.
 *
 * It is the only thing that draws a chart on the Today tab, and Today is the first paint:
 * pulling recharts in eagerly to render a panel that is hidden until a lesson is
 * acknowledged would undo the reason the tab views are split up in the first place.
 */
const ReviewTrendPanel = lazy(() =>
  import('./components/today/ReviewTrendPanel').then((m) => ({ default: m.ReviewTrendPanel }))
);
const PlaybookView = lazy(() =>
  import('./components/playbook/PlaybookView').then((m) => ({ default: m.PlaybookView }))
);
const SettingsView = lazy(() =>
  import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
import {
  TradingDay,
  Trade,
  DailyReview,
  LessonAcknowledgement,
  Setup,
  UserProfile,
  Instrument,
  TradeExecutionReview,
  TradeManagement,
  PatternStudy,
} from './types';
import type { SyncStatus } from './components/layout/SyncStatusBadge';
import { storage, dismissStorageFailure, measureJournalBytes } from './lib/storage';
import type { StorageState } from './lib/storage';
import { useStorageFailure } from './lib/storage/use-storage-failure';
import { StorageWarningBanner } from './components/common/StorageWarningBanner';
import { CloudConflictBanner } from './components/common/CloudConflictBanner';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import {
  loadOrMigrateJournal,
  loadJournal,
  saveJournal,
  overwriteJournal,
  isJournalConflictError,
} from './lib/cloud-sync';
import { parseTradovateCSV } from './lib/trading/tradovate-import';
import type { CsvImportSummary } from './lib/trading/tradovate-import';
import { buildPositionGroups, findPositionGroup } from './lib/trading/position-groups';
import { findAssumedRiskTrades, RiskFixItem } from './lib/trading/risk-fixup';
import { instrumentSymbol } from './lib/trading/instruments';
import { acknowledgementFor, isLessonAcknowledged } from './lib/storage/lesson-ack';
import {
  assessPlannedSize,
  assessRiskCapacity,
  estimateStopDistance,
} from './lib/analytics/risk-capacity';
import { findInstrument } from './lib/trading/instruments';
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

/**
 * The one deep link this app has: a chart pattern's stable URL.
 *
 * Deliberately a string in and a string out, with no pattern data involved — the id is
 * validated in the playbook chunk, which is loaded on demand. Importing the pattern list
 * here would drag all 20 patterns' prose into the first paint to check a hash.
 */
const PATTERN_HASH_PREFIX = '#chart-patterns/';

function readPatternFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith(PATTERN_HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(PATTERN_HASH_PREFIX.length)).trim();
  return id || null;
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
  // The catalog is merged on read, so built-in setups added since this journal was created
  // arrive here instead of only on a fresh install.
  const [setups, setSetups] = useState<Setup[]>(() => storage.ensureSetupCatalog());
  const [tradingDays, setTradingDays] = useState<TradingDay[]>(() => storage.getTradingDays());
  const [trades, setTrades] = useState<Trade[]>(() => storage.getTrades());
  const [reviews, setReviews] = useState<DailyReview[]>(() => storage.getReviews());
  // The lesson the trader has accepted. Held in state so the banner and the review trend
  // below it react to the click, and persisted so a reload does not undo it.
  const [lessonAck, setLessonAck] = useState<LessonAcknowledgement | null>(() =>
    storage.getLessonAck()
  );
  const [patternStudies, setPatternStudies] = useState<PatternStudy[]>(() =>
    storage.getPatternStudies()
  );

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
  // The plan lock preview: shows stats, the live sector heat map and a coach opinion
  // before the day's plan is committed. Opened by the lock button, resolved by confirm.
  const [isLockPreviewOpen, setIsLockPreviewOpen] = useState(false);
  // Trade detail view is stored as an id so it re-renders from live state and
  // immediately reflects a saved execution review.
  const [viewingTradeId, setViewingTradeId] = useState<string | null>(null);
  const [isRiskFixupOpen, setIsRiskFixupOpen] = useState(false);
  const [importNotification, setImportNotification] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(cloudEnabled ? 'loading' : 'local');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // A failed localStorage write is invisible otherwise: the app keeps working
  // while nothing is being recorded. Surface it on every tab.
  const storageFailure = useStorageFailure();
  const storageUsageBytes = useMemo(
    () => (storageFailure ? measureJournalBytes() : 0),
    [storageFailure]
  );

  const currentState = useMemo<StorageState>(
    () => ({
      profile,
      instruments,
      setups,
      tradingDays,
      trades,
      reviews,
      patternStudies,
      lessonAck,
    }),
    [profile, instruments, setups, tradingDays, trades, reviews, patternStudies, lessonAck]
  );

  // Keep the latest state reachable from the sign-out handler without re-running effects.
  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;

  // The cloud revision this device last read or wrote. Kept in a ref, not state,
  // because a successful save changing state would re-run the save effect and
  // loop forever.
  const cloudRevisionRef = useRef<number | null>(null);
  // Set when another device moved the cloud copy on. It also gates the save
  // effect: further saves could only be refused, and the trader has to pick a
  // copy before any write can be accepted again.
  const [syncConflict, setSyncConflict] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  /**
   * Adopts a snapshot as the whole journal, local storage included, so a reload
   * or a cloud copy taken in a conflict cannot leave the two disagreeing.
   */
  const applyJournalState = useCallback(
    (next: StorageState) => {
      storage.importData(JSON.stringify(next));
      setProfile({ ...next.profile, id: userId });
      setInstruments(next.instruments);
      // Re-runs the catalog merge against the snapshot just adopted: a cloud copy taken
      // before this release would otherwise reintroduce the same missing setups.
      setSetups(storage.ensureSetupCatalog());
      setTradingDays(next.tradingDays);
      setTrades(next.trades);
      setReviews(next.reviews);
      setPatternStudies(next.patternStudies ?? []);
      setLessonAck(next.lessonAck ?? null);
    },
    [userId]
  );

  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    (async () => {
      try {
        const snapshot = await loadOrMigrateJournal(userId, currentStateRef.current);
        if (!active) return;
        cloudRevisionRef.current = snapshot.revision;
        applyJournalState(snapshot.state);
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } catch (error) {
        console.error('Cloud journal load failed:', error);
        setSyncStatus('error');
        setImportNotification(
          describeSyncFailure(error, 'Cloud sync is unavailable. Your local journal is still available.')
        );
      } finally {
        if (active) setCloudReady(true);
      }
    })();
    return () => { active = false; };
  }, [cloudEnabled, userId, applyJournalState]);

  /**
   * Writes the journal against the revision this device last saw.
   *
   * A refusal is reported, never retried: retrying a refused write is precisely
   * the overwrite the revision guard exists to stop.
   */
  const persistJournal = useCallback(async (): Promise<'saved' | 'error' | 'conflict'> => {
    if (!cloudEnabled) return 'saved';
    try {
      cloudRevisionRef.current = await saveJournal(
        userId,
        currentStateRef.current,
        cloudRevisionRef.current
      );
      return 'saved';
    } catch (error) {
      if (isJournalConflictError(error)) {
        setSyncConflict(true);
        return 'conflict';
      }
      console.error('Cloud journal save failed:', error);
      return 'error';
    }
  }, [cloudEnabled, userId]);

  // `currentState` is not read in the body: it is the trigger. Any journal edit
  // produces a new object here and schedules the debounced save below.
  useEffect(() => {
    if (!cloudEnabled || !cloudReady || syncConflict) return;
    setSyncStatus('saving');
    const timeout = window.setTimeout(async () => {
      const result = await persistJournal();
      if (result === 'saved') {
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } else {
        setSyncStatus(result === 'conflict' ? 'conflict' : 'error');
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cloudEnabled, cloudReady, syncConflict, persistJournal, currentState]);

  const retrySave = useCallback(async () => {
    if (!cloudEnabled) return;
    setSyncStatus('saving');
    const result = await persistJournal();
    if (result === 'saved') {
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } else {
      setSyncStatus(result === 'conflict' ? 'conflict' : 'error');
    }
  }, [cloudEnabled, persistJournal]);

  /**
   * Resolves a conflict by taking the cloud copy, discarding whatever this
   * device changed since its last successful save.
   */
  const handleUseCloudCopy = useCallback(async () => {
    setResolvingConflict(true);
    setSyncStatus('loading');
    try {
      const snapshot = await loadJournal(userId);
      if (snapshot) {
        cloudRevisionRef.current = snapshot.revision;
        applyJournalState(snapshot.state);
      } else {
        // The other device removed the journal, so this copy is the only one left.
        cloudRevisionRef.current = await overwriteJournal(userId, currentStateRef.current);
      }
      setSyncConflict(false);
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error('Cloud journal reload failed:', error);
      setSyncStatus('error');
    } finally {
      setResolvingConflict(false);
    }
  }, [userId, applyJournalState]);

  /**
   * Resolves a conflict by overwriting the cloud with this device's journal,
   * discarding the other device's version. Only ever reached from an explicit
   * choice in the conflict banner.
   */
  const handleKeepThisDevice = useCallback(async () => {
    setResolvingConflict(true);
    setSyncStatus('saving');
    try {
      cloudRevisionRef.current = await overwriteJournal(userId, currentStateRef.current);
      setSyncConflict(false);
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error('Cloud journal overwrite failed:', error);
      setSyncStatus('error');
    } finally {
      setResolvingConflict(false);
    }
  }, [userId]);

  const handleSignOut = async () => {
    setSigningOut(true);
    let flushed = true;
    if (cloudEnabled && cloudReady) {
      setSyncStatus('saving');
      const result = await persistJournal();
      if (result === 'saved') {
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } else {
        // A refused or failed final save must not clear the local copy: that is
        // the only place this session's work would still exist.
        flushed = false;
        setSyncStatus(result === 'conflict' ? 'conflict' : 'error');
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

  /**
   * Whether the lesson on screen is the one already accepted.
   *
   * Compared by date AND text, so the banner stays acknowledged for the rest of the day but
   * comes back the moment a different lesson is written into the next review.
   */
  const lessonAcknowledged = isLessonAcknowledged(lessonAck, yesterdayFocus);

  const handleAcknowledgeLesson = useCallback(() => {
    if (!yesterdayFocus) return;
    setLessonAck(storage.saveLessonAck(acknowledgementFor(yesterdayFocus)));
  }, [yesterdayFocus]);

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

  /**
   * The account's remaining drawdown room, from the whole closed record.
   *
   * Computed here as well as on Analytics from the same function, so the line beside today's
   * plan and the panel that explains it can never disagree about the same account.
   */
  const riskCapacity = useMemo(
    () =>
      assessRiskCapacity({
        trades: trades.filter((t) => t.status === 'closed'),
        maxDrawdown: profile.maxDrawdown ?? null,
        dailyLossLimit: todayTradingDay.plannedLossLimit || profile.defaultDailyLossLimit,
      }),
    [trades, profile.maxDrawdown, profile.defaultDailyLossLimit, todayTradingDay.plannedLossLimit]
  );

  /**
   * What the day's planned size would risk at the trader's own stop distance.
   *
   * The plan's loss limit is what they are willing to lose; this is what the position they
   * asked for would actually cost. Both are measured against the same remaining room, from
   * the same capacity object, so the strip, the plan form and the lock preview agree.
   */
  const plannedSizeRisk = useMemo(() => {
    const instrument = findInstrument(instruments, todayTradingDay.primaryInstrument);
    return assessPlannedSize({
      capacity: riskCapacity,
      contracts: todayTradingDay.contractsPlanned,
      pointValue: instrument.pointValue,
      symbol: instrumentSymbol(instruments, instrument.id),
      stopDistance: estimateStopDistance({
        openTrades: todayTrades.filter((t) => t.status === 'open'),
        closedTrades: trades.filter((t) => t.status === 'closed'),
        instrumentId: instrument.id,
      }),
    });
  }, [
    riskCapacity,
    instruments,
    todayTradingDay.primaryInstrument,
    todayTradingDay.contractsPlanned,
    todayTrades,
    trades,
  ]);

  // Today's Review (if any)
  const todayReview = useMemo(() => {
    return reviews.find((r) => r.tradingDayId === todayTradingDay.id);
  }, [reviews, todayTradingDay.id]);

  // Plan actions
  const handleSaveDay = (updated: TradingDay) => {
    storage.saveTradingDay(updated);
    setTradingDays(storage.getTradingDays());
  };

  /**
   * Opens the plan lock preview instead of locking outright. Locking commits the day's
   * risk, so the trader first sees the plan's stats, a live sector heat map and an
   * honest coach opinion, then confirms. The actual lock happens in confirmLockPlan.
   */
  const handleLockPlan = () => {
    setIsLockPreviewOpen(true);
  };

  /** The confirmed lock: stores the immutable baseline and closes the preview. */
  const confirmLockPlan = () => {
    storage.lockPlan(todayTradingDay.id);
    setTradingDays(storage.getTradingDays());
    setIsLockPreviewOpen(false);
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
   * Everything the coach needs about this journal, in one object.
   *
   * Built from the live state rather than cached for the session, because the whole value
   * of these answers is that they reflect the journal as it is right now.
   */
  const coachContext = useMemo<PlanCoachContext>(
    () => ({
      day: todayTradingDay,
      // The account drawdown travels with the journal context, so a plan or size the coach
      // suggests can be measured against the room that is actually left.
      maxDrawdown: profile.maxDrawdown ?? null,
      instruments,
      setups,
      trades,
      tradingDays,
      reviews,
      timezone: profile.timezone,
    }),
    [todayTradingDay, instruments, setups, trades, tradingDays, reviews, profile.timezone]
  );

  /**
   * Asks the coach for its own call on an entry that was just recorded, and stores it
   * beside the trade.
   *
   * Deliberately fire-and-forget: the trade is already saved by the time this runs, so a
   * coach outage, a rate limit or a slow model costs the trader nothing but a missing
   * comparison row. It never touches the plan or the position.
   */
  const recordCoachEntryCall = useCallback(
    async (trade: Trade) => {
      if (!trade.entryPrice || !trade.initialStop) return;

      const result = await askEntryCall(coachContext, {
        symbol: instrumentSymbol(instruments, trade.instrumentId),
        direction: trade.direction,
        contracts: trade.contracts,
        entryPrice: trade.entryPrice,
        initialStop: trade.initialStop,
        setupName: trade.setupName,
        entryReason: trade.entryReason,
        session: trade.session,
      });
      if (!result.ok || !('direction' in result.data)) return;

      const call = result.data as EntryCallResponse;
      // Re-read rather than trusting the captured trade: it may have been closed or
      // deleted while the coach was answering, and a coach call must never resurrect it.
      const current = storage.getTrades().find((t) => t.id === trade.id);
      if (!current) return;

      storage.saveTrade({
        ...current,
        coachCall: {
          direction: call.direction,
          entry: call.entry,
          stop: call.stop,
          target: call.target,
          rationale: call.rationale,
          marketPrice: result.instrument?.price ?? null,
          createdAt: new Date().toISOString(),
        },
      });
      setTrades(storage.getTrades());
    },
    [coachContext, instruments]
  );

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

    // A brand-new entry gets the coach's own call recorded against it. Edits do not: the
    // comparison is with the moment of entry, and re-asking later would compare the
    // trader against an answer they never saw at the time.
    if (!stored) void recordCoachEntryCall(tradeToSave);
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

  const handleSavePatternStudy = (study: PatternStudy) => {
    setPatternStudies(storage.savePatternStudy(study));
  };

  // Deep-link from the Morning Plan: switching to the Playbook tab focused on
  // today's watched setups. Cleared on the next manual tab change so a later
  // visit to the Playbook starts clean at the top of the list.
  const [playbookFocusSetups, setPlaybookFocusSetups] = useState<string[] | null>(null);
  const handleOpenPlaybook = useCallback(() => {
    setPlaybookFocusSetups(todayTradingDay.watchedSetups || []);
    setActiveTab('playbook');
  }, [todayTradingDay.watchedSetups]);

  /**
   * The chart-pattern deep link, as `#chart-patterns/<patternId>`.
   *
   * The app has no router, so one hash makes a pattern linkable and bookmarkable without
   * pulling in a routing library for a single screen. It is written on open, cleared on
   * close, and re-read on load and on `hashchange`, so a pasted or bookmarked link opens
   * the same pattern again. The write is a `replaceState` on purpose: stepping through
   * twenty patterns should not leave twenty entries in the back button.
   */
  const [playbookFocusPattern, setPlaybookFocusPattern] = useState<string | null>(() =>
    readPatternFromHash()
  );

  const handleOpenPattern = useCallback((patternId: string | null) => {
    setPlaybookFocusPattern(patternId);
    const next = patternId ? `#chart-patterns/${patternId}` : '';
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
    } catch {
      // A blocked history write must not stop the pattern from opening.
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const patternId = readPatternFromHash();
      setPlaybookFocusPattern(patternId);
      if (patternId) setActiveTab('playbook');
    };
    // Applies a pasted link on load, and any later hash edit (typed URL, bookmark).
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const handleSelectTab = useCallback(
    (tab: NavTab) => {
      setPlaybookFocusSetups(null);
      setActiveTab(tab);
    },
    []
  );

  /**
   * Opens a chart pattern from elsewhere in the app (a trade whose setup is one of the
   * patterns). Closing the trade first keeps only one dialog on screen: the pattern guide
   * replaces it rather than stacking on top of it.
   */
  const handleStudyPattern = useCallback(
    (patternId: string) => {
      setViewingTradeId(null);
      setPlaybookFocusSetups(null);
      handleOpenPattern(patternId);
      setActiveTab('playbook');
    },
    [handleOpenPattern]
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
      // Deliberate and destructive, so it takes the unconditional write: a
      // pending conflict must not leave the emptied journal stuck locally while
      // the cloud still holds everything the trader just wiped.
      cloudRevisionRef.current = await overwriteJournal(userId, fresh);
      setSyncConflict(false);
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
      setSetups(storage.ensureSetupCatalog());
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
            {/* Yesterday's Focus Lesson Banner — held for the day once acknowledged. */}
            {yesterdayFocus && (
              <YesterdayFocusBanner
                yesterdayFocus={yesterdayFocus}
                acknowledged={lessonAcknowledged}
                acknowledgedAt={lessonAck?.acknowledgedAt ?? null}
                onAcknowledge={handleAcknowledgeLesson}
              />
            )}

            {/*
              The review trend opens only after the lesson is accepted. It is the evidence
              behind the lesson: what the last weeks of execution actually looked like.
            */}
            {lessonAcknowledged && (
              <Suspense
                fallback={
                  <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
                    Loading your review trend…
                  </div>
                }
              >
                <ReviewTrendPanel
                  reviews={reviews}
                  tradingDays={tradingDays}
                  trades={trades}
                />
              </Suspense>
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
              maxDrawdown={profile.maxDrawdown ?? null}
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


            {/* The coach's call on each entry against the trader's own, for today */}
            <CoachEntryComparison trades={todayTrades} instruments={instruments} />

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

            {/*
              What the account can still absorb, directly above what today is allowed to
              risk. The plan's loss limit can read unchanged while the room behind it is
              nearly gone, and this is the moment that gap matters most.
            */}
            <DrawdownRoomStrip
              capacity={riskCapacity}
              plannedSize={plannedSizeRisk}
              onOpenRisk={() => setActiveTab('analytics')}
            />

            {/* Morning Plan & Guardrails Form */}
            <DailyPlanForm
              day={todayTradingDay}
              setups={setups}
              instruments={instruments}
              openTrades={todayTrades.filter((t) => t.status === 'open')}
              onSaveDay={handleSaveDay}
              onLockPlan={handleLockPlan}
              lockPreviewOpen={isLockPreviewOpen}
              onRecordPlanChange={handleRecordPlanChange}
              onOpenPlaybook={handleOpenPlaybook}
              onLogScaleInTrade={openAddTrade}
              onUnlockPlan={handleUnlockPlan}
              coachContext={coachContext}
              drawdownCapacity={riskCapacity}
              plannedSizeRisk={plannedSizeRisk}
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
            maxDrawdown={profile.maxDrawdown ?? null}
            dailyLossLimit={todayTradingDay.plannedLossLimit || profile.defaultDailyLossLimit}
            onUpdateMaxDrawdown={(value) =>
              handleUpdateProfile({ ...profile, maxDrawdown: value })
            }
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
            maxDrawdown={profile.maxDrawdown ?? null}
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
            patternStudies={patternStudies}
            onSavePatternStudy={handleSavePatternStudy}
            focusPatternId={playbookFocusPattern}
            onOpenPattern={handleOpenPattern}
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
      {syncConflict && (
        <CloudConflictBanner
          busy={resolvingConflict}
          onUseCloudCopy={handleUseCloudCopy}
          onKeepThisDevice={handleKeepThisDevice}
        />
      )}
      {storageFailure && (
        <StorageWarningBanner
          failure={storageFailure}
          usageBytes={storageUsageBytes}
          onDismiss={dismissStorageFailure}
        />
      )}
      {!cloudEnabled && <LocalOnlyNotice />}
      <Suspense fallback={<TabLoading />}>{renderTabContent()}</Suspense>

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
        onStudyPattern={handleStudyPattern}
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

      {/* Plan Lock Preview: stats + live sector heat map + coach opinion before committing */}
      <PlanLockPreviewModal
        isOpen={isLockPreviewOpen}
        day={todayTradingDay}
        instruments={instruments}
        trades={trades}
        reviews={reviews}
        setups={setups}
        timezone={profile.timezone}
        maxDrawdown={profile.maxDrawdown ?? null}
        onConfirm={confirmLockPlan}
        onBack={() => setIsLockPreviewOpen(false)}
      />
    </AppShell>
  );
}

/**
 * Keeps the app's plain-language fallback for cloud failures, unless the error
 * itself carries instructions worth reading (a missing schema column, an
 * unconfigured client). Those are more useful than "sync is unavailable".
 */
function describeSyncFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/schema\.sql|is not configured/i.test(message)) return message;
  return fallback;
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

/** Placeholder while a tab's code arrives, sized so the layout does not jump. */
function TabLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-zinc-400">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      <p className="text-xs font-mono">Loading…</p>
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
