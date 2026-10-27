// Draws a toy photo into the owner's own frames (assets/img/frames, made from
// the Branding Assets: blue for boys, pink for girls, pink-to-blue for
// neutral, logo top left, red USED/NEW badge top right). The toy's name sits
// at the bottom in a bubble of the frame colour: a thin line on top
// (tagline, e.g. "Big & Small") and the big name under it ("Barbie Set").

const SIZE = 1080;
// The see-through window in the frame files.
const WIN = { x: 61, y: 56, w: 961, h: 898 };

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

export async function renderFrame({ image, name, tagline = '', audience = 'neutral', condition = 'used', look = 'classic' }) {
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

  // Photo: fills the window, centred on the part the name doesn't cover.
  const [iw, ih] = dims(image);
  const scale = Math.max(WIN.w / iw, WIN.h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const visibleMid = (WIN.y + Math.min(WIN.y + WIN.h, textTop)) / 2;
  const dy = Math.min(WIN.y, Math.max(WIN.y + WIN.h - dh, visibleMid - dh / 2));
  ctx.save();
  ctx.beginPath();
  ctx.rect(WIN.x - 4, WIN.y - 4, WIN.w + 8, WIN.h + 8);
  ctx.clip();
  ctx.drawImage(image, WIN.x + (WIN.w - dw) / 2, dy, dw, dh);
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
