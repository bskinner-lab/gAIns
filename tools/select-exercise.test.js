'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { withApp } = require('./app-shim');

// Fires a click through the app's real delegated `data-act` dispatcher.
function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

test('view starts with no exercise selected', () => {
  withApp({}, app => {
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('a selection redirects the active set to that exercise', () => {
  withApp({}, app => {
    const day = app.curDay();
    const third = day.exercises[2].id;
    app.view.selectedExId = third;
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, third);
    assert.strictEqual(act.i, 0);
  });
});

test('activeSet is pure — it never clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.view.selectedExId = day.exercises[1].id;
    app.activeSet(day);
    app.activeSet(day);
    assert.strictEqual(app.view.selectedExId, day.exercises[1].id);
  });
});

test('a fully-completed selection falls through to plan order', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    // Mark every set of the selected exercise done.
    app.state[day.id].sets[orig.id] = app.state[day.id].sets[orig.id].map(() => true);
    app.view.selectedExId = orig.id;
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, day.exercises[0].id);
  });
});

test('a selection naming an off-day exercise falls through to plan order', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.view.selectedExId = 'not_an_exercise_on_this_day';
    const act = app.activeSet(day);
    assert.strictEqual(act.orig.id, day.exercises[0].id);
  });
});

test('selectex sets, then toggles off, the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    click(app, { act: 'selectex', ex: orig.id });
    assert.strictEqual(app.view.selectedExId, orig.id);
    // render()'s syncPending keys on the RESOLVED exercise id, so verify
    // the pendKey actually names the selected exercise's first open set —
    // this would fail if the selection stopped taking effect.
    const resolved = app.state[day.id].swaps && app.state[day.id].swaps[orig.id]
      ? app.EXERCISE_ALTERNATIVES[orig.id].find(a => a.id === app.state[day.id].swaps[orig.id])
      : orig;
    const expectedKey = `${app.PROGRAMS[app.currentProgramIdx].id}:${app.currentWeek}:${day.id}:${resolved.id}:0`;
    assert.strictEqual(app.view.pendKey, expectedKey);
    click(app, { act: 'selectex', ex: orig.id });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('selecting the already-active exercise preserves a dialed-in weight', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.render();
    click(app, { act: 'w+' });
    click(app, { act: 'w+' });
    const dialed = app.view.pendW;
    assert.ok(dialed > 0, 'precondition: the stepper moved the weight');
    click(app, { act: 'selectex', ex: day.exercises[0].id });
    assert.strictEqual(app.view.pendW, dialed, 'tapping the active card discarded the dialed weight');
  });
});

test('selecting a different exercise replaces the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    click(app, { act: 'selectex', ex: day.exercises[1].id });
    click(app, { act: 'selectex', ex: day.exercises[2].id });
    assert.strictEqual(app.view.selectedExId, day.exercises[2].id);
  });
});

test('changing day clears the selection', () => {
  withApp({}, app => {
    click(app, { act: 'selectex', ex: app.curDay().exercises[1].id });
    click(app, { act: 'day', id: app.DAYS[1].id });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('changing week clears the selection', () => {
  withApp({}, app => {
    click(app, { act: 'selectex', ex: app.curDay().exercises[1].id });
    click(app, { act: 'wk', d: '1' });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('switching program clears the selection', () => {
  withApp({}, app => {
    click(app, { act: 'selectex', ex: app.curDay().exercises[1].id });
    click(app, { act: 'prog', i: '1' });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('logging a non-final set keeps the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    click(app, { act: 'selectex', ex: orig.id });
    click(app, { act: 'log' });
    assert.strictEqual(app.view.selectedExId, orig.id);
    assert.strictEqual(app.state[day.id].sets[orig.id][0], true);
  });
});

test('logging the final set clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click(app, { act: 'log' });
    assert.strictEqual(app.view.selectedExId, null);
    assert.ok(app.state[day.id].sets[orig.id].every(v => v === true));
  });
});

test('skipping the final set clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: orig.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('un-skipping a set keeps the exercise selectable and selected', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    const n = app.state[day.id].sets[orig.id].length;
    click(app, { act: 'selectex', ex: orig.id });
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: orig.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
    click(app, { act: 'selectex', ex: orig.id });
    click(app, { act: 'skipset', ex: orig.id, i: '0' });   // toggles back to pending
    assert.strictEqual(app.state[day.id].sets[orig.id][0], false);
    assert.strictEqual(app.view.selectedExId, orig.id);
  });
});

test('skipping the final set of a SWAPPED selected exercise clears the selection', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises.find(o => (app.EXERCISE_ALTERNATIVES[o.id] || []).length);
    assert.ok(orig, 'expected at least one swappable exercise on the first day');
    const altId = app.EXERCISE_ALTERNATIVES[orig.id][0].id;
    click(app, { act: 'swap', orig: orig.id });
    click(app, { act: 'doswap', orig: orig.id, new: altId });
    // doswap clears the selection, so re-select after swapping.
    click(app, { act: 'selectex', ex: orig.id });
    const resolvedId = app.state[day.id].swaps[orig.id];
    assert.strictEqual(resolvedId, altId);
    const n = app.state[day.id].sets[altId].length;
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: altId, i: String(k) });
    assert.strictEqual(app.view.selectedExId, null);
  });
});

test('completing a different exercise leaves the selection alone', () => {
  withApp({}, app => {
    const day = app.curDay();
    const other = day.exercises[0];
    click(app, { act: 'selectex', ex: day.exercises[2].id });
    const n = app.state[day.id].sets[other.id].length;
    for (let k = 0; k < n; k++) click(app, { act: 'skipset', ex: other.id, i: String(k) });
    assert.strictEqual(app.view.selectedExId, day.exercises[2].id);
  });
});

function scrollHTML(app) { return app.elements.get('scroll').innerHTML; }

// Splits the rendered scroll HTML back into one string per exercise card,
// each starting at its `<div class="ex...">` root, so assertions can be
// pinned to the specific card under test instead of the whole page.
function exCards(html) {
  // Split only on the card ROOT (`class="ex"` or `class="ex sel"`), not on
  // any of the many other `.ex-*` classes (`.ex-top`, `.ex-name`, …) that
  // also happen to start with the same four characters.
  return html.split(/(?=<div class="ex(?: sel)?">)/).slice(1);
}

// Extracts the full element (open tag through its matching close, honoring
// nested <div>s) starting at the `<div class="ex-top` in `card`. Depth-aware
// so a swap button relocated to be a sibling of ex-top — still textually
// "before .tags" but no longer actually nested inside the header — is
// correctly excluded, unlike a plain substring cut would be.
function headerBlock(card) {
  const start = card.indexOf('<div class="ex-top');
  if (start === -1) return '';
  const openEnd = card.indexOf('>', start) + 1;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = openEnd;
  let depth = 1, m;
  while ((m = re.exec(card))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return card.slice(start, re.lastIndex);
  }
  return card.slice(start);
}

test('incomplete exercise cards are selectable', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.render();
    const html = scrollHTML(app);
    for (const o of day.exercises) {
      assert.ok(
        html.includes(`data-act="selectex" data-ex="${o.id}"`),
        `missing selectex for ${o.id}`
      );
    }
  });
});

test('a completed exercise is not selectable', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[1];
    app.state[day.id].sets[orig.id] = app.state[day.id].sets[orig.id].map(() => true);
    app.render();
    assert.ok(!scrollHTML(app).includes(`data-act="selectex" data-ex="${orig.id}"`));
  });
});

test('the selected card renders with the sel modifier', () => {
  withApp({}, app => {
    const day = app.curDay();
    const id = day.exercises[2].id;
    click(app, { act: 'selectex', ex: id });
    app.render();
    const cards = exCards(scrollHTML(app));
    const selCard = cards.find(c => c.includes(`data-ex="${id}"`));
    assert.ok(selCard, 'expected to find the card for the selected exercise');
    assert.ok(selCard.startsWith('<div class="ex sel">'), 'selected card is missing the sel modifier');
    const others = cards.filter(c => c !== selCard);
    assert.ok(
      others.every(c => !c.startsWith('<div class="ex sel">')),
      'an unselected card also carries sel'
    );
  });
});

test('the swap button still emits its own act inside a selectable header', () => {
  withApp({}, app => {
    const day = app.curDay();
    app.render();
    const card = exCards(scrollHTML(app)).find(c => c.includes(`data-ex="${day.exercises[0].id}"`));
    assert.ok(card, 'expected to find the first exercise card');
    const header = headerBlock(card);
    assert.ok(
      header.includes('<div class="ex-top pick"'),
      'the swap button must live inside the selectable ex-top header'
    );
    const swapBtn = header.match(/<button class="swap[^>]*>/);
    assert.ok(swapBtn, 'swap button missing from the selectable header');
    assert.ok(swapBtn[0].includes('data-act="swap"'), 'swap button lost its own act');
    assert.ok(
      !swapBtn[0].includes('data-act="selectex"'),
      'swap button must not also carry selectex — it would double-fire the delegated handler'
    );
  });
});

test('completing the selected exercise via a non-log/skipset path drops the sel highlight', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises[2];
    click(app, { act: 'selectex', ex: orig.id });
    assert.strictEqual(app.view.selectedExId, orig.id);
    // skipex marks every set 'skipped' in one shot — it doesn't route through
    // logActiveSet/skipSet, so it can finish the exercise without releasing
    // the selection. The highlight must still not survive at render time.
    click(app, { act: 'skipex', ex: orig.id });
    app.render();
    const selCard = exCards(scrollHTML(app)).find(c => c.startsWith('<div class="ex sel">'));
    assert.ok(!selCard, 'a completed exercise must not render with the sel modifier');
  });
});

test('a swapped exercise is still selectable by its ORIGINAL id', () => {
  withApp({}, app => {
    const day = app.curDay();
    const orig = day.exercises.find(o => (app.EXERCISE_ALTERNATIVES[o.id] || []).length);
    assert.ok(orig, 'expected at least one swappable exercise on the first day');
    const altId = app.EXERCISE_ALTERNATIVES[orig.id][0].id;
    click(app, { act: 'swap', orig: orig.id });
    click(app, { act: 'doswap', orig: orig.id, new: altId });
    app.render();
    const html = scrollHTML(app);
    assert.ok(
      html.includes(`data-act="selectex" data-ex="${orig.id}"`),
      'swapped card should be selectable by its original id, not the resolved id'
    );
    assert.ok(
      !html.includes(`data-act="selectex" data-ex="${altId}"`),
      'swapped card must not expose the resolved id for selection'
    );
  });
});
