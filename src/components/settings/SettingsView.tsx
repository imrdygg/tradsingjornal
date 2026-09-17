import React, { useState } from 'react';
import {
  Settings,
  Plus,
  Trash2,
  Download,
  Upload,
  Shield,
  Clock,
  Sliders,
  CheckCircle2,
  FileSpreadsheet,
  Edit2,
  ImageIcon,
  ZoomIn,
  X,
  BookOpen,
} from 'lucide-react';
import { UserProfile, Instrument, Setup } from '../../types';
import { ImageUploader } from '../common/ImageUploader';
import { ImageLightboxModal } from '../common/ImageLightboxModal';

interface SettingsViewProps {
  profile: UserProfile;
  instruments: Instrument[];
  setups: Setup[];
  onUpdateProfile: (profile: UserProfile) => void;
  onAddSetup: (setup: Setup) => void;
  onUpdateSetup?: (setup: Setup) => void;
  onDeleteSetup: (setupId: string) => void;
  onToggleSetup: (setupId: string) => void;
  onExportData: () => void;
  onImportData: (jsonData: string) => void;
  onTradovateImport?: (csvContent: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  instruments,
  setups,
  onUpdateProfile,
  onAddSetup,
  onUpdateSetup,
  onDeleteSetup,
  onToggleSetup,
  onExportData,
  onImportData,
  onTradovateImport,
}) => {
  const [newSetupName, setNewSetupName] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Setup Detailed Editor & Lightbox states
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [editingSetup, setEditingSetup] = useState<Setup | null>(null);
  const [setupFormName, setSetupFormName] = useState('');
  const [setupFormDesc, setSetupFormDesc] = useState('');
  const [setupFormImages, setSetupFormImages] = useState<string[]>([]);
  const [setupFormError, setSetupFormError] = useState('');

  const [lightboxState, setLightboxState] = useState<{
    images: string[];
    initialIndex: number;
    title: string;
    subtitle?: string;
  } | null>(null);

  const openAddDetailedSetup = () => {
    setEditingSetup(null);
    setSetupFormName('');
    setSetupFormDesc('');
    setSetupFormImages([]);
    setSetupFormError('');
    setIsSetupModalOpen(true);
  };

  const openEditSetup = (setup: Setup) => {
    setEditingSetup(setup);
    setSetupFormName(setup.name);
    setSetupFormDesc(setup.description || '');
    setSetupFormImages(setup.images || []);
    setSetupFormError('');
    setIsSetupModalOpen(true);
  };

  const handleSaveSetupModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupFormName.trim()) {
      setSetupFormError('Please enter a setup name.');
      return;
    }

    if (editingSetup) {
      const updated: Setup = {
        ...editingSetup,
        name: setupFormName.trim(),
        description: setupFormDesc.trim() || undefined,
        images: setupFormImages.length > 0 ? setupFormImages : undefined,
      };
      if (onUpdateSetup) {
        onUpdateSetup(updated);
      } else {
        onAddSetup(updated);
      }
    } else {
      const created: Setup = {
        id: `setup-${Date.now()}`,
        name: setupFormName.trim(),
        description: setupFormDesc.trim() || undefined,
        images: setupFormImages.length > 0 ? setupFormImages : undefined,
        active: true,
        createdAt: new Date().toISOString(),
      };
      onAddSetup(created);
    }

    setIsSetupModalOpen(false);
  };

  const handleAddSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSetupName.trim()) return;

    const newSetup: Setup = {
      id: `setup-${Date.now()}`,
      name: newSetupName.trim(),
      active: true,
      createdAt: new Date().toISOString(),
    };

    onAddSetup(newSetup);
    setNewSetupName('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        onImportData(text);
        setImportStatus('Data successfully restored!');
        setTimeout(() => setImportStatus(null), 3000);
      } catch (err) {
        setImportStatus('Failed to import JSON data.');
      }
    };
    reader.readAsText(file);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onTradovateImport) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        onTradovateImport(text);
        setImportStatus('Tradovate CSV parsed and staged!');
        setTimeout(() => setImportStatus(null), 3000);
      } catch {
        setImportStatus('Failed to parse Tradovate CSV file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-zinc-400" />
          Settings & Configuration
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Tune your default risk guardrails, trading setups catalog, instruments, and data backups.
        </p>
      </div>

      {importStatus && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-800/80 bg-emerald-950/40 p-3 text-xs text-emerald-200 font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{importStatus}</span>
        </div>
      )}

      {/* 1. Default Risk Guardrails */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Shield className="w-4 h-4 text-zinc-400" />
          Default Daily Risk Guardrails
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Default Daily Max Loss ($)
            </label>
            <input
              type="number"
              step="10"
              value={profile.defaultDailyLossLimit}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  defaultDailyLossLimit: parseFloat(e.target.value) || 100,
                })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Default Instrument
            </label>
            <select
              value={profile.defaultInstrument}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  defaultInstrument: e.target.value,
                })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            >
              {instruments.map((inst) => (
                <option key={inst.id} value={inst.symbol}>
                  {inst.symbol} — {inst.name} (${inst.pointValue}/pt)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-400 block mb-1">
              Timezone
            </label>
            <input
              type="text"
              value={profile.timezone}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  timezone: e.target.value || 'America/New_York',
                })
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 2. Trading Setups Catalog & Playbooks */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
              <Sliders className="w-4 h-4 text-zinc-400" />
              Trading Setups & Playbook Library
            </h2>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Record setup criteria and attach reference chart screenshots so you can review model setups and see them big.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddDetailedSetup}
            className="rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-800/80 px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Setup with Charts</span>
          </button>
        </div>

        {/* Quick add setup form */}
        <form onSubmit={handleAddSetup} className="flex gap-2">
          <input
            type="text"
            placeholder="Quick add setup name (e.g. Fair Value Gap, VWAP Bounce)"
            value={newSetupName}
            onChange={(e) => setNewSetupName(e.target.value)}
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            required
          />
          <button
            type="submit"
            className="rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 px-4 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Quick Add
          </button>
        </form>

        {/* Existing Setups */}
        <div className="space-y-3 pt-1">
          {setups.map((s) => {
            const setupImages = s.images || [];
            return (
              <div
                key={s.id}
                className="rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3 text-xs space-y-2 hover:border-zinc-700/80 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => onToggleSetup(s.id)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold transition-colors ${
                        s.active
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {s.active ? 'Active' : 'Disabled'}
                    </button>
                    <span className="font-semibold text-zinc-100 text-sm">{s.name}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditSetup(s)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      title="Edit setup & chart screenshots"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSetup(s.id)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                      title="Delete setup"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Setup Description */}
                {s.description && (
                  <p className="text-zinc-400 text-xs leading-relaxed pl-1 border-l-2 border-zinc-800">
                    {s.description}
                  </p>
                )}

                {/* Attached Model / Playbook Images */}
                {setupImages.length > 0 ? (
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono uppercase text-zinc-400 flex items-center gap-1">
                        <ImageIcon className="w-3 h-3 text-emerald-400" />
                        Playbook Reference Charts ({setupImages.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxState({
                            images: setupImages,
                            initialIndex: 0,
                            title: `${s.name} Setup Playbook`,
                            subtitle: s.description || 'Model Chart Reference',
                          })
                        }
                        className="text-[10px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center gap-1 hover:underline"
                      >
                        <ZoomIn className="w-3 h-3" />
                        View Big
                      </button>
                    </div>

                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                      {setupImages.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setLightboxState({
                              images: setupImages,
                              initialIndex: idx,
                              title: `${s.name} Setup Playbook`,
                              subtitle: s.description || 'Model Chart Reference',
                            })
                          }
                          className="group relative rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden h-14 w-24 shrink-0 hover:border-emerald-500/80 transition-all hover:scale-105 active:scale-95 shadow-sm"
                          title="Click to view chart screenshot big"
                        >
                          <img
                            src={img}
                            alt={`${s.name} chart ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ZoomIn className="w-4 h-4 text-emerald-400 drop-shadow" />
                          </div>
                          <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono font-bold bg-black/70 text-zinc-300 px-1 rounded">
                            #{idx + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => openEditSetup(s)}
                      className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1 hover:underline"
                    >
                      <ImageIcon className="w-3 h-3" />
                      + Attach playbook chart screenshots
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Supported Futures Instruments */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Clock className="w-4 h-4 text-zinc-400" />
          Supported Futures Contracts Specifications
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
          {instruments.map((inst) => (
            <div
              key={inst.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-1"
            >
              <div className="flex items-center justify-between text-zinc-100 font-bold">
                <span>{inst.symbol} — {inst.name}</span>
                <span className="text-emerald-400">${inst.pointValue}/pt</span>
              </div>
              <div className="flex items-center justify-between text-zinc-500 text-[11px]">
                <span>Tick Size: {inst.tickSize} pts</span>
                <span>Tick Value: ${inst.tickValue}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Data Backup, Export & Tradovate CSV Staging */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono flex items-center gap-2">
          <Download className="w-4 h-4 text-zinc-400" />
          Data Backup & Tradovate CSV Import
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Export JSON */}
          <button
            onClick={onExportData}
            className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-medium text-zinc-200 hover:border-zinc-700 transition-colors"
          >
            <Download className="w-4 h-4 text-zinc-400" />
            Export Journal JSON
          </button>

          {/* Import JSON */}
          <label className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-medium text-zinc-200 hover:border-zinc-700 cursor-pointer transition-colors">
            <Upload className="w-4 h-4 text-zinc-400" />
            <span>Restore Backup JSON</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {/* Tradovate CSV Import */}
          <label className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs font-medium text-zinc-200 hover:border-zinc-700 cursor-pointer transition-colors">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Import Tradovate CSV</span>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="hidden"
            />
          </label>
        </div>
        <p className="text-[11px] text-zinc-400">
          Tradovate CSV import matches fills into trades, checks initial risk, and lets you review execution without silently guessing uncertain data.
        </p>
      </div>

      {/* Setup Edit / Create Modal with Image Attachments */}
      {isSetupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl my-6">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-zinc-100 font-mono">
                  {editingSetup ? `Edit Setup: ${editingSetup.name}` : 'New Setup & Playbook'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSetupModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSetupModal} className="mt-4 space-y-4">
              {setupFormError && (
                <div className="rounded-xl border border-rose-800/80 bg-rose-950/50 p-2.5 text-xs text-rose-300">
                  {setupFormError}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">
                  Setup Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Fair Value Gap, London High Sweep, VWAP Reclaim"
                  value={setupFormName}
                  onChange={(e) => setSetupFormName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">
                  Strategy Rules / Trigger Criteria
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. 1) Higher timeframe liquidity sweep. 2) 5m displacement candle creating FVG. 3) Limit order at top of FVG with stop behind swing high."
                  value={setupFormDesc}
                  onChange={(e) => setSetupFormDesc(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <ImageUploader
                  images={setupFormImages}
                  onChange={setSetupFormImages}
                  onPreviewImage={(idx) =>
                    setLightboxState({
                      images: setupFormImages,
                      initialIndex: idx,
                      title: setupFormName || 'Setup Reference Chart',
                      subtitle: setupFormDesc || 'Playbook Example',
                    })
                  }
                  maxImages={6}
                  label="Playbook Reference Chart Screenshots"
                  helperText="Attach textbook examples of this setup. Click thumbnail to view big."
                  idPrefix="setup-modal-images"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsSetupModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 px-5 py-2 text-xs font-semibold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {editingSetup ? 'Update Setup' : 'Save Setup'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox for viewing setup reference charts big */}
      {lightboxState && (
        <ImageLightboxModal
          isOpen={true}
          onClose={() => setLightboxState(null)}
          images={lightboxState.images}
          initialIndex={lightboxState.initialIndex}
          title={lightboxState.title}
          subtitle={lightboxState.subtitle}
        />
      )}
    </div>
  );
};
