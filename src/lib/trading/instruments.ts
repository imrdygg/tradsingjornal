import { Instrument } from '../../types';

/**
 * The built-in instrument catalog.
 *
 * Order is the order of the instrument dropdown when a trade is recorded, and of the
 * "default instrument" picker in Settings, so it is deliberate: the equity index complex
 * this trader's journal is built around first, then metals, then energy, with each micro
 * sitting beside the full-size contract it mirrors. Contracts that arrived in a later
 * release keep the place they were appended in, which is why micro WTI sits with crude
 * rather than with the metals it was added before.
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
 *     without receiving it has not yet reached. The tag picks the version, not the wish:
 *     announcing a contract in a version the journal's marker already passed is a no-op.
 * 6 — micro WTI announced again, because the 5 tag could not reach a journal whose marker
 *     had already recorded 5 without holding it. No journal can have recorded 6 yet, so
 *     this reaches every one; a journal that already holds MCL is untouched.
 */
export const INSTRUMENT_CATALOG_VERSION = 6;

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
  {
    id: 'es',
    symbol: 'ES',
    name: 'E-mini S&P 500',
    pointValue: 50,
    tickSize: 0.25,
    tickValue: 12.5,
    active: true,
  },
  {
    id: 'nq',
    symbol: 'NQ',
    name: 'E-mini Nasdaq-100',
    pointValue: 20,
    tickSize: 0.25,
    tickValue: 5,
    active: true,
  },
  {
    id: 'mym',
    symbol: 'MYM',
    name: 'Micro E-mini Dow',
    pointValue: 0.5,
    tickSize: 1,
    tickValue: 0.5,
    active: true,
  },
  // Dow and Russell, the two index complexes the journal was missing. Each is the
  // full-size contract behind a micro already above it: YM behind MYM, RTY behind M2K.
  {
    id: 'ym',
    symbol: 'YM',
    name: 'E-mini Dow',
    pointValue: 5,
    tickSize: 1,
    tickValue: 5,
    active: true,
    since: 3,
  },
  {
    id: 'm2k',
    symbol: 'M2K',
    name: 'Micro E-mini Russell 2000',
    pointValue: 5,
    tickSize: 0.1,
    tickValue: 0.5,
    active: true,
    since: 3,
  },
  {
    id: 'rty',
    symbol: 'RTY',
    name: 'E-mini Russell 2000',
    pointValue: 50,
    tickSize: 0.1,
    tickValue: 5,
    active: true,
    since: 3,
  },

  // Metals. Gold and silver, each in the micro and full size the two complexes trade in.
  // The micros are not both a tenth: micro gold is a tenth of a 100oz contract but micro
  // silver is a fifth of a 5,000oz one, which is why their point values differ by 10x and
  // 5x respectively.
  {
    id: 'mgc',
    symbol: 'MGC',
    name: 'Micro Gold',
    pointValue: 10,
    tickSize: 0.1,
    tickValue: 1,
    active: true,
    since: 3,
  },
  {
    id: 'gc',
    symbol: 'GC',
    name: 'Gold',
    pointValue: 100,
    tickSize: 0.1,
    tickValue: 10,
    active: true,
    since: 3,
  },
  {
    id: 'sil',
    symbol: 'SIL',
    name: 'Micro Silver',
    pointValue: 1000,
    tickSize: 0.005,
    tickValue: 5,
    active: true,
    since: 3,
  },
  {
    id: 'si',
    symbol: 'SI',
    name: 'Silver',
    pointValue: 5000,
    tickSize: 0.005,
    tickValue: 25,
    active: true,
    since: 3,
  },

  // Energy. Micro WTI is 100 barrels, so a $1.00 move in the barrel price is $100 per
  // contract — a tenth of full-size crude, which is the point of it.
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
  {
    id: 'cl',
    symbol: 'CL',
    name: 'WTI Crude Oil',
    pointValue: 1000,
    tickSize: 0.01,
    tickValue: 10,
    active: true,
    since: 3,
  },
];

/**
 * The instruments whose session extremes the trader logs.
 *
 * Deliberately their own short list rather than every contract in the catalog: the log
 * exists to answer a question about the two index micros and the one energy micro they
 * actually trade, and a picker with fifteen contracts on it turns a ten-second entry into
 * a search. Matched by symbol, so a journal that has renamed or deactivated one still
 * offers the others.
 */
export const TRACKED_EXTREME_SYMBOLS: readonly string[] = ['MES', 'MNQ', 'MCL'];

/**
 * The tracked instruments to offer in the extremes log, in the order they are logged.
 *
 * The journal's own entry is used whenever the catalog holds it, so a trader who corrected a
 * point value or deactivated one of the three sees their version. When the catalog does not
 * hold one, the built-in definition is used rather than leaving a gap: this log exists to
 * record these three contracts specifically, and it must not depend on a catalog migration
 * having delivered them — the failure that left micro WTI out of the trade form is exactly
 * the case this covers.
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
 * Broker exports name the full contract — "MESZ5", "MNQU6", "ESH4" — so we
 * match on the longest instrument symbol that the contract starts with. The
 * longest match matters: "MNQU6" must not be read as "NQ".
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
