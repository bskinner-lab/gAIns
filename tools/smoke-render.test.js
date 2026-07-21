// tools/smoke-render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { smokeRender } = require('./smoke-render');
const { APP_HTML } = require('./app-shim');

test('every program renders every view', () => {
  for (const idx of [0, 1]) {
    const result = smokeRender(undefined, idx);
    assert.strictEqual(result.ok, true, `program ${idx}: ${result.error}`);
    assert.ok(result.rendered.includes('plan'));
    assert.ok(result.rendered.includes('progress'));
    assert.ok(result.rendered.includes('tip'));
    assert.ok(result.rendered.includes('swap'));
    assert.ok(result.rendered.length > 4);
  }
});

test('a bad program index is reported, not thrown', () => {
  const result = smokeRender(undefined, 99);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /program index/i);
});

// --- Regression fixtures for false negatives found in review ---
//
// Each helper mutates a copy of the real index.html by replacing one array
// literal in program 0 (PROGRAMS[0]) with broken content, using bracket
// matching so it survives nested arrays/objects/strings in between.

function matchBracket(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return i + 1; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\') i++; i++; }
    }
  }
  throw new Error('no matching bracket found');
}

function replaceArrayLiteral(src, keyLabel, searchFrom, replacement) {
  const keyIdx = src.indexOf(keyLabel, searchFrom);
  if (keyIdx === -1) throw new Error(`key ${keyLabel} not found after ${searchFrom}`);
  const openIdx = src.indexOf('[', keyIdx);
  const closeIdx = matchBracket(src, openIdx);
  return src.slice(0, openIdx) + replacement + src.slice(closeIdx);
}

function writeBrokenCase(mutate) {
  const orig = fs.readFileSync(APP_HTML, 'utf8');
  const broken = mutate(orig);
  const p = path.join(os.tmpdir(), `smoke-render-case-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(p, broken);
  return p;
}

test('a day with zero exercises is caught, not reported clean', () => {
  const pIdx = fs.readFileSync(APP_HTML, 'utf8').indexOf('const PROGRAMS = [');
  const file = writeBrokenCase(orig => {
    const daysIdx = orig.indexOf('days:', pIdx);
    return replaceArrayLiteral(orig, 'exercises:', daysIdx, '[]');
  });
  try {
    const result = smokeRender(file, 0);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /0 exercises/);
  } finally {
    fs.unlinkSync(file);
  }
});

test('an empty mesocycle is caught, not reported clean', () => {
  const pIdx = fs.readFileSync(APP_HTML, 'utf8').indexOf('const PROGRAMS = [');
  const file = writeBrokenCase(orig => replaceArrayLiteral(orig, 'mesocycle:', pIdx, '[]'));
  try {
    const result = smokeRender(file, 0);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /empty mesocycle/);
  } finally {
    fs.unlinkSync(file);
  }
});

test('weekPhases short by one entry is caught, not reported clean', () => {
  const pIdx = fs.readFileSync(APP_HTML, 'utf8').indexOf('const PROGRAMS = [');
  // Program 0 has totalWeeks: 8. Seven well-formed phase entries (one short)
  // is exactly what a generator would produce if it undercounted by one —
  // the failure mode the review flagged as invisible to the old gate.
  const shortArray = "[{label:'Foundation',rpe:'RPE 7',llp:false},{label:'Foundation',rpe:'RPE 7',llp:false}," +
    "{label:'Overload',rpe:'RPE 8',llp:true},{label:'Overload',rpe:'RPE 8',llp:true}," +
    "{label:'High Stimulus',rpe:'RPE 9',llp:true},{label:'High Stimulus',rpe:'RPE 9',llp:true}," +
    "{label:'Overreach',rpe:'RPE 9.5',llp:true}]";
  const file = writeBrokenCase(orig => replaceArrayLiteral(orig, 'weekPhases:', pIdx, shortArray));
  try {
    const result = smokeRender(file, 0);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /weekPhases\.length/);
  } finally {
    fs.unlinkSync(file);
  }
});

test('blank exercise names are caught, not reported clean', () => {
  const pIdx = fs.readFileSync(APP_HTML, 'utf8').indexOf('const PROGRAMS = [');
  const file = writeBrokenCase(orig => {
    const daysIdx = orig.indexOf('days:', pIdx);
    const exIdx = orig.indexOf('exercises:', daysIdx);
    const openIdx = orig.indexOf('[', exIdx);
    const closeIdx = matchBracket(orig, openIdx);
    // Blank every exercise name on day1 while keeping the same count and
    // shape — the count check alone can't see this, only a content check can.
    const blanked = orig.slice(openIdx, closeIdx).replace(/name:\s*'[^']*'/g, "name: ''");
    return orig.slice(0, openIdx) + blanked + orig.slice(closeIdx);
  });
  try {
    const result = smokeRender(file, 0);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /empty name/);
  } finally {
    fs.unlinkSync(file);
  }
});

test('a non-integer index reports it is not an integer, not a misleading range message', () => {
  const result = smokeRender(undefined, 0.5);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /not an integer/);
  assert.doesNotMatch(result.error, /out of range/);
});

function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === '\\') i++; i++; }
    }
  }
  throw new Error('no matching brace found');
}

test('a program with no swappable exercises skips the swap probe instead of failing', () => {
  const file = writeBrokenCase(orig => {
    const idx = orig.indexOf('const EXERCISE_ALTERNATIVES');
    const openIdx = orig.indexOf('{', idx);
    const closeIdx = matchBrace(orig, openIdx);
    return orig.slice(0, openIdx) + '{}' + orig.slice(closeIdx);
  });
  try {
    const result = smokeRender(file, 0);
    assert.strictEqual(result.ok, true, result.error);
    assert.ok(result.rendered.some(r => r.startsWith('swap:skipped')), 'expected a visible swap:skipped marker');
    assert.ok(!result.rendered.includes('swap'), 'swap should not be marked as actually probed');
  } finally {
    fs.unlinkSync(file);
  }
});

test('CLI rejects a non-integer program index with a purpose-built message', () => {
  const cliPath = path.join(__dirname, 'smoke-render.js');
  assert.throws(
    () => execFileSync(process.execPath, [cliPath, APP_HTML, 'abc'], { stdio: 'pipe' }),
    err => {
      assert.strictEqual(err.status, 1);
      assert.match(err.stderr.toString(), /not an integer/);
      return true;
    }
  );
});
