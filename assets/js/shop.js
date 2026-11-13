import { supabase, imageUrl, friendlyError, configured } from './db.js';
import {
  esc, kwacha, effectivePrice, isSpecial, parcelSize, courierFee, waLink, orderMessage,
  CONDITIONS, AGES, PAYMENTS, timeLabel,
} from './lib.js';
import { track } from './track.js';

const TOY_COLUMNS = 'id,code,name,audience,condition,category,age_range,brand,description,price,sale_price,is_special,is_featured,quantity,status,image_path,photo_path,thumb_path,media,created_at,approved_at,sold_at';
const $ = (sel) => document.querySelector(sel);

const state = {
  toys: [],
  sold: [],
  settings: { whatsapp_number: '', hold_minutes: 120, medium_from: 2, large_from: 5 },
  towns: [],
  filter: { who: '', condition: '', budget: 0, category: '', age: '', q: '', sort: 'new' },
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
  const [settings, towns, cats] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('towns').select('*').eq('active', true).order('name'),
    supabase.from('categories').select('name').order('sort'),
  ]);
  if (settings.data) state.settings = settings.data;
  state.towns = towns.data || [];
  state.categories = (cats.data || []).map((c) => c.name);
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
const NEWER_COLUMNS = ['media', 'thumb_path', 'is_featured'];
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

// A picture for each toy type, matched on the type's name.
const LIKE_ICONS = [
  [/animal|pet|dino/i, '🦁'], [/vehicle|car|truck|train/i, '🚗'], [/dress/i, '👗'], [/doll/i, '🪆'],
  [/build|block|lego|construct/i, '🧱'], [/learn|educat|book|letter/i, '🔤'], [/plush|soft|teddy/i, '🧸'],
  [/puzzle/i, '🧩'], [/ball|sport|outdoor/i, '⚽'], [/music|sound/i, '🎵'], [/baby|infant/i, '🍼'],
  [/game|board/i, '🎲'], [/kitchen|food|pretend/i, '🍳'], [/art|craft|draw/i, '🎨'], [/action|figure|hero/i, '🦸'],
];
const likeIcon = (name) => (LIKE_ICONS.find(([re]) => re.test(name || '')) || [null, '🎁'])[1];

// Big tap buttons instead of dropdown menus: every choice is on screen.
const WHO = [
  { value: 'boy', label: 'A boy', icon: '👦', cls: 'boy' },
  { value: 'girl', label: 'A girl', icon: '👧', cls: 'girl' },
  { value: 'baby', label: 'A baby', icon: '👶', cls: '' },
  { value: '', label: 'Any child', icon: '🧒', cls: '' },
];
const ageWords = (a) => (a === '9+' ? '9 and up' : String(a || '').replace('-', ' to '));
const ageLabel = (a) => (a ? `Age ${ageWords(a)}` : '');
const PICKS = {
  age: [{ value: '', label: 'All ages' }, ...AGES.map((a) => ({ value: a, label: ageWords(a) }))],
  budget: [{ value: 0, label: 'Any price' }, ...[50, 100, 200].map((n) => ({ value: n, label: `Up to ${kwacha(n)}` }))],
  condition: [{ value: '', label: 'Used & new' }, { value: 'used', label: 'Used' }, { value: 'new', label: 'New' }],
  sort: [{ value: 'new', label: 'Newest' }, { value: 'low', label: 'Lowest price' }, { value: 'high', label: 'Highest price' }],
};
const pressed = (a, b) => String(String(a) === String(b));

function renderPicks() {
  const f = state.filter;
  const who = WHO.map((w) => `<button type="button" class="who-btn ${w.cls}" data-who="${w.value}" aria-pressed="${pressed(f.who, w.value)}"><span aria-hidden="true">${w.icon}</span>${w.label}</button>`).join('');
  if ($('#who').innerHTML !== who) $('#who').innerHTML = who;
  for (const box of document.querySelectorAll('[data-pick]')) {
    const key = box.dataset.pick === 'band' ? 'budget' : box.dataset.pick;
    const html = PICKS[key].map((o) => `<button type="button" class="tap" data-set-filter="${key}" data-value="${esc(o.value)}" aria-pressed="${pressed(f[key], o.value)}">${esc(o.label)}</button>`).join('');
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  const extra = [f.age, f.condition].filter(Boolean).length + (f.budget ? 1 : 0) + (f.sort !== 'new' ? 1 : 0);
  $('#filterCount').textContent = extra;
  $('#filterCount').hidden = !extra;
}

// One picture button per toy type that has toys, with how many there are.
function renderCats() {
  const counts = new Map();
  let all = 0;
  for (const t of state.toys) {
    if (!matches(t, { ignoreCategory: true })) continue;
    all++;
    if (t.category) counts.set(t.category, (counts.get(t.category) || 0) + 1);
  }
  const f = state.filter;
  const known = (state.categories || []).filter((c) => counts.has(c) || c === f.category);
  const extra = [...counts.keys()].filter((c) => !known.includes(c));
  const n = (k) => `${k} ${k === 1 ? 'toy' : 'toys'}`;
  const tile = (value, icon, label, k) => `<button type="button" class="type" data-cat="${esc(value)}" aria-pressed="${pressed(f.category, value)}"><span aria-hidden="true">${icon}</span>${esc(label)}<small>${n(k)}</small></button>`;
  const html = [tile('', '🎁', 'All toys', all), ...[...known, ...extra].map((c) => tile(c, likeIcon(c), c, counts.get(c) || 0))].join('');
  if ($('#cats').innerHTML !== html) $('#cats').innerHTML = html;
}

const isFiltered = () => {
  const f = state.filter;
  return Boolean(f.who || f.category || f.age || f.budget || f.condition);
};

// "Cars & Vehicles for a girl, up to K100" for the heading over the results.
function describe() {
  const f = state.filter;
  const parts = [f.category || 'Toys'];
  if (f.who === 'boy') parts.push('for a boy');
  if (f.who === 'girl') parts.push('for a girl');
  if (f.who === 'baby') parts.push('for a baby');
  const more = [];
  if (f.age) more.push(`age ${ageWords(f.age)}`);
  if (f.budget) more.push(`up to ${kwacha(f.budget)}`);
  if (f.condition) more.push(CONDITIONS[f.condition].toLowerCase());
  return parts.join(' ') + (more.length ? `, ${more.join(', ')}` : '');
}

function matches(t, { ignoreCategory = false } = {}) {
  const f = state.filter;
  // Toys for boys and girls suit both, so they show for either.
  if (f.who === 'boy' && !['boys', 'neutral'].includes(t.audience)) return false;
  if (f.who === 'girl' && !['girls', 'neutral'].includes(t.audience)) return false;
  if (f.who === 'baby' && t.age_range !== '0-2') return false;
  if (f.condition && t.condition !== f.condition) return false;
  if (!ignoreCategory && f.category && t.category !== f.category) return false;
  if (f.age && t.age_range !== f.age) return false;
  if (f.budget && effectivePrice(t) > f.budget) return false;
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
  // Toys you can buy first, then toys on hold.
  copy.sort((a, b) => (a.status === 'reserved') - (b.status === 'reserved'));
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

// "Buy" puts the toy in "My order"; the same words everywhere.
const addButton = (id, added) => `<button class="add ${added ? 'in-cart' : ''}" data-add="${id}">${added ? TICK + '<span>In my order</span>' : PLUS + '<span>Buy</span>'}</button>`;

function cardHtml(t) {
  const sold = t.status === 'sold';
  const hold = t.status === 'reserved';
  const ribbon = sold ? '<span class="ribbon sold">Sold</span>'
    : hold ? '<span class="ribbon hold">On hold</span>'
    : isSpecial(t) ? '<span class="ribbon">Special</span>' : '';
  const button = sold || hold ? '' : addButton(t.id, inCart(t.id));
  return `
    <article class="card for-${esc(t.audience || 'neutral')} ${sold ? 'is-sold' : ''} ${hold ? 'is-hold' : ''}" data-id="${t.id}">
      <button class="pic" data-open="${t.id}" aria-label="See ${esc(t.name)}">
        ${ribbon}<span class="cond ${t.condition === 'new' ? 'new' : ''}">${esc(CONDITIONS[t.condition] || 'Used')}</span>
        ${moreHtml(t)}
        <img src="${esc(thumbUrl(t))}" alt="${esc(t.name)}" loading="lazy" decoding="async" width="480" height="480">
      </button>
      <div class="body">
        <div class="name">${esc(t.name)}</div>
        ${t.age_range ? `<div class="meta">${esc(ageLabel(t.age_range))}</div>` : ''}
        ${sold ? '<div class="meta">Found a new home</div>' : priceHtml(t)}
        ${button}
      </div>
    </article>`;
}

// ---- The big banner: the toy or toys of the week.
// Staff tick "Put in the big banner" on a toy. With none ticked, the
// banner shows the specials; with no specials, the plain welcome.
const HERO_MAX = 6;
let heroHtml = '';

function heroToys() {
  const live = state.toys.filter((t) => t.status === 'available');
  const featured = live.filter((t) => t.is_featured);
  if (featured.length) return { toys: featured.slice(0, HERO_MAX), label: 'Hot this week' };
  const specials = live.filter(isSpecial)
    .sort((a, b) => (b.price - effectivePrice(b)) - (a.price - effectivePrice(a)));
  return { toys: specials.slice(0, HERO_MAX), label: 'Specials' };
}

function heroSlide(t, i, label) {
  const p = effectivePrice(t);
  const off = p < t.price ? Math.round((1 - p / t.price) * 100) : 0;
  return `
    <article class="slide for-${esc(t.audience || 'neutral')}" data-slide-i="${i}">
      <div class="slide-text">
        <span class="hot">🔥 ${esc(label)}</span>
        <h2>${esc(t.name)}</h2>
        <div class="slide-price">${kwacha(p)}${off ? `<s>${kwacha(t.price)}</s>` : ''}</div>
        ${off ? `<span class="save">Save ${off}%</span>` : `<span class="save">${esc(CONDITIONS[t.condition] || 'Used')}${t.age_range ? ` · ${esc(ageLabel(t.age_range))}` : ''}</span>`}
        <div class="slide-actions">${addButton(t.id, inCart(t.id))}<button class="see" data-open="${t.id}">See it</button></div>
      </div>
      <button class="slide-pic" data-open="${t.id}" aria-label="See ${esc(t.name)}">
        <img src="${esc(photoUrl(t))}" alt="${esc(t.name)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">
      </button>
    </article>`;
}

// The banner never moves by itself (it makes people tap the wrong toy).
// With more than one toy, big arrows and "1 of 3" move it.
function renderHero() {
  const { toys, label } = heroToys();
  const title = state.settings.hero_title?.trim() || label;
  const hero = $('#hero');
  // While someone is looking for something, the results come first.
  hero.hidden = isFiltered() || Boolean(state.filter.q);
  // Searching: the results sit right under the search box.
  $('#choose').hidden = Boolean(state.filter.q);
  $('#how').hidden = Boolean(state.filter.q);
  const html = toys.length ? `
    <div class="slides" id="heroSlides">${toys.map((t, i) => heroSlide(t, i, title)).join('')}</div>
    ${toys.length > 1 ? `<div class="hero-nav">
      <button type="button" data-hero="-1" aria-label="Previous toy">‹</button>
      <span id="heroPos">1 of ${toys.length}</span>
      <button type="button" data-hero="1" aria-label="Next toy">›</button>
    </div>` : ''}` : '';
  hero.classList.toggle('has-toys', toys.length > 0);
  if (html === heroHtml) return;
  heroHtml = html;
  hero.querySelector('.hero-show')?.remove();
  hero.querySelector('.hero-plain').hidden = toys.length > 0;
  if (!toys.length) return;
  const show = document.createElement('div');
  show.className = 'hero-show';
  show.innerHTML = html;
  hero.append(show);
  const slides = $('#heroSlides');
  slides.addEventListener('scroll', () => {
    if ($('#heroPos')) $('#heroPos').textContent = `${heroIndex() + 1} of ${toys.length}`;
  }, { passive: true });
}

function heroIndex() {
  const slides = $('#heroSlides');
  return slides ? Math.round(slides.scrollLeft / slides.clientWidth) : 0;
}

function moveHero(step) {
  const slides = $('#heroSlides');
  if (!slides) return;
  const n = slides.children.length;
  const next = (heroIndex() + step + n) % n;
  slides.scrollTo({ left: next * slides.clientWidth, behavior: 'smooth' });
}

// ---- Sections: plain grids that grow downwards; nothing to swipe.
// Short sections (specials, sold) show 4 toys and a "See all" button.
const SHORT = 4;
const PAGE = 24;
const unfolded = new Map(); // section key -> how many cards a grid shows
let sectionsHtml = '';

function buildSections() {
  const f = state.filter;
  const list = sorted(state.toys.filter((t) => matches(t)));
  const sold = sorted(state.sold.filter((t) => matches(t)));
  const soldSection = { key: 'sold', title: 'Found new homes', icon: '💛', toys: sold, sold: true,
    note: `${state.soldCount ?? state.sold.length} toys have found new homes. This is the kind of thing we stock. Message us if you want something similar!` };
  if (f.q) return [{ key: 'search', title: `Results for “${f.q}”`, icon: '🔎', toys: list, main: true, clear: true }, soldSection];
  if (isFiltered()) return [{ key: 'pick', title: describe(), icon: f.category ? likeIcon(f.category) : '🎁', toys: list, main: true, clear: true }, soldSection];
  const sections = [];
  const specials = list.filter((t) => t.status === 'available' && isSpecial(t));
  if (specials.length) sections.push({ key: 'specials', title: 'Specials', icon: '⭐', toys: specials });
  sections.push({ key: 'all', title: 'All toys', icon: '🎁', toys: list, main: true });
  sections.push(soldSection);
  return sections;
}

function sectionHtml(s) {
  const n = s.toys.length;
  if (s.sold && !soldLoaded) {
    if (!(state.soldCount > 0)) return '';
    return `<section class="sec sold-sec" data-sec="sold" id="soldSec"><div class="sec-head"><h2><span aria-hidden="true">${s.icon}</span> ${esc(s.title)}</h2></div><p class="status">Loading…</p></section>`;
  }
  if (!n && !s.main) return '';
  const count = s.sold ? state.soldCount ?? n : n;
  const shown = unfolded.get(s.key) || (s.main ? PAGE : SHORT);
  const toggle = s.clear ? '<button type="button" class="sec-btn" data-clear>✕ Show all toys</button>'
    : s.main ? ''
    : unfolded.has(s.key) ? `<button type="button" class="sec-btn" data-fold="${esc(s.key)}">Show less</button>`
    : n > SHORT ? `<button type="button" class="sec-btn" data-unfold="${esc(s.key)}">See all ${count} ›</button>` : '';
  const head = `<div class="sec-head"><h2><span aria-hidden="true">${s.icon}</span> ${esc(s.title)} <small>${count} ${count === 1 ? 'toy' : 'toys'}</small></h2>${toggle}</div>`;
  const note = s.sold ? `<p class="sold-intro">${esc(s.note)}</p>` : '';
  if (!n) return `<section class="sec" data-sec="${esc(s.key)}">${head}${emptyHtml()}</section>`;
  return `<section class="sec" data-sec="${esc(s.key)}">${head}${note}
    <div class="grid">${s.toys.slice(0, shown).map(cardHtml).join('')}</div>
    ${n > shown && (s.main || unfolded.has(s.key)) ? `<button type="button" class="btn ghost block show-more" data-more="${esc(s.key)}">Show more toys (${n - shown} more)</button>` : ''}
  </section>`;
}

// Nothing matches: never a dead end, offer to ask the shop.
function emptyHtml() {
  const what = state.filter.q || describe().toLowerCase();
  const link = waLink(state.settings.whatsapp_number, `Hi All Seazons! Do you have ${what}?`);
  return `<div class="nothing">
    <p>No toys match right now. We get new toys every week, so ask us. We may have it!</p>
    <a class="btn wa block big" href="${esc(link)}" target="_blank" rel="noopener">Ask us on WhatsApp</a>
    <button type="button" class="btn ghost block" data-clear>Show all toys</button>
  </div>`;
}

let soldWatch;
function render({ reset = false } = {}) {
  if (reset) for (const k of unfolded.keys()) unfolded.set(k, PAGE);
  renderHero();
  renderPicks();
  renderCats();
  const sections = buildSections();
  const html = sections.map(sectionHtml).join('');
  // Nothing changed (a background refresh): leave the page alone, so
  // pictures do not flicker and the lines keep their place.
  if (html !== sectionsHtml) {
    $('#sections').innerHTML = html;
    sectionsHtml = html;
    watchSold();
  }
  $('#status').textContent = '';
  renderCartCount();
}

// Sold toys are only fetched when someone scrolls down to them.
function watchSold() {
  const sec = $('#soldSec');
  soldWatch?.disconnect();
  if (!sec) return;
  if (!('IntersectionObserver' in window)) { loadSold().then(() => render()); return; }
  soldWatch = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      soldWatch.disconnect();
      loadSold().then(() => render());
    }
  }, { rootMargin: '600px 0px' });
  soldWatch.observe(sec);
}

// Ticks the Buy buttons in place, so the lines do not jump back to the start.
function refreshButtons(id) {
  document.querySelectorAll(`[data-add="${CSS.escape(id)}"]`).forEach((b) => {
    if (b.closest('#toyBody')) return;
    b.outerHTML = addButton(id, inCart(id));
  });
  sectionsHtml = '';
  heroHtml = '';
}

// After a choice, bring the results into view under the sticky header.
function scrollToSections() {
  const top = $('#sections').getBoundingClientRect().top + scrollY - $('.top').offsetHeight - 10;
  scrollTo({ top, behavior: 'smooth' });
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

const FOR_WHO = { boys: 'For boys', girls: 'For girls', neutral: 'For boys and girls' };

// Opens WhatsApp with the toy's name, code, price and a link back to it.
function askLink(t) {
  const page = new URL(location.pathname + '#' + encodeURIComponent(t.code), location.href).href;
  return waLink(state.settings.whatsapp_number, `Hi All Seazons! I'd like to ask about the ${t.name} (${t.code}), ${kwacha(effectivePrice(t))}. ${page}`);
}

function openToy(t) {
  const sold = t.status === 'sold';
  const hold = t.status === 'reserved';
  $('#toyBody').innerHTML = `
    <div class="inner toy-detail">
      ${galleryHtml(t)}
      <h2 id="toyTitle">${esc(t.name)}</h2>
      ${sold ? '<p><strong>Sold.</strong> Ask us on WhatsApp if you want something similar.</p>' : priceHtml(t)}
      ${hold ? '<p><strong>On hold</strong> for another customer. It may come back soon.</p>' : ''}
      <div class="toy-actions">
        ${sold || hold ? '' : inCart(t.id)
          ? `<p class="in-order">✓ This toy is in my order</p>
             <button class="btn wa block big" data-finish>Finish my order →</button>`
          : `<button class="btn buy block big" data-add="${t.id}">${PLUS} Buy this toy</button>`}
        <a class="btn ghost block ask" href="${esc(askLink(t))}" target="_blank" rel="noopener">💬 Ask us about this toy</a>
        <button type="button" class="btn ghost block" data-close>← Back to all toys</button>
      </div>
      <div class="tags">
        <span class="tag ${t.audience}">${esc(FOR_WHO[t.audience] || FOR_WHO.neutral)}</span>
        <span class="tag">${esc(CONDITIONS[t.condition])}</span>
        ${t.category ? `<span class="tag">${esc(t.category)}</span>` : ''}
        ${t.age_range ? `<span class="tag">${esc(ageLabel(t.age_range))}</span>` : ''}
        ${t.brand ? `<span class="tag">${esc(t.brand)}</span>` : ''}
        ${t.quantity > 1 && !sold ? `<span class="tag">${t.quantity} in stock</span>` : ''}
      </div>
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <p class="meta" style="color:var(--muted);font-size:13px">Toy code ${esc(t.code)}</p>
    </div>`;
  const slides = $('#toyBody .slides');
  document.querySelectorAll('#toyBody [data-goto]').forEach((b) => b.onclick = () => {
    const target = slides.querySelector(`[data-slide="${b.dataset.goto}"]`);
    slides.scrollTo({ left: target.offsetLeft - slides.offsetLeft, behavior: 'smooth' });
  });
  if (location.hash !== '#' + t.code) history.replaceState(null, '', '#' + t.code);
  $('#toyDialog').showModal();
  track('toy', { toy_code: t.code });
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
  refreshButtons(id);
  renderCartCount();
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
    body.innerHTML = `<div class="inner"><h2 id="cartTitle">My order</h2><p class="empty">Nothing here yet. Tap <b>Buy</b> on any toy.</p></div>`;
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
      <button type="button" class="remove" data-remove="${l.id}" aria-label="Remove ${esc(name)}">Remove</button>
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
      <h2 id="cartTitle">My order</h2>
      <p class="calm"><b>You do not pay now.</b> We check your toys and reply on WhatsApp. Then you pay.</p>
      ${list}
      <div class="two-col">
        <label class="field"><span>Your name</span><input type="text" name="name" autocomplete="name" required value="${esc(c.name || '')}"></label>
        <label class="field"><span>WhatsApp number</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="0977 123 456" required value="${esc(c.phone || '')}"></label>
      </div>
      <div class="field"><span>How do you want to get your toys?</span>
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
      <div class="field"><span>How will you pay after we confirm?</span>
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
        ${state.busy ? 'Holding your toys…' : 'Send my order on WhatsApp'}
      </button>
      <p style="font-size:15px;color:var(--ink-2);text-align:center;margin:8px 0 0">We hold your toys for ${Math.round((s.hold_minutes || 120) / 60 * 10) / 10} hours while we confirm on WhatsApp.</p>
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
  track('order', { order_code: data.code });
  save('as_last_order', state.lastOrder);
  state.cart = [];
  save('as_cart', state.cart);
  state.step = 'done';
  renderCart();
  loadToys();
  setTimeout(() => { window.location.href = link; }, 900);
}

// --------------------------------------------------------------- events

// Taps on any "chat on WhatsApp" link (not the order itself, counted above).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="https://wa.me"]');
  if (a && a.id !== 'waGo') track('whatsapp');
}, true);

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, a');
  if (!el) return;
  if (el.dataset.cat !== undefined) {
    state.filter.category = state.filter.category === el.dataset.cat ? '' : el.dataset.cat;
    unfolded.delete('pick');
    render({ reset: true });
    scrollToSections();
  } else if (el.dataset.who !== undefined) {
    state.filter.who = el.dataset.who;
    unfolded.delete('pick');
    render({ reset: true });
    scrollToSections();
  } else if (el.dataset.setFilter) {
    const key = el.dataset.setFilter;
    state.filter[key] = key === 'budget' ? Number(el.dataset.value) : el.dataset.value;
    render({ reset: true });
  } else if (el.dataset.clear !== undefined) {
    Object.assign(state.filter, { who: '', category: '', age: '', condition: '', budget: 0, sort: 'new', q: '' });
    $('#search').value = '';
    render({ reset: true });
    $('#choose').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } else if (el.dataset.hero) {
    moveHero(Number(el.dataset.hero));
  } else if (el.dataset.finish !== undefined) {
    $('#toyDialog').close();
    openCart();
  } else if (el.dataset.unfold) {
    unfolded.set(el.dataset.unfold, PAGE);
    render();
    document.querySelector(`[data-sec="${CSS.escape(el.dataset.unfold)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } else if (el.dataset.fold) {
    unfolded.delete(el.dataset.fold);
    render();
    document.querySelector(`[data-sec="${CSS.escape(el.dataset.fold)}"]`)?.scrollIntoView({ block: 'nearest' });
  } else if (el.dataset.more) {
    unfolded.set(el.dataset.more, (unfolded.get(el.dataset.more) || PAGE) + PAGE);
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
    refreshButtons(el.dataset.remove);
    renderCartCount();
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
  searchTimer = setTimeout(() => {
    const was = state.filter.q;
    state.filter.q = e.target.value.trim();
    render({ reset: true });
    // The picture buttons fold away while searching: start at the results.
    if (Boolean(was) !== Boolean(state.filter.q)) scrollTo({ top: 0 });
  }, 150);
});

$('#toyDialog').addEventListener('close', () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
window.addEventListener('hashchange', openFromHash);

// "How to buy" is open on someone's first visit, then folds to one line.
try {
  if (!localStorage.getItem('as_seen_how')) $('#how').open = true;
  localStorage.setItem('as_seen_how', '1');
} catch { $('#how').open = true; }

loadAll().then(subscribeLive);
