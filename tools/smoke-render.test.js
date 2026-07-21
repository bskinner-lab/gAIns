// tools/smoke-render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { smokeRender } = require('./smoke-render');

test('every program renders every view', () => {
  for (const idx of [0, 1]) {
    const result = smokeRender(undefined, idx);
    assert.strictEqual(result.ok, true, `program ${idx}: ${result.error}`);
    assert.ok(result.rendered.includes('plan'));
    assert.ok(result.rendered.includes('progress'));
    assert.ok(result.rendered.length > 4);
  }
});

test('a bad program index is reported, not thrown', () => {
  const result = smokeRender(undefined, 99);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /program index/i);
});
