'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

// A browser fires `click` only when press and release land on the same node.
// The 500ms clock tick rebuilds the masthead, bottom bar, overlays and the day
// view's #scroll with innerHTML, so a tick between pointerdown and pointerup
// replaced the button under the finger and the tap vanished — "sometimes it
// takes two taps". The tick must hold its repaint while a press is in flight.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

function countWrites(el) {
  let value = el.innerHTML, writes = 0;
  Object.defineProperty(el, 'innerHTML', {
    get: () => value,
    set: v => { value = v; writes++; },
    configurable: true,
  });
  return () => writes;
}

// Drive the app on a fake clock: Date.now() is what both the tick and the
// pointer listeners read.
function harness(app) {
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  const tick = app.intervals[0];
  assert.strictEqual(typeof tick, 'function', 'boot() did not register the clock tick');
  const fire = type => (app.listeners[type] || []).forEach(fn => fn({ target: {} }));
  const bar = countWrites(app.elements.get('bottombar'));
  return {
    advance(ms) { t += ms; },
    tick, fire, bar,
    restore() { Date.now = realNow; },
  };
}

function inDayView(fn) {
  withApp({ storage: allSeenSeed() }, app => {
    app.view.name = 'day';
    app.render();
    const h = harness(app);
    try { fn(app, h); } finally { h.restore(); }
  });
}

test('an idle tick still repaints', () => {
  inDayView((app, h) => {
    h.advance(500); h.tick();
    assert.strictEqual(h.bar(), 1);
  });
});

test('a tick during a press does not rebuild the button under the finger', () => {
  inDayView((app, h) => {
    h.fire('pointerdown');
    h.advance(150); h.tick();
    assert.strictEqual(h.bar(), 0, 'the bottom bar was rebuilt mid-tap');
  });
});

test('a tick just after release, before click lands, is held too', () => {
  inDayView((app, h) => {
    h.fire('pointerdown');
    h.advance(100); h.fire('pointerup');
    h.advance(100); h.tick();
    assert.strictEqual(h.bar(), 0, 'rebuilt between pointerup and click');
  });
});

test('ticks resume once the release window passes', () => {
  inDayView((app, h) => {
    h.fire('pointerdown');
    h.advance(100); h.fire('pointerup');
    h.advance(400); h.tick();
    assert.strictEqual(h.bar(), 1, 'the display stayed frozen after the tap');
  });
});

test('a cancelled press releases the hold', () => {
  inDayView((app, h) => {
    h.fire('pointerdown');
    h.advance(100); h.fire('pointercancel');
    h.advance(400); h.tick();
    assert.strictEqual(h.bar(), 1);
  });
});

test('a lost pointerup cannot freeze the display', () => {
  inDayView((app, h) => {
    h.fire('pointerdown');
    h.advance(2000); h.tick();
    assert.strictEqual(h.bar(), 1, 'a press with no release held the tick forever');
  });
});

test('a rest period that runs out mid-press still expires', () => {
  inDayView((app, h) => {
    app.view.restEnd = Date.now() + 100;
    app.view.restTotal = 90;
    h.fire('pointerdown');
    h.advance(200); h.tick();
    assert.strictEqual(app.view.restEnd, null, 'expiry waited on the repaint');
  });
});
