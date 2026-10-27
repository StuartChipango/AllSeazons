// Draws a toy photo into the owner's own frames (assets/img/frames, made from
// the Branding Assets: blue for boys, pink for girls, pink-to-blue for
// neutral, logo top left, red USED/NEW badge top right). The toy's name sits
// at the bottom in a bubble of the frame colour: a thin line on top
// (tagline, e.g. "Big & Small") and the big name under it ("Barbie Set").

const SIZE = 1080;
// The see-through window in the frame files.
const WIN = { x: 61, y: 56, w: 961, h: 898 };
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

const frameImages = new Map();
function loadFrameImage(audience, tag) {
  const key = `${audience}-${tag}`;
  if (!frameImages.has(key)) {
    frameImages.set(key, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The frame picture could not be loaded.'));
      img.src = new URL(`../img/frames/${key}.png`, import.meta.url).href;
    }));
  }
  return frameImages.get(key);
}

// Load a File/Blob as something canvas can draw, with phone photos turned
// the right way up.
export async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('This photo type cannot be opened here. Please use JPEG or PNG photos.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const dims = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

// Shrink a photo to at most maxSide pixels and return a JPEG blob.
export async function toJpeg(img, maxSide = 1600, quality = 0.88) {
  const [w, h] = dims(img);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasBlob(c, quality);
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
// is kept safe.
export function cleanFocus(focus) {
  const f = Array.isArray(focus) ? focus.map(Number) : null;
  if (!f || f.length !== 4 || f.some((v) => !Number.isFinite(v))) return [0.08, 0.08, 0.92, 0.92];
  const [l, t, r, b] = f.map((v) => Math.min(1, Math.max(0, v)));
  return r - l < 0.05 || b - t < 0.05 ? [0.08, 0.08, 0.92, 0.92] : [l, t, r, b];
}

// The photo at its drawn size, faded out along the sides that end inside the
// window so it melts into the blurred copy behind it.
function softEdges(image, w, h, sides) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  const F = 80;
  const fade = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(rx, ry, rw, rh);
  };
  if (sides.left) fade(0, 0, F, 0, 0, 0, F, c.height);
  if (sides.right) fade(c.width, 0, c.width - F, 0, c.width - F, 0, F, c.height);
  if (sides.top) fade(0, 0, 0, F, 0, 0, c.width, F);
  if (sides.bottom) fade(0, c.height, 0, c.height - F, 0, c.height - F, c.width, F);
  return c;
}

export async function renderFrame({ image, name, tagline = '', audience = 'neutral', condition = 'used', look = 'classic', focus = null }) {
  const fonts = await loadFrameFonts();
  const style = STYLE[audience] ? audience : 'neutral';
  const isNew = condition === 'new';
  const frame = await loadFrameImage(style, isNew ? 'blank' : 'used');
  const { bubble, name: nameColor, tagline: tagColor } = STYLE[style];

  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');
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

  // Photo: the toy (focus box) is centred in the space above the name with
  // the same gap on every side, and the photo around it fills the window.
  // Only background is ever cut off. If the toy is too big for that, the photo
  // shrinks and a blurred copy of it fills the rest, so nothing is left empty.
  const [iw, ih] = dims(image);
  const cover = Math.max(WIN.w / iw, WIN.h / ih);
  const area = { x: WIN.x + GAP, y: WIN.y + GAP, w: WIN.w - GAP * 2, h: textTop - GAP - (WIN.y + GAP) };
  const [fl, ft, fr, fb] = cleanFocus(focus);
  const fw = (fr - fl) * iw;
  const fh = (fb - ft) * ih;
  const scale = Math.min(area.w / fw, area.h / fh, cover * 2.2);
  const dw = iw * scale;
  const dh = ih * scale;
  const place = (start, size, drawn, focusMid, areaMid) => {
    const centred = areaMid - focusMid * drawn;
    if (drawn < size) return centred;
    return Math.min(start, Math.max(start + size - drawn, centred));
  };
  let dx = place(WIN.x, WIN.w, dw, (fl + fr) / 2, area.x + area.w / 2);
  let dy = place(WIN.y, WIN.h, dh, (ft + fb) / 2, area.y + area.h / 2);
  // Keeping the window filled must not push the toy out of its space.
  const fits = (x0, y0) => x0 + fl * dw >= area.x - 1 && x0 + fr * dw <= area.x + area.w + 1
    && y0 + ft * dh >= area.y - 1 && y0 + fb * dh <= area.y + area.h + 1;
  if (!fits(dx, dy)) {
    dx = area.x + area.w / 2 - ((fl + fr) / 2) * dw;
    dy = area.y + area.h / 2 - ((ft + fb) / 2) * dh;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(WIN.x - 4, WIN.y - 4, WIN.w + 8, WIN.h + 8);
  ctx.clip();
  const gaps = dx > WIN.x + 0.5 || dy > WIN.y + 0.5 || dx + dw < WIN.x + WIN.w - 0.5 || dy + dh < WIN.y + WIN.h - 0.5;
  if (gaps) {
    // Gaps: a strongly blurred copy of the same photo fills the window, and
    // the sharp photo melts into it, so the colours carry on behind the toy.
    const bs = Math.max(cover, dw / iw) * 1.15;
    if ('filter' in ctx) ctx.filter = 'blur(36px) saturate(1.05)';
    ctx.drawImage(image, dx + dw / 2 - (iw * bs) / 2, dy + dh / 2 - (ih * bs) / 2, iw * bs, ih * bs);
    ctx.filter = 'none';
    ctx.drawImage(softEdges(image, dw, dh, {
      left: dx > WIN.x, top: dy > WIN.y, right: dx + dw < WIN.x + WIN.w, bottom: dy + dh < WIN.y + WIN.h,
    }), dx, dy);
  } else {
    ctx.drawImage(image, dx, dy, dw, dh);
  }
  ctx.restore();

  ctx.drawImage(frame, 0, 0, SIZE, SIZE);

  // NEW badge: the frame's red badge with the word drawn in the brand font.
  if (isNew) {
    ctx.save();
    ctx.translate(992, 90);
    ctx.rotate(-0.04);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fit(ctx, 'New', 112, 64, 40, 700, fonts.bold);
    ctx.fillText('New', 0, 3);
    ctx.restore();
  }

  drawName(ctx, { big, small, fonts, nameBase, tagBase, look, bubble, nameColor, tagColor });
  return c;
}
