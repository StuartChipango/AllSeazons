import { esc, kwacha, METHOD_LABEL, CONDITIONS, waLink, timeLabel, waitLabel } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { refreshBadges, can } from './app.js';
import { $, $$, toast, confirmBox, ago, dateLabel, busy, openPanel, closePanel } from './ui.js';
import { loadAlerts, alertsHtml, wireAlerts, sendReminder, clearFlag } from './waiting.js';

const TABS = [
  { key: 'open', label: 'To confirm', statuses: ['held', 'confirmed'] },
  { key: 'paid', label: 'To pack', statuses: ['paid'] },
  { key: 'packed', label: 'Packed, waiting', statuses: ['packed'] },
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
const picked = new Set();
let ticker;
let alerts = [];

export async function show(main) {
  root = main;
  await load();
  clearInterval(ticker);
  ticker = setInterval(() => $$('.hold[data-until]', root || document).forEach(paintHold), 30_000);
}
export function leave() { root = null; clearInterval(ticker); }

// storage_info comes with the newer database file; without it the Inbox still works.
let withInfo = true;

async function load() {
  await supabase.rpc('release_expired_holds');
  if (!tab) { orders = []; alerts = view === 'inbox' ? await loadAlerts() : []; render(); return; }
  const t = TABS.find((x) => x.key === tab);
  const fields = withInfo ? '*, order_items(*), storage_info' : '*, order_items(*)';
  let query = supabase.from('orders').select(fields).order('created_at', { ascending: tab === 'open' || tab === 'paid' });
  query = tab === 'shop' ? query.eq('channel', 'shop') : query.in('status', t.statuses).eq('channel', 'online');
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ').trim();
    query = query.or(`code.ilike.%${safe}%,customer_name.ilike.%${safe}%,phone.ilike.%${safe}%,town.ilike.%${safe}%`);
  }
  const [{ data, error }, alertList, ...countRes] = await Promise.all([
    query.limit(200),
    view === 'inbox' ? loadAlerts() : [],
    ...TABS.map((x) => supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', x.statuses).eq('channel', 'online')),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('channel', 'shop'),
  ]);
  if (error && withInfo) { withInfo = false; return load(); } // database file not run yet
  if (error) throw error;
  orders = data;
  alerts = alertList;
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
  const info = o.storage_info || {};
  const waits = o.status === 'packed' && info.waits;
  const actions = waits
    ? `<button class="btn small go" data-collect="${o.id}">${o.delivery_method === 'yango' ? 'Handed to driver' : 'Collected'}</button>`
    : (NEXT[o.status] || []).map(([s, label, cls]) =>
      `<button class="btn small ${cls}" data-status="${s}" data-id="${o.id}">${label}</button>`).join('');
  const nudge = waits && o.phone ? (info.remind_due ? 'remind' : info.notice_due ? 'notice' : info.fee > 0 ? 'fee' : '') : '';
  const NUDGE = { remind: 'Send kind reminder', notice: 'Send storage fee notice', fee: 'Send storage update' };
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
        ${waits ? `<span class="wait ${info.stage}">Waiting ${waitLabel(info.hours)}${info.fee ? ` · storage ${kwacha(info.fee)}` : ''}</span>` : ''}
        ${waits && (o.reminded_at || o.fee_notice_at) ? `<span class="when">${o.fee_notice_at ? 'Fee notice sent' : 'Reminded'} ${ago(o.fee_notice_at || o.reminded_at)}</span>` : ''}
      </div>
      ${o.flag ? `<p class="flag-line">⚠️ ${esc(o.flag)} <button class="btn small ghost" data-unflag="${o.id}">Sorted</button></p>` : ''}
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
        <span>Toys ${kwacha(o.subtotal)}</span>
        <span>Delivery ${feeUnknown ? `<input type="number" min="0" placeholder="Set fee" data-fee="${o.id}" style="width:110px;min-height:30px;padding:2px 8px">` : o.delivery_fee ? kwacha(o.delivery_fee) : o.delivery_method === 'yango' ? 'paid to driver' : 'free'}</span>
        ${o.storage_fee ? `<span>Storage ${kwacha(o.storage_fee)}</span>` : ''}
        <strong>Total ${kwacha(o.total)}${feeUnknown ? ' + courier' : ''}</strong>
      </div>
      <div class="row-actions">
        ${canCancel ? `<button class="btn small danger" data-status="cancelled" data-id="${o.id}">Cancel</button>` : ''}
        ${canSticker ? `<a class="btn small ghost" href="sticker.html?ids=${o.id}" target="_blank" rel="noopener">Print sticker</a>` : ''}
        ${nudge ? `<button class="btn small wa" data-nudge="${nudge}" data-id="${o.id}">${NUDGE[nudge]}</button>` : ''}
        ${actions}
      </div>
    </article>`;
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
    ${view === 'inbox' ? alertsHtml(alerts) : ''}
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
  let t;
  $('#oq', root).oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { q = e.target.value.trim(); await load(); const i = $('#oq', root); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 350); };
  $$('[data-pick]', root).forEach((c) => c.onchange = () => {
    if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
    render();
  });
  $$('[data-status]', root).forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.status, b));
  wireAlerts(root, alerts, load);
  $$('[data-collect]', root).forEach((b) => b.onclick = () => collectPanel(orders.find((x) => x.id === b.dataset.collect)));
  $$('.order [data-unflag]', root).forEach((b) => b.onclick = async () => { await clearFlag(b.dataset.unflag); load(); });
  $$('[data-nudge]', root).forEach((b) => b.onclick = async () => {
    await sendReminder(orders.find((x) => x.id === b.dataset.id), b.dataset.nudge);
    load();
  });
  $$('[data-fee]', root).forEach((i) => i.onchange = async () => {
    const fee = parseInt(i.value, 10);
    if (!(fee >= 0)) return;
    const o = orders.find((x) => x.id === i.dataset.fee);
    const { error } = await supabase.from('orders').update({ delivery_fee: fee, total: o.subtotal + fee }).eq('id', o.id);
    if (error) return toast(friendlyError(error), true);
    toast(`Courier fee set: new total ${kwacha(o.subtotal + fee)}`);
    load();
  });
}

async function setStatus(id, status, button) {
  const o = orders.find((x) => x.id === id);
  if (status === 'cancelled' && !(await confirmBox(`Cancel ${o.code}? Its toys go back on sale.`, { ok: 'Cancel order', danger: true }))) return;
  busy(button, true);
  const { error } = await supabase.rpc('set_order_status', { p_order: id, p_status: status });
  if (error) { busy(button, false); return toast(friendlyError(error), true); }
  toast(`${o.code}: ${STATUS_LABEL[status]}`);
  if (!['paid', 'packed', 'sent'].includes(status)) picked.delete(id);
  await load();
  refreshBadges();
}

// The customer is here (or the Yango driver): show what they still owe,
// storage included, then close the order.
function collectPanel(o) {
  const i = o.storage_info || {};
  const fee = i.fee || 0;
  const body = openPanel(`
    <h2>${esc(o.code)} · ${esc(o.customer_name)}</h2>
    <p class="lead" style="margin:0 0 6px">Waited ${waitLabel(i.hours)} since it was packed.</p>
    <table class="bill"><tbody>
      <tr><td>Toys${o.delivery_fee ? ' and delivery' : ''} (already paid)</td><td>${kwacha(o.total)}</td></tr>
      <tr><td>Storage${fee ? `: ${i.fee_days} day${i.fee_days === 1 ? '' : 's'} × ${kwacha(i.per_day)}` : ' (still in the free time)'}</td><td>${kwacha(fee)}</td></tr>
      <tr class="due"><td>To pay now</td><td>${kwacha(fee)}</td></tr>
    </tbody></table>
    <div class="row-actions">
      ${fee && can('owner') ? '<button class="btn ghost" data-waive>Let the fee go</button>' : ''}
      <button class="btn go" data-done>${fee ? `Paid ${kwacha(fee)}, hand over` : 'Hand over'}</button>
    </div>
    ${fee && !can('owner') ? '<p class="sub">Only the owner can let the storage fee go.</p>' : ''}`);
  const go = async (waive, button) => {
    busy(button, true, 'Saving…');
    const { data, error } = await supabase.rpc('collect_order', { p_order: o.id, p_waive: waive });
    if (error) { busy(button, false); return toast(friendlyError(error), true); }
    closePanel();
    toast(`${o.code}: ${data.status === 'delivered' ? 'collected' : 'handed to the driver'}${data.storage_fee ? `, storage ${kwacha(data.storage_fee)}` : ''}`);
    await load();
    refreshBadges();
  };
  $('[data-done]', body).onclick = (e) => go(false, e.target);
  const w = $('[data-waive]', body);
  if (w) w.onclick = (e) => go(true, e.target);
}
