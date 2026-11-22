import { esc, kwacha, METHOD_LABEL, CONDITIONS, waLink, timeLabel } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { refreshBadges, can, shared } from './app.js';
import { $, $$, toast, confirmBox, ago, dateLabel, busy } from './ui.js';
import { wireSearchBox } from '../search.js';

const TABS = [
  { key: 'open', label: 'To confirm', statuses: ['held', 'confirmed'] },
  { key: 'paid', label: 'To pack', statuses: ['paid'] },
  { key: 'packed', label: 'Packed', statuses: ['packed'] },
  { key: 'sent', label: 'Sent', statuses: ['sent'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
  { key: 'closed', label: 'Cancelled', statuses: ['cancelled', 'expired'] },
];
const STATUS_LABEL = {
  held: 'Waiting', confirmed: 'Confirmed', paid: 'Paid', packed: 'Packed', sent: 'Sent',
  delivered: 'Delivered', cancelled: 'Cancelled', expired: 'Hold expired',
};
const NEXT = {
  held: [['confirmed', 'Confirm (keep holding)', 'ghost'], ['paid', 'Mark paid', 'go']],
  confirmed: [['paid', 'Mark paid', 'go']],
  paid: [['packed', 'Mark packed', 'go']],
  packed: [['sent', 'Mark sent', 'go']],
  sent: [['delivered', 'Mark delivered', 'go']],
  cancelled: [['held', 'Reopen', 'ghost']],
  expired: [['held', 'Reopen', 'ghost'], ['paid', 'Mark paid', 'go']],
};

let root = null;
let tab = 'open';
// The Inbox shows work still to do; Order history shows finished orders.
let view = 'inbox';
const GROUPS = { inbox: ['open', 'paid', 'packed', 'sent'], history: ['delivered', 'closed', 'shop'] };
const SECTION_LABEL = { shop: 'Shop sales' };
let q = '';
let orders = [];
let counts = {};
let towns = null;
const picked = new Set();
let ticker;

export async function show(main) {
  root = main;
  await load();
  clearInterval(ticker);
  ticker = setInterval(() => $$('.hold[data-until]', root || document).forEach(paintHold), 30_000);
}
export function leave() { root = null; clearInterval(ticker); }

async function load() {
  await supabase.rpc('release_expired_holds');
  if (!tab) { orders = []; render(); return; }
  const t = TABS.find((x) => x.key === tab);
  let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: tab === 'open' || tab === 'paid' });
  query = tab === 'shop' ? query.eq('channel', 'shop') : query.in('status', t.statuses).eq('channel', 'online');
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ').trim();
    query = query.or(`code.ilike.%${safe}%,customer_name.ilike.%${safe}%,phone.ilike.%${safe}%,town.ilike.%${safe}%`);
  }
  if (!towns) {
    const { data: tw } = await supabase.from('towns').select('*');
    towns = tw || [];
  }
  const [{ data, error }, ...countRes] = await Promise.all([
    query.limit(200),
    ...TABS.map((x) => supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', x.statuses).eq('channel', 'online')),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('channel', 'shop'),
  ]);
  if (error) throw error;
  orders = data;
  counts = Object.fromEntries(TABS.map((x, i) => [x.key, countRes[i].count || 0]));
  counts.shop = countRes[TABS.length].count || 0;
  render();
}

function paintHold(el) {
  const left = new Date(el.dataset.until).getTime() - Date.now();
  if (left <= 0) { el.textContent = 'Hold has run out'; el.classList.add('late'); return; }
  const m = Math.round(left / 60000);
  el.textContent = `Held ${m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'} more (until ${timeLabel(el.dataset.until)})`;
  el.classList.toggle('late', m < 15);
}

function orderCard(o) {
  const items = [...o.order_items].sort((a, b) => a.id - b.id);
  const place = o.delivery_method === 'courier' ? `${o.town}${o.courier ? ' · ' + o.courier : ''}` : o.location === 'shop' ? 'In the shop' : 'Lusaka';
  const feeUnknown = o.delivery_method === 'courier' && o.delivery_fee === null;
  const feeOpen = o.delivery_method === 'courier' && ['held', 'confirmed', 'paid', 'packed'].includes(o.status) && can('sales');
  const actions = (NEXT[o.status] || []).map(([s, label, cls]) =>
    `<button class="btn small ${cls}" data-status="${s}" data-id="${o.id}">${label}</button>`).join('');
  const canCancel = !['cancelled', 'expired', 'delivered'].includes(o.status);
  const canSticker = ['paid', 'packed', 'sent'].includes(o.status) && o.channel === 'online';
  const count = items.reduce((n, it) => n + it.qty, 0);
  const colors = ['#f9ddea', '#dce6f6', '#e8f5c8', '#fef0c7', '#fde1d3'];
  const color = colors[(o.customer_name || '?').charCodeAt(0) % colors.length];
  return `
    <article class="order" data-id="${o.id}">
      <div class="head">
        <span class="av" style="background:${color}" aria-hidden="true">${esc((o.customer_name || '?').trim()[0]?.toUpperCase() || '?')}</span>
        <div class="who-line">
          <b>${esc(o.customer_name)}</b> <span class="when">· ${ago(o.created_at)}</span>
          <div>${count} toy${count === 1 ? '' : 's'} · <b>${kwacha(o.total)}</b> · ${esc(place)}</div>
        </div>
        ${canSticker ? `<label class="sel"><input type="checkbox" data-pick="${o.id}" ${picked.has(o.id) ? 'checked' : ''}> Sticker</label>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span><span class="code">${esc(o.code)}</span>
        ${o.status === 'held' && o.hold_until ? `<span class="hold" style="margin:0" data-until="${o.hold_until}"></span>` : ''}
      </div>
      <details><summary>Details · ${dateLabel(o.created_at)}</summary>
      <div class="who">
        <div><b>Name</b> ${esc(o.customer_name)}</div>
        ${o.phone ? `<div><b>Phone</b> <a href="${esc(waLink(o.phone, `Hi ${o.customer_name}, thank you for your All Seazons order ${o.code}!`))}" target="_blank" rel="noopener">${esc(o.phone)} (WhatsApp)</a></div>` : ''}
        <div><b>Delivery</b> ${esc(METHOD_LABEL[o.delivery_method] || '')} · ${esc(place)}${o.parcel_size && o.delivery_method === 'courier' ? ` · ${esc(o.parcel_size)} parcel` : ''}</div>
        ${o.address ? `<div><b>Address</b> ${esc(o.address)}</div>` : ''}
        ${o.note ? `<div><b>Note</b> ${esc(o.note)}</div>` : ''}
      </div>
      </details>
      <div class="things">${items.map((it) => `
        <div class="thing"><img src="${esc(imageUrl(it.image_path))}" alt="" loading="lazy">
          <div>${esc(it.name)}${it.qty > 1 ? ' ×' + it.qty : ''}</div><div style="color:var(--muted)">${esc(CONDITIONS[it.condition] || '')} · ${kwacha(it.price * it.qty)}</div></div>`).join('')}
      </div>
      <div class="money">
        <span>Toys ${kwacha(o.subtotal)} <small>(sale)</small></span>
        <span>Delivery ${feeUnknown ? '<b class="warn-text">not set</b>' : o.delivery_fee ? `${kwacha(o.delivery_fee)} <small>(to courier)</small>` : o.delivery_method === 'yango' ? 'paid to driver' : 'free'}</span>
        <strong>Customer pays ${kwacha(o.total)}${feeUnknown ? ' + courier' : ''}</strong>
      </div>
      ${feeOpen ? feeBox(o) : ''}
      <div class="row-actions">
        ${canCancel ? `<button class="btn small danger" data-status="cancelled" data-id="${o.id}">Cancel</button>` : ''}
        ${canSticker ? `<a class="btn small ghost" href="sticker.html?ids=${o.id}" target="_blank" rel="noopener">Print sticker</a>` : ''}
        ${actions}
      </div>
    </article>`;
}

// Courier fee: Platinum charges by parcel size, so whoever confirms the
// order picks the size (or types the fee). It is passed on to the
// courier and never counted as a sale.
const SIZES = ['small', 'medium', 'large'];
function feeBox(o) {
  const town = (towns || []).find((t) => t.name === o.town);
  const pack = Number(shared.settings?.packaging_fee ?? 0);
  const sizes = SIZES.map((size) => {
    const f = town?.['fee_' + size];
    const fee = f === null || f === undefined ? null : Number(f) + pack;
    return fee === null ? '' : `<button type="button" class="chip" data-size="${size}" data-fee-for="${o.id}" data-amount="${fee}"
      aria-pressed="${o.parcel_size === size && o.delivery_fee === fee}">${size[0].toUpperCase() + size.slice(1)} ${kwacha(fee)}</button>`;
  }).join('');
  return `<div class="fee-box">
      <div><b>Courier fee</b> ${o.delivery_fee === null
        ? `<span class="warn-text">pick the parcel size${o.delivery_estimate ? ` (checkout said about ${kwacha(o.delivery_estimate)})` : ''}</span>`
        : `${kwacha(o.delivery_fee)}${o.parcel_size ? ` · ${esc(o.parcel_size)} parcel` : ''}`}</div>
      <div class="seg">${sizes}
        <input type="number" min="0" inputmode="numeric" placeholder="Other K" data-fee-input="${o.id}" aria-label="Type the courier fee">
        <button type="button" class="btn small ghost" data-fee-save="${o.id}">Set</button>
      </div>
      <small>${sizes && pack ? `Sizes include ${kwacha(pack)} packing and drop-off. ` : ''}Delivery money goes to the courier, so it is not counted in sales.</small>
    </div>`;
}

async function setFee(o, fee, size, button) {
  busy(button, true);
  const { error } = await supabase.rpc('set_delivery_fee', { p_order: o.id, p_fee: fee, p_size: size });
  busy(button, false);
  if (error) return toast(friendlyError(error), true);
  toast(`${o.code}: courier fee ${kwacha(fee)}, customer pays ${kwacha(o.subtotal + fee)}`);
  await load();
}

function render() {
  if (!root) return;
  const stickerIds = [...picked].join(',');
  root.innerHTML = `
    <div class="page-head">
      <h1>Inbox</h1>
      ${can('sales') ? '<a class="btn small ghost" href="#sale">Shop sale</a><a class="btn small ghost" href="#sale?wa">WhatsApp order</a>' : ''}
      ${picked.size ? `<a class="btn" href="sticker.html?ids=${stickerIds}" target="_blank" rel="noopener">Print ${picked.size} sticker${picked.size > 1 ? 's' : ''}</a>` : ''}
    </div>
    <div class="view-switch" role="tablist">
      <button role="tab" data-view="inbox" aria-selected="${view === 'inbox'}">To do</button>
      <button role="tab" data-view="history" aria-selected="${view === 'history'}">Order history</button>
    </div>
    <div class="toolbar"><input type="search" id="oq" placeholder="Search order, name, phone or town" value="${esc(q)}"></div>
    <div class="stack">${GROUPS[view].map((key) => {
      const label = SECTION_LABEL[key] || TABS.find((x) => x.key === key).label;
      const open = tab === key;
      return `<section class="stack-sec ${open ? 'open' : ''}">
        <button class="stack-head" data-tab="${key}" aria-expanded="${open}">
          <span>${label}</span><b class="n">${counts[key] || 0}</b><span class="chev" aria-hidden="true">${open ? '▴' : '▾'}</span>
        </button>
        ${open ? `<div class="orders">${orders.map(orderCard).join('') || '<p class="none">Nothing here right now.</p>'}</div>` : ''}
      </section>`;
    }).join('')}</div>`;
  $$('.hold[data-until]', root).forEach(paintHold);
  wire();
}

function wire() {
  $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = tab === b.dataset.tab ? null : b.dataset.tab; load(); });
  $$('[data-view]', root).forEach((b) => b.onclick = () => {
    if (view === b.dataset.view) return;
    view = b.dataset.view;
    tab = GROUPS[view][0];
    load();
  });
  // Search runs on Search / Enter or when the box is left, never while typing.
  wireSearchBox($('#oq', root), (text) => { q = text; load(); });
  $$('[data-pick]', root).forEach((c) => c.onchange = () => {
    if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
    render();
  });
  $$('[data-status]', root).forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.status, b));
  $$('[data-fee-for]', root).forEach((b) => b.onclick = () =>
    setFee(orders.find((x) => x.id === b.dataset.feeFor), Number(b.dataset.amount), b.dataset.size, b));
  $$('[data-fee-save]', root).forEach((b) => b.onclick = () => {
    const o = orders.find((x) => x.id === b.dataset.feeSave);
    const fee = parseInt($(`[data-fee-input="${o.id}"]`, root).value, 10);
    if (!(fee >= 0)) return toast('Type the courier fee in kwacha.', true);
    setFee(o, fee, null, b);
  });
}

async function setStatus(id, status, button) {
  const o = orders.find((x) => x.id === id);
  if (status === 'cancelled' && !(await confirmBox(`Cancel ${o.code}? Its toys go back on sale.`, { ok: 'Cancel order', danger: true }))) return;
  if (status === 'paid' && o.delivery_method === 'courier' && o.delivery_fee === null
    && !(await confirmBox(`The courier fee for ${o.code} is not set yet. Mark it paid anyway?`, { ok: 'Mark paid' }))) return;
  busy(button, true);
  const { error } = await supabase.rpc('set_order_status', { p_order: id, p_status: status });
  if (error) { busy(button, false); return toast(friendlyError(error), true); }
  toast(`${o.code}: ${STATUS_LABEL[status]}`);
  if (!['paid', 'packed', 'sent'].includes(status)) picked.delete(id);
  await load();
  refreshBadges();
}
