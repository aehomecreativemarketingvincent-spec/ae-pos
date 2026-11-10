// AE Home POS service worker
// Deploy tip: every time you upload new code, change the version number below
// (ae-pos-v4 -> ae-pos-v5 ...). That is what makes devices that are already
// open pick up the new version and refresh by themselves.
const CACHE = 'ae-pos-v4';

// Relative paths so it works at the site root AND inside a sub-folder
// (e.g. https://username.github.io/repo-name/)
const ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json',
                './icon-192.png', './icon-512.png', './favicon.ico'];

self.addEventListener('install', e => {
  // cache each file on its own so one missing file doesn't block the rest
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old  = keys.filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // New version replaced an older one -> refresh open tabs/apps so they run the new code
    if (old.length) {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(w => { try { w.navigate(w.url); } catch (err) {} });
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // only handle GET
  if (req.url.includes('script.google.com')) return;      // don't cache GAS
  if (!req.url.startsWith('http')) return;                // ignore chrome-extension:// etc.
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  e.respondWith(
    // network first, and bypass the browser's HTTP cache so new uploads show right away
    fetch(req, sameOrigin ? { cache: 'no-cache' } : undefined).then(res => {
      if (res && res.ok && sameOrigin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req).then(hit =>
        hit ||
        (req.mode === 'navigate' ? caches.match('./index.html') : null) ||
        new Response('', { status: 503, statusText: 'Offline' })
      )
    )
  );
});
