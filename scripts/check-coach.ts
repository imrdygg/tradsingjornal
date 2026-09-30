/**
 * Diagnostic: makes real coach calls in-process so the prompt, the API key and the model
 * chain can be verified without a deployment.
 *
 * It calls `runCoachModels` rather than the handler on purpose. The access gates live in
 * front of that function (a signed-in session and a per-caller limit), and a local script
 * has neither a session to present nor a reason to be counted against one. Gating is
 * covered by the endpoint's unit tests and by the deployed GET health check.
 *
 * Two calls are made. `brief` proves the plain text path. `match` proves the picture search
 * — the one path that carries images, parses a scored match list and is the hardest to catch
 * a regression in from the outside. It runs against a chart generated here, so the check
 * needs nothing but the API key.
 */
import 'dotenv/config';
import { deflateSync } from 'node:zlib';
import { runCoachModels } from '../src/api/coach';
import { buildJournalDigest, FULL_HISTORY_TRADE_SAMPLES } from '../src/lib/ai/journal-digest';
import { toCoachImagePart } from '../src/lib/ai/coach-images';
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

/**
 * The label the picture search pins to the uploaded chart. Kept in step with
 * `QUERY_LABEL` in the chart-match card — the model is told by name which picture the
 * question is about, so the two must agree.
 */
const QUERY_LABEL = 'THE CHART THE TRADER IS ASKING ABOUT';

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

/** A second closed trade, so a match has more than one row to choose between. */
const tradeTwo: Trade = {
  ...trade,
  id: 't2',
  tradingDayId: 'd1',
  direction: 'long',
  entryPrice: 7712,
  initialStop: 7702,
  exitPrice: 7730,
  setupName: 'Breakout',
  entryReason: 'Second reclaim of the same low, entered on the higher low.',
  netPnL: 86,
  grossPnL: 90,
  pointsPnL: 18,
  rMultiple: 1.8,
  entryTime: '2026-09-18T15:30:00.000Z',
  exitTime: '2026-09-18T16:10:00.000Z',
};

const digest = buildJournalDigest({
  trades: [trade, tradeTwo],
  tradingDays: [day],
  reviews: [],
  setups: [],
  instruments: DEFAULT_INSTRUMENTS,
  todayTradeDate: '2026-09-18',
  timezone: 'America/New_York',
  // The picture search reads the whole record, exactly as the card does.
  tradeSampleLimit: FULL_HISTORY_TRADE_SAMPLES,
});

// ---------------------------------------------------------------------------
// A chart to search with.
//
// The repo holds no chart image and no raster library, so one is drawn here: a small
// candlestick chart shaped like the trade above — a decline into a low, a reclaim, a
// retest that holds, then a grind higher. It is deterministic, so repeated runs ask the
// model about the same picture. A PNG encoder is ~40 lines and keeps the check free of a
// dependency, which matters more than the picture being pretty.
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // no per-scanline filter
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draws the synthetic chart and returns it as a data URL the coach will accept. */
function buildChartDataUrl(): string {
  const width = 360;
  const height = 240;
  const margin = 18;
  const rgba = Buffer.alloc(width * height * 4);
  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPixel(x, y, r, g, b);
  };
  const vline = (x: number, y0: number, y1: number, r: number, g: number, b: number) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) setPixel(x, y, r, g, b);
  };

  // Background and a faint grid, so it reads as a chart rather than a blank panel.
  fillRect(0, 0, width - 1, height - 1, 16, 17, 20);
  for (let i = 1; i < 6; i++) {
    const y = Math.round((height / 6) * i);
    for (let x = 0; x < width; x++) setPixel(x, y, 32, 34, 38);
  }

  // A decline into a low, a reclaim, a retest that holds, then a grind higher.
  const closes = [
    104, 103.2, 102.4, 101.6, 100.6, 99.6, 98.6, 97.6, 96.6, 95.6, 94.8, 94.2, 94.6, 95.4, 96.2,
    97.0, 97.8, 97.4, 96.9, 96.5, 96.8, 97.4, 98.0, 98.6, 99.2, 99.8, 100.4, 101.0, 101.8, 102.8,
    103.8, 104.8, 105.8, 106.8, 107.8, 108.8,
  ];
  const candles = closes.map((close, index) => {
    const open = index === 0 ? 104.6 : closes[index - 1];
    const wiggle = 0.35 + (index % 3) * 0.15;
    return {
      open,
      close,
      high: Math.max(open, close) + wiggle,
      low: Math.min(open, close) - wiggle,
    };
  });

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const maxP = Math.max(...highs) + 0.6;
  const minP = Math.min(...lows) - 0.6;
  const yFor = (price: number) =>
    Math.round(margin + ((maxP - price) / (maxP - minP)) * (height - margin * 2));

  const slot = (width - margin * 2) / candles.length;
  const bodyWidth = Math.max(2, Math.round(slot * 0.6));
  candles.forEach((candle, index) => {
    const cx = Math.round(margin + slot * index + slot / 2);
    const up = candle.close >= candle.open;
    const r = up ? 34 : 239;
    const g = up ? 197 : 68;
    const b = up ? 94 : 68;
    vline(cx, yFor(candle.high), yFor(candle.low), r, g, b);
    const top = yFor(Math.max(candle.open, candle.close));
    const bottom = yFor(Math.min(candle.open, candle.close));
    fillRect(cx - Math.floor(bodyWidth / 2), top, cx - Math.floor(bodyWidth / 2) + bodyWidth - 1, Math.max(top, bottom), r, g, b);
  });

  return `data:image/png;base64,${encodePng(width, height, rgba).toString('base64')}`;
}

/** The shape a parsed match response must have for the picture search to be usable. */
function checkMatchShape(data: unknown): string[] {
  const problems: string[] = [];
  if (!data || typeof data !== 'object') return ['the response was not an object'];
  const body = data as Record<string, unknown>;
  if (typeof body.patternRead !== 'string' || !body.patternRead.trim()) {
    problems.push('patternRead was missing or empty');
  }
  if (!Array.isArray(body.matches)) {
    problems.push('matches was not an array');
    return problems;
  }
  (body.matches as unknown[]).forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      problems.push(`match ${index} was not an object`);
      return;
    }
    const match = item as Record<string, unknown>;
    if (!match.date || !match.symbol || !match.direction) {
      problems.push(`match ${index} was missing date, symbol or direction`);
    }
    if (typeof match.score !== 'number' || match.score < 0 || match.score > 100) {
      problems.push(`match ${index} had a score outside 0-100 (${String(match.score)})`);
    }
  });
  return problems;
}

async function main() {
  // ---- The plain text path ----
  const brief = await runCoachModels({ apiKey: key, mode: 'brief', digest });
  console.log(`\n[brief] Status the endpoint would return: ${brief.status}`);
  console.log(JSON.stringify(brief.body, null, 2));

  // ---- The picture search ----
  const dataUrl = buildChartDataUrl();
  const image = toCoachImagePart({ label: QUERY_LABEL, dataUrl });
  if (!image) throw new Error('The synthetic chart was rejected as an image.');
  console.log(
    `\n[match] chart image: ${image.mimeType}, ${image.data.length.toLocaleString()} base64 chars`
  );

  const match = await runCoachModels({
    apiKey: key,
    mode: 'match',
    digest,
    extras: { imageLabels: [QUERY_LABEL] },
    imageParts: [image],
  });
  console.log(`[match] Status the endpoint would return: ${match.status}`);
  console.log(JSON.stringify(match.body, null, 2));

  const problems: string[] = [];
  if (brief.status !== 200) problems.push(`brief returned ${brief.status}`);
  if (match.status !== 200) {
    problems.push(`match returned ${match.status}`);
  } else {
    const body = match.body as { data?: unknown };
    problems.push(...checkMatchShape(body.data));
  }

  if (problems.length) {
    console.error('\n✗ Coach verification FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('\n✓ brief and match both answered and parsed.');
}

main().catch((err) => {
  console.error('Handler threw:', err);
  process.exit(1);
});
