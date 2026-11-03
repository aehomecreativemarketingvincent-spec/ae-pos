const CACHE = 'ae-pos-v3';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/favicon.ico'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // only handle GET
  if (req.url.includes('script.google.com')) return;      // don't cache GAS
  if (!req.url.startsWith('http')) return;                // ignore chrome-extension:// etc.
  e.respondWith(
    fetch(req).then(res => {
      // keep a fresh copy of same-origin files for offline use
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req).then(hit =>
        hit ||
        (req.mode === 'navigate' ? caches.match('/index.html') : null) ||
        new Response('', { status: 503, statusText: 'Offline' })   // always a valid Response
      )
    )
  );
});
