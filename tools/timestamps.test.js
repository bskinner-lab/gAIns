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

test('7d. bulk skip does not clobber an individually-skipped set\'s timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.setClock(() => FIXED);
    app.skipSet(day.id, ex.id, 0);              // measured, individual skip
    app.setClock(() => FIXED + 60000);
    app.skipExercise(day.id, ex.id);            // bulk-skips the remainder
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'skip' },
      'bulk skip overwrote a measured skip timestamp'
    );
    // The genuinely-unresolved sets in the same exercise still get bulk stamps.
    assert.strictEqual(app.state[day.id].times[`${ex.id}_1`].src, 'bulk');
  });
});

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
    // Pin the deletion mid-sequence: without this the final assertion passes
    // even if undo never deleted anything, because the re-log's markTime
    // overwrites unconditionally.
    assert.ok(
      !(`${ex.id}_0` in app.state[day.id].times),
      'undo did not delete the entry before re-logging'
    );
    app.setClock(() => FIXED + 120000);
    app.toggleSet(day.id, ex.id, 0);
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED + 120000, src: 'log' }
    );
  });
});
