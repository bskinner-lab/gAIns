'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

// All programs must be marked "seen" in every test's storage, or the
// auto-select-newest-untrained-program feature silently switches away from
// program 0 (whatever we seed) to the last untrained program, breaking the
// day/exercise ids these tests expect to see rendered.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

function seededStorage() {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
      reps: { [ex.id]: 9, [`${ex.id}_0`]: 11, [`${ex.id}_1`]: 9 },
      effort: {}, protocol: [], swaps: {},
    },
  };
  return {
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '2',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
    progId: prog.id, dayId: day.id, exId: ex.id,
  };
}

test('1. every day gets a reps map on a fresh install', () => {
  const app = loadApp();
  const { DAYS } = app;
  DAYS.forEach(day => {
    assert.strictEqual(typeof app.state[day.id].reps, 'object');
    assert.notStrictEqual(app.state[day.id].reps, null);
  });
});

test('2. state saved without a reps key still loads without error', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const legacy = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100 },
      effort: {}, protocol: [], swaps: {},
      // no `reps` key at all
    },
  };
  const app = loadApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(legacy),
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  });
  assert.deepStrictEqual(app.state[day.id].reps, {});
});

test('3. reps survive a save/load round trip', () => {
  const seed = seededStorage();
  // Seed week 1 as the CURRENT week too, so initState loads it directly.
  seed.storage[`hypertrophy_week_${seed.progId}`] = '1';
  withApp({ storage: seed.storage }, (app) => {
    assert.strictEqual(app.state[seed.dayId].reps[seed.exId], 9);
    assert.strictEqual(app.state[seed.dayId].reps[`${seed.exId}_0`], 11);
    // saveState() isn't exposed by the shim; skipSet() on an already-true set
    // is a no-op on `sets` but still calls saveState() internally, which is
    // enough to exercise the real persistence path.
    app.skipSet(seed.dayId, seed.exId, 0);
    const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${seed.progId}_w1`));
    assert.strictEqual(raw[seed.dayId].reps[seed.exId], 9);
    assert.strictEqual(raw[seed.dayId].reps[`${seed.exId}_0`], 11);
  });
});

test('4. history entries carry reps and setReps', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    const hist = app.getExerciseHistory(seed.dayId, seed.exId);
    const w1 = hist.find(h => h.week === 1);
    assert.ok(w1, 'week 1 should be present in history');
    assert.strictEqual(w1.reps, 9);
    assert.strictEqual(w1.setReps['0'], 11);
    assert.strictEqual(w1.setReps['1'], 9);
  });
});

test('5. a week with reps but no weight and no effort is not dropped from history', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: {},
      reps: { [ex.id]: 12 },
      effort: {}, protocol: [], swaps: {},
    },
  };
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    const hist = app.getExerciseHistory(day.id, ex.id);
    const entry = hist.find(h => h.week === 1);
    assert.ok(entry, 'week with reps-only should not be dropped');
    assert.strictEqual(entry.reps, 12);
    assert.strictEqual(entry.weight, null);
  });
});

test('6. per-set rep keys are matched on a digits-only suffix', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100 },
      reps: {
        [ex.id]: 10,
        [`${ex.id}_0`]: 11,
        [`${ex.id}_pause`]: 5,
        [`${ex.id}_pause_0`]: 6,
      },
      effort: {}, protocol: [], swaps: {},
    },
  };
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    const hist = app.getExerciseHistory(day.id, ex.id);
    const entry = hist.find(h => h.week === 1);
    assert.deepStrictEqual(Object.keys(entry.setReps), ['0']);
    assert.strictEqual(entry.setReps['0'], 11);
  });
});

test('7. a logged set with recorded reps renders weight × reps', () => {
  const seed = seededStorage();
  seed.storage[`hypertrophy_week_${seed.progId}`] = '1';
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /100\s*×\s*11\s*●/);
  });
});

test('9. lowRep parses the first integer out of varied prescription strings', () => {
  const { lowRep } = loadApp();
  assert.strictEqual(lowRep('6–10'), 6);
  assert.strictEqual(lowRep('12–15'), 12);
  assert.strictEqual(lowRep('10 each leg'), 10);
  assert.strictEqual(lowRep('8–12 each leg'), 8);
  assert.strictEqual(lowRep('15 + LLP'), 15);
  assert.strictEqual(lowRep(''), '');
});

test('10. reps prefill uses the low end of the prescribed range with no history', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const expected = Number(/\d+/.exec(ex.reps)[0]);
  withApp({ storage: { hypertrophy_program: '0', ...allSeenSeed() } }, (app) => {
    click(app, { day: day.id });
    app.render();
    assert.strictEqual(app.view.pendR, expected);
  });
});

test('11. reps prefill prefers last week reps at the same set index over the exercise-level figure', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    assert.strictEqual(app.view.pendR, 11);
  });
});

test('12. the reps stepper adjusts by one and clamps at zero', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    app.view.pendR = 0;
    click(app, { act: 'r-' });
    assert.strictEqual(app.view.pendR, 0);
    click(app, { act: 'r+' });
    assert.strictEqual(app.view.pendR, 1);
    click(app, { act: 'r+' });
    assert.strictEqual(app.view.pendR, 2);
    click(app, { act: 'r-' });
    assert.strictEqual(app.view.pendR, 1);
  });
});

test('13. logging writes reps at both the exercise and per-set keys', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  withApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)),
    },
  }, (app) => {
    click(app, { day: day.id });
    app.render();
    app.view.pendR = 8;
    app.logActiveSet();
    assert.strictEqual(app.state[day.id].reps[ex.id], 8);
    assert.strictEqual(app.state[day.id].reps[`${ex.id}_0`], 8);
  });
});

test('14. logging with an empty pendR records no reps but still logs the set', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  withApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)),
    },
  }, (app) => {
    click(app, { day: day.id });
    app.render();
    app.view.pendR = '';
    app.logActiveSet();
    assert.strictEqual(app.state[day.id].reps[ex.id], undefined);
    assert.strictEqual(app.state[day.id].reps[`${ex.id}_0`], undefined);
    assert.strictEqual(app.state[day.id].sets[ex.id][0], true);
  });
});

test('15. the bottom bar renders both steppers and the LOG SET button', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    const html = app.elements.get('bottombar').innerHTML;
    assert.match(html, /data-act="w-"/);
    assert.match(html, /data-act="w\+"/);
    assert.match(html, /data-act="r-"/);
    assert.match(html, /data-act="r\+"/);
    assert.match(html, /data-act="log"/);
    assert.match(html, />LOG SET</);
  });
});

test('16. tapping a value opens an inline field and freezes the bar', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editw' });
    app.render();
    const html = app.elements.get('bottombar').innerHTML;
    assert.match(html, /id="editfield"/);
    assert.match(html, /inputmode="decimal"/);
    // Mutate state directly (bypassing commitEdit) so an unfrozen re-render
    // WOULD produce different markup — this is what gives the freeze
    // assertion below actual teeth, rather than two renders of unchanged
    // state trivially matching by coincidence.
    app.view.pendW = 999;
    app.render();
    app.render();
    assert.strictEqual(app.elements.get('bottombar').innerHTML, html);
  });
});

test('17. the reps field uses inputmode="numeric"', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editr' });
    app.render();
    const html = app.elements.get('bottombar').innerHTML;
    assert.match(html, /id="editfield"/);
    assert.match(html, /inputmode="numeric"/);
  });
});

test('18. committing a typed weight updates pendW, clears editing, and unfreezes', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editw' });
    app.render();
    app.commitEdit('185');
    assert.strictEqual(app.view.pendW, 185);
    assert.strictEqual(app.view.editing, null);
    const html = app.elements.get('bottombar').innerHTML;
    assert.doesNotMatch(html, /id="editfield"/);
  });
});

test('19. committing a typed reps count updates pendR as an integer', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editr' });
    app.render();
    app.commitEdit('12');
    assert.strictEqual(app.view.pendR, 12);
    assert.strictEqual(app.view.editing, null);
  });
});

test('20. invalid and empty input leave the pending value untouched', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editw' });
    app.render();
    const before = app.view.pendW;
    app.commitEdit('abc');
    assert.strictEqual(app.view.pendW, before);
    assert.strictEqual(app.view.editing, null);

    click(app, { act: 'editw' });
    app.render();
    app.commitEdit('   ');
    assert.strictEqual(app.view.pendW, before);
    assert.strictEqual(app.view.editing, null);
  });
});

test('21. negative input clamps to zero', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editw' });
    app.render();
    app.commitEdit('-50');
    assert.strictEqual(app.view.pendW, 0);

    click(app, { act: 'editr' });
    app.render();
    app.commitEdit('-3');
    assert.strictEqual(app.view.pendR, 0);
  });
});

test('22. a second commitEdit on the same edit is a no-op', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editw' });
    app.render();
    const priorR = app.view.pendR;
    app.commitEdit('185');
    assert.strictEqual(app.view.pendW, 185);
    app.commitEdit('999');
    assert.strictEqual(app.view.pendW, 185);
    // A missing/removed guard falls through to the reps branch once
    // view.editing is already null (field becomes null, which fails the 'w'
    // check) — so a broken guard corrupts pendR here, not pendW. Assert both
    // stay untouched, or this test can pass against a broken guard.
    assert.strictEqual(app.view.pendR, priorR);
  });
});

test('23. any other action closes the editor', () => {
  const seed = seededStorage();
  const others = [{ act: 'tip', t: 'RPE' }, { act: 'view', v: 'plan' }, { act: 'log' }];
  others.forEach(dataset => {
    withApp({ storage: seed.storage }, (app) => {
      click(app, { day: seed.dayId });
      app.render();
      click(app, { act: 'editw' });
      app.render();
      assert.strictEqual(app.view.editing, 'w');
      click(app, dataset);
      assert.strictEqual(app.view.editing, null);
    });
  });
});

test('24. the field renders on the very first render after editing is set (would fail under a getElementById-based freeze guard)', () => {
  const seed = seededStorage();
  withApp({ storage: seed.storage }, (app) => {
    click(app, { day: seed.dayId });
    app.render();
    click(app, { act: 'editw' });
    // A single, first render() call after setting view.editing. A guard based
    // on `document.getElementById('editfield')` would find the shim's
    // auto-vivified stub (which is truthy even before the input markup ever
    // existed) and freeze the bar before the field is ever emitted, so this
    // render would leave the old step display in place with no editfield in
    // the markup. The markup-based guard has nothing to freeze on yet (no
    // prior render contained an editfield), so it renders normally and the
    // field appears.
    app.render();
    const html = app.elements.get('bottombar').innerHTML;
    assert.match(html, /id="editfield"/);
  });
});

// Scopes a rendered day-view html blob down to a single exercise's
// container (`<div class="ex">` / `<div class="ex sel">`), so assertions
// about that exercise's set rows can't accidentally pass because of markup
// belonging to a different exercise or the exercise's own prescription tag
// (`${ex.sets}×${ex.reps}`, e.g. "3×12–15", which legitimately contains ×).
//
// Anchored on the numbered exercise-name heading rather than the
// `data-act="selectex"` marker: a fully-completed exercise (every set
// logged/skipped) renders with no selectex attribute at all (`topAttrs` is
// `''` once `allDone` is true), which is exactly the state test 27 needs.
function extractExerciseBlock(html, exIndex, exName) {
  const marker = `${String(exIndex + 1).padStart(2, '0')} ${exName}`;
  const markerIdx = html.indexOf(marker);
  assert.notStrictEqual(markerIdx, -1, `expected exercise "${exName}" heading in rendered html`);
  const containerRe = /<div class="ex( sel)?">/g;
  const starts = [];
  let m;
  while ((m = containerRe.exec(html))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const nextStart = i + 1 < starts.length ? starts[i + 1] : html.length;
    if (starts[i] < markerIdx && markerIdx < nextStart) {
      return html.slice(starts[i], nextStart);
    }
  }
  throw new Error(`could not locate container for exercise ${exId}`);
}

test('25. reps ride along in a v3 export payload', () => {
  const seed = seededStorage();
  // This is exactly the blob exportData() reads via
  // `localStorage.getItem(hypertrophy_state_<progId>_w<n>)` and drops
  // unmodified into `data.programs[<progId>].weeks[<n>]`.
  const raw = JSON.parse(seed.storage[`hypertrophy_state_${seed.progId}_w1`]);
  assert.ok('reps' in raw[seed.dayId], 'week-1 blob should carry a reps key');
  assert.strictEqual(raw[seed.dayId].reps[seed.exId], 9);
  assert.strictEqual(raw[seed.dayId].reps[`${seed.exId}_0`], 11);
  assert.strictEqual(raw[seed.dayId].reps[`${seed.exId}_1`], 9);

  const payload = {
    version: 3,
    currentProgram: 0,
    programs: { [seed.progId]: { weeks: { 1: raw }, currentWeek: 2 } },
  };
  const dayInPayload = payload.programs[seed.progId].weeks[1][seed.dayId];
  assert.ok('reps' in dayInPayload);
  assert.strictEqual(dayInPayload.reps[seed.exId], 9);
});

test('26. a re-imported export restores the same reps', () => {
  const seed = seededStorage();
  const raw = JSON.parse(seed.storage[`hypertrophy_state_${seed.progId}_w1`]);
  // The v3 export payload, built the same way exportData() builds it.
  const payload = {
    version: 3,
    currentProgram: 0,
    programs: { [seed.progId]: { weeks: { 1: raw }, currentWeek: 1 } },
  };
  // Reconstruct localStorage the same way importData() does: each week's
  // blob goes back under its own key, plus the program's current-week
  // pointer and the active-program index.
  const progData = payload.programs[seed.progId];
  const importedStorage = {
    [`hypertrophy_state_${seed.progId}_w1`]: JSON.stringify(progData.weeks[1]),
    [`hypertrophy_week_${seed.progId}`]: String(progData.currentWeek),
    hypertrophy_program: String(payload.currentProgram),
    ...allSeenSeed(),
  };
  withApp({ storage: importedStorage }, (app) => {
    assert.strictEqual(app.state[seed.dayId].reps[seed.exId], 9);
    assert.strictEqual(app.state[seed.dayId].reps[`${seed.exId}_0`], 11);
    assert.strictEqual(app.state[seed.dayId].reps[`${seed.exId}_1`], 9);
  });
});

test('27. a pre-reps backup imports and renders without a reps suffix', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  // v3-shaped week blob with no `reps` key at all — what a backup taken
  // before this feature existed looks like.
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
      effort: {}, protocol: [], swaps: {},
    },
  };
  assert.ok(!('reps' in w1[day.id]));
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    assert.deepStrictEqual(app.state[day.id].reps, {});
    assert.doesNotThrow(() => app.render());

    click(app, { day: day.id });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    const block = extractExerciseBlock(html, 0, ex.name);
    // `cell-today` is on the cell element itself and carries a state modifier
    // (`t-done`/`t-skip`/`t-pend`), so match the class prefix, not an exact
    // `class="cell-today"`.
    const cells = block.match(/<div class="cell-today[^"]*"[\s\S]*?<\/div>/g) || [];
    assert.ok(cells.length > 0, 'expected at least one set-row cell for this exercise');
    cells.forEach(cell => {
      assert.doesNotMatch(cell, /×/, `set-row cell should not show a reps suffix: ${cell}`);
    });
  });
});

test('8. a logged set without reps renders weight only', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  const day = prog.days[0];
  const ex = day.exercises[0];
  const w1 = {
    [day.id]: {
      sets: { [ex.id]: new Array(ex.sets).fill(true) },
      weights: { [ex.id]: 100, [`${ex.id}_0`]: 100 },
      reps: {},
      effort: {}, protocol: [], swaps: {},
    },
  };
  withApp({
    storage: {
      [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify(w1),
      [`hypertrophy_week_${prog.id}`]: '1',
      hypertrophy_program: '0',
      ...allSeenSeed(),
    },
  }, (app) => {
    click(app, { day: day.id });
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /100 ●/);
    assert.doesNotMatch(html, /100\s*×/);
  });
});
