// tools/superset.test.js
//
// Supersets: two adjacent exercises on a day that share a `superset` key run
// as alternating sets. After the first half of a round the timer is only the
// walk to the partner (and opens minimized, so LOG SET for the partner is
// already on the bar); after the second half it is the longer of the two
// prescribed rests, counted from when the first half was logged, floored at
// SUPERSET_MIN_REST_SEC. That is the whole time saving — each muscle keeps its
// prescribed rest, it just spends part of it watching the partner's set.
//
// Meso 4 PUSH from week 6 is the live fixture: Pec Deck (4 sets, 75 s rest)
// is paired with Half-Kneeling Pallof Press (2 sets, 45 s rest) as 'A'.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');
const { validateProgram } = require('./insert-program');
const FIXTURE = require('./fixtures/program-valid.json');

const { PROGRAMS } = loadApp();

function meso4Week(week) {
  return {
    hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)),
    hypertrophy_program: String(PROGRAMS.findIndex(p => p.id === 'meso4')),
    hypertrophy_week_meso4: String(week),
  };
}

// Log the active set at a pinned moment, the way LOG SET does.
function logAt(app, ms) {
  app.setClock(() => ms);
  app.logActiveSet();
}

const T0 = Date.UTC(2026, 9, 29, 17, 0, 0);

// ── Program data ─────────────────────────────────────────────────────────────

test('every superset in every program pairs exactly two adjacent exercises that share no muscle', () => {
  for (const prog of PROGRAMS) {
    for (const day of prog.days) {
      const groups = {};
      day.exercises.forEach((ex, i) => { if (ex.superset) (groups[ex.superset] ||= []).push(i); });
      for (const [key, idx] of Object.entries(groups)) {
        const where = `${prog.id} ${day.id} superset ${key}`;
        assert.strictEqual(idx.length, 2, `${where}: ${idx.length} exercises`);
        assert.strictEqual(idx[1], idx[0] + 1, `${where}: not adjacent`);
        const [a, b] = idx.map(i => day.exercises[i]);
        const shared = Object.keys(a.muscles || {}).filter(m => m in (b.muscles || {}));
        assert.deepStrictEqual(shared, [], `${where}: ${a.id} and ${b.id} share ${shared}`);
      }
    }
  }
});

test('meso4 runs at least one superset on every day', () => {
  const meso4 = PROGRAMS.find(p => p.id === 'meso4');
  for (const day of meso4.days) {
    const keys = new Set(day.exercises.filter(e => e.superset).map(e => e.superset));
    assert.ok(keys.size >= 1, `${day.id} has no superset`);
  }
});

test('supersetPartner and supersetLabel read pairs in plan order', () => {
  withApp({ storage: meso4Week(6) }, app => {
    const day = app.DAYS.find(d => d.id === 'day1');
    const pec = day.exercises.find(e => e.id === 'm4_pec_deck');
    const pallof = day.exercises.find(e => e.id === 'm4_pallof_press');
    const incline = day.exercises.find(e => e.id === 'm4_incline_db_press');
    assert.strictEqual(app.supersetPartner(day, pec), pallof);
    assert.strictEqual(app.supersetPartner(day, pallof), pec);
    assert.strictEqual(app.supersetPartner(day, incline), null);
    assert.strictEqual(app.supersetLabel(day, pec), 'A1');
    assert.strictEqual(app.supersetLabel(day, pallof), 'A2');
    assert.strictEqual(app.supersetLabel(day, incline), '');
  });
});

// ── The round ────────────────────────────────────────────────────────────────

test('logging the first half moves straight to the partner on a short, minimized timer', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    assert.strictEqual(app.view.selectedExId, 'm4_pallof_press');
    assert.strictEqual(app.view.restTotal, app.SUPERSET_TRANSITION_SEC);
    assert.strictEqual(app.view.restMinimized, true);
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, 'm4_pallof_press');
    assert.match(app.view.restNext, /Pallof/);
  });
});

test('logging the second half rests the longer prescription, minus time since the first half', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    logAt(app, T0 + 30_000); // walk + Pallof set took 30 s
    // max(75, 45) - 30 = 45 s left for the pec deck's chest to recover.
    assert.strictEqual(app.view.restTotal, 45);
    assert.strictEqual(app.view.restMinimized, false);
    assert.strictEqual(app.view.selectedExId, 'm4_pec_deck');
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, 'm4_pec_deck');
    assert.match(app.view.restRec, /SUPERSET/);
  });
});

test('a slow second half never takes the rest under the floor', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    logAt(app, T0 + 70_000);
    assert.strictEqual(app.view.restTotal, app.SUPERSET_MIN_REST_SEC);
  });
});

test('once the shorter exercise runs out, the leftovers are straight sets with their own rest', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    let t = T0;
    for (let round = 0; round < 2; round++) { logAt(app, t += 40_000); logAt(app, t += 30_000); }
    // Pallof's 2 sets are done; Pec Deck has 2 left.
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, 'm4_pec_deck');
    logAt(app, t += 40_000);
    const pec = app.curDay().exercises.find(e => e.id === 'm4_pec_deck');
    assert.strictEqual(app.view.restTotal, pec.rest);
    assert.strictEqual(app.view.restMinimized, false);
    assert.strictEqual(app.view.selectedExId, 'm4_pec_deck');
  });
});

test('a straight-set exercise is untouched by any of this', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    const incline = app.curDay().exercises[0];
    assert.strictEqual(incline.id, 'm4_incline_db_press');
    logAt(app, T0);
    assert.strictEqual(app.view.restTotal, incline.rest);
    assert.strictEqual(app.view.restMinimized, false);
    assert.strictEqual(app.view.selectedExId, null);
    assert.match(app.view.restRec, /^RECOMMENDED/);
  });
});

test('a swapped half still pairs, and rests on the substitute\'s prescription', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    const alt = app.EXERCISE_ALTERNATIVES.m4_pec_deck[0];
    app.view.swap = { dayId: 'day1', origId: 'm4_pec_deck' };
    app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset: { act: 'doswap', orig: 'm4_pec_deck', new: alt.id } } : null) } });
    app.view.selectedExId = 'm4_pec_deck';
    const sub = app.activeSet(app.curDay()).ex; // resolved: fields the alt omits come from the original
    assert.strictEqual(sub.id, alt.id);
    logAt(app, T0);
    assert.strictEqual(app.view.selectedExId, 'm4_pallof_press');
    logAt(app, T0 + 20_000);
    assert.strictEqual(app.view.restTotal, Math.max(sub.rest, 45) - 20);
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, alt.id);
  });
});

test('the legacy toggleSet path pairs the same way', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.setClock(() => T0);
    app.toggleSet('day1', 'm4_pec_deck', 0);
    assert.strictEqual(app.view.selectedExId, 'm4_pallof_press');
    assert.strictEqual(app.view.restTotal, app.SUPERSET_TRANSITION_SEC);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────

test('paired cards carry a header and A1/A2 tags, and the bar names the half', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.name = 'day';
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    app.render();
    const html = app.elements.get('scroll').innerHTML;
    assert.match(html, /class="ss-head"><span>SUPERSET A<\/span>/);
    assert.match(html, /data-t="superset">SUPERSET A1</);
    assert.match(html, /data-t="superset">SUPERSET A2</);
    assert.strictEqual((html.match(/class="ss-head"/g) || []).length, 3, 'one header per PUSH pair');
    assert.match(app.elements.get('bottombar').innerHTML, /REPS · A1</);
  });
});

// ── Validator (for /newplan) ─────────────────────────────────────────────────

function fixtureWith(mutate) {
  const prog = JSON.parse(JSON.stringify(FIXTURE));
  mutate(prog.days[0].exercises);
  return prog;
}

test('the validator accepts a well-formed pair', () => {
  const prog = fixtureWith(exs => {
    exs[0].superset = 'A'; exs[1].superset = 'A';
    exs[0].muscles = { chest: 1 }; // the fixture's press also credits triceps
  });
  assert.deepStrictEqual(validateProgram(prog), []);
});

test('the validator rejects a pair whose halves share a muscle', () => {
  const prog = fixtureWith(exs => { exs[0].superset = 'A'; exs[1].superset = 'A'; });
  assert.ok(validateProgram(prog).some(e => /share triceps/.test(e)));
});

test('the validator rejects a lone, a triple, a non-adjacent or a non-string superset key', () => {
  const lone = fixtureWith(exs => { exs[0].superset = 'A'; });
  assert.ok(validateProgram(lone).some(e => /exactly two exercises \(found 1\)/.test(e)));

  const prog = JSON.parse(JSON.stringify(FIXTURE));
  const day = prog.days[0];
  const extra = (id, muscles) => ({ ...day.exercises[1], id, muscles });
  day.exercises = [
    { ...day.exercises[0], muscles: { chest: 1 }, superset: 'B' },
    extra('mtest_x1', { abs: 1 }),
    { ...day.exercises[1], superset: 'B' },
  ];
  assert.ok(validateProgram(prog).some(e => /must be adjacent/.test(e)));

  const triple = fixtureWith(exs => {
    exs.push({ ...exs[1], id: 'mtest_x2', muscles: { abs: 1 } });
    exs.forEach(e => { e.superset = 'C'; });
  });
  assert.ok(validateProgram(triple).some(e => /exactly two exercises \(found 3\)/.test(e)));

  const bad = fixtureWith(exs => { exs[0].superset = 7; });
  assert.ok(validateProgram(bad).some(e => /superset must be a non-empty string/.test(e)));
});
