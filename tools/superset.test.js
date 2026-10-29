// tools/superset.test.js
//
// Supersets: two adjacent exercises on a day that share a `superset` key run
// as alternating sets. After the first half of a round the timer is only the
// walk to the partner (and opens minimized, so LOG SET for the partner is
// already on the bar); after the second half it is a rest long enough for
// both muscles, counted from when the first half was logged, floored at
// SUPERSET_MIN_REST_SEC. That is the whole time saving — each muscle keeps its
// prescribed rest, it just spends part of it watching the partner's set.
//
// Meso 4 PUSH from week 6 is the live fixture: Pec Deck and DB Lateral Raise,
// 4 sets each at 75 s rest, are paired as 'A'.
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

// A pair whose counts differ ends in straight sets on their own full rest —
// the time the pair was meant to save, and a broken rhythm on the day. Meso 4
// is held to it in the weeks it was rebuilt for; later programs in every week.
test('both halves of every pair carry the same number of sets', () => {
  const meso4Idx = PROGRAMS.findIndex(p => p.id === 'meso4');
  const app = loadApp();
  const uneven = [];
  PROGRAMS.slice(meso4Idx).forEach((prog, k) => {
    const weeks = k === 0 ? [6, 7, 8] : Array.from({ length: prog.totalWeeks }, (_, i) => i + 1);
    for (const day of prog.days) {
      day.exercises.forEach((a, i) => {
        const b = day.exercises[i + 1];
        if (!a.superset || !b || b.superset !== a.superset) return;
        for (const w of weeks) {
          const na = app.setsForWeek(a, w, prog), nb = app.setsForWeek(b, w, prog);
          if (na !== nb) uneven.push(`${prog.id} ${day.id} w${w}: ${a.name} ${na} vs ${b.name} ${nb}`);
        }
      });
    }
  });
  assert.deepStrictEqual(uneven, []);
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
    const lat = day.exercises.find(e => e.id === 'm4_db_lateral_raise');
    const incline = day.exercises.find(e => e.id === 'm4_incline_db_press');
    assert.strictEqual(app.supersetPartner(day, pec), lat);
    assert.strictEqual(app.supersetPartner(day, lat), pec);
    assert.strictEqual(app.supersetPartner(day, incline), null);
    assert.strictEqual(app.supersetLabel(day, pec), 'A1');
    assert.strictEqual(app.supersetLabel(day, lat), 'A2');
    assert.strictEqual(app.supersetLabel(day, incline), '');
  });
});

// ── The round ────────────────────────────────────────────────────────────────

test('logging the first half moves straight to the partner on a short, minimized timer', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    assert.strictEqual(app.view.selectedExId, 'm4_db_lateral_raise');
    assert.strictEqual(app.view.restTotal, app.SUPERSET_TRANSITION_SEC);
    assert.strictEqual(app.view.restMinimized, true);
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, 'm4_db_lateral_raise');
    assert.match(app.view.restNext, /Lateral Raise/);
  });
});

test('logging the second half rests the longer prescription, minus time since the first half', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    logAt(app, T0 + 30_000); // walk + lateral raise set took 30 s
    // 75 - 30 = 45 s left for the pec deck's chest to recover; the lateral
    // raise only needs 75 - (walk 20 + pec set 32) = 23 s of it.
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
  // Programs pair equal counts, but the SETS THIS WEEK stepper can still
  // unbalance a pair on the day.
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.adjustSetCount('day1', 'm4_db_lateral_raise', -2);
    app.view.selectedExId = 'm4_pec_deck';
    let t = T0;
    for (let round = 0; round < 2; round++) { logAt(app, t += 40_000); logAt(app, t += 30_000); }
    // The lateral raise's 2 sets are done; Pec Deck has 2 left.
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
    assert.strictEqual(app.view.selectedExId, 'm4_db_lateral_raise');
    logAt(app, T0 + 20_000);
    assert.strictEqual(app.view.restTotal, sub.rest - 20);
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, alt.id);
  });
});

test('the legacy toggleSet path pairs the same way', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.setClock(() => T0);
    app.toggleSet('day1', 'm4_pec_deck', 0);
    assert.strictEqual(app.view.selectedExId, 'm4_db_lateral_raise');
    assert.strictEqual(app.view.restTotal, app.SUPERSET_TRANSITION_SEC);
  });
});

// ── Every muscle gets its rest ───────────────────────────────────────────────
// Run each meso4 pair through logActiveSet on a simulated clock: sets take the
// app's own SET_SECONDS, the walk to the partner takes the transition, and the
// walk back happens inside the rest timer (which is how the session-length
// model prices a round). Measure each exercise's actual rest — end of one set
// to start of its next — against its prescription. Rear Delt Fly → Neutral-
// Grip Close Press is the pair that used to fail this: the second half has the
// longer rest, and the timer only protected the first half's, so the close
// press got 107 s of its 120.

function restsInPair(app, day, a, b) {
  const len = ex => (ex.compound ? app.SET_SECONDS.compound : app.SET_SECONDS.isolation);
  const shortfalls = [];
  let t = T0 / 1000;
  const lastEnd = {};
  app.view.selectedExId = a.id;
  for (let guard = 0; guard < 40; guard++) {
    const act = app.activeSet(day);
    if (!act || (act.orig !== a && act.orig !== b)) break;
    const ex = act.ex;
    if (lastEnd[ex.id] != null && t - lastEnd[ex.id] < ex.rest) {
      shortfalls.push(`${ex.name} set ${act.i + 1}: ${t - lastEnd[ex.id]} s of ${ex.rest}`);
    }
    t += len(ex);
    logAt(app, t * 1000);
    lastEnd[ex.id] = t;
    t += app.view.restMinimized ? app.SUPERSET_TRANSITION_SEC : app.view.restTotal;
  }
  return shortfalls;
}

for (const week of [6, 7]) {
  test(`every meso4 superset in week ${week} gives both muscles their full prescribed rest`, () => {
    const meso4 = PROGRAMS.find(p => p.id === 'meso4');
    const shortfalls = [];
    for (const { id: dayId } of meso4.days) {
      withApp({ storage: meso4Week(week) }, app => {
        app.view.dayId = dayId;
        const day = app.curDay();
        day.exercises.forEach((a, i) => {
          const b = day.exercises[i + 1];
          if (a.superset && b && b.superset === a.superset) shortfalls.push(...restsInPair(app, day, a, b));
        });
      });
    }
    assert.deepStrictEqual(shortfalls, []);
  });
}

test('a long-rest second half sets the rest after the pair', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day4';
    app.view.selectedExId = 'm4_rear_delt_fly';   // C1, 75 s isolation
    logAt(app, T0);
    logAt(app, T0 + 65_000);                       // C2: close press, 120 s compound
    // The fly's muscle has had 65 s and needs 10 more; the close press needs
    // 120 - (walk 20 + fly set 32) = 68 s of timer before the fly starts.
    assert.strictEqual(app.view.restTotal, 120 - app.SUPERSET_TRANSITION_SEC - app.SET_SECONDS.isolation);
  });
});

// ── Skipping inside a pair ───────────────────────────────────────────────────

test('skipping the second half goes back to the first, on the rest its muscle still needs', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    app.setClock(() => T0 + 15_000);
    app.skipSet('day1', 'm4_db_lateral_raise', 0);
    assert.strictEqual(app.view.selectedExId, 'm4_pec_deck');
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, 'm4_pec_deck');
    assert.strictEqual(app.view.restTotal, 75 - 15, 'the pec deck needs the rest of its 75 s');
    assert.strictEqual(app.view.restMinimized, false);
  });
});

test('a skip that closes the round after the partner has already rested ends the timer', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    app.setClock(() => T0 + 90_000);
    app.skipSet('day1', 'm4_db_lateral_raise', 0);
    assert.strictEqual(app.view.restEnd, null);
    assert.strictEqual(app.activeSet(app.curDay()).ex.id, 'm4_pec_deck');
  });
});

test('skipping the first half moves to the partner and starts no timer', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.setClock(() => T0);
    app.skipSet('day1', 'm4_pec_deck', 0);
    assert.strictEqual(app.view.selectedExId, 'm4_db_lateral_raise');
    assert.strictEqual(app.view.restEnd, null);
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
    exs[0].sets = 3;               // and runs 4 sets against the pushdown's 3
  });
  assert.deepStrictEqual(validateProgram(prog), []);
});

test('the validator rejects a pair whose halves share a muscle', () => {
  const prog = fixtureWith(exs => { exs[0].superset = 'A'; exs[1].superset = 'A'; });
  assert.ok(validateProgram(prog).some(e => /share triceps/.test(e)));
});

test('the validator rejects a pair whose set counts differ in any week', () => {
  const prog = fixtureWith(exs => {
    exs[0].superset = 'A'; exs[1].superset = 'A';
    exs[0].muscles = { chest: 1 };
    exs[0].sets = 3; exs[1].sets = 3;
    exs[1].ramp = { 2: 4 };
  });
  assert.ok(validateProgram(prog).some(e => /in week 2 — give both halves the same count/.test(e)),
    validateProgram(prog).join('\n'));
  prog.days[0].exercises[0].ramp = { 2: 4 };
  assert.deepStrictEqual(validateProgram(prog), []);
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
