import { supabase, imageUrl, friendlyError, configured } from './db.js';
import {
  esc, kwacha, effectivePrice, isSpecial, parcelSize, courierFee, waLink, orderMessage,
  priceBands, AUDIENCES, CONDITIONS, AGES, timeLabel,
} from './lib.js';

const TOY_COLUMNS = 'id,code,name,audience,condition,category,age_range,brand,description,price,sale_price,is_special,quantity,status,image_path,photo_path,created_at,approved_at,sold_at';
const $ = (sel) => document.querySelector(sel);

const state = {
  toys: [],
  sold: [],
  settings: { whatsapp_number: '', hold_minutes: 120, medium_from: 2, large_from: 5 },
  towns: [],
  bands: [],
  view: 'shop',
  filter: { audience: '', condition: '', band: -1, category: '', age: '', q: '', sort: 'new' },
  cart: load('as_cart', []),
  customer: load('as_customer', { location: 'lusaka', delivery_method: 'pickup' }),
  step: 'cart',
  lastOrder: null,
  busy: false,
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------- data

async function loadAll() {
  if (!configured) {
    $('#status').textContent = 'The shop is being set up. Please check back soon.';
    return;
  }
  supabase.rpc('release_expired_holds').then(() => {}, () => {});
  const [settings, towns, tiers, cats] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('towns').select('*').eq('active', true).order('name'),
    supabase.from('price_tiers').select('price').order('price'),
    supabase.from('categories').select('name').order('sort'),
  ]);
  if (settings.data) state.settings = settings.data;
  state.towns = towns.data || [];
  state.bands = priceBands((tiers.data || []).map((t) => t.price));
  setupFilters((cats.data || []).map((c) => c.name));
  if (state.settings.announcement) {
    $('#announce').textContent = state.settings.announcement;
    $('#announce').hidden = false;
  }
  $('#footWa').href = waLink(state.settings.whatsapp_number, 'Hi All Seazons!');
  await loadToys();
  openFromHash();
}

async function loadToys() {
  const [live, sold] = await Promise.all([
    supabase.from('toys').select(TOY_COLUMNS).in('status', ['available', 'reserved'])
      .order('approved_at', { ascending: false, nullsFirst: false }).limit(2000),
    supabase.from('toys').select(TOY_COLUMNS).eq('status', 'sold').not('image_path', 'is', null)
      .order('sold_at', { ascending: false, nullsFirst: false }).limit(400),
  ]);
  if (live.error) {
    $('#status').textContent = friendlyError(live.error);
    return;
  }
  state.toys = live.data || [];
  state.sold = sold.data || [];
  render();
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadToys, 600);
}

function subscribeLive() {
  if (!configured) return;
  supabase.channel('shop-toys')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'toys' }, scheduleReload)
    .subscribe();
  setInterval(loadToys, 90_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReload(); });
}

// ------------------------------------------------------------- filters

function chipGroup(el, key, options) {
  el.innerHTML = options.map((o) => `
    <button class="chip" type="button" data-key="${key}" data-value="${esc(o.value)}" aria-pressed="${String(state.filter[key]) === String(o.value)}">
      ${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}${esc(o.label)}
    </button>`).join('');
}

function setupFilters(categories) {
  chipGroup($('#audienceChips'), 'audience', [
    { value: '', label: 'Everyone' },
    ...Object.entries(AUDIENCES).map(([value, a]) => ({ value, label: a.label, dot: a.color })),
  ]);
  chipGroup($('#conditionChips'), 'condition', [
    { value: '', label: 'Used & new' },
    { value: 'used', label: 'Used' },
    { value: 'new', label: 'New' },
  ]);
  chipGroup($('#priceChips'), 'band', [
    { value: -1, label: 'Any price' },
    ...state.bands.map((b, i) => ({ value: i, label: b.label })),
  ]);
  $('#category').innerHTML = '<option value="">All types of toy</option>' +
    categories.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#age').innerHTML = '<option value="">All ages</option>' +
    AGES.map((a) => `<option value="${a}">${a} years</option>`).join('');
}

function syncChips() {
  document.querySelectorAll('#filters .chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(String(state.filter[c.dataset.key]) === c.dataset.value));
  });
}

function matches(t) {
  const f = state.filter;
  if (f.audience && t.audience !== f.audience) return false;
  if (f.condition && t.condition !== f.condition) return false;
  if (f.category && t.category !== f.category) return false;
  if (f.age && t.age_range !== f.age) return false;
  if (f.band >= 0) {
    const b = state.bands[f.band];
    const p = effectivePrice(t);
    if (b && (p < b.min || p > b.max)) return false;
  }
  if (f.q) {
    const hay = `${t.name} ${t.brand || ''} ${t.category || ''} ${t.code}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function sorted(list) {
  const s = state.filter.sort;
  const copy = [...list];
  if (s === 'low') copy.sort((a, b) => effectivePrice(a) - effectivePrice(b));
  else if (s === 'high') copy.sort((a, b) => effectivePrice(b) - effectivePrice(a));
  return copy;
}

// --------------------------------------------------------------- render

function priceHtml(t) {
  const p = effectivePrice(t);
  return `<span class="price">${kwacha(p)}${p < t.price ? `<s>${kwacha(t.price)}</s>` : ''}</span>`;
}

// The website shows the plain photo; the framed picture is for social media.
const photoUrl = (t) => imageUrl(t?.photo_path || t?.image_path);

function inCart(id) {
  return state.cart.find((c) => c.id === id);
}

function cardHtml(t) {
  const sold = t.status === 'sold';
  const hold = t.status === 'reserved';
  const added = inCart(t.id);
  const ribbon = sold ? '<span class="ribbon sold">Sold</span>'
    : hold ? '<span class="ribbon hold">On hold</span>'
    : isSpecial(t) ? '<span class="ribbon">Special</span>' : '';
  const button = sold || hold ? ''
    : `<button class="btn add ${added ? 'in-cart' : ''}" data-add="${t.id}">${added ? 'In cart ✓' : 'Add to cart'}</button>`;
  return `
    <article class="card for-${esc(t.audience || 'neutral')} ${sold ? 'is-sold' : ''} ${hold ? 'is-hold' : ''}" data-id="${t.id}">
      <button class="pic" data-open="${t.id}" aria-label="See ${esc(t.name)}">
        ${ribbon}<span class="cond ${t.condition === 'new' ? 'new' : ''}">${esc(CONDITIONS[t.condition] || 'Used')}</span>
        <img src="${esc(photoUrl(t))}" alt="${esc(t.name)}" loading="lazy" width="540" height="540">
      </button>
      <div class="body">
        <div class="name">${esc(t.name)}</div>
        ${t.age_range ? `<div class="meta">${esc(t.age_range)} yrs</div>` : ''}
        ${sold ? '<div class="meta">Found a new home</div>' : priceHtml(t)}
        <div class="actions">${button}</div>
      </div>
    </article>`;
}

function render() {
  const forSale = state.toys;
  const specials = forSale.filter((t) => isSpecial(t) && t.status === 'available');
  $('#countShop').textContent = `(${forSale.filter((t) => t.status === 'available').length})`;
  $('#countSpecials').textContent = `(${specials.length})`;
  $('#countSold').textContent = `(${state.sold.length})`;

  let list = state.view === 'sold' ? state.sold : state.view === 'specials' ? specials : forSale;
  list = sorted(list.filter(matches));
  if (state.view === 'shop') {
    // Available first, then toys on hold.
    list.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'));
  }

  $('#soldIntro').hidden = state.view !== 'sold';
  if (state.view === 'sold') {
    $('#soldIntro').textContent = `${state.sold.length} toys have found new homes. This is the kind of thing we stock. Message us if you are looking for something similar!`;
  }
  $('#grid').innerHTML = list.map(cardHtml).join('');
  $('#status').textContent = list.length ? '' : state.view === 'specials'
    ? 'No specials right now. Check back soon!'
    : 'No toys match. Try a different filter.';
  renderCartCount();
}

function renderCartCount() {
  const n = state.cart.reduce((s, c) => s + c.qty, 0);
  $('#cartCount').textContent = n;
}

// ----------------------------------------------------------- toy detail

function findToy(id) {
  return state.toys.find((t) => t.id === id) || state.sold.find((t) => t.id === id);
}

function openToy(t) {
  const sold = t.status === 'sold';
  const hold = t.status === 'reserved';
  $('#toyBody').innerHTML = `
    <div class="inner toy-detail">
      <img src="${esc(photoUrl(t))}" alt="${esc(t.name)}" width="1080" height="1080">
      <h2 id="toyTitle">${esc(t.name)}</h2>
      ${sold ? '<p><strong>Sold.</strong> Ask us on WhatsApp if you want something similar.</p>' : priceHtml(t)}
      <div class="tags">
        <span class="tag ${t.audience}">${esc(AUDIENCES[t.audience]?.label)}</span>
        <span class="tag">${esc(CONDITIONS[t.condition])}</span>
        ${t.category ? `<span class="tag">${esc(t.category)}</span>` : ''}
        ${t.age_range ? `<span class="tag">${esc(t.age_range)} years</span>` : ''}
        ${t.brand ? `<span class="tag">${esc(t.brand)}</span>` : ''}
        ${t.quantity > 1 && !sold ? `<span class="tag">${t.quantity} in stock</span>` : ''}
      </div>
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <p class="meta" style="color:var(--muted);font-size:13px">Toy code ${esc(t.code)}</p>
      ${sold || hold ? (hold ? '<p><strong>On hold</strong> for another customer. It may come back soon.</p>' : '')
        : `<button class="btn block add ${inCart(t.id) ? 'in-cart' : ''}" data-add="${t.id}">${inCart(t.id) ? 'In cart ✓' : 'Add to cart'}</button>`}
    </div>`;
  if (location.hash !== '#' + t.code) history.replaceState(null, '', '#' + t.code);
  $('#toyDialog').showModal();
}

function openFromHash() {
  const code = decodeURIComponent(location.hash.slice(1));
  if (!code) return;
  const t = [...state.toys, ...state.sold].find((x) => x.code === code);
  if (t) openToy(t);
}

// ----------------------------------------------------------------- cart

function addToCart(id) {
  const t = findToy(id);
  if (!t || t.status !== 'available') return;
  if (!inCart(id)) {
    state.cart.push({ id, qty: 1 });
    save('as_cart', state.cart);
    toast(`${t.name} added to your cart`);
    $('#cartBtn').classList.remove('bump');
    void $('#cartBtn').offsetWidth;
    $('#cartBtn').classList.add('bump');
  }
  render();
  if ($('#toyDialog').open) openToy(t);
}

function cartLines() {
  return state.cart.map((c) => ({ ...c, toy: state.toys.find((t) => t.id === c.id) }));
}

function cartTotals(lines) {
  const ok = lines.filter((l) => l.toy && l.toy.status === 'available');
  const count = ok.reduce((s, l) => s + l.qty, 0);
  const subtotal = ok.reduce((s, l) => s + effectivePrice(l.toy) * l.qty, 0);
  const c = state.customer;
  const size = parcelSize(count, state.settings);
  let fee = 0;
  let feeKnown = true;
  if (c.location === 'out_of_town') {
    const town = state.towns.find((t) => String(t.id) === String(c.town_id));
    fee = courierFee(town, size);
    feeKnown = fee !== null;
    fee = fee ?? 0;
  }
  return { ok, count, subtotal, size, fee, feeKnown, total: subtotal + fee };
}

function openCart() {
  if (state.step === 'done' && !state.lastOrder) state.step = 'cart';
  renderCart();
  $('#cartDialog').showModal();
}

function renderCart() {
  const body = $('#cartBody');
  if (state.step === 'done' && state.lastOrder) {
    const o = state.lastOrder;
    body.innerHTML = `
      <div class="inner done">
        <h2 id="cartTitle">Almost done!</h2>
        <p>Your order number is</p>
        <div class="code">${esc(o.order.code)}</div>
        <p>We are holding your toys until <strong>${esc(timeLabel(o.order.hold_until))}</strong>.
          Send the order on WhatsApp so we can confirm it and arrange payment.</p>
        <a class="btn wa block" id="waGo" href="${esc(o.link)}" target="_blank" rel="noopener">Send order on WhatsApp</a>
        <p style="font-size:14px;color:var(--muted)">WhatsApp did not open? Tap the green button. Total to pay: <strong>${kwacha(o.order.total)}</strong>.</p>
        <button class="btn ghost block" id="keepShopping">Keep shopping</button>
      </div>`;
    return;
  }

  const lines = cartLines();
  const t = cartTotals(lines);
  if (!lines.length) {
    body.innerHTML = `<div class="inner"><h2 id="cartTitle">Your cart</h2><p class="empty">Your cart is empty. Tap “Add to cart” on any toy.</p></div>`;
    return;
  }

  const list = `<ul class="cart-list">${lines.map((l) => {
    const gone = !l.toy || l.toy.status !== 'available';
    const name = l.toy?.name || 'This toy';
    return `<li class="cart-item">
      <img src="${esc(photoUrl(l.toy))}" alt="">
      <div><div class="name">${esc(name)}</div>
        ${gone ? '<div class="error-text">No longer available</div>'
          : `<div>${kwacha(effectivePrice(l.toy))}${l.toy.quantity > 1 ? ` · <label>Qty <select data-qty="${l.id}">${Array.from({ length: Math.min(l.toy.quantity, 10) }, (_, i) => `<option ${i + 1 === l.qty ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>` : ''}</div>`}
      </div>
      <button class="remove" data-remove="${l.id}">Remove</button>
    </li>`;
  }).join('')}</ul>`;

  if (state.step === 'cart') {
    body.innerHTML = `
      <div class="inner">
        <h2 id="cartTitle">Your cart</h2>
        ${list}
        <div class="totals"><div class="grand"><span>Toys total</span><span>${kwacha(t.subtotal)}</span></div></div>
        <button class="btn block" id="toDetails" ${t.ok.length ? '' : 'disabled'}>Continue to checkout</button>
      </div>`;
    return;
  }

  const c = state.customer;
  const s = state.settings;
  const town = state.towns.find((x) => String(x.id) === String(c.town_id));
  const sizeText = `${t.size[0].toUpperCase() + t.size.slice(1)} parcel (${t.count} item${t.count === 1 ? '' : 's'})`;
  body.innerHTML = `
    <form class="inner" id="checkout" novalidate>
      <h2 id="cartTitle">Checkout</h2>
      <p style="color:var(--ink-2);margin-top:6px">${t.count} toy${t.count === 1 ? '' : 's'} · ${kwacha(t.subtotal)} <button type="button" class="btn ghost small" id="backToCart" style="margin-left:8px">Edit cart</button></p>
      <label class="field"><span>Your name</span><input type="text" name="name" autocomplete="name" required value="${esc(c.name || '')}"></label>
      <label class="field"><span>WhatsApp number</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="0977 123 456" required value="${esc(c.phone || '')}"></label>
      <div class="field"><span>Where are you?</span>
        <div class="seg">
          <button type="button" class="chip" data-set="location" data-value="lusaka" aria-pressed="${c.location === 'lusaka'}">Lusaka</button>
          <button type="button" class="chip" data-set="location" data-value="out_of_town" aria-pressed="${c.location === 'out_of_town'}">Out of town</button>
        </div>
      </div>
      ${c.location === 'lusaka' ? `
        <div class="field"><span>How do you want it?</span>
          <div class="seg">
            <button type="button" class="chip" data-set="delivery_method" data-value="pickup" aria-pressed="${c.delivery_method === 'pickup'}">Pickup</button>
            <button type="button" class="chip" data-set="delivery_method" data-value="yango" aria-pressed="${c.delivery_method === 'yango'}">Yango delivery</button>
          </div>
        </div>
        <p class="fee-note">${esc(c.delivery_method === 'yango' ? s.yango_note : s.pickup_note)}</p>
        ${c.delivery_method === 'yango' ? `<label class="field"><span>Delivery address</span><textarea name="address" autocomplete="street-address" placeholder="House number, street, area, landmark" required>${esc(c.address || '')}</textarea></label>` : ''}
      ` : `
        <label class="field"><span>Your town</span>
          <select name="town_id" required>
            <option value="">Choose your town</option>
            ${state.towns.map((x) => `<option value="${x.id}" ${String(x.id) === String(c.town_id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
          <small>Not listed? Message us on WhatsApp.</small>
        </label>
        ${town ? `<p class="fee-note">Courier${town.courier ? ` (${esc(town.courier)})` : ''} to ${esc(town.name)}: ${sizeText}, ${t.feeKnown ? `<strong>${kwacha(t.fee)}</strong>` : 'fee confirmed on WhatsApp'}. ${esc(s.courier_note)}</p>` : ''}
        <label class="field"><span>Address or courier collection point <small>(optional)</small></span><textarea name="address" placeholder="Where the parcel should go">${esc(c.address || '')}</textarea></label>
      `}
      <label class="field"><span>Note for us <small>(optional)</small></span><input type="text" name="note" maxlength="200" value="${esc(c.note || '')}"></label>
      <div class="totals">
        <div><span>Toys</span><span>${kwacha(t.subtotal)}</span></div>
        <div><span>Delivery</span><span>${c.location === 'lusaka' ? (c.delivery_method === 'yango' ? 'Paid to driver' : 'Free') : t.feeKnown ? kwacha(t.fee) : 'To confirm'}</span></div>
        <div class="grand"><span>Total</span><span>${kwacha(t.total)}</span></div>
      </div>
      <p class="error-text" id="checkoutError" role="alert"></p>
      <button class="btn wa block" type="submit" id="placeOrder" ${state.busy ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z"/></svg>
        ${state.busy ? 'Holding your toys…' : 'Checkout on WhatsApp'}
      </button>
      <p style="font-size:13px;color:var(--muted);text-align:center">We hold your toys for ${Math.round((s.hold_minutes || 120) / 60 * 10) / 10} hours while we confirm on WhatsApp.</p>
    </form>`;
}

function readForm() {
  const f = $('#checkout');
  if (!f) return;
  const data = new FormData(f);
  for (const k of ['name', 'phone', 'address', 'town_id', 'note']) {
    if (data.has(k)) state.customer[k] = String(data.get(k)).trim();
  }
  save('as_customer', state.customer);
}

async function placeOrder() {
  readForm();
  const c = state.customer;
  const err = $('#checkoutError');
  const fail = (msg, field) => {
    err.textContent = msg;
    if (field) $(`#checkout [name="${field}"]`)?.focus();
  };
  if ((c.name || '').length < 2) return fail('Please enter your name.', 'name');
  if ((c.phone || '').replace(/\D/g, '').length < 9) return fail('Please enter your WhatsApp number.', 'phone');
  if (c.location === 'lusaka' && c.delivery_method === 'yango' && !c.address) return fail('Please enter your delivery address.', 'address');
  if (c.location === 'out_of_town' && !c.town_id) return fail('Please choose your town.', 'town_id');

  const lines = cartLines().filter((l) => l.toy && l.toy.status === 'available');
  if (!lines.length) return fail('Your cart is empty.');

  state.busy = true;
  renderCart();
  const customer = {
    name: c.name, phone: c.phone, location: c.location, note: c.note || '',
    delivery_method: c.location === 'lusaka' ? c.delivery_method : 'courier',
    town_id: c.location === 'out_of_town' ? c.town_id : null,
    address: c.location === 'lusaka' && c.delivery_method === 'pickup' ? '' : (c.address || ''),
  };
  const { data, error } = await supabase.rpc('place_order', {
    p_items: lines.map((l) => ({ toy_id: l.id, qty: l.qty })),
    p_customer: customer,
  });
  state.busy = false;

  if (error) {
    if (error.hint === 'unavailable') {
      const gone = String(error.details || '').split(',').filter(Boolean);
      state.cart = state.cart.filter((x) => !gone.includes(x.id));
      save('as_cart', state.cart);
      await loadToys();
    }
    renderCart();
    const fieldMap = { name: 'name', phone: 'phone', address: 'address', town: 'town_id' };
    $('#checkoutError').textContent = friendlyError(error);
    if (fieldMap[error.hint]) $(`#checkout [name="${fieldMap[error.hint]}"]`)?.focus();
    return;
  }

  const pictures = new URL(`order.html?o=${encodeURIComponent(data.code)}&k=${encodeURIComponent(data.link_key)}`, location.href).href;
  const link = waLink(state.settings.whatsapp_number, orderMessage(data, pictures));
  state.lastOrder = { order: data, link };
  save('as_last_order', state.lastOrder);
  state.cart = [];
  save('as_cart', state.cart);
  state.step = 'done';
  renderCart();
  loadToys();
  setTimeout(() => { window.location.href = link; }, 900);
}

// --------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, a');
  if (!el) return;
  if (el.dataset.key) {
    const v = el.dataset.value;
    state.filter[el.dataset.key] = el.dataset.key === 'band' ? Number(v) : v;
    syncChips();
    render();
  } else if (el.dataset.view) {
    state.view = el.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === el)));
    render();
  } else if (el.dataset.add) {
    addToCart(el.dataset.add);
  } else if (el.dataset.open) {
    const t = findToy(el.dataset.open);
    if (t) openToy(t);
  } else if (el.dataset.close !== undefined) {
    el.closest('dialog').close();
  } else if (el.id === 'cartBtn') {
    openCart();
  } else if (el.dataset.remove) {
    state.cart = state.cart.filter((c) => c.id !== el.dataset.remove);
    save('as_cart', state.cart);
    renderCart();
    render();
  } else if (el.id === 'toDetails') {
    state.step = 'details';
    renderCart();
  } else if (el.id === 'backToCart') {
    readForm();
    state.step = 'cart';
    renderCart();
  } else if (el.dataset.set) {
    readForm();
    state.customer[el.dataset.set] = el.dataset.value;
    if (el.dataset.set === 'location' && el.dataset.value === 'lusaka' && !['pickup', 'yango'].includes(state.customer.delivery_method)) {
      state.customer.delivery_method = 'pickup';
    }
    save('as_customer', state.customer);
    renderCart();
  } else if (el.id === 'keepShopping') {
    state.step = 'cart';
    state.lastOrder = null;
    $('#cartDialog').close();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.qty) {
    const line = inCart(el.dataset.qty);
    if (line) line.qty = Number(el.value);
    save('as_cart', state.cart);
    renderCart();
    renderCartCount();
  } else if (el.name === 'town_id') {
    readForm();
    renderCart();
  } else if (['category', 'age', 'sort'].includes(el.id)) {
    state.filter[el.id] = el.value;
    render();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'checkout') {
    e.preventDefault();
    if (!state.busy) placeOrder();
  }
});

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filter.q = e.target.value.trim(); render(); }, 150);
});

$('#toyDialog').addEventListener('close', () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
window.addEventListener('hashchange', openFromHash);

loadAll().then(subscribeLive);
