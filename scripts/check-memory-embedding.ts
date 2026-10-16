/**
 * Diagnostic: makes real embedding calls in-process, so the model name, the output size and the wire
 * contract can be verified without a deployment or a signed-in session.
 *
 * It calls the endpoint's own `embedChartParts` rather than the handler on purpose. The handler's
 * gates are in front of that function — a signed-in session and a per-caller limit — and a local
 * script has neither a session to present nor a reason to be counted against one. The gating is what
 * the deployed `GET /api/memory` health check is for; this is for the half of the pipeline that a
 * health check cannot reach: that the model answers, that it answers at the width the vector column
 * holds, and that two different charts do not come back as the same picture.
 *
 * Two calls, one per chart, because the cap is one picture per request: the model aggregates several
 * inputs into a SINGLE embedding, so sending both would return one vector for the pair.
 *
 * Run it with `npm run verify:memory`.
 */
import { config } from 'dotenv';
import { embedChartParts } from '../src/api/memory';
import { toCoachImagePart } from '../src/lib/ai/coach-images';
import {
  MEMORY_EMBEDDING_DIMENSION,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from '../src/lib/memory/embeddings';
import { pngDataUrl } from './png';

// Both files, because the key belongs in `.env.local` on a workstation (the file `.gitignore`
// covers) while `verify:coach`'s own instructions name the same one — and a diagnostic that cannot
// see the key it just told you to set is worse than no diagnostic.
config({ path: ['.env.local', '.env'], quiet: true });

const WIDTH = 320;
const HEIGHT = 200;

/**
 * Whether a value is a placeholder rather than a key.
 *
 * This exists because of a trap that is easy to fall into: `vercel env pull` cannot decrypt a
 * Sensitive variable, so it writes the literal string `[SENSITIVE]` into `.env.local`. Sent to
 * Google that returns "API key not valid", which reads as a broken key and sends the reader to the
 * Vercel dashboard for a key that is perfectly fine. The failure belongs to the file, and saying so
 * is the difference between a five-second fix and an afternoon.
 */
function looksLikeAPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value) || /^MY_/.test(value) || /^</.test(value);
}

/**
 * A single-panel line chart of the given closes, drawn from scratch so the check needs no asset.
 *
 * Deterministic, so repeated runs ask the model about the same picture and a diff between two runs
 * means the provider changed rather than that the fixture did.
 */
function chartDataUrl(closes: readonly number[]): string {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };

  // Background, then a faint grid, then the line: something chart-shaped rather than a blank panel.
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) setPixel(x, y, 16, 17, 20);
  }
  for (let i = 1; i < 5; i += 1) {
    const y = Math.round((HEIGHT / 5) * i);
    for (let x = 0; x < WIDTH; x += 1) setPixel(x, y, 32, 34, 38);
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const slot = WIDTH / Math.max(1, closes.length - 1);
  closes.forEach((close, index) => {
    const x = Math.round(slot * index);
    const y = Math.round(HEIGHT - 12 - ((close - min) / span) * (HEIGHT - 24));
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) setPixel(x + dx, y + dy, 34, 197, 94);
    }
  });

  return pngDataUrl(WIDTH, HEIGHT, rgba);
}

/** A decline into a low, a reclaim that holds, then a grind higher. */
const UP_SERIES = [
  104, 103, 102, 101, 100, 99, 98, 96, 95, 94, 94.5, 95.5, 96.5, 97.5, 97, 96.5, 97, 98, 99, 100,
  101, 102.5, 104, 105.5, 107, 108.5,
];

/**
 * The same picture mirrored around its own midpoint: the same prices in the opposite order.
 *
 * Not a random second chart, and not a different chart either. The point is that the two differ in
 * exactly the way the embedding is supposed to notice — direction — so a model that returned the
 * same vector for both would be caught, while a check that used two unrelated pictures would pass on
 * a model that is merely sensitive to brightness.
 */
const DOWN_SERIES = UP_SERIES.map((value) => 104 + 108.5 - value);

/** Reads a data URL back as a PNG and reports its dimensions, so a fixture cannot be a claim. */
function readPng(dataUrl: string, label: string): { width: number; height: number } {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error(`${label} is not a data URL.`);
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error(`${label} is not a PNG.`);
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`${label} has no IHDR chunk.`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Cosine similarity, which is the metric the index and the resemblance score are built on. */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? Number.NaN : dot / denominator;
}

async function main() {
  const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
  console.log(`GEMINI_API_KEY: ${apiKey ? `present (${apiKey.length} characters)` : 'MISSING'}`);
  console.log(
    `Embedding: ${MEMORY_EMBEDDING_MODEL} v${MEMORY_EMBEDDING_VERSION}, ` +
      `${MEMORY_EMBEDDING_DIMENSION} dimensions`
  );

  // The pictures are built and checked BEFORE the key, because a fixture that cannot be drawn would
  // otherwise be reported as a provider failure and send the reader looking in the wrong place.
  const charts = { up: chartDataUrl(UP_SERIES), down: chartDataUrl(DOWN_SERIES) };
  const up = readPng(charts.up, 'the up chart');
  const down = readPng(charts.down, 'the down chart');
  console.log(
    `Charts: ${up.width}x${up.height} and ${down.width}x${down.height}, ` +
      `${charts.up.length} and ${charts.down.length} characters of data URL`
  );
  if (charts.up === charts.down) {
    throw new Error('The two charts are identical, so the comparison below would prove nothing.');
  }

  if (!apiKey || looksLikeAPlaceholder(apiKey)) {
    console.error(
      apiKey
        ? `\nGEMINI_API_KEY is the placeholder ${apiKey} — that is what \`vercel env pull\` writes ` +
          'for a Sensitive variable, because it cannot decrypt one. There is no key in this file, ' +
          'so nothing was embedded. Put the real key in .env.local by hand (never VITE_-prefixed — ' +
          'that would publish it in the browser bundle), or check the embedding through the ' +
          'deployed endpoint, whose GET already reports whether it can see one.'
        : '\nGEMINI_API_KEY is not set, so nothing was embedded. Put it in .env.local (never ' +
          'VITE_-prefixed), then re-run.'
    );
    process.exit(1);
  }

  // Not a failure: a plausible-looking key is still the provider's to judge, and this check exists
  // to report what the provider says. But a short value and an `API_KEY_INVALID` below are one
  // story, and saying so up front saves reading them as two.
  if (apiKey.length < 30) {
    console.warn(
      `GEMINI_API_KEY is only ${apiKey.length} characters, and a Google API key is longer than ` +
        'that. If the call below answers API_KEY_INVALID, that is why.'
    );
  }

  const problems: string[] = [];
  const vectors: number[][] = [];

  for (const [label, dataUrl] of [
    ['up', charts.up],
    ['down', charts.down],
  ] as const) {
    // The endpoint's own reader, so the picture is accepted or refused exactly as the handler would
    // accept or refuse it.
    const part = toCoachImagePart({ label, dataUrl });
    if (!part) {
      problems.push(`the ${label} chart was refused as an inline image before anything was sent`);
      continue;
    }

    const outcome = await embedChartParts(apiKey, [part]);
    if (!outcome.ok) {
      problems.push(`${label}: ${outcome.code} — ${outcome.message} (${outcome.detail})`);
      continue;
    }

    const vector = outcome.results[0]?.embedding ?? [];
    console.log(
      `[${label}] ${vector.length} dimensions, first three: ` +
        vector
          .slice(0, 3)
          .map((value) => value.toFixed(4))
          .join(', ')
    );
    if (vector.length !== MEMORY_EMBEDDING_DIMENSION) {
      problems.push(
        `the ${label} chart came back with ${vector.length} dimensions, and this build stores ` +
          `${MEMORY_EMBEDDING_DIMENSION} — the column in supabase/schema.sql is vector(${MEMORY_EMBEDDING_DIMENSION})`
      );
    }
    vectors.push(vector);
  }

  if (problems.length === 0 && vectors.length === 2) {
    const similarity = cosineSimilarity(vectors[0], vectors[1]);
    console.log(`Cosine similarity between the two charts: ${similarity.toFixed(4)}`);
    // Two charts of the same prices in opposite order must not come back alike. If they do, the
    // pipeline is storing something close to a constant, and every search would return the library
    // in creation order while reporting a resemblance for each row.
    if (!Number.isFinite(similarity) || similarity > 0.999) {
      problems.push(
        `the two charts came back ${similarity.toFixed(4)} alike, which is close enough to identical ` +
          'that the vectors carry no picture'
      );
    }
  }

  if (problems.length > 0) {
    console.error('\n✗ Memory embedding verification FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log('\n✓ One real embedding per chart, at the width this build stores.');
}

main().catch((err) => {
  console.error('The check threw:', err);
  process.exit(1);
});
