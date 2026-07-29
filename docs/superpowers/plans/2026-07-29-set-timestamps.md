# Set Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record when every set was performed, with provenance, so the app stops permanently losing the dates of training sessions.

**Architecture:** A parallel `state[dayId].times` map keyed `${exId}_${setIdx}`, holding `{at, src}`. Purely additive — no existing field changes shape, so the ~9 functions that compare `sets[]` scalars identity-wise are untouched. Two helpers (`markTime`/`clearTime`) keep all six write points to one line each. Export goes to v4 as a structural superset of v3.

**Tech Stack:** Vanilla JS in a single `index.html`. Tests are `node:test` against `tools/app-shim.js`, which evals the app's `<script>` block under a DOM shim.

**Global Constraints:**
- `src` is exactly one of `"log"`, `"skip"`, `"bulk"`, `"est"` — no other values
- `at` is epoch milliseconds; `est` entries use **local midnight** of the derived date
- Backfill writes/overwrites **only** entries whose `src === "est"`; `log`/`skip`/`bulk` are never touched
- `prefillFromPreviousWeeks()` must never copy `times`
- Migration never invents a date — `times` starts empty and stays empty until the user explicitly backfills
- The rest timer's existing `Date.now()` calls are out of scope and must not be modified
- Baseline is 179 passing tests; every task must leave the suite green

**User decisions (already made):**
- Per-set granularity, because "session duration and pacing" was a stated goal and cannot be answered per-day
- Backfill via an estimated start date per mesocycle, flagged so estimates never look like measured data
- Bulk operations get a timestamp **plus** a provenance flag, rather than being skipped or recorded indistinguishably
- Approach A (parallel `times` map) over upgrading `sets` entries to objects (B) or an event log (C)
- This plan lands the data model only; no UI consumes the timestamps yet

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `index.html` | The app. Clock seam, helpers, six write points, deletion paths, export/import, backfill + Settings UI. | Modify |
| `tools/app-shim.js` | Test harness. Needs `FileReader`, a content-capturing `Blob`, and more exposed bindings. | Modify |
| `tools/timestamps.test.js` | All 16 timestamp tests. | Create |
| `docs/superpowers/specs/2026-07-29-set-timestamps-design.md` | The spec. | Reference only |

**Note on test count:** the spec lists 15 cases (1–14 plus 11b). Self-review found the spec has no case asserting that backfill *correctly generates* `est` entries — only that it is idempotent and that it refuses oversized programs. This plan adds that as **test 15**, bringing the total to 16.

---

### Task 1: Clock seam, `times` plumbing, and shim exposure

**Goal:** `times` exists on every day, survives save/load, and the clock is stubbable — with the prefill exclusion pinned before any write path can violate it.

**Files:**
- Modify: `index.html` — add clock seam + helpers near `saveState` (JS ~2010); add `times` to `initState` (JS ~1914)
- Modify: `tools/app-shim.js` — expose new bindings
- Create: `tools/timestamps.test.js`

**Acceptance Criteria:**
- [ ] `nowMs()` returns `Date.now()` by default; `setClock(fn)` replaces it; `setClock(null)` restores the default
- [ ] Every day in `state` has a `times` object after `initState()`
- [ ] Day state saved without a `times` key loads without throwing
- [ ] `times` survives a `saveState()` → `loadState()` → `initState()` round trip
- [ ] `prefillFromPreviousWeeks()` copies weights and effort forward but not `times`
- [ ] The rest timer's `Date.now()` calls are unchanged

**Verify:** `node --test tools/*.test.js` → 179 baseline + 4 new = 183 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tools/timestamps.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

// Mirrors reps.test.js — without every program marked "seen", the
// auto-select-newest-untrained-program feature switches away from program 0
// and breaks the day/exercise ids these tests expect.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

const FIXED = 1785340666000; // 2026-07-29T15:57:46Z

test('1. every day gets a times map on a fresh install', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.DAYS.forEach(d => {
      assert.ok(app.state[d.id].times, `${d.id} has no times map`);
      assert.deepStrictEqual(app.state[d.id].times, {});
    });
  });
});

test('2. state saved without a times key still loads without error', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: { sets: { [ex.id]: [true, false, false] }, weights: {}, effort: {} },
    }),
  });
  withApp({ storage: seed }, app => {
    assert.deepStrictEqual(app.state[day.id].times, {});
  });
});

test('3. times survive a save/load round trip', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: {
        sets: { [ex.id]: [true, false, false] },
        weights: {}, effort: {},
        times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
      },
    }),
  });
  withApp({ storage: seed }, app => {
    assert.deepStrictEqual(app.state[day.id].times[`${ex.id}_0`], { at: FIXED, src: 'log' });
  });
});

test('10. prefillFromPreviousWeeks carries weights forward but never times', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '2',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: {
        sets: { [ex.id]: [true, true, true] },
        weights: { [ex.id]: '135' },
        effort: { [ex.id]: 'high' },
        times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
      },
    }),
  });
  withApp({ storage: seed }, app => {
    // Week 2 inherits the prior week's weight and effort...
    assert.strictEqual(app.state[day.id].weights[ex.id], '135');
    assert.strictEqual(app.state[day.id].effort[ex.id], 'high');
    // ...but must NOT inherit a timestamp for a set that was never performed.
    assert.deepStrictEqual(app.state[day.id].times, {});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/timestamps.test.js`
Expected: FAIL — tests 1, 2, 3, 10 fail on `state[dayId].times` being `undefined`.

- [ ] **Step 3: Add the clock seam and helpers to `index.html`**

Insert immediately before `function saveState()` (JS ~2010):

```js
// Clock seam. Every timestamp this feature writes goes through nowMs() so
// tests can pin the clock. The rest timer's own Date.now() calls are
// deliberately left alone — that logic works and is backgrounding-sensitive.
let clockNow = () => Date.now();
function nowMs() { return clockNow(); }
function setClock(fn) { clockNow = fn || (() => Date.now()); }

// A set was performed at a moment, by one of four routes. `src` is what keeps
// a bulk tap or an estimated backfill from ever being mistaken for a measured
// log — see docs/superpowers/specs/2026-07-29-set-timestamps-design.md.
function markTime(dayId, exId, setIdx, src) {
  if (!state[dayId]) return;
  if (!state[dayId].times) state[dayId].times = {};
  state[dayId].times[`${exId}_${setIdx}`] = { at: nowMs(), src };
}

// A set that was un-done was not performed. A stale timestamp is worse than
// no timestamp, so every un-resolve path deletes rather than leaving it.
function clearTime(dayId, exId, setIdx) {
  if (!state[dayId] || !state[dayId].times) return;
  delete state[dayId].times[`${exId}_${setIdx}`];
}
```

- [ ] **Step 4: Add `times` to `initState`**

In `initState()` (JS ~1914), add one line to the state literal, matching how `reps` is handled:

```js
    state[day.id] = {
      sets: {},
      weights: savedDay.weights || {},
      reps: savedDay.reps || {},
      times: savedDay.times || {},
      effort: savedDay.effort || {},
      protocol: savedDay.protocol || [],
      swaps: savedDay.swaps || {}
    };
```

`prefillFromPreviousWeeks()` needs **no change** — it only copies `weights` and `effort`. Test 10 exists to pin that, so a future edit can't quietly add `times` to it.

- [ ] **Step 5: Expose new bindings in `tools/app-shim.js`**

In the `eval` tail inside `setupApp`, extend the returned object:

```js
      '\n;({ PROGRAMS, EXERCISE_ALTERNATIVES, currentWeek, state, view,' +
      ' render, switchProgram, boot, activeSet, logActiveSet, skipSet, curDay,' +
      ' getExerciseHistory, lowRep,' +
      ' nowMs, setClock, markTime, clearTime,' +
      ' toggleSet, undoSet, skipExercise, skipDay, completeDay,' +
      ' initState, saveState, loadState, prefillFromPreviousWeeks,' +
```

Keep the existing `get commitEdit()` and the `get currentProgramIdx()` / `get DAYS()` / etc. getters exactly as they are — they follow this line.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/timestamps.test.js`
Expected: PASS — 4/4.

Then the full suite: `node --test tools/*.test.js`
Expected: 183 passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add index.html tools/app-shim.js tools/timestamps.test.js
git commit -m "feat: add times map, clock seam, and prefill exclusion"
```

---

### Task 2: Write points for `log` and `skip`

**Goal:** Individually-resolved sets record a precise, correctly-attributed timestamp.

**Files:**
- Modify: `index.html` — `logActiveSet` (JS ~2859), `toggleSet` (JS ~2105), `skipSet` (JS ~2208)
- Modify: `tools/timestamps.test.js`

**Acceptance Criteria:**
- [ ] `logActiveSet` writes `{at, src: "log"}` at the stubbed clock's value
- [ ] `toggleSet` writes `{at, src: "log"}` when marking a set done
- [ ] `skipSet` writes `{at, src: "skip"}` when marking a set skipped
- [ ] Each writes before `saveState()`, so the timestamp is persisted in the same write

**Verify:** `node --test tools/*.test.js` → 186 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/timestamps.test.js`:

```js
function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

test('4. logActiveSet writes src "log" at the stubbed clock value', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const act = app.activeSet(day);
    app.logActiveSet();
    assert.deepStrictEqual(
      app.state[day.id].times[`${act.ex.id}_${act.i}`],
      { at: FIXED, src: 'log' }
    );
  });
});

test('5. toggleSet writes src "log"', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    assert.deepStrictEqual(app.state[day.id].times[`${ex.id}_0`], { at: FIXED, src: 'log' });
  });
});

test('6. skipSet writes src "skip", not "log"', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.skipSet(day.id, ex.id, 0);
    assert.deepStrictEqual(app.state[day.id].times[`${ex.id}_0`], { at: FIXED, src: 'skip' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/timestamps.test.js`
Expected: FAIL — tests 4, 5, 6 fail reading properties of `undefined`.

- [ ] **Step 3: Add the write to `logActiveSet`**

In `logActiveSet()` (JS ~2859), immediately after the reps block and before `saveState()`:

```js
  const rn = (r === '' || r == null) ? NaN : Number(r);
  if (!isNaN(rn)) {
    state[day.id].reps[ex.id] = rn;
    state[day.id].reps[`${ex.id}_${i}`] = rn;
  }
  markTime(day.id, ex.id, i, 'log');
  saveState();
```

- [ ] **Step 4: Add the write to `toggleSet`**

In `toggleSet()` (JS ~2105), in the mark-done path — after the weight capture, before `saveState()`:

```js
  state[dayId].sets[exId][setIdx] = true;
  markTime(dayId, exId, setIdx, 'log');
  saveState();
```

- [ ] **Step 5: Add the write to `skipSet`**

In `skipSet()` (JS ~2208), in the branch that sets `'skipped'`:

```js
  } else if (current === false) {
    state[dayId].sets[exId][setIdx] = 'skipped';
    markTime(dayId, exId, setIdx, 'skip');
  }
```

Leave the un-skip branch alone for now — Task 4 handles deletion.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 186 passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add index.html tools/timestamps.test.js
git commit -m "feat: record log and skip timestamps on individual sets"
```

---

### Task 3: Write points for `bulk`

**Goal:** Sets resolved en masse record the day honestly without corrupting pacing analysis.

**Files:**
- Modify: `index.html` — `skipExercise` (JS ~2225), `skipDay` (JS ~2245), `completeDay` (JS ~2265)
- Modify: `tools/timestamps.test.js`

**Acceptance Criteria:**
- [ ] `completeDay` writes `src: "bulk"` for every set it flips to `true`
- [ ] `skipDay` writes `src: "bulk"` for every set it flips to `'skipped'`
- [ ] `skipExercise` writes `src: "bulk"` for every set it flips to `'skipped'`
- [ ] None of the three overwrite a timestamp on a set that was already resolved

**Verify:** `node --test tools/*.test.js` → 189 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/timestamps.test.js`:

```js
test('7a. completeDay writes src "bulk" for every set it flips', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    app.completeDay(day.id);
    const times = app.state[day.id].times;
    const keys = Object.keys(times);
    assert.ok(keys.length > 0, 'completeDay wrote no timestamps');
    keys.forEach(k => assert.strictEqual(times[k].src, 'bulk', `${k} is not bulk`));
  });
});

test('7b. skipDay writes src "bulk"', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    app.skipDay(day.id);
    const times = app.state[day.id].times;
    assert.ok(Object.keys(times).length > 0);
    Object.keys(times).forEach(k => assert.strictEqual(times[k].src, 'bulk'));
  });
});

test('7c. bulk ops do not overwrite an existing measured timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.setClock(() => FIXED);
    app.toggleSet(day.id, ex.id, 0);          // real log at FIXED
    app.setClock(() => FIXED + 60000);
    app.completeDay(day.id);                   // bulk-resolves the rest
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'log' },
      'completeDay clobbered a measured log timestamp'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/timestamps.test.js`
Expected: FAIL — 7a and 7b fail on an empty `times`; 7c fails only once 7a passes.

- [ ] **Step 3: Add the write to `completeDay`**

```js
function completeDay(dayId) {
  const ids = activeExIds(dayId);
  ids.forEach(id => {
    const arr = state[dayId].sets[id];
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== true) { arr[i] = true; markTime(dayId, id, i, 'bulk'); }
    }
  });
  saveState();
  refreshCurrentDay(dayId);
}
```

The `if (arr[i] !== true)` guard already means an already-logged set is skipped, so a measured `log` timestamp is never clobbered — that is what test 7c pins.

- [ ] **Step 4: Add the write to `skipDay`**

```js
      if (allResolved && hasSkipped) {
        if (arr[i] === 'skipped') { arr[i] = false; clearTime(dayId, id, i); }
      } else {
        if (arr[i] === false) { arr[i] = 'skipped'; markTime(dayId, id, i, 'bulk'); }
      }
```

The `clearTime` in the un-skip branch is Task 4's concern but lands naturally here — keep it.

- [ ] **Step 5: Add the write to `skipExercise`**

```js
function skipExercise(dayId, exId) {
  const sets = state[dayId].sets[exId];
  const allSkipped = sets.every(v => v === 'skipped');
  if (allSkipped) {
    for (let i = 0; i < sets.length; i++) { sets[i] = false; clearTime(dayId, exId, i); }
  } else {
    for (let i = 0; i < sets.length; i++) {
      if (sets[i] === false) { sets[i] = 'skipped'; markTime(dayId, exId, i, 'bulk'); }
    }
  }
  saveState();
  refreshCurrentDay(dayId);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 189 passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add index.html tools/timestamps.test.js
git commit -m "feat: flag bulk-resolved sets so pacing stats stay honest"
```

---

### Task 4: Delete timestamps on every un-resolve path

**Goal:** No timestamp outlives the set it describes.

**Files:**
- Modify: `index.html` — `undoSet` (JS ~2853), `toggleSet` un-done branch (JS ~2105), `skipSet` un-skip branch (JS ~2208)
- Modify: `tools/timestamps.test.js`

**Acceptance Criteria:**
- [ ] `undoSet` removes the entry entirely (key absent, not set to `undefined`)
- [ ] `toggleSet` on an already-done set removes the entry
- [ ] `skipSet` on an already-skipped set removes the entry
- [ ] `skipDay` / `skipExercise` un-skip branches remove entries (landed in Task 3)
- [ ] Re-logging after an undo writes a fresh timestamp, not the stale one

**Verify:** `node --test tools/*.test.js` → 192 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/timestamps.test.js`:

```js
test('8. undoSet removes the timestamp entirely', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    assert.ok(app.state[day.id].times[`${ex.id}_0`]);
    app.undoSet(day.id, ex.id, 0);
    assert.ok(
      !(`${ex.id}_0` in app.state[day.id].times),
      'key must be absent, not undefined'
    );
  });
});

test('9a. toggling a done set off removes its timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    app.toggleSet(day.id, ex.id, 0);
    assert.ok(!(`${ex.id}_0` in app.state[day.id].times));
  });
});

test('9b. un-skipping a set removes its timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.skipSet(day.id, ex.id, 0);
    app.skipSet(day.id, ex.id, 0);
    assert.ok(!(`${ex.id}_0` in app.state[day.id].times));
  });
});

test('9c. re-logging after undo records a fresh timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.setClock(() => FIXED);
    app.toggleSet(day.id, ex.id, 0);
    app.undoSet(day.id, ex.id, 0);
    app.setClock(() => FIXED + 120000);
    app.toggleSet(day.id, ex.id, 0);
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED + 120000, src: 'log' }
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/timestamps.test.js`
Expected: FAIL — stale timestamps survive.

- [ ] **Step 3: Add deletion to `undoSet`**

```js
function undoSet(dayId, exId, i) {
  state[dayId].sets[exId][i] = false;
  clearTime(dayId, exId, i);
  saveState();
  view.pendKey = '';
}
```

- [ ] **Step 4: Add deletion to the `toggleSet` un-done branch**

```js
  if (wasDone) {
    state[dayId].sets[exId][setIdx] = false;
    clearTime(dayId, exId, setIdx);
    saveState();
    refreshCurrentDay(dayId);
    return;
  }
```

- [ ] **Step 5: Add deletion to the `skipSet` un-skip branch**

```js
  if (current === 'skipped') {
    state[dayId].sets[exId][setIdx] = false;
    clearTime(dayId, exId, setIdx);
  } else if (current === false) {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 192 passing, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add index.html tools/timestamps.test.js
git commit -m "fix: delete timestamps when a set is un-resolved"
```

---

### Task 5: Export v4 and import compatibility

**Goal:** Backups carry timestamps, and old backups still import cleanly in both directions.

**Files:**
- Modify: `index.html` — `exportData` (JS ~2538), `importData` (JS ~2566), `settingsHTML` (JS ~3095)
- Modify: `tools/app-shim.js` — content-capturing `Blob`, `FileReader` stub
- Modify: `tools/timestamps.test.js`

**Acceptance Criteria:**
- [ ] Export emits `version: 4` and includes each day's `times`
- [ ] Export includes per-program `startDate` when one is stored, and omits the key when not
- [ ] A v3 backup imports cleanly, leaving `times` empty and fabricating zero dates
- [ ] A v4 backup round-trips through export → import with timestamps intact
- [ ] v2 and legacy v1 import branches are unmodified
- [ ] Settings copy reads `v4` and "v1, v2, v3 or v4"

**Verify:** `node --test tools/*.test.js` → 196 passing, 0 failing

**Steps:**

- [ ] **Step 1: Add the `Blob` and `FileReader` stubs to `tools/app-shim.js`**

`exportData` writes into a `Blob` and `importData` reads through a `FileReader`; neither is currently capturable, so the tests cannot be written without this first.

Add `'FileReader'` to `GLOBAL_KEYS`:

```js
const GLOBAL_KEYS = [
  'window', 'document', 'localStorage', 'navigator', 'Notification',
  'AudioContext', 'webkitAudioContext', 'Blob', 'URL', 'FileReader',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'requestAnimationFrame', 'alert',
];
```

In `setupApp`, replace the `Blob` stub and add `FileReader`:

```js
  // Capture what exportData serialises so tests can assert on it.
  let lastBlob = null;
  setGlobal('Blob', function (parts) { lastBlob = parts && parts[0]; });
  setGlobal('URL', { createObjectURL: () => 'blob:stub', revokeObjectURL() {} });
  // Synchronous FileReader: importData calls readAsText and acts in onload.
  // Test files are plain objects carrying a `_content` string.
  setGlobal('FileReader', function () {
    this.onload = null;
    this.readAsText = file => {
      if (this.onload) this.onload({ target: { result: file._content } });
    };
  });
```

Expose the capture and the two functions on the api. Extend the `Object.assign` at the end of `setupApp`:

```js
  Object.assign(api, {
    storage, elements,
    get lastBlob() { return lastBlob; },
    get clickHandler() { return clickHandler; },
  });
```

And add to the `eval` tail, alongside the bindings from Task 1:

```js
      ' exportData, importData,' +
```

- [ ] **Step 2: Write the failing tests**

Append to `tools/timestamps.test.js`:

```js
function fileEvent(content) {
  return { target: { files: [{ _content: content }], value: '' } };
}

test('12. export emits version 4 including times', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: {
        sets: { [ex.id]: [true, false, false] },
        weights: {}, effort: {},
        times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
      },
    }),
  });
  withApp({ storage: seed }, app => {
    app.exportData();
    const out = JSON.parse(app.lastBlob);
    assert.strictEqual(out.version, 4);
    assert.deepStrictEqual(
      out.programs[prog.id].weeks['1'][day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'log' }
    );
  });
});

test('13. a v3 backup imports cleanly and fabricates no dates', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const backup = JSON.stringify({
    version: 3,
    currentProgram: 0,
    programs: {
      [prog.id]: {
        currentWeek: 1,
        weeks: { 1: { [day.id]: { sets: { [ex.id]: [true, true, false] }, weights: {}, effort: {} } } },
      },
    },
  });
  withApp({ storage: allSeenSeed() }, app => {
    app.importData(fileEvent(backup));
    assert.deepStrictEqual(app.state[day.id].times, {}, 'import invented dates');
    assert.strictEqual(app.state[day.id].sets[ex.id][0], true, 'import lost set data');
  });
});

test('14. a v4 backup round-trips with timestamps intact', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const backup = JSON.stringify({
    version: 4,
    currentProgram: 0,
    programs: {
      [prog.id]: {
        currentWeek: 1,
        startDate: '2026-03-02',
        weeks: {
          1: {
            [day.id]: {
              sets: { [ex.id]: [true, false, false] },
              weights: {}, effort: {},
              times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
            },
          },
        },
      },
    },
  });
  withApp({ storage: allSeenSeed() }, app => {
    app.importData(fileEvent(backup));
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'log' }
    );
    assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), '2026-03-02');
  });
});

test('12b. export omits startDate when none is stored', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.exportData();
    const out = JSON.parse(app.lastBlob);
    Object.values(out.programs).forEach(p => {
      assert.ok(!('startDate' in p), 'startDate present with no stored value');
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tools/timestamps.test.js`
Expected: FAIL — export still reports `version: 3`; v4 import falls through to "Invalid backup file."

- [ ] **Step 4: Add the start-date key helper**

Insert next to the other storage-key helpers (near `weekStorageKey`, JS ~1714):

```js
function programStartKey(progId) { return `hypertrophy_start_${progId}`; }
```

- [ ] **Step 5: Update `exportData`**

```js
    const weekNum = parseInt(localStorage.getItem(`hypertrophy_week_${prog.id}`) || '1');
    const startDate = localStorage.getItem(programStartKey(prog.id));
    allPrograms[prog.id] = startDate
      ? { weeks, currentWeek: weekNum, startDate }
      : { weeks, currentWeek: weekNum };
  });
  const data = { programs: allPrograms, currentProgram: savedProgIdx, version: 4 };
```

`times` needs no explicit handling — the week blobs are copied wholesale from `localStorage`.

- [ ] **Step 6: Update `importData`**

v4 is a structural superset of v3, so one shared branch handles both:

```js
      if ((data.version === 4 || data.version === 3) && data.programs) {
        for (const [progId, progData] of Object.entries(data.programs)) {
          for (const [w, wState] of Object.entries(progData.weeks)) {
            localStorage.setItem(`${STORAGE_KEY}_${progId}_w${w}`, JSON.stringify(wState));
          }
          localStorage.setItem(`hypertrophy_week_${progId}`, progData.currentWeek);
          if (progData.startDate) {
            localStorage.setItem(programStartKey(progId), progData.startDate);
          }
        }
```

Do not touch the `version === 2` or legacy branches.

- [ ] **Step 7: Update the Settings copy**

In `settingsHTML()`:

```js
    <div class="vw-sub">BACKUP &amp; RESTORE · v4 · ALL PROGRAMS &amp; WEEKS</div>
```

and:

```js
      <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;margin-bottom:12px">Restore from a v1, v2, v3 or v4 gAIns backup. Legacy files are migrated automatically.</div>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 196 passing, 0 failing.

- [ ] **Step 9: Commit**

```bash
git add index.html tools/app-shim.js tools/timestamps.test.js
git commit -m "feat: export v4 carrying timestamps, compatible both directions"
```

---

### Task 6: Explicit backfill from a per-program start date

**Goal:** Recover approximate dates for ~1,568 historical sets without ever disguising an estimate as a measurement.

**Files:**
- Modify: `index.html` — add `backfillProgram` near `programStartKey`; Settings panel in `settingsHTML` (JS ~3095); click branch (JS ~3701)
- Modify: `tools/timestamps.test.js`

**Acceptance Criteria:**
- [ ] `backfillProgram(progId, startDate)` writes `{at, src: "est"}` for every resolved set across all stored weeks
- [ ] `at` is local midnight of `startDate + (week − 1) × 7 + dayIndex` days, where `dayIndex` is the 0-based position in the program's `days` array
- [ ] Re-running overwrites `est` entries and leaves `log` / `skip` / `bulk` untouched
- [ ] A program with more than 7 days is refused with `{ok: false}` and writes nothing
- [ ] An unparseable date is refused with `{ok: false}` and writes nothing
- [ ] The start date is persisted under `hypertrophy_start_<progId>`
- [ ] Settings exposes a date field and a button; using it re-runs `initState()` so the current week reflects the new data
- [ ] Migration and import still never trigger backfill on their own

**Verify:** `node --test tools/*.test.js` → 200 passing, 0 failing

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/timestamps.test.js`:

```js
function seedTwoWeeks(prog) {
  const d0 = prog.days[0], d1 = prog.days[1];
  const e0 = d0.exercises[0], e1 = d1.exercises[0];
  return Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [d0.id]: { sets: { [e0.id]: [true, 'skipped', false] }, weights: {}, effort: {} },
      [d1.id]: { sets: { [e1.id]: [true, true, true] }, weights: {}, effort: {} },
    }),
    [`hypertrophy_state_${prog.id}_w2`]: JSON.stringify({
      [d0.id]: { sets: { [e0.id]: [true, false, false] }, weights: {}, effort: {} },
    }),
  });
}

const DAY_MS = 86400000;
const midnight = iso => Date.parse(iso + 'T00:00:00');

test('15. backfill writes est entries at the derived day-level date', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  withApp({ storage: seedTwoWeeks(prog) }, app => {
    const res = app.backfillProgram(prog.id, '2026-03-02');
    assert.strictEqual(res.ok, true);

    const raw1 = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w1`));
    const d0 = prog.days[0], e0 = d0.exercises[0];
    // Week 1, day index 0 → the start date itself, at local midnight.
    assert.deepStrictEqual(
      raw1[d0.id].times[`${e0.id}_0`],
      { at: midnight('2026-03-02'), src: 'est' }
    );
    // Skipped sets are resolved too, so they are dated.
    assert.strictEqual(raw1[d0.id].times[`${e0.id}_1`].src, 'est');
    // Unresolved sets get nothing.
    assert.ok(!(`${e0.id}_2` in raw1[d0.id].times));

    // Week 1, day index 1 → one day later.
    const d1 = prog.days[1], e1 = d1.exercises[0];
    assert.strictEqual(
      raw1[d1.id].times[`${e1.id}_0`].at,
      midnight('2026-03-02') + DAY_MS
    );

    // Week 2, day index 0 → seven days later.
    const raw2 = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w2`));
    assert.strictEqual(
      raw2[d0.id].times[`${e0.id}_0`].at,
      midnight('2026-03-02') + 7 * DAY_MS
    );

    assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), '2026-03-02');
  });
});

test('11. re-running backfill overwrites est but never measured timestamps', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], d0 = prog.days[0], e0 = d0.exercises[0];
  const seed = seedTwoWeeks(prog);
  // Set 0 was really logged; set 1 was really skipped. Both must be immune.
  const w1 = JSON.parse(seed[`hypertrophy_state_${prog.id}_w1`]);
  w1[d0.id].times = {
    [`${e0.id}_0`]: { at: FIXED, src: 'log' },
    [`${e0.id}_1`]: { at: FIXED, src: 'skip' },
  };
  seed[`hypertrophy_state_${prog.id}_w1`] = JSON.stringify(w1);

  withApp({ storage: seed }, app => {
    app.backfillProgram(prog.id, '2026-03-02');
    app.backfillProgram(prog.id, '2026-05-04'); // revise the estimate

    const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w1`));
    assert.deepStrictEqual(raw[d0.id].times[`${e0.id}_0`], { at: FIXED, src: 'log' });
    assert.deepStrictEqual(raw[d0.id].times[`${e0.id}_1`], { at: FIXED, src: 'skip' });

    // A genuinely estimated entry elsewhere did move to the revised date.
    const d1 = prog.days[1], e1 = d1.exercises[0];
    assert.deepStrictEqual(
      raw[d1.id].times[`${e1.id}_0`],
      { at: midnight('2026-05-04') + DAY_MS, src: 'est' }
    );
  });
});

test('11b. backfill refuses a program with more than 7 days', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  withApp({ storage: seedTwoWeeks(prog) }, app => {
    const original = prog.days.slice();
    // Grow the program past a week so dayIndex would overlap the next week.
    while (prog.days.length <= 7) prog.days.push(original[0]);
    try {
      const res = app.backfillProgram(prog.id, '2026-03-02');
      assert.strictEqual(res.ok, false);
      const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w1`));
      assert.ok(!raw[prog.days[0].id].times, 'refused backfill still wrote data');
    } finally {
      prog.days.length = 0;
      original.forEach(d => prog.days.push(d));
    }
  });
});

test('11c. backfill refuses an unparseable date', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  withApp({ storage: seedTwoWeeks(prog) }, app => {
    const res = app.backfillProgram(prog.id, 'not-a-date');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/timestamps.test.js`
Expected: FAIL — `app.backfillProgram is not a function`.

- [ ] **Step 3: Implement `backfillProgram`**

Insert immediately after `programStartKey` (added in Task 5):

```js
// Derive approximate dates for historical sets logged before timestamps
// existed. Everything written here is src:"est" and must stay distinguishable
// from measured data forever — see the design spec. Returns {ok, written} or
// {ok:false, reason}.
function backfillProgram(progId, startDate) {
  const prog = PROGRAMS.find(p => p.id === progId);
  if (!prog) return { ok: false, reason: 'unknown program' };
  // dayIndex is added as a day offset within the week, so a program longer
  // than a week would spill into the next week's dates. Refuse rather than
  // silently produce wrong dates.
  if (prog.days.length > 7) return { ok: false, reason: 'program has more than 7 days' };
  const base = Date.parse(String(startDate) + 'T00:00:00');
  if (isNaN(base)) return { ok: false, reason: 'invalid date' };

  let written = 0;
  for (let w = 1; w <= prog.totalWeeks; w++) {
    const key = `${STORAGE_KEY}_${progId}_w${w}`;
    let raw;
    try { raw = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!raw || !Object.keys(raw).length) continue;

    prog.days.forEach((day, dayIndex) => {
      const sd = raw[day.id];
      if (!sd || !sd.sets) return;
      const at = base + ((w - 1) * 7 + dayIndex) * 86400000;
      if (!sd.times) sd.times = {};
      Object.keys(sd.sets).forEach(exId => {
        const arr = sd.sets[exId];
        if (!Array.isArray(arr)) return;
        arr.forEach((v, i) => {
          if (v !== true && v !== 'skipped') return;
          const k = `${exId}_${i}`;
          const existing = sd.times[k];
          // The safety property: only ever write over our own estimates.
          if (existing && existing.src !== 'est') return;
          sd.times[k] = { at, src: 'est' };
          written++;
        });
      });
    });
    localStorage.setItem(key, JSON.stringify(raw));
  }
  localStorage.setItem(programStartKey(progId), String(startDate));
  return { ok: true, written };
}
```

- [ ] **Step 4: Expose `backfillProgram` in `tools/app-shim.js`**

Add to the `eval` tail alongside the other bindings:

```js
      ' backfillProgram, programStartKey,' +
```

- [ ] **Step 5: Add the Settings panel**

In `settingsHTML()`, insert a panel immediately before the `THIS WEEK` panel:

```js
    <div class="panel" style="margin-left:0;margin-right:0">
      <div class="panel-h">TRAINING START DATE</div>
      <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;margin-bottom:12px">Sets logged before dates were recorded have no date. Setting a start date for <strong>${esc(prog.name)}</strong> fills in estimated dates, marked as estimates. Real logged times are never changed, so you can revise this freely.</div>
      <input type="date" id="startDate-${esc(prog.id)}" value="${esc(localStorage.getItem(programStartKey(prog.id)) || '')}" style="width:100%;margin-bottom:10px;font-family:var(--font-mono);font-size:12px;padding:8px;background:var(--surface);color:var(--ink);border:1px solid var(--border)">
      <button class="big-btn ghost" data-act="backfill" data-p="${esc(prog.id)}">SET START DATE</button>
    </div>
```

- [ ] **Step 6: Add the click branch**

In the delegated handler (JS ~3701), add before the final `else return;`:

```js
  else if (act === 'backfill') {
    const pid = el.dataset.p;
    const input = document.getElementById(`startDate-${pid}`);
    const res = backfillProgram(pid, input ? input.value : '');
    // Backfill writes straight to localStorage across all weeks; reload so the
    // in-memory current week reflects it.
    if (res.ok) initState();
    view.importMsg = res.ok
      ? `Estimated dates written for ${res.written} sets.`
      : `Could not set start date: ${res.reason}.`;
    view.importOk = res.ok;
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tools/*.test.js`
Expected: 200 passing, 0 failing.

- [ ] **Step 8: Verify the script still parses as a browser would**

```bash
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > /tmp/gains-app.js
node --check /tmp/gains-app.js
```

Expected: no output (clean parse).

- [ ] **Step 9: Commit**

```bash
git add index.html tools/app-shim.js tools/timestamps.test.js
git commit -m "feat: estimated backfill from a per-program start date"
```

---

### Task 7: Update TODO.md

**Goal:** The backlog reflects what shipped and corrects the item-4 overstatement found during design.

**Files:**
- Modify: `TODO.md`

**Acceptance Criteria:**
- [ ] Tier 0 item 1 marked complete, with a note that no UI consumes the data yet
- [ ] Item 4 corrected: per-set weights already exist in `toggleSet` and `logActiveSet`; only `saveWeight()` writes exercise-level only
- [ ] Item 6 notes that timestamps are now available as an input

**Verify:** `git diff --stat TODO.md` shows only `TODO.md` changed; `node --test tools/*.test.js` → 200 passing

**Steps:**

- [ ] **Step 1: Mark item 1 done**

Change item 1's status line to:

```markdown
**Status:** done — 2026-07-29. Data model only; nothing in the UI reads the
timestamps yet. See `docs/superpowers/specs/2026-07-29-set-timestamps-design.md`.
```

- [ ] **Step 2: Correct item 4**

Replace item 4's body paragraph with:

```markdown
Partially done already. Both `toggleSet` and `logActiveSet` write
`weights[exId_i]` alongside `weights[exId]` — only `saveWeight()` (the text
input path) writes exercise-level only. Remaining work is narrower than first
written up: make `saveWeight()` per-set and make the progress view read per-set
weights.
```

- [ ] **Step 3: Note the new input on item 6**

Append to item 6's checklist:

```markdown
- [ ] Plot against real dates now that `times` exists (filter to `src: "log"`
      for pacing; exclude `est` from anything claiming precision)
```

- [ ] **Step 4: Commit**

```bash
git add TODO.md
git commit -m "docs: mark timestamps done, correct per-set weight scope"
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task — data shape and clock seam → Task 1; write points → Tasks 2 and 3; deletion → Task 4; export v4 → Task 5; backfill → Task 6. The spec's "Related" note about item 4 → Task 7. One gap found and closed: the spec's test list had no case asserting backfill *generates* correct `est` entries, only idempotency and refusal; added as test 15 in Task 6.

**Placeholder scan:** No TBD/TODO markers. Every code step carries real code. No "similar to Task N" references.

**Type consistency:** `markTime(dayId, exId, setIdx, src)` and `clearTime(dayId, exId, setIdx)` keep the same signatures across Tasks 1–4. `programStartKey(progId)` is defined in Task 5 and consumed in Tasks 5 and 6. `backfillProgram` returns `{ok, written}` / `{ok, reason}` consistently in the implementation, tests, and click branch. The `times` entry shape `{at, src}` is identical everywhere.

**Test count arithmetic:** 179 baseline → 183 (T1, +4) → 186 (T2, +3) → 189 (T3, +3) → 192 (T4, +4) → 196 (T5, +4) → 200 (T6, +4). Sixteen new tests, matching the file structure note above.
