'use strict';
// Phase 2 of the completeness roadmap: the live stall / too-light detector.
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

const app0 = loadApp();
const { progressionFlag, STALL_WINDOW } = app0;
const MESO4_IDX = app0.PROGRAMS.findIndex(p => p.id === 'meso4');
const MESO4 = app0.PROGRAMS[MESO4_IDX];

// Eight plain training weeks, with a deload in week 4 for the deload cases.
const PLAIN = Array.from({ length: 8 }, () => ({ label: 'Overload', rpe: 'RPE 7–8.5' }));
const WITH_DELOAD = PLAIN.map((p, i) => (i === 3 ? { label: 'Deload', rpe: 'RPE 6–7' } : p));

const h = (week, weight, effort, reps = 8, extra = {}) =>
  ({ week, weight, reps, effort, setReps: {}, doneSets: 3, openSets: 0, ...extra });

test('the window is three weeks', () => {
  assert.strictEqual(STALL_WINDOW, 3);
});

const CASES = [
  {
    name: 'flat load and reps with a high-effort week → stalled',
    hist: [h(1, 85, 'medium'), h(2, 85, 'high'), h(3, 85, 'medium')],
    want: 'stalled',
  },
  {
    name: 'flat load but reps rising → null',
    hist: [h(1, 85, 'high', 8), h(2, 85, 'high', 9), h(3, 85, 'high', 10)],
    want: null,
  },
  {
    name: 'per-set reps rising count as a rep gain',
    hist: [h(1, 85, 'high', 8, { setReps: { 0: 8, 1: 7 } }), h(2, 85, 'high', 8, { setReps: { 0: 9 } }), h(3, 85, 'high', 8)],
    want: null,
  },
  {
    name: 'load rising → null',
    hist: [h(1, 85, 'high'), h(2, 85, 'high'), h(3, 90, 'high')],
    want: null,
  },
  {
    name: 'flat load at medium effort is not a stall',
    hist: [h(1, 85, 'medium'), h(2, 85, 'medium'), h(3, 85, 'medium')],
    want: null,
  },
  {
    name: '3× low with flat load → light',
    hist: [h(1, 85, 'low'), h(2, 85, 'low'), h(3, 85, 'low')],
    want: 'light',
  },
  {
    name: '3× low with the load going up is fine',
    hist: [h(1, 85, 'low'), h(2, 90, 'low'), h(3, 95, 'low')],
    want: null,
  },
  {
    name: 'only the last three weeks are judged',
    hist: [h(1, 60, 'high'), h(2, 70, 'high'), h(3, 80, 'high'), h(4, 80, 'high'), h(5, 80, 'high')],
    want: 'stalled',
  },
  {
    name: 'only 2 logged weeks → null',
    hist: [h(1, 85, 'high'), h(2, 85, 'high')],
    want: null,
  },
  {
    name: 'a gap in logged weeks breaks the run',
    hist: [h(1, 85, 'high'), h(2, 85, 'high'), h(4, 85, 'high')],
    want: null,
  },
  {
    name: 'a deload week in the middle is skipped, not counted as a break',
    phases: WITH_DELOAD,
    hist: [h(2, 85, 'high'), h(3, 85, 'high'), h(4, 60, 'low'), h(5, 85, 'high')],
    want: 'stalled',
  },
  {
    name: 'an unlogged deload week in the middle is not a break either',
    phases: WITH_DELOAD,
    hist: [h(2, 85, 'low'), h(3, 85, 'low'), h(5, 85, 'low')],
    want: 'light',
  },
  {
    name: 'the current, incomplete week is ignored',
    opts: { currentWeek: 4 },
    hist: [h(2, 85, 'high'), h(3, 85, 'high'), h(4, 85, 'high', 8, { openSets: 2, doneSets: 1 })],
    want: null,
  },
  {
    name: 'the current week counts once it is finished',
    opts: { currentWeek: 4 },
    hist: [h(2, 85, 'high'), h(3, 85, 'high'), h(4, 85, 'high')],
    want: 'stalled',
  },
  {
    name: 'a week with prefilled values but nothing performed is not a data point',
    hist: [h(1, 85, 'high'), h(2, 85, 'high', 8, { doneSets: 0 }), h(3, 85, 'high')],
    want: null,
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const got = progressionFlag(c.hist, c.phases || PLAIN, c.opts || {});
    assert.strictEqual(got ? got.kind : null, c.want);
    if (got) {
      assert.strictEqual(got.weeks, 3);
      assert.ok(got.reason.length > 0);
    }
  });
}

test('light wins when both rules match, with the actionable reason', () => {
  // All three LOW can never also contain a HIGH, so "both match" means the
  // light rule is checked first. Pin the message text the UI shows.
  const got = progressionFlag([h(1, 85, 'low'), h(2, 85, 'low'), h(3, 85, 'low')], PLAIN);
  assert.strictEqual(got.kind, 'light');
  assert.strictEqual(got.reason, 'rated LOW 3 weeks running with no load increase: add weight');
  const st = progressionFlag([h(1, 85, 'high'), h(2, 85, 'high'), h(3, 85, 'high')], PLAIN);
  assert.strictEqual(st.reason, 'no load or rep gain in 3 weeks at high effort');
});

// ------------------------------------------------------------- rendering

function seenSeed() {
  return { hypertrophy_seen_programs: JSON.stringify(app0.PROGRAMS.map(p => p.id)) };
}

// Weeks 1–3 of meso4 logged in full: the incline press flat at high effort
// (stalled, has alternatives), the machine press flat at LOW (too light), the
// pec deck progressing (no flag). The app opens on week 4.
function meso4Storage() {
  const day = MESO4.days[0];
  const ids = ['m4_incline_db_press', 'm4_machine_chest_press', 'm4_pec_deck'];
  ids.forEach(id => assert.ok(day.exercises.some(e => e.id === id), `${id} missing from meso4 day1`));
  const storage = { ...seenSeed(), hypertrophy_program: String(MESO4_IDX), hypertrophy_week_meso4: '4' };
  for (let w = 1; w <= 3; w++) {
    storage[`hypertrophy_state_meso4_w${w}`] = JSON.stringify({
      [day.id]: {
        sets: Object.fromEntries(ids.map(id => [id, [true, true, true]])),
        weights: { m4_incline_db_press: 60, m4_machine_chest_press: 100, m4_pec_deck: 80 + w * 5 },
        reps: { m4_incline_db_press: 8, m4_machine_chest_press: 12, m4_pec_deck: 12 },
        effort: { m4_incline_db_press: 'high', m4_machine_chest_press: 'low', m4_pec_deck: 'high' },
        protocol: [], swaps: {},
      },
    });
  }
  return storage;
}

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

// The markup for one exercise card, from its name to the next card.
function cardFor(html, name) {
  const i = html.indexOf(name);
  assert.ok(i !== -1, `${name} not rendered`);
  const m = /<div class="ex( sel)?">/.exec(html.slice(i));
  return html.slice(i, m ? i + m.index : undefined);
}

test('PROGRESS tags flagged rows, gives the reason, and counts flags', () => {
  withApp({ storage: meso4Storage() }, app => {
    assert.strictEqual(app.currentProgramIdx, MESO4_IDX);
    assert.strictEqual(app.currentWeek, 4);
    click(app, { act: 'view', v: 'progress' });
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /2 FLAGS/);
    assert.match(html, /Incline DB Press<span class="flag-tag stalled">STALLED<\/span>/);
    assert.match(html, /Machine Chest Press<span class="flag-tag light">TOO LIGHT<\/span>/);
    assert.match(html, /no load or rep gain in 3 weeks at high effort/);
    assert.match(html, /rated LOW 3 weeks running with no load increase: add weight/);
    assert.doesNotMatch(html, /Pec Deck<span class="flag-tag/);
  });
});

test('the day card shows the banner, with SWAP only for a stall', () => {
  withApp({ storage: meso4Storage() }, app => {
    click(app, { act: 'day', id: 'day1' });
    const html = app.elements.get('scroll').innerHTML;

    const incline = cardFor(html, 'Incline DB Press');
    assert.match(incline, /class="ex-flag stalled"/);
    assert.match(incline, /<b>STALLED<\/b> · no load or rep gain/);
    assert.match(incline, /class="ex-flag-swap" data-act="swap" data-orig="m4_incline_db_press">SWAP/);

    const machine = cardFor(html, 'Machine Chest Press');
    assert.match(machine, /class="ex-flag light"/);
    assert.doesNotMatch(machine, /ex-flag-swap/);

    assert.doesNotMatch(cardFor(html, 'Pec Deck'), /class="ex-flag/);
  });
});

test('the banner SWAP link opens the swap sheet', () => {
  withApp({ storage: meso4Storage() }, app => {
    click(app, { act: 'day', id: 'day1' });
    click(app, { act: 'swap', orig: 'm4_incline_db_press' });
    assert.deepStrictEqual(app.view.swap, { dayId: 'day1', origId: 'm4_incline_db_press' });
    assert.match(app.elements.get('overlays').innerHTML, /Swap Exercise/);
  });
});

test('history follows the swapped-in exercise', () => {
  const storage = meso4Storage();
  const alt = app0.EXERCISE_ALTERNATIVES.m4_incline_db_press[0].id;
  // Week 4: swap in the alternative. Its own history is empty, so no flag.
  storage['hypertrophy_state_meso4_w4'] = JSON.stringify({ day1: { swaps: { m4_incline_db_press: alt } } });
  withApp({ storage }, app => {
    click(app, { act: 'day', id: 'day1' });
    const html = app.elements.get('scroll').innerHTML;
    assert.doesNotMatch(html, /data-orig="m4_incline_db_press">SWAP/);
  });
});
