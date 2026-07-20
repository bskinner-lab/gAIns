# gAIns Editorial Redesign — Design Spec

**Date:** 2026-07-20
**Status:** Approved (design), pending spec review
**Author:** brainstorming session

## Summary

Port the "Claude design" editorial-look prototype (a React/`<x-dc>` component export) into the
existing gAIns app while preserving its core architecture: a single self-contained `index.html`
with no build step, no framework, and no external runtime. The prototype is **not runnable as-is**
— it depends on a proprietary `support.js` DC runtime, a missing `gains-data.js` data module, and
React. However, the app's *data* and *feature set* already exist in the current `index.html`, so
this work is fundamentally a **visual + interaction redesign (reskin)**, not a feature rewrite.

Chosen approach: **Approach A — port the export's component logic wholesale** into vanilla JS,
reusing the current data blocks verbatim and keeping the same localStorage schema so no logged
progress is lost.

## Goals

- Match the export's editorial/newsprint UI as closely as possible.
- Adopt the export's full interaction model (sticky LOG SET bar + stepper, minimizable rest pill,
  per-set skip, skip/complete-day, tip/confirm modals).
- Support both a light theme (as-export) and a derived dark editorial theme, with a toggle.
- Preserve 100% of existing user data (logged sets, weights, effort, swaps, week/program state).
- Keep the single-file, no-build, vanilla-JS architecture (per `CLAUDE.md`).

## Non-Goals

- No new training features beyond what the export already implies (the app already has multi-program,
  Progress, effort, swaps, export/import, PR detection).
- No build tooling, no framework, no splitting into multiple files.
- No server or sync.

## Context: current app vs export

The current `index.html` already defines, inline:
- `PROGRAMS` (line ~1549) — multi-program with `days`, `mesocycle`, `weekPhases`, `protocolItems`,
  `totalWeeks`; exercises carry `id/name/sets/reps/rpe/note/llp/compound/rest/restLabel`.
- `EXERCISE_ALTERNATIVES` (line ~1906) — swap options.
- `GLOSSARY` (line ~1534).
- A Progress panel (`renderProgressPanel`), effort tracking, swaps, export/import, PR detection.

The export's `Component` reads exactly these shapes from a `gains-data.js` that was never exported.
Both share `STORAGE_KEY = 'hypertrophy_state'` and the same per-program/per-week key scheme. The
meaningful delta is **visual design + interaction patterns**, not features.

## Architecture

Remain one `index.html` with three sections (CSS / HTML scaffold / JS). Reimplement the export's
React `Component` as a vanilla module:

- **State:** one central `state` object mirroring the export's `this.state`
  (`programIdx, week, data, dayId, view, now, sessionStart, rest*, pendW, pendKey, latestPr,
  openPhase, swap, tip, confirm, importMsg, importOk, theme`).
- **View-model:** a `computeVals()` function returning a plain object (the export's `renderVals()`)
  — keeps logic separate from markup.
- **Render:** per-view vanilla render functions consuming the view-model, rebuilding the app root's
  `innerHTML`. Events wired via delegation and `data-*` attributes (no inline React handlers).
- **Tick:** a 500ms `setInterval` updating `now` and expiring rest timers, plus a
  `visibilitychange` resync (already present in current app) so the timestamp-based rest timer
  survives tab backgrounding.

The export's helper methods port directly: `resolveExercise`, `getExerciseHistory`,
`priorWeekEntry`, `logSet`, `undo`, `skipSet`, `skipExercise`, `skipDay`, `completeDay`,
`toggleProtocol`, `saveEffort`, `performSwap`, `exportData`/`onImportFile` (v3 + legacy migrations),
`resetData`, `setRest`/`addRest`, migrations (`migrateOldState`, `migrateToMultiProgram`,
`migrateDayState`).

## Data & storage — preserved

- Reuse existing `PROGRAMS`, `EXERCISE_ALTERNATIVES`, `GLOSSARY` blocks verbatim.
- Keep `STORAGE_KEY = 'hypertrophy_state'` and the same derived keys:
  `hypertrophy_state_<progId>_w<week>`, `hypertrophy_program`, `hypertrophy_week_<progId>`, and the
  `hypertrophy_migrated_v3` flag.
- **First implementation step:** verify storage-key + data-schema parity between the current app and
  the export. If they differ in any way, reconcile so existing data loads unchanged. This is a hard
  gate before writing UI code.
- Export/import uses the v3 JSON format from the export, with legacy v1/v2 migration on import.

## Views & layout

Single app root; `state.view ∈ {day, plan, progress, settings}`.

- **Masthead (sticky):** day title + week `‹ ›` selector + phase line + ⚙ settings button; program
  chips (MESO 1 / MESO 2 …); scrollable tab bar (per-day tabs with complete/skip marks, + PLAN + PROGRESS).
- **Workout view:** stats row (TIME / SETS / SKIPPED / WEEK %); PR banner (when a weight PR beats a
  prior week); Skip-Day / Complete-Day buttons (Unskip-Day when applicable); shoulder-protocol
  checklist (push/pull/upper days); exercise cards — number+name, swap button, meta tags
  (`sets×reps`, RPE, rest, LLP, COMPOUND), optional note, trend mini-bars (≥2 logged weeks),
  SET/LAST/REPS/TODAY grid with per-row LOG/undo/skip states, EFFORT Low/Med/High, Skip-Exercise.
- **Plan view:** expandable mesocycle phase table (WEEKS / PHASE / RPE, "← NOW" tag, RIR + bullet
  points on expand); Execution Rules; Progression Rules; Glossary.
- **Progress view:** per-day → per-exercise weekly grid of weight cells (W1..Wn) with effort dots and
  a delta; empty-state message when nothing logged.
- **Settings view:** Export Data / Import Data (v3, with status message), This-Week stats, Clear
  This-Week's Log — **plus a new light/dark theme toggle**.
- **Overlays:** full-screen rest ring (presets 60/90/120/180, −15s/+30s/skip, minimize); swap
  bottom-sheet; tip modal (tap-to-close); confirm modal (skip/complete day, etc.).

## Interactions

- **Sticky bottom bar (workout):** active exercise name + set label, − / value / + weight stepper
  (2.5 lb steps), full-width **LOG SET**. Pending weight auto-fills from the previous set, else the
  stored weight, else the prior week's weight. When the day is done, shows "DAY COMPLETE" + summary.
- **Rest timer:** auto-starts on set log (configurable `autoStartRest`, default on) when the day
  isn't complete; full-screen overlay OR a minimized pill in the bottom bar; ring animation;
  urgent (≤10s) turns red; presets and ±15/+30 controls.
- **Skips:** per-set skip toggle, per-exercise skip/unskip, per-day skip/complete via confirm modal.
- **Tips:** RPE/LLP/compound tags open a **tap tip modal** (replaces the current app's hover
  tooltips — better on touch).

## Theming — light + dark toggle

- Move all colors to CSS custom properties with two palettes:
  - **Light** (as-export): `--bg #f2efe8`, `--ink #191813`, `--accent #e34f1e`, plus the export's
    grays (`#8a8574`, `#6b6759`, `#d8d3c6`, `#b5b0a1`, `#eae6db`, etc.).
  - **Dark editorial** (derived): warm dark background, off-white ink, same `#e34f1e` accent,
    adjusted borders/muted tones to preserve contrast and the editorial feel.
- Toggle in Settings; persist to a new `localStorage` key (e.g. `gains_theme`); default from
  `prefers-color-scheme`. Applied via a `data-theme` attribute on the root that switches the
  custom-property set.

## Fonts

Switch to **Oswald** (display), **IBM Plex Mono** (mono/labels), **Archivo** (body) via Google Fonts
CDN — consistent with the current app already loading fonts by CDN. Replaces Bebas Neue / DM Sans /
DM Mono.

## Risks & mitigations

- **Feature drift:** the current app may contain behavior not present in the export (e.g. hover
  tooltips, muscle-group sequencing tweaks, render niceties). *Mitigation:* diff the two feature sets
  before finalizing; surface anything current-only so it is consciously kept or dropped — nothing
  silently lost.
- **Storage incompatibility:** if key/schema differ, existing data could fail to load. *Mitigation:*
  the storage-parity check is a hard gate before UI work.
- **Large diff:** most of the CSS/HTML/render layer is replaced. *Mitigation:* keep data blocks and
  storage/migration logic stable; land the port on a branch and verify against real localStorage data.

## Verification

No automated test harness exists. Verify by:
1. Confirming storage-key/schema parity (pre-work gate).
2. Opening the redesigned `index.html` in a browser with existing localStorage present, and
   confirming logged sets/weights/effort/swaps render correctly across weeks and programs.
3. Walking every view and interaction: masthead/week/program switching, logging a set (stepper +
   auto-fill), rest overlay + minimize + presets, per-set/exercise/day skip + confirm, effort,
   swap, PR banner, tip modal, Plan/Progress/Settings, export/import round-trip, theme toggle
   (light ↔ dark, persistence, prefers-color-scheme default).
