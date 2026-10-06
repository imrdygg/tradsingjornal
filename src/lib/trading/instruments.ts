import { Instrument } from '../../types';

/**
 * The built-in instrument catalog: the one contract this journal is for.
 *
 * It is deliberately a single entry. The journal is one trader's record, and this trader
 * trades micro S&P and nothing else. A dropdown of other contracts turns recording a trade
 * into a search and invites a wrong one to be picked; MES sits there and nothing else does.
 *
 * `since` marks the catalog version an instrument arrived in, and it is what lets the
 * catalog grow for a journal that already exists: see `ensureInstrumentCatalog`. Entries
 * without it predate the versioning and are never re-added once a trader has removed them.
 */

/**
 * The current built-in catalog version. Bump it, and tag the new instruments with the new
 * number, when adding contracts that existing journals should receive.
 *
 * The catalog grew over several releases to carry the equity index, metals and energy
 * complexes. Those are gone now: the trader trades MES alone, and every other contract —
 * including the micro Nasdaq and micro WTI this file used to hold — is retired below, so a
 * journal that once carried them is brought back to MES on its next read. There is nothing
 * left to add, so the marker survives only to keep the merge's rule well defined.
 */
export const INSTRUMENT_CATALOG_VERSION = 6;

/**
 * Built-in contracts that were once shipped and no longer are.
 *
 * The merge in `ensureInstrumentCatalog` only ever adds, so a journal that received ES, GC,
 * CL and the rest would keep them forever. These ids are stripped from a stored list on
 * every read instead, so a journal that grew the full catalog is brought back to the one
 * contract the trader uses. Matched on id, which is stable for the built-ins, so a contract
 * the trader added themselves under another id is untouched.
 *
 * MNQ and MCL were this catalog's own defaults until the trader narrowed the journal to
 * MES; VIX was a levels-only symbol. All three are listed here so an existing journal loses
 * them too, rather than only a fresh install being clean.
 */
export const RETIRED_INSTRUMENT_IDS: readonly string[] = [
  'mnq',
  'mcl',
  'vix',
  'es',
  'nq',
  'mym',
  'ym',
  'm2k',
  'rty',
  'mgc',
  'gc',
  'sil',
  'si',
  'cl',
];

export const DEFAULT_INSTRUMENTS: Instrument[] = [
  {
    id: 'mes',
    symbol: 'MES',
    name: 'Micro E-mini S&P 500',
    pointValue: 5,
    tickSize: 0.25,
    tickValue: 1.25,
    active: true,
  },
];

/**
 * The instruments whose session extremes the trader logs.
 *
 * One now: MES. It was the micro Nasdaq and micro WTI as well, but the journal records a
 * single contract, so there is nothing else to log extremes against.
 */
export const TRACKED_EXTREME_SYMBOLS: readonly string[] = ['MES'];

/**
 * The instruments whose support and resistance lines the trader marks, every day.
 *
 * MES alone. It also carried the micro Nasdaq and micro WTI, and VIX as a symbol the trader
 * read but did not trade; all four became one when the journal narrowed to a single market.
 * Kept as its own list rather than read straight off the catalog, because the catalog is what
 * the trade form and the P&L read from — a levels-only symbol must never appear there and be
 * mistaken for something the account can hold.
 */
export const TRACKED_LEVEL_SYMBOLS: readonly string[] = ['MES'];

/**
 * Levels-only instruments that are not in the trade catalog.
 *
 * Empty since VIX — the only such symbol — was removed. The list and the path that reads it
 * are kept: marking a level on a market you do not trade is still something this card can
 * do, so adding one back should be a single entry rather than a new feature.
 */
export const LEVEL_ONLY_INSTRUMENTS: Instrument[] = [];

/**
 * The instruments the level-marking card offers, in a fixed order: MES.
 *
 * The journal's own entry wins whenever the catalog holds the symbol, so a corrected name or
 * an added contract is respected; a symbol the catalog does not hold falls back to the
 * built-in definition, and a levels-only symbol to its own. Mirrors
 * `trackedExtremeInstruments` for the same reason: this card exists to record this contract
 * specifically and must not depend on a catalog migration having delivered it.
 */
export function trackedLevelInstruments(instruments: Instrument[]): Instrument[] {
  const bySymbol = new Map<string, Instrument>();
  for (const instrument of instruments) {
    bySymbol.set(instrument.symbol.trim().toUpperCase(), instrument);
  }

  const tracked: Instrument[] = [];
  for (const symbol of TRACKED_LEVEL_SYMBOLS) {
    const key = symbol.toUpperCase();
    const chosen =
      bySymbol.get(key) ??
      DEFAULT_INSTRUMENTS.find((item) => item.symbol.toUpperCase() === key) ??
      LEVEL_ONLY_INSTRUMENTS.find((item) => item.symbol.toUpperCase() === key);
    if (chosen && !tracked.some((existing) => existing.id === chosen.id)) tracked.push(chosen);
  }

  return tracked.length ? tracked : instruments;
}

/**
 * The tracked instruments to offer in the extremes log, in the order they are logged.
 *
 * The journal's own entry is used whenever the catalog holds it, so a trader who corrected a
 * point value or deactivated one of the three sees their version. When the catalog does not
 * hold one, the built-in definition is used rather than leaving a gap: this log exists to
 * record this contract specifically, and it must not depend on a catalog migration having
 * delivered it.
 *
 * Falls back to the whole catalog only when the list is unusable, so the picker is never
 * empty for a trader who has removed it from their own catalog.
 */
export function trackedExtremeInstruments(instruments: Instrument[]): Instrument[] {
  const bySymbol = new Map<string, Instrument>();
  for (const instrument of instruments) {
    bySymbol.set(instrument.symbol.trim().toUpperCase(), instrument);
  }

  const tracked: Instrument[] = [];
  for (const symbol of TRACKED_EXTREME_SYMBOLS) {
    const key = symbol.toUpperCase();
    const chosen =
      bySymbol.get(key) ?? DEFAULT_INSTRUMENTS.find((item) => item.symbol.toUpperCase() === key);
    if (chosen && !tracked.some((existing) => existing.id === chosen.id)) tracked.push(chosen);
  }

  return tracked.length ? tracked : instruments;
}

/**
 * How many ticks wide a marked level is by default.
 *
 * Sixteen ticks: wide enough to absorb an ordinary wick through the line without calling it a
 * break, narrow enough that the band is still the level rather than the noise around it.
 */
export const DEFAULT_LEVEL_ZONE_TICKS = 16;

/**
 * The default width of a marked level, in points, for one instrument.
 *
 * A level is a zone, not a tick — the edge code only counts price as having broken a level once
 * it leaves a band around it, and counts a step back inside the band as the level failing — so
 * the width is a real setting and one figure cannot fit every contract. Four points is sixteen
 * ticks of MES: the default is derived from the contract's own tick so an instrument starts
 * somewhere sensible instead of copying one contract's width onto another.
 */
export function defaultLevelZonePoints(instrument: Instrument | undefined): number {
  const tick = instrument?.tickSize;
  if (!tick || !Number.isFinite(tick) || tick <= 0) return 4;
  return Math.round(tick * DEFAULT_LEVEL_ZONE_TICKS * 100) / 100;
}

/** Tiny formatter that trims trailing zeros: 7702.5 -> "7702.5", 7702.00 -> "7702". */
export function formatPoints(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * A price the trader recorded, shown at the two decimals the price fields are typed in.
 *
 * Prices are held as numbers, so a line marked at 7760.80 comes back as 7760.8 — printing the
 * number straight silently drops the trailing zero and reads as a different price. The level
 * editors, the marked-line list, the touch log and the session extremes all show two decimals;
 * this is that convention in one place, so a line entered at 7760.80 reads as 7760.80
 * everywhere without changing what is stored.
 */
export function formatLevelPrice(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '—';
}

export function findInstrument(instruments: Instrument[], symbolOrId: string): Instrument {
  const match = instruments.find(
    (i) =>
      i.id.toLowerCase() === symbolOrId.toLowerCase() ||
      i.symbol.toLowerCase() === symbolOrId.toLowerCase()
  );
  return match || DEFAULT_INSTRUMENTS[0]; // fallback to MES
}

/**
 * Display symbol for a trade's stored instrument id (e.g. 'mes' -> 'MES').
 *
 * Unlike findInstrument this does NOT fall back to MES: labelling an unknown
 * instrument as MES is exactly the kind of silent lie that makes a journal
 * untrustworthy. Unknown ids are shown uppercased instead.
 */
export function instrumentSymbol(instruments: Instrument[], instrumentId?: string): string {
  if (!instrumentId) return instruments[0]?.symbol ?? '—';
  const match = instruments.find(
    (i) =>
      i.id.toLowerCase() === instrumentId.toLowerCase() ||
      i.symbol.toLowerCase() === instrumentId.toLowerCase()
  );
  return match ? match.symbol : instrumentId.toUpperCase();
}

/**
 * Resolves a broker contract month code to a journal instrument.
 *
 * Broker exports name the full contract — "MESZ5", "MESU6" — so we
 * match on the longest instrument symbol that the contract starts with, so a contract
 * is never read as the shorter symbol it happens to begin with.
 */
export function findInstrumentByContract(
  instruments: Instrument[],
  contract: string
): Instrument | undefined {
  if (!contract) return undefined;
  const upper = contract.trim().toUpperCase();

  const exact = instruments.find((i) => i.symbol.toUpperCase() === upper || i.id.toUpperCase() === upper);
  if (exact) return exact;

  const prefixed = instruments
    .filter((i) => upper.startsWith(i.symbol.toUpperCase()))
    .sort((a, b) => b.symbol.length - a.symbol.length);

  return prefixed[0];
}
