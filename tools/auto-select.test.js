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

// The rollout-gap case: auto-select shipped in the same release as a new
// program, so the seen key never existed for this user at all — the trusted
// path above has nothing to compare against. Fall back to logged-data: the
// earlier programs have real state keys (a realistic saveState() blob, not
// just an empty shell), the last one has none at all, so the last one must
// be the one that's actually new.
test('first run with no seen key: unlogged last program is auto-selected over trained earlier ones', () => {
  const storage = { hypertrophy_program: '0' };
  for (let i = 0; i < LAST_IDX; i++) {
    storage[`hypertrophy_state_${ALL_IDS[i]}_w1`] = JSON.stringify({
      day1: { sets: { ex1: [true, true, false] }, weights: { ex1: '135' }, effort: { ex1: '8' }, protocol: {}, swaps: {} },
    });
  }
  const app = loadApp({ storage });
  assert.strictEqual(app.currentProgramIdx, LAST_IDX);
  assert.strictEqual(app.storage.getItem('hypertrophy_program'), String(LAST_IDX));
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

// Opened-but-untrained: the real-world user was told to tap the new
// program's chip to check it out, which writes a state blob via
// initState()/saveState() even though they never completed a set. That
// blob existing must NOT disqualify it from being the auto-select target —
// only a completed (`true`) set means "already trained," matching
// tools/analyze-history.js's countWeeksWithCompletedSets.
test('first run with no seen key: opened-but-untrained last program is still auto-selected', () => {
  const storage = { hypertrophy_program: '0' };
  for (let i = 0; i < LAST_IDX; i++) {
    storage[`hypertrophy_state_${ALL_IDS[i]}_w1`] = JSON.stringify({
      day1: { sets: { ex1: [true, true, false] }, weights: { ex1: '135' }, effort: { ex1: '8' }, protocol: {}, swaps: {} },
    });
  }
  // Last program was merely opened — all sets still false/skipped, nothing
  // completed.
  storage[`hypertrophy_state_${ALL_IDS[LAST_IDX]}_w1`] = JSON.stringify({
    day1: { sets: { ex1: [false, 'skipped', false] }, weights: {}, effort: {}, protocol: {}, swaps: {} },
  });
  const app = loadApp({ storage });
  assert.strictEqual(app.currentProgramIdx, LAST_IDX);
  assert.strictEqual(app.storage.getItem('hypertrophy_program'), String(LAST_IDX));
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

// Genuinely fresh install: no seen key, and nobody has logged anything
// anywhere — there is no "new" program to distinguish from the rest, so stay
// on the default rather than auto-select.
test('first run with no seen key and no logged data anywhere: no switch', () => {
  const app = loadApp({ storage: { hypertrophy_program: '0' } });
  assert.strictEqual(app.currentProgramIdx, 0);
  assert.deepStrictEqual(
    JSON.parse(app.storage.getItem('hypertrophy_seen_programs')),
    ALL_IDS
  );
});

// If the user has already trained the last program too, it isn't new to
// them, whatever the (absent) seen-list says — don't switch.
test('first run with no seen key: last program already trained, no switch', () => {
  const storage = { hypertrophy_program: '0' };
  for (const id of ALL_IDS) {
    storage[`hypertrophy_state_${id}_w1`] = JSON.stringify({
      day1: { sets: { ex1: [true] }, weights: { ex1: '95' }, effort: { ex1: '7' }, protocol: {}, swaps: {} },
    });
  }
  const app = loadApp({ storage });
  assert.strictEqual(app.currentProgramIdx, 0);
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
