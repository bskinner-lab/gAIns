'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

// All programs must be marked "seen" in every test's storage, or the
// auto-select-newest-untrained-program feature silently switches away from
// whatever program we seed, breaking the day/exercise ids these tests expect.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

// A stand-in program object shaped like a real one, with `deload: true` on the
// weeks named. Synthetic rather than real so the pure `setsForWeek` cases don't
// ride on which weeks of which shipped mesocycle happen to be deloads.
function fakeProg(deloadWeeks = []) {
  return {
    id: 'test_prog',
    name: 'Test Program',
    subtitle: 'fixture',
    totalWeeks: 8,
    days: [],
    weekPhases: Array.from({ length: 8 }, (_, i) => Object.assign(
      { label: 'Phase', rpe: 'RPE 7–8', llp: false, color: '#ffffff' },
      deloadWeeks.includes(i + 1) ? { deload: true } : null
    )),
  };
}

const PLAIN = fakeProg();          // no week is a deload
const DELOAD_W8 = fakeProg([8]);   // week 8 only

// First exercise carrying a `ramp`, else day 1's first exercise. Keeps the
// integration cases pointed at real ramped data once the ramps land, while
// still exercising the sync path before they do.
function rampedExercise(prog) {
  for (const day of prog.days) {
    for (const ex of day.exercises) {
      if (ex.ramp) return { day, ex };
    }
  }
  return { day: prog.days[0], ex: prog.days[0].exercises[0] };
}

function meso3Storage() {
  return { hypertrophy_program: '2', ...allSeenSeed() };
}

// ------------------------------------------------------ setsForWeek: ramps

test('setsForWeek walks a sparse ramp to 4,4,5,5,5,5,6 over weeks 1-7', () => {
  withApp({}, app => {
    const ex = { sets: 4, ramp: { 3: 5, 7: 6 } };
    const expected = { 1: 4, 2: 4, 3: 5, 4: 5, 5: 5, 6: 5, 7: 6 };
    for (const w of Object.keys(expected)) {
      assert.strictEqual(
        app.setsForWeek(ex, Number(w), PLAIN), expected[w],
        `week ${w} resolved to the wrong set count`
      );
    }
  });
});

test('setsForWeek returns ex.sets at every week when there is no ramp', () => {
  withApp({}, app => {
    const ex = { sets: 3 };
    for (let w = 1; w <= 8; w++) {
      assert.strictEqual(app.setsForWeek(ex, w, PLAIN), 3, `week ${w} drifted off ex.sets`);
    }
  });
});

test('an empty ramp behaves exactly like no ramp', () => {
  withApp({}, app => {
    const ex = { sets: 5, ramp: {} };
    for (let w = 1; w <= 8; w++) {
      assert.strictEqual(app.setsForWeek(ex, w, PLAIN), 5, `week ${w} drifted off ex.sets`);
    }
  });
});

test('weeks below the lowest ramp key fall back to ex.sets', () => {
  withApp({}, app => {
    const ex = { sets: 2, ramp: { 4: 3 } };
    for (let w = 1; w <= 3; w++) {
      assert.strictEqual(app.setsForWeek(ex, w, PLAIN), 2, `week ${w} should still be the base count`);
    }
    for (let w = 4; w <= 8; w++) {
      assert.strictEqual(app.setsForWeek(ex, w, PLAIN), 3, `week ${w} should have picked up the ramp`);
    }
  });
});

// ----------------------------------------------------- setsForWeek: deload

test('a deload week halves the prescribed count and never goes below 1', () => {
  withApp({}, app => {
    assert.strictEqual(app.setsForWeek({ sets: 4 }, 8, DELOAD_W8), 2);
    assert.strictEqual(app.setsForWeek({ sets: 3 }, 8, DELOAD_W8), 1);
    assert.strictEqual(app.setsForWeek({ sets: 2 }, 8, DELOAD_W8), 1);
    assert.strictEqual(app.setsForWeek({ sets: 1 }, 8, DELOAD_W8), 1);
  });
});

test('a deload halves the ramped count, not the base count', () => {
  withApp({}, app => {
    const ex = { sets: 4, ramp: { 7: 7 } };
    assert.strictEqual(app.setsForWeek(ex, 7, DELOAD_W8), 7, 'week 7 is not a deload here');
    assert.strictEqual(app.setsForWeek(ex, 8, DELOAD_W8), 3, 'deload should halve 7, not 4');
  });
});

test('a non-deload week of the same program is left at full volume', () => {
  withApp({}, app => {
    for (let w = 1; w <= 7; w++) {
      assert.strictEqual(app.setsForWeek({ sets: 4 }, w, DELOAD_W8), 4, `week ${w} was halved`);
    }
  });
});

// --------------------------------------------------- setsForWeek: defaults

test('setsForWeek defaults to the live currentWeek and current program', () => {
  withApp({ storage: meso3Storage() }, app => {
    const ex = { sets: 4, ramp: { 3: 5 } };
    assert.strictEqual(app.currentWeek, 1);
    assert.strictEqual(app.setsForWeek(ex), 4, 'week 1 default');
    click(app, { act: 'wk', d: '1' });
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.currentWeek, 3);
    assert.strictEqual(app.setsForWeek(ex), 5, 'the default did not follow currentWeek');
    // The program default is only observable through program-specific phase
    // data, so lean on meso3's week-8 deload for it.
    while (app.currentWeek < 8) click(app, { act: 'wk', d: '1' });
    assert.strictEqual(
      app.setsForWeek(ex), app.setsForWeek(ex, 8, app.PROGRAMS[2]),
      'the default program disagrees with meso3 passed explicitly'
    );
    assert.strictEqual(app.setsForWeek({ sets: 4 }), 2, 'meso3 week 8 did not deload by default');
  });
});

// --------------------------------------------------- regression: meso1 / 2

test('meso1 set counts are identical at every week', () => {
  withApp({}, app => {
    const prog = app.PROGRAMS[0];
    prog.days.forEach(day => day.exercises.forEach(ex => {
      for (let w = 1; w <= 8; w++) {
        assert.strictEqual(
          app.setsForWeek(ex, w, prog), ex.sets,
          `${prog.id}/${day.id}/${ex.id} changed at week ${w}`
        );
      }
    }));
  });
});

test('meso2 set counts are identical at every week', () => {
  withApp({}, app => {
    const prog = app.PROGRAMS[1];
    prog.days.forEach(day => day.exercises.forEach(ex => {
      for (let w = 1; w <= 8; w++) {
        assert.strictEqual(
          app.setsForWeek(ex, w, prog), ex.sets,
          `${prog.id}/${day.id}/${ex.id} changed at week ${w}`
        );
      }
    }));
  });
});

// -------------------------------------------------------------- syncSetCount

// Drop a fixture array straight into live state, then run the real sync.
function syncFixture(app, arr, target) {
  const day = app.DAYS[0];
  const exId = day.exercises[0].id;
  app.state[day.id].sets[exId] = arr;
  app.syncSetCount(day.id, exId, target);
  return app.state[day.id].sets[exId];
}

test('syncSetCount grows a short array with unlogged sets', () => {
  withApp({}, app => {
    assert.deepStrictEqual(syncFixture(app, [true, false], 4), [true, false, false, false]);
  });
});

test('syncSetCount shrinks an array whose trailing sets are unlogged', () => {
  withApp({}, app => {
    assert.deepStrictEqual(syncFixture(app, [true, true, false, false, false], 3), [true, true, false]);
  });
});

test('a trailing logged set blocks truncation', () => {
  withApp({}, app => {
    const out = syncFixture(app, [true, true, true, true], 2);
    assert.deepStrictEqual(out, [true, true, true, true], 'logged work was destroyed');
    assert.strictEqual(out.length, 4);
  });
});

test('a trailing skipped set blocks truncation', () => {
  withApp({}, app => {
    const out = syncFixture(app, [true, false, 'skipped'], 1);
    assert.deepStrictEqual(out, [true, false, 'skipped'], 'a skipped set was destroyed');
  });
});

test('truncation stops at the first resolved set from the end', () => {
  withApp({}, app => {
    const out = syncFixture(app, [true, false, true, false, false], 1);
    assert.strictEqual(out.length, 3, 'should pop the two trailing blanks and stop at the true');
    assert.deepStrictEqual(out, [true, false, true]);
  });
});

test('an array already at target is left alone', () => {
  withApp({}, app => {
    const day = app.DAYS[0];
    const exId = day.exercises[0].id;
    const arr = [true, 'skipped', false];
    app.state[day.id].sets[exId] = arr;
    app.syncSetCount(day.id, exId, 3);
    assert.strictEqual(app.state[day.id].sets[exId], arr, 'the array was replaced, not synced in place');
    assert.deepStrictEqual(arr, [true, 'skipped', false]);
  });
});

test('entries before the truncation point survive verbatim', () => {
  withApp({}, app => {
    const out = syncFixture(app, ['skipped', true, false, true, false, false], 2);
    assert.strictEqual(out[0], 'skipped');
    assert.strictEqual(out[1], true);
    assert.strictEqual(out[2], false);
    assert.strictEqual(out[3], true);
    assert.strictEqual(out.length, 4);
  });
});

// ------------------------------------------------------------------- swaps
//
// An alternative is a same-pattern substitute for its original, so it trains
// through the original's progression: the `ramp` inherits along with everything
// else the alt does not itself author. Deleting it on swap silently cut the
// week's prescribed volume — week 7 Standing Calf Raise goes 7 sets, and
// swapping it used to drop the session to the base 4.

function findEx(prog, exId) {
  for (const day of prog.days) {
    const ex = day.exercises.find(e => e.id === exId);
    if (ex) return { day, ex };
  }
  throw new Error(`${exId} is not in ${prog.id}`);
}

// Open `day`, then swap `exId` for `altId` through the real UI path.
function swapTo(app, day, exId, altId) {
  click(app, { act: 'day', id: day.id });
  click(app, { act: 'swap', orig: exId });
  click(app, { act: 'doswap', orig: exId, new: altId });
}

function gotoWeek(app, week) {
  while (app.currentWeek < week) click(app, { act: 'wk', d: '1' });
  while (app.currentWeek > week) click(app, { act: 'wk', d: '-1' });
}

// A swap changes the movement, not the dose: an alternative stands in the same
// slot for the same reason, so it carries the same base `sets`. Two guards in
// one — it keeps a set-count edit on an exercise from being undone the moment
// the user swaps it (the rope hammer curl went 3→2 and its alternatives were
// left at 3), and it is the premise that makes inheriting `ramp` correct, since
// the ramp's values are absolute counts read against that base.
test('an alternative prescribes the same number of sets as the exercise it replaces', () => {
  withApp({}, app => {
    app.PROGRAMS.forEach(prog => prog.days.forEach(day => day.exercises.forEach(ex => {
      (app.EXERCISE_ALTERNATIVES[ex.id] || []).forEach(alt => {
        assert.strictEqual(alt.sets, ex.sets,
          `${prog.id}/${ex.id} prescribes ${ex.sets} sets but its alternative ${alt.id} ` +
          `prescribes ${alt.sets} — swapping would change the session's volume`);
      });
    })));
  });
});

test('a swapped ramped exercise keeps the ramped count in a ramped week', () => {
  withApp({ storage: meso3Storage() }, app => {
    const { day, ex } = findEx(app.PROGRAMS[2], 'm3_standing_calf');
    const altId = app.EXERCISE_ALTERNATIVES[ex.id][1].id;
    gotoWeek(app, 7);
    assert.strictEqual(app.setsForWeek(ex, 7, app.PROGRAMS[2]), 7, 'week 7 is the peak for this lift');
    swapTo(app, day, ex.id, altId);
    assert.strictEqual(app.state[day.id].swaps[ex.id], altId, 'the swap did not take');
    assert.strictEqual(app.state[day.id].sets[altId].length, 7,
      'the swap dropped the week\'s prescribed volume back to the base count');
  });
});

test('an alternative that authors its own ramp overrides the original', () => {
  withApp({ storage: meso3Storage() }, app => {
    const { day, ex } = findEx(app.PROGRAMS[2], 'm3_standing_calf');
    const alt = app.EXERCISE_ALTERNATIVES[ex.id][1];
    alt.ramp = { 5: 2 }; // this eval's copy of the data only
    gotoWeek(app, 7);
    swapTo(app, day, ex.id, alt.id);
    assert.strictEqual(app.state[day.id].sets[alt.id].length, 2,
      'the alternative\'s own ramp lost to the original\'s');
  });
});

test('a swap in the deload week halves the ramped count, not the base count', () => {
  withApp({ storage: meso3Storage() }, app => {
    const { day, ex } = findEx(app.PROGRAMS[2], 'm3_standing_calf');
    const altId = app.EXERCISE_ALTERNATIVES[ex.id][1].id;
    gotoWeek(app, 8);
    assert.strictEqual(app.setsForWeek(ex, 8, app.PROGRAMS[2]), 3, 'week 8 should halve the week-7 count');
    swapTo(app, day, ex.id, altId);
    assert.strictEqual(app.state[day.id].sets[altId].length, 3,
      'the deload halved the base count instead of the ramped one');
  });
});

test('swapping an unramped exercise still follows the alternative\'s own set count', () => {
  withApp({ storage: meso3Storage() }, app => {
    const { day, ex } = findEx(app.PROGRAMS[2], 'm3_rope_hammer_curl');
    const alt = app.EXERCISE_ALTERNATIVES[ex.id][0];
    assert.ok(!ex.ramp, 'this case is about an exercise with no ramp');
    swapTo(app, day, ex.id, alt.id);
    assert.strictEqual(app.state[day.id].sets[alt.id].length, alt.sets,
      'a flat alt should prescribe its own sets');
  });
});

// -------------------------------------------------------------- integration

test('meso3 holds exactly the prescribed number of sets for the week', () => {
  withApp({ storage: meso3Storage() }, app => {
    assert.strictEqual(app.currentProgramIdx, 2, 'did not boot into meso3');
    const { day, ex } = rampedExercise(app.PROGRAMS[2]);
    click(app, { act: 'day', id: day.id });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.ok(html.includes(`data-ex="${ex.id}"`), 'the exercise card is not on screen');
    assert.strictEqual(
      app.state[day.id].sets[ex.id].length,
      app.setsForWeek(ex, app.currentWeek, app.PROGRAMS[2]),
      `${ex.id} rendered the wrong number of sets in week ${app.currentWeek}`
    );
  });
});

test('changing week re-syncs the set arrays to the new week', () => {
  withApp({ storage: meso3Storage() }, app => {
    const { day, ex } = rampedExercise(app.PROGRAMS[2]);
    click(app, { act: 'day', id: day.id });
    for (let w = 2; w <= 8; w++) {
      click(app, { act: 'wk', d: '1' });
      assert.strictEqual(app.currentWeek, w, 'the week did not advance');
      assert.strictEqual(
        app.state[day.id].sets[ex.id].length,
        app.setsForWeek(ex, w, app.PROGRAMS[2]),
        `${ex.id} was not re-synced on entering week ${w}`
      );
    }
  });
});

test('a set logged in a week survives leaving the week and coming back', () => {
  withApp({ storage: meso3Storage() }, app => {
    const day = app.PROGRAMS[2].days[0];
    const exId = day.exercises[0].id;
    click(app, { act: 'day', id: day.id });
    click(app, { act: 'log' });
    const logged = app.state[day.id].sets[exId].indexOf(true);
    assert.notStrictEqual(logged, -1, 'nothing got logged');
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.currentWeek, 2);
    assert.strictEqual(app.state[day.id].sets[exId][logged], false, 'week 2 opened pre-logged');
    click(app, { act: 'wk', d: '-1' });
    assert.strictEqual(app.currentWeek, 1);
    assert.strictEqual(app.state[day.id].sets[exId][logged], true, 'the logged set was lost');
    assert.strictEqual(
      app.state[day.id].sets[exId].length,
      app.setsForWeek(day.exercises[0], 1, app.PROGRAMS[2]),
      'the round trip left the array off-prescription'
    );
  });
});
