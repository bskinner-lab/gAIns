# gAIns Editorial Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the single-file gAIns app to the editorial/newsprint design from the Claude-design prototype, adopting its full interaction model and adding a light/dark theme toggle, without losing any logged data.

**Architecture:** Keep `index.html` as one self-contained file (CSS / HTML scaffold / JS). **Preserve the existing data blocks and logic layer** (`PROGRAMS`, `EXERCISE_ALTERNATIVES`, `GLOSSARY`, storage/migration/state helpers) — they already match the export's expectations. **Replace the presentation layer**: the entire `<style>` block, the HTML scaffold, and the render functions (`renderTabs`, `renderDay`, `renderInfoPanel`, `renderProgressPanel`). Add the genuinely-new UI pieces: theme system, sticky LOG SET bar with weight stepper, minimizable rest pill, tip modal, stats row, and PR banner.

**Tech Stack:** Vanilla JS (no framework, no build), CSS custom properties, Google Fonts CDN (Oswald / IBM Plex Mono / Archivo), localStorage.

**User decisions (already made):**
- Scope: "Full reskin + interactions" — adopt the export's look AND its interaction patterns, closest match to the export.
- Theme: "Light + dark toggle" — build the editorial layout with both a light (as-export) and dark variant, toggle in Settings.
- Approach: "A" — port the export's logic/structure wholesale as the reference, reusing existing data blocks and localStorage schema.
- Spec approved as written, including tap-to-open tip modals replacing hover tooltips, and `prefers-color-scheme` as the theme default.

**Resolved precondition (evidence captured 2026-07-20):** Storage-key parity between the current app and the export is **confirmed identical** — `hypertrophy_state`, `hypertrophy_state_<progId>_w<week>`, `hypertrophy_week_<progId>`, `hypertrophy_program`, `hypertrophy_migrated_v3`. Day-record shape `{sets, weights, effort, protocol, swaps}` matches (`index.html:2299-2305`). One delta found: current `migrateDayState()` (`index.html:2267`) omits `swaps` on the legacy numeric-key path; the export's version preserves it. Task 1 fixes this. **No data migration is required for this redesign.**

**Reference map of the current file:**
| Region | Lines | Disposition |
|---|---|---|
| `<style>` block | 12–1421 | **Replace** (Task 2) |
| HTML scaffold `<body>` | 1423–1531 | **Replace** (Task 3) |
| `GLOSSARY` | 1534–1546 | Keep verbatim |
| `STORAGE_KEY` | 1547 | Keep verbatim |
| `PROGRAMS` | 1549–1905 | Keep verbatim |
| `EXERCISE_ALTERNATIVES` | 1906–2146 | Keep verbatim |
| `DAYS`/`MESOCYCLE`/`WEEK_PHASES`/`PROTOCOL_ITEMS` | 2147–2150 | Keep verbatim |
| Storage/state/migration helpers | 2155–2476 | Keep (one fix in Task 1) |
| Render functions | 2477–2830 | **Replace** (Tasks 4–8) |
| Action functions (`toggleSet`, `skipDay`, `showConfirm`, swaps…) | 2831–3540 | Keep, rewire to new render (Tasks 4–9) |

---

## Verification approach

This project has **no test framework and no build step** (per `CLAUDE.md`). Every task is verified two ways:

1. **Automated syntax gate** — extract the `<script>` block and parse it with Node:
   ```bash
   sed -n '1533,3539p' index.html > /tmp/gains-check.js && node --check /tmp/gains-check.js && echo "SYNTAX OK"
   ```
   Expected output: `SYNTAX OK`. (Adjust line numbers if the script block moves; derive them with
   `grep -n '<script>\|</script>' index.html`.)
2. **Manual browser check** — open `index.html` and confirm the stated behavior. Each task lists exactly what to look at.

**Before starting any task, snapshot real data so you can prove nothing is lost:**
```bash
git rev-parse --abbrev-ref HEAD   # expect: redesign/editorial-reskin
```
In the browser devtools console on the current app, run and save the output:
```javascript
copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage))))
```
Paste it into `/tmp/gains-localstorage-before.json`. Task 10 diffs against it.

---

### Task 1: Preserve swaps through legacy migration

**Goal:** Fix `migrateDayState()` so `swaps` survives the legacy numeric-key migration path, matching the export's behavior.

**Files:**
- Modify: `index.html:2267`

**Acceptance Criteria:**
- [ ] `migrateDayState()` returns an object containing a `swaps` key on the legacy path
- [ ] Existing (non-legacy) data paths are untouched — the early `return sd` for string keys still fires first
- [ ] Script block parses cleanly

**Verify:** `sed -n '1533,3539p' index.html > /tmp/gains-check.js && node --check /tmp/gains-check.js` → `SYNTAX OK`

**Steps:**

- [ ] **Step 1: Apply the one-line fix**

Change `index.html:2267` from:

```javascript
  const m = { sets: {}, weights: {}, effort: {}, protocol: sd.protocol || [] };
```

to:

```javascript
  const m = { sets: {}, weights: {}, effort: {}, protocol: sd.protocol || [], swaps: sd.swaps || {} };
```

- [ ] **Step 2: Verify syntax**

```bash
sed -n '1533,3539p' index.html > /tmp/gains-check.js && node --check /tmp/gains-check.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix: preserve swaps through legacy day-state migration"
```

---

### Task 2: Editorial theme system (CSS custom properties, light + dark)

**Goal:** Replace the entire `<style>` block with the editorial design system, defining both palettes as CSS custom properties driven by a `data-theme` attribute.

**Files:**
- Modify: `index.html:5-11` (font `<link>` tags in `<head>`)
- Modify: `index.html:12-1421` (replace whole `<style>` block)

**Acceptance Criteria:**
- [ ] Google Fonts link loads Oswald (400–700), IBM Plex Mono (400–600), Archivo (400–700)
- [ ] `:root` defines the light palette; `:root[data-theme="dark"]` overrides it with the dark palette
- [ ] `@media (prefers-color-scheme: dark)` supplies the dark palette when no `data-theme` is set
- [ ] No hard-coded hex colors remain outside the two palette blocks
- [ ] Page renders with cream background and no console errors

**Verify:** Open `index.html`; background is `#f2efe8`, body font is Archivo. Run in console: `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()` → `#e34f1e`

**Steps:**

- [ ] **Step 1: Replace the font links in `<head>`**

Replace the existing Google Fonts `<link>` tags (lines 5–11) with:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Replace the entire `<style>` block with the palette foundation**

Delete lines 12–1421 and write this as the start of the new `<style>` block:

```css
<style>
:root {
  --bg:        #f2efe8;
  --surface:   #ffffff;
  --ink:       #191813;
  --ink-soft:  #454236;
  --muted:     #6b6759;
  --muted-2:   #8a8574;
  --faint:     #b5b0a1;
  --border:    #d8d3c6;
  --border-lt: #ece8de;
  --done-bg:   #eae6db;
  --accent:    #e34f1e;
  --danger:    #c0392b;
  --ok:        #4b7a3f;
  --on-dark:   #f2efe8;
  --bar-dark:  #191813;
  --bar-line:  #33312a;
  --bar-btn:   #26241f;
  --bar-edge:  #45423a;
  --font-display: 'Oswald', sans-serif;
  --font-mono:    'IBM Plex Mono', monospace;
  --font-body:    'Archivo', sans-serif;
}

:root[data-theme="dark"] {
  --bg:        #171613;
  --surface:   #201e1a;
  --ink:       #ece8de;
  --ink-soft:  #c9c3b4;
  --muted:     #9c9686;
  --muted-2:   #8a8574;
  --faint:     #6b6759;
  --border:    #3a3730;
  --border-lt: #2a2822;
  --done-bg:   #26241f;
  --accent:    #e34f1e;
  --danger:    #e05c4b;
  --ok:        #7fa872;
  --on-dark:   #f2efe8;
  --bar-dark:  #0f0e0c;
  --bar-line:  #2a2822;
  --bar-btn:   #26241f;
  --bar-edge:  #45423a;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:        #171613;
    --surface:   #201e1a;
    --ink:       #ece8de;
    --ink-soft:  #c9c3b4;
    --muted:     #9c9686;
    --muted-2:   #8a8574;
    --faint:     #6b6759;
    --border:    #3a3730;
    --border-lt: #2a2822;
    --done-bg:   #26241f;
    --danger:    #e05c4b;
    --ok:        #7fa872;
    --bar-dark:  #0f0e0c;
    --bar-line:  #2a2822;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

#app { min-height: 100vh; display: flex; flex-direction: column; max-width: 480px; margin: 0 auto; }
#scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }

.mono { font-family: var(--font-mono); }
.disp { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 1px; }
</style>
```

The remaining component styles are added by the tasks that introduce their markup (Tasks 3–9), each appending to this block.

- [ ] **Step 3: Verify in browser**

Open `index.html`. Expected: cream background, no console errors. In console:
```javascript
getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
```
Expected: `#e34f1e`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: editorial theme system with light and dark palettes"
```

---

### Task 3: HTML scaffold, app shell, and theme bootstrap

**Goal:** Replace the `<body>` scaffold with the editorial shell (app root, scroll container, overlay mounts) and wire theme persistence.

**Files:**
- Modify: `index.html:1423-1531` (replace `<body>` scaffold)
- Modify: `index.html` `<script>` — add theme helpers and a `render()` entry point

**Acceptance Criteria:**
- [ ] `<body>` contains only `#app` (with `#masthead`, `#scroll`, `#bottombar`) and `#overlays`
- [ ] `applyTheme()` sets `data-theme` on `<html>` and persists to `localStorage.gains_theme`
- [ ] On load with no stored preference, no `data-theme` attribute is set (so `prefers-color-scheme` governs)
- [ ] A stored preference of `light` or `dark` is reapplied on reload

**Verify:** In console: `setTheme('dark')` → page turns dark, `localStorage.gains_theme === 'dark'`; reload → still dark

**Steps:**

- [ ] **Step 1: Replace the `<body>` scaffold**

Replace lines 1423–1531 with:

```html
<body>
<div id="app">
  <div id="masthead"></div>
  <div id="scroll"></div>
  <div id="bottombar"></div>
</div>
<div id="overlays"></div>
```

- [ ] **Step 2: Add theme helpers at the top of the `<script>` block**

Insert immediately after the opening `<script>` tag:

```javascript
const THEME_KEY = 'gains_theme';

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

function setTheme(t) {
  try {
    if (t) localStorage.setItem(THEME_KEY, t);
    else localStorage.removeItem(THEME_KEY);
  } catch (e) {}
  applyTheme(t);
  render();
}

function effectiveTheme() {
  const s = storedTheme();
  if (s) return s;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

applyTheme(storedTheme());
```

- [ ] **Step 3: Add the render entry point at the end of the `<script>` block**

Replace the current app bootstrap/init call with:

```javascript
const view = { name: 'day', dayId: null, openPhase: 2, tip: null, confirm: null, swap: null,
               importMsg: '', importOk: true, sessionStart: Date.now(), now: Date.now(),
               pendW: 0, pendKey: '', latestPr: null,
               restEnd: null, restTotal: 0, restInfo: '', restNext: '', restRec: '', restMinimized: false };

function render() {
  renderMasthead();
  renderScroll();
  renderBottomBar();
  renderOverlays();
}

function boot() {
  loadProgram();
  loadWeek();
  initState();
  view.dayId = getStartDay();
  render();
  setInterval(() => {
    view.now = Date.now();
    if (view.restEnd && view.restEnd <= view.now) { view.restEnd = null; view.restMinimized = false; }
    render();
  }, 500);
  document.addEventListener('visibilitychange', () => { view.now = Date.now(); render(); });
}

boot();
```

Stub the four render functions so the page loads while later tasks fill them in:

```javascript
function renderMasthead()  { document.getElementById('masthead').innerHTML = ''; }
function renderScroll()    { document.getElementById('scroll').innerHTML = ''; }
function renderBottomBar() { document.getElementById('bottombar').innerHTML = ''; }
function renderOverlays()  { document.getElementById('overlays').innerHTML = ''; }
```

- [ ] **Step 4: Add `getStartDay()` (ported from the export)**

```javascript
function getStartDay() {
  for (const day of DAYS) {
    const ids = day.exercises.map(e => resolveExercise(day.id, e).id);
    const some = ids.some(id => state[day.id].sets[id] && state[day.id].sets[id].some(isResolved));
    const all  = ids.every(id => state[day.id].sets[id] && state[day.id].sets[id].every(isResolved));
    if (some && !all) return day.id;
  }
  for (const day of DAYS) if (!isDayComplete(day.id)) return day.id;
  return DAYS[0].id;
}
```

- [ ] **Step 5: Verify**

```bash
grep -n '<script>\|</script>' index.html
sed -n "$(grep -n '<script>' index.html | cut -d: -f1),$(grep -n '</script>' index.html | cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-check.js && node --check /tmp/gains-check.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`

Open `index.html`, then in console:
```javascript
setTheme('dark'); localStorage.gains_theme
```
Expected: page turns dark, returns `"dark"`. Reload → still dark. Then `setTheme(null)` → follows OS setting.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: editorial app shell and theme bootstrap"
```

---

### Task 4: Masthead — title, week selector, program chips, tabs

**Goal:** Render the sticky masthead: day/view title, week `‹ ›` selector with phase line, settings gear, program chips, and the day/PLAN/PROGRESS tab bar.

**Files:**
- Modify: `index.html` — implement `renderMasthead()`; append masthead CSS to `<style>`
- Replace: existing `renderTabs()` (`index.html:2477`)

**Acceptance Criteria:**
- [ ] Title shows the active day's `title` on workout view, else `Plan`/`Progress`/`Settings`
- [ ] Subline shows `<day.label> · <program.name> · <day.subtitle>` on workout view
- [ ] `‹`/`›` change the week within `1..prog.totalWeeks` and persist via existing `saveWeek()`
- [ ] Phase line shows uppercase phase label, RPE, and `· LLP` when the phase has LLP
- [ ] Program chips switch programs via the existing `switchProgram()`
- [ ] Day tabs show `✓` when complete with at least one genuinely logged set, `—` when complete but all skipped
- [ ] Active tab has dark background, inactive is transparent

**Verify:** Open `index.html`; click `›` → week increments and phase line updates; click PLAN → title becomes `Plan`; reload → week persisted

**Steps:**

- [ ] **Step 1: Append masthead CSS to the `<style>` block**

```css
#masthead { padding: 18px 20px 0; position: sticky; top: 0; background: var(--bg); z-index: 5; }
.mh-top { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 3px solid var(--ink); padding-bottom: 9px; }
.mh-title { font-family: var(--font-display); font-size: 34px; font-weight: 600; line-height: .95; letter-spacing: 1px; text-transform: uppercase; }
.mh-title span { color: var(--accent); }
.mh-sub { font-family: var(--font-mono); font-size: 9px; letter-spacing: 1.2px; color: var(--muted); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mh-right { display: flex; align-items: flex-start; gap: 10px; flex: none; }
.wk-row { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.wk-btn { border: none; background: none; cursor: pointer; color: var(--muted-2); font-size: 16px; line-height: 1; padding: 2px; }
.wk-lbl { font-family: var(--font-display); font-size: 19px; font-weight: 600; color: var(--accent); min-width: 44px; text-align: center; }
.phase-line { font-family: var(--font-mono); font-size: 8px; letter-spacing: .5px; color: var(--muted); margin-top: 2px; text-align: right; }
.gear { width: 34px; height: 34px; flex: none; border: 1.5px solid var(--ink); background: transparent; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--ink); font-size: 16px; }
.gear.on { background: var(--ink); color: var(--accent); }
.prog-chips { display: flex; gap: 6px; padding: 9px 0 8px; }
.chip { font-family: var(--font-mono); font-size: 9px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; padding: 5px 11px; border-radius: 3px; cursor: pointer; border: 1.5px solid var(--border); background: transparent; color: var(--muted-2); }
.chip.on { border-color: var(--ink); background: var(--ink); color: var(--on-dark); }
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.tab { background: transparent; border: none; cursor: pointer; padding: 12px 7px; min-height: 42px; white-space: nowrap; font-family: var(--font-mono); font-size: 9px; letter-spacing: .8px; font-weight: 600; color: var(--muted-2); }
.tab.on { background: var(--ink); color: var(--on-dark); }
.tab i { color: var(--accent); font-style: normal; }
```

- [ ] **Step 2: Implement `renderMasthead()`**

```javascript
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function curProg() { return PROGRAMS[currentProgramIdx]; }
function curDay()  { return DAYS.find(d => d.id === view.dayId) || DAYS[0]; }

function renderMasthead() {
  const prog = curProg(), day = curDay(), isW = view.name === 'day';
  const phase = prog.weekPhases[week - 1];
  const title = isW ? day.title
    : view.name === 'plan' ? 'Plan' : view.name === 'progress' ? 'Progress' : 'Settings';
  const sub = isW ? `${day.label} · ${prog.name} · ${day.subtitle}`
    : view.name === 'plan' ? `${prog.name} · ${prog.subtitle}`
    : view.name === 'progress' ? `${prog.name} · weight & effort by week`
    : 'Your data stays on this device';

  const chips = PROGRAMS.map((p, i) =>
    `<button class="chip${i === currentProgramIdx ? ' on' : ''}" data-act="prog" data-i="${i}">${esc(p.name.replace('Mesocycle', 'MESO'))}</button>`
  ).join('');

  const tabs = DAYS.map(d => {
    const complete = isDayComplete(d.id);
    const ids = d.exercises.map(e => resolveExercise(d.id, e).id);
    const anyDone = complete && ids.some(id => (state[d.id].sets[id] || []).some(v => v === true));
    const on = isW && view.dayId === d.id;
    const mark = complete ? (anyDone ? ' ✓' : ' —') : '';
    return `<button class="tab${on ? ' on' : ''}" data-act="day" data-id="${d.id}">${esc(d.label.toUpperCase().replace(' ', ''))}<i>${mark}</i></button>`;
  }).join('')
    + `<button class="tab${view.name === 'plan' ? ' on' : ''}" data-act="view" data-v="plan">PLAN</button>`
    + `<button class="tab${view.name === 'progress' ? ' on' : ''}" data-act="view" data-v="progress">PROGRESS</button>`;

  document.getElementById('masthead').innerHTML = `
    <div class="mh-top">
      <div style="min-width:0">
        <div class="mh-title">${esc(title)}<span>.</span></div>
        <div class="mh-sub">${esc(sub)}</div>
      </div>
      <div class="mh-right">
        <div>
          <div class="wk-row">
            <button class="wk-btn" data-act="wk" data-d="-1" aria-label="Previous week">‹</button>
            <div class="wk-lbl">W${week}/${prog.totalWeeks}</div>
            <button class="wk-btn" data-act="wk" data-d="1" aria-label="Next week">›</button>
          </div>
          <div class="phase-line">${esc(phase.label.toUpperCase())} · ${esc(phase.rpe.replace('RPE ', ''))}${phase.llp ? ' · LLP' : ''}</div>
        </div>
        <button class="gear${view.name === 'settings' ? ' on' : ''}" data-act="settings" aria-label="Settings">⚙</button>
      </div>
    </div>
    <div class="prog-chips">${chips}</div>
    <div class="tabs">${tabs}</div>`;
}
```

- [ ] **Step 3: Add one delegated click handler for the whole app**

Add near `render()`:

```javascript
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'prog')     { switchProgram(Number(el.dataset.i)); view.dayId = getStartDay(); view.pendKey = ''; view.latestPr = null; }
  else if (act === 'wk')  { changeWeek(Number(el.dataset.d)); view.dayId = getStartDay(); view.pendKey = ''; view.latestPr = null; view.restEnd = null; }
  else if (act === 'day') { view.name = 'day'; view.dayId = el.dataset.id; view.pendKey = ''; }
  else if (act === 'view'){ view.name = el.dataset.v; }
  else if (act === 'settings') { view.name = view.name === 'settings' ? 'day' : 'settings'; }
  else return;
  render();
});
```

- [ ] **Step 4: Delete the obsolete `renderTabs()`**

Remove the old `renderTabs()` function (was `index.html:2477`) and any remaining calls to it.

- [ ] **Step 5: Verify**

Run the syntax gate. Then open `index.html`: click `›` (week increments, phase line updates), click a day tab (title changes), click PLAN (title becomes `Plan`), click ⚙ (title becomes `Settings`), reload (week persisted).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: editorial masthead with week selector, program chips, tabs"
```

---

### Task 5: Workout view — stats row, PR banner, day controls, protocol

**Goal:** Render the top of the workout view: the four-cell stats row, PR banner, Skip/Complete-Day controls, and the shoulder-protocol checklist.

**Files:**
- Modify: `index.html` — implement `renderScroll()` workout branch; append CSS

**Acceptance Criteria:**
- [ ] Stats row shows TIME (session elapsed `m:ss`), SETS (`done/total` for the day), SKIPPED, WEEK % (across all days)
- [ ] PR banner appears only when `view.latestPr` is set, showing type badge and text
- [ ] Skip-Day / Complete-Day show only when the day has pending sets; Unskip-Day shows when day is complete and has skipped sets
- [ ] Both open a confirm modal before acting, reusing existing `skipDay()` / `completeDay()`
- [ ] Protocol checklist renders only for days with `protocol: true`, toggling via existing `toggleProtocol()`

**Verify:** Open a push day; stats row TIME increments each second; check a protocol box → it fills and persists across reload

**Steps:**

- [ ] **Step 1: Append CSS**

```css
.stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--border); margin: 0 20px; }
.stat { padding: 10px 0 10px 10px; border-right: 1px solid var(--border); }
.stat:first-child { padding-left: 0; }
.stat:last-child { border-right: none; }
.stat-k { font-family: var(--font-mono); font-size: 8px; letter-spacing: 1px; color: var(--muted-2); }
.stat-v { font-family: var(--font-display); font-size: 18px; font-weight: 500; margin-top: 2px; }
.stat-v small { font-size: 11px; color: var(--muted-2); }
.pr { margin: 14px 20px 0; background: var(--ink); color: var(--on-dark); border-radius: 4px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
.pr b { font-family: var(--font-mono); font-size: 9px; font-weight: 600; letter-spacing: 1.5px; background: var(--accent); padding: 3px 7px; border-radius: 2px; flex: none; }
.pr span { font-size: 12px; line-height: 1.4; }
.daybtns { display: flex; gap: 8px; margin: 14px 20px 0; }
.dbtn { flex: 1; background: transparent; border: 1px dashed var(--faint); border-radius: 4px; color: var(--muted-2); font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 1px; padding: 8px; min-height: 38px; cursor: pointer; }
.dbtn.strong { border-color: var(--ink); color: var(--ink); }
.panel { margin: 16px 20px 0; border: 1px solid var(--ink); border-radius: 4px; padding: 12px 14px; }
.panel-h { font-family: var(--font-mono); font-size: 9px; font-weight: 600; letter-spacing: 1.5px; color: var(--accent); margin-bottom: 8px; }
.proto { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 3.5px 0; }
.proto-box { width: 15px; height: 15px; border: 1.5px solid var(--ink); flex: none; display: flex; align-items: center; justify-content: center; color: var(--on-dark); font-size: 10px; font-weight: 700; }
.proto-box.on { background: var(--ink); }
.proto span { font-size: 12px; color: var(--ink-soft); }
.proto.on span { color: var(--muted-2); }
```

- [ ] **Step 2: Add day-stat helpers**

```javascript
function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function dayStats(dayId) {
  let done = 0, total = 0, skipped = 0;
  const day = DAYS.find(d => d.id === dayId);
  day.exercises.forEach(o => {
    const ex = resolveExercise(dayId, o);
    (state[dayId].sets[ex.id] || []).forEach(v => {
      total++;
      if (v === true) done++;
      else if (v === 'skipped') skipped++;
    });
  });
  return { done, total, skipped };
}

function weekPct() {
  let done = 0, total = 0;
  DAYS.forEach(d => d.exercises.forEach(o => {
    const ex = resolveExercise(d.id, o);
    (state[d.id].sets[ex.id] || []).forEach(v => { total++; if (v === true) done++; });
  }));
  return total ? Math.round(done / total * 100) : 0;
}
```

- [ ] **Step 3: Implement the workout-view header markup**

```javascript
function workoutHeaderHTML(day) {
  const s = dayStats(day.id);
  const ids = day.exercises.map(e => resolveExercise(day.id, e).id);
  const hasPending = ids.some(id => (state[day.id].sets[id] || []).some(v => v === false));
  const hasSkipped = ids.some(id => (state[day.id].sets[id] || []).some(v => v === 'skipped'));
  const complete = isDayComplete(day.id);

  const stats = `<div class="stats">
    <div class="stat"><div class="stat-k">TIME</div><div class="stat-v">${fmtClock(view.now - view.sessionStart)}</div></div>
    <div class="stat"><div class="stat-k">SETS</div><div class="stat-v">${s.done}<small>/${s.total}</small></div></div>
    <div class="stat"><div class="stat-k">SKIPPED</div><div class="stat-v">${s.skipped}</div></div>
    <div class="stat"><div class="stat-k">WEEK</div><div class="stat-v" style="color:var(--accent)">${weekPct()}<small>%</small></div></div>
  </div>`;

  const pr = view.latestPr
    ? `<div class="pr"><b>${esc(view.latestPr.type)}</b><span>${esc(view.latestPr.text)}</span></div>` : '';

  let btns = '';
  if (hasPending) {
    btns = `<div class="daybtns">
      <button class="dbtn" data-act="skipday">SKIP DAY</button>
      <button class="dbtn strong" data-act="completeday">COMPLETE DAY</button></div>`;
  } else if (complete && hasSkipped) {
    btns = `<div class="daybtns"><button class="dbtn" data-act="skipday">UNSKIP DAY</button></div>`;
  }

  let proto = '';
  if (day.protocol) {
    const items = (curProg().protocolItems || []).map((t, i) => {
      const on = (state[day.id].protocol || [])[i];
      return `<div class="proto${on ? ' on' : ''}" data-act="proto" data-i="${i}">
        <div class="proto-box${on ? ' on' : ''}">${on ? '✓' : ''}</div><span>${esc(t)}</span></div>`;
    }).join('');
    proto = `<div class="panel"><div class="panel-h">SHOULDER PROTOCOL — BEFORE PRESSING</div>${items}</div>`;
  }

  return stats + pr + btns + proto;
}
```

- [ ] **Step 4: Extend the delegated handler**

Add these branches inside the existing `document.addEventListener('click', …)` before the final `else return;`:

```javascript
  else if (act === 'proto') { toggleProtocol(curDay().id, Number(el.dataset.i)); }
  else if (act === 'skipday') {
    view.confirm = { title: 'Skip Day?', msg: 'All remaining sets will be marked skipped.', act: 'skipday' };
  }
  else if (act === 'completeday') {
    view.confirm = { title: 'Complete Day?', msg: 'All remaining sets will be marked done.', act: 'completeday' };
  }
```

- [ ] **Step 5: Wire it into `renderScroll()`**

```javascript
function renderScroll() {
  const el = document.getElementById('scroll');
  if (view.name === 'day') el.innerHTML = workoutHeaderHTML(curDay()) + exercisesHTML(curDay());
  else if (view.name === 'plan') el.innerHTML = planHTML();
  else if (view.name === 'progress') el.innerHTML = progressHTML();
  else el.innerHTML = settingsHTML();
}
```

Add temporary stubs so the page loads until Tasks 6–8 land:

```javascript
function exercisesHTML() { return ''; }
function planHTML()      { return ''; }
function progressHTML()  { return ''; }
function settingsHTML()  { return ''; }
```

- [ ] **Step 6: Verify**

Run the syntax gate. Open `index.html` on a push day: stats row present, TIME increments each second, protocol checkboxes toggle and survive reload.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: workout stats row, PR banner, day controls, protocol panel"
```

---

### Task 6: Exercise cards and set grid

**Goal:** Render each exercise as an editorial card: numbered title, swap button, meta tags, note, trend bars, SET/LAST/REPS/TODAY grid, effort buttons, skip-exercise.

**Files:**
- Modify: `index.html` — implement `exercisesHTML()`; replace old `renderDay()` (`index.html:2509`) and `sparklineSVG()` (`index.html:2749`); append CSS

**Acceptance Criteria:**
- [ ] Each card shows zero-padded index, name, `n/total` count, and greys the name when all sets are resolved
- [ ] Tags render `sets×reps`, `RPE n`, `⏱ restLabel`, plus `LLP` and `COMPOUND` when applicable; RPE/LLP/COMPOUND open the tip modal
- [ ] Trend bars appear only with ≥2 logged weeks; otherwise the "LOG 2+ WEEKS" hint shows
- [ ] Set rows show LAST (prior week weight + effort), REPS, and TODAY with LOG / done / skip / pending states
- [ ] The active set row is highlighted with an accent top border
- [ ] Effort Low/Med/High toggles via existing `saveEffort()`
- [ ] Skip-exercise toggles via existing `skipExercise()`

**Verify:** Open a day; tap a `RPE` tag → tip modal opens; tap `skip →` on a set → row shows struck-through SKIP; reload → persisted

**Steps:**

- [ ] **Step 1: Append CSS**

```css
.ex { padding: 18px 20px 0; }
.ex-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ex-name { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: .5px; min-width: 0; }
.ex-name.done { color: var(--muted-2); }
.ex-right { display: flex; align-items: center; gap: 8px; flex: none; }
.swap { border: 1px solid var(--border); background: transparent; color: var(--muted-2); border-radius: 3px; width: 26px; height: 26px; cursor: pointer; font-size: 13px; }
.swap.on { border-color: var(--accent); color: var(--accent); background: rgba(227,79,30,.1); }
.ex-count { font-family: var(--font-mono); font-size: 9px; color: var(--muted); }
.tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.tag { font-family: var(--font-mono); font-size: 8.5px; letter-spacing: .5px; padding: 2px 7px; border-radius: 2px; border: 1px solid var(--border); color: var(--muted); }
.tag.ink { border-color: var(--ink); color: var(--ink); cursor: help; }
.tag.acc { border-color: var(--accent); color: var(--accent); cursor: help; }
.ex-note { font-family: var(--font-mono); font-size: 9.5px; color: var(--muted-2); margin-top: 6px; line-height: 1.5; }
.trend { display: flex; align-items: flex-end; gap: 14px; margin-top: 10px; }
.bars { display: flex; align-items: flex-end; gap: 6px; height: 46px; }
.bar-col { display: flex; flex-direction: column; align-items: center; gap: 3px; justify-content: flex-end; height: 46px; }
.bar-col span { font-family: var(--font-mono); font-size: 7px; color: var(--muted-2); }
.bar { width: 22px; background: var(--faint); }
.bar.now { background: var(--accent); }
.trend-empty { font-family: var(--font-mono); font-size: 9px; color: var(--faint); margin-top: 8px; }
.grid { margin-top: 12px; border: 1px solid var(--ink); border-radius: 4px; overflow: hidden; }
.grid-h, .grid-r { display: grid; grid-template-columns: 34px 1fr 1fr 104px; align-items: center; }
.grid-h { background: var(--ink); color: var(--on-dark); font-family: var(--font-mono); font-size: 8px; letter-spacing: .8px; }
.grid-h span { padding: 6px 0; }
.grid-h span:first-child { padding-left: 8px; }
.grid-h span:last-child { padding-right: 8px; text-align: right; }
.grid-r { font-family: var(--font-mono); font-size: 11px; border-top: 1px solid var(--border); }
.grid-r.active { border-top: 2px solid var(--accent); background: var(--surface); }
.grid-r.done { background: var(--done-bg); }
.grid-r > span { padding: 8px 0; }
.grid-r .n { padding-left: 8px; color: var(--faint); }
.grid-r.active .n { color: var(--accent); font-weight: 600; }
.grid-r.done .n { color: var(--muted-2); }
.grid-r .last { color: var(--muted-2); }
.cell-today { padding: 5px 8px 5px 0; text-align: right; }
.log-btn { display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: var(--on-dark); font-weight: 600; font-size: 11px; letter-spacing: 1px; min-height: 32px; padding: 0 14px; border-radius: 4px; cursor: pointer; border: none; }
.t-done { color: var(--ink); font-weight: 600; cursor: pointer; }
.t-skip { color: var(--faint); text-decoration: line-through; cursor: pointer; }
.t-pend { color: var(--faint); cursor: pointer; font-size: 10px; }
.effort { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.effort-k { font-family: var(--font-mono); font-size: 9px; letter-spacing: 1px; color: var(--muted-2); }
.eff { font-family: var(--font-mono); font-size: 9px; padding: 4px 11px; min-height: 30px; border-radius: 3px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted-2); }
.eff.on { border-color: var(--ink); background: var(--ink); color: var(--on-dark); }
.skipex { margin-top: 8px; background: transparent; border: 1px dashed var(--border); border-radius: 4px; color: var(--faint); font-family: var(--font-mono); font-size: 9px; letter-spacing: 1px; padding: 5px 12px; cursor: pointer; }
```

- [ ] **Step 2: Add the active-set helper**

```javascript
function activeSet(day) {
  for (const o of day.exercises) {
    const ex = resolveExercise(day.id, o);
    const arr = state[day.id].sets[ex.id] || [];
    const i = arr.findIndex(v => v === false);
    if (i !== -1) return { ex, orig: o, i };
  }
  return null;
}
```

- [ ] **Step 3: Implement `exercisesHTML()`**

```javascript
const EFF_LABEL = { low: 'LOW', medium: 'MED', high: 'HIGH' };

function exercisesHTML(day) {
  const act = activeSet(day);
  return day.exercises.map((orig, xi) => {
    const ex = resolveExercise(day.id, orig);
    const swapped = ex.id !== orig.id;
    const arr = state[day.id].sets[ex.id] || [];
    const dh = arr.filter(v => v === true).length;
    const sk = arr.filter(v => v === 'skipped').length;
    const allDone = (dh + sk) === ex.sets;
    const prior = priorWeekEntry(day.id, ex.id);
    const curW = state[day.id].weights[ex.id];

    let tags = `<span class="tag">${ex.sets}×${esc(ex.reps)}</span>`
      + `<span class="tag ink" data-act="tip" data-t="RPE">RPE ${esc(ex.rpe)}</span>`;
    if (ex.restLabel) tags += `<span class="tag">⏱ ${esc(ex.restLabel)}</span>`;
    if (ex.llp) tags += `<span class="tag acc" data-act="tip" data-t="LLP">LLP</span>`;
    if (ex.compound) tags += `<span class="tag" data-act="tip" data-t="compounds" style="cursor:help">COMPOUND</span>`;

    const hist = getExerciseHistory(day.id, ex.id).filter(h => h.weight != null);
    let trend = `<div class="trend-empty">▂ LOG 2+ WEEKS TO SEE A TREND</div>`;
    if (hist.length >= 2) {
      const vals = hist.map(h => h.weight), mn = Math.min(...vals), mx = Math.max(...vals);
      const bars = hist.slice(-5).map(h =>
        `<div class="bar-col"><span>W${h.week}</span><div class="bar${h.week === week ? ' now' : ''}" style="height:${Math.round(12 + (mx === mn ? 22 : (h.weight - mn) / (mx - mn) * 28))}px"></div></div>`
      ).join('');
      const diff = vals[vals.length - 1] - hist[0].weight;
      trend = `<div class="trend"><div class="bars">${bars}</div>
        <div style="flex:1"><div class="effort-k">TREND</div>
        <div style="font-size:11.5px;line-height:1.4;margin-top:2px">${diff >= 0 ? '+' : ''}${diff % 1 ? diff.toFixed(1) : diff} lb over ${hist.length} logged wks.</div></div></div>`;
    }

    const activeI = act && act.ex.id === ex.id ? act.i : -1;
    const rows = arr.map((v, i) => {
      const isActive = i === activeI;
      const setW = state[day.id].weights[`${ex.id}_${i}`];
      const shown = setW != null ? setW : (curW != null ? curW : '');
      let cell;
      if (isActive) cell = `<button class="log-btn" data-act="log">LOG</button>`;
      else if (v === true) cell = `<span class="t-done" data-act="undo" data-ex="${ex.id}" data-i="${i}">${esc(shown)} ●</span>`;
      else if (v === 'skipped') cell = `<span class="t-skip" data-act="skipset" data-ex="${ex.id}" data-i="${i}">SKIP</span>`;
      else cell = `<span class="t-pend" data-act="skipset" data-ex="${ex.id}" data-i="${i}">skip →</span>`;
      const reps = ex.reps + (ex.llp && i === arr.length - 1 && !/LLP/.test(ex.reps) ? ' +LLP' : '');
      return `<div class="grid-r${isActive ? ' active' : ''}${v === true ? ' done' : ''}">
        <span class="n">${i + 1}</span>
        <span class="last">${prior && prior.weight != null ? esc(prior.weight) : '—'}</span>
        <span>${esc(reps)}</span>
        <div class="cell-today">${cell}</div></div>`;
    }).join('');

    const effort = ['low', 'medium', 'high'].map(l => {
      const on = (state[day.id].effort[ex.id] || '') === l;
      return `<button class="eff${on ? ' on' : ''}" data-act="eff" data-ex="${ex.id}" data-l="${l}">${EFF_LABEL[l]}</button>`;
    }).join('');

    const lastCol = prior
      ? `W${prior.week}${prior.effort ? ' · ' + EFF_LABEL[prior.effort] : ''}` : 'LAST';

    return `<div class="ex">
      <div class="ex-top">
        <div class="ex-name${allDone ? ' done' : ''}">${String(xi + 1).padStart(2, '0')} ${esc(ex.name)}</div>
        <div class="ex-right">
          ${EXERCISE_ALTERNATIVES[orig.id] ? `<button class="swap${swapped ? ' on' : ''}" data-act="swap" data-orig="${orig.id}" aria-label="Swap exercise">⇄</button>` : ''}
          <div class="ex-count">${dh + sk}/${ex.sets}</div>
        </div>
      </div>
      <div class="tags">${tags}</div>
      ${ex.note ? `<div class="ex-note">${esc(ex.note)}${swapped ? '  ·  swapped' : ''}</div>` : ''}
      ${trend}
      <div class="grid">
        <div class="grid-h"><span>SET</span><span>${esc(lastCol)}</span><span>REPS</span><span>TODAY</span></div>
        ${rows}
      </div>
      <div class="effort"><span class="effort-k">EFFORT</span><div style="display:flex;gap:5px">${effort}</div></div>
      <button class="skipex" data-act="skipex" data-ex="${ex.id}">${arr.every(v => v === 'skipped') ? 'UNSKIP EXERCISE' : 'SKIP EXERCISE'}</button>
    </div>`;
  }).join('') + `<div style="height:20px"></div>`;
}
```

- [ ] **Step 4: Extend the delegated handler**

```javascript
  else if (act === 'tip')     { view.tip = el.dataset.t; }
  else if (act === 'undo')    { undoSet(curDay().id, el.dataset.ex, Number(el.dataset.i)); }
  else if (act === 'skipset') { skipSet(curDay().id, el.dataset.ex, Number(el.dataset.i)); }
  else if (act === 'skipex')  { skipExercise(curDay().id, el.dataset.ex); }
  else if (act === 'eff')     { saveEffort(curDay().id, el.dataset.ex, el.dataset.l); }
  else if (act === 'swap')    { view.swap = { dayId: curDay().id, origId: el.dataset.orig }; }
  else if (act === 'log')     { logActiveSet(); }
```

- [ ] **Step 5: Add `undoSet()`**

```javascript
function undoSet(dayId, exId, i) {
  state[dayId].sets[exId][i] = false;
  saveState();
  view.pendKey = '';
}
```

- [ ] **Step 6: Delete obsolete render code**

Remove the old `renderDay()`, `sparklineSVG()`, `toggleCard()`, and `refreshCurrentDay()` functions and any calls to them.

- [ ] **Step 7: Verify**

Run the syntax gate. Open a day: cards render with tags and set grids; tap `RPE` → tip modal state set (visible after Task 9); tap `skip →` → row struck through; reload → persisted.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: editorial exercise cards with set grid, trend bars, effort"
```

---

### Task 7: Sticky bottom bar — weight stepper, LOG SET, rest pill

**Goal:** Build the dark sticky bottom bar: active exercise + `−`/value/`+` stepper, LOG SET, the minimized rest pill, and the DAY COMPLETE state.

**Files:**
- Modify: `index.html` — implement `renderBottomBar()`, `logActiveSet()`; append CSS

**Acceptance Criteria:**
- [ ] Bar shows only on the workout view
- [ ] Stepper adjusts weight by 2.5 lb, floored at 0
- [ ] Pending weight auto-fills from previous set → stored exercise weight → prior week's weight → 0, recomputed when the active set changes
- [ ] LOG SET marks the set done, saves both `weights[exId]` and `weights[exId_i]`, and starts rest
- [ ] A weight beating the best prior week sets `view.latestPr`
- [ ] When the day is complete, the bar shows DAY COMPLETE + elapsed/sets/skips
- [ ] Minimized rest shows a pill with remaining time, `+30`, and `SKIP`

**Verify:** Log a set → weight persists to the row, rest overlay starts; minimize → pill shows countdown; `+30` adds 30s

**Steps:**

- [ ] **Step 1: Append CSS**

```css
#bottombar:empty { display: none; }
.bar { background: var(--bar-dark); color: var(--on-dark); padding: 0 16px; flex: none; }
.pill { display: flex; align-items: center; justify-content: space-between; padding: 10px 2px; border-bottom: 1px solid var(--bar-line); }
.pill-l { display: flex; align-items: center; gap: 9px; cursor: pointer; min-width: 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
.dot.urgent { background: var(--danger); }
.pill-k { font-family: var(--font-mono); font-size: 10px; letter-spacing: 1.5px; color: rgba(242,239,232,.5); }
.pill-t { font-family: var(--font-mono); font-size: 17px; font-weight: 600; color: var(--accent); }
.pill-t.urgent { color: var(--danger); }
.pill-b { background: none; border: 1px solid var(--bar-edge); border-radius: 8px; color: var(--on-dark); font-family: var(--font-mono); font-size: 12px; min-height: 44px; padding: 0 16px; cursor: pointer; }
.log-row { padding: 11px 0 14px; }
.log-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.log-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.log-set { font-family: var(--font-mono); font-size: 8px; letter-spacing: 1px; color: rgba(242,239,232,.45); flex: none; }
.log-ctl { display: flex; align-items: stretch; gap: 10px; }
.stepper { display: flex; align-items: center; gap: 6px; flex: none; }
.step-b { width: 44px; height: 52px; background: var(--bar-btn); border: 1px solid var(--bar-edge); border-radius: 8px; color: var(--on-dark); font-size: 20px; cursor: pointer; }
.step-v { text-align: center; min-width: 50px; }
.step-v div:first-child { font-family: var(--font-mono); font-size: 16px; font-weight: 600; }
.step-v div:last-child { font-family: var(--font-mono); font-size: 7px; color: rgba(242,239,232,.4); }
.log-go { flex: 1; min-width: 0; background: var(--accent); border: none; border-radius: 8px; color: var(--on-dark); font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: 1px; height: 52px; cursor: pointer; }
.done-row { display: flex; align-items: center; justify-content: space-between; padding: 15px 2px 17px; }
.done-t { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: 1.5px; color: var(--accent); }
.done-s { font-family: var(--font-mono); font-size: 11px; color: rgba(242,239,232,.6); }
```

- [ ] **Step 2: Implement `renderBottomBar()`**

```javascript
function syncPending(day, act) {
  const key = `${curProg().id}:${week}:${day.id}:${act.ex.id}:${act.i}`;
  if (view.pendKey === key) return;
  view.pendKey = key;
  const stored = state[day.id].weights[act.ex.id];
  const prev = act.i > 0 ? state[day.id].weights[`${act.ex.id}_${act.i - 1}`] : null;
  const prior = priorWeekEntry(day.id, act.ex.id);
  view.pendW = Number(prev != null ? prev : stored != null ? stored : (prior && prior.weight) || 0) || 0;
}

function renderBottomBar() {
  const el = document.getElementById('bottombar');
  if (view.name !== 'day') { el.innerHTML = ''; return; }
  const day = curDay(), act = activeSet(day), s = dayStats(day.id);

  let pill = '';
  const restMs = view.restEnd ? Math.max(0, view.restEnd - view.now) : 0;
  if (view.restEnd && view.restMinimized) {
    const urgent = restMs / 1000 <= 10;
    pill = `<div class="pill">
      <div class="pill-l" data-act="restexpand">
        <span class="dot${urgent ? ' urgent' : ''}"></span>
        <span class="pill-k">REST</span>
        <span class="pill-t${urgent ? ' urgent' : ''}">${fmtClock(restMs)}</span>
      </div>
      <div style="display:flex;gap:8px;flex:none">
        <button class="pill-b" data-act="rest+">+30</button>
        <button class="pill-b" data-act="restskip">SKIP</button>
      </div></div>`;
  }

  let body;
  if (act) {
    syncPending(day, act);
    body = `<div class="log-row">
      <div class="log-top">
        <div class="log-name">${esc(act.ex.name)}</div>
        <div class="log-set">SET ${act.i + 1}/${act.ex.sets} · ${esc(act.ex.reps)} REPS</div>
      </div>
      <div class="log-ctl">
        <div class="stepper">
          <button class="step-b" data-act="w-">−</button>
          <div class="step-v"><div>${view.pendW % 1 ? view.pendW.toFixed(1) : view.pendW}</div><div>LB</div></div>
          <button class="step-b" data-act="w+">+</button>
        </div>
        <button class="log-go" data-act="log">LOG SET</button>
      </div></div>`;
  } else {
    body = `<div class="done-row">
      <div class="done-t">DAY COMPLETE</div>
      <div class="done-s">${fmtClock(view.now - view.sessionStart)} · ${s.done}/${s.total} · ${s.skipped} skip</div>
    </div>`;
  }

  el.innerHTML = `<div class="bar">${pill}${body}</div>`;
}
```

- [ ] **Step 3: Implement `logActiveSet()`**

```javascript
function logActiveSet() {
  const day = curDay(), act = activeSet(day);
  if (!act) return;
  const { ex, i } = act, w = view.pendW;

  const hist = getExerciseHistory(day.id, ex.id).filter(h => h.week < week && h.weight != null);
  const maxPrior = hist.length ? Math.max(...hist.map(h => h.weight)) : 0;

  state[day.id].sets[ex.id][i] = true;
  state[day.id].weights[ex.id] = w;
  state[day.id].weights[`${ex.id}_${i}`] = w;
  saveState();

  view.latestPr = (maxPrior > 0 && w > maxPrior)
    ? { type: 'WEIGHT PR', text: `${ex.name} — ${w} lb beats your W${hist.find(h => h.weight === maxPrior).week} best of ${maxPrior} lb` }
    : null;
  view.pendKey = '';

  if (!isDayComplete(day.id)) {
    view.restEnd = Date.now() + ex.rest * 1000;
    view.restTotal = ex.rest;
    view.restMinimized = false;
    view.restInfo = `${ex.name} — SET ${i + 1} DONE`;
    view.restRec = ex.restLabel ? `RECOMMENDED ${ex.restLabel}` : '';
    const nxt = activeSet(day);
    view.restNext = nxt
      ? (nxt.ex.id === ex.id ? `Next: ${ex.name} — Set ${nxt.i + 1}` : `Next: ${nxt.ex.name}`)
      : 'Last set of the day!';
  }
}
```

- [ ] **Step 4: Extend the delegated handler**

```javascript
  else if (act === 'w-') { view.pendW = Math.max(0, view.pendW - 2.5); }
  else if (act === 'w+') { view.pendW = view.pendW + 2.5; }
  else if (act === 'restexpand') { view.restMinimized = false; }
  else if (act === 'restskip')   { view.restEnd = null; view.restMinimized = false; }
  else if (act === 'rest+')      { addRest(30); }
  else if (act === 'rest-')      { addRest(-15); }
```

- [ ] **Step 5: Add `addRest()` / `setRest()`**

```javascript
function setRest(sec) { view.restTotal = sec; view.restEnd = Date.now() + sec * 1000; }

function addRest(delta) {
  if (!view.restEnd) return;
  let end = view.restEnd + delta * 1000;
  if (end - Date.now() < 5000) end = Date.now() + 5000;
  view.restTotal = Math.max(view.restTotal, Math.ceil((end - Date.now()) / 1000));
  view.restEnd = end;
}
```

- [ ] **Step 6: Verify**

Run the syntax gate. Open a day: bottom bar shows the active exercise; `+`/`−` change the weight by 2.5; LOG SET fills the row and starts rest; the DAY COMPLETE state appears after the last set.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: sticky bottom bar with weight stepper, LOG SET, rest pill"
```

---

### Task 8: Plan, Progress, and Settings views

**Goal:** Render the three non-workout views, including the new theme toggle in Settings.

**Files:**
- Modify: `index.html` — implement `planHTML()`, `progressHTML()`, `settingsHTML()`; replace old `renderInfoPanel()` (`index.html:2688`) and `renderProgressPanel()` (`index.html:2776`); append CSS

**Acceptance Criteria:**
- [ ] Plan shows an expandable phase table (WEEKS/PHASE/RPE) with `← NOW` on the current phase, RIR and bullets on expand
- [ ] Plan shows Execution Rules, Progression Rules, and the Glossary
- [ ] Progress shows per-day, per-exercise weekly cells with effort dots and a delta; empty state when nothing logged
- [ ] Settings shows Export/Import, this-week stats, Clear-week, and a Light/Dark/Auto theme toggle
- [ ] The theme toggle reflects the active choice and switches immediately

**Verify:** Click PLAN → phase table expands on click; click PROGRESS → grid of weeks; ⚙ → click Dark → UI turns dark, reload → still dark

**Steps:**

- [ ] **Step 1: Append CSS**

```css
.vw { padding: 16px 20px 24px; }
.vw-sub { font-family: var(--font-mono); font-size: 9px; letter-spacing: 1.5px; color: var(--muted-2); }
.tbl { margin-top: 12px; border: 1px solid var(--ink); border-radius: 4px; overflow: hidden; }
.tbl-h { display: grid; grid-template-columns: 78px 1fr 78px; background: var(--ink); color: var(--on-dark); font-family: var(--font-mono); font-size: 8.5px; letter-spacing: 1px; }
.tbl-h span { padding: 6px 0; }
.tbl-h span:first-child { padding-left: 10px; }
.tbl-h span:last-child { padding-right: 10px; text-align: right; }
.ph { border-top: 1px solid var(--border); }
.ph.now { background: var(--surface); }
.ph-r { display: grid; grid-template-columns: 78px 1fr 78px; align-items: center; font-family: var(--font-mono); font-size: 10.5px; cursor: pointer; }
.ph-r > span { padding: 9px 0; }
.ph-r .w { padding-left: 10px; color: var(--muted-2); }
.ph-r .l { font-family: var(--font-body); font-weight: 500; color: var(--muted); }
.ph.now .ph-r .l { font-weight: 700; color: var(--ink); }
.ph-r .r { padding-right: 10px; text-align: right; color: var(--muted-2); }
.ph.now .ph-r .r { color: var(--accent); }
.ph-body { padding: 0 10px 10px; }
.ph-rir { font-size: 11px; font-style: italic; color: var(--muted); margin: 2px 0 5px; }
.bullet { display: flex; gap: 7px; font-size: 11.5px; color: var(--ink-soft); line-height: 1.5; }
.bullet i { color: var(--accent); flex: none; font-style: normal; }
.rule { display: flex; gap: 8px; font-size: 12px; color: var(--ink-soft); line-height: 1.55; padding: 3px 0; }
.rule i { color: var(--accent); flex: none; font-style: normal; }
.gl { padding: 5px 0; border-top: 1px solid var(--border-lt); }
.gl-t { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 1px; }
.gl-d { font-size: 11.5px; color: var(--muted); line-height: 1.5; margin-top: 2px; }
.pd-h { font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: 1px; border-bottom: 2px solid var(--ink); padding-bottom: 5px; margin-top: 16px; }
.pe { padding: 12px 0 4px; border-bottom: 1px solid var(--border); }
.pe-top { display: flex; align-items: baseline; justify-content: space-between; }
.pe-n { font-size: 13px; font-weight: 600; }
.pe-d { font-family: var(--font-mono); font-size: 9.5px; color: var(--accent); }
.cells { display: flex; gap: 4px; margin-top: 8px; }
.cell { flex: 1; text-align: center; border: 1px solid var(--border); border-radius: 3px; padding: 4px 0; }
.cell.now { border-color: var(--accent); background: var(--surface); }
.cell-w { font-family: var(--font-mono); font-size: 7px; color: var(--muted-2); }
.cell-v { font-family: var(--font-mono); font-size: 10px; font-weight: 600; color: var(--ink-soft); }
.cell.now .cell-v { color: var(--accent); }
.cell.empty .cell-v { color: var(--faint); }
.cell-dot { height: 4px; width: 4px; border-radius: 50%; margin: 2px auto 0; background: transparent; }
.big-btn { width: 100%; min-height: 48px; background: var(--ink); border: none; border-radius: 4px; color: var(--on-dark); font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 1.5px; cursor: pointer; }
.big-btn.ghost { background: transparent; border: 1.5px solid var(--ink); color: var(--ink); }
.kv { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 11px; color: var(--ink-soft); padding: 3px 0; }
.theme-row { display: flex; gap: 6px; margin-top: 8px; }
.theme-b { flex: 1; padding: 9px; border-radius: 4px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted-2); font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px; }
.theme-b.on { border-color: var(--ink); background: var(--ink); color: var(--on-dark); }
```

- [ ] **Step 2: Implement `planHTML()`**

```javascript
const EXEC_RULES = [
  'First set of each exercise → 3–4 sec eccentric',
  'LLP = bottom-half partials on last set only — isolations only, never compounds',
  'No failure on compounds — RPE <10 always',
  'Exercise RPE = allowed range; weekly phase sets how deep to push',
  'Rest: compounds 2–3.5 min · machines 2–2.5 min · isolations 1–1.5 min',
];

const PROG_RULES = [
  'Double progression: hit top reps → increase weight next session. Miss → repeat weight.',
  'Performance drops 2 sessions in a row → reduce volume 20%',
  'If recovery suffers, cut 1 set per exercise before adding more',
];

function phaseIndexForWeek() {
  const label = curProg().weekPhases[week - 1].label;
  return curProg().mesocycle.findIndex(m => m.label === label);
}

function planHTML() {
  const prog = curProg(), nowIdx = phaseIndexForWeek();
  const phases = prog.mesocycle.map((ph, i) => {
    const open = view.openPhase === i;
    const body = open ? `<div class="ph-body">
      <div class="ph-rir">${esc(ph.rir)}</div>
      ${ph.points.map(p => `<div class="bullet"><i>—</i><span>${esc(p)}</span></div>`).join('')}
    </div>` : '';
    return `<div class="ph${i === nowIdx ? ' now' : ''}">
      <div class="ph-r" data-act="phase" data-i="${i}">
        <span class="w">${esc(ph.weeks)}</span>
        <span class="l">${esc(ph.label)}${i === nowIdx ? '  ← NOW' : ''}</span>
        <span class="r">${esc(ph.rpe)}</span>
      </div>${body}</div>`;
  }).join('');

  const panel = (title, items) =>
    `<div class="panel" style="margin-left:0;margin-right:0"><div class="panel-h">${title}</div>${
      items.map(t => `<div class="rule"><i>→</i><span>${esc(t)}</span></div>`).join('')}</div>`;

  const gloss = Object.entries(GLOSSARY).map(([t, d]) =>
    `<div class="gl"><div class="gl-t">${esc(t)}</div><div class="gl-d">${esc(d)}</div></div>`).join('');

  return `<div class="vw">
    <div class="vw-sub">${prog.totalWeeks}-WEEK MESOCYCLE · PROGRESSIVE OVERLOAD IN PHASES</div>
    <div class="tbl"><div class="tbl-h"><span>WEEKS</span><span>PHASE</span><span>RPE</span></div>${phases}</div>
    ${panel('EXECUTION RULES', EXEC_RULES)}
    ${panel('PROGRESSION RULES', PROG_RULES)}
    <div class="panel" style="margin-left:0;margin-right:0"><div class="panel-h">GLOSSARY</div>${gloss}</div>
  </div>`;
}
```

- [ ] **Step 3: Implement `progressHTML()`**

```javascript
const DOT_COLOR = { low: 'var(--muted-2)', medium: 'var(--accent)', high: 'var(--ink)' };

function progressHTML() {
  const prog = curProg(), max = prog.totalWeeks;
  let out = '', any = false;

  DAYS.forEach(d => {
    let rows = '';
    d.exercises.forEach(o => {
      const ex = resolveExercise(d.id, o);
      const hist = getExerciseHistory(d.id, ex.id);
      if (!hist.length) return;
      any = true;
      const byWeek = {};
      hist.forEach(h => { byWeek[h.week] = h; });
      let cells = '';
      for (let w = 1; w <= max; w++) {
        const h = byWeek[w], now = w === week;
        const val = h && h.weight != null ? (h.weight % 1 ? h.weight.toFixed(1) : h.weight) : '·';
        cells += `<div class="cell${now && h ? ' now' : ''}${h ? '' : ' empty'}">
          <div class="cell-w">W${w}</div><div class="cell-v">${val}</div>
          <div class="cell-dot" style="background:${h && h.effort ? DOT_COLOR[h.effort] : 'transparent'}"></div></div>`;
      }
      const ws = hist.filter(h => h.weight != null).map(h => h.weight);
      const diff = ws.length >= 2 ? ws[ws.length - 1] - ws[0] : null;
      const delta = diff == null ? '—' : `${diff >= 0 ? '+' : ''}${diff % 1 ? diff.toFixed(1) : diff} lb`;
      rows += `<div class="pe"><div class="pe-top"><div class="pe-n">${esc(ex.name)}</div>
        <div class="pe-d">${delta}</div></div><div class="cells">${cells}</div></div>`;
    });
    if (rows) out += `<div class="pd-h">${esc(d.label)} · ${esc(d.title)}</div>${rows}`;
  });

  const empty = `<div style="text-align:center;padding:48px 20px;font-size:12px;color:var(--muted-2);line-height:1.6">
    No weights or effort logged yet.<br>Track a few sessions and your progression appears here.</div>`;

  return `<div class="vw"><div class="vw-sub">${esc(prog.name.toUpperCase())} · ● EFFORT · ▮ = THIS WEEK</div>
    ${any ? out : empty}</div>`;
}
```

- [ ] **Step 4: Implement `settingsHTML()`**

```javascript
function settingsHTML() {
  const prog = curProg(), s = dayStats(curDay().id);
  const cur = storedTheme() || 'auto';
  const tb = (v, l) => `<button class="theme-b${cur === v ? ' on' : ''}" data-act="theme" data-v="${v}">${l}</button>`;

  return `<div class="vw">
    <div class="vw-sub">BACKUP &amp; RESTORE · v3 · ALL PROGRAMS &amp; WEEKS</div>

    <div class="panel" style="margin-left:0;margin-right:0">
      <div class="panel-h">APPEARANCE</div>
      <div class="theme-row">${tb('light', 'LIGHT')}${tb('dark', 'DARK')}${tb('auto', 'AUTO')}</div>
    </div>

    <div class="panel" style="margin-left:0;margin-right:0">
      <div class="panel-h">EXPORT</div>
      <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;margin-bottom:12px">Download every logged set, weight, effort rating, swap and protocol check across all programs and weeks as a JSON file.</div>
      <button class="big-btn" data-act="export">↓ EXPORT DATA</button>
    </div>

    <div class="panel" style="margin-left:0;margin-right:0">
      <div class="panel-h">IMPORT</div>
      <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;margin-bottom:12px">Restore from a v1, v2 or v3 gAIns backup. Legacy files are migrated automatically.</div>
      <button class="big-btn ghost" data-act="import">↑ IMPORT DATA</button>
      <input type="file" id="importFile" accept="application/json,.json" style="display:none">
      ${view.importMsg ? `<div style="margin-top:10px;font-family:var(--font-mono);font-size:10px;color:${view.importOk ? 'var(--ok)' : 'var(--danger)'}">${esc(view.importMsg)}</div>` : ''}
    </div>

    <div class="panel" style="margin-left:0;margin-right:0;border-color:var(--border)">
      <div class="panel-h" style="color:var(--muted-2)">THIS WEEK · WEEK ${week}/${prog.totalWeeks}</div>
      <div class="kv"><span>Sets done</span><span>${s.done}/${s.total}</span></div>
      <div class="kv"><span>Skipped</span><span>${s.skipped}</span></div>
      <div class="kv"><span>Program</span><span>${esc(prog.name)}</span></div>
    </div>

    <button class="big-btn ghost" style="margin-top:12px;border:1px solid var(--border);color:var(--muted-2)" data-act="clearweek">CLEAR THIS WEEK'S LOG</button>
  </div>`;
}
```

- [ ] **Step 5: Extend the delegated handler**

```javascript
  else if (act === 'phase')  { view.openPhase = view.openPhase === Number(el.dataset.i) ? -1 : Number(el.dataset.i); }
  else if (act === 'theme')  { setTheme(el.dataset.v === 'auto' ? null : el.dataset.v); return; }
  else if (act === 'export') { exportData(); }
  else if (act === 'import') { document.getElementById('importFile').click(); return; }
  else if (act === 'clearweek') {
    view.confirm = { title: 'Clear Week?', msg: "This week's logged sets, weights and effort will be reset.", act: 'clearweek' };
  }
```

Wire the file input after each render (append to the end of `renderScroll()`):

```javascript
  const fi = document.getElementById('importFile');
  if (fi) fi.onchange = importDataFile;
```

- [ ] **Step 6: Delete obsolete render code**

Remove `renderInfoPanel()`, `renderProgressPanel()`, and `toggleMeso()`; keep `exportData()` and rename the existing import handler to `importDataFile(e)` if its name differs.

- [ ] **Step 7: Verify**

Run the syntax gate. Open `index.html`: PLAN expands phases; PROGRESS shows the weekly grid; ⚙ → Dark turns the UI dark and survives reload; Auto follows the OS setting.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: editorial plan, progress and settings views with theme toggle"
```

---

### Task 9: Overlays — rest, swap, tip, confirm

**Goal:** Render the four overlays: the full-screen rest ring, the swap bottom-sheet, the tip modal, and the confirm modal.

**Files:**
- Modify: `index.html` — implement `renderOverlays()`; replace existing `showConfirm()`/`closeConfirm()`/`showSwapPicker()` (`index.html:3035-3060+`); append CSS

**Acceptance Criteria:**
- [ ] Rest overlay shows when rest is running and not minimized: SVG ring, remaining time, set info, next-up text, presets (60/90/120/180), −15s/+30s/SKIP, MINIMIZE
- [ ] Ring turns red at ≤10s remaining
- [ ] Swap sheet lists alternatives from `EXERCISE_ALTERNATIVES`, plus a revert option when swapped, applying via existing `performSwap()`
- [ ] Tip modal shows the glossary term/definition and closes on tap
- [ ] Confirm modal runs the pending action on CONFIRM and dismisses on CANCEL
- [ ] Only one overlay renders at a time, topmost by priority: confirm > tip > swap > rest

**Verify:** Log a set → rest overlay appears with a counting ring; MINIMIZE → pill; tap ⇄ → swap sheet; pick an alternative → exercise name changes and persists

**Steps:**

- [ ] **Step 1: Append CSS**

```css
.ov { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 28px; }
.ov.rest { background: var(--bg); opacity: .985; flex-direction: column; }
.ov.scrim { background: rgba(25,24,19,.55); }
.ov.sheet { align-items: flex-end; padding: 0; }
.mini { position: absolute; top: 16px; right: 16px; border: 1px solid var(--border); background: none; color: var(--muted-2); font-family: var(--font-mono); font-size: 10px; letter-spacing: 1px; padding: 7px 12px; border-radius: 6px; cursor: pointer; }
.rest-k { font-family: var(--font-mono); font-size: 10px; letter-spacing: 3px; color: var(--muted-2); text-transform: uppercase; }
.rest-i { font-family: var(--font-mono); font-size: 10px; letter-spacing: 1.5px; color: var(--accent); margin-top: 8px; text-align: center; }
.rest-r { font-family: var(--font-mono); font-size: 9px; letter-spacing: 1px; color: var(--muted-2); margin-top: 4px; }
.ring-wrap { position: relative; width: 190px; height: 190px; margin: 22px 0; }
.ring-mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ring-t { font-family: var(--font-display); font-size: 58px; font-weight: 600; line-height: 1; }
.ring-t.urgent { color: var(--danger); }
.ring-s { font-family: var(--font-mono); font-size: 8px; letter-spacing: 2px; color: var(--muted-2); text-transform: uppercase; }
.preset { font-family: var(--font-mono); font-size: 10px; padding: 6px 12px; border-radius: 3px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted-2); }
.preset.on { border-color: var(--ink); color: var(--ink); }
.rest-actions { display: flex; gap: 10px; margin-top: 16px; }
.ra { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 1px; padding: 11px 22px; border-radius: 4px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted-2); }
.ra.ink { border-color: var(--ink); color: var(--ink); }
.ra.solid { border: none; background: var(--ink); color: var(--on-dark); }
.rest-next { margin-top: 20px; font-size: 12px; color: var(--muted); text-align: center; }
.sheet-in { background: var(--bg); width: 100%; border-radius: 16px 16px 0 0; max-height: 88%; overflow-y: auto; padding: 18px 18px 22px; }
.sheet-h { font-family: var(--font-display); font-size: 22px; font-weight: 600; }
.sheet-s { font-family: var(--font-mono); font-size: 10px; color: var(--muted-2); margin: 4px 0 14px; }
.opt { border: 1px solid var(--border); background: var(--surface); border-radius: 6px; padding: 11px 12px; margin-bottom: 8px; cursor: pointer; }
.opt.on { border-color: var(--accent); background: rgba(227,79,30,.06); }
.opt-n { font-size: 13.5px; font-weight: 600; }
.opt.on .opt-n { color: var(--accent); }
.opt-m { font-family: var(--font-mono); font-size: 9.5px; color: var(--muted-2); margin-top: 3px; }
.opt-d { font-size: 11px; color: var(--muted); line-height: 1.4; margin-top: 3px; }
.modal { background: var(--bg); border-radius: 8px; padding: 20px; max-width: 300px; text-align: center; }
.modal.dark { background: var(--ink); color: var(--on-dark); text-align: left; padding: 18px 18px 20px; }
.modal-t { font-family: var(--font-display); font-size: 20px; font-weight: 600; }
.modal-m { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 8px 0 18px; }
.modal-row { display: flex; gap: 10px; }
.tip-t { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 1.5px; color: var(--accent); }
.tip-d { font-size: 12.5px; line-height: 1.55; margin-top: 8px; }
.tip-c { font-family: var(--font-mono); font-size: 9px; letter-spacing: 1px; color: rgba(242,239,232,.45); margin-top: 12px; text-align: right; }
```

- [ ] **Step 2: Implement `renderOverlays()`**

```javascript
const REST_PRESETS = [60, 90, 120, 180];
const RING_C = 527.8;

function renderOverlays() {
  const el = document.getElementById('overlays');

  if (view.confirm) {
    el.innerHTML = `<div class="ov scrim"><div class="modal">
      <div class="modal-t">${esc(view.confirm.title)}</div>
      <div class="modal-m">${esc(view.confirm.msg)}</div>
      <div class="modal-row">
        <button class="ra" style="flex:1" data-act="cfx">CANCEL</button>
        <button class="ra solid" style="flex:1" data-act="cfok">CONFIRM</button>
      </div></div></div>`;
    return;
  }

  if (view.tip) {
    el.innerHTML = `<div class="ov scrim" data-act="tipx"><div class="modal dark">
      <div class="tip-t">${esc(view.tip)}</div>
      <div class="tip-d">${esc(GLOSSARY[view.tip] || '')}</div>
      <div class="tip-c">TAP TO CLOSE</div></div></div>`;
    return;
  }

  if (view.swap) {
    const { dayId, origId } = view.swap;
    const day = DAYS.find(d => d.id === dayId);
    const orig = day.exercises.find(e => e.id === origId);
    const curSwap = (state[dayId].swaps || {})[origId];
    const cur = resolveExercise(dayId, orig);
    let opts = '';
    if (curSwap) {
      opts += `<div class="opt" data-act="doswap" data-orig="${origId}" data-new="${origId}">
        <div class="opt-n">↩ ${esc(orig.name)}</div>
        <div class="opt-m">${orig.sets} sets · ${esc(orig.reps)} · RPE ${esc(orig.rpe)}</div>
        <div class="opt-d">Revert to original exercise</div></div>`;
    }
    (EXERCISE_ALTERNATIVES[origId] || []).forEach(a => {
      opts += `<div class="opt${curSwap === a.id ? ' on' : ''}" data-act="doswap" data-orig="${origId}" data-new="${a.id}">
        <div class="opt-n">${esc(a.name)}</div>
        <div class="opt-m">${a.sets} sets · ${esc(a.reps)} · RPE ${esc(a.rpe)} · ⏱ ${esc(a.restLabel)}</div>
        <div class="opt-d">${esc(a.note)}</div></div>`;
    });
    el.innerHTML = `<div class="ov scrim sheet"><div class="sheet-in">
      <div class="sheet-h">Swap Exercise</div>
      <div class="sheet-s">Current: ${esc(cur.name)}</div>
      ${opts}
      <button class="ra" style="width:100%;margin-top:4px" data-act="swapx">CANCEL</button>
    </div></div>`;
    return;
  }

  if (view.restEnd && !view.restMinimized) {
    const ms = Math.max(0, view.restEnd - view.now);
    const urgent = ms / 1000 <= 10;
    const pct = view.restTotal ? Math.max(0, ms / 1000 / view.restTotal) : 0;
    const presets = REST_PRESETS.map(s =>
      `<button class="preset${view.restTotal === s ? ' on' : ''}" data-act="preset" data-s="${s}">${fmtClock(s * 1000)}</button>`).join('');
    el.innerHTML = `<div class="ov rest">
      <button class="mini" data-act="restmin">MINIMIZE ↓</button>
      <div class="rest-k">Rest Period</div>
      <div class="rest-i">${esc(view.restInfo)}</div>
      <div class="rest-r">${esc(view.restRec)}</div>
      <div class="ring-wrap">
        <svg width="190" height="190" viewBox="0 0 190 190" style="transform:rotate(-90deg)">
          <circle cx="95" cy="95" r="84" fill="none" stroke="var(--border)" stroke-width="6"></circle>
          <circle cx="95" cy="95" r="84" fill="none" stroke="${urgent ? 'var(--danger)' : 'var(--accent)'}"
                  stroke-width="6" stroke-linecap="round" stroke-dasharray="${RING_C}"
                  stroke-dashoffset="${(RING_C * (1 - pct)).toFixed(1)}"></circle>
        </svg>
        <div class="ring-mid">
          <div class="ring-t${urgent ? ' urgent' : ''}">${fmtClock(ms)}</div>
          <div class="ring-s">remaining</div>
        </div>
      </div>
      <div style="display:flex;gap:7px">${presets}</div>
      <div class="rest-actions">
        <button class="ra" data-act="rest-">−15s</button>
        <button class="ra ink" data-act="rest+">+30s</button>
        <button class="ra solid" data-act="restskip">SKIP</button>
      </div>
      <div class="rest-next">${esc(view.restNext)}</div></div>`;
    return;
  }

  el.innerHTML = '';
}
```

- [ ] **Step 3: Extend the delegated handler**

```javascript
  else if (act === 'restmin') { view.restMinimized = true; }
  else if (act === 'preset')  { setRest(Number(el.dataset.s)); }
  else if (act === 'tipx')    { view.tip = null; }
  else if (act === 'swapx')   { view.swap = null; }
  else if (act === 'doswap')  { performSwap(view.swap.dayId, el.dataset.orig, el.dataset.new); view.swap = null; view.pendKey = ''; }
  else if (act === 'cfx')     { view.confirm = null; }
  else if (act === 'cfok')    {
    const c = view.confirm; view.confirm = null;
    if (c.act === 'skipday') skipDay(curDay().id);
    else if (c.act === 'completeday') completeDay(curDay().id);
    else if (c.act === 'clearweek') { resetWeek(); view.importMsg = "This week's log cleared."; view.importOk = true; }
  }
```

- [ ] **Step 4: Add `resetWeek()`**

```javascript
function resetWeek() {
  DAYS.forEach(day => {
    state[day.id].protocol = [];
    state[day.id].weights = {};
    state[day.id].effort = {};
    day.exercises.forEach(o => {
      const ex = resolveExercise(day.id, o);
      state[day.id].sets[ex.id] = Array(ex.sets).fill(false);
    });
  });
  saveState();
  view.latestPr = null;
  view.pendKey = '';
}
```

- [ ] **Step 5: Delete obsolete overlay code**

Remove the old `showConfirm()`, `closeConfirm()`, `showSwapPicker()`, `tip()` functions and any timer-overlay DOM helpers that referenced the removed scaffold.

- [ ] **Step 6: Verify**

Run the syntax gate. Open a day: log a set → rest overlay with counting ring; MINIMIZE → pill; tap ⇄ → swap sheet, select an alternative → name changes, reload → persists; tap RPE tag → tip modal; Skip Day → confirm modal.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: rest, swap, tip and confirm overlays"
```

---

### Task 10: Full-app verification and data-integrity check

**Goal:** Confirm the redesigned app works end to end and that no logged data was lost or altered.

**Files:**
- Modify: `index.html` (only if defects are found)
- Modify: `CLAUDE.md` (update the architecture description)

**Acceptance Criteria:**
- [ ] Script block parses cleanly
- [ ] No dead references remain to deleted functions
- [ ] localStorage after the redesign is byte-identical to the pre-work snapshot for all `hypertrophy_*` keys, apart from intentional edits
- [ ] Every view and interaction listed below behaves correctly in both light and dark themes
- [ ] `CLAUDE.md` reflects the new architecture (render layer, theme system, fonts)

**Verify:** All checks below pass, and the localStorage diff shows no unintended changes

**Steps:**

- [ ] **Step 1: Syntax + dead-reference scan**

```bash
sed -n "$(grep -n '<script>' index.html | cut -d: -f1),$(grep -n '</script>' index.html | cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-check.js
node --check /tmp/gains-check.js && echo "SYNTAX OK"
grep -nE "renderTabs|renderDay\(|renderInfoPanel|renderProgressPanel|sparklineSVG|toggleCard|refreshCurrentDay|showSwapPicker|showConfirm|closeConfirm|toggleMeso" index.html
```
Expected: `SYNTAX OK`, and the `grep` returns **no matches**.

- [ ] **Step 2: Data-integrity diff**

Open the app, then in the devtools console:
```javascript
copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage))))
```
Save to `/tmp/gains-localstorage-after.json`, then:
```bash
diff <(jq -S 'with_entries(select(.key|startswith("hypertrophy")))' /tmp/gains-localstorage-before.json) \
     <(jq -S 'with_entries(select(.key|startswith("hypertrophy")))' /tmp/gains-localstorage-after.json) \
  && echo "DATA IDENTICAL"
```
Expected: `DATA IDENTICAL` (or only differences you deliberately made while testing).

- [ ] **Step 3: Manual walkthrough — run twice, once per theme**

- [ ] Masthead: week `‹`/`›` changes week and phase line; persists across reload
- [ ] Program chips switch program; day tabs and content update
- [ ] Day tabs show `✓` / `—` marks correctly
- [ ] Stats row: TIME counts up, SETS/SKIPPED/WEEK % accurate
- [ ] Log a set via the bottom bar: stepper ±2.5, weight lands in the row, rest starts
- [ ] Rest: ring counts down, red at ≤10s, presets set duration, −15/+30 work, MINIMIZE→pill→expand
- [ ] Undo a logged set; skip a set; skip/unskip an exercise; skip/complete a day via confirm
- [ ] Effort Low/Med/High toggles and persists
- [ ] Swap an exercise, then revert; both persist
- [ ] PR banner appears when beating a prior week's best
- [ ] Tip modal opens from RPE / LLP / COMPOUND tags and closes on tap
- [ ] PLAN: phases expand/collapse, `← NOW` on current phase, rules + glossary render
- [ ] PROGRESS: weekly cells, effort dots, deltas; empty state on a fresh program
- [ ] SETTINGS: export downloads JSON; re-import restores; clear-week works; theme toggle Light/Dark/Auto

- [ ] **Step 4: Update `CLAUDE.md`**

Revise the Architecture section to describe: the editorial theme system (CSS custom properties, `data-theme`, light/dark/auto), the new render layer (`renderMasthead`/`renderScroll`/`renderBottomBar`/`renderOverlays` driven by a single `view` object and one delegated click handler), the sticky LOG SET bar, and the Oswald/IBM Plex Mono/Archivo fonts. Keep the single-file, no-build, localStorage notes.

- [ ] **Step 5: Commit**

```bash
git add index.html CLAUDE.md
git commit -m "docs: update CLAUDE.md for editorial redesign architecture"
```

---

## Self-review notes

- **Spec coverage:** Architecture → Task 3; data/storage preservation → precondition + Tasks 1, 10; views → Tasks 4–8; interactions → Tasks 6, 7, 9; theming → Tasks 2, 3, 8; fonts → Task 2; risks/feature-diff → precondition + Task 10 dead-reference scan; verification → per-task gates + Task 10.
- **Naming consistency:** `renderMasthead`/`renderScroll`/`renderBottomBar`/`renderOverlays`, `view` state object, `curProg()`/`curDay()`, `activeSet()`, `dayStats()`, `fmtClock()`, `esc()`, `setRest()`/`addRest()`, `logActiveSet()`, `undoSet()`, `resetWeek()` are used consistently across Tasks 3–10.
- **Preserved from the existing app:** `PROGRAMS`, `EXERCISE_ALTERNATIVES`, `GLOSSARY`, `STORAGE_KEY`, `week`, `state`, `currentProgramIdx`, `resolveExercise`, `isResolved`, `isDayComplete`, `getExerciseHistory`, `priorWeekEntry`, `saveState`/`loadState`, `initState`, `loadWeek`/`saveWeek`, `loadProgram`/`saveProgram`, `changeWeek`, `switchProgram`, `skipSet`, `skipExercise`, `skipDay`, `completeDay`, `toggleProtocol`, `saveEffort`, `performSwap`, `exportData`, migrations.
