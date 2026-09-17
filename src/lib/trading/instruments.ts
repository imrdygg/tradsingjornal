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
