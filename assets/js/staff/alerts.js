// Sale alerts: "Cha-ching! New order" on this phone whenever a customer
// orders on the website, even when the staff app is closed.
//
// The phone registers staff/sw.js (the service worker that shows the
// notification), asks permission, and saves its push address in the
// database. The sale-alert edge function does the sending.
import { esc } from '../lib.js';
import { supabase, friendlyError } from '../db.js';
import { $, toast, busy } from './ui.js';

export const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const SOUND = new URL('../../sounds/cha-ching.wav', import.meta.url).href;
let audio = null;

// The cha-ching itself (only while the app is open; when it is closed the
// phone plays its own notification sound).
export function playChaChing() {
  try {
    audio = audio || new Audio(SOUND);
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch { /* no sound on this device */ }
}

let reg = null;
export async function startWorker() {
  if (!supported) return null;
  try {
    reg = await navigator.serviceWorker.register(new URL('../../../staff/sw.js', import.meta.url), {
      scope: new URL('../../../staff/', import.meta.url).pathname,
    });
  } catch (e) {
    console.warn('service worker', e);
    return null;
  }
  // If alerts are on, make sure the database still has this phone.
  try {
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') await save(sub);
  } catch { /* try again next time */ }
  return reg;
}

async function ready() {
  return reg || (await startWorker()) || Promise.reject(new Error('This phone cannot get alerts from the app.'));
}

function deviceName() {
  const ua = navigator.userAgent;
  const model = ua.match(/Android [\d.]+; ([^;)]+)/)?.[1];
  return (model ? model.replace(/ Build.*/, '') : /Android/.test(ua) ? 'Android phone' : /iPhone|iPad/.test(ua) ? 'iPhone' : 'Computer')
    + (matchMedia('(display-mode: standalone)').matches ? ' (app)' : ' (browser)');
}

async function save(sub) {
  const { error } = await supabase.rpc('push_subscribe', { p_sub: sub.toJSON(), p_device: deviceName() });
  if (error) throw error;
}

async function serverKey() {
  const { data, error } = await supabase.functions.invoke('sale-alert', { body: { action: 'key' } });
  if (error || !data?.publicKey) {
    throw new Error('Sale alerts are not set up on the server yet. The owner needs to do the 2 steps in SETUP.md under "Sale alerts".');
  }
  return data.publicKey;
}

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const sameKey = (sub, key) => {
  const k = sub?.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k), b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

export async function status() {
  if (!supported) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const r = await ready().catch(() => null);
  const sub = await r?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function turnOn() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this app. Allow them in the phone settings, then try again.');
  const r = await ready();
  const key = await serverKey();
  let sub = await r.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
  sub = sub || await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await save(sub);
}

export async function turnOff() {
  const r = await ready();
  const sub = await r.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export async function sendTest() {
  const r = await ready();
  const sub = await r.pushManager.getSubscription();
  const { data, error } = await supabase.functions.invoke('sale-alert', { body: { action: 'test', endpoint: sub?.endpoint } });
  if (error) throw new Error('The test could not be sent. Check the sale-alert function is deployed.');
  if (!data?.sent) throw new Error('The test did not reach this phone. Turn alerts off and on again.');
}

// ---- The "Sale alerts" card on the Me page ----
export function alertsHtml() {
  return `
    <section class="settings-section card-box" id="saleAlerts">
      <h2>Sale alerts</h2>
      <p class="sub">Cha-ching! This phone rings with every new website order, even when the app is closed.</p>
      <div id="alertsBody"><p class="sub">Checking…</p></div>
    </section>`;
}

export async function wireAlerts(root) {
  const body = $('#alertsBody', root);
  if (!body) return;
  const st = await status();
  const msg = {
    unsupported: 'This browser cannot get alerts. On Android, open the staff app in Chrome and install it (menu ⋮ then "Add to Home screen").',
    blocked: 'Notifications are blocked for this app. Open phone Settings, then Apps, then Chrome (or AS Staff), then Notifications, and allow them. Then come back here.',
    off: 'Alerts are off on this phone.',
    on: '<b>On.</b> This phone will ring for every new website order.',
  }[st];
  body.innerHTML = `
    <p class="lead" style="margin:0 0 10px">${st === 'on' ? msg : esc(msg)}</p>
    <div class="row-actions" style="justify-content:flex-start">
      ${st === 'off' ? '<button class="btn small" type="button" data-alert="on">Turn on sale alerts</button>' : ''}
      ${st === 'on' ? '<button class="btn small" type="button" data-alert="test">Send a test</button>' : ''}
      ${st !== 'unsupported' ? '<button class="btn small ghost" type="button" data-alert="sound">Play the cha-ching</button>' : ''}
      ${st === 'on' ? '<button class="btn small ghost" type="button" data-alert="off">Turn off</button>' : ''}
    </div>
    ${st === 'on' ? '<p class="sub" style="margin:8px 0 0">When the app is closed the phone plays its normal notification sound. To make that a cha-ching too, see "Change the alert sound" in SETUP.md.</p>' : ''}`;
  body.onclick = async (e) => {
    const b = e.target.closest('[data-alert]');
    if (!b) return;
    const what = b.dataset.alert;
    if (what === 'sound') return playChaChing();
    busy(b, true);
    try {
      if (what === 'on') { await turnOn(); playChaChing(); toast('Sale alerts are on'); }
      if (what === 'off') { await turnOff(); toast('Sale alerts are off on this phone'); }
      if (what === 'test') { await sendTest(); toast('Test sent. Look at the top of the screen.'); }
    } catch (err) {
      toast(friendlyError(err), true);
    }
    busy(b, false);
    if (what !== 'test') wireAlerts(root);
  };
}
