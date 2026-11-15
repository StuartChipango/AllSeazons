// Social media pictures: draws a toy photo into the owner's frame (blue for
// boys, pink for girls, pink-to-blue for neutral, logo top left, red USED/NEW
// badge top right). The frame is drawn in shapes, not loaded from the
// picture files in assets/img/frames (kept as the design reference), so it
// is sharp at any size. The toy's name sits at the bottom in a bubble of the
// frame colour: a thin line on top (tagline, e.g. "Big & Small") and the big
// name under it ("Barbie Set").
// The website itself shows the plain photo (renderPhoto, at the bottom).

const SIZE = 1080;
// The see-through window in the frame files.
const WIN = { x: 61, y: 56, w: 961, h: 898 };
export const FRAME_WINDOW = WIN;
// Space kept between the toy and the edges of its area.
const GAP = 36;

// Bubble colour, big-name colour and tagline colour, as in the examples.
const STYLE = {
  boys: { bubble: '#7eb2ca', name: '#ffffff', tagline: '#111111' },
  girls: { bubble: '#f2d3e3', name: '#111111', tagline: '#ffffff' },
  neutral: { bubble: '#f2d3e3', name: '#111111', tagline: '#ffffff' },
};
export const FRAME_COLORS = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.bubble]));

// The brand font is Glina Script. Until its files are in assets/fonts the
// frames fall back to Fredoka.
const BRAND = 'Glina Script';
const FALLBACK = 'Fredoka';
let fontsReady;
export function loadFrameFonts() {
  if (!fontsReady) {
    const base = new URL('../fonts/', import.meta.url);
    const add = (family, file, weight) => new FontFace(family, `url(${new URL(file, base)})`, { weight: String(weight) })
      .load().then((f) => { document.fonts.add(f); return true; }).catch(() => false);
    fontsReady = Promise.all([
      add(BRAND, 'glina-script.otf', 700),
      add(BRAND, 'glina-script-thin.otf', 300),
      add(FALLBACK, 'fredoka-latin-400-normal.woff2', 300),
      add(FALLBACK, 'fredoka-latin-600-normal.woff2', 700),
    ]).then(([bold, thin]) => ({ bold: bold ? BRAND : FALLBACK, thin: thin ? BRAND : FALLBACK }));
  }
  return fontsReady;
}

// The frame is drawn, not loaded as a picture, so it stays sharp at any size
// (1080 px for the shop's copy, 2160 px for "Best quality" downloads). The
// shapes match the owner's frame files: a coloured band with round corners,
// the photo window inside it, the logo sticker top left, the USED/NEW badge
// top right.
const OUTER = { x: 38, y: 34, w: 1007, h: 1007, r: 60 };
const WIN_R = { top: 24, bottom: 60 };
const FRAME_FILL = {
  boys: ['#7eb2ca'],
  girls: ['#f2d3e3'],
  neutral: ['#ead1e1', '#8bb5cd'], // pink on the left to blue on the right
};
const BADGE = { x: 989, y: 89, size: 166, color: '#d50a0a' };

function roundRect(ctx, x, y, w, h, rTop, rBottom = rTop) {
  ctx.moveTo(x + rTop, y);
  ctx.arcTo(x + w, y, x + w, y + h, rTop);
  ctx.arcTo(x + w, y + h, x, y + h, rBottom);
  ctx.arcTo(x, y + h, x, y, rBottom);
  ctx.arcTo(x, y, x + w, y, rTop);
  ctx.closePath();
}
function windowPath(ctx, grow = 0) {
  roundRect(ctx, WIN.x - grow, WIN.y - grow, WIN.w + 2 * grow, WIN.h + 2 * grow, WIN_R.top + grow, WIN_R.bottom + grow);
}

let logoImage;
function loadLogo() {
  if (!logoImage) {
    logoImage = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = new URL('../img/logo.svg', import.meta.url).href;
    });
  }
  return logoImage;
}

// The logo sticker with a thin coloured edge, as on the frame files.
// x, y, w in the 1080 layout; scale = how many real pixels per layout pixel.
export async function drawLogo(ctx, x, y, w, edge = '#7eb2ca', scale = 1) {
  const logo = await loadLogo();
  if (!logo) return;
  const h = w * (logo.naturalHeight || 389) / (logo.naturalWidth || 740);
  const pad = 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil((w + 2 * pad) * scale);
  c.height = Math.ceil((h + 2 * pad) * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.drawImage(logo, pad, pad, w, h);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = edge;
  g.fillRect(0, 0, w + 2 * pad, h + 2 * pad);
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    ctx.drawImage(c, x - pad + Math.cos(t) * 2.6, y - pad + Math.sin(t) * 2.6, w + 2 * pad, h + 2 * pad);
  }
  ctx.drawImage(logo, x, y, w, h);
}

// A hexagon with very round corners (pts: its corners).
function roundedPoly(ctx, pts, r) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  ctx.moveTo(...mid(pts[n - 1], pts[0]));
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const next = mid(p, pts[(i + 1) % n]);
    ctx.arcTo(p[0], p[1], next[0], next[1], r);
  }
  ctx.closePath();
}

// The USED / NEW badge: a soft rounded hexagon in brand red with a white
// sticker edge and the word in the brand font, bold.
export function drawBadge(ctx, word, { x = BADGE.x, y = BADGE.y, size = BADGE.size, color = BADGE.color, family = FALLBACK, tilt = -0.05 } = {}) {
  const R = size / 2;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return [Math.cos(a) * R, Math.sin(a) * R * 0.93];
  });
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  // Soft shadow, white sticker edge, then the red.
  ctx.save();
  ctx.shadowColor = 'rgba(26, 20, 36, 0.28)';
  ctx.shadowBlur = size * 0.07;
  ctx.shadowOffsetY = size * 0.03;
  roundedPoly(ctx, pts.map(([px, py]) => [px * 1.07, py * 1.07]), R * 0.4);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  roundedPoly(ctx, pts, R * 0.36);
  const grad = ctx.createLinearGradient(0, -R, 0, R);
  grad.addColorStop(0, shade(color, 0.12));
  grad.addColorStop(1, shade(color, -0.1));
  ctx.fillStyle = grad;
  ctx.fill();
  // A soft shine across the top.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.15, -R * 0.75, R * 1.05, R * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // The word: as big as fits, thickened with a white outline.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const t = fit(ctx, word, size * 0.74, size * 0.42, size * 0.24, 700, family);
  ctx.font = font(700, t.size, family);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, t.size * 0.07);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(t.text, 0, size * 0.03);
  ctx.fillText(t.text, 0, size * 0.03);
  ctx.restore();
}

// Lighter (amount > 0) or darker (amount < 0) version of a #rrggbb colour.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount)));
  return `rgb(${ch.join(',')})`;
}

function drawFrameBand(ctx, style) {
  const fill = FRAME_FILL[style] || FRAME_FILL.neutral;
  let paint = fill[0];
  if (fill.length > 1) {
    paint = ctx.createLinearGradient(OUTER.x, 0, OUTER.x + OUTER.w, 0);
    fill.forEach((col, i) => paint.addColorStop(i / (fill.length - 1), col));
  }
  ctx.beginPath();
  roundRect(ctx, OUTER.x, OUTER.y, OUTER.w, OUTER.h, OUTER.r);
  windowPath(ctx);
  ctx.fillStyle = paint;
  ctx.fill('evenodd');
}

// Load a File/Blob as something canvas can draw, with phone photos turned
// the right way up.
// Opens a photo for drawing. Phone cameras make very big photos that some
// phones cannot open in one go, so if the full size fails we ask the browser
// for a smaller copy (everything is saved at 2560 px or less anyway).
export async function loadBitmap(blob) {
  const reasons = [];
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) { reasons.push(e.name || e.message); }
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 2560, resizeQuality: 'high' });
    } catch (e) { reasons.push(e.name || e.message); }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('img'));
      img.src = url;
    });
    if (!(img.naturalWidth > 0)) throw new Error('empty');
    return img;
  } catch (e) {
    reasons.push(e.name || e.message);
    console.warn('photo could not be opened', blob?.type, blob?.size, reasons);
    throw new Error(`This photo could not be opened (${blob?.type || 'unknown type'}, ${Math.round((blob?.size || 0) / 1e6)} MB). Try again, or send it to yourself on WhatsApp and pick that copy.`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const dims = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

// The photo at most maxSide pixels on its longest side, as a canvas (the
// photo itself when it is already that small).
export function shrinkTo(img, maxSide) {
  const [w, h] = dims(img);
  const scale = maxSide / Math.max(w, h);
  if (scale >= 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  return c;
}

// Shrink a photo to at most maxSide pixels and return a JPEG blob.
export async function toJpeg(img, maxSide = 1600, quality = 0.88) {
  const [w, h] = dims(img);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasBlob(c, quality);
}

// "Touch up" (only when switched on): a gentle automatic fix for dim or
// greyish photos. It stretches the darkest and brightest 0.5% to black and
// white (the same amount on red, green and blue, so colours don't shift),
// and adds a little colour. Returns a canvas at most maxSide pixels.
export function touchUp(img, maxSide = 2560) {
  const [w, h] = dims(img);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 16) hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
  const total = hist.reduce((a, b) => a + b, 0);
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255 && (acc += hist[lo]) < total * 0.005; lo++);
  acc = 0;
  for (; hi > 0 && (acc += hist[hi]) < total * 0.005; hi--);
  // Never stretch more than a little: a white toy on white stays white.
  lo = Math.min(lo, 40);
  hi = Math.max(hi, 215);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) / (hi - lo)) * 255;
  const sat = 1.08;
  for (let i = 0; i < px.length; i += 4) {
    const r = lut[px[i]], g = lut[px[i + 1]], b = lut[px[i + 2]];
    const y = r * 0.3 + g * 0.59 + b * 0.11;
    px[i] = y + (r - y) * sat;
    px[i + 1] = y + (g - y) * sat;
    px[i + 2] = y + (b - y) * sat;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// The photo turned back the right way round (left and right swapped), on a
// canvas. maxSide keeps very big camera photos to a size phones can handle.
export function mirrored(img, maxSide = 3000) {
  const [w, h] = dims(img);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function canvasBlob(canvas, quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the picture.'))), 'image/jpeg', quality));
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function font(weight, size, family) {
  return `${weight} ${size}px "${family}", "${FALLBACK}", "Trebuchet MS", sans-serif`;
}

// Biggest size from start down to min that fits maxWidth; cut with … if needed.
function fit(ctx, text, maxWidth, start, min, weight, family) {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = font(weight, size, family);
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
  }
  ctx.font = font(weight, min, family);
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return { text: t === text ? t : t.trimEnd() + '…', size: min };
}

// "Remote Control Monster Truck" -> ["Remote Control", "Monster Truck"]: the
// later words stay big, so the split leaves the big line at most as long.
export function splitName(text) {
  const words = text.split(/\s+/);
  if (words.length < 2) return ['', text];
  const cut = Math.max(1, Math.floor(words.length / 2));
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
}

function drawName(ctx, { big, small, fonts, nameBase, tagBase, look, bubble, nameColor, tagColor }) {
  const bigFont = font(700, big.size, fonts.bold);
  const smallFont = small && font(300, small.size, fonts.thin);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let tagX = SIZE / 2;
  if (look === 'tilt') {
    ctx.translate(SIZE / 2, nameBase - big.size / 2);
    ctx.rotate(-0.06);
    ctx.translate(-SIZE / 2, -(nameBase - big.size / 2));
    if (small) {
      ctx.font = bigFont;
      const bigLeft = SIZE / 2 - ctx.measureText(big.text).width / 2;
      ctx.font = smallFont;
      tagX = Math.max(80 + ctx.measureText(small.text).width / 2, bigLeft + 20 + ctx.measureText(small.text).width / 2);
    }
  }
  // 1. Bubble: fat outlines of both lines in the frame colour, over a solid
  // band so no photo peeks through between letters.
  ctx.strokeStyle = bubble;
  ctx.fillStyle = bubble;
  const band = (text, x, base, size, f) => {
    ctx.font = f;
    const w = ctx.measureText(text).width;
    ctx.fillRect(x - w / 2, base - size * 0.78, w, size * 0.78);
    ctx.lineWidth = 64;
    ctx.strokeText(text, x, base);
    return [x - w / 2, x + w / 2];
  };
  const [bl, br] = band(big.text, SIZE / 2, nameBase, big.size, bigFont);
  if (small) {
    const [sl, sr] = band(small.text, tagX, tagBase, small.size, smallFont);
    const l = Math.max(bl, sl);
    const r = Math.min(br, sr);
    if (r > l) ctx.fillRect(l, tagBase - small.size * 0.5, r - l, nameBase - tagBase);
  }
  // 2. Big name, thickened a little like the examples.
  ctx.font = bigFont;
  if (look === 'pop') {
    ctx.lineWidth = 14;
    ctx.strokeStyle = tagColor;
    ctx.strokeText(big.text, SIZE / 2, nameBase);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = nameColor;
  ctx.strokeText(big.text, SIZE / 2, nameBase);
  ctx.fillStyle = nameColor;
  ctx.fillText(big.text, SIZE / 2, nameBase);
  // 3. Small line on top.
  if (small) {
    ctx.font = smallFont;
    ctx.fillStyle = tagColor;
    ctx.fillText(small.text, tagX, tagBase);
  }
  ctx.restore();
}

// focus: where the toy is in the photo, [left, top, right, bottom] as
// fractions of the photo (Claude packs give one). Without it the middle 84%
// is kept safe. cutout: the toy cut out of the photo (a mask whose alpha is
// the toy), which lets a tall toy pop out over the frame like the brand
// examples. plate: the photo with the toy painted out, used to carry the
// table on past the photo's edges.
export function cleanFocus(focus) {
  const f = Array.isArray(focus) ? focus.map(Number) : null;
  if (!f || f.length !== 4 || f.some((v) => !Number.isFinite(v))) return [0.08, 0.08, 0.92, 0.92];
  const [l, t, r, b] = f.map((v) => Math.min(1, Math.max(0, v)));
  return r - l < 0.05 || b - t < 0.05 ? [0.08, 0.08, 0.92, 0.92] : [l, t, r, b];
}

// Manual placement from the "Adjust photo" screen: zoom (1 = the photo just
// covers the window) and the point of the photo (fractions) at the middle.
export function cleanFraming(framing) {
  if (!framing || typeof framing !== 'object') return null;
  const zoom = Number(framing.zoom);
  const cx = Number(framing.cx);
  const cy = Number(framing.cy);
  if (![zoom, cx, cy].every(Number.isFinite)) return null;
  return { zoom: Math.min(6, Math.max(0.3, zoom)), cx: Math.min(1.5, Math.max(-0.5, cx)), cy: Math.min(1.5, Math.max(-0.5, cy)) };
}

// Where the photo stops short of the window, the gap is filled by carrying
// the photo's own edge colours straight outwards (smoothed along the edge, so
// no lines are copied or bent), with a light film grain so it doesn't look
// flat, and the photo's edge fades softly into it. A table stays a table and
// a wall stays a wall, with no mirrored or stretched shapes.
let grainTile;
function grain() {
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = grainTile.height = 128;
    const g = grainTile.getContext('2d');
    const d = g.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = Math.round(Math.random() * 9);
    }
    g.putImageData(d, 0, 0);
  }
  return grainTile;
}

// The photo's outer band on one side, averaged down to a line of `n` colours.
function edgeLine(image, side, n) {
  const [iw, ih] = dims(image);
  const vertical = side === 'left' || side === 'right';
  const depth = Math.max(2, Math.round((vertical ? iw : ih) * 0.012));
  const c = document.createElement('canvas');
  c.width = vertical ? 1 : n;
  c.height = vertical ? n : 1;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const sx = side === 'right' ? iw - depth : 0;
  const sy = side === 'bottom' ? ih - depth : 0;
  // Two steps down so every pixel of the band counts.
  const mid = document.createElement('canvas');
  mid.width = vertical ? 1 : Math.min(iw, n * 8);
  mid.height = vertical ? Math.min(ih, n * 8) : 1;
  mid.getContext('2d').drawImage(image, sx, sy, vertical ? depth : iw, vertical ? ih : depth, 0, 0, mid.width, mid.height);
  g.drawImage(mid, 0, 0, c.width, c.height);
  return c;
}

export function edgeFill(ctx, image, dx, dy, dw, dh, box) {
  const L = box.x, T = box.y, R = box.x + box.w, B = box.y + box.h;
  const gap = { left: dx - L, right: R - (dx + dw), top: dy - T, bottom: B - (dy + dh) };
  if (!Object.values(gap).some((v) => v > 0.5)) return;
  // About one colour every 6 px along the edge: straight table lines carry
  // on, small detail is smoothed away.
  const lines = {};
  const k = ctx.getTransform().a || 1;
  const count = (len) => Math.max(8, Math.min(600, Math.round((len * k) / 6)));
  for (const side of Object.keys(gap)) if (gap[side] > 0.5) lines[side] = edgeLine(image, side, side === 'left' || side === 'right' ? count(dh) : Math.ceil(count(dw) / 4));
  const feather = Math.max(8, Math.min(dw, dh) * 0.035);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Sides first (they also cover the corners), then top and bottom.
  for (const side of ['left', 'right']) {
    const line = lines[side];
    if (!line) continue;
    const n = line.height;
    const x = side === 'left' ? L : dx + dw;
    const w = gap[side] + feather;
    const xx = side === 'left' ? x : x - feather;
    ctx.drawImage(line, 0, 0, 1, n, xx, dy, w, dh);
    if (dy > T) ctx.drawImage(line, 0, 0, 1, 1, xx, T, w, dy - T);
    if (dy + dh < B) ctx.drawImage(line, 0, n - 1, 1, 1, xx, dy + dh, w, B - dy - dh);
  }
  for (const side of ['top', 'bottom']) {
    const line = lines[side];
    if (!line) continue;
    const n = line.width;
    const y = side === 'top' ? T : dy + dh - feather;
    const h = gap[side] + feather;
    const x0 = Math.max(L, dx);
    const x1 = Math.min(R, dx + dw);
    const sx0 = ((x0 - dx) / dw) * n;
    const sx1 = ((x1 - dx) / dw) * n;
    ctx.drawImage(line, sx0, 0, Math.max(0.01, sx1 - sx0), 1, x0, y, x1 - x0, h);
  }
  // Light grain over the filled parts.
  ctx.beginPath();
  if (gap.left > 0.5) ctx.rect(L, T, gap.left, B - T);
  if (gap.right > 0.5) ctx.rect(dx + dw, T, gap.right, B - T);
  if (gap.top > 0.5) ctx.rect(L, T, R - L, gap.top);
  if (gap.bottom > 0.5) ctx.rect(L, dy + dh, R - L, gap.bottom);
  ctx.clip();
  ctx.fillStyle = ctx.createPattern(grain(), 'repeat');
  ctx.fillRect(L, T, R - L, B - T);
  ctx.restore();
  return { gap, feather };
}

// The photo drawn with its edges fading out on the sides that have a gap, so
// it melts into the fill instead of ending on a hard line.
function drawPhoto(ctx, image, dx, dy, dw, dh, fill) {
  const fade = fill && Object.entries(fill.gap).filter(([, v]) => v > 0.5).map(([k]) => k);
  if (!fade?.length) { ctx.drawImage(image, dx, dy, dw, dh); return; }
  const k = ctx.getTransform().a || 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(dw * k));
  c.height = Math.max(1, Math.round(dh * k));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(image, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  const f = fill.feather * k;
  const ramp = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  // Fade only the outer `f` pixels, from fully clear at the edge.
  if (fade.includes('left')) ramp(0, 0, f, 0, 0, 0, f, c.height);
  if (fade.includes('right')) ramp(c.width, 0, c.width - f, 0, c.width - f, 0, f, c.height);
  if (fade.includes('top')) ramp(0, 0, 0, f, 0, 0, c.width, f);
  if (fade.includes('bottom')) ramp(0, c.height, 0, c.height - f, 0, c.height - f, c.width, f);
  ctx.drawImage(c, dx, dy, dw, dh);
}

// The photo at its drawn size, kept only where the cutout mask is solid.
function cutoutCanvas(image, mask, w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0, c.width, c.height);
  return c;
}

// Where the photo goes in the window when nobody placed it by hand.
function autoPlace({ iw, ih, focus, pop, textTop }) {
  const cover = Math.max(WIN.w / iw, WIN.h / ih);
  // No toy position known (on-device naming): simply fill the window, with
  // the middle of the photo a little above the middle so the name does not
  // sit on the toy. No gaps, so nothing needs filling.
  if (!focus) {
    const dw = iw * cover;
    const dh = ih * cover;
    const dx = WIN.x + (WIN.w - dw) / 2;
    const want = (WIN.y + textTop) / 2 - dh / 2;
    const dy = Math.min(WIN.y, Math.max(WIN.y + WIN.h - dh, want));
    return { dx, dy, dw, dh };
  }
  // A toy position is known: the toy is centred in the space above the name,
  // as big as fits, never under the name. A toy too tall for that may pop out
  // over the top of the frame (when there is a cutout); only if it still
  // doesn't fit does the photo shrink, and the gaps get filled.
  const [fl, ft, fr, fb] = cleanFocus(focus);
  const fw = (fr - fl) * iw;
  const fh = (fb - ft) * ih;
  const zone = { l: WIN.x + GAP, r: WIN.x + WIN.w - GAP, t: pop ? 14 : WIN.y + GAP, b: textTop - GAP };
  const sideRoom = pop ? WIN.w + 2 * (WIN.x - 14) : zone.r - zone.l;
  const sFit = Math.min((zone.r - zone.l) / fw, (zone.b - (WIN.y + GAP)) / fh);
  const sMax = Math.min(sideRoom / fw, (zone.b - zone.t) / fh);
  const scale = sFit >= cover ? Math.min(sFit, cover * 2.2) : Math.min(cover, sMax);
  const dw = iw * scale;
  const dh = ih * scale;
  const toyH = fh * scale;
  const midX = WIN.x + WIN.w / 2;
  const fitsAbove = toyH <= zone.b - (WIN.y + GAP);
  const targetTop = fitsAbove ? (WIN.y + GAP + zone.b) / 2 - toyH / 2 : Math.max(zone.t, Math.min(WIN.y + GAP, zone.b - toyH));
  let dx = midX - ((fl + fr) / 2) * dw;
  let dy = targetTop - ft * dh;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  if (dw >= WIN.w) {
    const nx = clamp(dx, WIN.x + WIN.w - dw, WIN.x);
    const okX = (x) => (pop ? x + fl * dw >= 14 && x + fr * dw <= SIZE - 14 : x + fl * dw >= zone.l - 1 && x + fr * dw <= zone.r + 1);
    if (okX(nx)) dx = nx;
  }
  if (dh >= WIN.h) {
    const ny = clamp(dy, WIN.y + WIN.h - dh, WIN.y);
    if (ny + ft * dh >= zone.t - 1 && ny + fb * dh <= zone.b + 1) dy = ny;
  }
  return { dx, dy, dw, dh };
}

// scale: 1 makes 1080 x 1080, 2 makes 2160 x 2160 (the "Best quality" download).
// framing: manual zoom and position (see cleanFraming); overrides focus.
export async function renderFrame({ image, name, tagline = '', audience = 'neutral', condition = 'used', look = 'classic', focus = null, cutout = null, plate = null, framing = null, scale = 1 }) {
  const fonts = await loadFrameFonts();
  await loadLogo();
  const style = STYLE[audience] ? audience : 'neutral';
  const isNew = condition === 'new';
  const { bubble, name: nameColor, tagline: tagColor } = STYLE[style];

  const c = document.createElement('canvas');
  c.width = Math.round(SIZE * scale);
  c.height = Math.round(SIZE * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Name sizes first: the photo is centred in the space above the name.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let title = String(name || 'Unnamed toy').trim();
  let sub = String(tagline || '').trim();
  // A long name with no tagline: move its first words up to the thin line.
  if (!sub && fit(ctx, title, 900, 150, 110, 700, fonts.bold).text !== title) [sub, title] = splitName(title);
  const big = fit(ctx, title, 900, 172, 70, 700, fonts.bold);
  const small = sub ? fit(ctx, sub, 760, 104, 52, 300, fonts.thin) : null;
  const nameBase = 1000;
  const tagBase = nameBase - big.size * 0.86;
  const textTop = small ? tagBase - small.size * 0.78 - 26 : nameBase - big.size * 0.78 - 26;

  const [iw, ih] = dims(image);
  const pop = !!cutout;
  const manual = cleanFraming(framing);
  let place;
  if (manual) {
    const cover = Math.max(WIN.w / iw, WIN.h / ih);
    const dw = iw * cover * manual.zoom;
    const dh = ih * cover * manual.zoom;
    place = { dx: WIN.x + WIN.w / 2 - manual.cx * dw, dy: WIN.y + WIN.h / 2 - manual.cy * dh, dw, dh };
  } else {
    place = autoPlace({ iw, ih, focus, pop, textTop });
  }
  const { dx, dy, dw, dh } = place;

  ctx.save();
  ctx.beginPath();
  windowPath(ctx, 3);
  ctx.clip();
  const filled = edgeFill(ctx, plate || image, dx, dy, dw, dh, { x: WIN.x - 4, y: WIN.y - 4, w: WIN.w + 8, h: WIN.h + 8 });
  drawPhoto(ctx, image, dx, dy, dw, dh, filled);
  ctx.restore();

  drawFrameBand(ctx, style);
  await drawLogo(ctx, 14, 12, 202, bubble === '#f2d3e3' ? '#e9bcd3' : '#7eb2ca', scale);
  drawBadge(ctx, isNew ? 'New' : 'Used', { family: fonts.bold });

  // Pop-out: the parts of the toy outside the window, drawn over the frame
  // (never over the logo or the badge).
  if (pop) {
    const cut = cutoutCanvas(image, cutout, dw * scale, dh * scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h);
    ctx.rect(0, 0, 250, 140);
    ctx.rect(870, 0, 210, 185);
    ctx.clip('evenodd');
    ctx.drawImage(cut, dx, dy, dw, dh);
    ctx.restore();
  }

  drawName(ctx, { big, small, fonts, nameBase, tagBase, look, bubble, nameColor, tagColor });
  return c;
}

// The plain square photo the website shows: no frame, no name. The photo
// fills the square; with a toy position known the toy is kept whole and
// centred, and any gap is filled from the photo's own edge colours. framing
// (manual zoom/position) overrides both.
export function renderPhoto({ image, focus = null, plate = null, size = 1080, framing = null }) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const [iw, ih] = dims(image);
  const cover = Math.max(size / iw, size / ih);
  const manual = cleanFraming(framing);
  let scale = cover;
  let [fl, ft, fr, fb] = [0, 0, 1, 1];
  let dx;
  let dy;
  if (manual) {
    scale = cover * manual.zoom;
    dx = size / 2 - manual.cx * iw * scale;
    dy = size / 2 - manual.cy * ih * scale;
  } else {
    if (focus) {
      [fl, ft, fr, fb] = cleanFocus(focus);
      const room = size * 0.92;
      scale = Math.min(cover, room / ((fr - fl) * iw), room / ((fb - ft) * ih));
    }
    dx = size / 2 - ((fl + fr) / 2) * iw * scale;
    dy = size / 2 - ((ft + fb) / 2) * ih * scale;
  }
  const dw = iw * scale;
  const dh = ih * scale;
  if (!manual) {
    // Fill the square where the photo is big enough, keeping the toy whole.
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    if (dw >= size) {
      const nx = clamp(dx, size - dw, 0);
      if (nx + fl * dw >= 0 && nx + fr * dw <= size) dx = nx;
    }
    if (dh >= size) {
      const ny = clamp(dy, size - dh, 0);
      if (ny + ft * dh >= 0 && ny + fb * dh <= size) dy = ny;
    }
  }
  const filled = edgeFill(ctx, plate || image, dx, dy, dw, dh, { x: 0, y: 0, w: size, h: size });
  drawPhoto(ctx, image, dx, dy, dw, dh, filled);
  return c;
}
