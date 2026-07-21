'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, withApp } = require('./app-shim');

test('fresh install records ids without hijacking the saved program', () => {
  const app = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});

test('an unseen program is auto-selected', () => {
  const app = loadApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(['meso1']),
    },
  });
  // meso2 is unseen, so the app should jump to it.
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.strictEqual(app.storage.getItem('hypertrophy_program'), '1');
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});

test('manual selection sticks when nothing is new', () => {
  const app = loadApp({
    storage: {
      hypertrophy_program: '0',
      hypertrophy_seen_programs: JSON.stringify(['meso1', 'meso2']),
    },
  });
  assert.strictEqual(app.currentProgramIdx, 0);
});

test('corrupt seen-programs value is tolerated', () => {
  const app = loadApp({
    storage: { hypertrophy_program: '1', hypertrophy_seen_programs: '{not json' },
  });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});

// A literal `[]` parses fine, so `Array.isArray` alone can't tell it apart
// from "every program is new" — it must be treated like the key-absent case
// (record, don't switch), not like proof of a fresh unseen program.
test('an empty seen-list does not override the saved program', () => {
  const app = loadApp({
    storage: { hypertrophy_program: '1', hypertrophy_seen_programs: '[]' },
  });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ['meso1', 'meso2']
  );
});

test('a seen-list sharing no ids with the current programs does not override the saved program', () => {
  for (const corrupt of [[1, 2], [null], [{}], ['meso_deleted']]) {
    const app = loadApp({
      storage: {
        hypertrophy_program: '1',
        hypertrophy_seen_programs: JSON.stringify(corrupt),
      },
    });
    assert.strictEqual(
      app.currentProgramIdx, 1,
      `expected no override for seen=${JSON.stringify(corrupt)}`
    );
    assert.deepStrictEqual(
      JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
      ['meso1', 'meso2']
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
        hypertrophy_program: '1',
        hypertrophy_seen_programs: JSON.stringify(['meso1', 'meso2']),
      },
    },
    (app) => {
      // Now recreate the exact state from the bug report: a switch is
      // pending (meso2 unseen) and the user has manually reverted to
      // program 0 — then make the seen-list write throw persistently, as
      // if storage were read-only.
      app.storage.setItem('hypertrophy_program', '0');
      app.storage.setItem('hypertrophy_seen_programs', JSON.stringify(['meso1']));
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
