// "Make a post": the staff app's maker for social media posts that are not
// a single toy in its frame: holidays, special deals, questions and games,
// and announcements. Pick a kind, fill in a few words, then move, resize and
// zoom anything by touch, and save every post at high quality.
//
// mount(root, deps) where deps = {
//   loadToys(): Promise<toys>        toys in the shop, for picking
//   toyImage(toy): Promise<Blob>     the best photo of a toy
//   settings: { whatsapp_number }    the shop settings
// }
import { esc, kwacha, effectivePrice } from '../lib.js';
import { searchToys, wireSearchBox } from '../search.js';
import { loadBitmap, canvasBlob } from '../frame.js';
import { makeZip } from '../unzip.js';
import { toast, openPanel, closePanel, busy } from '../staff/ui.js';
import { S, THEMES, MASCOTS, FONT_LABELS, mascotOk, pickMascot, loadStudioAssets, drawPage, renderPage, photoPlacement } from './render.js';
import { FAMILIES, ASK_KINDS, DEAL_DEFAULT, NEWS_DEFAULT, makePages, caption, uid } from './templates.js';

// Kept while the app is open, so leaving the page and coming back keeps the post.
const st = {
  view: 'pick',
  family: null,
  opts: null,
  toys: [],
  pages: [],
  cur: 0,
  sel: null,
  dragMode: 'inside',
  undo: [],
};
const images = new Map();
let root = null;
let deps = null;

const COLORS = ['#1a1424', '#ffffff', '#d61f2c', '#f2611f', '#f9bb16', '#a8d432', '#17663a', '#4f7dc6', '#7fb2ca', '#e58fb6', '#f9ddea'];
const QUALITY = {
  best: { label: 'Best', hint: '2160 × 2160 JPEG, sharp on every app', px: 2160, type: 'image/jpeg', q: 0.95 },
  max: { label: 'Highest', hint: '2160 × 2160 PNG, no compression (bigger file)', px: 2160, type: 'image/png' },
  small: { label: 'Small', hint: '1080 × 1080 JPEG, quick to send', px: 1080, type: 'image/jpeg', q: 0.92 },
};

const mascotUrl = (m) => new URL(`../../img/mascots/${m}.webp`, import.meta.url).href;
const $ = (sel) => root?.querySelector(sel);
const page = () => st.pages[st.cur];
const layer = (id = st.sel) => page()?.layers.find((l) => l.id === id);
const isCoarse = () => window.matchMedia('(pointer: coarse)').matches;

function waPretty(num) {
  const d = String(num || '').replace(/\D/g, '');
  const local = d.startsWith('260') ? `0${d.slice(3)}` : d;
  return local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
}
function contact() {
  return { site: 'allseazons.shop', wa: waPretty(deps.settings?.whatsapp_number || '260762750240') };
}

export async function mount(el, d) {
  root = el;
  deps = d;
  root.innerHTML = '<p class="lead">Loading…</p>';
  await loadStudioAssets().then((m) => m.forEach((v, k) => images.set(k, v)));
  if (!root) return;
  render();
}
export function unmount() {
  root = null;
  window.removeEventListener('resize', schedule);
}

function render() {
  if (!root) return;
  if (st.view === 'edit' && st.pages.length) return renderEdit();
  if (st.view === 'setup' && st.family) return renderSetup();
  renderPick();
}

// ---------- 1. pick a kind ----------

const FAMILY_LOOK = {
  holiday: { bg: 'var(--orange)', fg: '#fff', mascot: 'spri' },
  deal: { bg: 'var(--yellow)', fg: 'var(--ink)', mascot: 'auty' },
  ask: { bg: 'var(--blue)', fg: 'var(--ink)', mascot: 'sammy' },
  news: { bg: 'var(--pink)', fg: 'var(--ink)', mascot: 'winnie' },
};

function renderPick() {
  root.innerHTML = `
    <div class="page-head"><h1>Make a post</h1></div>
    <p class="lead">Pick what you want to post. Everything can be changed after: words, colours, where things sit.</p>
    ${st.pages.length ? `<button class="btn block st-continue" data-continue>Carry on with your ${st.pages.length === 1 ? 'post' : `${st.pages.length} posts`}</button>` : ''}
    <div class="opts-list st-families">
      ${Object.entries(FAMILIES).map(([k, f]) => `
        <button type="button" class="opt" data-family="${k}" style="--c:${FAMILY_LOOK[k].bg};color:${FAMILY_LOOK[k].fg}">
          <span class="otext"><b>${esc(f.label)}</b><small>${esc(f.hint)}</small></span>
          <img class="mascot" src="${mascotUrl(FAMILY_LOOK[k].mascot)}" alt="" width="56" height="67" loading="lazy" decoding="async">
        </button>`).join('')}
    </div>
    <p class="hint st-foot">For one toy in its blue or pink frame, use Stock, then Social media pack.</p>`;
  root.querySelector('[data-continue]')?.addEventListener('click', () => { st.view = 'edit'; render(); });
  root.querySelectorAll('[data-family]').forEach((b) => b.addEventListener('click', () => startSetup(b.dataset.family)));
}

function startSetup(family) {
  const f = FAMILIES[family];
  const theme = f.themes[0];
  const t = THEMES[theme];
  st.family = family;
  st.toys = [];
  st.opts = {
    theme,
    headline: family === 'holiday' ? t.headline : family === 'deal' ? DEAL_DEFAULT.headline : family === 'news' ? NEWS_DEFAULT.headline : ASK_KINDS.question.headline,
    line: family === 'holiday' ? t.line : family === 'deal' ? DEAL_DEFAULT.line : NEWS_DEFAULT.line,
    big: DEAL_DEFAULT.big,
    small: DEAL_DEFAULT.small,
    kind: 'question',
    text: ASK_KINDS.question.text,
    options: [...ASK_KINDS.quiz.options],
    cta: ASK_KINDS.question.cta,
    edited: {},
  };
  st.view = 'setup';
  render();
}

// ---------- 2. a few words ----------

function themeChips(selected, list) {
  return `<div class="st-scroll">${list.map((k) => `<button type="button" class="chip" data-theme="${k}" aria-pressed="${k === selected}">
    <span class="dot" style="background:${THEMES[k].bg}"></span>${esc(THEMES[k].label)}</button>`).join('')}</div>`;
}

function field(label, name, value, { area = false, hint = '' } = {}) {
  const v = esc(value ?? '');
  return `<label class="field"><span>${esc(label)}</span>${area ? `<textarea name="${name}" rows="3">${v}</textarea>` : `<input type="text" name="${name}" value="${v}">`}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function toysNeeded() {
  const { family } = st;
  const kind = st.opts.kind;
  if (family === 'ask') return { max: kind === 'thisorthat' ? 2 : 1, min: kind === 'thisorthat' ? 2 : kind === 'guess' ? 1 : 0 };
  return { max: family === 'news' ? 4 : 10, min: family === 'deal' ? 1 : 0 };
}

function toysHint() {
  const { family } = st;
  const kind = st.opts.kind;
  if (family === 'holiday') return 'Optional. Each toy gets its own post in this style, after the greeting.';
  if (family === 'deal') return 'The first post shows them together with the deal; then one post per toy with its new price.';
  if (family === 'news') return 'Optional. Up to 4 photos on the post.';
  if (kind === 'thisorthat') return 'Pick 2 toys: A and B.';
  if (kind === 'guess') return 'Pick 1 toy, then zoom in close on one part of it.';
  return 'Optional. A small photo next to the mascot.';
}

function percent() {
  const m = /^\s*(\d{1,2})\s*%\s*$/.exec(st.opts.big || '');
  return m ? Number(m[1]) : null;
}
const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

function renderSetup() {
  const o = st.opts;
  const f = FAMILIES[st.family];
  const fam = st.family;
  const need = toysNeeded();
  const kindRow = fam === 'ask' ? `<div class="field"><span>What kind?</span><div class="st-scroll">${Object.entries(ASK_KINDS).map(([k, v]) =>
    `<button type="button" class="chip" data-kind="${k}" aria-pressed="${k === o.kind}">${esc(v.label)}</button>`).join('')}</div></div>` : '';
  let words = '';
  if (fam === 'holiday') words = field('Big words', 'headline', o.headline) + field('Message', 'line', o.line);
  if (fam === 'news') words = field('Big words', 'headline', o.headline) + field('Message', 'line', o.line);
  if (fam === 'deal') {
    words = field('Big words', 'headline', o.headline)
      + `<div class="st-two">${field('Deal', 'big', o.big, { hint: 'e.g. 20%, K50, 2 for 1' })}${field('Under it', 'small', o.small)}</div>`
      + field('When', 'line', o.line);
  }
  if (fam === 'ask') {
    words = field('Big words', 'headline', o.headline);
    if (o.kind !== 'thisorthat' && o.kind !== 'guess') words += field(o.kind === 'fact' ? 'The fact' : 'Your question', 'text', o.text, { area: true });
    if (o.kind === 'quiz') words += `<div class="field"><span>Answers</span>${[0, 1, 2].map((i) => `<input type="text" name="opt${i}" value="${esc(o.options[i] || '')}" placeholder="Answer ${'ABC'[i]}">`).join('')}</div>`;
    words += field('Bottom line', 'cta', o.cta);
  }
  const pct = percent();
  root.innerHTML = `
    <div class="page-head"><button class="back st-back" data-back aria-label="Back">‹</button><h1>${esc(f.label)}</h1></div>
    <form class="st-setup card-box" autocomplete="off">
      ${kindRow}
      <div class="field"><span>Background</span>${themeChips(o.theme, f.themes)}</div>
      ${words}
      ${need.max ? `<div class="field"><span>Toys in this post</span>
        <div class="st-toys">${st.toys.map((t, i) => `
          <div class="st-toy">
            ${t.thumb ? `<img src="${esc(t.thumb)}" alt="" width="56" height="56">` : '<i></i>'}
            <div class="st-toy-text"><b>${esc(t.name || 'Photo from phone')}</b>
            ${fam === 'deal' ? `<span class="st-price-edit">${t.price ? `<s>${kwacha(t.price)}</s>` : ''} now K<input type="number" inputmode="numeric" min="0" step="5" data-now="${i}" value="${esc(String(t.nowN ?? ''))}" placeholder="${t.price && pct ? round5(t.price * (1 - pct / 100)) : ''}"></span>` : t.price ? `<small>${kwacha(effectivePrice(t.raw || t))}</small>` : ''}</div>
            <button type="button" class="x" data-drop="${i}" aria-label="Remove">×</button>
          </div>`).join('')}</div>
        ${st.toys.length < need.max ? `<div class="row-actions st-add-toys"><button type="button" class="btn ghost" data-stock>From stock</button><label class="btn ghost">From phone<input type="file" accept="image/*" ${need.max > 1 ? 'multiple' : ''} data-phone hidden></label></div>` : ''}
        <small class="hint">${esc(toysHint())}${fam === 'deal' && pct ? ` New prices are ${pct}% off, rounded to K5, unless you type one.` : ''}</small></div>` : ''}
      <button class="btn block st-make" type="submit">Make my post${fam === 'deal' || (fam === 'holiday' && st.toys.length) ? 's' : ''}</button>
    </form>`;
  const form = root.querySelector('form');
  root.querySelector('[data-back]').onclick = () => { st.view = 'pick'; render(); };
  root.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    const t = THEMES[b.dataset.theme];
    o.theme = b.dataset.theme;
    if (fam === 'holiday') {
      if (!o.edited.headline) o.headline = t.headline;
      if (!o.edited.line) o.line = t.line;
    }
    renderSetup();
  }));
  root.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    const k = ASK_KINDS[b.dataset.kind];
    o.kind = b.dataset.kind;
    if (!o.edited.headline) o.headline = k.headline;
    if (!o.edited.text) o.text = k.text;
    if (!o.edited.cta) o.cta = k.cta;
    st.toys = st.toys.slice(0, toysNeeded().max);
    renderSetup();
  }));
  form.addEventListener('input', (e) => {
    const n = e.target.name;
    if (!n) return;
    if (/^opt\d$/.test(n)) o.options[Number(n.slice(3))] = e.target.value;
    else { o[n] = e.target.value; o.edited[n] = true; }
    if (n === 'big') root.querySelectorAll('[data-now]').forEach((inp) => {
      const t = st.toys[Number(inp.dataset.now)];
      const p = percent();
      inp.placeholder = t.price && p ? round5(t.price * (1 - p / 100)) : '';
    });
  });
  root.querySelectorAll('[data-now]').forEach((inp) => inp.addEventListener('input', () => {
    const v = inp.value.trim();
    st.toys[Number(inp.dataset.now)].nowN = v === '' ? null : Number(v);
  }));
  root.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => { st.toys.splice(Number(b.dataset.drop), 1); renderSetup(); }));
  root.querySelector('[data-stock]')?.addEventListener('click', () => pickFromStock(need.max - st.toys.length, (picked) => {
    st.toys.push(...picked);
    renderSetup();
  }));
  root.querySelector('[data-phone]')?.addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, need.max - st.toys.length);
    const added = await Promise.all(files.map(phonePhoto));
    st.toys.push(...added.filter(Boolean).map((p) => ({ src: p.key, thumb: p.thumb, name: '' })));
    renderSetup();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (st.toys.length < need.min) return toast(need.min === 2 ? 'Pick 2 toys for This or that.' : 'Pick a toy first.', true);
    const btn = form.querySelector('.st-make');
    busy(btn, true, 'Getting photos…');
    try {
      await Promise.all(st.toys.map(loadToyImage));
    } finally {
      busy(btn, false);
    }
    const pct2 = percent();
    const toys = st.toys.map((t) => {
      let now = '';
      let old = '';
      if (fam === 'deal') {
        const n = t.nowN ?? (t.price && pct2 ? round5(t.price * (1 - pct2 / 100)) : null);
        now = n ? kwacha(n) : '';
        old = t.price && n && n < t.price ? kwacha(t.price) : '';
      } else if (t.raw && fam !== 'ask') {
        now = kwacha(effectivePrice(t.raw));
        old = effectivePrice(t.raw) < t.raw.price ? kwacha(t.raw.price) : '';
      }
      return { src: t.src, name: t.name, now, old };
    });
    pushUndo();
    st.pages = makePages(fam, { ...o, toys, ...contact() });
    st.cur = 0;
    st.sel = null;
    st.view = 'edit';
    render();
  });
}

// A photo from the phone: full quality, turned the right way up, kept up to
// 3000 px (enough to zoom in for a 2160 px post).
async function phonePhoto(file) {
  try {
    let img = await loadBitmap(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const k = 3000 / Math.max(w, h);
    if (k < 1) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      img.close?.();
      img = c;
    }
    const key = `file:${uid()}`;
    images.set(key, img);
    return { key, thumb: URL.createObjectURL(file) };
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

async function loadToyImage(t) {
  if (!t.src || images.has(t.src) || !t.raw) return;
  try {
    images.set(t.src, await loadBitmap(await deps.toyImage(t.raw)));
  } catch (e) {
    console.warn('toy photo', t.raw.id, e);
    toast(`The photo of ${t.name} could not be loaded.`, true);
  }
}

let stockCache = null;
async function pickFromStock(max, done) {
  const body = openPanel(`<h2>Pick toys</h2><input type="search" placeholder="Search toys" class="st-search" aria-label="Search toys"><p class="hint">Loading…</p>`, { wide: true });
  try {
    stockCache = stockCache || await deps.loadToys();
  } catch (e) {
    body.querySelector('.hint').textContent = e.message;
    return;
  }
  const chosen = new Set();
  const draw = (q = '') => {
    const list = searchToys(stockCache, q).toys.slice(0, 120);
    body.querySelector('.hint')?.remove();
    body.querySelector('.pick-grid')?.remove();
    body.querySelector('.st-pick-go')?.remove();
    body.insertAdjacentHTML('beforeend', `<div class="pick-grid">${list.map((t) => `
      <button type="button" class="pick" data-id="${esc(t.id)}" aria-pressed="${chosen.has(t.id)}">
        <img src="${esc(t.thumb || '')}" alt="" loading="lazy" width="104" height="104"><span>${esc(t.name)}</span><small>${kwacha(effectivePrice(t))}</small>
      </button>`).join('') || '<p>No toys found.</p>'}</div>
      <div class="st-pick-go"><button class="btn block" data-go>Add ${chosen.size || ''} toy${chosen.size === 1 ? '' : 's'}</button></div>`);
    body.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (chosen.has(id)) chosen.delete(id);
      else if (chosen.size < max) chosen.add(id);
      else return toast(max === 1 ? 'One toy here.' : `Up to ${max} toys here.`);
      draw(shownFor);
    }));
    body.querySelector('[data-go]').addEventListener('click', () => {
      const picked = stockCache.filter((t) => chosen.has(t.id)).map((t) => ({ src: `toy:${t.id}`, thumb: t.thumb, name: t.name, price: t.price, raw: t }));
      closePanel();
      done(picked);
    });
  };
  // Search on Search / Enter or when the box is left, never while typing.
  let shownFor = '';
  wireSearchBox(body.querySelector('.st-search'), (text) => { shownFor = text; draw(text); });
  draw();
}

// ---------- 3. the editor ----------

let canvas = null;
let boxes = new Map();
let guides = null;
let raf = 0;
let thumbTimer = 0;

function pushUndo() {
  st.undo.push(JSON.stringify({ pages: st.pages, cur: st.cur }));
  if (st.undo.length > 40) st.undo.shift();
  const u = $('[data-undo]');
  if (u) u.disabled = false;
}
function undo() {
  const last = st.undo.pop();
  if (!last) return;
  const s = JSON.parse(last);
  st.pages = s.pages;
  st.cur = Math.min(s.cur, st.pages.length - 1);
  st.sel = null;
  if (!st.pages.length) { st.view = 'pick'; return render(); }
  renderEdit();
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    drawStage();
  });
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(drawThumbs, 350);
}

function drawStage() {
  if (!canvas || !root) return;
  const css = canvas.clientWidth || 360;
  const px = Math.min(1600, Math.round(css * (window.devicePixelRatio || 1)));
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  boxes = drawPage(ctx, page(), images, { px, selected: st.sel, guides });
}

function drawThumbs() {
  root?.querySelectorAll('canvas[data-thumb]').forEach((c) => {
    const p = st.pages[Number(c.dataset.thumb)];
    if (!p) return;
    const ctx = c.getContext('2d');
    drawPage(ctx, p, images, { px: c.width });
  });
}

function renderEdit() {
  const n = st.pages.length;
  root.innerHTML = `
    <div class="st-bar">
      <button class="back st-back" data-setup aria-label="Back to the words">‹</button>
      <b class="st-title">${n > 1 ? `Post ${st.cur + 1} of ${n}` : 'Your post'}</b>
      <button class="btn ghost small" data-undo ${st.undo.length ? '' : 'disabled'}>Undo</button>
      <button class="btn small st-save-top" data-save>Save</button>
    </div>
    <div class="st-stage"><canvas id="stCanvas" width="${S}" height="${S}" aria-label="Post preview"></canvas></div>
    <p class="st-tip">Tap a part to change it. Drag to move it. Pinch, or use the sliders, to make it bigger or smaller.</p>
    <div class="st-pages" role="list">
      ${st.pages.map((_, i) => `<button type="button" class="st-thumb" data-page="${i}" aria-pressed="${i === st.cur}" aria-label="Post ${i + 1}"><canvas data-thumb="${i}" width="144" height="144"></canvas></button>`).join('')}
      <button type="button" class="st-thumb st-addpage" data-copy-page aria-label="Copy this post">+<small>Copy</small></button>
    </div>
    <div class="st-tools" id="stTools"></div>
    <div class="st-savebar"><button class="btn block st-save-btn" data-save>Save ${n > 1 ? `all ${n} pictures` : 'picture'}</button></div>`;
  canvas = $('#stCanvas');
  wireStage();
  root.querySelector('[data-setup]').onclick = async () => {
    if (st.family && st.opts) { st.view = 'setup'; render(); } else { st.view = 'pick'; render(); }
  };
  root.querySelector('[data-undo]').onclick = undo;
  root.querySelectorAll('[data-save]').forEach((b) => (b.onclick = openSave));
  root.querySelectorAll('[data-page]').forEach((b) => (b.onclick = () => { st.cur = Number(b.dataset.page); st.sel = null; renderEdit(); }));
  root.querySelector('[data-copy-page]').onclick = () => {
    pushUndo();
    const copy = JSON.parse(JSON.stringify(page()));
    copy.layers.forEach((l) => (l.id = uid()));
    st.pages.splice(st.cur + 1, 0, copy);
    st.cur += 1;
    st.sel = null;
    renderEdit();
  };
  renderTools();
  window.removeEventListener('resize', schedule);
  window.addEventListener('resize', schedule);
  drawStage();
  drawThumbs();
}

// --- touch: tap to pick, drag to move, pinch to resize or zoom ---

function toGrid(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
}

function hit(pt) {
  const ls = page().layers;
  for (let i = ls.length - 1; i >= 0; i--) {
    const b = boxes.get(ls[i].id);
    if (b && pt.x >= b.x - 10 && pt.x <= b.x + b.w + 10 && pt.y >= b.y - 10 && pt.y <= b.y + b.h + 10) return ls[i];
  }
  return null;
}

function photoInner(l) {
  const b = l.border === 'none' ? 0 : 16;
  return [l.w - 2 * b, l.h - 2 * b];
}

function wireStage() {
  const pts = new Map();
  let g = null; // the gesture in progress
  let lastTap = 0;
  const begin = () => {
    const l = layer();
    if (!l) { g = null; return; }
    const arr = [...pts.values()];
    g = { l, x: l.x, y: l.y, s: l.s || 1, zoom: l.zoom || 1, px: l.px || 0, py: l.py || 0, start: arr.map((p) => ({ ...p })), moved: false };
    if (arr.length === 2) g.dist = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) || 1;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pt = toGrid(e);
    pts.set(e.pointerId, pt);
    if (pts.size === 1) {
      const l = hit(pt);
      const was = st.sel;
      st.sel = l?.id || null;
      if (was !== st.sel) renderTools();
      const now = Date.now();
      if (l && was === l.id && now - lastTap < 350) {
        if (l.kind === 'text') root.querySelector('#stTools textarea')?.focus();
      }
      lastTap = now;
      if (l?.kind === 'photo' && !images.get(l.src) && was !== l.id) choosePhoto(l);
    }
    begin();
    schedule();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, toGrid(e));
    const arr = [...pts.values()];
    const l = g.l;
    if (!g.moved) { pushUndo(); g.moved = true; }
    const inside = l.kind === 'photo' && st.dragMode === 'inside' && images.get(l.src);
    if (arr.length >= 2 && g.dist) {
      const ratio = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) / g.dist;
      if (inside) {
        const [iw, ih] = photoInner(l);
        const min = photoPlacement({ zoom: 1 }, images.get(l.src), iw, ih).minZoom;
        l.zoom = Math.max(min, Math.min(6, g.zoom * ratio));
      } else l.s = Math.max(0.2, Math.min(4, g.s * ratio));
    } else if (arr.length === 1) {
      const dx = arr[0].x - g.start[0].x;
      const dy = arr[0].y - g.start[0].y;
      if (inside) {
        const [iw, ih] = photoInner(l);
        const p0 = photoPlacement(l, images.get(l.src), iw, ih);
        const s = l.s || 1;
        const p = photoPlacement({ ...l, px: g.px + dx / (p0.dw * s), py: g.py + dy / (p0.dh * s) }, images.get(l.src), iw, ih);
        l.px = p.px;
        l.py = p.py;
      } else {
        let x = g.x + dx;
        let y = g.y + dy;
        guides = { x: Math.abs(x - S / 2) < 14, y: Math.abs(y - S / 2) < 14 };
        if (guides.x) x = S / 2;
        if (guides.y) y = S / 2;
        l.x = Math.round(x);
        l.y = Math.round(y);
      }
    }
    schedule();
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    guides = null;
    if (g?.moved) syncTools();
    begin();
    schedule();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Mouse wheel zooms on a computer.
  canvas.addEventListener('wheel', (e) => {
    const l = layer();
    if (!l) return;
    e.preventDefault();
    const k = Math.exp(-e.deltaY / 400);
    if (l.kind === 'photo' && st.dragMode === 'inside' && images.get(l.src)) {
      const [iw, ih] = photoInner(l);
      const min = photoPlacement({ zoom: 1 }, images.get(l.src), iw, ih).minZoom;
      l.zoom = Math.max(min, Math.min(6, (l.zoom || 1) * k));
    } else l.s = Math.max(0.2, Math.min(4, (l.s || 1) * k));
    syncTools();
    schedule();
  }, { passive: false });
}

// --- the tools under the post ---

function slider(name, label, value, min, max, step) {
  return `<label class="st-slider"><span>${esc(label)}</span><input type="range" data-r="${name}" min="${min}" max="${max}" step="any" data-step="${step}" value="${value}"></label>`;
}
function chips(name, value, list) {
  return `<div class="st-scroll">${list.map(([v, label, extra = '']) => `<button type="button" class="chip" data-c="${name}" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}" ${extra}>${label}</button>`).join('')}</div>`;
}
function swatches(name, value) {
  return `<div class="st-swatches">${COLORS.map((c) => `<button type="button" class="st-sw" data-c="${name}" data-v="${c}" aria-pressed="${c === value}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>`;
}
const order = `<div class="st-actions">
  <button type="button" class="btn ghost small" data-act="front">To front</button>
  <button type="button" class="btn ghost small" data-act="back">To back</button>
  <button type="button" class="btn ghost small" data-act="dup">Copy</button>
  <button type="button" class="btn danger small" data-act="del">Delete</button>
  <button type="button" class="btn small" data-act="done">Done</button></div>`;

function mascotChips(l) {
  const cur = l.src.split(':')[1];
  return `<div class="st-mascots">${Object.entries(MASCOTS).map(([k, m]) => {
    const ok = mascotOk(page().theme, k);
    return `<button type="button" class="st-mascot" data-c="mascot" data-v="${k}" aria-pressed="${k === cur}" ${ok ? '' : 'disabled title="Hard to see on this background"'}>
      <img src="${mascotUrl(k)}" alt="" width="40" height="48"><span>${esc(m.label)}</span></button>`;
  }).join('')}</div>`;
}

function renderTools() {
  const box = $('#stTools');
  if (!box) return;
  const l = layer();
  let html = '';
  if (!l) {
    const p = page();
    html = `
      <h3>Background</h3>${chips('theme', p.theme, Object.entries(THEMES).map(([k, t]) => [k, `<span class="dot" style="background:${t.bg}"></span>${esc(t.label)}`]))}
      <h3>Add</h3>
      <div class="st-add">
        <button type="button" class="btn ghost small" data-add="text">Words</button>
        <button type="button" class="btn ghost small" data-add="bubble">Speech bubble</button>
        <button type="button" class="btn ghost small" data-add="photo">Photo</button>
        <button type="button" class="btn ghost small" data-add="mascot">Mascot</button>
        <button type="button" class="btn ghost small" data-add="badge">Deal sticker</button>
        <button type="button" class="btn ghost small" data-add="price">Price</button>
        <button type="button" class="btn ghost small" data-add="logo">Logo</button>
      </div>
      ${st.pages.length > 1 ? '<div class="st-actions"><button type="button" class="btn danger small" data-act="delpage">Delete this post</button></div>' : ''}`;
  } else if (l.kind === 'text') {
    html = `
      <textarea data-f="text" rows="2" aria-label="Words">${esc(l.text)}</textarea>
      ${slider('s', 'Size', l.s || 1, 0.3, 3, 0.01)}
      <h3>Letters</h3>${chips('font', l.font || 'round', Object.entries(FONT_LABELS).map(([k, v]) => [k, esc(v)]))}
      <h3>Colour</h3>${swatches('color', l.color || THEMES[page().theme].ink)}
      <h3>Look</h3>${chips('style', l.style || 'plain', [['plain', 'Plain'], ['sticker', 'Outline'], ['shadow', 'Shadow']])}
      ${chips('boxed', l.box ? (l.box.tail ? 'bubble' : 'pill') : 'none', [['none', 'No box'], ['pill', 'White box'], ['bubble', 'Speech bubble']])}
      ${slider('tilt', 'Tilt', l.tilt || 0, -0.5, 0.5, 0.01)}
      ${order}`;
  } else if (l.kind === 'photo') {
    const has = images.get(l.src);
    html = `
      <div class="st-actions"><button type="button" class="btn small" data-act="photo">${has ? 'Change photo' : 'Add a photo'}</button>
      ${has ? '<button type="button" class="btn ghost small" data-act="fit">Show whole photo</button><button type="button" class="btn ghost small" data-act="fill">Fill the box</button>' : ''}</div>
      ${has ? `<h3>Dragging moves</h3>${chips('dragMode', st.dragMode, [['inside', 'The photo inside its box'], ['box', 'The whole box']])}
      ${slider('zoom', 'Zoom photo', l.zoom || 1, minZoom(l).toFixed(3), 6, 0.01)}` : ''}
      ${slider('s', 'Box size', l.s || 1, 0.3, 2.5, 0.01)}
      <h3>Box shape</h3>${chips('shape', l.border === 'none' ? 'plain' : l.radius >= Math.min(l.w, l.h) / 2 ? 'round' : 'card', [['card', 'White frame'], ['round', 'Circle'], ['plain', 'No frame']])}
      ${slider('w', 'Box width', l.w, 200, 1080, 2)}${slider('h', 'Box height', l.h, 200, 1080, 2)}
      ${slider('tilt', 'Tilt', l.tilt || 0, -0.5, 0.5, 0.01)}
      ${order}`;
  } else if (l.kind === 'sticker') {
    html = `${l.src.startsWith('mascot:') ? `<h3>Mascot</h3>${mascotChips(l)}` : ''}
      ${slider('s', 'Size', l.s || 1, 0.2, 3, 0.01)}
      ${slider('tilt', 'Tilt', l.tilt || 0, -0.6, 0.6, 0.01)}
      <div class="st-actions"><button type="button" class="btn ghost small" data-act="flip">Flip</button></div>
      ${order}`;
  } else if (l.kind === 'badge') {
    html = `<div class="st-two"><label class="field"><span>Big</span><input type="text" data-f="big" value="${esc(l.big)}"></label>
      <label class="field"><span>Small</span><input type="text" data-f="small" value="${esc(l.small)}"></label></div>
      ${slider('s', 'Size', l.s || 1, 0.3, 3, 0.01)}
      <h3>Shape</h3>${chips('shape', l.shape, [['burst', 'Star'], ['circle', 'Circle'], ['hex', 'Hexagon']])}
      <h3>Colour</h3>${swatches('fill', l.fill || THEMES[page().theme].accent)}
      <h3>Letters</h3>${swatches('color', l.color || THEMES[page().theme].accentInk)}
      ${slider('tilt', 'Tilt', l.tilt || 0, -0.6, 0.6, 0.01)}
      ${order}`;
  } else if (l.kind === 'price') {
    html = `<div class="st-two"><label class="field"><span>Was</span><input type="text" data-f="old" value="${esc(l.old)}" placeholder="K100"></label>
      <label class="field"><span>Now</span><input type="text" data-f="now" value="${esc(l.now)}" placeholder="K80"></label></div>
      ${slider('s', 'Size', l.s || 1, 0.3, 3, 0.01)}
      ${slider('tilt', 'Tilt', l.tilt || 0, -0.5, 0.5, 0.01)}
      ${order}`;
  }
  box.innerHTML = html;
  wireTools(box);
}

function minZoom(l) {
  const img = images.get(l.src);
  if (!img) return 1;
  const [iw, ih] = photoInner(l);
  return photoPlacement({ zoom: 1 }, img, iw, ih).minZoom;
}

// After a drag or pinch, move the sliders to match.
function syncTools() {
  const l = layer();
  if (!l) return;
  for (const r of root.querySelectorAll('#stTools [data-r]')) {
    const v = r.dataset.r === 's' ? l.s || 1 : l[r.dataset.r];
    if (v !== undefined) r.value = v;
  }
}

function wireTools(box) {
  let undoArmed = true;
  const arm = () => { if (undoArmed) { pushUndo(); undoArmed = false; } };
  box.querySelectorAll('[data-f]').forEach((inp) => {
    inp.addEventListener('focus', () => { undoArmed = true; });
    inp.addEventListener('input', () => { arm(); layer()[inp.dataset.f] = inp.value; schedule(); });
  });
  box.querySelectorAll('[data-r]').forEach((r) => {
    r.addEventListener('pointerdown', () => { undoArmed = true; });
    r.addEventListener('input', () => {
      arm();
      const l = layer();
      l[r.dataset.r] = Number(r.value);
      if ((r.dataset.r === 'w' || r.dataset.r === 'h') && l.radius >= 9999) l.radius = 9999;
      schedule();
    });
  });
  box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
    const name = b.dataset.c;
    const v = b.dataset.v;
    const l = layer();
    if (name === 'dragMode') { st.dragMode = v; return renderTools(); }
    pushUndo();
    if (name === 'theme') setTheme(v);
    else if (name === 'mascot') l.src = `mascot:${v}`;
    else if (name === 'boxed') {
      if (v === 'none') l.box = null;
      else l.box = { fill: '#ffffff', radius: v === 'bubble' ? 52 : undefined, tail: v === 'bubble' ? 'left' : undefined };
      if (v !== 'none' && (!l.color || l.color === '#ffffff')) l.color = '#1a1424';
    } else if (name === 'shape' && l.kind === 'photo') {
      if (v === 'plain') { l.border = 'none'; l.radius = 30; }
      else if (v === 'round') { l.border = 'white'; const m = Math.min(l.w, l.h); l.w = m; l.h = m; l.radius = 9999; }
      else { l.border = 'white'; l.radius = 44; }
    } else l[name] = v;
    renderTools();
    schedule();
  }));
  box.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addLayer(b.dataset.add)));
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
}

function setTheme(theme) {
  const p = page();
  p.theme = theme;
  // Mascots never sit on their own colour: swap any that would.
  const swapped = [];
  for (const l of p.layers) {
    if (l.kind !== 'sticker' || !l.src.startsWith('mascot:')) continue;
    const m = l.src.split(':')[1];
    if (!mascotOk(theme, m)) {
      const to = pickMascot(theme, m);
      l.src = `mascot:${to}`;
      swapped.push(`${MASCOTS[m].label} → ${MASCOTS[to].label}`);
    }
  }
  if (swapped.length) toast(`Swapped so the mascot stands out: ${swapped.join(', ')}`);
}

function addLayer(kind) {
  pushUndo();
  const p = page();
  const t = THEMES[p.theme];
  let l;
  if (kind === 'text') l = { kind: 'text', text: 'Your words', x: 540, y: 540, size: 80, font: 'round', maxW: 900, color: t.ink, style: t.ink === '#ffffff' ? 'shadow' : 'plain' };
  if (kind === 'bubble') l = { kind: 'text', text: 'Hello!', x: 600, y: 360, size: 64, maxW: 700, color: '#1a1424', box: { fill: '#ffffff', radius: 52, tail: 'left' } };
  if (kind === 'photo') l = { kind: 'photo', x: 540, y: 520, w: 620, h: 520, zoom: 1, px: 0, py: 0, radius: 44 };
  if (kind === 'mascot') l = { kind: 'sticker', src: `mascot:${pickMascot(p.theme, 'spri')}`, x: 220, y: 800, h: 360 };
  if (kind === 'badge') l = { kind: 'badge', shape: 'burst', r: 140, big: '20%', small: 'OFF', x: 860, y: 260, tilt: 0.12 };
  if (kind === 'price') l = { kind: 'price', old: 'K100', now: 'K80', x: 540, y: 900 };
  if (kind === 'logo') l = { kind: 'sticker', src: 'logo', x: 160, y: 100, h: 120 };
  l = { id: uid(), s: 1, ...l };
  p.layers.push(l);
  st.sel = l.id;
  renderTools();
  schedule();
  if (kind === 'photo') choosePhoto(l);
  if (kind === 'text' || kind === 'bubble') setTimeout(() => { const ta = root.querySelector('#stTools textarea'); ta?.focus(); ta?.select(); }, 50);
}

function act(a) {
  const p = page();
  const l = layer();
  if (a === 'done') { st.sel = null; renderTools(); return schedule(); }
  if (a === 'photo') return choosePhoto(l);
  pushUndo();
  if (a === 'delpage') {
    st.pages.splice(st.cur, 1);
    st.cur = Math.max(0, st.cur - 1);
    st.sel = null;
    return renderEdit();
  }
  const i = p.layers.indexOf(l);
  if (a === 'del') { p.layers.splice(i, 1); st.sel = null; }
  if (a === 'front') p.layers.push(...p.layers.splice(i, 1));
  if (a === 'back') p.layers.unshift(...p.layers.splice(i, 1));
  if (a === 'dup') {
    const c = { ...JSON.parse(JSON.stringify(l)), id: uid(), x: l.x + 40, y: l.y + 40 };
    p.layers.splice(i + 1, 0, c);
    st.sel = c.id;
  }
  if (a === 'flip') l.flip = !l.flip;
  if (a === 'fit') { l.zoom = minZoom(l); l.px = 0; l.py = 0; }
  if (a === 'fill') { l.zoom = 1; l.px = 0; l.py = 0; }
  renderTools();
  schedule();
}

function choosePhoto(l) {
  const body = openPanel(`<h2>Photo</h2>
    <div class="opts-list">
      <button type="button" class="opt" data-src="stock" style="--c:var(--yellow)"><span class="otext"><b>A toy from stock</b><small>Its best photo</small></span></button>
      <label class="opt" style="--c:var(--blue)"><input type="file" accept="image/*" hidden data-file><span class="otext"><b>From the phone</b><small>Full quality, straight from the gallery</small></span></label>
    </div>`);
  body.querySelector('[data-src=stock]').onclick = () => pickFromStock(1, async ([t]) => {
    if (!t) return;
    await loadToyImage(t);
    pushUndo();
    Object.assign(l, { src: t.src, zoom: 1, px: 0, py: 0 });
    renderTools();
    schedule();
  });
  body.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    closePanel();
    const p = await phonePhoto(f);
    if (!p) return;
    pushUndo();
    Object.assign(l, { src: p.key, zoom: 1, px: 0, py: 0 });
    renderTools();
    schedule();
  };
}

// ---------- saving ----------

function quality() {
  try { return QUALITY[localStorage.getItem('studio_quality')] ? localStorage.getItem('studio_quality') : 'best'; } catch { return 'best'; }
}

function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function exportPages(list) {
  const q = QUALITY[quality()];
  const ext = q.type === 'image/png' ? 'png' : 'jpg';
  const stamp = new Date().toISOString().slice(0, 10);
  const files = [];
  for (const [i, p] of list.entries()) {
    const c = renderPage(p, images, q.px);
    const blob = q.type === 'image/png'
      ? await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the picture.'))), 'image/png'))
      : await canvasBlob(c, q.q);
    c.width = c.height = 1; // free the memory on small phones
    files.push(new File([blob], `allseazons-${st.family || 'post'}-${stamp}-${String(i + 1).padStart(2, '0')}.${ext}`, { type: q.type }));
  }
  return files;
}

function openSave() {
  st.sel = null;
  renderTools();
  schedule();
  const n = st.pages.length;
  const text = st.opts ? caption(st.family, { ...st.opts, toys: [], ...contact() }) : '';
  const body = openPanel(`
    <h2>Save ${n > 1 ? `${n} pictures` : 'the picture'}</h2>
    <div class="field"><span>Picture quality</span>
      <div class="st-quality">${Object.entries(QUALITY).map(([k, q]) => `
        <button type="button" class="st-q" data-q="${k}" aria-pressed="${k === quality()}"><b>${esc(q.label)}</b><small>${esc(q.hint)}</small></button>`).join('')}</div></div>
    <div class="st-save-actions">
      ${navigator.canShare ? `<button class="btn block" data-share>Share to WhatsApp, Facebook…</button>` : ''}
      <button class="btn block ${navigator.canShare ? 'ghost' : ''}" data-all>Save ${n > 1 ? `all ${n}` : ''} to the phone</button>
      ${n > 1 ? `<button class="btn ghost block" data-one>Save only post ${st.cur + 1}</button>` : ''}
    </div>
    ${text ? `<label class="field"><span>Caption to paste under the post</span><textarea rows="7" data-caption>${esc(text)}</textarea></label>
    <button class="btn ghost" data-copy>Copy caption</button>` : ''}`);
  body.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
    try { localStorage.setItem('studio_quality', b.dataset.q); } catch { /* private mode: stays for now */ }
    body.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const copy = async () => {
    const t = body.querySelector('[data-caption]')?.value;
    if (!t) return;
    try { await navigator.clipboard.writeText(t); toast('Caption copied'); } catch { /* not allowed */ }
  };
  body.querySelector('[data-copy]')?.addEventListener('click', copy);
  const run = async (btn, list, how) => {
    busy(btn, true, 'Making pictures…');
    try {
      const files = await exportPages(list);
      if (how === 'share') {
        await copy();
        if (navigator.canShare({ files })) {
          await navigator.share({ files, text: body.querySelector('[data-caption]')?.value || '' });
          return;
        }
        toast('This phone cannot share pictures from here, so they are saved instead.');
      }
      if (files.length > 1 && !isCoarse()) {
        saveBlob(`allseazons-posts-${new Date().toISOString().slice(0, 10)}.zip`, makeZip(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))));
      } else {
        for (const f of files) {
          saveBlob(f.name, f);
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      toast(files.length > 1 ? `${files.length} pictures saved` : 'Picture saved');
    } catch (e) {
      if (e?.name !== 'AbortError') toast(e.message || String(e), true);
    } finally {
      busy(btn, false);
    }
  };
  body.querySelector('[data-share]')?.addEventListener('click', (e) => run(e.currentTarget, st.pages, 'share'));
  body.querySelector('[data-all]').addEventListener('click', (e) => run(e.currentTarget, st.pages, 'save'));
  body.querySelector('[data-one]')?.addEventListener('click', (e) => run(e.currentTarget, [page()], 'save'));
}
