'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

// Mirrors reps.test.js — without every program marked "seen", the
// auto-select-newest-untrained-program feature switches away from program 0
// and breaks the day/exercise ids these tests expect.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

const FIXED = 1785340666000; // 2026-07-29T15:57:46Z

test('1. every day gets a times map on a fresh install', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.DAYS.forEach(d => {
      assert.ok(app.state[d.id].times, `${d.id} has no times map`);
      assert.deepStrictEqual(app.state[d.id].times, {});
    });
  });
});

test('2. state saved without a times key still loads without error', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: { sets: { [ex.id]: [true, false, false] }, weights: {}, effort: {} },
    }),
  });
  withApp({ storage: seed }, app => {
    assert.deepStrictEqual(app.state[day.id].times, {});
  });
});

test('3. times survive a save/load round trip', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: {
        sets: { [ex.id]: [true, false, false] },
        weights: {}, effort: {},
        times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
      },
    }),
  });
  withApp({ storage: seed }, app => {
    assert.deepStrictEqual(app.state[day.id].times[`${ex.id}_0`], { at: FIXED, src: 'log' });
  });
});

test('10. prefillFromPreviousWeeks carries weights forward but never times', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '2',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: {
        sets: { [ex.id]: [true, true, true] },
        weights: { [ex.id]: '135' },
        effort: { [ex.id]: 'high' },
        times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
      },
    }),
  });
  withApp({ storage: seed }, app => {
    // Week 2 inherits the prior week's weight and effort...
    assert.strictEqual(app.state[day.id].weights[ex.id], '135');
    assert.strictEqual(app.state[day.id].effort[ex.id], 'high');
    // ...but must NOT inherit a timestamp for a set that was never performed.
    assert.deepStrictEqual(app.state[day.id].times, {});
  });
});

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

test('4. logActiveSet writes src "log" at the stubbed clock value', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const act = app.activeSet(day);
    app.logActiveSet();
    assert.deepStrictEqual(
      app.state[day.id].times[`${act.ex.id}_${act.i}`],
      { at: FIXED, src: 'log' }
    );
  });
});

test('5. toggleSet writes src "log"', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    assert.deepStrictEqual(app.state[day.id].times[`${ex.id}_0`], { at: FIXED, src: 'log' });
  });
});

test('6. skipSet writes src "skip", not "log"', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.skipSet(day.id, ex.id, 0);
    assert.deepStrictEqual(app.state[day.id].times[`${ex.id}_0`], { at: FIXED, src: 'skip' });
  });
});

test('7a. completeDay writes src "bulk" for every set it flips', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    app.completeDay(day.id);
    const times = app.state[day.id].times;
    const keys = Object.keys(times);
    assert.ok(keys.length > 0, 'completeDay wrote no timestamps');
    keys.forEach(k => assert.strictEqual(times[k].src, 'bulk', `${k} is not bulk`));
  });
});

test('7b. skipDay writes src "bulk"', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    app.skipDay(day.id);
    const times = app.state[day.id].times;
    assert.ok(Object.keys(times).length > 0);
    Object.keys(times).forEach(k => assert.strictEqual(times[k].src, 'bulk'));
  });
});

test('7c. bulk ops do not overwrite an existing measured timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.setClock(() => FIXED);
    app.toggleSet(day.id, ex.id, 0);          // real log at FIXED
    app.setClock(() => FIXED + 60000);
    app.completeDay(day.id);                   // bulk-resolves the rest
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'log' },
      'completeDay clobbered a measured log timestamp'
    );
  });
});

test('7d. bulk skip does not clobber an individually-skipped set\'s timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.setClock(() => FIXED);
    app.skipSet(day.id, ex.id, 0);              // measured, individual skip
    app.setClock(() => FIXED + 60000);
    app.skipExercise(day.id, ex.id);            // bulk-skips the remainder
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'skip' },
      'bulk skip overwrote a measured skip timestamp'
    );
    // The genuinely-unresolved sets in the same exercise still get bulk stamps.
    assert.strictEqual(app.state[day.id].times[`${ex.id}_1`].src, 'bulk');
  });
});

test('8. undoSet removes the timestamp entirely', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    assert.ok(app.state[day.id].times[`${ex.id}_0`]);
    app.undoSet(day.id, ex.id, 0);
    assert.ok(
      !(`${ex.id}_0` in app.state[day.id].times),
      'key must be absent, not undefined'
    );
  });
});

test('9a. toggling a done set off removes its timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    app.toggleSet(day.id, ex.id, 0);
    assert.ok(!(`${ex.id}_0` in app.state[day.id].times));
  });
});

test('9b. un-skipping a set removes its timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.skipSet(day.id, ex.id, 0);
    app.skipSet(day.id, ex.id, 0);
    assert.ok(!(`${ex.id}_0` in app.state[day.id].times));
  });
});

test('9c. re-logging after undo records a fresh timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.setClock(() => FIXED);
    app.toggleSet(day.id, ex.id, 0);
    app.undoSet(day.id, ex.id, 0);
    // Pin the deletion mid-sequence: without this the final assertion passes
    // even if undo never deleted anything, because the re-log's markTime
    // overwrites unconditionally.
    assert.ok(
      !(`${ex.id}_0` in app.state[day.id].times),
      'undo did not delete the entry before re-logging'
    );
    app.setClock(() => FIXED + 120000);
    app.toggleSet(day.id, ex.id, 0);
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED + 120000, src: 'log' }
    );
  });
});

test('9d. clearing the week removes every timestamp', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.setClock(() => FIXED);
    const day = app.curDay();
    const ex = app.activeSet(day).ex;
    app.toggleSet(day.id, ex.id, 0);
    assert.ok(app.state[day.id].times[`${ex.id}_0`], 'precondition: a timestamp exists');

    // Drive the real user path — Settings → CLEAR THIS WEEK'S LOG → confirm —
    // rather than calling resetWeek() directly.
    app.view.confirm = { act: 'clearweek' };
    click(app, { act: 'cfok' });

    assert.strictEqual(app.state[day.id].sets[ex.id][0], false, 'week was not cleared');
    app.DAYS.forEach(d => {
      assert.deepStrictEqual(app.state[d.id].times, {}, `${d.id} kept orphaned timestamps`);
      assert.deepStrictEqual(app.state[d.id].reps, {}, `${d.id} kept orphaned reps`);
    });
  });
});

function fileEvent(content) {
  return { target: { files: [{ _content: content }], value: '' } };
}

test('12. export emits version 4 including times', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const seed = Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [day.id]: {
        sets: { [ex.id]: [true, false, false] },
        weights: {}, effort: {},
        times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
      },
    }),
  });
  withApp({ storage: seed }, app => {
    app.exportData();
    const out = JSON.parse(app.lastBlob);
    assert.strictEqual(out.version, 4);
    assert.deepStrictEqual(
      out.programs[prog.id].weeks['1'][day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'log' }
    );
  });
});

test('13. a v3 backup imports cleanly and fabricates no dates', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const backup = JSON.stringify({
    version: 3,
    currentProgram: 0,
    programs: {
      [prog.id]: {
        currentWeek: 1,
        weeks: { 1: { [day.id]: { sets: { [ex.id]: [true, true, false] }, weights: {}, effort: {} } } },
      },
    },
  });
  withApp({ storage: allSeenSeed() }, app => {
    app.importData(fileEvent(backup));
    assert.deepStrictEqual(app.state[day.id].times, {}, 'import invented dates');
    assert.strictEqual(app.state[day.id].sets[ex.id][0], true, 'import lost set data');
  });
});

test('14. a v4 backup round-trips with timestamps intact', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], day = prog.days[0], ex = day.exercises[0];
  const backup = JSON.stringify({
    version: 4,
    currentProgram: 0,
    programs: {
      [prog.id]: {
        currentWeek: 1,
        startDate: '2026-03-02',
        weeks: {
          1: {
            [day.id]: {
              sets: { [ex.id]: [true, false, false] },
              weights: {}, effort: {},
              times: { [`${ex.id}_0`]: { at: FIXED, src: 'log' } },
            },
          },
        },
      },
    },
  });
  withApp({ storage: allSeenSeed() }, app => {
    app.importData(fileEvent(backup));
    assert.deepStrictEqual(
      app.state[day.id].times[`${ex.id}_0`],
      { at: FIXED, src: 'log' }
    );
    assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), '2026-03-02');
  });
});

test('12b. export omits startDate when none is stored', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.exportData();
    const out = JSON.parse(app.lastBlob);
    Object.values(out.programs).forEach(p => {
      assert.ok(!('startDate' in p), 'startDate present with no stored value');
    });
  });
});

function seedTwoWeeks(prog) {
  const d0 = prog.days[0], d1 = prog.days[1];
  const e0 = d0.exercises[0], e1 = d1.exercises[0];
  return Object.assign(allSeenSeed(), {
    hypertrophy_program: '0',
    [`hypertrophy_week_${prog.id}`]: '1',
    [`hypertrophy_state_${prog.id}_w1`]: JSON.stringify({
      [d0.id]: { sets: { [e0.id]: [true, 'skipped', false] }, weights: {}, effort: {} },
      [d1.id]: { sets: { [e1.id]: [true, true, true] }, weights: {}, effort: {} },
    }),
    [`hypertrophy_state_${prog.id}_w2`]: JSON.stringify({
      [d0.id]: { sets: { [e0.id]: [true, false, false] }, weights: {}, effort: {} },
    }),
  });
}

const DAY_MS = 86400000;
const midnight = iso => Date.parse(iso + 'T00:00:00');

test('15. backfill writes est entries at the derived day-level date', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  withApp({ storage: seedTwoWeeks(prog) }, app => {
    const res = app.backfillProgram(prog.id, '2026-03-02');
    assert.strictEqual(res.ok, true);

    const raw1 = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w1`));
    const d0 = prog.days[0], e0 = d0.exercises[0];
    // Week 1, day index 0 → the start date itself, at local midnight.
    assert.deepStrictEqual(
      raw1[d0.id].times[`${e0.id}_0`],
      { at: midnight('2026-03-02'), src: 'est' }
    );
    // Skipped sets are resolved too, so they are dated.
    assert.strictEqual(raw1[d0.id].times[`${e0.id}_1`].src, 'est');
    // Unresolved sets get nothing.
    assert.ok(!(`${e0.id}_2` in raw1[d0.id].times));

    // Week 1, day index 1 → one day later.
    const d1 = prog.days[1], e1 = d1.exercises[0];
    assert.strictEqual(
      raw1[d1.id].times[`${e1.id}_0`].at,
      midnight('2026-03-02') + DAY_MS
    );

    // Week 2, day index 0 → seven days later.
    const raw2 = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w2`));
    assert.strictEqual(
      raw2[d0.id].times[`${e0.id}_0`].at,
      midnight('2026-03-02') + 7 * DAY_MS
    );

    assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), '2026-03-02');
  });
});

test('11. re-running backfill overwrites est but never measured timestamps', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0], d0 = prog.days[0], e0 = d0.exercises[0];
  const seed = seedTwoWeeks(prog);
  // Set 0 was really logged; set 1 was really skipped. Both must be immune.
  const w1 = JSON.parse(seed[`hypertrophy_state_${prog.id}_w1`]);
  w1[d0.id].times = {
    [`${e0.id}_0`]: { at: FIXED, src: 'log' },
    [`${e0.id}_1`]: { at: FIXED, src: 'skip' },
  };
  seed[`hypertrophy_state_${prog.id}_w1`] = JSON.stringify(w1);

  withApp({ storage: seed }, app => {
    app.backfillProgram(prog.id, '2026-03-02');
    app.backfillProgram(prog.id, '2026-05-04'); // revise the estimate

    const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w1`));
    assert.deepStrictEqual(raw[d0.id].times[`${e0.id}_0`], { at: FIXED, src: 'log' });
    assert.deepStrictEqual(raw[d0.id].times[`${e0.id}_1`], { at: FIXED, src: 'skip' });

    // A genuinely estimated entry elsewhere did move to the revised date.
    const d1 = prog.days[1], e1 = d1.exercises[0];
    assert.deepStrictEqual(
      raw[d1.id].times[`${e1.id}_0`],
      { at: midnight('2026-05-04') + DAY_MS, src: 'est' }
    );
  });
});

test('11b. backfill refuses a program with more than 7 days', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  withApp({ storage: seedTwoWeeks(prog) }, app => {
    // withApp re-evals the script, so it has its own PROGRAMS array —
    // backfillProgram reads that one, not the loadApp copy `prog` came from.
    const live = app.PROGRAMS.find(p => p.id === prog.id);
    const original = live.days.slice();
    // Grow the program past a week so dayIndex would overlap the next week.
    while (live.days.length <= 7) live.days.push(original[0]);
    try {
      const res = app.backfillProgram(prog.id, '2026-03-02');
      assert.strictEqual(res.ok, false);
      const raw = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w1`));
      // boot()'s initState() already gives every day an empty times map, so the
      // map's presence proves nothing — the property is that it stayed empty.
      assert.deepStrictEqual(
        raw[prog.days[0].id].times || {}, {},
        'refused backfill still wrote data'
      );
      assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), null);
    } finally {
      live.days.length = 0;
      original.forEach(d => live.days.push(d));
    }
  });
});

test('11c. backfill refuses an unparseable date', () => {
  const { PROGRAMS } = loadApp();
  const prog = PROGRAMS[0];
  withApp({ storage: seedTwoWeeks(prog) }, app => {
    const res = app.backfillProgram(prog.id, 'not-a-date');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(app.storage.getItem(`hypertrophy_start_${prog.id}`), null);
  });
});
