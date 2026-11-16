'use strict';
// Phase 1 of the completeness roadmap: backup at week close, plus the
// "last backup" age in Settings. See
// docs/superpowers/plans/2026-11-13-completeness-roadmap.md.
const test = require('node:test');
const assert = require('node:assert');
const { withApp } = require('./app-shim');

const DAY_MS = 86400000;
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

function click(app, dataset) {
  app.clickHandler({ target: { closest: sel => (sel === '[data-act]' ? { dataset } : null) } });
}

function openSettings(app) {
  click(app, { act: 'settings' });
  return app.elements.get('scroll').innerHTML;
}

function finishWeek(app) {
  app.DAYS.forEach(d => app.completeDay(d.id));
  return app.elements.get('overlays').innerHTML;
}

// A thenable that settles synchronously. withApp callbacks must be
// synchronous (teardown runs as soon as fn returns), so a real Promise's
// .then would fire after localStorage has already been torn down.
function syncThenable(ok) {
  return { then(onOk, onErr) { if (ok) onOk && onOk(); else onErr && onErr(new Error('AbortError')); return this; } };
}

// ---------------------------------------------------------- Settings age

test('Settings shows LAST BACKUP · NEVER, stale-styled, with no backup on record', () => {
  withApp({}, app => {
    const html = openSettings(app);
    assert.match(html, /LAST BACKUP · NEVER/);
    assert.match(html, /class="bk-age stale"/);
  });
});

test('Settings shows the age in days from a seeded key', () => {
  withApp({ storage: { gains_last_backup: String(NOW - 3 * DAY_MS - 1000) } }, app => {
    app.setClock(() => NOW);
    const html = openSettings(app);
    assert.match(html, /LAST BACKUP · 3 DAYS AGO/);
    assert.match(html, /class="bk-age"/, 'a 3-day-old backup is not stale');
  });
});

test('a backup older than 7 days gets the stale styling', () => {
  withApp({ storage: { gains_last_backup: String(NOW - 9 * DAY_MS) } }, app => {
    app.setClock(() => NOW);
    const html = openSettings(app);
    assert.match(html, /LAST BACKUP · 9 DAYS AGO/);
    assert.match(html, /class="bk-age stale"/);
  });
});

test('exactly 7 days is not yet stale; today reads TODAY', () => {
  withApp({ storage: { gains_last_backup: String(NOW - 7 * DAY_MS) } }, app => {
    app.setClock(() => NOW);
    assert.match(openSettings(app), /class="bk-age">LAST BACKUP · 7 DAYS AGO/);
  });
  withApp({ storage: { gains_last_backup: String(NOW - 60000) } }, app => {
    app.setClock(() => NOW);
    assert.match(openSettings(app), /LAST BACKUP · TODAY/);
  });
});

test('the plain EXPORT button records a backup', () => {
  withApp({}, app => {
    app.setClock(() => NOW);
    openSettings(app);
    click(app, { act: 'export' });
    assert.strictEqual(app.storage.getItem('gains_last_backup'), String(NOW));
    assert.match(app.elements.get('scroll').innerHTML, /LAST BACKUP · TODAY/);
  });
});

// ------------------------------------------------------------- done card

test('the week-complete card offers SAVE BACKUP; a plain day complete does not', () => {
  withApp({}, app => {
    app.completeDay(app.DAYS[0].id);
    assert.ok(app.view.done && !app.view.done.weekDone);
    assert.doesNotMatch(app.elements.get('overlays').innerHTML, /data-act="backupshare"/);
    click(app, { act: 'donex' });

    const html = finishWeek(app);
    assert.ok(app.view.done.weekDone);
    assert.match(html, /data-act="backupshare"/);
    assert.match(html, />SAVE BACKUP</);
  });
});

test('a stale backup is called out on the button', () => {
  withApp({ storage: { gains_last_backup: String(NOW - 9 * DAY_MS) } }, app => {
    app.setClock(() => NOW);
    assert.match(finishWeek(app), /SAVE BACKUP · LAST 9 DAYS AGO/);
  });
});

test('tapping SAVE BACKUP keeps the celebration up', () => {
  withApp({}, app => {
    finishWeek(app);
    click(app, { act: 'backupshare' });
    assert.ok(app.view.done, 'backupshare must not dismiss the done card');
  });
});

// ------------------------------------------------------------ share path

test('with a share sheet, SAVE BACKUP shares one named .json File and records it on resolve', () => {
  withApp({}, app => {
    app.setClock(() => NOW);
    const shared = [];
    navigator.canShare = () => true;
    navigator.share = data => { shared.push(data); return syncThenable(true); };
    let downloaded = 0;
    const realCreate = document.createElement;
    document.createElement = tag => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = () => { downloaded++; };
      return el;
    };
    finishWeek(app);
    click(app, { act: 'backupshare' });

    assert.strictEqual(shared.length, 1);
    assert.strictEqual(shared[0].files.length, 1);
    const f = shared[0].files[0];
    assert.match(f.name, /^gains-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.strictEqual(f.type, 'application/json');
    assert.strictEqual(downloaded, 0, 'the share path must not also download');
    assert.strictEqual(app.storage.getItem('gains_last_backup'), String(NOW));
    assert.match(app.elements.get('overlays').innerHTML, /BACKUP SAVED TODAY/);
  });
});

test('a cancelled share sheet records nothing', () => {
  withApp({}, app => {
    navigator.canShare = () => true;
    navigator.share = () => syncThenable(false);
    finishWeek(app);
    click(app, { act: 'backupshare' });
    assert.strictEqual(app.storage.getItem('gains_last_backup'), null);
  });
});

test('a browser that refuses application/json is retried with text/plain', () => {
  withApp({}, app => {
    const shared = [];
    navigator.canShare = ({ files }) => files[0].type === 'text/plain';
    navigator.share = data => { shared.push(data); return syncThenable(true); };
    finishWeek(app);
    click(app, { act: 'backupshare' });
    assert.strictEqual(shared.length, 1);
    assert.strictEqual(shared[0].files[0].type, 'text/plain');
    assert.match(shared[0].files[0].name, /\.json$/, 'the filename stays .json');
  });
});

test('without a usable share sheet, SAVE BACKUP downloads and records it', () => {
  withApp({}, app => {
    app.setClock(() => NOW);
    navigator.canShare = () => false;
    let shareCalls = 0;
    navigator.share = () => { shareCalls++; return syncThenable(true); };
    let downloaded = null;
    const realCreate = document.createElement;
    document.createElement = tag => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = () => { downloaded = el.download; };
      return el;
    };
    finishWeek(app);
    click(app, { act: 'backupshare' });
    assert.strictEqual(shareCalls, 0);
    assert.match(downloaded, /^gains-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.strictEqual(app.storage.getItem('gains_last_backup'), String(NOW));
  });
});

// ------------------------------------------------------ export integrity

// The pre-refactor exportData(), verbatim apart from returning the string,
// so a drift in buildExportBlob() is caught byte for byte.
function legacyExportText(app) {
  const allPrograms = {};
  app.PROGRAMS.forEach(prog => {
    const weeks = {};
    for (let w = 1; w <= prog.totalWeeks; w++) {
      try {
        const d = JSON.parse(app.storage.getItem(`hypertrophy_state_${prog.id}_w${w}`) || '{}');
        if (Object.keys(d).length) weeks[w] = d;
      } catch (e) {}
    }
    const weekNum = parseInt(app.storage.getItem(`hypertrophy_week_${prog.id}`) || '1');
    const startDate = app.storage.getItem(`hypertrophy_start_${prog.id}`);
    allPrograms[prog.id] = startDate
      ? { weeks, currentWeek: weekNum, startDate }
      : { weeks, currentWeek: weekNum };
  });
  return JSON.stringify({ programs: allPrograms, currentProgram: app.currentProgramIdx, version: 3 }, null, 2);
}

test('buildExportBlob output is byte-identical to the pre-refactor export', () => {
  withApp({}, app => {
    const d = app.DAYS[0];
    app.completeDay(d.id);
    click(app, { act: 'donex' });
    app.storage.setItem(`hypertrophy_start_${app.PROGRAMS[app.currentProgramIdx].id}`, '2026-09-01');

    const built = app.buildExportBlob();
    assert.match(built.filename, /^gains-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.strictEqual(built.text, legacyExportText(app));

    app.exportData();
    assert.strictEqual(app.lastBlob, legacyExportText(app));
  });
});

test('the last-backup key never rides along in the export, and import leaves it alone', () => {
  withApp({ storage: { gains_last_backup: '12345' } }, app => {
    app.exportData();
    const text = app.lastBlob;
    assert.doesNotMatch(text, /gains_last_backup/);
    app.storage.setItem('gains_last_backup', '999');
    app.importData({ target: { files: [{ _content: text }], value: '' } });
    assert.strictEqual(app.storage.getItem('gains_last_backup'), '999');
  });
});
