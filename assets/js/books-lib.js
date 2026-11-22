// The Books (bookkeeping): categories, reading a receipt's words, month
// helpers and the accountant's spreadsheet. No browser-only APIs here, so
// all of it can be tested with Node.

// Money out. "stock" and "setup" get their own lines in profit and loss.
export const EXPENSE_CATEGORIES = {
  stock: 'Stock (toys bought)',
  setup: 'Shop setup (one-off)',
  rent: 'Rent',
  transport: 'Transport & fuel',
  delivery: 'Delivery & courier',
  packaging: 'Packaging & shop supplies',
  phone: 'Phone, data & internet',
  ads: 'Advertising & printing',
  wages: 'Wages & allowances',
  utilities: 'Electricity & water',
  fees: 'Bank & mobile money fees',
  licences: 'Licences, levies & registration',
  repairs: 'Repairs & cleaning',
  other: 'Other',
};
// Money in that is not a sale made in the app.
export const INCOME_CATEGORIES = {
  sales: 'Sales not in the app',
  other_income: 'Other money in',
};
export const categoryLabel = (kind, key) =>
  (kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[key] || key || 'Other';

export const PAY_METHODS = {
  cash: 'Cash',
  mtn: 'MTN Money',
  airtel: 'Airtel Money',
  bank: 'Bank transfer',
  card: 'Card',
  other: 'Other',
};

// ---------------------------------------------------------------------
// Months (all in Lusaka time, which has no daylight saving).
// ---------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function lusakaToday(now = new Date()) {
  return new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
}
export const monthKey = (iso) => String(iso).slice(0, 7);
export function monthLabel(key, short = false) {
  const [y, m] = monthKey(key).split('-').map(Number);
  const name = MONTHS[m - 1] || '';
  return short ? `${name.slice(0, 3)}` : `${name} ${y}`;
}
export function addMonths(key, n) {
  const [y, m] = monthKey(key).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthRange(key) {
  return { from: `${monthKey(key)}-01`, to: `${addMonths(key, 1)}-01` };
}

// Turnover tax for a month is due by the 14th of the next month (ZRA).
// From the reminder day (default the 25th) the app nudges the owners to
// get the month's books ready; after the month ends it nudges about the
// month just gone until its tax is marked paid.
export function booksReminder(today, { reminderDay = 25, closedMonths = [] } = {}) {
  const key = monthKey(today);
  const day = Number(String(today).slice(8, 10));
  const prev = addMonths(key, -1);
  if (day <= 14 && !closedMonths.includes(prev)) {
    const left = 14 - day;
    return {
      month: prev,
      urgent: left <= 4,
      text: left === 0
        ? `Turnover tax for ${monthLabel(prev)} is due today.`
        : `Turnover tax for ${monthLabel(prev)} is due by 14 ${monthLabel(key).split(' ')[0]} (${left} day${left === 1 ? '' : 's'} left).`,
    };
  }
  if (day >= reminderDay && !closedMonths.includes(key)) {
    return {
      month: key,
      urgent: false,
      text: `${monthLabel(key).split(' ')[0]} is nearly over. Time to put in every receipt and get the books ready for tax.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------
// Reading a receipt. The phone turns the photo into words (Tesseract);
// these pick out the shop, date and total. Staff check and fix them.
// ---------------------------------------------------------------------
const MONEY = /(?:K|ZMW|ZK)?\s*(\d{1,3}(?:[,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d%])/gi;

// "1,250.00" -> 1250, "1 250,50" -> 1250.5, "45" -> 45
export function parseAmount(text) {
  let s = String(text).replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').replace(/[^\d.,\s]/g, '').trim();
  if (!s) return null;
  s = s.replace(/\s+/g, ',');
  const dec = s.match(/[.,](\d{1,2})$/);
  let whole = dec ? s.slice(0, -dec[0].length) : s;
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole)) return null;
  const n = Number(whole + (dec ? '.' + dec[1] : ''));
  return Number.isFinite(n) ? n : null;
}

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const raw = m[1];
    // Skip phone numbers, TPINs and long codes.
    if (/^\d{7,}$/.test(raw.replace(/[,\s]/g, '')) && !/[.,]\d{1,2}$/.test(raw)) continue;
    const n = parseAmount(raw);
    if (n !== null) out.push(n);
  }
  return out;
}

const TOTAL_WORDS = /\b(grand\s*total|total\s*(?:due|amount|payable|incl\w*|zmw|k)?|amount\s*(?:due|payable|paid)|balance\s*due|to\s*pay|net\s*amount|tota1|totai)\b/i;
const NOT_TOTAL = /\b(sub\s*-?\s*total|subtotal|vat|tax|tot\s*tax|change|cash\s*(?:tendered|paid|received)?|tender|tendered|discount|saving|items?|qty|quantity|points|rounding|excl)\b/i;

function looksLikeDate(y, m, d) {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function findDate(text, today = '2100-01-01') {
  const found = [];
  const t = String(text);
  for (const m of t.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) found.push([+m[1], +m[2], +m[3]]);
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) {
    let y = +m[3];
    if (y < 100) y += 2000;
    let d = +m[1], mo = +m[2];
    // Zambia writes day first; only swap when that cannot be a date.
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    found.push([y, mo, d]);
  }
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s,-]*(\d{4}|\d{2})\b/gi)) {
    let y = +m[3]; if (y < 100) y += 2000;
    found.push([y, MON[m[2].toLowerCase()], +m[1]]);
  }
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/gi)) {
    found.push([+m[3], MON[m[1].toLowerCase()], +m[2]]);
  }
  for (const [y, mo, d] of found) {
    if (!looksLikeDate(y, mo, d)) continue;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso <= today) return iso;
  }
  return null;
}

export function findTotal(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let best = null;
  lines.forEach((line, i) => {
    if (!TOTAL_WORDS.test(line)) return;
    if (/sub\s*-?\s*total|total\s*(?:vat|tax|items?|qty|discount|savings?)\b/i.test(line)) return;
    let nums = amountsIn(line.replace(TOTAL_WORDS, ' '));
    // The amount is sometimes printed on the line under "TOTAL".
    if (!nums.length && lines[i + 1] && !NOT_TOTAL.test(lines[i + 1])) nums = amountsIn(lines[i + 1]);
    if (!nums.length) return;
    const n = nums[nums.length - 1];
    const strength = /grand/i.test(line) ? 3 : /due|payable|to\s*pay/i.test(line) ? 2 : 1;
    if (!best || strength > best.strength || (strength === best.strength && n >= best.n)) best = { n, strength };
  });
  if (best) return best.n;
  // No "total" line: the biggest amount on the receipt that is not cash
  // handed over or change.
  let max = null;
  for (const line of lines) {
    if (/change|tender|^\W*cash\b|tpin|tel|phone|cell|invoice\s*no|receipt\s*no/i.test(line)) continue;
    for (const n of amountsIn(line)) if (n < 1e7 && (max === null || n > max)) max = n;
  }
  return max;
}

const SKIP_NAME = /receipt|invoice|tax|tpin|vat|tel\b|phone|cell|date|time|till|cashier|welcome|thank|copy|customer|p\.?\s*o\.?\s*box|plot|road|street|www|@|^\W*$/i;
export function findSupplier(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/[|_~*=]+/g, ' ').replace(/\s+/g, ' ').trim());
  for (const line of lines.slice(0, 8)) {
    const letters = (line.match(/[a-z]/gi) || []).length;
    if (letters < 3 || letters < line.length * 0.5 || SKIP_NAME.test(line)) continue;
    return line.length > 40 ? line.slice(0, 40).trim() : titleCase(line);
  }
  return '';
}
const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

// A first guess at the category from the shop's name and the items.
const CATEGORY_HINTS = [
  ['stock', /\btoys?\b|bale|second[\s-]*hand|thrift|salaula|kantemba/i],
  ['transport', /fuel|petrol|diesel|puma|total\s*energies|engen|mount\s*meru|rubis|bp\b|lake\s*petroleum|taxi|bus\s*fare|uber|yango\s*ride/i],
  ['delivery', /platinum|courier|mazhandu|postnet|zampost|dhl|parcel|yango|shipping/i],
  ['phone', /airtime|data\s*bundle|bundle|mtn|airtel|zamtel|liquid|internet|wi-?fi/i],
  ['utilities', /zesco|electricity|units|water\s*(?:and|&)\s*sewer|lwsc|lusaka\s*water/i],
  ['rent', /\brent\b|landlord|lease/i],
  ['licences', /pacra|council|levy|licen[cs]e|zra|permit|registration/i],
  ['ads', /facebook|meta\s*platforms|advert|print|banner|flyer|signage|sticker/i],
  ['packaging', /plastic|carrier\s*bag|tape|box(?:es)?\b|packag|wrap|stationery|shoprite|pick\s*n\s*pay|game\s*stores|choppies|spar/i],
  ['setup', /shelf|shelv|paint|cement|hardware|timber|board|furniture|rack|display|tiles|electrical|builders|plumb/i],
  ['repairs', /repair|clean|detergent|soap|jik|broom|mop/i],
  ['fees', /bank\s*charge|service\s*fee|withdraw|transaction\s*fee/i],
];
export function guessCategory(text) {
  for (const [key, re] of CATEGORY_HINTS) if (re.test(text)) return key;
  return 'other';
}

export function readReceipt(text, today = '2100-01-01') {
  const t = String(text || '');
  return {
    supplier: findSupplier(t),
    spent_on: findDate(t, today),
    amount: findTotal(t),
    category: guessCategory(t),
  };
}

// ---------------------------------------------------------------------
// The accountant's spreadsheet for a month (opens in Excel / Sheets).
// ---------------------------------------------------------------------
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function booksCsv(month, entries) {
  const m = month || {};
  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvCell).join(','));
  row(`All Seazons Play books: ${monthLabel(m.month || '2000-01')}`);
  row('');
  row('Summary', 'Kwacha');
  row('Toy sales (website)', m.online_sales ?? 0);
  row('Toy sales (shop)', m.shop_sales ?? 0);
  row('Delivery and packaging fees', m.delivery ?? 0);
  row('Other money in', m.income ?? 0);
  row('Turnover', m.turnover ?? 0);
  row('Stock bought', m.stock ?? 0);
  row('Running costs', m.expenses ?? 0);
  row('Shop setup (one-off)', m.setup ?? 0);
  row(`Turnover tax estimate`, m.tax_due ?? 0);
  row('Turnover tax paid', m.tax_paid ?? '');
  row('');
  row('Date', 'Money in or out', 'Category', 'Supplier', 'What for', 'Amount', 'Paid with', 'Paid by', 'Toys or items', 'Box', 'Receipt photo', 'Checked');
  for (const e of entries) {
    row(e.spent_on, e.kind === 'income' ? 'In' : 'Out', categoryLabel(e.kind, e.category), e.supplier, e.description,
      Number(e.amount), PAY_METHODS[e.pay_method] || '', e.paid_by === 'director' ? 'Director (owed back)' : 'Business',
      e.items ?? '', e.box_id ?? '', e.receipt_path ? 'Yes' : 'No', e.status === 'check' ? 'Not yet' : 'Yes');
  }
  return lines.join('\r\n') + '\r\n';
}

// A repeating phone calendar reminder (Google Calendar link and .ics file).
export function reminderCalendar(day = 25, start = lusakaToday()) {
  const title = 'All Seazons: prepare the books and turnover tax';
  const details = 'Put in every receipt for this month in the staff app (Books), check the sales, then pay turnover tax at ZRA by the 14th.';
  const [y, m] = start.split('-').map(Number);
  const first = `${y}${String(m).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const next = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const rule = `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`;
  const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(title)}&details=${encodeURIComponent(details)}`
    + `&dates=${first}/${next}&recur=${encodeURIComponent(rule)}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//All Seazons//Books//EN',
    'BEGIN:VEVENT', `UID:books-reminder-${day}@allseazons.shop`, `DTSTAMP:${first}T060000Z`,
    `DTSTART;VALUE=DATE:${first}`, `DTEND;VALUE=DATE:${next}`, rule,
    `SUMMARY:${title}`, `DESCRIPTION:${details}`,
    'BEGIN:VALARM', 'TRIGGER:PT8H', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT', 'UID:books-tax-due-10@allseazons.shop', `DTSTAMP:${first}T060000Z`,
    `DTSTART;VALUE=DATE:${y}${String(m).padStart(2, '0')}10`, `DTEND;VALUE=DATE:${y}${String(m).padStart(2, '0')}11`,
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=10',
    'SUMMARY:All Seazons: turnover tax due on the 14th', 'DESCRIPTION:Pay last month\'s turnover tax at ZRA by the 14th, then mark it paid in Books.',
    'BEGIN:VALARM', 'TRIGGER:PT8H', 'ACTION:DISPLAY', 'DESCRIPTION:Turnover tax due on the 14th', 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
  return { google, ics };
}
