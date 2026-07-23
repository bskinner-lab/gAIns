# Out-of-Order Logging + Custom Weight & Reps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user log any exercise on the current day in any order, type exact weights instead of stepping to them, and record actual reps performed per set.

**Architecture:** All changes live in `index.html` (single-file app, no build step). Selection is one new UI-only field on the `view` object that biases `activeSet()`; reps are a new `state[dayId].reps` map that mirrors the existing `weights` map key-for-key, so no data migration is needed. Inline numeric entry works around the 500 ms whole-innerHTML render loop by freezing `renderBottomBar()` while a field is on screen. Tests are headless Node tests under `tools/`, driving the app's real delegated click handler through the existing `app-shim.js` DOM shim.

**Tech Stack:** Vanilla JS (ES2015+), no framework, no bundler. Node 24 + `node:test` + `node:assert` for tests. `tools/app-shim.js` (DOM/localStorage shim), `tools/smoke-render.js` (renders every view of every program).

**User decisions (already made):**
- Reps scope: "Record actual reps performed (new data)" — a real new persisted field, not a derived one.
- Granularity: "Any exercise; sets stay in order within it" — no reordering of sets inside an exercise.
- Entry UX: "Tap the number → inline numeric field" — the ± steppers stay; tapping the value turns it into an input.
- Reps default: "Last week's actual reps, else bottom of prescribed range."
- Architecture: "A" — mirror the existing `weights` pattern rather than introducing a per-set record object.
- Analyzer rep-support is explicitly OUT of scope for this work.

**Spec:** `docs/superpowers/specs/2026-07-23-out-of-order-logging-and-reps-design.md`

---

## Working Constraints (read before touching the repo)

- `data/` holds the user's **real** training log. Read it if needed; **never write to it**. It is gitignored.
- **Never** run `git stash`, `git checkout --`, `git reset`, or `git clean` — the working tree is shared.
- Commit with an explicit pathspec: `git commit -m "..." -- path/one path/two`. **Never** `git add -A`, `git commit -a`, or a bare `git commit`.
- **Do not push.** The user pushes.
- Verify with the headless toolchain; there is no browser in this environment.

**Extract-and-check command** (used as a verify step throughout — `$CLAUDE_JOB_DIR/tmp` avoids clobbering parallel jobs):

```bash
sed -n "$(grep -n '<script>' index.html|cut -d: -f1),$(grep -n '</script>' index.html|cut -d: -f1)p" index.html | sed '1d;$d' > "${CLAUDE_JOB_DIR:-/tmp}/tmp/gains-app.js" && node --check "${CLAUDE_JOB_DIR:-/tmp}/tmp/gains-app.js"
```

**Full suite command** (note the glob — `node --test tools/` fails on Node 24):

```bash
node --test tools/*.test.js
```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `index.html` | Modify | The entire app. All feature code lands here — CSS block (~line 141–205), `view` init (~2966), `initState` (2214), `getExerciseHistory` (2265), `activeSet` (3090), `logActiveSet` (3106), `skipSet` (2495), `exercisesHTML` (3149), `syncPending` (3363), `renderBottomBar` (3373), delegated click handler (3530). |
| `tools/app-shim.js` | Modify | Expose additional app bindings (`activeSet`, `logActiveSet`, `skipSet`, `curDay`, `commitEdit`) so tests can assert on behavior directly rather than scraping markup; add `select()` to the element stub. |
| `tools/select-exercise.test.js` | Create | Tests for out-of-order selection: redirecting the active set, toggling, clearing on completion/nav, swap interaction. |
| `tools/reps.test.js` | Create | Tests for the reps data model, prefill, stepper, inline entry, and export/import round-trip. |

`index.html` is a large single file by explicit design (`CLAUDE.md`: "Single file by design — don't split into separate files unless explicitly asked"). Do **not** restructure it.

---

### Task 1: Expose app internals to the test shim

**Goal:** Tests can call `activeSet()`, `logActiveSet()`, `skipSet()`, `curDay()`, `getExerciseHistory()`, and `commitEdit()` directly instead of inferring behavior from rendered HTML.

**Files:**
- Modify: `tools/app-shim.js:180-192` (the `eval` tail that builds the returned API), `tools/app-shim.js:50-66` (`makeElement`)
- Test: `tools/app-shim.test.js`

**Acceptance Criteria:**
- [ ] `withApp({}, app => …)` exposes `activeSet`, `logActiveSet`, `skipSet`, `curDay`, `getExerciseHistory` as functions.
- [ ] `commitEdit` is exposed (it does not exist yet — Task 7 adds it; until then the binding is `undefined`, which must not throw at eval time).
- [ ] The shim's element stub answers `select()` without throwing.
- [ ] Existing tests still pass unchanged.

**Verify:** `node --test tools/*.test.js` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `tools/app-shim.test.js`:

```js
test('the shim exposes the day-logging internals tests need', () => {
  withApp({}, app => {
    for (const name of ['activeSet', 'logActiveSet', 'skipSet', 'curDay', 'getExerciseHistory']) {
      assert.strictEqual(typeof app[name], 'function', `${name} not exposed`);
    }
    // curDay() must return a real day from the active program.
    const day = app.curDay();
    assert.ok(app.DAYS.some(d => d.id === day.id));
    // activeSet() on a fresh state points at the first exercise, first set.
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, day.exercises[0].id);
    assert.strictEqual(act.i, 0);
  });
});

test('the element stub supports select() for inline inputs', () => {
  withApp({}, app => {
    const el = app.elements.get('bottombar') || { select: null };
    assert.doesNotThrow(() => { if (el.select) el.select(); });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/app-shim.test.js`
Expected: FAIL — `activeSet not exposed`.

- [ ] **Step 3: Add `select()` to the element stub**

In `tools/app-shim.js`, inside `makeElement`, extend the method line that already carries `focus`/`blur`:

```js
    closest: () => null, focus() {}, blur() {}, select() {}, click() {}, scrollTo() {},
```

- [ ] **Step 4: Extend the eval tail**

In `tools/app-shim.js`, replace the `api = eval(...)` argument's first appended line:

```js
      '\n;({ PROGRAMS, EXERCISE_ALTERNATIVES, currentWeek, state, view,' +
      ' render, switchProgram, boot,' +
```

with:

```js
      '\n;({ PROGRAMS, EXERCISE_ALTERNATIVES, currentWeek, state, view,' +
      ' render, switchProgram, boot, activeSet, logActiveSet, skipSet, curDay,' +
      ' getExerciseHistory,' +
      ' get commitEdit() { return typeof commitEdit === "function" ? commitEdit : undefined; },' +
```

`activeSet`/`logActiveSet`/`skipSet`/`curDay`/`getExerciseHistory` are hoisted function declarations in the app script, so naming them directly works. `commitEdit` does not exist until Task 7 — referencing an undeclared identifier directly would throw a `ReferenceError` at eval time, so it goes behind a `typeof` guard in a getter.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/app-shim.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite for regressions**

Run: `node --test tools/*.test.js`
Expected: all pass (127 existing + the 2 new).

- [ ] **Step 7: Commit**

```bash
git commit -m "test: expose day-logging internals through the app shim" -- tools/app-shim.js tools/app-shim.test.js
```

---

### Task 2: Selection state and `activeSet()` preference

**Goal:** `view.selectedExId` biases which set is active, and a `selectex` click toggles it.

**Files:**
- Modify: `index.html:2966` (`view` init), `index.html:3090` (`activeSet`), `index.html:3530-3536` (click handler)
- Test: `tools/select-exercise.test.js` (create)

**Acceptance Criteria:**
- [ ] `view.selectedExId` defaults to `null`.
- [ ] With a selection set to an exercise that has incomplete sets, `activeSet(day)` returns that exercise's first incomplete set — not the plan-order first.
- [ ] With no selection, `activeSet(day)` behaves exactly as before.
- [ ] A selection naming a fully-completed exercise falls through to plan order (it does not return `null` or throw).
- [ ] A selection naming an exercise not on the current day falls through to plan order.
- [ ] `activeSet()` never mutates `view` — calling it twice in a row leaves `view.selectedExId` unchanged.
- [ ] Clicking `selectex` sets the selection and clears `view.pendKey`; clicking the same id again clears the selection.
- [ ] Day / week / program / swap actions clear `view.selectedExId`.

**Verify:** `node --test tools/select-exercise.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tools/select-exercise.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp } = require('./app-shim');

// Fires a click through the app's real delegated `data-act` dispatcher.
function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

test('view starts with no exercise selected', () => {
  withApp({}, app => {
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('a selection redirects the active set to that exercise', () => {
  withApp({}, app => {
    const day = app.curDay();
    const third = day.exercises[2].id;
    app.view.selectedExId = third;
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, third);
    assert.strictEqual(act.i, 0);
  });
});

test('activeSet is pure — it never clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.view.selectedExId = day.exercises[1].id;
    app.activeSet(day);
    app.activeSet(day);
    assert.strictEqual(app.view.selectedExId, day.exercises[1].id);
  });
});

test('a fully-completed selection falls through to plan order', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    // Mark every set of the selected exercise done.
    app.state[day.id].sets[orig.id] = app.state[day.id].sets[orig.id].map(() => true);
    app.view.selectedExId = orig.id;
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, day.exercises[0].id);
  });
});

test('a selection naming an off-day exercise falls through to plan order', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.view.selectedExId = 'not_an_exercise_on_this_day';
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, day.exercises[0].id);
  });
});

test('selectex sets, then toggles off, the selection', () => {
  withApp({}, app => {
    const id = app.curDay().exercises[2].id;
    click(app, { act: 'selectex', ex: id });
    assert.strictEqual(app.view.selectedExId, id);
    assert.strictEqual(app.view.pendKey, '');
    click(app, { act: 'selectex', ex: id });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('selecting a different exercise replaces the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    click(app, { act: 'selectex', ex: day.exercises[1].id });
    click(app, { act: 'selectex', ex: day.exercises[2].id });
    assert.strictEqual(app.view.selectedExId, day.exercises[2].id);
  });
});

test('changing day clears the selection', () => {
  withApp({}, app => {
    click(app, { act: 'selectex', ex: app.curDay().exercises[1].id });
    click(app, { act: 'day', id: app.DAYS[1].id });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('changing week clears the selection', () => {
  withApp({}, app => {
    click(app, { act: 'selectex', ex: app.curDay().exercises[1].id });
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('switching program clears the selection', () => {
  withApp({}, app => {
    click(app, { act: 'selectex', ex: app.curDay().exercises[1].id });
    click(app, { act: 'prog', i: '1' });
    assert.strictEqual(app.view.selectedExId, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/select-exercise.test.js`
Expected: FAIL — `view.selectedExId` is `undefined`, not `null`.

- [ ] **Step 3: Add the state field**

In `index.html`, in the `view` object literal (~line 2966), add `selectedExId: null` to the line carrying `pendW`:

```js
               pendW: 0, pendKey: '', latestPr: null, selectedExId: null,
```

- [ ] **Step 4: Add the selection preference to `activeSet()`**

Replace `activeSet` (line 3090) with:

```js
// A selected exercise wins over plan order, so sets can be logged in any
// order. Stays PURE — it runs during render, so it must never write to
// `view`; the handlers that complete an exercise clear the selection instead.
function activeSet(day) {
  if (view.selectedExId) {
    const sel = day.exercises.find(o => o.id === view.selectedExId);
    if (sel) {
      const ex = resolveExercise(day.id, sel);
      const arr = state[day.id].sets[ex.id] || [];
      const i = arr.findIndex(v => v === false);
      if (i !== -1) return { ex, orig: sel, i };
    }
  }
  for (const o of day.exercises) {
    const ex = resolveExercise(day.id, o);
    const arr = state[day.id].sets[ex.id] || [];
    const i = arr.findIndex(v => v === false);
    if (i !== -1) return { ex, orig: o, i };
  }
  return null;
}
```

- [ ] **Step 5: Add the handler and the clears**

In the delegated click handler, add the `selectex` branch next to the other day-view branches (immediately after the `act === 'skipex'` line, ~3549):

```js
  else if (act === 'selectex') {
    const id = el.dataset.ex;
    view.selectedExId = view.selectedExId === id ? null : id;
    view.pendKey = '';
  }
```

Then add `view.selectedExId = null;` to the four navigation branches that already clear `view.pendKey`:

```js
  if (act === 'prog')     { switchProgram(Number(el.dataset.i)); view.dayId = getStartDay(); view.pendKey = ''; view.selectedExId = null; view.latestPr = null; }
  else if (act === 'wk')  { changeWeek(Number(el.dataset.d)); view.dayId = getStartDay(); view.pendKey = ''; view.selectedExId = null; view.latestPr = null; view.restEnd = null; }
  else if (act === 'day') { view.name = 'day'; view.dayId = el.dataset.id; view.pendKey = ''; view.selectedExId = null; }
```

and the swap branch (~3570):

```js
  else if (act === 'doswap')  { performSwap(view.swap.dayId, el.dataset.orig, el.dataset.new); view.swap = null; view.pendKey = ''; view.selectedExId = null; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/select-exercise.test.js`
Expected: PASS (10 tests).

- [ ] **Step 7: Syntax + smoke check**

Run the extract-and-check command from the header, then:

```bash
node -e "const {smokeRender}=require('./tools/smoke-render');const {loadApp}=require('./tools/app-shim');for(let i=0;i<loadApp().PROGRAMS.length;i++){const r=smokeRender(undefined,i);if(!r.ok)throw new Error('program '+i+': '+r.error)}console.log('smoke ok')"
```

Expected: `smoke ok`.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: allow selecting which exercise the active set targets" -- index.html tools/select-exercise.test.js
```

---

### Task 3: Clear the selection when the selected exercise completes

**Goal:** Logging or skipping the selected exercise's last remaining set releases the selection, so the app falls back to plan order.

**Files:**
- Modify: `index.html:2495` (`skipSet`), `index.html:3106` (`logActiveSet`), plus a new `hasPendingSet` helper beside `activeSet`
- Test: `tools/select-exercise.test.js`

**Acceptance Criteria:**
- [ ] Logging the last incomplete set of the selected exercise clears `view.selectedExId`.
- [ ] Logging a non-final set of the selected exercise **keeps** the selection.
- [ ] Skipping the last incomplete set of the selected exercise clears `view.selectedExId`.
- [ ] Skipping works when the selected exercise has been **swapped** — `skipSet` receives the resolved id while the selection stores the original, and the two must be reconciled.
- [ ] Un-skipping (toggling a skipped set back to pending) does not clear the selection.
- [ ] Completing a **different** exercise never clears the selection.

**Verify:** `node --test tools/select-exercise.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/select-exercise.test.js`:

```js
function click2(app, dataset) {   // local alias so this block is self-contained
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

test('logging a non-final set keeps the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    click2(app, { act: 'selectex', ex: orig.id });
    click2(app, { act: 'log' });
    assert.strictEqual(app.view.selectedExId, orig.id);
    assert.strictEqual(app.state[day.id].sets[orig.id][0], true);
  });
});

test('logging the final set clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click2(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click2(app, { act: 'log' });
    assert.strictEqual(app.view.selectedExId, null);
    assert.ok(app.state[day.id].sets[orig.id].every(v => v === true));
  });
});

test('skipping the final set clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click2(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click2(app, { act: 'skipset', ex: orig.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('un-skipping a set keeps the exercise selectable and selected', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click2(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click2(app, { act: 'skipset', ex: orig.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
    click2(app, { act: 'selectex', ex: orig.id });
    click2(app, { act: 'skipset', ex: orig.id, i: '0' });   // toggles back to pending
    assert.strictEqual(app.state[day.id].sets[orig.id][0], false);
    assert.strictEqual(app.view.selectedExId, orig.id);
  });
});

test('skipping the final set of a SWAPPED selected exercise clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    // Find an exercise on this day that has swap alternatives.
    const orig = day.exercises.find(o => (app.EXERCISE_ALTERNATIVES[o.id] || []).length);
    assert.ok(orig, 'expected at least one swappable exercise on the first day');
    const altId = app.EXERCISE_ALTERNATIVES[orig.id][0].id;
    click2(app, { act: 'swap', orig: orig.id });
    click2(app, { act: 'doswap', orig: orig.id, new: altId });
    // doswap clears the selection, so re-select after swapping.
    click2(app, { act: 'selectex', ex: orig.id });
    const resolvedId = app.state[day.id].swaps[orig.id];
    assert.strictEqual(resolvedId, altId);
    const n = app.state[day.id].sets[altId].length;
    for (let k = 0; k < n; k++) click2(app, { act: 'skipset', ex: altId, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('completing a different exercise leaves the selection alone', () => {
  withApp({}, app => {
    const day = app.curDay();
    const other = day.exercises[0];
    click2(app, { act: 'selectex', ex: day.exercises[2].id });
    const n = app.state[day.id].sets[other.id].length;
    for (let k = 0; k < n; k++) click2(app, { act: 'skipset', ex: other.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, day.exercises[2].id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/select-exercise.test.js`
Expected: FAIL — "logging the final set clears the selection" fails; selection stays set.

- [ ] **Step 3: Add the `hasPendingSet` helper**

In `index.html`, immediately after `activeSet` (which now ends around line 3105), add:

```js
// True when the exercise (given by its ORIGINAL id entry) still has a set
// waiting to be logged. Used to decide when a selection has been used up.
function hasPendingSet(day, orig) {
  const ex = resolveExercise(day.id, orig);
  const arr = state[day.id].sets[ex.id] || [];
  return arr.some(v => v === false);
}
```

- [ ] **Step 4: Clear on log**

In `logActiveSet`, immediately after the existing `view.pendKey = '';` line, add:

```js
  if (view.selectedExId === act.orig.id && !hasPendingSet(day, act.orig)) view.selectedExId = null;
```

`activeSet()` returns `{ ex, orig, i }`, so `act.orig.id` is already the original id — no lookup needed here.

- [ ] **Step 5: Clear on skip**

Replace `skipSet` (line 2495) with:

```js
function skipSet(dayId, exId, setIdx) {
  const current = state[dayId].sets[exId][setIdx];
  if (current === 'skipped') {
    state[dayId].sets[exId][setIdx] = false;
  } else if (current === false) {
    state[dayId].sets[exId][setIdx] = 'skipped';
  }
  saveState();
  // `exId` here is the RESOLVED id, but `view.selectedExId` holds the
  // ORIGINAL — a direct comparison would silently fail for any swapped
  // exercise and strand the selection on a finished lift.
  if (view.selectedExId) {
    const day = DAYS.find(d => d.id === dayId);
    const orig = day && day.exercises.find(o => resolveExercise(dayId, o).id === exId);
    if (orig && orig.id === view.selectedExId && !hasPendingSet(day, orig)) view.selectedExId = null;
  }
  refreshCurrentDay(dayId);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/select-exercise.test.js`
Expected: PASS (16 tests).

- [ ] **Step 7: Syntax + full suite**

Run the extract-and-check command, then `node --test tools/*.test.js`.
Expected: `node --check` silent; all tests pass.

- [ ] **Step 8: Commit**

```bash
git commit -m "fix: release the exercise selection once its last set resolves" -- index.html tools/select-exercise.test.js
```

---

### Task 4: Make exercise cards selectable in the UI

**Goal:** Tapping an exercise card's header selects it, with a visible accent treatment; completed exercises are not selectable.

**Files:**
- Modify: `index.html:141-144` (CSS, `.ex` block), `index.html:3205-3212` (`exercisesHTML` card markup)
- Test: `tools/select-exercise.test.js`

**Acceptance Criteria:**
- [ ] Every incomplete exercise's `.ex-top` carries `data-act="selectex"` with `data-ex` set to its **original** id.
- [ ] A fully-resolved exercise (`done + skipped === ex.sets`) emits **no** `selectex` attribute.
- [ ] The selected card's root element carries the `sel` class.
- [ ] The swap button inside the header still resolves to `data-act="swap"` (nearest-ancestor wins via `closest`).
- [ ] CSS uses only existing custom properties — no hard-coded colors.
- [ ] `smoke-render` passes for every program.

**Verify:** `node --test tools/select-exercise.test.js tools/smoke-render.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/select-exercise.test.js`:

```js
function scrollHTML(app) { return app.elements.get('scroll').innerHTML; }

test('incomplete exercise cards are selectable', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.render();
    const html = scrollHTML(app);
    for (const o of day.exercises) {
      assert.ok(
        html.includes(`data-act="selectex" data-ex="${o.id}"`),
        `missing selectex for ${o.id}`
      );
    }
  });
});

test('a completed exercise is not selectable', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[1];
    app.state[day.id].sets[orig.id] = app.state[day.id].sets[orig.id].map(() => true);
    app.render();
    assert.ok(!scrollHTML(app).includes(`data-act="selectex" data-ex="${orig.id}"`));
  });
});

test('the selected card renders with the sel modifier', () => {
  withApp({}, app => {
    const id = app.curDay().exercises[2].id;
    app.clickHandler({ target: { closest: s => (s === '[data-act]' ? { dataset: { act: 'selectex', ex: id } } : null) } });
    app.render();
    assert.ok(scrollHTML(app).includes('class="ex sel"'));
  });
});

test('the swap button still emits its own act inside a selectable header', () => {
  withApp({}, app => {
    app.render();
    const html = scrollHTML(app);
    assert.ok(html.includes('data-act="swap"'), 'swap button disappeared');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/select-exercise.test.js`
Expected: FAIL — `missing selectex for …`.

- [ ] **Step 3: Add the CSS**

In `index.html`, immediately after the `.ex-name.done` rule (line 144), insert:

```css
.ex.sel { box-shadow: inset 3px 0 0 var(--accent); background: var(--surface); }
.ex.sel .ex-name { color: var(--accent); }
.ex-top.pick { cursor: pointer; }
```

All three use existing custom properties, so both themes are covered without touching the `:root` blocks.

- [ ] **Step 4: Update the card markup**

In `exercisesHTML`, replace the returned card opening (lines ~3205-3212):

```js
    return `<div class="ex">
      <div class="ex-top">
        <div class="ex-name${allDone ? ' done' : ''}">${String(xi + 1).padStart(2, '0')} ${esc(ex.name)}</div>
```

with:

```js
    const isSel = view.selectedExId === orig.id;
    // A finished exercise can't become the active set, so don't offer it.
    const pick = allDone ? '' : ` class="ex-top pick" data-act="selectex" data-ex="${orig.id}"`;
    return `<div class="ex${isSel ? ' sel' : ''}">
      <div${pick || ' class="ex-top"'}>
        <div class="ex-name${allDone ? ' done' : ''}">${String(xi + 1).padStart(2, '0')} ${esc(ex.name)}</div>
```

The swap `<button>` inside this header keeps its own `data-act="swap"`; the delegated handler uses `closest('[data-act]')`, so the nearest ancestor — the button — wins. Do not flatten that nesting.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tools/select-exercise.test.js`
Expected: PASS (20 tests).

- [ ] **Step 6: Syntax + smoke check**

Run the extract-and-check command, then `node --test tools/smoke-render.test.js`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: tap an exercise card to target it for logging" -- index.html tools/select-exercise.test.js
```

---

### Task 5: Reps storage, history, and display

**Goal:** A `state[dayId].reps` map exists, persists, survives export/import, flows through `getExerciseHistory`, and renders in set rows.

**Files:**
- Modify: `index.html:2214-2226` (`initState`), `index.html:2265-2286` (`getExerciseHistory`), `index.html:3180-3195` (set-row markup in `exercisesHTML`)
- Test: `tools/reps.test.js` (create)

**Acceptance Criteria:**
- [ ] `state[dayId].reps` is an object for every day on a fresh install.
- [ ] Existing saved state without a `reps` key loads without error and yields `{}`.
- [ ] Saved `reps` round-trips through `saveState`/`loadState`.
- [ ] `getExerciseHistory` entries carry `reps` (exercise-level) and `setReps` (per-set index map).
- [ ] `setReps` keys are matched only on an all-digits suffix, so `m3_squat_0` is credited to `m3_squat` but `m3_squat_pause_0` is **not**.
- [ ] A week with reps but no weight and no effort is no longer dropped by `getExerciseHistory`.
- [ ] A completed set with recorded reps renders as `<weight> × <reps> ●`; without reps it renders as today, `<weight> ●`.
- [ ] The LAST column shows `<weight> × <reps>` when the prior week recorded reps, else just the weight.

**Verify:** `node --test tools/reps.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tools/reps.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

// Build a week-1 storage blob for the first day of meso1 with weights+reps
// already logged, so history-reading paths have something to read.
function seededStorage() {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: ex.sets ? new Array(ex.sets).fill(true) : [true] },
      weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
      reps: { [ex.id]: 9, [`${ex.id}_0`]: 11, [`${ex.id}_1`]: 9 },
      effort: {}, protocol: [], swaps: {},
    },
  };
  return {
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '2',
      hypertrophy_program: '0',
    },
    progId: prog.id, dayId: day.id, exId: ex.id,
  };
}

test('every day gets a reps map on a fresh install', () => {
  withApp({}, app => {
    for (const day of app.DAYS) {
      assert.strictEqual(typeof app.state[day.id].reps, 'object');
      assert.ok(app.state[day.id].reps !== null);
    }
  });
});

test('state saved without a reps key still loads', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const legacy = { [day.id]: { sets: { [day.exercises[0].id]: [true] }, weights: {}, effort: {}, protocol: [], swaps: {} } };
  withApp({ storage: {
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(legacy),
    hypertrophy_program: '0',
  } }, app => {
    assert.deepStrictEqual(app.state[day.id].reps, {});
  });
});

test('reps survive a save/load round trip', () => {
  const s = seededStorage();
  withApp({ storage: { ...s.storage, [`hypertrophy_week_${s.progId}`]: '1' } }, app => {
    assert.strictEqual(app.state[s.dayId].reps[s.exId], 9);
    assert.strictEqual(app.state[s.dayId].reps[`${s.exId}_0`], 11);
  });
});

test('history entries carry reps and per-set reps', () => {
  const s = seededStorage();            // current week is 2, week 1 has history
  withApp({ storage: s.storage }, app => {
    const hist = app.getExerciseHistory(s.dayId, s.exId);
    const w1 = hist.find(h => h.week === 1);
    assert.ok(w1, 'week 1 missing from history');
    assert.strictEqual(w1.reps, 9, 'exercise-level reps');
    assert.strictEqual(w1.setReps['0'], 11, 'per-set reps for set 0');
    assert.strictEqual(w1.setReps['1'], 9, 'per-set reps for set 1');
  });
});

test('a week with reps but no weight and no effort is not dropped', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = { [day.id]: {
    sets: { [ex.id]: new Array(ex.sets).fill(true) },
    weights: {}, reps: { [ex.id]: 10 }, effort: {}, protocol: [], swaps: {},
  } };
  withApp({ storage: {
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
    [`hypertrophy_week_${prog.id}`]: '2',
    hypertrophy_program: '0',
  } }, app => {
    const hist = app.getExerciseHistory(day.id, ex.id);
    assert.ok(hist.some(h => h.week === 1 && h.reps === 10), 'reps-only week was dropped');
  });
});

test('per-set rep keys are matched on a digits-only suffix', () => {
  // A bare startsWith(exId + '_') would read 'sq_pause_0' as set "pause_0" of
  // 'sq', mixing two different exercises' reps together.
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = { [day.id]: {
    sets: { [ex.id]: new Array(ex.sets).fill(true) },
    weights: { [ex.id]: 100 },
    reps: { [ex.id]: 8, [`${ex.id}_0`]: 10, [`${ex.id}_pause`]: 6, [`${ex.id}_pause_0`]: 5 },
    effort: {}, protocol: [], swaps: {},
  } };
  withApp({ storage: {
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
    [`hypertrophy_week_${prog.id}`]: '2',
    hypertrophy_program: '0',
  } }, app => {
    const w = app.getExerciseHistory(day.id, ex.id).find(h => h.week === 1);
    assert.deepStrictEqual(Object.keys(w.setReps).sort(), ['0'],
      'only the digits-only suffix belongs to this exercise');
    assert.strictEqual(w.setReps['0'], 10);
  });
});

test('a logged set renders weight x reps when reps were recorded', () => {
  const s = seededStorage();
  withApp({ storage: { ...s.storage, [`hypertrophy_week_${s.progId}`]: '1' } }, app => {
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.ok(html.includes('100 × 11 ●'), `expected "100 × 11 ●" in rendered rows`);
  });
});

test('a logged set without reps renders weight only', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = { [day.id]: {
    sets: { [ex.id]: new Array(ex.sets).fill(false).map((v, i) => (i === 0 ? true : v)) },
    weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
    effort: {}, protocol: [], swaps: {},
  } };
  withApp({ storage: {
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
    [`hypertrophy_week_${prog.id}`]: '1',
    hypertrophy_program: '0',
  } }, app => {
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.ok(html.includes('100 ●'), 'expected weight-only cell');
    assert.ok(!html.includes('100 × '), 'must not invent a reps value');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/reps.test.js`
Expected: FAIL — `state[dayId].reps` is `undefined`.

- [ ] **Step 3: Add `reps` to `initState`**

In `index.html`, in `initState` (line 2220), add the field:

```js
    state[day.id] = {
      sets: {},
      weights: savedDay.weights || {},
      reps: savedDay.reps || {},
      effort: savedDay.effort || {},
      protocol: savedDay.protocol || [],
      swaps: savedDay.swaps || {}
    };
```

`saveState()` serializes the whole `state` object and `exportData`/`importData` copy whole day blobs, so persistence and export/import need no further change.

- [ ] **Step 4: Carry reps through `getExerciseHistory`**

Replace the tail of `getExerciseHistory` (lines 2279-2284):

```js
    const rawW = (dayState.weights || {})[exId];
    const weight = (rawW === '' || rawW == null) ? null : Number(rawW);
    const eff = (dayState.effort || {})[exId] || '';
    if (weight == null && !eff) continue;
    out.push({ week: w, weight, effort: eff });
```

with:

```js
    const rawW = (dayState.weights || {})[exId];
    const weight = (rawW === '' || rawW == null) ? null : Number(rawW);
    const rawR = (dayState.reps || {})[exId];
    const reps = (rawR === '' || rawR == null) ? null : Number(rawR);
    const eff = (dayState.effort || {})[exId] || '';
    // Per-set reps, keyed by set index. The suffix must be all digits:
    // a bare `startsWith(exId + '_')` would credit `m3_squat_pause_0` to
    // `m3_squat`, silently mixing two different exercises' reps.
    const setReps = {};
    const repsMap = dayState.reps || {};
    Object.keys(repsMap).forEach(k => {
      if (!k.startsWith(exId + '_')) return;
      const suffix = k.slice(exId.length + 1);
      if (/^\d+$/.test(suffix)) setReps[suffix] = Number(repsMap[k]);
    });
    if (weight == null && reps == null && !eff) continue;
    out.push({ week: w, weight, reps, effort: eff, setReps });
```

- [ ] **Step 5: Render reps in the set rows**

In `exercisesHTML`, add a reps lookup beside the existing weight lookup and use it in both the today cell and the LAST column. Replace lines ~3159 and ~3180-3195.

First, beside `const curW = state[day.id].weights[ex.id];` (line 3159) add:

```js
    const curR = state[day.id].reps[ex.id];
```

Then replace the row builder:

```js
    const rows = arr.map((v, i) => {
      const isActive = i === activeI;
      const setW = state[day.id].weights[`${ex.id}_${i}`];
      const shown = setW != null ? setW : (curW != null ? curW : '');
      const setR = state[day.id].reps[`${ex.id}_${i}`];
      const shownR = setR != null ? setR : (curR != null ? curR : '');
      const doneTxt = shownR !== '' ? `${esc(shown)} × ${esc(shownR)}` : `${esc(shown)}`;
      let cell;
      if (isActive) cell = `<button class="log-btn" data-act="log">LOG</button>`;
      else if (v === true) cell = `<span class="t-done" data-act="undo" data-ex="${ex.id}" data-i="${i}">${doneTxt} ●</span>`;
      else if (v === 'skipped') cell = `<span class="t-skip" data-act="skipset" data-ex="${ex.id}" data-i="${i}">SKIP</span>`;
      else cell = `<span class="t-pend" data-act="skipset" data-ex="${ex.id}" data-i="${i}">skip →</span>`;
      const reps = ex.reps + (ex.llp && i === arr.length - 1 && !/LLP/.test(ex.reps) ? ' +LLP' : '');
      const priorSetR = prior && prior.setReps ? prior.setReps[i] : undefined;
      const priorR = priorSetR != null ? priorSetR : (prior && prior.reps != null ? prior.reps : null);
      const lastTxt = prior && prior.weight != null
        ? (priorR != null ? `${esc(prior.weight)} × ${esc(priorR)}` : `${esc(prior.weight)}`)
        : '—';
      return `<div class="grid-r${isActive ? ' active' : ''}${v === true ? ' done' : ''}">
        <span class="n">${i + 1}</span>
        <span class="last">${lastTxt}</span>
        <span>${esc(reps)}</span>
        <div class="cell-today">${cell}</div></div>`;
    }).join('');
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/reps.test.js`
Expected: PASS (8 tests).

- [ ] **Step 7: Syntax + full suite**

Run the extract-and-check command, then `node --test tools/*.test.js`.
Expected: all pass. `analyze-history` tests in particular must be unaffected — the analyzer ignores `reps` by design.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: store and display actual reps performed per set" -- index.html tools/reps.test.js
```

---

### Task 6: Reps prefill and the reps stepper

**Goal:** The bottom bar shows a reps value beside the weight, prefilled from last week (else the low end of the prescribed range), adjustable with ±1, and written on log.

**Files:**
- Modify: `index.html:2966` (`view` init), `index.html:190-205` (CSS, `.log-ctl`/`.stepper`), `index.html:3106` (`logActiveSet`), `index.html:3363-3371` (`syncPending`), `index.html:3396-3409` (bottom-bar markup), click handler (`r-`/`r+`)
- Test: `tools/reps.test.js`

**Acceptance Criteria:**
- [ ] `view.pendR` exists and is prefilled by `syncPending`.
- [ ] Prefill order: prior week's reps for the **same set index** → prior week's exercise-level reps → first integer in `ex.reps` → `''`.
- [ ] `lowRep('6–10')` → `6`; `lowRep('12–15')` → `12`; `lowRep('10 each leg')` → `10`; `lowRep('8–12 each leg')` → `8`; `lowRep('15 + LLP')` → `15`; `lowRep('')` → `''`.
- [ ] `r+` increments by 1; `r-` decrements by 1 and clamps at 0.
- [ ] `logActiveSet` writes `reps[exId]` and `reps[exId_i]` when `pendR` is a number.
- [ ] `logActiveSet` writes **no** reps keys when `pendR` is `''`.
- [ ] The bottom bar renders two steppers on one row and a full-width LOG SET button below them.
- [ ] PR detection is unchanged — still weight-only.

**Verify:** `node --test tools/reps.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/reps.test.js`:

```js
test('reps prefill uses the low end of the prescribed range with no history', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.render();                       // renderBottomBar calls syncPending
    const first = day.exercises[0];
    const low = parseInt(/\d+/.exec(String(first.reps))[0], 10);
    assert.strictEqual(Number(app.view.pendR), low);
  });
});

test('reps prefill prefers last week reps for the same set index', () => {
  const s = seededStorage();            // w1 has reps {ex:9, ex_0:11, ex_1:9}
  withApp({ storage: s.storage }, app => {
    app.render();                       // current week is 2
    assert.strictEqual(Number(app.view.pendR), 11, 'set 0 should prefill from last week set 0');
  });
});

test('the reps stepper adjusts by one and clamps at zero', () => {
  withApp({}, app => {
    app.render();
    app.view.pendR = 2;
    click(app, { act: 'r-' });
    assert.strictEqual(app.view.pendR, 1);
    click(app, { act: 'r-' });
    click(app, { act: 'r-' });
    assert.strictEqual(app.view.pendR, 0);
    click(app, { act: 'r+' });
    assert.strictEqual(app.view.pendR, 1);
  });
});

test('logging writes reps at both the exercise and per-set keys', () => {
  withApp({}, app => {
    const day = app.curDay();
    const ex = day.exercises[0];
    app.render();
    app.view.pendR = 12;
    app.view.pendW = 95;
    click(app, { act: 'log' });
    assert.strictEqual(app.state[day.id].reps[ex.id], 12);
    assert.strictEqual(app.state[day.id].reps[`${ex.id}_0`], 12);
    assert.strictEqual(app.state[day.id].weights[`${ex.id}_0`], 95);
  });
});

test('logging with an empty reps value records no reps', () => {
  withApp({}, app => {
    const day = app.curDay();
    const ex = day.exercises[0];
    app.render();
    app.view.pendR = '';
    click(app, { act: 'log' });
    assert.strictEqual(app.state[day.id].sets[ex.id][0], true, 'the set must still log');
    assert.strictEqual(app.state[day.id].reps[ex.id], undefined);
    assert.strictEqual(app.state[day.id].reps[`${ex.id}_0`], undefined);
  });
});

test('the bottom bar renders both steppers', () => {
  withApp({}, app => {
    app.render();
    const bar = app.elements.get('bottombar').innerHTML;
    assert.ok(bar.includes('data-act="w+"'), 'weight stepper missing');
    assert.ok(bar.includes('data-act="r+"'), 'reps stepper missing');
    assert.ok(bar.includes('data-act="log"'), 'LOG SET missing');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/reps.test.js`
Expected: FAIL — `view.pendR` is `undefined`.

- [ ] **Step 3: Add the state field**

In the `view` object literal, extend the `pendW` line:

```js
               pendW: 0, pendR: '', pendKey: '', latestPr: null, selectedExId: null,
```

- [ ] **Step 4: Add the `lowRep` helper and extend `syncPending`**

Replace `syncPending` (line 3363) with:

```js
// The bottom of a prescribed range: the FIRST integer in the reps string.
// Those strings vary a lot across programs — "6–10", "12–15", "10 each leg",
// "8–12 each leg", "15 + LLP" — and the first integer is the right answer for
// all of them (low end of a range, or the per-leg count), never an inflated one.
function lowRep(repsStr) {
  const m = /\d+/.exec(String(repsStr == null ? '' : repsStr));
  return m ? Number(m[0]) : '';
}

function syncPending(day, act) {
  const key = `${curProg().id}:${currentWeek}:${day.id}:${act.ex.id}:${act.i}`;
  if (view.pendKey === key) return;
  view.pendKey = key;
  const stored = state[day.id].weights[act.ex.id];
  const prev = act.i > 0 ? state[day.id].weights[`${act.ex.id}_${act.i - 1}`] : null;
  const prior = priorWeekEntry(day.id, act.ex.id);
  view.pendW = Number(prev != null ? prev : stored != null ? stored : (prior && prior.weight) || 0) || 0;

  // Reps deliberately do NOT carry from the previous set the way weight does:
  // reps drop set to set as fatigue accumulates, so set 1's number is a bad
  // guess for set 3. Last week's number at the same set index is the anchor.
  const priorSetR = prior && prior.setReps ? prior.setReps[act.i] : undefined;
  view.pendR = priorSetR != null ? priorSetR
    : (prior && prior.reps != null ? prior.reps : lowRep(act.ex.reps));
}
```

- [ ] **Step 5: Write reps in `logActiveSet`**

In `logActiveSet`, change the destructure line:

```js
  const { ex, i } = act, w = view.pendW;
```

to:

```js
  const { ex, i } = act, w = view.pendW, r = view.pendR;
```

and add, immediately after the two existing `state[day.id].weights[...] = w;` lines and **before** `saveState()`:

```js
  // Blank/invalid reps record nothing at all, so "not recorded" stays a single
  // unambiguous state — exactly how every set logged before this feature reads.
  const rn = (r === '' || r == null) ? NaN : Number(r);
  if (!isNaN(rn)) {
    state[day.id].reps[ex.id] = rn;
    state[day.id].reps[`${ex.id}_${i}`] = rn;
  }
```

PR detection below this point is untouched — it stays weight-only.

- [ ] **Step 6: Add the stepper handlers**

In the delegated click handler, immediately after the `w+` branch:

```js
  else if (act === 'r-') { view.pendR = Math.max(0, (Number(view.pendR) || 0) - 1); }
  else if (act === 'r+') { view.pendR = (Number(view.pendR) || 0) + 1; }
```

- [ ] **Step 7: Update the bottom-bar markup**

Replace the `log-ctl` block (lines ~3402-3409):

```js
      <div class="log-ctl">
        <div class="stepper">
          <button class="step-b" data-act="w-">−</button>
          <div class="step-v"><div>${view.pendW % 1 ? view.pendW.toFixed(1) : view.pendW}</div><div>LB</div></div>
          <button class="step-b" data-act="w+">+</button>
        </div>
        <button class="log-go" data-act="log">LOG SET</button>
      </div></div>`;
```

with:

```js
      <div class="log-ctl">
        <div class="log-steps">
          <div class="stepper">
            <button class="step-b" data-act="w-">−</button>
            <div class="step-v"><div>${view.pendW % 1 ? view.pendW.toFixed(1) : view.pendW}</div><div>LB</div></div>
            <button class="step-b" data-act="w+">+</button>
          </div>
          <div class="stepper">
            <button class="step-b" data-act="r-">−</button>
            <div class="step-v"><div>${view.pendR === '' ? '—' : view.pendR}</div><div>REPS</div></div>
            <button class="step-b" data-act="r+">+</button>
          </div>
        </div>
        <button class="log-go" data-act="log">LOG SET</button>
      </div></div>`;
```

- [ ] **Step 8: Update the CSS for the two-stepper layout**

Two steppers plus a LOG button will not fit on one row on a 360 px phone. Stack them: replace lines 200-206 (`.log-ctl` through `.log-go`) with:

```css
.log-ctl { display: flex; flex-direction: column; gap: 8px; }
.log-steps { display: flex; gap: 10px; }
.stepper { display: flex; align-items: center; justify-content: center; gap: 6px; flex: 1; min-width: 0; }
.step-b { width: 44px; height: 52px; background: var(--bar-btn); border: 1px solid var(--bar-edge); border-radius: 8px; color: var(--on-dark); font-size: 20px; cursor: pointer; flex: none; }
.step-v { text-align: center; min-width: 50px; }
.step-v div:first-child { font-family: var(--font-mono); font-size: 16px; font-weight: 600; }
.step-v div:last-child { font-family: var(--font-mono); font-size: 7px; color: rgba(242,239,232,.4); }
.log-go { width: 100%; background: var(--accent); border: none; border-radius: 8px; color: var(--on-dark); font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: 1px; height: 48px; cursor: pointer; }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test tools/reps.test.js`
Expected: PASS (14 tests).

- [ ] **Step 10: Syntax + full suite + smoke**

Run the extract-and-check command, then `node --test tools/*.test.js`.
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git commit -m "feat: prefill and adjust reps alongside weight in the log bar" -- index.html tools/reps.test.js
```

---

### Task 7: Inline numeric entry for weight and reps

**Goal:** Tapping either value turns it into a numeric input that survives the 500 ms render loop, commits on Enter/blur/change, and cancels on Escape.

**Files:**
- Modify: `index.html:190-206` (CSS, add `.step-in`), `index.html:2966` (`view` init), `index.html:3373` (`renderBottomBar` guard + focus), bottom-bar markup, click handler (top-of-handler clear + `editw`/`editr`), new `commitEdit` + document-level `change`/`keydown`/`focusout` listeners
- Modify: `tools/app-shim.js` — already handled in Task 1 (`commitEdit` getter, `select()`)
- Test: `tools/reps.test.js`

**Acceptance Criteria:**
- [ ] `view.editing` is `null` initially; `editw` sets it to `'w'`, `editr` to `'r'`.
- [ ] The first render after `editing` is set emits `<input id="editfield" …>`; subsequent renders leave the bar's `innerHTML` byte-identical (frozen) while that input is present.
- [ ] Clearing `view.editing` unfreezes the bar.
- [ ] `commitEdit('185')` while editing weight sets `view.pendW` to `185` and clears `view.editing`.
- [ ] `commitEdit('abc')` and `commitEdit('')` leave the pending value unchanged.
- [ ] Negative input clamps to 0; reps commit as integers.
- [ ] `commitEdit` called twice (change + focusout both firing on blur) is a no-op the second time.
- [ ] Any click whose `data-act` is not `editw`/`editr` clears `view.editing` — this covers every overlay and navigation path in one place.
- [ ] Weight input uses `inputmode="decimal"`; reps uses `inputmode="numeric"`.

**Verify:** `node --test tools/reps.test.js` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Append to `tools/reps.test.js`:

```js
test('tapping a value opens an inline field and freezes the bar', () => {
  withApp({}, app => {
    app.render();
    click(app, { act: 'editw' });
    assert.strictEqual(app.view.editing, 'w');
    const bar = app.elements.get('bottombar');
    assert.ok(bar.innerHTML.includes('id="editfield"'), 'input not rendered');
    assert.ok(bar.innerHTML.includes('inputmode="decimal"'), 'wrong inputmode for weight');
    // The 500ms tick must not blow the caret away.
    const frozen = bar.innerHTML;
    app.render();
    app.render();
    assert.strictEqual(bar.innerHTML, frozen, 'bar re-rendered while editing');
  });
});

test('the reps field uses a numeric inputmode', () => {
  withApp({}, app => {
    app.render();
    click(app, { act: 'editr' });
    assert.ok(app.elements.get('bottombar').innerHTML.includes('inputmode="numeric"'));
  });
});

test('committing a typed weight updates pendW and unfreezes the bar', () => {
  withApp({}, app => {
    app.render();
    click(app, { act: 'editw' });
    app.commitEdit('185');
    assert.strictEqual(app.view.pendW, 185);
    assert.strictEqual(app.view.editing, null);
    assert.ok(!app.elements.get('bottombar').innerHTML.includes('id="editfield"'));
  });
});

test('committing a typed reps count updates pendR as an integer', () => {
  withApp({}, app => {
    app.render();
    click(app, { act: 'editr' });
    app.commitEdit('14');
    assert.strictEqual(app.view.pendR, 14);
  });
});

test('invalid or empty input leaves the pending value untouched', () => {
  withApp({}, app => {
    app.render();
    app.view.pendW = 95;
    click(app, { act: 'editw' });
    app.commitEdit('abc');
    assert.strictEqual(app.view.pendW, 95);
    click(app, { act: 'editw' });
    app.commitEdit('   ');
    assert.strictEqual(app.view.pendW, 95);
  });
});

test('negative input clamps to zero', () => {
  withApp({}, app => {
    app.render();
    click(app, { act: 'editw' });
    app.commitEdit('-40');
    assert.strictEqual(app.view.pendW, 0);
  });
});

test('a second commit on the same edit is a no-op', () => {
  withApp({}, app => {
    app.render();
    app.view.pendW = 95;
    click(app, { act: 'editw' });
    app.commitEdit('185');
    app.commitEdit('999');           // focusout after change — must not apply
    assert.strictEqual(app.view.pendW, 185);
  });
});

test('any other action closes the editor', () => {
  for (const dataset of [{ act: 'tip', t: 'RPE' }, { act: 'view', v: 'plan' }, { act: 'log' }]) {
    withApp({}, app => {
      app.render();
      click(app, { act: 'editw' });
      assert.strictEqual(app.view.editing, 'w');
      click(app, dataset);
      assert.strictEqual(app.view.editing, null, `editing survived ${dataset.act}`);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/reps.test.js`
Expected: FAIL — `view.editing` is `undefined`.

- [ ] **Step 3: Add the state field**

Extend the `view` literal line once more:

```js
               pendW: 0, pendR: '', pendKey: '', latestPr: null, selectedExId: null, editing: null,
```

- [ ] **Step 4: Add the freeze guard and focus to `renderBottomBar`**

Change the head of `renderBottomBar` (line 3373):

```js
function renderBottomBar() {
  const el = document.getElementById('bottombar');
  if (view.name !== 'day') { el.innerHTML = ''; return; }
```

to:

```js
function renderBottomBar() {
  const el = document.getElementById('bottombar');
  // A 500ms interval re-renders this whole bar. Once the inline field is on
  // screen, leave the DOM alone or the caret and any partially-typed value
  // die twice a second. Checking the markup (not getElementById) keeps this
  // correct under the headless test shim, whose getElementById never returns
  // null. Only the rest pill's DISPLAY pauses; the timer is timestamp-based.
  if (view.editing && el.innerHTML.includes('id="editfield"')) return;
  if (view.name !== 'day') { el.innerHTML = ''; return; }
```

and at the very end of the function, after `el.innerHTML = \`<div class="bar">${pill}${body}</div>\`;`, add:

```js
  if (view.editing) {
    const f = document.getElementById('editfield');
    if (f) { f.focus(); if (f.select) f.select(); }
  }
```

- [ ] **Step 5: Make the values tappable**

In the bottom-bar markup from Task 6, replace the two `step-v` divs with editable versions:

```js
            <div class="step-v" data-act="editw">${view.editing === 'w'
              ? `<input id="editfield" class="step-in" type="text" inputmode="decimal" value="${esc(view.pendW)}">`
              : `<div>${view.pendW % 1 ? view.pendW.toFixed(1) : view.pendW}</div>`}<div>LB</div></div>
```

and

```js
            <div class="step-v" data-act="editr">${view.editing === 'r'
              ? `<input id="editfield" class="step-in" type="text" inputmode="numeric" value="${esc(view.pendR)}">`
              : `<div>${view.pendR === '' ? '—' : view.pendR}</div>`}<div>REPS</div></div>
```

- [ ] **Step 6: Add `commitEdit` and the input listeners**

Immediately after `syncPending` in `index.html`, add:

```js
// Commit an inline numeric edit. Guarded on `view.editing` because a blur
// fires BOTH `change` and `focusout`, so this runs twice for one edit — the
// second call must do nothing rather than re-apply a stale field value.
function commitEdit(raw) {
  if (!view.editing) return;
  const field = view.editing;
  view.editing = null;
  const s = String(raw == null ? '' : raw).trim();
  if (s !== '') {
    if (field === 'w') {
      const n = parseFloat(s);
      if (!isNaN(n)) view.pendW = Math.max(0, n);
    } else {
      const n = parseInt(s, 10);
      if (!isNaN(n)) view.pendR = Math.max(0, n);
    }
  }
  render();
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'editfield') commitEdit(e.target.value);
});
document.addEventListener('focusout', e => {
  if (e.target && e.target.id === 'editfield') commitEdit(e.target.value);
});
document.addEventListener('keydown', e => {
  if (!view.editing || !e.target || e.target.id !== 'editfield') return;
  if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.target.value); }
  else if (e.key === 'Escape') { view.editing = null; render(); }
});
```

- [ ] **Step 7: Add the handler branches and the blanket clear**

At the top of the delegated click handler, right after `const act = el.dataset.act;`, add:

```js
  // One place to close the inline editor. Doing it per-branch would eventually
  // miss one and leave the bar frozen behind an overlay showing a stale set.
  if (act !== 'editw' && act !== 'editr') view.editing = null;
```

and add the two branches next to `w-`/`w+`/`r-`/`r+`:

```js
  else if (act === 'editw') { view.editing = 'w'; }
  else if (act === 'editr') { view.editing = 'r'; }
```

- [ ] **Step 8: Add the input CSS**

After the `.step-v div:last-child` rule, add:

```css
.step-in { width: 100%; box-sizing: border-box; background: var(--bar-btn); border: 1px solid var(--accent); border-radius: 6px; color: var(--on-dark); font-family: var(--font-mono); font-size: 16px; font-weight: 600; text-align: center; padding: 3px 2px; }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test tools/reps.test.js`
Expected: PASS (22 tests).

- [ ] **Step 10: Syntax + full suite**

Run the extract-and-check command, then `node --test tools/*.test.js`.
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git commit -m "feat: type an exact weight or rep count in the log bar" -- index.html tools/reps.test.js
```

---

### Task 8: Export/import round-trip and full regression

**Goal:** Prove reps survive a real export/import cycle, that pre-reps backups still import cleanly, and that the whole suite is green.

**Files:**
- Test: `tools/reps.test.js`

**Acceptance Criteria:**
- [ ] A v3 export written from state containing reps produces JSON whose day objects carry a `reps` key.
- [ ] Importing that JSON and reloading yields the same reps values.
- [ ] Importing a **pre-reps** v3 export (no `reps` key anywhere) loads without throwing, and set rows render with no `×` suffix.
- [ ] `node --test tools/*.test.js` is fully green.
- [ ] `smoke-render` passes for every program and every week.

**Verify:** `node --test tools/*.test.js` → all pass, and the smoke command prints `smoke ok`.

**Steps:**

- [ ] **Step 1: Write the tests**

Append to `tools/reps.test.js`:

```js
// exportData() writes through Blob/URL/anchor, which the shim stubs out — so
// build the export payload the same way exportData does (whole day blobs
// straight out of localStorage) and assert the round trip through storage.
test('reps ride along in a v3 export payload', () => {
  const s = seededStorage();
  withApp({ storage: s.storage }, app => {
    const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${s.progId}_w1`));
    assert.ok(raw[s.dayId].reps, 'week-1 blob lost its reps');
    assert.strictEqual(raw[s.dayId].reps[`${s.exId}_0`], 11);
  });
});

test('a re-imported export restores the same reps', () => {
  const s = seededStorage();
  // Simulate import: the same blob written back into a fresh storage.
  const exported = JSON.parse(JSON.stringify({
    version: 3,
    currentProgram: 0,
    programs: {
      [s.progId]: { weeks: { 1: JSON.parse(s.storage[`hypertrophy_state_${s.progId}_w1`]) }, currentWeek: 1 },
    },
  }));
  const reimported = {};
  for (const [progId, pd] of Object.entries(exported.programs)) {
    for (const [w, ws] of Object.entries(pd.weeks)) {
      reimported[`hypertrophy_state_${progId}_w${w}`] = JSON.stringify(ws);
    }
    reimported[`hypertrophy_week_${progId}`] = String(pd.currentWeek);
  }
  reimported.hypertrophy_program = '0';
  withApp({ storage: reimported }, app => {
    assert.strictEqual(app.state[s.dayId].reps[`${s.exId}_0`], 11);
    assert.strictEqual(app.state[s.dayId].reps[s.exId], 9);
  });
});

test('a pre-reps backup imports and renders without a reps suffix', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const legacyWeek = { [day.id]: {
    sets: { [ex.id]: new Array(ex.sets).fill(false).map((v, i) => (i === 0 ? true : v)) },
    weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
    effort: {}, protocol: [], swaps: {},
  } };
  withApp({ storage: {
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(legacyWeek),
    [`hypertrophy_week_${prog.id}`]: '1',
    hypertrophy_program: '0',
  } }, app => {
    assert.deepStrictEqual(app.state[day.id].reps, {});
    assert.doesNotThrow(() => app.render());
    const html = app.elements.get('scroll').innerHTML;
    assert.ok(html.includes('100 ●'));
    assert.ok(!html.includes('100 × '), 'pre-reps history must not grow a reps suffix');
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `node --test tools/reps.test.js`
Expected: PASS (25 tests). If the pre-reps test fails on `100 × `, the display fallback in Task 5 is wrong — it must not fall back to *another set's* reps.

- [ ] **Step 3: Run the full suite**

Run: `node --test tools/*.test.js`
Expected: every test passes. Report the exact pass/fail counts; do not summarize as "all good" without the numbers.

- [ ] **Step 4: Run the smoke render across all programs**

```bash
node -e "const {smokeRender}=require('./tools/smoke-render');const {loadApp}=require('./tools/app-shim');for(let i=0;i<loadApp().PROGRAMS.length;i++){const r=smokeRender(undefined,i);if(!r.ok)throw new Error('program '+i+': '+r.error)}console.log('smoke ok')"
```

Expected: `smoke ok`.

- [ ] **Step 5: Confirm the analyzer is untouched**

Run: `node --test tools/analyze-history.test.js`
Expected: PASS with the same count as before this plan started. The analyzer ignores `reps` by design; any change here means something leaked out of scope.

- [ ] **Step 6: Commit**

```bash
git commit -m "test: cover reps through export/import round trips" -- tools/reps.test.js
```

---

## Manual check (user, in a browser)

The headless suite cannot verify focus behavior, on-screen keyboards, or layout at real widths. After Task 8, the user should confirm on a phone:

1. Tap a later exercise's header → it highlights and LOG SET switches to it.
2. Tap the LB value → keyboard opens, the value is selected, typing replaces it, Enter commits.
3. Tap the REPS value → numeric keyboard, ±1 buttons still work.
4. Log a set → the row shows `weight × reps`.
5. Both steppers and LOG SET fit without horizontal scroll on the narrowest device they use.
