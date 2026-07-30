'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadSW, makeResponse, BASE } = require('./sw-shim');

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
  assert.deepStrictEqual([...dump.keys()], ['gains-v1']);
  assert.deepStrictEqual([...dump.get('gains-v1').keys()].sort(), [...EXPECTED_PRECACHE].sort());
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
  const entries = dump.get('gains-v1');
  assert.strictEqual(entries ? entries.size : 0, 0, 'install left a partially populated cache');
});

test('3. activate deletes foreign caches and keeps the current one', async () => {
  const sw = loadSW();
  sw.caches._seed('gains-v0', './index.html', makeResponse({ body: 'old' }));
  sw.caches._seed('something-else', './x', makeResponse());
  await sw.fire('install');
  await sw.fire('activate');
  assert.deepStrictEqual([...sw.caches._dump().keys()], ['gains-v1']);
  assert.strictEqual(sw.calls.claim, 1, 'activate did not call clients.claim()');
});
