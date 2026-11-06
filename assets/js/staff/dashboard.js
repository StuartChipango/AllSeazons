import { esc, kwacha, AUDIENCES } from '../lib.js';
import { supabase, imageUrl } from '../db.js';
import { shared } from './app.js';

function weekStart() {
  // Monday 00:00 in Lusaka (UTC+2, no daylight saving).
  const now = new Date(Date.now() + 2 * 3600e3);
  const day = (now.getUTCDay() + 6) % 7;
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day);
  return new Date(monday - 2 * 3600e3).toISOString();
}

function bars(rows, color = 'var(--blue)') {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars">${rows.map(([label, n]) => `
    <div class="bar"><span>${esc(label)}</span><i style="width:${Math.max(4, (n / max) * 100)}%;background:${color}"></i><b>${n}</b></div>`).join('') || '<p class="sub">Nothing yet.</p>'}</div>`;
}

function countBy(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = typeof key === 'function' ? key(x) : x[key];
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + (x.qty || 1));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export async function show(main) {
  const since = weekStart();
  const sixty = new Date(Date.now() - 60 * 86400e3).toISOString();
  const [week, open, toPack, live, review, soldItems, slow] = await Promise.all([
    supabase.from('orders').select('total, channel').in('status', ['paid', 'packed', 'sent', 'delivered']).gte('paid_at', since),
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['held', 'confirmed']),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
    supabase.from('toys').select('id', { count: 'exact', head: true }).eq('status', 'available'),
    supabase.from('toys').select('id', { count: 'exact', head: true }).eq('status', 'review'),
    supabase.from('order_items').select('name, qty, price, toys(category, audience, condition), orders!inner(status, paid_at)')
      .in('orders.status', ['paid', 'packed', 'sent', 'delivered']).order('id', { ascending: false }).limit(2000),
    supabase.from('toys').select('id, name, code, price, image_path, approved_at').eq('status', 'available')
      .lt('approved_at', sixty).order('approved_at').limit(12),
  ]);

  const sales = (week.data || []).reduce((s, o) => s + o.total, 0);
  const goal = shared.settings?.weekly_goal || 0;
  const items = soldItems.data || [];
  const byCategory = countBy(items, (x) => x.toys?.category || 'Not set').slice(0, 8);
  const byAudience = countBy(items, (x) => AUDIENCES[x.toys?.audience]?.label);
  const byCondition = countBy(items, (x) => (x.toys?.condition === 'new' ? 'New' : x.toys ? 'Used' : null));
  const byName = countBy(items, (x) => x.name.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())).filter(([, n]) => n > 1).slice(0, 10);
  const byPrice = countBy(items, (x) => kwacha(x.price)).sort((a, b) => parseInt(a[0].slice(1).replace(/,/g, ''), 10) - parseInt(b[0].slice(1).replace(/,/g, ''), 10));

  main.innerHTML = `
    <div class="page-head"><h1>Home</h1><a class="btn" href="#upload">Add toys</a></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Sales this week</div><div class="n">${kwacha(sales)}</div>
        ${goal ? `<div class="progress" title="Goal ${kwacha(goal)}"><span style="width:${Math.min(100, (sales / goal) * 100)}%"></span></div><div class="l">${Math.round((sales / goal) * 100)}% of ${kwacha(goal)} goal</div>` : ''}</div>
      <a class="kpi" href="#orders"><div class="l">Orders to confirm</div><div class="n">${open.count ?? 0}</div></a>
      <a class="kpi" href="#orders"><div class="l">Paid, to pack</div><div class="n">${toPack.count ?? 0}</div></a>
      <a class="kpi" href="#review"><div class="l">Waiting for review</div><div class="n">${review.count ?? 0}</div></a>
      <a class="kpi" href="#stock"><div class="l">Toys in the shop</div><div class="n">${live.count ?? 0}</div></a>
    </div>
    <div class="two">
      <section class="card-box"><h2>What sells: type of toy</h2><p class="sub">All sales so far</p>${bars(byCategory)}</section>
      <section class="card-box"><h2>Boys, girls or neutral</h2><p class="sub">Toys sold</p>${bars(byAudience, 'var(--pink-strong)')}
        <h2 style="margin-top:14px">Used or new</h2>${bars(byCondition, 'var(--green)')}</section>
      <section class="card-box"><h2>Best price points</h2><p class="sub">Toys sold at each price</p>${bars(byPrice, 'var(--yellow)')}</section>
      <section class="card-box"><h2>Sold more than once</h2><p class="sub">Toys worth buying again</p>${bars(byName)}</section>
    </div>
    <section class="card-box" style="margin-top:12px">
      <h2>Slow movers</h2><p class="sub">In the shop for over 60 days. Try a special price.</p>
      <div style="display:flex;gap:10px;overflow-x:auto">${(slow.data || []).map((t) => `
        <a href="#stock" style="width:110px;flex:none;text-decoration:none;font-size:13px">
          <img src="${esc(imageUrl(t.image_path))}" alt="" style="width:110px;height:110px;border-radius:12px;object-fit:cover">
          ${esc(t.name)}<br><strong>${kwacha(t.price)}</strong></a>`).join('') || '<p class="sub">None. Stock is moving well.</p>'}</div>
    </section>
    <div class="mobile-more"><a class="btn ghost" href="#boxes">Boxes</a><a class="btn ghost" href="#settings">Settings</a><a class="btn ghost" href="../" target="_blank">View shop</a></div>`;
}
