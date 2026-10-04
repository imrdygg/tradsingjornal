import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  AppShell,
  NavTab,
} from './components/layout/AppShell';
import { YesterdayFocusBanner } from './components/today/YesterdayFocusBanner';
import { DrawdownRoomStrip } from './components/today/DrawdownRoomStrip';
import { realizedPnL } from './lib/analytics/realized-pnl';
import { summariseCoachPlanPending } from './lib/analytics/coach-plan-grades';
import { TodaySummary } from './components/today/TodaySummary';
import { ImportantLevelsEditor } from './components/today/ImportantLevelsEditor';
import { GlobalSearch } from './components/common/GlobalSearch';
import { CollapsibleSection } from './components/common/CollapsibleSection';
import { FeedbackModal } from './components/common/FeedbackModal';
import { TradeCard } from './components/trades/TradeCard';
import { TradeFormModal } from './components/trades/TradeFormModal';
import { TradeCloseModal } from './components/trades/TradeCloseModal';
import { RiskFixupModal } from './components/trades/RiskFixupModal';
import { TradeDetailModal } from './components/trades/TradeDetailModal';
import { DailyReviewModal } from './components/review/DailyReviewModal';
import { LatestReviewCard } from './components/today/LatestReviewCard';
import { SessionExtremesCard } from './components/today/SessionExtremesCard';
import { ExtremeMatchStrip } from './components/today/ExtremeMatchStrip';
import { askEntryCall, buildCoachPlanPatch, type PlanCoachContext } from './lib/ai/plan-coach';
import type { CoachPlanFields, EntryCallResponse } from './lib/ai/coach-types';

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
 * The coach's own calls load on demand like the other views.
 *
 * It carries the grade trend chart, so pulling recharts into the first paint to render a tab
 * the trader has not opened would undo the reason the views are split up.
 */
const CallsView = lazy(() =>
  import('./components/coach/CallsView').then((m) => ({ default: m.CallsView }))
);
/**
 * Markets loads on demand like the other tab views. Besides the bytes, the point is the
 * provider's chart script: it is injected only when this view mounts, so a trader who
 * never opens Markets never downloads it.
 */
const MarketsView = lazy(() =>
  import('./components/markets/MarketsView').then((m) => ({ default: m.MarketsView }))
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
  LevelTouch,
  SessionExtreme,
  ChartSearch,
  Lesson,
  CoachPlan,
  ImportantLevel,
  FeedbackNote,
  MarkedLevel,
  LevelOutlook,
} from './types';
import type { SyncStatus } from './components/layout/SyncStatusBadge';
import { storage, dismissStorageFailure, measureJournalBytes } from './lib/storage';
import { FOCUS_SETUP_NAMES } from './lib/playbook/focus-setups';
import type { StorageState } from './lib/storage';
import { useStorageFailure } from './lib/storage/use-storage-failure';
import { StorageWarningBanner } from './components/common/StorageWarningBanner';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { loadOrMigrateJournal, overwriteJournal } from './lib/cloud-sync';
import { countLocalOnlyRecords, createJournalSaver } from './lib/journal-sync';
import { migrateJournalMedia, uploadImageDataUrl } from './lib/media/media-utils';
import { parseTradovateCSV } from './lib/trading/tradovate-import';
import type { CsvImportSummary } from './lib/trading/tradovate-import';
import { buildPositionGroups, findPositionGroup } from './lib/trading/position-groups';
import { findAssumedRiskTrades, RiskFixItem } from './lib/trading/risk-fixup';
import { instrumentSymbol } from './lib/trading/instruments';
import { riskTierAmounts, tierCapStatuses } from './lib/trading/risk-tiers';
import { acknowledgementFor, isLessonAcknowledged } from './lib/storage/lesson-ack';
import { tradingDateOf } from './lib/storage/date-utils';
import {
  assessPlannedSize,
  assessRiskCapacity,
  estimateStopDistance,
} from './lib/analytics/risk-capacity';
import { findInstrument, trackedLevelInstruments } from './lib/trading/instruments';
import { Plus, Award, Sparkles, Layers, Activity, Target, Cloud, CloudOff, Loader2 } from 'lucide-react';

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
  // The catalog is merged on read, so a contract added since this journal was created
  // arrives here instead of only on a fresh install.
  const [instruments, setInstruments] = useState<Instrument[]>(() =>
    storage.ensureInstrumentCatalog()
  );
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
  // The break-and-run journal. Held with the rest of the state so every touch is
  // persisted locally and carried to the cloud by the same debounced save.
  const [levelTouches, setLevelTouches] = useState<LevelTouch[]>(() =>
    storage.getLevelTouches()
  );
  // The levels the trader marked before any of them was touched. Held with the journal so a
  // marked line is saved and carried between devices by the same debounced write.
  const [markedLevels, setMarkedLevels] = useState<MarkedLevel[]>(() =>
    storage.getMarkedLevels()
  );
  // What the trader expects each instrument to do today, written beside the levels. Held with
  // the journal so a written lean is saved and carried between devices by the same write.
  const [levelOutlooks, setLevelOutlooks] = useState<LevelOutlook[]>(() =>
    storage.getLevelOutlooks()
  );
  // Where each session's extremes printed on the clock. The trader's own record, held with
  // the rest of the state so it is saved and synced by the same debounced write.
  const [sessionExtremes, setSessionExtremes] = useState<SessionExtreme[]>(() =>
    storage.getSessionExtremes()
  );
  // The saved picture searches: which charts the trader uploaded and what they matched.
  // Held with the rest of the state so it is saved and synced by the same debounced write.
  const [chartSearches, setChartSearches] = useState<ChartSearch[]>(() =>
    storage.getChartSearches()
  );
  // The lessons the trader wrote for themselves: their own notes, tags and media, held with
  // the rest of the state so they are saved and synced by the same debounced write.
  const [lessons, setLessons] = useState<Lesson[]>(() => storage.getLessons());
  // The plans the coach made on its own, with the trader's grades and feedback. Held with
  // the journal so a plan and its grade are saved and carried between devices by the same
  // debounced write.
  const [coachPlans, setCoachPlans] = useState<CoachPlan[]>(() => storage.getCoachPlans());
  // The trader's own notes about what needs fixing in the app. Held with the journal so they
  // are saved and carried between devices by the same debounced write as everything else.
  const [feedback, setFeedback] = useState<FeedbackNote[]>(() => storage.getFeedback());

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
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
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
      // Kept with the instruments it describes, so a cloud copy carries the version the
      // list was brought to and the adopting device does not re-run a merge that skips it.
      instrumentCatalogVersion: storage.getInstrumentCatalogVersion(),
      setups,
      tradingDays,
      trades,
      reviews,
      patternStudies,
      levelTouches,
      markedLevels,
      levelOutlooks,
      sessionExtremes,
      chartSearches,
      lessons,
      coachPlans,
      feedback,
      lessonAck,
    }),
    [
      profile,
      instruments,
      setups,
      tradingDays,
      trades,
      reviews,
      patternStudies,
      levelTouches,
      markedLevels,
      levelOutlooks,
      sessionExtremes,
      chartSearches,
      lessons,
      coachPlans,
      feedback,
      lessonAck,
    ]
  );

  // Keep the latest state reachable from the sign-out handler without re-running effects.
  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;

  // The cloud revision this device last read or wrote. Kept in a ref, not state,
  // because a successful save changing state would re-run the save effect and
  // loop forever.
  const cloudRevisionRef = useRef<number | null>(null);

  /**
   * Adopts a snapshot as the whole journal, local storage included, so a reload
   * or a cloud copy taken in a conflict cannot leave the two disagreeing.
   */
  const applyJournalState = useCallback(
    (next: StorageState) => {
      storage.importData(JSON.stringify(next));
      setProfile({ ...next.profile, id: userId });
      // Re-runs the catalog merge against the snapshot just adopted, for the same reason
      // as the setups below: a copy taken before this release would otherwise reintroduce
      // the same missing contract.
      setInstruments(storage.ensureInstrumentCatalog());
      // Re-runs the catalog merge against the snapshot just adopted: a cloud copy taken
      // before this release would otherwise reintroduce the same missing setups.
      setSetups(storage.ensureSetupCatalog());
      setTradingDays(next.tradingDays);
      setTrades(next.trades);
      setReviews(next.reviews);
      setPatternStudies(next.patternStudies ?? []);
      setLevelTouches(next.levelTouches ?? []);
      setMarkedLevels(next.markedLevels ?? []);
      setLevelOutlooks(next.levelOutlooks ?? []);
      setSessionExtremes(next.sessionExtremes ?? []);
      setChartSearches(next.chartSearches ?? []);
      setLessons(next.lessons ?? []);
      setCoachPlans(next.coachPlans ?? []);
      setFeedback(next.feedback ?? []);
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
        // Adopting the cloud copy is the one moment a sync can overwrite work this
        // device is holding, so anything the cloud does not already have is set aside
        // first. It costs a check on sign-in and nothing in normal use, where the two
        // copies agree.
        const localOnly = countLocalOnlyRecords(currentStateRef.current, snapshot.state);
        if (localOnly > 0) {
          storage.saveRecoveryCopy(
            JSON.stringify(currentStateRef.current),
            `This device was holding ${localOnly} ${
              localOnly === 1 ? 'record' : 'records'
            } the cloud copy did not have when it signed in and downloaded the cloud copy over them.`
          );
        }
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
   * The one path the journal takes to the cloud.
   *
   * Writes are serialised rather than fired in parallel: the debounce below does not
   * cancel a write already in flight, so two saves could both carry the revision this
   * device last read and the second was refused by the first — reported to the trader as
   * another device's change when it was this device refusing itself.
   *
   * A refusal that survives that (a genuine write from another device) is resolved here
   * by saving this device's copy, which is the one being typed into. The copy it replaces
   * is set aside first, so resolving is never the reason work is gone.
   */
  const persistJournal = useMemo(
    () =>
      createJournalSaver({
        userId,
        readState: () => currentStateRef.current,
        readRevision: () => cloudRevisionRef.current,
        writeRevision: (revision) => {
          cloudRevisionRef.current = revision;
        },
        onRemoteReplaced: (remote) => {
          if (!remote) return;
          storage.saveRecoveryCopy(
            JSON.stringify(remote),
            'A save from this device replaced it while syncing — it had been written by another device.'
          );
        },
      }),
    [userId]
  );

  // `currentState` is not read in the body: it is the trigger. Any journal edit
  // produces a new object here and schedules the debounced save below.
  useEffect(() => {
    if (!cloudEnabled || !cloudReady) return;
    setSyncStatus('saving');
    const timeout = window.setTimeout(async () => {
      const result = await persistJournal();
      if (result === 'saved') {
        setSyncStatus('saved');
        setLastSyncedAt(new Date());
      } else {
        setSyncStatus('error');
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [cloudEnabled, cloudReady, persistJournal, currentState]);

  const retrySave = useCallback(async () => {
    if (!cloudEnabled) return;
    setSyncStatus('saving');
    const result = await persistJournal();
    if (result === 'saved') {
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } else {
      setSyncStatus('error');
    }
  }, [cloudEnabled, persistJournal]);

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
        // A failed final save must not clear the local copy: that is the only place
        // this session's work would still exist.
        flushed = false;
        setSyncStatus('error');
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

  /**
   * The trader's numbered risk ladder, read once per profile change.
   *
   * The plan, the lock preview and the trade form all show the same four amounts, so it is
   * resolved here rather than in each of them — one place decides what a slot is worth.
   */
  const riskTiers = useMemo(() => riskTierAmounts(profile), [profile]);

  /**
   * The instruments the level cards offer.
   *
   * The trade catalog plus any levels-only symbol (VIX), kept apart from `instruments` so a
   * symbol the account cannot hold never reaches the trade form or a P&L calculation.
   */
  const levelInstruments = useMemo(() => trackedLevelInstruments(instruments), [instruments]);

  /**
   * Coach calls still waiting on the trader — ungraded, or with no result marked.
   *
   * Held here rather than in the shell so the header only learns a number, and derived from
   * the same state the Calls tab renders, so the badge can never disagree with the page.
   */
  const pendingCoachCalls = useMemo(
    () => summariseCoachPlanPending(coachPlans).pending,
    [coachPlans]
  );

  /** How many feedback notes are still open — the number the header badge shows. */
  const openFeedbackCount = useMemo(
    () => feedback.filter((note) => note.status === 'open').length,
    [feedback]
  );

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
   * Computed from the same function the Analytics panel uses, so the line beside today's plan
   * and the panel that explains it can never disagree about the same account. Read net of
   * fees, like the coach and the review trend: the limit is enforced in the money that
   * actually reached the account, so the room it leaves has to be counted the same way.
   */
  const riskCapacity = useMemo(
    () =>
      assessRiskCapacity({
        trades: trades.filter((t) => t.status === 'closed'),
        maxDrawdown: profile.maxDrawdown ?? null,
        dailyLossLimit: todayTradingDay.plannedLossLimit || profile.defaultDailyLossLimit,
        pnlOf: realizedPnL,
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

  /**
   * The risk slots today's trades have used up.
   *
   * Read from the day's own trades and caps, the same pair the trade form warns with, so the
   * summary and the form can never disagree about whether a slot is spent.
   */
  const tierCapFlags = useMemo(
    () => tierCapStatuses(todayTrades, todayTradingDay.riskTierCaps),
    [todayTrades, todayTradingDay.riskTierCaps]
  );

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
   * Saves today's levels from the Today tab.
   *
   * The editor builds its rows in the form, so the day is stamped on here: a level is a fact
   * about one trading day, and everything that reads them — the coach's live-price warning,
   * the Playbook's level log, a search result — expects that link to be there.
   */
  const handleSaveTodayLevels = (levels: ImportantLevel[]) => {
    handleSaveDay({
      ...todayTradingDay,
      importantLevels: levels.map((level) => ({ ...level, tradingDayId: todayTradingDay.id })),
    });
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
      // The level log and the day's written levels travel with every plan-side request, so a
      // self-plan or a scale-in read can quote the line the trader is actually watching.
      levelTouches,
      markedLevels,
      levelOutlooks,
    }),
    [
      todayTradingDay,
      instruments,
      setups,
      trades,
      tradingDays,
      reviews,
      profile.timezone,
      levelTouches,
      markedLevels,
      levelOutlooks,
    ]
  );

  /**
   * Writes a coach-drafted plan from the Markets tab into today's plan.
   *
   * The draft was made for the one symbol on the chart, so it becomes the day's primary
   * instrument only when the journal's own catalog actually holds that symbol: a chart of
   * a market this app cannot price must never redirect the day's sizing. Nothing here
   * locks the plan — the trader still reviews and locks it themselves.
   */
  const handleApplyChartPlan = (draft: CoachPlanFields, symbol: string) => {
    const key = symbol.trim().toLowerCase();
    const match = instruments.find(
      (inst) => inst.symbol.toLowerCase() === key || inst.id.toLowerCase() === key
    );
    const patch = buildCoachPlanPatch({
      day: todayTradingDay,
      draft,
      setups,
      primaryInstrument: match?.symbol,
    });
    handleSaveDay({ ...todayTradingDay, ...patch });
  };

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
        targetPrice: trade.targetPrice,
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
    const entryTime = tradeData.entryTime || now;

    // A trade belongs to the session its entry falls in. Editing is not allowed to move a
    // past trade into today on its own — that is what used to corrupt both days at once — but
    // the entry time carries the date, and changing it is exactly how a trade written down on
    // the wrong day (a Friday close logged as Saturday) is re-filed onto its real session. So
    // the day only moves when the entry's date actually changed.
    let tradingDayId = stored?.tradingDayId ?? todayTradingDay.id;
    const entryDate = tradingDateOf(entryTime, profile.timezone);
    if (stored && entryDate) {
      const storedDate = storage.getTradingDayById(stored.tradingDayId)?.tradeDate;
      if (entryDate !== storedDate) {
        tradingDayId = storage.getOrCreateDay(entryDate).id;
        setTradingDays(storage.getTradingDays());
      }
    }

    const tradeToSave: Trade = {
      // Identity and provenance are not the form's to change.
      id: stored?.id ?? `trade-${Date.now()}`,
      userId: profile.id,
      tradingDayId,
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
      entryTime,
      exitTime: tradeData.exitTime,
      session: tradeData.session || 'Regular Session',
      // A trade saved without a setup still has to carry a label, and the one the app is
      // built around is the least presumptuous: it says "a level trade" rather than
      // inventing a pattern the trader never picked.
      setupName: tradeData.setupName || FOCUS_SETUP_NAMES[0],
      entryReason: tradeData.entryReason,
      targetPrice: tradeData.targetPrice,
      exitReason: tradeData.exitReason,
      notes: tradeData.notes,
      exitNote: tradeData.exitNote,
      tags: tradeData.tags,
      // A trade logged without a stop records no risk, and 0 is a real answer there — the
      // `|| 50` this used to be would have turned "no stop" into a confident $50 of risk,
      // which is exactly the invented number the rest of the journal refuses to show. Only
      // a caller that omits the field entirely still falls back.
      initialRisk: tradeData.initialRisk ?? 50,
      // The risk slot the form recorded the trade against. `null` is the custom option and
      // is a real value, so it is taken as given rather than merged like the fields above;
      // undefined falls back to what was stored (a pre-ladder trade keeps having none).
      riskTier: tradeData.riskTier !== undefined ? tradeData.riskTier : stored?.riskTier,
      plannedRisk:
        tradeData.plannedRisk !== undefined ? tradeData.plannedRisk : stored?.plannedRisk,
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
      exitReason?: string;
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
      exitReason: exitData.exitReason ?? existing.exitReason,
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

  const handleDeleteTradingDay = (dayId: string) => {
    storage.deleteTradingDay(dayId);
    setTradingDays(storage.getTradingDays());
    setTrades(storage.getTrades());
    setReviews(storage.getReviews());
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

  /**
   * Records a level touch, whether it is a brand new one or an outcome being decided later.
   *
   * Both paths are the same write on purpose: storage upserts by id, so marking a touch
   * "never came back" a week later is the same call that created it, and the touch keeps its
   * place in the list instead of jumping to the front as if it were fresh.
   */
  const handleSaveLevelTouch = (touch: LevelTouch) => {
    storage.saveLevelTouch(touch);
    setLevelTouches(storage.getLevelTouches());
  };

  const handleDeleteLevelTouch = (touchId: string) => {
    storage.deleteLevelTouch(touchId);
    setLevelTouches(storage.getLevelTouches());
  };

  /**
   * Writes down the batch of levels the trader marked for today.
   *
   * Storage skips a level whose day, instrument, side and price are already on the record,
   * so pasting the same indicator lines twice adds nothing the second time — the state is
   * read back rather than appended here, so the card and the record cannot disagree.
   */
  const handleSaveMarkedLevels = (batch: MarkedLevel[]) => {
    setMarkedLevels(storage.saveMarkedLevels(batch));
  };

  /**
   * Rewrites one marked level in place.
   *
   * Used to close a line out — never touched or void — and to reopen it again. Storage upserts
   * by id, so this is the same write path a corrected price would take.
   */
  const handleUpdateMarkedLevel = (level: MarkedLevel) => {
    setMarkedLevels(storage.saveMarkedLevel(level));
  };

  /**
   * Finds or creates the trading day for a date.
   *
   * Called when a record is moved to another day, so the record belongs to a session that exists
   * rather than pointing at one History never shows.
   */
  const handleResolveTradingDay = (date: string): TradingDay => {
    const day = storage.getOrCreateDay(date);
    setTradingDays(storage.getTradingDays());
    return day;
  };

  const handleDeleteMarkedLevel = (levelId: string) => {
    setMarkedLevels(storage.deleteMarkedLevel(levelId));
  };

  /** Writes or edits today's outlook for one instrument. */
  const handleSaveLevelOutlook = (outlook: LevelOutlook) => {
    setLevelOutlooks(storage.saveLevelOutlook(outlook));
  };

  /**
   * Records one session extreme.
   *
   * Storage upserts by slot as well as by id, so re-logging the same symbol, date, kind and
   * window corrects that reading instead of adding a second one — a typo and its fix can
   * never both sit in the record.
   */
  const handleSaveSessionExtreme = (extreme: SessionExtreme) => {
    storage.saveSessionExtreme(extreme);
    setSessionExtremes(storage.getSessionExtremes());
  };

  const handleDeleteSessionExtreme = (extremeId: string) => {
    storage.deleteSessionExtreme(extremeId);
    setSessionExtremes(storage.getSessionExtremes());
  };

  /**
   * Records one completed picture search.
   *
   * Storage caps the list and drops the oldest, so the state is read back from storage
   * rather than appended here — the two can never disagree about what was kept.
   */
  const handleSaveChartSearch = (search: ChartSearch) => {
    setChartSearches(storage.saveChartSearch(search));
  };

  /**
   * Records one lesson, new or edited. Storage upserts by id, so an edit rewrites the same
   * record — the media already attached stays put — rather than adding a second copy.
   */
  const handleSaveLesson = (lesson: Lesson) => {
    setLessons(storage.saveLesson(lesson));
  };

  const handleDeleteLesson = (lessonId: string) => {
    setLessons(storage.deleteLesson(lessonId));
  };

  /**
   * Marks the lessons the coach just read, so the library can show what is new since then.
   *
   * Written straight to storage rather than through a full lesson save: this only touches
   * `lastReadAt` on the ids that were in the read, and it must not disturb the notes or media
   * a save would rewrite.
   */
  const handleMarkLessonsRead = (lessonIds: string[], at: string) => {
    if (!lessonIds.length) return;
    setLessons(storage.markLessonsRead(lessonIds, at));
  };

  /**
   * Records one of the coach's own plans, new or newly graded.
   *
   * Storage upserts by id, so grading re-writes the plan that was on screen rather than
   * adding a second copy — the grade attaches to the levels and reasoning it judged.
   */
  const handleSaveCoachPlan = (plan: CoachPlan) => {
    setCoachPlans(storage.saveCoachPlan(plan));
  };

  const handleDeleteCoachPlan = (planId: string) => {
    setCoachPlans(storage.deleteCoachPlan(planId));
  };

  /**
   * Writes down one note about the app itself, in the trader's own words.
   *
   * The tab they were looking at rides along as context, so a note like "this is in the
   * wrong place" can be found again weeks later with the screen it was about.
   */
  const handleAddFeedback = (text: string, context?: string) => {
    const now = new Date().toISOString();
    setFeedback(
      storage.saveFeedback({
        id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: profile.id,
        text,
        context,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
    );
  };

  /** Marks a note fixed, or reopens one that was. */
  const handleToggleFeedbackStatus = (note: FeedbackNote) => {
    const fixed = note.status !== 'fixed';
    setFeedback(
      storage.saveFeedback({
        ...note,
        status: fixed ? 'fixed' : 'open',
        resolvedAt: fixed ? new Date().toISOString() : undefined,
      })
    );
  };

  const handleDeleteFeedback = (id: string) => {
    setFeedback(storage.deleteFeedback(id));
  };

  const handleDeleteChartSearch = (searchId: string) => {
    setChartSearches(storage.deleteChartSearch(searchId));
  };

  /**
   * The trades taken on one session date, for linking a logged extreme back to what it led to.
   *
   * Read from the day records rather than from a stored link, so it stays right when a trade
   * is added or deleted later — the logging card links a session, not a fixed set of ids.
   */
  const tradeIdsForDate = useCallback(
    (date: string) => {
      const day =
        tradingDays.find((candidate) => candidate.tradeDate === date) ??
        (todayTradingDay.tradeDate === date ? todayTradingDay : undefined);
      if (!day) return [];
      return trades.filter((trade) => trade.tradingDayId === day.id).map((trade) => trade.id);
    },
    [tradingDays, trades, todayTradingDay]
  );

  /**
   * What the journal already records under each setup name.
   *
   * Read from the trades and days themselves rather than from a counter kept on the setup,
   * so a rename can offer to bring the entries along and the offer is always the real
   * number — including for trades imported with a name that has no setup row at all.
   */
  const setupUsage = useMemo(() => {
    const byName: Record<string, { trades: number; days: number }> = {};
    const bucket = (name: string) => {
      const key = name.trim().toLowerCase();
      if (!key) return null;
      byName[key] = byName[key] ?? { trades: 0, days: 0 };
      return byName[key];
    };

    for (const trade of trades) {
      const entry = trade.setupName ? bucket(trade.setupName) : null;
      if (entry) entry.trades += 1;
    }

    // Today's day is created lazily on the first render and written straight to storage,
    // so it is not in `tradingDays` until something else refreshes that state. Adding it
    // here keeps today's watch list counted — and today is the day whose entries are most
    // likely to matter when a setup is renamed.
    const daysById = new Map<string, TradingDay>();
    for (const day of tradingDays) daysById.set(day.id, day);
    daysById.set(todayTradingDay.id, todayTradingDay);

    for (const day of daysById.values()) {
      for (const name of day.watchedSetups ?? []) {
        const entry = bucket(name);
        if (entry) entry.days += 1;
      }
    }
    return byName;
  }, [trades, tradingDays, todayTradingDay]);

  const handleRenameSetup = (id: string, name: string): Setup[] | null => {
    const updated = storage.renameSetup(id, name);
    if (!updated) return null;
    setSetups(updated);
    return updated;
  };

  const handleReorderSetups = (orderedIds: string[]) => {
    setSetups(storage.reorderSetups(orderedIds));
  };

  const handleRelabelSetup = (oldName: string, newName: string) => {
    storage.relabelSetupReferences(oldName, newName);
    setTrades(storage.getTrades());
    setTradingDays(storage.getTradingDays());
  };

  /**
   * A trading day to open in the History tab's day detail, handed over from the home
   * page's search: a plan or review match has no modal of its own on Today, so the
   * result lands where the day can actually be read. Cleared once consumed, and on any
   * manual tab change, so a later History visit starts clean.
   */
  const [historyFocusDayId, setHistoryFocusDayId] = useState<string | null>(null);

  // Deep-link from the Morning Plan: switching to the Playbook tab focused on
  // today's watched setups. Cleared on the next manual tab change so a later
  // visit to the Playbook starts clean at the top of the list.
  const [playbookFocusSetups, setPlaybookFocusSetups] = useState<string[] | null>(null);
  const handleOpenPlaybook = useCallback(() => {
    setPlaybookFocusSetups(todayTradingDay.watchedSetups || []);
    setActiveTab('playbook');
  }, [todayTradingDay.watchedSetups]);

  /**
   * Deep-link from the Insights tab: the log filtered to the exact trades an observation
   * was counted from.
   *
   * Cleared on the next manual tab change, like the Playbook focus, so coming back later to
   * the log starts on the whole record rather than on a filter the trader set an hour ago
   * and has since forgotten about.
   */
  const [tradeFocus, setTradeFocus] = useState<{ label: string; tradeIds: string[] } | null>(
    null
  );
  const handleOpenTrades = useCallback((label: string, tradeIds: string[]) => {
    setTradeFocus({ label, tradeIds });
    setActiveTab('trades');
  }, []);

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
      setTradeFocus(null);
      setHistoryFocusDayId(null);
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
      levelTouches: [],
      sessionExtremes: [],
      chartSearches: [],
    };

    if (cloudEnabled && cloudReady) {
      // Deliberate and destructive, so it takes the unconditional write: the
      // emptied journal must not sit locally while the cloud still holds
      // everything the trader just wiped.
      cloudRevisionRef.current = await overwriteJournal(userId, fresh);
    }

    setTrades([]);
    setReviews([]);
    // The reset clears these two in storage as well, so the screen has to follow: a list
    // still on screen after "start fresh" would look like it had survived the reset.
    setLevelTouches([]);
    setSessionExtremes([]);
    // Recreate today's (empty) planning day so the app has somewhere to land.
    storage.getOrCreateToday();
    setTradingDays(storage.getTradingDays());
    setSyncStatus(cloudEnabled ? 'saved' : 'local');
    setLastSyncedAt(cloudEnabled ? new Date() : null);
  };

  /**
   * Moves the screenshots this browser is holding into the media bucket.
   *
   * Read, transform, adopt: the migration is handed the journal as it stands, uploads every
   * inline picture it finds and returns the state with links in their place. Adopting that state
   * replaces the heavy records and re-schedules the cloud save below, so the lighter copy is
   * what syncs.
   */
  const handleMoveScreenshotsToCloud = async () => {
    const before = storage.readState();
    const { state, counts } = await migrateJournalMedia(
      before,
      uploadImageDataUrl,
      new Date().toISOString()
    );

    if (counts.moved > 0) {
      // The quota banner is sticky, and the write it was reporting is long gone. Cleared before
      // the write below rather than after, so a failure from *this* write is recorded fresh and
      // a fixed browser is not left staring at a warning about a change it no longer lost.
      dismissStorageFailure();
      // `applyJournalState` is the existing adoption path: it writes the whole journal through
      // storage and re-runs the catalog merges, so the screen and storage cannot disagree about
      // which pictures are links now. Deliberately the only write — the journal is at the
      // browser's limit when this runs, so a second full pass is the last thing it needs.
      applyJournalState({ ...state, profile: { ...state.profile, id: userId } });
    }

    return counts;
  };

  const handleImportData = (jsonStr: string) => {
    const success = storage.importData(jsonStr);
    if (success) {
      setProfile(storage.getProfile());
      setInstruments(storage.ensureInstrumentCatalog());
      setSetups(storage.ensureSetupCatalog());
      setTradingDays(storage.getTradingDays());
      setTrades(storage.getTrades());
      setReviews(storage.getReviews());
      setSessionExtremes(storage.getSessionExtremes());
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
            {/*
              Today, said in one line.

              The number, the record behind it and the two things a trader does with it: write
              a trade down, and say how the day went. Under the strip the tab reads in the
              order the trader asked for: the carried-forward lesson first, because it is the
              one thing that has to be in view whether or not it is welcome; then the
              journal-wide search, always open; then the review trend, which is the evidence
              behind that lesson. The day's own panels follow below them.
            */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg font-bold tracking-tight text-zinc-100">Today</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-400">
                    <span>{todayTradingDay.tradeDate}</span>
                    <span
                      className={
                        todayRealizedPnL > 0
                          ? 'text-emerald-400'
                          : todayRealizedPnL < 0
                          ? 'text-rose-400'
                          : 'text-zinc-400'
                      }
                    >
                      {todayRealizedPnL > 0 ? '+' : ''}${todayRealizedPnL.toFixed(2)} today
                    </span>
                    <span>
                      {todayTrades.length} {todayTrades.length === 1 ? 'trade' : 'trades'}
                    </span>
                    <span>
                      {todayWins}W/{todayLosses}L
                    </span>
                    <span>{instrumentSymbol(instruments, todayTradingDay.primaryInstrument)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    id="btn-add-trade-top"
                    onClick={() => openAddTrade()}
                    className="flex items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4 stroke-[2.5]" />
                    Log a Trade
                  </button>

                  <button
                    onClick={() => setIsReviewModalOpen(true)}
                    className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 px-4 py-2 text-xs font-semibold text-zinc-200 shadow-sm transition-all hover:bg-zinc-800"
                  >
                    <Award className="h-4 w-4 text-amber-400" />
                    {todayReview ? 'Update Daily Review' : 'End-of-Day Review'}
                  </button>
                </div>
              </div>

              {importNotification && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/80 px-3 py-1.5 font-mono text-xs text-emerald-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{importNotification}</span>
                  <button
                    onClick={() => setImportNotification(null)}
                    className="ml-2 text-zinc-400 hover:text-zinc-200"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/*
              The lesson carried forward from the last session, first in the tab.

              It used to sit third, under the day's summary and its levels, which meant the
              one piece of writing the trader is meant to act on had to be scrolled to. It
              goes first now: a lesson nobody reads before the session is a lesson already
              lost.
            */}
            {yesterdayFocus && (
              <YesterdayFocusBanner
                yesterdayFocus={yesterdayFocus}
                acknowledged={lessonAcknowledged}
                acknowledgedAt={lessonAck?.acknowledgedAt ?? null}
                onAcknowledge={handleAcknowledgeLesson}
              />
            )}

            {/*
              Journal-wide search, directly under the lesson.

              It reads across every tab's records rather than the day's, which is why it
              belongs above the day's own panels: a box you reach by scrolling past the whole
              day is a box you stop using on the days you most need it. It used to fold away,
              and a box behind a line is one the trader has to remember exists — so it is
              always open, like the lesson above it.
            */}
            <section id="section-search" className="space-y-3">
              <GlobalSearch
                trades={trades}
                tradingDays={tradingDays}
                reviews={reviews}
                instruments={instruments}
                timezone={profile.timezone}
                onViewTrade={(trade) => setViewingTradeId(trade.id)}
                onOpenDay={(dayId) => {
                  setActiveTab('history');
                  setHistoryFocusDayId(dayId);
                }}
              />
            </section>

            {/*
              The review trend, directly under the search.

              This is the evidence behind the lesson at the top of the tab: the same history
              told by the trader's own writing rather than by the account. It moved up from
              the foot of the page because a trend read once a session, buried under a day's
              trades, is one that gets skipped on the days it matters. It is not held back
              until the lesson is accepted — closing the line because a banner was not
              clicked hid the trader's own record from them.
            */}
            <Suspense
              fallback={
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
                  Loading your review trend…
                </div>
              }
            >
              <CollapsibleSection
                id="section-review-trend"
                title="End-of-day review trend"
                meta={
                  <span className="font-mono text-[11px] text-zinc-400">
                    {reviews.length} reviewed
                  </span>
                }
                persistKey="review-trend"
              >
                <ReviewTrendPanel reviews={reviews} tradingDays={tradingDays} trades={trades} />
              </CollapsibleSection>
            </Suspense>

            {/*
              ── Today ─────────────────────────────────────────────────────────────────

              The day as it stands, under the lesson, the search and the trend. Nothing here
              is behind a click, because all of these are things a trader reads or writes
              around a session rather than during one, and each one stops working the moment
              it is folded away: a review that disappears after it is saved, and a record
              nobody scrolls back to, are the same as not having them.
            */}
            <CollapsibleSection
              id="section-today-summary"
              title="Today's summary"
              meta={
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    todayRealizedPnL > 0
                      ? 'text-emerald-400'
                      : todayRealizedPnL < 0
                      ? 'text-rose-400'
                      : 'text-zinc-400'
                  }`}
                >
                  {todayRealizedPnL >= 0 ? '+' : '-'}${Math.abs(todayRealizedPnL).toFixed(2)} ·{' '}
                  {todayWins}W/{todayLosses}L
                </span>
              }
              persistKey="today-summary"
            >
              <TodaySummary
                realizedPnL={todayRealizedPnL}
                totalTrades={todayTrades.length}
                wins={todayWins}
                losses={todayLosses}
                plannedMaxLoss={todayTradingDay.plannedLossLimit}
                onOpenAddTrade={openAddTrade}
                onOpenEndDay={() => setIsReviewModalOpen(true)}
                capStatuses={tierCapFlags}
              />
            </CollapsibleSection>

            {/*
              The levels today is read against.

              Two things in the app look forward rather than back, and both are fed by this
              list: the coach's warning (price measured against your own levels) and the
              Playbook's level log (which of them price actually touched). Neither can say
              anything without it, so it belongs on the day's own page instead of three tabs
              away — and marking levels is not the same as writing a plan. A level is a price,
              not a view, which is why it is the one morning entry this tab keeps.
            */}
            <section id="today-levels" className="space-y-3">
              <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
                <Target className="h-4 w-4 text-zinc-300" />
                Today's levels ({(todayTradingDay.importantLevels || []).length})
              </h2>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5">
                <ImportantLevelsEditor
                  levels={todayTradingDay.importantLevels || []}
                  onChange={handleSaveTodayLevels}
                  showHeading={false}
                />
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  The coach measures its live price against these, and the Playbook's level log
                  records which of them price touched. Nothing here says which way you think
                  the market is going — they are prices, not a bias.
                </p>
              </div>
            </section>

            {/*
              Where price went on the clock, logged by hand.

              The other half of "what price did" beside today's levels: the levels are the
              prices the trader marked before the session, and this is where the extremes
              actually printed overnight and during it. Neither can be fetched — the live
              quote has no clock on its range — so the record is theirs to keep, and the
              card's own picture is what the coach then reads back.
            */}
            <section id="today-extremes" className="space-y-3">
              {/*
                Whether this morning's print lands in an hour the log can speak about. Sits
                directly above the log so the counts it quotes are one line away, and renders
                nothing at all when there is nothing readable to say.
              */}
              <ExtremeMatchStrip
                extremes={sessionExtremes}
                todayTradeDate={todayTradingDay.tradeDate}
              />

              <SessionExtremesCard
                extremes={sessionExtremes}
                todayTradingDay={todayTradingDay}
                instruments={instruments}
                onSave={handleSaveSessionExtreme}
                onDelete={handleDeleteSessionExtreme}
                tradesForDate={tradeIdsForDate}
                onOpenTrades={handleOpenTrades}
              />
            </section>

            {/* The review the trader last wrote, so the focus they set is still in front of
                them when they sit down to trade it. */}
            <CollapsibleSection
              id="section-eod-review"
              title="End-of-day review"
              meta={
                <span className="font-mono text-[11px] text-zinc-400">
                  {reviews.length} recorded
                </span>
              }
              persistKey="eod-review"
            >
              <LatestReviewCard
                reviews={reviews}
                tradingDays={tradingDays}
                todayTradeDate={todayTradingDay.tradeDate}
                onOpenReview={() => setIsReviewModalOpen(true)}
              />
            </CollapsibleSection>

            {/*
              The journal itself — the reason the tab exists.

              Last inside Today, because it is the record everything above it is about: the
              summary, the lesson and the review are all reading these trades back.
            */}
            <section id="today-trades" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
                  <Layers className="h-4 w-4 text-zinc-300" />
                  Today's Trade Executions ({todayTrades.length})
                </h2>
                <span className="font-mono text-[11px] text-zinc-400">
                  {todayTrades.filter((t) => t.status === 'open').length} Open •{' '}
                  {todayTrades.filter((t) => t.status === 'closed').length} Closed
                </span>
              </div>

              {todayTrades.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center space-y-3">
                  <p className="text-xs text-zinc-400">
                    No trades logged for today yet. Entry, exit, why, note and tags — that is
                    the whole of it.
                  </p>
                  <button
                    onClick={() => openAddTrade()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-medium transition-colors hover:bg-zinc-700"
                  >
                    <Plus className="w-3.5 h-3.5" /> Log a Trade
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
            </section>

            {/*
              ── Drawdown room ──────────────────────────────────────────────────────────

              What is left of the account is the reading that belongs to today: it decides
              whether the next trade is affordable. The chart that explains how the room got
              here moved to Analytics, where the limit defining it is set, and the review
              trend now sits at the top of this tab beside the lesson it is the evidence for.
            */}
            <section id="today-room-and-trend" className="space-y-6">
              <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
                <Activity className="h-4 w-4 text-zinc-300" />
                Drawdown room
              </h2>

              <DrawdownRoomStrip
                capacity={riskCapacity}
                plannedSize={plannedSizeRisk}
                onOpenRisk={() => setActiveTab('analytics')}
              />
            </section>

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
            // Deep link from an Insights observation: the log opens narrowed to exactly the
            // trades that observation was counted from.
            focus={tradeFocus}
            onClearFocus={() => setTradeFocus(null)}
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
            focusDayId={historyFocusDayId}
            onConsumeFocusDay={() => setHistoryFocusDayId(null)}
            onDeleteTradingDay={handleDeleteTradingDay}
            // The archive can list the trades still owing an execution review; opening one
            // here is where that review is written.
            onViewTrade={(t) => setViewingTradeId(t.id)}
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
            riskTiers={riskTiers}
            coachPlans={coachPlans}
            onUpdateMaxDrawdown={(value) =>
              handleUpdateProfile({ ...profile, maxDrawdown: value })
            }
          />
        );

      case 'insights':
        return (
          <InsightsView
            trades={trades}
            tradingDays={tradingDays}
            onOpenTrades={handleOpenTrades}
            // A point on the equity curve is one trade, so it opens that trade here rather
            // than handing the log a filter for a single row.
            onOpenTrade={(tradeId) => setViewingTradeId(tradeId)}
          />
        );

      case 'coach':
        return (
          <CoachView
            trades={trades}
            tradingDays={tradingDays}
            reviews={reviews}
            setups={setups}
            instruments={instruments}
            todayTradingDay={todayTradingDay}
            todayTradeDate={todayTradingDay.tradeDate}
            timezone={profile.timezone}
            maxDrawdown={profile.maxDrawdown ?? null}
            levelTouches={levelTouches}
            markedLevels={markedLevels}
            levelOutlooks={levelOutlooks}
            sessionExtremes={sessionExtremes}
            // A trade the picture search matches opens from here like it does from the log.
            onViewTrade={(t) => setViewingTradeId(t.id)}
            chartSearches={chartSearches}
            onSaveChartSearch={handleSaveChartSearch}
            onDeleteChartSearch={handleDeleteChartSearch}
            onAddSetups={(drafts) => drafts.forEach(handleAddSetup)}
            userId={userId}
            // A finding the coach wrote from a question the trader asked is theirs to keep, so
            // it lands in the same lessons library everything else reads from.
            onSaveLesson={handleSaveLesson}
            coachPlans={coachPlans}
          />
        );

      case 'calls':
        return (
          <CallsView
            context={{
              day: todayTradingDay,
              maxDrawdown: profile.maxDrawdown ?? null,
              instruments,
              setups,
              trades,
              tradingDays,
              reviews,
              timezone: profile.timezone,
              levelTouches,
              // The self-plan read gets the trader's marked levels and per-instrument outlooks,
              // so its independent call can still weigh the lines the trader is watching.
              markedLevels,
              levelOutlooks,
              coachPlans,
            }}
            plans={coachPlans}
            defaultSymbol={instrumentSymbol(instruments, todayTradingDay.primaryInstrument)}
            instruments={instruments}
            userId={userId}
            onSavePlan={handleSaveCoachPlan}
            onDeletePlan={handleDeleteCoachPlan}
            timezone={profile.timezone}
            setupCount={setups.length}
            reviewCount={reviews.length}
          />
        );

      case 'markets':
        return (
          <MarketsView
            trades={trades}
            tradingDays={tradingDays}
            reviews={reviews}
            setups={setups}
            instruments={instruments}
            todayTradeDate={todayTradingDay.tradeDate}
            timezone={profile.timezone}
            maxDrawdown={profile.maxDrawdown ?? null}
            primaryInstrument={instrumentSymbol(instruments, todayTradingDay.primaryInstrument)}
            onApplyPlan={handleApplyChartPlan}
            planLocked={!!todayTradingDay.lockedAt}
            theme={theme}
            coachPlans={coachPlans}
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
            edgeFinder={{
              trades,
              tradingDays,
              reviews,
              instruments,
              todayTradeDate: todayTradingDay.tradeDate,
              timezone: profile.timezone,
              maxDrawdown: profile.maxDrawdown ?? null,
              levelTouches,
              // The marked levels travel with the read so the finder can report how many of
              // the trader's own lines were ever tested, not only how the tested ones held,
              // and the level instruments label VIX and the rest in that breakdown.
              markedLevels,
              levelOutlooks,
              levelInstruments,
              coachPlans,
            }}
            coachSetups={{
              trades,
              tradingDays,
              reviews,
              instruments,
              todayTradeDate: todayTradingDay.tradeDate,
              timezone: profile.timezone,
              maxDrawdown: profile.maxDrawdown ?? null,
              levelTouches,
              // The levels and the day's outlooks travel with the setup learner too, so a
              // proposal can name a line the trader marked but has not yet traded against.
              markedLevels,
              levelOutlooks,
              coachPlans,
            }}
            // The levels the trader marks before any of them is touched. Tapping one logs
            // the touch it produces.
            markedLevels={{
              levels: markedLevels,
              touches: levelTouches,
              todayTradingDay,
              instruments: levelInstruments,
              timezone: profile.timezone,
              onSaveLevels: handleSaveMarkedLevels,
              onUpdateLevel: handleUpdateMarkedLevel,
              onResolveDay: handleResolveTradingDay,
              onDeleteLevel: handleDeleteMarkedLevel,
              onSaveTouch: handleSaveLevelTouch,
              onDeleteTouch: handleDeleteLevelTouch,
            }}
            userId={userId}
            lessons={lessons}
            onSaveLesson={handleSaveLesson}
            onDeleteLesson={handleDeleteLesson}
            lessonsCoach={{
              trades,
              tradingDays,
              reviews,
              instruments,
              todayTradeDate: todayTradingDay.tradeDate,
              timezone: profile.timezone,
              maxDrawdown: profile.maxDrawdown ?? null,
              levelTouches,
              // The lessons read sees the marked lines and the outlooks as well, so a theme
              // can cite what the trader wrote down, not only the touches that occurred.
              markedLevels,
              levelOutlooks,
              sessionExtremes,
              coachPlans,
              onMarkRead: handleMarkLessonsRead,
            }}
          />
        );

      case 'settings':
        return (
          <SettingsView
            profile={profile}
            instruments={instruments}
            setups={setups}
            setupUsage={setupUsage}
            onRenameSetup={handleRenameSetup}
            onReorderSetups={handleReorderSetups}
            onRelabelSetup={handleRelabelSetup}
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
            // Only offered when there is an account to upload to: signed out, the pictures
            // have nowhere to go and the button would be a lie.
            onMoveScreenshotsToCloud={cloudEnabled ? handleMoveScreenshotsToCloud : undefined}
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
      pendingCalls={pendingCoachCalls}
      onOpenFeedback={() => setIsFeedbackOpen(true)}
      feedbackCount={openFeedbackCount}
    >
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
        riskTiers={riskTiers}
        todayTrades={todayTrades}
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

      {/* The trader's own notes about what needs fixing in the app. */}
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        notes={feedback}
        onAdd={handleAddFeedback}
        onToggleStatus={handleToggleFeedbackStatus}
        onDelete={handleDeleteFeedback}
        context={activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
        timezone={profile.timezone}
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
