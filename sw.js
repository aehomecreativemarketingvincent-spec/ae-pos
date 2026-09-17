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
  // Never intercept GAS, CDN scripts, or non-GET requests
  const url = e.request.url;
  if (url.includes('script.google.com')) return;
  if (url.includes('cdn.sheetjs.com')) return;
  if (url.includes('cdnjs.cloudflare.com')) return;
  if (url.includes('cdn.jsdelivr.net')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(function(res) {
        // Only cache valid responses
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        return res;
      })
      .catch(function() {
        return caches.match(e.request).then(function(cached) {
          // Return cached version OR a fallback — never undefined
          return cached || new Response('Network error', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
  );
});
