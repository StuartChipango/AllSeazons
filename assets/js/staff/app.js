import { supabase, configured, friendlyError } from '../db.js';
import { $, $$, toast, closePanel } from './ui.js';

// Shared lookups every page uses, loaded once after sign-in.
export const ROLE_LABELS = { owner: 'Owner', stock: 'Stock', sales: 'Sales' };

// True when the signed-in person may do this job (owners may do everything).
export function can(role) {
  const roles = shared.me?.roles || [];
  return roles.includes('owner') || roles.includes(role);
}

export const shared = {
  me: null,
  settings: null,
  tiers: [],
  categories: [],
  boxes: [],
  // Photos picked from the + menu, handed to the Snap page when it opens.
  pendingFiles: null,
  async refresh() {
    const [s, t, c, b] = await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('price_tiers').select('price').order('price'),
      supabase.from('categories').select('name').order('sort'),
      supabase.from('boxes').select('*').order('created_at', { ascending: false }),
    ]);
    this.settings = s.data || {};
    this.tiers = (t.data || []).map((x) => x.price);
    this.categories = (c.data || []).map((x) => x.name);
    this.boxes = b.data || [];
  },
};

const pages = {
  home: () => import('./dashboard.js'),
  upload: () => import('./upload.js'),
  review: () => import('./review.js'),
  orders: () => import('./orders.js'),
  stock: () => import('./inventory.js'),
  boxes: () => import('./boxes.js'),
  settings: () => import('./settings.js'),
  sale: () => import('./sale.js'),
};

// Which job each page needs (null = everyone).
const NEEDS = { home: null, upload: 'stock', review: 'stock', stock: 'stock', boxes: 'stock', orders: 'sales', sale: 'sales', settings: null };
const allowed = (name) => !NEEDS[name] || can(NEEDS[name]);

let current = null;

async function route() {
  let name = (location.hash.slice(1).split('?')[0]) || 'home';
  if (!pages[name] || !allowed(name)) name = 'home';
  const loader = pages[name];
  // Snap, Review and Boxes sit under Stock on the phone's bottom tabs.
  const parent = { upload: 'stock', review: 'stock', boxes: 'stock', sale: 'orders' }[name];
  $$('#nav a').forEach((a) => {
    if (a.dataset.nav === name || a.dataset.nav === parent) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = $('#main');
  current?.leave?.();
  closePanel();
  main.innerHTML = '<p class="lead">Loading…</p>';
  try {
    const mod = await loader();
    current = mod;
    await mod.show(main);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<p class="error-text">Something went wrong: ${friendlyError(e)}</p>`;
  }
  main.focus({ preventScroll: true });
  refreshBadges();
}

export async function refreshBadges() {
  if (!shared.me) return;
  const [r, o] = await Promise.all([
    supabase.from('toys').select('id', { count: 'exact', head: true }).eq('status', 'review'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['held', 'confirmed', 'paid']),
  ]);
  const set = (id, n) => { const b = $(id); b.textContent = n || ''; b.hidden = !n; };
  set('#reviewBadge', r.count);
  set('#ordersBadge', o.count);
}

async function showApp() {
  let { data: me, error } = await supabase.rpc('my_staff');
  // Until the new database file is run, my_staff() does not exist yet:
  // carry on as before (every staff member can do everything).
  if (error && (await supabase.rpc('is_staff')).data === true) {
    const { data: u } = await supabase.auth.getUser();
    me = { email: u?.user?.email, name: null, roles: ['owner'] };
  }
  if (!me?.email) {
    await supabase.auth.signOut();
    showLogin('This account is not on the team, or it is switched off. Ask the owner.');
    return;
  }
  shared.me = { ...me, roles: me.roles || [] };
  $$('#nav a').forEach((a) => { a.hidden = !allowed(a.dataset.nav); });
  $$('#plusSheet [data-need]').forEach((o) => { o.hidden = !can(o.dataset.need); });
  const who = $('#whoAmI');
  if (who) who.textContent = `${me.name || me.login || me.email} · ${shared.me.roles.map((r) => ROLE_LABELS[r]).join(', ')}`;
  await shared.refresh();
  $('#login').hidden = true;
  $('#app').hidden = false;
  supabase.rpc('release_expired_holds').then(() => {}, () => {});
  route();
}

function showLogin(message = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginError').textContent = message;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  // Staff without an email sign in with a short name (see staff_add).
  const login = String(f.get('email')).trim().toLowerCase();
  const email = login.includes('@') ? login : `${login.replace(/[^a-z0-9._-]/g, '')}@staff.allseazons.shop`;
  const { error } = await supabase.auth.signInWithPassword({ email, password: String(f.get('password')) });
  btn.disabled = false;
  if (error) return showLogin(error.message === 'Invalid login credentials' ? 'That sign-in name and password do not match.' : friendlyError(error));
  showApp();
});

$('#signOut').addEventListener('click', async () => {
  await supabase.auth.signOut();
  shared.me = null;
  location.hash = '';
  showLogin();
});

// The + button opens a sheet; picking photos there goes straight to Snap.
const plus = $('#plusSheet');
$('#plusBtn').addEventListener('click', () => {
  // Clear last time's picks here, never while their photos are still being read.
  for (const id of ['#plusCamera', '#plusGallery']) $(id).value = '';
  plus.showModal();
});
plus.addEventListener('click', (e) => {
  if (e.target === plus || e.target.closest('[data-close-plus]') || e.target.closest('a.opt')) plus.close();
});
for (const id of ['#plusCamera', '#plusGallery']) {
  $(id).addEventListener('change', (e) => {
    if (!e.target.files.length) return;
    shared.pendingFiles = [...e.target.files];
    plus.close();
    if (location.hash === '#upload') route(); else location.hash = '#upload';
  });
}

window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });
window.addEventListener('unhandledrejection', (e) => toast(friendlyError(e.reason), true));

if (!configured) {
  showLogin('The app is not connected to Supabase yet. Fill in assets/js/config.js (see SETUP.md).');
} else {
  const { data } = await supabase.auth.getSession();
  if (data.session) showApp();
  else showLogin();
}
