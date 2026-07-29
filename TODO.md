# gAIns — Improvement Backlog

Ordered by what it costs to defer, not by effort. Findings are grounded in the
state of `index.html` as of 2026-07-29 (3893 lines / 177 KB).

Hosting decision: **staying on GitHub Pages** for now. Private-hosting options
(Cloudflare Pages, GitHub Pro) were evaluated and deferred — revisit only if the
public repo becomes a real concern. Note that any hosting move changes the
origin and would orphan `localStorage`; export first, import after, and put a
custom domain on it so it never has to happen twice.

---

## Tier 0 — Losing data right now

### 1. Record timestamps

**Status:** done — 2026-07-29. Data model only; nothing in the UI reads the
timestamps yet. See `docs/superpowers/specs/2026-07-29-set-timestamps-design.md`.

*The problem this solved, as it stood before 2026-07-29:*

Nothing in the persisted model knew when anything happened. `state` was keyed
`program → week → day → {sets, weights, reps, effort, protocol, swaps}` with no
timestamp anywhere. `advanceToCurrentWeek()` bumps the week when the previous one
is *fully complete*, so "Week 5" was an ordinal counter disconnected from the
calendar. The export (then `version: 3`) carried no dates either — the only date
in the whole system was the export filename.

Couldn't answer: when did I last train legs, what's my actual training
frequency, was this mesocycle run over 8 weeks or dragged across 5 months, is
this a deload or a vacation.

**Why first:** it is the only item in this file that is retroactively
unrecoverable. Everything else can be built six months from now against data that
still exists. Every session logged without a date loses its date permanently.

- [x] Add `completedAt` per set (minimum: per day)
- [x] Bump export to v4 with a migration from v3
- [x] Keep v1/v2/v3 import paths working

---

## Tier 1 — Reliability on the gym floor

### 2. Service worker + self-hosted fonts

**Status:** not started

GitHub Pages hard-codes `cache-control: max-age=600` on `index.html` and offers
no way to change it. More than 10 minutes after the last load, every cold launch
needs live network — and in `display: standalone` a failure is a blank screen
with no reload affordance. Fonts (Oswald, IBM Plex Mono, Archivo) come from the
Google Fonts CDN, adding a third-party origin to the critical path.

- [ ] Service worker, cache-first precache of the shell
- [ ] Inline the three fonts as base64 `@font-face`; drop the CDN links
- [ ] Deliberate update path (versioned cache, `skipWaiting` + `clients.claim`,
      background revalidate) so pushes still reach the phone
- [ ] Fix stale README — it claims Bebas Neue / DM Sans / DM Mono

### 3. Make backups durable

**Status:** not started

The entire history lives in `localStorage` on one phone, protected only by an
export you have to remember to run.

- [ ] "Last backup was N days ago" nudge in Settings
- [ ] Consider auto-export to Files/iCloud Drive on week completion

---

## Tier 2 — The features that make it worth using

### 4. Per-set weights

**Status:** not started

Partially done already. Both `toggleSet` and `logActiveSet` write
`weights[exId_i]` alongside `weights[exId]` — only `saveWeight()` (the text
input path) writes exercise-level only. Remaining work is narrower than first
written up: make `saveWeight()` per-set and make the progress view read per-set
weights.

- [ ] Store weight per set, mirroring the reps shape
- [ ] Migrate existing per-exercise weights forward

### 5. Weekly volume per muscle vs. landmarks

**Status:** not started

`tools/muscle-map.json` and `tools/volume-landmarks.json` already exist, and
`docs/training-evidence.md` is built around weekly hard sets per muscle vs.
MEV/MAV/MRV — but none of it is surfaced in the app. It's only consumed by
`/newplan` at generation time.

Surfacing "chest: 14 sets this week, MAV 18, MRV 22" turns the app from a
checklist into what the evidence file says actually matters. The data all exists;
it just isn't wired to the UI.

- [ ] Load muscle map + landmarks into the app
- [ ] Weekly set count per muscle, against MEV/MAV/MRV
- [ ] Surface in PROGRESS (or a new view)

### 6. Progress view beyond weight

**Status:** not started

`progressHTML()` charts `h.weight` per week plus a first-to-last delta. With
per-set weights and reps, volume load (`Σ weight × reps`) and estimated 1RM
become available — both better hypertrophy signals.

- [ ] Volume load per exercise per week
- [ ] Estimated 1RM trend
- [ ] Plot against real dates now that `times` exists (filter to `src: "log"`
      for pacing; exclude `est` from anything claiming precision)

---

## Tier 3 — Maintainability

### 7. Extract program data to JSON

**Status:** not started

`PROGRAMS` + `EXERCISE_ALTERNATIVES` are 78 KB of the 176 KB file (44%). Actual
application code is only ~75 KB.

- [ ] Move to `data/programs.json`, fetch at boot
- [ ] Ensure the service worker caches it alongside the shell

### 8. Modularize with an inline-back build

**Status:** not started — do not start until editing genuinely hurts

Split to `src/*.js` ES modules with a ~10-line esbuild step that inlines back to
a single distributable `index.html`. Keeps the portable single-file artifact as
the *output* while editing sane 200-line files. This is the only item that adds
a build step, which is why it's last.

---

## Suggested sequence

1 → 2 → 4 → 5, folding in 3 whenever convenient. Item 1 first strictly because of
the clock on it; item 2 next because that's the one that bites mid-workout.
