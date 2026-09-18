import { Instrument } from '../../types';

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
