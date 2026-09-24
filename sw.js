const CACHE  = 'ae-pos-v10';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
];

// Install — cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.all(
        ASSETS.map(url =>
          c.add(url).catch(err => {
            console.warn('[SW] Failed to cache:', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache first for app assets, network first for GAS/CDN
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Skip non-GET
  if (e.request.method !== 'GET') return;

  // Never intercept — let browser handle directly
  if (url.includes('script.google.com'))       return;
  if (url.includes('script.googleusercontent')) return;
  if (url.includes('cdn.sheetjs.com'))          return;
  if (url.includes('cdnjs.cloudflare.com'))     return;
  if (url.includes('cdn.jsdelivr.net'))         return;
  if (url.includes('fonts.googleapis.com'))     return;
  if (url.includes('fonts.gstatic.com'))        return;
  if (url.includes('googleapis.com'))           return;

  // For app shell assets — cache first, then network
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;

      // Not in cache — fetch from network and cache it
      return fetch(e.request).then(function(res) {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        return res;
      }).catch(function() {
        // Offline fallback — return index.html for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('', { status: 200 });
      });
    })
  );
});
