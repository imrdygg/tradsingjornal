/**
 * Diagnostic: makes one real chartread call in-process, exactly as the endpoint would —
 * fetch the daily bars, build the prompt, run the model chain — so a Markets-tab coach
 * failure can be reproduced without a deployment. The chartread counterpart of
 * scripts/check-coach.ts, which covers the default brief mode.
 */
import 'dotenv/config';
import { runCoachModels } from '../src/api/coach';
import { buildJournalDigest } from '../src/lib/ai/journal-digest';
import { DEFAULT_INSTRUMENTS } from '../src/lib/trading/instruments';
import { Trade, TradingDay } from '../src/types';

const key = process.env.GEMINI_API_KEY ?? '';
if (!key) {
  console.error('GEMINI_API_KEY missing');
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
  // Same order the handler does it: validate extras, fetch the bars, run the models.
  const extras = { instrument: 'GC' };
  const { getDailyBars } = await import('../src/lib/ai/market-data');
  const chartSeries = await getDailyBars(extras.instrument);
  console.log(
    `daily bars: ok=${chartSeries.ok} bars=${chartSeries.bars.length} yahoo=${chartSeries.yahooSymbol} note=${chartSeries.note ?? '—'}`
  );

  const outcome = await runCoachModels({
    apiKey: key,
    mode: 'chartread',
    digest,
    extras: { ...extras, chartSeries },
  });
  console.log(`\nStatus the endpoint would return: ${outcome.status}`);
  console.log(JSON.stringify(outcome.body, null, 2).slice(0, 3000));
}

main().catch((err) => {
  console.error('Handler threw:', err);
  process.exit(1);
});
