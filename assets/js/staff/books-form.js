// One entry in the Books: a receipt photo (read by the phone), or money
// in or out typed by hand. Used by the Books page (owners) and the
// "Hand in a receipt" page (everyone on staff).
import { esc } from '../lib.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAY_METHODS, lusakaToday } from '../books-lib.js';
import { supabase, friendlyError } from '../db.js';
import { shared, can } from './app.js';
import { $, $$, toast, openPanel, closePanel, confirmBox, busy, keepFiles } from './ui.js';

export function useBooksCss() {
  if (document.querySelector('link[data-books-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/books.css', import.meta.url).href;
  l.dataset.booksCss = '';
  document.head.append(l);
}

// Shown receipts are private: download them with the signed-in session.
const urlCache = new Map();
export async function receiptUrl(path) {
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  const { data, error } = await supabase.storage.from('receipts').download(path);
  if (error || !data) return null;
  const type = /\.pdf$/i.test(path) ? 'application/pdf' : (data.type || 'image/jpeg');
  const url = URL.createObjectURL(new Blob([data], { type }));
  urlCache.set(path, url);
  return url;
}

const options = (map, value) => Object.entries(map)
  .map(([k, label]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(label)}</option>`).join('');

let suppliers = null;
async function knownSuppliers() {
  if (suppliers || !can('owner')) return suppliers || [];
  const { data } = await supabase.from('book_entries').select('supplier').not('supplier', 'is', null)
    .order('created_at', { ascending: false }).limit(300);
  suppliers = [...new Set((data || []).map((x) => x.supplier).filter(Boolean))];
  return suppliers;
}

function photoBox(fileOrUrl, isPdf) {
  if (!fileOrUrl) return '<div class="rc-photo empty"><span>No receipt photo</span></div>';
  if (isPdf) return `<div class="rc-photo pdf"><a href="${esc(fileOrUrl)}" target="_blank" rel="noopener">Receipt (PDF) ↗</a></div>`;
  return `<a class="rc-photo" href="${esc(fileOrUrl)}" target="_blank" rel="noopener"><img src="${esc(fileOrUrl)}" alt="Receipt photo"></a>`;
}

/**
 * Open the form. Resolves with 'saved', 'deleted' or 'skipped' when it closes.
 *   entry  an existing row to edit (or null)
 *   file   a new photo or PDF of a receipt (read on the phone)
 *   kind   'expense' or 'income' for a new entry
 *   step   e.g. "2 of 5" when going through several receipts
 */
export function openEntry({ entry = null, file = null, kind = 'expense', step = '' } = {}) {
  useBooksCss();
  const owner = can('owner');
  const e = entry || { kind, category: kind === 'income' ? 'sales' : 'other', spent_on: lusakaToday(), paid_by: 'business', pay_method: 'cash' };
  let newFile = file;
  let readText = e.receipt_text || '';
  const touched = new Set();
  let result = 'skipped';

  return new Promise((resolve) => {
    const body = openPanel(`
      <h2>${entry ? (e.kind === 'income' ? 'Money in' : 'Receipt') : step ? `Receipt ${esc(step)}` : (kind === 'income' ? 'Money in' : 'New receipt or expense')}</h2>
      <form class="rc-form" novalidate>
        <div class="rc-top">
          <div id="rcPhoto">${photoBox(null)}</div>
          <div class="rc-photo-actions">
            <label class="btn ghost small"><input type="file" accept="image/*" capture="environment" hidden data-photo>${e.receipt_path || file ? 'Retake photo' : 'Snap receipt'}</label>
            <label class="btn ghost small"><input type="file" accept="image/*,application/pdf" hidden data-photo>${e.receipt_path || file ? 'Other photo or PDF' : 'Photo or PDF'}</label>
          </div>
        </div>
        <div class="rc-reading" id="rcReading" hidden><div class="progress"><span style="width:2%"></span></div><small>Reading the receipt…</small></div>
        ${owner ? `<div class="seg rc-kind" role="group" aria-label="Money in or out">
          <button type="button" class="chip" data-kind="expense" aria-pressed="${e.kind !== 'income'}">Money out</button>
          <button type="button" class="chip" data-kind="income" aria-pressed="${e.kind === 'income'}">Money in</button>
        </div>` : ''}
        <label class="field rc-amount"><span>Amount (Kwacha)</span>
          <input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(e.amount ?? '')}" placeholder="0.00"></label>
        <div class="rc-two">
          <label class="field"><span>Date on the receipt</span><input name="spent_on" type="date" max="${lusakaToday()}" required value="${esc(e.spent_on || lusakaToday())}"></label>
          <label class="field"><span>Category</span><select name="category"></select></label>
        </div>
        <label class="field"><span>Shop or supplier</span><input name="supplier" list="rcSuppliers" maxlength="80" autocomplete="off" value="${esc(e.supplier || '')}"></label>
        <datalist id="rcSuppliers"></datalist>
        <label class="field"><span>What for <small>(optional)</small></span><input name="description" maxlength="160" value="${esc(e.description || '')}" placeholder="e.g. 2 shelves for the shop"></label>
        <div class="rc-stock" hidden>
          <div class="rc-two">
            <label class="field"><span>How many toys or items</span><input name="items" type="number" inputmode="numeric" min="0" step="1" value="${esc(e.items ?? '')}"></label>
            <label class="field"><span>Box <small>(from Boxes)</small></span><select name="box_id"><option value="">None</option>${shared.boxes.map((b) => `<option value="${esc(b.id)}" ${b.id === e.box_id ? 'selected' : ''}>${esc(b.id)}${b.supplier ? ` · ${esc(b.supplier)}` : ''}</option>`).join('')}</select></label>
          </div>
          <p class="sub rc-note">Picking a box stops its cost from being counted twice.</p>
        </div>
        <div class="rc-two">
          <label class="field"><span>Paid with</span><select name="pay_method">${options(PAY_METHODS, e.pay_method || 'cash')}</select></label>
          <label class="field"><span>Paid by</span><select name="paid_by">
            <option value="business" ${e.paid_by !== 'director' ? 'selected' : ''}>The business</option>
            <option value="director" ${e.paid_by === 'director' ? 'selected' : ''}>A director (own money)</option></select></label>
        </div>
        <details class="rc-text" ${readText ? '' : 'hidden'}><summary>What the phone read</summary><pre id="rcText">${esc(readText)}</pre></details>
        ${e.status === 'check' && owner ? '<p class="rc-flag">Handed in by staff. Saving marks it as checked.</p>' : ''}
        <p class="error-text" id="rcError" role="alert"></p>
        <div class="row-actions">
          ${entry && owner ? '<button type="button" class="btn danger" data-delete>Delete</button>' : ''}
          ${step ? '<button type="button" class="btn ghost" data-skip>Skip</button>' : ''}
          <button type="submit" class="btn go">${owner ? 'Save' : 'Hand it in'}</button>
        </div>
      </form>`);
    const form = $('form', body);
    const f = (n) => form.elements[n];
    let currentKind = e.kind || kind;

    const setCategories = () => {
      const map = currentKind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      const keep = map[f('category').value] ? f('category').value : (map[e.category] ? e.category : Object.keys(map)[currentKind === 'income' ? 0 : Object.keys(map).length - 1]);
      f('category').innerHTML = options(map, keep);
      showStock();
    };
    const showStock = () => { $('.rc-stock', form).hidden = !(currentKind === 'expense' && f('category').value === 'stock'); };
    setCategories();
    f('category').onchange = () => { touched.add('category'); showStock(); };
    for (const n of ['amount', 'spent_on', 'supplier']) f(n).addEventListener('input', () => touched.add(n));
    $$('[data-kind]', form).forEach((b) => b.onclick = () => {
      currentKind = b.dataset.kind;
      $$('[data-kind]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      setCategories();
    });
    knownSuppliers().then((list) => { $('#rcSuppliers', body).innerHTML = list.map((s) => `<option value="${esc(s)}">`).join(''); });

    const showFile = (fl) => {
      const url = URL.createObjectURL(fl);
      $('#rcPhoto', body).innerHTML = photoBox(url, fl.type === 'application/pdf');
    };
    if (e.receipt_path && !file) receiptUrl(e.receipt_path).then((u) => { if (u) $('#rcPhoto', body).innerHTML = photoBox(u, /\.pdf$/i.test(e.receipt_path)); });

    async function read(fl) {
      showFile(fl);
      if (!fl.type.startsWith('image/')) return;
      const box = $('#rcReading', body);
      const bar = $('span', box);
      const label = $('small', box);
      box.hidden = false;
      try {
        const { readReceiptPhoto } = await import('./receipt-reader.js');
        const r = await readReceiptPhoto(fl, (p, words) => { bar.style.width = `${Math.max(2, p * 100)}%`; label.textContent = words + '…'; });
        readText = r.text;
        $('#rcText', body).textContent = r.text || '(no words found)';
        $('.rc-text', body).hidden = false;
        const filled = [];
        if (r.amount != null && !touched.has('amount')) { f('amount').value = r.amount; filled.push('amount'); }
        if (r.spent_on && !touched.has('spent_on')) { f('spent_on').value = r.spent_on; filled.push('date'); }
        if (r.supplier && !touched.has('supplier') && !f('supplier').value) { f('supplier').value = r.supplier; filled.push('shop'); }
        if (currentKind === 'expense' && r.category !== 'other' && !touched.has('category') && !entry) { f('category').value = r.category; showStock(); filled.push('category'); }
        label.textContent = filled.length
          ? `Filled in the ${filled.join(', ')}. Please check them against the photo.`
          : 'Could not read it clearly. Please type the amount and date.';
        bar.style.width = '100%';
        filled.forEach((n) => form.querySelector(`[name="${{ amount: 'amount', date: 'spent_on', shop: 'supplier', category: 'category' }[n]}"]`)?.classList.add('rc-filled'));
      } catch (err) {
        console.warn('receipt reader', err);
        label.textContent = 'The phone could not read it. Please type the amount and date.';
      }
    }
    if (file) read(file);
    $$('[data-photo]', form).forEach((inp) => inp.onchange = async () => {
      if (!inp.files.length) return;
      [newFile] = await keepFiles(inp.files);
      inp.value = '';
      read(newFile);
    });

    const dialog = body.closest('dialog');
    let asking = false;
    dialog.addEventListener('close', () => { if (!asking) resolve(result); });
    $('[data-skip]', form)?.addEventListener('click', () => { result = 'skipped'; closePanel(); });
    $('[data-delete]', form)?.addEventListener('click', async () => {
      asking = true;
      if (!(await confirmBox('Delete this entry and its receipt photo?', { ok: 'Delete', danger: true }))) {
        openEntry({ entry: e }).then(resolve);
        return;
      }
      const { error } = await supabase.from('book_entries').delete().eq('id', e.id);
      if (error) return toast(friendlyError(error), true);
      if (e.receipt_path) supabase.storage.from('receipts').remove([e.receipt_path]).catch(() => {});
      toast('Deleted');
      result = 'deleted';
      resolve(result);
    });

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const err = $('#rcError', body);
      const amount = Number(f('amount').value);
      if (!f('amount').value || !(amount >= 0)) { err.textContent = 'Type the amount.'; f('amount').focus(); return; }
      if (!f('spent_on').value) { err.textContent = 'Pick the date on the receipt.'; return; }
      if (f('spent_on').value > lusakaToday()) { err.textContent = 'The date cannot be in the future.'; return; }
      const btn = form.querySelector('[type=submit]');
      busy(btn, true, 'Saving…');
      try {
        const rec = {
          kind: currentKind,
          category: f('category').value,
          spent_on: f('spent_on').value,
          supplier: f('supplier').value.trim() || null,
          description: f('description').value.trim() || null,
          amount: Math.round(amount * 100) / 100,
          pay_method: f('pay_method').value,
          paid_by: f('paid_by').value,
          items: currentKind === 'expense' && f('category').value === 'stock' && f('items').value !== '' ? Math.round(Number(f('items').value)) : null,
          box_id: currentKind === 'expense' && f('category').value === 'stock' ? (f('box_id').value || null) : null,
          receipt_text: readText || null,
          status: 'ok',
        };
        if (newFile) {
          const { archiveCopy } = await import('./receipt-reader.js');
          const copy = await archiveCopy(newFile);
          const path = `${rec.spent_on.slice(0, 7)}/${crypto.randomUUID()}.${copy.ext}`;
          const up = await supabase.storage.from('receipts').upload(path, copy.blob, { contentType: copy.type, upsert: false });
          if (up.error) throw up.error;
          if (e.receipt_path) supabase.storage.from('receipts').remove([e.receipt_path]).catch(() => {});
          rec.receipt_path = path;
        }
        const q = entry
          ? supabase.from('book_entries').update(rec).eq('id', e.id)
          : supabase.from('book_entries').insert(rec);
        const { error } = await q;
        if (error) throw error;
        if (rec.supplier && suppliers && !suppliers.includes(rec.supplier)) suppliers.unshift(rec.supplier);
        toast(owner ? 'Saved in the books' : 'Handed in. A director will check it.');
        result = 'saved';
        closePanel();
      } catch (x) {
        busy(btn, false);
        err.textContent = /book_entries|schema cache|bucket/i.test(x.message || '')
          ? 'The Books are not switched on yet. A director needs to run supabase/books.sql in Supabase.'
          : friendlyError(x);
      }
    };
  });
}

// Several receipts at once (backdating a pile of old ones): one after another.
export async function enterReceipts(files) {
  const list = [...files];
  let saved = 0;
  for (let i = 0; i < list.length; i++) {
    const r = await openEntry({ file: list[i], step: list.length > 1 ? `${i + 1} of ${list.length}` : '' });
    if (r === 'saved') saved++;
  }
  return saved;
}
