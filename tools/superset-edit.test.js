// tools/superset-edit.test.js
//
// Breaking up and making supersets from the workout card.
//
// A pair can be broken up (one station is taken, or the partner just isn't
// happening today) and two adjacent straight-set exercises can be paired. Each
// change is either THIS WEEK, kept in the week blob as state[dayId].pairs, or
// EVERY WEEK, kept per program in localStorage under hypertrophy_pairs_<progId>.
// Week beats program beats plan. Re-pairing only changes the order sets are
// offered in and the rest after them, so logged sets, weekly volume and
// history must come through untouched.
//
// Fixture: meso4 PUSH (day1) at week 6. Plan order is Incline DB Press,
// Machine Chest Press, Pec Deck + Pallof Press (A), DB Lateral Raise +
// Rope Pushdown (B), Cable Lateral Raise + Overhead Cable Extension (C).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

const { PROGRAMS } = loadApp();

function meso4Week(week, extra = {}) {
  return {
    hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)),
    hypertrophy_program: String(PROGRAMS.findIndex(p => p.id === 'meso4')),
    hypertrophy_week_meso4: String(week),
    ...extra,
  };
}

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

const T0 = Date.UTC(2026, 10, 12, 17, 0, 0);
function logAt(app, ms) { app.setClock(() => ms); app.logActiveSet(); }

const ex = (app, id) => app.DAYS.find(d => d.id === 'day1').exercises.find(e => e.id === id);
const day1 = app => app.DAYS.find(d => d.id === 'day1');

// ── Breaking up a pair ───────────────────────────────────────────────────────

test('unpairing this week makes both halves straight sets', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'week');
    const day = day1(app);
    assert.strictEqual(app.supersetPartner(day, ex(app, 'm4_pec_deck')), null);
    assert.strictEqual(app.supersetPartner(day, ex(app, 'm4_pallof_press')), null);
    assert.strictEqual(app.supersetLabel(day, ex(app, 'm4_pec_deck')), '');
    // The other pairs on the day are untouched.
    assert.strictEqual(app.supersetLabel(day, ex(app, 'm4_db_lateral_raise')), 'B1');
  });
});

test('after unpairing, a logged set gets its own rest and the selection stays put', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'week');
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    assert.strictEqual(app.view.restTotal, ex(app, 'm4_pec_deck').rest);
    assert.strictEqual(app.view.restMinimized, false);
    assert.strictEqual(app.view.selectedExId, 'm4_pec_deck');
    assert.doesNotMatch(app.view.restRec, /SUPERSET/);
  });
});

test('this-week unpairing is saved with the week and does not reach other weeks', () => {
  const storage = meso4Week(6);
  withApp({ storage }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'week');
    const blob = JSON.parse(app.storage.getItem('hypertrophy_state_meso4_w6'));
    assert.deepStrictEqual(blob.day1.pairs, { m4_pec_deck: '', m4_pallof_press: '' });
    assert.strictEqual(app.storage.getItem('hypertrophy_pairs_meso4'), null);
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.currentWeek, 7);
    assert.strictEqual(app.supersetLabel(day1(app), ex(app, 'm4_pec_deck')), 'A1');
    click(app, { act: 'wk', d: '-1' });
    assert.strictEqual(app.supersetLabel(day1(app), ex(app, 'm4_pec_deck')), '');
  });
});

test('every-week unpairing holds in other weeks and survives a reload', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'program');
    assert.deepStrictEqual(JSON.parse(app.storage.getItem('hypertrophy_pairs_meso4')),
      { day1: { m4_pec_deck: '', m4_pallof_press: '' } });
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.supersetPartner(day1(app), ex(app, 'm4_pec_deck')), null);
    // Reload from the same storage.
    const saved = { ...app.storage._store };
    withApp({ storage: saved }, again => {
      assert.strictEqual(again.supersetPartner(day1(again), ex(again, 'm4_pec_deck')), null);
    });
  });
});

test('logged sets, weekly volume and history are untouched by unpairing', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pec_deck';
    logAt(app, T0);
    logAt(app, T0 + 30_000);
    const sets = JSON.stringify(app.state.day1.sets);
    const vol = JSON.stringify(app.weeklyMuscleVolume());
    const hist = JSON.stringify(app.getExerciseHistory('day1', 'm4_pec_deck'));
    app.unpairSuperset('day1', 'm4_pec_deck', 'week');
    app.unpairSuperset('day1', 'm4_db_lateral_raise', 'program');
    assert.strictEqual(JSON.stringify(app.state.day1.sets), sets);
    assert.strictEqual(JSON.stringify(app.weeklyMuscleVolume()), vol);
    assert.strictEqual(JSON.stringify(app.getExerciseHistory('day1', 'm4_pec_deck')), hist);
  });
});

// ── Making a pair ────────────────────────────────────────────────────────────

test('only two adjacent straight-set exercises can be paired', () => {
  withApp({ storage: meso4Week(6) }, app => {
    const day = day1(app);
    assert.strictEqual(app.pairableNext(day, ex(app, 'm4_incline_db_press')), ex(app, 'm4_machine_chest_press'));
    // Machine Chest Press's next is Pec Deck, which is in A.
    assert.strictEqual(app.pairableNext(day, ex(app, 'm4_machine_chest_press')), null);
    assert.strictEqual(app.pairableNext(day, ex(app, 'm4_pec_deck')), null);
    // The last exercise has no next.
    assert.strictEqual(app.pairableNext(day, ex(app, 'm4_oh_cable_ext')), null);
    // Not adjacent: refused.
    app.pairSuperset('day1', 'm4_incline_db_press', 'm4_pallof_press', 'week');
    assert.strictEqual(app.supersetPartner(day, ex(app, 'm4_incline_db_press')), null);
  });
});

test('pairing picks a letter the day does not use, and runs as a superset', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'week');
    app.unpairSuperset('day1', 'm4_db_lateral_raise', 'week');
    // Pallof Press + DB Lateral Raise share no muscle.
    app.pairSuperset('day1', 'm4_pallof_press', 'm4_db_lateral_raise', 'week');
    const day = day1(app);
    assert.strictEqual(app.supersetLabel(day, ex(app, 'm4_pallof_press')), 'D1');
    assert.strictEqual(app.supersetLabel(day, ex(app, 'm4_db_lateral_raise')), 'D2');
    assert.strictEqual(app.supersetPartner(day, ex(app, 'm4_pec_deck')), null);
    assert.strictEqual(app.supersetPartner(day, ex(app, 'm4_rope_pushdown')), null);
    app.view.dayId = 'day1';
    app.view.selectedExId = 'm4_pallof_press';
    logAt(app, T0);
    assert.strictEqual(app.view.selectedExId, 'm4_db_lateral_raise');
    assert.strictEqual(app.view.restTotal, app.SUPERSET_TRANSITION_SEC);
  });
});

test('re-pairing the plan pair every week gets its letter back and stores nothing', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'program');
    app.pairSuperset('day1', 'm4_pec_deck', 'm4_pallof_press', 'program');
    assert.strictEqual(app.supersetLabel(day1(app), ex(app, 'm4_pec_deck')), 'A1');
    assert.strictEqual(app.storage.getItem('hypertrophy_pairs_meso4'), null);
  });
});

test('an every-week change clears a this-week override on the same exercises', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.unpairSuperset('day1', 'm4_pec_deck', 'week');
    app.pairSuperset('day1', 'm4_pec_deck', 'm4_pallof_press', 'program');
    assert.strictEqual(app.supersetLabel(day1(app), ex(app, 'm4_pec_deck')), 'A1');
    assert.deepStrictEqual(app.state.day1.pairs, {});
  });
});

test('the pairing dialog warns when the two share a muscle', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.name = 'day';
    app.view.dayId = 'day1';
    assert.deepStrictEqual(app.sharedMuscles(day1(app), ex(app, 'm4_incline_db_press'), ex(app, 'm4_machine_chest_press')).sort(),
      ['chest', 'front_delt', 'triceps']);
    click(app, { act: 'pairask', mode: 'pair', ex: 'm4_incline_db_press', b: 'm4_machine_chest_press' });
    const html = app.elements.get('overlays').innerHTML;
    assert.match(html, /Pair as a superset\?/);
    assert.match(html, /Both work chest, front delt, triceps/);
  });
});

// ── The card and the dialog ──────────────────────────────────────────────────

test('cards offer UNPAIR on a pair and PAIR WITH NEXT where it can be made', () => {
  withApp({ storage: meso4Week(6) }, app => {
    const html = app.exercisesHTML(day1(app));
    assert.strictEqual((html.match(/data-mode="unpair"/g) || []).length, 6);
    // Only Incline DB Press → Machine Chest Press is pairable on this day.
    assert.strictEqual((html.match(/data-mode="pair"/g) || []).length, 1);
    assert.match(html, /data-mode="pair" data-ex="m4_incline_db_press" data-b="m4_machine_chest_press"/);
  });
});

test('tapping UNPAIR asks the scope, and EVERY WEEK applies it', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.name = 'day';
    app.view.dayId = 'day1';
    click(app, { act: 'pairask', mode: 'unpair', ex: 'm4_pallof_press' });
    const html = app.elements.get('overlays').innerHTML;
    assert.match(html, /Break up Superset A\?/);
    assert.match(html, /THIS WEEK/);
    assert.match(html, /EVERY WEEK/);
    click(app, { act: 'pairdo', scope: 'program' });
    assert.strictEqual(app.view.pairAsk, null);
    assert.strictEqual(app.supersetPartner(day1(app), ex(app, 'm4_pec_deck')), null);
    assert.ok(app.storage.getItem('hypertrophy_pairs_meso4'));
  });
});

test('CANCEL changes nothing', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.view.name = 'day';
    app.view.dayId = 'day1';
    click(app, { act: 'pairask', mode: 'unpair', ex: 'm4_pec_deck' });
    click(app, { act: 'pairx' });
    assert.strictEqual(app.view.pairAsk, null);
    assert.strictEqual(app.supersetLabel(day1(app), ex(app, 'm4_pec_deck')), 'A1');
    assert.strictEqual(app.elements.get('overlays').innerHTML, '');
  });
});

// ── Backup ───────────────────────────────────────────────────────────────────

test('every-week changes go into the backup, and only when there are some', () => {
  withApp({ storage: meso4Week(6) }, app => {
    app.exportData();
    assert.ok(!('pairs' in JSON.parse(app.lastBlob).programs.meso4));
    app.unpairSuperset('day1', 'm4_pec_deck', 'program');
    app.exportData();
    assert.deepStrictEqual(JSON.parse(app.lastBlob).programs.meso4.pairs,
      { day1: { m4_pec_deck: '', m4_pallof_press: '' } });
  });
});

test('restoring a backup brings every-week changes back, and clears them when it has none', () => {
  const fileEvent = content => ({ target: { files: [{ _content: content }], value: 'x' } });
  let withPairs, without;
  withApp({ storage: meso4Week(6) }, app => {
    app.exportData();
    without = app.lastBlob;
    app.unpairSuperset('day1', 'm4_pec_deck', 'program');
    app.exportData();
    withPairs = app.lastBlob;
  });
  withApp({ storage: meso4Week(6) }, app => {
    app.importData(fileEvent(withPairs));
    assert.strictEqual(app.supersetPartner(day1(app), ex(app, 'm4_pec_deck')), null);
    app.importData(fileEvent(without));
    assert.strictEqual(app.storage.getItem('hypertrophy_pairs_meso4'), null);
    assert.strictEqual(app.supersetLabel(day1(app), ex(app, 'm4_pec_deck')), 'A1');
  });
});
