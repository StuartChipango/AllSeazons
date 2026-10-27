// Small helpers shared by the shop and the staff app. No browser-only APIs
// here, so these can be tested with Node.

export const AUDIENCES = {
  boys: { label: 'Boys', color: '#5f9fc4' },
  girls: { label: 'Girls', color: '#ec9cc1' },
  neutral: { label: 'Neutral', color: '#9cc9a6' },
};
export const CONDITIONS = { used: 'Used', new: 'New' };
export const AGES = ['0-2', '3-5', '6-8', '9+'];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function kwacha(n) {
  if (n === null || n === undefined || n === '') return '';
  return 'K' + Math.round(Number(n)).toLocaleString('en-US');
}

export const effectivePrice = (toy) => (toy.sale_price ?? null) !== null ? toy.sale_price : toy.price;
export const isSpecial = (toy) => Boolean(toy.is_special) || ((toy.sale_price ?? null) !== null && toy.sale_price < toy.price);

// Parcel size from the number of items, using the shop's settings.
export function parcelSize(count, settings = {}) {
  const medium = settings.medium_from ?? 2;
  const large = settings.large_from ?? 5;
  if (count >= large) return 'large';
  if (count >= medium) return 'medium';
  return 'small';
}

// Courier fee for a town and parcel size; null means "confirmed on WhatsApp".
export function courierFee(town, size) {
  if (!town) return null;
  const fee = town['fee_' + size];
  return fee === undefined || fee === null || fee === '' ? null : Number(fee);
}

// Zambian numbers: 0977 123 456 -> 260977123456 (the form wa.me needs).
export function waNumber(phone) {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('0')) d = '260' + d.slice(1);
  if (d.length === 9) d = '260' + d;
  return d;
}

export function waLink(phone, text) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

const SIZE_LABEL = { small: 'small', medium: 'medium', large: 'large' };

export function deliveryLine(order) {
  if (order.delivery_method === 'pickup') return 'Pickup in Lusaka (free)';
  if (order.delivery_method === 'yango') return 'Yango delivery in Lusaka (fee paid to the driver)';
  if (order.delivery_method === 'walk_in') return 'Bought in the shop';
  const where = `Courier to ${order.town}${order.courier ? ' via ' + order.courier : ''}, ${SIZE_LABEL[order.parcel_size] || order.parcel_size} parcel`;
  return order.delivery_fee === null || order.delivery_fee === undefined
    ? `${where} (fee to be confirmed)`
    : `${where} - ${kwacha(order.delivery_fee)}`;
}

export const METHOD_LABEL = {
  pickup: 'Pickup',
  yango: 'Yango delivery',
  courier: 'Courier',
  walk_in: 'Walk-in',
};

export function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' });
}

// The WhatsApp message the customer sends us. Built from the order the
// database returned, so the prices and totals are the shop's own.
export function orderMessage(order, picturesUrl) {
  const lines = [];
  lines.push(`*NEW ORDER ${order.code}*`);
  lines.push(`Hi All Seazons! I'd like to order these toys:`);
  lines.push('');
  (order.items || []).forEach((it, i) => {
    const qty = it.qty > 1 ? ` x${it.qty}` : '';
    lines.push(`${i + 1}. ${it.name}${qty} (${it.code}) - ${CONDITIONS[it.condition] || ''} - ${kwacha(it.price * (it.qty || 1))}`);
  });
  lines.push('');
  lines.push(`*Items:* ${order.item_count}`);
  lines.push(`*Toys total:* ${kwacha(order.subtotal)}`);
  lines.push(`*Delivery:* ${deliveryLine(order)}`);
  const pending = order.delivery_method === 'courier' && (order.delivery_fee === null || order.delivery_fee === undefined);
  lines.push(`*TOTAL TO PAY:* ${kwacha(order.total)}${pending ? ' + courier fee' : ''}`);
  lines.push('');
  lines.push(`*Name:* ${order.customer_name}`);
  lines.push(`*Phone:* ${order.phone}`);
  lines.push(`*Location:* ${order.location === 'lusaka' ? 'Lusaka' : `Out of town - ${order.town}`}`);
  lines.push(`*Delivery method:* ${METHOD_LABEL[order.delivery_method] || order.delivery_method}${order.courier ? ` (${order.courier})` : ''}`);
  if (order.address) lines.push(`*Address:* ${order.address}`);
  if (order.note) lines.push(`*Note:* ${order.note}`);
  if (picturesUrl) {
    lines.push('');
    lines.push(`*Pictures of my toys:* ${picturesUrl}`);
  }
  if (order.hold_until) lines.push(`(Held for me until ${timeLabel(order.hold_until)})`);
  return lines.join('\n');
}

// Price bands for the shop filter: each tier covers prices above the
// previous tier up to and including itself.
export function priceBands(tiers) {
  const sorted = [...new Set(tiers.map(Number))].filter((n) => n > 0).sort((a, b) => a - b);
  return sorted.map((max, i) => ({
    min: i === 0 ? 0 : sorted[i - 1] + 1,
    max,
    label: i === 0 ? `Up to ${kwacha(max)}` : kwacha(max),
  })).concat(sorted.length ? [{ min: sorted[sorted.length - 1] + 1, max: Infinity, label: `Over ${kwacha(sorted[sorted.length - 1])}` }] : []);
}

// Parse CSV text (handles quotes, commas and new lines inside quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function toCsv(rows, columns) {
  const cell = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n');
}

// Map a row from the old Google Sheet to a toy record.
export function legacyRowToToy(row) {
  const get = (...names) => {
    for (const n of names) {
      const key = Object.keys(row).find((k) => k.toLowerCase().replace(/[^a-z]/g, '') === n);
      if (key && row[key] !== '') return row[key];
    }
    return '';
  };
  const statusMap = { available: 'review', sold: 'sold', damaged: 'damaged', bundled: 'hidden', reserved: 'review' };
  const rawStatus = get('status').toLowerCase();
  const cond = get('condition').toLowerCase();
  const price = parseInt(String(get('price', 'pricek')).replace(/[^\d]/g, ''), 10);
  const text = `${get('category')} ${get('type', 'toytype')} ${get('tags')}`.toLowerCase();
  return {
    legacy_id: get('toyid', 'id') || null,
    name: get('name', 'toyname') || 'Unnamed toy',
    brand: get('brand') || null,
    category: get('type', 'toytype') || null,
    condition: cond.startsWith('new') ? 'new' : 'used',
    audience: /\bgirl/.test(text) ? 'girls' : /\bboy/.test(text) ? 'boys' : 'neutral',
    status: statusMap[rawStatus] || 'review',
    price: Number.isFinite(price) ? price : 50,
    box_id: get('boxid', 'box') || null,
    age_range: get('agerange', 'age') || null,
    description: get('description', 'notes') || null,
  };
}

// A file name the person chose ("barbie camper.jpg") beats the AI's guess;
// camera names ("IMG_2041.jpg") don't count.
export function nameFromFile(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  if (!/[a-z]{3}/i.test(base) || /^[a-z]+\s?\d+$/i.test(base)) return '';
  if (/^(img|dsc|dcim|pxl|photo|image|whatsapp|screenshot|snapchat|signal|fb|mvimg|wp|picture)\b/i.test(base)) return '';
  return base.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
}

// Labels made by Claude in a chat (labels.csv in a "Claude pack"), keyed by
// photo file name without folder or extension, lower case.
export const labelKey = (filename) => String(filename || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').trim().toLowerCase();

export function packLabels(rows) {
  const map = new Map();
  for (const r of rows) {
    const get = (k) => String(r[Object.keys(r).find((h) => h.toLowerCase().replace(/[^a-z]/g, '') === k) ?? ''] ?? '').trim();
    const key = labelKey(get('file') || get('filename') || get('photo'));
    if (!key) continue;
    const audience = get('audience').toLowerCase();
    const condition = get('condition').toLowerCase();
    const age = get('agerange').replace(/\s/g, '');
    const price = parseInt(get('price').replace(/[^\d]/g, ''), 10);
    map.set(key, {
      name: get('name').slice(0, 40) || 'Unnamed toy',
      brand: get('brand'),
      audience: ['boys', 'girls', 'neutral'].includes(audience) ? audience : 'neutral',
      condition: condition.startsWith('new') ? 'new' : 'used',
      category: get('category'),
      age_range: AGES.includes(age) ? age : '',
      description: get('description'),
      confidence: ['high', 'medium', 'low'].includes(get('confidence').toLowerCase()) ? get('confidence').toLowerCase() : 'high',
      price: price > 0 ? price : null,
      source: 'claude-pack',
    });
  }
  return map;
}
