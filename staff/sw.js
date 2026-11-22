// Staff app service worker: shows "Cha-ching! New order" when the
// sale-alert edge function sends a push, even when the app is closed.
// It does not cache anything, so app updates show up straight away.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// The website host lets phones keep the app's files for 10 minutes, so
// after an update a phone could keep showing the old screens. Always ask
// the website whether a file changed (a quick check; unchanged files are
// not downloaded again). Without a connection, the phone's copy is used.
const APP_FILE = /\.(?:js|mjs|css|html|webmanifest)$/;
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r.url, { cache: 'no-cache', credentials: 'same-origin' }).catch(() => fetch(r)));
  } else if (APP_FILE.test(url.pathname)) {
    e.respondWith(fetch(r, { cache: 'no-cache' }).catch(() => fetch(r)));
  }
});

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const looking = wins.some((w) => w.visibilityState === 'visible');
    // An open app plays the real cha-ching and refreshes its lists.
    for (const w of wins) w.postMessage({ type: 'sale-alert', ...m });
    await self.registration.showNotification(m.title || 'Cha-ching! New order', {
      body: m.body || 'A customer just ordered on the website.',
      tag: m.tag || 'order',
      renotify: true,
      icon: new URL('../assets/img/icon-512.png', self.location).href,
      vibrate: [90, 50, 90, 50, 400],
      // While someone is looking at the app, the app makes the noise.
      silent: looking,
      timestamp: Date.now(),
      data: { url: m.url || '#orders' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./' + (e.notification.data?.url || '#orders'), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) {
      await w.focus();
      w.postMessage({ type: 'open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
