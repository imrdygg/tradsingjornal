import React, { useState } from 'react';
import { BarChart3, CalendarDays, Database, Grid3x3, ListChecks, Timer } from 'lucide-react';
import type { LevelRecord } from '../../lib/mes/types';
import type { MesPlaybookBridge } from '../../lib/mes/playbook-bridge';
import { MesJournalProvider } from './mes-store';
import { MesDashboard } from './MesDashboard';
import { MesDailyLog } from './MesDailyLog';
import { MesLevelsTable } from './MesLevelsTable';
import { MesPatterns } from './MesPatterns';
import { MesTiming } from './MesTiming';
import { MesDataManager } from './MesDataManager';

/**
 * The MES tab: the indicator level tracker for $MES.
 *
 * Six screens behind one tab, because they are six readings of one record — what you log on
 * a session, the whole record, and the four ways it is read back. The screens take no props:
 * each pulls the record from the provider, which is what keeps them independently buildable
 * and keeps the store the single place a write can happen.
 */
type MesSection = 'dashboard' | 'daily' | 'levels' | 'patterns' | 'timing' | 'data';

const SECTIONS: Array<{
  id: MesSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'daily', label: 'Daily Log', icon: CalendarDays },
  { id: 'levels', label: 'All Levels', icon: ListChecks },
  { id: 'patterns', label: 'Patterns', icon: Grid3x3 },
  { id: 'timing', label: 'Timing', icon: Timer },
  { id: 'data', label: 'Data', icon: Database },
];

interface MesViewProps {
  records: LevelRecord[];
  /** Writes the next list through storage and updates the app's state (and so the sync). */
  persist: (next: LevelRecord[]) => void;
  /**
   * The playbook's lines and the way across, when the app has them to hand.
   *
   * Optional so the tab still renders — in a test, or for a caller with no playbook — without
   * the cross-record card. The tracker is one record of the trader's levels either way; only the
   * shortcut between the two records depends on this.
   */
  bridge?: MesPlaybookBridge;
}

export const MesView: React.FC<MesViewProps> = ({ records, persist, bridge }) => {
  const [section, setSection] = useState<MesSection>('dashboard');

  return (
    <MesJournalProvider records={records} persist={persist} bridge={bridge}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-zinc-100">
                MES Indicator Levels
              </h1>
              <p className="mt-1 font-mono text-[11px] text-zinc-400">
                $MES · 1m / 3m / 5m / 15m / 30m / 1h · {records.length} level
                {records.length === 1 ? '' : 's'} logged
              </p>
            </div>
          </div>

          <nav className="mt-3 flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  id={`mes-tab-${item.id}`}
                  onClick={() => setSection(item.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border border-zinc-700/50 bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {section === 'dashboard' && <MesDashboard />}
        {section === 'daily' && <MesDailyLog />}
        {section === 'levels' && <MesLevelsTable />}
        {section === 'patterns' && <MesPatterns />}
        {section === 'timing' && <MesTiming />}
        {section === 'data' && <MesDataManager />}
      </div>
    </MesJournalProvider>
  );
};
