# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

gAIns is a single-file hypertrophy workout tracker (`index.html`) — no build tools, no dependencies, no server. Open the file directly in a browser to use.

## Architecture

Everything lives in one `index.html` file with three sections:

1. **CSS** (~460 lines) — Editorial/newsprint design system. All colors are CSS custom properties defined in three blocks: `:root` (light), `:root[data-theme="dark"]` (dark), and a `@media (prefers-color-scheme: dark)` fallback for when no explicit theme is set. Never hard-code colors outside those blocks — use the vars (`--bg`, `--ink`, `--accent`, `--muted`, `--border`, `--surface`, `--on-dark`, `--font-display`, `--font-mono`, `--font-body`, …).
2. **HTML** (~8 lines) — Minimal shell only: `#app` containing `#masthead`, `#scroll`, `#bottombar`, plus a sibling `#overlays`. All content is JS-rendered.
3. **JavaScript** (~1900 lines) — Vanilla JS, no frameworks.

### Rendering model

A single `view` state object drives four render functions, all called by `render()`:

- `renderMasthead()` — title, week `‹ ›` selector, phase line, ⚙ settings, program chips, day/PLAN/PROGRESS tabs
- `renderScroll()` — dispatches on `view.name`: `day` → `workoutHeaderHTML()` + `exercisesHTML()`, `plan` → `planHTML()`, `progress` → `progressHTML()`, else `settingsHTML()`
- `renderBottomBar()` — sticky dark bar: active exercise, ± weight stepper (2.5 lb), LOG SET, minimized rest pill, or DAY COMPLETE
- `renderOverlays()` — one overlay at a time, priority `confirm > done > tip > swap > rest`

Each rebuilds its container's `innerHTML`. **All interaction goes through one delegated click handler** keyed on `data-act` attributes — add new UI by emitting `data-act="…"` and adding an `else if` branch there. A 500ms `setInterval` updates `view.now` (session clock + rest countdown); `visibilitychange` resyncs so the timestamp-based rest timer survives backgrounding.

### Data and state

- **Data constants**: `PROGRAMS` (multi-program: days, exercises, `mesocycle`, `weekPhases`, `protocolItems`), `EXERCISE_ALTERNATIVES` (swap options), `GLOSSARY`. `DAYS`/`MESOCYCLE`/`WEEK_PHASES`/`PROTOCOL_ITEMS` are reassigned from the active program on switch.
- **Supersets**: two ADJACENT exercises on a day with the same `superset` key (`'A'`, `'B'`, …) run as alternating sets. `supersetStep()` decides the rest after each logged set: after the first half, a `SUPERSET_TRANSITION_SEC` walk (minimized, with the selection moved to the partner); after the second, a rest (walk back included) long enough for both muscles: the partner's `rest` minus the time since its half was logged, or this exercise's `rest` minus the walk and one partner set (`SET_SECONDS`), whichever is longer, floored at `SUPERSET_MIN_REST_SEC`. Skipping a half hands over to the partner the same way. Pairs must share no muscle and carry the same set count every week (an uneven pair ends in straight sets) — `tools/superset.test.js` and `insert-program.js` both enforce it.
- **Globals**: the current week is `currentWeek` (not `week`); the program index is `currentProgramIdx`; workout data is `state`, keyed by day id → `{sets, weights, effort, protocol, swaps}`. `sets[exId]` entries are `true`, `'skipped'`, or `false`.
- **Persistence**: `localStorage` under `hypertrophy_state_<progId>_w<week>`, plus `hypertrophy_week_<progId>`, `hypertrophy_program`, `hypertrophy_migrated_v3`. Theme preference lives in `gains_theme` (`light`/`dark`/absent = auto). Migration functions handle legacy v1/v2 layouts — don't break them.

### Compatibility shims

`refreshCurrentDay()`, `switchDay()`, `updateOverallProgress()`, `updateWeekDisplay()`, `updateProgramSelector()` are one-line shims that delegate to `render()`. The preserved logic layer (`skipSet`, `skipDay`, `completeDay`, `performSwap`, `changeWeek`, `switchProgram`, …) calls them internally. **Do not delete them** — removing them throws `ReferenceError` on skip/swap/week/program actions.

## Key Design Decisions

- **Single file by design** — self-contained and portable. Don't split into separate files unless explicitly asked.
- **No build step** — uses Google Fonts CDN (Oswald, IBM Plex Mono, Archivo) directly.
- **localStorage persistence** — all progress, weights, effort, and swaps stored client-side.
- **Light + dark themes** — toggled in Settings, defaults to `prefers-color-scheme`.
- **Shoulder-cautious program** — tailored for a user with shoulder considerations. Protocol sections appear on push/pull/upper days.
- **Week system** — 8-week mesocycle with phases (Foundation → Overload → High Stimulus → Overreach → Deload) that affect RPE targets and whether LLP is active.
- **Sessions fit 50 minutes** — `tools/session-length.test.js` models a session (45 s per compound set, 32 s per isolation set, each set's `rest`, 5 min of prehab, superset rounds priced the way `supersetStep()` runs them) and fails meso4 weeks 6–8 and every later program at over 50 min. Make room by supersetting or cutting redundant sets, never by shortening `rest`.
- **Completion is loud, and it advances** — when a day's last set resolves, `syncCompletion()` fires the full-screen celebration in `view.done`; if that day also closed out the week, `openDayDone()` calls `changeWeek(1)` first, so the app is already on the next week when the overlay appears. `advanceToCurrentWeek()` repeats that on boot for a week finished in a previous session. Both are gated on `weekHasActivity()` so an untouched week can never walk itself forward.

## Bump the version on every change

`APP_VERSION` (top of the script block in `index.html`) renders at the bottom of Settings as `gAIns · APP VERSION <n>`. It is the only way to tell whether the build you are looking at contains your change: the service worker serves the cached shell first, so the load right after a deploy runs the **old** build and only the one after it picks up the new code. Without a bump that is indistinguishable from "the fix didn't work" — and it has already cost one debugging cycle.

**Any change to `index.html` or `sw.js` must bump both, in lockstep:**

- `APP_VERSION` in `index.html` → the next integer
- `CACHE` in `sw.js` → `gains-v<APP_VERSION>`

One bump per commit, not per edit. `tools/version-sync.test.js` fails if the two ever drift — but nothing catches forgetting to bump *both together*, so that part is on you. There is no judgment call about whether a change is "user-visible enough": if either file changed, bump.

## Development

To develop:
- Edit `index.html`
- Open in browser (or refresh) to see changes
- State persists in localStorage; clear it manually or via devtools to reset

There is no build step, but there **is** a test suite — Node's built-in runner, no dependencies, no `package.json`:

```bash
node --test tools/*.test.js                # full suite (412 tests)
node tools/smoke-render.js                 # render gate, program 0
node tools/smoke-render.js index.html 2    # render gate, a specific program
```

Run the full suite before committing. Each feature commit in this repo ships its own `tools/<feature>.test.js` built on `tools/app-shim.js` — follow that pattern rather than adding tests to an unrelated file.

### Verifying changes without a browser

The script block can be extracted and executed headlessly, which catches syntax and runtime errors fast:

```bash
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
```

For behavior, `eval` that file under a minimal `document`/`localStorage` shim, capture the delegated click handler passed to `document.addEventListener('click', …)`, and drive the app by synthesizing `{target: {dataset, closest}}` events against the rendered `data-act` markup. Note the canvas apple-touch-icon block runs at load, so the shim's `createElement` must return an object with `getContext()`.
