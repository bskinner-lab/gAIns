// tools/analyze-history.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeExport, findNewestExport, perExercise, slopeOf,
  resolveMuscles, weeklyVolume, flagExercises, flagVolume, renderReport, analyze,
} = require('./analyze-history');
const muscleMap = require('./muscle-map.json');
const landmarks = require('./volume-landmarks.json');

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

test('normalizeExport handles v1 with currentWeek 0', () => {
  // currentWeek is falsy but a valid number — `raw.currentWeek &&` would wrongly
  // reject this as unrecognized.
  const n = normalizeExport({ currentWeek: 0, state: { day1: { sets: {}, weights: {} } } });
  assert.ok(n.programs.meso1.weeks['0'].day1);
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
  assert.strictEqual(raise.slots, 9);
  // Week 3's final slot is `false` (not yet attempted, not skipped) — the
  // in-progress week's untouched slot must not dilute skipRate, which is
  // completed+skipped, not slots.
  assert.strictEqual(raise.skipRate, 1);

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

test('resolveMuscles falls back to the original exercise', () => {
  // alt_pec_deck has no entry of its own; it stands in for machine_chest_press.
  assert.deepStrictEqual(
    resolveMuscles('alt_pec_deck', 'machine_chest_press', muscleMap),
    muscleMap['machine_chest_press']
  );
  assert.deepStrictEqual(
    resolveMuscles('incline_db_press', 'incline_db_press', muscleMap),
    muscleMap['incline_db_press']
  );
  assert.deepStrictEqual(resolveMuscles('nope', 'also_nope', muscleMap), {});
});

test('weeklyVolume credits completed sets only', () => {
  const vol = weeklyVolume(normalizeExport(v3), muscleMap).meso1;
  // incline_db_press: 4 sets x 3 weeks, chest credit 1.0 -> 4 sets/week
  // machine_chest_press (and its pec deck swap): 3 sets x 3 weeks -> 3 sets/week
  assert.ok(Math.abs(vol.chest - 7) < 1e-9);
  // cable_lat_raise_push was skipped every week, so side delts get nothing.
  assert.strictEqual(vol.side_delt || 0, 0);
});

test('flagExercises identifies rejected, substituted, stalled and under-stimulating work', () => {
  const stats = perExercise(normalizeExport(v3)).meso1;
  const flags = flagExercises(stats);
  // Skip-driven rejection: genuinely abandoned.
  assert.ok(flags.rejected.some(f => f.exId === 'cable_lat_raise_push'));
  // Swap-driven: the user consistently substitutes it, which is a "promote the
  // substitute" signal, not a "drop the muscle group" signal — separate bucket.
  assert.ok(!flags.rejected.some(f => f.exId === 'machine_chest_press'));
  assert.ok(flags.substituted.some(f => f.exId === 'machine_chest_press'));
  assert.ok(flags.underStimulating.some(f => f.exId === 'rope_pushdown'));
  assert.ok(!flags.rejected.some(f => f.exId === 'incline_db_press'));
});

test('flagVolume compares against landmarks', () => {
  const flags = flagVolume({ chest: 7, side_delt: 0, biceps: 40 }, landmarks);
  assert.ok(flags.below.some(f => f.muscle === 'side_delt'));
  assert.ok(flags.below.some(f => f.muscle === 'chest'));
  assert.ok(flags.above.some(f => f.muscle === 'biceps'));
});

test('renderReport emits the expected sections', () => {
  const md = renderReport(analyze(v3, muscleMap, landmarks));
  for (const heading of ['## Adherence', '## Per exercise', '## Weekly volume by muscle', '## Flags']) {
    assert.ok(md.includes(heading), `missing ${heading}`);
  }
});

test('renderReport flags an in-progress final week', () => {
  // Week 3 in the fixture has a `false` (not-yet-attempted) slot on
  // cable_lat_raise_push — the report should call out that the snapshot is
  // mid-block, since that changes how the skip rates should be read.
  const md = renderReport(analyze(v3, muscleMap, landmarks));
  assert.match(md, /Week 3 is in progress; its unattempted sets are excluded from skip rates\./);
});

test('renderReport gives swap-driven rejections their own bucket', () => {
  const md = renderReport(analyze(v3, muscleMap, landmarks));
  assert.match(md, /Substitute promoted/i);
  // machine_chest_press must appear under the substitute bucket, not "Rejected".
  const rejectedSection = md.slice(md.indexOf('### Rejected'), md.indexOf('### Substitute'));
  assert.ok(!rejectedSection.includes('machine_chest_press'));
});

test('weeklyVolume ignores weeks that were merely visited, not trained', () => {
  // initState() in the app calls saveState() unconditionally on visit, so an
  // opened-but-untouched week writes an all-false sets blob. That week must
  // not dilute the average — it contributed zero completed sets.
  const withVisitedWeek = JSON.parse(JSON.stringify(v3));
  withVisitedWeek.programs.meso1.weeks['4'] = {
    day1: {
      sets: {
        incline_db_press: [false, false, false, false],
        machine_chest_press: [false, false, false],
        cable_lat_raise_push: [false, false, false],
        rope_pushdown: [false, false, false],
      },
      weights: {},
      effort: {},
      protocol: [],
      swaps: {},
    },
  };
  const before = weeklyVolume(normalizeExport(v3), muscleMap).meso1;
  const after = weeklyVolume(normalizeExport(withVisitedWeek), muscleMap).meso1;
  assert.ok(Math.abs(before.chest - after.chest) < 1e-9, `${before.chest} !== ${after.chest}`);
  assert.ok(Math.abs(after.chest - 7) < 1e-9);
});

test('flagVolume exposes a per-muscle status that renderReport reuses', () => {
  const flags = flagVolume({ chest: 7, side_delt: 0, biceps: 40, triceps: 8 }, landmarks);
  assert.strictEqual(flags.statuses.chest, 'BELOW MEV');
  assert.strictEqual(flags.statuses.biceps, 'ABOVE MRV');
  assert.strictEqual(flags.statuses.triceps, 'below MAV');
  const md = renderReport(analyze(v3, muscleMap, landmarks));
  assert.match(md, /\| chest \| 7 \| 8 \| 12–20 \| 22 \| BELOW MEV \|/);
});
