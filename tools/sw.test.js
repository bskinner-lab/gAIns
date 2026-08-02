'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadSW, makeResponse, BASE, CACHE } = require('./sw-shim');

const EXPECTED_PRECACHE = [
  'https://example.test/gAIns/',
  'https://example.test/gAIns/index.html',
  'https://example.test/gAIns/fonts/oswald-var.woff2',
  'https://example.test/gAIns/fonts/archivo-var.woff2',
  'https://example.test/gAIns/fonts/ibm-plex-mono-400.woff2',
  'https://example.test/gAIns/fonts/ibm-plex-mono-500.woff2',
  'https://example.test/gAIns/fonts/ibm-plex-mono-600.woff2',
];

test('1. install precaches exactly the seven shell entries', async () => {
  const sw = loadSW();
  await sw.fire('install');
  const dump = sw.caches._dump();
  assert.deepStrictEqual([...dump.keys()], [CACHE]);
  assert.deepStrictEqual([...dump.get(CACHE).keys()].sort(), [...EXPECTED_PRECACHE].sort());
  assert.strictEqual(sw.calls.skipWaiting, 1, 'install did not call skipWaiting()');
});

test('2. one failed entry aborts the whole install — no partial cache', async () => {
  // A half-populated cache is worse than none: the app would look installed
  // and then render without fonts offline.
  const sw = loadSW({
    fetchImpl: req => Promise.resolve(
      /archivo/.test(req.url) ? makeResponse({ status: 404 }) : makeResponse()
    ),
  });
  await assert.rejects(() => sw.fire('install'), /addAll failed/);
  const dump = sw.caches._dump();
  const entries = dump.get(CACHE);
  assert.strictEqual(entries ? entries.size : 0, 0, 'install left a partially populated cache');
});

test('3. activate deletes foreign caches and keeps the current one', async () => {
  const sw = loadSW();
  sw.caches._seed('gains-v0', './index.html', makeResponse({ body: 'old' }));
  sw.caches._seed('something-else', './x', makeResponse());
  await sw.fire('install');
  await sw.fire('activate');
  assert.deepStrictEqual([...sw.caches._dump().keys()], [CACHE]);
  assert.strictEqual(sw.calls.claim, 1, 'activate did not call clients.claim()');
});

const { makeRequest } = require('./sw-shim');

function navigate(url = './') {
  return makeRequest(url, { mode: 'navigate' });
}

test('4. a navigation is served from the cached shell', async () => {
  const sw = loadSW({ fetchImpl: () => Promise.resolve(makeResponse({ body: 'NETWORK' })) });
  await sw.fire('install');
  sw.caches._seed(CACHE, './index.html', makeResponse({ body: 'CACHED' }));
  const res = await sw.fetchEvent(navigate());
  assert.ok(res, 'sw declined to handle a navigation');
  assert.strictEqual((await res).body, 'CACHED');
});

test('5. a navigation refreshes the cache in the background', async () => {
  const sw = loadSW({ fetchImpl: () => Promise.resolve(makeResponse({ body: 'NEW BUILD' })) });
  await sw.fire('install');
  sw.caches._seed(CACHE, './index.html', makeResponse({ body: 'OLD BUILD' }));
  const res = await sw.fetchEvent(navigate());
  assert.strictEqual((await res).body, 'OLD BUILD', 'should serve stale immediately');
  // Let the revalidation microtasks settle, then confirm the next launch wins.
  await new Promise(r => setImmediate(r));
  const stored = await sw.caches.match('./index.html');
  assert.strictEqual(stored.body, 'NEW BUILD', 'background revalidation did not update the cache');
});

test('6. an offline navigation still resolves from cache and does not reject', async () => {
  // The whole point of the feature. If the network promise is not caught, this
  // is where an offline launch breaks.
  const sw = loadSW({ fetchImpl: () => Promise.reject(new TypeError('offline')) });
  sw.caches._seed(CACHE, './index.html', makeResponse({ body: 'CACHED' }));
  const res = await sw.fetchEvent(navigate());
  const settled = await res;   // must not throw
  assert.strictEqual(settled.body, 'CACHED');
  await new Promise(r => setImmediate(r));
});

test('7. a non-200 response is never cached', async () => {
  // Guards the worst deploy failure: caching GitHub Pages' 404 page as the app
  // shell, then serving it offline forever.
  const sw = loadSW({ fetchImpl: () => Promise.resolve(makeResponse({ status: 404, body: 'NOT FOUND' })) });
  sw.caches._seed(CACHE, './index.html', makeResponse({ body: 'GOOD SHELL' }));
  await sw.fetchEvent(navigate());
  await new Promise(r => setImmediate(r));
  const stored = await sw.caches.match('./index.html');
  assert.strictEqual(stored.body, 'GOOD SHELL', 'a 404 response overwrote the cached shell');
});

test('8. fonts are served cache-first without touching the network', async () => {
  let hits = 0;
  const sw = loadSW({ fetchImpl: () => { hits++; return Promise.resolve(makeResponse({ body: 'NET' })); } });
  await sw.fire('install');
  hits = 0;
  const res = await sw.fetchEvent(makeRequest('./fonts/oswald-var.woff2'));
  assert.ok(res, 'sw declined to handle a font request');
  await res;
  assert.strictEqual(hits, 0, 'font request hit the network despite being cached');
});

test('9. cross-origin and non-GET requests pass through untouched', async () => {
  const sw = loadSW();
  await sw.fire('install');
  assert.strictEqual(
    await sw.fetchEvent({ url: 'https://other.test/thing.js', method: 'GET', mode: 'no-cors' }),
    null, 'intercepted a cross-origin request');
  assert.strictEqual(
    await sw.fetchEvent(makeRequest('./index.html', { method: 'POST', mode: 'navigate' })),
    null, 'intercepted a non-GET request');
});
