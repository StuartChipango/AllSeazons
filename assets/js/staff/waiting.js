// Orders that need someone: packed orders waiting for the customer (kind
// reminders, storage fee), paid orders not packed, courier parcels not
// sent, confirmed orders not paid, and orders flagged as a double sale.
// Used by Home and the Inbox. Nothing here sends messages by itself: each
// button opens WhatsApp with the message ready, and staff press send.
import { esc, kwacha, waLink, waitLabel, reminderMessage, teamReport } from '../lib.js';
import { supabase, friendlyError } from '../db.js';
import { shared, can } from './app.js';
import { $$, toast } from './ui.js';

const H = 3600e3;
const hoursSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / H : 0);

// One line per problem. level: 'flag' (double sale or other problem to
// sort out), 'customer' (send them a message), 'team' (we must act).
export function alertsFor(orders) {
  const s = shared.settings || {};
  const out = [];
  for (const o of orders) {
    const i = o.storage_info || {};
    if (o.flag) out.push({ o, level: 'flag', text: `${o.code} ${o.customer_name}: ${o.flag}` });
    if (['cancelled', 'expired', 'sent', 'delivered'].includes(o.status)) continue;
    if (o.status === 'packed' && i.waits) {
      if (i.remind_due) out.push({ o, level: 'customer', kind: 'remind', text: `${o.code} ${o.customer_name} packed ${waitLabel(i.hours)} ago: send a kind reminder` });
      if (i.notice_due) out.push({ o, level: 'customer', kind: 'notice', text: `${o.code} ${o.customer_name} waiting ${waitLabel(i.hours)}: send the storage fee notice` });
      if (i.stage === 'late') out.push({ o, level: 'team', kind: 'fee', text: `${o.code} ${o.customer_name} not collected for ${waitLabel(i.hours)}${i.fee ? `, storage ${kwacha(i.fee)} so far` : ''}` });
    } else if (o.status === 'packed' && o.delivery_method === 'courier' && hoursSince(o.packed_at) >= 24) {
      out.push({ o, level: 'team', text: `${o.code} ${o.customer_name} packed ${waitLabel(hoursSince(o.packed_at))} ago, not sent to the courier yet` });
    } else if (o.status === 'paid' && hoursSince(o.paid_at) >= 24) {
      out.push({ o, level: 'team', text: `${o.code} ${o.customer_name} paid ${waitLabel(hoursSince(o.paid_at))} ago, not packed yet` });
    } else if (o.status === 'confirmed' && hoursSince(o.updated_at) >= (s.storage_free_hours || 72)) {
      out.push({ o, level: 'team', text: `${o.code} ${o.customer_name} confirmed ${waitLabel(hoursSince(o.updated_at))} ago, not paid yet` });
    }
  }
  const rank = { flag: 0, customer: 1, team: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export async function loadAlerts() {
  const [open, flagged] = await Promise.all([
    supabase.from('orders').select('*, storage_info').eq('channel', 'online').in('status', ['confirmed', 'paid', 'packed']).limit(300),
    supabase.from('orders').select('*, storage_info').not('flag', 'is', null).limit(100),
  ]);
  // Until the new database file is run, storage_info does not exist yet.
  if (open.error) return [];
  const byId = new Map([...(open.data || []), ...(flagged.data || [])].map((o) => [o.id, o]));
  return alertsFor([...byId.values()]);
}

const ICON = { flag: '⚠️', customer: '💬', team: '⏰' };
export function alertsHtml(alerts, { limit = 8 } = {}) {
  if (!alerts.length) return '';
  return `<section class="card-box alerts" aria-label="Needs attention">
    <h2>Needs attention <b class="n">${alerts.length}</b></h2>
    <ul>${alerts.slice(0, limit).map((a, n) => `
      <li class="${a.level}"><span aria-hidden="true">${ICON[a.level]}</span><span>${esc(a.text)}</span>
        ${a.kind && a.o.phone && can('sales') ? `<button class="btn small wa" data-remind="${n}">WhatsApp</button>` : ''}
        ${a.level === 'flag' && can('sales') ? `<button class="btn small ghost" data-unflag="${a.o.id}">Sorted</button>` : ''}
      </li>`).join('')}</ul>
    ${alerts.length > limit ? `<p class="sub"><a href="#orders">${alerts.length - limit} more in the Inbox</a></p>` : ''}
  </section>`;
}

// Open WhatsApp with the reminder for this order, and note that it went.
export async function sendReminder(o, kind) {
  const i = o.storage_info || {};
  window.open(waLink(o.phone, reminderMessage(o, kind, i)), '_blank', 'noopener');
  const col = { remind: 'reminded_at', notice: 'fee_notice_at' }[kind];
  if (!col) return;
  const { error } = await supabase.from('orders').update({ [col]: new Date().toISOString() }).eq('id', o.id);
  if (error) toast(friendlyError(error), true);
}

export async function clearFlag(id) {
  const { error } = await supabase.from('orders').update({ flag: null, flagged_at: null }).eq('id', id);
  if (error) toast(friendlyError(error), true); else toast('Marked as sorted');
}

export function wireAlerts(root, alerts, reload) {
  $$('[data-remind]', root).forEach((b) => b.onclick = async () => {
    const a = alerts[Number(b.dataset.remind)];
    await sendReminder(a.o, a.kind);
    reload?.();
  });
  $$('[data-unflag]', root).forEach((b) => b.onclick = async () => { await clearFlag(b.dataset.unflag); reload?.(); });
}

// Share text to WhatsApp and let the person pick the team group. Phones
// with the share sheet get it; others go through wa.me, which asks which chat.
export async function shareToGroup(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

// Today's sales, what went out and what is waiting, for the team group.
export async function dailyReport() {
  const now = new Date(Date.now() + 2 * H); // Lusaka time, UTC+2
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 2 * H).toISOString();
  const [sales, done, alerts] = await Promise.all([
    supabase.from('orders').select('code, channel, total, customer_name').in('status', ['paid', 'packed', 'sent', 'delivered']).gte('paid_at', start),
    supabase.from('orders').select('code, customer_name, storage_fee, status').eq('channel', 'online')
      .in('status', ['sent', 'delivered']).or(`sent_at.gte.${start},delivered_at.gte.${start}`),
    loadAlerts(),
  ]);
  const day = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lusaka' });
  return teamReport({ day, sales: sales.data || [], done: done.data || [], alerts });
}
