# Service Worker and Self-Hosted Fonts — Design

**Date:** 2026-07-30
**Backlog item:** TODO.md Tier 1 #2
**Branch:** `feat/service-worker` (off master `1d92e5b`)

## Problem

The app is hosted on GitHub Pages and saved to the iOS Home Screen with
`display: standalone`. Two facts combine badly.

**GitHub Pages hard-codes `cache-control: max-age=600` on `index.html`** and
offers no way to change it. More than ten minutes after the last load, every
cold launch requires a live network request for the shell.

**In `display: standalone` there is no address bar and no reload button.** A
failed launch is a blank screen with no affordance to recover from.

Together: walk into a gym with poor signal, tap the icon, and the app does not
open. Not "degrades" — fails to load. This is the single worst reliability
problem in the app, and it hits at exactly the moment the app is needed.

Compounding it, the three fonts (Oswald, IBM Plex Mono, Archivo) load from the
Google Fonts CDN, putting a third-party origin on the critical path of every
cold start.

## Goals

1. A cold launch never requires the network
2. Pushes still reach the phone, without the user doing anything
3. No third-party origin in the critical path
4. A recovery path exists if a bad version is ever cached
5. The user can tell which build they are running

## Non-goals

- Offline mutation queues or background sync — all state is already local
- Precaching program data — `PROGRAMS` is still inline in `index.html`
  (TODO.md item 7 extracts it; the precache list gains one entry then)
- Push notifications
- Any change to the rest timer, state model, or export/import

## User decisions

Confirmed during design:

- **Update model:** silent, applies on next launch. Launch speed beats freshness
  on the gym floor; being one launch behind is acceptable.
- **Escape hatch:** both a version string and a force-update button in Settings.
- **Version source:** automatic, from the cached response's `last-modified`
  header. No manual constant to forget.
- **Caching architecture:** precache at install plus stale-while-revalidate for
  navigation (Approach A below).

## Font payload — measured

Measured against the live Google Fonts CSS, latin subset only:

| File | Size |
| --- | --- |
| `oswald-var.woff2` (variable, 400–700) | 21 KB |
| `archivo-var.woff2` (variable, 400–700) | 34 KB |
| `ibm-plex-mono-400.woff2` | 14 KB |
| `ibm-plex-mono-500.woff2` | 15 KB |
| `ibm-plex-mono-600.woff2` | 15 KB |
| **Total** | **99 KB** |

The CDN request names eleven weight variants, but Oswald and Archivo are
variable fonts — all four weights of each resolve to a single file. Only IBM
Plex Mono ships static per-weight files. Five files, not eleven.

### Why not base64-inline them

An earlier recommendation, made before a service worker was in scope, was to
inline the fonts as base64 `@font-face` data. Superseded:

- base64 inflates 99 KB to 132 KB, growing `index.html` from 190 KB to 323 KB
- every `index.html` push would re-download all 132 KB of font data
- the service worker precaches separate files just as reliably

Separate self-hosted files are strictly better once a service worker exists.
They remove the third-party origin identically, at lower cost.

## Chosen approach

**Precache at install, stale-while-revalidate for navigation.**

After `install` completes, the app is *guaranteed* fully offline — not "offline
if the right things happened to load."

### Rejected alternatives

**Runtime caching only, no precache.** Simplest service worker, no manifest.
Rejected: a first visit interrupted before every font loads leaves a partially
cached app that renders in fallback fonts on the next offline launch. Low
probability, silent, and defeats the point of making offline deterministic.

**Network-first for navigation, cache as fallback.** Always fresh when online.
Rejected by the user in the update-model decision: it stalls cold launch on a
slow-but-alive connection, which is precisely the gym case.

## The service worker

New file `sw.js` at repo root, registered from `index.html` with a **relative**
path so scope resolves correctly under the project page (`/gAIns/`).

```js
const CACHE = 'gains-v1';
const PRECACHE = [
  './',
  './index.html',
  './fonts/oswald-var.woff2',
  './fonts/archivo-var.woff2',
  './fonts/ibm-plex-mono-400.woff2',
  './fonts/ibm-plex-mono-500.woff2',
  './fonts/ibm-plex-mono-600.woff2',
];
```

`./` and `./index.html` are distinct cache keys for the same resource. Both are
precached because a navigation to `/gAIns/` requests the former.

### Lifecycle

**`install`** — `cache.addAll(PRECACHE)`, then `skipWaiting()`. `addAll` is
atomic: any single failed entry fails the whole install and the previous
service worker stays active. A half-populated cache is worse than none.

**`activate`** — delete every cache whose name is not `CACHE`, then
`clients.claim()`. This is what makes a bumped cache name actually evict the old
one instead of accumulating storage.

**`skipWaiting()` does not contradict the "applies next launch" model.** It
governs when the new *service worker* takes control, not which *HTML* the
current page is displaying. On first install it means the worker controls the
page immediately, so the very first launch is already protected. On a later
update it means the new worker's fetch logic is live at once, while the
already-rendered HTML stays as it was until the next launch — which is exactly
the intended behaviour.

### Fetch routing

Handles same-origin `GET` only. Three routes:

| Request | Strategy | Rationale |
| --- | --- | --- |
| `mode === 'navigate'` | Stale-while-revalidate against `./index.html` | Instant launch from cache; background fetch updates it for the next launch |
| `./fonts/*.woff2` | Cache-first, no revalidation | Content-addressed and immutable; revalidating is waste |
| everything else | Pass through untouched | No opinion on requests we do not own |

Cross-origin requests and non-`GET` methods fall through without interception.

### Two silent failure modes, handled explicitly

**The background revalidation must swallow its own errors.** Offline, that fetch
rejects. The cached response must be committed to `event.respondWith` *before*
the network attempt begins, and the network promise must have its own `.catch`.
Wired carelessly, an offline launch either logs spurious errors or fails
outright.

**Only successful responses may be cached.** Guard on `res.ok && res.status ===
200`. Without it, a bad deploy that serves GitHub Pages' 404 page gets that page
cached as the app shell — and the service worker then serves the 404 offline
indefinitely.

### When the cache name must be bumped

Only when `sw.js`'s own logic or the precache list changes. **Not** for routine
`index.html` pushes, which arrive via revalidation.

This is worth stating explicitly because the common failure of this pattern is
assuming every deploy needs a bump, forgetting once, and concluding the service
worker is broken. It is also why a forgotten bump is benign here.

Browsers revalidate `sw.js` itself on every navigation regardless of
`Cache-Control` (the default `updateViaCache: 'imports'`), so GitHub Pages'
`max-age=600` cannot strand a stale service worker.

## Fonts

New `fonts/` directory at repo root with the five files above.

Five `@font-face` blocks in the existing `<style>` block — two using a weight
range for the variable families, three static for IBM Plex Mono:

```css
@font-face {
  font-family: 'Oswald';
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url('./fonts/oswald-var.woff2') format('woff2');
}
```

`400 700` states the range the app actually uses rather than the font's full
axis. Narrower is safe — the browser clamps.

**`unicode-range` is deliberately omitted.** We ship the latin subset only;
omitting the descriptor means the font applies to all characters with system
fallback for any glyph it lacks. Copying Google's latin `unicode-range` would
instead cause silent fallback for characters just outside it.

**Removed from `<head>`:** the `fonts.googleapis.com` stylesheet link and both
`preconnect` hints.

**Unchanged:** `--font-display`, `--font-mono`, `--font-body` and every consumer.
Nothing downstream of the CSS variables moves.

### Licensing

All three families are OFL, which requires the copyright notice and license text
to accompany the font files. Loading from the CDN outsourced this obligation;
self-hosting makes it ours.

`fonts/LICENSE.txt` carries the **full OFL 1.1 text** — the licence requires the
text itself, not merely a reference to it — together with each family's
copyright line and the `fonts.gstatic.com` source URL it was fetched from, so a
future re-fetch is reproducible.

All three families are OFL 1.1, so one copy of the licence text plus three
copyright lines suffices; separate per-family files are not required.

## Settings UI

A new "OFFLINE & UPDATES" panel following the existing panel markup.

### Build version

```js
const res = await caches.match('./index.html');
const lm  = res && res.headers.get('last-modified');
```

Uses the **global** `caches.match()`, which searches every cache, so
`index.html` never needs to know the service worker's cache name. Duplicating
that constant across two files would drift the first time one was bumped.

`last-modified` arrives as an RFC 1123 GMT string
(`Wed, 29 Jul 2026 15:36:34 GMT`). It is parsed with `Date.parse` and rendered
in the **device's local time**, since the user is reading it to answer "did my
push land?" — a GMT string would need mental arithmetic to compare against when
they hit deploy.

Three states, because an absent version is ambiguous between broken and
unsupported:

| State | Condition | Display |
| --- | --- | --- |
| Cached | `caches.match` resolves and the response carries `last-modified` | `Build 2026-07-30 14:22` |
| Preparing | `caches` exists but `caches.match('./index.html')` resolves `undefined`, or the response has no `last-modified` | `Offline cache: preparing` |
| Unavailable | `'caches' in window` is false | `Offline cache: unavailable` |

The read is async and the render pipeline is synchronous, so `boot()` starts it
and stashes the result in `view.buildTime`; `settingsHTML()` reads it
synchronously like every other view field.

### Force update

Clears all caches, unregisters all service workers, reloads. **Does not touch
`localStorage`.**

Routes through the existing `view.confirm` mechanism, with copy that says so:
*"Clears the offline cache and reloads. Your logged data is not affected."*

The clear-week dialog was recently corrected for understating what it destroys.
This one must be equally precise about what it does *not* destroy — otherwise
the recovery button reads as dangerous as the destructive one and will not be
used at the moment it is needed.

## Testing

`sw.js` has no DOM dependency, which makes it more testable than the app itself.

**New `tools/sw-shim.js`** — evals `sw.js` under a stubbed
`ServiceWorkerGlobalScope`, captures the `install` / `activate` / `fetch`
listeners, and exposes them to be driven against a fake `caches` and `fetch`.
Same philosophy as the existing `tools/app-shim.js`.

**New `tools/sw.test.js`:**

1. `install` precaches exactly the seven entries
2. A single failed entry aborts the whole install — no partial cache
3. `activate` deletes foreign caches and keeps the current one
4. Navigation serves from cache when present
5. Navigation triggers background revalidation that updates the cache
6. Revalidation failure while offline does not reject the response
7. A non-200 response is never cached
8. Font requests are served cache-first
9. Cross-origin and non-`GET` requests pass through untouched

**New `tools/offline-ui.test.js`**, requiring `caches` and
`navigator.serviceWorker` stubs added to `app-shim.js`'s `GLOBAL_KEYS`:

10. Build time renders from a stubbed cached response
11. Both degraded states render correctly
12. Force update clears caches and unregisters service workers but leaves
    `localStorage` untouched
13. Force update routes through the confirm dialog rather than firing on first
    tap

Cases **2, 6, 7 and 12** are load-bearing. Each fails silently, and each has a
concrete bad outcome: a half-cached app, console noise masking a real error, a
permanently-cached 404 shell, and deleted training history.

Every test guarding a load-bearing property must be verified by breaking the
property and confirming the test fails. Three tests in the timestamps work were
found to pass vacuously; the same discipline applies here.

Baseline: 204 tests passing via `node --test tools/*.test.js` (the directory
form fails on the installed Node version).

## Manual verification

Two things no headless test covers:

**Rendering must be visually unchanged.** Same families, same weights, same
`swap` behaviour, so it should be pixel-identical — but that warrants an eyeball
in a browser before merge.

**The offline launch itself.** Load the page, go offline (devtools or airplane
mode), cold-launch it, and confirm it opens fully styled. This is the entire
point of the work and cannot be asserted from Node.

## Risks

| Risk | Mitigation |
| --- | --- |
| Bad version cached, no way out in standalone mode | Force-update button in Settings |
| Force update wipes training history | Clears caches and SW registrations only, never `localStorage`; test 12 pins it |
| 404 page cached as the app shell | `res.ok && res.status === 200` guard; test 7 pins it |
| Half-populated cache after interrupted install | `addAll` atomicity; test 2 pins it |
| Offline revalidation throws | Response committed before the fetch; `.catch` on the network promise; test 6 pins it |
| Fonts render differently after self-hosting | Manual browser check before merge |
| OFL notices omitted | `fonts/LICENSE.txt` shipped with the files |

## Out of scope

Consuming the timestamps added in the previous branch — calendar charts,
frequency stats, "last trained N days ago" — remains TODO.md items 5 and 6.
