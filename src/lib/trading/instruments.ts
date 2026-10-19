import { Instrument, InstrumentKind } from '../../types';

/**
 * The instrument catalog: every contract the trader can record, and the arithmetic behind it.
 *
 * The journal used to be one contract's journal — MES and nothing else — on the reasoning that
 * a short picker is a picker nobody gets wrong. That is only true for a trader with one market.
 * This software is sold to futures traders, and they trade ES, NQ, CL, GC, ZN and whatever else
 * their plan names; a stock or ETF is a symbol someone types, and a custom contract is one the
 * seller has never heard of. So the catalog is a starting list, not a gate: it ships the liquid
 * futures contracts with their real specifications, and the trader adds, edits or retires
 * anything else.
 *
 * Two rules keep that honest:
 *
 * 1. **A contract's own spec prices its own trades.** `pointValue` is dollars per point for one
 *    unit (one contract, or one share for a stock), and `tickValue` is derived from it rather
 *    than trusted from a form. Nothing here assumes $5/point.
 * 2. **An unknown symbol is never silently priced as another contract.** `findInstrument` used
 *    to fall back to MES, which turned an unrecognised import into a P&L figure that looked
 *    real. It now falls back to a neutral one-dollar-per-point instrument carrying the symbol
 *    that was asked for, and says so.
 */

/**
 * The current built-in catalog version.
 *
 * Bump it, and tag the new instruments with the new number, when adding contracts that
 * existing journals should receive. A journal's own edits always win; this only decides what
 * arrives that it has never seen.
 */
export const INSTRUMENT_CATALOG_VERSION = 7;

/** Short, stable ids for the built-ins: the symbol, lowercased. */
const id = (symbol: string) => symbol.trim().toLowerCase();

/**
 * One built-in contract, written the way the exchange publishes it.
 *
 * `pointValue` and `tickSize` are the two fields that matter: tick value is their product, and
 * the P&L read is `points × pointValue × quantity`. Specs are per one contract.
 */
function future(
  symbol: string,
  name: string,
  pointValue: number,
  tickSize: number
): Instrument {
  return {
    id: id(symbol),
    symbol,
    name,
    kind: 'future',
    pointValue,
    tickSize,
    tickValue: Math.round(pointValue * tickSize * 1e6) / 1e6,
    active: true,
    since: INSTRUMENT_CATALOG_VERSION,
  };
}

/**
 * The built-in futures catalog.
 *
 * Grouped as a trader groups them, though the order here is only the order a fresh journal
 * shows. The list is deliberately the liquid contracts with published specs rather than every
 * listed product: a wrong spec is worse than a missing one, because a missing one is obvious
 * and an editable one is a minute's work. Anything absent is added by the trader, who knows
 * their own commission schedule and contract size.
 */
export const DEFAULT_INSTRUMENTS: Instrument[] = [
  // ---- Equity index -------------------------------------------------------
  future('ES', 'E-mini S&P 500', 50, 0.25),
  future('MES', 'Micro E-mini S&P 500', 5, 0.25),
  future('NQ', 'E-mini Nasdaq-100', 20, 0.25),
  future('MNQ', 'Micro E-mini Nasdaq-100', 2, 0.25),
  future('YM', 'E-mini Dow ($5)', 5, 1),
  future('MYM', 'Micro E-mini Dow ($0.50)', 0.5, 1),
  future('RTY', 'E-mini Russell 2000', 50, 0.1),
  future('M2K', 'Micro E-mini Russell 2000', 5, 0.1),
  future('NKD', 'Nikkei 225 (USD)', 5, 5),

  // ---- Energy -------------------------------------------------------------
  future('CL', 'Crude Oil (WTI)', 1000, 0.01),
  future('MCL', 'Micro Crude Oil (WTI)', 100, 0.01),
  future('QM', 'E-mini Crude Oil', 500, 0.025),
  future('BZ', 'Brent Crude Oil (last day)', 1000, 0.01),
  future('NG', 'Natural Gas (Henry Hub)', 10000, 0.001),
  future('RB', 'RBOB Gasoline', 42000, 0.0001),
  future('HO', 'NY Harbor ULSD (Heating Oil)', 42000, 0.0001),

  // ---- Metals -------------------------------------------------------------
  future('GC', 'Gold', 100, 0.1),
  future('MGC', 'Micro Gold', 10, 0.1),
  future('SI', 'Silver', 5000, 0.005),
  future('SIL', 'Micro Silver', 1000, 0.005),
  future('HG', 'Copper', 25000, 0.0005),
  future('PL', 'Platinum', 50, 0.1),

  // ---- Rates --------------------------------------------------------------
  future('ZB', '30-Year T-Bond', 1000, 1 / 32),
  future('ZN', '10-Year T-Note', 1000, 1 / 64),
  future('ZF', '5-Year T-Note', 1000, 1 / 128),
  future('ZT', '2-Year T-Note', 2000, 1 / 256),
  future('SR3', '3-Month SOFR', 2500, 0.005),

  // ---- Grains -------------------------------------------------------------
  future('ZC', 'Corn', 5000, 0.25),
  future('ZS', 'Soybeans', 5000, 0.25),
  future('ZW', 'Chicago Wheat', 5000, 0.25),

  // ---- Currencies ---------------------------------------------------------
  future('6E', 'Euro FX', 125000, 0.00005),
  future('6J', 'Japanese Yen', 12500000, 0.0000005),
  future('6B', 'British Pound', 62500, 0.0001),
  future('6A', 'Australian Dollar', 100000, 0.0001),

  // ---- Crypto -------------------------------------------------------------
  future('BTC', 'Bitcoin', 5, 5),
  future('MBT', 'Micro Bitcoin', 0.1, 5),
  future('ETH', 'Ether', 50, 0.05),
];

/**
 * Where the trader's focus contract sits first, and what the level and extreme cards lead with.
 *
 * These are ordering preferences, not gates. Every active instrument can be marked, logged and
 * traded; the list simply puts the contract the day is worked on at the front, which is where
 * a picker's most-used entry belongs.
 */
export const PREFERRED_FOCUS_SYMBOL = 'MES';

/**
 * The instruments a picker offers: every active one, focus first.
 *
 * `focusSymbol` is the day's own contract. It is moved to the front rather than filtering the
 * rest out: the trader records what they actually traded, and a picker that hides the other
 * contracts is how a trade ends up filed under the wrong symbol.
 */
export function activeInstruments(
  instruments: Instrument[],
  focusSymbol?: string
): Instrument[] {
  const active = instruments.filter((instrument) => instrument.active !== false);
  const list = active.length ? active : instruments;
  if (!focusSymbol) return list;

  const key = focusSymbol.trim().toUpperCase();
  const focus = list.find((instrument) => instrument.symbol.trim().toUpperCase() === key);
  if (!focus) return list;
  return [focus, ...list.filter((instrument) => instrument.id !== focus.id)];
}

/**
 * Instruments whose levels the trader marks.
 *
 * Every active instrument: a level is a level, whatever it is drawn on. Kept as a function
 * rather than reading `instruments` directly so a caller that has only a focus contract still
 * gets a usable list.
 */
export function trackedLevelInstruments(instruments: Instrument[]): Instrument[] {
  return activeInstruments(instruments);
}

/**
 * Instruments offered in the session-extremes log.
 *
 * The same list as the level card, for the same reason: the trader logs the high and low of
 * the market they are actually watching, and which market that is changes.
 */
export function trackedExtremeInstruments(instruments: Instrument[]): Instrument[] {
  return activeInstruments(instruments);
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
 * the width is a real setting and one figure cannot fit every contract. It is derived from the
 * contract's own tick rather than copying one contract's width onto another.
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

/** The asset class a stored instrument belongs to, inferred for records saved before it. */
export function instrumentKind(instrument: Instrument | undefined): InstrumentKind {
  if (!instrument) return 'custom';
  if (instrument.kind) return instrument.kind;
  // Everything the app shipped before kinds existed was a futures contract, except a symbol
  // with no exchange multiplier, which is a share-like instrument.
  return instrument.pointValue === 1 && instrument.tickSize === 0.01 ? 'stock' : 'future';
}

/** How a stock's size is counted, so a form can say "shares" rather than "contracts". */
export function sizeUnit(instrument: Instrument | undefined): string {
  return instrumentKind(instrument) === 'stock' ? 'shares' : 'contracts';
}

/** One point's worth, in dollars, for a single unit. */
export function pointValueOf(instrument: Instrument | undefined): number {
  const value = instrument?.pointValue;
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 1;
}

/** The dollar value of one tick, derived from the spec rather than trusted from the form. */
export function tickValueOf(instrument: Instrument | undefined): number {
  const tick = instrument?.tickSize;
  const pointValue = pointValueOf(instrument);
  if (!Number.isFinite(tick) || (tick as number) <= 0) return pointValue * 0.01;
  return Math.round(pointValue * (tick as number) * 1e6) / 1e6;
}

/**
 * The neutral instrument an unknown symbol resolves to.
 *
 * One dollar a point and a cent a tick, which is share arithmetic: a quantity of shares moving
 * a dollar makes a dollar. It is `active: false` because it is not part of the trader's
 * catalog and must not start appearing in pickers. The symbol is carried through so the record
 * still names what was traded — that, and a visible note, is what stops an unrecognised import
 * from being quietly re-priced as a contract it is not.
 */
export function unknownInstrument(symbolOrId: string): Instrument {
  const symbol = (symbolOrId || 'CUSTOM').trim().toUpperCase() || 'CUSTOM';
  return {
    id: symbol.toLowerCase(),
    symbol,
    name: `${symbol} (not in the catalog)`,
    kind: 'custom',
    pointValue: 1,
    tickSize: 0.01,
    tickValue: 0.01,
    active: false,
  };
}

/**
 * Resolves a stored instrument id or symbol to its catalog entry.
 *
 * Falls back to `unknownInstrument` rather than MES: an unrecognised id means the catalog no
 * longer holds that contract, and pricing its trades as something else would change money the
 * trader has already read. Callers that need to know whether the lookup succeeded can compare
 * `resolved.active` or use `tryFindInstrument`.
 */
export function findInstrument(instruments: Instrument[], symbolOrId: string): Instrument {
  return tryFindInstrument(instruments, symbolOrId) ?? unknownInstrument(symbolOrId);
}

/** The catalog entry for an id or symbol, or null when the catalog does not hold it. */
export function tryFindInstrument(
  instruments: Instrument[],
  symbolOrId: string
): Instrument | null {
  if (!symbolOrId) return null;
  const key = symbolOrId.trim().toLowerCase();
  const match = instruments.find(
    (instrument) =>
      instrument.id.trim().toLowerCase() === key ||
      instrument.symbol.trim().toLowerCase() === key
  );
  return match ?? null;
}

/**
 * Display symbol for a trade's stored instrument id (e.g. 'mes' -> 'MES').
 *
 * Does NOT fall back to the focus contract: labelling an unknown instrument as MES is exactly
 * the kind of silent lie that makes a journal untrustworthy. Unknown ids are shown uppercased.
 */
export function instrumentSymbol(instruments: Instrument[], instrumentId?: string): string {
  if (!instrumentId) return '—';
  const match = tryFindInstrument(instruments, instrumentId);
  return match ? match.symbol : instrumentId.toUpperCase();
}

/**
 * Resolves a broker contract month code to a journal instrument.
 *
 * Broker exports name the full contract — "MESZ5", "MESU6", "ESZ5" — so we match on the
 * longest instrument symbol that the contract starts with, so a contract is never read as the
 * shorter symbol it happens to begin with. A trailing month code is not required: some exports
 * give the bare root, and that is a match too.
 */
export function findInstrumentByContract(
  instruments: Instrument[],
  contract: string
): Instrument | undefined {
  if (!contract) return undefined;
  const upper = contract.trim().toUpperCase();

  const exact = instruments.find(
    (instrument) =>
      instrument.symbol.toUpperCase() === upper || instrument.id.toUpperCase() === upper
  );
  if (exact) return exact;

  const prefixed = instruments
    .filter((instrument) => upper.startsWith(instrument.symbol.toUpperCase()))
    .sort((a, b) => b.symbol.length - a.symbol.length);

  return prefixed[0];
}

/** The symbol as the form stores it: trimmed, uppercased, and safe as an id. */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Cleans a draft from the instrument editor into something worth saving.
 *
 * The editor is the trader's own catalog, so this does not second-guess their spec — it only
 * makes the record well formed. Tick value is recomputed from the two numbers that define it,
 * and an id is derived from the symbol when the draft is new, so the same contract cannot be
 * entered twice under different spellings of its id.
 */
export function normalizeInstrument(draft: Instrument): Instrument {
  const symbol = normalizeSymbol(draft.symbol);
  const pointValue = Number(draft.pointValue);
  const tickSize = Number(draft.tickSize);
  const safePointValue = Number.isFinite(pointValue) && pointValue > 0 ? pointValue : 1;
  const safeTickSize = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
  return {
    ...draft,
    id: (draft.id || id(symbol)).trim().toLowerCase(),
    symbol,
    name: draft.name.trim() || symbol,
    kind: draft.kind ?? 'custom',
    pointValue: safePointValue,
    tickSize: safeTickSize,
    tickValue: Math.round(safePointValue * safeTickSize * 1e6) / 1e6,
    active: draft.active !== false,
  };
}

/**
 * What is wrong with a draft, or null when it can be saved.
 *
 * `others` is the rest of the catalog, so a duplicate symbol and a duplicate id are caught here
 * rather than at the picker, where two identical entries would be indistinguishable. The edited
 * instrument excludes itself by id.
 */
export function instrumentProblem(
  draft: Instrument,
  others: Instrument[]
): string | null {
  const symbol = normalizeSymbol(draft.symbol);
  if (!symbol) return 'A symbol is required.';
  if (!/^[A-Z0-9._=^/-]{1,12}$/.test(symbol)) {
    return 'Use 1–12 characters: letters, numbers, or . = ^ / -.';
  }
  if (!draft.name.trim()) return 'A name is required.';
  if (!Number.isFinite(Number(draft.pointValue)) || Number(draft.pointValue) <= 0) {
    return 'Dollar value per point must be greater than zero.';
  }
  if (!Number.isFinite(Number(draft.tickSize)) || Number(draft.tickSize) <= 0) {
    return 'Tick size must be greater than zero.';
  }

  const clash = others.find(
    (other) =>
      other.id !== draft.id &&
      (other.symbol.trim().toUpperCase() === symbol ||
        other.id.trim().toLowerCase() === id(symbol))
  );
  if (clash) return `${symbol} is already in the catalog.`;

  return null;
}

/**
 * The kinds the editor offers, with the arithmetic each starts from.
 *
 * A stock is one dollar a point per share; a forex pair in this app is a futures contract on
 * that pair, which is why it starts from the same shape as a future. The note is what the
 * editor shows under the choice, so the trader knows what "point value" will mean before they
 * type a number.
 */
export const INSTRUMENT_KINDS: ReadonlyArray<{
  kind: InstrumentKind;
  label: string;
  note: string;
  pointValue: number;
  tickSize: number;
}> = [
  {
    kind: 'future',
    label: 'Futures contract',
    note: 'Point value is dollars per point for one contract — ES is $50, MES is $5.',
    pointValue: 5,
    tickSize: 0.25,
  },
  {
    kind: 'stock',
    label: 'Stock or ETF',
    note: 'One point is one dollar per share, so size is the number of shares.',
    pointValue: 1,
    tickSize: 0.01,
  },
  {
    kind: 'forex',
    label: 'Forex future',
    note: 'Point value is dollars per point for one contract, as the exchange lists it.',
    pointValue: 62500,
    tickSize: 0.0001,
  },
  {
    kind: 'crypto',
    label: 'Crypto future',
    note: 'Point value is dollars per point for one contract, as the exchange lists it.',
    pointValue: 5,
    tickSize: 5,
  },
  {
    kind: 'custom',
    label: 'Something else',
    note: 'Any instrument: set dollars per point and tick size from your own contract spec.',
    pointValue: 1,
    tickSize: 0.01,
  },
];

/**
 * A starting draft for the editor, from a kind's own defaults.
 *
 * The symbol is left blank on purpose: prefilling it with `MES` is how a stock ends up saved
 * under a futures symbol.
 */
export function draftInstrument(kind: InstrumentKind = 'future'): Instrument {
  const spec = INSTRUMENT_KINDS.find((entry) => entry.kind === kind) ?? INSTRUMENT_KINDS[0];
  return {
    id: '',
    symbol: '',
    name: '',
    kind: spec.kind,
    pointValue: spec.pointValue,
    tickSize: spec.tickSize,
    tickValue: Math.round(spec.pointValue * spec.tickSize * 1e6) / 1e6,
    active: true,
  };
}
