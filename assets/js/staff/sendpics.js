// "Pictures ready": one screen for every set of social media pictures the
// staff app makes (the toy pack and "Make a post"). No zip files: each
// picture is its own JPEG (or PNG), shared straight into Facebook,
// WhatsApp or Instagram through the phone's share menu, or saved to the
// phone's gallery one by one.
//
// The share menu only opens straight after a tap, and Android takes at most
// 10 pictures (about 50 MB) at a time, so big sets get one button per 10.
import { esc } from '../lib.js';
import { toast, openPanel } from './ui.js';

const MAX_FILES = 10;
const MAX_BYTES = 45 * 1024 * 1024;

export function batches(files) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= MAX_FILES || size + f.size > MAX_BYTES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const canShareFiles = (files) => {
  try { return !!navigator.canShare && navigator.canShare({ files }); } catch { return false; }
};

async function copyText(text, quiet) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    if (!quiet) toast('Caption copied');
    return true;
  } catch { return false; }
}

// files: File[] (each with a name and type). caption: text to paste under
// the post. Opens a panel; the pictures stay in memory while it is open.
export function showReady(files, { caption = '', title } = {}) {
  const groups = batches(files);
  const share = canShareFiles(files.slice(0, 1));
  const urls = files.map((f) => URL.createObjectURL(f));
  const n = files.length;
  const label = (g, i) => {
    if (groups.length === 1) return n > 1 ? `Share all ${n} pictures` : 'Share the picture';
    const first = groups.slice(0, i).reduce((s, x) => s + x.length, 0) + 1;
    return `Share pictures ${first}–${first + g.length - 1}`;
  };
  const body = openPanel(`
    <h2>${esc(title || (n > 1 ? `${n} pictures ready` : 'Picture ready'))}</h2>
    ${share ? `
      <p class="muted sp-hint">Tap Share, then pick <b>Facebook</b> (or Business Suite, WhatsApp, Instagram). To post on the shop's Page, choose the Page as the one posting.</p>
      <div class="sp-actions">${groups.map((g, i) => `<button class="btn block sp-share" data-share="${i}">${esc(label(g, i))}</button>`).join('')}</div>`
    : `<p class="muted sp-hint">This browser cannot share pictures straight to other apps. Save them, then add them from the gallery.</p>`}
    <div class="sp-actions">
      <button class="btn block ${share ? 'ghost' : ''}" data-save>Save ${n > 1 ? `all ${n} ` : ''}to the phone</button>
    </div>
    <p class="muted sp-hint">Tap one picture to save just that one.</p>
    <div class="sp-grid">${files.map((f, i) => `
      <button type="button" class="sp-pic" data-one="${i}" title="${esc(f.name)}"><img src="${urls[i]}" alt="Picture ${i + 1}"><span>${i + 1}</span></button>`).join('')}</div>
    ${caption ? `<label class="field"><span>Caption to paste under the post</span><textarea rows="7" data-caption>${esc(caption)}</textarea></label>
    <button class="btn ghost" data-copy>Copy caption</button>` : ''}`);
  const text = () => body.querySelector('[data-caption]')?.value || '';
  body.closest('dialog').addEventListener('close', () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60000));

  body.querySelectorAll('[data-share]').forEach((b) => (b.onclick = async () => {
    const list = groups[Number(b.dataset.share)];
    // Facebook ignores text that comes with pictures, so the caption also
    // goes on the clipboard: long-press and Paste in the post box.
    const copied = await copyText(text(), true);
    try {
      await navigator.share({ files: list, text: text() || undefined });
      b.classList.add('done');
      b.textContent = `✓ ${b.textContent.replace(/^✓ /, '')}`;
    } catch (e) {
      if (e?.name === 'AbortError') return;
      try {
        await navigator.share({ files: list });
        b.classList.add('done');
      } catch (e2) {
        if (e2?.name !== 'AbortError') toast('This phone would not share these pictures. Save them instead, then post from the gallery.', true);
      }
    }
    if (copied) toast('Caption copied: long-press and Paste in the post');
  }));
  body.querySelector('[data-save]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    for (const [i, f] of files.entries()) {
      b.textContent = `Saving ${i + 1} of ${n}…`;
      saveBlob(f.name, f);
      await new Promise((r) => setTimeout(r, 450));
    }
    b.disabled = false;
    b.textContent = `✓ Saved ${n > 1 ? `all ${n}` : ''}`;
    toast(n > 1 ? `${n} pictures saved to Downloads` : 'Picture saved to Downloads');
  };
  body.querySelectorAll('[data-one]').forEach((b) => (b.onclick = () => {
    const f = files[Number(b.dataset.one)];
    saveBlob(f.name, f);
    b.classList.add('done');
  }));
  body.querySelector('[data-copy]')?.addEventListener('click', () => copyText(text()));
  return body;
}
