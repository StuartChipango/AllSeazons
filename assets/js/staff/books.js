// The Books: money in and out, receipts, profit and turnover tax.
// Directors (the Owner job) only.
import { esc, kwacha } from '../lib.js';
import {
  categoryLabel, lusakaToday, monthKey, monthLabel, addMonths, monthRange,
  booksReminder, booksCsv, reminderCalendar,
} from '../books-lib.js';
import { supabase, friendlyError } from '../db.js';
import { shared } from './app.js';
import { $, $$, toast, openPanel, closePanel, busy, download, keepFiles } from './ui.js';
import { openEntry, enterReceipts, useBooksCss } from './books-form.js';

let month = monthKey(lusakaToday());
try { month = sessionStorage.getItem('as_books_month') || month; } catch { /* private mode */ }
let root = null;
let showAll = false;

const k2 = (n) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const s = 'K' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return v < 0 ? '−' + s : s;
};
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dayLabel = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Profit for one month row of books_report.
export function profitOf(m) {
  const tax = m.tax_paid != null ? Number(m.tax_paid) : Number(m.tax_due);
  const gross = Number(m.turnover) - Number(m.stock);
  const running = gross - Number(m.expenses);
  return { tax, gross, running, net: running - Number(m.setup) - tax };
}

export async function show(main) {
  root = main;
  useBooksCss();
  const asked = new URLSearchParams(location.hash.split('?')[1] || '').get('m');
  if (/^\d{4}-\d{2}$/.test(asked || '') && asked <= monthKey(lusakaToday())) month = asked;
  main.innerHTML = '<p class="lead">Loading the books…</p>';
  const year = Number(month.slice(0, 4));
  const { from, to } = monthRange(month);
  const [rep, entries] = await Promise.all([
    supabase.rpc('books_report', { p_year: year }),
    supabase.from('book_entries').select('*').gte('spent_on', from).lt('spent_on', to)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  if (rep.error) {
    const missing = /books_report|function|schema cache/i.test(rep.error.message || '');
    main.innerHTML = `<div class="page-head"><h1>Books</h1></div>
      <section class="card-box"><h2>${missing ? 'One step to switch the Books on' : 'Could not open the books'}</h2>
      <p>${missing ? 'In Supabase, open SQL Editor, paste all of <b>supabase/books.sql</b> and press Run. Then come back here.' : esc(friendlyError(rep.error))}</p></section>`;
    return;
  }
  // The open check list from other months too.
  const { data: toCheck } = await supabase.from('book_entries').select('*').eq('status', 'check').order('spent_on');
  render(rep.data, entries.data || [], toCheck || []);
}
export function leave() { root = null; }

function render(report, entries, toCheck) {
  if (!root) return;
  const main = root;
  const m = report.months[Number(month.slice(5, 7)) - 1];
  const p = profitOf(m);
  const rate = Number(report.rate);
  const closed = report.months.filter((x) => x.closed).map((x) => monthKey(x.month));
  const reminder = booksReminder(lusakaToday(), { reminderDay: shared.settings?.books_reminder_day || 25, closedMonths: closed });
  const isThisMonth = month === monthKey(lusakaToday());
  const byCat = Object.entries(m.by_category || {}).filter(([c]) => !['stock', 'setup'].includes(c)).sort((a, b) => b[1] - a[1]);
  const shown = showAll ? entries : entries.slice(0, 12);

  main.innerHTML = `
    <div class="page-head"><h1>Books</h1>
      <div class="bk-month">
        <button type="button" class="btn ghost small" data-month="-1" aria-label="Month before">‹</button>
        <b>${esc(monthLabel(month))}</b>
        <button type="button" class="btn ghost small" data-month="1" aria-label="Next month" ${isThisMonth ? 'disabled' : ''}>›</button>
      </div>
    </div>
    ${reminder ? `<a class="bk-remind ${reminder.urgent ? 'urgent' : ''}" href="#books" data-go="${reminder.month}">
      <b>${esc(reminder.text)}</b><span>Open ${esc(monthLabel(reminder.month))} ›</span></a>` : ''}

    <div class="bk-add">
      <label class="btn go"><input type="file" accept="image/*" capture="environment" hidden id="bkSnap">Snap a receipt</label>
      <label class="btn ghost"><input type="file" accept="image/*,application/pdf" multiple hidden id="bkPick">From gallery or PDF</label>
      <button type="button" class="btn ghost" id="bkHand">Type an expense</button>
      <button type="button" class="btn ghost" id="bkIncome">Money in</button>
    </div>

    <div class="kpis bk-kpis">
      <div class="kpi"><div class="l">Money in</div><div class="n">${k2(m.turnover)}</div><div class="l">${plural(m.orders, 'sale')}</div></div>
      <div class="kpi"><div class="l">Stock bought</div><div class="n">${k2(m.stock)}</div><div class="l">${m.stock_items ? plural(Number(m.stock_items), 'toy') : '&nbsp;'}</div></div>
      <div class="kpi"><div class="l">Costs</div><div class="n">${k2(Number(m.expenses) + Number(m.setup))}</div><div class="l">${Number(m.setup) ? `${k2(m.setup)} shop setup` : '&nbsp;'}</div></div>
      <div class="kpi ${p.net >= 0 ? 'good' : 'bad'}"><div class="l">Profit</div><div class="n">${k2(p.net)}</div><div class="l">after tax</div></div>
    </div>

    ${toCheck.length ? `<section class="card-box bk-check"><h2>To check (${toCheck.length})</h2>
      <p class="sub">Receipts handed in by staff. Open each one, check it against the photo, and save.</p>
      ${entryList(toCheck)}</section>` : ''}

    <div class="two">
      <section class="card-box"><h2>Profit and loss</h2><p class="sub">${esc(monthLabel(month))}, money as it came in and went out</p>
        <table class="mini-table bk-pl"><tbody>
          <tr><td>Toy sales, website</td><td class="num">${k2(m.online_sales)}</td></tr>
          <tr><td>Toy sales, shop</td><td class="num">${k2(m.shop_sales)}</td></tr>
          <tr><td>Delivery and packaging fees</td><td class="num">${k2(m.delivery)}</td></tr>
          ${Number(m.income) ? `<tr><td>Other money in</td><td class="num">${k2(m.income)}</td></tr>` : ''}
          <tr class="tot"><td>Money in (turnover)</td><td class="num">${k2(m.turnover)}</td></tr>
          <tr><td>Stock bought${m.boxes ? ` <small>(${plural(Number(m.boxes), 'box', 'boxes')} from Boxes)</small>` : ''}</td><td class="num">−${k2(m.stock)}</td></tr>
          <tr class="tot"><td>Left after stock</td><td class="num">${k2(p.gross)}</td></tr>
          ${byCat.map(([c, v]) => `<tr><td>${esc(categoryLabel('expense', c))}</td><td class="num">−${k2(v)}</td></tr>`).join('')}
          <tr class="tot"><td>Profit from running the shop</td><td class="num">${k2(p.running)}</td></tr>
          ${Number(m.setup) ? `<tr><td>Shop setup (one-off)</td><td class="num">−${k2(m.setup)}</td></tr>` : ''}
          <tr><td>Turnover tax ${m.tax_paid != null ? '(paid)' : `(${rate}%, estimate)`}</td><td class="num">−${k2(p.tax)}</td></tr>
          <tr class="tot big"><td>Profit</td><td class="num">${k2(p.net)}</td></tr>
        </tbody></table>
      </section>

      <section class="card-box bk-close"><h2>Month end and tax</h2>
        <p class="sub">Turnover tax is ${rate}% of money in, not of profit. Due at ZRA by 14 ${esc(monthLabel(addMonths(month, 1)).split(' ')[0])}.</p>
        <ul class="bk-steps">
          <li class="${m.entries ? 'done' : ''}">Every receipt and expense put in <small>${plural(Number(m.entries), 'entry', 'entries')}${m.no_receipt ? `, ${m.no_receipt} without a photo` : ''}</small></li>
          <li class="${!m.to_check ? 'done' : ''}">Staff receipts checked <small>${m.to_check ? `${m.to_check} still to check` : 'all checked'}</small></li>
          <li class="${m.tax_paid != null ? 'done' : ''}">Turnover tax paid <small>${m.tax_paid != null ? `${k2(m.tax_paid)}${m.tax_paid_on ? ` on ${esc(dayLabel(m.tax_paid_on))}` : ''}${m.tax_ref ? `, ref ${esc(m.tax_ref)}` : ''}` : `about ${k2(m.tax_due)} on ${k2(m.turnover)}`}</small></li>
          <li class="${m.closed ? 'done' : ''}">Month closed</li>
        </ul>
        <div class="row-actions" style="justify-content:flex-start">
          <button type="button" class="btn ${m.tax_paid != null ? 'ghost' : 'soft'}" id="bkTax">${m.tax_paid != null ? 'Change tax paid' : 'Mark tax paid'}</button>
          <button type="button" class="btn ghost" id="bkClose">${m.closed ? 'Open the month again' : 'Close the month'}</button>
          <button type="button" class="btn ghost" id="bkCsv">Download for the accountant</button>
        </div>
      </section>
    </div>

    <section class="card-box" style="margin-top:14px"><h2>${esc(monthLabel(month))}: money in and out</h2>
      <p class="sub">${entries.length ? plural(entries.length, 'entry', 'entries') : 'Nothing put in for this month yet.'} Sales from the shop and website come in by themselves.</p>
      ${entryList(shown)}
      ${entries.length > shown.length ? `<button type="button" class="btn ghost small" id="bkMore">Show all ${entries.length}</button>` : ''}
    </section>

    <section class="card-box" style="margin-top:14px"><h2>${report.year} month by month</h2>
      <p class="sub">Tap a month to open it.</p>
      <div class="table-scroll"><table class="mini-table bk-year">
        <thead><tr><th>Month</th><th>Money in</th><th>Stock</th><th>Costs</th><th>Tax</th><th>Profit</th></tr></thead>
        <tbody>${report.months.filter((x) => monthKey(x.month) <= monthKey(lusakaToday())).map((x) => {
          const q = profitOf(x);
          const empty = !Number(x.turnover) && !Number(x.stock) && !Number(x.expenses) && !Number(x.setup);
          return `<tr data-go="${monthKey(x.month)}" class="${monthKey(x.month) === month ? 'on' : ''} ${empty ? 'empty' : ''}">
            <td>${esc(monthLabel(x.month, true))}${x.closed ? ' ✓' : ''}</td><td class="num">${k2(x.turnover)}</td><td class="num">${k2(x.stock)}</td>
            <td class="num">${k2(Number(x.expenses) + Number(x.setup))}</td><td class="num">${k2(q.tax)}</td><td class="num ${q.net < 0 ? 'neg' : ''}">${k2(q.net)}</td></tr>`;
        }).join('')}</tbody>
        <tfoot>${(() => {
          const t = report.months.reduce((a, x) => {
            const q = profitOf(x);
            a.turnover += Number(x.turnover); a.stock += Number(x.stock); a.costs += Number(x.expenses) + Number(x.setup); a.tax += q.tax; a.net += q.net; a.items += Number(x.stock_items);
            return a;
          }, { turnover: 0, stock: 0, costs: 0, tax: 0, net: 0, items: 0 });
          return `<tr><td>Year</td><td class="num">${k2(t.turnover)}</td><td class="num">${k2(t.stock)}</td><td class="num">${k2(t.costs)}</td><td class="num">${k2(t.tax)}</td><td class="num">${k2(t.net)}</td></tr>`;
        })()}</tfoot>
      </table></div>
      <div class="row-actions" style="justify-content:flex-start;margin-top:10px">
        <button type="button" class="btn ghost small" data-year="-1">‹ ${report.year - 1}</button>
        ${report.year < Number(lusakaToday().slice(0, 4)) ? `<button type="button" class="btn ghost small" data-year="1">${report.year + 1} ›</button>` : ''}
      </div>
    </section>

    <details class="more-box"><summary>Reminders and tax rate</summary>
      <form id="bkSettings" class="bk-settings">
        <div class="rc-two">
          <label class="field"><span>Turnover tax rate (%)</span><input name="turnover_tax_rate" type="number" min="0" max="50" step="0.5" value="${esc(rate)}"></label>
          <label class="field"><span>Start reminding on day</span><input name="books_reminder_day" type="number" min="1" max="28" value="${esc(shared.settings?.books_reminder_day || 25)}"></label>
        </div>
        <div class="row-actions" style="justify-content:flex-start"><button class="btn small" type="submit">Save</button></div>
      </form>
      <p>The app reminds you on the Home page from that day until the month's tax is marked paid and the month is closed.
        For a reminder on your phone too, add it to your calendar once. It repeats every month, and a second one on the 10th reminds you tax is due on the 14th.</p>
      <div class="row-actions" style="justify-content:flex-start">
        <a class="btn ghost small" id="bkGcal" target="_blank" rel="noopener">Add to Google Calendar</a>
        <button type="button" class="btn ghost small" id="bkIcs">Calendar file (.ics)</button>
      </div>
      <p class="sub">Turnover tax: ZRA's rate was 5% of gross sales when this was set up. Check the rate and deadline with ZRA or your accountant, and change it here if it moves.</p>
    </details>`;

  wire(main, report, entries, toCheck, m);
}

function entryList(list) {
  if (!list.length) return '';
  return `<ul class="bk-list">${list.map((e) => `
    <li><button type="button" data-entry="${esc(e.id)}">
      <span class="bk-ico ${e.kind === 'income' ? 'in' : e.category === 'stock' ? 'stock' : ''}" aria-hidden="true">${e.receipt_path ? '🧾' : e.kind === 'income' ? '＋' : '✎'}</span>
      <span class="bk-what"><b>${esc(e.supplier || e.description || categoryLabel(e.kind, e.category))}</b>
        <small>${esc(dayLabel(e.spent_on))} · ${esc(categoryLabel(e.kind, e.category))}${e.items ? ` · ${e.items} toys` : ''}${e.paid_by === 'director' ? ' · director paid' : ''}${e.status === 'check' ? ' · <em>to check</em>' : ''}</small></span>
      <span class="bk-amt ${e.kind === 'income' ? 'in' : ''}">${e.kind === 'income' ? '+' : '−'}${k2(e.amount)}</span>
    </button></li>`).join('')}</ul>`;
}

function go(key) {
  month = key;
  try { sessionStorage.setItem('as_books_month', month); } catch { /* private mode */ }
  showAll = false;
  show(root);
}

function wire(main, report, entries, toCheck, m) {
  const again = () => root && show(root);
  $$('[data-month]', main).forEach((b) => b.onclick = () => go(addMonths(month, Number(b.dataset.month))));
  $$('[data-year]', main).forEach((b) => b.onclick = () => go(`${report.year + Number(b.dataset.year)}-${b.dataset.year === '1' ? '01' : '12'}`));
  $$('[data-go]', main).forEach((b) => b.onclick = (ev) => { ev.preventDefault(); go(b.dataset.go); });
  $('#bkMore', main)?.addEventListener('click', () => { showAll = true; render(report, entries, toCheck); });

  const pick = (id) => $(id, main).onchange = async (ev) => {
    if (!ev.target.files.length) return;
    const files = await keepFiles(ev.target.files);
    ev.target.value = '';
    const n = await enterReceipts(files);
    if (n) again();
  };
  pick('#bkSnap');
  pick('#bkPick');
  // Start loading the receipt reader while the camera is open.
  $('#bkSnap', main).addEventListener('click', () => import('./receipt-reader.js').then((r) => r.warmUp()), { once: true });
  $('#bkHand', main).onclick = async () => { if (await openEntry({ kind: 'expense' }) === 'saved') again(); };
  $('#bkIncome', main).onclick = async () => { if (await openEntry({ kind: 'income' }) === 'saved') again(); };
  $$('[data-entry]', main).forEach((b) => b.onclick = async () => {
    const e = [...entries, ...toCheck].find((x) => x.id === b.dataset.entry);
    const r = await openEntry({ entry: e });
    if (r !== 'skipped') again();
  });

  $('#bkTax', main).onclick = () => taxPanel(m).then((ok) => ok && again());
  $('#bkClose', main).onclick = async (ev) => {
    busy(ev.target, true);
    const { error } = await supabase.from('book_months').upsert({ month: `${month}-01`, closed: !m.closed }, { onConflict: 'month' });
    if (error) { busy(ev.target, false); return toast(friendlyError(error), true); }
    toast(m.closed ? 'Month opened again' : `${monthLabel(month)} closed`);
    again();
  };
  $('#bkCsv', main).onclick = async () => {
    const { from, to } = monthRange(month);
    const { data, error } = await supabase.from('book_entries').select('*').gte('spent_on', from).lt('spent_on', to).order('spent_on');
    if (error) return toast(friendlyError(error), true);
    download(`all-seazons-books-${month}.csv`, booksCsv(m, data || []));
  };

  const cal = reminderCalendar(Number(shared.settings?.books_reminder_day || 25), lusakaToday());
  $('#bkGcal', main).href = cal.google;
  $('#bkIcs', main).onclick = () => download('all-seazons-books-reminder.ics', cal.ics, 'text/calendar');
  $('#bkSettings', main).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target.elements;
    const rec = { turnover_tax_rate: Number(f.turnover_tax_rate.value), books_reminder_day: Math.min(28, Math.max(1, Math.round(Number(f.books_reminder_day.value)))) };
    const { error } = await supabase.from('settings').update(rec).eq('id', 1);
    if (error) return toast(friendlyError(error), true);
    await shared.refresh();
    toast('Saved');
    again();
  };
}

function taxPanel(m) {
  return new Promise((resolve) => {
    let ok = false;
    const body = openPanel(`
      <h2>Turnover tax for ${esc(monthLabel(month))}</h2>
      <p class="sub">Money in was ${k2(m.turnover)}. At the rate set, the tax is about ${k2(m.tax_due)}.</p>
      <form>
        <label class="field"><span>Amount paid (Kwacha)</span><input name="tax_paid" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(m.tax_paid ?? m.tax_due)}"></label>
        <label class="field"><span>Date paid</span><input name="tax_paid_on" type="date" max="${lusakaToday()}" value="${esc(m.tax_paid_on || lusakaToday())}"></label>
        <label class="field"><span>ZRA payment reference <small>(PRN, optional)</small></span><input name="tax_ref" maxlength="60" value="${esc(m.tax_ref || '')}"></label>
        <label class="field"><span>Notes <small>(optional)</small></span><input name="notes" maxlength="200" value="${esc(m.notes || '')}"></label>
        <label class="check-line"><input type="checkbox" name="closed" ${m.closed || m.tax_paid == null ? 'checked' : ''}> Close the month too</label>
        <div class="row-actions" style="margin-top:14px">
          ${m.tax_paid != null ? '<button type="button" class="btn danger" data-clear>Not paid</button>' : ''}
          <button type="submit" class="btn go">Save</button>
        </div>
      </form>`);
    body.closest('dialog').addEventListener('close', () => resolve(ok));
    const form = $('form', body);
    const save = async (rec) => {
      const { error } = await supabase.from('book_months').upsert({ month: `${month}-01`, ...rec }, { onConflict: 'month' });
      if (error) return toast(friendlyError(error), true);
      ok = true;
      toast('Saved');
      closePanel();
    };
    $('[data-clear]', form)?.addEventListener('click', () => save({ tax_paid: null, tax_paid_on: null, tax_ref: null, closed: false }));
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const f = form.elements;
      save({
        tax_paid: Number(f.tax_paid.value) || 0,
        tax_paid_on: f.tax_paid_on.value || null,
        tax_ref: f.tax_ref.value.trim() || null,
        notes: f.notes.value.trim() || null,
        closed: f.closed.checked,
      });
    };
  });
}

// Home page: a small Books tile and the month-end reminder (owners).
export async function homeSummary() {
  useBooksCss();
  const today = lusakaToday();
  const { data, error } = await supabase.rpc('books_report', { p_year: Number(today.slice(0, 4)) });
  if (error || !data) return null;
  const thisMonth = data.months[Number(today.slice(5, 7)) - 1];
  let closed = data.months.filter((x) => x.closed).map((x) => monthKey(x.month));
  // In early January the month to remind about is last December.
  if (today.slice(5, 7) === '01') {
    const last = await supabase.rpc('books_report', { p_year: Number(today.slice(0, 4)) - 1 });
    closed = closed.concat((last.data?.months || []).filter((x) => x.closed).map((x) => monthKey(x.month)));
  }
  return {
    month: thisMonth,
    profit: profitOf(thisMonth).net,
    reminder: booksReminder(today, { reminderDay: shared.settings?.books_reminder_day || 25, closedMonths: closed }),
  };
}
