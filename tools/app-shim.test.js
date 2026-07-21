'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, extractScript } = require('./app-shim');

test('extractScript returns the app script block', () => {
  const src = extractScript();
  assert.ok(src.includes('const PROGRAMS = ['));
  assert.ok(!src.includes('<script>'));
});

test('loadApp exposes real program data', () => {
  const app = loadApp();
  assert.strictEqual(app.PROGRAMS.length, 2);
  assert.deepStrictEqual(app.PROGRAMS.map(p => p.id), ['meso1', 'meso2']);
  assert.ok(Object.keys(app.EXERCISE_ALTERNATIVES).length > 0);
});

test('loadApp seeds localStorage before boot', () => {
  const app = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(app.currentProgramIdx, 1);
});

test('loadApp does not leak globals', () => {
  loadApp();
  assert.strictEqual(typeof global.PROGRAMS, 'undefined');
  assert.strictEqual(typeof global.document, 'undefined');
});
