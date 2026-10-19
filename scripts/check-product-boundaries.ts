/**
 * Fails when a standalone product starts depending on the journal.
 *
 * Products may share presentation and pure logic — the modal shell, the license UI, the
 * feature they were extracted from — but must not import the journal's storage, AI, memory,
 * trading, analytics or Supabase layers, nor another product's feature. Each product's
 * `product.json` names the segments it is allowed to reach (`allowedSegments`).
 *
 * The built JavaScript is checked too, because a source-only rule cannot see a dependency
 * introduced through a shared component: no product may ship a cloud client or a key
 * reference.
 *
 * Run with `npm run check:boundaries`.
 */
import fs from 'node:fs';
import path from 'node:path';

interface ProductManifest {
  id: string;
  sourceDir: string;
  buildDir: string;
  allowedSegments: string[];
}

const FORBIDDEN_SEGMENTS = [
  '/lib/ai/',
  '/lib/analytics/',
  '/lib/history/',
  '/lib/journal/',
  '/lib/media/',
  '/lib/memory/',
  '/lib/mes/',
  '/lib/playbook/',
  '/lib/routine/',
  '/lib/search/',
  '/lib/storage/',
  '/lib/trading/',
  '/lib/supabase',
  '/components/analytics/',
  '/components/coach/',
  '/components/history/',
  '/components/layout/',
  '/components/markets/',
  '/components/memory/',
  '/components/mes/',
  '/components/playbook/',
  '/components/review/',
  '/components/settings/',
  '/components/today/',
  '/components/trades/',
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const productRoots = fs
  .readdirSync('products', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join('products', entry.name, 'product.json'))
  .filter((file) => fs.existsSync(file))
  .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as ProductManifest);

const failures: string[] = [];

for (const product of productRoots) {
  if (!fs.existsSync(product.sourceDir)) {
    failures.push(`${product.id}: source directory ${product.sourceDir} does not exist`);
    continue;
  }

  for (const file of walk(product.sourceDir).filter((name) => /\.(ts|tsx)$/.test(name))) {
    const source = fs.readFileSync(file, 'utf8');
    const specifiers = [
      ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier).replace(/\\/g, '/');
      const forbidden = FORBIDDEN_SEGMENTS.find(
        (segment) =>
          `${resolved}/`.includes(segment) &&
          !product.allowedSegments.some((allowed) => `${resolved}/`.includes(allowed))
      );
      if (forbidden) {
        failures.push(`${file} imports ${specifier} (${forbidden})`);
      }
    }
  }

  const assets = path.join(product.buildDir, 'assets');
  if (!fs.existsSync(assets)) {
    console.warn(`No build at ${assets}; checked ${product.id} source imports only.`);
    continue;
  }
  for (const file of fs.readdirSync(assets).filter((name) => name.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(assets, file), 'utf8');
    if (/supabase/i.test(code)) failures.push(`${product.id}: ${file} ships Supabase code`);
    if (/GEMINI_API_KEY/.test(code)) {
      failures.push(`${product.id}: ${file} ships a Gemini key reference`);
    }
  }
}

if (failures.length > 0) {
  console.error('Product boundary check failed:\n' + failures.map((line) => `  - ${line}`).join('\n'));
  process.exit(1);
}

console.log(`Product boundaries are clean (${productRoots.length} products).`);
