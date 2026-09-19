const CACHE = 'ae-pos-v7';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

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
  const url = e.request.url;
  // Skip — let browser handle these directly
  if (e.request.method !== 'GET') return;
  if (url.includes('script.google.com')) return;
  if (url.includes('cdn.sheetjs.com')) return;
  if (url.includes('cdnjs.cloudflare.com')) return;
  if (url.includes('cdn.jsdelivr.net')) return;

  // Network first, fall back to cache
  e.respondWith(
    fetch(e.request).catch(function() {
      return caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        // For navigation requests, return the cached index.html
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return undefined;
      });
    })
  );
});
