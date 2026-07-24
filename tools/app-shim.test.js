'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadApp, withApp, extractScript, GLOBAL_KEYS } = require('./app-shim');

function snapshotGlobals() {
  const snap = {};
  for (const k of GLOBAL_KEYS) snap[k] = Object.getOwnPropertyDescriptor(global, k);
  return snap;
}

test('extractScript returns the app script block', () => {
  const src = extractScript();
  assert.ok(src.includes('const PROGRAMS = ['));
  assert.ok(!src.includes('<script>'));
});

test('extractScript is unchanged for a normal single-block file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'normal.html');
  fs.writeFileSync(htmlPath, '<html><body></body><script>const x = 1;\nconst y = 2;</script></html>');

  assert.strictEqual(extractScript(htmlPath), 'const x = 1;\nconst y = 2;');
});

test('extractScript stops at the FIRST </script>, matching browser parsing — not the last', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'injected.html');
  // A generated note containing a literal `</script>` inside a JS string
  // would terminate the real <script> block early in a browser, even though
  // Node's own tokenizer (lastIndexOf) would happily read past it to the
  // true trailing tag. The gates must see what the browser sees.
  fs.writeFileSync(
    htmlPath,
    '<script>const note = "malicious </script><script>alert(1)</script>";\n' +
      'const shouldBeUnreachable = true;</script>'
  );

  const src = extractScript(htmlPath);
  assert.strictEqual(src, 'const note = "malicious ');
  assert.ok(!src.includes('shouldBeUnreachable'));
});

test('extractScript matches </script> case-insensitively', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'mixed-case.html');
  fs.writeFileSync(htmlPath, '<script>const z = 3;</ScRiPt>');

  assert.strictEqual(extractScript(htmlPath), 'const z = 3;');
});

test('loadApp exposes real program data', () => {
  const app = loadApp();
  // The app gains a new program every time /newplan inserts one — assert the
  // known baseline programs are present rather than exact-matching the
  // whole (growing) array.
  assert.ok(app.PROGRAMS.length >= 2);
  const ids = app.PROGRAMS.map(p => p.id);
  assert.ok(ids.includes('meso1'));
  assert.ok(ids.includes('meso2'));
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
  // What's being tested is that fn's return value comes back through
  // unchanged — the actual count is incidental, so compare against a fresh
  // loadApp() rather than a hardcoded number of programs.
  const result = withApp({}, app => app.PROGRAMS.length);
  assert.strictEqual(result, loadApp().PROGRAMS.length);
});

test('withApp tears down globals even when fn throws', () => {
  assert.throws(() => withApp({}, () => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(typeof global.document, 'undefined');
});

test('withApp rejects an async fn instead of hanging', () => {
  // An async function always returns a promise, so this throws synchronously
  // — it must never reach the `await`, which would hang forever since
  // setTimeout is stubbed to a no-op for the duration of the callback.
  assert.throws(
    () => withApp({}, async () => { await new Promise(r => setTimeout(r, 0)); }),
    /withApp\(fn\): fn must be synchronous/
  );
  // Teardown still ran despite the throw.
  assert.strictEqual(typeof global.document, 'undefined');
});

test('loadApp fully restores globals when the script block is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'no-script.html');
  fs.writeFileSync(htmlPath, '<html><body>nothing here</body></html>');

  const before = snapshotGlobals();
  assert.throws(() => loadApp({ htmlPath }), /no <script> block found/);
  const after = snapshotGlobals();
  for (const k of GLOBAL_KEYS) {
    assert.deepStrictEqual(after[k], before[k], `global.${k} not restored`);
  }
});

test('the shim exposes the day-logging internals tests need', () => {
  withApp({}, app => {
    for (const name of ['activeSet', 'logActiveSet', 'skipSet', 'curDay', 'getExerciseHistory']) {
      assert.strictEqual(typeof app[name], 'function', `${name} not exposed`);
    }
    // curDay() must return a real day from the active program.
    const day = app.curDay();
    assert.ok(app.DAYS.some(d => d.id === day.id));
    // activeSet() on a fresh state points at the first exercise, first set.
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, day.exercises[0].id);
    assert.strictEqual(act.i, 0);
  });
});

test('the element stub supports select() for inline inputs', () => {
  withApp({}, app => {
    const el = app.elements.get('bottombar') || { select: null };
    assert.doesNotThrow(() => { if (el.select) el.select(); });
  });
});

test('loadApp fully restores globals when the script has a syntax error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-shim-'));
  const htmlPath = path.join(dir, 'bad-script.html');
  fs.writeFileSync(htmlPath, '<script>const PROGRAMS = [ this is not valid js !!!</script>');

  const before = snapshotGlobals();
  assert.throws(() => loadApp({ htmlPath }));
  const after = snapshotGlobals();
  for (const k of GLOBAL_KEYS) {
    assert.deepStrictEqual(after[k], before[k], `global.${k} not restored`);
  }
});
