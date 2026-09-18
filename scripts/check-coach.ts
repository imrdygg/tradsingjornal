/**
 * Temporary diagnostic: invokes the deployed-shape coach handler in-process so the
 * server code and the API key can be verified without a deployment.
 */
import 'dotenv/config';
import handler from '../src/api/coach';
import { buildJournalDigest } from '../src/lib/ai/journal-digest';
import { DEFAULT_INSTRUMENTS } from '../src/lib/trading/instruments';
import { Trade, TradingDay } from '../src/types';

const key = process.env.GEMINI_API_KEY ?? '';
console.log(
  `GEMINI_API_KEY: ${key ? `present (${key.length} chars, starts "${key.slice(0, 4)}...")` : 'MISSING'}`
);
console.log(`GEMINI_MODEL: ${process.env.GEMINI_MODEL ?? '(default gemini-flash-latest)'}`);

const day: TradingDay = {
  id: 'd1',
  userId: 'u1',
  tradeDate: '2026-09-18',
  status: 'active',
  riskMode: 'normal',
  normalLossLimit: 100,
  plannedLossLimit: 100,
  contractsPlanned: 2,
  primaryInstrument: 'MES',
  allowedSessions: ['Regular Session'],
  marketBias: 'bullish',
  watchedSetups: ['Breakout'],
  importantLevels: [],
  waitingFor: 'Retest of the open',
    stayOutIf: 'Chop inside the prior range',
  planChanges: [],
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-18T12:00:00.000Z',
};

const trade: Trade = {
  id: 't1',
  userId: 'u1',
  tradingDayId: 'd1',
  instrumentId: 'mes',
  source: 'manual',
  direction: 'long',
  contracts: 2,
  entryPrice: 7730,
  initialStop: 7720,
  exitPrice: 7740,
  entryTime: '2026-09-18T13:30:00.000Z',
  exitTime: '2026-09-18T14:00:00.000Z',
  session: 'Regular Session',
  setupName: 'Breakout',
  entryReason: 'Reclaim of the overnight low after the retest held.',
  initialRisk: 100,
  grossPnL: 100,
  netPnL: 96,
  pointsPnL: 10,
  rMultiple: 1,
  status: 'closed',
  createdAt: '2026-09-18T13:30:00.000Z',
  updatedAt: '2026-09-18T14:00:00.000Z',
};

const digest = buildJournalDigest({
  trades: [trade],
  tradingDays: [day],
  reviews: [],
  setups: [],
  instruments: DEFAULT_INSTRUMENTS,
  todayTradeDate: '2026-09-18',
});

let statusCode = 0;
let payload: unknown = null;

const res = {
  status(code: number) {
    statusCode = code;
    return res;
  },
  json(body: unknown) {
    payload = body;
  },
  setHeader() {
    /* no headers needed */
  },
};

async function main() {
  await handler(
    { method: 'POST', body: { mode: 'brief', digest } } as never,
    res as never
  );
  console.log(`\nHTTP status from the handler: ${statusCode}`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error('Handler threw:', err);
  process.exit(1);
});
