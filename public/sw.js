/**
 * Legal OS — Service Worker
 *
 * Phase 9A — Offline Mode + Install to Home Screen.
 * Phase 9E — Background push infrastructure.
 * Phase 9F — Deploy-safe cache versioning (fixes stale-build bug).
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
 * ⚠️ SW_VERSION MUST BE BUMPED ON EVERY DEPLOY THAT TOUCHES SHELL ASSETS
 * (any JS/CSS/HTML change). It does NOT need to change for backend-only /
 * Worker-side changes. This is the #1 cause of "my deploy doesn't show up
 * until I clear browsing data / use incognito" — if you forget to bump
 * this, `activate` has nothing to purge and everyone stays on the old
 * cached shell indefinitely.
 *
 * Bump pattern: 'v1' → 'v2' → 'v3' ... on every shell-touching deploy.
 */

const SW_VERSION  = 'v2'; // ← bumped from v1. BUMP THIS AGAIN NEXT SHELL DEPLOY.
const SHELL_CACHE = `afs-shell-${SW_VERSION}`;

// ── install — pre-warm the one URL we know ahead of time ───────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.add('/'))
      .catch(() => { /* offline first install — fine, fetch handler fills the cache in as the app runs */ })
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
  const isWorker      = url.hostname.endsWith('.workers.dev');
  const isFontCdn      = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isShellAsset   = url.origin === self.location.origin || isFontCdn;

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

/**
 * Phase 9E — Background push infrastructure.
 *
 * Push handler:
 *  - Richer payload support: severity, caseId, tab, actionUrl
 *  - Badge icon uses /icon-192.png (Phase 9C asset) instead of /favicon.ico
 *  - Notification actions: "Open" deep-link (shows case + tab) and "Dismiss"
 *  - Notification tag is severity-prefixed so CRITICAL alerts don't collapse
 *    into LOW ones when multiple arrive while the app is backgrounded
 *
 * notificationclick handler
 *  - Tapping the notification (or its "Open" action) focuses an existing
 *    app window or opens a new one, and deep-links to the right case tab
 *    by setting the hash the app reads on load.
 *  - Tapping "Dismiss" closes the notification without opening the app.
 */

self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};

  const title    = data.title    || 'AFS Alert';
  const body     = data.body     || '';
  const severity = data.severity || 'LOW';   // CRITICAL | HIGH | MEDIUM | LOW
  const caseId   = data.caseId   || null;
  const tab      = data.tab      || 'alerts';
  const actionUrl = data.actionUrl
    || (caseId ? `/#engine?case=${caseId}&tab=${tab}` : '/#home');

  // Tag by severity so CRITICAL notifications are never collapsed by a LOW one
  const tag = `afs-${severity.toLowerCase()}-${caseId || 'global'}`;

  const icon  = '/icon-192.png';
  const badge = '/icon-192.png';

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify:           true,
    requireInteraction: severity === 'CRITICAL' || severity === 'HIGH',
    data:               { actionUrl },
    actions: [
      { action: 'open',    title: 'Open'    },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const actionUrl = e.notification.data?.actionUrl || '/';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If an AFS window is already open, focus it and navigate to the deep link
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(self.location.origin + actionUrl);
          return;
        }
      }
      // No window open — open a new one
      return clients.openWindow(self.location.origin + actionUrl);
    })
  );
});
