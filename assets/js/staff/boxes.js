import { esc, kwacha } from '../lib.js';
import { supabase, friendlyError } from '../db.js';
import { shared } from './app.js';
import { $, toast, openPanel, closePanel, confirmBox, busy } from './ui.js';

let root = null;

export async function show(main) {
  root = main;
  await shared.refresh();
  const [{ data: toys }, { data: sold }] = await Promise.all([
    supabase.from('toys').select('id, box_id, status, price, sale_price, quantity, sold_count').not('box_id', 'is', null),
    supabase.from('order_items').select('price, qty, toy_id, toys!inner(box_id), orders!inner(status)')
      .in('orders.status', ['paid', 'packed', 'sent', 'delivered']).not('toys.box_id', 'is', null),
  ]);
  const stats = {};
  for (const b of shared.boxes) stats[b.id] = { toys: 0, inShop: 0, sold: 0, revenue: 0 };
  for (const t of toys || []) {
    const s = stats[t.box_id];
    if (!s) continue;
    s.toys += Math.max(t.quantity, 0) + t.sold_count;
    if (['available', 'reserved'].includes(t.status)) s.inShop += t.quantity;
  }
  for (const it of sold || []) {
    const s = stats[it.toys.box_id];
    if (!s) continue;
    s.sold += it.qty;
    s.revenue += it.price * it.qty;
  }
  render(stats);
}
export function leave() { root = null; }

function render(stats) {
  if (!root) return;
  root.innerHTML = `
    <div class="page-head"><h1>Boxes</h1><button class="btn" id="newBox">New box</button></div>
    <p class="lead">Each bulk purchase. Cost per toy uses the number of toys counted in the box (or the expected number until you add them).</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Box</th><th>Bought</th><th>Total cost</th><th>Toys</th><th>Cost per toy</th><th>Sold</th><th>Sales</th><th>Profit so far</th></tr></thead>
      <tbody>${shared.boxes.map((b) => {
        const s = stats[b.id] || { toys: 0, sold: 0, revenue: 0, inShop: 0 };
        const cost = Number(b.cost) + Number(b.delivery) + Number(b.other);
        const count = s.toys || b.expected_count || 0;
        return `<tr data-box="${esc(b.id)}" style="cursor:pointer">
          <td><strong>${esc(b.id)}</strong><br><small>${esc(b.supplier || '')}</small></td>
          <td>${esc(b.purchased_on || '')}</td>
          <td>${kwacha(cost)}</td>
          <td>${s.toys}${b.expected_count ? ` / ${b.expected_count}` : ''}</td>
          <td>${count ? kwacha(cost / count) : '—'}</td>
          <td>${s.sold} <small>(${s.inShop} in shop)</small></td>
          <td>${kwacha(s.revenue)}</td>
          <td style="color:${s.revenue - cost >= 0 ? 'var(--ok)' : 'var(--bad)'}"><strong>${kwacha(s.revenue - cost)}</strong></td>
        </tr>`;
      }).join('') || '<tr><td colspan="8">No boxes yet.</td></tr>'}</tbody>
    </table></div>`;
  $('#newBox', root).onclick = () => edit(null);
  root.querySelectorAll('[data-box]').forEach((r) => r.onclick = () => edit(shared.boxes.find((b) => b.id === r.dataset.box)));
}

function edit(box) {
  const b = box || { id: nextId(), purchased_on: new Date().toISOString().slice(0, 10), cost: 0, delivery: 0, other: 0 };
  const body = openPanel(`
    <h2>${box ? 'Edit box' : 'New box'}</h2>
    <form id="boxForm">
      <div class="form-grid">
        <label class="field"><span>Box ID</span><input type="text" name="id" required value="${esc(b.id)}" ${box ? 'readonly' : ''}></label>
        <label class="field"><span>Date bought</span><input type="date" name="purchased_on" value="${esc(b.purchased_on || '')}"></label>
        <label class="field"><span>Supplier / market</span><input type="text" name="supplier" value="${esc(b.supplier || '')}" placeholder="Kamwala Market"></label>
        <label class="field"><span>Expected number of toys</span><input type="number" name="expected_count" min="0" value="${b.expected_count ?? ''}"></label>
        <label class="field"><span>Purchase cost (K)</span><input type="number" name="cost" min="0" step="0.01" value="${b.cost}"></label>
        <label class="field"><span>Delivery cost (K)</span><input type="number" name="delivery" min="0" step="0.01" value="${b.delivery}"></label>
        <label class="field"><span>Other costs (K)</span><input type="number" name="other" min="0" step="0.01" value="${b.other}"></label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes">${esc(b.notes || '')}</textarea></label>
      <div class="row-actions">
        ${box ? '<button type="button" class="btn danger" id="delBox">Delete</button>' : ''}
        <button class="btn" type="submit">Save</button>
      </div>
    </form>`);
  $('#boxForm', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rec = {
      id: f.id.trim(), purchased_on: f.purchased_on || null, supplier: f.supplier.trim() || null,
      expected_count: f.expected_count ? parseInt(f.expected_count, 10) : null,
      cost: Number(f.cost) || 0, delivery: Number(f.delivery) || 0, other: Number(f.other) || 0, notes: f.notes.trim() || null,
    };
    busy(e.submitter, true);
    const { error } = box ? await supabase.from('boxes').update(rec).eq('id', box.id) : await supabase.from('boxes').insert(rec);
    if (error) { busy(e.submitter, false); return toast(friendlyError(error), true); }
    toast('Saved');
    closePanel();
    show(root);
  };
  $('#delBox', body)?.addEventListener('click', async () => {
    if (!(await confirmBox(`Delete box ${box.id}? Its toys stay in stock without a box.`, { ok: 'Delete', danger: true }))) return;
    const { error } = await supabase.from('boxes').delete().eq('id', box.id);
    if (error) return toast(friendlyError(error), true);
    closePanel();
    show(root);
  });
}

function nextId() {
  const nums = shared.boxes.map((b) => parseInt(String(b.id).replace(/\D/g, ''), 10)).filter((n) => n >= 0);
  return 'BOX-' + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
}
