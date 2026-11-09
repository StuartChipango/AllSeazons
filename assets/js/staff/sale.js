// Shop sale and WhatsApp order: tap the toys, then finish in one panel.
// A shop sale is paid now; a WhatsApp order holds the toys like a website order.
import { esc, kwacha, effectivePrice, waLink, PAYMENTS, timeLabel } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { refreshBadges } from './app.js';
import { $, $$, openPanel, busy } from './ui.js';

const COLS = 'id,code,name,price,sale_price,status,quantity,condition,thumb_path,photo_path,image_path';
const SHOW = 60;
let root = null;
let mode = 'shop';
let toys = [];
let towns = [];
let q = '';
const picked = new Set();

export async function show(main) {
  root = main;
  mode = location.hash.includes('?wa') ? 'wa' : 'shop';
  const [t, w] = await Promise.all([
    supabase.from('toys').select(COLS).eq('status', 'available').order('approved_at', { ascending: false, nullsFirst: false }).limit(2000),
    mode === 'wa' ? supabase.from('towns').select('id,name').eq('active', true).order('name') : { data: [] },
  ]);
  if (t.error) throw t.error;
  toys = t.data || [];
  towns = w.data || [];
  for (const id of [...picked]) if (!toys.some((x) => x.id === id)) picked.delete(id);
  render();
}
export function leave() { if (root) root.onclick = null; root = null; }

const thumb = (t) => imageUrl(t.thumb_path || t.photo_path || t.image_path);
const chosen = () => toys.filter((t) => picked.has(t.id));
const total = () => chosen().reduce((s, t) => s + effectivePrice(t), 0);

function matches(t) {
  if (!q) return true;
  const hay = `${t.name} ${t.code}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function gridHtml() {
  // Picked toys stay on top so they are easy to un-pick.
  const list = [...chosen(), ...toys.filter((t) => !picked.has(t.id) && matches(t))].slice(0, SHOW);
  return list.map((t) => `
    <button type="button" class="pick" data-pick="${t.id}" aria-pressed="${picked.has(t.id)}">
      <img src="${esc(thumb(t))}" alt="" loading="lazy" decoding="async" width="160" height="160">
      <div>${esc(t.name)}<b>${kwacha(effectivePrice(t))}</b></div>
    </button>`).join('') || '<p class="lead">No toys match.</p>';
}

function barHtml() {
  const n = picked.size;
  return n ? `<span>${n} toy${n === 1 ? '' : 's'} · ${kwacha(total())}</span>
    <button class="btn small" id="next" type="button">${mode === 'wa' ? 'Customer details' : 'Take payment'}</button>` : '';
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <div class="page-head"><a class="back" href="#orders" aria-label="Back">‹</a>
      <h1>${mode === 'wa' ? 'WhatsApp order' : 'Shop sale'}</h1></div>
    <p class="lead">${mode === 'wa' ? 'Tap the toys the customer asked for. They are held for them until they pay.' : 'Tap the toys the customer is buying. Search by name or the code on the tag.'}</p>
    <div class="toolbar"><input type="search" id="pq" placeholder="Search name or code" value="${esc(q)}" autocomplete="off"></div>
    <div class="pick-grid" id="pickGrid">${gridHtml()}</div>
    <div class="sale-bar" id="saleBar" ${picked.size ? '' : 'hidden'}>${barHtml()}</div>
    <div style="height:90px"></div>`;
  let timer;
  $('#pq', root).oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = e.target.value.trim(); $('#pickGrid', root).innerHTML = gridHtml(); }, 120);
  };
  root.onclick = (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) {
      const id = b.dataset.pick;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      b.setAttribute('aria-pressed', String(picked.has(id)));
      const bar = $('#saleBar', root);
      bar.innerHTML = barHtml();
      bar.hidden = !picked.size;
    } else if (e.target.closest('#next')) {
      if (mode === 'wa') waPanel(); else shopSale();
    }
  };
}

async function shopSale() {
  const { sellPanel } = await import('./inventory.js');
  sellPanel(chosen(), () => { picked.clear(); refreshBadges(); location.hash = '#orders'; });
}

function waPanel() {
  const list = chosen();
  const body = openPanel(`
    <h2>WhatsApp order</h2>
    <p class="lead" style="margin:0 0 12px">${list.length} toy${list.length === 1 ? '' : 's'} · ${kwacha(total())}</p>
    <form id="waForm">
      <label class="field"><span>Customer name</span><input type="text" name="name" required autocomplete="off"></label>
      <label class="field"><span>WhatsApp number</span><input type="tel" name="phone" inputmode="tel" required autocomplete="off"></label>
      <div class="field"><span>How do they get it?</span>
        <div class="seg">
          <button type="button" class="chip" data-how="pickup" aria-pressed="true">Pickup</button>
          <button type="button" class="chip" data-how="yango" aria-pressed="false">Lusaka delivery</button>
          <button type="button" class="chip" data-how="courier" aria-pressed="false">Other town</button>
        </div>
      </div>
      <label class="field" data-for="courier" hidden><span>Town</span><select name="town_id"><option value="">Choose the town</option>${towns.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field" data-for="yango courier" hidden><span>Address (optional)</span><input type="text" name="address"></label>
      <p class="error-text" id="waErr" role="alert"></p>
      <button class="btn go block" type="submit">Hold the toys</button>
    </form>`);
  let how = 'pickup';
  $$('[data-how]', body).forEach((b) => b.onclick = () => {
    how = b.dataset.how;
    $$('[data-how]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $$('[data-for]', body).forEach((f) => { f.hidden = !f.dataset.for.split(' ').includes(how); });
  });
  $('#waForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.submitter;
    busy(btn, true, 'Holding…');
    const customer = {
      name: String(f.get('name')).trim(), phone: String(f.get('phone')).trim(),
      location: how === 'courier' ? 'out_of_town' : 'lusaka', delivery_method: how,
      town_id: how === 'courier' ? f.get('town_id') : null,
      address: how === 'pickup' ? '' : String(f.get('address') || ''), note: 'Ordered on WhatsApp',
    };
    const { data, error } = await supabase.rpc('place_order', {
      p_items: list.map((t) => ({ toy_id: t.id, qty: 1 })), p_customer: customer,
    });
    busy(btn, false);
    if (error) { $('#waErr', body).textContent = friendlyError(error); return; }
    picked.clear();
    refreshBadges();
    const pay = Object.values(PAYMENTS).filter((p) => customer.delivery_method === 'pickup' || p !== PAYMENTS.cash).map((p) => `- ${p.how}`).join('\n');
    const msg = [
      `Hi ${customer.name}! Your All Seazons order ${data.code} is held for you until ${timeLabel(data.hold_until)}.`, '',
      ...(data.items || []).map((it, i) => `${i + 1}. ${it.name} - ${kwacha(it.price * (it.qty || 1))}`), '',
      `*Total: ${kwacha(data.total)}*${data.delivery_method === 'courier' && data.delivery_fee == null ? ' + courier fee' : ''}`, '',
      'You can pay with:', pay, '',
      'Send us the payment message and we will get your toys ready. Thank you!',
    ].join('\n');
    body.innerHTML = `
      <h2>Held: ${esc(data.code)}</h2>
      <p>The toys are held until <b>${esc(timeLabel(data.hold_until))}</b>. Send ${esc(customer.name)} the summary and how to pay.</p>
      <a class="btn wa block" href="${esc(waLink(customer.phone, msg))}" target="_blank" rel="noopener">Send summary on WhatsApp</a>
      <div class="row-actions" style="margin-top:12px"><a class="btn ghost" href="#orders" data-close-panel>Go to Inbox</a></div>`;
    show(root);
  };
}

