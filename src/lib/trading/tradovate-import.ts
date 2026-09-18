import { Trade, TradeDirection, Instrument } from '../../types';
import { DEFAULT_INSTRUMENTS, findInstrumentByContract } from './instruments';

export interface TradovateFill {
  timestamp: string;
  contract: string;
  action: 'Buy' | 'Sell';
  quantity: number;
  price: number;
  orderId?: string;
}

/** What an import actually did, surfaced in the Settings UI. */
export interface CsvImportSummary {
  imported: number;
  errors: string[];
  warnings: string[];
}

export interface DetectedColumns {
  time?: string;
  contract?: string;
  action?: string;
  quantity?: string;
  price?: string;
}

export interface ParsedTradovateResult {
  trades: Partial<Trade>[];
  unmatchedFills: TradovateFill[];
  errors: string[];
  warnings: string[];
  /** Headers actually used, so the UI can explain a mis-detected file. */
  detectedColumns: DetectedColumns;
  /** Data rows that were not fills (blank price/time) and were ignored. */
  skippedRows: number;
}

/** Placeholder stop distance for imported trades — the file has no stop data. */
const PLACEHOLDER_STOP_POINTS = 10;

/**
 * Splits CSV text into rows of fields.
 *
 * This is quote-aware on purpose: broker exports contain values with commas
 * inside double quotes ("Micro E-mini S&P 500", account names, thousand
 * separators). A naive `split(',')` shifts every later column, which is how a
 * perfectly good price ends up read from the wrong field.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines so row numbers in messages stay meaningful.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Header cell -> comparable token: lowercase, no spaces/underscores/punctuation. */
const normalizeHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '')
    .replace(/[^a-z0-9/]/g, '');

const exactIndex = (headers: string[], names: string[]) =>
  headers.findIndex((h) => names.includes(h));

const includeIndex = (headers: string[], terms: string[]) =>
  headers.findIndex((h) => terms.some((t) => h.includes(t)));

function firstIndex(...candidates: number[]): number {
  for (const idx of candidates) {
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Finds the *fill* price column.
 *
 * Order books export both an order/limit "Price" and a "Fill Price". The order
 * price is blank on market orders, so reading it produces "invalid price" for
 * exactly those rows — the bug this preference order fixes.
 */
function findPriceColumn(headers: string[]): number {
  return firstIndex(
    exactIndex(headers, [
      'fillprice',
      'filledprice',
      'avgfillprice',
      'averagefillprice',
      'executionprice',
      'execprice',
      'avgprice',
    ]),
    includeIndex(headers, ['fillprice', 'filledprice', 'executionprice', 'execprice']),
    includeIndex(headers, ['fill']),
    exactIndex(headers, ['price', 'lastprice', 'tradeprice']),
    includeIndex(headers, ['price'])
  );
}

function findTimeColumn(headers: string[]): number {
  return firstIndex(
    exactIndex(headers, [
      'filltime',
      'filledtime',
      'timestamp',
      'datetime',
      'date/time',
      'time',
      'date',
    ]),
    includeIndex(headers, ['filltime', 'filledtime', 'timestamp', 'datetime', 'date']),
    includeIndex(headers, ['time'])
  );
}

function findActionColumn(headers: string[]): number {
  return firstIndex(
    exactIndex(headers, ['b/s', 'action', 'side', 'buysell', 'buysellindicator']),
    includeIndex(headers, ['b/s', 'action']),
    includeIndex(headers, ['side', 'direction'])
  );
}

function findQuantityColumn(headers: string[]): number {
  return firstIndex(
    exactIndex(headers, ['filledqty', 'fillqty', 'qty', 'quantity', 'size', 'contracts']),
    includeIndex(headers, ['filledqty', 'fillqty', 'qty', 'quantity', 'filled']),
    includeIndex(headers, ['size', 'contracts'])
  );
}

function findContractColumn(headers: string[]): number {
  return firstIndex(
    exactIndex(headers, ['contract', 'symbol', 'instrument', 'product']),
    includeIndex(headers, ['contract', 'symbol', 'instrument']),
    includeIndex(headers, ['product'])
  );
}

const parseNumber = (raw: string): number => {
  if (!raw) return NaN;
  // Some exports write "1,234.50" or "(1,234.50)" - strip noise before parsing.
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return NaN;
  return parseFloat(cleaned);
};

const parseTimestamp = (raw: string): number => {
  if (!raw) return NaN;
  const direct = new Date(raw).getTime();
  if (!isNaN(direct)) return direct;
  // "2024-05-23 09:31:00" is not valid ISO; try swapping in a "T" separator.
  const isoish = raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  return new Date(isoish).getTime();
};

/**
 * Parses a broker fills/orders CSV export into journal trades.
 *
 * Handles brokers that export the whole order book (empty fill rows are skipped
 * rather than reported as errors) and matches partial fills into a single
 * position, including scale-ins and scale-outs.
 */
export function parseTradovateCSV(
  csvContent: string,
  instruments: Instrument[] = DEFAULT_INSTRUMENTS
): ParsedTradovateResult {
  const empty: ParsedTradovateResult = {
    trades: [],
    unmatchedFills: [],
    errors: [],
    warnings: [],
    detectedColumns: {},
    skippedRows: 0,
  };

  const rows = parseCsvRows(csvContent);
  if (rows.length < 2) {
    return { ...empty, errors: ['CSV file is empty or missing a header row.'] };
  }

  const headerCells = rows[0].map((h) => h.trim());
  const headers = headerCells.map(normalizeHeader);

  const timeIdx = findTimeColumn(headers);
  const contractIdx = findContractColumn(headers);
  const actionIdx = findActionColumn(headers);
  const qtyIdx = findQuantityColumn(headers);
  const priceIdx = findPriceColumn(headers);

  const detectedColumns: DetectedColumns = {
    time: timeIdx !== -1 ? headerCells[timeIdx] : undefined,
    contract: contractIdx !== -1 ? headerCells[contractIdx] : undefined,
    action: actionIdx !== -1 ? headerCells[actionIdx] : undefined,
    quantity: qtyIdx !== -1 ? headerCells[qtyIdx] : undefined,
    price: priceIdx !== -1 ? headerCells[priceIdx] : undefined,
  };

  const missing: string[] = [];
  if (timeIdx === -1) missing.push('a time/date column');
  if (actionIdx === -1) missing.push('an action/side (Buy/Sell) column');
  if (priceIdx === -1) missing.push('a price column');

  if (missing.length > 0) {
    return {
      ...empty,
      detectedColumns,
      errors: [
        `Could not find ${missing.join(', ')} in the CSV header. Headers found: ${headerCells
          .slice(0, 8)
          .join(', ')}${headerCells.length > 8 ? '…' : ''}`,
      ],
    };
  }

  const fills: Array<TradovateFill & { rowNumber: number }> = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].map((c) => c.trim());
    const rowNumber = i + 1;
    const timeStr = cols[timeIdx] || '';
    const priceRaw = cols[priceIdx] ?? '';
    const price = parseNumber(priceRaw);

    // An order-book export contains rows that never filled: no fill price.
    // Skip them silently; they are not a parsing failure.
    if (!priceRaw || isNaN(price)) {
      skippedRows++;
      continue;
    }

    const actionRaw = (cols[actionIdx] || '').toLowerCase();
    if (!actionRaw) {
      skippedRows++;
      continue;
    }
    const action: 'Buy' | 'Sell' =
      actionRaw.startsWith('b') || actionRaw.includes('buy') ? 'Buy' : 'Sell';

    const contract = contractIdx !== -1 ? cols[contractIdx] || '' : '';
    const qty = qtyIdx !== -1 ? Math.abs(parseInt(cols[qtyIdx], 10)) : 1;

    fills.push({
      timestamp: timeStr,
      contract,
      action,
      quantity: !isNaN(qty) && qty > 0 ? qty : 1,
      price,
      rowNumber,
    });
  }

  if (fills.length === 0) {
    return {
      ...empty,
      detectedColumns,
      skippedRows,
      errors: [
        skippedRows > 0
          ? `No filled orders found — all ${skippedRows} rows had a blank ${detectedColumns.price}. This looks like an unfilled order list rather than a fills export.`
          : 'No usable fill rows found in the CSV.',
      ],
      warnings,
    };
  }

  // Sort chronologically only when every timestamp parses; otherwise trust the
  // file order rather than scrambling the trades.
  const parsedTimes = fills.map((f) => parseTimestamp(f.timestamp));
  if (parsedTimes.every((t) => !isNaN(t))) {
    const order = fills.map((_, idx) => idx);
    order.sort((a, b) => {
      const diff = parsedTimes[a] - parsedTimes[b];
      return diff !== 0 ? diff : a - b;
    });
    const sorted = order.map((idx) => fills[idx]);
    fills.length = 0;
    fills.push(...sorted);
  } else {
    warnings.push(
      'Some timestamps could not be read, so trades were kept in the order they appear in the file.'
    );
  }

  if (contractIdx === -1) {
    warnings.push(
      'No contract/symbol column found — every trade was imported as MES. Check the instrument on each trade.'
    );
  }

  // ---------------------------------------------------------------------------
  // Match fills into positions
  // ---------------------------------------------------------------------------
  interface OpenPosition {
    positionId: string;
    direction: TradeDirection;
    weightedEntry: number;
    contracts: number;
    entryTime: string;
    instrument: ReturnType<typeof findInstrumentByContract>;
  }

  const batchId = Math.random().toString(36).slice(2, 8);
  let positionCounter = 0;
  let open: OpenPosition | null = null;

  const trades: Partial<Trade>[] = [];
  const unmatchedFills: TradovateFill[] = [];

  /** Builds a fresh open position from a fill (a factory, not a mutator, so the
   *  compiler can see every assignment to `open`). */
  const startPosition = (
    fill: TradovateFill,
    direction: TradeDirection,
    quantity: number
  ): OpenPosition => {
    positionCounter++;
    return {
      positionId: `import-${batchId}-${positionCounter}`,
      direction,
      weightedEntry: fill.price * quantity,
      contracts: quantity,
      entryTime: fill.timestamp,
      instrument: findInstrumentByContract(instruments, fill.contract) || instruments[0],
    };
  };

  for (const fill of fills) {
    const isBuy = fill.action === 'Buy';

    if (open === null) {
      open = startPosition(fill, isBuy ? 'long' : 'short', fill.quantity);
      continue;
    }

    const instrument = open.instrument;
    const pointValue = instrument?.pointValue ?? 5;
    const isClosing =
      (open.direction === 'long' && !isBuy) || (open.direction === 'short' && isBuy);

    if (!isClosing) {
      // Scale-in: improve the average entry.
      open.weightedEntry += fill.price * fill.quantity;
      open.contracts += fill.quantity;
      continue;
    }

    // Closing fill — may only close part of the position (a scale-out).
    const closingQty = Math.min(fill.quantity, open.contracts);
    const averageEntry = open.weightedEntry / open.contracts;
    const points =
      open.direction === 'long' ? fill.price - averageEntry : averageEntry - fill.price;
    const grossPnL = Math.round(points * pointValue * closingQty * 100) / 100;
    const placeholderRisk =
      Math.round(PLACEHOLDER_STOP_POINTS * pointValue * closingQty * 100) / 100;

    trades.push({
      positionId: open.positionId,
      instrumentId: instrument?.id ?? 'mes',
      direction: open.direction,
      entryPrice: Math.round(averageEntry * 100) / 100,
      exitPrice: fill.price,
      entryTime: open.entryTime,
      exitTime: fill.timestamp,
      contracts: closingQty,
      pointsPnL: Math.round(points * 100) / 100,
      grossPnL,
      status: 'closed',
      session: 'Regular Session',
      initialRisk: placeholderRisk,
      rMultiple: placeholderRisk > 0 ? Math.round((grossPnL / placeholderRisk) * 100) / 100 : 0,
      initialStop:
        open.direction === 'long'
          ? Math.round((averageEntry - PLACEHOLDER_STOP_POINTS) * 100) / 100
          : Math.round((averageEntry + PLACEHOLDER_STOP_POINTS) * 100) / 100,
    });

    // Keep the unfilled remainder of the position open.
    open.weightedEntry -= averageEntry * closingQty;
    open.contracts -= closingQty;

    if (open.contracts <= 0) {
      open = null;
    }

    // A closing fill larger than the position flips direction.
    const overflow = fill.quantity - closingQty;
    if (overflow > 0) {
      open = startPosition(fill, isBuy ? 'long' : 'short', overflow);
    }
  }

  // Whatever is still open becomes an open trade.
  if (open) {
    const instrument = open.instrument;
    const pointValue = instrument?.pointValue ?? 5;
    const averageEntry = open.weightedEntry / open.contracts;
    const placeholderRisk =
      Math.round(PLACEHOLDER_STOP_POINTS * pointValue * open.contracts * 100) / 100;

    trades.push({
      positionId: open.positionId,
      instrumentId: instrument?.id ?? 'mes',
      direction: open.direction,
      entryPrice: Math.round(averageEntry * 100) / 100,
      entryTime: open.entryTime,
      contracts: open.contracts,
      status: 'open',
      session: 'Regular Session',
      initialRisk: placeholderRisk,
      initialStop:
        open.direction === 'long'
          ? Math.round((averageEntry - PLACEHOLDER_STOP_POINTS) * 100) / 100
          : Math.round((averageEntry + PLACEHOLDER_STOP_POINTS) * 100) / 100,
      grossPnL: 0,
      pointsPnL: 0,
      rMultiple: 0,
    });

    unmatchedFills.push({
      timestamp: open.entryTime,
      contract: instrument?.symbol ?? 'MES',
      action: open.direction === 'long' ? 'Buy' : 'Sell',
      quantity: open.contracts,
      price: Math.round(averageEntry * 100) / 100,
    });
  }

  if (skippedRows > 0) {
    warnings.push(
      `${skippedRows} row${skippedRows === 1 ? '' : 's'} had no fill price and were skipped (unfilled orders are normal in an orders export).`
    );
  }

  warnings.push(
    `Imported trades get a placeholder ${PLACEHOLDER_STOP_POINTS}-point stop and matching risk, because the CSV has no stop data. Edit any trade to set its real stop.`
  );

  return { trades, unmatchedFills, errors, warnings, detectedColumns, skippedRows };
}
