import { esc, kwacha } from '../lib.js';
import { supabase, friendlyError } from '../db.js';
import { shared } from './app.js';
import { $, $$, toast, confirmBox, busy } from './ui.js';

let root = null;

export async function show(main) {
  root = main;
  await shared.refresh();
  const [towns, staff] = await Promise.all([
    supabase.from('towns').select('*').order('name'),
    supabase.from('staff').select('*').order('created_at'),
  ]);
  render(towns.data || [], staff.data || []);
}
export function leave() { root = null; }

function render(towns, staff) {
  const s = shared.settings;
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <section class="settings-section card-box">
      <h2>Shop</h2>
      <form id="shopForm">
        <div class="form-grid">
          <label class="field"><span>WhatsApp Business number</span><input type="tel" name="whatsapp_number" required value="${esc(s.whatsapp_number)}"><small>Orders are sent here. Example: 0977 123 456</small></label>
          <label class="field"><span>Hold toys for (minutes)</span><input type="number" name="hold_minutes" min="10" max="10080" value="${s.hold_minutes}"><small>After checkout, before the order lapses.</small></label>
          <label class="field"><span>Medium parcel from (items)</span><input type="number" name="medium_from" min="2" value="${s.medium_from}"></label>
          <label class="field"><span>Large parcel from (items)</span><input type="number" name="large_from" min="3" value="${s.large_from}"></label>
          <label class="field"><span>Packaging fee (K)</span><input type="number" name="packaging_fee" min="0" value="${s.packaging_fee ?? 40}"><small>Added to every courier fee: packaging and the rider to the courier office.</small></label>
          <label class="field"><span>Weekly sales goal (K)</span><input type="number" name="weekly_goal" min="0" value="${s.weekly_goal}"></label>
        </div>
        <label class="field"><span>Banner at the top of the shop (optional)</span><input type="text" name="announcement" value="${esc(s.announcement || '')}" placeholder="New toys every Friday!"></label>
        <label class="field"><span>Pickup note (Lusaka)</span><input type="text" name="pickup_note" value="${esc(s.pickup_note)}"></label>
        <label class="field"><span>Yango note</span><input type="text" name="yango_note" value="${esc(s.yango_note)}"></label>
        <label class="field"><span>Courier note (out of town)</span><input type="text" name="courier_note" value="${esc(s.courier_note)}"></label>
        <div class="row-actions"><button class="btn" type="submit">Save shop settings</button></div>
      </form>
    </section>

    <section class="settings-section card-box">
      <h2>Price tiers</h2>
      <p class="lead" style="margin:0 0 10px">The prices you pick when adding toys, and the price filters in the shop.</p>
      <div class="tiers">${shared.tiers.map((p) => `<span class="chip">${kwacha(p)}<button data-del-tier="${p}" aria-label="Remove ${kwacha(p)}">×</button></span>`).join('')}
        <input type="number" id="newTier" min="1" placeholder="Add price" style="width:120px;min-height:36px"><button class="btn small" id="addTier">Add</button></div>
    </section>

    <section class="settings-section card-box">
      <h2>Out-of-town towns and courier fees</h2>
      <p class="lead" style="margin:0 0 10px">Enter the courier’s own price; the packaging fee above is added on top. Leave a fee empty and the customer sees “fee confirmed on WhatsApp”. Parcel size comes from the number of items.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Town</th><th>Courier</th><th>Small (K)</th><th>Medium (K)</th><th>Large (K)</th><th>Show</th><th></th></tr></thead>
        <tbody>${towns.map((t) => `
          <tr data-town="${t.id}">
            <td><input type="text" data-k="name" value="${esc(t.name)}"></td>
            <td><input type="text" data-k="courier" value="${esc(t.courier || '')}" placeholder="e.g. Mazhandu"></td>
            <td><input type="number" min="0" data-k="fee_small" value="${t.fee_small ?? ''}" style="width:90px"></td>
            <td><input type="number" min="0" data-k="fee_medium" value="${t.fee_medium ?? ''}" style="width:90px"></td>
            <td><input type="number" min="0" data-k="fee_large" value="${t.fee_large ?? ''}" style="width:90px"></td>
            <td><input type="checkbox" data-k="active" ${t.active ? 'checked' : ''} style="width:20px;height:20px"></td>
            <td><button class="btn small danger" data-del-town="${t.id}">Remove</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="row-actions" style="margin-top:10px">
        <input type="text" id="newTown" placeholder="New town" style="max-width:220px"><button class="btn small ghost" id="addTown">Add town</button>
        <button class="btn" id="saveTowns">Save towns</button>
      </div>
    </section>

    <section class="settings-section card-box">
      <h2>Types of toy</h2>
      <div class="tiers">${shared.categories.map((c) => `<span class="chip">${esc(c)}<button data-del-cat="${esc(c)}" aria-label="Remove ${esc(c)}">×</button></span>`).join('')}
        <input type="text" id="newCat" placeholder="Add a type" style="width:180px;min-height:36px"><button class="btn small" id="addCat">Add</button></div>
    </section>

    <section class="settings-section card-box">
      <h2>Staff</h2>
      <p class="lead" style="margin:0 0 10px">People who can sign in here. First create their login in Supabase (Authentication &gt; Users &gt; Add user), then add the same email below.</p>
      <ul>${staff.map((m) => `<li>${esc(m.email)}${m.name ? ` (${esc(m.name)})` : ''} ${staff.length > 1 ? `<button class="linkish" data-del-staff="${esc(m.email)}">remove</button>` : ''}</li>`).join('')}</ul>
      <div class="row-actions" style="justify-content:flex-start">
        <input type="email" id="newStaff" placeholder="email@example.com" style="max-width:260px"><input type="text" id="newStaffName" placeholder="Name" style="max-width:160px"><button class="btn small" id="addStaff">Add staff</button>
      </div>
    </section>`;
  wire();
}

function wire() {
  $('#shopForm', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rec = {
      whatsapp_number: f.whatsapp_number.trim(), hold_minutes: parseInt(f.hold_minutes, 10),
      medium_from: parseInt(f.medium_from, 10), large_from: parseInt(f.large_from, 10),
      weekly_goal: parseInt(f.weekly_goal, 10) || 0, packaging_fee: Math.max(0, parseInt(f.packaging_fee, 10) || 0), announcement: f.announcement.trim() || null,
      pickup_note: f.pickup_note.trim(), yango_note: f.yango_note.trim(), courier_note: f.courier_note.trim(),
      updated_at: new Date().toISOString(),
    };
    if (rec.large_from <= rec.medium_from) return toast('Large parcels must start above medium.', true);
    busy(e.submitter, true);
    const { error } = await supabase.from('settings').update(rec).eq('id', 1);
    busy(e.submitter, false);
    if (error) return toast(friendlyError(error), true);
    toast('Shop settings saved');
    shared.refresh();
  };

  const run = async (promise, msg) => {
    const { error } = await promise;
    if (error) return toast(friendlyError(error), true);
    if (msg) toast(msg);
    show(root);
  };

  $('#addTier', root).onclick = () => {
    const v = parseInt($('#newTier', root).value, 10);
    if (v > 0) run(supabase.from('price_tiers').insert({ price: v }), `Added ${kwacha(v)}`);
  };
  $$('[data-del-tier]', root).forEach((b) => b.onclick = () => run(supabase.from('price_tiers').delete().eq('price', b.dataset.delTier)));

  $('#addCat', root).onclick = () => {
    const v = $('#newCat', root).value.trim();
    if (v) run(supabase.from('categories').insert({ name: v, sort: shared.categories.length + 1 }), `Added ${v}`);
  };
  $$('[data-del-cat]', root).forEach((b) => b.onclick = () => run(supabase.from('categories').delete().eq('name', b.dataset.delCat)));

  $('#addTown', root).onclick = () => {
    const v = $('#newTown', root).value.trim();
    if (v) run(supabase.from('towns').insert({ name: v }), `Added ${v}`);
  };
  $$('[data-del-town]', root).forEach((b) => b.onclick = async () => {
    if (await confirmBox('Remove this town? Customers will not be able to choose it.', { ok: 'Remove', danger: true })) {
      run(supabase.from('towns').delete().eq('id', b.dataset.delTown));
    }
  });
  $('#saveTowns', root).onclick = async (e) => {
    const rows = $$('[data-town]', root).map((tr) => {
      const v = (k) => tr.querySelector(`[data-k="${k}"]`);
      const fee = (k) => (v(k).value === '' ? null : parseInt(v(k).value, 10));
      return {
        id: Number(tr.dataset.town), name: v('name').value.trim(), courier: v('courier').value.trim() || null,
        fee_small: fee('fee_small'), fee_medium: fee('fee_medium'), fee_large: fee('fee_large'), active: v('active').checked,
      };
    });
    busy(e.target, true);
    const { error } = await supabase.from('towns').upsert(rows);
    busy(e.target, false);
    if (error) return toast(friendlyError(error), true);
    toast('Towns saved');
  };

  $('#addStaff', root).onclick = () => {
    const email = $('#newStaff', root).value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email.', true);
    run(supabase.from('staff').insert({ email, name: $('#newStaffName', root).value.trim() || null }), `${email} can now sign in`);
  };
  $$('[data-del-staff]', root).forEach((b) => b.onclick = async () => {
    if (await confirmBox(`Remove ${b.dataset.delStaff} from staff?`, { ok: 'Remove', danger: true })) {
      run(supabase.from('staff').delete().eq('email', b.dataset.delStaff));
    }
  });
}
