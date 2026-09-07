'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp } = require('./app-shim');

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

function firstExercise(app) {
  const day = app.DAYS[0];
  return { day, exId: day.exercises[0].id };
}

// ----------------------------------------------------------- adjustSetCount

test('adding a set grows the array by one beyond the base prescription', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    app.adjustSetCount(day.id, exId, 1);
    assert.strictEqual(app.state[day.id].sets[exId].length, base + 1);
    assert.deepStrictEqual(app.state[day.id].sets[exId].slice(base), [false]);
  });
});

test('removing a set shrinks an unlogged trailing set', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    app.adjustSetCount(day.id, exId, -1);
    assert.strictEqual(app.state[day.id].sets[exId].length, base - 1);
  });
});

test('a set removal followed by an addition returns to the base count', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    app.adjustSetCount(day.id, exId, -1);
    app.adjustSetCount(day.id, exId, 1);
    assert.strictEqual(app.state[day.id].sets[exId].length, base);
    assert.strictEqual(app.state[day.id].setAdjust[exId], 0);
  });
});

test('removal never drops an exercise below one set', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    for (let i = 0; i < base + 5; i++) app.adjustSetCount(day.id, exId, -1);
    assert.strictEqual(app.state[day.id].sets[exId].length, 1);
  });
});

test('removal never destroys a logged set, even though setAdjust still records the request', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const arr = app.state[day.id].sets[exId];
    arr.fill(true); // every set logged
    const base = arr.length;
    app.adjustSetCount(day.id, exId, -1);
    assert.strictEqual(app.state[day.id].sets[exId].length, base, 'a logged set was dropped');
    assert.ok(app.state[day.id].sets[exId].every(v => v === true), 'logged work was altered');
  });
});

test('adding a set reopens an exercise that had been fully completed', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    app.state[day.id].sets[exId].fill(true);
    app.adjustSetCount(day.id, exId, 1);
    const arr = app.state[day.id].sets[exId];
    assert.strictEqual(arr[arr.length - 1], false, 'the new set should start unlogged');
  });
});

// ------------------------------------------------------------- week scoping

test('a set added in one week does not appear when a different week is opened', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    app.adjustSetCount(day.id, exId, 1);
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.currentWeek, 2);
    assert.strictEqual(app.state[day.id].sets[exId].length, base,
      'the adjustment leaked into a week it was never made in');
  });
});

test('a set added in a week survives leaving and returning to that week', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    app.adjustSetCount(day.id, exId, 1);
    click(app, { act: 'wk', d: '1' });
    click(app, { act: 'wk', d: '-1' });
    assert.strictEqual(app.currentWeek, 1);
    assert.strictEqual(app.state[day.id].sets[exId].length, base + 1,
      'the manual set was lost on the round trip');
  });
});

// --------------------------------------------------------------- UI wiring

test('the setadd/setrm actions reach adjustSetCount through the click handler', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    click(app, { act: 'day', id: day.id });
    const base = app.state[day.id].sets[exId].length;
    click(app, { act: 'setadd', ex: exId });
    assert.strictEqual(app.state[day.id].sets[exId].length, base + 1);
    click(app, { act: 'setrm', ex: exId });
    click(app, { act: 'setrm', ex: exId });
    assert.strictEqual(app.state[day.id].sets[exId].length, base - 1);
  });
});

test('the exercise card renders a +/- sets stepper wired to the resolved exercise id', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    click(app, { act: 'day', id: day.id });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, new RegExp(`data-act="setadd" data-ex="${exId}"`));
    assert.match(html, new RegExp(`data-act="setrm" data-ex="${exId}"`));
  });
});

test('the remove button is disabled once an exercise is down to one set', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const base = app.state[day.id].sets[exId].length;
    for (let i = 0; i < base - 1; i++) app.adjustSetCount(day.id, exId, -1);
    assert.strictEqual(app.state[day.id].sets[exId].length, 1);
    click(app, { act: 'day', id: day.id });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, new RegExp(`data-act="setrm" data-ex="${exId}"[^>]*disabled`));
  });
});

// --------------------------------------------------------- adjustedSetTarget

test('adjustedSetTarget adds the stored delta to the week\'s prescribed count', () => {
  withApp({}, app => {
    const { day, exId } = firstExercise(app);
    const ex = day.exercises.find(e => e.id === exId);
    const base = app.setsForWeek(ex);
    assert.strictEqual(app.adjustedSetTarget(day.id, exId, ex), base);
    app.state[day.id].setAdjust = { [exId]: 2 };
    assert.strictEqual(app.adjustedSetTarget(day.id, exId, ex), base + 2);
  });
});
