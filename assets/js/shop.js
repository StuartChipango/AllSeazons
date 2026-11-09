import { supabase, imageUrl, friendlyError, configured } from './db.js';
import {
  esc, kwacha, effectivePrice, isSpecial, parcelSize, courierFee, waLink, orderMessage,
  priceBands, AUDIENCES, CONDITIONS, AGES, PAYMENTS, timeLabel,
} from './lib.js';

const TOY_COLUMNS = 'id,code,name,audience,condition,category,age_range,brand,description,price,sale_price,is_special,quantity,status,image_path,photo_path,thumb_path,media,created_at,approved_at,sold_at';
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
  customer: load('as_customer', { location: 'lusaka', delivery_method: 'pickup', payment: 'mtn' }),
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
  $('#topWa').href = $('#footWa').href;
  await loadToys();
  openFromHash();
}

// Columns the database may not have yet (until the latest schema is run):
// the shop then loads without them instead of showing an error.
const NEWER_COLUMNS = ['media', 'thumb_path'];
let columnsInUse = TOY_COLUMNS;

// The Sold section is only fetched when someone opens it.
let soldLoaded = false;
async function loadSold() {
  const { data } = await supabase.from('toys').select(columnsInUse).eq('status', 'sold').not('image_path', 'is', null)
    .order('sold_at', { ascending: false, nullsFirst: false }).limit(200);
  state.sold = data || [];
  soldLoaded = true;
}

async function loadToys(columns = columnsInUse) {
  const [live, soldCount] = await Promise.all([
    supabase.from('toys').select(columns).in('status', ['available', 'reserved'])
      .order('approved_at', { ascending: false, nullsFirst: false }).limit(2000),
    supabase.from('toys').select('id', { count: 'exact', head: true }).eq('status', 'sold').not('image_path', 'is', null),
  ]);
  if (live.error?.code === '42703' && columns === TOY_COLUMNS) {
    columnsInUse = TOY_COLUMNS.split(',').filter((c) => !NEWER_COLUMNS.includes(c)).join(',');
    return loadToys(columnsInUse);
  }
  if (live.error) {
    $('#status').textContent = friendlyError(live.error);
    return;
  }
  state.toys = live.data || [];
  state.soldCount = soldCount.count ?? state.sold.length;
  if (soldLoaded) await loadSold();
  render();
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadToys, 2000);
}

// Staff change toys all the time while uploading and reviewing. Only
// reload when a change can show in the shop.
const SHOP_STATUSES = ['available', 'reserved', 'sold'];
function onToyChange(change) {
  if (change.eventType === 'DELETE') return scheduleReload();
  const t = change.new || {};
  const known = state.toys.some((x) => x.id === t.id) || state.sold.some((x) => x.id === t.id);
  if (SHOP_STATUSES.includes(t.status) || known) scheduleReload();
}

function subscribeLive() {
  if (!configured) return;
  supabase.channel('shop-toys')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'toys' }, onToyChange)
    .subscribe();
  setInterval(() => { if (!document.hidden) loadToys(); }, 120_000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (Date.now() - hiddenAt > 30_000) scheduleReload();
  });
}

// ------------------------------------------------------------- filters

function chipGroup(el, key, options) {
  el.innerHTML = options.map((o) => `
    <button class="chip" type="button" data-key="${key}" data-value="${esc(o.value)}" aria-pressed="${String(state.filter[key]) === String(o.value)}">
      ${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}${esc(o.label)}
    </button>`).join('');
}

// A picture for each "what they like" circle, matched on the type's name.
const LIKE_ICONS = [
  [/animal|pet|dino/i, '🦁'], [/vehicle|car|truck|train/i, '🚗'], [/dress/i, '👗'], [/doll/i, '🪆'],
  [/build|block|lego|construct/i, '🧱'], [/learn|educat|book|letter/i, '🔤'], [/plush|soft|teddy/i, '🧸'],
  [/puzzle/i, '🧩'], [/ball|sport|outdoor/i, '⚽'], [/music|sound/i, '🎵'], [/baby|infant/i, '🍼'],
  [/game|board/i, '🎲'], [/kitchen|food|pretend/i, '🍳'], [/art|craft|draw/i, '🎨'],
];
const likeIcon = (name) => (LIKE_ICONS.find(([re]) => re.test(name)) || [null, '🎁'])[1];

function setupFilters(categories) {
  chipGroup($('#audienceChips'), 'audience', [
    { value: '', label: 'Everyone' },
    ...Object.entries(AUDIENCES).map(([value, a]) => ({ value, label: a.label, dot: a.color })),
  ]);
  chipGroup($('#ageChips'), 'age', [
    { value: '', label: 'All ages' },
    ...AGES.map((a) => ({ value: a, label: `${a} yrs` })),
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
  $('#likes').innerHTML = categories.map((c) => `
    <button type="button" class="like" data-key="category" data-value="${esc(c)}" aria-pressed="${state.filter.category === c}">
      <span aria-hidden="true">${likeIcon(c)}</span>${esc(c)}</button>`).join('');
}

function syncChips() {
  document.querySelectorAll('[data-key]').forEach((c) => {
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
// Toy cards use the small copy: a few KB each instead of the full photo.
const thumbUrl = (t) => imageUrl(t?.thumb_path || t?.photo_path || t?.image_path);

function inCart(id) {
  return state.cart.find((c) => c.id === id);
}

// "3 photos · video" on a card whose toy has more than one picture.
function moreHtml(t) {
  const media = t.media || [];
  if (!media.length) return '';
  const photos = 1 + media.filter((m) => m.type !== 'video').length;
  const video = media.some((m) => m.type === 'video');
  return `<span class="more">${photos > 1 ? `${photos} photos` : ''}${photos > 1 && video ? ' · ' : ''}${video ? '▶ video' : ''}</span>`;
}

const PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function cardHtml(t) {
  const sold = t.status === 'sold';
  const hold = t.status === 'reserved';
  const added = inCart(t.id);
  const ribbon = sold ? '<span class="ribbon sold">Sold</span>'
    : hold ? '<span class="ribbon hold">On hold</span>'
    : isSpecial(t) ? '<span class="ribbon">Special</span>' : '';
  const button = sold || hold ? ''
    : `<button class="add ${added ? 'in-cart' : ''}" data-add="${t.id}" aria-label="${added ? 'In cart' : 'Add to cart'}">${added ? TICK : PLUS}</button>`;
  return `
    <article class="card for-${esc(t.audience || 'neutral')} ${sold ? 'is-sold' : ''} ${hold ? 'is-hold' : ''}" data-id="${t.id}">
      <button class="pic" data-open="${t.id}" aria-label="See ${esc(t.name)}">
        ${ribbon}<span class="cond ${t.condition === 'new' ? 'new' : ''}">${esc(CONDITIONS[t.condition] || 'Used')}</span>
        ${moreHtml(t)}
        <img src="${esc(thumbUrl(t))}" alt="${esc(t.name)}" loading="lazy" decoding="async" width="480" height="480">
      </button>
      <div class="body">
        <div class="name">${esc(t.name)}</div>
        ${sold ? '<div class="meta">Found a new home</div>' : priceHtml(t)}
        ${t.age_range ? `<div class="meta">${esc(t.age_range)} yrs</div>` : ''}
      </div>
      ${button}
    </article>`;
}

// Cards are added a screenful at a time as you scroll, so a phone never
// has to draw hundreds of toys at once.
const PAGE = 24;
let shown = PAGE;
let lastHtml = '';
let pager = null;

function render({ reset = false } = {}) {
  if (reset) shown = PAGE;
  const forSale = state.toys;
  const specials = forSale.filter((t) => isSpecial(t) && t.status === 'available');
  $('#countShop').textContent = `(${forSale.filter((t) => t.status === 'available').length})`;
  $('#countSpecials').textContent = `(${specials.length})`;
  $('#countSold').textContent = `(${state.soldCount ?? state.sold.length})`;

  let list = state.view === 'sold' ? state.sold : state.view === 'specials' ? specials : forSale;
  list = sorted(list.filter(matches));
  if (state.view === 'shop') {
    // Available first, then toys on hold.
    list.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'));
  }

  $('#soldIntro').hidden = state.view !== 'sold';
  if (state.view === 'sold') {
    $('#soldIntro').textContent = `${state.soldCount ?? state.sold.length} toys have found new homes. This is the kind of thing we stock. Message us if you are looking for something similar!`;
  }
  // Nothing changed (a background refresh): leave the page alone, so
  // pictures do not flicker and the page does not jump.
  const html = list.slice(0, shown).map(cardHtml).join('');
  if (html !== lastHtml) {
    $('#grid').innerHTML = html;
    lastHtml = html;
  }
  watchMore(list.length > shown);
  $('#status').textContent = list.length ? '' : state.view === 'specials'
    ? 'No specials right now. Check back soon!'
    : 'No toys match. Try a different filter.';
  renderCartCount();
}

function watchMore(more) {
  let sentinel = $('#more');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'more';
    sentinel.className = 'more-sentinel';
    $('#grid').after(sentinel);
  }
  sentinel.hidden = !more;
  if (!pager && 'IntersectionObserver' in window) {
    pager = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !sentinel.hidden) {
        shown += PAGE;
        render();
      }
    }, { rootMargin: '800px 0px' });
    pager.observe(sentinel);
  } else if (!('IntersectionObserver' in window)) {
    shown = Infinity;
  }
}

function renderCartCount() {
  const lines = cartLines().filter((l) => l.toy && l.toy.status === 'available');
  const n = lines.reduce((s, c) => s + c.qty, 0);
  $('#cartCount').textContent = n;
  $('#cartWord').textContent = n === 1 ? 'toy' : 'toys';
  $('#cartTotal').textContent = `${kwacha(lines.reduce((s, l) => s + effectivePrice(l.toy) * l.qty, 0))} →`;
  $('#cartBtn').hidden = !n;
  document.body.classList.toggle('has-cart', n > 0);
}

// ----------------------------------------------------------- toy detail

function findToy(id) {
  return state.toys.find((t) => t.id === id) || state.sold.find((t) => t.id === id);
}

// The main photo, then any other angles and videos: swipe, or tap a thumbnail.
function galleryHtml(t) {
  const slides = [{ url: photoUrl(t), type: 'image' }, ...(t.media || []).map((m) => ({ url: imageUrl(m.path), type: m.type }))];
  const slide = (s, i) => s.type === 'video'
    ? `<video src="${esc(s.url)}" controls playsinline preload="metadata" data-slide="${i}"></video>`
    : `<img src="${esc(s.url)}" alt="${esc(t.name)}${i ? ` (photo ${i + 1})` : ''}" data-slide="${i}" ${i ? 'loading="lazy"' : ''}>`;
  if (slides.length === 1) return `<div class="gallery"><div class="slides">${slide(slides[0], 0)}</div></div>`;
  return `
    <div class="gallery">
      <div class="slides" tabindex="0" aria-label="Photos of ${esc(t.name)}">${slides.map(slide).join('')}</div>
      <div class="thumbs">${slides.map((s, i) => `<button type="button" data-goto="${i}" aria-label="${s.type === 'video' ? 'Video' : `Photo ${i + 1}`}">
        ${s.type === 'video' ? '<span>▶</span>' : `<img src="${esc(s.url)}" alt="" loading="lazy">`}</button>`).join('')}</div>
    </div>`;
}

function openToy(t) {
  const sold = t.status === 'sold';
  const hold = t.status === 'reserved';
  $('#toyBody').innerHTML = `
    <div class="inner toy-detail">
      ${galleryHtml(t)}
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
        : `<div class="toy-actions">
            <button class="btn ghost" data-add="${t.id}" ${inCart(t.id) ? 'disabled' : ''}>${inCart(t.id) ? 'On my list ✓' : 'Add to my list'}</button>
            <button class="btn go" data-order="${t.id}">Order now</button>
          </div>`}
    </div>`;
  const slides = $('#toyBody .slides');
  document.querySelectorAll('#toyBody [data-goto]').forEach((b) => b.onclick = () => {
    const target = slides.querySelector(`[data-slide="${b.dataset.goto}"]`);
    slides.scrollTo({ left: target.offsetLeft - slides.offsetLeft, behavior: 'smooth' });
  });
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

// Packaging and a rider to the courier office, added to every courier fee.
const packagingFee = () => Number(state.settings?.packaging_fee ?? 0);

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
    const courier = courierFee(town, size);
    feeKnown = courier !== null;
    fee = feeKnown ? courier + packagingFee() : 0;
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
          Send the order on WhatsApp so we can confirm it.</p>
        <a class="btn wa block big" id="waGo" href="${esc(o.link)}" target="_blank" rel="noopener">Send order on WhatsApp</a>
        <p class="pay-how">Total to pay: <strong>${kwacha(o.order.total)}</strong>${PAYMENTS[o.order.payment] ? `<br>${esc(PAYMENTS[o.order.payment].how)}` : ''}</p>
        <img class="mascot" src="assets/img/mascots/spri.webp" alt="" width="80" height="95" loading="lazy" decoding="async">
        <button class="btn ghost block" id="keepShopping">Keep shopping</button>
      </div>`;
    return;
  }

  const lines = cartLines();
  const t = cartTotals(lines);
  if (!lines.length) {
    body.innerHTML = `<div class="inner"><h2 id="cartTitle">My list</h2><p class="empty">Nothing here yet. Tap <b>+</b> on any toy.</p></div>`;
    return;
  }

  const list = `<ul class="cart-list">${lines.map((l) => {
    const gone = !l.toy || l.toy.status !== 'available';
    const name = l.toy?.name || 'This toy';
    return `<li class="cart-item for-${esc(l.toy?.audience || 'neutral')}">
      <img src="${esc(thumbUrl(l.toy))}" alt="" width="56" height="56">
      <div><div class="name">${esc(name)}</div>
        ${gone ? '<div class="error-text">No longer available</div>'
          : `<div>${kwacha(effectivePrice(l.toy))}${l.toy.quantity > 1 ? ` · <label>Qty <select data-qty="${l.id}">${Array.from({ length: Math.min(l.toy.quantity, 10) }, (_, i) => `<option ${i + 1 === l.qty ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>` : ''}</div>`}
      </div>
      <button type="button" class="remove" data-remove="${l.id}" aria-label="Remove ${esc(name)}">×</button>
    </li>`;
  }).join('')}</ul>`;

  const c = state.customer;
  const s = state.settings;
  const how = c.location === 'out_of_town' ? 'courier' : c.delivery_method;
  const town = state.towns.find((x) => String(x.id) === String(c.town_id));
  const sizeText = `${t.size} parcel`;
  const pays = Object.entries(PAYMENTS).filter(([k]) => k !== 'cash' || how === 'pickup');
  if (!pays.some(([k]) => k === c.payment)) c.payment = 'mtn';
  body.innerHTML = `
    <form class="inner" id="checkout" novalidate>
      <h2 id="cartTitle">My list</h2>
      ${list}
      <div class="two-col">
        <label class="field"><span>Your name</span><input type="text" name="name" autocomplete="name" required value="${esc(c.name || '')}"></label>
        <label class="field"><span>WhatsApp number</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="0977 123 456" required value="${esc(c.phone || '')}"></label>
      </div>
      <div class="field"><span>How do you get it?</span>
        <div class="seg three">
          <button type="button" class="opt" data-set="how" data-value="pickup" aria-pressed="${how === 'pickup'}">Pickup<small>Free</small></button>
          <button type="button" class="opt" data-set="how" data-value="yango" aria-pressed="${how === 'yango'}">Lusaka delivery<small>Yango</small></button>
          <button type="button" class="opt" data-set="how" data-value="courier" aria-pressed="${how === 'courier'}">Out of town<small>Courier</small></button>
        </div>
      </div>
      ${how === 'pickup' && s.pickup_note ? `<p class="fee-note">${esc(s.pickup_note)}</p>` : ''}
      ${how === 'yango' ? `${s.yango_note ? `<p class="fee-note">${esc(s.yango_note)}</p>` : ''}<label class="field"><span>Delivery address</span><input type="text" name="address" autocomplete="street-address" placeholder="House number, street, area, landmark" required value="${esc(c.address || '')}"></label>` : ''}
      ${how === 'courier' ? `
        <label class="field"><span>Your town</span>
          <select name="town_id" required>
            <option value="">Choose your town</option>
            ${state.towns.map((x) => `<option value="${x.id}" ${String(x.id) === String(c.town_id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
          </select>
          <small>Not listed? Message us on WhatsApp.</small>
        </label>
        ${town ? `<p class="fee-note">Courier${town.courier ? ` (${esc(town.courier)})` : ''} to ${esc(town.name)}, ${sizeText}: ${t.feeKnown ? `<strong>${kwacha(t.fee)}</strong>${packagingFee() ? ` (courier ${kwacha(t.fee - packagingFee())} + packing and drop-off ${kwacha(packagingFee())})` : ''}` : 'fee confirmed on WhatsApp'}.${s.courier_note ? ' ' + esc(s.courier_note) : ''}</p>` : ''}
      ` : ''}
      <div class="field"><span>Pay with</span>
        <div class="pays">${pays.map(([k, p]) => `<button type="button" class="chip" data-set="payment" data-value="${k}" aria-pressed="${c.payment === k}">${esc(p.label)}</button>`).join('')}</div>
      </div>
      <details class="note-box" ${c.note || (how === 'courier' && c.address) ? 'open' : ''}><summary>Add a note${how === 'courier' ? ' or collection point' : ''}</summary>
        ${how === 'courier' ? `<label class="field"><span>Courier collection point <small>(optional)</small></span><input type="text" name="address" value="${esc(c.address || '')}"></label>` : ''}
        <label class="field"><span>Note for us <small>(optional)</small></span><input type="text" name="note" maxlength="160" value="${esc(c.note || '')}"></label>
      </details>
      <div class="totals">
        <div><span>Toys</span><span>${kwacha(t.subtotal)}</span></div>
        <div><span>Delivery</span><span>${how === 'pickup' ? 'Free' : how === 'yango' ? 'Paid to driver' : t.feeKnown && town ? kwacha(t.fee) : 'To confirm'}</span></div>
        <div class="grand"><span>Total</span><span>${kwacha(t.total)}</span></div>
      </div>
      <p class="error-text" id="checkoutError" role="alert"></p>
      <button class="btn wa block big" type="submit" id="placeOrder" ${state.busy ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4A8 8 0 1 1 20 12z"/></svg>
        ${state.busy ? 'Holding your toys…' : 'Send order on WhatsApp'}
      </button>
      <p style="font-size:13px;color:var(--muted);text-align:center;margin:8px 0 0">We hold your toys for ${Math.round((s.hold_minutes || 120) / 60 * 10) / 10} hours while we confirm on WhatsApp.</p>
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
    name: c.name, phone: c.phone, location: c.location,
    note: [c.note, PAYMENTS[c.payment] ? `Pays with ${PAYMENTS[c.payment].label}` : ''].filter(Boolean).join(' · '),
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

  data.payment = c.payment;
  data.note = c.note || '';
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
    render({ reset: true });
  } else if (el.dataset.view) {
    state.view = el.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === el)));
    if (state.view === 'sold' && !soldLoaded) {
      $('#grid').innerHTML = '';
      lastHtml = '';
      $('#status').textContent = 'Loading…';
      loadSold().then(() => render({ reset: true }));
    } else {
      render({ reset: true });
    }
  } else if (el.dataset.add) {
    addToCart(el.dataset.add);
  } else if (el.dataset.order) {
    addToCart(el.dataset.order);
    $('#toyDialog').close();
    openCart();
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
    if (!state.cart.length) $('#cartDialog').close();
  } else if (el.dataset.set) {
    readForm();
    if (el.dataset.set === 'how') {
      const how = el.dataset.value;
      state.customer.location = how === 'courier' ? 'out_of_town' : 'lusaka';
      if (how !== 'courier') state.customer.delivery_method = how;
    } else {
      state.customer[el.dataset.set] = el.dataset.value;
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
  } else if (el.id === 'sort') {
    state.filter[el.id] = el.value;
    render({ reset: true });
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
  searchTimer = setTimeout(() => { state.filter.q = e.target.value.trim(); render({ reset: true }); }, 150);
});

$('#toyDialog').addEventListener('close', () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
window.addEventListener('hashchange', openFromHash);

loadAll().then(subscribeLive);
