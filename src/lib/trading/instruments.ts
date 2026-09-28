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
 */
export const INSTRUMENT_CATALOG_VERSION = 3;

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
  {
    id: 'mcl',
    symbol: 'MCL',
    name: 'Micro WTI Crude Oil',
    pointValue: 100,
    tickSize: 0.01,
    tickValue: 1,
    active: true,
    since: 2,
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
