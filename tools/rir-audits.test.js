'use strict';
// RIR audits: the lifter calls their own reps in reserve before going to
// failure, audits repeat (first Overload + first High Stimulus week), unsafe
// lifts are never audited, and each lift's track record becomes a bias that
// adjusts the RPE cue on its card. Builds on tools/rir-calibration.test.js.
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

const app0 = loadApp();
const SEEN = JSON.stringify(app0.PROGRAMS.map(p => p.id));
const prog = id => app0.PROGRAMS.find(p => p.id === id);
const MESO4 = prog('meso4'), MESO5 = prog('meso5');
const idx = p => String(app0.PROGRAMS.indexOf(p));

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}
const at = (p, week, extra = {}) => ({
  hypertrophy_seen_programs: SEEN, hypertrophy_program: idx(p), [`hypertrophy_week_${p.id}`]: String(week), ...extra,
});
function upToLast(app, dayId, exId) {
  const arr = app.state[dayId].sets[exId];
  for (let i = 0; i < arr.length - 1; i++) arr[i] = true;
  return arr.length - 1;
}
// One stored audit week: { dayId: { exId: record } }.
function auditWeek(days) {
  const out = {};
  for (const [dayId, recs] of Object.entries(days)) out[dayId] = { sets: {}, calib: recs };
  return JSON.stringify(out);
}

// ------------------------------------------------------------- schedule

test('audits run in the first Overload and the first High Stimulus week', () => {
  assert.deepStrictEqual(app0.calibrationWeekIdxs(MESO4), [2, 4]);
  assert.deepStrictEqual(app0.calibrationWeekIdxs(MESO5), [2, 4]);
  assert.deepStrictEqual(app0.calibrationWeekIdxs(prog('meso2')), [], 'meso2 names its phases differently');
  // Never in a deload, Foundation or Overreach week, and at most one set a day.
  for (const p of [MESO4, MESO5]) {
    p.weekPhases.forEach((ph, w) => {
      const any = p.days.some(d => app0.calibrationTarget(d, w, p));
      if (['Foundation', 'Overreach', 'Deload'].includes(ph.label)) assert.ok(!any, `${p.id} week ${w + 1}`);
    });
  }
});

test('meso5 audits in week 3 as well as week 5', () => {
  const t = d => app0.calibrationTarget(MESO5.days.find(x => x.id === d), 2, MESO5);
  assert.deepStrictEqual(t('day1'), { exId: 'm5_oh_cable_ext', setIdx: 2 });
  assert.deepStrictEqual(t('day5'), { exId: 'm5_seated_calf', setIdx: 4 });
});

// --------------------------------------------------------------- safety

test('free bars, the Smith machine and joint-limited moves are never audited', () => {
  for (const n of ['EZ-Bar Curl', 'EZ-Bar Skull Crusher (to forehead)', 'Smith Calf Raise (on a plate)', 'Smith Machine Calf Raise',
    'Nordic Curl (assisted)', 'Ab Wheel Rollout', 'Sissy Squat (assisted)', 'DB Reverse Lunge', 'Seated Good Morning', 'Glute-Ham Raise', 'Barbell Curl']) {
    assert.strictEqual(app0.calibSafeName(n), false, n);
  }
  for (const n of ['Bayesian Cable Curl', 'EZ-Bar Cable Curl', 'Incline DB Curl', 'Seated Calf Raise', 'Machine Preacher Curl', 'Cable Crunch']) {
    assert.strictEqual(app0.calibSafeName(n), true, n);
  }
});

test('swapping the audited lift to an EZ bar takes the audit off it', () => {
  withApp({ storage: at(MESO5, 5) }, app => {
    click(app, { act: 'day', id: 'day2' });
    const day = app.DAYS.find(d => d.id === 'day2');
    assert.deepStrictEqual(app.liveCalibration(day), { exId: 'm5_bayesian_curl', setIdx: 3 });
    app.state.day2.swaps.m5_bayesian_curl = 'm5_alt_ez_curl';
    const t = app.liveCalibration(day);
    assert.ok(!t || t.exId !== 'm5_alt_ez_curl', 'an EZ-bar curl was chosen for failure');
  });
});

test('a twinge or pain on the lift today skips the audit', () => {
  for (const level of ['twinge', 'pain']) {
    withApp({ storage: at(MESO5, 5) }, app => {
      click(app, { act: 'day', id: 'day2' });
      app.state.day2.joint.m5_bayesian_curl = level;
      click(app, { act: 'day', id: 'day2' });
      assert.doesNotMatch(app.elements.get('scroll').innerHTML, /calib-b/);
      const last = upToLast(app, 'day2', 'm5_bayesian_curl');
      app.toggleSet('day2', 'm5_bayesian_curl', last);
      assert.strictEqual(app.view.calib, null, level);
    });
  }
});

test('pain on the lift last week skips this week\'s audit too', () => {
  const storage = at(MESO5, 5, {
    hypertrophy_state_meso5_w4: JSON.stringify({ day2: { sets: { m5_bayesian_curl: [true, true, true] }, joint: { m5_bayesian_curl: 'pain' } } }),
  });
  withApp({ storage }, app => {
    click(app, { act: 'day', id: 'day2' });
    const t = app.liveCalibration(app.DAYS.find(d => d.id === 'day2'));
    assert.strictEqual(t, null);
  });
});

// ------------------------------------------------------- the lifter's call

test('the overlay asks for the call first, then the reps to failure, and saves both', () => {
  withApp({ storage: at(MESO5, 3) }, app => {
    app.setClock(() => 777);
    click(app, { act: 'day', id: 'day5' });
    const ex = 'm5_seated_calf';
    const last = upToLast(app, 'day5', ex);
    app.toggleSet('day5', ex, last);
    const c = app.view.calib;
    assert.ok(c, 'no audit overlay');
    assert.strictEqual(c.step, 'call');
    // Overload is RPE 7–8.5: prescribed 1.5 in reserve, the call starts at 2.
    assert.strictEqual(c.prescribedRir, 1.5);
    assert.strictEqual(c.predicted, 2);
    let html = app.elements.get('overlays').innerHTML;
    assert.match(html, /How many reps do you have left\?/);
    assert.match(html, /data-act="calibnext">GO TO FAILURE/);
    assert.doesNotMatch(html, /calibsave/, 'no SAVE before the call is made');

    click(app, { act: 'calib-' });
    assert.strictEqual(app.view.calib.predicted, 1);
    assert.strictEqual(app.view.calib.extra, 0, 'the call step must not touch extra');
    click(app, { act: 'calibnext' });
    html = app.elements.get('overlays').innerHTML;
    assert.match(html, /How many more reps to failure\?/);
    assert.match(html, /you called 1/);
    click(app, { act: 'calib+' }); click(app, { act: 'calib+' }); click(app, { act: 'calib+' });
    assert.strictEqual(app.view.calib.predicted, 1, 'the fail step must not touch the call');
    click(app, { act: 'calibsave' });
    assert.deepStrictEqual(app.state.day5.calib[ex], { setIdx: last, prescribedRir: 1.5, extra: 3, at: 777, predictedRir: 1 });
  });
});

test('the call stays within 0–5', () => {
  withApp({ storage: at(MESO5, 3) }, app => {
    click(app, { act: 'day', id: 'day5' });
    app.toggleSet('day5', 'm5_seated_calf', upToLast(app, 'day5', 'm5_seated_calf'));
    for (let i = 0; i < 9; i++) click(app, { act: 'calib+' });
    assert.strictEqual(app.view.calib.predicted, 5);
    assert.match(app.elements.get('overlays').innerHTML, /aria-label="One more" disabled/);
    for (let i = 0; i < 9; i++) click(app, { act: 'calib-' });
    assert.strictEqual(app.view.calib.predicted, 0);
  });
});

test('SKIP at the call stores nothing', () => {
  withApp({ storage: at(MESO5, 3) }, app => {
    click(app, { act: 'day', id: 'day5' });
    app.toggleSet('day5', 'm5_seated_calf', upToLast(app, 'day5', 'm5_seated_calf'));
    click(app, { act: 'calibskip' });
    assert.strictEqual(app.view.calib, null);
    assert.deepStrictEqual(app.state.day5.calib, {});
  });
});

test('a record scores against the call, or the prescription when it has none', () => {
  assert.strictEqual(app0.calibPredicted({ prescribedRir: 1, predictedRir: 3, extra: 2 }), 3);
  assert.strictEqual(app0.calibPredicted({ prescribedRir: 1, extra: 2 }), 1);
  assert.strictEqual(app0.calibPredicted({ prescribedRir: 1 }), null);
  assert.strictEqual(app0.calibPredicted(null), null);
});

test('the analyzer scores against the call too', () => {
  const { calibrationSummary } = require('./analyze-history');
  const sum = calibrationSummary({
    3: { day5: { calib: { m5_seated_calf: { setIdx: 4, prescribedRir: 1.5, predictedRir: 1, extra: 3 } } } },
    5: { day5: { calib: { m5_seated_calf: { setIdx: 5, prescribedRir: 1, extra: 2 } } } },
  });
  assert.deepStrictEqual(sum.entries.map(e => [e.week, e.predicted, e.error]), [[3, 1, 2], [5, 1, 1]]);
  assert.strictEqual(sum.meanOffset, 1.5);
});

// ------------------------------------------------------------- the bias

const rec = (predictedRir, extra, at = 1) => ({ setIdx: 2, prescribedRir: 1, predictedRir, extra, at });

test('the bias is the mean error, shrunk by n/(n+1), rounded, capped at ±2', () => {
  const all = errs => errs.map((error, i) => ({ name: 'Cable Curl', error, at: i }));
  assert.strictEqual(app0.calibrationBias('Cable Curl', []), null);
  assert.deepStrictEqual(app0.calibrationBias('Cable Curl', all([2])), { n: 1, mean: 2, reps: 1 });
  assert.deepStrictEqual(app0.calibrationBias('cable curl ', all([1])), { n: 1, mean: 1, reps: 0 }, 'one +1 audit is not enough');
  assert.deepStrictEqual(app0.calibrationBias('Cable Curl', all([2, 1])), { n: 2, mean: 1.5, reps: 1 });
  assert.deepStrictEqual(app0.calibrationBias('Cable Curl', all([5, 5, 5])), { n: 3, mean: 5, reps: 2 });
  assert.deepStrictEqual(app0.calibrationBias('Cable Curl', all([-3, -3])), { n: 2, mean: -3, reps: -2 });
});

test('a meso4 audit carries to the same lift in meso5, by name', () => {
  assert.strictEqual(MESO4.days[1].exercises.find(e => e.id === 'm4_bayesian_curl').name,
    MESO5.days[1].exercises.find(e => e.id === 'm5_bayesian_curl').name);
  const storage = at(MESO5, 2, {
    hypertrophy_state_meso4_w3: auditWeek({ day1: { m4_oh_cable_ext: rec(1, 4) } }),
    hypertrophy_state_meso4_w5: auditWeek({ day2: { m4_bayesian_curl: rec(1, 3) } }),
  });
  withApp({ storage }, app => {
    const all = app.allCalibrations();
    assert.deepStrictEqual(all.map(r => [r.progId, r.week, r.name, r.error]).sort(),
      [['meso4', 3, 'Overhead Cable Extension', 3], ['meso4', 5, 'Bayesian Cable Curl', 2]]);
    click(app, { act: 'day', id: 'day2' });
    const html = app.elements.get('scroll').innerHTML;
    const card = html.slice(html.indexOf('Bayesian Cable Curl'));
    assert.match(card, /<b>YOUR RIR<\/b> · 1 audit: you had ~2 more in the tank than you called\. Go 1 rep past where the RPE target feels reached\./);
    click(app, { act: 'day', id: 'day1' });
    assert.match(app.elements.get('scroll').innerHTML, /1 audit: you had ~3 more in the tank than you called\. Go 1 rep past/);
  });
});

test('a negative bias says stop sooner', () => {
  const storage = at(MESO5, 4, {
    hypertrophy_state_meso5_w1: auditWeek({ day5: { m5_seated_calf: rec(3, 1, 1) } }),
    hypertrophy_state_meso5_w2: auditWeek({ day5: { m5_seated_calf: rec(3, 0, 2) } }),
  });
  withApp({ storage }, app => {
    click(app, { act: 'day', id: 'day5' });
    assert.match(app.elements.get('scroll').innerHTML, /2 audits: you had ~2\.5 fewer left than you called\. Stop 2 reps sooner than the RPE target feels\./);
  });
});

test('no hint on a delt lift, in a deload, on the set being audited, or with audits off', () => {
  const recs = {
    hypertrophy_state_meso5_w1: auditWeek({
      day1: { m5_machine_lat_raise: rec(1, 4) }, // a delt: never gets a hint, whatever is stored
      day2: { m5_bayesian_curl: rec(1, 4) },
    }),
  };
  withApp({ storage: at(MESO5, 2, recs) }, app => {
    click(app, { act: 'day', id: 'day1' });
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /YOUR RIR/);
    click(app, { act: 'day', id: 'day2' });
    assert.match(app.elements.get('scroll').innerHTML, /YOUR RIR/);
  });
  withApp({ storage: at(MESO5, 8, recs) }, app => {
    assert.ok(MESO5.weekPhases[7].label === 'Deload');
    click(app, { act: 'day', id: 'day2' });
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /YOUR RIR/);
  });
  withApp({ storage: at(MESO5, 5, recs) }, app => {
    // Week 5 audits the curl itself: its card shows the audit note, not the hint.
    click(app, { act: 'day', id: 'day2' });
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /RIR AUDIT<\/b>/);
    assert.doesNotMatch(html, /YOUR RIR/);
  });
  withApp({ storage: at(MESO5, 2, { ...recs, gains_calib: 'off' }) }, app => {
    click(app, { act: 'day', id: 'day2' });
    assert.doesNotMatch(app.elements.get('scroll').innerHTML, /YOUR RIR/);
  });
});

test('PROGRESS shows each audit with its week, and the bias by lift across blocks', () => {
  const storage = at(MESO5, 6, {
    hypertrophy_state_meso4_w5: auditWeek({ day2: { m4_bayesian_curl: { setIdx: 3, prescribedRir: 1, extra: 3 } } }),
    hypertrophy_state_meso5_w5: auditWeek({ day2: { m5_bayesian_curl: rec(1, 2) } }),
  });
  withApp({ storage }, app => {
    click(app, { act: 'view', v: 'progress' });
    const html = app.elements.get('scroll').innerHTML;
    // This block's audit, scored against the lifter's own call.
    assert.match(html, /Bayesian Cable Curl · W5<\/span><span>called 1 · actual 2 · \+1/);
    // Both blocks feed the lift's bias: errors +2 (meso4, prescribed) and +1.
    assert.match(html, /BIAS BY LIFT · ALL BLOCKS/);
    assert.match(html, /Bayesian Cable Curl<\/span><span>2 audits · \+1\.5 · go 1 past/);
  });
});

test('Settings describes two audits a block and keeps the off switch', () => {
  withApp({ storage: at(MESO5, 1) }, app => {
    click(app, { act: 'settings' });
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /Twice per block, in the first Overload and first High Stimulus weeks/);
    assert.match(html, /never a free bar/);
    assert.match(html, /RIR CALIBRATION · ON/);
  });
});
