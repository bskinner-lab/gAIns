'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp, loadApp } = require('./app-shim');

// The rest timer has two surfaces — the full-screen overlay and the minimized
// pill on the bottom bar — and two things were wrong with the minimized one.
//
// 1. It never made a sound. The countdown is timestamp-based (view.restEnd vs
//    Date.now()) so nothing fires *at* zero; the 500ms tick just nulled
//    view.restEnd on the way past. playTimerSound() existed but was wired only
//    to startTimer(), a legacy DOM-driven timer with no reachable callers.
// 2. Its urgent state used --danger, which is tuned for the light page
//    background. On the near-black bottom bar that lands at roughly 3:1 —
//    *dimmer* than the --accent it replaces — so at a glance nothing changed.
//
// These tests pin both: the pill flips the same classes at the same threshold
// the overlay does, and expiry chimes exactly once from either surface.

function seed() {
  const { PROGRAMS } = loadApp();
  return { hypertrophy_seen_programs: JSON.stringify(PROGRAMS.map(p => p.id)) };
}

// Put a rest period on screen with `remaining` ms left of a `total`-second
// period. view.now is what every render and expiry check reads, so it has to
// be pinned by hand — the 500ms interval that normally advances it is stubbed
// out for the whole life of withApp().
function restWith(app, { remaining, total = 90, minimized = true }) {
  const now = Date.now();
  app.view.name = 'day';
  app.view.now = now;
  app.setRest(total);
  app.view.restEnd = now + remaining;
  app.view.restMinimized = minimized;
  app.render();
}

const barHTML = app => app.elements.get('bottombar').innerHTML;
const overlayHTML = app => app.elements.get('overlays').innerHTML;

test('the minimized pill goes urgent in the last 10 seconds', () => {
  withApp({ storage: seed() }, app => {
    restWith(app, { remaining: 9000 });
    const html = barHTML(app);
    assert.match(html, /class="dot urgent"/, 'the status dot stayed on accent');
    assert.match(html, /class="pill-k urgent"/, 'the REST label stayed on accent');
    assert.match(html, /class="pill-t urgent"/, 'the countdown stayed on accent');
    assert.match(html, /class="pill-fill urgent"/, 'the progress bar stayed on accent');
  });
});

test('the minimized pill stays on the accent colour above the threshold', () => {
  withApp({ storage: seed() }, app => {
    restWith(app, { remaining: 30000 });
    const html = barHTML(app);
    assert.doesNotMatch(html, /urgent/, 'the pill went red with 30s still on the clock');
    assert.match(html, /class="pill-t"/, 'the countdown is missing from the pill');
  });
});

test('the pill and the overlay flip at exactly the same moment', () => {
  for (const [remaining, expectUrgent] of [[10000, true], [10001, false]]) {
    withApp({ storage: seed() }, app => {
      restWith(app, { remaining, minimized: true });
      const pill = /urgent/.test(barHTML(app));
      restWith(app, { remaining, minimized: false });
      const overlay = /urgent/.test(overlayHTML(app));
      assert.strictEqual(
        pill, overlay,
        `at ${remaining}ms the pill and overlay disagree (pill=${pill}, overlay=${overlay})`
      );
      assert.strictEqual(pill, expectUrgent, `wrong urgent state at ${remaining}ms`);
    });
  }
});

// The overlay's ring shows how much is left; the pill's track is that ring
// unrolled, so it has to answer the same fraction.
test("the pill's progress track tracks the fraction remaining", () => {
  withApp({ storage: seed() }, app => {
    restWith(app, { remaining: 45000, total: 90 });
    assert.match(barHTML(app), /class="pill-fill" style="width:50\.0%"/);
  });
});

test("the pill's progress track is clamped to 0-100%", () => {
  withApp({ storage: seed() }, app => {
    // addRest(30) can push the remaining time past the original total.
    restWith(app, { remaining: 120000, total: 90 });
    const m = /width:([\d.]+)%/.exec(barHTML(app));
    assert.ok(m, 'no progress track rendered');
    assert.ok(Number(m[1]) <= 100, `track overflowed at ${m[1]}%`);
  });
});

// Every colour the pill swaps to has to be declared in all three theme blocks
// — :root, [data-theme="dark"], and the prefers-color-scheme fallback — or one
// of them renders the urgent state as an unstyled inherit.
test('--danger-bar is defined in every theme block', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const decls = html.match(/--danger-bar:\s*#[0-9a-f]{6}/gi) || [];
  assert.strictEqual(decls.length, 3, `--danger-bar declared ${decls.length}x, expected 3`);
});

// Count oscillators rather than reaching for playTimerSound directly: the
// chime is three of them, and this is what a browser would actually hear.
function withBeepCounter(app) {
  let beeps = 0;
  app.view.__beeps = () => beeps;
  global.window.AudioContext = function () {
    return {
      state: 'running', currentTime: 0, destination: {},
      resume() {}, close() {},
      createOscillator: () => {
        beeps++;
        return { connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' };
      },
      createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} } }),
    };
  };
  return () => beeps;
}

test('running out of rest plays the chime', () => {
  withApp({ storage: seed() }, app => {
    const beeps = withBeepCounter(app);
    restWith(app, { remaining: 500 });
    assert.strictEqual(beeps(), 0, 'chimed while the timer was still running');

    app.view.now = app.view.restEnd + 1;
    app.expireRestIfDue();
    assert.ok(beeps() > 0, 'the rest timer ran out in silence');
    assert.strictEqual(app.view.restEnd, null, 'the expired timer is still on screen');
  });
});

test('the chime fires from the full-screen overlay too', () => {
  withApp({ storage: seed() }, app => {
    const beeps = withBeepCounter(app);
    restWith(app, { remaining: 500, minimized: false });
    app.view.now = app.view.restEnd + 1;
    app.expireRestIfDue();
    assert.ok(beeps() > 0, 'the overlay timer ran out in silence');
  });
});

// The 500ms tick and the visibilitychange resync both call expireRestIfDue,
// and on a phone coming back from the lock screen they can land back to back.
test('a second expiry check does not chime twice', () => {
  withApp({ storage: seed() }, app => {
    const beeps = withBeepCounter(app);
    restWith(app, { remaining: 500 });
    app.view.now = app.view.restEnd + 1;
    app.expireRestIfDue();
    const after = beeps();
    app.expireRestIfDue();
    app.expireRestIfDue();
    assert.strictEqual(beeps(), after, 'the chime repeated on a later tick');
  });
});

test('skipping rest ends it silently', () => {
  withApp({ storage: seed() }, app => {
    const beeps = withBeepCounter(app);
    restWith(app, { remaining: 30000 });
    app.clickHandler({ target: { dataset: {}, closest: sel => (sel === '[data-act]' ? { dataset: { act: 'restskip' } } : null) } });
    assert.strictEqual(app.view.restEnd, null, 'SKIP left the timer running');
    assert.strictEqual(app.view.restMinimized, false, 'SKIP left the pill minimized');
    assert.strictEqual(beeps(), 0, 'SKIP played the rest-over chime');
  });
});

test('an already-ended rest period cannot chime', () => {
  withApp({ storage: seed() }, app => {
    const beeps = withBeepCounter(app);
    restWith(app, { remaining: 30000 });
    app.endRest(false);
    app.endRest(true);
    assert.strictEqual(beeps(), 0, 'chimed for a timer that was no longer running');
  });
});

// toggleSet is the older of the two logging paths. Its tail used to write into
// #timerSetInfo/#timerNext/#timerRestRec and call startTimer() — elements and a
// timer that the JS-rendered shell never creates, so in a real browser it threw
// on a null. It now goes through the same beginRest() as logActiveSet.
test('toggleSet starts a real rest period', () => {
  withApp({ storage: seed() }, app => {
    app.view.name = 'day';
    app.view.now = Date.now();
    const day = app.curDay();
    const act = app.activeSet(day);
    app.toggleSet(day.id, act.ex.id, 0);
    assert.ok(app.view.restEnd > Date.now(), 'toggleSet did not start the rest timer');
    assert.strictEqual(app.view.restTotal, act.ex.rest, 'wrong rest length');
    assert.match(app.view.restInfo, /SET 1 DONE/);
  });
});

// The whole point of sharing beginRest() is that the two paths cannot drift.
test('both logging paths open an identical rest period', () => {
  const readRest = log => withApp({ storage: seed() }, app => {
    app.view.name = 'day';
    app.view.now = Date.now();
    log(app);
    const { restTotal, restInfo, restRec, restNext, restMinimized } = app.view;
    return { restTotal, restInfo, restRec, restNext, restMinimized };
  });
  const viaToggle = readRest(app => {
    const act = app.activeSet(app.curDay());
    app.toggleSet(app.curDay().id, act.ex.id, 0);
  });
  const viaLog = readRest(app => {
    app.view.pendW = 100;
    app.view.pendR = 10;
    app.logActiveSet();
  });
  assert.deepStrictEqual(viaToggle, viaLog, 'the two logging paths disagree about the rest period');
});

test('the last set of the day does not open a rest period', () => {
  withApp({ storage: seed() }, app => {
    app.view.name = 'day';
    app.view.now = Date.now();
    let restedAtLeastOnce = false;
    // Log the day out, one set at a time. curDay() is re-read every pass:
    // closing the day (or the week) moves the app on underneath us.
    for (let guard = 0; guard < 200 && app.activeSet(app.curDay()); guard++) {
      app.view.pendW = 100;
      app.view.pendR = 10;
      app.logActiveSet();
      if (app.view.restEnd) restedAtLeastOnce = true;
    }
    assert.ok(restedAtLeastOnce, 'no set in the day ever opened a rest period');
    assert.strictEqual(app.view.restEnd, null, 'a finished day left a rest timer running');
  });
});

// Logging a set is the only way a rest period starts in normal use, and it is
// the user gesture that unlocks the AudioContext — if it stops priming audio,
// iOS drops the first chime of every session.
test('logging a set starts a primed rest period', () => {
  withApp({ storage: seed() }, app => {
    app.view.name = 'day';
    app.view.now = Date.now();
    const beeps = withBeepCounter(app);
    const act = app.activeSet(app.curDay());
    app.view.pendW = 100;
    app.view.pendR = 10;
    app.logActiveSet();
    assert.ok(app.view.restEnd > Date.now(), 'logging a set did not start the rest timer');
    assert.strictEqual(app.view.restTotal, act.ex.rest, "rest length does not match the exercise's");
    // primeAudio() ran, so the context exists before the chime needs it.
    assert.strictEqual(beeps(), 0, 'logging a set played the rest-over chime');

    app.view.now = app.view.restEnd + 1;
    app.expireRestIfDue();
    assert.ok(beeps() > 0, 'the rest period started by logging a set expired in silence');
  });
});
