import { esc, kwacha, AGES } from '../lib.js';
import { supabase, imageUrl, friendlyError } from '../db.js';
import { shared, refreshBadges } from './app.js';
import { $, $$, toast, seg, confirmBox, busy } from './ui.js';
import { reframe, replacePhoto, deleteToyFiles, relabel } from './photos.js';

let root = null;
let toys = [];

export async function show(main) {
  root = main;
  const { data, error } = await supabase.from('toys').select('*').eq('status', 'review').order('created_at');
  if (error) throw error;
  toys = data;
  render();
}

export function leave() { root = null; }

function card(t) {
  const priceOptions = [...new Set([...shared.tiers, t.price])].sort((a, b) => a - b);
  const ai = t.ai_labels || {};
  const flag = ai.error ? `AI could not name this one (${esc(ai.error)}). Please type the name.`
    : t.needs_attention ? `Not sure about this one. Please check the name.${ai.alternatives?.length ? ` It might also be: ${esc(ai.alternatives.join(', '))}.` : ''}` : '';
  return `
    <article class="rcard ${t.needs_attention ? 'attn' : ''}" data-id="${t.id}">
      <div class="pic"><img src="${esc(imageUrl(t.image_path))}" alt="${esc(t.name)}" loading="lazy"></div>
      <div class="body">
        ${t.image_path ? '' : '<label class="btn soft small">Add a photo<input type="file" accept="image/*" data-f="photo" hidden></label>'}
        ${flag ? `<div class="flag">${flag}</div>` : ''}
        ${ai.error && t.raw_path ? '<button class="btn soft small" data-act="ai">Try AI again</button>' : ''}
        <label class="field"><span>Small top line (optional)</span><input type="text" data-f="tagline" value="${esc(t.tagline || '')}" maxlength="30" placeholder="e.g. Big &amp; Small"></label>
        <label class="field"><span>Name</span><input type="text" data-f="name" value="${esc(t.name)}" maxlength="40"></label>
        ${seg('audience', t.audience, [['boys', 'Boys'], ['girls', 'Girls'], ['neutral', 'Neutral']])}
        ${seg('condition', t.condition, [['used', 'Used'], ['new', 'New']])}
        <div class="mini">
          <label class="field"><span>Price</span><select data-f="price">${priceOptions.map((p) => `<option value="${p}" ${p === t.price ? 'selected' : ''}>${kwacha(p)}</option>`).join('')}<option value="other">Other…</option></select></label>
          <label class="field"><span>How many</span><input type="number" min="1" data-f="quantity" value="${t.quantity}"></label>
          <label class="field"><span>Type</span><select data-f="category"><option value="">—</option>${shared.categories.map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Age</span><select data-f="age_range"><option value="">—</option>${AGES.map((a) => `<option ${a === t.age_range ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        </div>
        <div class="row-actions">
          <button class="btn danger small" data-act="delete">Delete</button>
          <button class="btn small" data-act="approve">Approve</button>
        </div>
      </div>
    </article>`;
}

function render() {
  if (!root) return;
  root.innerHTML = `
    <div class="page-head">
      <h1>Review</h1>
      ${unnamed().length ? `<button class="btn soft" id="aiAll">Try AI again for ${unnamed().length}</button>` : ''}
      ${toys.length ? `<button class="btn" id="approveAll">Approve all ${toys.length}</button>` : ''}
    </div>
    <p class="lead">Check each picture. Fix the name, Boys/Girls/Neutral or Used/New and the picture redraws itself. Approved toys appear in the shop straight away.</p>
    ${toys.length ? `<div class="review-grid">${toys.map(card).join('')}</div>`
      : `<div class="card-box"><p>Nothing waiting for review.</p><a class="btn" href="#upload">Add toys</a></div>`}`;
  wire();
}

function find(id) { return toys.find((t) => t.id === id); }
const unnamed = () => toys.filter((t) => t.ai_labels?.error && t.raw_path);

// One toy at a time, so the free AI's per-minute limit is not hit.
async function retryAI(t, cardEl) {
  cardEl?.querySelector('.pic')?.insertAdjacentHTML('beforeend', '<div class="working">AI is naming…</div>');
  try {
    Object.assign(t, await relabel(t));
  } catch (e) {
    t.ai_labels = { ...(t.ai_labels || {}), error: e.message };
    toast(`${t.name}: ${e.message}`, true);
  }
}

async function save(t, changes, el) {
  const needsFrame = ['name', 'tagline', 'audience', 'condition'].some((k) => k in changes && changes[k] !== t[k]);
  const cardEl = el.closest('.rcard');
  const pic = cardEl.querySelector('.pic');
  try {
    let updated;
    if (needsFrame) {
      pic.insertAdjacentHTML('beforeend', '<div class="working">Redrawing…</div>');
      updated = await reframe(t, { ...changes, needs_attention: false });
    } else {
      const { data, error } = await supabase.from('toys').update(changes).eq('id', t.id).select().single();
      if (error) throw error;
      updated = data;
    }
    Object.assign(t, updated);
    if (needsFrame) {
      cardEl.outerHTML = card(t);
      wire();
    }
  } catch (e) {
    toast(friendlyError(e), true);
    pic.querySelector('.working')?.remove();
  }
}

function wire() {
  if (!root) return;
  $('#approveAll', root)?.addEventListener('click', async (e) => {
    const attention = toys.filter((t) => t.needs_attention).length;
    if (attention && !(await confirmBox(`${attention} toy${attention > 1 ? 's are' : ' is'} marked for checking. Approve everything anyway?`, { ok: 'Approve all' }))) return;
    busy(e.target, true, 'Approving…');
    const { data, error } = await supabase.rpc('approve_toys', { p_ids: toys.map((t) => t.id) });
    if (error) { busy(e.target, false); return toast(friendlyError(error), true); }
    toast(`${data} toys are now in the shop`);
    show(root);
    refreshBadges();
  });

  $('#aiAll', root)?.addEventListener('click', async (e) => {
    busy(e.target, true, 'AI is naming…');
    for (const t of unnamed()) await retryAI(t, root?.querySelector(`.rcard[data-id="${t.id}"]`));
    render();
  });

  $$('.rcard', root).forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    const t = find(el.dataset.id);
    el.querySelector('[data-f="name"]').addEventListener('change', (e) => {
      const name = e.target.value.trim();
      if (name) save(t, { name }, e.target);
    });
    el.querySelector('[data-f="tagline"]').addEventListener('change', (e) => {
      save(t, { tagline: e.target.value.trim() || null }, e.target);
    });
    $$('[data-seg]', el).forEach((b) => b.addEventListener('click', () => {
      if (t[b.dataset.seg] === b.dataset.value) return;
      $$(`[data-seg="${b.dataset.seg}"]`, el).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      save(t, { [b.dataset.seg]: b.dataset.value }, b);
    }));
    el.querySelector('[data-f="price"]').addEventListener('change', (e) => {
      let v = e.target.value;
      if (v === 'other') {
        v = prompt('Price in kwacha', t.price);
        if (!v || !(parseInt(v, 10) > 0)) { e.target.value = t.price; return; }
      }
      save(t, { price: parseInt(v, 10) }, e.target);
    });
    el.querySelector('[data-f="quantity"]').addEventListener('change', (e) => save(t, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }, e.target));
    el.querySelector('[data-f="category"]').addEventListener('change', (e) => save(t, { category: e.target.value || null }, e.target));
    el.querySelector('[data-f="age_range"]').addEventListener('change', (e) => save(t, { age_range: e.target.value || null }, e.target));
    el.querySelector('[data-f="photo"]')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      el.querySelector('.pic').insertAdjacentHTML('beforeend', '<div class="working">Adding photo…</div>');
      try {
        Object.assign(t, await replacePhoto(t, file));
        el.outerHTML = card(t);
        wire();
      } catch (err) {
        toast(friendlyError(err), true);
        el.querySelector('.working')?.remove();
      }
    });
    el.querySelector('[data-act="ai"]')?.addEventListener('click', async (e) => {
      busy(e.target, true, 'AI is naming…');
      await retryAI(t, el);
      render();
    });
    el.querySelector('[data-act="approve"]').addEventListener('click', async (e) => {
      busy(e.target, true);
      const { data, error } = await supabase.rpc('approve_toys', { p_ids: [t.id] });
      if (error || !data) { busy(e.target, false); return toast(error ? friendlyError(error) : 'Could not approve this toy.', true); }
      toys = toys.filter((x) => x.id !== t.id);
      toast(`${t.name} is in the shop`);
      render();
      refreshBadges();
    });
    el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!(await confirmBox(`Delete “${t.name}”? The photo is removed too.`, { ok: 'Delete', danger: true }))) return;
      const { error } = await supabase.from('toys').delete().eq('id', t.id);
      if (error) return toast(friendlyError(error), true);
      deleteToyFiles(t);
      toys = toys.filter((x) => x.id !== t.id);
      render();
      refreshBadges();
    });
  });
}
