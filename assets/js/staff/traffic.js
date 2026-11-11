// Website visitors: where people come from and what they do next.
import { esc, kwacha, TRAFFIC_SOURCES, LINK_CHANNELS, trackedLink } from '../lib.js';
import { supabase, friendlyError } from '../db.js';
import { $, $$, seg, toast } from './ui.js';

const PERIODS = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']];
let days = 7;
try { days = Number(localStorage.getItem('as_traffic_days')) || 7; } catch { /* private mode */ }

const SHOP = new URL('../', location.href).href;
const label = (key) => TRAFFIC_SOURCES[key]?.label || key;
const viaLabel = (via) => LINK_CHANNELS.find((c) => c.code === via)?.label
  || { 'facebook-app': 'Facebook app', 'instagram-app': 'Instagram app', 'tiktok-app': 'TikTok app', 'whatsapp-app': 'WhatsApp app', fbclid: 'Facebook link', 'google-ads': 'Google ads' }[via]
  || via;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function sourceRows(sources) {
  const max = Math.max(1, ...sources.map((s) => s.visitors));
  return sources.map((s) => `
    <li class="src-row">
      <div class="src-top"><b>${esc(label(s.source))}</b><span>${plural(s.visitors, 'visitor')}</span></div>
      <i class="src-bar" style="width:${Math.max(3, (s.visitors / max) * 100)}%"></i>
      <small>${plural(s.toy_views, 'toy look')} · ${plural(s.whatsapp, 'WhatsApp tap')} · ${plural(s.orders, 'order')}${s.sales ? ` (${kwacha(s.sales)})` : ''}</small>
    </li>`).join('');
}

function dayChart(list) {
  const max = Math.max(1, ...list.map((d) => d.visitors));
  const fmt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<div class="day-chart" role="img" aria-label="Visitors each day">${list.map((d) => `
    <span class="day" title="${esc(fmt(d.day))}: ${plural(d.visitors, 'visitor')}"><i style="height:${d.visitors ? Math.max(4, (d.visitors / max) * 100) : 0}%"></i></span>`).join('')}</div>
    <div class="day-axis"><span>${esc(fmt(list[0].day))}</span><span>busiest day: ${max} visitors</span><span>${esc(fmt(list.at(-1).day))}</span></div>`;
}

function table(rows, head) {
  if (!rows.length) return '<p class="sub">Nothing yet.</p>';
  return `<table class="mini-table"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function linkMaker() {
  return `
    <section class="card-box" id="linkMaker">
      <h2>Make a tracked link</h2>
      <p class="sub">Post this link instead of the plain shop address, so visits from it are counted under the right place.
        WhatsApp hides where people come from, so without it most WhatsApp visits show as "Direct".</p>
      <label class="field"><span>Where will you post it?</span>
        <select id="lmChannel">${LINK_CHANNELS.map((c) => `<option value="${c.code}">${esc(c.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Name of the promotion <small>(optional)</small></span>
        <input id="lmCampaign" type="text" maxlength="40" autocomplete="off" placeholder="e.g. christmas"></label>
      <div class="link-out" id="lmOut"></div>
      <div class="row-actions" style="justify-content:flex-start">
        <button class="btn" type="button" id="lmCopy">Copy link</button>
        <button class="btn ghost" type="button" id="lmShare" ${navigator.share ? '' : 'hidden'}>Share…</button>
      </div>
    </section>`;
}

function wireLinkMaker(main) {
  const out = $('#lmOut', main);
  const link = () => trackedLink(SHOP, $('#lmChannel', main).value, $('#lmCampaign', main).value);
  const draw = () => { out.textContent = link(); };
  $('#lmChannel', main).onchange = draw;
  $('#lmCampaign', main).oninput = draw;
  draw();
  $('#lmCopy', main).onclick = async () => {
    try { await navigator.clipboard.writeText(link()); toast('Link copied. Paste it into your post.'); } catch { toast('Press and hold the link to copy it.'); }
  };
  $('#lmShare', main).onclick = () => navigator.share({ text: 'Quality toys from K30 at All Seazons Play: ' + link() }).catch(() => {});
}

function countThisPhone() {
  let on = false;
  try { on = JSON.parse(localStorage.getItem('as_staff_device')) === true; } catch { /* private mode */ }
  return `<label class="check-line"><input type="checkbox" id="notrack" ${on ? 'checked' : ''}>
    Do not count visits from this phone (on by default for staff phones, so your own checking does not show up)</label>`;
}

export async function show(main) {
  const { data: r, error } = await supabase.rpc('traffic_report', { p_days: days });
  const head = `
    <div class="page-head"><h1>Website visitors</h1></div>
    ${seg('days', days, PERIODS)}`;
  if (error) {
    const missing = /traffic_report|function|schema cache/i.test(error.message || '');
    main.innerHTML = `${head}
      <section class="card-box" style="margin-top:12px"><h2>${missing ? 'One step left' : 'Could not load visitors'}</h2>
      <p>${missing ? 'Run the latest database file in Supabase (SQL Editor, paste <b>supabase/schema-paste.sql</b>, press Run). Visitors are counted from then on.' : esc(friendlyError(error))}</p></section>
      ${linkMaker()}`;
    wireLinkMaker(main);
    wireDays(main);
    return;
  }
  const t = r.totals;
  const sources = r.sources.filter((s) => s.visits || s.orders);
  const vias = r.vias.filter((v) => v.visits || v.orders).map((v) => [viaLabel(v.via), v.visits, v.orders]);
  main.innerHTML = `${head}
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="l">Visitors</div><div class="n">${t.visitors}</div><div class="l">${plural(t.visits, 'visit')}</div></div>
      <div class="kpi"><div class="l">Toy looks</div><div class="n">${t.toy_views}</div></div>
      <div class="kpi"><div class="l">WhatsApp taps</div><div class="n">${t.whatsapp}</div></div>
      <div class="kpi"><div class="l">Website orders</div><div class="n">${t.orders}</div><div class="l">${kwacha(t.sales) || 'K0'}</div></div>
    </div>
    <div class="two">
      <section class="card-box"><h2>Where visitors come from</h2>
        <p class="sub">Each place, and what its visitors did next</p>
        ${sources.length ? `<ul class="src-list">${sourceRows(sources)}</ul>` : '<p class="sub">No visitors yet in this time. Share a tracked link below to start.</p>'}
      </section>
      <section class="card-box"><h2>Visitors each day</h2><p class="sub">Lusaka time</p>
        ${r.days.length > 1 ? dayChart(r.days) : `<p class="big-n">${t.visitors}</p><p class="sub">visitors today</p>`}
        <p class="sub" style="margin-top:10px">${plural(t.phones, 'phone')}, ${plural(t.computers, 'computer')}</p>
      </section>
      <section class="card-box"><h2>Which links and sites</h2><p class="sub">Your tracked links, apps and other websites</p>
        ${table(vias, ['From', 'Visits', 'Orders'])}</section>
      <section class="card-box"><h2>Most looked-at toys</h2>
        ${table(r.toys.map((x) => [`${x.name || 'Toy'} (${x.code})`, x.views]), ['Toy', 'Looks'])}</section>
      ${r.campaigns.length ? `<section class="card-box"><h2>Promotions</h2>
        ${table(r.campaigns.map((c) => [c.campaign, c.visits, c.orders, kwacha(c.sales) || 'K0']), ['Name', 'Visits', 'Orders', 'Sales'])}</section>` : ''}
    </div>
    <div style="margin-top:14px">${linkMaker()}</div>
    <details class="more-box"><summary>What do these mean?</summary>
      <p><b>Visitor</b>: one phone or computer. <b>Visit</b>: each time they come back after 30 minutes or more away.</p>
      <p><b>Direct or unknown</b>: the address was typed, saved, or tapped in an app that hides where it came from (WhatsApp chats and status do this). Use tracked links to move these into the right place.</p>
      <p><b>Google and search</b>: people who searched and found the shop.</p>
      <p><b>WhatsApp taps</b>: taps on a "chat on WhatsApp" button. Orders sent from the checkout are counted under orders.</p>
      ${countThisPhone()}
    </details>`;
  wireLinkMaker(main);
  wireDays(main);
  $('#notrack', main).onchange = (e) => {
    try {
      if (e.target.checked) localStorage.setItem('as_staff_device', 'true');
      else localStorage.setItem('as_staff_device', 'false');
    } catch { /* private mode */ }
    toast(e.target.checked ? 'This phone is not counted.' : 'This phone is counted now.');
  };
}

function wireDays(main) {
  $$('[data-seg="days"]', main).forEach((b) => b.onclick = () => {
    days = Number(b.dataset.value);
    try { localStorage.setItem('as_traffic_days', String(days)); } catch { /* private mode */ }
    show(main);
  });
}
