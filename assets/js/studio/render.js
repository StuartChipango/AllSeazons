// Social posts: draws one square post (a "page") from a list of layers.
// Everything is laid out on a 1080 x 1080 grid and drawn at any size, so the
// same post can be saved at 1080 px or at 2160 px (sharp for Facebook and
// Instagram) without anything moving.
//
// A page: { theme, layers: [...] }. Layer kinds:
//   text    words, wrapped to maxW; style plain / sticker (white outline like
//           the logo) / shadow; optional box (a pill or a speech bubble)
//   photo   a picture inside a rounded box. zoom 1 = the picture just fills
//           the box; px/py move it inside the box; the box never shows a gap
//           unless the picture is zoomed out on purpose.
//   sticker a mascot or the logo
//   badge   a round sticker for a deal ("20%" over "OFF")
//   price   old price crossed out next to the new one
// Every layer has x, y (its middle) and s (its size, 1 = normal).

import { loadFrameFonts } from '../frame.js';

export const S = 1080;
const INK = '#1a1424';

// Mascots and the colour each one is. A mascot is never put on a background
// of its own colour (the owner's rule).
export const MASCOTS = {
  spri: { label: 'Spri', color: 'green', pair: 'auty' },
  sammy: { label: 'Sammy', color: 'yellow', pair: 'winnie' },
  auty: { label: 'Auty', color: 'orange', pair: 'spri' },
  winnie: { label: 'Winnie', color: 'blue', pair: 'sammy' },
};

// Backgrounds. clash: the colour families a mascot must not sit on.
export const THEMES = {
  christmas: { label: 'Christmas', bg: '#c8202f', ink: '#ffffff', head: INK, glow: '#f9bb16', accent: '#f9bb16', accentInk: INK, clash: ['orange'],
    headline: 'Merry Christmas', line: 'Toys for every stocking, from all of us at All Seazons', ribbon: 'Christmas gift idea', emoji: '🎄' },
  xmasgreen: { label: 'Christmas green', bg: '#17663a', ink: '#ffffff', head: INK, glow: '#e8343f', accent: '#e8343f', accentInk: '#ffffff', clash: ['green'],
    headline: 'Merry Christmas', line: 'Toys for every stocking, from all of us at All Seazons', ribbon: 'Christmas gift idea', emoji: '🎄' },
  newyear: { label: 'New Year', bg: '#1d2b55', ink: '#ffffff', head: INK, glow: '#f9bb16', accent: '#f9bb16', accentInk: INK, clash: ['blue'],
    headline: 'Happy New Year', line: 'More play, more smiles. See you in the new year!', ribbon: 'New year, new toys', emoji: '🎉' },
  easter: { label: 'Easter', bg: '#d9f0e4', ink: INK, head: INK, glow: '#f9ddea', accent: '#e58fb6', accentInk: INK, clash: [],
    headline: 'Happy Easter', line: 'Wishing your family a joyful Easter', ribbon: 'Easter treat', emoji: '🐣' },
  zambia: { label: 'Independence', bg: '#198a00', ink: '#ffffff', head: INK, glow: '#ef7d00', accent: '#ef7d00', accentInk: INK, clash: ['green'],
    headline: 'Happy Independence Day', line: 'Proudly Zambian. Celebrating with you!', ribbon: 'Independence special', emoji: '🇿🇲' },
  party: { label: 'Celebration', bg: '#f9bb16', ink: INK, head: INK, glow: '#ffffff', accent: '#f2611f', accentInk: '#ffffff', clash: ['yellow'],
    headline: "Let's celebrate!", line: 'Birthday gifts sorted, from K50', ribbon: 'Perfect birthday gift', emoji: '🎈' },
  school: { label: 'Back to school', bg: '#2e4a3f', ink: '#ffffff', head: INK, glow: '#f9bb16', accent: '#f9bb16', accentInk: INK, clash: ['green'],
    headline: 'Back to school', line: 'Learning toys that make school fun', ribbon: 'Learn through play', emoji: '✏️' },
  sale: { label: 'Orange deal', bg: '#f2611f', ink: '#ffffff', head: INK, glow: '#f9bb16', accent: '#f9bb16', accentInk: INK, clash: ['orange'],
    headline: 'Special deals', line: 'This week only', ribbon: 'Special deal', emoji: '🔥' },
  brand: { label: 'All Seazons', bg: '#7fb2ca', ink: INK, head: INK, glow: '#f2d3e3', accent: '#f9bb16', accentInk: INK, clash: ['blue'],
    headline: 'Play for every season', line: 'Quality toys from K50', ribbon: 'All Seazons pick', emoji: '🧸' },
  pink: { label: 'Pink', bg: '#f9ddea', ink: INK, head: INK, glow: '#ffffff', accent: '#f2611f', accentInk: '#ffffff', clash: [],
    headline: 'Hello!', line: 'Quality toys from K50', ribbon: 'All Seazons pick', emoji: '💖' },
  cream: { label: 'Cream', bg: '#fff8ee', ink: INK, head: INK, glow: '#7fb2ca', accent: '#f9bb16', accentInk: INK, clash: [],
    headline: 'Hello!', line: 'Quality toys from K50', ribbon: 'All Seazons pick', emoji: '✨' },
  sky: { label: 'Sky blue', bg: '#9fcbe0', ink: INK, head: INK, glow: '#ffffff', accent: '#f2611f', accentInk: '#ffffff', clash: ['blue'],
    headline: 'Hello!', line: 'Quality toys from K50', ribbon: 'All Seazons pick', emoji: '☁️' },
};

export const mascotOk = (themeId, mascot) => !(THEMES[themeId]?.clash || []).includes(MASCOTS[mascot]?.color);

// The mascot to use on this background: the one asked for if it shows up
// well, otherwise its partner (green→Auty, yellow→Winnie, orange→Spri,
// blue→Sammy), otherwise the first that works.
export function pickMascot(themeId, want = 'spri') {
  if (mascotOk(themeId, want)) return want;
  const pair = MASCOTS[want]?.pair;
  if (pair && mascotOk(themeId, pair)) return pair;
  return Object.keys(MASCOTS).find((m) => mascotOk(themeId, m));
}

// ---------- pictures and fonts ----------

const art = new Map();
function loadImage(url) {
  if (!art.has(url)) {
    art.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    }));
  }
  return art.get(url);
}

let fonts = { script: 'Fredoka', thin: 'Fredoka' };
let ready;
// Fonts, the logo and the four mascots. Call once before drawing.
export function loadStudioAssets() {
  if (!ready) {
    const img = (p) => new URL(`../../img/${p}`, import.meta.url).href;
    ready = Promise.all([
      loadFrameFonts().then((f) => { fonts = { script: f.bold, thin: f.thin }; }),
      document.fonts.load('700 40px Fredoka').catch(() => {}),
      document.fonts.load('500 40px Fredoka').catch(() => {}),
      loadImage(img('logo.svg')),
      ...Object.keys(MASCOTS).map((m) => loadImage(img(`mascots/${m}-big.png`))),
    ]).then(([, , , logo, ...ms]) => {
      const out = new Map([['logo', logo]]);
      Object.keys(MASCOTS).forEach((m, i) => out.set(`mascot:${m}`, ms[i]));
      return out;
    });
  }
  return ready;
}

// ---------- small drawing helpers ----------

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FONT_LABELS = { script: 'Brand script', round: 'Round bold', soft: 'Round light', thin: 'Thin script' };
function fontCss(kind, size) {
  if (kind === 'script') return `700 ${size}px "${fonts.script}", Fredoka, sans-serif`;
  if (kind === 'thin') return `300 ${size}px "${fonts.thin}", Fredoka, sans-serif`;
  if (kind === 'soft') return `500 ${size}px Fredoka, "Trebuchet MS", sans-serif`;
  return `700 ${size}px Fredoka, "Trebuchet MS", sans-serif`;
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      if (ctx.measureText(`${line} ${w}`).width <= maxW) line += ` ${w}`;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

// ---------- backgrounds ----------

function snowflake(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(2, r * 0.14);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -r);
    ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.25, -r * 0.8);
    ctx.moveTo(0, -r * 0.55); ctx.lineTo(-r * 0.25, -r * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

function sparkle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function confetti(ctx, rand, colors, n, size = 1) {
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.translate(rand() * S, rand() * S);
    ctx.rotate(rand() * Math.PI);
    ctx.fillStyle = colors[i % colors.length];
    if (i % 3 === 0) { ctx.beginPath(); ctx.arc(0, 0, 9 * size, 0, Math.PI * 2); ctx.fill(); } else rr(ctx, -16 * size, -6 * size, 32 * size, 12 * size, 6 * size), ctx.fill();
    ctx.restore();
  }
}

// Spots near the edges, so decorations stay out of the middle.
function edgeSpots(rand, n, margin = 210) {
  const spots = [];
  while (spots.length < n) {
    const x = rand() * S;
    const y = rand() * S;
    if (x < margin || x > S - margin || y < margin || y > S - margin) spots.push([x, y, rand()]);
  }
  return spots;
}

const DECOR = {
  christmas(ctx, t) {
    const rand = seeded(7);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(rand() * S, rand() * S, 120 + rand() * 160, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    for (const [x, y, k] of edgeSpots(rand, 26)) snowflake(ctx, x, y, 12 + k * 26);
    ctx.fillStyle = t.glow;
    for (const [x, y, k] of edgeSpots(rand, 10)) sparkle(ctx, x, y, 10 + k * 14);
  },
  xmasgreen(ctx, t) { DECOR.christmas(ctx, t); },
  newyear(ctx) {
    const rand = seeded(11);
    confetti(ctx, rand, ['#f9bb16', '#ffffff', '#f9ddea', '#e8c25a'], 70, 1.1);
    ctx.fillStyle = '#ffe28a';
    for (const [x, y, k] of edgeSpots(rand, 14)) sparkle(ctx, x, y, 12 + k * 22);
  },
  easter(ctx) {
    const rand = seeded(5);
    const colors = ['#f9ddea', '#f9bb16', '#9fcbe0', '#a8d432', '#e58fb6'];
    edgeSpots(rand, 16, 190).forEach(([x, y, k], i) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((k - 0.5) * 0.9);
      const w = 34 + k * 26;
      ctx.beginPath(); ctx.ellipse(0, 0, w, w * 1.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = colors[i % colors.length]; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.clip();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6;
      ctx.beginPath();
      for (let zx = -w; zx <= w; zx += w / 3) ctx.lineTo(zx, (Math.round((zx + w) / (w / 3)) % 2 ? -6 : 6));
      ctx.stroke();
      ctx.restore();
    });
  },
  zambia(ctx) {
    // The flag's stripes along the bottom right, with confetti.
    const rand = seeded(3);
    confetti(ctx, rand, ['rgba(255,255,255,.55)', '#ef7d00'], 30);
    const stripes = ['#de2010', '#111111', '#ef7d00'];
    ctx.save();
    ctx.translate(S, S);
    ctx.rotate(-Math.PI / 4);
    stripes.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-400, -150 + i * 50, 800, 50); });
    ctx.restore();
  },
  party(ctx) {
    const rand = seeded(9);
    confetti(ctx, rand, ['#f2611f', '#ffffff', '#4f7dc6', '#e58fb6', '#a8d432'], 80);
    const balloon = (x, y, c) => {
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, y + 70); ctx.quadraticCurveTo(x - 20, y + 130, x + 6, y + 190); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y, 56, 70, 0, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(x - 20, y - 26, 12, 20, -0.5, 0, Math.PI * 2); ctx.fill();
    };
    balloon(90, 120, '#f2611f'); balloon(990, 110, '#4f7dc6'); balloon(1000, 300, '#e58fb6');
  },
  school(ctx) {
    const rand = seeded(13);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const doodles = ['A', 'B', 'C', '1', '2', '3', '+', '=', '★', 'abc', '123', '✓'];
    edgeSpots(rand, 22).forEach(([x, y, k], i) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate((k - 0.5) * 0.6);
      ctx.font = fontCss('round', 40 + k * 46);
      ctx.fillText(doodles[i % doodles.length], 0, 0);
      ctx.restore();
    });
    // Wooden frame.
    ctx.lineWidth = 34; ctx.strokeStyle = '#b07a3c'; ctx.strokeRect(17, 17, S - 34, S - 34);
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.strokeRect(34, 34, S - 68, S - 68); ctx.strokeRect(2.5, 2.5, S - 5, S - 5);
  },
  sale(ctx) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -900); ctx.lineTo(90, -900); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const rand = seeded(17);
    ctx.fillStyle = '#f9bb16';
    for (const [x, y, k] of edgeSpots(rand, 18)) { ctx.beginPath(); ctx.arc(x, y, 6 + k * 10, 0, Math.PI * 2); ctx.fill(); }
  },
  brand(ctx, t) {
    // The pink blobs from the brand artwork.
    ctx.fillStyle = t.glow;
    ctx.beginPath();
    ctx.moveTo(0, 130);
    ctx.bezierCurveTo(260, 40, 560, -40, 700, 120);
    ctx.bezierCurveTo(840, 300, 640, 520, 820, 720);
    ctx.bezierCurveTo(980, 880, 1080, 760, 1080, 1080);
    ctx.lineTo(560, 1080);
    ctx.bezierCurveTo(600, 900, 420, 760, 300, 820);
    ctx.bezierCurveTo(150, 900, 60, 760, 0, 700);
    ctx.closePath();
    ctx.fill();
  },
  pink(ctx) {
    const rand = seeded(21);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (const [x, y, k] of edgeSpots(rand, 34, 180)) { ctx.beginPath(); ctx.arc(x, y, 8 + k * 16, 0, Math.PI * 2); ctx.fill(); }
  },
  cream(ctx) {
    confetti(ctx, seeded(23), ['#f9bb16', '#7fb2ca', '#e58fb6', '#a8d432', '#f2611f'], 46, 0.9);
  },
  sky(ctx) {
    const cloud = (x, y, k) => {
      ctx.beginPath();
      ctx.arc(x, y, 50 * k, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(x + 60 * k, y - 40 * k, 60 * k, Math.PI, Math.PI * 1.85);
      ctx.arc(x + 140 * k, y - 10 * k, 50 * k, Math.PI * 1.37, Math.PI * 0.5);
      ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    cloud(60, 140, 1); cloud(820, 100, 0.8); cloud(860, 960, 1.1); cloud(40, 900, 0.7);
  },
};

const bgCache = new Map();
function background(themeId, px) {
  const key = `${themeId}@${px}`;
  if (!bgCache.has(key)) {
    if (bgCache.size > 12) bgCache.clear();
    const t = THEMES[themeId] || THEMES.brand;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.scale(px / S, px / S);
    g.fillStyle = t.bg;
    g.fillRect(0, 0, S, S);
    DECOR[themeId]?.(g, t);
    bgCache.set(key, c);
  }
  return bgCache.get(key);
}

// ---------- layers ----------

const dims = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

// Where a photo's picture sits inside its box (inner w x h).
export function photoPlacement(layer, img, w, h) {
  const [iw, ih] = dims(img);
  const cover = Math.max(w / iw, h / ih);
  const sc = cover * (layer.zoom || 1);
  const dw = iw * sc;
  const dh = ih * sc;
  // Keep the box filled when the picture is big enough; when it is zoomed
  // out it may move anywhere inside the box.
  const mx = Math.abs(dw - w) / 2 / dw;
  const my = Math.abs(dh - h) / 2 / dh;
  const px = Math.max(-mx, Math.min(mx, layer.px || 0));
  const py = Math.max(-my, Math.min(my, layer.py || 0));
  return { dw, dh, dx: -dw / 2 + px * dw, dy: -dh / 2 + py * dh, px, py, minZoom: Math.min(w / iw, h / ih) / cover };
}

const BORDER = 16;
function drawPhoto(ctx, l, images, theme) {
  const w = l.w;
  const h = l.h;
  const r = l.radius ?? 44;
  const framed = l.border !== 'none';
  if (framed) {
    ctx.fillStyle = INK; // sticker shadow
    rr(ctx, -w / 2, -h / 2 + 12, w, h, r); ctx.fill();
    ctx.fillStyle = '#ffffff';
    rr(ctx, -w / 2, -h / 2, w, h, r); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke();
  }
  const b = framed ? BORDER : 0;
  const iw = w - 2 * b;
  const ih = h - 2 * b;
  ctx.save();
  rr(ctx, -iw / 2, -ih / 2, iw, ih, Math.max(0, r - b));
  ctx.clip();
  ctx.fillStyle = l.fill || '#ffffff';
  ctx.fillRect(-iw / 2, -ih / 2, iw, ih);
  const img = l.src && images.get(l.src);
  if (img) {
    const p = photoPlacement(l, img, iw, ih);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, p.dx, p.dy, p.dw, p.dh);
  } else {
    ctx.fillStyle = '#efe7da';
    ctx.fillRect(-iw / 2, -ih / 2, iw, ih);
    ctx.fillStyle = '#8c8496';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontCss('round', Math.min(56, iw / 9));
    ctx.fillText(l.loading ? 'Loading photo…' : 'Tap to add a photo', 0, 0);
  }
  ctx.restore();
  return { w, h: h + (framed ? 12 : 0) };
}

function drawText(ctx, l, theme) {
  let size = l.size || 60;
  ctx.font = fontCss(l.font || 'round', size);
  let lines = wrap(ctx, l.text, l.maxW || 900);
  // Headlines shrink rather than run onto too many lines.
  while (l.maxLines && size > 30 && (lines.length > l.maxLines || lines.some((t) => ctx.measureText(t).width > (l.maxW || 900)))) {
    size -= 4;
    ctx.font = fontCss(l.font || 'round', size);
    lines = wrap(ctx, l.text, l.maxW || 900);
  }
  const lh = size * (l.lh || (l.font === 'script' || l.font === 'thin' ? 1.0 : 1.15));
  const widths = lines.map((t) => ctx.measureText(t).width);
  const tw = Math.max(1, ...widths);
  const th = lh * lines.length;
  const align = l.align || 'center';
  const x0 = align === 'left' ? -tw / 2 : align === 'right' ? tw / 2 : 0;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  let bw = tw;
  let bh = th;
  const box = l.box;
  if (box) {
    const pad = box.pad ?? size * 0.45;
    bw = tw + pad * 2.2;
    bh = th + pad * 1.4;
    ctx.fillStyle = INK;
    if (box.pop !== false) { rr(ctx, -bw / 2, -bh / 2 + 9, bw, bh, box.radius ?? bh / 2); ctx.fill(); }
    // Speech bubble tail, pointing at the mascot.
    const tail = box.tail;
    const tailPath = () => {
      ctx.beginPath();
      if (tail === 'left') { ctx.moveTo(-bw / 2 + 40, bh / 2 - 34); ctx.lineTo(-bw / 2 - 52, bh / 2 + 40); ctx.lineTo(-bw / 2 + 120, bh / 2 - 6); }
      else if (tail === 'right') { ctx.moveTo(bw / 2 - 40, bh / 2 - 34); ctx.lineTo(bw / 2 + 52, bh / 2 + 40); ctx.lineTo(bw / 2 - 120, bh / 2 - 6); }
      else { ctx.moveTo(-50, bh / 2 - 8); ctx.lineTo(-20, bh / 2 + 70); ctx.lineTo(40, bh / 2 - 8); }
      ctx.closePath();
    };
    ctx.fillStyle = box.fill || '#ffffff';
    ctx.strokeStyle = box.stroke || INK;
    ctx.lineWidth = 6;
    if (tail) { tailPath(); ctx.fill(); ctx.stroke(); }
    rr(ctx, -bw / 2, -bh / 2, bw, bh, box.radius ?? bh / 2);
    ctx.fill();
    if (box.stroke !== 'none') ctx.stroke();
    if (tail) { ctx.save(); tailPath(); ctx.clip(); rr(ctx, -bw / 2 + 3, -bh / 2 + 3, bw - 6, bh - 6, box.radius ?? bh / 2); ctx.fill(); ctx.restore(); }
  }
  const color = l.color || theme.ink;
  lines.forEach((t, i) => {
    const y = -th / 2 + lh * (i + 0.5) + (l.font === 'script' ? size * 0.06 : 0);
    if (l.style === 'sticker') {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = l.glow || theme.glow;
      ctx.lineWidth = size * 0.26;
      ctx.strokeText(t, x0 + size * 0.05, y + size * 0.06);
      ctx.strokeStyle = l.outline || '#ffffff';
      ctx.lineWidth = size * 0.22;
      ctx.strokeText(t, x0, y);
    } else if (l.style === 'shadow') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.06;
      ctx.fillStyle = color;
      ctx.fillText(t, x0, y);
      ctx.restore();
    }
    ctx.fillStyle = color;
    ctx.fillText(t, x0, y);
  });
  const extra = l.style === 'sticker' ? size * 0.3 : 0;
  return { w: bw + extra, h: bh + extra + (box?.tail ? 70 : 0) };
}

function drawSticker(ctx, l, images) {
  const img = images.get(l.src);
  const h = l.h || 300;
  if (!img) return { w: h * 0.7, h };
  const [iw, ih] = dims(img);
  const w = (h * iw) / ih;
  ctx.save();
  if (l.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
  return { w, h };
}

function badgePath(ctx, shape, r) {
  ctx.beginPath();
  if (shape === 'circle') { ctx.arc(0, 0, r, 0, Math.PI * 2); return; }
  if (shape === 'hex') {
    // A soft hexagon with very round corners.
    const pts = [...Array(6)].map((_, i) => [r * Math.cos(Math.PI / 6 + (i * Math.PI) / 3), r * Math.sin(Math.PI / 6 + (i * Math.PI) / 3)]);
    const cr = r * 0.32;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(pts[5], pts[0]);
    ctx.moveTo(...start);
    for (let i = 0; i < 6; i++) ctx.arcTo(...pts[i], ...mid(pts[i], pts[(i + 1) % 6]), cr);
    ctx.closePath();
    return;
  }
  // Burst: a scalloped seal.
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const am = ((i - 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    const p = [Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9];
    if (i === 0) ctx.moveTo(...p);
    else ctx.quadraticCurveTo(Math.cos(am) * r * 1.08, Math.sin(am) * r * 1.08, ...p);
  }
  ctx.closePath();
}

function fitSize(ctx, text, kind, start, maxW) {
  let size = start;
  for (; size > 16; size -= 2) {
    ctx.font = fontCss(kind, size);
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

function drawBadge(ctx, l, theme) {
  const r = l.r || 150;
  const fill = l.fill || theme.accent;
  const color = l.color || theme.accentInk;
  ctx.save();
  ctx.translate(0, 10);
  badgePath(ctx, l.shape, r);
  ctx.fillStyle = INK; ctx.fill();
  ctx.restore();
  badgePath(ctx, l.shape, r);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = String(l.big ?? '').trim();
  const small = String(l.small ?? '').trim();
  const bigSize = fitSize(ctx, big, 'round', r * 0.78, r * 1.45);
  ctx.font = fontCss('round', bigSize);
  ctx.fillText(big, 0, small ? -r * 0.12 : r * 0.02);
  if (small) {
    const ss = fitSize(ctx, small, 'round', r * 0.34, r * 1.3);
    ctx.font = fontCss('round', ss);
    ctx.fillText(small, 0, r * 0.42);
  }
  return { w: r * 2.1, h: r * 2.1 + 10 };
}

function drawPrice(ctx, l) {
  const old = String(l.old ?? '').trim();
  const now = String(l.now ?? '').trim();
  const bigS = 96;
  const oldS = 54;
  ctx.font = fontCss('round', bigS);
  const nw = ctx.measureText(now).width;
  ctx.font = fontCss('soft', oldS);
  const ow = old ? ctx.measureText(old).width : 0;
  const gap = old ? 34 : 0;
  const w = nw + ow + gap + 90;
  const h = bigS * 1.35;
  ctx.fillStyle = INK;
  rr(ctx, -w / 2, -h / 2 + 9, w, h, h / 2); ctx.fill();
  ctx.fillStyle = l.fill || '#ffffff';
  rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = -w / 2 + 45;
  if (old) {
    ctx.font = fontCss('soft', oldS);
    ctx.fillStyle = '#6b6475';
    ctx.fillText(old, x, 4);
    ctx.strokeStyle = '#d61f2c'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 6, 14); ctx.lineTo(x + ow + 6, -8); ctx.stroke();
    x += ow + gap;
  }
  ctx.font = fontCss('round', bigS);
  ctx.fillStyle = l.color || '#d61f2c';
  ctx.fillText(now, x, 6);
  return { w, h: h + 9 };
}

// Draws one page. scale: pixels per grid unit. Returns each layer's box
// (in grid units) for tapping. opts.selected draws a dashed outline round
// that layer (only on screen, never in a saved picture).
export function drawPage(ctx, page, images, { px = S, selected = null, guides = null } = {}) {
  const k = px / S;
  const theme = THEMES[page.theme] || THEMES.brand;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(background(page.theme, px), 0, 0, px, px);
  ctx.scale(k, k);
  const boxes = new Map();
  for (const l of page.layers) {
    if (l.hidden) continue;
    ctx.save();
    ctx.translate(l.x, l.y);
    if (l.tilt) ctx.rotate(l.tilt);
    const s = l.s || 1;
    ctx.scale(s, s);
    let size;
    if (l.kind === 'photo') size = drawPhoto(ctx, l, images, theme);
    else if (l.kind === 'text') size = drawText(ctx, l, theme);
    else if (l.kind === 'sticker') size = drawSticker(ctx, l, images);
    else if (l.kind === 'badge') size = drawBadge(ctx, l, theme);
    else if (l.kind === 'price') size = drawPrice(ctx, l);
    ctx.restore();
    if (size) boxes.set(l.id, { x: l.x - (size.w * s) / 2, y: l.y - (size.h * s) / 2, w: size.w * s, h: size.h * s });
  }
  if (guides) {
    ctx.strokeStyle = '#ff2fa0';
    ctx.lineWidth = 3 / k;
    ctx.setLineDash([]);
    if (guides.x) { ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke(); }
    if (guides.y) { ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2); ctx.stroke(); }
  }
  const b = selected && boxes.get(selected);
  if (b) {
    ctx.lineWidth = 4 / k;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
    ctx.setLineDash([14 / k, 10 / k]);
    ctx.strokeStyle = '#ff2fa0';
    ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
    ctx.setLineDash([]);
  }
  ctx.restore();
  return boxes;
}

// A finished post as a canvas of px x px.
export function renderPage(page, images, px = 2160) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawPage(ctx, page, images, { px });
  return c;
}
