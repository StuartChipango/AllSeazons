// Social media pictures: draws a toy photo into the owner's own frames (assets/img/frames, made from
// the Branding Assets: blue for boys, pink for girls, pink-to-blue for
// neutral, logo top left, red USED/NEW badge top right). The toy's name sits
// at the bottom in a bubble of the frame colour: a thin line on top
// (tagline, e.g. "Big & Small") and the big name under it ("Barbie Set").
// The website itself shows the plain photo (renderPhoto, at the bottom).

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
// Opens a photo for drawing. Phone cameras make very big photos that some
// phones cannot open in one go, so if the full size fails we ask the browser
// for a smaller copy (everything is saved at 1600 px or less anyway).
export async function loadBitmap(blob) {
  const reasons = [];
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) { reasons.push(e.name || e.message); }
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 1600, resizeQuality: 'high' });
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

// Where the photo stops short of the window, its own edge is mirrored
// outwards: a table or wall carries on with no seam.
function mirrorFill(ctx, image, dx, dy, dw, dh, box = { x: WIN.x - 8, y: WIN.y - 8, w: WIN.w + 16, h: WIN.h + 16 }) {
  const L = box.x, T = box.y, R = box.x + box.w, B = box.y + box.h;
  for (const ox of [-1, 0, 1]) {
    for (const oy of [-1, 0, 1]) {
      if (!ox && !oy) continue;
      const x = dx + ox * dw;
      const y = dy + oy * dh;
      if (x >= R || x + dw <= L || y >= B || y + dh <= T) continue;
      ctx.save();
      ctx.translate(x + (ox ? dw : 0), y + (oy ? dh : 0));
      ctx.scale(ox ? -1 : 1, oy ? -1 : 1);
      ctx.drawImage(image, 0, 0, dw, dh);
      ctx.restore();
    }
  }
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

export async function renderFrame({ image, name, tagline = '', audience = 'neutral', condition = 'used', look = 'classic', focus = null, cutout = null, plate = null }) {
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

  // Photo: always fills the window. The toy (focus box) is centred in the
  // space above the name, as big as fits, never under the name. A toy too
  // tall for that may pop out over the top of the frame (when there is a
  // cutout); only if it still doesn't fit does the photo shrink, and then the
  // table or wall is carried on past its edges (mirrored from the plate).
  const [iw, ih] = dims(image);
  const cover = Math.max(WIN.w / iw, WIN.h / ih);
  const [fl, ft, fr, fb] = cleanFocus(focus);
  const fw = (fr - fl) * iw;
  const fh = (fb - ft) * ih;
  const pop = !!cutout;
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
  // Fill the window if the photo is big enough, without moving the toy out
  // of where it may go.
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

  ctx.save();
  ctx.beginPath();
  ctx.rect(WIN.x - 4, WIN.y - 4, WIN.w + 8, WIN.h + 8);
  ctx.clip();
  mirrorFill(ctx, plate || image, dx, dy, dw, dh);
  ctx.drawImage(image, dx, dy, dw, dh);
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

  // Pop-out: the parts of the toy outside the window, drawn over the frame
  // (never over the logo or the badge).
  if (pop) {
    const cut = cutoutCanvas(image, cutout, dw, dh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.rect(WIN.x, WIN.y, WIN.w, WIN.h);
    ctx.rect(0, 0, 250, 140);
    ctx.rect(870, 0, 210, 185);
    ctx.clip('evenodd');
    ctx.drawImage(cut, dx, dy);
    ctx.restore();
  }

  drawName(ctx, { big, small, fonts, nameBase, tagBase, look, bubble, nameColor, tagColor });
  return c;
}

// The plain square photo the website shows: no frame, no name. The photo
// fills the square with the toy whole and centred; if the toy doesn't fit,
// the photo shrinks and its background carries on past the edges (mirrored
// from the plate). Without a focus box it is a simple centre crop.
export function renderPhoto({ image, focus = null, plate = null, size = 1080 }) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const [iw, ih] = dims(image);
  const cover = Math.max(size / iw, size / ih);
  let scale = cover;
  let [fl, ft, fr, fb] = [0, 0, 1, 1];
  if (focus) {
    [fl, ft, fr, fb] = cleanFocus(focus);
    const room = size * 0.92;
    scale = Math.min(cover, room / ((fr - fl) * iw), room / ((fb - ft) * ih));
  }
  const dw = iw * scale;
  const dh = ih * scale;
  let dx = size / 2 - ((fl + fr) / 2) * dw;
  let dy = size / 2 - ((ft + fb) / 2) * dh;
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
  mirrorFill(ctx, plate || image, dx, dy, dw, dh, { x: 0, y: 0, w: size, h: size });
  ctx.drawImage(image, dx, dy, dw, dh);
  return c;
}
