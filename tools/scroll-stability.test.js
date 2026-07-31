'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

// The 500ms clock tick calls render() unconditionally. renderScroll() used to
// reassign #scroll.innerHTML on every one of those ticks, which destroys and
// recreates every node inside it. For the <input type="date"> on the settings
// panel that is fatal: the browser dismisses a native date picker the moment
// its input leaves the DOM, so the calendar closed within half a second of
// being opened. Same failure the bottombar inline weight editor already
// guards against — this is the #scroll half of it.
function allSeenSeed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

// Count innerHTML writes, and — critically — model the fact that a real
// browser's innerHTML GETTER returns a re-serialization of the parsed DOM, not
// the string that was assigned. Attribute quoting and order are normalized,
// entities are re-escaped, void tags are respelled. Swapping the quote style on
// read is a cheap stand-in for all of that. Any "did it change?" guard that
// reads the DOM back will see a difference every single time and never fire;
// a shim that echoes the assigned string verbatim hides that bug completely.
function watchWrites(el) {
  let value = el.innerHTML, writes = 0;
  Object.defineProperty(el, 'innerHTML', {
    get: () => String(value).replace(/"/g, "'"),
    set: v => { value = v; writes++; },
    configurable: true,
  });
  return () => writes;
}

test('an idle clock tick does not rebuild #scroll on the settings panel', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.view.name = 'settings';
    app.render();
    const writes = watchWrites(app.elements.get('scroll'));
    app.view.now = app.view.now + 500; // what the 500ms interval does
    app.render();
    assert.strictEqual(writes(), 0, '#scroll was rebuilt, destroying the date input');
  });
});

// The day view is the one that legitimately repaints every tick: its header
// renders the running session clock, so the markup really does differ. The
// guard must not suppress that.
test('a clock tick still repaints the day view, which shows a live timer', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.view.name = 'day';
    app.render();
    const writes = watchWrites(app.elements.get('scroll'));
    app.view.now = app.view.now + 60000;
    app.render();
    assert.strictEqual(writes(), 1, 'the session clock stopped updating');
  });
});

test('#scroll still rebuilds when the content actually changes', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.view.name = 'day';
    app.render();
    const writes = watchWrites(app.elements.get('scroll'));
    app.view.name = 'settings';
    app.render();
    assert.strictEqual(writes(), 1, 'switching views must repaint #scroll');
  });
});

test('logging a set repaints #scroll', () => {
  withApp({ storage: allSeenSeed() }, app => {
    app.view.name = 'day';
    app.render();
    const writes = watchWrites(app.elements.get('scroll'));
    app.logActiveSet();
    app.render();
    assert.strictEqual(writes(), 1, 'a logged set must repaint #scroll');
  });
});
