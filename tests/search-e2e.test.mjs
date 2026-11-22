// Search boxes in a real browser: typing never reloads, and the search runs on
// Search / Enter or when the box is left. Needs local Postgres and PostgREST
// (see tests/harness/server.mjs). SHOTS=dir saves phone screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, copyFileSync } from 'node:fs';
import pg from 'pg';
import { startHarness } from './harness/server.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const STORE = fileURLToPath(new URL('./.storage/toys/', import.meta.url));
const TOYS = [
  ['Teddy Bear', 'Soft Toys', 'neutral', null],
  ['Pink Bunny Plushie', 'Soft Toys', 'girls', null],
  ['Red Toy Car', 'Cars & Vehicles', 'boys', 'Hot Wheels'],
  ['Yellow Dump Truck', 'Cars & Vehicles', 'boys', null],
  ['Toy Train Set', 'Cars & Vehicles', 'boys', null],
  ['Dinosaur Toy', 'Action Figures', 'boys', null],
  ['Card Game', 'Puzzles & Games', 'neutral', null],
  ['Barbie Fashion Doll', 'Dolls & Accessories', 'girls', 'Mattel'],
  ['Wooden Blocks', 'Building & Blocks', 'neutral', null],
  ['Football', 'Outdoor & Sports', 'boys', null],
];
let h, browser, shop, staff;
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

before(async () => {
  h = await startHarness();
  mkdirSync(STORE, { recursive: true });
  const db = new pg.Client({ connectionString: h.dbUrl });
  await db.connect();
  for (const [i, [name, category, audience, brand]] of TOYS.entries()) {
    copyFileSync(fileURLToPath(new URL(`./fixtures/photos/toy${(i % 3) + 1}.jpg`, import.meta.url)), `${STORE}s${i}.jpg`);
    await db.query(`insert into toys (name, category, audience, brand, price, status, image_path, photo_path)
      values ($1, $2, $3, $4, $5, 'available', $6, $6)`, [name, category, audience, brand, 50 + i * 10, `s${i}.jpg`]);
  }
  await db.end();
  browser = await playwright.chromium.launch();
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 };
  shop = watch(await (await browser.newContext(phone)).newPage());
  staff = watch(await (await browser.newContext(phone)).newPage());
});
after(async () => {
  await browser?.close();
  await h?.stop();
});

const names = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));

test('shop: typing does not reload, spaces and backspace are kept', async () => {
  await shop.goto(`${h.url}/`);
  await shop.locator('.card').first().waitFor();
  const before = await names(shop, '.sec-head h2');
  await shop.locator('#search').tap();
  await shop.locator('#search').pressSequentially('teddy bxx ', { delay: 40 });
  await shop.keyboard.press('Backspace');
  await shop.keyboard.press('Backspace');
  await shop.keyboard.press('Backspace');
  await shop.locator('#search').pressSequentially('ear ', { delay: 40 });
  await shop.waitForTimeout(600);
  assert.equal(await shop.locator('#search').inputValue(), 'teddy bear ');
  assert.deepEqual(await names(shop, '.sec-head h2'), before, 'nothing reloaded while typing');
  await shot(shop, '1-shop-typing');
  await shop.keyboard.press('Enter');
  await shop.getByRole('heading', { name: /Results for “teddy bear”/ }).waitFor();
  assert.equal((await names(shop, '.card .name'))[0], 'Teddy Bear');
});

test('shop: spelling slips and related words, with the Search button', async () => {
  await shop.locator('#search').fill('dinasour');
  await shop.locator('#searchGo').tap();
  await shop.getByRole('heading', { name: /Results for “dinasour”/ }).waitFor();
  assert.equal((await names(shop, '.card .name'))[0], 'Dinosaur Toy');
  await shot(shop, '2-shop-typo');

  await shop.locator('#search').fill('vehicles');
  await shop.locator('#searchGo').tap();
  await shop.getByRole('heading', { name: /Results for “vehicles”/ }).waitFor();
  const v = await names(shop, '.card .name');
  for (const n of ['Red Toy Car', 'Yellow Dump Truck', 'Toy Train Set']) assert.ok(v.includes(n), n);
  assert.ok(!v.includes('Card Game'));
  await shot(shop, '3-shop-related');
});

test('shop: tapping out of the box searches', async () => {
  await shop.locator('#search').fill('');
  await shop.locator('#search').tap();
  await shop.locator('#search').pressSequentially('plushies', { delay: 30 });
  await shop.locator('.brand').evaluate((el) => el.closest('header').click());
  await shop.locator('#search').blur();
  await shop.getByRole('heading', { name: /Results for “plushies”/ }).waitFor();
  const v = await names(shop, '.card .name');
  assert.equal(v[0], 'Pink Bunny Plushie');
  assert.ok(v.includes('Teddy Bear'));
});

test('shop: clearing the box shows all toys again', async () => {
  await shop.locator('#search').fill('');
  await shop.locator('#search').blur();
  await shop.getByRole('heading', { name: /All toys/ }).waitFor();
});

test('staff Stock: typing does not reload; search on leaving the box', async () => {
  await staff.goto(`${h.url}/staff/`);
  await staff.fill('input[name=email]', h.staff.email);
  await staff.fill('input[name=password]', h.staff.password);
  await staff.click('#loginForm button[type=submit]');
  await staff.getByRole('heading', { name: 'Home' }).waitFor();
  await staff.goto(`${h.url}/staff/#stock`);
  await staff.locator('.item-row').first().waitFor();
  const count = await staff.locator('.item-row').count();
  assert.equal(count, TOYS.length);
  const box = staff.locator('#q');
  await box.tap();
  await box.pressSequentially('lorry ', { delay: 40 });
  await staff.waitForTimeout(600);
  assert.equal(await box.inputValue(), 'lorry ');
  assert.equal(await staff.locator('.item-row').count(), count, 'nothing reloaded while typing');
  await shot(staff, '4-stock-typing');
  await staff.keyboard.press('Enter');
  await staff.waitForFunction(() => document.querySelectorAll('.item-row').length < 10);
  assert.equal(await staff.locator('.item-row .nm').first().textContent(), 'Yellow Dump Truck');
  await shot(staff, '5-stock-results');
  // The box is not rebuilt, so the text is still there and still editable.
  assert.equal(await box.inputValue(), 'lorry ');
});

test('no page errors', () => {
  assert.deepEqual(errors, []);
});
