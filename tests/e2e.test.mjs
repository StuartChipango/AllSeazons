// End-to-end: staff add photos -> review -> shop -> WhatsApp checkout -> paid -> sticker.
// Needs local Postgres and PostgREST (see tests/harness/server.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Most tests use the pretend online AI; one test below names on the device.
  await staffContext.addInitScript(() => { if (!localStorage.getItem('naming')) localStorage.setItem('naming', 'online'); });
  staff = watch(await staffContext.newPage());
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
  await staff.getByText('That sign-in name and password do not match.').waitFor();
  await staff.fill('input[name=password]', h.staff.password);
  await staff.click('#loginForm button[type=submit]');
  await staff.getByRole('heading', { name: 'Home' }).waitFor();
});

test('photos become framed toys waiting for review', async () => {
  await staff.goto(`${h.url}/staff/#upload`);
  await staff.getByRole('button', { name: 'K70', exact: true }).click();
  await staff.setInputFiles('#files', [photo('toy1.jpg'), photo('toy2.jpg'), photo('toy3.jpg')]);
  await staff.getByText('3 of 3 ready').waitFor({ timeout: 30000 });
  await shot(staff, '01-upload');
  await staff.click('#reviewGo');
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
  // Cards show a small copy of the plain photo (quick on phones); the framed
  // pictures are for social media.
  await shopper.waitForFunction(() => [...document.querySelectorAll('.card .pic img')].every((i) => i.complete && i.naturalWidth === 480));
  const srcs = await shopper.locator('.card .pic img').evaluateAll((els) => els.map((i) => i.src));
  assert.ok(srcs.every((src) => /\/thumb-\d+\.jpg$/.test(src)), srcs.join(' '));
  // Opening a toy shows the full-size plain photo.
  await shopper.locator('.card .pic').first().click();
  const full = shopper.locator('#toyDialog .gallery img').first();
  await full.waitFor();
  assert.match(await full.getAttribute('src'), /\/photo-\d+\.jpg$/);
  await shopper.keyboard.press('Escape');
  assert.equal(await shopper.locator('.card .cond').first().textContent(), 'Used');
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
  await shopper.fill('#checkout [name=name]', 'Mwila Phiri');
  await shopper.fill('#checkout [name=phone]', '0966 000 111');
  // Yango needs an address.
  await shopper.getByRole('button', { name: /Lusaka delivery/ }).click();
  await shopper.getByRole('button', { name: 'Send order on WhatsApp' }).click();
  await shopper.getByText('Please enter your delivery address.').waitFor();
  await shopper.getByRole('button', { name: /Out of town/ }).click();
  await shopper.selectOption('#checkout [name=town_id]', { label: 'Kitwe' });
  await shopper.getByText(/medium parcel/).waitFor();
  await shopper.getByText('Add a note or collection point').click();
  await shopper.fill('#checkout [name=address]', 'Collect at Mazhandu Kitwe');
  await shot(shopper, '04-checkout');
  await shopper.getByRole('button', { name: 'Send order on WhatsApp' }).click();
  await shopper.getByText('Almost done!').waitFor();
  await shot(shopper, '05-done');
  await shopper.waitForURL('https://wa.me/**', { timeout: 5000 });
  const u = new URL(waUrl);
  assert.equal(u.pathname, '/260977000111');
  const msg = u.searchParams.get('text');
  assert.match(msg, /\*NEW ORDER ORD-1001\*/);
  assert.match(msg, /Big Brown Teddy \(AS-\d+\) - Used - K70/);
  assert.match(msg, /Red Race Car \(AS-\d+\) - Used - K70/);
  assert.match(msg, /\*Delivery:\* Courier to Kitwe via Mazhandu, medium parcel - K130/);
  assert.match(msg, /\*TOTAL TO PAY:\* K270/);
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
  await staff.getByText(/Sale ORD-\d+ recorded: K70/).waitFor();
  await shopper.goto(`${h.url}/`);
  await shopper.getByText('No toys match').waitFor();
});

test('staff home shows the week and what sells', async () => {
  await staff.goto(`${h.url}/staff/#home`);
  await staff.getByText('Sales this week').waitFor();
  await staff.getByText('K340').waitFor();
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
  // The pack's cutout and focus box came through, so the toy can fill the frame.
  const pg = new (require('pg').Client)({ connectionString: h.dbUrl });
  await pg.connect();
  const ponyRow = await pg.query("select has_cutout, focus, photo_path, image_path from toys where name = 'Pink Pony Stable'");
  await pg.end();
  assert.equal(ponyRow.rows[0].has_cutout, true);
  assert.match(ponyRow.rows[0].photo_path, /\/photo-\d+\.jpg$/);
  assert.notEqual(ponyRow.rows[0].photo_path, ponyRow.rows[0].image_path);
  assert.equal(ponyRow.rows[0].focus.length, 4);
  assert.equal(await tractor.locator('[data-seg=condition][data-value=new]').getAttribute('aria-pressed'), 'true');
  const prices = await staff.locator('.rcard [data-f=price]').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(prices.sort(), ['100', '50']);
  await pony.locator('.pic img').evaluate((i) => i.complete || new Promise((r) => { i.onload = r; }));
  assert.equal(await pony.locator('.pic img').evaluate((i) => i.naturalWidth), 1080);
});

test('stock page downloads a social media pack of framed pictures', async () => {
  await staff.goto(`${h.url}/staff/#stock`);
  await staff.locator('#fStatus').selectOption('');
  await staff.locator('.item-row').first().waitFor();
  const [dl] = await Promise.all([staff.waitForEvent('download'), staff.locator('#socialPack').click()]);
  const file = await dl.path();
  const names = JSON.parse(execSync(`python3 -c "import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(z.namelist()))" ${file}`).toString());
  assert.ok(names.includes('captions.txt'));
  assert.ok(names.some((n) => /^001-.+\.jpg$/.test(n)), names.join(' '));
  const captions = execSync(`python3 -c "import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read('captions.txt').decode())" ${file}`).toString();
  assert.match(captions, /Order: http.+#/);
});

test('toys the AI could not name get another try', async () => {
  h.ai.down = true;
  await staff.goto(`${h.url}/staff/#upload`);
  await staff.setInputFiles('#files', [photo('toy1.jpg')]);
  await staff.getByText(/AI could not name it/).waitFor({ timeout: 30000 });
  h.ai.down = false;
  await staff.goto(`${h.url}/staff/#review`);
  const card = staff.locator('.rcard', { has: staff.getByRole('button', { name: 'Try AI again' }) });
  await card.waitFor();
  await staff.getByRole('button', { name: /Try AI again for 1/ }).click();
  await staff.locator('[data-act=ai]').waitFor({ state: 'detached', timeout: 30000 });
  assert.equal(await staff.locator('#aiAll').count(), 0);
  const names = await staff.locator('.rcard [data-f=name]').evaluateAll((els) => els.map((e) => e.value));
  assert.ok(!names.some((n) => /^toy1$|Unnamed/i.test(n)), names.join(', '));
});

// A stand-in for the picture-matching library: each prompt or photo becomes
// a vector of the keywords it contains, so a photo "of" a yellow teddy
// matches the teddy prompts and the yellow prompt.
const FAKE_RECOGNISER = `
const WORDS = ['teddy', 'saxophone', 'yellow', 'pink'];
const vec = (text) => WORDS.map((w) => (text.includes(w) ? 1 : 0));
const tensor = (rows) => ({ tolist: () => rows });
export const env = {};
export const RawImage = { fromBlob: async () => ({}) };
export const AutoProcessor = { from_pretrained: async () => async () => ({}) };
export const CLIPVisionModelWithProjection = { from_pretrained: async () => async () => ({ image_embeds: tensor([vec('teddy yellow')]) }) };
export const AutoTokenizer = { from_pretrained: async () => (prompts) => ({ prompts }) };
export const CLIPTextModelWithProjection = { from_pretrained: async () => async ({ prompts }) => ({ text_embeds: tensor(prompts.map(vec)) }) };
`;

test('toys are named on the device without any key', async () => {
  await staff.route('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1*', (route) => route.fulfill({
    body: FAKE_RECOGNISER, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
  }));
  h.ai.down = true; // the online AI is not used
  await staff.goto(`${h.url}/staff/#upload`);
  await staff.locator('#moreOpts').evaluate((d) => { d.open = true; });
  await staff.getByRole('button', { name: 'On this device (free)' }).click();
  await staff.setInputFiles('#files', [photo('toy2.jpg')]);
  await staff.getByText('Yellow Teddy Bear').first().waitFor({ timeout: 30000 });
  h.ai.down = false;
  const pg = new (require('pg').Client)({ connectionString: h.dbUrl });
  await pg.connect();
  const row = (await pg.query("select category, age_range, ai_labels from toys where name = 'Yellow Teddy Bear'")).rows[0];
  await pg.end();
  assert.equal(row.category, 'Soft Toys');
  assert.equal(row.age_range, '0-2');
  assert.equal(row.ai_labels.source, 'device');
  await staff.getByRole('button', { name: 'Online AI (needs a key)' }).click();
});

test('angles of one toy and its video become one toy with a gallery', async () => {
  // The stand-in recogniser sees every photo as the same toy.
  const dir = mkdtempSync(join(tmpdir(), 'angles-'));
  const second = join(dir, 'teddy-side.jpg');
  copyFileSync(photo('toy2.jpg'), second);
  const clip = join(dir, 'teddy.mp4');
  writeFileSync(clip, Buffer.from('not really a video'));
  await staff.goto(`${h.url}/staff/#upload`);
  await staff.locator('#moreOpts').evaluate((d) => { d.open = true; });
  await staff.getByRole('button', { name: 'Group them into one toy' }).click();
  await staff.setInputFiles('#files', [photo('toy2.jpg'), second, clip]);
  await staff.getByText(/^Video added to /).waitFor({ timeout: 30000 });
  await staff.getByText(/^Another angle of /).waitFor();

  const pg = new (require('pg').Client)({ connectionString: h.dbUrl });
  await pg.connect();
  const row = (await pg.query("select id, name, media from toys order by created_at desc limit 1")).rows[0];
  assert.deepEqual(row.media.map((m) => m.type), ['image', 'video']);
  await pg.query("update toys set status = 'available', approved_at = now() where id = $1", [row.id]);
  await pg.end();

  await shopper.goto(`${h.url}/`);
  await shopper.locator('.card', { hasText: row.name }).first().locator('.more').waitFor();
  assert.equal(await shopper.locator('.card', { hasText: row.name }).first().locator('.more').textContent(), '2 photos · ▶ video');
  await shopper.locator('.card', { hasText: row.name }).first().locator('.pic').click();
  await shopper.locator('#toyBody .gallery .thumbs button').first().waitFor();
  assert.equal(await shopper.locator('#toyBody .gallery .thumbs button').count(), 3);
  assert.equal(await shopper.locator('#toyBody .gallery video').count(), 1);
  await shopper.keyboard.press('Escape');
});

test('the owner adds a Sales person who signs in with a short name and sees only their work', async () => {
  await staff.goto(`${h.url}/staff/#settings`);
  await staff.getByRole('heading', { name: 'Team' }).waitFor();
  const form = staff.locator('#addStaff');
  await form.locator('input[name=name]').fill('Chanda');
  await form.locator('input[name=login]').fill('Chanda1');
  await form.locator('input[name=password]').fill('till-pass');
  await form.locator('[data-role-new][value=stock]').uncheck();
  await form.locator('[data-role-new][value=sales]').check();
  await form.getByRole('button', { name: 'Add person' }).click();
  await staff.getByText('Chanda can now sign in as chanda1').waitFor();
  const card = staff.locator('[data-staff="chanda1@staff.allseazons.shop"]');
  await card.waitFor();
  await shot(staff, '20-team');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const till = watch(await ctx.newPage());
  await till.goto(`${h.url}/staff/`);
  await till.fill('input[name=email]', 'Chanda1');
  await till.fill('input[name=password]', 'till-pass');
  await till.click('#loginForm button[type=submit]');
  await till.getByRole('heading', { name: 'Home' }).waitFor();
  assert.equal(await till.locator('#nav a[data-nav=orders]').isVisible(), true);
  for (const page of ['upload', 'review', 'stock']) {
    assert.equal(await till.locator(`#nav a[data-nav=${page}]`).isVisible(), false, `${page} is hidden for Sales`);
  }
  // Going to a Stock page by its address lands on Home instead.
  await till.goto(`${h.url}/staff/#stock`);
  await till.getByRole('heading', { name: 'Home' }).waitFor();
  await till.goto(`${h.url}/staff/#settings`);
  await till.getByRole('heading', { name: 'My account', level: 1 }).waitFor();
  assert.equal(await till.getByRole('heading', { name: 'Team' }).count(), 0);
  await till.fill('#myPassword input[name=pw]', 'new-till-pass');
  await till.getByRole('button', { name: 'Change my password' }).click();
  await till.getByText('Password changed').waitFor();
  await shot(till, '21-sales-account');

  // The owner switches Chanda off: the next sign-in is refused.
  await staff.reload();
  await card.locator('[data-active]').uncheck();
  await staff.getByRole('button', { name: 'Switch off' }).click();
  await staff.getByText('Chanda is switched off').waitFor();
  const ctx2 = await browser.newContext();
  const again = watch(await ctx2.newPage());
  await again.goto(`${h.url}/staff/`);
  await again.fill('input[name=email]', 'chanda1');
  await again.fill('input[name=password]', 'new-till-pass');
  await again.click('#loginForm button[type=submit]');
  await again.getByText('That sign-in name and password do not match.').waitFor();
  // Who did what.
  await staff.locator('#activity').getByText('Switched off Chanda').waitFor();
  await ctx.close();
  await ctx2.close();
});

test('the shop draws toys a screenful at a time and old toys get small pictures', async () => {
  const pg = new (require('pg').Client)({ connectionString: h.dbUrl });
  await pg.connect();
  // An older toy with only a full photo: the staff app makes its small copy.
  const src = (await pg.query("select photo_path from toys where photo_path is not null limit 1")).rows[0].photo_path;
  await pg.query(`insert into toys (name, price, status, image_path, photo_path, approved_at)
    select 'Old Toy ' || g, 50, 'available', $1, $1, now() - interval '1 day' from generate_series(1, 40) g`, [src]);
  await shopper.goto(`${h.url}/`);
  await shopper.locator('.card').first().waitFor();
  const total = (await pg.query("select count(*)::int n from toys where status in ('available','reserved')")).rows[0].n;
  assert.ok(total > 40);
  assert.equal(await shopper.locator('.card').count(), 24, 'first screenful only');
  for (let i = 0; i < 6 && (await shopper.locator('.card').count()) < total; i++) {
    await shopper.locator('#more').scrollIntoViewIfNeeded();
    await shopper.waitForTimeout(300);
  }
  assert.equal(await shopper.locator('.card').count(), total, 'scrolling shows the rest');

  await staff.goto(`${h.url}/staff/#home`);
  await staff.waitForFunction(() => true);
  for (let i = 0; i < 60; i++) {
    const left = (await pg.query("select count(*)::int n from toys where thumb_path is null and photo_path is not null")).rows[0].n;
    if (!left) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const left = (await pg.query("select count(*)::int n from toys where thumb_path is null and photo_path is not null")).rows[0].n;
  await pg.end();
  assert.equal(left, 0, 'every toy got a small picture');
});

test('on a phone: bottom tabs, the + sheet, a shop sale and a WhatsApp order', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = watch(await ctx.newPage());
  await phone.goto(`${h.url}/staff/`);
  await phone.fill('input[name=email]', h.staff.email);
  await phone.fill('input[name=password]', h.staff.password);
  await phone.click('#loginForm button[type=submit]');
  await phone.getByRole('heading', { name: 'Home' }).waitFor();
  await phone.locator('.stories').waitFor();
  await shot(phone, '30-phone-home');
  await phone.click('#plusBtn');
  await phone.getByRole('heading', { name: "What's new?" }).waitFor();
  await shot(phone, '31-phone-plus');
  await phone.getByRole('link', { name: /Shop sale/ }).click();
  await phone.getByRole('heading', { name: 'Shop sale' }).waitFor();
  await phone.locator('.pick').first().click();
  await phone.locator('#saleBar').getByText('1 toy').waitFor();
  await shot(phone, '32-phone-sale');
  await phone.getByRole('button', { name: 'Take payment' }).click();
  await phone.getByRole('button', { name: 'Record sale' }).click();
  await phone.getByText(/^Sale ORD-\d+ recorded/).waitFor();
  await phone.getByRole('heading', { name: 'Inbox' }).waitFor();

  await phone.goto(`${h.url}/staff/#sale?wa`);
  await phone.getByRole('heading', { name: 'WhatsApp order' }).waitFor();
  await phone.locator('.pick').first().click();
  await phone.getByRole('button', { name: 'Customer details' }).click();
  await phone.fill('#waForm [name=name]', 'Bupe Tembo');
  await phone.fill('#waForm [name=phone]', '0977 222 333');
  await phone.getByRole('button', { name: 'Hold the toys' }).click();
  const send = phone.getByRole('link', { name: 'Send summary on WhatsApp' });
  await send.waitFor();
  const link = new URL(await send.getAttribute('href'));
  assert.equal(link.pathname, '/260977222333');
  assert.match(link.searchParams.get('text'), /Hi Bupe Tembo! Your All Seazons order ORD-\d+ is held/);
  assert.match(link.searchParams.get('text'), /MTN Money to 0762750240/);
  await shot(phone, '33-phone-wa-order');

  await phone.goto(`${h.url}/staff/#upload`);
  await phone.locator('.shutter').waitFor();
  assert.equal(await phone.locator('.side').isVisible(), false, 'the shutter bar replaces the tabs');
  await shot(phone, '34-phone-snap');
  await phone.goto(`${h.url}/staff/#orders`);
  await phone.locator('.order').first().waitFor();
  await shot(phone, '35-phone-inbox');
  await ctx.close();
});

test('no browser errors along the way', () => {
  assert.deepEqual(errors, []);
});
