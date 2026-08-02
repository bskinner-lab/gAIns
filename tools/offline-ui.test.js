'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('F1. fonts are self-hosted with no third-party origin on the critical path', () => {
  const html = HTML();

  // No CDN reference of any kind — stylesheet link or preconnect.
  assert.ok(!/fonts\.googleapis\.com/.test(html), 'index.html still references fonts.googleapis.com');
  assert.ok(!/fonts\.gstatic\.com/.test(html), 'index.html still references fonts.gstatic.com');

  const blocks = html.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.strictEqual(blocks.length, 5, `expected 5 @font-face blocks, found ${blocks.length}`);

  blocks.forEach(b => {
    assert.match(b, /src:\s*url\('\.\/fonts\/[^']+\.woff2'\)/, `@font-face not sourced locally: ${b}`);
    assert.match(b, /font-display:\s*swap/, `@font-face missing font-display: swap: ${b}`);
    // Deliberately omitted: copying Google's latin range would cause silent
    // fallback for characters just outside it.
    assert.ok(!/unicode-range/.test(b), `@font-face must not declare unicode-range: ${b}`);
  });

  // Variable families declare a range; the mono statics declare single weights.
  const weights = blocks.map(b => (b.match(/font-weight:\s*([^;]+);/) || [])[1].trim()).sort();
  assert.deepStrictEqual(weights, ['400', '400 700', '400 700', '500', '600']);

  // Every referenced file must actually exist and be a real woff2.
  const refs = [...html.matchAll(/url\('\.\/(fonts\/[^']+\.woff2)'\)/g)].map(m => m[1]);
  assert.strictEqual(new Set(refs).size, 5, 'expected 5 distinct font files referenced');
  refs.forEach(rel => {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), `missing font file: ${rel}`);
    assert.strictEqual(fs.readFileSync(p).subarray(0, 4).toString('latin1'), 'wOF2',
      `${rel} is not a woff2 file`);
  });

  // OFL obligation: the licence text travels with the files.
  const lic = fs.readFileSync(path.join(ROOT, 'fonts', 'LICENSE.txt'), 'utf8');
  assert.match(lic, /SIL OPEN FONT LICENSE/i, 'LICENSE.txt missing OFL text');
  assert.match(lic, /PERMISSION IS HEREBY GRANTED/i, 'LICENSE.txt appears to be a reference, not the full text');
});
