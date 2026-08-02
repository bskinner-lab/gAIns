'use strict';
const fs = require('fs');
const path = require('path');

const SW_PATH = path.join(__dirname, '..', 'sw.js');
// The service worker lives at /gAIns/sw.js on GitHub Pages, so relative
// precache paths resolve under /gAIns/. Using the real shape here keeps the
// tests honest about scope.
const BASE = 'https://example.test/gAIns/';

function urlOf(req) {
  const raw = typeof req === 'string' ? req : req.url;
  return new URL(raw, BASE).href;
}

/** Minimal Response stand-in: sw.js only reads ok/status/headers and clones. */
function makeResponse({ status = 200, body = '', headers = {} } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    body,
    headers: { get: k => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    clone() { return makeResponse({ status, body, headers }); },
  };
}

function makeRequest(url, { method = 'GET', mode = 'no-cors' } = {}) {
  return { url: new URL(url, BASE).href, method, mode };
}

/**
 * CacheStorage stand-in. `_dump()` exposes the raw contents so tests can assert
 * on exactly what was stored without going through the same code under test.
 */
function makeCaches(fetchImpl) {
  const store = new Map(); // cacheName -> Map(url -> response)

  function openSync(name) {
    if (!store.has(name)) store.set(name, new Map());
    const c = store.get(name);
    return {
      match: req => Promise.resolve(c.get(urlOf(req))),
      put: (req, res) => { c.set(urlOf(req), res); return Promise.resolve(); },
      addAll: reqs => Promise.all(reqs.map(r =>
        fetchImpl(makeRequest(r)).then(res => {
          // Real addAll rejects on any non-ok response, taking the whole
          // install with it. Reproduce that or test 2 proves nothing.
          if (!res || !res.ok) throw new TypeError(`addAll failed for ${urlOf(r)}`);
          return [urlOf(r), res];
        })
      )).then(pairs => { pairs.forEach(([k, v]) => c.set(k, v)); }),
    };
  }

  return {
    _dump: () => new Map([...store].map(([n, c]) => [n, new Map(c)])),
    _seed: (name, url, res) => { if (!store.has(name)) store.set(name, new Map()); store.get(name).set(urlOf(url), res); },
    open: name => Promise.resolve(openSync(name)),
    keys: () => Promise.resolve([...store.keys()]),
    delete: name => Promise.resolve(store.delete(name)),
    match: req => {
      for (const c of store.values()) if (c.has(urlOf(req))) return Promise.resolve(c.get(urlOf(req)));
      return Promise.resolve(undefined);
    },
  };
}

/**
 * Eval sw.js under a fake global scope and return handles for driving it.
 * `fetchImpl(request)` is the network: tests supply one that resolves, 404s,
 * or rejects, to exercise each branch.
 */
function loadSW({ fetchImpl } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const netFetch = fetchImpl || (() => Promise.resolve(makeResponse()));
  const cacheStorage = makeCaches(netFetch);

  const self = {
    location: new URL('sw.js', BASE),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { calls.claim++; return Promise.resolve(); } },
  };

  const src = fs.readFileSync(SW_PATH, 'utf8');
  // eslint-disable-next-line no-new-func
  const run = new Function('self', 'caches', 'fetch', 'Response', 'URL', src);
  run(self, cacheStorage, netFetch, { error: () => makeResponse({ status: 0 }) }, URL);

  /** Fire a lifecycle event and await whatever it passed to waitUntil. */
  function fire(type) {
    const waits = [];
    const evt = { waitUntil: p => waits.push(p) };
    if (!listeners[type]) throw new Error(`sw.js registered no '${type}' listener`);
    listeners[type](evt);
    return Promise.all(waits);
  }

  /**
   * Fire a fetch event. Resolves to the response sw.js supplied, or null if it
   * declined to call respondWith (i.e. passed the request through).
   */
  function fetchEvent(request) {
    let responded = null;
    const evt = { request, respondWith: p => { responded = p; } };
    listeners.fetch(evt);
    return Promise.resolve(responded);
  }

  return { self, caches: cacheStorage, listeners, calls, fire, fetchEvent };
}

// The cache name sw.js declares, parsed from source rather than duplicated
// here. CACHE gets bumped on every app edit, and a hardcoded copy in the tests
// would turn each of those bumps into a spurious failure.
const CACHE = (() => {
  const m = /const CACHE = '([^']+)'/.exec(fs.readFileSync(SW_PATH, 'utf8'));
  if (!m) throw new Error('sw-shim: could not find the CACHE constant in sw.js');
  return m[1];
})();

module.exports = { loadSW, makeResponse, makeRequest, makeCaches, urlOf, BASE, SW_PATH, CACHE };
