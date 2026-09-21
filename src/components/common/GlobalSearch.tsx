import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Tag,
  Layers,
  ArrowDownRight,
  ArrowUpRight,
  X,
  Calendar,
  CornerDownLeft,
  ClipboardList,
} from 'lucide-react';
import type { DailyReview, Instrument, Trade, TradingDay } from '../../types';
import {
  buildSearchIndex,
  buildDaySearchIndex,
  buildSuggestions,
  filterSuggestions,
  searchTrades,
  searchDays,
  type DayMatch,
  type SearchMatch,
  type SearchSuggestion,
} from '../../lib/search/journal-search';
import { formatTradingDate, formatTimestamp } from '../../lib/storage/date-utils';

/**
 * The home page's journal-wide search.
 *
 * One box that finds anything in the journal: trades by tags ("president speech"), setup,
 * notes, instrument, P&L (">100", "<-50", "pnl:75") and date/time — and, beyond trades,
 * the journal's own writing. A day's morning plan (waiting-for, stay-out-if, notes,
 * watched setups, level labels, audit reasons) and its end-of-day review (did well /
 * did poorly / tomorrow focus) are indexed per day, so a word you only wrote in last
 * Tuesday's review finds that day.
 *
 * While typing, a dropdown offers the journal's own labels — tags first, then setups and
 * symbols — each with a live count, and the first result is previewed inline so the
 * answer is visible before the query is even finished.
 *
 * Deliberately client-side and instant: the journal is already in memory, so there is no
 * spinner and no network anywhere in this component.
 */

interface GlobalSearchProps {
  trades: Trade[];
  tradingDays: TradingDay[];
  reviews: DailyReview[];
  instruments: Instrument[];
  timezone: string;
  /** Opens the read-only trade detail for a matched trade. */
  onViewTrade: (trade: Trade) => void;
  /** Opens the History tab's day detail for a matched plan or review. */
  onOpenDay: (dayId: string) => void;
}

const KIND_STYLES: Record<SearchSuggestion['kind'], { label: string; icon: React.ReactNode }> = {
  tag: { label: 'tag', icon: <Tag className="h-3 w-3" /> },
  setup: { label: 'setup', icon: <Layers className="h-3 w-3" /> },
  symbol: { label: 'symbol', icon: <Search className="h-3 w-3" /> },
};

const money = (n: number) =>
  `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  trades,
  tradingDays,
  reviews,
  instruments,
  timezone,
  onViewTrade,
  onOpenDay,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const index = useMemo(
    () =>
      buildSearchIndex(
        trades,
        instruments,
        new Map(tradingDays.map((day) => [day.id, day.tradeDate]))
      ),
    [trades, instruments, tradingDays]
  );

  const dayIndex = useMemo(
    () => buildDaySearchIndex(tradingDays, reviews),
    [tradingDays, reviews]
  );

  const allSuggestions = useMemo(() => buildSuggestions(index), [index]);
  const suggestions = useMemo(
    () => filterSuggestions(allSuggestions, query),
    [allSuggestions, query]
  );

  const matches = useMemo(
    () => (query.trim() ? searchTrades(index, query) : []),
    [index, query]
  );

  const dayMatches = useMemo(
    () => (query.trim() ? searchDays(dayIndex, query) : []),
    [dayIndex, query]
  );

  const totalResults = matches.length + dayMatches.length;

  // Close on outside click — a dropdown that lingers after the click that was meant
  // elsewhere reads as broken.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep the highlight inside the list as suggestions filter down.
  useEffect(() => {
    setHighlighted((prev) => (suggestions.length ? Math.min(prev, suggestions.length - 1) : 0));
  }, [suggestions.length]);

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setQuery(suggestion.value);
    setHighlighted(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (query) {
        setQuery('');
      } else {
        setOpen(false);
      }
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => (suggestions.length ? (prev + 1) % suggestions.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) =>
        suggestions.length ? (prev - 1 + suggestions.length) % suggestions.length : 0
      );
    } else if (event.key === 'Enter') {
      // Enter accepts the highlighted suggestion while the dropdown is showing one;
      // otherwise Enter simply closes the dropdown over the results already shown.
      if (suggestions.length > 0 && document.activeElement === inputRef.current) {
        event.preventDefault();
        chooseSuggestion(suggestions[Math.min(highlighted, suggestions.length - 1)]);
      }
    }
  };

  const clear = () => {
    setQuery('');
    setHighlighted(0);
    inputRef.current?.focus();
  };

  const preview: SearchMatch | null = matches[0] ?? null;
  const previewDay: DayMatch | null = !preview ? (dayMatches[0] ?? null) : null;

  return (
    <div ref={rootRef} className="relative" id="journal-search">
      {/* Input row */}
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 shadow-sm backdrop-blur-sm focus-within:border-emerald-700/60">
        <Search className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search trades, tags, P&L, plans, reviews — e.g. “president speech”, >100"
          aria-label="Search the journal"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {query.trim() && (
          <span
            className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] ${
              totalResults > 0
                ? 'border-emerald-800/70 bg-emerald-950/50 text-emerald-300'
                : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
            }`}
          >
            {totalResults} match{totalResults === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {/* Dropdown: suggestions while typing */}
      {open && suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        >
          <p className="border-b border-zinc-800/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            In your journal
          </p>
          <ul className="max-h-64 overflow-y-auto py-1">
            {suggestions.map((suggestion, i) => {
              const kind = KIND_STYLES[suggestion.kind];
              return (
                <li key={`${suggestion.kind}-${suggestion.value}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlighted}
                    onMouseEnter={() => setHighlighted(i)}
                    onClick={() => chooseSuggestion(suggestion)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                      i === highlighted ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 text-zinc-300">
                      {kind.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{suggestion.value}</span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {suggestion.kind !== 'tag' ? `${kind.label} · ` : ''}
                      {suggestion.meta}
                    </span>
                    {i === highlighted && (
                      <CornerDownLeft className="h-3 w-3 shrink-0 text-zinc-600" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Inline result preview: the first match, visible while typing. Trades win —
          they are what the search box is mostly asked for — with the first matching
          day (plan/review) shown when no trade matched. */}
      {query.trim() && preview && (
        <button
          type="button"
          onClick={() => onViewTrade(preview.entry.trade)}
          className="search-result-enter mt-2 block w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-left transition-colors hover:border-zinc-700"
          title="Open the full trade"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-zinc-100">
              {preview.entry.trade.direction === 'long' ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5 text-rose-400" />
              )}
              {preview.entry.trade.direction.toUpperCase()} {preview.entry.trade.contracts}{' '}
              {preview.entry.symbol}
            </span>
            <span className="font-mono text-xs text-zinc-400">
              {preview.entry.trade.setupName || '—'}
            </span>
            <span
              className={`ml-auto font-mono text-xs font-bold ${
                preview.entry.trade.grossPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {money(preview.entry.trade.grossPnL)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-zinc-500" />
              {preview.entry.tradeDate
                ? formatTradingDate(preview.entry.tradeDate, timezone)
                : '—'}
            </span>
            <span className="font-mono">{formatTimestamp(preview.entry.trade.entryTime, timezone)}</span>
            {preview.entry.trade.tags && preview.entry.trade.tags.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                {preview.entry.trade.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-amber-800/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            )}
            <span className="ml-auto rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
              {preview.reason === 'tag'
                ? 'matched tags'
                : preview.reason === 'pnl'
                ? 'matched P&L'
                : preview.reason === 'text+pnl'
                ? 'text + P&L'
                : 'matched text'}
            </span>
          </div>
        </button>
      )}

      {/* First matching day (plan / review) when no trade matched */}
      {query.trim() && previewDay && (
        <button
          type="button"
          onClick={() => onOpenDay(previewDay.entry.day.id)}
          className="search-result-enter mt-2 block w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-left transition-colors hover:border-zinc-700"
          title="Open this day in History"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-zinc-100">
              <ClipboardList className="h-3.5 w-3.5 text-sky-400" />
              {formatTradingDate(previewDay.entry.day.tradeDate, timezone)}
            </span>
            <span className="font-mono text-[11px] text-zinc-400 capitalize">
              bias {previewDay.entry.day.marketBias}
            </span>
            <span
              className={`ml-auto rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                previewDay.reason === 'review'
                  ? 'border-amber-800/60 bg-amber-950/40 text-amber-300'
                  : previewDay.reason === 'plan+review'
                  ? 'border-sky-800/60 bg-sky-950/40 text-sky-300'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
              }`}
            >
              {previewDay.reason === 'review'
                ? 'matched review'
                : previewDay.reason === 'plan+review'
                ? 'matched plan + review'
                : 'matched plan'}
            </span>
          </div>
          <p className="mt-1.5 truncate text-[11px] text-zinc-400">
            {previewDay.entry.day.stayOutIf ||
              previewDay.entry.day.waitingFor ||
              previewDay.entry.review?.tomorrowFocus ||
              previewDay.entry.review?.didPoorly ||
              'No plan notes on this day'}
          </p>
        </button>
      )}

      {/* Nothing anywhere — say what WAS searched so the empty state teaches the scope */}
      {query.trim() && !preview && !previewDay && (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-2.5 text-xs text-zinc-400">
          Nothing in trades, plans or reviews matches “{query.trim()}”. Tags match whole or
          partial — try one word, or a P&amp;L filter like <span className="font-mono">&gt;100</span>.
        </p>
      )}
    </div>
  );
};
