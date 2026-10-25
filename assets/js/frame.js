// Draws the All Seazons frame around a toy photo:
//   blue border for boys, pink for girls, pink-to-blue for neutral,
//   the toy's name across the bottom and a USED or NEW tag top right.

const SIZE = 1080;
const PAD = 44;
const BAR_H = 132;
const FONT = 'Fredoka';

export const FRAME_COLORS = {
  boys: ['#5f9fc4', '#7eb2ca'],
  girls: ['#ec9cc1', '#f2bcd5'],
  neutral: ['#f0b3cf', '#7eb2ca'],
};

let fontsReady;
export function loadFrameFonts() {
  if (!fontsReady) {
    const base = new URL('../fonts/', import.meta.url);
    const faces = [500, 600, 700].map((w) =>
      new FontFace(FONT, `url(${new URL(`fredoka-latin-${w}-normal.woff2`, base)})`, { weight: String(w) }));
    fontsReady = Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff)).catch(() => null)));
  }
  return fontsReady;
}

let logoImg;
function loadLogo() {
  if (!logoImg) {
    logoImg = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = new URL('../img/logo.svg', import.meta.url).href;
    });
  }
  return logoImg;
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, start, min, weight = 600) {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}, "Trebuchet MS", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  ctx.font = `${weight} ${min}px ${FONT}, "Trebuchet MS", sans-serif`;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t === text ? t : t.trimEnd() + '…';
}

export async function renderFrame({ image, name, audience = 'neutral', condition = 'used' }) {
  await loadFrameFonts();
  const logo = await loadLogo();
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');

  // Border.
  const [a, b] = FRAME_COLORS[audience] || FRAME_COLORS.neutral;
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Soft dots in the border so it feels playful, like the brand's blobs.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (const [x, y, r] of [[30, 520, 60], [1060, 300, 80], [880, 1070, 70], [140, 20, 50]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // Photo window: a blurred fill behind the whole toy so nothing is cropped.
  const px = PAD, py = PAD, pw = SIZE - PAD * 2, ph = SIZE - PAD * 2 - BAR_H - 16;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 36);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.fillRect(px, py, pw, ph);
  const [iw, ih] = dims(image);
  const cover = Math.max(pw / iw, ph / ih);
  if ('filter' in ctx) {
    ctx.filter = 'blur(28px) saturate(1.1)';
    ctx.drawImage(image, px + (pw - iw * cover) / 2, py + (ph - ih * cover) / 2, iw * cover, ih * cover);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(px, py, pw, ph);
  }
  const contain = Math.min(pw / iw, ph / ih);
  ctx.drawImage(image, px + (pw - iw * contain) / 2, py + (ph - ih * contain) / 2, iw * contain, ih * contain);
  ctx.restore();

  // Logo, top left.
  if (logo) {
    const lw = 190;
    const lh = lw * (logo.naturalHeight || 389) / (logo.naturalWidth || 740);
    ctx.drawImage(logo, px + 18, py + 16, lw, lh);
  }

  // USED / NEW tag, top right.
  const isNew = condition === 'new';
  const tag = isNew ? 'NEW' : 'USED';
  ctx.save();
  ctx.translate(SIZE - PAD - 120, PAD + 66);
  ctx.rotate(0.12);
  ctx.font = `700 54px ${FONT}, "Trebuchet MS", sans-serif`;
  const tw = ctx.measureText(tag).width + 64;
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, -tw / 2, -40, tw, 80, 40);
  ctx.fillStyle = isNew ? '#ffd84d' : '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1d1d1f';
  ctx.stroke();
  ctx.fillStyle = '#1d1d1f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, 0, 3);
  ctx.restore();

  // Name bar.
  const by = SIZE - PAD - BAR_H;
  roundRect(ctx, PAD, by, SIZE - PAD * 2, BAR_H, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#1d1d1f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = fitText(ctx, String(name || 'Unnamed toy'), SIZE - PAD * 2 - 60, 66, 38);
  ctx.fillText(label, SIZE / 2, by + BAR_H / 2 + 3);

  return c;
}
