// tools/insert-program.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateProgram, collectExistingIds } = require('./insert-program');
const valid = require('./fixtures/program-valid.json');

const clone = o => JSON.parse(JSON.stringify(o));

test('the fixture validates cleanly', () => {
  const errors = validateProgram(valid, collectExistingIds());
  assert.deepStrictEqual(errors, []);
});

test('missing top-level fields are reported', () => {
  const bad = clone(valid);
  delete bad.mesocycle;
  delete bad.protocolItems;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /mesocycle/.test(e)));
  assert.ok(errors.some(e => /protocolItems/.test(e)));
});

test('weekPhases length must equal totalWeeks', () => {
  const bad = clone(valid);
  bad.totalWeeks = 8;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases has 2 entries but totalWeeks is 8/.test(e)));
});

test('a day with no exercises is rejected', () => {
  const bad = clone(valid);
  bad.days[1].exercises = [];
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /day2.*no exercises/.test(e)));
});

test('incomplete exercises are rejected', () => {
  const bad = clone(valid);
  delete bad.days[0].exercises[0].restLabel;
  bad.days[0].exercises[1].rest = '75';
  bad.days[1].exercises[0].muscles = {};
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /restLabel/.test(e)));
  assert.ok(errors.some(e => /rest must be a number/.test(e)));
  assert.ok(errors.some(e => /muscles/.test(e)));
});

test('duplicate ids inside the program are rejected', () => {
  const bad = clone(valid);
  bad.days[1].exercises[0].id = 'm3_rope_pushdown';
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /duplicate id 'm3_rope_pushdown'/.test(e)));
});

test('collisions with existing app ids are rejected', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].id = 'incline_db_press';
  bad.alternatives = { 'm3_rope_pushdown': [{ id: 'alt_pec_deck', name: 'Pec Deck', note: 'x' }] };
  const errors = validateProgram(bad, collectExistingIds());
  assert.ok(errors.some(e => /'incline_db_press' already exists/.test(e)));
  assert.ok(errors.some(e => /'alt_pec_deck' already exists/.test(e)));
});

test('collectExistingIds covers program and alternative ids', () => {
  const ids = collectExistingIds();
  assert.ok(ids.has('incline_db_press'));
  assert.ok(ids.has('m2_cable_crunch'));
  assert.ok(ids.has('alt_pec_deck'));
});

// --- Hardening fixes (adversarial review) -----------------------------

test('fix2: non-array weekPhases/mesocycle/protocolItems are rejected explicitly', () => {
  const bad = clone(valid);
  bad.weekPhases = 'not an array';
  bad.mesocycle = { oops: true };
  bad.protocolItems = { oops: true };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases must be an array/.test(e)));
  assert.ok(errors.some(e => /mesocycle must be an array/.test(e)));
  assert.ok(errors.some(e => /protocolItems must be an array/.test(e)));
});

test('fix3: stray nulls are reported, never thrown', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].muscles = null;
  bad.days[1].exercises = [null];
  bad.days.push(null);
  assert.doesNotThrow(() => validateProgram(bad, new Set()));
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.length > 0);
  assert.ok(errors.some(e => /exercises\[0\] must be an object/.test(e)));
  assert.ok(errors.some(e => /days\[2\] must be an object/.test(e)));
});

test('fix4: malformed exercise ids are never silently skipped', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].id = '';
  bad.days[0].exercises[1].id = 42;
  bad.days[1].exercises[0].id = {};
  const errors = validateProgram(bad, new Set());
  assert.strictEqual(errors.filter(e => /id must be a non-empty string/.test(e)).length, 3);
});

test('fix5: duplicate day ids are rejected', () => {
  const bad = clone(valid);
  bad.days[1].id = 'day1';
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /duplicate day id 'day1'/.test(e)));
});

test('fix6: null (not just undefined) fields are treated as missing everywhere', () => {
  const bad = clone(valid);
  bad.days[0].label = null;
  bad.days[0].exercises[0].name = null;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /days\[0\] missing label/.test(e)));
  assert.ok(errors.some(e => /missing name/.test(e)));
});

test('fix7: totalWeeks must be a positive integer', () => {
  for (const badValue of ['2', 0, -1, 2.5]) {
    const bad = clone(valid);
    bad.totalWeeks = badValue;
    const errors = validateProgram(bad, new Set());
    assert.ok(errors.some(e => /totalWeeks must be a positive integer/.test(e)),
      `expected error for totalWeeks = ${JSON.stringify(badValue)}`);
  }
});

test('fix8: muscle credits and keys are validated', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].muscles = { chest: 0, front_delt: -0.5, made_up_muscle: 1.0, triceps: 'lots' };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /muscles\.chest must be a number in \(0, 1\]/.test(e)));
  assert.ok(errors.some(e => /muscles\.front_delt must be a number in \(0, 1\]/.test(e)));
  assert.ok(errors.some(e => /unknown muscle 'made_up_muscle'/.test(e)));
  assert.ok(errors.some(e => /muscles\.triceps must be a number in \(0, 1\]/.test(e)));
});

test('fix9: llp/compound must be real booleans, sets a positive number', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].llp = 'false';
  bad.days[0].exercises[0].compound = 'true';
  bad.days[0].exercises[1].sets = '3';
  bad.days[1].exercises[0].sets = 0;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /llp must be a boolean/.test(e)));
  assert.ok(errors.some(e => /compound must be a boolean/.test(e)));
  assert.ok(errors.filter(e => /sets must be a positive number/.test(e)).length === 2);
});

test('fix10: alternatives referencing a non-existent exercise id are rejected', () => {
  const bad = clone(valid);
  bad.alternatives = { 'm3_no_such_exercise': [{ id: 'm3_alt_ghost', name: 'Ghost', note: 'x' }] };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /no exercise with id 'm3_no_such_exercise' exists/.test(e)));
});
