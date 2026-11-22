import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, findDate, findTotal, findSupplier, guessCategory, readReceipt,
  booksReminder, addMonths, monthLabel, booksCsv, reminderCalendar, lusakaToday,
} from '../assets/js/books-lib.js';

test('amounts as receipts print them', () => {
  assert.equal(parseAmount('1,250.00'), 1250);
  assert.equal(parseAmount('K 1 250,50'), 1250.5);
  assert.equal(parseAmount('45'), 45);
  assert.equal(parseAmount('1O5.00'), 105);
  assert.equal(parseAmount('ZMW 12,000'), 12000);
  assert.equal(parseAmount('abc'), null);
});

const SHOPRITE = `SHOPRITE
Manda Hill Lusaka
TPIN 1001234567
TAX INVOICE
Date: 14/11/2026 10:32
CARRIER BAG 2 x 1.50     3.00
PACKING TAPE             45.00
BOX FILE                 89.99
SUBTOTAL                137.99
VAT 16%                  19.03
TOTAL                   137.99
CASH                    200.00
CHANGE                   62.01`;

const PUMA = `PUMA ENERGY
Great East Road
Receipt No 004521
2026-11-03 07:45
DIESEL 20.00 L @ 28.50
Amount Due ZMW 570.00
Paid Airtel`;

const HANDWRITTEN = `Mwila Hardware
Cell 0977 555 123
3 Nov 2026
Shelves x4   K2,400
Paint        K650
Total
K3,050`;

test('reads a supermarket receipt', () => {
  const r = readReceipt(SHOPRITE, '2026-11-22');
  assert.deepEqual(r, { supplier: 'Shoprite', spent_on: '2026-11-14', amount: 137.99, category: 'packaging' });
});
test('reads a fuel receipt', () => {
  const r = readReceipt(PUMA, '2026-11-22');
  assert.equal(r.supplier, 'Puma Energy');
  assert.equal(r.spent_on, '2026-11-03');
  assert.equal(r.amount, 570);
  assert.equal(r.category, 'transport');
});
test('reads a written receipt with the total on the next line', () => {
  const r = readReceipt(HANDWRITTEN, '2026-11-22');
  assert.equal(r.supplier, 'Mwila Hardware');
  assert.equal(r.spent_on, '2026-11-03');
  assert.equal(r.amount, 3050);
  assert.equal(r.category, 'setup');
});
test('no total word: biggest amount that is not cash or change', () => {
  assert.equal(findTotal('Bale of toys 1,800.00\nTransport 200.00\nCash 2,500.00\nChange 500.00'), 1800);
});
test('dates: day first, never in the future, phone numbers ignored', () => {
  assert.equal(findDate('05/11/26', '2026-11-22'), '2026-11-05');
  assert.equal(findDate('11/25/2026', '2026-12-01'), '2026-11-25');
  assert.equal(findDate('Nov 2, 2026', '2026-11-22'), '2026-11-02');
  assert.equal(findDate('01/12/2026', '2026-11-22'), null);
  assert.equal(findDate('Tel 0977123456', '2026-11-22'), null);
});
test('shop name skips headers', () => {
  assert.equal(findSupplier('TAX INVOICE\n*** GAME STORES ***\nTPIN 123'), 'Game Stores');
});
test('category hints', () => {
  assert.equal(guessCategory('ZESCO prepaid units'), 'utilities');
  assert.equal(guessCategory('Platinum Couriers Kitwe'), 'delivery');
  assert.equal(guessCategory('bale of toys'), 'stock');
  assert.equal(guessCategory('random'), 'other');
});

test('month helpers', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01-15', -1), '2025-12');
  assert.equal(monthLabel('2026-11-01'), 'November 2026');
  assert.equal(lusakaToday(new Date('2026-11-30T23:30:00Z')), '2026-12-01');
});

test('month-end reminder', () => {
  assert.equal(booksReminder('2026-11-20'), null);
  assert.match(booksReminder('2026-11-25').text, /November is nearly over/);
  assert.equal(booksReminder('2026-11-25', { closedMonths: ['2026-11'] }), null);
  const due = booksReminder('2026-12-10');
  assert.equal(due.month, '2026-11');
  assert.equal(due.urgent, true);
  assert.match(due.text, /by 14 December \(4 days left\)/);
  assert.match(booksReminder('2026-12-14').text, /due today/);
  assert.equal(booksReminder('2026-12-03', { closedMonths: ['2026-11'] }), null);
  assert.equal(booksReminder('2026-12-15'), null);
  assert.equal(booksReminder('2026-11-20', { reminderDay: 20 }).month, '2026-11');
});

test('accountant spreadsheet', () => {
  const csv = booksCsv({ month: '2026-11-01', online_sales: 500, shop_sales: 300, delivery: 40, income: 0, turnover: 840, stock: 1000, expenses: 200, setup: 0, tax_due: 42 },
    [{ spent_on: '2026-11-03', kind: 'expense', category: 'stock', supplier: 'Bale, "big"', amount: '1000.00', pay_method: 'mtn', paid_by: 'director', items: 40, receipt_path: 'x.jpg', status: 'ok' }]);
  assert.match(csv, /^All Seazons Play books: November 2026/);
  assert.match(csv, /Turnover,840/);
  assert.match(csv, /2026-11-03,Out,Stock \(toys bought\),"Bale, ""big""",,1000,MTN Money,Director \(owed back\),40,,Yes,Yes/);
});

test('calendar reminder repeats monthly', () => {
  const { google, ics } = reminderCalendar(25, '2026-11-22');
  assert.match(google, /recur=RRULE%3AFREQ%3DMONTHLY%3BBYMONTHDAY%3D25/);
  assert.match(google, /dates=20261125\/20261126/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261125/);
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYMONTHDAY=10/);
});
test('"total VAT" and "total items" are not the total', () => {
  assert.equal(findTotal('Total items 3\nTotal VAT 16.00\nTOTAL 116.00'), 116);
});
test('what the phone read from a test photo', () => {
  const text = `MWILA HARDWARE  LTD\n\nplot 12 Kafue Road, Lusaka\nTPIN 1002345678   cell 0977 555 123\n\nCASH SALE RECEIPT No. 004512\n\nDate: 18/11/2026\n\nMetal shelf 5 tier x2                   1,900.00\nPVA paint white 20L                       650.00\nBrushes x3                                  90.00\nTOTAL                                    K2,640.00\nCASH                            3,000.00\nCHANGE                            360.00\nThank you for your business`;
  assert.deepEqual(readReceipt(text, '2026-11-22'), { supplier: 'Mwila Hardware Ltd', spent_on: '2026-11-18', amount: 2640, category: 'setup' });
  assert.equal(readReceipt('PUMA ENERGY\n2026-11-12 07:45\nDIESEL 20.00 L @ 28.50   570.00\nAmount Due ZMw         570.00', '2026-11-22').amount, 570);
});
