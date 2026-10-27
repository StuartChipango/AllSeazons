// End-to-end: staff add photos -> review -> shop -> WhatsApp checkout -> paid -> sticker.
// Needs local Postgres and PostgREST (see tests/harness/server.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { startHarness } from './harness/server.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const photo = (n) => fileURLToPath(new URL(`./fixtures/photos/${n}`, import.meta.url));
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let h, browser, staff, shopper;
const errors = [];

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

function watch(page) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return page;
}

before(async () => {
  h = await startHarness();
  browser = await playwright.chromium.launch();
  staff = watch(await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage());
  shopper = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage());
});
after(async () => {
  await browser?.close();
  await h?.stop();
});

test('staff sign in', async () => {
  await staff.goto(`${h.url}/staff/`);
  await staff.fill('input[name=email]', h.staff.email);
  await staff.fill('input[name=password]', 'wrong');
  await staff.click('#loginForm button[type=submit]');
  await staff.getByText('That email and password do not match.').waitFor();
  await staff.fill('input[name=password]', h.staff.password);
  await staff.click('#loginForm button[type=submit]');
  await staff.getByRole('heading', { name: 'Home' }).waitFor();
});

test('photos become framed toys waiting for review', async () => {
  await staff.goto(`${h.url}/staff/#upload`);
  await staff.getByRole('button', { name: 'K75', exact: true }).click();
  await staff.setInputFiles('#files', [photo('toy1.jpg'), photo('toy2.jpg'), photo('toy3.jpg')]);
  await staff.getByText('3 of 3 ready').waitFor({ timeout: 30000 });
  await shot(staff, '01-upload');
  await staff.click('text=Review them');
  await staff.locator('.rcard').first().waitFor();
  assert.equal(await staff.locator('.rcard').count(), 3);
  const names = await staff.locator('.rcard [data-f=name]').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(names.sort(), ['Red Race Car', 'Stacking Blocks Set', 'Teddy Bear']);
  await shot(staff, '02-review');
});

test('fixing a label redraws the picture', async () => {
  const card = staff.locator('.rcard', { has: staff.locator('[data-f=name][value="Teddy Bear"]') });
  const before = await card.locator('.pic img').getAttribute('src');
  await card.locator('[data-f=name]').fill('Big Brown Teddy');
  await card.locator('[data-f=name]').press('Tab');
  const updated = staff.locator('.rcard', { has: staff.locator('[data-f=name][value="Big Brown Teddy"]') });
  await updated.waitFor();
  await updated.getByRole('button', { name: 'Girls' }).click();
  await staff.waitForFunction(() => [...document.querySelectorAll('.rcard')].some((c) =>
    c.querySelector('[data-f=name]')?.value === 'Big Brown Teddy' && c.querySelector('[data-seg=audience][data-value=girls]')?.getAttribute('aria-pressed') === 'true' && !c.querySelector('.working')));
  const after = await staff.locator('.rcard', { has: staff.locator('[data-f=name][value="Big Brown Teddy"]') }).locator('.pic img').getAttribute('src');
  assert.notEqual(before, after);
});

test('approve all puts the toys in the shop', async () => {
  await staff.getByRole('button', { name: /Approve all 3/ }).click();
  await staff.getByText('Nothing waiting for review.').waitFor();
  await shopper.goto(`${h.url}/`);
  await shopper.locator('.card').first().waitFor();
  assert.equal(await shopper.locator('.card').count(), 3);
  await shopper.waitForFunction(() => [...document.querySelectorAll('.card .pic img')].every((i) => i.complete && i.naturalWidth === 1080));
  await shot(shopper, '03-shop');
  await shopper.getByRole('button', { name: 'Boys' }).click();
  assert.equal(await shopper.locator('.card').count(), 1);
  await shopper.getByRole('button', { name: 'Everyone' }).click();
});

let waUrl = '';
test('checkout sends a labelled order to WhatsApp and holds the toys', async () => {
  await shopper.route('https://wa.me/**', (route) => { waUrl = route.request().url(); route.fulfill({ body: 'WhatsApp' }); });
  await shopper.locator('.card', { hasText: 'Big Brown Teddy' }).getByRole('button', { name: 'Add to cart' }).click();
  await shopper.locator('.card', { hasText: 'Red Race Car' }).getByRole('button', { name: 'Add to cart' }).click();
  assert.equal(await shopper.locator('#cartCount').textContent(), '2');
  await shopper.click('#cartBtn');
  await shopper.getByRole('button', { name: 'Continue to checkout' }).click();
  await shopper.fill('#checkout [name=name]', 'Mwila Phiri');
  await shopper.fill('#checkout [name=phone]', '0966 000 111');
  // Yango needs an address.
  await shopper.getByRole('button', { name: 'Yango delivery' }).click();
  await shopper.getByRole('button', { name: 'Checkout on WhatsApp' }).click();
  await shopper.getByText('Please enter your delivery address.').waitFor();
  await shopper.getByRole('button', { name: 'Out of town' }).click();
  await shopper.selectOption('#checkout [name=town_id]', { label: 'Kitwe' });
  await shopper.getByText(/Medium parcel \(2 items\)/).waitFor();
  await shopper.fill('#checkout [name=address]', 'Collect at Mazhandu Kitwe');
  await shot(shopper, '04-checkout');
  await shopper.getByRole('button', { name: 'Checkout on WhatsApp' }).click();
  await shopper.getByText('Almost done!').waitFor();
  await shot(shopper, '05-done');
  await shopper.waitForURL('https://wa.me/**', { timeout: 5000 });
  const u = new URL(waUrl);
  assert.equal(u.pathname, '/260977000111');
  const msg = u.searchParams.get('text');
  assert.match(msg, /\*NEW ORDER ORD-1001\*/);
  assert.match(msg, /Big Brown Teddy \(AS-\d+\) - Used - K75/);
  assert.match(msg, /Red Race Car \(AS-\d+\) - Used - K75/);
  assert.match(msg, /\*Delivery:\* Courier to Kitwe via Mazhandu, medium parcel - K90/);
  assert.match(msg, /\*TOTAL TO PAY:\* K240/);
  assert.match(msg, /\*Name:\* Mwila Phiri/);
  assert.match(msg, /\*Address:\* Collect at Mazhandu Kitwe/);
  const pictures = msg.match(/Pictures of my toys:\* (\S+)/)[1];

  await shopper.goto(pictures);
  await shopper.getByRole('heading', { name: 'Order ORD-1001' }).waitFor();
  assert.equal(await shopper.locator('.item img').count(), 2);
  assert.equal(await shopper.getByText('Mwila').count(), 0, 'no personal details on the public page');
  await shot(shopper, '06-order-page');

  await shopper.goto(`${h.url}/`);
  await shopper.locator('.card.is-hold').first().waitFor();
  assert.equal(await shopper.locator('.card.is-hold').count(), 2);
});

test('staff mark the order paid and print the sticker', async () => {
  await staff.goto(`${h.url}/staff/#orders`);
  const card = staff.locator('.order', { hasText: 'ORD-1001' });
  await card.waitFor();
  await shot(staff, '07-orders');
  await card.getByRole('button', { name: 'Mark paid' }).click();
  await staff.getByText('ORD-1001: Paid').waitFor();
  await staff.getByRole('button', { name: /To pack/ }).click();
  const paid = staff.locator('.order', { hasText: 'ORD-1001' });
  const [sticker] = await Promise.all([
    staff.context().waitForEvent('page'),
    paid.getByRole('link', { name: 'Print sticker' }).click(),
  ]);
  await sticker.locator('.label').waitFor();
  const text = await sticker.locator('.label').innerText();
  assert.match(text, /Mwila Phiri/);
  assert.match(text, /KITWE/i);
  assert.match(text, /Mazhandu/);
  assert.match(text, /Collect at Mazhandu Kitwe/);
  if (SHOTS) await sticker.screenshot({ path: `${SHOTS}/08-sticker.png` });
  await sticker.close();

  await shopper.reload();
  await shopper.getByRole('tab', { name: /Sold/ }).click();
  await shopper.locator('.card.is-sold').first().waitFor();
  assert.equal(await shopper.locator('.card.is-sold').count(), 2);
  await shot(shopper, '09-sold');
});

test('editing a toy later redraws its frame from the original photo', async () => {
  await staff.goto(`${h.url}/staff/#stock`);
  await staff.reload();
  const row = staff.locator('.item-row', { hasText: 'Stacking Blocks Set' });
  await row.click();
  const before = await staff.locator('dialog.panel .preview').getAttribute('src');
  await staff.locator('dialog.panel').getByRole('button', { name: 'Used', exact: true }).click();
  await staff.locator('dialog.panel').getByRole('button', { name: 'Save' }).click();
  await staff.getByText('Saved').waitFor();
  await row.click();
  const after = await staff.locator('dialog.panel .preview').getAttribute('src');
  assert.notEqual(before, after);
  await staff.waitForFunction(() => document.querySelector('dialog.panel .preview')?.naturalWidth === 1080);
  await staff.locator('dialog.panel [data-close-panel]').click();
});

test('a walk-in sale takes the last toy off the website', async () => {
  await staff.goto(`${h.url}/staff/#stock`);
  const row = staff.locator('.item-row', { hasText: 'Stacking Blocks Set' });
  await row.waitFor();
  await row.locator('input[type=checkbox]').check();
  await staff.getByRole('button', { name: 'Sell in shop' }).click();
  await staff.getByRole('button', { name: 'Record sale' }).click();
  await staff.getByText(/Sale ORD-\d+ recorded: K75/).waitFor();
  await shopper.goto(`${h.url}/`);
  await shopper.getByText('No toys match').waitFor();
});

test('staff home shows the week and what sells', async () => {
  await staff.goto(`${h.url}/staff/#home`);
  await staff.getByText('Sales this week').waitFor();
  await staff.getByText('K315').waitFor();
  await shot(staff, '10-home');
});

test('a Claude pack adds named toys without the AI', async () => {
  await staff.goto(`${h.url}/staff/#upload`);
  await staff.getByRole('button', { name: 'K50', exact: true }).click();
  await staff.setInputFiles('#pack', [fileURLToPath(new URL('./fixtures/claude-pack.zip', import.meta.url))]);
  await staff.getByText('2 photos named by Claude.').waitFor();
  await staff.getByText('2 of 2 ready').waitFor({ timeout: 30000 });
  await shot(staff, '11-pack');
  await staff.goto(`${h.url}/staff/#review`);
  const pony = staff.locator('.rcard', { has: staff.locator('[data-f=name][value="Pink Pony Stable"]') });
  const tractor = staff.locator('.rcard', { has: staff.locator('[data-f=name][value="Green Tractor"]') });
  await pony.waitFor();
  await tractor.waitFor();
  assert.equal(await pony.locator('[data-seg=audience][data-value=girls]').getAttribute('aria-pressed'), 'true');
  assert.equal(await pony.locator('[data-f=tagline]').inputValue(), 'With Pony');
  assert.equal(await tractor.locator('[data-seg=condition][data-value=new]').getAttribute('aria-pressed'), 'true');
  const prices = await staff.locator('.rcard [data-f=price]').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(prices.sort(), ['100', '50']);
  await pony.locator('.pic img').evaluate((i) => i.complete || new Promise((r) => { i.onload = r; }));
  assert.equal(await pony.locator('.pic img').evaluate((i) => i.naturalWidth), 1080);
});

test('no browser errors along the way', () => {
  assert.deepEqual(errors, []);
});
