import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  Edit2,
  ImageIcon,
  ZoomIn,
  X,
  ChevronDown,
  Eye,
  Lightbulb,
  ListChecks,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { Setup } from '../../types';
import { ImageUploader } from '../common/ImageUploader';
import { ImageLightboxModal } from '../common/ImageLightboxModal';
import { ModalOverlay } from '../common/ModalOverlay';
import { SetupDiagram } from './SetupDiagram';
import { SetupGuide, resolveSetupGuide } from './setup-guides';

interface PlaybookViewProps {
  setups: Setup[];
  onAddSetup: (setup: Setup) => void;
  onUpdateSetup?: (setup: Setup) => void;
  onDeleteSetup: (setupId: string) => void;
  onToggleSetup: (setupId: string) => void;
  /**
   * When provided, the setup cards whose names appear in this list are
   * automatically expanded and the first match is scrolled into view. Used by
   * the Morning Plan's "Study in Playbook" link to jump straight to the
   * setups watched today.
   */
  focusSetupNames?: string[];
  /**
   * Names of the setups on today's watch list. These cards get a persistent
   * emerald highlight and a "Watched today" badge so the trader can see at a
   * glance which playbooks are in play for the current session — independent
   * of whether they arrived via the Morning Plan deep-link.
   */
  watchedSetupNames?: string[];
}

/** Small labelled block used inside each setup's guide container. */
const GuideSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}> = ({ icon, title, children }) => (
  <div className="space-y-1.5">
    <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 font-mono flex items-center gap-1.5">
      {icon}
      {title}
    </h4>
    {children}
  </div>
);

/**
 * The Trading Setups & Playbook Library as its own tab.
 *
 * The management UI (add / edit / toggle / delete setups, attach reference
 * charts) is the same that used to live in Settings — the extras here are the
 * study containers: for every setup we show what the pattern is, how it
 * forms, how to trade it, what invalidates it, and two example charts
 * (green = bullish example, red = bearish example) drawn as SVG diagrams.
 */
export const PlaybookView: React.FC<PlaybookViewProps> = ({
  setups,
  onAddSetup,
  onUpdateSetup,
  onDeleteSetup,
  onToggleSetup,
  focusSetupNames,
  watchedSetupNames,
}) => {
  const [newSetupName, setNewSetupName] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Scroll anchor for the focused setup card ("Study in Playbook" deep-link).
  const focusContainerRef = useRef<HTMLDivElement | null>(null);

  // Setup Detailed Editor & Lightbox states (unchanged from the old Settings UI)
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

  const toggleExpanded = (setupId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(setupId)) {
        next.delete(setupId);
      } else {
        next.add(setupId);
      }
      return next;
    });
  };

  // Deep-link support: expand every setup named in `focusSetupNames` and
  // scroll the first match into view. The scroll waits a frame so the newly
  // expanded card exists in the DOM before we try to measure it.
  const focusKey = (focusSetupNames || []).join('|');
  useEffect(() => {
    if (!focusKey) return;
    const names = focusKey.split('|');
    const matches = setups.filter((s) =>
      names.some(
        (n) => n.trim().toLowerCase() === s.name.trim().toLowerCase()
      )
    );
    if (matches.length === 0) return;

    setExpandedIds((prev) => {
      const next = new Set(prev);
      matches.forEach((s) => next.add(s.id));
      return next;
    });

    const frame = requestAnimationFrame(() => {
      focusContainerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => cancelAnimationFrame(frame);
    // Re-run when the focus request changes or the setups list changes
    // (a late cloud-sync render could add the matching setups afterwards).
  }, [focusKey, setups]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-emerald-400" />
          Trading Setups & Playbook Library
        </h1>
        <p className="text-xs text-zinc-400 mt-0.5">
          Master each setup: what it is, how it forms, how to trade it, and reference charts. Attach
          your own textbook screenshots to personalize every playbook.
        </p>
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
        <button
          type="button"
          onClick={openAddDetailedSetup}
          className="rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-800/80 px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Add with Charts</span>
        </button>
      </form>

      {/* Setup Containers */}
      <div className="space-y-3">
        {setups.map((s) => {
          const setupImages = s.images || [];
          const guide: SetupGuide | undefined = resolveSetupGuide(s.name);
          const isExpanded = expandedIds.has(s.id);
          const nameMatches = (list: string[] | undefined) =>
            !!list &&
            list.some((n) => n.trim().toLowerCase() === s.name.trim().toLowerCase());
          const isFocused = nameMatches(focusSetupNames);
          const isWatched = nameMatches(watchedSetupNames);

          return (
            <div
              key={s.id}
              ref={isFocused && !focusContainerRef.current ? focusContainerRef : undefined}
              className={`rounded-2xl border text-xs space-y-2 transition-colors scroll-mt-40 sm:scroll-mt-32
                isFocused || isWatched
                  ? 'border-emerald-800/80 bg-zinc-900/50 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
                  : 'border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700/80'
              }`}
            >
              {/* Container header */}
              <div className="flex items-center justify-between gap-2 p-3 pb-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => onToggleSetup(s.id)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold transition-colors shrink-0 ${
                      s.active
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                    title={s.active ? 'Active — selectable in trade forms' : 'Disabled — hidden from trade forms'}
                  >
                    {s.active ? 'Active' : 'Disabled'}
                  </button>
                  <span className="font-semibold text-zinc-100 text-sm truncate">{s.name}</span>
                  {isWatched && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(s.id)}
                      aria-expanded={isExpanded}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/60 hover:text-emerald-200 transition-colors shrink-0 cursor-pointer"
                      title="This setup is on today's morning plan watch list — click to open its study guide"
                    >
                      <Eye className="w-3 h-3" />
                      Watched today
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(s.id)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors flex items-center gap-1"
                    title={isExpanded ? 'Hide study guide' : 'Show study guide'}
                    aria-expanded={isExpanded}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>
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

              {/* Guide summary is always visible when present (kept short) */}
              {guide && (
                <p className="px-3 text-zinc-400 leading-relaxed">{guide.summary}</p>
              )}
              {!guide && s.description && (
                <p className="px-3 text-zinc-400 leading-relaxed pl-3 border-l-2 border-zinc-800 ml-3">
                  {s.description}
                </p>
              )}

              {/* Attached Model / Playbook Images */}
              {setupImages.length > 0 && (
                <div className="px-3 pt-1">
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
              )}

              {/* Expanded study guide: formation, trading plan, diagrams, invalidation */}
              {isExpanded && (
                <div className="mx-3 mb-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 space-y-4">
                  {guide ? (
                    <>
                      {/* Example diagrams: green = bullish, red = bearish */}
                      <div className="grid grid-cols-2 gap-3">
                        <SetupDiagram setupName={s.name} direction="bullish" />
                        <SetupDiagram setupName={s.name} direction="bearish" />
                      </div>

                      <GuideSection
                        icon={<ListChecks className="w-3.5 h-3.5 text-zinc-300" />}
                        title="How this setup forms"
                      >
                        <ol className="space-y-1.5 list-decimal list-inside text-zinc-300 leading-relaxed">
                          {guide.formation.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </GuideSection>

                      <GuideSection
                        icon={<Lightbulb className="w-3.5 h-3.5 text-amber-400" />}
                        title="How to trade it"
                      >
                        <ul className="space-y-1.5 list-disc list-inside text-zinc-300 leading-relaxed">
                          {guide.howToTrade.map((tip, i) => (
                            <li key={i}>{tip}</li>
                          ))}
                        </ul>
                      </GuideSection>

                      <GuideSection
                        icon={<ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
                        title="Invalidation — when you are wrong"
                      >
                        <p className="text-zinc-300 leading-relaxed">{guide.invalidation}</p>
                      </GuideSection>

                      <GuideSection
                        icon={<Target className="w-3.5 h-3.5 text-emerald-400" />}
                        title="Journal habit"
                      >
                        <p className="text-zinc-400 leading-relaxed">
                          When logging a trade with this setup, use the Entry Reason field to note
                          which rule you actually followed — the discipline score is only honest if
                          the setup was really there.
                        </p>
                      </GuideSection>
                    </>
                  ) : (
                    /* Custom setups: editable description instead of the built-in guide */
                    <div className="space-y-3">
                      <GuideSection
                        icon={<Edit2 className="w-3.5 h-3.5 text-zinc-300" />}
                        title="Your playbook notes"
                      >
                        {s.description ? (
                          <p className="text-zinc-300 leading-relaxed whitespace-pre-line">
                            {s.description}
                          </p>
                        ) : (
                          <p className="text-zinc-500 leading-relaxed">
                            No notes yet. Use the edit (pencil) button to add strategy rules,
                            trigger criteria, and your own reference charts — this card becomes your
                            personal study guide for the setup.
                          </p>
                        )}
                      </GuideSection>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {setups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center">
            <p className="text-xs text-zinc-400">
              No setups yet. Add one above to start your playbook.
            </p>
          </div>
        )}
      </div>

      {/* Setup Edit / Create Modal with Image Attachments (unchanged) */}
      {isSetupModalOpen && (
        <ModalOverlay>
          <div className="relative my-6 w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
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
        </ModalOverlay>
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
