import { esc, kwacha, METHOD_LABEL, CONDITIONS, waLink, timeLabel } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { refreshBadges } from './app.js';
import { $, $$, toast, confirmBox, ago, dateLabel, busy } from './ui.js';

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
  held: [['confirmed', 'Confirm (keep holding)', 'ghost'], ['paid', 'Mark paid', '']],
  confirmed: [['paid', 'Mark paid', '']],
  paid: [['packed', 'Mark packed', '']],
  packed: [['sent', 'Mark sent', '']],
  sent: [['delivered', 'Mark delivered', '']],
  cancelled: [['held', 'Reopen', 'ghost']],
  expired: [['held', 'Reopen', 'ghost'], ['paid', 'Mark paid', '']],
};

let root = null;
let tab = 'open';
let q = '';
let orders = [];
let counts = {};
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
  const t = TABS.find((x) => x.key === tab);
  let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: tab === 'open' || tab === 'paid' });
  query = tab === 'shop' ? query.eq('channel', 'shop') : query.in('status', t.statuses).eq('channel', 'online');
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ').trim();
    query = query.or(`code.ilike.%${safe}%,customer_name.ilike.%${safe}%,phone.ilike.%${safe}%,town.ilike.%${safe}%`);
  }
  const [{ data, error }, ...countRes] = await Promise.all([
    query.limit(200),
    ...TABS.map((x) => supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', x.statuses).eq('channel', 'online')),
  ]);
  if (error) throw error;
  orders = data;
  counts = Object.fromEntries(TABS.map((x, i) => [x.key, countRes[i].count || 0]));
  render();
}

function paintHold(el) {
  const left = new Date(el.dataset.until).getTime() - Date.now();
  if (left <= 0) { el.textContent = 'Hold has run out'; el.classList.add('late'); return; }
  const m = Math.round(left / 60000);
  el.textContent = `Held until ${timeLabel(el.dataset.until)} (${m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'} left)`;
  el.classList.toggle('late', m < 15);
}

function orderCard(o) {
  const items = [...o.order_items].sort((a, b) => a.id - b.id);
  const place = o.delivery_method === 'courier' ? `${o.town}${o.courier ? ' · ' + o.courier : ''}` : o.location === 'shop' ? 'In the shop' : 'Lusaka';
  const feeUnknown = o.delivery_method === 'courier' && o.delivery_fee === null;
  const actions = (NEXT[o.status] || []).map(([s, label, cls]) =>
    `<button class="btn small ${cls}" data-status="${s}" data-id="${o.id}">${label}</button>`).join('');
  const canCancel = !['cancelled', 'expired', 'delivered'].includes(o.status);
  const canSticker = ['paid', 'packed', 'sent'].includes(o.status) && o.channel === 'online';
  return `
    <article class="order" data-id="${o.id}">
      <div class="head">
        <span class="code">${esc(o.code)}</span>
        <span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span>
        <span class="when">${ago(o.created_at)} · ${dateLabel(o.created_at)}</span>
        ${canSticker ? `<label class="sel"><input type="checkbox" data-pick="${o.id}" ${picked.has(o.id) ? 'checked' : ''}> Sticker</label>` : ''}
      </div>
      ${o.status === 'held' && o.hold_until ? `<div class="hold" data-until="${o.hold_until}"></div>` : ''}
      <div class="who">
        <div><b>Name</b> ${esc(o.customer_name)}</div>
        ${o.phone ? `<div><b>Phone</b> <a href="${esc(waLink(o.phone, `Hi ${o.customer_name}, thank you for your All Seazons order ${o.code}!`))}" target="_blank" rel="noopener">${esc(o.phone)} (WhatsApp)</a></div>` : ''}
        <div><b>Delivery</b> ${esc(METHOD_LABEL[o.delivery_method] || '')} · ${esc(place)}${o.parcel_size && o.delivery_method === 'courier' ? ` · ${esc(o.parcel_size)} parcel` : ''}</div>
        ${o.address ? `<div><b>Address</b> ${esc(o.address)}</div>` : ''}
        ${o.note ? `<div><b>Note</b> ${esc(o.note)}</div>` : ''}
      </div>
      <div class="things">${items.map((it) => `
        <div class="thing"><img src="${esc(imageUrl(it.image_path))}" alt="" loading="lazy">
          <div>${esc(it.name)}${it.qty > 1 ? ' ×' + it.qty : ''}</div><div style="color:var(--muted)">${esc(CONDITIONS[it.condition] || '')} · ${kwacha(it.price * it.qty)}</div></div>`).join('')}
      </div>
      <div class="money">
        <span>Toys ${kwacha(o.subtotal)}</span>
        <span>Delivery ${feeUnknown ? `<input type="number" min="0" placeholder="Set fee" data-fee="${o.id}" style="width:110px;min-height:30px;padding:2px 8px">` : o.delivery_fee ? kwacha(o.delivery_fee) : o.delivery_method === 'yango' ? 'paid to driver' : 'free'}</span>
        <strong>Total ${kwacha(o.total)}${feeUnknown ? ' + courier' : ''}</strong>
      </div>
      <div class="row-actions">
        ${canCancel ? `<button class="btn small danger" data-status="cancelled" data-id="${o.id}">Cancel</button>` : ''}
        ${canSticker ? `<a class="btn small ghost" href="sticker.html?ids=${o.id}" target="_blank" rel="noopener">Print sticker</a>` : ''}
        ${actions}
      </div>
    </article>`;
}

function render() {
  if (!root) return;
  const stickerIds = [...picked].join(',');
  root.innerHTML = `
    <div class="page-head">
      <h1>Orders</h1>
      ${picked.size ? `<a class="btn" href="sticker.html?ids=${stickerIds}" target="_blank" rel="noopener">Print ${picked.size} sticker${picked.size > 1 ? 's' : ''}</a>` : ''}
    </div>
    <div class="otabs">
      ${TABS.map((t) => `<button class="chip" data-tab="${t.key}" aria-pressed="${tab === t.key}">${t.label} <b>${counts[t.key] || 0}</b></button>`).join('')}
      <button class="chip" data-tab="shop" aria-pressed="${tab === 'shop'}">Shop sales</button>
    </div>
    <div class="toolbar"><input type="search" id="oq" placeholder="Search order, name, phone or town" value="${esc(q)}"></div>
    <div class="orders">${orders.map(orderCard).join('') || '<div class="card-box">No orders here.</div>'}</div>`;
  $$('.hold[data-until]', root).forEach(paintHold);
  wire();
}

function wire() {
  $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; load(); });
  let t;
  $('#oq', root).oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { q = e.target.value.trim(); await load(); const i = $('#oq', root); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 350); };
  $$('[data-pick]', root).forEach((c) => c.onchange = () => {
    if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
    render();
  });
  $$('[data-status]', root).forEach((b) => b.onclick = () => setStatus(b.dataset.id, b.dataset.status, b));
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
