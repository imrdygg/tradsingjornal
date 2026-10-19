/**
 * Packages one standalone product for a digital store.
 *
 * Usage:
 *   npm run package:chart-patterns
 *   npm run package:mes
 *
 * The deliverable is the **built site**, not the source: the buyer unzips it, serves the
 * folder, and pastes a license key. The script refuses a missing build and verifies the zip
 * it wrote before exiting — a package that only works from the repository is not shippable.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

interface ProductManifest {
  id: string;
  displayName: string;
  version: string;
  licenseMode: string;
  buildDir: string;
  /** The HTML entry the product's Vite build emits. */
  buildHtml: string;
}

const productDir = process.argv[2] ?? 'products/chart-patterns';
const manifestPath = path.join(productDir, 'product.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`No product manifest at ${manifestPath}.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ProductManifest;
const buildDir = manifest.buildDir;
const sourceHtml = path.join(buildDir, manifest.buildHtml);
const assetsDir = path.join(buildDir, 'assets');

if (!fs.existsSync(sourceHtml) || !fs.existsSync(assetsDir)) {
  console.error(
    `No product build at ${buildDir} (expected ${manifest.buildHtml}). Build it before packaging.`
  );
  process.exit(1);
}

function addDirectory(zip: JSZip, directory: string, prefix: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) addDirectory(zip, full, name);
    else zip.file(name, fs.readFileSync(full));
  }
}

const zip = new JSZip();
// The build emits a product-named HTML file; a buyer should find `index.html`.
zip.file('index.html', fs.readFileSync(sourceHtml));
addDirectory(zip, assetsDir, 'assets');

const docs = fs
  .readdirSync(productDir)
  .filter((name) => /^(INSTALL\.md|LICENSE\.txt|README\.md)$/.test(name))
  .sort();
for (const doc of docs) {
  zip.file(doc, fs.readFileSync(path.join(productDir, doc)));
}

zip.file(
  'version.json',
  JSON.stringify(
    {
      id: manifest.id,
      name: manifest.displayName,
      version: manifest.version,
      licenseMode: manifest.licenseMode,
      builtAt: new Date().toISOString(),
    },
    null,
    2
  )
);

const releaseDir = path.join('release');
fs.mkdirSync(releaseDir, { recursive: true });
const outfile = path.join(releaseDir, `${manifest.id}-${manifest.version}.zip`);

const archive = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
fs.writeFileSync(outfile, archive);

// --- Verify the artifact rather than trusting the write -----------------------
const check = await JSZip.loadAsync(fs.readFileSync(outfile));
const names = Object.keys(check.files).sort();
const required = ['index.html', 'INSTALL.md', 'LICENSE.txt', 'README.md', 'version.json'];
for (const name of required) {
  if (!names.includes(name)) throw new Error(`Package is missing ${name}`);
}
if (!names.some((name) => /^assets\/.+\.js$/.test(name))) {
  throw new Error('Package carries no JavaScript asset');
}
if (!names.some((name) => /^assets\/.+\.css$/.test(name))) {
  throw new Error('Package carries no stylesheet');
}

const html = await check.file('index.html')!.async('string');
if (!/(\.\/)?assets\/[^"]+\.js/.test(html)) {
  throw new Error('index.html does not reference a built script relatively');
}
if (/src="\/src\//.test(html)) {
  throw new Error('index.html still points at the development entry');
}

const jsFiles = names.filter((name) => /^assets\/.+\.js$/.test(name));
for (const name of jsFiles) {
  const code = await check.file(name)!.async('string');
  if (/supabase/i.test(code) || /GEMINI_API_KEY/.test(code)) {
    throw new Error(`${name} contains a cloud/server dependency; the product must stay local`);
  }
}

const sizeMb = (archive.length / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${outfile} (${sizeMb} MB)`);
console.log(names.join('\n'));
