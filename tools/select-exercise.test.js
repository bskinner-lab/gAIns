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
    const day = app.curDay();
    const orig = day.exercises[2];
    click(app, { act: 'selectex', ex: orig.id });
    assert.strictEqual(app.view.selectedExId, orig.id);
    // render()'s syncPending keys on the RESOLVED exercise id, so verify
    // the pendKey actually names the selected exercise's first open set —
    // this would fail if the selection stopped taking effect.
    const resolved = app.state[day.id].swaps && app.state[day.id].swaps[orig.id]
      ? app.EXERCISE_ALTERNATIVES[orig.id].find(a => a.id === app.state[day.id].swaps[orig.id])
      : orig;
    const expectedKey = `${app.PROGRAMS[app.currentProgramIdx].id}:${app.currentWeek}:${day.id}:${resolved.id}:0`;
    assert.strictEqual(app.view.pendKey, expectedKey);
    click(app, { act: 'selectex', ex: orig.id });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('selecting the already-active exercise preserves a dialed-in weight', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.render();
    click(app, { act: 'w+' });
    click(app, { act: 'w+' });
    const dialed = app.view.pendW;
    assert.ok(dialed > 0, 'precondition: the stepper moved the weight');
    click(app, { act: 'selectex', ex: day.exercises[0].id });
    assert.strictEqual(app.view.pendW, dialed, 'tapping the active card discarded the dialed weight');
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

test('logging a non-final set keeps the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    click(app, { act: 'selectex', ex: orig.id });
    click(app, { act: 'log' });
    assert.strictEqual(app.view.selectedExId, orig.id);
    assert.strictEqual(app.state[day.id].sets[orig.id][0], true);
  });
});

test('logging the final set clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click(app, { act: 'log' });
    assert.strictEqual(app.view.selectedExId, null);
    assert.ok(app.state[day.id].sets[orig.id].every(v => v === true));
  });
});

test('skipping the final set clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: orig.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('un-skipping a set keeps the exercise selectable and selected', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: orig.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
    click(app, { act: 'selectex', ex: orig.id });
    click(app, { act: 'skipset', ex: orig.id, i: '0' });   // toggles back to pending
    assert.strictEqual(app.state[day.id].sets[orig.id][0], false);
    assert.strictEqual(app.view.selectedExId, orig.id);
  });
});

test('skipping the final set of a SWAPPED selected exercise clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises.find(o => (app.EXERCISE_ALTERNATIVES[o.id] || []).length);
    assert.ok(orig, 'expected at least one swappable exercise on the first day');
    const altId = app.EXERCISE_ALTERNATIVES[orig.id][0].id;
    click(app, { act: 'swap', orig: orig.id });
    click(app, { act: 'doswap', orig: orig.id, new: altId });
    // doswap clears the selection, so re-select after swapping.
    click(app, { act: 'selectex', ex: orig.id });
    const resolvedId = app.state[day.id].swaps[orig.id];
    assert.strictEqual(resolvedId, altId);
    const n = app.state[day.id].sets[altId].length;
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: altId, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('completing a different exercise leaves the selection alone', () => {
  withApp({}, app => {
    const day = app.curDay();
    const other = day.exercises[0];
    click(app, { act: 'selectex', ex: day.exercises[2].id });
    const n = app.state[day.id].sets[other.id].length;
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: other.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, day.exercises[2].id);
  });
});
