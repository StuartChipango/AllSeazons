import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kwacha, waNumber, waLink, parcelSize, courierFee, orderMessage, priceBands, parseCsv, toCsv,
  legacyRowToToy, nameFromFile, effectivePrice, isSpecial, deliveryLine, packLabels, labelKey,
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
    assert.deepEqual(files.map((f) => f.name).sort(), ['001.jpg', '002.jpg', 'labels.csv']);
    const csv = await files.find((f) => f.name === 'labels.csv').blob.text();
    const labels = packLabels(parseCsv(csv));
    assert.equal(labels.get(labelKey('IMG/001.JPG')).name, 'Pink Pony Stable');
    assert.equal(labels.get('001').price, 100);
    assert.equal(labels.get('002').price, null);
    assert.equal(labels.get('002').condition, 'new');
    const jpg = new Uint8Array(await files.find((f) => f.name === '001.jpg').blob.arrayBuffer());
    assert.deepEqual([...jpg.slice(0, 2)], [0xff, 0xd8]);
  }
});

test('pack labels are cleaned up', () => {
  const labels = packLabels([{ File: 'a.png', Name: 'X', Audience: 'Unisex', Condition: 'NEW in box', 'Age range': '3 - 5', Price: 'K75' }, { name: 'no file' }]);
  assert.equal(labels.size, 1);
  assert.deepEqual({ ...labels.get('a'), source: undefined }, { name: 'X', brand: '', audience: 'neutral', condition: 'new', category: '', age_range: '3-5', description: '', confidence: 'high', price: 75, source: undefined });
});
