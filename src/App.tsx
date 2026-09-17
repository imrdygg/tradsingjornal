import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { DailyReviewModal } from './components/review/DailyReviewModal';
import { TradesView } from './components/trades/TradesView';
import { HistoryView } from './components/history/HistoryView';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { InsightsView } from './components/insights/InsightsView';
import { SettingsView } from './components/settings/SettingsView';
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
import { storage } from './lib/storage';
import { parseTradovateCSV } from './lib/trading/tradovate-import';
import { Plus, Award, Sparkles, Layers } from 'lucide-react';

export default function App() {
  const [profile, setProfile] = useState<UserProfile>(() => storage.getProfile());
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
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [importNotification, setImportNotification] = useState<string | null>(null);

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

  const handleRecordPlanChange = (change: {
    fieldName: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }) => {
    storage.recordPlanChange(todayTradingDay.id, change);
    setTradingDays(storage.getTradingDays());
  };

  // Trade actions
  const handleSaveTrade = (tradeData: Partial<Trade>) => {
    const tradeToSave: Trade = {
      id: editingTrade ? editingTrade.id : `trade-${Date.now()}`,
      userId: profile.id,
      tradingDayId: todayTradingDay.id,
      instrumentId: tradeData.instrumentId || 'mes',
      source: 'manual',
      direction: tradeData.direction || 'long',
      contracts: tradeData.contracts || 1,
      entryPrice: tradeData.entryPrice || 0,
      initialStop: tradeData.initialStop || 0,
      exitPrice: tradeData.exitPrice,
      entryTime: tradeData.entryTime || new Date().toISOString(),
      exitTime: tradeData.exitTime,
      session: tradeData.session || 'Regular Session',
      setupName: tradeData.setupName || 'Engulfing',
      entryReason: tradeData.entryReason,
      notes: tradeData.notes,
      tags: tradeData.tags,
      initialRisk: tradeData.initialRisk || 50,
      grossPnL: tradeData.grossPnL || 0,
      pointsPnL: tradeData.pointsPnL || 0,
      rMultiple: tradeData.rMultiple !== undefined ? tradeData.rMultiple : 0,
      status: tradeData.status || (tradeData.exitPrice ? 'closed' : 'open'),
      images: tradeData.images !== undefined ? tradeData.images : (editingTrade ? editingTrade.images : undefined),
      screenshotPath: tradeData.screenshotPath !== undefined ? tradeData.screenshotPath : (editingTrade ? editingTrade.screenshotPath : undefined),
      createdAt: editingTrade ? editingTrade.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionReview: editingTrade ? editingTrade.executionReview : undefined,
    };

    storage.saveTrade(tradeToSave);
    setTrades(storage.getTrades());
    setEditingTrade(null);
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

  const handleDeleteTrade = (tradeId: string) => {
    storage.deleteTrade(tradeId);
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

  const handleTradovateImport = (csvContent: string) => {
    const parsed = parseTradovateCSV(csvContent);
    if (parsed.errors.length > 0) {
      setImportNotification(`CSV errors: ${parsed.errors.slice(0, 2).join('; ')}`);
      return;
    }

    const newTrades: Trade[] = parsed.trades.map((pt, idx) => ({
      id: `tradovate-${Date.now()}-${idx}`,
      userId: profile.id,
      tradingDayId: todayTradingDay.id,
      instrumentId: 'mes',
      source: 'tradovate_csv',
      direction: pt.direction || 'long',
      contracts: pt.contracts || 1,
      entryPrice: pt.entryPrice || 0,
      initialStop: pt.initialStop || 0,
      exitPrice: pt.exitPrice,
      entryTime: pt.entryTime || new Date().toISOString(),
      exitTime: pt.exitTime,
      session: pt.session || 'Regular Session',
      setupName: pt.setupName || 'Engulfing',
      notes: 'Imported from Tradovate Fills CSV',
      initialRisk: pt.initialRisk || 50,
      grossPnL: pt.grossPnL || 0,
      pointsPnL: pt.pointsPnL || 0,
      rMultiple: pt.rMultiple !== undefined ? pt.rMultiple : 0,
      status: pt.status || 'closed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    for (const t of newTrades) {
      storage.saveTrade(t);
    }
    setTrades(storage.getTrades());

    setImportNotification(
      `Successfully imported ${newTrades.length} trades from Tradovate CSV. Please review execution!`
    );
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

            {/* Today's Risk & Performance Summary Card */}
            <TodaySummary
              realizedPnL={todayRealizedPnL}
              totalTrades={todayTrades.length}
              wins={todayWins}
              losses={todayLosses}
              plannedMaxLoss={todayTradingDay.plannedLossLimit}
              riskMode={todayTradingDay.riskMode}
              planStatus={todayTradingDay.status}
              onOpenAddTrade={() => {
                setEditingTrade(null);
                setIsTradeModalOpen(true);
              }}
              onOpenEndDay={() => setIsReviewModalOpen(true)}
              isPlanLocked={!!todayTradingDay.lockedAt}
            />

            {/* Quick Actions & Notification */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  id="btn-add-trade-top"
                  onClick={() => {
                    setEditingTrade(null);
                    setIsTradeModalOpen(true);
                  }}
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
            />

            {/* Today's Recorded Trades Section */}
            <div className="space-y-3">
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
                    onClick={() => {
                      setEditingTrade(null);
                      setIsTradeModalOpen(true);
                    }}
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
            onOpenAddTrade={() => {
              setEditingTrade(null);
              setIsTradeModalOpen(true);
            }}
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

      case 'settings':
        return (
          <SettingsView
            profile={profile}
            instruments={instruments}
            setups={setups}
            onUpdateProfile={handleUpdateProfile}
            onAddSetup={handleAddSetup}
            onUpdateSetup={handleUpdateSetup}
            onDeleteSetup={handleDeleteSetup}
            onToggleSetup={handleToggleSetup}
            onExportData={handleExportData}
            onImportData={handleImportData}
            onTradovateImport={handleTradovateImport}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AppShell
      currentTab={activeTab}
      onSelectTab={setActiveTab}
      onOpenAddTrade={() => {
        setEditingTrade(null);
        setIsTradeModalOpen(true);
      }}
      riskMode={todayTradingDay.riskMode}
      dayStatus={todayTradingDay.status}
      realizedPnL={todayRealizedPnL}
      timezone={profile.timezone}
      theme={theme}
      onToggleTheme={handleToggleTheme}
    >
      {renderTabContent()}

      {/* Trade Form Modal (Add / Edit) */}
      <TradeFormModal
        isOpen={isTradeModalOpen}
        onClose={() => {
          setIsTradeModalOpen(false);
          setEditingTrade(null);
        }}
        onSave={handleSaveTrade}
        day={todayTradingDay}
        instruments={instruments}
        setups={setups}
        editingTrade={editingTrade}
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
