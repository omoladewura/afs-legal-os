/**
 * AFS Legal OS — Service Worker
 *
 * Phase 9A — Offline Mode + Install to Home Screen.
 *
 * Builds on top of the original push-only handler at the bottom of this
 * file (unchanged) rather than replacing it — that was the only thing
 * registering this script before now (AlertsEngine's notification opt-in
 * flow; see Phase 9B, which moves the `register()` call to app boot so
 * shell caching here doesn't depend on anyone granting notifications).
 *
 * STRATEGY
 *  - App shell (HTML, JS, CSS, Google Fonts) → cache-first, populated at
 *    runtime. There's no build-time asset manifest available to this
 *    static file — Vite hashes JS/CSS filenames per build and this script
 *    isn't part of that pipeline — so instead of precaching a fixed list
 *    of hashed filenames on `install`, the shell cache fills in as the
 *    SPA requests each asset during normal use: a cache hit serves
 *    instantly (and offline) afterwards; a cache miss falls through to
 *    network and caches the response for next time. `install` itself only
 *    pre-warms `/`, the one URL known ahead of time (Cloudflare Pages
 *    serves index.html for every route via _redirects, so this alone
 *    covers offline navigation once the shell has loaded once).
 *  - Worker API calls (case data) → network-first, so data stays current
 *    whenever there's a connection, falling back to the last cached
 *    response only when offline. Matches any *.workers.dev origin so the
 *    main RAG worker and the monitor worker are both covered without
 *    hardcoding either subdomain.
 *  - `activate` purges every cache that doesn't match SW_VERSION below,
 *    so a Cloudflare Pages redeploy doesn't leave anyone stuck on stale
 *    cached JS pointing at asset hashes that no longer exist on origin.
 *
 * SW_VERSION must be bumped on any deploy that changes shell assets
 * (JS/CSS/HTML) so the old cache gets evicted on activate. It does not
 * need to change for backend-only / Worker-side changes.
 */

const SW_VERSION   = 'v1';
const SHELL_CACHE  = `afs-shell-${SW_VERSION}`;

// ── install — pre-warm the one URL we know ahead of time ───────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.add('/')).catch(() => { /* offline first install — fine, fetch handler fills the cache in as the app runs */ })
  );
  self.skipWaiting();
});

// ── activate — purge any cache left over from a previous deploy ────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── fetch — cache-first for shell assets, network-first for the Worker ─────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return; // Worker calls are POST — never intercept those, let them fail/succeed on the network directly

  const url = new URL(request.url);
  const isWorker = url.hostname.endsWith('.workers.dev');
  const isFontCdn = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isShellAsset = url.origin === self.location.origin || isFontCdn;

  // Worker API — network-first. Case data should be as fresh as possible
  // whenever there's a connection; only fall back to cache when offline.
  if (isWorker) {
    event.respondWith(
      fetch(request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Shell assets (same-origin HTML/JS/CSS + Google Fonts) — cache-first
  if (isShellAsset) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request)
          .then(resp => {
            if (resp.ok) {
              const copy = resp.clone();
              caches.open(SHELL_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
            }
            return resp;
          })
          .catch(() => {
            // Offline, nothing cached yet for this exact request. For a
            // full-page navigation, fall back to the cached shell root so
            // the app frame still renders instead of a blank tab.
            if (request.mode === 'navigate') return caches.match('/');
            return new Response('', { status: 504, statusText: 'Offline' });
          });
      })
    );
  }
  // Anything else cross-origin — let the browser handle it normally.
});

self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(data.title || 'AFS Alert', {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'afs-alert',
    renotify: true,
  }));
});
