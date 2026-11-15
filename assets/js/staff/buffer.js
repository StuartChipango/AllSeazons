// "Post with Buffer": staff pick pictures, write the caption, tick the
// shop's Facebook Page, Instagram and TikTok, and Buffer posts them (now,
// in the next free slot, or at a chosen time). Buffer is already approved
// by Meta and TikTok, so no Facebook app review is needed.
//
// The Buffer key lives only in the buffer-post Edge Function. Pictures go
// to the public "social" bucket first, because Buffer fetches them by link
// when the post goes out.
import { esc } from '../lib.js';
import { supabase } from '../db.js';
import { toast, openPanel, busy } from './ui.js';

const MAX_PICS = 10;
const SERVICE = {
  facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', twitter: 'X', threads: 'Threads',
  linkedin: 'LinkedIn', pinterest: 'Pinterest', youtube: 'YouTube', googlebusiness: 'Google',
};
const serviceName = (s) => Object.entries(SERVICE).find(([k]) => (s || '').includes(k))?.[1] || s;

let cached = null;

async function call(body) {
  const { data, error } = await supabase.functions.invoke('buffer-post', { body });
  if (!error) return data;
  let msg = error.message;
  let setup = false;
  try {
    const b = await error.context?.json();
    if (b?.error) msg = b.error;
    setup = !!b?.setup;
  } catch { /* not JSON */ }
  if (error.context?.status === 404) { msg = 'The Buffer link is not switched on yet.'; setup = true; }
  const e = new Error(msg);
  e.setup = setup;
  throw e;
}

function remember(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* private mode */ }
  return null;
}

function setupHelp(msg) {
  openPanel(`
    <h2>Link Buffer first</h2>
    <p>${esc(msg)}</p>
    <ol class="bf-steps">
      <li>Make a free account at <b>buffer.com</b> and connect the shop's <b>Facebook Page</b>, <b>Instagram</b> (Business or Creator account) and <b>TikTok</b>.</li>
      <li>In Buffer open <b>Settings → API</b> (publish.buffer.com/settings/api) and tap <b>Create API key</b>. Copy it.</li>
      <li>In Supabase open <b>Edge Functions → Secrets</b>, add <b>BUFFER_API_KEY</b> and paste the key.</li>
      <li>In Supabase open <b>Edge Functions → Deploy a new function → Via Editor</b>, name it <b>buffer-post</b>, paste the code from <b>supabase/functions/buffer-post/index.ts</b> and tap <b>Deploy</b>.</li>
      <li>Run the latest <b>schema-paste.sql</b> once in the SQL Editor.</li>
    </ol>
    <p class="muted">Until then, use Share and pick Facebook or Business Suite.</p>`);
}

async function upload(files, onStep) {
  const day = new Date().toISOString().slice(0, 10);
  const urls = [];
  for (const [i, f] of files.entries()) {
    onStep?.(i + 1);
    const ext = f.type === 'image/png' ? 'png' : 'jpg';
    const path = `${day}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('social').upload(path, f, { contentType: f.type, upsert: false });
    if (error) throw new Error(`A picture could not be uploaded: ${error.message}`);
    urls.push(supabase.storage.from('social').getPublicUrl(path).data.publicUrl);
  }
  return urls;
}

function localInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function postWithBuffer(files, caption = '') {
  let body = openPanel(`<h2>Post with Buffer</h2><p class="muted">Checking your linked pages…</p>`);
  let channels;
  try {
    channels = cached || (cached = (await call({ action: 'channels' })).channels || []);
  } catch (e) {
    cached = null;
    if (e.setup) return setupHelp(e.message);
    return toast(e.message, true);
  }
  if (!channels.length) return setupHelp('Buffer has no pages linked yet. Connect the Facebook Page, Instagram and TikTok in Buffer.');

  const ticked = new Set(remember('buffer_channels') || channels.map((c) => c.id));
  const picked = new Set(files.slice(0, MAX_PICS).map((_, i) => i));
  const urls = files.map((f) => URL.createObjectURL(f));
  const when = remember('buffer_when') || 'now';
  const later = new Date(Date.now() + 3 * 3600_000);
  later.setMinutes(0, 0, 0);

  body = openPanel(`
    <h2>Post with Buffer</h2>
    <div class="field"><span>Post on</span>
      <div class="bf-channels">${channels.map((c) => `
        <label class="bf-ch"><input type="checkbox" value="${esc(c.id)}" ${ticked.has(c.id) ? 'checked' : ''}>
          ${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : ''}<span><b>${esc(serviceName(c.service))}</b><small>${esc(c.name)}</small></span></label>`).join('')}
      </div></div>
    <div class="field"><span>Pictures${files.length > MAX_PICS ? ` (up to ${MAX_PICS} in one post)` : ''}</span>
      <div class="sp-grid">${files.map((f, i) => `
        <button type="button" class="sp-pic bf-pic" data-pic="${i}" aria-pressed="${picked.has(i)}"><img src="${urls[i]}" alt="Picture ${i + 1}"><span>${i + 1}</span></button>`).join('')}</div></div>
    <label class="field"><span>Caption</span><textarea rows="6" data-text>${esc(caption)}</textarea></label>
    <div class="field"><span>When</span>
      <div class="seg" role="group">
        ${[['now', 'Post now'], ['queue', 'Next free slot'], ['at', 'Pick a time']].map(([v, l]) => `<button type="button" class="chip" data-when="${v}" aria-pressed="${v === when}">${l}</button>`).join('')}
      </div>
      <input type="datetime-local" data-at value="${localInput(later)}" ${when === 'at' ? '' : 'hidden'} style="margin-top:8px">
    </div>
    <button class="btn block bf-go" data-go>Post</button>
    <div class="bf-results" data-results></div>`);
  body.closest('dialog').addEventListener('close', () => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60000));

  let mode = when;
  body.querySelectorAll('[data-when]').forEach((b) => (b.onclick = () => {
    mode = b.dataset.when;
    remember('buffer_when', mode);
    body.querySelectorAll('[data-when]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    body.querySelector('[data-at]').hidden = mode !== 'at';
  }));
  body.querySelectorAll('[data-pic]').forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.pic);
    if (picked.has(i)) picked.delete(i);
    else if (picked.size >= MAX_PICS) return toast(`One post can have up to ${MAX_PICS} pictures.`, true);
    else picked.add(i);
    b.setAttribute('aria-pressed', String(picked.has(i)));
  }));

  body.querySelector('[data-go]').onclick = async (e) => {
    const btn = e.currentTarget;
    const ids = [...body.querySelectorAll('.bf-ch input:checked')].map((x) => x.value);
    const list = [...picked].sort((a, b) => a - b).map((i) => files[i]);
    if (!ids.length) return toast('Tick at least one page.', true);
    if (!list.length) return toast('Pick at least one picture.', true);
    let dueAt;
    if (mode === 'at') {
      const t = new Date(body.querySelector('[data-at]').value);
      if (!(t > new Date())) return toast('Pick a time in the future.', true);
      dueAt = t.toISOString();
    }
    remember('buffer_channels', ids);
    const out = body.querySelector('[data-results]');
    out.innerHTML = '';
    busy(btn, true, 'Uploading pictures…');
    try {
      const images = await upload(list, (i) => busy(btn, true, `Uploading ${i} of ${list.length}…`));
      busy(btn, true, 'Sending to Buffer…');
      const { results } = await call({ action: 'post', channelIds: ids, text: body.querySelector('[data-text]').value, images, when: mode, dueAt });
      out.innerHTML = results.map((r) => `
        <p class="bf-r ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} <b>${esc(serviceName(r.service) || '')}</b> ${esc(r.name || '')}: ${r.ok
          ? (mode === 'now' ? 'posted (it shows in a minute or two)' : mode === 'queue' ? 'added to the queue' : 'scheduled')
          : esc(r.error || 'not posted')}</p>`).join('');
      const good = results.filter((r) => r.ok).length;
      toast(good === results.length ? 'Sent to Buffer' : `${good} of ${results.length} went through`, good !== results.length);
      if (good) {
        btn.textContent = '✓ Sent';
        btn.dataset.label = btn.textContent;
      }
    } catch (err) {
      if (err.setup) return setupHelp(err.message);
      toast(err.message, true);
    } finally {
      busy(btn, false);
    }
  };
}

export const bufferAction = {
  label: 'Post with Buffer (Facebook, Instagram, TikTok)',
  hint: 'Posts straight to the shop’s pages, now or at a time you pick.',
  run: postWithBuffer,
};
