import { esc } from '../lib.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(text, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3000);
}

// A side panel for editing one thing. Returns the panel's content element.
export function openPanel(html, { wide = false } = {}) {
  closePanel();
  const d = document.createElement('dialog');
  d.className = 'panel' + (wide ? ' wide' : '');
  d.innerHTML = `<button class="close" data-close-panel aria-label="Close">×</button><div class="panel-body">${html}</div>`;
  document.body.append(d);
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close-panel]')) closePanel();
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d.querySelector('.panel-body');
}

export function closePanel() {
  document.querySelectorAll('dialog.panel').forEach((d) => d.close());
}

export function confirmBox(message, { ok = 'Yes', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = openPanel(`
      <h2>Are you sure?</h2>
      <p>${esc(message)}</p>
      <div class="row-actions">
        <button class="btn ghost" data-no>Go back</button>
        <button class="btn ${danger ? 'danger' : ''}" data-yes>${esc(ok)}</button>
      </div>`);
    const dialog = body.closest('dialog');
    let answered = false;
    body.querySelector('[data-yes]').onclick = () => { answered = true; resolve(true); closePanel(); };
    body.querySelector('[data-no]').onclick = () => closePanel();
    dialog.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function dateLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lusaka' });
}

export function download(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function seg(name, value, options) {
  return `<div class="seg" role="group">${options.map(([v, label]) =>
    `<button type="button" class="chip" data-seg="${name}" data-value="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(label)}</button>`).join('')}</div>`;
}

export function busy(button, on, text) {
  if (!button) return;
  if (on) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    if (text) button.textContent = text;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

// Some Android phones only let a page read picked photos for a short time
// (or until the file picker is redrawn), so copy them into memory at once.
export async function keepFiles(list) {
  return Promise.all([...list].map(async (f) => {
    try {
      const buf = await f.arrayBuffer();
      return new File([buf], f.name, { type: f.type, lastModified: f.lastModified });
    } catch {
      return f;
    }
  }));
}
