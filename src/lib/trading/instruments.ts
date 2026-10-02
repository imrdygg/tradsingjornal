import { Instrument } from '../../types';

/**
 * The built-in instrument catalog: the three contracts this journal is for.
 *
 * It is deliberately short. The journal is one trader's record, and this trader trades
 * micro S&P, micro Nasdaq and micro WTI — nothing else. A dropdown of fifteen contracts
 * turns recording a trade into a search and invites a wrong one to be picked; the three
 * the trader actually uses sit there and nothing else does.
 *
 * `since` marks the catalog version an instrument arrived in, and it is what lets the
 * catalog grow for a journal that already exists: see `ensureInstrumentCatalog`. Entries
 * without it predate the versioning and are never re-added once a trader has removed them.
 */

/**
 * The current built-in catalog version. Bump it, and tag the new instruments with the new
 * number, when adding contracts that existing journals should receive.
 *
 * 1 — the equity index futures the journal shipped with.
 * 2 — micro WTI.
 * 3 — the rest of the index, metals and energy complexes, micro and full size.
 * 4 — micro WTI announced again, so a journal that is somehow missing it receives it.
 * 5 — micro WTI announced once more, from a version a journal that somehow passed 4
 *     without receiving it has not yet reached.
 * 6 — micro WTI announced again, because the 5 tag could not reach a journal whose marker
 *     had already recorded 5 without holding it. No journal can have recorded 6 yet, so
 *     this reaches every one; a journal that already holds MCL is untouched.
 */
export const INSTRUMENT_CATALOG_VERSION = 6;

/**
 * Built-in contracts that were once shipped and no longer are.
 *
 * The merge in `ensureInstrumentCatalog` only ever adds, so a journal that received ES, GC,
 * CL and the rest would keep them forever. These ids are stripped from a stored list on
 * every read instead, so a journal that grew the full catalog is brought back to the three
 * the trader uses. Matched on id, which is stable for the built-ins, so a contract the
 * trader added themselves under another id is untouched.
 */
export const RETIRED_INSTRUMENT_IDS: readonly string[] = [
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
  {
    id: 'mnq',
    symbol: 'MNQ',
    name: 'Micro E-mini Nasdaq-100',
    pointValue: 2,
    tickSize: 0.25,
    tickValue: 0.5,
    active: true,
  },
  // Micro WTI is 100 barrels, so a $1.00 move in the barrel price is $100 per contract.
  //
  // Tagged at version 6, three releases past the 2 it first arrived in: a journal whose
  // catalog marker had already passed micro WTI but which did not hold it was reaching a
  // state the upgrade rule reads as a deliberate removal. Re-announcing it is the only way
  // that journal receives it, and a journal that already has it is untouched — the merge
  // skips anything already present by symbol or id. The version must be one the journal has
  // not yet recorded, so each attempt advances the marker rather than reusing it.
  {
    id: 'mcl',
    symbol: 'MCL',
    name: 'Micro WTI Crude Oil',
    pointValue: 100,
    tickSize: 0.01,
    tickValue: 1,
    active: true,
    since: 6,
  },
];

/**
 * The instruments whose session extremes the trader logs.
 *
 * Deliberately their own short list rather than every contract in the catalog, because the
 * log exists to answer a question about these three contracts specifically.
 */
export const TRACKED_EXTREME_SYMBOLS: readonly string[] = ['MES', 'MNQ', 'MCL'];

/**
 * The instruments whose support and resistance lines the trader marks, every day.
 *
 * Their three tradable contracts plus VIX, which they read but do not trade. Kept as its own
 * list rather than added to the catalog above, because the catalog is what the trade form and
 * the P&L read from — a levels-only symbol must never appear there and be mistaken for
 * something the account can hold.
 */
export const TRACKED_LEVEL_SYMBOLS: readonly string[] = ['MES', 'MNQ', 'MCL', 'VIX'];

/**
 * Levels-only instruments that are not in the trade catalog.
 *
 * Given a zero point value on purpose: nothing here can be priced or traded, so if one ever
 * reached a trade calculation it would contribute nothing rather than inventing a figure.
 */
export const LEVEL_ONLY_INSTRUMENTS: Instrument[] = [
  {
    id: 'vix',
    symbol: 'VIX',
    name: 'CBOE Volatility Index',
    pointValue: 0,
    tickSize: 0.01,
    tickValue: 0,
    active: true,
  },
];

/**
 * The instruments the level-marking card offers, in a fixed order: the trader's four.
 *
 * The journal's own entry wins whenever the catalog holds the symbol, so a corrected name or
 * an added contract is respected; a symbol the catalog does not hold falls back to the
 * built-in definition, and VIX to its levels-only one. Mirrors `trackedExtremeInstruments`
 * for the same reason: this card exists to record these four specifically and must not depend
 * on a catalog migration having delivered them.
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
 * record these three contracts specifically, and it must not depend on a catalog migration
 * having delivered them.
 *
 * Falls back to the whole catalog only when the list is unusable, so the picker is never
 * empty for a trader who has removed all three from their own catalog.
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

export function findInstrument(instruments: Instrument[], symbolOrId: string): Instrument {
  const match = instruments.find(
    (i) =>
      i.id.toLowerCase() === symbolOrId.toLowerCase() ||
      i.symbol.toLowerCase() === symbolOrId.toLowerCase()
  );
  return match || DEFAULT_INSTRUMENTS[0]; // fallback to MES
}

/**
 * Display symbol for a trade's stored instrument id (e.g. 'mnq' -> 'MNQ').
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
 * Broker exports name the full contract — "MESZ5", "MNQU6", "MCLZ5" — so we
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
