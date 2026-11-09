import { esc, kwacha, AGES, AUDIENCES, CONDITIONS, effectivePrice, parseCsv, toCsv, legacyRowToToy } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { shared, refreshBadges } from './app.js';
import { $, $$, toast, openPanel, closePanel, confirmBox, seg, download, busy, dateLabel } from './ui.js';
import { reframe, replacePhoto, deleteToyFiles } from './photos.js';
import { makeZip } from '../unzip.js';
import { mediaHtml, wireMedia } from './media.js';

const STATUS_LABEL = {
  available: 'In shop', review: 'Needs review', reserved: 'On hold', sold: 'Sold', damaged: 'Damaged', hidden: 'Hidden',
};
const filter = { q: '', status: 'instock', audience: '', condition: '', category: '', box: '' };
let root = null;
let toys = [];
const selected = new Set();

export async function show(main) {
  root = main;
  await load();
}
export function leave() { root = null; }

async function load() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('toys').select('*').order('created_at', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  toys = all;
  render();
}

function matches(t) {
  const f = filter;
  if (f.status === 'instock' && !['available', 'reserved'].includes(t.status)) return false;
  if (f.status && f.status !== 'instock' && t.status !== f.status) return false;
  if (f.audience && t.audience !== f.audience) return false;
  if (f.condition && t.condition !== f.condition) return false;
  if (f.category && t.category !== f.category) return false;
  if (f.box && t.box_id !== f.box) return false;
  if (f.q) {
    const hay = `${t.name} ${t.code} ${t.brand || ''} ${t.legacy_id || ''} ${t.category || ''}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function render() {
  if (!root) return;
  const list = toys.filter(matches);
  const value = list.filter((t) => ['available', 'reserved'].includes(t.status)).reduce((s, t) => s + effectivePrice(t) * t.quantity, 0);
  root.innerHTML = `
    <div class="page-head">
      <h1>Stock</h1>
      <button class="btn small" id="socialPack" title="The framed pictures and captions of the toys listed below, for Facebook and the other pages">Social media pack</button>
      <button class="btn ghost small" id="exportCsv">Export CSV</button>
      <label class="btn ghost small">Import CSV<input type="file" accept=".csv,text/csv" id="importCsv" hidden></label>
    </div>
    <nav class="stories" aria-label="Stock jobs">
      <a class="story" href="#upload"><div class="ring"><div class="in">📷</div></div>Snap</a>
      <a class="story ${toys.some((t) => t.status === 'review') ? '' : 'quiet'}" href="#review"><div class="ring"><div class="in">${toys.filter((t) => t.status === 'review').length}</div></div>Review</a>
      <a class="story quiet" href="#boxes"><div class="ring"><div class="in">📦</div></div>Boxes</a>
    </nav>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search name, code, brand" value="${esc(filter.q)}">
      <select id="fStatus">
        <option value="instock" ${filter.status === 'instock' ? 'selected' : ''}>In shop and on hold</option>
        <option value="" ${filter.status === '' ? 'selected' : ''}>Everything</option>
        ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${filter.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select id="fAudience"><option value="">Boys, girls, neutral</option>${Object.entries(AUDIENCES).map(([v, a]) => `<option value="${v}" ${filter.audience === v ? 'selected' : ''}>${a.label}</option>`).join('')}</select>
      <select id="fCondition"><option value="">Used and new</option>${Object.entries(CONDITIONS).map(([v, l]) => `<option value="${v}" ${filter.condition === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="fCategory"><option value="">All types</option>${shared.categories.map((c) => `<option ${filter.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="fBox"><option value="">All boxes</option>${shared.boxes.map((b) => `<option ${filter.box === b.id ? 'selected' : ''}>${esc(b.id)}</option>`).join('')}</select>
    </div>
    <p class="lead" style="margin:0 0 10px">${list.length} toy${list.length === 1 ? '' : 's'}${value ? ` · shop value ${kwacha(value)}` : ''}</p>
    <div class="list">${list.slice(0, 400).map((t) => `
      <div class="item-row" data-id="${t.id}">
        <input type="checkbox" data-pick="${t.id}" ${selected.has(t.id) ? 'checked' : ''} aria-label="Select ${esc(t.name)}">
        <img src="${esc(imageUrl(t.thumb_path || t.image_path))}" alt="" loading="lazy" decoding="async">
        <div><div class="nm">${esc(t.name)}</div>
          <div class="mt">${esc(t.code)} · ${esc(AUDIENCES[t.audience]?.label)} · ${esc(CONDITIONS[t.condition])}${t.box_id ? ' · ' + esc(t.box_id) : ''}${t.quantity > 1 ? ` · ${t.quantity} left` : ''}</div></div>
        <div style="text-align:right"><div><strong>${kwacha(effectivePrice(t))}</strong>${effectivePrice(t) < t.price ? ` <s style="color:var(--muted)">${kwacha(t.price)}</s>` : ''}</div>
          <span class="pill ${t.status}">${STATUS_LABEL[t.status]}</span></div>
      </div>`).join('')}
      ${list.length > 400 ? `<p class="lead">Showing the first 400. Use search or filters to find others.</p>` : ''}
    </div>
    ${selected.size ? `
      <div class="bulkbar">
        <strong>${selected.size} selected</strong>
        <button class="btn small" data-bulk="sell">Sell in shop</button>
        <button class="btn small" data-bulk="special">Make special</button>
        <button class="btn small" data-bulk="unspecial">Remove special</button>
        <button class="btn small" data-bulk="show">Show in shop</button>
        <button class="btn small" data-bulk="hide">Hide</button>
        <button class="btn small" data-bulk="social">Social media pack</button>
        <button class="btn small" data-bulk="clear">Clear</button>
      </div>` : ''}
    <div class="mobile-more"><a class="btn ghost" href="../" target="_blank">View shop</a></div>`;
  wire();
}

function wire() {
  let qTimer;
  $('#q', root).oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { filter.q = e.target.value.trim(); render(); $('#q', root)?.focus(); const q = $('#q', root); q?.setSelectionRange(q.value.length, q.value.length); }, 250); };
  for (const [id, key] of [['#fStatus', 'status'], ['#fAudience', 'audience'], ['#fCondition', 'condition'], ['#fCategory', 'category'], ['#fBox', 'box']]) {
    $(id, root).onchange = (e) => { filter[key] = e.target.value; render(); };
  }
  $$('.item-row', root).forEach((row) => row.addEventListener('click', (e) => {
    if (e.target.matches('input[type=checkbox]')) return;
    edit(toys.find((t) => t.id === row.dataset.id));
  }));
  $$('[data-pick]', root).forEach((c) => c.onchange = () => {
    if (c.checked) selected.add(c.dataset.pick); else selected.delete(c.dataset.pick);
    render();
  });
  $$('[data-bulk]', root).forEach((b) => b.onclick = () => bulk(b.dataset.bulk, b));
  $('#exportCsv', root).onclick = exportCsv;
  $('#socialPack', root).onclick = (e) => socialPack(toys.filter(matches), e.currentTarget);
  $('#importCsv', root).onchange = (e) => importCsv(e.target.files[0]);
}

async function bulk(action, button) {
  const ids = [...selected];
  const picked = toys.filter((t) => selected.has(t.id));
  if (action === 'clear') { selected.clear(); return render(); }
  if (action === 'sell') return sellPanel(picked);
  if (action === 'social') return socialPack(picked, button);
  let changes;
  if (action === 'special') {
    const v = prompt('Special price in kwacha for all selected toys (leave empty to just mark them special)', '');
    if (v === null) return;
    changes = { is_special: true, sale_price: v.trim() ? parseInt(v, 10) : null };
  } else if (action === 'unspecial') changes = { is_special: false, sale_price: null };
  else if (action === 'hide') changes = { status: 'hidden' };
  else if (action === 'show') changes = { status: 'available' };
  let q = supabase.from('toys').update(changes).in('id', ids);
  if (action === 'show') q = q.in('status', ['hidden', 'damaged']).not('image_path', 'is', null).gt('quantity', 0);
  if (action === 'hide') q = q.in('status', ['available', 'damaged']);
  busy(button, true);
  const { error } = await q;
  if (error) { busy(button, false); return toast(friendlyError(error), true); }
  toast('Updated');
  selected.clear();
  await load();
}

export function sellPanel(picked, done = load) {
  const ok = picked.filter((t) => t.status === 'available');
  const body = openPanel(`
    <h2>Sell in the shop</h2>
    <p class="lead">Records a walk-in sale and takes these toys off the website.</p>
    ${ok.length < picked.length ? `<p class="notice">${picked.length - ok.length} selected toy(s) are not available and were left out.</p>` : ''}
    <table class="table"><tbody>${ok.map((t) => `
      <tr><td>${esc(t.name)}<br><small>${esc(t.code)}</small></td>
      <td style="width:120px"><input type="number" min="0" data-price="${t.id}" value="${effectivePrice(t)}" aria-label="Price"></td></tr>`).join('')}
    </tbody></table>
    <label class="field" style="margin-top:12px"><span>Customer name (optional)</span><input type="text" id="saleName"></label>
    <label class="field"><span>Phone (optional)</span><input type="tel" id="salePhone"></label>
    <p><strong id="saleTotal"></strong></p>
    <div class="row-actions"><button class="btn" id="doSale" ${ok.length ? '' : 'disabled'}>Record sale</button></div>`);
  const total = () => {
    const sum = $$('[data-price]', body).reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
    $('#saleTotal', body).textContent = `Total ${kwacha(sum)}`;
  };
  $$('[data-price]', body).forEach((i) => i.oninput = total);
  total();
  $('#doSale', body).onclick = async (e) => {
    busy(e.target, true, 'Saving…');
    const items = $$('[data-price]', body).map((i) => ({ toy_id: i.dataset.price, qty: 1, price: parseInt(i.value, 10) || 0 }));
    const { data, error } = await supabase.rpc('shop_sale', {
      p_items: items, p_customer_name: $('#saleName', body).value, p_phone: $('#salePhone', body).value,
    });
    if (error) { busy(e.target, false); return toast(friendlyError(error), true); }
    toast(`Sale ${data.code} recorded: ${kwacha(data.total)}`);
    closePanel();
    selected.clear();
    done();
  };
}

function edit(t) {
  const editable = !['reserved', 'sold'].includes(t.status);
  const body = openPanel(`
    <h2>${esc(t.name)} <span class="pill ${t.status}">${STATUS_LABEL[t.status]}</span></h2>
    <img class="preview" src="${esc(imageUrl(t.image_path))}" alt="">
    <div class="field"><span>More photos and video for the shop page</span><div id="mediaBox">${mediaHtml(t)}</div></div>
    <div class="row-actions" style="justify-content:flex-start;margin-bottom:12px">
      <label class="btn ghost small">Replace photo<input type="file" accept="image/*" id="newPhoto" hidden></label>
      ${t.status === 'available' ? '<button class="btn ghost small" id="sellOne">Sell in shop</button>' : ''}
    </div>
    <form id="editForm">
      <label class="field"><span>Small top line on the picture (optional)</span><input type="text" name="tagline" maxlength="30" value="${esc(t.tagline || '')}"></label>
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="40" required value="${esc(t.name)}"></label>
      <div class="field"><span>Boys, girls or neutral</span>${seg('audience', t.audience, [['boys', 'Boys'], ['girls', 'Girls'], ['neutral', 'Neutral']])}</div>
      <div class="field"><span>Condition</span>${seg('condition', t.condition, [['used', 'Used'], ['new', 'New']])}</div>
      <div class="form-grid">
        <label class="field"><span>Price (K)</span><input type="number" name="price" min="0" required value="${t.price}"></label>
        <label class="field"><span>Special price (K)</span><input type="number" name="sale_price" min="0" value="${t.sale_price ?? ''}" placeholder="None"></label>
        <label class="field"><span>How many in stock</span><input type="number" name="quantity" min="0" value="${t.quantity}" ${editable ? '' : 'disabled'}></label>
        <label class="field"><span>Status</span><select name="status" ${editable ? '' : 'disabled'}>
          ${(editable ? ['available', 'review', 'hidden', 'damaged'] : [t.status]).map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select></label>
        <label class="field"><span>Type</span><select name="category"><option value="">—</option>${shared.categories.map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Age</span><select name="age_range"><option value="">—</option>${AGES.map((a) => `<option ${a === t.age_range ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <label class="field"><span>Brand</span><input type="text" name="brand" value="${esc(t.brand || '')}"></label>
        <label class="field"><span>Box</span><select name="box_id"><option value="">No box</option>${shared.boxes.map((b) => `<option ${b.id === t.box_id ? 'selected' : ''}>${esc(b.id)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><input type="checkbox" name="is_special" ${t.is_special ? 'checked' : ''} style="width:auto;min-height:0"> Show in Specials</label>
      <label class="field"><span>Description for customers</span><textarea name="description">${esc(t.description || '')}</textarea></label>
      ${!editable ? `<p class="notice">This toy is ${t.status === 'sold' ? 'sold' : 'on hold for an order'}. Change its order on the Orders page to put it back on sale.</p>` : ''}
      <p class="mt" style="color:var(--muted);font-size:13px">Code ${esc(t.code)}${t.legacy_id ? ` · old ID ${esc(t.legacy_id)}` : ''} · added ${dateLabel(t.created_at)}${t.sold_count ? ` · sold ${t.sold_count}` : ''}</p>
      <div class="row-actions">
        <button type="button" class="btn danger" id="del">Delete</button>
        <button type="submit" class="btn">Save</button>
      </div>
    </form>`, { wide: false });

  const media = $('#mediaBox', body);
  const wireBox = () => wireMedia(media, t, (updated) => {
    Object.assign(t, updated);
    media.innerHTML = mediaHtml(t);
    wireBox();
  });
  wireBox();

  const segVals = { audience: t.audience, condition: t.condition };
  $$('[data-seg]', body).forEach((b) => b.onclick = () => {
    segVals[b.dataset.seg] = b.dataset.value;
    $$(`[data-seg="${b.dataset.seg}"]`, body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  $('#editForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = (k) => (f.get(k) === '' || f.get(k) === null ? null : parseInt(f.get(k), 10));
    const changes = {
      name: String(f.get('name')).trim(),
      tagline: String(f.get('tagline') || '').trim() || null,
      audience: segVals.audience,
      condition: segVals.condition,
      price: num('price') ?? t.price,
      sale_price: num('sale_price'),
      category: f.get('category') || null,
      age_range: f.get('age_range') || null,
      brand: String(f.get('brand') || '').trim() || null,
      box_id: f.get('box_id') || null,
      is_special: f.get('is_special') === 'on',
      description: String(f.get('description') || '').trim() || null,
    };
    if (editable) {
      changes.quantity = num('quantity') ?? t.quantity;
      changes.status = f.get('status');
      if (changes.status === 'available' && changes.quantity === 0) changes.status = 'hidden';
    }
    const btn = e.submitter;
    busy(btn, true, 'Saving…');
    try {
      const reframeNeeded = ['name', 'tagline', 'audience', 'condition'].some((k) => (changes[k] ?? null) !== (t[k] ?? null)) && t.raw_path;
      if (reframeNeeded) await reframe(t, changes);
      else {
        const { error } = await supabase.from('toys').update(changes).eq('id', t.id);
        if (error) throw error;
      }
      toast('Saved');
      closePanel();
      load();
      refreshBadges();
    } catch (err) {
      busy(btn, false);
      toast(friendlyError(err), true);
    }
  };

  $('#newPhoto', body).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const relabel = await confirmBox('Should the AI rename this toy from the new photo? Choose "Go back" to keep the current details.', { ok: 'Yes, rename it' });
    try {
      toast('Updating photo…');
      await replacePhoto(t, file, { relabel });
      toast('Photo updated');
      load();
    } catch (err) {
      toast(friendlyError(err), true);
    }
  };

  $('#sellOne', body)?.addEventListener('click', () => sellPanel([t]));

  $('#del', body).onclick = async () => {
    if (!(await confirmBox(`Delete “${t.name}” for good? Past orders keep their record.`, { ok: 'Delete', danger: true }))) return;
    const { error } = await supabase.from('toys').delete().eq('id', t.id);
    if (error) return toast(friendlyError(error), true);
    deleteToyFiles(t);
    toast('Deleted');
    closePanel();
    load();
  };
}

function exportCsv() {
  const cols = ['code', 'tagline', 'name', 'audience', 'condition', 'category', 'age_range', 'brand', 'price', 'sale_price', 'is_special',
    'quantity', 'status', 'box_id', 'sold_count', 'created_at', 'approved_at', 'sold_at', 'legacy_id', 'description'];
  download(`all-seazons-stock-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(toys.filter(matches), cols));
}

async function importCsv(file) {
  if (!file) return;
  const rows = parseCsv(await file.text());
  if (!rows.length) return toast('That file has no rows.', true);
  const records = rows.map(legacyRowToToy);
  const ok = await confirmBox(`Import ${records.length} toys from “${file.name}”? Available toys arrive on the Review page so you can add photos.`, { ok: 'Import' });
  if (!ok) return;
  const boxIds = [...new Set(records.map((r) => r.box_id).filter(Boolean))].filter((id) => !shared.boxes.some((b) => b.id === id));
  if (boxIds.length) {
    const { error } = await supabase.from('boxes').insert(boxIds.map((id) => ({ id })));
    if (error) return toast(friendlyError(error), true);
  }
  const known = new Set(shared.categories);
  for (const r of records) if (r.category && !known.has(r.category)) r.category = r.category.slice(0, 40);
  for (let i = 0; i < records.length; i += 200) {
    const { error } = await supabase.from('toys').insert(records.slice(i, i + 200));
    if (error) return toast(`Stopped at row ${i + 1}: ${friendlyError(error)}`, true);
  }
  await shared.refresh();
  toast(`Imported ${records.length} toys`);
  load();
  refreshBadges();
}

// The framed pictures (the ones with the brand frame and name) are for
// Facebook, Instagram, WhatsApp status and so on; the website shows the
// plain photos. One zip: 001-name.jpg... plus captions.txt to copy from.
const PACK_MAX = 60;
function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function socialPack(list, button) {
  const ready = list.filter((t) => t.image_path);
  if (!ready.length) return toast('None of these toys has a picture yet.', true);
  if (ready.length > PACK_MAX && !(await confirmBox(`That is ${ready.length} toys. Download the first ${PACK_MAX}? Use the filters or tick toys to choose.`))) return;
  const picks = ready.slice(0, PACK_MAX);
  busy(button, true, 'Making pack…');
  try {
    const files = [];
    const captions = [];
    for (const [i, t] of picks.entries()) {
      const res = await fetch(imageUrl(t.image_path));
      if (!res.ok) throw new Error(`The picture of ${t.name} could not be downloaded.`);
      const num = String(i + 1).padStart(3, '0');
      const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      files.push({ name: `${num}-${slug || 'toy'}.jpg`, data: new Uint8Array(await res.arrayBuffer()) });
      const link = new URL(`../#${encodeURIComponent(t.code)}`, location.href).href;
      captions.push([`${num}. ${t.name}${t.tagline ? ` (${t.tagline})` : ''}`,
        `${kwacha(effectivePrice(t))} · ${CONDITIONS[t.condition]}${t.age_range ? ` · ${t.age_range} yrs` : ''}`,
        t.description || '', `Order: ${link}`].filter(Boolean).join('\n'));
    }
    const text = captions.join('\n\n') + '\n';
    // On a phone a zip is hard to open: save each picture on its own, so it
    // lands in the gallery ready to post, and put the captions on the clipboard.
    if (window.matchMedia('(pointer: coarse)').matches) {
      for (const f of files) {
        saveBlob(f.name, new Blob([f.data], { type: 'image/jpeg' }));
        await new Promise((r) => setTimeout(r, 350));
      }
      saveBlob('captions.txt', new Blob([text], { type: 'text/plain' }));
      try { await navigator.clipboard.writeText(text); } catch { /* not allowed: captions.txt is saved too */ }
      toast(`${picks.length} pictures saved. Captions copied.`);
      return;
    }
    files.push({ name: 'captions.txt', data: text });
    saveBlob(`social-media-pack-${new Date().toISOString().slice(0, 10)}.zip`, makeZip(files));
    toast(`${picks.length} pictures ready to post`);
  } catch (e) {
    toast(friendlyError(e), true);
  } finally {
    busy(button, false);
  }
}
