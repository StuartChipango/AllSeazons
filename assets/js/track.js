// Counts shop visits and where they came from (Facebook, WhatsApp, Google...).
// No names or numbers: each phone gets a random id. Phones that have signed
// in to the staff app are not counted, so your own checking does not show up.
import { supabase, configured } from './db.js';
import { trafficSource } from './lib.js';

const VISIT_GAP = 30 * 60e3; // a new visit after 30 minutes away
const TAG_PARAMS = ['src', 'c', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'igshid', 'ttclid'];

const read = (store, key) => { try { return JSON.parse(store.getItem(key)); } catch { return null; } };
const write = (store, key, v) => { try { store.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };
const newId = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const params = new URLSearchParams(location.search);
if (params.has('notrack')) write(localStorage, 'as_staff_device', true);
const off = !configured || read(localStorage, 'as_staff_device') === true
  || /bot|crawl|spider|slurp|preview|lighthouse/i.test(navigator.userAgent);

let visitor = read(localStorage, 'as_vid');
if (!visitor) { visitor = newId(); write(localStorage, 'as_vid', visitor); }

const tagged = TAG_PARAMS.some((k) => params.has(k));
const here = trafficSource({ search: location.search, referrer: document.referrer, ua: navigator.userAgent, host: location.hostname });
let visit = read(sessionStorage, 'as_visit');
const stale = !visit || Date.now() - (visit.last || 0) > VISIT_GAP;
// A tracked link, or arriving from another website, starts a new visit.
const isNew = stale || (tagged && here.via !== visit.via) || (here.referrer && here.referrer !== visit.referrer);
if (isNew) visit = { session: newId(), ...here, started: Date.now() };
visit.last = Date.now();
write(sessionStorage, 'as_visit', visit);

// Tidy the address so a shared link does not carry someone else's tag along.
if (tagged) {
  for (const k of TAG_PARAMS) params.delete(k);
  const q = params.toString();
  history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
}

const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'computer';

export function track(kind, extra = {}) {
  if (off) return Promise.resolve();
  visit.last = Date.now();
  write(sessionStorage, 'as_visit', visit);
  const p = {
    kind, visitor, session: visit.session, source: visit.source, via: visit.via,
    campaign: visit.campaign, referrer: visit.referrer, device, ...extra,
  };
  return supabase.rpc('track', { p }).then(() => {}, () => {});
}

if (isNew) track('visit');
