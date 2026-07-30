'use strict';

// Bump ONLY when this file's logic or PRECACHE changes. Routine index.html
// pushes do NOT need a bump — they arrive via revalidation in the fetch
// handler. Assuming otherwise, then forgetting once, is the usual way this
// pattern is mistakenly declared broken.
const CACHE = 'gains-v1';

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
