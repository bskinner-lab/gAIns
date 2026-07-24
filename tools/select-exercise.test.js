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
    const priorKey = app.view.pendKey;
    click(app, { act: 'selectex', ex: id });
    assert.strictEqual(app.view.selectedExId, id);
    // The handler clears pendKey; render()'s syncPending immediately
    // repopulates it to reflect the newly active (selected) exercise's set,
    // not the stale key from whatever was active before selection.
    assert.notStrictEqual(app.view.pendKey, priorKey);
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
