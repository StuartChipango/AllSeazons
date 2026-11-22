// Reads a receipt photo on the phone itself (Tesseract, no internet AI).
// The first time it loads about 7 MB (kept by the phone after that), then
// a receipt takes a few seconds.
import { readReceipt, lusakaToday } from '../books-lib.js';

const BASE = new URL('../../vendor/tesseract/', import.meta.url).href;
let workerPromise = null;
let progressHook = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = BASE + 'tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Could not load the receipt reader. Check the internet and try again.'));
    document.head.append(s);
  });
}

function worker() {
  workerPromise ||= (async () => {
    const T = await loadScript();
    const w = await T.createWorker('eng', 1, {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE,
      langPath: BASE,
      gzip: true,
      logger: (m) => progressHook?.(m),
    });
    // Read straight across each line, so "TOTAL ... K2,640.00" stays together.
    await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return w;
  })().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

// Start loading while the person is still taking the photo.
export function warmUp() { worker().catch(() => {}); }

async function bitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* older phones */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function draw(src, maxSide, grey = false) {
  const w = src.width, h = src.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext('2d');
  if (grey) ctx.filter = 'grayscale(1) contrast(1.35)';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const toBlob = (canvas, q = 0.82) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

// The copy kept in the archive: clear enough to read, small enough to keep
// thousands (about 150-400 KB each). PDFs are kept as they are.
export async function archiveCopy(file) {
  if (!file.type.startsWith('image/')) return { blob: file, ext: (file.name.split('.').pop() || 'pdf').toLowerCase(), type: file.type || 'application/pdf' };
  const img = await bitmap(file);
  return { blob: await toBlob(draw(img, 1800), 0.82), ext: 'jpg', type: 'image/jpeg' };
}

// Photo -> { text, supplier, spent_on, amount, category }.
// onProgress(0..1, words) while it works.
export async function readReceiptPhoto(file, onProgress) {
  if (!file.type.startsWith('image/')) return { text: '', ...readReceipt('', lusakaToday()) };
  progressHook = (m) => {
    if (!onProgress) return;
    if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'Reading the receipt');
    else if (/load|initializ/i.test(m.status)) onProgress(Math.min(0.3, (m.progress || 0) * 0.3), 'Getting the reader ready (first time only)');
  };
  const [w, img] = await Promise.all([worker(), bitmap(file)]);
  const canvas = draw(img, 2000, true);
  const { data } = await w.recognize(canvas);
  progressHook = null;
  const text = (data.text || '').trim();
  return { text, ...readReceipt(text, lusakaToday()) };
}
