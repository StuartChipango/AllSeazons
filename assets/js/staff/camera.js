// A simple "pro" camera inside the staff app. It shows only the controls the
// phone's camera really supports (brightness, ISO, shutter, focus, white
// balance, zoom, torch), keeps them between shots, and hands each photo back
// straight away so naming starts while the next toy is being set up.
import { esc } from '../lib.js';
import { loadBitmap, mirrored, canvasBlob } from '../frame.js';

export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia;

const SETTINGS_KEY = 'camera-settings';
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* fine */ } };

// Each control: which capability it needs, how to switch it to manual, and how to show its value.
const CONTROLS = [
  { key: 'exposureCompensation', label: 'Brightness', fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) },
  { key: 'iso', label: 'ISO', mode: ['exposureMode', 'manual', 'continuous'], fmt: (v) => Math.round(v) },
  { key: 'exposureTime', label: 'Shutter', mode: ['exposureMode', 'manual', 'continuous'],
    // Chrome gives exposure time in units of 100 microseconds.
    fmt: (v) => { const s = v / 10000; return s >= 1 ? `${s.toFixed(1)}s` : `1/${Math.round(1 / s)}`; } },
  { key: 'focusDistance', label: 'Focus', mode: ['focusMode', 'manual', 'continuous'], fmt: (v) => `${v.toFixed(2)} m` },
  { key: 'colorTemperature', label: 'Colour', mode: ['whiteBalanceMode', 'manual', 'continuous'], fmt: (v) => `${Math.round(v)}K` },
  { key: 'zoom', label: 'Zoom', fmt: (v) => `${v.toFixed(1)}×` },
];

export async function openCamera({ onShot, onClose = () => {} }) {
  const root = document.createElement('div');
  root.className = 'cam';
  root.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="cam-grid" hidden></div>
    <div class="cam-flash"></div>
    <div class="cam-top">
      <button type="button" class="cam-btn" data-close aria-label="Close camera">×</button>
      <span class="cam-count" aria-live="polite"></span>
      <button type="button" class="cam-btn" data-flip aria-label="Always turn photos round" aria-pressed="false">⇋</button>
      <button type="button" class="cam-btn" data-grid aria-label="Grid lines" aria-pressed="false">#</button>
      <button type="button" class="cam-btn" data-torch aria-label="Torch" aria-pressed="false" hidden>⚡</button>
    </div>
    <div class="cam-msg" role="status"></div>
    <div class="cam-panel">
      <div class="cam-slider" hidden>
        <button type="button" class="cam-auto" data-auto>Auto</button>
        <input type="range" aria-label="Setting">
        <b class="cam-val"></b>
      </div>
      <div class="cam-chips"></div>
      <div class="cam-bar">
        <span class="cam-last" aria-hidden="true"></span>
        <button type="button" class="cam-shoot" aria-label="Take photo"><span></span></button>
        <button type="button" class="cam-done" data-close>Done</button>
      </div>
    </div>`;
  document.body.append(root);
  document.documentElement.classList.add('cam-open');
  const $ = (s) => root.querySelector(s);
  const video = $('video');
  let stream = null;
  let track = null;
  let shots = 0;
  let active = null;
  const saved = loadSaved();

  const close = () => {
    stream?.getTracks().forEach((t) => t.stop());
    root.remove();
    document.documentElement.classList.remove('cam-open');
    window.removeEventListener('popstate', onBack);
    onClose(shots);
  };
  // The phone's back button closes the camera instead of leaving the page.
  const onBack = () => close();
  history.pushState({ cam: true }, '');
  window.addEventListener('popstate', onBack);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) history.back();
  });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
    });
  } catch (e) {
    $('.cam-msg').textContent = e.name === 'NotAllowedError'
      ? 'Camera blocked. Allow the camera for this site in Chrome settings, or use the gallery button.'
      : 'The camera could not start. Use the gallery button instead.';
    return;
  }
  track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  await video.play().catch(() => {});

  const caps = track.getCapabilities?.() || {};
  const imageCapture = 'ImageCapture' in window ? new ImageCapture(track) : null;

  // Put back the settings used last time, where this camera allows them.
  const apply = async (c) => { try { await track.applyConstraints({ advanced: [c] }); return true; } catch { return false; } };
  for (const ctl of CONTROLS) {
    const v = saved[ctl.key];
    if (v === undefined || !caps[ctl.key]) continue;
    await apply(ctl.mode ? { [ctl.mode[0]]: ctl.mode[1], [ctl.key]: v } : { [ctl.key]: v });
  }

  const usable = CONTROLS.filter((c) => caps[c.key] && caps[c.key].max > caps[c.key].min
    && (!c.mode || (caps[c.mode[0]] || []).includes(c.mode[1])));
  $('.cam-chips').innerHTML = usable.map((c) => `<button type="button" class="cam-chip" data-ctl="${c.key}">${esc(c.label)}<small></small></button>`).join('')
    || '<span class="cam-hint">Tap the picture to focus</span>';
  const current = (key) => track.getSettings?.()[key];
  const paintChips = () => usable.forEach((c) => {
    const chip = root.querySelector(`[data-ctl="${c.key}"]`);
    const manual = saved[c.key] !== undefined;
    const v = current(c.key);
    chip.querySelector('small').textContent = manual && typeof v === 'number' ? c.fmt(v) : 'Auto';
    chip.classList.toggle('on', c.key === active);
  });
  paintChips();

  const slider = $('.cam-slider');
  const range = slider.querySelector('input');
  const showSlider = (key) => {
    active = active === key ? null : key;
    slider.hidden = !active;
    if (active) {
      const c = CONTROLS.find((x) => x.key === active);
      const cap = caps[active];
      range.min = cap.min; range.max = cap.max; range.step = cap.step || (cap.max - cap.min) / 100;
      range.value = current(active) ?? saved[active] ?? (cap.min + cap.max) / 2;
      range.setAttribute('aria-label', c.label);
      slider.querySelector('.cam-val').textContent = c.fmt(Number(range.value));
      slider.querySelector('[data-auto]').hidden = !c.mode && active !== 'exposureCompensation';
    }
    paintChips();
  };
  $('.cam-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ctl]');
    if (b) showSlider(b.dataset.ctl);
  });
  let pending;
  range.addEventListener('input', () => {
    const c = CONTROLS.find((x) => x.key === active);
    const v = Number(range.value);
    slider.querySelector('.cam-val').textContent = c.fmt(v);
    clearTimeout(pending);
    pending = setTimeout(async () => {
      await apply(c.mode ? { [c.mode[0]]: c.mode[1], [c.key]: v } : { [c.key]: v });
      saved[c.key] = v;
      saveSettings(saved);
      paintChips();
    }, 40);
  });
  $('[data-auto]').addEventListener('click', async () => {
    const c = CONTROLS.find((x) => x.key === active);
    if (c.mode) await apply({ [c.mode[0]]: c.mode[2] });
    else await apply({ [c.key]: 0 });
    delete saved[c.key];
    saveSettings(saved);
    showSlider(active);
  });

  // Tap to focus (and meter) on that spot, where the phone supports it.
  video.addEventListener('click', async (e) => {
    const r = video.getBoundingClientRect();
    const point = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const ring = document.createElement('span');
    ring.className = 'cam-focus';
    ring.style.left = `${e.clientX - r.left}px`;
    ring.style.top = `${e.clientY - r.top}px`;
    root.append(ring);
    setTimeout(() => ring.remove(), 900);
    if (caps.pointsOfInterest || 'pointsOfInterest' in (track.getSettings?.() || {})) {
      const focusAuto = (caps.focusMode || []).includes('single-shot') ? 'single-shot' : 'continuous';
      if (saved.focusDistance === undefined) await apply({ pointsOfInterest: [point], focusMode: focusAuto });
      else await apply({ pointsOfInterest: [point] });
    }
  });

  if (caps.torch) {
    const t = $('[data-torch]');
    t.hidden = false;
    t.onclick = async () => {
      const on = t.getAttribute('aria-pressed') !== 'true';
      if (await apply({ torch: on })) t.setAttribute('aria-pressed', String(on));
    };
  }
  // Backup for phones where the check below cannot tell: turn every photo round.
  const flipBtn = $('[data-flip]');
  const paintFlip = () => flipBtn.setAttribute('aria-pressed', String(!!saved.alwaysFlip));
  paintFlip();
  flipBtn.onclick = () => {
    if (saved.alwaysFlip) delete saved.alwaysFlip; else saved.alwaysFlip = true;
    saveSettings(saved);
    paintFlip();
    $('.cam-msg').textContent = saved.alwaysFlip ? 'Every photo will be turned round (left ↔ right).' : 'Photos are checked and turned round only when mirrored.';
    setTimeout(() => { $('.cam-msg').textContent = ''; }, 2500);
  };
  $('[data-grid]').onclick = (e) => {
    const g = $('.cam-grid');
    g.hidden = !g.hidden;
    e.currentTarget.setAttribute('aria-pressed', String(!g.hidden));
  };

  // Full sensor photo where the phone allows it, else the sharpest video frame.
  // Some Android phones hand back the full photo mirrored (writing on the toy
  // reads backwards). The live picture on screen is the right way round, so
  // each photo is checked against it and turned back when it is mirrored.
  async function capture() {
    if (imageCapture) {
      const view = looks(video, video.videoWidth, video.videoHeight);
      try {
        const blob = await imageCapture.takePhoto();
        if (blob?.size) {
          if (saved.alwaysFlip) return canvasBlob(mirrored(await loadBitmap(blob)), 0.92);
          return (await unmirror(blob, view)) || blob;
        }
      } catch { /* fall back to a frame */ }
    }
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    if (saved.alwaysFlip) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  }

  let busy = false;
  $('.cam-shoot').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const flash = $('.cam-flash');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    try {
      const blob = await capture();
      if (!blob) throw new Error('no photo');
      shots += 1;
      $('.cam-count').textContent = `${shots} taken`;
      const url = URL.createObjectURL(blob);
      const last = $('.cam-last');
      last.style.backgroundImage = `url("${url}")`;
      onShot(new File([blob], `snap-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' }));
    } catch {
      $('.cam-msg').textContent = 'That photo did not work. Try again.';
      setTimeout(() => { $('.cam-msg').textContent = ''; }, 2500);
    } finally {
      busy = false;
    }
  });
}

// A tiny grey copy of a picture (the middle part with the same shape as the
// live picture), evened out for brightness, to compare two pictures by.
const SW = 32;
const SH = 24;
export function looks(src, w, h, flip = false, aspect = w / h) {
  if (!w || !h) return null;
  const portrait = aspect < 1;
  const [ow, oh] = portrait ? [SH, SW] : [SW, SH];
  let cw = w;
  let ch = w / aspect;
  if (ch > h) { ch = h; cw = h * aspect; }
  const c = document.createElement('canvas');
  c.width = ow;
  c.height = oh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (flip) { ctx.translate(ow, 0); ctx.scale(-1, 1); }
  try {
    ctx.drawImage(src, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, ow, oh);
    const px = ctx.getImageData(0, 0, ow, oh).data;
    const g = new Float32Array(ow * oh);
    let sum = 0;
    for (let i = 0; i < g.length; i++) { g[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11; sum += g[i]; }
    const mean = sum / g.length;
    let v = 0;
    for (let i = 0; i < g.length; i++) { g[i] -= mean; v += g[i] * g[i]; }
    const sd = Math.sqrt(v / g.length) || 1;
    for (let i = 0; i < g.length; i++) g[i] /= sd;
    return { g, aspect, portrait };
  } catch {
    return null;
  }
}
const distance = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

// The photo turned back the right way round when it is a mirror image of the
// live picture; null when it is fine (or when it cannot tell).
export async function unmirror(blob, view) {
  if (!view) return null;
  try {
    const small = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 192, resizeQuality: 'low' });
    const { width: w, height: h } = small;
    if ((w / h < 1) !== view.portrait) return null; // turned sideways: cannot compare
    const same = looks(small, w, h, false, view.aspect);
    const flipped = looks(small, w, h, true, view.aspect);
    if (!same || !flipped) return null;
    const dSame = distance(same.g, view.g);
    const dFlip = distance(flipped.g, view.g);
    // Only turn it round when the mirror image clearly matches better.
    if (!(dFlip < dSame * 0.8)) return null;
    return canvasBlob(mirrored(await loadBitmap(blob)), 0.92);
  } catch {
    return null;
  }
}
