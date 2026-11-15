import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kwacha, waNumber, waLink, parcelSize, courierFee, orderMessage, priceBands, parseCsv, toCsv,
  legacyRowToToy, nameFromFile, effectivePrice, isSpecial, deliveryLine, packLabels, labelKey, parseFocus,
  storagePolicy, upsellPicks, setStorage, waitLabel, reminderMessage, teamReport,
} from '../assets/js/lib.js';

test('kwacha amounts', () => {
  assert.equal(kwacha(50), 'K50');
  assert.equal(kwacha(1250), 'K1,250');
  assert.equal(kwacha(null), '');
});

test('Zambian numbers become wa.me numbers', () => {
  assert.equal(waNumber('0977 123 456'), '260977123456');
  assert.equal(waNumber('+260 97 7123456'), '260977123456');
  assert.equal(waNumber('977123456'), '260977123456');
  assert.equal(waNumber('00260977123456'), '260977123456');
  assert.match(waLink('0977123456', 'Hi & bye'), /^https:\/\/wa\.me\/260977123456\?text=Hi%20%26%20bye$/);
});

test('parcel size follows the item count', () => {
  const s = { medium_from: 2, large_from: 5 };
  assert.equal(parcelSize(1, s), 'small');
  assert.equal(parcelSize(2, s), 'medium');
  assert.equal(parcelSize(4, s), 'medium');
  assert.equal(parcelSize(5, s), 'large');
  assert.equal(courierFee({ fee_small: 60, fee_medium: null }, 'small'), 60);
  assert.equal(courierFee({ fee_small: 60, fee_medium: null }, 'medium'), null);
});

test('specials use the sale price', () => {
  assert.equal(effectivePrice({ price: 100, sale_price: 80 }), 80);
  assert.equal(effectivePrice({ price: 100, sale_price: null }), 100);
  assert.equal(isSpecial({ price: 100, sale_price: 80 }), true);
  assert.equal(isSpecial({ price: 100, sale_price: null, is_special: false }), false);
});

const order = {
  code: 'ORD-1042', customer_name: 'Mwila Phiri', phone: '0966000111', location: 'out_of_town',
  town: 'Kitwe', courier: 'Mazhandu', delivery_method: 'courier', address: 'Mazhandu Kitwe branch',
  parcel_size: 'medium', item_count: 3, subtotal: 220, delivery_fee: 90, total: 310, note: 'Gift wrap please',
  hold_until: '2026-10-25T19:30:00Z',
  items: [
    { code: 'AS-0012', name: 'Barbie Camper Van', condition: 'used', price: 100, qty: 1 },
    { code: 'AS-0013', name: 'Duplo Train', condition: 'new', price: 60, qty: 2 },
  ],
};

test('the WhatsApp order message is clearly labelled', () => {
  const m = orderMessage(order, 'https://shop.example/order.html?o=ORD-1042&k=abc');
  assert.match(m, /^\*NEW ORDER ORD-1042\*/);
  assert.match(m, /1\. Barbie Camper Van \(AS-0012\) - Used - K100/);
  assert.match(m, /2\. Duplo Train x2 \(AS-0013\) - New - K120/);
  assert.match(m, /\*Toys total:\* K220/);
  assert.match(m, /\*Delivery:\* Courier to Kitwe via Mazhandu, medium parcel - K90/);
  assert.match(m, /\*TOTAL TO PAY:\* K310\n/);
  assert.match(m, /\*Name:\* Mwila Phiri/);
  assert.match(m, /\*Location:\* Out of town - Kitwe/);
  assert.match(m, /\*Delivery method:\* Courier \(Mazhandu\)/);
  assert.match(m, /\*Address:\* Mazhandu Kitwe branch/);
  assert.match(m, /\*Pictures of my toys:\* https:\/\/shop\.example\/order\.html\?o=ORD-1042&k=abc/);
  assert.match(m, /Held for me until 21:30/);
});

test('the 72-hour storage rule is in pickup and Yango orders, not courier ones', () => {
  assert.doesNotMatch(orderMessage(order, ''), /storage fee/);
  const m = orderMessage({ ...order, delivery_method: 'pickup', location: 'lusaka' }, '');
  assert.match(m, /keep your toys for 72 hours[\s\S]*K10 per toy for every day/);
  assert.match(storagePolicy(true), /72 hours[\s\S]*K10 a day per toy/);
});

test('checkout suggests toys like the ones picked, cheapest first', () => {
  const toy = (id, category, age_range, price, extra = {}) => ({ id, category, age_range, price, audience: 'boys', status: 'available', ...extra });
  const toys = [
    toy('a', 'Cars', '3-5', 100), toy('b', 'Cars', '3-5', 70), toy('c', 'Cars', '3-5', 50),
    toy('d', 'Dolls', '9+', 30, { audience: 'girls' }), toy('e', 'Cars', '3-5', 50, { status: 'reserved' }),
  ];
  assert.deepEqual(upsellPicks(toys, ['a']).map((t) => t.id), ['c', 'b', 'd']);
  assert.deepEqual(upsellPicks(toys, ['a'], 1).map((t) => t.id), ['c']);
});

test('delivery wording for each method', () => {
  assert.equal(deliveryLine({ delivery_method: 'pickup' }), 'Pickup in Lusaka (free)');
  assert.match(deliveryLine({ delivery_method: 'yango' }), /paid to the driver/);
  assert.match(deliveryLine({ ...order, delivery_fee: null }), /fee to be confirmed/);
  const m = orderMessage({ ...order, delivery_fee: null, total: 220 }, '');
  assert.match(m, /TOTAL TO PAY:\* K220 \+ courier fee/);
});

test('price bands for the shop filter', () => {
  const b = priceBands([100, 50, 75]);
  assert.deepEqual(b.map((x) => x.label), ['Up to K50', 'K75', 'K100', 'Over K100']);
  assert.deepEqual([b[1].min, b[1].max], [51, 75]);
});

test('CSV round trip with quotes and commas', () => {
  const csv = toCsv([{ a: 'x, "y"', b: 2 }], ['a', 'b']);
  assert.deepEqual(parseCsv(csv), [{ a: 'x, "y"', b: '2' }]);
});

test('old Google Sheet rows import as toys', () => {
  const rows = parseCsv('ToyID,Name,Brand,Type,Category,Condition,Status,Price,BoxID,AgeRange,Description\nT-7,Barbie Doll,Mattel,Dolls & Accessories,Girls,Used,Available,K75,B01,3-5,Nice\nT-8,Truck,,Cars & Vehicles,Boys,New,Sold,100,,,\n');
  const [a, b] = rows.map(legacyRowToToy);
  assert.equal(a.legacy_id, 'T-7');
  assert.equal(a.audience, 'girls');
  assert.equal(a.status, 'review');
  assert.equal(a.price, 75);
  assert.equal(a.box_id, 'B01');
  assert.equal(b.status, 'sold');
  assert.equal(b.condition, 'new');
  assert.equal(b.audience, 'boys');
  assert.equal(b.box_id, null);
});

test('only chosen file names become toy names', () => {
  assert.equal(nameFromFile('barbie camper van.jpg'), 'Barbie Camper Van');
  assert.equal(nameFromFile('lego_duplo-train.JPG'), 'Lego Duplo Train');
  assert.equal(nameFromFile('IMG_2041.jpg'), '');
  assert.equal(nameFromFile('PXL_20261001_123.jpg'), '');
  assert.equal(nameFromFile('WhatsApp Image 2026-10-01.jpeg'), '');
  assert.equal(nameFromFile('toy1.jpg'), '');
  assert.equal(nameFromFile('20261001_120000.jpg'), '');
});

test('a Claude pack opens, stored or deflated, and its labels match the photos', async () => {
  const { readFile } = await import('node:fs/promises');
  const { readZip } = await import('../assets/js/unzip.js');
  for (const name of ['claude-pack.zip', 'claude-pack-deflated.zip']) {
    const buf = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
    const files = await readZip(new Blob([buf]));
    assert.deepEqual(files.map((f) => f.name).filter((n) => !/-(cut|plate)\./.test(n)).sort(), ['001.jpg', '002.jpg', 'labels.csv']);
    const csv = await files.find((f) => f.name === 'labels.csv').blob.text();
    const labels = packLabels(parseCsv(csv));
    assert.equal(labels.get(labelKey('IMG/001.JPG')).name, 'Pink Pony Stable');
    assert.equal(labels.get('001').price, 100);
    assert.equal(labels.get('001').tagline, 'With Pony');
    assert.equal(labels.get('002').price, null);
    assert.equal(labels.get('002').condition, 'new');
    const jpg = new Uint8Array(await files.find((f) => f.name === '001.jpg').blob.arrayBuffer());
    assert.deepEqual([...jpg.slice(0, 2)], [0xff, 0xd8]);
  }
});

test('pack labels are cleaned up', () => {
  const labels = packLabels([{ File: 'a.png', Name: 'X', Audience: 'Unisex', Condition: 'NEW in box', 'Age range': '3 - 5', Price: 'K75' }, { name: 'no file' }]);
  assert.equal(labels.size, 1);
  assert.deepEqual({ ...labels.get('a'), source: undefined }, { name: 'X', tagline: '', focus: null, brand: '', audience: 'neutral', condition: 'new', category: '', age_range: '3-5', description: '', confidence: 'high', price: 75, source: undefined });
});

test('focus boxes from a pack', () => {
  assert.deepEqual(parseFocus('0.1, 0.2, 0.9, 0.8'), [0.1, 0.2, 0.9, 0.8]);
  assert.deepEqual(parseFocus('10 20 90 80'), [0.1, 0.2, 0.9, 0.8]);
  assert.equal(parseFocus('0.9,0.2,0.1,0.8'), null);
  assert.equal(parseFocus(''), null);
});

test('traffic sources: tracked links, referrers and in-app browsers', async () => {
  const { trafficSource, trackedLink, sourceFromTag } = await import('../assets/js/lib.js');
  const host = 'allseazons.shop';
  const s = (o) => trafficSource({ host, ...o });
  assert.deepEqual(s({ search: '?src=wa-status&c=Christmas Sale' }),
    { source: 'whatsapp', via: 'wa-status', campaign: 'christmas-sale', referrer: '' });
  assert.equal(s({ search: '?utm_source=facebook&utm_medium=post', referrer: 'https://l.facebook.com/' }).source, 'facebook');
  assert.equal(s({ search: '?src=ig-bio' }).source, 'instagram');
  assert.equal(s({ search: '?src=qr' }).source, 'poster');
  assert.equal(s({ search: '?src=market-day' }).source, 'other');
  assert.equal(s({ search: '?fbclid=abc' }).source, 'facebook');
  assert.equal(s({ referrer: 'https://m.facebook.com/' }).source, 'facebook');
  assert.equal(s({ referrer: 'https://lm.facebook.com/l.php' }).source, 'facebook');
  assert.equal(s({ referrer: 'https://www.google.co.zm/' }).source, 'search');
  assert.equal(s({ referrer: 'https://www.bing.com/search?q=toys' }).source, 'search');
  assert.equal(s({ referrer: 'android-app://com.google.android.googlequicksearchbox/' }).source, 'search');
  assert.equal(s({ referrer: 'android-app://com.whatsapp/' }).source, 'whatsapp');
  assert.equal(s({ referrer: 'https://l.instagram.com/' }).source, 'instagram');
  assert.deepEqual(s({ referrer: 'https://zambiatoys.blog/post' }), { source: 'other', via: 'zambiatoys.blog', campaign: '', referrer: 'zambiatoys.blog' });
  // Moving between pages of the shop itself is not a new source.
  assert.equal(s({ referrer: 'https://allseazons.shop/order.html' }).source, 'direct');
  assert.equal(s({ ua: 'Mozilla/5.0 (Linux; Android 13) [FB_IAB/FB4A;FBAV/440.0.0.0;]' }).source, 'facebook');
  assert.equal(s({ ua: 'Mozilla/5.0 (Linux; Android 13) Instagram 300.0.0' }).source, 'instagram');
  assert.equal(s({ ua: 'Mozilla/5.0 (Linux; Android 13) Chrome/120' }).source, 'direct');
  assert.equal(sourceFromTag('WA'), 'whatsapp');
  assert.equal(sourceFromTag('fb-christmas'), 'facebook');
  assert.equal(trackedLink('https://allseazons.shop/#ABC', 'wa-status'), 'https://allseazons.shop/?src=wa-status');
  assert.equal(trackedLink('https://allseazons.shop/', 'fb', 'Easter Toys!'), 'https://allseazons.shop/?src=fb&c=easter-toys');
});

test('storage reminders and the team report', () => {
  assert.equal(waitLabel(5), '5 h');
  assert.equal(waitLabel(24), '1 day');
  assert.equal(waitLabel(77), '3 days 5 h');
  const o = { code: 'ORD-1009', customer_name: 'Jane Banda', delivery_method: 'pickup' };
  assert.match(reminderMessage(o, 'remind'), /^Hi Jane! .*ORD-1009 is packed and waiting for you to collect/);
  const n = reminderMessage(o, 'notice', { hours: 72, toys: 2, per_day: 20 });
  assert.match(n, /free for 72 hours/);
  assert.match(n, /K10 per toy per day/);
  assert.match(n, /K20 a day for your order/);
  assert.match(reminderMessage(o, 'fee', { hours: 120, fee: 40, per_day: 20 }), /Storage so far: K40, going up K20 a day/);
  setStorage({ storage_free_hours: 48, storage_fee: 15, storage_fee_per: 'order' });
  assert.match(storagePolicy(), /48 hours \(2 days\).*K15 per order/);
  setStorage({ storage_free_hours: 72, storage_fee: 10, storage_fee_per: 'toy' });
  const r = teamReport({
    day: 'Sun 15 Nov',
    sales: [{ channel: 'shop', total: 100 }, { channel: 'online', total: 250 }],
    done: [{ code: 'ORD-1', customer_name: 'Ann', storage_fee: 20 }],
    alerts: [{ text: 'ORD-2 waiting 5 days' }],
  });
  assert.match(r, /Sales today: K350\* \(2 orders\)/);
  assert.match(r, /Shop: 1 · K100/);
  assert.match(r, /ORD-1 Ann \(storage K20\)/);
  assert.match(r, /Needs attention: 1\*\n- ORD-2 waiting 5 days/);
});
