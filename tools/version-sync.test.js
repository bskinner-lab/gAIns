'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, withApp } = require('./app-shim');
const { CACHE } = require('./sw-shim');

// Two files carry the build number: APP_VERSION in index.html (shown in
// Settings) and CACHE in sw.js (what actually forces a fresh shell). Bumping
// one and forgetting the other is the whole failure mode this pair exists to
// prevent — Settings would claim a version the user isn't running.
test('APP_VERSION and the sw.js cache name carry the same build number', () => {
  const { APP_VERSION } = loadApp();
  assert.ok(APP_VERSION, 'index.html declares no APP_VERSION');
  assert.strictEqual(CACHE, `gains-v${APP_VERSION}`,
    `sw.js CACHE is "${CACHE}" but index.html APP_VERSION is "${APP_VERSION}" — bump both`);
});

// withApp, not loadApp: loadApp restores the real globals before returning, so
// a later render() would run without the document shim in place.
test('the running build number is shown in Settings', () => {
  withApp({}, app => {
    app.view.name = 'settings';
    app.render();
    assert.match(app.elements.get('scroll').innerHTML,
      new RegExp(`APP VERSION ${app.APP_VERSION}\\b`),
      'Settings does not display APP_VERSION');
  });
});
