// "Adjust photo": the owner zooms and moves the photo inside the frame by
// hand (pinch and drag, or the slider), without touching the frame itself.
// The same placement is used for the social picture and the website photo.
import { renderFrame, renderPhoto, cleanFraming, FRAME_WINDOW as WIN } from '../frame.js';
import { sourceImage, setFraming } from './photos.js';
import { toast } from './ui.js';
import { friendlyError } from '../db.js';

const SIZE = 1080;

export function openAdjust(toy, onSaved = () => {}) {
  const d = document.createElement('dialog');
  d.className = 'adjust';
  d.innerHTML = `
    <div class="adj-head">
      <button type="button" class="adj-x" data-close aria-label="Close">×</button>
      <h2>Adjust photo</h2>
      <div class="seg adj-tabs" role="group" aria-label="Preview">
        <button type="button" data-view="frame" aria-pressed="true">Social</button>
        <button type="button" data-view="photo" aria-pressed="false">Website</button>
      </div>
    </div>
    <div class="adj-stage"><canvas width="540" height="540" aria-label="Preview: drag to move, pinch to zoom"></canvas><div class="adj-wait">Loading photo…</div></div>
    <p class="adj-tip">Drag to move the toy. Pinch or use the slider to zoom. The frame stays the same.</p>
    <div class="adj-zoom">
      <span aria-hidden="true">−</span>
      <input type="range" min="30" max="400" step="1" value="100" aria-label="Zoom">
      <span aria-hidden="true">+</span>
      <b class="adj-val">100%</b>
    </div>
    <div class="adj-quick">
      <button type="button" class="btn ghost small" data-q="fit">Whole photo</button>
      <button type="button" class="btn ghost small" data-q="fill">Fill frame</button>
      <button type="button" class="btn ghost small" data-q="auto">Automatic</button>
    </div>
    <div class="adj-acts">
      <button type="button" class="btn ghost" data-close>Cancel</button>
      <button type="button" class="btn" data-save>Save</button>
    </div>`;
  document.body.append(d);
  d.showModal();
  const $ = (s) => d.querySelector(s);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const range = $('input[type=range]');
  let view = 'frame';
  let src = null;
  let framing = cleanFraming(toy.framing); // null = automatic
  let dirty = false;

  const close = () => { d.close(); d.remove(); };
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  // Sharp on the phone's screen, but not bigger than needed (it redraws while dragging).
  const fitCanvas = () => {
    const css = canvas.getBoundingClientRect().width || 340;
    const px = Math.min(1080, Math.round(css * Math.min(2, window.devicePixelRatio || 1)));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  };

  // Photo size at zoom 1 in the current view, in 1080 layout pixels.
  const coverSize = () => {
    const iw = src.image.naturalWidth || src.image.width;
    const ih = src.image.naturalHeight || src.image.height;
    const cover = view === 'frame' ? Math.max(WIN.w / iw, WIN.h / ih) : Math.max(SIZE / iw, SIZE / ih);
    return { iw, ih, cover };
  };

  let queued = false;
  let drawing = false;
  const paint = () => {
    if (queued || !src) return;
    queued = true;
    requestAnimationFrame(async () => {
      queued = false;
      if (drawing) { paint(); return; }
      drawing = true;
      try {
        fitCanvas();
        const scale = canvas.width / SIZE;
        let out;
        if (view === 'frame') {
          out = await renderFrame({ ...src, name: toy.name, tagline: toy.tagline, audience: toy.audience,
            condition: toy.condition, focus: toy.focus, framing, scale });
        } else {
          out = renderPhoto({ ...src, focus: toy.focus, framing, size: canvas.width });
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(out, 0, 0, canvas.width, canvas.height);
      } finally {
        drawing = false;
      }
      const z = framing ? Math.round(framing.zoom * 100) : 100;
      range.value = z;
      $('.adj-val').textContent = framing ? `${z}%` : 'Auto';
    });
  };

  const start = () => { if (!framing) framing = { zoom: 1, cx: 0.5, cy: 0.5 }; dirty = true; };
  const setZoom = (z, about = null) => {
    start();
    const next = Math.min(4, Math.max(0.3, z));
    // Keep the point under the fingers where it is.
    if (about) {
      const { iw, ih, cover } = coverSize();
      const before = cover * framing.zoom;
      const after = cover * next;
      const mid = view === 'frame' ? [WIN.x + WIN.w / 2, WIN.y + WIN.h / 2] : [SIZE / 2, SIZE / 2];
      const px = (about[0] - mid[0]);
      const py = (about[1] - mid[1]);
      framing.cx += px / (iw * before) - px / (iw * after);
      framing.cy += py / (ih * before) - py / (ih * after);
    }
    framing.zoom = next;
    paint();
  };

  // Pointer: one finger moves, two fingers zoom.
  const pts = new Map();
  let last = null;
  const layout = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  const pinch = () => {
    const [a, b] = [...pts.values()];
    return { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!src) return;
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, layout(e));
    last = pts.size === 2 ? pinch() : null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const now = layout(e);
    pts.set(e.pointerId, now);
    start();
    if (pts.size === 1) {
      const { iw, ih, cover } = coverSize();
      framing.cx -= (now[0] - prev[0]) / (iw * cover * framing.zoom);
      framing.cy -= (now[1] - prev[1]) / (ih * cover * framing.zoom);
      framing.cx = Math.min(1.5, Math.max(-0.5, framing.cx));
      framing.cy = Math.min(1.5, Math.max(-0.5, framing.cy));
      paint();
    } else if (pts.size === 2 && last) {
      const p = pinch();
      if (last.dist > 0) setZoom(framing.zoom * (p.dist / last.dist), p.mid);
      last = p;
    }
  });
  const up = (e) => { pts.delete(e.pointerId); last = pts.size === 2 ? pinch() : null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    if (!src) return;
    e.preventDefault();
    start();
    setZoom(framing.zoom * Math.exp(-e.deltaY * 0.0015), layout(e));
  }, { passive: false });
  range.addEventListener('input', () => setZoom(Number(range.value) / 100));

  d.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    d.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  }));
  d.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    if (!src) return;
    dirty = true;
    if (b.dataset.q === 'auto') framing = null;
    else if (b.dataset.q === 'fill') framing = { zoom: 1, cx: 0.5, cy: 0.5 };
    else {
      const { iw, ih, cover } = coverSize();
      const box = view === 'frame' ? [WIN.w, WIN.h] : [SIZE, SIZE];
      framing = { zoom: Math.min(box[0] / iw, box[1] / ih) / cover, cx: 0.5, cy: 0.5 };
    }
    paint();
  }));

  $('[data-save]').addEventListener('click', async (e) => {
    if (!dirty) { close(); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const keep = framing ? { zoom: +framing.zoom.toFixed(4), cx: +framing.cx.toFixed(4), cy: +framing.cy.toFixed(4) } : null;
      const { toy: saved, remembered } = await setFraming(toy, keep);
      toast(remembered ? 'Photo placed' : 'Photo placed. Run the latest database update so the app remembers it next time.', !remembered);
      close();
      onSaved(saved);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Save';
      toast(friendlyError(err), true);
    }
  });

  sourceImage(toy).then((s) => {
    src = s;
    $('.adj-wait').remove();
    paint();
  }).catch((err) => {
    $('.adj-wait').textContent = err.message || 'The photo could not be loaded.';
  });
  window.addEventListener('resize', paint);
  d.addEventListener('close', () => window.removeEventListener('resize', paint));
}
