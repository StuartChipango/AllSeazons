// Draws every toy in a Claude pack exactly as the staff app will (same
// frame.js, frames, fonts and shop styles), so the owner can see it first.
//
//   node tools/preview_pack.mjs pack.zip out-folder
//
// Writes out-folder/001.jpg ... (framed social media pictures),
// out-folder/sheet.jpg (all of them) and out-folder/website.jpg (the toys
// as cards on the website, with their plain photos).
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

const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.woff2': 'font/woff2', '.csv': 'text/csv', '.html': 'text/html' };
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
  const { renderFrame, renderPhoto, loadBitmap } = await import('/assets/js/frame.js');
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
    out.push({ key, data: canvas.toDataURL('image/jpeg', 0.9),
      plain: renderPhoto({ image, plate: cutout && plate ? plate : null, focus: l.focus }).toDataURL('image/jpeg', 0.85), l });
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

  // Website cards, built like shop.js does.
  for (const css of ['/assets/css/base.css', '/assets/css/shop.css']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = css;
    document.head.append(link);
    await new Promise((r) => { link.onload = r; });
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  document.body.innerHTML = `<div class="wrap" style="padding-top:16px"><div class="grid" id="grid">${out.filter((o) => o.plain).map((o) => `
    <article class="card for-${esc(o.l.audience)}">
      <button class="pic"><span class="cond ${o.l.condition === 'new' ? 'new' : ''}">${o.l.condition === 'new' ? 'New' : 'Used'}</span>
        <img src="${o.plain}" alt=""></button>
      <div class="body"><div class="name">${esc(o.l.name)}</div>
        ${o.l.age_range ? `<div class="meta">${esc(o.l.age_range)} yrs</div>` : ''}
        <span class="price">${o.l.price ? `K${o.l.price}` : 'K —'}</span>
        <div class="actions"><button class="btn add">Add to cart</button></div></div>
    </article>`).join('')}</div></div>`;
  await Promise.all([...document.images].map((i) => i.decode()));
  await document.fonts.ready;
  return out.map(({ key, data }) => ({ key, data }));
});
await page.setViewportSize({ width: 1100, height: 800 });
const web = await page.locator('#grid').screenshot({ type: 'jpeg', quality: 88 });
results.push({ key: 'website', data: 'x,' + web.toString('base64') });
await browser.close();
server.close();
await mkdir(outDir, { recursive: true });
for (const r of results) await writeFile(join(outDir, `${r.key}.jpg`), Buffer.from(r.data.split(',')[1], 'base64'));
await rm(work, { recursive: true, force: true });
console.log(`${outDir}: ${results.length - 2} pictures + sheet.jpg + website.jpg`);
