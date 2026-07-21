// tools/analyze-history.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeExport, findNewestExport, perExercise, slopeOf,
} = require('./analyze-history');

const v3 = require('./fixtures/export-v3.json');
const v2 = require('./fixtures/export-v2.json');

test('normalizeExport handles v3', () => {
  const n = normalizeExport(v3);
  assert.deepStrictEqual(Object.keys(n.programs), ['meso1']);
  assert.deepStrictEqual(Object.keys(n.programs.meso1.weeks), ['1', '2', '3']);
});

test('normalizeExport attributes v2 to meso1', () => {
  const n = normalizeExport(v2);
  assert.deepStrictEqual(Object.keys(n.programs), ['meso1']);
  assert.ok(n.programs.meso1.weeks['1'].day1);
});

test('normalizeExport handles v1', () => {
  const n = normalizeExport({ currentWeek: 1, state: { day1: { sets: {}, weights: {} } } });
  assert.ok(n.programs.meso1.weeks['1'].day1);
});

test('normalizeExport rejects garbage', () => {
  assert.throws(() => normalizeExport({ hello: 'world' }), /unrecognized export/i);
});

test('slopeOf computes least-squares slope', () => {
  assert.strictEqual(slopeOf([[1, 60], [2, 65], [3, 70]]), 5);
  assert.strictEqual(slopeOf([[1, 100], [2, 100], [3, 100]]), 0);
  assert.strictEqual(slopeOf([[1, 60]]), null);
});

test('perExercise reports adherence, progression, effort and swaps', () => {
  const stats = perExercise(normalizeExport(v3));

  const press = stats['meso1']['incline_db_press'];
  assert.strictEqual(press.completed, 12);
  assert.strictEqual(press.skipped, 0);
  assert.strictEqual(press.weeksTouched, 3);
  assert.strictEqual(press.firstWeight, 60);
  assert.strictEqual(press.lastWeight, 70);
  assert.strictEqual(press.slope, 5);
  assert.deepStrictEqual(press.effortCounts, { low: 0, medium: 2, high: 1 });

  const raise = stats['meso1']['cable_lat_raise_push'];
  assert.strictEqual(raise.completed, 0);
  assert.strictEqual(raise.skipped, 8);
  assert.ok(Math.abs(raise.skipRate - 8 / 9) < 1e-9);

  const machine = stats['meso1']['machine_chest_press'];
  assert.strictEqual(machine.slope, 0);
  assert.deepStrictEqual(machine.swappedTo, { alt_pec_deck: 2 });
});

test('findNewestExport picks the newest json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gains-'));
  assert.strictEqual(findNewestExport(dir), null);
  fs.writeFileSync(path.join(dir, 'old.json'), '{}');
  fs.writeFileSync(path.join(dir, 'new.json'), '{}');
  fs.utimesSync(path.join(dir, 'old.json'), new Date(1000), new Date(1000));
  assert.strictEqual(path.basename(findNewestExport(dir)), 'new.json');
});
