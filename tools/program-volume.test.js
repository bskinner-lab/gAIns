// tools/program-volume.test.js
//
// Weekly set volume for the meso3 block, week by week.
//
// Today every exercise carries a single static `sets` count that applies to all
// eight weeks: no progressive overload, and the week-8 "Deload" phase is a
// deload in name only. These tests pin the ramp that fixes that. They read the
// prescribed count through `app.setsForWeek(ex, week, prog)`:
//
//   - `ex.ramp` is sparse. Its keys are the weeks where the count CHANGES and
//     its values are the ABSOLUTE count from that week until the next key.
//     Weeks below the lowest key fall back to `ex.sets`; an exercise with no
//     `ramp` at all is `ex.sets` in every week.
//   - A week whose phase carries `deload: true` halves the ramped value:
//     `Math.max(1, Math.floor(n / 2))`.
//
// Weekly volume for a muscle is the sum over every exercise of
// `setsForWeek(...) * credit`, where the credit comes from the exercise's own
// inline `muscles` map (1 = direct, 0.5 = secondary). Only meso3 carries those
// maps — meso1/meso2 exercises have none, so the per-muscle helper skips them
// and the meso1/meso2 test below works off totals alone.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');
const landmarks = require('./volume-landmarks.json');

// One eval of the app script for the whole file. Safe here because this is a
// pure data-assertion suite: nothing below calls back into the app's renderer,
// so `loadApp` (which tears the DOM shim down before returning) is the right
// harness, and re-evaluating index.html once per assertion would be wasteful.
const app = loadApp();
const MESO1 = app.PROGRAMS[0];
const MESO2 = app.PROGRAMS[1];
const MESO3 = app.PROGRAMS[2];
const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8];

// ── The oracle ───────────────────────────────────────────────────────────────
// Prescribed meso3 volume for weeks 1–7. Week 8 is the deload; it is asserted
// as a band relative to week 7 rather than pinned to exact counts, so that the
// implementation is free to land the per-exercise halving wherever the integer
// floor puts it.
const ORACLE = [
  { week: 1, total: 102, side_delt: 13, calves: 8,  chest: 11.5, rear_delt: 9,  lats: 12.5, upper_back: 13, abs: 6, biceps: 14.5 },
  { week: 2, total: 102, side_delt: 13, calves: 8,  chest: 11.5, rear_delt: 9,  lats: 12.5, upper_back: 13, abs: 6, biceps: 14.5 },
  { week: 3, total: 108, side_delt: 15, calves: 10, chest: 12.5, rear_delt: 10, lats: 12.5, upper_back: 13, abs: 6, biceps: 14.5 },
  { week: 4, total: 108, side_delt: 15, calves: 10, chest: 12.5, rear_delt: 10, lats: 12.5, upper_back: 13, abs: 6, biceps: 14.5 },
  { week: 5, total: 114, side_delt: 17, calves: 12, chest: 12.5, rear_delt: 10, lats: 14.5, upper_back: 14, abs: 6, biceps: 15.5 },
  { week: 6, total: 114, side_delt: 17, calves: 12, chest: 12.5, rear_delt: 10, lats: 14.5, upper_back: 14, abs: 6, biceps: 15.5 },
  { week: 7, total: 119, side_delt: 19, calves: 13, chest: 12.5, rear_delt: 10, lats: 14.5, upper_back: 14, abs: 8, biceps: 15.5 },
];
const MUSCLE_COLUMNS = Object.keys(ORACLE[0]).filter(k => k !== 'week' && k !== 'total');
const RAMPED_WEEKS = ORACLE.map(r => r.week); // 1–7; week 8 is the deload

// Deload band: week 8 must land at 40–50% of week 7, i.e. the 50–60% volume cut
// the Plan tab prescribes.
const DELOAD_MIN_FRACTION = 0.40;
const DELOAD_MAX_FRACTION = 0.50;

// ── Helper ───────────────────────────────────────────────────────────────────
/**
 * Walk a program for one week and add up prescribed sets.
 * @returns {{ total: number, byMuscle: Record<string, number> }}
 */
function weekVolume(prog, week) {
  assert.strictEqual(typeof app.setsForWeek, 'function',
    'app.setsForWeek is not a function — the per-week set count function is ' +
    'missing from index.html (or is not exported by tools/app-shim.js)');
  let total = 0;
  const byMuscle = {};
  for (const day of prog.days) {
    for (const ex of day.exercises) {
      const count = app.setsForWeek(ex, week, prog);
      assert.ok(Number.isInteger(count) && count > 0,
        `${prog.id}/${day.id}/${ex.id}: setsForWeek(week ${week}) returned ` +
        `${count}, expected a positive integer`);
      total += count;
      // meso1/meso2 exercises carry no inline `muscles` map — skip, don't crash.
      for (const [muscle, credit] of Object.entries(ex.muscles || {})) {
        byMuscle[muscle] = (byMuscle[muscle] || 0) + count * credit;
      }
    }
  }
  return { total, byMuscle };
}

// Credits are 1 and 0.5 (both exact in binary floating point), so sums are
// exact today. Compare with a tolerance anyway so that adding a 1/3-style
// credit later surfaces as a real volume regression, not float dust.
function closeTo(actual, expected) {
  return Math.abs(actual - expected) < 1e-9;
}

// ── 1. Per-week totals ───────────────────────────────────────────────────────
for (const row of ORACLE) {
  test(`meso3 week ${row.week} prescribes ${row.total} total sets`, () => {
    const { total } = weekVolume(MESO3, row.week);
    assert.strictEqual(total, row.total,
      `meso3 week ${row.week}: expected ${row.total} total sets, got ${total}`);
  });
}

// ── 2. Per-muscle, per-week ──────────────────────────────────────────────────
for (const muscle of MUSCLE_COLUMNS) {
  test(`meso3 ${muscle} volume follows the ramp across weeks 1–7`, () => {
    for (const row of ORACLE) {
      const { byMuscle } = weekVolume(MESO3, row.week);
      const actual = byMuscle[muscle] || 0;
      assert.ok(closeTo(actual, row[muscle]),
        `meso3 ${muscle} in week ${row.week}: expected ${row[muscle]} sets, got ${actual}`);
    }
  });
}

// ── 3. Deload band ───────────────────────────────────────────────────────────
test('meso3 week 8 deload cuts total volume to 40–50% of week 7', () => {
  const week7 = weekVolume(MESO3, 7).total;
  const week8 = weekVolume(MESO3, 8).total;
  const fraction = week8 / week7;
  assert.ok(fraction >= DELOAD_MIN_FRACTION,
    `meso3 week 8: ${week8} sets is ${(fraction * 100).toFixed(1)}% of week 7 ` +
    `(${week7} sets) — below the ${DELOAD_MIN_FRACTION * 100}% floor, the deload cuts too deep`);
  assert.ok(fraction <= DELOAD_MAX_FRACTION,
    `meso3 week 8: ${week8} sets is ${(fraction * 100).toFixed(1)}% of week 7 ` +
    `(${week7} sets) — above the ${DELOAD_MAX_FRACTION * 100}% ceiling, that is not a deload`);
});

// ── 4. The deload cuts every muscle ──────────────────────────────────────────
// Structural, and deliberately independent of the oracle numbers: whatever the
// ramp does, no muscle may come out of the deload week carrying more volume
// than it did in week 1.
test('meso3 week 8 deload leaves no muscle above its week 1 volume', () => {
  const week1 = weekVolume(MESO3, 1).byMuscle;
  const week8 = weekVolume(MESO3, 8).byMuscle;
  for (const muscle of Object.keys(week1)) {
    const before = week1[muscle];
    const after = week8[muscle] || 0;
    assert.ok(after <= before,
      `meso3 ${muscle}: week 8 (deload) has ${after} sets vs ${before} in week 1 — ` +
      `the deload must not add volume`);
  }
});

// ── 5. MRV guard ─────────────────────────────────────────────────────────────
// The safety rail on the whole ramp: no week may push a muscle past its
// maximum recoverable volume.
test('no meso3 muscle exceeds its MRV in any week', () => {
  for (const week of WEEKS) {
    const { byMuscle } = weekVolume(MESO3, week);
    for (const [muscle, volume] of Object.entries(byMuscle)) {
      const landmark = landmarks[muscle];
      assert.ok(landmark,
        `meso3 week ${week}: muscle "${muscle}" has no entry in volume-landmarks.json`);
      assert.ok(volume <= landmark.mrv,
        `meso3 ${muscle} in week ${week}: ${volume} sets exceeds MRV of ${landmark.mrv}`);
    }
  }
});

// ── 6. Monotonic ramp ────────────────────────────────────────────────────────
// Structural: volume may hold flat or climb across the accumulation weeks, but
// it may never fall. Week 8 is exempt — it is the deload.
test('meso3 volume never decreases week over week across weeks 1–7', () => {
  for (let i = 1; i < RAMPED_WEEKS.length; i++) {
    const prevWeek = RAMPED_WEEKS[i - 1];
    const week = RAMPED_WEEKS[i];
    const prev = weekVolume(MESO3, prevWeek);
    const cur = weekVolume(MESO3, week);
    assert.ok(cur.total >= prev.total,
      `meso3 total: week ${week} has ${cur.total} sets, down from ${prev.total} in week ${prevWeek}`);
    for (const [muscle, volume] of Object.entries(prev.byMuscle)) {
      const next = cur.byMuscle[muscle] || 0;
      assert.ok(next >= volume,
        `meso3 ${muscle}: week ${week} has ${next} sets, down from ${volume} in week ${prevWeek}`);
    }
  }
});

// ── 7. meso1 and meso2 stay flat ─────────────────────────────────────────────
// Scope guard: only meso3 gets a ramp. The older blocks keep their static set
// counts in every week — including week 8, so whatever marks meso3's deload
// phase must not be applied to theirs. Totals only: these programs carry no
// inline `muscles` maps, so there is no per-muscle breakdown to compare.
for (const prog of [MESO1, MESO2]) {
  test(`${prog.id} total set volume is identical across all 8 weeks`, () => {
    const baseline = weekVolume(prog, 1).total;
    for (const week of WEEKS) {
      const { total } = weekVolume(prog, week);
      assert.strictEqual(total, baseline,
        `${prog.id} week ${week}: ${total} total sets, expected ${baseline} ` +
        `(same as week 1) — only meso3 is meant to ramp or deload`);
    }
  });
}
