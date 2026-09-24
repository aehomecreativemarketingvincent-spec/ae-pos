const CACHE_NAME = 'ae-pos-v11';

/*
 * AE HOME POS SERVICE WORKER
 * Runtime caching only.
 * No aggressive pre-cache during install.
 */

// ================================
// INSTALL
// ================================
self.addEventListener('install', event => {
  console.log('[SW] Installing:', CACHE_NAME);

  // Activate the new service worker immediately
  event.waitUntil(self.skipWaiting());
});


// ================================
// ACTIVATE
// ================================
self.addEventListener('activate', event => {
  console.log('[SW] Activating:', CACHE_NAME);

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});


// ================================
// FETCH
// ================================
self.addEventListener('fetch', event => {

  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // ==========================================
  // DO NOT INTERCEPT EXTERNAL / GOOGLE SERVICES
  // ==========================================
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.sheetjs.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    return;
  }

  // ==========================================
  // ONLY HANDLE SAME-ORIGIN REQUESTS
  // ==========================================
  if (url.origin !== self.location.origin) {
    return;
  }

  // ==========================================
  // NAVIGATION / HTML
  // Network first, cache fallback
  // ==========================================
  if (request.mode === 'navigate') {

    event.respondWith(
      fetch(request)
        .then(response => {

          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, copy).catch(() => {});
            });
          }

          return response;
        })
        .catch(() => {

          return caches.match(request).then(cached => {

            if (cached) {
              return cached;
            }

            // Last fallback
            return caches.match('/').then(rootCached => {
              return rootCached || new Response(
                'AE Home POS is currently offline.',
                {
                  status: 503,
                  headers: {
                    'Content-Type': 'text/plain'
                  }
                }
              );
            });

          });

        })
    );

    return;
  }


  // ==========================================
  // STATIC ASSETS
  // Cache first, network fallback
  // ==========================================
  const destination = request.destination;

  const cacheableTypes = [
    'style',
    'script',
    'image',
    'font',
    'manifest'
  ];

  if (cacheableTypes.includes(destination)) {

    event.respondWith(

      caches.match(request).then(cached => {

        if (cached) {
          return cached;
        }

        return fetch(request)
          .then(response => {

            if (
              response &&
              response.ok &&
              response.type !== 'opaque'
            ) {

              const copy = response.clone();

              caches.open(CACHE_NAME).then(cache => {
                cache.put(request, copy).catch(() => {});
              });

            }

            return response;
          })
          .catch(() => {

            // Don't generate another error
            return new Response('', {
              status: 503
            });

          });

      })

    );

    return;
  }

  // ==========================================
  // EVERYTHING ELSE
  // Let browser handle normally
  // ==========================================
});
