# Service Worker and Self-Hosted Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a cold launch of the Home Screen app work with no network, while still delivering pushes silently.

**Architecture:** A new `sw.js` precaches the shell and five self-hosted fonts at install, then serves navigations stale-while-revalidate and fonts cache-first. The Google Fonts CDN is removed entirely. Settings gains a build-version readout (from the cached response's `last-modified`) and a force-update escape hatch.

**Tech Stack:** Vanilla JS, no build step. Service Worker API + CacheStorage. Tests are `node:test` against two harnesses: the existing `tools/app-shim.js` (evals `index.html`'s script under a DOM shim) and a new `tools/sw-shim.js` (evals `sw.js` under a ServiceWorkerGlobalScope shim).

**Global Constraints:**
- Cache name is `gains-v1`; bump only when `sw.js` logic or `PRECACHE` changes, never for routine `index.html` pushes
- `PRECACHE` has exactly 7 entries and all paths are **relative** (`./…`) so scope resolves under the `/gAIns/` project page
- Only `res.ok && res.status === 200` responses may be cached — a cached 404 becomes a permanent broken shell
- The background revalidation must have its own `.catch`; the cached response is committed before the network attempt
- The service worker handles same-origin `GET` only; everything else passes through untouched
- Force update clears caches and service worker registrations **only** — never `localStorage`
- `unicode-range` is deliberately omitted from every `@font-face`
- Baseline is 204 passing tests via `node --test tools/*.test.js` (the directory form fails on this Node version); every task leaves the suite green

**User decisions (already made):**
- Update model: silent, applies on next launch — launch speed beats freshness on the gym floor
- Both a version string and a force-update button in Settings
- Version comes automatically from `last-modified`, not a manual constant
- Precache-at-install + stale-while-revalidate (Approach A), over runtime-only caching or network-first
- Self-hosted separate `.woff2` files, **not** base64 inlining — inlining predates the SW and would grow `index.html` 190 KB → 323 KB

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `fonts/*.woff2` | Five self-hosted font files | Create |
| `fonts/LICENSE.txt` | Full OFL 1.1 text, copyright lines, source URLs | Create |
| `sw.js` | Service worker: precache, lifecycle, fetch routing | Create |
| `index.html` | `@font-face` blocks, `<head>` cleanup, SW registration, Settings panel | Modify |
| `tools/sw-shim.js` | Evals `sw.js` under a ServiceWorkerGlobalScope shim | Create |
| `tools/sw.test.js` | 9 service worker cases | Create |
| `tools/offline-ui.test.js` | 4 Settings-UI cases | Create |
| `tools/app-shim.js` | Add `caches` + `navigator.serviceWorker` stubs | Modify |
| `README.md` | Correct the stale font names | Modify |
| `TODO.md` | Mark item 2 done | Modify |

**Test arithmetic:** 204 baseline → 205 (T1) → 208 (T2) → 214 (T3) → 215 (T4) → 218 (T5) → 220 (T6) → 220 (T7). **Verify this yourself at each task and report any disagreement — the counts in previous plans of this project have been wrong three times, and the implementer was right each time.**

---

### Task 1: Self-host the fonts

**Goal:** The three font families load from our own origin, with no third-party request on the critical path.

**Files:**
- Create: `fonts/oswald-var.woff2`, `fonts/archivo-var.woff2`, `fonts/ibm-plex-mono-{400,500,600}.woff2`
- Create: `fonts/LICENSE.txt`
- Modify: `index.html` — remove lines 13–15 (`preconnect` ×2 + CDN stylesheet); add `@font-face` blocks at the top of the `<style>` block
- Modify: `README.md` — font names are stale
- Create: `tools/offline-ui.test.js` (first test lands here)

**Acceptance Criteria:**
- [ ] Five `.woff2` files exist under `fonts/`, each non-empty and beginning with the `wOF2` magic bytes
- [ ] `index.html` contains no reference to `fonts.googleapis.com` or `fonts.gstatic.com`
- [ ] Exactly five `@font-face` blocks, all `src`ing `./fonts/*.woff2`
- [ ] Oswald and Archivo declare `font-weight: 400 700`; the three IBM Plex Mono blocks declare `400`, `500`, `600`
- [ ] No `@font-face` block declares `unicode-range`
- [ ] Every block declares `font-display: swap`
- [ ] `fonts/LICENSE.txt` contains the full OFL 1.1 text plus a source URL per file
- [ ] `README.md` names Oswald, IBM Plex Mono, Archivo

**Verify:** `node --test tools/*.test.js` → 205 passing, 0 failing

**Steps:**

- [ ] **Step 1: Download the five latin `.woff2` files**

Fetch the CSS with a modern-browser UA (Google serves `.woff2` only to UAs it recognises), take the **latin** blocks, dedupe, and download. Oswald and Archivo are variable fonts — all their weights resolve to one file each, which is why five files cover eleven declared weights.

```bash
cd /home/skinny/Projects/gAIns
mkdir -p fonts
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
CSS="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Archivo:wght@400;500;600;700&display=swap"
curl -s -A "$UA" "$CSS" -o /tmp/gf.css

# latin blocks only, one URL per line, deduped
awk '/\/\* latin \*\//{f=1} f&&/src:/{print; f=0}' /tmp/gf.css \
  | grep -oE 'https://[^)]+\.woff2' | sort -u > /tmp/font-urls.txt
wc -l /tmp/font-urls.txt   # expect 5
```

Map each URL to its family by inspecting the path segment (`/oswald/`, `/archivo/`, `/ibmplexmono/`) and download with the target names. The three IBM Plex Mono files must be matched to weights by looking at which `@font-face` block in `/tmp/gf.css` references each URL.

```bash
curl -s -A "$UA" "<oswald-url>"   -o fonts/oswald-var.woff2
curl -s -A "$UA" "<archivo-url>"  -o fonts/archivo-var.woff2
curl -s -A "$UA" "<mono-400-url>" -o fonts/ibm-plex-mono-400.woff2
curl -s -A "$UA" "<mono-500-url>" -o fonts/ibm-plex-mono-500.woff2
curl -s -A "$UA" "<mono-600-url>" -o fonts/ibm-plex-mono-600.woff2

# sanity: each must start with the wOF2 magic and be non-trivial in size
for f in fonts/*.woff2; do printf '%s %s %s\n' "$f" "$(head -c4 "$f")" "$(wc -c <"$f")"; done
```

Expect roughly: oswald 21 KB, archivo 34 KB, mono 14–16 KB each.

- [ ] **Step 2: Write `fonts/LICENSE.txt`**

All three families are OFL 1.1, so one copy of the licence text plus three copyright lines suffices. OFL requires the licence *text*, not a reference to it.

Structure the file as:

```
The fonts in this directory are licensed under the SIL Open Font License 1.1.

Oswald — Copyright 2016 The Oswald Project Authors
  https://github.com/googlefonts/OswaldFont
  Fetched from: <oswald-url>

Archivo — Copyright 2017 The Archivo Project Authors
  https://github.com/Omnibus-Type/Archivo
  Fetched from: <archivo-url>

IBM Plex Mono — Copyright 2017 IBM Corp.
  https://github.com/IBM/plex
  Fetched from: <mono-400-url>
                <mono-500-url>
                <mono-600-url>

--------------------------------------------------------------------------
<full SIL OFL 1.1 text>
```

Get the licence body from <https://openfontlicense.org/open-font-license-official-text/> or any of the upstream repos above. Paste the complete text — preamble, permissions, conditions, termination and disclaimer.

- [ ] **Step 3: Write the failing test**

Create `tools/offline-ui.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('F1. fonts are self-hosted with no third-party origin on the critical path', () => {
  const html = HTML();

  // No CDN reference of any kind — stylesheet link or preconnect.
  assert.ok(!/fonts\.googleapis\.com/.test(html), 'index.html still references fonts.googleapis.com');
  assert.ok(!/fonts\.gstatic\.com/.test(html), 'index.html still references fonts.gstatic.com');

  const blocks = html.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.strictEqual(blocks.length, 5, `expected 5 @font-face blocks, found ${blocks.length}`);

  blocks.forEach(b => {
    assert.match(b, /src:\s*url\('\.\/fonts\/[^']+\.woff2'\)/, `@font-face not sourced locally: ${b}`);
    assert.match(b, /font-display:\s*swap/, `@font-face missing font-display: swap: ${b}`);
    // Deliberately omitted: copying Google's latin range would cause silent
    // fallback for characters just outside it.
    assert.ok(!/unicode-range/.test(b), `@font-face must not declare unicode-range: ${b}`);
  });

  // Variable families declare a range; the mono statics declare single weights.
  const weights = blocks.map(b => (b.match(/font-weight:\s*([^;]+);/) || [])[1].trim()).sort();
  assert.deepStrictEqual(weights, ['400', '400 700', '400 700', '500', '600']);

  // Every referenced file must actually exist and be a real woff2.
  const refs = [...html.matchAll(/url\('\.\/(fonts\/[^']+\.woff2)'\)/g)].map(m => m[1]);
  assert.strictEqual(new Set(refs).size, 5, 'expected 5 distinct font files referenced');
  refs.forEach(rel => {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), `missing font file: ${rel}`);
    assert.strictEqual(fs.readFileSync(p).subarray(0, 4).toString('latin1'), 'wOF2',
      `${rel} is not a woff2 file`);
  });

  // OFL obligation: the licence text travels with the files.
  const lic = fs.readFileSync(path.join(ROOT, 'fonts', 'LICENSE.txt'), 'utf8');
  assert.match(lic, /SIL OPEN FONT LICENSE/i, 'LICENSE.txt missing OFL text');
  assert.match(lic, /PERMISSION IS HEREBY GRANTED/i, 'LICENSE.txt appears to be a reference, not the full text');
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test tools/offline-ui.test.js`
Expected: FAIL — `index.html still references fonts.googleapis.com`.

- [ ] **Step 5: Add the `@font-face` blocks**

Insert at the very top of the `<style>` block in `index.html`, immediately after the opening `<style>` tag:

```css
/* Self-hosted so a cold launch never touches a third-party origin. Latin
   subset only; unicode-range is deliberately omitted so any glyph the subset
   lacks falls back to the system font rather than silently to no font.
   Oswald and Archivo are variable — one file covers the whole 400-700 range. */
@font-face {
  font-family: 'Oswald';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/oswald-var.woff2') format('woff2');
}
@font-face {
  font-family: 'Archivo';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/archivo-var.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/ibm-plex-mono-400.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('./fonts/ibm-plex-mono-500.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('./fonts/ibm-plex-mono-600.woff2') format('woff2');
}
```

- [ ] **Step 6: Remove the CDN from `<head>`**

Delete these three consecutive lines (currently `index.html:13-15`):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Leave `--font-display`, `--font-mono`, `--font-body` and every consumer untouched.

- [ ] **Step 7: Fix the README**

In `README.md`, the Tech section reads "Google Fonts loaded via CDN (Bebas Neue, DM Sans, DM Mono)" — wrong on both counts now. Replace with:

```markdown
- Self-hosted fonts (Oswald, IBM Plex Mono, Archivo) — no third-party requests
```

- [ ] **Step 8: Run tests**

Run: `node --test tools/*.test.js`
Expected: 205 passing, 0 failing.

Also confirm the script still parses as a browser would:

```bash
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
```

- [ ] **Step 9: Commit**

```bash
git add fonts/ index.html README.md tools/offline-ui.test.js
git commit -m "feat: self-host fonts, removing the CDN from the critical path"
```

---

### Task 2: Service worker harness, install and activate

**Goal:** `sw.js` precaches the shell atomically and cleans up stale caches, with a harness that can drive it headlessly.

**Files:**
- Create: `sw.js`
- Create: `tools/sw-shim.js`
- Create: `tools/sw.test.js`

**Acceptance Criteria:**
- [ ] `install` precaches exactly the 7 `PRECACHE` entries
- [ ] A single failing entry aborts the whole install — the cache is left empty, not partial
- [ ] `install` calls `skipWaiting()`
- [ ] `activate` deletes every cache whose name is not `gains-v1` and keeps that one
- [ ] `activate` calls `clients.claim()`
- [ ] All `PRECACHE` paths are relative

**Verify:** `node --test tools/*.test.js` → 208 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the harness**

Create `tools/sw-shim.js`. It mirrors `app-shim.js`'s philosophy — eval the real file under a fake global and hand back live handles — but the fake global here is a ServiceWorkerGlobalScope rather than a DOM.

```js
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

module.exports = { loadSW, makeResponse, makeRequest, makeCaches, urlOf, BASE, SW_PATH };
```

- [ ] **Step 2: Write the failing tests**

Create `tools/sw.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tools/sw.test.js`
Expected: FAIL — `ENOENT` on `sw.js`, since it does not exist yet.

- [ ] **Step 4: Write `sw.js` (lifecycle only)**

Create `sw.js` at the repo root. The `fetch` handler lands in Task 3 — this task stops at `activate`.

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 208 passing, 0 failing.

- [ ] **Step 6: Prove test 2 is not vacuous**

Temporarily change `cache.addAll(PRECACHE)` to a loop that ignores failures:

```js
.then(cache => Promise.all(PRECACHE.map(u =>
  fetch(u).then(r => r.ok && cache.put(u, r)).catch(() => {}))))
```

Run `node --test tools/sw.test.js` — **test 2 must FAIL** (the cache will hold 6 of 7 entries). Restore `addAll` and confirm green. Report both results.

- [ ] **Step 7: Commit**

```bash
git add sw.js tools/sw-shim.js tools/sw.test.js
git commit -m "feat: service worker precache and lifecycle, with a headless harness"
```

---

### Task 3: Service worker fetch routing

**Goal:** Navigations serve instantly from cache and refresh in the background; fonts are cache-first; nothing else is intercepted.

**Files:**
- Modify: `sw.js` — add the `fetch` listener and its two helpers
- Modify: `tools/sw.test.js` — six more cases

**Acceptance Criteria:**
- [ ] A navigation request is answered from the cached `./index.html`
- [ ] After a navigation, the cache holds the newly fetched body (background revalidation ran)
- [ ] A navigation while the network is down still resolves to the cached response and does not reject
- [ ] A non-200 network response is never written to the cache
- [ ] A `./fonts/*.woff2` request is answered from cache without hitting the network
- [ ] Cross-origin requests are not intercepted (`respondWith` not called)
- [ ] Non-`GET` requests are not intercepted

**Verify:** `node --test tools/*.test.js` → 214 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/sw.test.js`:

```js
const { makeRequest } = require('./sw-shim');

function navigate(url = './') {
  return makeRequest(url, { mode: 'navigate' });
}

test('4. a navigation is served from the cached shell', async () => {
  const sw = loadSW({ fetchImpl: () => Promise.resolve(makeResponse({ body: 'NETWORK' })) });
  await sw.fire('install');
  sw.caches._seed('gains-v1', './index.html', makeResponse({ body: 'CACHED' }));
  const res = await sw.fetchEvent(navigate());
  assert.ok(res, 'sw declined to handle a navigation');
  assert.strictEqual((await res).body, 'CACHED');
});

test('5. a navigation refreshes the cache in the background', async () => {
  const sw = loadSW({ fetchImpl: () => Promise.resolve(makeResponse({ body: 'NEW BUILD' })) });
  await sw.fire('install');
  sw.caches._seed('gains-v1', './index.html', makeResponse({ body: 'OLD BUILD' }));
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
  sw.caches._seed('gains-v1', './index.html', makeResponse({ body: 'CACHED' }));
  const res = await sw.fetchEvent(navigate());
  const settled = await res;   // must not throw
  assert.strictEqual(settled.body, 'CACHED');
  await new Promise(r => setImmediate(r));
});

test('7. a non-200 response is never cached', async () => {
  // Guards the worst deploy failure: caching GitHub Pages' 404 page as the app
  // shell, then serving it offline forever.
  const sw = loadSW({ fetchImpl: () => Promise.resolve(makeResponse({ status: 404, body: 'NOT FOUND' })) });
  sw.caches._seed('gains-v1', './index.html', makeResponse({ body: 'GOOD SHELL' }));
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sw.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'fetch')`, since no `fetch` listener is registered yet.

- [ ] **Step 3: Add the fetch handler to `sw.js`**

Append to `sw.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 214 passing, 0 failing.

- [ ] **Step 5: Prove tests 6 and 7 are not vacuous**

Two separate experiments; report both.

**Test 6:** remove `.catch(() => null)` from the network promise in `staleWhileRevalidate`. Run `node --test tools/sw.test.js`. Test 6 must fail or the process must report an unhandled rejection. Restore.

**Test 7:** change the guard to `if (res) cache.put(...)`. Run again — test 7 must FAIL with the 404 body overwriting the shell. Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add sw.js tools/sw.test.js
git commit -m "feat: stale-while-revalidate navigation and cache-first fonts"
```

---

### Task 4: Register the service worker

**Goal:** The app installs the service worker on load, and degrades silently where the API is unavailable.

**Files:**
- Modify: `index.html` — registration inside `boot()`
- Modify: `tools/app-shim.js` — add `caches` and `navigator.serviceWorker` to the shim
- Modify: `tools/offline-ui.test.js` — one case

**Acceptance Criteria:**
- [ ] `boot()` registers `./sw.js` when `navigator.serviceWorker` exists
- [ ] The path is relative, so scope resolves under `/gAIns/`
- [ ] A missing `navigator.serviceWorker` does not throw — the app boots normally
- [ ] A rejected registration does not throw
- [ ] `GLOBAL_KEYS` includes `caches`, so the stub is torn down between tests

**Verify:** `node --test tools/*.test.js` → 215 passing, 0 failing

**Steps:**

- [ ] **Step 1: Extend the DOM shim**

In `tools/app-shim.js`, add `'caches'` to `GLOBAL_KEYS`:

```js
const GLOBAL_KEYS = [
  'window', 'document', 'localStorage', 'navigator', 'Notification',
  'AudioContext', 'webkitAudioContext', 'Blob', 'URL', 'FileReader', 'caches',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'requestAnimationFrame', 'alert',
];
```

`navigator` is already in the list, so the service-worker stub rides on the existing `setGlobal('navigator', …)`. Replace that line so tests can observe registration and unregistration:

```js
  // Records registrations so tests can assert on them; `_regs` doubles as the
  // list getRegistrations() returns, so unregister() is observable too.
  const swRegs = [];
  const swStub = {
    _registered: [],
    _regs: swRegs,
    register: (path, opts) => {
      swStub._registered.push({ path, opts });
      const reg = { scope: path, unregister: () => { reg._unregistered = true; return Promise.resolve(true); } };
      swRegs.push(reg);
      return Promise.resolve(reg);
    },
    getRegistrations: () => Promise.resolve(swRegs.slice()),
  };
  setGlobal('navigator', { userAgent: 'node', vibrate() {}, serviceWorker: swStub });
  setGlobal('caches', undefined);
```

Expose both on the api object, alongside the existing `Object.assign` / `Object.defineProperties` block:

```js
  Object.defineProperties(api, {
    lastBlob: { get: () => lastBlob, enumerable: true },
    clickHandler: { get: () => clickHandler, enumerable: true },
    swStub: { value: swStub, enumerable: true },
  });
```

Keep every existing property in that block exactly as it is — Task 5 of the timestamps work fixed a real bug there (`Object.assign` snapshots getters instead of installing accessors), and reverting it would silently break `lastBlob`.

- [ ] **Step 2: Write the failing test**

Append to `tools/offline-ui.test.js`:

```js
const { withApp, loadApp } = require('./app-shim');

function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

test('F2. boot registers the service worker with a relative path', () => {
  withApp({ storage: allSeenSeed() }, app => {
    assert.strictEqual(app.swStub._registered.length, 1, 'boot did not register a service worker');
    // Relative, or scope resolves to the domain root instead of /gAIns/.
    assert.strictEqual(app.swStub._registered[0].path, './sw.js');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tools/offline-ui.test.js`
Expected: FAIL — `boot did not register a service worker`.

- [ ] **Step 4: Register in `boot()`**

In `index.html`, inside `boot()`, immediately after `render();`:

```js
  // Relative path: on the /gAIns/ project page an absolute '/sw.js' would
  // resolve to the domain root and the registration would 404.
  // Failures are deliberately silent — the app works fine without a service
  // worker, it just loses offline launch.
  if ('serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./sw.js').catch(() => {}); } catch (e) {}
  }
```

- [ ] **Step 5: Run tests**

Run: `node --test tools/*.test.js`
Expected: 215 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add index.html tools/app-shim.js tools/offline-ui.test.js
git commit -m "feat: register the service worker on boot"
```

---

### Task 5: Settings build-version readout

**Goal:** Settings shows which build is cached, so "did my push land?" is answerable on the phone.

**Files:**
- Modify: `index.html` — `view.buildTime`, async read in `boot()`, new panel in `settingsHTML()`
- Modify: `tools/offline-ui.test.js` — three cases

**Acceptance Criteria:**
- [ ] Settings renders `Build <local date and time>` when a cached response carries `last-modified`
- [ ] Renders `Offline cache: preparing` when `caches` exists but nothing matches, or the match has no `last-modified`
- [ ] Renders `Offline cache: unavailable` when `caches` is absent
- [ ] The timestamp is rendered in device-local time, not the raw GMT string
- [ ] The lookup uses the global `caches.match()`, so the cache name is not duplicated into `index.html`

**Verify:** `node --test tools/*.test.js` → 218 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/offline-ui.test.js`:

```js
function cachesStub(response) {
  return { match: () => Promise.resolve(response) };
}
function fakeRes(headers) {
  return { headers: { get: k => headers[k.toLowerCase()] || null } };
}

// boot() starts the read asynchronously; give the microtask queue a turn, then
// re-render so settingsHTML() sees the resolved value.
function settleAndRenderSettings(app) {
  return new Promise(r => setImmediate(r)).then(() => {
    app.view.name = 'settings';
    app.render();
    return app.elements.get('scroll').innerHTML;
  });
}

test('F3. settings shows the cached build time in local time', async () => {
  const lm = 'Wed, 29 Jul 2026 15:36:34 GMT';
  let html;
  await withApp({ storage: allSeenSeed() }, app => {
    global.caches = cachesStub(fakeRes({ 'last-modified': lm }));
    return null;
  });
  // Re-load with the stub present from the start so boot() sees it.
  global.caches = cachesStub(fakeRes({ 'last-modified': lm }));
  const { withApp: w } = require('./app-shim');
  await new Promise(resolve => {
    w({ storage: allSeenSeed() }, app => {
      settleAndRenderSettings(app).then(out => { html = out; resolve(); });
      return null;
    });
  });

  assert.match(html, /Build /, 'no build line rendered');
  // Local rendering of that instant — never the raw GMT string.
  const expect = new Date(Date.parse(lm));
  const y = expect.getFullYear();
  assert.ok(html.includes(String(y)), `build line missing local year ${y}`);
  assert.ok(!html.includes('GMT'), 'raw GMT string leaked into the UI');
});

test('F4. settings distinguishes preparing from unavailable', async () => {
  // caches present but empty -> preparing
  global.caches = cachesStub(undefined);
  let html = await new Promise(resolve => {
    require('./app-shim').withApp({ storage: allSeenSeed() }, app => {
      settleAndRenderSettings(app).then(resolve);
      return null;
    });
  });
  assert.match(html, /Offline cache: preparing/);

  // caches absent entirely -> unavailable
  global.caches = undefined;
  html = await new Promise(resolve => {
    require('./app-shim').withApp({ storage: allSeenSeed() }, app => {
      settleAndRenderSettings(app).then(resolve);
      return null;
    });
  });
  assert.match(html, /Offline cache: unavailable/);
});

test('F5. a cached response without last-modified reads as preparing', async () => {
  global.caches = cachesStub(fakeRes({}));
  const html = await new Promise(resolve => {
    require('./app-shim').withApp({ storage: allSeenSeed() }, app => {
      settleAndRenderSettings(app).then(resolve);
      return null;
    });
  });
  assert.match(html, /Offline cache: preparing/);
});
```

If `withApp`'s synchronous-callback contract makes the above awkward, prefer adding a `loadAppAsync`-style helper to `sw-shim`/`app-shim` over weakening the assertions — but first try simply assigning `global.caches` before the `withApp` call, since `setupApp` reads globals at eval time.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/offline-ui.test.js`
Expected: FAIL — no build line is rendered.

- [ ] **Step 3: Add the state field and reader**

In `index.html`, add `buildTime: null` to the `view` object literal, then add this helper next to the other Settings helpers:

```js
// Read the build stamp off whatever the service worker cached. Uses the global
// caches.match(), which searches every cache — so index.html never needs to
// know the worker's cache name, and the two can't drift apart.
// Returns: a Date, 'preparing', or 'unavailable'.
function readBuildTime() {
  if (typeof caches === 'undefined' || !caches) return Promise.resolve('unavailable');
  return caches.match('./index.html')
    .then(res => {
      const lm = res && res.headers && res.headers.get('last-modified');
      if (!lm) return 'preparing';
      const t = Date.parse(lm);
      return isNaN(t) ? 'preparing' : new Date(t);
    })
    .catch(() => 'preparing');
}

function fmtBuild(v) {
  if (v === 'unavailable') return 'Offline cache: unavailable';
  if (!v || v === 'preparing') return 'Offline cache: preparing';
  const p = n => String(n).padStart(2, '0');
  // Local time deliberately: this answers "did my push land?", and comparing a
  // GMT string against when you hit deploy needs mental arithmetic.
  return `Build ${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}`;
}
```

In `boot()`, after the service worker registration added in Task 4:

```js
  readBuildTime().then(v => { view.buildTime = v; render(); });
```

- [ ] **Step 4: Add the Settings panel**

In `settingsHTML()`, insert immediately before the `THIS WEEK` panel:

```js
    <div class="panel" style="margin-left:0;margin-right:0">
      <div class="panel-h">OFFLINE &amp; UPDATES</div>
      <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;margin-bottom:12px">The app is cached on your phone and opens without a network. New versions install in the background and appear the next time you open it.</div>
      <div class="kv"><span>Version</span><span class="mono">${esc(fmtBuild(view.buildTime))}</span></div>
    </div>
```

- [ ] **Step 5: Run tests**

Run: `node --test tools/*.test.js`
Expected: 218 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add index.html tools/offline-ui.test.js
git commit -m "feat: show the cached build version in settings"
```

---

### Task 6: Force-update escape hatch

**Goal:** A bad cached version can be recovered from inside the app, without losing training data.

**Files:**
- Modify: `index.html` — button, confirm branch, `forceUpdate()`
- Modify: `tools/offline-ui.test.js` — two cases

**Acceptance Criteria:**
- [ ] Settings has a `data-act="forceupdate"` button
- [ ] Tapping it opens the existing confirm dialog rather than acting immediately
- [ ] Confirm copy states that logged data is not affected
- [ ] Confirming deletes every cache and unregisters every service worker
- [ ] **`localStorage` is untouched** — every key present before is present after with the same value
- [ ] The page reloads afterwards

**Verify:** `node --test tools/*.test.js` → 220 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/offline-ui.test.js`:

```js
test('F6. force update goes through the confirm dialog, not straight to action', () => {
  global.caches = cachesStub(undefined);
  withApp({ storage: allSeenSeed() }, app => {
    app.view.name = 'settings';
    app.render();
    click(app, { act: 'forceupdate' });
    assert.ok(app.view.confirm, 'no confirm dialog was opened');
    assert.strictEqual(app.view.confirm.act, 'forceupdate');
    // The recovery button must not read as scary as the destructive one, or it
    // won't be used at the moment it is needed.
    assert.match(app.view.confirm.msg, /not affected/i,
      'confirm copy does not reassure that logged data survives');
  });
});

test('F7. confirming force update clears caches and SWs but never localStorage', async () => {
  const deleted = [];
  global.caches = {
    match: () => Promise.resolve(undefined),
    keys: () => Promise.resolve(['gains-v1', 'stale-cache']),
    delete: n => { deleted.push(n); return Promise.resolve(true); },
  };
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    hypertrophy_state_meso1_w1: '{"day1":{"sets":{}}}',
  });

  await new Promise(resolve => {
    withApp({ storage: seed }, app => {
      const before = JSON.stringify(app.storage._store);
      app.view.name = 'settings';
      app.render();
      click(app, { act: 'forceupdate' });
      click(app, { act: 'cfok' });
      setImmediate(() => {
        assert.deepStrictEqual(deleted.sort(), ['gains-v1', 'stale-cache']);
        assert.ok(app.swStub._regs.length > 0, 'no service worker was registered to unregister');
        assert.ok(app.swStub._regs.every(r => r._unregistered), 'a service worker was left registered');
        // The whole point: this is a recovery button, not a data-loss button.
        assert.strictEqual(JSON.stringify(app.storage._store), before,
          'force update modified localStorage');
        resolve();
      });
      return null;
    });
  });
});
```

Add the `click` helper at the top of the file if not already present:

```js
function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/offline-ui.test.js`
Expected: FAIL — `no confirm dialog was opened`.

- [ ] **Step 3: Add `forceUpdate()`**

In `index.html`, next to `readBuildTime()`:

```js
// Recovery path for a bad cached build. In display:standalone there is no
// address bar and no reload button, so without this the only way out is
// clearing site data in iOS Settings — which would also delete localStorage,
// i.e. the entire training history. This deliberately touches caches and
// service worker registrations ONLY.
function forceUpdate() {
  const jobs = [];
  if (typeof caches !== 'undefined' && caches && caches.keys) {
    jobs.push(caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))));
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    jobs.push(navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister()))));
  }
  return Promise.all(jobs)
    .catch(() => {})
    .then(() => { if (typeof location !== 'undefined' && location.reload) location.reload(); });
}
```

- [ ] **Step 4: Add the button and confirm branch**

Add to the OFFLINE & UPDATES panel, after the Version row:

```js
      <button class="big-btn ghost" style="margin-top:12px" data-act="forceupdate">FORCE UPDATE</button>
```

In the delegated click handler, before the final `else return;`:

```js
  else if (act === 'forceupdate') {
    view.confirm = {
      title: 'Force Update?',
      msg: 'Clears the offline cache and reloads the app. Your logged data is not affected.',
      act: 'forceupdate',
    };
  }
```

And in the `cfok` branch, alongside the existing cases:

```js
    else if (c.act === 'forceupdate') forceUpdate();
```

- [ ] **Step 5: Run tests**

Run: `node --test tools/*.test.js`
Expected: 220 passing, 0 failing.

- [ ] **Step 6: Prove test F7's localStorage assertion is not vacuous**

Add `localStorage.clear();` as the first line of `forceUpdate()`. Run `node --test tools/offline-ui.test.js` — **F7 must FAIL** with `force update modified localStorage`. Remove the line and confirm green. Report both results.

- [ ] **Step 7: Verify the script still parses**

```bash
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
node tools/smoke-render.js
```

- [ ] **Step 8: Commit**

```bash
git add index.html tools/offline-ui.test.js
git commit -m "feat: force-update escape hatch that leaves logged data alone"
```

---

### Task 7: Update TODO.md

**Goal:** The backlog reflects what shipped.

**Files:**
- Modify: `TODO.md`

**Acceptance Criteria:**
- [ ] Tier 1 item 2 marked done with the date
- [ ] Its four checklist items are ticked
- [ ] The problem description is past-tensed or bridged, so it does not contradict its own `done` status
- [ ] Item 7's checklist notes that `data/programs.json` must be added to `PRECACHE` when it lands
- [ ] Items 1, 3, 4, 5, 6, 8 are untouched

**Verify:** `git diff --stat TODO.md` shows only `TODO.md`; `node --test tools/*.test.js` → 220 passing

**Steps:**

- [ ] **Step 1: Mark item 2 done**

Replace item 2's status line and bridge its problem statement, mirroring how item 1 was handled:

```markdown
**Status:** done — 2026-07-30. See
`docs/superpowers/specs/2026-07-30-service-worker-design.md`.

*The problem this solved, as it stood before 2026-07-30:*

GitHub Pages hard-coded `cache-control: max-age=600` on `index.html` and offered
no way to change it. More than 10 minutes after the last load, every cold launch
needed live network — and in `display: standalone` a failure was a blank screen
with no reload affordance. Fonts (Oswald, IBM Plex Mono, Archivo) came from the
Google Fonts CDN, adding a third-party origin to the critical path.
```

Tick all four checklist items.

- [ ] **Step 2: Note the precache dependency on item 7**

Item 7 extracts `PROGRAMS` to `data/programs.json`. Its existing checklist already says "Ensure the service worker caches it alongside the shell" — make that concrete now that the worker exists:

```markdown
- [ ] Add `./data/programs.json` to `PRECACHE` in `sw.js` and bump `CACHE` to
      `gains-v2` (a precache-list change is exactly when the bump is required)
```

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "docs: mark service worker done, note precache dependency for item 7"
```

---

## Manual verification before merge

Two things no headless test can cover. Both must be done in a real browser.

1. **Rendering is visually unchanged.** Same families, same weights, same `swap`. Load the page and compare against master — particularly the masthead (Oswald), set-grid numerals (IBM Plex Mono) and body copy (Archivo).
2. **An actual offline cold launch works.** Load the page, confirm the service worker is active in devtools, tick Offline, hard-reload. The app must open fully styled. This is the entire point of the work and cannot be asserted from Node.

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — fonts and licensing → Task 1; SW lifecycle → Task 2; fetch routing → Task 3; registration → Task 4; build version → Task 5; force update → Task 6; backlog → Task 7. The spec's manual-verification section is carried forward above. The spec's note that item 7 will add an eighth precache entry is captured in Task 7 Step 2.

**Placeholder scan:** No TBD/TODO markers. Every code step carries real code. The only deliberately unfilled values are the five font URLs in Task 1, which are extracted by the command given in the same step and cannot be hard-coded — Google versions the paths (`/v25/`, `/v57/`) and they change.

**Type consistency:** `CACHE` and `PRECACHE` are defined in Task 2 and consumed in Task 3. `cacheable(res)` is defined once in Task 3 and used by both strategies. `readBuildTime()` returns `Date | 'preparing' | 'unavailable'` in Task 5 and `fmtBuild()` accepts exactly that union. `forceUpdate()` in Task 6 takes no arguments and returns a promise. `app.swStub` is added in Task 4 and used in Tasks 4 and 6. Cache name is `gains-v1` everywhere.

**Known soft spot:** the async-render tests in Task 5 fight `withApp`'s synchronous-callback contract. The step says so explicitly and directs the implementer to add an async helper rather than weaken the assertions. If it reports back that the helper is needed, that is expected, not scope creep.
