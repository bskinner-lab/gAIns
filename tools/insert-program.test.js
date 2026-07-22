// tools/insert-program.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  validateProgram, collectExistingIds, nextProgramId, toJsLiteral,
  spliceProgram, insertProgram,
} = require('./insert-program');
const { loadApp } = require('./app-shim');
const { smokeRender } = require('./smoke-render');
const valid = require('./fixtures/program-valid.json');

// The fixture's exercise ids are prefixed 'mtest_', not 'm3_'. Real generated
// programs always get ids of the form 'm<N>_' for an integer N (see
// nextProgramId below), so a fixture using 'm3_' would collide the moment a
// real third program (meso3) exists in index.html — which is exactly what
// happened once /newplan generated one. 'mtest_' is not a shape any
// generator produces, so it can never collide with a real program. Do not
// "tidy" it back to 'm3_'.

const clone = o => JSON.parse(JSON.stringify(o));

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gains-insert-'));
  const dest = path.join(dir, 'index.html');
  fs.copyFileSync(path.join(__dirname, '..', 'index.html'), dest);
  return dest;
}

test('the fixture validates cleanly', () => {
  const errors = validateProgram(valid, collectExistingIds());
  assert.deepStrictEqual(errors, []);
});

test('missing top-level fields are reported', () => {
  const bad = clone(valid);
  delete bad.mesocycle;
  delete bad.protocolItems;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /mesocycle/.test(e)));
  assert.ok(errors.some(e => /protocolItems/.test(e)));
});

test('weekPhases length must equal totalWeeks', () => {
  const bad = clone(valid);
  bad.totalWeeks = 8;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases has 2 entries but totalWeeks is 8/.test(e)));
});

test('a day with no exercises is rejected', () => {
  const bad = clone(valid);
  bad.days[1].exercises = [];
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /day2.*no exercises/.test(e)));
});

test('incomplete exercises are rejected', () => {
  const bad = clone(valid);
  delete bad.days[0].exercises[0].restLabel;
  bad.days[0].exercises[1].rest = '75';
  bad.days[1].exercises[0].muscles = {};
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /restLabel/.test(e)));
  assert.ok(errors.some(e => /rest must be a number/.test(e)));
  assert.ok(errors.some(e => /muscles/.test(e)));
});

test('duplicate ids inside the program are rejected', () => {
  const bad = clone(valid);
  bad.days[1].exercises[0].id = 'mtest_rope_pushdown';
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /duplicate id 'mtest_rope_pushdown'/.test(e)));
});

test('collisions with existing app ids are rejected', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].id = 'incline_db_press';
  bad.alternatives = { 'mtest_rope_pushdown': [{ id: 'alt_pec_deck', name: 'Pec Deck', note: 'x' }] };
  const errors = validateProgram(bad, collectExistingIds());
  assert.ok(errors.some(e => /'incline_db_press' already exists/.test(e)));
  assert.ok(errors.some(e => /'alt_pec_deck' already exists/.test(e)));
});

test('collectExistingIds covers program and alternative ids', () => {
  const ids = collectExistingIds();
  assert.ok(ids.has('incline_db_press'));
  assert.ok(ids.has('m2_cable_crunch'));
  assert.ok(ids.has('alt_pec_deck'));
});

// --- Hardening fixes (adversarial review) -----------------------------

test('fix2: non-array weekPhases/mesocycle/protocolItems are rejected explicitly', () => {
  const bad = clone(valid);
  bad.weekPhases = 'not an array';
  bad.mesocycle = { oops: true };
  bad.protocolItems = { oops: true };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases must be an array/.test(e)));
  assert.ok(errors.some(e => /mesocycle must be an array/.test(e)));
  assert.ok(errors.some(e => /protocolItems must be an array/.test(e)));
});

test('fix3: stray nulls are reported, never thrown', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].muscles = null;
  bad.days[1].exercises = [null];
  bad.days.push(null);
  assert.doesNotThrow(() => validateProgram(bad, new Set()));
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.length > 0);
  assert.ok(errors.some(e => /exercises\[0\] must be an object/.test(e)));
  assert.ok(errors.some(e => /days\[2\] must be an object/.test(e)));
});

test('fix4: malformed exercise ids are never silently skipped', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].id = '';
  bad.days[0].exercises[1].id = 42;
  bad.days[1].exercises[0].id = {};
  const errors = validateProgram(bad, new Set());
  assert.strictEqual(errors.filter(e => /id must be a non-empty string/.test(e)).length, 3);
});

test('fix5: duplicate day ids are rejected', () => {
  const bad = clone(valid);
  bad.days[1].id = 'day1';
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /duplicate day id 'day1'/.test(e)));
});

test('fix6: null (not just undefined) fields are treated as missing everywhere', () => {
  const bad = clone(valid);
  bad.days[0].label = null;
  bad.days[0].exercises[0].name = null;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /days\[0\] missing label/.test(e)));
  assert.ok(errors.some(e => /missing name/.test(e)));
});

test('fix7: totalWeeks must be a positive integer', () => {
  for (const badValue of ['2', 0, -1, 2.5]) {
    const bad = clone(valid);
    bad.totalWeeks = badValue;
    const errors = validateProgram(bad, new Set());
    assert.ok(errors.some(e => /totalWeeks must be a positive integer/.test(e)),
      `expected error for totalWeeks = ${JSON.stringify(badValue)}`);
  }
});

test('fix8: muscle credits and keys are validated', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].muscles = { chest: 0, front_delt: -0.5, made_up_muscle: 1.0, triceps: 'lots' };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /muscles\.chest must be a number in \(0, 1\]/.test(e)));
  assert.ok(errors.some(e => /muscles\.front_delt must be a number in \(0, 1\]/.test(e)));
  assert.ok(errors.some(e => /unknown muscle 'made_up_muscle'/.test(e)));
  assert.ok(errors.some(e => /muscles\.triceps must be a number in \(0, 1\]/.test(e)));
});

test('fix9: llp/compound must be real booleans, sets a positive number', () => {
  const bad = clone(valid);
  bad.days[0].exercises[0].llp = 'false';
  bad.days[0].exercises[0].compound = 'true';
  bad.days[0].exercises[1].sets = '3';
  bad.days[1].exercises[0].sets = 0;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /llp must be a boolean/.test(e)));
  assert.ok(errors.some(e => /compound must be a boolean/.test(e)));
  assert.ok(errors.filter(e => /sets must be a positive number/.test(e)).length === 2);
});

test('fix10: alternatives referencing a non-existent exercise id are rejected', () => {
  const bad = clone(valid);
  bad.alternatives = { 'mtest_no_such_exercise': [{ id: 'mtest_alt_ghost', name: 'Ghost', note: 'x' }] };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /no exercise with id 'mtest_no_such_exercise' exists/.test(e)));
});

// --- Splice, gate, write -----------------------------------------------

test('nextProgramId follows the mesoN sequence', () => {
  assert.strictEqual(nextProgramId(['meso1', 'meso2']), 'meso3');
  assert.strictEqual(nextProgramId(['meso1', 'meso2', 'meso3']), 'meso4');
  assert.strictEqual(nextProgramId([]), 'meso1');
});

test('toJsLiteral unquotes identifier keys and keeps unicode', () => {
  const js = toJsLiteral({ id: 'x', reps: '6–10', note: 'elbows ~60°' });
  assert.match(js, /^\s*\{/);
  assert.match(js, /\bid: 'x'/);
  assert.match(js, /reps: '6–10'/);
  assert.match(js, /note: 'elbows ~60°'/);
  assert.ok(!js.includes('"id"'));
});

test('toJsLiteral escapes embedded quotes', () => {
  const js = toJsLiteral({ note: "don't flare" });
  assert.match(js, /note: 'don\\'t flare'/);
});

test('insertProgram appends a renderable program', () => {
  const file = tempCopy();
  // Derive expectations from the app's current program count rather than
  // hardcoding 'meso3' / index 2 — that count grows every time /newplan
  // inserts a real program, and did exactly that (meso3 is now real).
  const startCount = loadApp({ htmlPath: file }).PROGRAMS.length;
  const expectedId = nextProgramId(loadApp({ htmlPath: file }).PROGRAMS.map(p => p.id));

  const result = insertProgram(valid, { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.programId, expectedId);

  const app = loadApp({ htmlPath: file });
  assert.strictEqual(app.PROGRAMS.length, startCount + 1);
  assert.strictEqual(app.PROGRAMS.at(-1).id, expectedId);
  assert.strictEqual(app.PROGRAMS.at(-1).days.length, 2);
  assert.ok(app.EXERCISE_ALTERNATIVES['mtest_rope_pushdown']);
  assert.strictEqual(smokeRender(file, startCount).ok, true);
});

test('a second insert becomes the next sequential program id after that', () => {
  const file = tempCopy();
  const startCount = loadApp({ htmlPath: file }).PROGRAMS.length;
  assert.strictEqual(insertProgram(valid, { htmlPath: file }).ok, true);

  const afterFirst = loadApp({ htmlPath: file });
  const expectedSecondId = nextProgramId(afterFirst.PROGRAMS.map(p => p.id));

  const second = JSON.parse(JSON.stringify(valid));
  for (const day of second.days) for (const ex of day.exercises) ex.id = ex.id.replace('mtest_', 'mtest2_');
  second.alternatives = {
    'mtest2_rope_pushdown': [{ id: 'mtest2_alt_vbar', name: 'V-Bar Pushdown', note: 'Straighter wrists' }],
  };
  const result = insertProgram(second, { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.programId, expectedSecondId);
  assert.strictEqual(loadApp({ htmlPath: file }).PROGRAMS.length, startCount + 2);
});

test('an invalid program leaves the file untouched', () => {
  const file = tempCopy();
  const before = fs.readFileSync(file, 'utf8');
  const bad = clone(valid);
  delete bad.mesocycle;
  const result = insertProgram(bad, { htmlPath: file });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /mesocycle/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('a missing splice anchor is a hard error', () => {
  const file = tempCopy();
  fs.writeFileSync(file, '<script>const PROGRAMS = [];</script>');
  const result = insertProgram(valid, { htmlPath: file });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /anchor/i);
});

test('a program that passes validation but breaks rendering leaves the file byte-identical', () => {
  const file = tempCopy();
  const before = fs.readFileSync(file, 'utf8');
  // validateProgram only checks that weekPhases[i].rpe is PRESENT, not that
  // it's a string — renderMasthead() does `phase.rpe.replace(...)`
  // unconditionally on every view, so a number here sails through
  // validation and throws at render time. This is exactly the gate-ordering
  // the tool exists to enforce: schema-valid but render-broken must still
  // leave index.html untouched.
  const bad = clone(valid);
  bad.weekPhases[0].rpe = 7;
  assert.deepStrictEqual(validateProgram(bad, collectExistingIds(file)), []);
  const result = insertProgram(bad, { htmlPath: file });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

// --- </script> injection (adversarial review, critical) ----------------
//
// A generated `note` (or any other string field) containing a literal
// `</script>` is written verbatim into index.html by toJsLiteral()/quote().
// Both Gate 3 (`node --check`) and Gate 4 (smoke render) extract the script
// via `extractScript()`, which locates the block with `lastIndexOf` and so
// always finds the file's REAL trailing `</script>` — the injected one
// inside the string is invisible to it. Both gates therefore report success
// on a candidate that a BROWSER'S HTML PARSER — which closes a <script>
// block at the FIRST literal `</script`, wherever it appears, including
// inside a JS string literal — truncates to a fraction of its real size.
// quote() must neutralize `</script` (any case, with or without a
// following `>`) for the HTML parser while leaving the JS string's runtime
// VALUE byte-for-byte unchanged.

function countAll(haystack, needle) {
  let count = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { count++; i++; }
  return count;
}

function programWithNote(note) {
  const bad = clone(valid);
  bad.days[0].exercises[0].note = note;
  return bad;
}

test('a note containing </script> does not truncate the script block', () => {
  const file = tempCopy();
  const note = 'careful of </script> here';
  const result = insertProgram(programWithNote(note), { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);

  const html = fs.readFileSync(file, 'utf8');
  assert.strictEqual(countAll(html, '</script>'), 1, 'exactly one real closing tag should survive');

  const app = loadApp({ htmlPath: file });
  const ex = app.PROGRAMS.at(-1).days[0].exercises[0];
  assert.strictEqual(ex.note, note, 'the round-tripped string must equal the original input exactly');
});

test('a note containing </SCRIPT > (mixed case, trailing space) is neutralized', () => {
  const file = tempCopy();
  const note = 'weird case: </SCRIPT > should not break anything';
  const result = insertProgram(programWithNote(note), { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);

  const html = fs.readFileSync(file, 'utf8');
  assert.strictEqual(countAll(html, '</script>'), 1);

  const app = loadApp({ htmlPath: file });
  assert.strictEqual(app.PROGRAMS.at(-1).days[0].exercises[0].note, note);
});

test('a note containing a full injected script tag is neutralized end to end', () => {
  const file = tempCopy();
  const note = 'evil</script><script>alert(1)</script>';
  const result = insertProgram(programWithNote(note), { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);

  const html = fs.readFileSync(file, 'utf8');
  assert.strictEqual(countAll(html, '</script>'), 1, 'only the real trailing tag may remain');

  const app = loadApp({ htmlPath: file });
  assert.strictEqual(app.PROGRAMS.at(-1).days[0].exercises[0].note, note);
});

// --- Hardening fixes (second adversarial review) ------------------------

test('a program with no alternatives anywhere is rejected at validation', () => {
  const bad = clone(valid);
  delete bad.alternatives;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /must define at least one exercise alternative/.test(e)));
});

test('a program whose alternatives are all empty arrays is rejected at validation', () => {
  const bad = clone(valid);
  bad.alternatives = { mtest_rope_pushdown: [] };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /must define at least one exercise alternative/.test(e)));
});

test('non-string day label/title/subtitle are named at validation', () => {
  const bad = clone(valid);
  bad.days[0].label = 42;
  bad.days[0].title = '';
  bad.days[1].subtitle = null;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /days\[0\]: label must be a non-empty string/.test(e)));
  assert.ok(errors.some(e => /days\[0\]: title must be a non-empty string/.test(e)));
  // subtitle is `null`, which missingKeys() already reports as "missing" —
  // it isn't a second, redundant type error.
  assert.ok(errors.some(e => /days\[1\] missing subtitle/.test(e)));
});
