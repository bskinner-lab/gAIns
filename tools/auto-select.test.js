'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, withApp } = require('./app-shim');

// The seen-programs auto-select logic only cares about program ids and
// count, both of which grow every time /newplan inserts a new program (meso3
// is now real, and more will follow). These tests build the seen-list from
// the app's actual loaded PROGRAMS instead of hardcoding ['meso1', 'meso2'],
// so the suite keeps meaning as programs accumulate.
const ALL_IDS = loadApp().PROGRAMS.map(p => p.id);
const LAST_IDX = ALL_IDS.length - 1;

test('fresh install records ids without hijacking the saved program', () => {
  const app = loadApp({ storage: { hypertrophy_program: String(LAST_IDX) } });
  assert.strictEqual(app.currentProgramIdx, LAST_IDX);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

test('an unseen program is auto-selected', () => {
  // Seed "all but the last" as seen, simulating exactly one new program
  // (the last one) having just appeared.
  const seenSoFar = ALL_IDS.slice(0, -1);
  const app = loadApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(seenSoFar),
    },
  });
  // The last program is unseen, so the app should jump to it.
  assert.strictEqual(app.currentProgramIdx, LAST_IDX);
  assert.strictEqual(app.storage.getItem('hypertrophy_program'), String(LAST_IDX));
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

test('manual selection sticks when nothing is new', () => {
  const app = loadApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(ALL_IDS),
    },
  });
  assert.strictEqual(app.currentProgramIdx, 0);
});

test('corrupt seen-programs value is tolerated', () => {
  const app = loadApp({
    storage: { hypertrophy_program: String(LAST_IDX), hypertrophy_seen_programs: '{not json' },
  });
  assert.strictEqual(app.currentProgramIdx, LAST_IDX);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

// A literal `[]` parses fine, so `Array.isArray` alone can't tell it apart
// from "every program is new" — it must be treated like the key-absent case
// (record, don't switch), not like proof of a fresh unseen program.
test('an empty seen-list does not override the saved program', () => {
  const app = loadApp({
    storage: { hypertrophy_program: String(LAST_IDX), hypertrophy_seen_programs: '[]' },
  });
  assert.strictEqual(app.currentProgramIdx, LAST_IDX);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

test('a seen-list sharing no ids with the current programs does not override the saved program', () => {
  for (const corrupt of [[1, 2], [null], [{}], ['meso_deleted']]) {
    const app = loadApp({
      storage: {
        hypertrophy_program: String(LAST_IDX),
        hypertrophy_seen_programs: JSON.stringify(corrupt),
      },
    });
    assert.strictEqual(
      app.currentProgramIdx, LAST_IDX,
      `expected no override for seen=${JSON.stringify(corrupt)}`
    );
    assert.deepStrictEqual(
      JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
      ALL_IDS
    );
  }
});

// If the seen-list write fails, we must not act as though we recorded it —
// otherwise a stale seen-list re-triggers the same "unseen" verdict on every
// subsequent load, permanently overriding a manual switch back.
test('a failed seen-list write blocks the switch, on every load it keeps failing', () => {
  withApp(
    {
      // Fully seen and settled, so the automatic first boot (which runs
      // during eval, before we can patch storage) is a no-op.
      storage: {
        hypertrophy_program: String(LAST_IDX),
        hypertrophy_seen_programs: JSON.stringify(ALL_IDS),
      },
    },
    (app) => {
      // Now recreate the exact state from the bug report: a switch is
      // pending (the last program is unseen) and the user has manually
      // reverted to program 0 — then make the seen-list write throw
      // persistently, as if storage were read-only.
      app.storage.setItem('hypertrophy_program', '0');
      app.storage.setItem('hypertrophy_seen_programs', JSON.stringify(ALL_IDS.slice(0, -1)));
      const realSetItem = app.storage.setItem;
      app.storage.setItem = (k, v) => {
        if (k === 'hypertrophy_seen_programs') throw new Error('storage is read-only');
        return realSetItem(k, v);
      };

      app.boot();
      assert.strictEqual(app.currentProgramIdx, 0, 'must not switch when the write fails');
      assert.strictEqual(app.storage.getItem('hypertrophy_program'), '0');

      // A second load with the write still failing must not switch either —
      // this is the "forever" part of the bug.
      app.boot();
      assert.strictEqual(app.currentProgramIdx, 0, 'must still not switch on a repeat failing load');
      assert.strictEqual(app.storage.getItem('hypertrophy_program'), '0');
    }
  );
});
