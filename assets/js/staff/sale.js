// Shop sale and WhatsApp order: tap the toys, then finish in one panel.
// A shop sale is paid now; a WhatsApp order holds the toys like a website order.
// Every toy in the shop is listed (search and type chips to find one), and
// staff can mark a toy sold out here and relist it when new stock comes in.
import { esc, kwacha, effectivePrice, waLink, PAYMENTS, timeLabel, isNewStock } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { refreshBadges, shared, can } from './app.js';
import { $, $$, openPanel, closePanel, busy, toast } from './ui.js';

// Tiles are added in pages as you scroll, so a long list stays quick.
const PAGE = 90;
const SOLD_OUT = '__soldout';
let root = null;
let mode = 'shop';
let toys = [];
let soldOut = [];
let towns = [];
let q = '';
let cat = '';
let shown = PAGE;
let watcher = null;
const picked = new Set();

async function all(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function show(main) {
  root = main;
  mode = location.hash.includes('?wa') ? 'wa' : 'shop';
  const [t, s, w] = await Promise.all([
    all(() => supabase.from('toys').select('*').eq('status', 'available')
      .order('approved_at', { ascending: false, nullsFirst: false }).order('id')),
    supabase.from('toys').select('*').eq('status', 'sold').not('image_path', 'is', null)
      .order('sold_at', { ascending: false, nullsFirst: false }).limit(500),
    mode === 'wa' ? supabase.from('towns').select('id,name').eq('active', true).order('name') : { data: [] },
  ]);
  toys = t;
  soldOut = s.data || [];
  towns = w.data || [];
  for (const id of [...picked]) if (!toys.some((x) => x.id === id)) picked.delete(id);
  render();
}
export function leave() {
  if (root) root.onclick = null;
  watcher?.disconnect();
  root = null;
}

const thumb = (t) => imageUrl(t.thumb_path || t.photo_path || t.image_path);
const chosen = () => toys.filter((t) => picked.has(t.id));
const total = () => chosen().reduce((s, t) => s + effectivePrice(t), 0);
const short = (label) => label.split(/\s*[&,/]\s*/)[0];

function matchesSearch(t) {
  if (!q) return true;
  const hay = `${t.name} ${t.code} ${t.brand || ''} ${t.category || ''} ${t.legacy_id || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function listNow() {
  if (cat === SOLD_OUT) return soldOut.filter(matchesSearch);
  return toys.filter((t) => matchesSearch(t) && (!cat || t.category === cat));
}

// One small row of chips: All, each toy type that has toys, then Sold out.
function chipsHtml() {
  const counts = new Map();
  let n = 0;
  for (const t of toys) {
    if (!matchesSearch(t)) continue;
    n++;
    if (t.category) counts.set(t.category, (counts.get(t.category) || 0) + 1);
  }
  const known = shared.categories.filter((c) => counts.has(c) || c === cat);
  const extra = [...counts.keys()].filter((c) => !known.includes(c));
  const chip = (value, label, k) => `<button type="button" class="chip" data-cat="${esc(value)}" aria-pressed="${cat === value}">${esc(label)} <b>${k}</b></button>`;
  const sold = soldOut.filter(matchesSearch).length;
  return chip('', 'All', n)
    + [...known, ...extra].map((c) => chip(c, short(c), counts.get(c) || 0)).join('')
    + chip(SOLD_OUT, 'Sold out', sold);
}

function tileHtml(t) {
  const out = cat === SOLD_OUT;
  const tag = isNewStock(t) ? '<span class="stock-tag">New stock</span>' : '';
  if (out) {
    return `
    <div class="pick-cell">
      <button type="button" class="pick is-out" data-relist="${t.id}">
        <img src="${esc(thumb(t))}" alt="" loading="lazy" decoding="async" width="160" height="160">
        <div>${esc(t.name)}<b>${kwacha(effectivePrice(t))}</b><em>Relist</em></div>
      </button>
    </div>`;
  }
  return `
    <div class="pick-cell">
      <button type="button" class="pick" data-pick="${t.id}" aria-pressed="${picked.has(t.id)}">
        ${tag}<img src="${esc(thumb(t))}" alt="" loading="lazy" decoding="async" width="160" height="160">
        <div>${esc(t.name)}<b>${kwacha(effectivePrice(t))}</b>${t.quantity > 1 ? `<small>${t.quantity} left</small>` : ''}</div>
      </button>
      <button type="button" class="pick-more" data-more="${t.id}" aria-label="More for ${esc(t.name)}: mark sold out">⋯</button>
    </div>`;
}

function gridHtml() {
  const list = listNow();
  // Picked toys stay on top so they are easy to un-pick.
  const ordered = cat === SOLD_OUT ? list : [...chosen(), ...list.filter((t) => !picked.has(t.id))];
  const empty = cat === SOLD_OUT
    ? '<p class="lead">No sold out toys. When a toy runs out, tap ⋯ on it and choose Sold out.</p>'
    : '<p class="lead">No toys match.</p>';
  return ordered.slice(0, shown).map(tileHtml).join('') || empty;
}

function countHtml() {
  const n = listNow().length;
  if (cat === SOLD_OUT) return `${n} sold out toy${n === 1 ? '' : 's'}. Tap one to put it back in the shop.`;
  return `${n} toy${n === 1 ? '' : 's'} in the shop${q || cat ? ' match' : ''}`;
}

function barHtml() {
  const n = picked.size;
  return n ? `<span>${n} toy${n === 1 ? '' : 's'} · ${kwacha(total())}</span>
    <button class="btn small" id="next" type="button">${mode === 'wa' ? 'Customer details' : 'Take payment'}</button>` : '';
}

function refresh({ chips = true } = {}) {
  if (!root) return;
  shown = PAGE;
  if (chips) $('#saleChips', root).innerHTML = chipsHtml();
  $('#pickCount', root).textContent = countHtml();
  $('#pickGrid', root).innerHTML = gridHtml();
  watchEnd();
}

// Add the next page of tiles when the end of the list comes into view.
function watchEnd() {
  watcher?.disconnect();
  const end = $('#pickEnd', root);
  if (!end || listNow().length <= shown) return;
  watcher = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting) || !root) return;
    shown += PAGE;
    $('#pickGrid', root).innerHTML = gridHtml();
    if (listNow().length <= shown) watcher.disconnect();
  }, { rootMargin: '600px' });
  watcher.observe(end);
}

function render() {
  if (!root) return;
  shown = PAGE;
  root.innerHTML = `
    <div class="page-head"><a class="back" href="#orders" aria-label="Back">‹</a>
      <h1>${mode === 'wa' ? 'WhatsApp order' : 'Shop sale'}</h1></div>
    <p class="lead">${mode === 'wa' ? 'Tap the toys the customer asked for. They are held for them until they pay.' : 'Tap the toys the customer is buying. Search by name or the code on the tag.'}</p>
    <div class="toolbar sale-search"><input type="search" id="pq" placeholder="Search name or code" value="${esc(q)}" autocomplete="off"></div>
    <div class="chip-row" id="saleChips" role="group" aria-label="Toy type">${chipsHtml()}</div>
    <p class="pick-count" id="pickCount">${countHtml()}</p>
    <div class="pick-grid" id="pickGrid">${gridHtml()}</div>
    <div id="pickEnd"></div>
    <div class="sale-bar" id="saleBar" ${picked.size ? '' : 'hidden'}>${barHtml()}</div>
    <div style="height:90px"></div>`;
  let timer;
  $('#pq', root).oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { q = e.target.value.trim(); refresh(); }, 150);
  };
  watchEnd();
  root.onclick = (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) {
      cat = cat === c.dataset.cat && c.dataset.cat ? '' : c.dataset.cat;
      $$('[data-cat]', root).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cat === cat)));
      refresh({ chips: false });
      return;
    }
    const more = e.target.closest('[data-more]');
    if (more) return soldOutPanel(toys.find((t) => t.id === more.dataset.more));
    const re = e.target.closest('[data-relist]');
    if (re) return relistPanel(soldOut.find((t) => t.id === re.dataset.relist), () => show(root));
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

const noFunction = (error) => /toy_sold_out|toy_relist|function|schema cache/i.test(error?.message || '') && error?.code !== 'P0001';

function soldOutPanel(t) {
  if (!t) return;
  const body = openPanel(`
    <div class="toy-head"><img src="${esc(thumb(t))}" alt="" width="72" height="72">
      <div><h2>${esc(t.name)}</h2><p class="lead" style="margin:0">${esc(t.code)} · ${kwacha(effectivePrice(t))}${t.quantity > 1 ? ` · ${t.quantity} left` : ''}</p></div></div>
    <p>None left in the shop? Mark it sold out. On the website it moves to the Sold toys, so nobody can order it. When more come in, open <b>Sold out</b> here and tap it to relist it with a <b>New stock</b> tag.</p>
    <p class="error-text" id="soErr" role="alert"></p>
    <div class="row-actions">
      <button class="btn ghost" type="button" data-close-panel>Go back</button>
      <button class="btn danger" type="button" id="doSoldOut">Mark sold out</button>
    </div>`);
  $('#doSoldOut', body).onclick = async (e) => {
    busy(e.target, true, 'Saving…');
    const { error } = await supabase.rpc('toy_sold_out', { p_toy: t.id });
    if (error) {
      busy(e.target, false);
      $('#soErr', body).textContent = noFunction(error)
        ? 'The database needs the latest update first. Ask the owner to run the new schema in Supabase.'
        : friendlyError(error);
      return;
    }
    picked.delete(t.id);
    closePanel();
    toast(`${t.name} marked sold out`);
    refreshBadges();
    show(root);
  };
}

// Also used by the Stock page for a sold toy.
export function relistPanel(t, done) {
  if (!t) return;
  const priceOk = can('stock');
  const body = openPanel(`
    <div class="toy-head"><img src="${esc(thumb(t))}" alt="" width="72" height="72">
      <div><h2>Relist ${esc(t.name)}</h2><p class="lead" style="margin:0">${esc(t.code)}</p></div></div>
    <p>Puts it back in the shop and on the website with a small <span class="stock-tag inline">New stock</span> tag for 14 days.</p>
    <form id="relistForm">
      <div class="field"><span>How many came in?</span>
        <div class="stepper"><button type="button" class="btn ghost small" data-step="-1" aria-label="One less">−</button>
          <input type="number" name="qty" min="1" value="1" inputmode="numeric" aria-label="How many">
          <button type="button" class="btn ghost small" data-step="1" aria-label="One more">+</button></div></div>
      <label class="field"><span>Price (K)</span><input type="number" name="price" min="0" value="${t.price}" inputmode="numeric" ${priceOk ? '' : 'disabled'}>
        ${priceOk ? '' : '<small>Only Stock staff can change the price.</small>'}</label>
      <p class="error-text" id="reErr" role="alert"></p>
      <button class="btn go block" type="submit">Relist as new stock</button>
    </form>`);
  const qty = $('[name=qty]', body);
  $$('[data-step]', body).forEach((b) => b.onclick = () => {
    qty.value = Math.max(1, (parseInt(qty.value, 10) || 1) + Number(b.dataset.step));
  });
  $('#relistForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const n = parseInt(qty.value, 10) || 0;
    const price = parseInt($('[name=price]', body).value, 10);
    busy(btn, true, 'Relisting…');
    const { error } = await supabase.rpc('toy_relist', {
      p_toy: t.id, p_qty: n, p_price: priceOk && Number.isFinite(price) && price !== t.price ? price : null,
    });
    if (error) {
      busy(btn, false);
      $('#reErr', body).textContent = noFunction(error)
        ? 'The database needs the latest update first. Ask the owner to run the new schema in Supabase.'
        : friendlyError(error);
      return;
    }
    closePanel();
    toast(`${t.name} is back in the shop as new stock`);
    refreshBadges();
    done?.();
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

