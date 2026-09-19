const CACHE = 'ae-pos-v8';
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

  // Let browser handle these — never intercept
  if (e.request.method !== 'GET') return;
  if (url.includes('script.google.com')) return;
  if (url.includes('cdn.sheetjs.com')) return;
  if (url.includes('cdnjs.cloudflare.com')) return;
  if (url.includes('cdn.jsdelivr.net')) return;
  if (url.includes('fonts.googleapis.com')) return;
  if (url.includes('fonts.gstatic.com')) return;

  // Network first — if offline, try cache — always resolve to a valid Response
  e.respondWith(
    fetch(e.request)
      .then(function(res) { return res; })
      .catch(function() {
        return caches.open(CACHE).then(function(cache) {
          return cache.match(e.request).then(function(cached) {
            if (cached) return cached;
            if (e.request.mode === 'navigate') {
              return cache.match('/index.html').then(function(page) {
                return page || new Response('<h1>Offline</h1>', {
                  status: 200,
                  headers: { 'Content-Type': 'text/html' }
                });
              });
            }
            // Non-navigation uncached: return empty 200 so respondWith never gets undefined
            return new Response('', { status: 200 });
          });
        });
      })
  );
});
