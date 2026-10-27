// Draws every toy in a Claude pack exactly as the staff app will (same
// frame.js, frames and fonts), so the owner can see the pictures first.
//
//   node tools/preview_pack.mjs pack.zip out-folder
//
// Writes out-folder/001.jpg ... and out-folder/sheet.jpg (all of them).
// Needs Chromium with Playwright (require('playwright')).
import http from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const [zipPath, outDir] = process.argv.slice(2);
if (!zipPath || !outDir) {
  console.error('Usage: node tools/preview_pack.mjs pack.zip out-folder');
  process.exit(1);
}
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(tmpdir(), `pack-preview-${process.pid}`);
await mkdir(work, { recursive: true });
execSync(`python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "${zipPath}" "${work}"`);

const types = { '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.csv': 'text/csv', '.html': 'text/html' };
const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.startsWith('/pack/') ? join(work, path.slice(6)) : path === '/' ? null : join(root, path);
  try {
    const body = file ? await readFile(file) : Buffer.from('<!doctype html><title>preview</title>');
    res.writeHead(200, { 'Content-Type': file ? types[extname(file)] || 'application/octet-stream' : 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await playwright.chromium.launch();
const page = await browser.newPage();
await page.goto(base + '/');
const results = await page.evaluate(async () => {
  const { parseCsv, packLabels } = await import('/assets/js/lib.js');
  const { renderFrame, loadBitmap } = await import('/assets/js/frame.js');
  const csv = await (await fetch('/pack/labels.csv')).text();
  const rows = parseCsv(csv);
  const labels = packLabels(rows);
  const load = async (name) => {
    const r = await fetch('/pack/' + name);
    return r.ok ? loadBitmap(await r.blob()) : null;
  };
  const out = [];
  for (const row of rows) {
    const file = row.file;
    const key = file.replace(/\.[^.]+$/, '').toLowerCase();
    const l = labels.get(key);
    const image = await load(file);
    const cutout = await load(`${key}-cut.png`);
    const plate = await load(`${key}-plate.jpg`);
    const canvas = await renderFrame({ image, cutout: cutout && plate ? cutout : null, plate: cutout && plate ? plate : null,
      name: l.name, tagline: l.tagline, audience: l.audience, condition: l.condition, focus: l.focus });
    out.push({ key, data: canvas.toDataURL('image/jpeg', 0.9) });
  }
  // Contact sheet, three across.
  const cols = Math.min(3, out.length);
  const rowsN = Math.ceil(out.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * 540;
  sheet.height = rowsN * 540;
  const g = sheet.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < out.length; i++) {
    const img = new Image();
    img.src = out[i].data;
    await img.decode();
    g.drawImage(img, (i % cols) * 540, Math.floor(i / cols) * 540, 540, 540);
  }
  out.push({ key: 'sheet', data: sheet.toDataURL('image/jpeg', 0.88) });
  return out;
});
await browser.close();
server.close();
await mkdir(outDir, { recursive: true });
for (const r of results) await writeFile(join(outDir, `${r.key}.jpg`), Buffer.from(r.data.split(',')[1], 'base64'));
await rm(work, { recursive: true, force: true });
console.log(`${outDir}: ${results.length - 1} pictures + sheet.jpg`);
