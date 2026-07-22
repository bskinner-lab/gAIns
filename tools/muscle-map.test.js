// tools/muscle-map.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');
const muscleMap = require('./muscle-map.json');
const landmarks = require('./volume-landmarks.json');

// Every program exercise needs a muscle profile from EITHER source — the
// map (legacy meso1/meso2 ids) or its own inline `muscles` field (generated
// programs, meso3+, carry credits on the exercise itself; see
// `resolveMuscles`/`buildInlineMuscleIndex` in analyze-history.js). Neither
// source is privileged here: an exercise carrying inline credits is not a
// gap, only an exercise with NEITHER is.
test('every program exercise is mapped', () => {
  const { PROGRAMS } = loadApp();
  const missing = [];
  for (const prog of PROGRAMS) {
    for (const day of prog.days) {
      for (const ex of day.exercises) {
        if (!muscleMap[ex.id] && !ex.muscles) missing.push(`${prog.id}/${day.id}/${ex.id}`);
      }
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('every mapped or inline muscle has landmarks', () => {
  const { PROGRAMS } = loadApp();
  const unknown = new Set();
  for (const credits of Object.values(muscleMap)) {
    for (const muscle of Object.keys(credits)) {
      if (!landmarks[muscle]) unknown.add(muscle);
    }
  }
  for (const prog of PROGRAMS) {
    for (const day of prog.days) {
      for (const ex of day.exercises) {
        for (const muscle of Object.keys(ex.muscles || {})) {
          if (!landmarks[muscle]) unknown.add(muscle);
        }
      }
    }
  }
  assert.deepStrictEqual([...unknown], []);
});

test('credits are in (0, 1]', () => {
  const { PROGRAMS } = loadApp();
  for (const [exId, credits] of Object.entries(muscleMap)) {
    for (const [muscle, value] of Object.entries(credits)) {
      assert.ok(typeof value === 'number' && value > 0 && value <= 1,
        `${exId}.${muscle} = ${value}`);
    }
  }
  for (const prog of PROGRAMS) {
    for (const day of prog.days) {
      for (const ex of day.exercises) {
        for (const [muscle, value] of Object.entries(ex.muscles || {})) {
          assert.ok(typeof value === 'number' && value > 0 && value <= 1,
            `${prog.id}/${day.id}/${ex.id}.${muscle} = ${value}`);
        }
      }
    }
  }
});

test('landmarks are ordered mev <= mavLow <= mavHigh <= mrv', () => {
  for (const [muscle, l] of Object.entries(landmarks)) {
    assert.ok(l.mev <= l.mavLow, `${muscle}: mev > mavLow`);
    assert.ok(l.mavLow <= l.mavHigh, `${muscle}: mavLow > mavHigh`);
    assert.ok(l.mavHigh <= l.mrv, `${muscle}: mavHigh > mrv`);
  }
});
