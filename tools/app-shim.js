'use strict';
const fs = require('fs');
const path = require('path');

const APP_HTML = path.join(__dirname, '..', 'index.html');

function extractScript(htmlPath = APP_HTML) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const open = html.indexOf('<script>');
  if (open === -1) {
    throw new Error(`no <script> block found in ${htmlPath}`);
  }
  const bodyStart = open + '<script>'.length;
  // A browser's HTML tokenizer ends the block at the FIRST `</script` it sees
  // after the opening tag — case-insensitively, and on the bare prefix, not
  // just the exact `</script>` spelling — even if that occurrence is inside a
  // JS string literal. lastIndexOf would happily eval past it and hide a
  // `</script>` injection that truncates the real, browser-rendered script to
  // whatever precedes the first match. Match that same, stricter rule so what
  // gets eval'd here is what a browser would actually execute.
  const closeMatch = /<\/script/i.exec(html.slice(bodyStart));
  if (!closeMatch) {
    throw new Error(`no <script> block found in ${htmlPath}`);
  }
  return html.slice(bodyStart, bodyStart + closeMatch.index);
}

function makeStorage(seed = {}) {
  const store = Object.assign(Object.create(null), seed);
  return {
    _store: store,
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

// Canvas 2D context stub: every method is a no-op, gradients answer addColorStop.
function makeCtx2d() {
  return new Proxy({}, {
    get: (_t, key) => {
      if (key === 'measureText') return () => ({ width: 0 });
      if (key === 'canvas') return undefined;
      return () => ({ addColorStop() {} });
    },
  });
}

function makeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, blur() {}, select() {}, click() {}, scrollTo() {},
    getContext: () => makeCtx2d(),
    toDataURL: () => 'data:,',
  };
}

const GLOBAL_KEYS = [
  'window', 'document', 'localStorage', 'navigator', 'Notification',
  'AudioContext', 'webkitAudioContext', 'Blob', 'URL',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout',
  'requestAnimationFrame', 'alert',
];

// Node ships some globals (e.g. `navigator`) as getter-only accessors, so a
// plain `global[k] = v` throws. defineProperty always works, for stubbing and
// for restoring the original descriptor afterward.
function setGlobal(k, v) {
  Object.defineProperty(global, k, { value: v, writable: true, configurable: true, enumerable: true });
}

/**
 * Set up the DOM shim, eval the app script under it, and hand back both the
 * live API and a `teardown()` that restores globals. Shared by `loadApp`
 * (tears down immediately, for consumers that only read data captured at eval
 * time) and `withApp` (tears down after the caller is done, for consumers
 * that need to keep calling into the app afterward).
 */
function setupApp({ htmlPath, storage: seed } = {}) {
  // Full descriptors, not just values — `navigator` etc. are accessor
  // properties on this Node, and restoring with a plain value would silently
  // turn them into (frozen-shape) data properties for the rest of the process.
  const saved = {};
  for (const k of GLOBAL_KEYS) saved[k] = Object.getOwnPropertyDescriptor(global, k);

  function teardown() {
    for (const k of GLOBAL_KEYS) {
      const desc = saved[k];
      if (desc === undefined) delete global[k];
      else Object.defineProperty(global, k, desc);
    }
  }

  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  let clickHandler = null;
  const storage = makeStorage(seed);

  const doc = {
    documentElement: makeElement('html'),
    body: makeElement('body'),
    head: makeElement('head'),
    hidden: false,
    getElementById,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: tag => makeElement(tag),
    // The app registers two click listeners: `primeAudio` (one-shot, unlocks
    // audio) and the real `data-act` dispatcher (persistent). We want the
    // dispatcher, so a `{once: true}` listener never wins the slot.
    addEventListener: (type, fn, options) => {
      if (type === 'click' && !(options && options.once)) clickHandler = fn;
    },
    removeEventListener() {},
  };

  setGlobal('window', {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { href: '' },
  });
  setGlobal('document', doc);
  setGlobal('localStorage', storage);
  setGlobal('navigator', { userAgent: 'node', vibrate() {} });
  const NotificationStub = function () {};
  NotificationStub.permission = 'default';
  NotificationStub.requestPermission = () => Promise.resolve('default');
  setGlobal('Notification', NotificationStub);
  const AudioContextStub = function () {
    return {
      state: 'running', currentTime: 0, destination: {},
      resume() {}, close() {},
      createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, type: '' }),
      createGain: () => ({ connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} } }),
    };
  };
  setGlobal('AudioContext', AudioContextStub);
  setGlobal('webkitAudioContext', AudioContextStub);
  setGlobal('Blob', function () {});
  setGlobal('URL', { createObjectURL: () => 'blob:stub', revokeObjectURL() {} });
  setGlobal('setInterval', () => 0);
  setGlobal('setTimeout', () => 0);
  setGlobal('clearInterval', () => {});
  setGlobal('clearTimeout', () => {});
  setGlobal('requestAnimationFrame', () => 0);
  setGlobal('alert', () => {});

  let api;
  try {
    const src = extractScript(htmlPath);
    // eval is safe/needed here: src is our own trusted index.html script (not
    // untrusted input), and this is a dev/test harness — the whole point is to
    // execute the app's real code under a DOM shim rather than parse it.
    // The script ends with boot(); the tail expression hands back live bindings.
    //
    // DAYS/MESOCYCLE/WEEK_PHASES/PROTOCOL_ITEMS/currentProgramIdx are
    // *reassigned* (not mutated) by syncProgramGlobals()/switchProgram(), so a
    // plain destructure would snapshot them at eval time and go stale the
    // instant either runs. `eval` here is direct-call strict-mode eval, which
    // scopes the script's `const`/`let` bindings to this eval and does not
    // leak them into setupApp's own scope — so these getters have to be
    // written as part of the evaluated string itself, closing over the real
    // bindings, rather than wrapped on afterward like `clickHandler` below.
    api = eval(
      src +
      '\n;({ PROGRAMS, EXERCISE_ALTERNATIVES, currentWeek, state, view,' +
      ' render, switchProgram, boot, activeSet, logActiveSet, skipSet, curDay,' +
      ' getExerciseHistory, lowRep,' +
      ' nowMs, setClock, markTime, clearTime,' +
      // commitEdit is a forward reference: it does not exist in index.html yet
      // (Task 7 adds it). `typeof commitEdit` is legal even on an undeclared
      // identifier — it evaluates to "undefined" — whereas a bare `commitEdit`
      // reference here would throw ReferenceError at eval time and take down
      // every test in the suite. Once index.html defines it, this getter can
      // collapse to a plain destructure alongside the others above.
      ' get commitEdit() { return typeof commitEdit === "function" ? commitEdit : undefined; },' +
      ' get currentProgramIdx() { return currentProgramIdx; },' +
      ' get DAYS() { return DAYS; },' +
      ' get MESOCYCLE() { return MESOCYCLE; },' +
      ' get WEEK_PHASES() { return WEEK_PHASES; },' +
      ' get PROTOCOL_ITEMS() { return PROTOCOL_ITEMS; } })'
    );
  } catch (e) {
    // A malformed script (missing <script>, syntax error, throw during boot)
    // must not leave the shimmed globals in place for whatever runs next.
    teardown();
    throw e;
  }

  Object.assign(api, { storage, elements, get clickHandler() { return clickHandler; } });
  return { api, teardown };
}

/**
 * Evaluate the app script under a DOM shim and return its live globals.
 * Globals are restored to their pre-call state before this returns, so use
 * this for consumers that only need data captured at eval time. To keep
 * calling into the app afterward — e.g. `render()` or the click handler,
 * which look up `document` fresh each call — use `withApp` instead.
 *
 * Field liveness (matters most under `withApp`, where the app can keep
 * running after this call returns):
 * - LIVE getters — always read the current binding, even after
 *   `syncProgramGlobals()`/`switchProgram()` reassigns them:
 *   `currentProgramIdx`, `DAYS`, `MESOCYCLE`, `WEEK_PHASES`, `PROTOCOL_ITEMS`.
 * - Mutated in place, so already reflect changes without needing a getter:
 *   `state`, `view`.
 * - Snapshots at eval time — never reassigned by the app, so this is safe:
 *   `PROGRAMS`, `EXERCISE_ALTERNATIVES`, `currentWeek`.
 * @param {{htmlPath?: string, storage?: Record<string,string>}} opts
 * @returns {{PROGRAMS: any[], EXERCISE_ALTERNATIVES: object, DAYS: any[],
 *            MESOCYCLE: object, WEEK_PHASES: any[], PROTOCOL_ITEMS: any[],
 *            currentProgramIdx: number, currentWeek: number, state: object,
 *            view: object, render: Function, switchProgram: Function,
 *            boot: Function, activeSet: Function, logActiveSet: Function,
 *            skipSet: Function, curDay: Function, getExerciseHistory: Function,
 *            commitEdit: Function|undefined, storage: object,
 *            elements: Map<string, object>, clickHandler: Function|null}}
 */
function loadApp(opts) {
  const { api, teardown } = setupApp(opts);
  teardown();
  return api;
}

/**
 * Like `loadApp`, but keeps the shimmed globals live for the duration of
 * `fn(api)` — teardown happens only after `fn` returns or throws — so `fn`
 * can call back into the app (`api.render()`, `api.clickHandler(evt)`, …)
 * without hitting `document is not defined`.
 *
 * `fn` MUST be synchronous. `setInterval`/`setTimeout`/`clearInterval`/
 * `clearTimeout`/`requestAnimationFrame` are stubbed to no-ops for the whole
 * duration of the call — not just while the app's own code runs, but for
 * `fn`'s own code too, since they're real globals and `fn` shares this
 * process. An `async fn` that awaits a timer-based operation (`setTimeout`,
 * a library that polls, …) would therefore hang forever: the timer that's
 * supposed to resolve it never fires. To catch this early rather than as a
 * mysterious hang, a thenable return value throws immediately instead.
 *
 * `fn`'s return value is propagated on success, and teardown still runs (via
 * `finally`) if it throws.
 * @param {{htmlPath?: string, storage?: Record<string,string>}} opts
 * @param {(api: ReturnType<typeof loadApp>) => any} fn
 */
function withApp(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const { api, teardown } = setupApp(opts);
  try {
    const result = fn(api);
    if (result && typeof result.then === 'function') {
      throw new Error(
        'withApp(fn): fn must be synchronous; timers are stubbed for the ' +
        'duration of the callback, so awaiting a timer-based operation will hang'
      );
    }
    return result;
  } finally {
    teardown();
  }
}

module.exports = { loadApp, withApp, extractScript, makeStorage, APP_HTML, GLOBAL_KEYS };
