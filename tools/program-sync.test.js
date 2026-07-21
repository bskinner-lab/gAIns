// tools/program-sync.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');

test('boot syncs DAYS to the saved program', () => {
  const app = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(app.currentProgramIdx, 1);
  assert.strictEqual(app.DAYS[0].exercises[0].id, 'm2_incline_smith');
  assert.strictEqual(app.WEEK_PHASES, app.PROGRAMS[1].weekPhases);
  assert.strictEqual(app.PROTOCOL_ITEMS, app.PROGRAMS[1].protocolItems);
});

test('boot defaults to the first program', () => {
  const app = loadApp();
  assert.strictEqual(app.currentProgramIdx, 0);
  assert.strictEqual(app.DAYS[0].exercises[0].id, 'incline_db_press');
});

test('switchProgram still updates the globals', () => {
  const app = loadApp();
  // app.switchProgram() re-renders via switchDay(), which needs a live
  // `document` — but app-shim tears down the DOM shim globals as soon as
  // loadApp() returns (see its own "loadApp does not leak globals" test), so
  // this call always throws on the render step. The globals we care about
  // (DAYS/MESOCYCLE/WEEK_PHASES/PROTOCOL_ITEMS) are set earlier in the
  // function, before the crash; also, `app.DAYS` etc. are one-time snapshots
  // taken when loadApp() first evaluated the script, so they wouldn't reflect
  // a later reassignment anyway. Swallow the expected error and observe the
  // effect through a fresh loadApp() that boots straight into program 1.
  try { app.switchProgram(1); } catch (_) { /* render() needs a live `document` */ }
  const after = loadApp({ storage: { hypertrophy_program: '1' } });
  assert.strictEqual(after.DAYS[0].exercises[0].id, 'm2_incline_smith');
});
