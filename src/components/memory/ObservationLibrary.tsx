import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Filter,
  Link2,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Instrument,
  LevelTimeframe,
  MarketOutlookBias,
  MemoryContinuation,
  MemoryImage,
  MemoryOutcome,
  MemoryOutcomeStatus,
  MemoryObservedAtSource,
  Setup,
  Trade,
  TradeDirection,
  TradingDay,
  TradingObservation,
  TradingSession,
} from '../../types';
import { instrumentSymbol } from '../../lib/trading/instruments';
import { formatTimestamp } from '../../lib/storage/date-utils';
import { MEMORY_OUTCOME_WINDOWS, formatMemoryRate } from '../../lib/memory/outcomes';
import { tradeResultSample } from '../../lib/memory/results';
import { promoteJournalImage, unlabelledImages } from '../../lib/memory/journal-import';
import { MemoryImagePicker, MemoryImageThumb } from './MemoryImagePicker';
import { JournalImportPanel } from './JournalImportPanel';

/**
 * The library of market situations the trader has recorded.
 *
 * This screen is deliberately the first half of the Trading Memory feature and the half that works
 * alone. A searchable memory is only as good as what has been put into it, and the one thing that
 * would hollow it out is limiting the library to executed trades: the trader would be able to ask
 * "what happened the last times I TOOK this setup" but never "what happened the last times I SAW
 * it", and the second question is both bigger and free of the selection bias the first one carries.
 *
 * So recording a sighting asks for very little — a picture, a time and an instrument is enough —
 * and everything else is optional and fillable later. The outcome in particular is expected to be
 * absent for a while: it is what price did afterwards, and it can only be written once the trader
 * has actually watched what happened.
 *
 * Two boundaries are enforced here rather than only in the engine:
 *
 *   1. **The two pictures are labelled by what they are.** The first is what the trader was looking
 *      at when they decided, and only that kind of picture can be matched on. The second is from
 *      after the fact and is read only once the matches are chosen. Labelling them at the moment
 *      they are attached is what keeps the distinction real, because a picture taken afterwards and
 *      filed as a setup screenshot would make the whole library lie about what the trader knew.
 *   2. **Uncertainty about the time is recorded, not hidden.** A timestamp the trader is unsure of
 *      is marked as such and the engine refuses to place it in a replay, rather than letting an
 *      approximate date drift into a search window it never belonged to.
 */

export type MemoryObservationFilter = {
  instrumentId: string;
  session: TradingSession | '';
  query: string;
};

export interface ObservationLibraryProps {
  observations: TradingObservation[];
  instruments: Instrument[];
  setups: Setup[];
  trades: Trade[];
  tradingDays: TradingDay[];
  timezone: string;
  userId: string;
  /** Today's session date, used as the default for a new sighting. */
  todayTradeDate: string;
  /** Whether the trader has consented to cloud image processing. */
  consentToIndex: boolean;
  /** False in a local-only build, where an import keeps its pictures in the browser. */
  cloudEnabled: boolean;
  onSave: (observation: TradingObservation) => void;
  onDelete: (id: string) => void;
  onViewTrade: (trade: Trade) => void;
}

const TIMEFRAMES: LevelTimeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h'];
const SESSIONS: TradingSession[] = ['Overnight', 'Premarket', 'Regular Session'];
const TRENDS: { value: MarketOutlookBias; label: string }[] = [
  { value: 'bullish', label: 'Leaning up' },
  { value: 'bearish', label: 'Leaning down' },
  { value: 'neutral', label: 'No lean' },
];
const DIRECTIONS: { value: TradeDirection | 'none'; label: string }[] = [
  { value: 'none', label: 'No direction claimed' },
  { value: 'long', label: 'Long' },
  { value: 'short', label: 'Short' },
];
const TIME_SOURCES: { value: MemoryObservedAtSource; label: string; hint: string }[] = [
  {
    value: 'recorded',
    label: 'I know when this was',
    hint: 'The time above is when the setup was in front of me. A replay may use it.',
  },
  {
    value: 'upload-time',
    label: 'Roughly — this is when I got to it',
    hint: 'Recorded, but NOT the decision moment. A replay leaves it out rather than guessing.',
  },
  {
    value: 'unknown',
    label: 'I do not know',
    hint: 'Still worth keeping and reading. It just cannot be placed in time.',
  },
];

/** `YYYY-MM-DDTHH:mm` in the browser's own clock, which is what a datetime-local input wants. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Turns a datetime-local value into the ISO instant the record stores. */
function fromLocalInputValue(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

/** Everything a brand-new sighting starts with: the time, and nothing the trader did not say. */
function newObservation(userId: string, timezone: string): TradingObservation {
  const now = new Date();
  return {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    observedAt: now.toISOString(),
    observedAtSource: 'recorded',
    marketTimezone: timezone,
    instrumentId: '',
    symbol: '',
    images: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** The field styling every control in the form shares, so the form reads as one object. */
const fieldClass =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 ' +
  'placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600/40';
const labelClass = 'text-[10px] font-mono uppercase font-bold text-zinc-400';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="space-y-1">
    <label className={labelClass}>{label}</label>
    {children}
    {hint && <p className="text-[10px] leading-relaxed text-zinc-500">{hint}</p>}
  </div>
);

export const ObservationLibrary: React.FC<ObservationLibraryProps> = ({
  observations,
  instruments,
  setups,
  trades,
  tradingDays,
  timezone,
  userId,
  todayTradeDate,
  consentToIndex,
  cloudEnabled,
  onSave,
  onDelete,
  onViewTrade,
}) => {
  const [draft, setDraft] = useState<TradingObservation | null>(null);
  /** Which observation's outcome panel is open. One at a time: this is a form, not a table. */
  const [outcomeOpenId, setOutcomeOpenId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState<MemoryObservationFilter>({
    instrumentId: '',
    session: '',
    query: '',
  });

  const dayById = useMemo(
    () => new Map(tradingDays.map((day) => [day.id, day])),
    [tradingDays]
  );

  const tradeDateOf = (trade: Trade): string => {
    const day = dayById.get(trade.tradingDayId);
    return day?.tradeDate ?? (trade.entryTime ? trade.entryTime.slice(0, 10) : '');
  };

  const tradeLabel = (trade: Trade): string => {
    const date = tradeDateOf(trade);
    return (
      `${date || 'no date'} · ${instrumentSymbol(instruments, trade.instrumentId)} ` +
      `${trade.direction.toUpperCase()} ${trade.contracts} · ${trade.rMultiple}R` +
      (trade.setupName ? ` · ${trade.setupName}` : '')
    );
  };

  /** Newest observed first, which is the order the library is read in. */
  const sorted = useMemo(
    () =>
      [...observations].sort((a, b) => (b.observedAt ?? '').localeCompare(a.observedAt ?? '')),
    [observations]
  );

  const visible = useMemo(() => {
    const needle = filter.query.trim().toLowerCase();
    return sorted.filter((observation) => {
      if (filter.instrumentId && observation.instrumentId !== filter.instrumentId) return false;
      if (filter.session && observation.session !== filter.session) return false;
      if (!needle) return true;
      return [observation.setupName, observation.setupCategory, observation.notes, observation.marketContext]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle));
    });
  }, [sorted, filter]);

  const activeFilterCount =
    (filter.instrumentId ? 1 : 0) + (filter.session ? 1 : 0) + (filter.query.trim() ? 1 : 0);

  const indexedCount = sorted.filter((observation) =>
    (observation.images ?? []).some((image) => image.indexStatus === 'completed')
  ).length;
  const withOutcomeCount = sorted.filter(
    (observation) => observation.outcome?.status === 'recorded'
  ).length;
  const noTradeCount = sorted.filter((observation) => !observation.linkedTradeId).length;

  function startNew() {
    setDraft(newObservation(userId, timezone));
    setOutcomeOpenId(null);
  }

  function startEdit(observation: TradingObservation) {
    setDraft({ ...observation, images: [...(observation.images ?? [])] });
    setOutcomeOpenId(null);
  }

  /** Replaces one image slot on the draft, keeping the other slot untouched. */
  function setDraftImage(role: MemoryImage['role'], image: MemoryImage | undefined) {
    setDraft((current) => {
      if (!current) return current;
      const others = (current.images ?? []).filter((existing) => existing.role !== role);
      const images = image ? [...others, image] : others;
      return { ...current, images, updatedAt: new Date().toISOString() };
    });
  }

  function commitDraft() {
    if (!draft) return;
    const instrument = instruments.find((candidate) => candidate.id === draft.instrumentId);
    onSave({
      ...draft,
      // The symbol is copied onto the record rather than resolved later, so renaming or deleting
      // an instrument cannot quietly move a session's history onto something else.
      symbol: instrument ? instrument.symbol : draft.symbol,
    });
    setDraft(null);
  }

  /** Writes an outcome patch onto a stored observation. */
  function saveOutcome(observation: TradingObservation, patch: Partial<MemoryOutcome>) {
    const current: MemoryOutcome = observation.outcome ?? {
      status: 'unknown',
      source: 'trader-recorded',
    };
    const next: MemoryOutcome = { ...current, ...patch };
    onSave({
      ...observation,
      outcome: next,
      updatedAt: new Date().toISOString(),
    });
  }

  const beforeImage = draft?.images?.find(
    (image) => image.role === 'before-setup' || image.role === 'entry'
  );
  const afterImage = draft?.images?.find((image) => image.role === 'after-setup');

  return (
    <section id="observation-library" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-100">
            <BookmarkPlus className="h-4 w-4 text-sky-400" />
            Observation library
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
            Everything you have seen, whether or not you traded it. This is the half of the memory
            that works on its own: a sighting is worth keeping with nothing more than a chart and a
            time, and what price did afterwards is filled in later — or never.
          </p>
        </div>
        <button
          type="button"
          id="observation-new"
          onClick={startNew}
          className="flex items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-xs font-bold text-zinc-950 shadow-sm transition-all hover:scale-[1.02] hover:bg-white active:scale-[0.98]"
        >
          <BookmarkPlus className="h-4 w-4 stroke-[2.5]" />
          Record a sighting
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Observations', value: String(sorted.length) },
          { label: 'Searchable', value: String(indexedCount) },
          { label: 'With an outcome', value: String(withOutcomeCount) },
          { label: 'No trade taken', value: String(noTradeCount) },
        ].map((fact) => (
          <div key={fact.label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            <div className="font-mono text-lg font-semibold text-zinc-100">{fact.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{fact.label}</div>
          </div>
        ))}
      </div>

      {/*
        ---- What the journal already holds, and cannot be searched ----

        Above the list rather than on the Indexing tab, because this is the screen where the trader
        is looking at an empty library and wondering why. It is rendered even when there is nothing
        to bring in: the boundary it explains is exactly what an empty library beside a full journal
        needs said out loud.
      */}
      <JournalImportPanel
        trades={trades}
        observations={observations}
        instruments={instruments}
        userId={userId}
        timezone={timezone}
        consentToIndex={consentToIndex}
        cloudEnabled={cloudEnabled}
        onSave={onSave}
      />

      {/* ---- The record form. Open only while something is being written. ---- */}
      {draft && (
        <div
          id="observation-form"
          className="space-y-4 rounded-2xl border border-sky-900/60 bg-zinc-900/70 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold tracking-tight text-zinc-100">
              {observations.some((existing) => existing.id === draft.id)
                ? 'Edit this sighting'
                : 'Record a sighting'}
            </h3>
            <button
              type="button"
              id="observation-form-cancel"
              onClick={() => setDraft(null)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="When you saw it"
              hint="The decision moment. A replay can only use observations that already existed."
            >
              <input
                id="observation-when"
                type="datetime-local"
                className={fieldClass}
                value={toLocalInputValue(new Date(draft.observedAt))}
                onChange={(e) =>
                  setDraft({ ...draft, observedAt: fromLocalInputValue(e.target.value) })
                }
              />
            </Field>

            <Field label="How sure are you of that time?">
              <select
                id="observation-time-source"
                className={fieldClass}
                value={draft.observedAtSource}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    observedAtSource: e.target.value as MemoryObservedAtSource,
                  })
                }
              >
                {TIME_SOURCES.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                {TIME_SOURCES.find((source) => source.value === draft.observedAtSource)?.hint}
              </p>
            </Field>

            <Field label="Instrument">
              <select
                id="observation-instrument"
                className={fieldClass}
                value={draft.instrumentId}
                onChange={(e) => setDraft({ ...draft, instrumentId: e.target.value })}
              >
                <option value="">Pick the contract</option>
                {instruments
                  .filter((instrument) => instrument.active)
                  .map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.symbol}
                      {instrument.name ? ` — ${instrument.name}` : ''}
                    </option>
                  ))}
              </select>
            </Field>

            <Field label="Timeframe">
              <select
                id="observation-timeframe"
                className={fieldClass}
                value={draft.timeframe ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, timeframe: (e.target.value || undefined) as LevelTimeframe })
                }
              >
                <option value="">Not recorded</option>
                {TIMEFRAMES.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>
                    {timeframe}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Session">
              <select
                id="observation-session"
                className={fieldClass}
                value={draft.session ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, session: (e.target.value || undefined) as TradingSession })
                }
              >
                <option value="">Not recorded</option>
                {SESSIONS.map((session) => (
                  <option key={session} value={session}>
                    {session}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Setup">
              <select
                id="observation-setup"
                className={fieldClass}
                value={draft.setupId ?? ''}
                onChange={(e) => {
                  const setup = setups.find((candidate) => candidate.id === e.target.value);
                  setDraft({
                    ...draft,
                    setupId: setup?.id,
                    setupName: setup?.name,
                  });
                }}
              >
                <option value="">Not one of my setups</option>
                {setups.map((setup) => (
                  <option key={setup.id} value={setup.id}>
                    {setup.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Category"
              hint="An optional wider label, so a growing library can be grouped."
            >
              <input
                id="observation-category"
                className={fieldClass}
                placeholder="e.g. break and run"
                value={draft.setupCategory ?? ''}
                onChange={(e) => setDraft({ ...draft, setupCategory: e.target.value || undefined })}
              />
            </Field>

            <Field label="Trend it was forming against">
              <select
                id="observation-trend"
                className={fieldClass}
                value={draft.previousTrend ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    previousTrend: (e.target.value || undefined) as MarketOutlookBias,
                  })
                }
              >
                <option value="">Not recorded</option>
                {TRENDS.map((trend) => (
                  <option key={trend.value} value={trend.value}>
                    {trend.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="What it pointed at">
              <select
                id="observation-direction"
                className={fieldClass}
                value={draft.observedDirection ?? 'none'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    observedDirection: e.target.value as TradeDirection | 'none',
                  })
                }
              >
                {DIRECTIONS.map((direction) => (
                  <option key={direction.value} value={direction.value}>
                    {direction.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Trade taken under it"
              hint="Optional. Leaving this empty is a real answer — it is how a setup you watched but did not take gets recorded."
            >
              <select
                id="observation-trade"
                className={fieldClass}
                value={draft.linkedTradeId ?? ''}
                onChange={(e) => setDraft({ ...draft, linkedTradeId: e.target.value || undefined })}
              >
                <option value="">No trade</option>
                {[...trades]
                  .sort((a, b) => (b.entryTime ?? '').localeCompare(a.entryTime ?? ''))
                  .slice(0, 100)
                  .map((trade) => (
                    <option key={trade.id} value={trade.id}>
                      {tradeLabel(trade)}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MemoryImagePicker
              idPrefix="observation-before"
              label="What you were looking at"
              role="before-setup"
              observationId={draft.id}
              userId={userId}
              image={beforeImage}
              consentToIndex={consentToIndex}
              onChange={(image) => setDraftImage('before-setup', image)}
            />
            <MemoryImagePicker
              idPrefix="observation-after"
              label="What happened next (optional)"
              role="after-setup"
              observationId={draft.id}
              userId={userId}
              image={afterImage}
              consentToIndex={consentToIndex}
              onChange={(image) => setDraftImage('after-setup', image)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What the chart was showing">
              <textarea
                id="observation-context"
                rows={3}
                className={fieldClass}
                placeholder="Structure, levels, what you were waiting for."
                value={draft.marketContext ?? ''}
                onChange={(e) => setDraft({ ...draft, marketContext: e.target.value || undefined })}
              />
            </Field>
            <Field label="Notes">
              <textarea
                id="observation-notes"
                rows={3}
                className={fieldClass}
                placeholder="In your own words."
                value={draft.notes ?? ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              id="observation-save"
              onClick={commitDraft}
              disabled={!draft.instrumentId}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                draft.instrumentId
                  ? 'bg-sky-500 text-zinc-950 hover:bg-sky-400'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
              }`}
            >
              <Save className="h-4 w-4" />
              {observations.some((existing) => existing.id === draft.id)
                ? 'Save changes'
                : 'Save this sighting'}
            </button>
            {!draft.instrumentId && (
              <p className="text-[11px] text-zinc-500">
                Pick the contract — a sighting with no instrument cannot be grouped or compared.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- Filters. Folded away, because most visits are to read the list. ---- */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              id="observation-search"
              className={`${fieldClass} pl-8`}
              placeholder="Search setups, categories and notes"
              value={filter.query}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            />
          </div>
          <button
            type="button"
            id="observation-filters-toggle"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <Filter className="h-3 w-3" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-md bg-sky-500/20 px-1.5 font-mono text-[10px] text-sky-300">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {filtersOpen && (
          <div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 sm:grid-cols-3">
            <Field label="Instrument">
              <select
                id="observation-filter-instrument"
                className={fieldClass}
                value={filter.instrumentId}
                onChange={(e) => setFilter({ ...filter, instrumentId: e.target.value })}
              >
                <option value="">Any</option>
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.symbol}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Session">
              <select
                id="observation-filter-session"
                className={fieldClass}
                value={filter.session}
                onChange={(e) =>
                  setFilter({ ...filter, session: e.target.value as TradingSession | '' })
                }
              >
                <option value="">Any</option>
                {SESSIONS.map((session) => (
                  <option key={session} value={session}>
                    {session}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                id="observation-filters-clear"
                onClick={() => setFilter({ instrumentId: '', session: '', query: '' })}
                className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---- The list ---- */}
      {visible.length === 0 ? (
        <p id="observation-empty" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs leading-relaxed text-zinc-400">
          {sorted.length === 0
            ? 'Nothing recorded yet. The first sighting is the one that makes this useful — record a chart you are looking at now, even if you never trade it.'
            : 'No sighting matches these filters.'}
        </p>
      ) : (
        <div id="observation-list" className="space-y-2">
          {visible.map((observation) => {
            const before = (observation.images ?? []).find(
              (image) => image.role === 'before-setup' || image.role === 'entry'
            );
            const after = (observation.images ?? []).find(
              (image) => image.role === 'after-setup'
            );
            // Pictures brought in from the journal that nobody has said anything about yet. They are
            // deliberately not filed as either of the two above: an unlabelled picture is not a
            // before-the-decision chart, and presenting it as one is the mistake this strip exists to
            // prevent.
            const unlabelledHere = unlabelledImages(observation);
            const trade = observation.linkedTradeId
              ? trades.find((candidate) => candidate.id === observation.linkedTradeId)
              : undefined;
            const outcomeOpen = outcomeOpenId === observation.id;
            const result = tradeResultSample(trade);

            return (
              <article
                key={observation.id}
                id={`observation-${observation.id}`}
                data-observation-id={observation.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  {before ? (
                    <MemoryImageThumb
                      image={before}
                      alt={`The chart from ${observation.symbol} on ${observation.observedAt.slice(0, 10)}`}
                    />
                  ) : (
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-[9px] text-zinc-600">
                      no chart
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-100">
                        {formatTimestamp(observation.observedAt, timezone)}
                      </span>
                      <span className="rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                        {observation.symbol || 'no contract'}
                      </span>
                      {observation.timeframe && (
                        <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {observation.timeframe}
                        </span>
                      )}
                      {observation.session && (
                        <span className="rounded-md border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {observation.session}
                        </span>
                      )}
                      {observation.setupName && (
                        <span className="rounded-md border border-sky-900/70 bg-sky-950/50 px-1.5 py-0.5 text-[10px] text-sky-300">
                          {observation.setupName}
                        </span>
                      )}
                      {observation.observedAtSource !== 'recorded' && (
                        <span
                          className="rounded-md border border-amber-900/70 bg-amber-950/50 px-1.5 py-0.5 text-[10px] text-amber-300"
                          title={
                            TIME_SOURCES.find(
                              (source) => source.value === observation.observedAtSource
                            )?.hint
                          }
                        >
                          time {observation.observedAtSource === 'unknown' ? 'unknown' : 'approximate'}
                        </span>
                      )}
                    </div>

                    {observation.marketContext && (
                      <p className="text-xs leading-relaxed text-zinc-300">
                        {observation.marketContext}
                      </p>
                    )}
                    {observation.notes && (
                      <p className="text-[11px] leading-relaxed text-zinc-400">{observation.notes}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                      <span>
                        {observation.images.length === 0
                          ? 'no pictures'
                          : `${observation.images.length} picture${
                              observation.images.length === 1 ? '' : 's'
                            }`}
                      </span>
                      <span>
                        {before?.indexStatus === 'completed'
                          ? 'searchable'
                          : before
                          ? before.indexStatus === 'skipped'
                            ? 'not sent for indexing'
                            : 'not indexed yet'
                          : unlabelledHere.length > 0
                          ? 'not searchable until you label it'
                          : 'not indexed yet'}
                      </span>
                      {after && <span>has a what-happened-next picture</span>}
                    </div>

                    {/*
                      ---- The one question an imported picture asks ----

                      Rendered here rather than behind the Edit form because it is a single
                      answer, and because the whole reason these pictures arrived is that they
                      were invisible: a chart in the library that nothing on screen mentions is
                      indistinguishable from one that was dropped.
                    */}
                    {unlabelledHere.length > 0 && (
                      <div
                        id={`observation-unlabelled-${observation.id}`}
                        className="space-y-2 rounded-xl border border-amber-900/50 bg-amber-950/20 p-2.5"
                      >
                        <p className="text-[10px] leading-relaxed text-amber-200/90">
                          {unlabelledHere.length} picture
                          {unlabelledHere.length === 1 ? '' : 's'} brought in from your journal,
                          unlabelled. No search can use {unlabelledHere.length === 1 ? 'it' : 'them'}{' '}
                          yet: only a chart that was in front of you before you decided may be matched
                          on.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {unlabelledHere.map((image) => (
                            <div
                              key={image.id}
                              className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2"
                            >
                              <MemoryImageThumb
                                image={image}
                                alt="A chart brought in from the journal, not labelled yet"
                              />
                              <div className="space-y-1">
                                <span className="inline-block rounded-md border border-amber-900/70 bg-amber-950/50 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
                                  unlabelled
                                </span>
                                <button
                                  type="button"
                                  id={`observation-label-${image.id}`}
                                  onClick={() =>
                                    onSave(
                                      promoteJournalImage(observation, image.id, {
                                        consent: consentToIndex,
                                      })
                                    )
                                  }
                                  className="block rounded-lg border border-sky-800 px-2 py-1 text-[10px] font-semibold text-sky-300 transition-colors hover:bg-sky-950/60"
                                >
                                  This was the chart before my decision
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] leading-relaxed text-zinc-500">
                          Saying so makes it a candidate a search can return, once indexing has given
                          it an embedding. If this record already has a before-the-decision chart,
                          this one takes its place — a record cannot have two pictures both claiming
                          to be the moment of decision.
                        </p>
                      </div>
                    )}

                    {/* Market behaviour, said apart from what the trader did with it. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-zinc-400">
                        Market:{' '}
                        <span className="text-zinc-200">
                          {observation.outcome?.status === 'recorded' &&
                          observation.outcome.continuation
                            ? observation.outcome.continuation
                            : 'not recorded'}
                        </span>
                      </span>
                      <span className="text-zinc-400">
                        You:{' '}
                        <span className="text-zinc-200">
                          {!trade
                            ? 'no trade taken'
                            : trade.status === 'open'
                            ? 'still open'
                            : result ?? 'no result recorded'}
                        </span>
                      </span>
                      {trade && (
                        <button
                          type="button"
                          onClick={() => onViewTrade(trade)}
                          className="flex items-center gap-1 font-semibold text-sky-400 transition-colors hover:text-sky-300"
                        >
                          <Link2 className="h-3 w-3" /> Open the trade
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        id={`observation-outcome-toggle-${observation.id}`}
                        onClick={() =>
                          setOutcomeOpenId(outcomeOpen ? null : observation.id)
                        }
                        aria-expanded={outcomeOpen}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                      >
                        <CalendarClock className="h-3 w-3" />
                        {observation.outcome?.status === 'recorded'
                          ? 'Update what happened'
                          : 'Record what happened'}
                        {outcomeOpen ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        id={`observation-edit-${observation.id}`}
                        onClick={() => startEdit(observation)}
                        className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        id={`observation-delete-${observation.id}`}
                        onClick={() => onDelete(observation.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-rose-900/70 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition-colors hover:bg-rose-950/60"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </div>
                </div>

                {outcomeOpen && (
                  <OutcomeEditor
                    observation={observation}
                    instruments={instruments}
                    userId={userId}
                    consentToIndex={consentToIndex}
                    onSave={(patch) => saveOutcome(observation, patch)}
                    onSaveImage={setDraftImage}
                    onClose={() => setOutcomeOpenId(null)}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

/**
 * What price did afterwards, written after the fact.
 *
 * Split out because it is a different act from recording the sighting: it happens later, it is
 * often never filled in at all, and its fields are the only place in the app where a market result
 * is claimed. So the controls are explicit about the difference between "I could not classify it"
 * and "I did not record it", and a movement figure is only ever typed in — never derived from a
 * price the app does not have.
 */
const OutcomeEditor: React.FC<{
  observation: TradingObservation;
  instruments: Instrument[];
  userId: string;
  consentToIndex: boolean;
  onSave: (patch: Partial<MemoryOutcome>) => void;
  onSaveImage: (role: MemoryImage['role'], image: MemoryImage | undefined) => void;
  onClose: () => void;
}> = ({ observation, instruments, userId, consentToIndex, onSave, onSaveImage, onClose }) => {
  const outcome = observation.outcome;
  const status: MemoryOutcomeStatus = outcome?.status ?? 'unknown';
  const after = (observation.images ?? []).find((image) => image.role === 'after-setup');

  /** Local text state for the three optional figures, so an empty field stays empty. */
  const asText = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

  const [movement, setMovement] = useState(asText(outcome?.measuredMovementPoints));
  const [favourable, setFavourable] = useState(asText(outcome?.maxFavorableExcursionPoints));
  const [adverse, setAdverse] = useState(asText(outcome?.maxAdverseExcursionPoints));
  const [notes, setNotes] = useState(outcome?.notes ?? '');

  /** Reads an optional figure, refusing to turn a blank or a typo into a zero. */
  const readNumber = (text: string): number | undefined => {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  };

  return (
    <div
      id={`observation-outcome-${observation.id}`}
      className="mt-3 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-[11px] font-bold text-zinc-100">What happened after this?</h4>
          <p className="mt-0.5 max-w-xl text-[10px] leading-relaxed text-zinc-500">
            This is the market, not your trading. It is kept separate from whether you made money on
            it, because the two disagree all the time — a setup can continue while your own trade
            loses. A field you leave empty stays unknown; it is never read as zero.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          <X className="h-3 w-3" /> Done
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Recorded?">
          <select
            id={`outcome-status-${observation.id}`}
            className={fieldClass}
            value={status}
            onChange={(e) =>
              onSave({
                status: e.target.value as MemoryOutcomeStatus,
                source: 'trader-recorded',
                verifiedAt: new Date().toISOString(),
              })
            }
          >
            <option value="unknown">Nothing recorded yet</option>
            <option value="recorded">I watched what happened</option>
          </select>
        </Field>

        <Field label="Over what horizon">
          <input
            id={`outcome-window-${observation.id}`}
            list={`outcome-windows-${observation.id}`}
            className={fieldClass}
            placeholder="e.g. 30 minutes after the open"
            value={outcome?.window ?? ''}
            onChange={(e) => onSave({ window: e.target.value || undefined })}
          />
          <datalist id={`outcome-windows-${observation.id}`}>
            {MEMORY_OUTCOME_WINDOWS.map((window) => (
              <option key={window} value={window} />
            ))}
          </datalist>
        </Field>

        <Field label="Continuation or reversal">
          <select
            id={`outcome-continuation-${observation.id}`}
            className={fieldClass}
            value={outcome?.continuation ?? ''}
            onChange={(e) =>
              onSave({
                continuation: (e.target.value || undefined) as MemoryContinuation | undefined,
              })
            }
          >
            <option value="">Not classified</option>
            <option value="continuation">It continued</option>
            <option value="reversal">It reversed</option>
            <option value="unclear">I could not tell</option>
          </select>
        </Field>

        <Field
          label="Movement, in points"
          hint="Only if you actually measured it. Left blank it stays unknown."
        >
          <input
            id={`outcome-movement-${observation.id}`}
            className={fieldClass}
            inputMode="decimal"
            placeholder="not measured"
            value={movement}
            onChange={(e) => setMovement(e.target.value)}
            onBlur={() => onSave({ measuredMovementPoints: readNumber(movement) })}
          />
        </Field>

        <Field label="Best excursion, points">
          <input
            id={`outcome-favourable-${observation.id}`}
            className={fieldClass}
            inputMode="decimal"
            placeholder="not measured"
            value={favourable}
            onChange={(e) => setFavourable(e.target.value)}
            onBlur={() => onSave({ maxFavorableExcursionPoints: readNumber(favourable) })}
          />
        </Field>

        <Field label="Worst excursion, points">
          <input
            id={`outcome-adverse-${observation.id}`}
            className={fieldClass}
            inputMode="decimal"
            placeholder="not measured"
            value={adverse}
            onChange={(e) => setAdverse(e.target.value)}
            onBlur={() => onSave({ maxAdverseExcursionPoints: readNumber(adverse) })}
          />
        </Field>
      </div>

      <Field label="Notes on what happened">
        <textarea
          id={`outcome-notes-${observation.id}`}
          rows={2}
          className={fieldClass}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onSave({ notes: notes || undefined })}
        />
      </Field>

      <MemoryImagePicker
        idPrefix={`outcome-after-${observation.id}`}
        label="A chart from after it played out (optional)"
        role="after-setup"
        observationId={observation.id}
        userId={userId}
        image={after}
        consentToIndex={consentToIndex}
        onChange={(image) => onSaveImage('after-setup', image)}
      />

      {outcome?.status !== 'recorded' && (
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          Until this is marked as watched, the observation counts as an unknown outcome in every
          summary — never as a reversal, and never as a zero.
        </p>
      )}

      <p className="text-[10px] text-zinc-600">
        {instruments.length === 0
          ? 'No instruments are configured.'
          : 'Market behaviour and your execution are always reported as two separate numbers.'}
      </p>
    </div>
  );
};

/** Exported for the summary strip above, so the same wording is used in both places. */
export { formatMemoryRate };
