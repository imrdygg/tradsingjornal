/**
 * Small helpers the tracker needs and the journal's own utils do not already provide:
 * local dates, clock parsing, formatting, CSV and downloads.
 *
 * Dates are built from `getFullYear/getMonth/getDate` rather than `toISOString`, which
 * yields the previous day for a US trader working in the evening — the single most
 * likely way to file a whole session under the wrong date.
 */
import type { LevelRecord, Timeframe } from './types';
import { TIMEFRAME_ORDER } from './constants';

/** A uuid, falling back for browsers without `crypto.randomUUID`. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mes-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Today's LOCAL date as 'YYYY-MM-DD'. */
export function localISODate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's local date, for the Daily Log's default and its Today button. */
export function todayISO(): string {
  return localISODate();
}

/**
 * Shifts an ISO date by whole days.
 *
 * Parsed as local noon so a daylight-saving boundary cannot push the result onto the
 * previous day.
 */
export function shiftISODate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  date.setDate(date.getDate() + deltaDays);
  return localISODate(date);
}

/** 'YYYY-MM-DD' → 'Mon, Sep 22'. */
export function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** 'YYYY-MM-DD' → 'Sep 22'. */
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Prices: 2 decimals with thousands separators (e.g. 5,823.25). */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A 0..1 fraction as a percentage, or '—' for null. */
export function formatPct(fraction: number | null, digits = 0): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** A 0..100 number as a percentage, or '—' for null. */
export function formatPct100(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** 'HH:MM' → minutes since midnight, or null when unset/unparseable. */
export function parseClockMinutes(hhmm: string): number | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight → '9:35 AM'. */
export function minutesToClockLabel(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** Stored 24h 'HH:MM' → '9:35 AM', or '—'. */
export function formatClock(hhmm: string): string {
  const minutes = parseClockMinutes(hhmm);
  return minutes === null ? '—' : minutesToClockLabel(minutes);
}

/** The current local clock as 'HH:MM' 24h, for the form's Now button. */
export function nowClock(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Fires a text download. No-op outside a browser. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** A CSV cell, quoted when it carries a comma, quote or newline. */
function csvCell(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The tracked levels as CSV.
 *
 * Timing columns are exported in 24h so a spreadsheet sorts them correctly; notes are
 * quoted so a comma in a sentence cannot shift every later column.
 */
export function recordsToCsv(records: LevelRecord[]): string {
  const headers = [
    'date',
    'timeframe',
    'kind',
    'price',
    'touches',
    'holds',
    'breaks',
    'setup',
    'hitTime',
    'breakTime',
    'breakDirection',
    'notes',
  ];
  const rows = records.map((r) =>
    [
      r.date,
      r.timeframe,
      r.kind,
      r.price,
      r.touches,
      r.holds,
      r.breaks,
      r.setup,
      r.hitTime,
      r.breakTime,
      r.breakDirection,
      r.notes,
    ]
      .map(csvCell)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

/** Sort a timeframe list the trader's way — 1m before 1h, not alphabetically. */
export function sortTimeframes(list: Timeframe[]): Timeframe[] {
  return [...list].sort((a, b) => TIMEFRAME_ORDER[a] - TIMEFRAME_ORDER[b]);
}
