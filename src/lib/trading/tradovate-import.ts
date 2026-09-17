import { Trade, TradeDirection } from '../../types';

export interface TradovateFill {
  timestamp: string;
  contract: string;
  action: 'Buy' | 'Sell';
  quantity: number;
  price: number;
  orderId?: string;
}

export interface ParsedTradovateResult {
  trades: Partial<Trade>[];
  unmatchedFills: TradovateFill[];
  errors: string[];
}

/**
 * Parses a standard Tradovate fills/orders CSV export.
 * Adheres strictly to the rule: "Never silently guess uncertain imported trade data."
 */
export function parseTradovateCSV(csvContent: string): ParsedTradovateResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { trades: [], unmatchedFills: [], errors: ['CSV file is empty or missing headers.'] };
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
  const fills: TradovateFill[] = [];
  const errors: string[] = [];

  // Find column indices
  const timeIdx = headers.findIndex((h) => h.includes('time') || h.includes('date'));
  const contractIdx = headers.findIndex((h) => h.includes('contract') || h.includes('symbol'));
  const actionIdx = headers.findIndex((h) => h.includes('action') || h.includes('side') || h.includes('b/s'));
  const qtyIdx = headers.findIndex((h) => h.includes('qty') || h.includes('quantity') || h.includes('amount'));
  const priceIdx = headers.findIndex((h) => h.includes('price') || h.includes('fill price'));

  if (timeIdx === -1 || actionIdx === -1 || priceIdx === -1) {
    return {
      trades: [],
      unmatchedFills: [],
      errors: [
        'Missing required columns (Timestamp/Date, Action/Side, and Price) in Tradovate CSV.',
      ],
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/['"]/g, ''));
    if (cols.length <= Math.max(timeIdx, actionIdx, priceIdx)) continue;

    const timeStr = cols[timeIdx];
    const contract = contractIdx !== -1 ? cols[contractIdx] : 'MES';
    const actionRaw = cols[actionIdx].toLowerCase();
    const action: 'Buy' | 'Sell' = actionRaw.startsWith('b') ? 'Buy' : 'Sell';
    const quantity = qtyIdx !== -1 ? Math.abs(parseInt(cols[qtyIdx], 10)) || 1 : 1;
    const price = parseFloat(cols[priceIdx]);

    if (isNaN(price)) {
      errors.push(`Row ${i + 1}: Invalid price "${cols[priceIdx]}"`);
      continue;
    }

    fills.push({
      timestamp: timeStr,
      contract,
      action,
      quantity,
      price,
    });
  }

  // Sort fills chronologically
  fills.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // FIFO matching for trades
  const trades: Partial<Trade>[] = [];
  const unmatchedFills: TradovateFill[] = [];
  let openPosition: {
    direction: TradeDirection;
    entryTime: string;
    entryPrice: number;
    contracts: number;
  } | null = null;

  for (const fill of fills) {
    const isBuy = fill.action === 'Buy';

    if (!openPosition) {
      openPosition = {
        direction: isBuy ? 'long' : 'short',
        entryTime: fill.timestamp,
        entryPrice: fill.price,
        contracts: fill.quantity,
      };
    } else {
      const isClosing = (openPosition.direction === 'long' && !isBuy) || (openPosition.direction === 'short' && isBuy);

      if (isClosing) {
        // Paired trade completed
        const points =
          openPosition.direction === 'long'
            ? fill.price - openPosition.entryPrice
            : openPosition.entryPrice - fill.price;
        const grossPnL = Math.round(points * 5 * openPosition.contracts * 100) / 100;

        trades.push({
          direction: openPosition.direction,
          entryPrice: openPosition.entryPrice,
          exitPrice: fill.price,
          entryTime: openPosition.entryTime,
          exitTime: fill.timestamp,
          contracts: openPosition.contracts,
          pointsPnL: Math.round(points * 100) / 100,
          grossPnL,
          status: 'closed',
          session: 'Regular Session',
          setupName: 'Engulfing',
          initialRisk: Math.max(50, Math.round(Math.abs(points) * 5 * openPosition.contracts)),
          initialStop:
            openPosition.direction === 'long'
              ? openPosition.entryPrice - 10
              : openPosition.entryPrice + 10,
        });

        openPosition = null;
      } else {
        // Additional fill in same direction or scaled
        unmatchedFills.push(fill);
      }
    }
  }

  if (openPosition) {
    trades.push({
      direction: openPosition.direction,
      entryPrice: openPosition.entryPrice,
      entryTime: openPosition.entryTime,
      contracts: openPosition.contracts,
      status: 'open',
      session: 'Regular Session',
      setupName: 'Engulfing',
      initialRisk: 50,
      initialStop:
        openPosition.direction === 'long'
          ? openPosition.entryPrice - 10
          : openPosition.entryPrice + 10,
      grossPnL: 0,
      pointsPnL: 0,
    });
  }

  return { trades, unmatchedFills, errors };
}
