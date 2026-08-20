// tools/waist-block.test.js
//
// The waist + conditioning block added to meso3.
//
// The request behind it was "exercises to eliminate the love handles." No such
// exercise exists — flank fat is mobilised systemically, so oblique work does
// not strip the fat sitting on the obliques (see the "Energy balance and
// regional fat" section of docs/training-evidence.md for the three studies).
// What shipped therefore has two halves that must stay together, and these
// tests exist to stop either half drifting away from the other:
//
//   1. TRAINING — anti-rotation / anti-lateral-flexion work that builds the
//      wall under the fat, plus low-impact Zone 2 finishers that widen the
//      deficit at a low recovery cost. Deliberately FLAT (no `ramp`): during a
//      deficit, accessory and conditioning volume holds, it does not climb.
//   2. HONESTY — the PLAN tab has to say, in the app, that the deficit is what
//      removes the fat. Ship the exercises without that panel and the app is
//      selling spot reduction.
//
// Volume consequences (totals, MRV, the deload band) are pinned by
// tools/program-volume.test.js, not here.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, withApp } = require('./app-shim');

const app = loadApp();
const MESO3 = app.PROGRAMS[2];

// exId → the day it lives on.
const HOME = {};
for (const day of MESO3.days) for (const ex of day.exercises) HOME[ex.id] = day.id;

// Waist work goes on the three UPPER-body days. Lower days already carry
// direct ab work (Hanging Leg Raise on day3, Cable Crunch on day5) and are the
// wrong place to stack more fatigue.
const WAIST = {
  m3_pallof_press: 'day1',
  m3_suitcase_carry: 'day2',
  m3_side_plank: 'day4',
};
const ZONE2 = {
  m3_zone2_push: 'day1',
  m3_zone2_pull: 'day2',
  m3_zone2_upper: 'day4',
};

function find(exId) {
  for (const day of MESO3.days) {
    const ex = day.exercises.find(e => e.id === exId);
    if (ex) return ex;
  }
  return null;
}

// ── 1. The movements are on the days they were designed for ──────────────────

for (const [exId, dayId] of Object.entries({ ...WAIST, ...ZONE2 })) {
  test(`${exId} lives on meso3 ${dayId}`, () => {
    assert.strictEqual(HOME[exId], dayId,
      `${exId} is on ${HOME[exId] || 'no day'}, expected ${dayId}`);
  });
}

test('no waist or conditioning work lands on a lower day', () => {
  const lower = MESO3.days.filter(d => d.id === 'day3' || d.id === 'day5');
  const added = new Set([...Object.keys(WAIST), ...Object.keys(ZONE2)]);
  for (const day of lower) {
    for (const ex of day.exercises) {
      assert.ok(!added.has(ex.id),
        `${ex.id} is on ${day.id} (${day.title}) — Zone 2 and extra waist volume ` +
        `stay off lower days, they cost recovery the ramped lifts need`);
    }
  }
});

// ── 2. Waist work is trained as muscle, and it stays flat ────────────────────

test('every waist movement credits abs and carries no ramp', () => {
  for (const exId of Object.keys(WAIST)) {
    const ex = find(exId);
    assert.ok(ex, `${exId} is missing from meso3`);
    assert.strictEqual(ex.muscles.abs, 1, `${exId} must credit abs directly`);
    assert.strictEqual(ex.sets, 2, `${exId} is prescribed at 2 sets`);
    assert.ok(!ex.ramp,
      `${exId} carries a ramp — waist volume holds during a deficit, it does not climb`);
    for (const week of [1, 4, 7]) {
      assert.strictEqual(app.setsForWeek(ex, week, MESO3), 2,
        `${exId} should prescribe 2 sets in week ${week}`);
    }
  }
});

// Rest is what makes this a ~6-minute block rather than another 15 minutes of
// session. 2 sets at 45s rest is roughly 3 minutes per movement.
test('waist work rests short enough to stay a finisher', () => {
  for (const exId of Object.keys(WAIST)) {
    const ex = find(exId);
    assert.ok(ex.rest <= 60,
      `${exId} rests ${ex.rest}s — the waist block is time-boxed, keep it at or under 60s`);
  }
});

// Loaded lateral flexion (heavy side bends, weighted twists) hypertrophies the
// obliques in the plane that widens the waist. The whole point of the block is
// the opposite, so the prescriptions are anti-rotation and anti-lateral-flexion.
test('the waist block is anti-rotation work, not loaded side bends', () => {
  const banned = /side bend|russian twist|oblique crunch/i;
  for (const day of MESO3.days) {
    for (const ex of day.exercises) {
      assert.ok(!banned.test(ex.name),
        `${ex.id} (${ex.name}) is loaded lateral flexion — it thickens the waist ` +
        `it is meant to narrow`);
    }
  }
});

// ── 3. Conditioning is low-impact, short, and honest about what it is ────────

test('Zone 2 finishers are one timed set at an easy RPE', () => {
  for (const exId of Object.keys(ZONE2)) {
    const ex = find(exId);
    assert.ok(ex, `${exId} is missing from meso3`);
    assert.strictEqual(ex.sets, 1, `${exId} is one block, not a set scheme`);
    assert.match(ex.reps, /min/, `${exId} is prescribed in minutes, not reps`);
    assert.strictEqual(ex.rpe, '5–6',
      `${exId} must stay conversational — harder conditioning starts costing the lifting`);
  }
});

// The concurrent-training meta-analysis in the evidence doc found interference
// from running, not from cycling. Every prescribed and swappable modality has
// to be low-impact.
test('no Zone 2 option is running', () => {
  const running = /\brun|jog|sprint|treadmill run/i;
  for (const exId of Object.keys(ZONE2)) {
    const ex = find(exId);
    assert.ok(!running.test(`${ex.name} ${ex.note}`), `${exId} prescribes running`);
    const alts = app.EXERCISE_ALTERNATIVES[exId] || [];
    assert.ok(alts.length >= 2, `${exId} needs alternatives — equipment gets taken`);
    for (const alt of alts) {
      assert.ok(!running.test(`${alt.name} ${alt.note}`),
        `${exId} alternative ${alt.id} (${alt.name}) is running — interference risk`);
    }
  }
});

// muscles: {} is load-bearing, not an oversight. tools/muscle-map.test.js
// requires every program exercise to resolve muscle credits from either the map
// or an inline field; conditioning legitimately credits nothing, and an empty
// object satisfies that check without inventing volume that never happened.
test('Zone 2 carries an explicit empty muscle map', () => {
  for (const exId of Object.keys(ZONE2)) {
    const ex = find(exId);
    assert.ok(ex.muscles, `${exId} has no muscles field — muscle-map.test.js will flag it`);
    assert.deepStrictEqual(ex.muscles, {},
      `${exId} must credit no muscle — conditioning is not hypertrophy volume`);
  }
});

// ── 4. Every new movement can be swapped ─────────────────────────────────────

test('every added movement has alternatives', () => {
  for (const exId of [...Object.keys(WAIST), ...Object.keys(ZONE2)]) {
    const alts = app.EXERCISE_ALTERNATIVES[exId];
    assert.ok(Array.isArray(alts) && alts.length >= 2,
      `${exId} has no swap options`);
    for (const alt of alts) {
      for (const field of ['id', 'name', 'sets', 'reps', 'rpe', 'rest', 'restLabel']) {
        assert.ok(alt[field] != null, `${exId} alternative ${alt.id} is missing ${field}`);
      }
    }
  }
});

test('added exercise and alternative ids are unique across the app', () => {
  const seen = new Set();
  for (const prog of app.PROGRAMS) {
    for (const day of prog.days) for (const ex of day.exercises) {
      assert.ok(!seen.has(ex.id), `duplicate exercise id: ${ex.id}`);
      seen.add(ex.id);
    }
  }
  for (const [orig, alts] of Object.entries(app.EXERCISE_ALTERNATIVES)) {
    for (const alt of alts) {
      assert.ok(!seen.has(alt.id), `alternative ${alt.id} (under ${orig}) collides with another id`);
      seen.add(alt.id);
    }
  }
});

// ── 5. The app tells the truth about where the fat goes ──────────────────────

test('PLAN renders the fat-loss panel', () => {
  withApp({ storage: { hypertrophy_program: '2' } }, a => {
    a.view.name = 'plan';
    const scroll = a.elements.get('scroll');
    scroll.innerHTML = '';
    a.render();
    const html = scroll.innerHTML;
    assert.match(html, /FAT LOSS/,
      'the PLAN tab has no fat-loss panel — shipping the waist work without it ' +
      'is the app implying spot reduction works');
    assert.match(html, /Spot reduction is not real/,
      'the panel must say plainly that no exercise burns flank fat');
    assert.match(html, /0\.5–1% of bodyweight per week/, 'the panel must state a rate of loss');
    assert.match(html, /1\.6–2\.2 g/, 'the panel must state a protein target');
    assert.match(html, /steps/i, 'the panel must state a step target — NEAT outweighs the finishers');
  });
});

test('the glossary defines spot reduction and the deficit', () => {
  withApp({ storage: { hypertrophy_program: '2' } }, a => {
    a.view.name = 'plan';
    const scroll = a.elements.get('scroll');
    scroll.innerHTML = '';
    a.render();
    for (const term of ['spot reduction', 'energy deficit', 'NEAT', 'Zone 2']) {
      assert.ok(scroll.innerHTML.includes(term),
        `the glossary is missing "${term}"`);
    }
  });
});
