'use strict';
// Phase 4 of the completeness roadmap: the once-per-block RIR calibration set.
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

const app0 = loadApp();
const { calibrationTarget, calibrationWeekIdx, prescribedRirFromRpe } = app0;
const SEEN = JSON.stringify(app0.PROGRAMS.map(p => p.id));
const prog = id => app0.PROGRAMS.find(p => p.id === id);
const MESO4 = prog('meso4');
const MESO4_IDX = app0.PROGRAMS.indexOf(MESO4);
const day = (p, id) => p.days.find(d => d.id === id);

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

function meso4AtWeek(week, extra = {}) {
  return { hypertrophy_seen_programs: SEEN, hypertrophy_program: String(MESO4_IDX), hypertrophy_week_meso4: String(week), ...extra };
}

// ------------------------------------------------------------ RPE parsing

test('prescribed RIR comes from the RPE upper bound', () => {
  assert.strictEqual(prescribedRirFromRpe('RPE 8–9'), 1);
  assert.strictEqual(prescribedRirFromRpe('RPE 9'), 1);
  assert.strictEqual(prescribedRirFromRpe('RPE 6.5–7.5'), 2.5);
  assert.strictEqual(prescribedRirFromRpe('RPE 9–9.5'), 0.5);
  assert.strictEqual(prescribedRirFromRpe(''), null);
});

// ----------------------------------------------------- choosing the set

test('the calibration week is the first High Stimulus week', () => {
  assert.strictEqual(calibrationWeekIdx(MESO4), 4);
  assert.strictEqual(calibrationWeekIdx(prog('meso3')), 4);
  assert.strictEqual(calibrationWeekIdx(prog('meso2')), -1, 'meso2 has no High Stimulus phase');
});

test('calibrationTarget picks the right exercise and set on each meso4 day', () => {
  const w = calibrationWeekIdx(MESO4);
  const got = Object.fromEntries(MESO4.days.map(d => [d.id, calibrationTarget(d, w, MESO4)]));
  assert.deepStrictEqual(got, {
    // PUSH: the isolations are side delts (never) and an overhead extension
    // whose lateral-raise partner still has a set left after it.
    day1: null,
    // PULL: the curl closes pair C; week 5 ramps it to 4 sets.
    day2: { exId: 'm4_bayesian_curl', setIdx: 3 },
    // LOWER A: the carry has forearms/traps, so the calf raise (A2, 6 sets).
    day3: { exId: 'm4_standing_calf', setIdx: 5 },
    // UPPER: every isolation trains a delt, or forearms with the curl.
    day4: null,
    // LOWER B: the crunch closes pair B.
    day5: { exId: 'm4_cable_crunch', setIdx: 2 },
  });
});

test('null outside the High Stimulus week, and for programs without inline muscles', () => {
  for (let w = 0; w < MESO4.totalWeeks; w++) {
    if (w === 4) continue;
    for (const d of MESO4.days) assert.strictEqual(calibrationTarget(d, w, MESO4), null, `meso4 ${d.id} week ${w + 1}`);
  }
  // Week 6 is also High Stimulus, but only the FIRST one calibrates.
  assert.strictEqual(MESO4.weekPhases[5].label, 'High Stimulus');
  const meso1 = prog('meso1');
  for (const d of meso1.days) assert.strictEqual(calibrationTarget(d, calibrationWeekIdx(meso1), meso1), null);
});

test('superset members only qualify as the closing half of their pair', () => {
  const synthetic = {
    id: 'dx', exercises: [
      { id: 'a', compound: false, sets: 3, reps: '10–12', muscles: { biceps: 1 }, superset: 'A', rest: 60 },
      { id: 'b', compound: false, sets: 3, reps: '10–12', muscles: { side_delt: 1 }, superset: 'A', rest: 60 },
    ],
  };
  const p = { ...MESO4, days: [synthetic] };
  // `a` is the first half, `b` is delts: nothing qualifies.
  assert.strictEqual(calibrationTarget(synthetic, 4, p), null);
  // Swap the order so the curl closes the pair: it qualifies.
  synthetic.exercises.reverse();
  assert.deepStrictEqual(calibrationTarget(synthetic, 4, p), { exId: 'a', setIdx: 2 });
  // …unless the partner has more sets, so one is still to come after it.
  synthetic.exercises[0].sets = 4;
  assert.strictEqual(calibrationTarget(synthetic, 4, p), null);
});

test('per-side and timed work is never chosen', () => {
  const d = { id: 'dx', exercises: [
    { id: 'curl', compound: false, sets: 3, reps: '10–12', muscles: { biceps: 1 }, rest: 60 },
    { id: 'pallof', compound: false, sets: 2, reps: '10–12 each side', muscles: { abs: 1 }, rest: 60 },
    { id: 'plank', compound: false, sets: 2, reps: '45 s', muscles: { abs: 1 }, rest: 60 },
  ] };
  assert.deepStrictEqual(calibrationTarget(d, 4, { ...MESO4, days: [d] }), { exId: 'curl', setIdx: 2 });
});

// ------------------------------------------------------------------ flow

// Mark every set of `exId` but the last done, so the next log is the target.
function upToLast(app, dayId, exId) {
  const arr = app.state[dayId].sets[exId];
  for (let i = 0; i < arr.length - 1; i++) arr[i] = true;
  return arr.length - 1;
}

test('the target set shows a CALIBRATE badge and the card carries the note', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    click(app, { act: 'day', id: 'day2' });
    const html = app.elements.get('scroll').innerHTML;
    assert.strictEqual((html.match(/class="calib-b">CALIBRATE/g) || []).length, 1);
    assert.match(html, /RIR CALIBRATION<\/b> · Last set: stop where you'd normally stop/);
    const card = html.slice(html.indexOf('Bayesian'));
    assert.match(card, /class="calib-b"/);
  });
});

test('logging the target set opens view.calib; SAVE stores the record', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    app.setClock(() => 1234);
    click(app, { act: 'day', id: 'day2' });
    const ex = 'm4_bayesian_curl';
    const last = upToLast(app, 'day2', ex);
    click(app, { act: 'selectex', ex });
    click(app, { act: 'log' });
    assert.ok(app.view.calib, 'the calibration overlay did not open');
    assert.strictEqual(app.view.calib.exId, ex);
    assert.strictEqual(app.view.calib.prescribedRir, 1);
    assert.match(app.elements.get('overlays').innerHTML, /How many more reps to failure\?/);
    assert.ok(app.view.restEnd, 'the rest timer keeps running underneath');

    click(app, { act: 'calib+' }); click(app, { act: 'calib+' }); click(app, { act: 'calib+' });
    click(app, { act: 'calib-' });
    click(app, { act: 'calibsave' });
    assert.strictEqual(app.view.calib, null);
    assert.deepStrictEqual(app.state.day2.calib[ex], { setIdx: last, prescribedRir: 1, extra: 2, at: 1234 });
    const saved = JSON.parse(app.storage.getItem('hypertrophy_state_meso4_w5'));
    assert.strictEqual(saved.day2.calib[ex].extra, 2);
    // Done: the badge goes away.
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /calib-b/);
  });
});

test('the stepper stays within 0–10', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    click(app, { act: 'day', id: 'day2' });
    upToLast(app, 'day2', 'm4_bayesian_curl');
    click(app, { act: 'selectex', ex: 'm4_bayesian_curl' });
    click(app, { act: 'log' });
    click(app, { act: 'calib-' });
    assert.strictEqual(app.view.calib.extra, 0);
    for (let i = 0; i < 15; i++) click(app, { act: 'calib+' });
    assert.strictEqual(app.view.calib.extra, 10);
  });
});

test('the toggleSet path opens it too; SKIP stores nothing', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    click(app, { act: 'day', id: 'day5' });
    const last = upToLast(app, 'day5', 'm4_cable_crunch');
    app.toggleSet('day5', 'm4_cable_crunch', last);
    assert.ok(app.view.calib);
    click(app, { act: 'calibskip' });
    assert.strictEqual(app.view.calib, null);
    assert.deepStrictEqual(app.state.day5.calib, {});
  });
});

test('logging any other set does not open it', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    click(app, { act: 'day', id: 'day2' });
    app.toggleSet('day2', 'm4_bayesian_curl', 0);
    app.toggleSet('day2', 'm4_neutral_pulldown', 0);
    assert.strictEqual(app.view.calib, null);
  });
});

test('outside the calibration week there is no badge and no overlay', () => {
  withApp({ storage: meso4AtWeek(6) }, app => {
    click(app, { act: 'day', id: 'day2' });
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /calib-b/);
    const last = upToLast(app, 'day2', 'm4_bayesian_curl');
    app.toggleSet('day2', 'm4_bayesian_curl', last);
    assert.strictEqual(app.view.calib, null);
  });
});

test('the Settings toggle off means no badge and no overlay', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    click(app, { act: 'settings' });
    assert.match(app.elements.get('scroll').innerHTML, /RIR CALIBRATION · ON/);
    click(app, { act: 'calibtoggle' });
    assert.strictEqual(app.storage.getItem('gains_calib'), 'off');
    assert.match(app.elements.get('scroll').innerHTML, /RIR CALIBRATION · OFF/);

    click(app, { act: 'day', id: 'day2' });
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /calib-b/);
    const last = upToLast(app, 'day2', 'm4_bayesian_curl');
    app.toggleSet('day2', 'm4_bayesian_curl', last);
    assert.strictEqual(app.view.calib, null);
  });
});

test('closing out the week on the calibration set still saves into that week', () => {
  withApp({ storage: meso4AtWeek(5) }, app => {
    ['day1', 'day3', 'day4', 'day5'].forEach(id => app.completeDay(id));
    click(app, { act: 'donex' });
    click(app, { act: 'day', id: 'day2' });
    // Everything on PULL done except the curl's last set.
    app.DAYS.find(d => d.id === 'day2').exercises.forEach(o => app.state.day2.sets[o.id].fill(true));
    const last = app.state.day2.sets.m4_bayesian_curl.length - 1;
    app.state.day2.sets.m4_bayesian_curl[last] = false;
    app.toggleSet('day2', 'm4_bayesian_curl', last);

    assert.ok(app.view.done && app.view.done.weekDone, 'the week did not close');
    assert.strictEqual(app.currentWeek, 6);
    assert.ok(app.view.calib, 'the calibration must survive the week advance');
    // The celebration wins; the calibration waits behind it.
    assert.doesNotMatch(app.elements.get('overlays').innerHTML, /reps to failure/);
    click(app, { act: 'donex' });
    assert.match(app.elements.get('overlays').innerHTML, /reps to failure/);
    click(app, { act: 'calib+' });
    click(app, { act: 'calibsave' });

    const w5 = JSON.parse(app.storage.getItem('hypertrophy_state_meso4_w5'));
    assert.strictEqual(w5.day2.calib.m4_bayesian_curl.extra, 1);
    assert.ok(!app.state.day2.calib.m4_bayesian_curl, 'nothing leaks into week 6');
  });
});

// --------------------------------------------------------------- key sites

function calibWeek(extra) {
  return JSON.stringify({ day2: { sets: { m4_bayesian_curl: [true, true, true, true] },
    calib: { m4_bayesian_curl: { setIdx: 3, prescribedRir: 1, extra } } } });
}

test('PROGRESS lists each calibration and the mean offset', () => {
  const storage = meso4AtWeek(6, {
    hypertrophy_state_meso4_w5: JSON.stringify({
      day2: { sets: { m4_bayesian_curl: [true, true, true, true] }, calib: { m4_bayesian_curl: { setIdx: 3, prescribedRir: 1, extra: 3 } } },
      day5: { sets: { m4_cable_crunch: [true, true, true] }, calib: { m4_cable_crunch: { setIdx: 2, prescribedRir: 1, extra: 2 } } },
    }),
  });
  withApp({ storage }, app => {
    click(app, { act: 'view', v: 'progress' });
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /RIR CALIBRATION/);
    assert.match(html, /Bayesian[^<]*<\/span><span>predicted 1 · actual 3 · \+2/);
    assert.match(html, /predicted 1 · actual 2 · \+1/);
    assert.match(html, /YOU STOP ~1\.5 REPS EARLIER THAN YOU THINK/);
  });
});

test('calib is cleared by Clear Week, exported, and restored by import', () => {
  let text;
  withApp({ storage: meso4AtWeek(5, { hypertrophy_state_meso4_w5: calibWeek(2) }) }, app => {
    assert.strictEqual(app.state.day2.calib.m4_bayesian_curl.extra, 2);
    app.exportData();
    text = app.lastBlob;
    assert.strictEqual(JSON.parse(text).programs.meso4.weeks['5'].day2.calib.m4_bayesian_curl.extra, 2);
    assert.strictEqual(JSON.parse(text).version, 3);
    click(app, { act: 'clearweek' });
    assert.match(app.view.confirm.msg, /RIR calibrations/);
    click(app, { act: 'cfok' });
    assert.deepStrictEqual(app.state.day2.calib, {});
  });
  withApp({ storage: { hypertrophy_seen_programs: SEEN } }, app => {
    app.importData({ target: { files: [{ _content: text }], value: '' } });
    assert.strictEqual(app.state.day2.calib.m4_bayesian_curl.extra, 2);
  });
});

test('gains_calib is device-local: not in the export', () => {
  withApp({ storage: meso4AtWeek(5, { gains_calib: 'off' }) }, app => {
    app.exportData();
    assert.doesNotMatch(app.lastBlob, /gains_calib/);
  });
});
