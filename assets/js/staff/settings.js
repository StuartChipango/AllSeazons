import { esc, kwacha } from '../lib.js';
import { supabase, friendlyError } from '../db.js';
import { shared, can, ROLE_LABELS } from './app.js';
import { $, $$, toast, confirmBox, busy } from './ui.js';

let root = null;

export async function show(main) {
  root = main;
  if (!can('owner')) {
    root.innerHTML = `<div class="page-head"><h1>My account</h1></div>${accountHtml()}`;
    wireAccount();
    return;
  }
  await shared.refresh();
  const [towns, staff, activity] = await Promise.all([
    supabase.from('towns').select('*').order('name'),
    supabase.from('staff').select('*').order('created_at'),
    supabase.from('activity').select('*').order('at', { ascending: false }).limit(60),
  ]);
  render(towns.data || [], staff.data || [], activity.data || []);
}
export function leave() { root = null; }

const signIn = (m) => m.login || m.email;
const ROLE_HELP = {
  owner: 'Everything, including settings, prices, staff and refunds',
  stock: 'Photos, review, stock and boxes',
  sales: 'Orders, shop sales and receipts',
};
const roleBoxes = (roles = [], prefix = '') => Object.entries(ROLE_LABELS).map(([r, label]) => `
  <label class="role-pick"><input type="checkbox" value="${r}" data-role${prefix} ${roles.includes(r) ? 'checked' : ''}>
    <span><b>${label}</b><small>${ROLE_HELP[r]}</small></span></label>`).join('');

function accountHtml() {
  const me = shared.me;
  return `
    <section class="settings-section card-box">
      <h2>My account</h2>
      <p class="lead" style="margin:0 0 10px">${esc(me.name || me.email)}, signed in as <b>${esc(signIn(me))}</b>. Jobs: ${me.roles.map((r) => ROLE_LABELS[r]).join(', ')}.</p>
      <form id="myPassword" class="row-actions" style="justify-content:flex-start">
        <input type="password" name="pw" minlength="6" autocomplete="new-password" placeholder="New password" required style="max-width:220px">
        <button class="btn small" type="submit">Change my password</button>
      </form>
      <div class="row-actions" style="justify-content:flex-start;margin-top:8px"><button class="btn small ghost" id="signOutHere" type="button">Sign out (switch person)</button></div>
    </section>`;
}

function wireAccount() {
  $('#signOutHere', root).onclick = () => document.getElementById('signOut').click();
  $('#myPassword', root).onsubmit = async (e) => {
    e.preventDefault();
    const pw = e.target.pw.value;
    busy(e.submitter, true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    busy(e.submitter, false);
    if (error) return toast(friendlyError(error), true);
    e.target.reset();
    toast('Password changed');
  };
}

function when(at) {
  const d = new Date(at);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function teamHtml(staff) {
  return `
    <section class="settings-section card-box" id="team">
      <h2>Team</h2>
      <p class="lead" style="margin:0 0 12px">Everyone who can use this app, and what they can do. Switch someone off straight away if their phone is lost.</p>
      <div class="team-list">${staff.map((m) => `
        <article class="team-card ${m.active ? '' : 'is-off'}" data-staff="${esc(m.email)}">
          <div class="team-head">
            <div><b>${esc(m.name || m.email)}</b><small>Signs in as <b>${esc(signIn(m))}</b>${m.active ? '' : ' · switched off'}</small></div>
            <label class="switch"><input type="checkbox" data-active ${m.active ? 'checked' : ''}><span>${m.active ? 'On' : 'Off'}</span></label>
          </div>
          <div class="role-list">${roleBoxes(m.roles)}</div>
          <div class="row-actions" style="justify-content:flex-start">
            <input type="password" data-pw minlength="6" autocomplete="new-password" placeholder="New password" style="max-width:180px">
            <button class="btn small ghost" data-act="pw">Set password</button>
            <button class="btn small danger" data-act="remove">Remove</button>
          </div>
        </article>`).join('')}</div>

      <form class="team-card team-add" id="addStaff">
        <h3>Add a person</h3>
        <div class="form-grid">
          <label class="field"><span>Name</span><input type="text" name="name" required placeholder="e.g. Mutale"></label>
          <label class="field"><span>Sign-in name or email</span><input type="text" name="login" required autocapitalize="none" autocomplete="off" placeholder="e.g. mutale"><small>A short name is fine. No email needed.</small></label>
          <label class="field"><span>Password</span><input type="text" name="password" minlength="6" required autocomplete="off" placeholder="At least 6 characters"><small>Tell them this. They can change it later.</small></label>
        </div>
        <div class="role-list">${roleBoxes(['stock'], '-new')}</div>
        <div class="row-actions"><button class="btn" type="submit">Add person</button></div>
      </form>
    </section>`;
}

function activityHtml(activity, staff) {
  const names = [...new Map(activity.map((a) => [a.actor, a.actor_name || a.actor])).entries()];
  return `
    <section class="settings-section card-box" id="activity">
      <h2>Who did what</h2>
      <div class="row-actions" style="justify-content:flex-start;margin-bottom:8px">
        <select id="actFilter" style="max-width:220px"><option value="">Everyone</option>${names.map(([e, n]) => `<option value="${esc(e)}">${esc(n)}</option>`).join('')}</select>
      </div>
      ${activity.length ? `<ul class="activity">${activity.map((a) => `
        <li data-actor="${esc(a.actor)}"><time>${when(a.at)}</time><b>${esc(a.actor_name || a.actor)}</b><span>${esc(a.summary)}</span></li>`).join('')}</ul>`
        : '<p class="lead" style="margin:0">Nothing yet. Approvals, price changes, sales and order updates appear here.</p>'}
    </section>`;
}

function render(towns, staff, activity) {
  const s = shared.settings;
  root.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    ${accountHtml()}
    ${teamHtml(staff)}
    ${activityHtml(activity, staff)}

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

  wireAccount();
  wireTeam(run);
}

function wireTeam(run) {
  const picked = (el, attr) => $$(`[${attr}]`, el).filter((x) => x.checked).map((x) => x.value);

  $('#addStaff', root).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const roles = picked(e.target, 'data-role-new');
    if (!roles.length) return toast('Pick at least one job.', true);
    busy(e.submitter, true);
    const { data, error } = await supabase.rpc('staff_add', { p_name: f.name, p_login: f.login, p_password: f.password, p_roles: roles });
    busy(e.submitter, false);
    if (error) return toast(friendlyError(error), true);
    toast(`${data.name} can now sign in as ${data.login || data.email}`);
    show(root);
  };

  $$('[data-staff]', root).forEach((card) => {
    const email = card.dataset.staff;
    const name = $('b', card).textContent;
    $$('[data-role]', card).forEach((b) => b.onchange = () => {
      const roles = picked(card, 'data-role');
      if (!roles.length) { b.checked = true; return toast('Everyone needs at least one job.', true); }
      run(supabase.rpc('staff_update', { p_email: email, p_roles: roles }), `${name}: ${roles.map((r) => ROLE_LABELS[r]).join(', ')}`);
    });
    $('[data-active]', card).onchange = async (e) => {
      const on = e.target.checked;
      if (!on && !(await confirmBox(`Switch off ${name}? They are signed out on every phone straight away.`, { ok: 'Switch off', danger: true }))) {
        e.target.checked = true;
        return;
      }
      run(supabase.rpc('staff_update', { p_email: email, p_active: on }), on ? `${name} is switched on` : `${name} is switched off`);
    };
    $('[data-act="pw"]', card).onclick = () => {
      const pw = $('[data-pw]', card).value;
      if (pw.length < 6) return toast('The password needs at least 6 characters.', true);
      run(supabase.rpc('staff_set_password', { p_email: email, p_password: pw }), `New password set for ${name}`);
    };
    $('[data-act="remove"]', card).onclick = async () => {
      if (await confirmBox(`Remove ${name} from the team? They can no longer sign in.`, { ok: 'Remove', danger: true })) {
        run(supabase.rpc('staff_remove', { p_email: email }), `${name} removed`);
      }
    };
  });

  $('#actFilter', root).onchange = (e) => {
    $$('.activity li', root).forEach((li) => { li.hidden = !!e.target.value && li.dataset.actor !== e.target.value; });
  };
}
