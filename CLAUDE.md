# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

gAIns is a single-file hypertrophy workout tracker (`index.html`) — no build tools, no dependencies, no server. Open the file directly in a browser to use.

## Architecture

Everything lives in one `index.html` file with three sections:

1. **CSS** (~910 lines) — Dark theme with CSS custom properties (`--bg`, `--accent`, `--green`, etc.). Mobile-responsive at 480px breakpoint.
2. **HTML** (~70 lines) — Minimal scaffold: a global tooltip div, timer overlay, header with week selector/progress ring, tab bar, and a `#mainContent` container. All workout content is JS-rendered.
3. **JavaScript** (~750 lines) — Vanilla JS, no frameworks. Key parts:
   - **Data constants**: `DAYS` (5 workout days with exercises), `PROTOCOL_ITEMS` (shoulder prehab checklist), `MESOCYCLE` (8-week periodization phases), `WEEK_PHASES`, `GLOSSARY`
   - **State management**: `state` object keyed by day ID, holding `sets` (completion booleans), `weights` (per-exercise and per-set), and `protocol` (checklist). Persisted to `localStorage` under `STORAGE_KEY`.
   - **Rendering**: `renderDay()` builds exercise cards with set buttons, weight inputs, protocol checklists. `renderInfoPanel()` builds the Plan tab with mesocycle info and glossary. `switchDay()` swaps active content.
   - **Rest timer**: Timestamp-based (survives tab backgrounding). Uses `visibilitychange` to resync. Configurable presets (60/90/120/180s). Full-screen overlay with SVG ring animation.
   - **Tooltips**: Event-delegated hover/touch tooltips using a fixed-position `#tooltip` div with `data-tip` attributes.

## Key Design Decisions

- **Single file by design** — intended to be self-contained and portable. Don't split into separate files unless explicitly asked.
- **No build step** — uses Google Fonts CDN (Bebas Neue, DM Sans, DM Mono) directly.
- **localStorage persistence** — all workout progress, weights, and week number stored client-side.
- **Shoulder-cautious program** — the app is tailored for a user with shoulder considerations. Protocol sections appear on push/pull/upper days.
- **Week system** — 8-week mesocycle with phases (Foundation → Overload → High Stimulus → Overreach → Deload) that affect RPE targets and whether LLP is active.

## Development

No build or test commands. To develop:
- Edit `index.html`
- Open in browser (or refresh) to see changes
- State persists in localStorage; clear it manually or via devtools to reset
