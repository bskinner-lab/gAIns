'use strict';

// Bump on EVERY app edit, not just changes to this file or PRECACHE.
//
// Revalidation alone does deliver a new index.html, but stale-while-revalidate
// serves the cached shell first — so the load right after a deploy runs the OLD
// build and only the one after it picks up the new one. That is indistinguish-
// able from "the fix didn't work", and it has already cost one debugging cycle.
// A new cache name makes activate() drop the old cache outright, so the next
// launch is guaranteed fresh. Correctness over a saved refetch.
const CACHE = 'gains-v2';

// Relative paths so scope resolves under the /gAIns/ project page.
// './' and './index.html' are distinct cache keys for the same resource; a
// navigation to /gAIns/ requests the former.
const PRECACHE = [
  './',
  './index.html',
  './fonts/oswald-var.woff2',
  './fonts/archivo-var.woff2',
  './fonts/ibm-plex-mono-400.woff2',
  './fonts/ibm-plex-mono-500.woff2',
  './fonts/ibm-plex-mono-600.woff2',
];

self.addEventListener('install', event => {
  // addAll is atomic: one failed entry fails the whole install and the previous
  // worker stays active. A half-populated cache is worse than none.
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // Without this, a bumped cache name accumulates storage instead of replacing.
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  return !!res && res.ok && res.status === 200;
}

// Serve the cached shell immediately, then refresh it in the background so the
// NEXT launch gets the new build. Two details are load-bearing:
//   1. `cached` is returned before the network settles, so an offline launch is
//      instant rather than waiting on a doomed fetch.
//   2. the network promise carries its own .catch — uncaught, an offline
//      launch would reject and the app would fail to open at all.
function staleWhileRevalidate(request, cacheKey) {
  return caches.open(CACHE).then(cache =>
    cache.match(cacheKey).then(cached => {
      const network = fetch(request)
        .then(res => {
          // Never cache a 404: GitHub Pages serves one during a bad deploy and
          // it would become a permanent broken shell.
          if (cacheable(res)) cache.put(cacheKey, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || network.then(res => res || Response.error());
    })
  );
}

function cacheFirst(request) {
  return caches.open(CACHE).then(cache =>
    cache.match(request).then(cached => cached || fetch(request).then(res => {
      if (cacheable(res)) cache.put(request, res.clone());
      return res;
    }))
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  // No opinion on anything we do not own.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(req, './index.html'));
    return;
  }
  if (/\/fonts\/[^/]+\.woff2$/.test(new URL(req.url).pathname)) {
    event.respondWith(cacheFirst(req));
  }
});
