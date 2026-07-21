# Workout Plan Generator (`/newplan`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/newplan` slash command that analyzes the user's exported training history, applies researched hypertrophy constraints, and appends a validated new mesocycle to `index.html`.

**Architecture:** A thin Claude-driven orchestrator prompt (`.claude/commands/newplan.md`) surrounded by deterministic Node helpers in `tools/`. All helpers share one module, `tools/app-shim.js`, which evaluates the app's `<script>` block under a minimal DOM shim — that gives every tool the real `PROGRAMS` and `EXERCISE_ALTERNATIVES` objects instead of regex-parsed approximations, and doubles as the headless render test. Claude does only the part that needs judgment: designing the block from the analysis report and the evidence doc.

**Tech Stack:** Vanilla Node 24 (no dependencies), `node --test` + `node:assert` for tests, plain JSON data files. The app itself stays a single dependency-free `index.html`.

**User decisions (already made):**
- Improvements are driven by program definitions **plus** the user's exported training data (not paper-only, not a run-time questionnaire alone).
- The export is dropped into a gitignored `data/`; the newest `*.json` wins. No path argument.
- Web research is cached in `docs/training-evidence.md`, refreshed via `/newplan --research` — not re-searched every run.
- New programs are **appended** as the next `mesoN` and auto-selected on next load; `meso1`/`meso2` and their history are never touched.
- The command **pauses for approval** with a summary brief before writing to `index.html`.
- Three multiple-choice questions at run time: days available, shoulder/joint status, emphasis.
- Architecture A: slash command + deterministic Node helpers.

**Deviation from the spec (deliberate):** the spec listed five helper files; this plan adds a sixth, `tools/app-shim.js`. During planning I confirmed the app's script block evals cleanly under a shim, which makes loading real `PROGRAMS`/`EXERCISE_ALTERNATIVES` strictly more reliable than parsing them out of the HTML. Three tools need that capability, so it is factored out rather than triplicated.

**Pre-existing bug found during planning (Task 2 fixes it):** `DAYS`, `MESOCYCLE`, `WEEK_PHASES`, and `PROTOCOL_ITEMS` are only reassigned inside `switchProgram()`, which `boot()` never calls. Verified headlessly: with `hypertrophy_program = 1`, the masthead reads "Mesocycle 2" while `DAYS[0].exercises[0].id` is `incline_db_press` (meso1's). Auto-selecting a newly generated program cannot work until this is fixed.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/app-shim.js` | Eval `index.html`'s script under a DOM/localStorage shim; expose app globals |
| `tools/muscle-map.json` | Exercise id → muscle groups with fractional credit (66 program exercises) |
| `tools/volume-landmarks.json` | Machine-readable MEV/MAV/MRV per muscle, mirroring the evidence doc |
| `tools/analyze-history.js` | Export + programs + maps → markdown analysis report |
| `tools/smoke-render.js` | Headless render of every view for a given program index |
| `tools/insert-program.js` | Validate a program JSON and splice it into `index.html` behind four gates |
| `docs/training-evidence.md` | Researched constraints with citations (the rulebook) |
| `.claude/commands/newplan.md` | Orchestrator prompt |
| `index.html` | Two additions: `syncProgramGlobals()` and `autoSelectNewProgram()` |

Tests live beside their subject as `tools/<name>.test.js` and run with `node --test tools/*.test.js`.

## Amendments during execution

**A1 — `app-shim.js` needs `withApp(opts, fn)` (affects Tasks 1 and 7).** The plan's
`loadApp()` restores globals in a `finally` block before returning, but `render()` calls
`document.getElementById()` fresh on every invocation. Any consumer calling `app.render()`
after `loadApp()` returns therefore throws `document is not defined` — which blocks
`smoke-render.js` entirely. This was a design error in the plan, caught by the Task 7
implementer.

Fix: `loadApp()` keeps its teardown-on-return semantics, which are correct for the
data-only consumers (`analyze-history.js` and `insert-program.js`'s validation half read
`PROGRAMS`/`EXERCISE_ALTERNATIVES`, both captured at eval time). Task 1 additionally
exports `withApp(opts, fn)`, which holds the globals live for the duration of `fn` and
tears down in `finally` afterward, propagating `fn`'s return value and tearing down
correctly if `fn` throws. Task 7's `smokeRender()` runs its entire render loop inside one
`withApp()` callback and still returns `{ok:false, error}` rather than throwing —
including when `withApp` itself throws on malformed HTML, since Task 9 uses it as a gate
against candidate files that are sometimes legitimately broken.

**A2 — Task 1 review fixes.** Three defects found in review, all fixed in Task 1:
`clickHandler` captured `primeAudio` (registered first, `{once:true}`) instead of the
delegated `data-act` dispatcher; the global-restore path wrote a data descriptor over
Node's getter-only `global.navigator` accessor, permanently corrupting its descriptor
shape for the process; and there was no test covering the throw-path restore. Also, Node
24 required setting globals via `Object.defineProperty` rather than plain assignment,
since `global.navigator` is a getter-only accessor property.

---

### Task 1: Dev harness — `tools/app-shim.js`

**Goal:** A reusable module that loads the app's script block headlessly and returns its live globals, so every other tool reads real program data.

**Files:**
- Create: `tools/app-shim.js`
- Create: `tools/app-shim.test.js`
- Create: `.gitignore`

**Acceptance Criteria:**
- [ ] `loadApp()` returns `PROGRAMS` with 2 entries whose ids are `meso1`, `meso2`
- [ ] `loadApp()` returns `EXERCISE_ALTERNATIVES` as a non-empty object
- [ ] `loadApp({ storage: { hypertrophy_program: '1' } })` seeds localStorage before boot
- [ ] Repeated `loadApp()` calls do not leak globals between loads
- [ ] `data/` is gitignored

**Verify:** `node --test tools/app-shim.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// tools/app-shim.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, extractScript } = require('./app-shim');

test('extractScript returns the app script block', () => {
  const src = extractScript();
  assert.ok(src.includes('const PROGRAMS = ['));
  assert.ok(!src.includes('<script>'));
});

test('loadApp exposes real program data', () => {
  const app = loadApp();
  assert.strictEqual(app.PROGRAMS.length, 2);
  assert.deepStrictEqual(app.PROGRAMS.map(p => p.id), ['meso1', 'meso2']);
  assert.ok(Object.keys(app.EXERCISE_ALTERNATIVES).length > 0);
});

test('loadApp seeds localStorage before boot', () => {
  const app = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(app.currentProgramIdx, 1);
});

test('loadApp does not leak globals', () => {
  loadApp();
  assert.strictEqual(typeof global.PROGRAMS, 'undefined');
  assert.strictEqual(typeof global.document, 'undefined');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/app-shim.test.js`
Expected: FAIL with `Cannot find module './app-shim'`

- [ ] **Step 3: Write the implementation**

```js
// tools/app-shim.js
'use strict';
const fs = require('fs');
const path = require('path');

const APP_HTML = path.join(__dirname, '..', 'index.html');

function extractScript(htmlPath = APP_HTML) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`no <script> block found in ${htmlPath}`);
  }
  return html.slice(open + '<script>'.length, close);
}

function makeStorage(seed = {}) {
  const store = Object.assign(Object.create(null), seed);
  return {
    _store: store,
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

// Canvas 2D context stub: every method is a no-op, gradients answer addColorStop.
function makeCtx2d() {
  return new Proxy({}, {
    get: (_t, key) => {
      if (key === 'measureText') return () => ({ width: 0 });
      if (key === 'canvas') return undefined;
      return () => ({ addColorStop() {} });
    },
  });
}

function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, blur() {}, click() {}, scrollTo() {},
    getContext: () => makeCtx2d(),
    toDataURL: () => 'data:,',
  };
}

const GLOBAL_KEYS = [
  'window', 'document', 'localStorage', 'navigator', 'Notification',
  'AudioContext', 'webkitAudioContext', 'Blob', 'URL',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'requestAnimationFrame', 'alert',
];

/**
 * Evaluate the app script under a DOM shim.
 * @param {{htmlPath?: string, storage?: Record<string,string>}} opts
 * @returns {{PROGRAMS: any[], EXERCISE_ALTERNATIVES: object, DAYS: any[],
 *            currentProgramIdx: number, currentWeek: number, view: object,
 *            render: Function, switchProgram: Function,
 *            storage: object, elements: Map<string, object>,
 *            clickHandler: Function|null}}
 */
function loadApp({ htmlPath, storage: seed } = {}) {
  const saved = {};
  for (const k of GLOBAL_KEYS) saved[k] = global[k];

  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  let clickHandler = null;
  const storage = makeStorage(seed);

  const doc = {
    documentElement: makeElement('html'),
    body: makeElement('body'),
    head: makeElement('head'),
    hidden: false,
    getElementById,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: tag => makeElement(tag),
    addEventListener: (type, fn) => { if (type === 'click' && !clickHandler) clickHandler = fn; },
    removeEventListener() {},
  };

  global.window = {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { href: '' },
  };
  global.document = doc;
  global.localStorage = storage;
  global.navigator = { userAgent: 'node', vibrate() {} };
  global.Notification = function () {};
  global.Notification.permission = 'default';
  global.Notification.requestPermission = () => Promise.resolve('default');
  global.AudioContext = global.webkitAudioContext = function () {
    return {
      state: 'running', currentTime: 0, destination: {},
      resume() {}, close() {},
      createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' }),
      createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} } }),
    };
  };
  global.Blob = function () {};
  global.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
  global.setInterval = () => 0;
  global.setTimeout = () => 0;
  global.clearInterval = () => {};
  global.clearTimeout = () => {};
  global.requestAnimationFrame = () => 0;
  global.alert = () => {};

  try {
    const src = extractScript(htmlPath);
    // The script ends with boot(); the tail expression hands back live bindings.
    const api = eval(
      src +
      '\n;({ PROGRAMS, EXERCISE_ALTERNATIVES, DAYS, MESOCYCLE, WEEK_PHASES,' +
      ' PROTOCOL_ITEMS, currentProgramIdx, currentWeek, state, view,' +
      ' render, switchProgram, boot })'
    );
    return Object.assign(api, { storage, elements, get clickHandler() { return clickHandler; } });
  } finally {
    for (const k of GLOBAL_KEYS) {
      if (saved[k] === undefined) delete global[k];
      else global[k] = saved[k];
    }
  }
}

module.exports = { loadApp, extractScript, makeStorage, APP_HTML };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/app-shim.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Create `.gitignore`**

```
data/
*.tmp.html
newplan.json
```

- [ ] **Step 6: Commit**

```bash
git add tools/app-shim.js tools/app-shim.test.js .gitignore
git commit -m "feat(tools): headless app shim for reading program data"
```

---

### Task 2: Fix boot-time program desync in `index.html`

**Goal:** Make `boot()` sync `DAYS`/`MESOCYCLE`/`WEEK_PHASES`/`PROTOCOL_ITEMS` to the saved program, so a non-zero saved program renders its own days.

**Files:**
- Modify: `index.html` — add `syncProgramGlobals()` near `switchProgram()` (around line 1020), reuse it inside `switchProgram()` (lines 1024–1030), call it from `boot()` (around line 2447)
- Create: `tools/program-sync.test.js`

**Acceptance Criteria:**
- [ ] With `hypertrophy_program = '1'`, `DAYS[0].exercises[0].id === 'm2_incline_smith'`
- [ ] With no saved program, `DAYS[0].exercises[0].id === 'incline_db_press'`
- [ ] `switchProgram()` still updates all four globals (no behavior regression)
- [ ] `node --check` on the extracted script passes

**Verify:** `node --test tools/program-sync.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// tools/program-sync.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');

test('boot syncs DAYS to the saved program', () => {
  const app = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.strictEqual(app.DAYS[0].exercises[0].id, 'm2_incline_smith');
  assert.strictEqual(app.WEEK_PHASES, app.PROGRAMS[1].weekPhases);
  assert.strictEqual(app.PROTOCOL_ITEMS, app.PROGRAMS[1].protocolItems);
});

test('boot defaults to the first program', () => {
  const app = loadApp();
  assert.strictEqual(app.currentProgramIdx, 0);
  assert.strictEqual(app.DAYS[0].exercises[0].id, 'incline_db_press');
});

test('switchProgram still updates the globals', () => {
  const app = loadApp();
  app.switchProgram(1);
  const after = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(after.DAYS[0].exercises[0].id, 'm2_incline_smith');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/program-sync.test.js`
Expected: FAIL — first test reports `'incline_db_press' !== 'm2_incline_smith'`

- [ ] **Step 3: Add `syncProgramGlobals()` to `index.html`**

Insert immediately before `let programInitialized = false;` (currently line 1020):

```js
function syncProgramGlobals() {
  const prog = PROGRAMS[currentProgramIdx];
  DAYS = prog.days;
  MESOCYCLE = prog.mesocycle;
  WEEK_PHASES = prog.weekPhases;
  PROTOCOL_ITEMS = prog.protocolItems;
  rebuildLegacyIdMap();
}
```

- [ ] **Step 4: Reuse it inside `switchProgram()`**

Replace these lines in `switchProgram()`:

```js
  const prog = PROGRAMS[idx];
  currentProgramIdx = idx;
  DAYS = prog.days;
  MESOCYCLE = prog.mesocycle;
  WEEK_PHASES = prog.weekPhases;
  PROTOCOL_ITEMS = prog.protocolItems;
  rebuildLegacyIdMap();
```

with:

```js
  currentProgramIdx = idx;
  syncProgramGlobals();
```

- [ ] **Step 5: Call it from `boot()`**

In `boot()`, replace `loadProgram();` with:

```js
  loadProgram();
  syncProgramGlobals();
```

- [ ] **Step 6: Run tests and syntax check**

```bash
node --test tools/program-sync.test.js
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
```

Expected: 3 tests pass; `node --check` silent (exit 0)

- [ ] **Step 7: Commit**

```bash
git add index.html tools/program-sync.test.js
git commit -m "fix: sync program globals at boot so saved program renders its own days"
```

---

### Task 3: `autoSelectNewProgram()` in `index.html`

**Goal:** On first load after a new program is appended, switch to it automatically; otherwise leave the user's manual choice alone.

**Files:**
- Modify: `index.html` — add `autoSelectNewProgram()` beside `loadProgram()` (around line 977), call it from `boot()`
- Create: `tools/auto-select.test.js`

**Acceptance Criteria:**
- [ ] Fresh install (no `hypertrophy_seen_programs`) records all ids and does **not** override the saved program
- [ ] When an unseen program id exists, `currentProgramIdx` becomes its index and `hypertrophy_program` is persisted
- [ ] After auto-select, `hypertrophy_seen_programs` contains every current id
- [ ] A second load with no new programs leaves the manual selection intact
- [ ] Corrupt `hypertrophy_seen_programs` JSON is treated as absent, not thrown

**Verify:** `node --test tools/auto-select.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// tools/auto-select.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');

test('fresh install records ids without hijacking the saved program', () => {
  const app = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});

test('an unseen program is auto-selected', () => {
  const app = loadApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(['meso1']),
    },
  });
  // meso2 is unseen, so the app should jump to it.
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.strictEqual(app.storage.getItem('hypertrophy_program'), '1');
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});

test('manual selection sticks when nothing is new', () => {
  const app = loadApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(['meso1', 'meso2']),
    },
  });
  assert.strictEqual(app.currentProgramIdx, 0);
});

test('corrupt seen-programs value is tolerated', () => {
  const app = loadApp({
    storage: { hypertrophy_program: '1', hypertrophy_seen_programs: '{not json' },
  });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/auto-select.test.js`
Expected: FAIL — `hypertrophy_seen_programs` is `null`, so `JSON.parse` throws

- [ ] **Step 3: Add `autoSelectNewProgram()` to `index.html`**

Insert immediately after `saveProgram()` (currently ends line 987):

```js
const SEEN_PROGRAMS_KEY = 'hypertrophy_seen_programs';

// Jump to a newly added program the first time it appears. On a fresh install we
// only record what exists, so we never override a deliberate selection.
function autoSelectNewProgram() {
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_PROGRAMS_KEY)); } catch(e) {}
  const ids = PROGRAMS.map(p => p.id);
  if (Array.isArray(seen)) {
    const unseenIdx = PROGRAMS.findIndex(p => !seen.includes(p.id));
    if (unseenIdx !== -1) {
      currentProgramIdx = unseenIdx;
      saveProgram();
    }
  }
  try { localStorage.setItem(SEEN_PROGRAMS_KEY, JSON.stringify(ids)); } catch(e) {}
}
```

- [ ] **Step 4: Call it from `boot()`**

In `boot()`, the program lines become:

```js
  loadProgram();
  autoSelectNewProgram();
  syncProgramGlobals();
```

- [ ] **Step 5: Run tests and syntax check**

```bash
node --test tools/auto-select.test.js tools/program-sync.test.js
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
```

Expected: 7 tests pass; `node --check` exit 0

- [ ] **Step 6: Commit**

```bash
git add index.html tools/auto-select.test.js
git commit -m "feat: auto-select newly added programs on first load"
```

---

### Task 4: Muscle map and volume landmarks

**Goal:** Machine-readable data for per-muscle volume accounting: which muscles each exercise trains, and what weekly set counts are appropriate.

**Files:**
- Create: `tools/muscle-map.json`
- Create: `tools/volume-landmarks.json`
- Create: `tools/muscle-map.test.js`

**Acceptance Criteria:**
- [ ] Every exercise id appearing in any `PROGRAMS[].days[].exercises[]` has a map entry
- [ ] Every muscle named in the map exists in `volume-landmarks.json`
- [ ] All credit values are numbers in `(0, 1]`
- [ ] Landmarks satisfy `mev <= mavLow <= mavHigh <= mrv` for every muscle

**Verify:** `node --test tools/muscle-map.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// tools/muscle-map.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');
const muscleMap = require('./muscle-map.json');
const landmarks = require('./volume-landmarks.json');

test('every program exercise is mapped', () => {
  const { PROGRAMS } = loadApp();
  const missing = [];
  for (const prog of PROGRAMS) {
    for (const day of prog.days) {
      for (const ex of day.exercises) {
        if (!muscleMap[ex.id]) missing.push(`${prog.id}/${day.id}/${ex.id}`);
      }
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('every mapped muscle has landmarks', () => {
  const unknown = new Set();
  for (const credits of Object.values(muscleMap)) {
    for (const muscle of Object.keys(credits)) {
      if (!landmarks[muscle]) unknown.add(muscle);
    }
  }
  assert.deepStrictEqual([...unknown], []);
});

test('credits are in (0, 1]', () => {
  for (const [exId, credits] of Object.entries(muscleMap)) {
    for (const [muscle, value] of Object.entries(credits)) {
      assert.ok(typeof value === 'number' && value > 0 && value <= 1,
        `${exId}.${muscle} = ${value}`);
    }
  }
});

test('landmarks are ordered mev <= mavLow <= mavHigh <= mrv', () => {
  for (const [muscle, l] of Object.entries(landmarks)) {
    assert.ok(l.mev <= l.mavLow, `${muscle}: mev > mavLow`);
    assert.ok(l.mavLow <= l.mavHigh, `${muscle}: mavLow > mavHigh`);
    assert.ok(l.mavHigh <= l.mrv, `${muscle}: mavHigh > mrv`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/muscle-map.test.js`
Expected: FAIL with `Cannot find module './muscle-map.json'`

- [ ] **Step 3: Write `tools/muscle-map.json`**

Primary movers get `1.0`; secondary movers get `0.5` so per-muscle volume is not inflated. Exercise ids not listed here (the `alt_*` swap targets) inherit the muscle profile of the exercise they replaced — swap alternatives are curated same-function substitutes, so that fallback is correct by construction and is implemented in Task 5.

```json
{
  "incline_db_press":      { "chest": 1.0, "front_delt": 0.5, "triceps": 0.5 },
  "machine_chest_press":   { "chest": 1.0, "front_delt": 0.5, "triceps": 0.5 },
  "seated_db_press":       { "front_delt": 1.0, "side_delt": 0.5, "triceps": 0.5 },
  "cable_chest_fly":       { "chest": 1.0 },
  "cable_lat_raise_push":  { "side_delt": 1.0 },
  "rope_pushdown":         { "triceps": 1.0 },
  "overhead_cable_ext":    { "triceps": 1.0 },
  "pullups_pulldown":      { "lats": 1.0, "upper_back": 0.5, "biceps": 0.5 },
  "chest_supported_row":   { "upper_back": 1.0, "lats": 1.0, "biceps": 0.5 },
  "single_arm_cable_row":  { "lats": 1.0, "upper_back": 0.5, "biceps": 0.5 },
  "face_pulls":            { "rear_delt": 1.0, "upper_back": 0.5, "traps": 0.5 },
  "rear_delt_cable_fly":   { "rear_delt": 1.0 },
  "incline_db_curl":       { "biceps": 1.0 },
  "hammer_curl":           { "biceps": 1.0, "forearms": 0.5 },
  "squat":                 { "quads": 1.0, "glutes": 0.5, "spinal_erectors": 0.5 },
  "rdl":                   { "hamstrings": 1.0, "glutes": 0.5, "spinal_erectors": 0.5 },
  "leg_curl":              { "hamstrings": 1.0 },
  "leg_press":             { "quads": 1.0, "glutes": 0.5 },
  "walking_lunges":        { "quads": 1.0, "glutes": 1.0 },
  "calf_raises":           { "calves": 1.0 },
  "core":                  { "abs": 1.0 },
  "cable_fly_upper":       { "chest": 1.0 },
  "neutral_pulldown":      { "lats": 1.0, "biceps": 0.5 },
  "chest_row_upper":       { "upper_back": 1.0, "lats": 1.0, "biceps": 0.5 },
  "close_grip_bench":      { "triceps": 1.0, "chest": 0.5, "front_delt": 0.5 },
  "cable_lat_raise_upper": { "side_delt": 1.0 },
  "rear_delt_fly":         { "rear_delt": 1.0 },
  "ez_bar_curl":           { "biceps": 1.0 },
  "trap_bar_dl":           { "glutes": 1.0, "spinal_erectors": 1.0, "quads": 0.5, "hamstrings": 0.5, "traps": 0.5 },
  "dips":                  { "chest": 1.0, "triceps": 1.0, "front_delt": 0.5 },
  "cable_pull_through":    { "glutes": 1.0, "hamstrings": 0.5 },
  "seated_row":            { "upper_back": 1.0, "lats": 0.5, "biceps": 0.5 },
  "optional_arms":         { "biceps": 0.5, "triceps": 0.5, "side_delt": 0.5 },

  "m2_incline_smith":       { "chest": 1.0, "front_delt": 0.5, "triceps": 0.5 },
  "m2_landmine_press":      { "front_delt": 1.0, "chest": 0.5, "triceps": 0.5 },
  "m2_cable_fly":           { "chest": 1.0 },
  "m2_rope_pushdown_d1":    { "triceps": 1.0 },
  "m2_single_oh_ext":       { "triceps": 1.0 },
  "m2_cable_lat_raise_d1":  { "side_delt": 1.0 },
  "m2_lean_lat_raise":      { "side_delt": 1.0 },
  "m2_weighted_pullup":     { "lats": 1.0, "upper_back": 0.5, "biceps": 0.5 },
  "m2_chest_row_d2":        { "upper_back": 1.0, "lats": 1.0, "biceps": 0.5 },
  "m2_single_pulldown":     { "lats": 1.0, "biceps": 0.5 },
  "m2_rear_delt_row":       { "rear_delt": 1.0, "upper_back": 0.5 },
  "m2_face_pull":           { "rear_delt": 1.0, "upper_back": 0.5, "traps": 0.5 },
  "m2_bayesian_curl":       { "biceps": 1.0 },
  "m2_hammer_curl":         { "biceps": 1.0, "forearms": 0.5 },
  "m2_ssb_squat":           { "quads": 1.0, "glutes": 0.5, "spinal_erectors": 0.5 },
  "m2_rdl":                 { "hamstrings": 1.0, "glutes": 0.5, "spinal_erectors": 0.5 },
  "m2_leg_press":           { "quads": 1.0, "glutes": 0.5 },
  "m2_seated_leg_curl":     { "hamstrings": 1.0 },
  "m2_bss":                 { "quads": 1.0, "glutes": 1.0 },
  "m2_standing_calf":       { "calves": 1.0 },
  "m2_hanging_leg_raise":   { "abs": 1.0 },
  "m2_machine_press":       { "chest": 1.0, "front_delt": 0.5, "triceps": 0.5 },
  "m2_neutral_pulldown":    { "lats": 1.0, "biceps": 0.5 },
  "m2_chest_row_d4":        { "upper_back": 1.0, "lats": 1.0, "biceps": 0.5 },
  "m2_cg_smith":            { "triceps": 1.0, "chest": 0.5, "front_delt": 0.5 },
  "m2_cable_lat_raise_d4":  { "side_delt": 1.0 },
  "m2_rear_delt_fly":       { "rear_delt": 1.0 },
  "m2_ez_curl":             { "biceps": 1.0 },
  "m2_cable_lat_raise_d5":  { "side_delt": 1.0 },
  "m2_rear_delt_fly_d5":    { "rear_delt": 1.0 },
  "m2_cable_curl":          { "biceps": 1.0 },
  "m2_rope_pushdown_d5":    { "triceps": 1.0 },
  "m2_cable_crunch":        { "abs": 1.0 }
}
```

- [ ] **Step 4: Write `tools/volume-landmarks.json`**

Weekly hard sets per muscle. These are starting values from mainstream hypertrophy programming; Task 10 re-derives them from sourced research and updates both this file and the evidence doc together.

```json
{
  "chest":           { "mev": 8,  "mavLow": 12, "mavHigh": 20, "mrv": 22 },
  "front_delt":      { "mev": 0,  "mavLow": 6,  "mavHigh": 12, "mrv": 16 },
  "side_delt":       { "mev": 8,  "mavLow": 16, "mavHigh": 24, "mrv": 26 },
  "rear_delt":       { "mev": 6,  "mavLow": 10, "mavHigh": 18, "mrv": 24 },
  "lats":            { "mev": 10, "mavLow": 14, "mavHigh": 20, "mrv": 25 },
  "upper_back":      { "mev": 8,  "mavLow": 12, "mavHigh": 20, "mrv": 25 },
  "traps":           { "mev": 0,  "mavLow": 6,  "mavHigh": 14, "mrv": 20 },
  "biceps":          { "mev": 8,  "mavLow": 12, "mavHigh": 18, "mrv": 20 },
  "triceps":         { "mev": 6,  "mavLow": 10, "mavHigh": 16, "mrv": 18 },
  "forearms":        { "mev": 0,  "mavLow": 4,  "mavHigh": 10, "mrv": 15 },
  "quads":           { "mev": 8,  "mavLow": 12, "mavHigh": 18, "mrv": 20 },
  "hamstrings":      { "mev": 6,  "mavLow": 10, "mavHigh": 16, "mrv": 20 },
  "glutes":          { "mev": 4,  "mavLow": 8,  "mavHigh": 16, "mrv": 20 },
  "calves":          { "mev": 8,  "mavLow": 12, "mavHigh": 18, "mrv": 20 },
  "abs":             { "mev": 4,  "mavLow": 8,  "mavHigh": 16, "mrv": 20 },
  "spinal_erectors": { "mev": 0,  "mavLow": 4,  "mavHigh": 10, "mrv": 12 }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/muscle-map.test.js`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add tools/muscle-map.json tools/volume-landmarks.json tools/muscle-map.test.js
git commit -m "feat(tools): muscle map and weekly volume landmarks"
```

---

### Task 5: `analyze-history.js` — export loading and per-exercise metrics

**Goal:** Normalize any export version into one shape and compute per-exercise adherence, progression, and effort statistics.

**Files:**
- Create: `tools/analyze-history.js`
- Create: `tools/fixtures/export-v3.json`
- Create: `tools/fixtures/export-v2.json`
- Create: `tools/analyze-history.test.js`

**Acceptance Criteria:**
- [ ] `normalizeExport` maps v1, v2, and v3 payloads to `{ programs: { <id>: { weeks: { <n>: { <dayId>: {...} } } } } }`
- [ ] v2 payloads are attributed to `meso1` (matching the app's own migration)
- [ ] An unrecognized payload throws a clear error
- [ ] `perExercise` reports completed, skipped, skipRate, weeksTouched, firstWeight, lastWeight, slope, effortCounts, swappedTo
- [ ] `slope` is the least-squares slope of weight over week number, `null` with fewer than 2 weighted weeks
- [ ] `findNewestExport` returns the most recently modified `*.json` in a directory, `null` if empty

**Verify:** `node --test tools/analyze-history.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the fixtures**

`tools/fixtures/export-v3.json` — three weeks of meso1 day1, with a stall, a skipped exercise, and a swap:

```json
{
  "version": 3,
  "currentProgram": 0,
  "programs": {
    "meso1": {
      "currentWeek": 3,
      "weeks": {
        "1": {
          "day1": {
            "sets": {
              "incline_db_press": [true, true, true, true],
              "machine_chest_press": [true, true, true],
              "cable_lat_raise_push": ["skipped", "skipped", "skipped"],
              "rope_pushdown": [true, true, true]
            },
            "weights": { "incline_db_press": 60, "machine_chest_press": 100, "rope_pushdown": 40 },
            "effort": { "incline_db_press": "medium", "rope_pushdown": "low" },
            "protocol": [],
            "swaps": {}
          }
        },
        "2": {
          "day1": {
            "sets": {
              "incline_db_press": [true, true, true, true],
              "machine_chest_press": [true, true, true],
              "cable_lat_raise_push": ["skipped", "skipped", "skipped"],
              "rope_pushdown": [true, true, true]
            },
            "weights": { "incline_db_press": 65, "machine_chest_press": 100, "rope_pushdown": 40 },
            "effort": { "incline_db_press": "medium", "rope_pushdown": "low" },
            "protocol": [],
            "swaps": { "machine_chest_press": "alt_pec_deck" }
          }
        },
        "3": {
          "day1": {
            "sets": {
              "incline_db_press": [true, true, true, true],
              "machine_chest_press": [true, true, true],
              "cable_lat_raise_push": ["skipped", "skipped", false],
              "rope_pushdown": [true, true, true]
            },
            "weights": { "incline_db_press": 70, "machine_chest_press": 100, "rope_pushdown": 40 },
            "effort": { "incline_db_press": "high", "rope_pushdown": "low" },
            "protocol": [],
            "swaps": { "machine_chest_press": "alt_pec_deck" }
          }
        }
      }
    }
  }
}
```

`tools/fixtures/export-v2.json`:

```json
{
  "version": 2,
  "currentWeek": 2,
  "weeks": {
    "1": {
      "day1": {
        "sets": { "incline_db_press": [true, true, true, true] },
        "weights": { "incline_db_press": 55 },
        "effort": { "incline_db_press": "medium" },
        "protocol": [],
        "swaps": {}
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

```js
// tools/analyze-history.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeExport, findNewestExport, perExercise, slopeOf,
} = require('./analyze-history');

const v3 = require('./fixtures/export-v3.json');
const v2 = require('./fixtures/export-v2.json');

test('normalizeExport handles v3', () => {
  const n = normalizeExport(v3);
  assert.deepStrictEqual(Object.keys(n.programs), ['meso1']);
  assert.deepStrictEqual(Object.keys(n.programs.meso1.weeks), ['1', '2', '3']);
});

test('normalizeExport attributes v2 to meso1', () => {
  const n = normalizeExport(v2);
  assert.deepStrictEqual(Object.keys(n.programs), ['meso1']);
  assert.ok(n.programs.meso1.weeks['1'].day1);
});

test('normalizeExport handles v1', () => {
  const n = normalizeExport({ currentWeek: 1, state: { day1: { sets: {}, weights: {} } } });
  assert.ok(n.programs.meso1.weeks['1'].day1);
});

test('normalizeExport rejects garbage', () => {
  assert.throws(() => normalizeExport({ hello: 'world' }), /unrecognized export/i);
});

test('slopeOf computes least-squares slope', () => {
  assert.strictEqual(slopeOf([[1, 60], [2, 65], [3, 70]]), 5);
  assert.strictEqual(slopeOf([[1, 100], [2, 100], [3, 100]]), 0);
  assert.strictEqual(slopeOf([[1, 60]]), null);
});

test('perExercise reports adherence, progression, effort and swaps', () => {
  const stats = perExercise(normalizeExport(v3));

  const press = stats['meso1']['incline_db_press'];
  assert.strictEqual(press.completed, 12);
  assert.strictEqual(press.skipped, 0);
  assert.strictEqual(press.weeksTouched, 3);
  assert.strictEqual(press.firstWeight, 60);
  assert.strictEqual(press.lastWeight, 70);
  assert.strictEqual(press.slope, 5);
  assert.deepStrictEqual(press.effortCounts, { low: 0, medium: 2, high: 1 });

  const raise = stats['meso1']['cable_lat_raise_push'];
  assert.strictEqual(raise.completed, 0);
  assert.strictEqual(raise.skipped, 8);
  assert.ok(Math.abs(raise.skipRate - 8 / 9) < 1e-9);

  const machine = stats['meso1']['machine_chest_press'];
  assert.strictEqual(machine.slope, 0);
  assert.deepStrictEqual(machine.swappedTo, { alt_pec_deck: 2 });
});

test('findNewestExport picks the newest json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gains-'));
  assert.strictEqual(findNewestExport(dir), null);
  fs.writeFileSync(path.join(dir, 'old.json'), '{}');
  fs.writeFileSync(path.join(dir, 'new.json'), '{}');
  fs.utimesSync(path.join(dir, 'old.json'), new Date(1000), new Date(1000));
  assert.strictEqual(path.basename(findNewestExport(dir)), 'new.json');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tools/analyze-history.test.js`
Expected: FAIL with `Cannot find module './analyze-history'`

- [ ] **Step 4: Write the implementation**

```js
// tools/analyze-history.js
'use strict';
const fs = require('fs');
const path = require('path');

const EFFORT_LEVELS = ['low', 'medium', 'high'];

/** Newest *.json in dir by mtime, or null. */
function findNewestExport(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return null; }
  const files = entries
    .filter(f => f.toLowerCase().endsWith('.json'))
    .map(f => path.join(dir, f))
    .map(p => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].p : null;
}

/**
 * Collapse export versions 1, 2 and 3 into one shape.
 * v1/v2 predate multi-program support; the app's own migration attributes them
 * to meso1, so we do the same.
 */
function normalizeExport(raw) {
  if (raw && raw.version === 3 && raw.programs) {
    const programs = {};
    for (const [id, data] of Object.entries(raw.programs)) {
      programs[id] = { weeks: data.weeks || {}, currentWeek: data.currentWeek || 1 };
    }
    return { programs };
  }
  if (raw && raw.version === 2 && raw.weeks) {
    return { programs: { meso1: { weeks: raw.weeks, currentWeek: raw.currentWeek || 1 } } };
  }
  if (raw && raw.state && raw.currentWeek) {
    return {
      programs: {
        meso1: { weeks: { [String(raw.currentWeek)]: raw.state }, currentWeek: raw.currentWeek },
      },
    };
  }
  throw new Error('unrecognized export format — expected version 1, 2 or 3');
}

/** Least-squares slope of y over x; null with fewer than two points. */
function slopeOf(points) {
  if (!points || points.length < 2) return null;
  const n = points.length;
  const sx = points.reduce((a, p) => a + p[0], 0);
  const sy = points.reduce((a, p) => a + p[1], 0);
  const sxy = points.reduce((a, p) => a + p[0] * p[1], 0);
  const sxx = points.reduce((a, p) => a + p[0] * p[0], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

function emptyStat() {
  return {
    completed: 0, skipped: 0, slots: 0, skipRate: 0,
    weeksTouched: 0, weeks: [],
    firstWeight: null, lastWeight: null, slope: null, weightPoints: [],
    effortCounts: { low: 0, medium: 0, high: 0 },
    swappedTo: {},
  };
}

/**
 * Per-program, per-exercise statistics keyed by the ORIGINAL exercise id
 * (swaps are recorded on the original, so this keeps one row per plan slot).
 * @returns {Record<string, Record<string, ReturnType<typeof emptyStat>>>}
 */
function perExercise(normalized) {
  const out = {};
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const byEx = (out[progId] = {});
    const weekNums = Object.keys(prog.weeks).map(Number).sort((a, b) => a - b);

    for (const w of weekNums) {
      const weekData = prog.weeks[String(w)] || {};
      for (const dayData of Object.values(weekData)) {
        const sets = dayData.sets || {};
        const weights = dayData.weights || {};
        const effort = dayData.effort || {};
        const swaps = dayData.swaps || {};

        for (const [exId, arr] of Object.entries(sets)) {
          if (!Array.isArray(arr)) continue;
          const s = (byEx[exId] = byEx[exId] || emptyStat());
          s.slots += arr.length;
          for (const v of arr) {
            if (v === true) s.completed++;
            else if (v === 'skipped') s.skipped++;
          }
          if (!s.weeks.includes(w)) s.weeks.push(w);

          const weight = weights[exId];
          if (typeof weight === 'number' && !Number.isNaN(weight)) {
            s.weightPoints.push([w, weight]);
          }
          const eff = effort[exId];
          if (EFFORT_LEVELS.includes(eff)) s.effortCounts[eff]++;
          if (swaps[exId]) s.swappedTo[swaps[exId]] = (s.swappedTo[swaps[exId]] || 0) + 1;
        }
      }
    }

    for (const s of Object.values(byEx)) {
      s.weeksTouched = s.weeks.length;
      s.skipRate = s.slots ? s.skipped / s.slots : 0;
      s.weightPoints.sort((a, b) => a[0] - b[0]);
      if (s.weightPoints.length) {
        s.firstWeight = s.weightPoints[0][1];
        s.lastWeight = s.weightPoints[s.weightPoints.length - 1][1];
      }
      s.slope = slopeOf(s.weightPoints);
    }
  }
  return out;
}

module.exports = {
  findNewestExport, normalizeExport, slopeOf, perExercise, EFFORT_LEVELS,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/analyze-history.test.js`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add tools/analyze-history.js tools/analyze-history.test.js tools/fixtures/
git commit -m "feat(tools): export normalization and per-exercise training metrics"
```

---

### Task 6: `analyze-history.js` — muscle volume, flags, and the report

**Goal:** Turn the per-exercise statistics into weekly per-muscle volume, actionable flags, and a markdown report the command can read.

**Files:**
- Modify: `tools/analyze-history.js` (append functions and a CLI entry point)
- Modify: `tools/analyze-history.test.js` (append tests)

**Acceptance Criteria:**
- [ ] `resolveMuscles` uses a swap target's own entry when present, else falls back to the original exercise's profile
- [ ] `weeklyVolume` credits completed sets only (never skipped), weighted by muscle credit, averaged over weeks with data
- [ ] `flagExercises` marks `rejected` at skipRate > 0.40 **or** a swap recorded in a majority of trained weeks
- [ ] `flagExercises` marks `stalled` when slope <= 0 across 4+ weighted weeks with any `high` effort
- [ ] `flagExercises` marks `underStimulating` when effort is majority `low` and slope <= 0
- [ ] `flagVolume` reports muscles below `mev` and above `mrv`
- [ ] `renderReport` emits markdown with an `## Adherence`, `## Per exercise`, `## Weekly volume by muscle`, and `## Flags` section
- [ ] Running the CLI on the fixture prints a report and exits 0

**Verify:** `node --test tools/analyze-history.test.js && node tools/analyze-history.js tools/fixtures/export-v3.json | head -40`

**Steps:**

- [ ] **Step 1: Write the failing test (append to `tools/analyze-history.test.js`)**

```js
const {
  resolveMuscles, weeklyVolume, flagExercises, flagVolume, renderReport, analyze,
} = require('./analyze-history');
const muscleMap = require('./muscle-map.json');
const landmarks = require('./volume-landmarks.json');

test('resolveMuscles falls back to the original exercise', () => {
  // alt_pec_deck has no entry of its own; it stands in for machine_chest_press.
  assert.deepStrictEqual(
    resolveMuscles('alt_pec_deck', 'machine_chest_press', muscleMap),
    muscleMap['machine_chest_press']
  );
  assert.deepStrictEqual(
    resolveMuscles('incline_db_press', 'incline_db_press', muscleMap),
    muscleMap['incline_db_press']
  );
  assert.deepStrictEqual(resolveMuscles('nope', 'also_nope', muscleMap), {});
});

test('weeklyVolume credits completed sets only', () => {
  const vol = weeklyVolume(normalizeExport(v3), muscleMap).meso1;
  // incline_db_press: 4 sets x 3 weeks, chest credit 1.0 -> 4 sets/week
  // machine_chest_press (and its pec deck swap): 3 sets x 3 weeks -> 3 sets/week
  assert.ok(Math.abs(vol.chest - 7) < 1e-9);
  // cable_lat_raise_push was skipped every week, so side delts get nothing.
  assert.strictEqual(vol.side_delt || 0, 0);
});

test('flagExercises identifies rejected, stalled and under-stimulating work', () => {
  const stats = perExercise(normalizeExport(v3)).meso1;
  const flags = flagExercises(stats);
  assert.ok(flags.rejected.some(f => f.exId === 'cable_lat_raise_push'));
  assert.ok(flags.rejected.some(f => f.exId === 'machine_chest_press'));
  assert.ok(flags.underStimulating.some(f => f.exId === 'rope_pushdown'));
  assert.ok(!flags.rejected.some(f => f.exId === 'incline_db_press'));
});

test('flagVolume compares against landmarks', () => {
  const flags = flagVolume({ chest: 7, side_delt: 0, biceps: 40 }, landmarks);
  assert.ok(flags.below.some(f => f.muscle === 'side_delt'));
  assert.ok(flags.below.some(f => f.muscle === 'chest'));
  assert.ok(flags.above.some(f => f.muscle === 'biceps'));
});

test('renderReport emits the expected sections', () => {
  const md = renderReport(analyze(v3, muscleMap, landmarks));
  for (const heading of ['## Adherence', '## Per exercise', '## Weekly volume by muscle', '## Flags']) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/analyze-history.test.js`
Expected: FAIL — `resolveMuscles is not a function`

- [ ] **Step 3: Append the implementation to `tools/analyze-history.js`**

Insert before `module.exports`:

```js
// ── Flag thresholds ───────────────────────────────────────────────
// Judgment calls, not research-derived. They decide what gets dropped from the
// next block, so they are named and centralized for easy tuning.
const REJECT_SKIP_RATE = 0.40;   // skipped more than 40% of prescribed sets
const STALL_MIN_WEEKS  = 4;      // weeks of logged weight needed to call a stall
const LOW_EFFORT_SHARE = 0.5;    // majority-low effort counts as under-stimulating

/** Muscle profile for a performed exercise, falling back to the slot it filled. */
function resolveMuscles(performedId, originalId, muscleMap) {
  return muscleMap[performedId] || muscleMap[originalId] || {};
}

/**
 * Average weekly sets per muscle, per program. Completed sets only — skipped
 * work is exactly the thing we do not want to count as stimulus.
 */
function weeklyVolume(normalized, muscleMap) {
  const out = {};
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const totals = {};
    const weekNums = Object.keys(prog.weeks);
    for (const w of weekNums) {
      for (const dayData of Object.values(prog.weeks[w] || {})) {
        const sets = dayData.sets || {};
        const swaps = dayData.swaps || {};
        for (const [exId, arr] of Object.entries(sets)) {
          if (!Array.isArray(arr)) continue;
          const done = arr.filter(v => v === true).length;
          if (!done) continue;
          const muscles = resolveMuscles(swaps[exId] || exId, exId, muscleMap);
          for (const [muscle, credit] of Object.entries(muscles)) {
            totals[muscle] = (totals[muscle] || 0) + done * credit;
          }
        }
      }
    }
    const weeksWithData = weekNums.length || 1;
    const avg = {};
    for (const [muscle, total] of Object.entries(totals)) avg[muscle] = total / weeksWithData;
    out[progId] = avg;
  }
  return out;
}

/** Classify exercises into the three actionable buckets. */
function flagExercises(statsForProgram) {
  const rejected = [], stalled = [], underStimulating = [];

  for (const [exId, s] of Object.entries(statsForProgram)) {
    const swapWeeks = Object.values(s.swappedTo).reduce((a, n) => a + n, 0);
    if (s.skipRate > REJECT_SKIP_RATE) {
      rejected.push({ exId, reason: `skipped ${Math.round(s.skipRate * 100)}% of prescribed sets` });
    } else if (s.weeksTouched && swapWeeks > s.weeksTouched / 2) {
      const target = Object.keys(s.swappedTo).join(', ');
      rejected.push({ exId, reason: `swapped away to ${target} in ${swapWeeks}/${s.weeksTouched} weeks` });
    }

    const effortTotal = s.effortCounts.low + s.effortCounts.medium + s.effortCounts.high;
    if (s.weightPoints.length >= STALL_MIN_WEEKS && s.slope !== null && s.slope <= 0 && s.effortCounts.high > 0) {
      stalled.push({ exId, reason: `no load progress across ${s.weightPoints.length} weeks at high effort` });
    }
    if (effortTotal && s.effortCounts.low / effortTotal > LOW_EFFORT_SHARE && (s.slope === null || s.slope <= 0)) {
      underStimulating.push({ exId, reason: `${s.effortCounts.low}/${effortTotal} sessions rated low effort with no load progress` });
    }
  }
  return { rejected, stalled, underStimulating };
}

/** Compare average weekly volume against the landmarks. */
function flagVolume(volumeForProgram, landmarks) {
  const below = [], above = [];
  for (const [muscle, l] of Object.entries(landmarks)) {
    const sets = volumeForProgram[muscle] || 0;
    if (l.mev > 0 && sets < l.mev) below.push({ muscle, sets, mev: l.mev });
    else if (sets > l.mrv) above.push({ muscle, sets, mrv: l.mrv });
  }
  return { below, above };
}

function num(n, digits = 1) {
  return n === null || n === undefined ? '—' : Number(n).toFixed(digits).replace(/\.0$/, '');
}

/** Full analysis object for one export. */
function analyze(raw, muscleMap, landmarks) {
  const normalized = normalizeExport(raw);
  const stats = perExercise(normalized);
  const volume = weeklyVolume(normalized, muscleMap);
  const programs = {};

  for (const progId of Object.keys(normalized.programs)) {
    const weeks = Object.keys(normalized.programs[progId].weeks).map(Number).sort((a, b) => a - b);
    const progStats = stats[progId] || {};
    let completed = 0, skipped = 0, slots = 0;
    for (const s of Object.values(progStats)) {
      completed += s.completed; skipped += s.skipped; slots += s.slots;
    }
    programs[progId] = {
      weeks,
      hasData: slots > 0,
      completed, skipped, slots,
      stats: progStats,
      volume: volume[progId] || {},
      exerciseFlags: flagExercises(progStats),
      volumeFlags: flagVolume(volume[progId] || {}, landmarks),
    };
  }
  return { programs, landmarks };
}

/** Markdown report — this is what the /newplan command actually reads. */
function renderReport(analysis) {
  const lines = ['# Training history analysis', ''];

  lines.push('## Adherence', '');
  lines.push('| Program | Weeks with data | Sets completed | Sets skipped | Completion |');
  lines.push('|---|---|---|---|---|');
  for (const [progId, p] of Object.entries(analysis.programs)) {
    const pct = p.slots ? Math.round((p.completed / p.slots) * 100) : 0;
    lines.push(`| ${progId} | ${p.weeks.join(', ') || '—'} | ${p.completed} | ${p.skipped} | ${pct}% |`);
  }
  lines.push('');
  const empty = Object.entries(analysis.programs).filter(([, p]) => !p.hasData).map(([id]) => id);
  if (empty.length) {
    lines.push(`> No logged data for: ${empty.join(', ')}. Excluded from inference.`, '');
  }

  for (const [progId, p] of Object.entries(analysis.programs)) {
    if (!p.hasData) continue;

    lines.push(`## Per exercise — ${progId}`, '');
    lines.push('| Exercise | Done | Skipped | Skip % | Weeks | Weight | Slope/wk | Effort L/M/H | Swapped to |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const [exId, s] of Object.entries(p.stats)) {
      const weight = s.firstWeight === null ? '—' : `${num(s.firstWeight)} → ${num(s.lastWeight)}`;
      const swaps = Object.keys(s.swappedTo).join(', ') || '—';
      const e = s.effortCounts;
      lines.push(
        `| ${exId} | ${s.completed} | ${s.skipped} | ${Math.round(s.skipRate * 100)}% | ` +
        `${s.weeksTouched} | ${weight} | ${num(s.slope)} | ${e.low}/${e.medium}/${e.high} | ${swaps} |`
      );
    }
    lines.push('');

    lines.push(`## Weekly volume by muscle — ${progId}`, '');
    lines.push('| Muscle | Avg sets/week | MEV | MAV | MRV | Status |');
    lines.push('|---|---|---|---|---|---|');
    for (const [muscle, l] of Object.entries(analysis.landmarks)) {
      const sets = p.volume[muscle] || 0;
      let status = 'in range';
      if (l.mev > 0 && sets < l.mev) status = 'BELOW MEV';
      else if (sets > l.mrv) status = 'ABOVE MRV';
      else if (sets < l.mavLow) status = 'below MAV';
      lines.push(`| ${muscle} | ${num(sets)} | ${l.mev} | ${l.mavLow}–${l.mavHigh} | ${l.mrv} | ${status} |`);
    }
    lines.push('');

    lines.push(`## Flags — ${progId}`, '');
    const buckets = [
      ['Rejected (drop from next block)', p.exerciseFlags.rejected],
      ['Stalled (change the stimulus)', p.exerciseFlags.stalled],
      ['Under-stimulating (too light)', p.exerciseFlags.underStimulating],
    ];
    for (const [title, items] of buckets) {
      lines.push(`### ${title}`, '');
      if (!items.length) lines.push('_none_', '');
      else {
        for (const f of items) lines.push(`- \`${f.exId}\` — ${f.reason}`);
        lines.push('');
      }
    }
    lines.push('### Volume gaps', '');
    if (!p.volumeFlags.below.length && !p.volumeFlags.above.length) lines.push('_none_', '');
    else {
      for (const f of p.volumeFlags.below) lines.push(`- **${f.muscle}** under-trained: ${num(f.sets)} sets/week vs MEV ${f.mev}`);
      for (const f of p.volumeFlags.above) lines.push(`- **${f.muscle}** over-trained: ${num(f.sets)} sets/week vs MRV ${f.mrv}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const explicit = argv[2];
  const file = explicit || findNewestExport(path.join(__dirname, '..', 'data'));
  if (!file) {
    console.error(
      'No export found.\n' +
      'In the app: Settings → Export, then move the downloaded gains-backup-*.json into ./data/'
    );
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const muscleMap = require('./muscle-map.json');
  const landmarks = require('./volume-landmarks.json');
  console.error(`Analyzing ${file}`);
  console.log(renderReport(analyze(raw, muscleMap, landmarks)));
}

if (require.main === module) main(process.argv);
```

Extend `module.exports` to:

```js
module.exports = {
  findNewestExport, normalizeExport, slopeOf, perExercise, EFFORT_LEVELS,
  resolveMuscles, weeklyVolume, flagExercises, flagVolume, analyze, renderReport,
  REJECT_SKIP_RATE, STALL_MIN_WEEKS, LOW_EFFORT_SHARE,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tools/analyze-history.test.js
node tools/analyze-history.js tools/fixtures/export-v3.json | head -40
```

Expected: 12 tests pass; the CLI prints a report starting with `# Training history analysis`

- [ ] **Step 5: Commit**

```bash
git add tools/analyze-history.js tools/analyze-history.test.js
git commit -m "feat(tools): per-muscle volume, training flags and analysis report"
```

---

### Task 7: `tools/smoke-render.js`

**Goal:** A headless check that a given program renders every view without throwing — the gate that catches runtime errors `node --check` cannot.

**Files:**
- Create: `tools/smoke-render.js`
- Create: `tools/smoke-render.test.js`

**Acceptance Criteria:**
- [ ] `smokeRender(htmlPath, programIdx)` renders every day plus the plan, progress, and settings views
- [ ] Returns `{ ok: true, rendered: [...] }` when all views produce non-empty `#scroll` markup
- [ ] Returns `{ ok: false, error }` instead of throwing when a view fails
- [ ] CLI exits 0 on success, 1 on failure, and prints which view failed
- [ ] Passes against the current `index.html` for both existing programs

**Verify:** `node --test tools/smoke-render.test.js && node tools/smoke-render.js index.html 1`

**Steps:**

- [ ] **Step 1: Write the failing test**

```js
// tools/smoke-render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { smokeRender } = require('./smoke-render');

test('every program renders every view', () => {
  for (const idx of [0, 1]) {
    const result = smokeRender(undefined, idx);
    assert.strictEqual(result.ok, true, `program ${idx}: ${result.error}`);
    assert.ok(result.rendered.includes('plan'));
    assert.ok(result.rendered.includes('progress'));
    assert.ok(result.rendered.length > 4);
  }
});

test('a bad program index is reported, not thrown', () => {
  const result = smokeRender(undefined, 99);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /program index/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/smoke-render.test.js`
Expected: FAIL with `Cannot find module './smoke-render'`

- [ ] **Step 3: Write the implementation**

```js
// tools/smoke-render.js
'use strict';
const { loadApp } = require('./app-shim');

/**
 * Render every view of one program under the DOM shim.
 * @param {string|undefined} htmlPath  defaults to ../index.html
 * @param {number} programIdx
 * @returns {{ok: boolean, rendered: string[], error?: string}}
 */
function smokeRender(htmlPath, programIdx = 0) {
  const rendered = [];
  let app;
  try {
    app = loadApp({ htmlPath, storage: { hypertrophy_program: String(programIdx) } });
  } catch (e) {
    return { ok: false, rendered, error: `boot failed: ${e.message}` };
  }

  if (programIdx < 0 || programIdx >= app.PROGRAMS.length) {
    return { ok: false, rendered, error: `program index ${programIdx} out of range (0..${app.PROGRAMS.length - 1})` };
  }
  if (app.currentProgramIdx !== programIdx) {
    return { ok: false, rendered, error: `boot selected program ${app.currentProgramIdx}, expected ${programIdx}` };
  }

  const scroll = app.elements.get('scroll');
  const views = [
    ...app.DAYS.map(d => ({ name: 'day', dayId: d.id, label: `day:${d.id}` })),
    { name: 'plan', label: 'plan' },
    { name: 'progress', label: 'progress' },
    { name: 'settings', label: 'settings' },
  ];

  for (const v of views) {
    try {
      app.view.name = v.name;
      if (v.dayId) app.view.dayId = v.dayId;
      scroll.innerHTML = '';
      app.render();
      if (!scroll.innerHTML || scroll.innerHTML.length < 20) {
        return { ok: false, rendered, error: `view "${v.label}" produced empty markup` };
      }
      rendered.push(v.label);
    } catch (e) {
      return { ok: false, rendered, error: `view "${v.label}" threw: ${e.message}` };
    }
  }
  return { ok: true, rendered };
}

function main(argv) {
  const htmlPath = argv[2] || undefined;
  const idx = argv[3] === undefined ? 0 : Number(argv[3]);
  const result = smokeRender(htmlPath, idx);
  if (result.ok) {
    console.log(`smoke ok — program ${idx}, ${result.rendered.length} views: ${result.rendered.join(', ')}`);
    process.exit(0);
  }
  console.error(`smoke FAILED — program ${idx}: ${result.error}`);
  process.exit(1);
}

if (require.main === module) main(process.argv);

module.exports = { smokeRender };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tools/smoke-render.test.js
node tools/smoke-render.js index.html 1
```

Expected: 2 tests pass; CLI prints `smoke ok — program 1, 8 views: …` and exits 0

- [ ] **Step 5: Commit**

```bash
git add tools/smoke-render.js tools/smoke-render.test.js
git commit -m "feat(tools): headless smoke render for all program views"
```

---

### Task 8: `insert-program.js` — validation gates

**Goal:** Reject a malformed or colliding program before any file is touched.

**Files:**
- Create: `tools/insert-program.js` (validation half only)
- Create: `tools/fixtures/program-valid.json`
- Create: `tools/insert-program.test.js`

**Acceptance Criteria:**
- [ ] `validateProgram` requires `name`, `subtitle`, `totalWeeks`, `days`, `protocolItems`, `mesocycle`, `weekPhases`
- [ ] Rejects `weekPhases.length !== totalWeeks`
- [ ] Rejects a day with no exercises
- [ ] Rejects an exercise missing any of `id, name, sets, reps, rpe, note, llp, compound, rest, restLabel, muscles`
- [ ] Rejects non-numeric `rest` and empty `muscles`
- [ ] Rejects duplicate ids within the new program and collisions with ids already in `index.html` (program exercises **and** `EXERCISE_ALTERNATIVES` targets)
- [ ] Returns every error found, not just the first

**Verify:** `node --test tools/insert-program.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the fixture `tools/fixtures/program-valid.json`**

A minimal but complete two-day, two-week program:

```json
{
  "name": "Mesocycle 3",
  "subtitle": "Test Fixture",
  "totalWeeks": 2,
  "days": [
    {
      "id": "day1",
      "label": "Day 1",
      "title": "PUSH",
      "subtitle": "Chest · Triceps",
      "note": "Fixture day.",
      "protocol": true,
      "exercises": [
        {
          "id": "m3_incline_db_press", "name": "Incline DB Press", "sets": 4, "reps": "6–10",
          "rpe": "7–9", "note": "Neutral grip.", "llp": false, "compound": true,
          "rest": 150, "restLabel": "2–3 min",
          "muscles": { "chest": 1.0, "front_delt": 0.5, "triceps": 0.5 }
        },
        {
          "id": "m3_rope_pushdown", "name": "Rope Pushdown", "sets": 3, "reps": "12–15",
          "rpe": "8", "note": "Full extension.", "llp": false, "compound": false,
          "rest": 75, "restLabel": "1–1.5 min",
          "muscles": { "triceps": 1.0 }
        }
      ]
    },
    {
      "id": "day2",
      "label": "Day 2",
      "title": "PULL",
      "subtitle": "Lats · Biceps",
      "note": "Fixture day.",
      "protocol": true,
      "exercises": [
        {
          "id": "m3_neutral_pulldown", "name": "Neutral Pulldown", "sets": 4, "reps": "8–12",
          "rpe": "7–9", "note": "Neutral grip.", "llp": false, "compound": true,
          "rest": 135, "restLabel": "2–2.5 min",
          "muscles": { "lats": 1.0, "biceps": 0.5 }
        }
      ]
    }
  ],
  "protocolItems": [
    "Band Pull-Aparts — 2×20 before any pressing",
    "External Rotation (band/cable) — 2×15 per arm"
  ],
  "mesocycle": [
    {
      "weeks": "Week 1", "label": "Foundation", "rpe": "6.5–7.5",
      "rir": "2–3 reps in reserve", "color": "#4eff91",
      "points": ["Technique focus", "Baseline volume"]
    },
    {
      "weeks": "Week 2", "label": "Deload", "rpe": "6–7",
      "rir": "Feel fresh", "color": "#8b8bff",
      "points": ["Volume down 50%"]
    }
  ],
  "weekPhases": [
    { "label": "Foundation", "rpe": "RPE 6.5–7.5", "llp": false, "color": "#4eff91" },
    { "label": "Deload", "rpe": "RPE 6–7", "llp": false, "color": "#8b8bff" }
  ],
  "alternatives": {
    "m3_rope_pushdown": [
      { "id": "m3_alt_vbar_pushdown", "name": "V-Bar Pushdown", "note": "Straighter wrist path" },
      { "id": "m3_alt_skulls", "name": "Skull Crushers (EZ Bar)", "note": "More long-head stretch" }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

```js
// tools/insert-program.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateProgram, collectExistingIds } = require('./insert-program');
const valid = require('./fixtures/program-valid.json');

const clone = o => JSON.parse(JSON.stringify(o));

test('the fixture validates cleanly', () => {
  const errors = validateProgram(valid, collectExistingIds());
  assert.deepStrictEqual(errors, []);
});

test('missing top-level fields are reported', () => {
  const bad = clone(valid);
  delete bad.mesocycle;
  delete bad.protocolItems;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /mesocycle/.test(e)));
  assert.ok(errors.some(e => /protocolItems/.test(e)));
});

test('weekPhases length must equal totalWeeks', () => {
  const bad = clone(valid);
  bad.totalWeeks = 8;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases has 2 entries but totalWeeks is 8/.test(e)));
});

test('a day with no exercises is rejected', () => {
  const bad = clone(valid);
  bad.days[1].exercises = [];
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /day2.*no exercises/.test(e)));
});

test('incomplete exercises are rejected', () => {
  const bad = clone(valid);
  delete bad.days[0].exercises[0].restLabel;
  bad.days[0].exercises[1].rest = '75';
  bad.days[1].exercises[0].muscles = {};
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /restLabel/.test(e)));
  assert.ok(errors.some(e => /rest must be a number/.test(e)));
  assert.ok(errors.some(e => /muscles/.test(e)));
});

test('duplicate ids inside the program are rejected', () => {
  const bad = clone(valid);
  bad.days[1].exercises[0].id = 'm3_rope_pushdown';
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /duplicate id 'm3_rope_pushdown'/.test(e)));
});

test('collisions with existing app ids are rejected', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].id = 'incline_db_press';
  bad.alternatives = { 'm3_rope_pushdown': [{ id: 'alt_pec_deck', name: 'Pec Deck', note: 'x' }] };
  const errors = validateProgram(bad, collectExistingIds());
  assert.ok(errors.some(e => /'incline_db_press' already exists/.test(e)));
  assert.ok(errors.some(e => /'alt_pec_deck' already exists/.test(e)));
});

test('collectExistingIds covers program and alternative ids', () => {
  const ids = collectExistingIds();
  assert.ok(ids.has('incline_db_press'));
  assert.ok(ids.has('m2_cable_crunch'));
  assert.ok(ids.has('alt_pec_deck'));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tools/insert-program.test.js`
Expected: FAIL with `Cannot find module './insert-program'`

- [ ] **Step 4: Write the validation half of `tools/insert-program.js`**

```js
// tools/insert-program.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadApp, extractScript, APP_HTML } = require('./app-shim');
const { smokeRender } = require('./smoke-render');

const REQUIRED_TOP = ['name', 'subtitle', 'totalWeeks', 'days', 'protocolItems', 'mesocycle', 'weekPhases'];
const REQUIRED_EX = ['id', 'name', 'sets', 'reps', 'rpe', 'note', 'llp', 'compound', 'rest', 'restLabel', 'muscles'];
const REQUIRED_DAY = ['id', 'label', 'title', 'subtitle', 'exercises'];

/** Every exercise id already live in the app — programs and swap targets alike. */
function collectExistingIds(htmlPath = APP_HTML) {
  const { PROGRAMS, EXERCISE_ALTERNATIVES } = loadApp({ htmlPath });
  const ids = new Set();
  for (const prog of PROGRAMS) {
    for (const day of prog.days) for (const ex of day.exercises) ids.add(ex.id);
  }
  for (const alts of Object.values(EXERCISE_ALTERNATIVES)) {
    for (const alt of alts) ids.add(alt.id);
  }
  return ids;
}

/**
 * Validate a generated program. Returns ALL errors so one run surfaces every
 * problem rather than making the caller play whack-a-mole.
 * @returns {string[]}
 */
function validateProgram(prog, existingIds = new Set()) {
  const errors = [];
  if (!prog || typeof prog !== 'object') return ['program must be an object'];

  for (const key of REQUIRED_TOP) {
    if (prog[key] === undefined || prog[key] === null) errors.push(`missing required field: ${key}`);
  }
  if (typeof prog.totalWeeks === 'number' && Array.isArray(prog.weekPhases) &&
      prog.weekPhases.length !== prog.totalWeeks) {
    errors.push(`weekPhases has ${prog.weekPhases.length} entries but totalWeeks is ${prog.totalWeeks}`);
  }
  if (Array.isArray(prog.weekPhases)) {
    prog.weekPhases.forEach((ph, i) => {
      for (const key of ['label', 'rpe', 'llp', 'color']) {
        if (ph[key] === undefined) errors.push(`weekPhases[${i}] missing ${key}`);
      }
    });
  }
  if (Array.isArray(prog.mesocycle)) {
    prog.mesocycle.forEach((ph, i) => {
      for (const key of ['weeks', 'label', 'rpe', 'rir', 'color', 'points']) {
        if (ph[key] === undefined) errors.push(`mesocycle[${i}] missing ${key}`);
      }
    });
  }
  if (Array.isArray(prog.protocolItems) && prog.protocolItems.length === 0) {
    errors.push('protocolItems is empty');
  }

  const seen = new Set();
  const noteId = (id, where) => {
    if (!id) return;
    if (seen.has(id)) errors.push(`${where}: duplicate id '${id}' within the new program`);
    else if (existingIds.has(id)) errors.push(`${where}: id '${id}' already exists in index.html`);
    seen.add(id);
  };

  if (!Array.isArray(prog.days) || prog.days.length === 0) {
    errors.push('days must be a non-empty array');
  } else {
    prog.days.forEach((day, di) => {
      for (const key of REQUIRED_DAY) {
        if (day[key] === undefined) errors.push(`days[${di}] missing ${key}`);
      }
      if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
        errors.push(`day ${day.id || di} has no exercises`);
        return;
      }
      day.exercises.forEach((ex, ei) => {
        const where = `${day.id || di}/exercises[${ei}]`;
        for (const key of REQUIRED_EX) {
          if (ex[key] === undefined) errors.push(`${where} missing ${key}`);
        }
        if (ex.rest !== undefined && typeof ex.rest !== 'number') {
          errors.push(`${where}: rest must be a number (got ${typeof ex.rest})`);
        }
        if (ex.muscles !== undefined &&
            (typeof ex.muscles !== 'object' || Object.keys(ex.muscles).length === 0)) {
          errors.push(`${where}: muscles must be a non-empty object`);
        }
        noteId(ex.id, where);
      });
    });
  }

  if (prog.alternatives !== undefined) {
    if (typeof prog.alternatives !== 'object') errors.push('alternatives must be an object');
    else {
      for (const [origId, alts] of Object.entries(prog.alternatives)) {
        if (!Array.isArray(alts)) { errors.push(`alternatives['${origId}'] must be an array`); continue; }
        alts.forEach((alt, ai) => {
          const where = `alternatives['${origId}'][${ai}]`;
          for (const key of ['id', 'name', 'note']) {
            if (alt[key] === undefined) errors.push(`${where} missing ${key}`);
          }
          noteId(alt.id, where);
        });
      }
    }
  }
  return errors;
}

module.exports = { validateProgram, collectExistingIds, REQUIRED_TOP, REQUIRED_EX };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/insert-program.test.js`
Expected: PASS, 8 tests

- [ ] **Step 6: Commit**

```bash
git add tools/insert-program.js tools/insert-program.test.js tools/fixtures/program-valid.json
git commit -m "feat(tools): program schema and id-collision validation"
```

---

### Task 9: `insert-program.js` — splice, gate, and write

**Goal:** Insert a validated program into `index.html`, but only after `node --check` and a smoke render pass against the candidate file.

**Files:**
- Modify: `tools/insert-program.js` (append serialization, splice, gates, CLI)
- Modify: `tools/insert-program.test.js` (append tests)

**Acceptance Criteria:**
- [ ] `nextProgramId` returns `meso3` for the current file, `meso4` after one insert
- [ ] `toJsLiteral` emits unquoted identifier keys and preserves em-dashes and en-dashes
- [ ] `spliceProgram` inserts before the `PROGRAMS` terminator and merges `alternatives` into `EXERCISE_ALTERNATIVES`
- [ ] Splice anchors are asserted unique; a missing or duplicated anchor is a hard error
- [ ] `insertProgram` writes nothing when validation, `node --check`, or the smoke render fails
- [ ] On success the original file is replaced atomically and the new program renders
- [ ] CLI exits 0 on success, 1 on any gate failure, printing which gate failed

**Verify:** `node --test tools/insert-program.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the failing test (append to `tools/insert-program.test.js`)**

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nextProgramId, toJsLiteral, spliceProgram, insertProgram } = require('./insert-program');
const { loadApp } = require('./app-shim');
const { smokeRender } = require('./smoke-render');

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gains-insert-'));
  const dest = path.join(dir, 'index.html');
  fs.copyFileSync(path.join(__dirname, '..', 'index.html'), dest);
  return dest;
}

test('nextProgramId follows the mesoN sequence', () => {
  assert.strictEqual(nextProgramId(['meso1', 'meso2']), 'meso3');
  assert.strictEqual(nextProgramId(['meso1', 'meso2', 'meso3']), 'meso4');
  assert.strictEqual(nextProgramId([]), 'meso1');
});

test('toJsLiteral unquotes identifier keys and keeps unicode', () => {
  const js = toJsLiteral({ id: 'x', reps: '6–10', note: 'elbows ~60°' });
  assert.match(js, /^\s*\{/);
  assert.match(js, /\bid: 'x'/);
  assert.match(js, /reps: '6–10'/);
  assert.match(js, /note: 'elbows ~60°'/);
  assert.ok(!js.includes('"id"'));
});

test('toJsLiteral escapes embedded quotes', () => {
  const js = toJsLiteral({ note: "don't flare" });
  assert.match(js, /note: 'don\\'t flare'/);
});

test('insertProgram appends a renderable program', () => {
  const file = tempCopy();
  const result = insertProgram(valid, { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.programId, 'meso3');

  const app = loadApp({ htmlPath: file });
  assert.strictEqual(app.PROGRAMS.length, 3);
  assert.strictEqual(app.PROGRAMS[2].id, 'meso3');
  assert.strictEqual(app.PROGRAMS[2].days.length, 2);
  assert.ok(app.EXERCISE_ALTERNATIVES['m3_rope_pushdown']);
  assert.strictEqual(smokeRender(file, 2).ok, true);
});

test('a second insert becomes meso4', () => {
  const file = tempCopy();
  assert.strictEqual(insertProgram(valid, { htmlPath: file }).ok, true);
  const second = JSON.parse(JSON.stringify(valid));
  for (const day of second.days) for (const ex of day.exercises) ex.id = ex.id.replace('m3_', 'm4_');
  second.alternatives = {
    'm4_rope_pushdown': [{ id: 'm4_alt_vbar', name: 'V-Bar Pushdown', note: 'Straighter wrists' }],
  };
  const result = insertProgram(second, { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.programId, 'meso4');
  assert.strictEqual(loadApp({ htmlPath: file }).PROGRAMS.length, 4);
});

test('an invalid program leaves the file untouched', () => {
  const file = tempCopy();
  const before = fs.readFileSync(file, 'utf8');
  const bad = clone(valid);
  delete bad.mesocycle;
  const result = insertProgram(bad, { htmlPath: file });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /mesocycle/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('a missing splice anchor is a hard error', () => {
  const file = tempCopy();
  fs.writeFileSync(file, '<script>const PROGRAMS = [];</script>');
  const result = insertProgram(valid, { htmlPath: file });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /anchor/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/insert-program.test.js`
Expected: FAIL — `nextProgramId is not a function`

- [ ] **Step 3: Append the implementation to `tools/insert-program.js`**

Insert before `module.exports`:

```js
// Splice anchors. Both were verified unique in index.html; uniqueness is
// re-asserted at run time so a future edit cannot silently corrupt the file.
const PROGRAMS_ANCHOR = '\n];\n\nconst EXERCISE_ALTERNATIVES = {';
const ALTS_ANCHOR = '\n};\n\nlet DAYS = PROGRAMS[0].days;';

function countOccurrences(haystack, needle) {
  let count = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { count++; i++; }
  return count;
}

/** Next free mesoN id given the ids already present. */
function nextProgramId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const m = /^meso(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `meso${max + 1}`;
}

function quote(str) {
  return `'${String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/**
 * Serialize to a JS object literal in the file's hand-authored style:
 * unquoted identifier keys, single-quoted strings, unicode left intact.
 */
function toJsLiteral(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);

  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return quote(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => padIn + toJsLiteral(v, indent + 1));
    return `[\n${items.join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const body = entries.map(([k, v]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k);
    return `${padIn}${key}: ${toJsLiteral(v, indent + 1)}`;
  });
  return `{\n${body.join(',\n')},\n${pad}}`;
}

/**
 * Return the new file contents with the program spliced in.
 * @throws when an anchor is missing or ambiguous
 */
function spliceProgram(html, programWithId, alternatives) {
  for (const [name, anchor] of [['PROGRAMS', PROGRAMS_ANCHOR], ['EXERCISE_ALTERNATIVES', ALTS_ANCHOR]]) {
    const n = countOccurrences(html, anchor);
    if (n !== 1) {
      throw new Error(`${name} splice anchor found ${n} times (expected exactly 1) — index.html structure changed`);
    }
  }

  const literal = toJsLiteral(programWithId, 1);
  let out = html.replace(PROGRAMS_ANCHOR, `\n  ${literal},${PROGRAMS_ANCHOR}`);

  const altEntries = Object.entries(alternatives || {});
  if (altEntries.length) {
    const block = altEntries
      .map(([origId, alts]) => `  ${/^[A-Za-z_$][\w$]*$/.test(origId) ? origId : quote(origId)}: ${toJsLiteral(alts, 1)},`)
      .join('\n');
    out = out.replace(ALTS_ANCHOR, `\n\n  // ── ${programWithId.name} ──\n${block}${ALTS_ANCHOR}`);
  }
  return out;
}

/**
 * Validate, splice, and write — but only if all four gates pass.
 * @returns {{ok: boolean, programId?: string, error?: string}}
 */
function insertProgram(rawProgram, { htmlPath = APP_HTML } = {}) {
  // Gate 1 + 2: schema and id uniqueness.
  let existingIds, programs;
  try {
    const app = loadApp({ htmlPath });
    programs = app.PROGRAMS;
    existingIds = collectExistingIds(htmlPath);
  } catch (e) {
    return { ok: false, error: `could not load ${htmlPath}: ${e.message}` };
  }
  const errors = validateProgram(rawProgram, existingIds);
  if (errors.length) return { ok: false, error: `validation failed:\n  - ${errors.join('\n  - ')}` };

  const programId = nextProgramId(programs.map(p => p.id));
  const { alternatives, ...programFields } = rawProgram;
  const programWithId = { id: programId, ...programFields };

  let candidate;
  try {
    candidate = spliceProgram(fs.readFileSync(htmlPath, 'utf8'), programWithId, alternatives);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const tmp = `${htmlPath}.candidate.tmp.html`;
  try {
    fs.writeFileSync(tmp, candidate, 'utf8');

    // Gate 3: the script block must parse.
    const scriptFile = `${tmp}.js`;
    fs.writeFileSync(scriptFile, extractScript(tmp), 'utf8');
    try {
      execFileSync(process.execPath, ['--check', scriptFile], { stdio: 'pipe' });
    } catch (e) {
      return { ok: false, error: `node --check failed:\n${e.stderr ? e.stderr.toString() : e.message}` };
    } finally {
      fs.rmSync(scriptFile, { force: true });
    }

    // Gate 4: the new program must render.
    const newIdx = programs.length;
    const smoke = smokeRender(tmp, newIdx);
    if (!smoke.ok) return { ok: false, error: `smoke render failed: ${smoke.error}` };

    fs.renameSync(tmp, htmlPath);
    return { ok: true, programId, views: smoke.rendered };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error('usage: node tools/insert-program.js <program.json>');
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`could not read ${file}: ${e.message}`);
    process.exit(1);
  }
  const result = insertProgram(raw);
  if (!result.ok) {
    console.error(`insert FAILED — index.html unchanged.\n${result.error}`);
    process.exit(1);
  }
  console.log(`Inserted ${result.programId} into index.html (${result.views.length} views rendered clean).`);
  process.exit(0);
}

if (require.main === module) main(process.argv);
```

Extend `module.exports` to:

```js
module.exports = {
  validateProgram, collectExistingIds, nextProgramId, toJsLiteral,
  spliceProgram, insertProgram, REQUIRED_TOP, REQUIRED_EX,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tools/*.test.js
git status --short   # index.html must NOT appear — tests operate on temp copies
```

Expected: all tests pass across every file; `git status --short` shows no modification to `index.html`

- [ ] **Step 5: Commit**

```bash
git add tools/insert-program.js tools/insert-program.test.js
git commit -m "feat(tools): gated program insertion into index.html"
```

---

### Task 10: `docs/training-evidence.md`

**Goal:** The researched rulebook the generator reasons from, plus a landmarks file that provably matches it.

**Files:**
- Create: `docs/training-evidence.md`
- Modify: `tools/volume-landmarks.json` (revise values to match the research)
- Create: `tools/evidence-sync.test.js`

**Acceptance Criteria:**
- [ ] Covers all eight spec topics: volume landmarks, frequency, proximity to failure, lengthened-position bias, rep ranges, progression models, deload timing, exercise rotation
- [ ] Every quantitative claim carries an inline source link
- [ ] Contains a `## Volume landmarks` table with one row per muscle key in `volume-landmarks.json`
- [ ] `volume-landmarks.json` values match the table exactly
- [ ] A `## Shoulder-cautious constraints` section states which rules survive regardless of the generator's other choices
- [ ] A `## Last researched` line records the date

**Verify:** `node --test tools/evidence-sync.test.js` → all tests pass

**Steps:**

- [ ] **Step 1: Write the sync test**

```js
// tools/evidence-sync.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const landmarks = require('./volume-landmarks.json');

const DOC = path.join(__dirname, '..', 'docs', 'training-evidence.md');
const md = () => fs.readFileSync(DOC, 'utf8');

test('the evidence doc covers every required topic', () => {
  const text = md().toLowerCase();
  for (const topic of [
    'volume landmarks', 'frequency', 'proximity to failure', 'lengthened',
    'rep range', 'progression', 'deload', 'rotation',
    'shoulder-cautious constraints', 'last researched',
  ]) {
    assert.ok(text.includes(topic), `missing topic: ${topic}`);
  }
});

test('every quantitative section cites a source', () => {
  assert.ok((md().match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || []).length >= 8,
    'expected at least 8 inline source links');
});

test('the landmarks table matches volume-landmarks.json', () => {
  const rows = new Map();
  for (const line of md().split('\n')) {
    // | muscle | mev | mavLow–mavHigh | mrv | ...
    const m = /^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*[–-]\s*(\d+)\s*\|\s*(\d+)\s*\|/.exec(line);
    if (m) rows.set(m[1], { mev: +m[2], mavLow: +m[3], mavHigh: +m[4], mrv: +m[5] });
  }
  assert.deepStrictEqual([...rows.keys()].sort(), Object.keys(landmarks).sort());
  for (const [muscle, values] of rows) {
    assert.deepStrictEqual(values, landmarks[muscle], `mismatch for ${muscle}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/evidence-sync.test.js`
Expected: FAIL with `ENOENT ... docs/training-evidence.md`

- [ ] **Step 3: Research the eight topics**

Run WebSearch across these queries, then WebFetch the two or three most substantive sources per topic:

```
hypertrophy weekly set volume landmarks MEV MAV MRV per muscle
resistance training frequency per muscle per week hypertrophy meta-analysis
proximity to failure RIR hypertrophy compound vs isolation evidence
lengthened partials stretch-mediated hypertrophy research
rep range hypertrophy 5-30 reps equal gains meta-analysis
progressive overload models mesocycle set progression hypertrophy
deload frequency and structure resistance training fatigue
exercise rotation vs exercise retention hypertrophy adaptation
```

Prefer meta-analyses, systematic reviews, and primary studies over blog summaries. Where sources disagree, record the range and note the disagreement — the generator should see the uncertainty rather than a false consensus.

- [ ] **Step 4: Write `docs/training-evidence.md`**

Required structure (fill each section from the research; every number gets a link):

```markdown
# Training Evidence

Rulebook for `/newplan`. Every claim here is applied by the generator; if you
disagree with a plan, this is the file to argue with.

**Last researched:** YYYY-MM-DD

## Volume landmarks

Weekly hard sets per muscle. Mirrored machine-readably in
`tools/volume-landmarks.json` — the two are kept in sync by
`tools/evidence-sync.test.js`, so edit both together.

| Muscle | MEV | MAV | MRV | Notes |
|---|---|---|---|---|
| `chest` | 8 | 12–20 | 22 | … |
| …one row per key in volume-landmarks.json… |

## Frequency
## Proximity to failure
## Lengthened-position bias
## Rep ranges
## Progression models
## Deload timing and structure
## Exercise rotation vs retention

## Shoulder-cautious constraints

Rules that survive regardless of what the data suggests, unless the user's
run-time shoulder answer explicitly relaxes them:
- …

## Sources
```

- [ ] **Step 5: Reconcile the landmarks file**

Update `tools/volume-landmarks.json` so every value matches the researched table. If research moves a number, change both places in the same commit.

- [ ] **Step 6: Run tests to verify they pass**

```bash
node --test tools/evidence-sync.test.js tools/muscle-map.test.js
```

Expected: all tests pass — including the ordering invariant from Task 4, which catches a bad hand-edit of the landmarks

- [ ] **Step 7: Commit**

```bash
git add docs/training-evidence.md tools/volume-landmarks.json tools/evidence-sync.test.js
git commit -m "docs: researched hypertrophy evidence base with synced volume landmarks"
```

---

### Task 11: `.claude/commands/newplan.md`

**Goal:** The orchestrator prompt that ties the helpers together and does the design work.

**Files:**
- Create: `.claude/commands/newplan.md`

**Acceptance Criteria:**
- [ ] Stops with export instructions when `data/` holds no `*.json`
- [ ] Supports `--research` to refresh `docs/training-evidence.md` and the landmarks file
- [ ] Asks exactly three multiple-choice questions before generating
- [ ] Prints the approval brief and waits before calling the inserter
- [ ] Never edits `index.html` directly — insertion goes through `tools/insert-program.js`
- [ ] Leaves the change uncommitted and offers to commit

**Verify:** `test -f .claude/commands/newplan.md && grep -c 'insert-program.js' .claude/commands/newplan.md` → at least 1

**Steps:**

- [ ] **Step 1: Write the command file**

````markdown
---
description: Generate a new hypertrophy mesocycle from your logged training data and insert it into the app
---

# /newplan

Generate the next mesocycle for gAIns, improving on the previous blocks using the
user's own logged data, and insert it into `index.html`.

## Refresh mode

If `$ARGUMENTS` contains `--research`: re-run the web research described in
`docs/training-evidence.md` → "Sources", rewrite that file and
`tools/volume-landmarks.json` together, run `node --test tools/evidence-sync.test.js`,
report what changed, and stop. Do not generate a program in this mode.

## Step 1 — Find the export

```bash
ls -t data/*.json 2>/dev/null | head -5
```

If there are no files, stop and tell the user:

> No export found. In the app: **Settings → Export**, then move the downloaded
> `gains-backup-*.json` into `data/` and run `/newplan` again.

Do not fall back to generating without data unless the user explicitly asks.

## Step 2 — Analyze

```bash
node tools/analyze-history.js
```

Read the report. If every program shows "No logged data", tell the user which
programs were empty and ask whether to proceed on evidence and answers alone
before continuing.

## Step 3 — Read the rulebook

Read `docs/training-evidence.md` in full. It governs volume, frequency,
proximity to failure, rep ranges, progression, deloads, and rotation. Where it
records disagreement between sources, choose within the stated range and say
why in the brief.

## Step 4 — Ask three questions

Use a single `AskUserQuestion` call with exactly these three:

1. **Days/week** — how many training days this block? (3 / 4 / 5)
2. **Shoulder status** — current shoulder and joint state? (Fine, relax the
   cautions / Manageable, keep the cautions / Flaring, minimize overhead and
   pressing)
3. **Emphasis** — (Balanced / Bring up a lagging area — name it / Strength-leaning,
   heavier compounds and lower reps)

## Step 5 — Design the block

Apply, in order:

1. **Carry forward** exercises with good adherence and a positive weight slope.
2. **Replace** everything in the analyzer's *rejected* and *stalled* lists.
   Reconsider *under-stimulating* entries — usually a loading or rep-range
   problem, not an exercise problem.
3. **Allocate volume** per muscle inside the landmarks, biased by the emphasis
   answer. Ramp from near-MEV in week 1 toward MAV by the overreach week rather
   than one flat number all block.
4. **Set block length**: 8 weeks by default; 6 weeks if the analysis shows
   adherence collapsing after week 5–6.
5. **Preserve the shoulder-cautious constraints** from the evidence doc unless
   the shoulder answer says to relax them.

Write the result to `newplan.json` (gitignored) in exactly the shape
`tools/insert-program.js` validates — see `tools/fixtures/program-valid.json`
for a complete minimal example. Do **not** include an `id` field; the inserter
assigns the next `mesoN`. Every exercise needs
`id, name, sets, reps, rpe, note, llp, compound, rest, restLabel, muscles`,
with ids prefixed `m<N>_` where N is the new program number. Muscle keys must
come from `tools/volume-landmarks.json`. Include an `alternatives` object with
2–3 swap options per exercise.

## Step 6 — Present the brief and wait

Print, in this order:

1. **Per-muscle weekly sets** — a table with the new block's week-1 and peak-week
   values beside the actuals from the analysis.
2. **Day-by-day exercise list** — name, sets, reps, RPE.
3. **Changed vs. last block, and why** — one line per change, each citing a
   specific analyzer flag or a rule from the evidence doc.

Then ask whether to insert. **Do not write to `index.html` before approval.**

## Step 7 — Insert

```bash
node tools/insert-program.js newplan.json
```

The script runs four gates (schema, id uniqueness, `node --check`, smoke render)
and writes nothing if any fails. On failure, report the specific gate, fix the
generated JSON, and retry once. If it fails again, stop and show the user the
error rather than editing `index.html` by hand.

On success, report the assigned program id and tell the user:

- The change is uncommitted — review with `git diff index.html`
- The new program will be selected automatically next time the app loads

Offer to commit. Do not commit without being asked.
````

- [ ] **Step 2: Verify the command file**

```bash
test -f .claude/commands/newplan.md && grep -c 'insert-program.js' .claude/commands/newplan.md
```

Expected: prints a count of at least 1

- [ ] **Step 3: Run the full suite once more**

```bash
node --test tools/*.test.js
```

Expected: every test passes

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/newplan.md
git commit -m "feat: /newplan command for on-demand mesocycle generation"
```

---

### Task 12: End-to-end verification with real data

**Goal:** Prove the whole pipeline works on the user's actual export, from `/newplan` through to the app rendering the new program.

**USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Modify: `index.html` (via `tools/insert-program.js` only — never by hand)
- Create: `data/<user export>.json` (gitignored, supplied by the user)

**Acceptance Criteria:**
- [ ] `node tools/analyze-history.js` runs against the user's real export and exits 0
- [ ] `/newplan` completes end-to-end and prints the approval brief
- [ ] `node tools/insert-program.js newplan.json` exits 0 and reports `meso3`
- [ ] `node tools/smoke-render.js index.html 2` exits 0
- [ ] `node --test tools/*.test.js` passes with the new program in place
- [ ] `git diff --stat index.html` shows additions only — no lines removed from `meso1`/`meso2`

**Verify:** `node --test tools/*.test.js && node tools/smoke-render.js index.html 2 && git diff --stat index.html`

**Steps:**

- [ ] **Step 1: Get a real export**

Ask the user to export from the app (Settings → Export) and move the file into `data/`. Confirm:

```bash
ls -la data/
```

- [ ] **Step 2: Run the analyzer alone first**

```bash
node tools/analyze-history.js
```

Read the report and sanity-check it against what the user says about their training. If a number looks wrong — a muscle showing zero volume that they know they trained — the muscle map or swap resolution is at fault. Fix it before generating anything.

- [ ] **Step 3: Run the command end-to-end**

Run `/newplan`. Answer the three questions as the user directs. Review the brief with them.

- [ ] **Step 4: Capture the gate evidence**

```bash
node tools/insert-program.js newplan.json
node tools/smoke-render.js index.html 2
node --test tools/*.test.js
git diff --stat index.html
```

Expected: insert reports `Inserted meso3 into index.html`; smoke reports 8+ views clean; all tests pass; the diff shows insertions only.

- [ ] **Step 5: Confirm auto-select in a real browser**

Ask the user to open `index.html` and confirm the app lands on the new program and that switching back to Mesocycle 1 still shows its own days and logged history intact. This is the one check the headless harness cannot make.

- [ ] **Step 6: Commit once the user approves**

```bash
git add index.html
git commit -m "feat: add generated mesocycle 3"
```

```json:metadata
{"files": ["index.html", "data/"], "verifyCommand": "node --test tools/*.test.js && node tools/smoke-render.js index.html 2 && git diff --stat index.html", "acceptanceCriteria": ["analyze-history exits 0 on the real export", "/newplan prints the approval brief", "insert-program exits 0 reporting meso3", "smoke-render exits 0 for program index 2", "node --test tools/*.test.js passes", "git diff shows additions only, meso1/meso2 untouched"], "userGate": true, "tags": ["user-gate"], "modelTier": "standard"}
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `tools/app-shim.js` (plan addition) | 1 |
| `autoSelectNewProgram()` | 3 (plus the Task 2 prerequisite fix) |
| `tools/muscle-map.json` with fractional credit | 4 |
| `docs/training-evidence.md`, `--research` refresh | 10, 11 |
| `analyze-history.js` — adherence, per exercise, per muscle, flags | 5, 6 |
| v1/v2/v3 export handling | 5 |
| Newest `data/*.json` wins | 5, 6 (CLI), 11 |
| Three run-time questions | 11 |
| Generation rules (carry, replace, allocate, length, shoulder) | 11 |
| Approval brief and gate | 11 |
| Four insertion gates | 8, 9 |
| `smoke-render.js` | 7 |
| Append as next `mesoN`, prior programs intact | 9, 12 |
| Uncommitted change, offer to commit | 11 |
| `data/` gitignored | 1 |
| Failure modes (no export, empty history, bad JSON, gate failure, repeat runs) | 5, 9, 11 |

No spec requirement is unassigned.

**Known deviations, both deliberate and stated above:** the added `tools/app-shim.js`, and the Task 2 bug fix that the spec did not anticipate because the bug was found during planning.

**Naming consistency check:** `loadApp`, `extractScript`, `smokeRender`, `validateProgram`, `collectExistingIds`, `nextProgramId`, `toJsLiteral`, `spliceProgram`, `insertProgram`, `normalizeExport`, `perExercise`, `slopeOf`, `resolveMuscles`, `weeklyVolume`, `flagExercises`, `flagVolume`, `analyze`, `renderReport`, `findNewestExport` — each is defined once and used under the same name everywhere it appears.

## Task dependency graph

```
1 (app-shim)
├── 2 (boot sync fix) ── 3 (auto-select) ─┐
├── 4 (muscle map) ── 5 (analyzer core) ── 6 (analyzer report) ─┐
├── 7 (smoke render) ─┐                                         │
└── 8 (validation) ───┴── 9 (splice + gates) ───────────────────┤
                                    10 (evidence doc) ──────────┤
                                                                └── 11 (command) ── 12 (e2e gate)
```
