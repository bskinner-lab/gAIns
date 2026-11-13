# Completeness roadmap: five features

**Date:** 2026-11-13
**Status:** phases 1–4 done (APP_VERSION 15–18); phase 5 not started — needs the user's setup and go-ahead
**Execute in:** a fresh session, one phase per commit, in the order below.

The idea behind all five: the app is the *sensor* half of a feedback loop, and
the *controller* (`tools/analyze-history.js` + `/newplan`) only runs once every
8 weeks, offline. Each phase either protects the data the loop runs on, gives
it a signal it lacks, or shortens the loop.

| Phase | Feature | Risk | Size |
|---|---|---|---|
| 1 | Backup at week close + "last backup" age | Low | ~2 h |
| 2 | Live stall / too-light detector in PROGRESS and on the card | Low | ~½ day |
| 3 | Per-exercise shoulder flag, fed to the analyzer and `/newplan` | Low | ~1 day |
| 4 | RIR calibration set, once per block | Low | ~1 day |
| 5 | Wild card: export to a private repo, scheduled `/newplan` | Medium–High | 2–3 days |

Phases 2 and 3 share the per-exercise card and PROGRESS row markup, so do them
back to back. Phase 5 depends on the user doing a manual setup step first (see
its prerequisites). Stop and ask before starting it.

---

## Rules that apply to every phase

Read `CLAUDE.md` first. In particular:

- **Version bump, once per commit:** `APP_VERSION` in `index.html` (currently
  `'14'`) → next integer, and `CACHE` in `sw.js` → `gains-v<same>`. Phase 1 →
  15, phase 2 → 16, and so on, if each phase is one commit.
- **One delegated click handler.** New UI emits `data-act="…"` and gets an
  `else if` branch in the handler near `index.html` ~line 6500.
- **Colors only through CSS vars** in the three theme blocks.
- **Keep the compatibility shims** (`refreshCurrentDay`, `switchDay`, …).
- **Each feature ships its own `tools/<feature>.test.js`** built on
  `tools/app-shim.js` (`withApp`, `loadApp`, `makeStorage`).
- **Run before each commit:**
  ```bash
  node --test tools/*.test.js
  ```
  ```bash
  node tools/smoke-render.js
  ```
  ```bash
  node tools/smoke-render.js index.html 3
  ```
- **Export stays labelled `version: 3`.** See the comment in `exportData()`:
  the version integer is the import gate, and new keys are a structural
  superset that older builds ignore. New per-day keys (`joint`, `calib`) ride
  along the same way `times` did. Do **not** bump the export version.
  `tools/analyze-history.js`'s `normalizeExport` only accepts `version === 3`,
  which is another reason not to.
- **Adding a per-day state key** means touching every place that enumerates
  them. Today that list is: `initState()` (~4685), `normalizeWeekBlob()` /
  `migrateMovedExercises()` / `moveEntry()` (~4620–4685, so a moved exercise
  keeps its entry), `resetWeek()` (~6439), the "Clear Week?" confirm copy
  (~6518), and the Settings export blurb (~6079). Grep for `setAdjust` to find
  every site, since it was the last key added.
- Don't touch v1/v2 migration paths.

---

## Phase 1: Backup at week close

**Why:** the whole training history lives in one phone's `localStorage`. This
is `TODO.md` item 3, Tier 0 data-loss risk.

### Behaviour

1. **"Last backup" age in Settings.** In the EXPORT panel of `settingsHTML()`,
   show `LAST BACKUP · 3 DAYS AGO` (or `NEVER`). Show it in the accent or
   warning tone when it's more than 7 days old.
2. **SAVE BACKUP on the week-complete card.** In `doneCardHTML(d)`, when
   `d.weekDone` (including `programDone`), add a third button
   `data-act="backupshare"`. Label: `SAVE BACKUP`, or `SAVE BACKUP · LAST 9 DAYS AGO`
   when stale.
3. **Share sheet first, download fallback.** Refactor `exportData()` into
   `buildExportBlob()` (returns `{ blob, filename }`) plus the existing download
   path. `backupshare` does:
   ```js
   const file = new File([blob], filename, { type: 'application/json' });
   if (navigator.canShare && navigator.canShare({ files: [file] })) {
     navigator.share({ files: [file], title: 'gAIns backup' })
       .then(markBackedUp).catch(() => {});  // AbortError = user cancelled
   } else { downloadExport(); markBackedUp(); }
   ```
   Call it synchronously inside the click handler, because Safari needs the
   user gesture. Chrome on Android rejects `application/json` for share. If
   `canShare` is false with that type, retry the check with `type: 'text/plain'`
   (keep the `.json` filename) before falling back to the download.
4. `markBackedUp()` writes `localStorage['gains_last_backup'] = Date.now()`. The
   plain EXPORT button also calls it. The key is device-local metadata: leave it
   **out** of the export and don't clear it on import.

### Tests: `tools/backup.test.js`

- Settings renders `NEVER` with no key, `N DAYS AGO` with a seeded key (stub
  `Date.now`), and the stale styling past 7 days.
- The week-complete done card contains `data-act="backupshare"`. A plain day
  complete doesn't.
- With a stub `navigator.share` + `canShare → true`, clicking `backupshare`
  calls share with one `File` whose name matches `gains-backup-YYYY-MM-DD.json`,
  and sets `gains_last_backup` on resolve. With `canShare → false`, it takes
  the download path (stub `createElement('a').click`).
- `buildExportBlob()` output is byte-identical to the current export, so a
  refactor regression is caught. The existing export/import tests must still pass.

### Manual check (user, on the phone)
Finish a week (or use a test week), tap SAVE BACKUP, and confirm the file lands
in Files/iCloud and re-imports cleanly in Settings → Import.

---

## Phase 2: Live stall / too-light detector

**Why:** `/newplan`'s notes ("LOW effort 6 of 8 weeks", "flat 85 lb for 6
weeks") are findings that were visible in week 3. Surface them mid-block, when
a swap still helps this block.

### Rule: a pure function in `index.html`

```js
// hist = getExerciseHistory(dayId, exId), ascending by week.
// Returns null | { kind: 'stalled' | 'light', weeks: n, reason: '…' }
function progressionFlag(hist, weekPhases)
```

- Drop weeks whose phase label is `Deload` (`weekPhases[w-1].label`), plus the
  current week if it isn't complete yet. Half-logged weeks mustn't count.
- Look at the **last 3 consecutive logged weeks** (consecutive in week number,
  after dropping deloads).
- **top load** = `weight`. **best reps** = max of `setReps` values, falling
  back to `reps`.
- `stalled`: top load hasn't increased across the 3 weeks, best reps haven't
  increased either, and at least one of the 3 is effort `high`. Reason:
  `no load or rep gain in 3 weeks at high effort`.
- `light`: all 3 weeks are effort `low` and top load hasn't increased. Reason:
  `rated LOW 3 weeks running with no load increase: add weight`.
- `light` wins if both match (it's the more actionable message).
- Keep these thresholds as named constants (`STALL_WINDOW = 3`) beside the
  function. They are deliberately looser than the analyzer's
  (`STALL_MIN_WEEKS = 4`, slope-based), because this is an early warning and
  the analyzer is the end-of-block verdict. Say so in a comment.

### UI

- **PROGRESS (`progressHTML()`):** a flagged row gets a small tag after the
  name (`STALLED` / `TOO LIGHT`) plus the reason line under the cells. Count
  flags in the `vw-sub` header (`2 FLAGS`).
- **Day card (`exercisesHTML()`):** a one-line banner under the exercise name
  with the reason. For `stalled` with `EXERCISE_ALTERNATIVES[orig.id]`, add a
  `SWAP` link reusing the existing `data-act="swap" data-orig="…"`. For `light`
  there's no swap link, because the fix is load, not exercise choice.
- Use the effective (swapped-in) exercise id for history, as `progressHTML()`
  already does via `resolveExercise`.

### Tests: `tools/progression-flag.test.js`

Table-driven over synthetic histories: flat load + high effort → stalled; flat
load but reps rising → null; load rising → null; 3× low → light; a deload week
in the middle is skipped, not counted as a break; only 2 logged weeks → null;
the current incomplete week is ignored. Then one render test: seed 3 weeks of
storage for a meso4 exercise, render PROGRESS and the day, and assert the tag,
the banner and the `data-act="swap"` link.

Sanity run (not a test): load `tools/fixtures/export-v3.json` into the shim and
eyeball that the in-app flags overlap what `node tools/analyze-history.js`
reports as stalled / under-stimulating.

---

## Phase 3: Per-exercise shoulder flag

**Why:** the program is built around the shoulder, but nothing records how
the shoulder responds. `/newplan` swaps by stalls and skips, never by symptoms.

### Data
New per-day key `joint: { [exId]: 'ok' | 'twinge' | 'pain' }`, same shape as
`effort`. Unlike effort, **do not** prefill it from prior weeks in
`prefillFromPreviousWeeks()`: a symptom is per session. Add it to every per-day
key site listed in the shared rules.

### UI
- A second row under the effort row on each card: `SHOULDER` + three buttons
  `OK · TWINGE · PAIN`, `data-act="joint" data-ex="…" data-l="…"`. Tapping the
  active one clears it, mirroring `saveEffort()`. Write `saveJoint()` as a
  sibling, re-rendering via `render()` rather than the DOM-patching
  `saveEffort` does.
- Default: show the row on every exercise. Simple, and the analyzer can ignore
  lower-body noise. (Decision for the user at execution time: if it feels
  cluttered, show it only where `ex.muscles` touches `chest`, `front_delt`,
  `side_delt`, `rear_delt`, `triceps`, `lats` or `upper_back`, with every
  exercise as the fallback when `muscles` is absent.)
- **Carry-forward warning:** if the previous week's entry for this exercise was
  `pain`, or `twinge` in 2 of the last 3 weeks, the card shows a banner
  `SHOULDER FLAGGED LAST WEEK` with the swap link (same markup as phase 2's).
  Reuse the phase 2 banner component.
- PROGRESS: a small marker on cells with a flag (e.g. a ring around the effort
  dot, using a CSS var).

### Analyzer and `/newplan`
- `tools/analyze-history.js`: in `perExercise()`, count `jointCounts { ok,
  twinge, pain }` per exercise (and per dominant variant, as effort already is).
  Add a `jointFlagged` list in `flagExercises()`: any `pain`, or `twinge` in 2+
  weeks. Render a **"Shoulder flags"** section in `renderReport()`.
- `.claude/commands/newplan.md`: add to the design rules that a `jointFlagged`
  exercise must be replaced or moved to a more shoulder-neutral variant, and
  must never be carried forward unchanged. Cite the count in the exercise's
  `note`, matching the existing note style.
- Extend `tools/analyze-history.test.js` with a fixture week containing `joint`.

### Tests: `tools/shoulder-flag.test.js`
Toggle on/off and persistence across reload; survives `migrateMovedExercises`
when an exercise changes day; cleared by Clear Week; not prefilled into the
next week; included in the export JSON and restored by import; the
carry-forward banner appears in week N+1 after `pain` in week N.

---

## Phase 4: RIR calibration set

**Why:** lifters typically underestimate RIR by about one rep (Halperin et al.
scoping review). If "RPE 8" is really RPE 6 for you, every weekly RPE target is
off. One failure set per day per block measures your personal offset.

**Changed from the brainstorm:** calibrate in the **first `High Stimulus`
week** (week 5 in meso3/meso4), not Overreach. At RPE 9–9.5 you're already
within about a rep of failure, so there's little error to measure. RPE 8 is
where the bias matters.

### Choosing the set, deterministically
- Week: the first index in `weekPhases` with label `High Stimulus`. None → no
  calibration this program.
- Per day: the **last** exercise on the day (after swaps) with `compound:
  false` whose `ex.muscles` is present and has **only** muscles from the
  allowlist `biceps, triceps, hamstrings, quads, calves, abs`. No delts, chest
  or back: the program notes say "never 0 on delts", and flys load the shoulder
  in the stretch. Programs without inline `muscles` (meso1/meso2) get none.
  Skip superset members, because a failure set wrecks the partner's rest
  timing.
- The set is that exercise's **last** set.
- Pure function `calibrationTarget(day, weekIdx)` → `{ exId, setIdx } | null`.
  Test it directly.

### Flow
- The chosen set shows a `CALIBRATE` badge. A one-line note on the card: *"Last
  set: stop where you'd normally stop, log the reps, then keep going to true
  failure."*
- After logging that set (`logActiveSet` / `toggleSet` path), open a small
  overlay, `view.calib`, slotted into the priority in `renderOverlays()` after
  `done` and before `tip`: **"How many more reps to failure?"** with a 0–10
  stepper and a SAVE button (`data-act="calibsave"`), plus `SKIP` (`calibskip`).
  The rest timer keeps running underneath.
- **Prescribed RIR** comes from the week's RPE upper bound: parse `RPE 8–9` →
  9 → RIR 1. Parse the phase `rpe` string with `/([\d.]+)\s*$/`; RIR = 10 − RPE.
  Store `calib: { [exId]: { setIdx, prescribedRir, extra, at } }`, a new
  per-day key (follow the shared rules).
- **Error** = `extra − prescribedRir`. Positive means you leave more in the
  tank than you think.

### Surfacing
- PROGRESS: a `RIR CALIBRATION` panel listing each calibrated exercise as
  `predicted 1 · actual 3 · +2`, and the mean offset:
  `YOU STOP ~1.5 REPS EARLIER THAN YOU THINK`.
- Analyzer: a "RIR calibration" section in `renderReport()`, listing the mean
  offset per program. `newplan.md`: if the mean offset is ≥ +1.5, note it in the
  program intro and bias isolation RPE targets up half a point. Never raise
  them for compounds.
- Settings: a `RIR CALIBRATION · ON/OFF` toggle in `localStorage['gains_calib']`
  (default on), so the user can opt out without a code change.

### Tests: `tools/rir-calibration.test.js`
`calibrationTarget` picks the right exercise and set on each meso4 day, returns
null for meso1, for a non-High-Stimulus week, and for a day whose only eligible
isolations are delts or superset members. Logging the target set opens
`view.calib`; saving stores the record; skipping stores nothing; the toggle off
means no badge and no overlay. RPE parsing covers `RPE 8–9`, `RPE 9`, and
`RPE 6.5–7.5`. Run the session-length test too: the failure set adds about
20 s, so confirm meso4 still fits in 50 min.

---

## Phase 5 (wild card): close the loop automatically

**Stop and confirm with the user before starting.** This moves training data
off the device and stores a credential on the phone.

### Prerequisites (the user does these; Claude can't)
1. Create a **private** repo, e.g. `bskinner-lab/gains-data`. **Never** push
   data to `gains`: it's public (GitHub Pages).
2. Create a fine-grained PAT scoped to **only** that repo, with *Contents:
   read & write*, and a 90-day expiry.
3. Add the repo to the Claude environment so a scheduled session can read it.

### App side
- Settings → `AUTO-SYNC` panel: repo (`owner/name`) and token fields, a TEST
  button, and the last sync time. Store them in `localStorage['gains_sync']`.
  Leave them **out** of the export, and mask the token in the UI after saving.
- On week close (in `openDayDone` when `weekDone`) and on manual SYNC NOW:
  `PUT https://api.github.com/repos/{owner}/{repo}/contents/data/gains-backup-YYYY-MM-DD.json`
  with `Authorization: Bearer <token>`, `message`, base64 `content`, plus `sha`
  if the file exists (GET first). The GitHub REST API allows CORS for
  authenticated requests. Verify this from the deployed origin as the first
  step, because it's the thing that would kill the phase.
- It must be fire-and-forget and offline-safe. On failure, set
  `gains_sync.pending = true` and retry on next boot. Never block the done
  card. Add `api.github.com` to nothing in `sw.js`: let it go to the network.
- When `programDone`, also write `data/READY-<progId>.json` (`{ progId, at }`)
  as the trigger marker.

### Claude side
- A scheduled task (create it with the user in a session; daily, fresh session
  per fire) that checks out `gains-data`, and if a `READY-*.json` exists with no
  matching `PLANNED-*.json`, copies the newest export into `gains/data/`, runs
  `/newplan`, opens a PR on `gains` with the new mesocycle, and writes
  `PLANNED-<progId>.json` back to `gains-data`. It never merges anything.
- Document the setup in `README.md`, including how to revoke the token.

### Tests: `tools/auto-sync.test.js`
Stub `fetch`: GET 404 then PUT without `sha`; GET 200 then PUT with `sha`; a
network failure sets `pending` and the next boot retries; the token is never in
the export JSON or the rendered HTML (assert on the masked form); week close
triggers exactly one sync; `programDone` also writes the READY marker.

### Risk and rollback
The token lives in phone `localStorage`, where anyone with the unlocked phone
or an XSS could use it. Scope limits the blast radius to one private repo. To
roll back: revoke the PAT, clear the Settings fields, and delete the scheduled
task.

---

## Housekeeping when done
- Update `TODO.md`: item 3 → done (phase 1). Add a note under items 5/6 that
  the stall detector exists.
- Update `CLAUDE.md`: the new per-day keys (`joint`, `calib`), the new
  `localStorage` keys (`gains_last_backup`, `gains_calib`, `gains_sync`), the
  `view.calib` overlay in the priority list, and the test count.
