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
