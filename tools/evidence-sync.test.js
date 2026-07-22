// tools/evidence-sync.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const landmarks = require('./volume-landmarks.json');

const DOC = path.join(__dirname, '..', 'docs', 'training-evidence.md');
const md = () => fs.readFileSync(DOC, 'utf8');

test('the evidence doc covers every required topic', () => {
  const text = md().toLowerCase();
  for (const topic of [
    'volume landmarks', 'frequency', 'proximity to failure', 'lengthened',
    'rep range', 'progression', 'deload', 'rotation',
    'shoulder-cautious constraints', 'last researched',
  ]) {
    assert.ok(text.includes(topic), `missing topic: ${topic}`);
  }
});

test('every quantitative section cites a source', () => {
  assert.ok((md().match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || []).length >= 8,
    'expected at least 8 inline source links');
});

test('the landmarks table matches volume-landmarks.json', () => {
  const rows = new Map();
  for (const line of md().split('\n')) {
    // | muscle | mev | mavLow–mavHigh | mrv | ...
    const m = /^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*[–-]\s*(\d+)\s*\|\s*(\d+)\s*\|/.exec(line);
    if (m) rows.set(m[1], { mev: +m[2], mavLow: +m[3], mavHigh: +m[4], mrv: +m[5] });
  }
  assert.deepStrictEqual([...rows.keys()].sort(), Object.keys(landmarks).sort());
  for (const [muscle, values] of rows) {
    assert.deepStrictEqual(values, landmarks[muscle], `mismatch for ${muscle}`);
  }
});
