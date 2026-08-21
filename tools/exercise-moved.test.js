// tools/exercise-moved.test.js
//
// An exercise that MOVES between days across a program revision must take its
// logged history with it.
//
// `state` is keyed dayId → exId, so a week blob written before the move files
// that work under the OLD day. `initState()` then rebuilds every day's `sets`
// from that day's CURRENT exercise list and calls `saveState()`, which writes
// the whole object back — so without a migration the logged array is not merely
// orphaned, it is deleted from localStorage on the next boot.
//
// meso3's Machine Chest Press moved day1 (PUSH) → day4 (UPPER) in 798c495;
// these tests use it as the live case and synthetic ids for the edge cases.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

const MOVED = 'm3_machine_chest_press';
const OLD_DAY = 'day1';
const NEW_DAY = 'day4';
const WEEK_KEY = 'hypertrophy_state_meso3_w1';

// Every program must be marked "seen", or the auto-select-newest-untrained
// feature switches away from meso3 and takes the day/exercise ids with it.
function seenPrograms() {
  const { PROGRAMS } = loadApp();
  return JSON.stringify(PROGRAMS.map(p => p.id));
}
const SEEN = seenPrograms();

// Week-1 set count for the moved exercise. `syncSetCount` pads a shorter logged
// array up to the current prescription on boot, so every expectation here is
// "the logged entries, then whatever blanks today's set count adds" — that way
// re-prescribing the exercise is a program decision, not a test failure.
const MOVED_SET_COUNT = (() => {
  const { PROGRAMS, setsForWeek } = loadApp();
  const meso3 = PROGRAMS[2];
  const ex = meso3.days
    .flatMap(d => d.exercises)
    .find(e => e.id === MOVED);
  assert.ok(ex, `${MOVED} is missing from meso3`);
  return setsForWeek(ex, 1, meso3);
})();

function pad(logged) {
  const out = logged.slice();
  while (out.length < MOVED_SET_COUNT) out.push(false);
  return out;
}

function emptyDay(extra) {
  return Object.assign(
    { sets: {}, weights: {}, reps: {}, times: {}, effort: {}, protocol: [], swaps: {} },
    extra
  );
}

// meso3, week 1, with `days` as the raw week blob.
function seed(days) {
  return {
    hypertrophy_program: '2',
    hypertrophy_week_meso3: '1',
    hypertrophy_seen_programs: SEEN,
    hypertrophy_migrated_v3: '1',
    [WEEK_KEY]: JSON.stringify(days),
  };
}

function savedBlob(app) {
  return JSON.parse(app.storage._store[WEEK_KEY]);
}

// -------------------------------------------------------------- the premise

test('the moved exercise really does live on its new day', () => {
  const { PROGRAMS } = loadApp();
  const meso3 = PROGRAMS[2];
  const home = {};
  meso3.days.forEach(d => d.exercises.forEach(ex => { home[ex.id] = d.id; }));
  assert.strictEqual(home[MOVED], NEW_DAY,
    `${MOVED} is no longer on ${NEW_DAY}; retarget this suite at whatever moved instead`);
});

// ------------------------------------------------------------- the reported bug

test('history logged under the old day is found under the new one', () => {
  withApp({ storage: seed({
    [OLD_DAY]: emptyDay({
      sets: { [MOVED]: [true, true, true] },
      weights: { [MOVED]: 140 },
      effort: { [MOVED]: 'hard' },
    }),
  }) }, app => {
    const hist = app.getExerciseHistory(NEW_DAY, MOVED);
    assert.strictEqual(hist.length, 1, 'the logged week vanished from history');
    assert.strictEqual(hist[0].week, 1);
    assert.strictEqual(hist[0].weight, 140);
    assert.strictEqual(hist[0].effort, 'hard');
    assert.deepStrictEqual(app.getExerciseHistory(OLD_DAY, MOVED), [],
      'the old day still claims the history');
  });
});

test('the logged sets array survives the boot that rewrites storage', () => {
  withApp({ storage: seed({
    [OLD_DAY]: emptyDay({ sets: { [MOVED]: [true, true, true] }, weights: { [MOVED]: 140 } }),
  }) }, app => {
    assert.deepStrictEqual(app.state[NEW_DAY].sets[MOVED], pad([true, true, true]),
      'the logged sets did not reach the new day in memory');
    const blob = savedBlob(app);
    assert.deepStrictEqual(blob[NEW_DAY].sets[MOVED], pad([true, true, true]),
      'the logged sets were dropped from localStorage on boot');
    assert.strictEqual(blob[OLD_DAY].sets[MOVED], undefined,
      'the old day kept a stale copy');
    assert.strictEqual(blob[NEW_DAY].weights[MOVED], 140);
    assert.strictEqual(blob[OLD_DAY].weights[MOVED], undefined);
  });
});

test('per-set weights, reps and times follow the exercise', () => {
  withApp({ storage: seed({
    [OLD_DAY]: emptyDay({
      sets: { [MOVED]: [true, true, false] },
      weights: { [MOVED]: 145, [`${MOVED}_0`]: 140, [`${MOVED}_1`]: 145 },
      reps: { [MOVED]: 10, [`${MOVED}_0`]: 12, [`${MOVED}_1`]: 10 },
      times: { [`${MOVED}_0`]: { at: 1000, src: 'log' }, [`${MOVED}_1`]: { at: 2000, src: 'log' } },
      effort: { [MOVED]: 'hard' },
    }),
  }) }, app => {
    const dst = savedBlob(app)[NEW_DAY];
    const src = savedBlob(app)[OLD_DAY];
    assert.deepStrictEqual(dst.weights, { [MOVED]: 145, [`${MOVED}_0`]: 140, [`${MOVED}_1`]: 145 });
    assert.deepStrictEqual(dst.reps, { [MOVED]: 10, [`${MOVED}_0`]: 12, [`${MOVED}_1`]: 10 });
    assert.deepStrictEqual(dst.times, {
      [`${MOVED}_0`]: { at: 1000, src: 'log' },
      [`${MOVED}_1`]: { at: 2000, src: 'log' },
    });
    assert.strictEqual(dst.effort[MOVED], 'hard');
    assert.deepStrictEqual(src.weights, {}, 'per-set weights were left behind');
    assert.deepStrictEqual(src.reps, {}, 'per-set reps were left behind');
    assert.deepStrictEqual(src.times, {}, 'per-set times were left behind');
    assert.deepStrictEqual(src.effort, {}, 'effort was left behind');
  });
});

test('a swap moves with the exercise, and so do the sets logged under the alternative', () => {
  const { EXERCISE_ALTERNATIVES } = loadApp();
  const altId = EXERCISE_ALTERNATIVES[MOVED][0].id;
  withApp({ storage: seed({
    [OLD_DAY]: emptyDay({
      sets: { [altId]: [true, false, false] },
      weights: { [altId]: 90 },
      swaps: { [MOVED]: altId },
    }),
  }) }, app => {
    assert.strictEqual(app.state[NEW_DAY].swaps[MOVED], altId, 'the swap stayed on the old day');
    assert.strictEqual(app.state[OLD_DAY].swaps[MOVED], undefined);
    assert.deepStrictEqual(app.state[NEW_DAY].sets[altId], pad([true, false, false]),
      'the sets logged against the alternative were lost');
    assert.strictEqual(savedBlob(app)[NEW_DAY].weights[altId], 90);
  });
});

// -------------------------------------------------------------------- rules

test('the migration is idempotent', () => {
  const first = withApp({ storage: seed({
    [OLD_DAY]: emptyDay({
      sets: { [MOVED]: [true, true, true] },
      weights: { [MOVED]: 140, [`${MOVED}_0`]: 140 },
      effort: { [MOVED]: 'hard' },
    }),
  }) }, app => app.storage._store[WEEK_KEY]);
  const second = withApp({ storage: seed(JSON.parse(first)) }, app => app.storage._store[WEEK_KEY]);
  assert.deepStrictEqual(JSON.parse(second), JSON.parse(first),
    'a second boot moved something again');
});

test('an exercise the program no longer knows is left exactly where it is', () => {
  withApp({ storage: seed({
    [OLD_DAY]: emptyDay({
      sets: { ghost_exercise: [true, true] },
      weights: { ghost_exercise: 55, ghost_exercise_0: 55 },
      reps: { ghost_exercise: 8 },
      effort: { ghost_exercise: 'hard' },
    }),
  }) }, app => {
    const blob = savedBlob(app);
    assert.strictEqual(blob[OLD_DAY].weights.ghost_exercise, 55, 'a removed exercise was deleted');
    assert.strictEqual(blob[OLD_DAY].weights.ghost_exercise_0, 55);
    assert.strictEqual(blob[OLD_DAY].reps.ghost_exercise, 8);
    assert.strictEqual(blob[OLD_DAY].effort.ghost_exercise, 'hard');
    Object.keys(blob).forEach(dayId => {
      if (dayId === OLD_DAY) return;
      assert.strictEqual(blob[dayId].weights.ghost_exercise, undefined,
        `a removed exercise was relocated to ${dayId}`);
    });
  });
});

test('the destination wins when both days hold data for the moved exercise', () => {
  withApp({ storage: seed({
    [OLD_DAY]: emptyDay({
      sets: { [MOVED]: [true, true, true] },
      weights: { [MOVED]: 140, [`${MOVED}_0`]: 140 },
      effort: { [MOVED]: 'hard' },
    }),
    [NEW_DAY]: emptyDay({
      sets: { [MOVED]: [false, true, false] },
      weights: { [MOVED]: 200, [`${MOVED}_0`]: 200 },
      effort: { [MOVED]: 'easy' },
    }),
  }) }, app => {
    const blob = savedBlob(app);
    assert.deepStrictEqual(blob[NEW_DAY].sets[MOVED], pad([false, true, false]),
      'the incoming array clobbered the sets already on the new day');
    assert.strictEqual(blob[NEW_DAY].weights[MOVED], 200);
    assert.strictEqual(blob[NEW_DAY].weights[`${MOVED}_0`], 200);
    assert.strictEqual(blob[NEW_DAY].effort[MOVED], 'easy');
    assert.strictEqual(blob[OLD_DAY].weights[MOVED], undefined,
      'the losing copy was left behind on the old day');
  });
});

test('a past week logged under the old day still reads back as history', () => {
  const storage = seed({
    [OLD_DAY]: emptyDay({ sets: { [MOVED]: [true, true, true] }, weights: { [MOVED]: 130 } }),
  });
  storage.hypertrophy_week_meso3 = '2';
  storage['hypertrophy_state_meso3_w2'] = JSON.stringify({});
  withApp({ storage }, app => {
    assert.strictEqual(app.currentWeek, 2);
    const hist = app.getExerciseHistory(NEW_DAY, MOVED);
    const w1 = hist.find(h => h.week === 1);
    assert.ok(w1, 'week 1 fell out of history');
    assert.strictEqual(w1.weight, 130);
    assert.strictEqual(app.state[NEW_DAY].weights[MOVED], 130,
      'week 2 did not prefill the moved exercise from week 1');
  });
});

test('an untouched program boots without moving anything', () => {
  const before = { [OLD_DAY]: emptyDay({ sets: { m3_incline_db_press: [true, false, false, false] } }) };
  withApp({ storage: seed(before) }, app => {
    const blob = savedBlob(app);
    assert.deepStrictEqual(blob[OLD_DAY].sets.m3_incline_db_press, [true, false, false, false],
      'an exercise that never moved was disturbed');
  });
});
