'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadApp, withApp, extractScript } = require('./app-shim');

// Mirrors app-shim.js's GLOBAL_KEYS — the set of globals the shim stubs and
// must restore. Kept local since GLOBAL_KEYS isn't (and shouldn't need to be)
// part of the public surface.
const SHIMMED_GLOBAL_KEYS = [
  'window', 'document', 'localStorage', 'navigator', 'Notification',
  'AudioContext', 'webkitAudioContext', 'Blob', 'URL',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'requestAnimationFrame', 'alert',
];

function snapshotGlobals() {
  const snap = {};
  for (const k of SHIMMED_GLOBAL_KEYS) snap[k] = Object.getOwnPropertyDescriptor(global, k);
  return snap;
}

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

test('loadApp tears down before returning — render is unavailable afterward', () => {
  const app = loadApp();
  assert.throws(() => app.render(), /document is not defined/);
});

test('withApp keeps globals live for fn, and resolves the real dispatcher', () => {
  withApp({}, app => {
    assert.doesNotThrow(() => app.render());
    assert.strictEqual(typeof app.clickHandler, 'function');
    // primeAudio (registered {once: true}) must lose the slot to the
    // persistent data-act dispatcher, which is an anonymous arrow function.
    assert.notStrictEqual(app.clickHandler.name, 'primeAudio');

    // Drive a real click through the dispatcher and observe a state change —
    // this is what actually proves clickHandler is the right listener.
    const fakeEvent = {
      target: { closest: sel => (sel === '[data-act]' ? { dataset: { act: 'view', v: 'plan' } } : null) },
    };
    app.clickHandler(fakeEvent);
    assert.strictEqual(app.view.name, 'plan');
  });
});

test('reassigned program globals stay live across switchProgram, even under withApp', () => {
  withApp({}, app => {
    assert.strictEqual(app.currentProgramIdx, 0);
    app.switchProgram(1);
    assert.strictEqual(app.currentProgramIdx, 1);
    assert.strictEqual(app.DAYS[0].exercises[0].id, 'm2_incline_smith');
    assert.strictEqual(app.WEEK_PHASES, app.PROGRAMS[1].weekPhases);
    assert.strictEqual(app.PROTOCOL_ITEMS, app.PROGRAMS[1].protocolItems);
  });
});

test('loadApp still returns meso1 data-only (post-teardown getters keep working)', () => {
  const app = loadApp();
  assert.strictEqual(app.currentProgramIdx, 0);
  assert.strictEqual(app.DAYS[0].exercises[0].id, 'incline_db_press');
});

test('withApp propagates the return value of fn', () => {
  const result = withApp({}, app => app.PROGRAMS.length);
  assert.strictEqual(result, 2);
});

test('withApp tears down globals even when fn throws', () => {
  assert.throws(() => withApp({}, () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(typeof global.document, 'undefined');
});

test('loadApp fully restores globals when the script block is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'no-script.html');
  fs.writeFileSync(htmlPath, '<html><body>nothing here</body></html>');

  const before = snapshotGlobals();
  assert.throws(() => loadApp({ htmlPath }), /no <script> block found/);
  const after = snapshotGlobals();
  for (const k of SHIMMED_GLOBAL_KEYS) {
    assert.deepStrictEqual(after[k], before[k], `global.${k} not restored`);
  }
});

test('loadApp fully restores globals when the script has a syntax error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'bad-script.html');
  fs.writeFileSync(htmlPath, '<script>const PROGRAMS = [ this is not valid js !!!</script>');

  const before = snapshotGlobals();
  assert.throws(() => loadApp({ htmlPath }));
  const after = snapshotGlobals();
  for (const k of SHIMMED_GLOBAL_KEYS) {
    assert.deepStrictEqual(after[k], before[k], `global.${k} not restored`);
  }
});
