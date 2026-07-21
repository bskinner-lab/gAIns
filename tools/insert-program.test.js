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
