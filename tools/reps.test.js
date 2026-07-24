'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

// All programs must be marked "seen" in every test's storage, or the
// auto-select-newest-untrained-program feature silently switches away from
// program 0 (whatever we seed) to the last untrained program, breaking the
// day/exercise ids these tests expect to see rendered.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

function seededStorage() {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
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
      ...allSeenSeed(),
    },
    progId: prog.id, dayId: day.id, exId: ex.id,
  };
}

test('1. every day gets a reps map on a fresh install', () => {
  const app = loadApp();
  const { DAYS } = app;
  DAYS.forEach(day => {
    assert.strictEqual(typeof app.state[day.id].reps, 'object');
    assert.notStrictEqual(app.state[day.id].reps, null);
  });
});

test('2. state saved without a reps key still loads without error', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const legacy = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100 },
      effort: {}, protocol: [], swaps: {},
      // no `reps` key at all
    },
  };
  const app = loadApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(legacy),
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  });
  assert.deepStrictEqual(app.state[day.id].reps, {});
});

test('3. reps survive a save/load round trip', () => {
  const seed = seededStorage();
  // Seed week 1 as the CURRENT week too, so initState loads it directly.
  seed.storage[`hypertrophy_week_${seed.progId}`] = '1';
  withApp({ storage: seed.storage }, (app) => {
    assert.strictEqual(app.state[seed.dayId].reps[seed.exId], 9);
    assert.strictEqual(app.state[seed.dayId].reps[`${seed.exId}_0`], 11);
    // saveState() isn't exposed by the shim; skipSet() on an already-true set
    // is a no-op on `sets` but still calls saveState() internally, which is
    // enough to exercise the real persistence path.
    app.skipSet(seed.dayId, seed.exId, 0);
    const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${seed.progId}_w1`));
    assert.strictEqual(raw[seed.dayId].reps[seed.exId], 9);
    assert.strictEqual(raw[seed.dayId].reps[`${seed.exId}_0`], 11);
  });
});

test('4. history entries carry reps and setReps', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    const hist = app.getExerciseHistory(seed.dayId, seed.exId);
    const w1 = hist.find(h => h.week === 1);
    assert.ok(w1, 'week 1 should be present in history');
    assert.strictEqual(w1.reps, 9);
    assert.strictEqual(w1.setReps['0'], 11);
    assert.strictEqual(w1.setReps['1'], 9);
  });
});

test('5. a week with reps but no weight and no effort is not dropped from history', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: {},
      reps: { [ex.id]: 12 },
      effort: {}, protocol: [], swaps: {},
    },
  };
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    const hist = app.getExerciseHistory(day.id, ex.id);
    const entry = hist.find(h => h.week === 1);
    assert.ok(entry, 'week with reps-only should not be dropped');
    assert.strictEqual(entry.reps, 12);
    assert.strictEqual(entry.weight, null);
  });
});

test('6. per-set rep keys are matched on a digits-only suffix', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100 },
      reps: {
        [ex.id]: 10,
        [`${ex.id}_0`]: 11,
        [`${ex.id}_pause`]: 5,
        [`${ex.id}_pause_0`]: 6,
      },
      effort: {}, protocol: [], swaps: {},
    },
  };
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    const hist = app.getExerciseHistory(day.id, ex.id);
    const entry = hist.find(h => h.week === 1);
    assert.deepStrictEqual(Object.keys(entry.setReps), ['0']);
    assert.strictEqual(entry.setReps['0'], 11);
  });
});

test('7. a logged set with recorded reps renders weight × reps', () => {
  const seed = seededStorage();
  seed.storage[`hypertrophy_week_${seed.progId}`] = '1';
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /100\s*×\s*11\s*●/);
  });
});

test('8. a logged set without reps renders weight only', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
      reps: {},
      effort: {}, protocol: [], swaps: {},
    },
  };
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    click(app, { day: day.id });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /100 ●/);
    assert.doesNotMatch(html, /100\s*×/);
  });
});
