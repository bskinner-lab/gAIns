'use strict';
// Phase 3 of the completeness roadmap: a per-exercise, per-session shoulder
// flag (state[dayId].joint[exId] = 'ok' | 'twinge' | 'pain').
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

const app0 = loadApp();
const SEEN = JSON.stringify(app0.PROGRAMS.map(p => p.id));
const MESO4_IDX = app0.PROGRAMS.findIndex(p => p.id === 'meso4');
const EX = 'm4_incline_db_press';
const DAY = 'day1';

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

function meso4(week, blobs = {}) {
  const storage = { hypertrophy_seen_programs: SEEN, hypertrophy_program: String(MESO4_IDX), hypertrophy_week_meso4: String(week) };
  for (const [w, blob] of Object.entries(blobs)) storage[`hypertrophy_state_meso4_w${w}`] = JSON.stringify(blob);
  return storage;
}

// A week with the press done in full and the given shoulder rating.
function pressWeek(joint) {
  return { [DAY]: { sets: { [EX]: [true, true, true, true] }, weights: { [EX]: 60 }, effort: { [EX]: 'medium' }, joint: joint ? { [EX]: joint } : {} } };
}

function savedJoint(app, week) {
  const blob = JSON.parse(app.storage.getItem(`hypertrophy_state_meso4_w${week}`) || '{}');
  return ((blob[DAY] || {}).joint || {})[EX];
}

function cardFor(html, name) {
  const i = html.indexOf(name);
  assert.ok(i !== -1, `${name} not rendered`);
  const m = /<div class="ex( sel)?">/.exec(html.slice(i));
  return html.slice(i, m ? i + m.index : undefined);
}

// --------------------------------------------------------- toggling

test('every card has a SHOULDER row with OK · TWINGE · PAIN', () => {
  withApp({ storage: meso4(1) }, app => {
    click(app, { act: 'day', id: DAY });
    const card = cardFor(app.elements.get('scroll').innerHTML, 'Incline DB Press');
    assert.match(card, /SHOULDER/);
    for (const l of ['ok', 'twinge', 'pain']) {
      assert.match(card, new RegExp(`data-act="joint" data-ex="${EX}" data-l="${l}"`));
    }
  });
});

test('tapping sets the level, tapping it again clears it, and it persists across reload', () => {
  let store;
  withApp({ storage: meso4(1) }, app => {
    click(app, { act: 'day', id: DAY });
    click(app, { act: 'joint', ex: EX, l: 'twinge' });
    assert.strictEqual(app.state[DAY].joint[EX], 'twinge');
    assert.strictEqual(savedJoint(app, 1), 'twinge');
    assert.match(app.elements.get('scroll').innerHTML, /class="eff jnt on twinge"/);

    click(app, { act: 'joint', ex: EX, l: 'pain' });
    assert.strictEqual(app.state[DAY].joint[EX], 'pain');
    click(app, { act: 'joint', ex: EX, l: 'pain' });
    assert.strictEqual(app.state[DAY].joint[EX], undefined);
    assert.strictEqual(savedJoint(app, 1), undefined);

    click(app, { act: 'joint', ex: EX, l: 'ok' });
    store = { ...app.storage._store };
  });
  withApp({ storage: store }, app => {
    assert.strictEqual(app.state[DAY].joint[EX], 'ok');
  });
});

test('an unknown level is ignored', () => {
  withApp({ storage: meso4(1) }, app => {
    click(app, { act: 'day', id: DAY });
    click(app, { act: 'joint', ex: EX, l: 'agony' });
    assert.deepStrictEqual(app.state[DAY].joint, {});
  });
});

// ------------------------------------------------------ per-day key sites

test('a shoulder flag travels with an exercise that moved to another day', () => {
  // meso3's Machine Chest Press moved day1 → day4; a blob written before the
  // move files it under day1.
  const MOVED = 'm3_machine_chest_press';
  const meso3 = app0.PROGRAMS.findIndex(p => p.id === 'meso3');
  const storage = {
    hypertrophy_seen_programs: SEEN, hypertrophy_program: String(meso3), hypertrophy_week_meso3: '1',
    hypertrophy_state_meso3_w1: JSON.stringify({ day1: { sets: { [MOVED]: [true] }, joint: { [MOVED]: 'pain' } } }),
  };
  withApp({ storage }, app => {
    assert.strictEqual(app.state.day4.joint[MOVED], 'pain');
    assert.strictEqual(app.state.day1.joint[MOVED], undefined);
  });
});

test('Clear Week clears the shoulder flags, and the confirm says so', () => {
  withApp({ storage: meso4(1) }, app => {
    click(app, { act: 'day', id: DAY });
    click(app, { act: 'joint', ex: EX, l: 'pain' });
    click(app, { act: 'clearweek' });
    assert.match(app.view.confirm.msg, /shoulder flags/);
    click(app, { act: 'cfok' });
    assert.deepStrictEqual(app.state[DAY].joint, {});
    assert.strictEqual(savedJoint(app, 1), undefined);
  });
});

test('a shoulder flag is NOT prefilled into the next week', () => {
  withApp({ storage: meso4(2, { 1: pressWeek('twinge') }) }, app => {
    assert.strictEqual(app.currentWeek, 2);
    assert.strictEqual(app.state[DAY].joint[EX], undefined);
    // …while weight and effort, which ARE prefilled, still are.
    assert.strictEqual(Number(app.state[DAY].weights[EX]), 60);
    assert.strictEqual(app.state[DAY].effort[EX], 'medium');
  });
});

test('the flag is in the export JSON and restored by import', () => {
  let text;
  withApp({ storage: meso4(1) }, app => {
    click(app, { act: 'day', id: DAY });
    click(app, { act: 'joint', ex: EX, l: 'twinge' });
    app.exportData();
    text = app.lastBlob;
    const out = JSON.parse(text);
    assert.strictEqual(out.version, 3, 'the export version must not be bumped');
    assert.strictEqual(out.programs.meso4.weeks['1'][DAY].joint[EX], 'twinge');
  });
  withApp({ storage: { hypertrophy_seen_programs: SEEN } }, app => {
    app.importData({ target: { files: [{ _content: text }], value: '' } });
    assert.strictEqual(app.currentProgramIdx, MESO4_IDX);
    assert.strictEqual(app.state[DAY].joint[EX], 'twinge');
  });
});

// ------------------------------------------------------ carry-forward

test('PAIN in week N puts the SHOULDER FLAGGED banner, with SWAP, on week N+1', () => {
  withApp({ storage: meso4(2, { 1: pressWeek('pain') }) }, app => {
    click(app, { act: 'day', id: DAY });
    const card = cardFor(app.elements.get('scroll').innerHTML, 'Incline DB Press');
    assert.match(card, /class="ex-flag joint"/);
    assert.match(card, /<b>SHOULDER FLAGGED LAST WEEK<\/b> · PAIN logged in week 1/);
    assert.match(card, /class="ex-flag-swap" data-act="swap" data-orig="m4_incline_db_press">SWAP/);
  });
});

test('a twinge in 2 of the last 3 weeks flags; one twinge does not', () => {
  withApp({ storage: meso4(4, { 1: pressWeek('twinge'), 2: pressWeek('ok'), 3: pressWeek('twinge') }) }, app => {
    // Week 4 looks back at W1–W3: twinge, ok, twinge → 2 of 3.
    click(app, { act: 'day', id: DAY });
    assert.match(cardFor(app.elements.get('scroll').innerHTML, 'Incline DB Press'), /twinge in 2 of the last 3 weeks/);
  });
  // Week 5 looks back at W2–W4: ok, ok, twinge → 1 of 3. W1's twinge has aged out.
  withApp({ storage: meso4(5, { 1: pressWeek('twinge'), 2: pressWeek('ok'), 3: pressWeek('ok'), 4: pressWeek('twinge') }) }, app => {
    click(app, { act: 'day', id: DAY });
    assert.doesNotMatch(cardFor(app.elements.get('scroll').innerHTML, 'Incline DB Press'), /ex-flag joint/);
  });
});

test('PAIN two weeks back with OK since does not flag', () => {
  withApp({ storage: meso4(3, { 1: pressWeek('pain'), 2: pressWeek('ok') }) }, app => {
    click(app, { act: 'day', id: DAY });
    assert.doesNotMatch(cardFor(app.elements.get('scroll').innerHTML, 'Incline DB Press'), /ex-flag joint/);
  });
});

test('PROGRESS rings the effort dot on a flagged cell', () => {
  withApp({ storage: meso4(3, { 1: pressWeek('twinge'), 2: pressWeek('pain') }) }, app => {
    click(app, { act: 'view', v: 'progress' });
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /class="cell j-twinge">\s*<div class="cell-w">W1</);
    assert.match(html, /class="cell j-pain">\s*<div class="cell-w">W2</);
  });
});
