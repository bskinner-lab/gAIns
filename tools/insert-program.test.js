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

// --- ramp / deload (per-week set counts) --------------------------------
//
// `ex.ramp` is a sparse map: keys are the weeks where the prescribed set
// count CHANGES, values are the ABSOLUTE count from that week on. Weeks below
// the lowest key fall back to `ex.sets`, so week 1 is `sets` by definition and
// a ramp key of 1 is always an authoring mistake. `weekPhases[i].deload`
// halves the ramped count for that week. Both are optional — the fixture
// carries neither and must keep validating clean.
//
// The fixture's totalWeeks is 2, so week 2 is the only in-range ramp key and
// week 3 is the first out-of-range one.

/** The fixture with `ramp` set on day1/exercises[0]. */
function programWithRamp(ramp) {
  const p = clone(valid);
  p.days[0].exercises[0].ramp = ramp;
  return p;
}

test('a valid ramp is accepted', () => {
  assert.deepStrictEqual(validateProgram(programWithRamp({ 2: 5 }), new Set()), []);
});

test('an empty ramp is accepted — it behaves as no ramp', () => {
  assert.deepStrictEqual(validateProgram(programWithRamp({}), new Set()), []);
});

test('an absent ramp is accepted — the fixture has none', () => {
  assert.ok(!('ramp' in valid.days[0].exercises[0]));
  assert.deepStrictEqual(validateProgram(valid, new Set()), []);
});

test('a ramp key of 1 is rejected by name — week 1 is `sets`', () => {
  const errors = validateProgram(programWithRamp({ 1: 5, 2: 6 }), new Set());
  assert.ok(errors.some(e => /ramp key '1' is invalid/.test(e)), errors.join('; '));
  assert.ok(errors.some(e => /week 1 is always `sets`/.test(e)), errors.join('; '));
  // The legal key alongside it must not be dragged down with it.
  assert.strictEqual(errors.length, 1);
});

test('a ramp key above totalWeeks is rejected', () => {
  const errors = validateProgram(programWithRamp({ 3: 5 }), new Set());
  assert.ok(errors.some(e => /ramp week 3 is out of range \(totalWeeks is 2\)/.test(e)), errors.join('; '));
});

test('a ramp week of 0 or a negative week is rejected', () => {
  for (const week of ['0', '-2']) {
    const errors = validateProgram(programWithRamp({ [week]: 5 }), new Set());
    assert.ok(errors.some(e => /is not a valid week \(weeks start at 1\)/.test(e)),
      `expected an error for ramp week ${week} — got ${errors.join('; ')}`);
  }
});

test('non-integer and non-numeric ramp keys are rejected', () => {
  for (const key of ['week2', '2.5', '', ' 2', '2x']) {
    const errors = validateProgram(programWithRamp({ [key]: 5 }), new Set());
    assert.ok(errors.some(e => e.includes(`ramp key '${key}' must be an integer week number`)),
      `expected an error for ramp key ${JSON.stringify(key)} — got ${errors.join('; ')}`);
  }
});

test('zero, negative and fractional ramp values are rejected', () => {
  for (const count of [0, -3, 4.5]) {
    const errors = validateProgram(programWithRamp({ 2: count }), new Set());
    assert.ok(errors.some(e => e.includes(`ramp['2'] must be a positive integer set count (got ${JSON.stringify(count)})`)),
      `expected an error for ramp value ${count} — got ${errors.join('; ')}`);
  }
});

test('non-numeric ramp values are rejected', () => {
  for (const count of ['5', null, {}, [5]]) {
    const errors = validateProgram(programWithRamp({ 2: count }), new Set());
    assert.ok(errors.some(e => /ramp\['2'\] must be a positive integer set count/.test(e)),
      `expected an error for ramp value ${JSON.stringify(count)} — got ${errors.join('; ')}`);
  }
});

test('a bad ramp key and a bad ramp value are both reported for the same entry', () => {
  const errors = validateProgram(programWithRamp({ 1: 0 }), new Set());
  assert.ok(errors.some(e => /ramp key '1' is invalid/.test(e)), errors.join('; '));
  assert.ok(errors.some(e => /ramp\['1'\] must be a positive integer set count/.test(e)), errors.join('; '));
});

test('an array ramp is rejected — typeof passes but the indices are not weeks', () => {
  const errors = validateProgram(programWithRamp([4, 5, 6]), new Set());
  assert.ok(errors.some(e => /ramp must be an object mapping week number to set count \(got array\)/.test(e)),
    errors.join('; '));
});

test('a null ramp is rejected — typeof null === "object"', () => {
  const errors = validateProgram(programWithRamp(null), new Set());
  assert.ok(errors.some(e => /ramp must be an object mapping week number to set count \(got null\)/.test(e)),
    errors.join('; '));
});

test('a scalar ramp is rejected and names the type it got', () => {
  const errors = validateProgram(programWithRamp(5), new Set());
  assert.ok(errors.some(e => /ramp must be an object mapping week number to set count \(got number\)/.test(e)),
    errors.join('; '));
});

test('a ramp error names the exercise path the way every other message does', () => {
  const bad = clone(valid);
  bad.days[1].exercises[0].ramp = { 3: 5 };
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => e.startsWith('day2/exercises[0]: ramp')), errors.join('; '));
});

test('a missing totalWeeks does not cascade into bogus ramp range errors', () => {
  const bad = programWithRamp({ 2: 5, 9: 7 });
  delete bad.totalWeeks;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /missing required field: totalWeeks/.test(e)));
  assert.ok(!errors.some(e => /out of range/.test(e)),
    `range checks should stand down when totalWeeks is unusable — got ${errors.join('; ')}`);
});

test('deload: true and deload: false are both accepted on a phase', () => {
  for (const flag of [true, false]) {
    const p = clone(valid);
    p.weekPhases[1].deload = flag;
    assert.deepStrictEqual(validateProgram(p, new Set()), [],
      `deload: ${flag} should validate clean`);
  }
});

test('an absent deload is accepted — it stays optional', () => {
  assert.ok(valid.weekPhases.every(ph => !('deload' in ph)));
  assert.deepStrictEqual(validateProgram(valid, new Set()), []);
  // And it must not have been quietly added to the required set.
  const bare = clone(valid);
  delete bare.weekPhases[0].deload;
  assert.ok(!validateProgram(bare, new Set()).some(e => /missing deload/.test(e)));
});

test('a non-boolean deload is rejected', () => {
  const bad = clone(valid);
  bad.weekPhases[1].deload = 'true';
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases\[1\]: deload must be a boolean \(got string\)/.test(e)),
    errors.join('; '));
});

test('a truthy non-boolean deload is rejected too — 1 is not true', () => {
  const bad = clone(valid);
  bad.weekPhases[0].deload = 1;
  const errors = validateProgram(bad, new Set());
  assert.ok(errors.some(e => /weekPhases\[0\]: deload must be a boolean \(got number\)/.test(e)),
    errors.join('; '));
});

test('a null deload is read as absent, matching missingKeys() leniency', () => {
  const p = clone(valid);
  p.weekPhases[0].deload = null;
  assert.deepStrictEqual(validateProgram(p, new Set()), []);
});

test('a ramped, deloading program validates clean end to end', () => {
  const p = clone(valid);
  p.days[0].exercises[0].ramp = { 2: 5 };
  p.days[0].exercises[1].ramp = {};
  p.days[1].exercises[0].ramp = { 2: 6 };
  p.weekPhases[1].deload = true;
  p.weekPhases[0].deload = false;
  assert.deepStrictEqual(validateProgram(p, collectExistingIds()), []);
});

test('a ramped program survives the full insert pipeline', () => {
  const file = tempCopy();
  const p = clone(valid);
  p.days[0].exercises[0].ramp = { 2: 5 };
  p.weekPhases[1].deload = true;

  const result = insertProgram(p, { htmlPath: file });
  assert.strictEqual(result.ok, true, result.error);

  const inserted = loadApp({ htmlPath: file }).PROGRAMS.at(-1);
  assert.deepStrictEqual(inserted.days[0].exercises[0].ramp, { 2: 5 });
  assert.strictEqual(inserted.weekPhases[1].deload, true);
});

// --- ramp key canonicality (third adversarial review) -------------------
//
// setsForWeek() picks the applicable week with
// `Object.keys(ex.ramp).map(Number)` but reads the count back with
// `ex.ramp[week]` — a NUMBER index, which JS stringifies canonically. A key
// spelled '03' therefore selects week 3 and then looks up `ex.ramp[3]`, which
// does not exist. Verified against the real setsForWeek() in index.html for
// { sets: 4, ramp: { '03': 5 } }: weeks 1–2 answer 4, and from week 3 on it
// answers `undefined` — or NaN in a deload week, since
// Math.max(1, Math.floor(undefined / 2)) is NaN.
//
// The rest of the chain, also verified: syncSetCount()'s two while-loops both
// compare the live array's length against that non-number, so both are false
// on the first iteration and the function no-ops. The array initState()
// seeded as [] stays [] — and isDayComplete()'s `arr.every(isResolved)` is
// vacuously true for an empty array. The day renders DAY COMPLETE, every card
// at 0/0, with nothing ever logged and no way to log it.
//
// Which is why a non-canonical key gets its own error message rather than
// sharing the generic "must be an integer week number" one: nothing at
// runtime will ever point at the key, so the message is the only chance the
// author gets to understand what happened.

/** The fixture stretched to `weeks` weeks, so ramp keys above 2 are in range. */
function longProgram(weeks = 4) {
  const p = clone(valid);
  p.totalWeeks = weeks;
  p.weekPhases = Array.from({ length: weeks }, (_, i) =>
    Object.assign(clone(valid.weekPhases[0]), { label: `Week ${i + 1}` }));
  return p;
}

/** `longProgram()` with `ramp` set on day1/exercises[0]. */
function longProgramWithRamp(ramp) {
  const p = longProgram();
  p.days[0].exercises[0].ramp = ramp;
  return p;
}

test('a ramp key with a leading zero is rejected — Number() round-trips it away', () => {
  const errors = validateProgram(longProgramWithRamp({ '03': 5 }), new Set());
  assert.ok(errors.some(e => /ramp key '03' must be a plain integer/.test(e)), errors.join('; '));
  assert.ok(errors.some(e => /no leading zeros or padding/.test(e)), errors.join('; '));
  assert.ok(errors.some(e => /write '3'/.test(e)), errors.join('; '));
  // The value beside it is fine and week 3 is in range, so the spelling of
  // the key is the only thing to complain about.
  assert.strictEqual(errors.length, 1, errors.join('; '));
});

test('sign-padded, decimal and whitespace-padded ramp keys are all rejected', () => {
  for (const key of ['+3', '3.0', ' 3', '3 ', '003', '-0']) {
    const errors = validateProgram(longProgramWithRamp({ [key]: 5 }), new Set());
    assert.ok(errors.some(e => e.includes(`ramp key '${key}'`)),
      `expected a ramp key error for ${JSON.stringify(key)} — got ${errors.join('; ')}`);
  }
});

test('a canonical ramp key is still accepted', () => {
  assert.deepStrictEqual(validateProgram(longProgramWithRamp({ '3': 5 }), new Set()), []);
  assert.deepStrictEqual(validateProgram(longProgramWithRamp({ 2: 4, 3: 5, 4: 6 }), new Set()), []);
});

test('the canonicality check names the exercise path like every other message', () => {
  const p = longProgram();
  p.days[1].exercises[0].ramp = { '02': 5 };
  const errors = validateProgram(p, new Set());
  assert.ok(errors.some(e => e.startsWith("day2/exercises[0]: ramp key '02'")), errors.join('; '));
});

// --- alternatives carry real prescriptions too --------------------------
//
// resolveExercise() merges an alternative over its original with
// `{...ex, ...alt}`, so an alternative's `sets` REPLACES the original's and an
// alternative's own `ramp` is honoured verbatim. Both therefore reach
// setsForWeek()/syncSetCount()/Array(n) exactly the way an exercise's do, and
// must be held to exactly the same rules.

/** `longProgram()` with `patch` merged onto the first alternative. */
function programWithAlt(patch) {
  const p = longProgram();
  Object.assign(p.alternatives.mtest_rope_pushdown[0], patch);
  return p;
}

test('an alternative with a malformed ramp is rejected the way an exercise is', () => {
  const cases = [
    [{ '03': 5 }, /ramp key '03' must be a plain integer/],
    [{ 1: 5 }, /ramp key '1' is invalid/],
    [{ 9: 5 }, /ramp week 9 is out of range \(totalWeeks is 4\)/],
    [{ 0: 5 }, /ramp week 0 is not a valid week/],
    [{ 2: 0 }, /ramp\['2'\] must be a positive integer set count/],
    [{ 2: '5' }, /ramp\['2'\] must be a positive integer set count/],
    [null, /ramp must be an object mapping week number to set count \(got null\)/],
    [[4, 5], /ramp must be an object mapping week number to set count \(got array\)/],
    [5, /ramp must be an object mapping week number to set count \(got number\)/],
  ];
  for (const [ramp, pattern] of cases) {
    const errors = validateProgram(programWithAlt({ ramp }), new Set());
    assert.ok(errors.some(e => pattern.test(e)),
      `expected ${pattern} for alt ramp ${JSON.stringify(ramp)} — got ${errors.join('; ')}`);
    assert.ok(errors.some(e => e.startsWith("alternatives['mtest_rope_pushdown'][0]: ramp")),
      `alt ramp errors must name the alternative's path — got ${errors.join('; ')}`);
  }
});

test('an alternative with a valid ramp is accepted', () => {
  assert.deepStrictEqual(validateProgram(programWithAlt({ sets: 3, ramp: { 3: 4 } }), new Set()), []);
  assert.deepStrictEqual(validateProgram(programWithAlt({ ramp: {} }), new Set()), []);
});

test('an alternative ramp range check stands down when totalWeeks is unusable', () => {
  const p = programWithAlt({ ramp: { 9: 5 } });
  delete p.totalWeeks;
  const errors = validateProgram(p, new Set());
  assert.ok(errors.some(e => /missing required field: totalWeeks/.test(e)));
  assert.ok(!errors.some(e => /out of range/.test(e)), errors.join('; '));
});

test('an alternative with a zero, negative, fractional or non-numeric sets is rejected', () => {
  for (const sets of [0, -2, 2.5, '3']) {
    const errors = validateProgram(programWithAlt({ sets }), new Set());
    const want = `alternatives['mtest_rope_pushdown'][0]: sets must be a positive integer (got ${JSON.stringify(sets)})`;
    assert.ok(errors.includes(want),
      `expected exactly "${want}" — got ${errors.join('; ')}`);
  }
});

test('a positive integer sets on an alternative is accepted', () => {
  assert.deepStrictEqual(validateProgram(programWithAlt({ sets: 3 }), new Set()), []);
});

test('sets stays OPTIONAL on an alternative — the spread inherits the original one', () => {
  // The shipped fixture's alternatives carry no `sets` at all, and
  // resolveExercise()'s `{...ex, ...alt}` is what makes that work: an
  // alternative with no `sets` runs the original's prescription, exactly like
  // it runs the original's reps/rpe/rest/muscles. Requiring it here would
  // reject every alternative the app already ships in that shape.
  assert.ok(valid.alternatives.mtest_rope_pushdown.every(a => !('sets' in a)));
  const errors = validateProgram(valid, new Set());
  assert.deepStrictEqual(errors, []);
  assert.ok(!errors.some(e => /missing sets/.test(e)));
});

test('a still-valid ramped program produces zero errors after the tightened checks', () => {
  const p = longProgram();
  p.days[0].exercises[0].ramp = { 2: 5, 4: 6 };
  p.days[0].exercises[1].ramp = {};
  p.days[1].exercises[0].ramp = { 3: 5 };
  p.weekPhases[3].deload = true;
  Object.assign(p.alternatives.mtest_rope_pushdown[0], { sets: 3, ramp: { 3: 4 } });
  assert.deepStrictEqual(validateProgram(p, collectExistingIds()), []);
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
