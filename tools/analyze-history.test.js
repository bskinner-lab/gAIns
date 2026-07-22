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
  toNumber, buildLegacyIdMap, migrateLegacyState, isLegacyDayState, excludeLegacyState,
  buildAltReverseMap, resolveDaySlots, pickDominantVariant, dominantVariantOf,
} = require('./analyze-history');
const muscleMap = require('./muscle-map.json');
const landmarks = require('./volume-landmarks.json');
const { loadApp } = require('./app-shim');

const v3 = require('./fixtures/export-v3.json');
const v2 = require('./fixtures/export-v2.json');

// The real PROGRAMS array — legacy-key migration must be tested against the
// actual day/exercise ordering the app ships, not a hand-rolled stand-in.
const { PROGRAMS } = loadApp();

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

// ── inline muscle credits (generated programs, meso3+) ──────────────────
//
// Generated programs carry their muscle credits directly on each exercise
// (`ex.muscles`) rather than in muscle-map.json — the map only ever covered
// meso1/meso2's hand-written ids. `resolveMuscles`/`weeklyVolume` must
// consult the inline profile first, without disturbing legacy resolution.

/** A one-day, one-week v3 export for `progId`, with the given day's `sets`. */
function inlineExport(progId, dayId, sets) {
  return { version: 3, programs: { [progId]: { currentWeek: 1, weeks: { 1: { [dayId]: { sets, weights: {}, effort: {}, protocol: [], swaps: {} } } } } } };
}

test('resolveMuscles uses the inline profile when there is no map entry', () => {
  const inlineMuscles = { m3_incline_db_press: { chest: 1, front_delt: 0.5, triceps: 0.5 } };
  assert.strictEqual(muscleMap.m3_incline_db_press, undefined);
  assert.deepStrictEqual(
    resolveMuscles('m3_incline_db_press', 'm3_incline_db_press', muscleMap, inlineMuscles),
    { chest: 1, front_delt: 0.5, triceps: 0.5 }
  );
});

test('resolveMuscles prefers the inline profile over a map entry for the same id', () => {
  const clashId = 'incline_db_press'; // real meso1 id, real map entry
  const inlineMuscles = { [clashId]: { chest: 0.42 } };
  assert.notDeepStrictEqual(muscleMap[clashId], { chest: 0.42 }); // sanity: sources actually differ
  assert.deepStrictEqual(
    resolveMuscles(clashId, clashId, muscleMap, inlineMuscles),
    { chest: 0.42 }
  );
});

test('legacy meso1/meso2 exercises with no inline profile still resolve via muscle-map.json', () => {
  // Regression guard: an empty/undefined inlineMuscles index must not break
  // the map fallback that legacy programs depend on.
  assert.deepStrictEqual(
    resolveMuscles('incline_db_press', 'incline_db_press', muscleMap, {}),
    muscleMap.incline_db_press
  );
  assert.deepStrictEqual(
    resolveMuscles('alt_pec_deck', 'machine_chest_press', muscleMap, undefined),
    muscleMap.machine_chest_press
  );
});

test('weeklyVolume credits a generated program exercise via its inline muscles', () => {
  const { PROGRAMS } = loadApp();
  const raw = inlineExport('meso3', 'day1', {
    m3_incline_db_press: [true, true, true, true],
  });
  const withoutPrograms = weeklyVolume(normalizeExport(raw), muscleMap).meso3;
  assert.deepStrictEqual(withoutPrograms, {}); // old behavior: zero credit, nothing to resolve it
  const withPrograms = weeklyVolume(normalizeExport(raw), muscleMap, undefined, PROGRAMS).meso3;
  // m3_incline_db_press: chest 1, front_delt 0.5, triceps 0.5; 4 completed sets.
  assert.ok(Math.abs(withPrograms.chest - 4) < 1e-9);
  assert.ok(Math.abs(withPrograms.front_delt - 2) < 1e-9);
  assert.ok(Math.abs(withPrograms.triceps - 2) < 1e-9);
});

test('a generated alternative swapped into a generated slot inherits the original exercise\'s inline profile', () => {
  const { PROGRAMS, EXERCISE_ALTERNATIVES } = loadApp();
  // m3_alt_pec_deck is a swap target for m3_machine_chest_press and carries no
  // inline `muscles` of its own — same "generated alt has no profile" shape
  // as the legacy alt_* case, just for a generated program.
  const alt = EXERCISE_ALTERNATIVES.m3_machine_chest_press.find(a => a.id === 'm3_alt_pec_deck');
  assert.ok(alt, 'fixture assumption: m3_alt_pec_deck exists as an alternative to m3_machine_chest_press');
  const original = PROGRAMS.find(p => p.id === 'meso3').days.find(d => d.id === 'day1')
    .exercises.find(e => e.id === 'm3_machine_chest_press');
  assert.ok(original.muscles && Object.keys(original.muscles).length, 'fixture assumption: original has an inline profile');

  const raw = inlineExport('meso3', 'day1', { m3_alt_pec_deck: [true, true, true] });
  raw.programs.meso3.weeks['1'].day1.swaps = { m3_machine_chest_press: 'm3_alt_pec_deck' };
  const vol = weeklyVolume(normalizeExport(raw), muscleMap, EXERCISE_ALTERNATIVES, PROGRAMS).meso3;
  for (const [muscle, credit] of Object.entries(original.muscles)) {
    assert.ok(Math.abs((vol[muscle] || 0) - 3 * credit) < 1e-9, `${muscle}: ${vol[muscle]} !== ${3 * credit}`);
  }
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

// ── toNumber ───────────────────────────────────────────────────────

test('toNumber accepts real numbers and numeric strings, including decimals', () => {
  assert.strictEqual(toNumber(135), 135);
  assert.strictEqual(toNumber('135'), 135);
  assert.strictEqual(toNumber('47.5'), 47.5);
  assert.strictEqual(toNumber(0), 0);
  assert.strictEqual(toNumber('0'), 0);
});

test('toNumber rejects junk without throwing or producing NaN', () => {
  for (const junk of ['', 'abc', null, undefined, NaN, Infinity, '  ', {}, []]) {
    const n = toNumber(junk);
    assert.strictEqual(n, null, `expected null for ${JSON.stringify(junk)}, got ${n}`);
  }
});

// ── legacy index-key migration ────────────────────────────────────

test('buildLegacyIdMap maps each day\'s exercise order to real ids, per program', () => {
  const map = buildLegacyIdMap(PROGRAMS);
  assert.deepStrictEqual(map.meso1.day3['0'], 'squat');
  assert.deepStrictEqual(map.meso1.day3['1'], 'rdl');
  assert.deepStrictEqual(map.meso1.day1['0'], 'incline_db_press');
  // meso2 has a different day3 order entirely — the map must be per-program,
  // not a single global index->id table.
  assert.deepStrictEqual(map.meso2.day3['0'], 'm2_ssb_squat');
  assert.deepStrictEqual(map.meso2.day3['1'], 'm2_rdl');
});

test('migrateLegacyState remaps a numeric-keyed day to the right ids for that day', () => {
  const normalized = {
    programs: {
      meso1: {
        weeks: {
          1: {
            day3: {
              sets: { 0: [true, true], 1: [true, true] },
              weights: { 0: '135', 1: '205' },
              effort: { 0: 'high', 1: 'medium' },
              swaps: {},
            },
          },
        },
        currentWeek: 1,
      },
    },
  };
  migrateLegacyState(normalized, PROGRAMS);
  const day3 = normalized.programs.meso1.weeks[1].day3;
  assert.deepStrictEqual(Object.keys(day3.sets).sort(), ['rdl', 'squat']);
  assert.strictEqual(day3.weights.squat, '135');
  assert.strictEqual(day3.weights.rdl, '205');
  assert.strictEqual(day3.effort.squat, 'high');
});

test('migrateLegacyState leaves an id-keyed day alone even when another day in the same week is numeric-keyed', () => {
  const normalized = {
    programs: {
      meso1: {
        weeks: {
          1: {
            day3: {
              sets: { 0: [true], 1: [true] },
              weights: { 0: '135', 1: '205' },
              effort: {},
              swaps: {},
            },
            day1: {
              sets: { incline_db_press: [true, true] },
              weights: { incline_db_press: '60' },
              effort: { incline_db_press: 'medium' },
              swaps: {},
            },
          },
        },
        currentWeek: 1,
      },
    },
  };
  migrateLegacyState(normalized, PROGRAMS);
  const week1 = normalized.programs.meso1.weeks[1];
  assert.deepStrictEqual(Object.keys(week1.day3.sets).sort(), ['rdl', 'squat']);
  // day1 was already id-keyed — migrateLegacyState must not touch it.
  assert.deepStrictEqual(week1.day1.sets, { incline_db_press: [true, true] });
  assert.strictEqual(week1.day1.weights.incline_db_press, '60');
});

test('migrateLegacyState re-keys per-set weight entries through the same index map', () => {
  const normalized = {
    programs: {
      meso1: {
        weeks: {
          1: {
            day3: {
              sets: { 1: [true, true, true] },
              weights: { '1_2': '210' },
              effort: {},
              swaps: {},
            },
          },
        },
        currentWeek: 1,
      },
    },
  };
  migrateLegacyState(normalized, PROGRAMS);
  const weights = normalized.programs.meso1.weeks[1].day3.weights;
  assert.strictEqual(weights.rdl_2, '210');
  assert.ok(!('1_2' in weights));
});

test('migrateLegacyState drops indices that don\'t map to an exercise in that day, without throwing', () => {
  const normalized = {
    programs: {
      meso1: {
        weeks: {
          1: {
            day3: {
              // day3 only has indices 0-6; 99 is out of range.
              sets: { 0: [true], 99: [true] },
              weights: { 0: '135', 99: '999', '99_0': '999' },
              effort: { 99: 'high' },
              swaps: {},
            },
          },
        },
        currentWeek: 1,
      },
    },
  };
  assert.doesNotThrow(() => migrateLegacyState(normalized, PROGRAMS));
  const day3 = normalized.programs.meso1.weeks[1].day3;
  assert.deepStrictEqual(Object.keys(day3.sets), ['squat']);
  assert.deepStrictEqual(Object.keys(day3.weights), ['squat']);
  assert.deepStrictEqual(Object.keys(day3.effort), []);
});

test('regression: numeric-key weeks no longer surface as exercises literally named 0-6', () => {
  const normalized = {
    programs: {
      meso1: {
        weeks: {
          1: {
            day1: {
              sets: { 0: [true], 1: [true], 2: [true], 3: [true], 4: [true], 5: [true], 6: [true] },
              weights: {},
              effort: {},
              swaps: {},
            },
          },
        },
        currentWeek: 1,
      },
    },
  };
  const stats = perExercise(normalized).meso1;
  assert.deepStrictEqual(Object.keys(stats).sort(), ['0', '1', '2', '3', '4', '5', '6']);

  migrateLegacyState(normalized, PROGRAMS);
  const migratedStats = perExercise(normalized).meso1;
  for (const bogus of ['0', '1', '2', '3', '4', '5', '6']) {
    assert.ok(!(bogus in migratedStats), `bogus exercise "${bogus}" survived migration`);
  }
  assert.deepStrictEqual(
    Object.keys(migratedStats).sort(),
    ['cable_chest_fly', 'cable_lat_raise_push', 'incline_db_press', 'machine_chest_press', 'overhead_cable_ext', 'rope_pushdown', 'seated_db_press'].sort()
  );
});

test('analyze() excludes legacy index-keyed weeks entirely rather than migrating them', () => {
  // Bug: migrating a legacy week against the CURRENT program order silently
  // fabricates numbers when that order has changed since the week was
  // logged (see the comment on excludeLegacyState — meso1 day4's real
  // close_grip_bench insertion is the proof). So these weeks must be
  // dropped, not remapped: no `squat` row, no `0` row, and week 1 absent
  // from the program's week list and adherence totals.
  const raw = {
    version: 3,
    programs: {
      meso1: {
        currentWeek: 2,
        weeks: {
          1: { day3: { sets: { 0: [true] }, weights: { 0: '135' }, effort: {}, swaps: {} } },
          2: { day3: { sets: { squat: [true] }, weights: { squat: '155' }, effort: {}, swaps: {} } },
        },
      },
    },
  };
  const result = analyze(raw, muscleMap, landmarks);
  assert.ok(!('0' in result.programs.meso1.stats), 'literal index "0" must never surface as an exercise');
  assert.deepStrictEqual(result.programs.meso1.weeks, [2]);
  assert.strictEqual(result.programs.meso1.stats.squat.completed, 1);
  assert.strictEqual(result.programs.meso1.stats.squat.firstWeight, 155);
  assert.deepStrictEqual(result.excluded.meso1, [{ week: 1, days: ['day3'] }]);
});

// ── legacy-week exclusion (Bug A) ─────────────────────────────────

test('isLegacyDayState detects index-only keys and leaves id-keyed/empty days alone', () => {
  assert.strictEqual(isLegacyDayState({ sets: { 0: [true], 1: [true] } }), true);
  assert.strictEqual(isLegacyDayState({ sets: { squat: [true] } }), false);
  assert.strictEqual(isLegacyDayState({ sets: {} }), false);
  assert.strictEqual(isLegacyDayState({}), false);
  assert.strictEqual(isLegacyDayState(null), false);
});

test('excludeLegacyState drops only legacy day-entries, keeping id-keyed days in the same week', () => {
  const normalized = {
    programs: {
      meso1: {
        currentWeek: 1,
        weeks: {
          1: {
            day3: { sets: { 0: [true], 1: [true] }, weights: {}, effort: {}, swaps: {} },
            day1: { sets: { incline_db_press: [true] }, weights: {}, effort: {}, swaps: {} },
          },
        },
      },
    },
  };
  const { normalized: cleaned, excluded } = excludeLegacyState(normalized);
  assert.deepStrictEqual(Object.keys(cleaned.programs.meso1.weeks[1]), ['day1']);
  assert.deepStrictEqual(excluded.meso1, [{ week: 1, day: 'day3' }]);
});

test('excludeLegacyState drops a week entirely once every day-entry in it is legacy', () => {
  const normalized = {
    programs: {
      meso1: {
        currentWeek: 1,
        weeks: {
          1: { day3: { sets: { 0: [true] }, weights: {}, effort: {}, swaps: {} } },
        },
      },
    },
  };
  const { normalized: cleaned } = excludeLegacyState(normalized);
  assert.deepStrictEqual(cleaned.programs.meso1.weeks, {});
});

test('a mixed export (one legacy week, one id-keyed week) only lets the id-keyed week contribute', () => {
  const raw = {
    version: 3,
    programs: {
      meso1: {
        currentWeek: 2,
        weeks: {
          1: {
            day1: {
              sets: { 0: [true, true], 1: ['skipped'] },
              weights: {}, effort: {}, swaps: {},
            },
          },
          2: {
            day1: {
              sets: { incline_db_press: [true, true, true, true] },
              weights: { incline_db_press: 65 },
              effort: {}, swaps: {},
            },
          },
        },
      },
    },
  };
  const result = analyze(raw, muscleMap, landmarks);
  assert.deepStrictEqual(result.programs.meso1.weeks, [2]);
  assert.strictEqual(result.programs.meso1.completed, 4);
  assert.strictEqual(result.programs.meso1.skipped, 0);
  assert.strictEqual(result.programs.meso1.slots, 4);
});

test('renderReport names each excluded program/week loudly, near the top', () => {
  const raw = {
    version: 3,
    programs: {
      meso1: {
        currentWeek: 1,
        weeks: { 1: { day1: { sets: { 0: [true] }, weights: {}, effort: {}, swaps: {} } } },
      },
    },
  };
  const md = renderReport(analyze(raw, muscleMap, landmarks));
  assert.match(md, /Excluded weeks/);
  assert.match(md, /\| meso1 \| 1 \| day1 \|/);
  assert.ok(md.indexOf('Excluded weeks') < md.indexOf('## Adherence'), 'exclusion block should come before Adherence');
});

test('renderReport says nothing about exclusions when there are none', () => {
  const md = renderReport(analyze(v3, muscleMap, landmarks));
  assert.doesNotMatch(md, /Excluded weeks/);
});

// ── swap merging (Bug B) ───────────────────────────────────────────
//
// Real shape, straight from the user's export: once a swap is live,
// `sets`/`weights`/`effort` are keyed by the SUBSTITUTE id (mirrors
// performSwap() in index.html), while `swaps` itself stays keyed by the
// ORIGINAL id. A stale `weights[originalId]` entry can also linger from
// before the swap.

function swapExport(weeksSpec) {
  const weeks = {};
  for (const [w, spec] of Object.entries(weeksSpec)) {
    weeks[w] = { day3: { protocol: [], ...spec } };
  }
  return { version: 3, programs: { meso2: { currentWeek: Object.keys(weeksSpec).length, weeks } } };
}

test('a swapped slot merges into ONE row under the original id, with swappedTo populated', () => {
  const raw = swapExport({
    1: {
      sets: { m2_ssb_squat: [true, true] },
      weights: { m2_ssb_squat: '45' },
      effort: {}, swaps: {},
    },
    2: {
      sets: { alt_m2_hack_squat: [true, true] },
      weights: { m2_ssb_squat: '45', alt_m2_hack_squat: '155' },
      effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' },
    },
  });
  const stats = perExercise(normalizeExport(raw)).meso2;
  assert.ok(stats.m2_ssb_squat, 'the merged row lives under the original id');
  assert.ok(!stats.alt_m2_hack_squat, 'the substitute must not get its own row');
  assert.strictEqual(stats.m2_ssb_squat.completed, 4);
  assert.strictEqual(stats.m2_ssb_squat.weeksTouched, 2);
  assert.deepStrictEqual(stats.m2_ssb_squat.swappedTo, { alt_m2_hack_squat: 1 });
});

test('when both original and substitute carry a weight in the same week, the substitute wins — no phantom point', () => {
  const raw = swapExport({
    1: {
      sets: { alt_m2_hack_squat: [true] },
      // A stale entry under the original alongside the real one under the
      // substitute — exactly the shape seen in the real export.
      weights: { m2_ssb_squat: '45', alt_m2_hack_squat: '155' },
      effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' },
    },
  });
  const stats = perExercise(normalizeExport(raw)).meso2;
  assert.deepStrictEqual(stats.m2_ssb_squat.variants.alt_m2_hack_squat.weightPoints, [[1, 155]]);
  assert.strictEqual(stats.m2_ssb_squat.lastWeight, 155);
});

test('flagExercises puts a swap-driven slot in substituted, not rejected or absent', () => {
  const raw = swapExport({
    1: { sets: { alt_m2_hack_squat: [true, true] }, weights: {}, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    2: { sets: { alt_m2_hack_squat: [true, true] }, weights: {}, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    3: { sets: { alt_m2_hack_squat: [true, true] }, weights: {}, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
  });
  const stats = perExercise(normalizeExport(raw)).meso2;
  const flags = flagExercises(stats);
  assert.ok(flags.substituted.some(f => f.exId === 'm2_ssb_squat'));
  assert.ok(!flags.rejected.some(f => f.exId === 'm2_ssb_squat'));
  assert.ok(!('alt_m2_hack_squat' in stats));
});

test('weeklyVolume credits a swapped exercise once, to the right muscles, via the substitute falling back to the original', () => {
  // alt_m2_hack_squat has no entry of its own in muscle-map.json; it must
  // fall back to m2_ssb_squat's profile (quads/glutes/spinal_erectors).
  const raw = swapExport({
    1: {
      sets: { alt_m2_hack_squat: [true, true, true] },
      weights: {}, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' },
    },
  });
  const vol = weeklyVolume(normalizeExport(raw), muscleMap).meso2;
  const profile = muscleMap.m2_ssb_squat;
  assert.ok(Math.abs(vol.quads - 3 * profile.quads) < 1e-9);
  assert.ok(Math.abs(vol.glutes - 3 * profile.glutes) < 1e-9);
  assert.ok(Math.abs(vol.spinal_erectors - 3 * profile.spinal_erectors) < 1e-9);
});

// ── stale prior-substitute keys (further mismatch found on real data) ──
//
// performSwap() in index.html never deletes an old `sets` key when writing
// the new substitute's — it only ensures the NEW id's array exists. So on
// real data (meso2 day1 week8, m2_incline_smith's slot) a day can carry
// TWO alt_* keys for the same slot in the same week: this week's live
// substitute per `swaps`, and an orphan left over from an earlier swap that
// `swaps` no longer mentions. A plain per-week `swaps` reverse map can't
// recognize the orphan at all — only the static EXERCISE_ALTERNATIVES table
// (index.html) knows alt_m2_incline_bb belongs to m2_incline_smith too.

const altMap = { m2_incline_smith: [{ id: 'alt_m2_incline_db' }, { id: 'alt_m2_incline_bb' }] };

test('buildAltReverseMap maps every alternative id back to its original, across all slots', () => {
  const rev = buildAltReverseMap(altMap);
  assert.deepStrictEqual(rev, { alt_m2_incline_db: 'm2_incline_smith', alt_m2_incline_bb: 'm2_incline_smith' });
});

test('resolveDaySlots prefers the live swap and drops a stale orphan key for the same slot', () => {
  const dayData = {
    sets: {
      alt_m2_incline_db: [true, true, true, true],   // this week's live substitute
      alt_m2_incline_bb: [true, true, true],           // orphan from an earlier swap
    },
    swaps: { m2_incline_smith: 'alt_m2_incline_db' },
  };
  const pairs = resolveDaySlots(dayData, buildAltReverseMap(altMap));
  assert.deepStrictEqual(pairs, [['m2_incline_smith', 'alt_m2_incline_db']]);
});

test('perExercise does not double-count slots/weight when a stale orphan key sits alongside the live one', () => {
  const raw = {
    version: 3,
    programs: {
      meso2: {
        currentWeek: 1,
        weeks: {
          1: {
            day1: {
              sets: {
                alt_m2_incline_db: [true, true, true, true],
                alt_m2_incline_bb: [true, true, true],
              },
              weights: { alt_m2_incline_bb: '135' }, // stale weight, must be ignored
              effort: {},
              protocol: [],
              swaps: { m2_incline_smith: 'alt_m2_incline_db' },
            },
          },
        },
      },
    },
  };
  const stats = perExercise(normalizeExport(raw), altMap).meso2;
  assert.ok(!('alt_m2_incline_bb' in stats), 'the orphan must not open its own row');
  const s = stats.m2_incline_smith;
  assert.strictEqual(s.slots, 4, 'only the live substitute\'s 4 sets should count, not 4+3');
  assert.strictEqual(s.completed, 4);
  assert.strictEqual(
    s.variants.alt_m2_incline_db.weightPoints.length, 0,
    'the stale weight under the orphan id must not surface'
  );
  assert.ok(!('alt_m2_incline_bb' in s.variants), 'the orphan must not open its own variant either');
});

// ── per-variant weight series (further mismatch found on real data) ──
//
// 60a56e7 correctly merged a swapped slot into one row, but pooled every
// variant's weights into one series. A dumbbell press and a Smith-machine
// press are not on the same scale — pooling fabricates the slope. Each
// performed exercise now gets its own `variants[slotKey]` series; the slot's
// headline slope/firstWeight/lastWeight come from whichever variant was
// performed in the most weeks (`pickDominantVariant`).

test('a slot performed as A for 2 weeks then B for 6 gets two variants, and the headline slope is B\'s', () => {
  const raw = swapExport({
    1: { sets: { m2_ssb_squat: [true] }, weights: { m2_ssb_squat: '45' }, effort: {}, swaps: {} },
    2: { sets: { m2_ssb_squat: [true] }, weights: { m2_ssb_squat: '45' }, effort: {}, swaps: {} },
    3: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '140' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    4: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '150' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    5: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '160' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    6: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '170' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    7: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '180' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    8: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '190' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
  });
  const s = perExercise(normalizeExport(raw)).meso2.m2_ssb_squat;

  assert.deepStrictEqual(Object.keys(s.variants).sort(), ['alt_m2_hack_squat', 'm2_ssb_squat']);
  assert.deepStrictEqual(s.variants.m2_ssb_squat.weightPoints, [[1, 45], [2, 45]]);
  assert.strictEqual(s.variants.m2_ssb_squat.slope, 0);
  assert.deepStrictEqual(
    s.variants.alt_m2_hack_squat.weightPoints,
    [[3, 140], [4, 150], [5, 160], [6, 170], [7, 180], [8, 190]]
  );
  assert.strictEqual(s.variants.alt_m2_hack_squat.slope, 10);

  assert.strictEqual(s.dominantVariant, 'alt_m2_hack_squat', 'B was performed in 6 of 8 weeks, A in only 2');
  assert.strictEqual(s.slope, s.variants.alt_m2_hack_squat.slope, 'headline slope is the dominant variant\'s');
  assert.strictEqual(s.firstWeight, 140);
  assert.strictEqual(s.lastWeight, 190);
});

test('pickDominantVariant breaks a tie in week count toward whichever variant was performed more recently', () => {
  const raw = swapExport({
    1: { sets: { m2_ssb_squat: [true] }, weights: {}, effort: {}, swaps: {} },
    2: { sets: { m2_ssb_squat: [true] }, weights: {}, effort: {}, swaps: {} },
    3: { sets: { alt_m2_hack_squat: [true] }, weights: {}, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    4: { sets: { alt_m2_hack_squat: [true] }, weights: {}, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
  });
  const s = perExercise(normalizeExport(raw)).meso2.m2_ssb_squat;
  assert.strictEqual(s.variants.m2_ssb_squat.weeks.length, s.variants.alt_m2_hack_squat.weeks.length, 'both performed 2 weeks — a genuine tie');
  assert.strictEqual(s.dominantVariant, 'alt_m2_hack_squat', 'the substitute was performed more recently (weeks 3-4 vs 1-2), so it wins the tie');

  // Sanity-check pickDominantVariant directly against the same shape.
  assert.strictEqual(
    pickDominantVariant({
      a: { weeks: [1, 2], weightPoints: [], firstWeight: null, lastWeight: null, slope: null },
      b: { weeks: [3, 4], weightPoints: [], firstWeight: null, lastWeight: null, slope: null },
    }),
    'b'
  );
});

test('a stale original-id weight in a week the substitute was performed does not become a data point for the original\'s own variant', () => {
  const raw = swapExport({
    1: { sets: { m2_ssb_squat: [true] }, weights: { m2_ssb_squat: '45' }, effort: {}, swaps: {} },
    2: {
      // Live this week is the substitute, but the ORIGINAL's key is still
      // sitting in `weights` from week 1 — performSwap() never cleans it up.
      sets: { alt_m2_hack_squat: [true] },
      weights: { m2_ssb_squat: '45', alt_m2_hack_squat: '160' },
      effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' },
    },
  });
  const s = perExercise(normalizeExport(raw)).meso2.m2_ssb_squat;
  assert.deepStrictEqual(s.variants.m2_ssb_squat.weightPoints, [[1, 45]], 'week 2\'s stale entry must not appear here');
  assert.deepStrictEqual(s.variants.alt_m2_hack_squat.weightPoints, [[2, 160]]);
});

test('flagExercises does not mark a slot stalled when the dominant variant is progressing, even though the pooled series would have sloped <= 0', () => {
  // Same shape as the real m2_ssb_squat slot (2 weeks on the original, 6 on
  // the substitute), but with the original logged at a HIGHER weight than
  // the substitute's early sessions, so pooling all 8 points drags the
  // least-squares slope negative even though the substitute alone climbs
  // steadily (100 -> 150, slope +10). This is the exact failure mode that
  // motivated tracking variants separately: a genuinely progressing lift
  // must not be called stalled because of a scale mismatch.
  const raw = swapExport({
    1: { sets: { m2_ssb_squat: [true] }, weights: { m2_ssb_squat: '200' }, effort: { m2_ssb_squat: 'high' }, swaps: {} },
    2: { sets: { m2_ssb_squat: [true] }, weights: { m2_ssb_squat: '200' }, effort: { m2_ssb_squat: 'high' }, swaps: {} },
    3: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '100' }, effort: { alt_m2_hack_squat: 'high' }, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    4: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '110' }, effort: { alt_m2_hack_squat: 'high' }, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    5: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '120' }, effort: { alt_m2_hack_squat: 'high' }, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    6: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '130' }, effort: { alt_m2_hack_squat: 'high' }, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    7: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '140' }, effort: { alt_m2_hack_squat: 'high' }, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    8: { sets: { alt_m2_hack_squat: [true] }, weights: { alt_m2_hack_squat: '150' }, effort: { alt_m2_hack_squat: 'high' }, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
  });
  const stats = perExercise(normalizeExport(raw)).meso2;
  const s = stats.m2_ssb_squat;

  // Confirm the setup actually produces the mismatch this test is about.
  assert.strictEqual(s.variants.alt_m2_hack_squat.slope, 10, 'the dominant variant is clearly progressing');
  const pooled = [[1, 200], [2, 200], [3, 100], [4, 110], [5, 120], [6, 130], [7, 140], [8, 150]];
  assert.ok(slopeOf(pooled) <= 0, 'the pooled series (not used anywhere) would have sloped <= 0');
  assert.strictEqual(s.slope, 10, 'the headline slope is the dominant variant\'s, not the pooled one');

  const flags = flagExercises(stats);
  assert.ok(!flags.stalled.some(f => f.exId === 'm2_ssb_squat'), 'a progressing lift must not be flagged stalled due to pooling');
});

test('renderReport surfaces each variant of a multi-variant slot, not just the dominant one', () => {
  const raw = swapExport({
    1: { sets: { m2_ssb_squat: [true, true] }, weights: { m2_ssb_squat: '45' }, effort: {}, swaps: {} },
    2: { sets: { m2_ssb_squat: [true, true] }, weights: { m2_ssb_squat: '45' }, effort: {}, swaps: {} },
    3: { sets: { alt_m2_hack_squat: [true, true] }, weights: { alt_m2_hack_squat: '140' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
    4: { sets: { alt_m2_hack_squat: [true, true] }, weights: { alt_m2_hack_squat: '205' }, effort: {}, swaps: { m2_ssb_squat: 'alt_m2_hack_squat' } },
  });
  const report = renderReport(analyze(raw, muscleMap, landmarks));

  assert.match(report, /### Variants — meso2/);
  assert.match(report, /`m2_ssb_squat`/);
  assert.match(report, /`alt_m2_hack_squat`.*\(dominant\)/);
  // The main table's weight column is starred to flag it as dominant-only.
  assert.match(report, /\|\s*m2_ssb_squat\s*\|.*\*\s*\|/);
});

test('a single-variant slot behaves exactly as before (regression guard)', () => {
  const stats = perExercise(normalizeExport(v3)).meso1;
  const press = stats.incline_db_press;
  assert.deepStrictEqual(Object.keys(press.variants), ['incline_db_press']);
  assert.strictEqual(press.dominantVariant, 'incline_db_press');
  assert.strictEqual(dominantVariantOf(press), press.variants.incline_db_press);
  // Same numbers the very first test in this file already asserts at the
  // top level — a single-variant slot's headline is just its own variant.
  assert.strictEqual(press.firstWeight, 60);
  assert.strictEqual(press.lastWeight, 70);
  assert.strictEqual(press.slope, 5);
});
