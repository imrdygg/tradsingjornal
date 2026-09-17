import React from 'react';
import {
  Calendar,
  Layers,
  History as HistoryIcon,
  BarChart3,
  Lightbulb,
  Settings as SettingsIcon,
  ShieldAlert,
  Lock,
  Plus,
  Clock,
  Sun,
  Moon,
  LogOut,
  Loader2,
} from 'lucide-react';
import { getCurrentTradingDate } from '../../lib/storage/date-utils';
import { SyncStatusBadge, SyncStatus } from './SyncStatusBadge';
import { RiskMode, DayStatus } from '../../types';

export type NavTab = 'today' | 'trades' | 'history' | 'analytics' | 'insights' | 'settings';

interface AppShellProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddTrade: () => void;
  riskMode: RiskMode;
  dayStatus: DayStatus;
  realizedPnL: number;
  timezone: string;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  userEmail?: string | null;
  onSignOut?: () => void;
  signingOut?: boolean;
  syncStatus?: SyncStatus;
  lastSyncedAt?: Date | null;
  onRetrySync?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentTab,
  onSelectTab,
  onOpenAddTrade,
  riskMode,
  dayStatus,
  realizedPnL,
  timezone,
  theme = 'dark',
  onToggleTheme,
  userEmail,
  onSignOut,
  signingOut = false,
  syncStatus,
  lastSyncedAt,
  onRetrySync,
  children,
}) => {
  const todayDate = getCurrentTradingDate(timezone);

  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'today', label: 'Today', icon: Calendar },
    { id: 'trades', label: 'Trades', icon: Layers },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const pnlSign = realizedPnL > 0 ? '+' : '';
  const pnlColor =
    realizedPnL > 0
      ? 'text-emerald-400'
      : realizedPnL < 0
      ? 'text-rose-400'
      : 'text-zinc-400';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Brand & Market Date */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 font-semibold text-xs tracking-wider text-zinc-200">
              MES
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm sm:text-base text-zinc-100 tracking-tight">
                  Trading Journal
                </span>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-zinc-200 font-mono">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  {todayDate}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono hidden sm:block">
                Solo Futures Desk • {timezone}
              </p>
            </div>
          </div>

          {/* Center/Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-btn-${item.id}`}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/50'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Quick Header Right Actions: Status & Quick Add */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Live Today Realized P&L Badge */}
            <div className="flex flex-col items-end px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-mono">
                Today P&L
              </span>
              <span className={`text-xs sm:text-sm font-semibold font-mono ${pnlColor}`}>
                {pnlSign}${realizedPnL.toFixed(2)}
              </span>
            </div>

            {/* Risk Mode Indicator */}
            <div
              className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                riskMode === 'expanded'
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span className="capitalize">{riskMode} Risk</span>
            </div>

            {/* Plan Lock status badge */}
            <div
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border ${
                dayStatus === 'active' || dayStatus === 'completed'
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              <Lock className="w-3 h-3" />
              <span className="capitalize">{dayStatus}</span>
            </div>

            {/* Cloud Sync Status */}
            {syncStatus && (
              <SyncStatusBadge
                status={syncStatus}
                lastSyncedAt={lastSyncedAt}
                onRetry={onRetrySync}
              />
            )}

            {/* Dark / Light Theme Toggler Icon Button */}
            {onToggleTheme && (
              <button
                id="theme-toggler-btn"
                type="button"
                onClick={onToggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 transition-colors flex items-center justify-center shadow-sm"
                aria-label="Toggle light/dark theme"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4 text-amber-400 stroke-[2.2]" />
                ) : (
                  <Moon className="w-4 h-4 text-indigo-400 stroke-[2.2]" />
                )}
              </button>
            )}

            {/* + Add Trade Button */}
            <button
              id="header-add-trade-btn"
              onClick={onOpenAddTrade}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Add Trade</span>
              <span className="sm:hidden">Trade</span>
            </button>

            {/* Signed-in Account & Sign Out */}
            {onSignOut && (
              <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-zinc-800">
                <span
                  className="hidden xl:inline text-[11px] font-mono text-zinc-400 max-w-[160px] truncate"
                  title={userEmail ?? undefined}
                >
                  {userEmail ?? 'Signed in'}
                </span>
                <button
                  id="header-sign-out-btn"
                  type="button"
                  onClick={onSignOut}
                  disabled={signingOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {signingOut ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4 stroke-[2.2]" />
                  )}
                  <span className="hidden sm:inline">{signingOut ? 'Saving…' : 'Sign out'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 pb-24 md:pb-8">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 border-t border-zinc-800/90 backdrop-blur-lg px-2 py-1.5">
        <div className="grid grid-cols-6 gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`mobile-nav-${item.id}`}
                onClick={() => onSelectTab(item.id)}
                className={`flex flex-col items-center justify-center py-1 rounded-lg text-[10px] transition-colors ${
                  isActive
                    ? 'text-zinc-100 bg-zinc-900 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-4 h-4 mb-0.5 ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
