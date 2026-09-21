/**
 * Diagnostic: makes one real coach call in-process so the prompt, the API key and the
 * model chain can be verified without a deployment.
 *
 * It calls `runCoachModels` rather than the handler on purpose. The access gates live in
 * front of that function (a signed-in session and a per-caller limit), and a local script
 * has neither a session to present nor a reason to be counted against one. Gating is
 * covered by the endpoint's unit tests and by the deployed GET health check.
 */
import 'dotenv/config';
import { runCoachModels } from '../src/api/coach';
import { buildJournalDigest } from '../src/lib/ai/journal-digest';
import { DEFAULT_INSTRUMENTS } from '../src/lib/trading/instruments';
import { Trade, TradingDay } from '../src/types';

const key = process.env.GEMINI_API_KEY ?? '';
console.log(
  `GEMINI_API_KEY: ${key ? `present (${key.length} chars, starts "${key.slice(0, 4)}...")` : 'MISSING'}`
);
console.log(`GEMINI_MODEL: ${process.env.GEMINI_MODEL ?? '(unset — the built-in chain is tried)'}`);

if (!key) {
  console.error(
    '\nGEMINI_API_KEY is missing. Put it in .env.local (never VITE_-prefixed), then re-run.'
  );
  process.exit(1);
}

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
  timezone: 'America/New_York',
});

async function main() {
  const outcome = await runCoachModels({ apiKey: key, mode: 'brief', digest });
  console.log(`\nStatus the endpoint would return: ${outcome.status}`);
  console.log(JSON.stringify(outcome.body, null, 2));
}

main().catch((err) => {
  console.error('Handler threw:', err);
  process.exit(1);
});
