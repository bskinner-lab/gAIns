// tools/insert-program.js
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { loadApp, extractScript, APP_HTML } = require('./app-shim');
const { smokeRender } = require('./smoke-render');
const VOLUME_LANDMARKS = require('./volume-landmarks.json');

const REQUIRED_TOP = ['name', 'subtitle', 'totalWeeks', 'days', 'protocolItems', 'mesocycle', 'weekPhases'];
const REQUIRED_EX = ['id', 'name', 'sets', 'reps', 'rpe', 'note', 'llp', 'compound', 'rest', 'restLabel', 'muscles'];
const REQUIRED_DAY = ['id', 'label', 'title', 'subtitle', 'exercises'];
const MUSCLE_KEYS = new Set(Object.keys(VOLUME_LANDMARKS));

/** Keys from `keys` that are absent from `obj` — treats null the same as undefined. */
function missingKeys(obj, keys) {
  return keys.filter(k => obj[k] === undefined || obj[k] === null);
}

/** Every exercise id already live in the app — programs and swap targets alike. */
function collectExistingIds(htmlPath) {
  const { PROGRAMS, EXERCISE_ALTERNATIVES } = loadApp({ htmlPath });
  const ids = new Set();
  for (const prog of PROGRAMS) {
    for (const day of prog.days) for (const ex of day.exercises) ids.add(ex.id);
  }
  for (const alts of Object.values(EXERCISE_ALTERNATIVES)) {
    for (const alt of alts) ids.add(alt.id);
  }
  return ids;
}

/**
 * Validate a generated program. Returns ALL errors so one run surfaces every
 * problem rather than making the caller play whack-a-mole. Never throws —
 * a truncated/malformed LLM response (stray `null`s, wrong types) is the
 * expected failure mode, and it must come back as an error list, not an
 * exception.
 * @returns {string[]}
 */
function validateProgram(prog, existingIds = new Set()) {
  const errors = [];
  if (!prog || typeof prog !== 'object') return ['program must be an object'];

  for (const key of missingKeys(prog, REQUIRED_TOP)) {
    errors.push(`missing required field: ${key}`);
  }

  if (prog.totalWeeks !== undefined && prog.totalWeeks !== null) {
    if (!(typeof prog.totalWeeks === 'number' && Number.isInteger(prog.totalWeeks) && prog.totalWeeks > 0)) {
      errors.push(`totalWeeks must be a positive integer (got ${JSON.stringify(prog.totalWeeks)})`);
    }
  }

  if (prog.weekPhases !== undefined && prog.weekPhases !== null) {
    if (!Array.isArray(prog.weekPhases)) {
      errors.push('weekPhases must be an array');
    } else {
      if (typeof prog.totalWeeks === 'number' && prog.weekPhases.length !== prog.totalWeeks) {
        errors.push(`weekPhases has ${prog.weekPhases.length} entries but totalWeeks is ${prog.totalWeeks}`);
      }
      prog.weekPhases.forEach((ph, i) => {
        if (!ph || typeof ph !== 'object') { errors.push(`weekPhases[${i}] must be an object`); return; }
        for (const key of missingKeys(ph, ['label', 'rpe', 'llp', 'color'])) {
          errors.push(`weekPhases[${i}] missing ${key}`);
        }
      });
    }
  }

  if (prog.mesocycle !== undefined && prog.mesocycle !== null) {
    if (!Array.isArray(prog.mesocycle)) {
      errors.push('mesocycle must be an array');
    } else {
      prog.mesocycle.forEach((ph, i) => {
        if (!ph || typeof ph !== 'object') { errors.push(`mesocycle[${i}] must be an object`); return; }
        for (const key of missingKeys(ph, ['weeks', 'label', 'rpe', 'rir', 'color', 'points'])) {
          errors.push(`mesocycle[${i}] missing ${key}`);
        }
      });
    }
  }

  if (prog.protocolItems !== undefined && prog.protocolItems !== null) {
    if (!Array.isArray(prog.protocolItems)) errors.push('protocolItems must be an array');
    else if (prog.protocolItems.length === 0) errors.push('protocolItems is empty');
  }

  const seenIds = new Set();
  const definedExerciseIds = new Set();
  // Shared by exercise ids and alternative ids — both land in the same flat
  // EXERCISE_ALTERNATIVES/PROGRAMS id namespace, so both must be unique and
  // collision-checked against the app. Falsiness is never the skip condition:
  // an empty string, 0, or an object masquerading as an id must be flagged,
  // not silently passed through.
  const noteId = (id, where) => {
    if (id === undefined || id === null) return; // already reported as a missing field
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`${where}: id must be a non-empty string (got ${JSON.stringify(id)})`);
      return;
    }
    if (seenIds.has(id)) errors.push(`${where}: duplicate id '${id}' within the new program`);
    else if (existingIds.has(id)) errors.push(`${where}: id '${id}' already exists in index.html`);
    seenIds.add(id);
  };

  if (!Array.isArray(prog.days) || prog.days.length === 0) {
    errors.push('days must be a non-empty array');
  } else {
    const seenDayIds = new Set();
    prog.days.forEach((day, di) => {
      if (!day || typeof day !== 'object') { errors.push(`days[${di}] must be an object`); return; }

      for (const key of missingKeys(day, REQUIRED_DAY)) errors.push(`days[${di}] missing ${key}`);

      if (day.id !== undefined && day.id !== null) {
        if (typeof day.id !== 'string' || day.id.length === 0) {
          errors.push(`days[${di}]: id must be a non-empty string (got ${JSON.stringify(day.id)})`);
        } else if (seenDayIds.has(day.id)) {
          errors.push(`days[${di}]: duplicate day id '${day.id}' within the new program`);
        } else {
          seenDayIds.add(day.id);
        }
      }

      // renderMasthead()/workoutHeaderHTML() call .toUpperCase()/.replace()
      // on these unconditionally on every view — a non-string here is a Gate
      // 4 render crash instead of a Gate 1 message naming the field.
      for (const field of ['label', 'title', 'subtitle']) {
        if (day[field] !== undefined && day[field] !== null &&
            !(typeof day[field] === 'string' && day[field].length > 0)) {
          errors.push(`days[${di}]: ${field} must be a non-empty string (got ${JSON.stringify(day[field])})`);
        }
      }

      if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
        errors.push(`day ${day.id || di} has no exercises`);
        return;
      }
      day.exercises.forEach((ex, ei) => {
        const where = `${day.id || di}/exercises[${ei}]`;
        if (!ex || typeof ex !== 'object') { errors.push(`${where} must be an object`); return; }

        for (const key of missingKeys(ex, REQUIRED_EX)) errors.push(`${where} missing ${key}`);

        if (ex.rest !== undefined && ex.rest !== null && typeof ex.rest !== 'number') {
          errors.push(`${where}: rest must be a number (got ${typeof ex.rest})`);
        }
        if (ex.sets !== undefined && ex.sets !== null &&
            !(typeof ex.sets === 'number' && ex.sets > 0)) {
          errors.push(`${where}: sets must be a positive number (got ${JSON.stringify(ex.sets)})`);
        }
        if (ex.llp !== undefined && ex.llp !== null && typeof ex.llp !== 'boolean') {
          errors.push(`${where}: llp must be a boolean (got ${typeof ex.llp})`);
        }
        if (ex.compound !== undefined && ex.compound !== null && typeof ex.compound !== 'boolean') {
          errors.push(`${where}: compound must be a boolean (got ${typeof ex.compound})`);
        }
        if (ex.muscles !== undefined && ex.muscles !== null) {
          if (typeof ex.muscles !== 'object' || Array.isArray(ex.muscles) || Object.keys(ex.muscles).length === 0) {
            errors.push(`${where}: muscles must be a non-empty object`);
          } else {
            for (const [muscle, credit] of Object.entries(ex.muscles)) {
              if (!MUSCLE_KEYS.has(muscle)) {
                errors.push(`${where}: muscles has unknown muscle '${muscle}'`);
              }
              if (typeof credit !== 'number' || !(credit > 0 && credit <= 1)) {
                errors.push(`${where}: muscles.${muscle} must be a number in (0, 1] (got ${JSON.stringify(credit)})`);
              }
            }
          }
        }

        noteId(ex.id, where);
        if (typeof ex.id === 'string' && ex.id.length > 0) definedExerciseIds.add(ex.id);
      });
    });
  }

  let hasAlternative = false;
  if (prog.alternatives !== undefined && prog.alternatives !== null) {
    if (typeof prog.alternatives !== 'object') errors.push('alternatives must be an object');
    else {
      for (const [origId, alts] of Object.entries(prog.alternatives)) {
        if (!definedExerciseIds.has(origId)) {
          errors.push(`alternatives['${origId}']: no exercise with id '${origId}' exists in this program`);
        }
        if (!Array.isArray(alts)) { errors.push(`alternatives['${origId}'] must be an array`); continue; }
        if (alts.length > 0) hasAlternative = true;
        alts.forEach((alt, ai) => {
          const where = `alternatives['${origId}'][${ai}]`;
          if (!alt || typeof alt !== 'object') { errors.push(`${where} must be an object`); return; }
          for (const key of missingKeys(alt, ['id', 'name', 'note'])) errors.push(`${where} missing ${key}`);
          noteId(alt.id, where);
        });
      }
    }
  }
  // Product policy, not an incidental render quirk: a program where every
  // exercise lacks a substitute means the swap feature is dead app-wide for
  // this program. Caught here, by name, rather than as a render-probe
  // failure at Gate 4.
  if (!hasAlternative) {
    errors.push('program must define at least one exercise alternative in `alternatives` — a program with no substitutes anywhere disables the swap feature for this program');
  }
  return errors;
}

// Splice anchors. Both were verified unique in index.html; uniqueness is
// re-asserted at run time so a future edit cannot silently corrupt the file.
const PROGRAMS_ANCHOR = '\n];\n\nconst EXERCISE_ALTERNATIVES = {';
const ALTS_ANCHOR = '\n};\n\nlet DAYS = PROGRAMS[0].days;';

function countOccurrences(haystack, needle) {
  let count = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { count++; i++; }
  return count;
}

/** Next free mesoN id given the ids already present. */
function nextProgramId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const m = /^meso(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `meso${max + 1}`;
}

// Escaping `\`/`'`/`\n` alone lets a JS-string-valid `</script>` (in any
// case, with or without a trailing `>`) slip through untouched: Node's
// `--check` and `extractScript()` both find the file's real trailing
// `</script>` via string search and are happy, but a BROWSER's HTML parser
// closes the <script> block at the first literal `</script` substring —
// including one sitting inside a JS string literal — silently truncating
// the app. Inserting a backslash before the `/` (`<\/script`) neutralizes
// it for the HTML parser while leaving the JS string's runtime VALUE
// unchanged (`\/` in a JS string literal is just `/`), so round-tripping
// through the app still yields the original text byte-for-byte.
function escapeScriptClose(str) {
  return str.replace(/<\/(script)/gi, '<\\/$1');
}

function quote(str) {
  const escaped = String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return `'${escapeScriptClose(escaped)}'`;
}

/**
 * Serialize to a JS object literal in the file's hand-authored style:
 * unquoted identifier keys, single-quoted strings, unicode left intact.
 */
function toJsLiteral(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);

  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return quote(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => padIn + toJsLiteral(v, indent + 1));
    return `[\n${items.join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const body = entries.map(([k, v]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k);
    return `${padIn}${key}: ${toJsLiteral(v, indent + 1)}`;
  });
  return `{\n${body.join(',\n')},\n${pad}}`;
}

/**
 * Return the new file contents with the program spliced in.
 * @throws when an anchor is missing or ambiguous
 */
function spliceProgram(html, programWithId, alternatives) {
  for (const [name, anchor] of [['PROGRAMS', PROGRAMS_ANCHOR], ['EXERCISE_ALTERNATIVES', ALTS_ANCHOR]]) {
    const n = countOccurrences(html, anchor);
    if (n !== 1) {
      throw new Error(`${name} splice anchor found ${n} times (expected exactly 1) — index.html structure changed`);
    }
  }

  const literal = toJsLiteral(programWithId, 1);
  let out = html.replace(PROGRAMS_ANCHOR, `\n  ${literal},${PROGRAMS_ANCHOR}`);

  const altEntries = Object.entries(alternatives || {});
  if (altEntries.length) {
    const block = altEntries
      .map(([origId, alts]) => `  ${/^[A-Za-z_$][\w$]*$/.test(origId) ? origId : quote(origId)}: ${toJsLiteral(alts, 1)},`)
      .join('\n');
    out = out.replace(ALTS_ANCHOR, `\n\n  // ── ${programWithId.name} ──\n${block}${ALTS_ANCHOR}`);
  }
  return out;
}

/**
 * Validate, splice, and write — but only if all four gates pass.
 * @returns {{ok: boolean, programId?: string, error?: string}}
 */
function insertProgram(rawProgram, { htmlPath = APP_HTML } = {}) {
  // Gate 0: the file must still have the shape spliceProgram() depends on.
  // Checked up front — a structurally broken index.html can fail to even
  // define its globals, so loadApp()'s error wouldn't mention the anchor.
  let html;
  try {
    html = fs.readFileSync(htmlPath, 'utf8');
  } catch (e) {
    return { ok: false, error: `could not read ${htmlPath}: ${e.message}` };
  }
  for (const [name, anchor] of [['PROGRAMS', PROGRAMS_ANCHOR], ['EXERCISE_ALTERNATIVES', ALTS_ANCHOR]]) {
    const n = countOccurrences(html, anchor);
    if (n !== 1) {
      return { ok: false, error: `${name} splice anchor found ${n} times (expected exactly 1) — index.html structure changed` };
    }
  }

  // Gate 1 + 2: schema and id uniqueness.
  let existingIds, programs;
  try {
    const app = loadApp({ htmlPath });
    programs = app.PROGRAMS;
    existingIds = collectExistingIds(htmlPath);
  } catch (e) {
    return { ok: false, error: `could not load ${htmlPath}: ${e.message}` };
  }
  const errors = validateProgram(rawProgram, existingIds);
  if (errors.length) return { ok: false, error: `validation failed:\n  - ${errors.join('\n  - ')}` };

  const programId = nextProgramId(programs.map(p => p.id));
  const { alternatives, ...programFields } = rawProgram;
  const programWithId = { id: programId, ...programFields };

  let candidate;
  try {
    candidate = spliceProgram(html, programWithId, alternatives);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const tmp = `${htmlPath}.candidate.tmp.html`;
  try {
    fs.writeFileSync(tmp, candidate, 'utf8');

    // Gate 3: the script block must parse.
    const scriptFile = `${tmp}.js`;
    fs.writeFileSync(scriptFile, extractScript(tmp), 'utf8');
    try {
      execFileSync(process.execPath, ['--check', scriptFile], { stdio: 'pipe' });
    } catch (e) {
      return { ok: false, error: `node --check failed:\n${e.stderr ? e.stderr.toString() : e.message}` };
    } finally {
      fs.rmSync(scriptFile, { force: true });
    }

    // Gate 4: the new program must render.
    const newIdx = programs.length;
    const smoke = smokeRender(tmp, newIdx);
    if (!smoke.ok) return { ok: false, error: `smoke render failed: ${smoke.error}` };

    fs.renameSync(tmp, htmlPath);
    return { ok: true, programId, views: smoke.rendered };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error('usage: node tools/insert-program.js <program.json>');
    process.exit(1);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`could not read ${file}: ${e.message}`);
    process.exit(1);
  }
  const result = insertProgram(raw);
  if (!result.ok) {
    console.error(`insert FAILED — index.html unchanged.\n${result.error}`);
    process.exit(1);
  }
  console.log(`Inserted ${result.programId} into index.html (${result.views.length} views rendered clean).`);
  process.exit(0);
}

if (require.main === module) main(process.argv);

module.exports = {
  validateProgram, collectExistingIds, nextProgramId, toJsLiteral,
  spliceProgram, insertProgram, REQUIRED_TOP, REQUIRED_EX,
};
