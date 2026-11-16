// tools/muscle-volume.test.js
//
// Weekly hard sets per muscle in PROGRESS, against MEV / MAV / MRV.
//
// The app inlines copies of tools/muscle-map.json and tools/volume-landmarks.json
// (it is a single file), so the first tests pin those copies to the canonical
// JSON. The rest check the count itself against an oracle computed here from
// PROGRAMS + the JSON files, independently of the app's own helpers, and that
// the PROGRESS view renders it for every program.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, withApp } = require('./app-shim');
const muscleMap = require('./muscle-map.json');
const landmarks = require('./volume-landmarks.json');

// Independent oracle: planned week-N volume for a program with no swaps or ±
// adjustments, straight from the data. Same ramp/deload rule as the Plan tab.
function plannedOracle(prog, week) {
  const out = {};
  const phase = prog.weekPhases[week - 1];
  for (const day of prog.days) {
    for (const ex of day.exercises) {
      let n = ex.sets;
      for (const k of Object.keys(ex.ramp || {}).map(Number).sort((a, b) => a - b)) {
        if (k <= week) n = ex.ramp[k];
      }
      if (phase && phase.deload) n = Math.max(1, Math.floor(n / 2));
      for (const [m, c] of Object.entries(ex.muscles || muscleMap[ex.id] || {})) {
        out[m] = (out[m] || 0) + n * c;
      }
    }
  }
  return out;
}

function close(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} !== ${expected}`);
}

// ── The inlined tables ───────────────────────────────────────────────────────

test('MUSCLE_MAP in index.html matches tools/muscle-map.json', () => {
  const { MUSCLE_MAP } = loadApp();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(MUSCLE_MAP)), muscleMap);
});

test('VOLUME_LANDMARKS in index.html matches tools/volume-landmarks.json', () => {
  const { VOLUME_LANDMARKS } = loadApp();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(VOLUME_LANDMARKS)), landmarks);
});

// ── Counting ─────────────────────────────────────────────────────────────────

test('a fresh week plans exactly what the program prescribes, with nothing done', () => {
  const { PROGRAMS } = loadApp();
  PROGRAMS.forEach((prog, idx) => {
    withApp({}, app => {
      app.switchProgram(idx);
      const vol = app.weeklyMuscleVolume();
      const want = plannedOracle(prog, app.currentWeek);
      assert.deepStrictEqual(Object.keys(vol).sort(), Object.keys(want).sort(), `${prog.id} muscles`);
      for (const [m, planned] of Object.entries(want)) {
        close(vol[m].planned, planned, `${prog.id}.${m} planned`);
        assert.strictEqual(vol[m].done, 0, `${prog.id}.${m} done`);
      }
    });
  });
});

test('meso3 week 1 agrees with the program-volume oracle', () => {
  // Same numbers tools/program-volume.test.js pins for meso3 week 1.
  withApp({}, app => {
    app.switchProgram(2);
    const vol = app.weeklyMuscleVolume();
    close(vol.chest.planned, 11, 'chest');
    close(vol.side_delt.planned, 12.5, 'side_delt');
    close(vol.lats.planned, 12.5, 'lats');
    close(vol.biceps.planned, 13.5, 'biceps');
  });
});

test('a completed set adds its credit to every muscle it trains', () => {
  withApp({}, app => {
    const day = app.DAYS[0];
    const ex = app.resolveExercise(day.id, day.exercises[0]);
    const credits = app.musclesFor(ex, day.exercises[0].id);
    const before = app.weeklyMuscleVolume();
    app.state[day.id].sets[ex.id][0] = true;
    app.state[day.id].sets[ex.id][1] = true;
    const after = app.weeklyMuscleVolume();
    assert.ok(Object.keys(credits).length > 0);
    for (const [m, c] of Object.entries(credits)) {
      close(after[m].done - before[m].done, 2 * c, `${m} done`);
      close(after[m].planned, before[m].planned, `${m} planned`);
    }
  });
});

test('a skipped set is not counted as done', () => {
  withApp({}, app => {
    const day = app.DAYS[0];
    const ex = app.resolveExercise(day.id, day.exercises[0]);
    app.state[day.id].sets[ex.id].fill('skipped');
    const vol = app.weeklyMuscleVolume();
    for (const m of Object.keys(app.musclesFor(ex, day.exercises[0].id))) {
      // No other exercise has been touched, so every done count is still 0.
      assert.strictEqual(vol[m].done, 0, m);
    }
  });
});

test('the ± SETS stepper moves the planned count', () => {
  withApp({}, app => {
    const day = app.DAYS[0];
    const exId = day.exercises[0].id;
    const ex = app.resolveExercise(day.id, day.exercises[0]);
    const before = app.weeklyMuscleVolume();
    app.adjustSetCount(day.id, exId, 1);
    const after = app.weeklyMuscleVolume();
    for (const [m, c] of Object.entries(app.musclesFor(ex, exId))) {
      close(after[m].planned - before[m].planned, c, m);
    }
  });
});

test('a swapped-in alternative counts under its slot, done sets included', () => {
  withApp({}, app => {
    // First slot on any day that has an alternative.
    let day, orig, alt;
    for (const d of app.DAYS) {
      const o = d.exercises.find(e => (app.EXERCISE_ALTERNATIVES[e.id] || []).length);
      if (o) { day = d; orig = o; alt = app.EXERCISE_ALTERNATIVES[o.id][0]; break; }
    }
    assert.ok(alt, 'some slot has an alternative');
    const before = app.weeklyMuscleVolume();
    app.state[day.id].swaps = { ...(app.state[day.id].swaps || {}), [orig.id]: alt.id };
    const ex = app.resolveExercise(day.id, orig);
    app.state[day.id].sets[ex.id] = Array(app.adjustedSetTarget(day.id, ex.id, ex)).fill(true);
    const after = app.weeklyMuscleVolume();
    const credits = app.musclesFor(ex, orig.id);
    assert.ok(Object.keys(credits).length > 0, 'the alternative inherits a muscle profile');
    for (const [m, c] of Object.entries(credits)) {
      close(after[m].done - before[m].done, app.state[day.id].sets[ex.id].length * c, `${m} done`);
    }
  });
});

// ── Status ───────────────────────────────────────────────────────────────────

test('volumeStatus judges the plan against each landmark', () => {
  const { volumeStatus } = loadApp();
  const l = { mev: 8, mavLow: 12, mavHigh: 20, mrv: 22 };
  const at = (p, deload = false) => volumeStatus(p, l, deload).key;
  assert.strictEqual(at(7), 'under');
  assert.strictEqual(at(8), 'low');
  assert.strictEqual(at(11.5), 'low');
  assert.strictEqual(at(12), 'in');
  assert.strictEqual(at(20), 'in');
  assert.strictEqual(at(21), 'high');
  assert.strictEqual(at(22), 'high');
  assert.strictEqual(at(22.5), 'over');
});

test('a muscle with no MEV is never flagged below it', () => {
  const { volumeStatus } = loadApp();
  assert.strictEqual(volumeStatus(0, { mev: 0, mavLow: 6, mavHigh: 12, mrv: 16 }, false).key, 'low');
});

test('a deload week only flags volume over MRV', () => {
  const { volumeStatus } = loadApp();
  const l = { mev: 8, mavLow: 12, mavHigh: 20, mrv: 22 };
  assert.strictEqual(volumeStatus(3, l, true).key, 'deload');
  assert.strictEqual(volumeStatus(23, l, true).key, 'over');
});

// ── Rendering ────────────────────────────────────────────────────────────────

test('PROGRESS shows a weekly-sets row per trained muscle, for every program', () => {
  const { PROGRAMS } = loadApp();
  PROGRAMS.forEach((prog, idx) => {
    withApp({}, app => {
      app.switchProgram(idx);
      app.view.name = 'progress';
      app.render();
      const html = app.elements.get('scroll').innerHTML;
      assert.match(html, /WEEKLY SETS · WEEK 1/, prog.id);
      const want = plannedOracle(prog, 1);
      const shown = Object.keys(landmarks).filter(m => want[m] || landmarks[m].mev);
      assert.strictEqual((html.match(/class="mv"/g) || []).length, shown.length, `${prog.id} row count`);
      for (const m of shown) assert.ok(html.includes(`>${m.replace(/_/g, ' ').toUpperCase()}<`), `${prog.id} ${m}`);
    });
  });
});

test('logged sets show up as done in the row', () => {
  withApp({}, app => {
    const day = app.DAYS[0];
    const ex = app.resolveExercise(day.id, day.exercises[0]);
    app.state[day.id].sets[ex.id].fill(true);
    const vol = app.weeklyMuscleVolume();
    const [m] = Object.keys(app.musclesFor(ex, day.exercises[0].id));
    const n = x => String(Math.round(x * 10) / 10);
    assert.ok(app.muscleVolumeHTML().includes(`${n(vol[m].done)} / ${n(vol[m].planned)}`));
  });
});

test('a deload week is labelled and its rows read DELOAD, not BELOW MEV', () => {
  const { PROGRAMS } = loadApp();
  const idx = PROGRAMS.findIndex(p => (p.weekPhases || []).some(ph => ph.deload));
  assert.ok(idx >= 0, 'some program has a deload week');
  const prog = PROGRAMS[idx];
  const week = prog.weekPhases.findIndex(ph => ph.deload) + 1;
  withApp({ storage: {
    hypertrophy_program: String(idx),
    hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)),
    hypertrophy_migrated_v3: '1',
    [`hypertrophy_week_${prog.id}`]: String(week),
  } }, app => {
    assert.strictEqual(app.currentWeek, week);
    const html = app.muscleVolumeHTML();
    assert.match(html, new RegExp(`WEEKLY SETS · WEEK ${week} · DELOAD`));
    assert.ok(!html.includes('BELOW MEV'));
  });
});
