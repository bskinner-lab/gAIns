# gAIns — Improvement Backlog

Ordered by what it costs to defer, not by effort. Findings are grounded in the
state of `index.html` as of 2026-11-12 (6588 lines / 276 KB, `APP_VERSION` 14,
before item 5 landed).
First written 2026-07-29 at 3893 lines / 177 KB.

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
calendar. The export carried no dates either — the only date in the whole system
was the export filename.

Couldn't answer: when did I last train legs, what's my actual training
frequency, was this mesocycle run over 8 weeks or dragged across 5 months, is
this a deload or a vacation.

- [x] Add `completedAt` per set (minimum: per day)
- [x] Carry timestamps in the export. The file stays labelled `version: 3` on
      purpose: the version integer is the import gate, so a `4` would be
      rejected by older builds. `times` and `startDate` are extra keys older
      builds ignore (see the comment above `exportData`'s `data` object).
- [x] Keep v1/v2/v3 import paths working

---

## Tier 1 — Reliability on the gym floor

### 2. Service worker + self-hosted fonts

**Status:** done — 2026-07-29 to 2026-08-02 (PR #17). See
`docs/superpowers/specs/2026-07-30-service-worker-design.md`.

GitHub Pages hard-codes `cache-control: max-age=600` on `index.html`, so a cold
launch used to need live network, and the fonts came from the Google Fonts CDN.

- [x] Service worker (`sw.js`) precaches the shell and fonts
- [x] Fonts self-hosted as `.woff2` files in `fonts/`, served cache-first. This
      replaced the original base64-inline idea; the CDN links are gone.
- [x] Deliberate update path: versioned cache (`CACHE` in `sw.js`, kept in
      lockstep with `APP_VERSION`), `skipWaiting` + `clients.claim`,
      stale-while-revalidate for navigations, build number shown in Settings
- [x] README fonts fixed (Oswald, IBM Plex Mono, Archivo)

### 3. Make backups durable

**Status:** not started

The entire history lives in `localStorage` on one phone, protected only by an
export you have to remember to run.

- [ ] "Last backup was N days ago" nudge in Settings
- [ ] Consider auto-export to Files/iCloud Drive on week completion

---

## Tier 2 — The features that make it worth using

### 4. Per-set weights

**Status:** partly done

`toggleSet` and `logActiveSet` already write
`weights[exId_i]` alongside `weights[exId]`. What is left: `saveWeight()` (the
text input path) still writes exercise-level only, and `progressHTML()` still
charts the exercise-level `h.weight`.

- [ ] Make `saveWeight()` per-set, mirroring the reps shape
- [ ] Migrate existing per-exercise weights forward
- [ ] Make the progress view read per-set weights

### 5. Weekly volume per muscle vs. landmarks

**Status:** done — 2026-11-12 (`APP_VERSION` 15). Tests in
`tools/muscle-volume.test.js`.

PROGRESS now opens with WEEKLY SETS: for the selected week, done / planned hard
sets per muscle (secondary credit counts half), a bar with the MAV band shaded
and MEV/MRV ticks, and a status judged on the plan (BELOW MEV, BELOW MAV,
IN MAV, ABOVE MAV, OVER MRV; a deload week only flags OVER MRV).

- [x] Load muscle map + landmarks into the app (`MUSCLE_MAP`,
      `VOLUME_LANDMARKS`, inlined copies pinned to the JSON in `tools/`)
- [x] Weekly set count per muscle, against MEV/MAV/MRV
      (`weeklyMuscleVolume()`, `volumeStatus()`)
- [x] Surface in PROGRESS (`muscleVolumeHTML()`)
- [ ] Later, if wanted: a week-by-week trend per muscle across the block

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

`PROGRAMS` (~78 KB) + `EXERCISE_ALTERNATIVES` (~57 KB) are about 135 KB of the
276 KB file, roughly half. Four programs now live inline.

- [ ] Move to `data/programs.json`, fetch at boot
- [ ] Add it to the service worker's `PRECACHE` alongside the shell
- [ ] Keep `tools/insert-program.js` and `/newplan` writing to the new location

### 8. Modularize with an inline-back build

**Status:** not started — do not start until editing genuinely hurts

Split to `src/*.js` ES modules with a ~10-line esbuild step that inlines back to
a single distributable `index.html`. Keeps the portable single-file artifact as
the *output* while editing sane 200-line files. This is the only item that adds
a build step, which is why it's last.

---

## Shipped outside this list

For context on where the app is now; each has its own tests in `tools/`.

- 2026-07-21 — `/newplan` program generator and `tools/insert-program.js`
- 2026-07-23 — out-of-order set logging and per-set reps
- 2026-08-03 — loud day completion, and the week auto-advances when finished
- 2026-08-12 — per-week set ramp across the block, and a real week-8 deload
- 2026-08-13 — logged work survives an exercise moving days
- 2026-08-14 — rest-timer chime and a readable minimized timer
- 2026-08-20 — waist + Zone 2 finisher block for meso3
- 2026-08-21 / 2026-10-29 — sessions capped by `tools/session-length.test.js`
- 2026-09-07 — per-week ± sets stepper on each exercise card
- 2026-09-21 — Mesocycle 4 (8-week MAV push, shoulder-cautious)
- 2026-10-29 — supersets for meso4 from week 6

---

## Suggested sequence

3 → 4 → 6. Item 3 is small and protects everything else, so
fold it in whenever convenient; item 6 builds on item 4's per-set weights.
