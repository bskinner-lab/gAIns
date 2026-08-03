'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp } = require('./app-shim');

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

// Mark every set of `dayId` done, straight through the app's own bulk path so
// the completion edge fires exactly as it does for a real user.
function finishDay(app, dayId) {
  click(app, { act: 'day', id: dayId });
  click(app, { act: 'completeday' });
  click(app, { act: 'cfok' });
}

function dayIds(app) { return app.DAYS.map(d => d.id); }

// ---------------------------------------------------------------- day done

test('finishing a day raises the completion celebration', () => {
  withApp({}, app => {
    const first = dayIds(app)[0];
    assert.strictEqual(app.view.done, null);
    finishDay(app, first);
    assert.ok(app.view.done, 'no celebration after the last set of the day');
    assert.strictEqual(app.view.done.dayId, first);
    assert.strictEqual(app.view.done.weekDone, false);
  });
});

test('the celebration names the next unfinished day', () => {
  withApp({}, app => {
    const [first, second] = dayIds(app);
    finishDay(app, first);
    assert.strictEqual(app.view.done.nextDayId, second);
    assert.match(app.elements.get('overlays').innerHTML, /NEXT ·/);
  });
});

test('re-rendering a finished day does not re-raise the celebration', () => {
  withApp({}, app => {
    finishDay(app, dayIds(app)[0]);
    click(app, { act: 'donex' });
    app.render();
    app.render();
    assert.strictEqual(app.view.done, null);
  });
});

test('undoing a set takes a still-open celebration back down', () => {
  withApp({}, app => {
    const first = dayIds(app)[0];
    finishDay(app, first);
    assert.ok(app.view.done);
    const exId = app.DAYS[0].exercises[0].id;
    app.undoSet(first, exId, 0);
    assert.strictEqual(app.view.done, null);
  });
});

test('re-completing an un-completed day raises the celebration again', () => {
  withApp({}, app => {
    const first = dayIds(app)[0];
    finishDay(app, first);
    click(app, { act: 'donex' });
    const exId = app.DAYS[0].exercises[0].id;
    app.undoSet(first, exId, 0);
    app.completeDay(first);
    assert.ok(app.view.done, 'the completion edge did not fire a second time');
  });
});

test('opening a week whose days are already complete stays quiet', () => {
  withApp({}, app => {
    dayIds(app).forEach(id => app.completeDay(id));
    // Week 1 is done, so the app has already moved on. Walk back to it.
    click(app, { act: 'donex' });
    click(app, { act: 'wk', d: '-1' });
    assert.strictEqual(app.view.done, null, 'revisiting a finished week celebrated again');
    app.render();
    assert.strictEqual(app.view.done, null);
  });
});

// ------------------------------------------------------- prominent surfaces

test('a finished day gets a standing banner at the top of the scroll', () => {
  withApp({}, app => {
    const first = dayIds(app)[0];
    finishDay(app, first);
    click(app, { act: 'donex' });
    click(app, { act: 'day', id: first });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /class="dayflag"/);
    assert.match(html, /DAY COMPLETE/);
  });
});

test('an unfinished day gets no banner', () => {
  withApp({}, app => {
    app.render();
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /class="dayflag"/);
  });
});

test('the bottom bar done row carries a check badge and a next-up button', () => {
  withApp({}, app => {
    const first = dayIds(app)[0];
    finishDay(app, first);
    click(app, { act: 'donex' });
    click(app, { act: 'day', id: first });
    app.render();
    const html = app.elements.get('bottombar').innerHTML;
    assert.match(html, /class="done-mark"/);
    assert.match(html, /data-act="donenext"/);
  });
});

test('the next-up button jumps to the day it names', () => {
  withApp({}, app => {
    const [first, second] = dayIds(app);
    finishDay(app, first);
    click(app, { act: 'donenext', id: second });
    assert.strictEqual(app.view.done, null);
    assert.strictEqual(app.view.name, 'day');
    assert.strictEqual(app.view.dayId, second);
  });
});

// --------------------------------------------------------- week advancement

test('finishing the last day of the week moves on to the next week', () => {
  withApp({}, app => {
    assert.strictEqual(app.currentWeek, 1);
    const ids = dayIds(app);
    ids.slice(0, -1).forEach(id => { finishDay(app, id); click(app, { act: 'donex' }); });
    assert.strictEqual(app.currentWeek, 1, 'advanced before the week was actually done');
    finishDay(app, ids[ids.length - 1]);
    assert.strictEqual(app.currentWeek, 2, 'the week did not advance');
    assert.strictEqual(app.view.done.week, 1, 'the celebration lost the week it just finished');
    assert.strictEqual(app.view.done.advancedTo, 2);
    assert.strictEqual(app.view.done.weekDone, true);
  });
});

test('the new week starts empty and lands on its first day', () => {
  withApp({}, app => {
    dayIds(app).forEach(id => app.completeDay(id));
    assert.strictEqual(app.currentWeek, 2);
    assert.strictEqual(app.view.dayId, app.DAYS[0].id);
    assert.ok(dayIds(app).every(id => !app.isDayComplete(id)), 'week 2 opened already complete');
  });
});

test('the advance is announced in the celebration overlay', () => {
  withApp({}, app => {
    dayIds(app).forEach(id => app.completeDay(id));
    const html = app.elements.get('overlays').innerHTML;
    assert.match(html, /WEEK 1 COMPLETE/);
    assert.match(html, /MOVED ON TO WEEK 2/);
    assert.match(html, /START WEEK 2/);
    assert.match(html, /STAY ON WEEK 1/);
  });
});

test('STAY ON WEEK n walks the advance back', () => {
  withApp({}, app => {
    dayIds(app).forEach(id => app.completeDay(id));
    assert.strictEqual(app.currentWeek, 2);
    click(app, { act: 'doneback' });
    assert.strictEqual(app.currentWeek, 1);
    assert.strictEqual(app.view.done, null);
    assert.ok(dayIds(app).every(id => app.isDayComplete(id)), 'week 1 lost its logged sets');
  });
});

test('the advanced-to week is persisted, not just held in memory', () => {
  withApp({}, app => {
    dayIds(app).forEach(id => app.completeDay(id));
    const progId = app.PROGRAMS[app.currentProgramIdx].id;
    assert.strictEqual(app.storage.getItem(`hypertrophy_week_${progId}`), '2');
  });
});

test('the last week of the program reports completion instead of advancing', () => {
  withApp({}, app => {
    const last = app.PROGRAMS[app.currentProgramIdx].totalWeeks;
    for (let w = app.currentWeek; w < last; w++) click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.currentWeek, last);
    dayIds(app).forEach(id => app.completeDay(id));
    assert.strictEqual(app.currentWeek, last, 'walked past the end of the program');
    assert.strictEqual(app.view.done.programDone, true);
    assert.strictEqual(app.view.done.advancedTo, null);
    assert.match(app.elements.get('overlays').innerHTML, /MESOCYCLE COMPLETE/);
  });
});

test('a week finished in an earlier session advances on the next open', () => {
  const seed = withApp({}, app => {
    dayIds(app).forEach(id => app.completeDay(id));
    click(app, { act: 'doneback' });          // back to the finished week 1
    return { ...app.storage._store };
  });
  assert.strictEqual(seed[Object.keys(seed).find(k => k.startsWith('hypertrophy_week_'))], '1');
  withApp({ storage: seed }, app => {
    assert.strictEqual(app.currentWeek, 2, 'boot did not resume on the current week');
    assert.strictEqual(app.view.done, null, 'a boot-time advance popped a celebration');
  });
});

test('an untouched week never auto-advances on boot', () => {
  withApp({}, app => {
    assert.strictEqual(app.currentWeek, 1);
    app.advanceToCurrentWeek();
    assert.strictEqual(app.currentWeek, 1);
  });
});

test('a week completed entirely by skipping still advances', () => {
  withApp({}, app => {
    dayIds(app).forEach(id => app.skipDay(id));
    assert.strictEqual(app.currentWeek, 2, 'an all-skipped week did not close out');
  });
});

test('switching weeks by hand clears a celebration that is still up', () => {
  withApp({}, app => {
    finishDay(app, dayIds(app)[0]);
    assert.ok(app.view.done);
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.view.done, null);
  });
});

test('logging the last set of a week does not start a rest timer', () => {
  withApp({}, app => {
    const ids = dayIds(app);
    ids.slice(0, -1).forEach(id => { finishDay(app, id); click(app, { act: 'donex' }); });
    const last = ids[ids.length - 1];
    click(app, { act: 'day', id: last });
    // Leave a single set open, then log it through the real bottom-bar path.
    app.completeDay(last);
    click(app, { act: 'doneback' });
    const lastEx = app.DAYS.find(d => d.id === last).exercises.slice(-1)[0].id;
    const n = app.state[last].sets[lastEx].length;
    app.undoSet(last, lastEx, n - 1);
    click(app, { act: 'day', id: last });
    click(app, { act: 'log' });
    assert.strictEqual(app.currentWeek, 2, 'the final set did not close the week');
    assert.strictEqual(app.view.restEnd, null, 'a rest timer ran into the new week');
  });
});
