import { supabase, configured, friendlyError } from '../db.js';
import { $, $$, toast } from './ui.js';

// Shared lookups every page uses, loaded once after sign-in.
export const shared = {
  settings: null,
  tiers: [],
  categories: [],
  boxes: [],
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
};

let current = null;

async function route() {
  const name = (location.hash.slice(1).split('?')[0]) || 'home';
  const loader = pages[name] || pages.home;
  $$('#nav a').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const main = $('#main');
  current?.leave?.();
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
  const [r, o] = await Promise.all([
    supabase.from('toys').select('id', { count: 'exact', head: true }).eq('status', 'review'),
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['held', 'confirmed', 'paid']),
  ]);
  const set = (id, n) => { const b = $(id); b.textContent = n || ''; b.hidden = !n; };
  set('#reviewBadge', r.count);
  set('#ordersBadge', o.count);
}

async function showApp() {
  const { data: isStaff } = await supabase.rpc('is_staff');
  if (isStaff !== true) {
    await supabase.auth.signOut();
    showLogin('This account is not on the staff list. Ask the owner to add your email in Settings.');
    return;
  }
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
  const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) });
  btn.disabled = false;
  if (error) return showLogin(error.message === 'Invalid login credentials' ? 'That email and password do not match.' : friendlyError(error));
  showApp();
});

$('#signOut').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.hash = '';
  showLogin();
});

window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });
window.addEventListener('unhandledrejection', (e) => toast(friendlyError(e.reason), true));

if (!configured) {
  showLogin('The app is not connected to Supabase yet. Fill in assets/js/config.js (see SETUP.md).');
} else {
  const { data } = await supabase.auth.getSession();
  if (data.session) showApp();
  else showLogin();
}
