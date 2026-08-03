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
- **Completion is loud, and it advances** — when a day's last set resolves, `syncCompletion()` fires the full-screen celebration in `view.done`; if that day also closed out the week, `openDayDone()` calls `changeWeek(1)` first, so the app is already on the next week when the overlay appears. `advanceToCurrentWeek()` repeats that on boot for a week finished in a previous session. Both are gated on `weekHasActivity()` so an untouched week can never walk itself forward.

## Development

No build or test commands. To develop:
- Edit `index.html`
- Open in browser (or refresh) to see changes
- State persists in localStorage; clear it manually or via devtools to reset

### Verifying changes without a browser

The script block can be extracted and executed headlessly, which catches syntax and runtime errors fast:

```bash
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
```

For behavior, `eval` that file under a minimal `document`/`localStorage` shim, capture the delegated click handler passed to `document.addEventListener('click', …)`, and drive the app by synthesizing `{target: {dataset, closest}}` events against the rendered `data-act` markup. Note the canvas apple-touch-icon block runs at load, so the shim's `createElement` must return an object with `getContext()`.
