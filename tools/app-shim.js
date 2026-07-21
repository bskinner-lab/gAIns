'use strict';
const fs = require('fs');
const path = require('path');

const APP_HTML = path.join(__dirname, '..', 'index.html');

function extractScript(htmlPath = APP_HTML) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const open = html.indexOf('<script>');
  const close = html.lastIndexOf('</script>');
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`no <script> block found in ${htmlPath}`);
  }
  return html.slice(open + '<script>'.length, close);
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
    closest: () => null, focus() {}, blur() {}, click() {}, scrollTo() {},
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
 * Evaluate the app script under a DOM shim.
 * @param {{htmlPath?: string, storage?: Record<string,string>}} opts
 * @returns {{PROGRAMS: any[], EXERCISE_ALTERNATIVES: object, DAYS: any[],
 *            currentProgramIdx: number, currentWeek: number, view: object,
 *            render: Function, switchProgram: Function,
 *            storage: object, elements: Map<string, object>,
 *            clickHandler: Function|null}}
 */
function loadApp({ htmlPath, storage: seed } = {}) {
  const saved = {};
  for (const k of GLOBAL_KEYS) saved[k] = global[k];

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
    addEventListener: (type, fn) => { if (type === 'click' && !clickHandler) clickHandler = fn; },
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

  try {
    const src = extractScript(htmlPath);
    // eval is safe/needed here: src is our own trusted index.html script (not
    // untrusted input), and this is a dev/test harness — the whole point is to
    // execute the app's real code under a DOM shim rather than parse it.
    // The script ends with boot(); the tail expression hands back live bindings.
    const api = eval(
      src +
      '\n;({ PROGRAMS, EXERCISE_ALTERNATIVES, DAYS, MESOCYCLE, WEEK_PHASES,' +
      ' PROTOCOL_ITEMS, currentProgramIdx, currentWeek, state, view,' +
      ' render, switchProgram, boot })'
    );
    return Object.assign(api, { storage, elements, get clickHandler() { return clickHandler; } });
  } finally {
    for (const k of GLOBAL_KEYS) {
      if (saved[k] === undefined) delete global[k];
      else setGlobal(k, saved[k]);
    }
  }
}

module.exports = { loadApp, extractScript, makeStorage, APP_HTML };
