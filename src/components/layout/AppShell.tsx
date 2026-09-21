import React, { useState } from 'react';
import {
  Calendar,
  ChevronDown,
  Layers,
  History as HistoryIcon,
  BarChart3,
  Lightbulb,
  Sparkles,
  BookOpen,
  Settings as SettingsIcon,
  ShieldAlert,
  Lock,
  Plus,
  Sun,
  Moon,
  CandlestickChart,
} from 'lucide-react';
import { getCurrentTradingDate } from '../../lib/storage/date-utils';
import { SyncStatusBadge, SyncStatus } from './SyncStatusBadge';
import { AccountMenu } from './AccountMenu';
import { RiskMode, DayStatus } from '../../types';

export type NavTab =
  | 'today'
  | 'trades'
  | 'history'
  | 'analytics'
  | 'insights'
  | 'coach'
  | 'playbook'
  | 'markets'
  | 'settings';

interface AppShellProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAddTrade: () => void;
  riskMode: RiskMode;
  dayStatus: DayStatus;
  realizedPnL: number;
  /** Instrument the trader is focused on today (MES, MNQ, ES, ...). */
  primaryInstrument?: string;
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
  primaryInstrument,
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
  const [statusExpanded, setStatusExpanded] = useState(false);

  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'today', label: 'Today', icon: Calendar },
    { id: 'trades', label: 'Trades', icon: Layers },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'insights', label: 'Insights', icon: Lightbulb },
    { id: 'coach', label: 'Coach', icon: Sparkles },
    { id: 'markets', label: 'Markets', icon: CandlestickChart },
    { id: 'playbook', label: 'Playbook', icon: BookOpen },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const pnlSign = realizedPnL > 0 ? '+' : '';
  const pnlColor =
    realizedPnL > 0
      ? 'text-emerald-400'
      : realizedPnL < 0
      ? 'text-rose-400'
      : 'text-zinc-400';

  // Condensed form of the status chips, used by the collapsed narrow-screen line.
  const syncSummaryWord =
    syncStatus === 'saved'
      ? 'Saved'
      : syncStatus === 'saving'
      ? 'Saving'
      : syncStatus === 'loading'
      ? 'Loading'
      : syncStatus === 'error'
      ? 'Sync failed'
      : syncStatus === 'local'
      ? 'Local only'
      : '';

  const syncDotClass =
    syncStatus === 'saved'
      ? 'bg-emerald-400'
      : syncStatus === 'saving' || syncStatus === 'loading'
      ? 'sync-dot-working bg-amber-400'
      : syncStatus === 'error'
      ? 'bg-rose-400'
      : 'bg-zinc-500';

  // Rendered in two places: inside the expanded narrow-screen panel and inline on sm+.
  const statusChips = (
    <>
      <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Today
        </span>
        <span className={`font-mono text-[11px] font-semibold ${pnlColor}`}>
          {pnlSign}${realizedPnL.toFixed(2)}
        </span>
      </div>

      <div
        className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
          riskMode === 'expanded'
            ? 'border-amber-800/60 bg-amber-950/40 text-amber-300'
            : 'border-zinc-800 bg-zinc-900 text-zinc-300'
        }`}
      >
        <ShieldAlert className="h-3 w-3" />
        <span className="capitalize">{riskMode} Risk</span>
      </div>

      <div
        className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
          dayStatus === 'active' || dayStatus === 'completed'
            ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
            : 'border-zinc-800 bg-zinc-900 text-zinc-400'
        }`}
      >
        <Lock className="h-3 w-3" />
        <span className="capitalize">{dayStatus}</span>
      </div>

      {syncStatus && (
        <SyncStatusBadge
          status={syncStatus}
          lastSyncedAt={lastSyncedAt}
          onRetry={onRetrySync}
        />
      )}
    </>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 font-sans text-zinc-100 selection:bg-zinc-800">
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        {/* ---- Main row: brand | nav | actions ---- */}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-6">
          {/* Brand */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:flex-none">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-[10px] font-semibold tracking-wider text-zinc-200"
              title={
                primaryInstrument
                  ? `Today's instrument: ${primaryInstrument}`
                  : 'Trading Journal'
              }
            >
              {primaryInstrument || 'TJ'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold tracking-tight text-zinc-100 sm:text-base">
                  Trading Journal
                </span>
                <span className="hidden items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-0.5 font-mono text-[11px] text-zinc-200 xl:inline-flex">
                  <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                  {todayDate}
                </span>
              </div>
              {/* Kept for xl and up only: this long subtitle widened the brand
                  enough to wrap the header actions at 1024-1279px. */}
              <p className="hidden truncate font-mono text-[11px] text-zinc-400 xl:block">
                Solo Futures Desk • {timezone}
              </p>
            </div>
          </div>

          {/* Desktop navigation - only where there is genuinely room for it */}
          <nav className="order-last hidden w-full items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1 lg:order-none lg:flex lg:w-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-btn-${item.id}`}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all lg:flex-none ${
                    isActive
                      ? 'border border-zinc-700/50 bg-zinc-800 text-zinc-100 shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {onToggleTheme && (
              <button
                id="theme-toggler-btn"
                type="button"
                onClick={onToggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label="Toggle light/dark theme"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 shadow-sm transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 stroke-[2.2] text-amber-400" />
                ) : (
                  <Moon className="h-4 w-4 stroke-[2.2] text-indigo-400" />
                )}
              </button>
            )}

            <button
              id="header-add-trade-btn"
              onClick={onOpenAddTrade}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Add Trade</span>
              <span className="sm:hidden">Trade</span>
            </button>

            {onSignOut && (
              <AccountMenu
                email={userEmail}
                onSignOut={onSignOut}
                signingOut={signingOut}
              />
            )}
          </div>
        </div>

        {/* ---- Status strip: lives below the header so the main row never crowds ---- */}
        <div className="border-t border-zinc-800/60 bg-zinc-950/70">
          {/* Very narrow: one compact summary line, tap to reveal the full chips */}
          <div className="mx-auto max-w-7xl px-3 py-1.5 sm:hidden">
            <button
              id="status-strip-summary"
              type="button"
              onClick={() => setStatusExpanded((prev) => !prev)}
              aria-expanded={statusExpanded}
              aria-controls="status-strip-detail"
              className="flex w-full items-center gap-1.5 text-left"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${syncDotClass}`}
                aria-hidden="true"
              />
              <span className={`font-mono text-[11px] font-semibold ${pnlColor}`}>
                {pnlSign}${realizedPnL.toFixed(2)}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-[11px] capitalize text-zinc-400">{riskMode}</span>
              <span className="text-zinc-600">·</span>
              <span className="text-[11px] capitalize text-zinc-400">{dayStatus}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {syncStatus && (
                  <span
                    className={`font-mono text-[10px] ${
                      syncStatus === 'error'
                        ? 'text-rose-300'
                        : 'text-zinc-500'
                    }`}
                  >
                    {syncSummaryWord}
                  </span>
                )}
                <ChevronDown
                  className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${
                    statusExpanded ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </button>

            {statusExpanded && (
              <div
                id="status-strip-detail"
                className="flex flex-wrap items-center gap-1.5 pt-2"
              >
                {statusChips}
              </div>
            )}
          </div>

          {/* sm and wider: the chips sit inline */}
          <div className="mx-auto hidden max-w-7xl flex-wrap items-center gap-2 px-6 py-1.5 sm:flex">
            {statusChips}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto w-full max-w-7xl flex-1 p-3 pb-28 sm:p-6 sm:pb-32 lg:pb-8">
        {children}
      </main>

      {/* Bottom navigation for anything narrower than the desktop nav breakpoint */}
      <div className="pb-safe fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800/90 bg-zinc-950/95 pt-1.5 backdrop-blur-lg lg:hidden">
        {/* Eight tabs now: the label size and column count were both tuned so the
            longest label still fits at 320px without wrapping or overflowing. */}
        <div className="grid grid-cols-8 gap-0.5 px-1 sm:gap-1 sm:px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`mobile-nav-${item.id}`}
                onClick={() => onSelectTab(item.id)}
                className={`flex flex-col items-center justify-center rounded-lg py-1 text-[9px] transition-colors ${
                  isActive
                    ? 'bg-zinc-900 font-medium text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className={`mb-0.5 h-4 w-4 ${isActive ? 'text-zinc-100' : 'text-zinc-400'}`} />
                <span className="w-full truncate text-center">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
