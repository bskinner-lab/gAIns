'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');

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
