// tools/insert-program.js
'use strict';
const { loadApp } = require('./app-shim');
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

  if (prog.alternatives !== undefined && prog.alternatives !== null) {
    if (typeof prog.alternatives !== 'object') errors.push('alternatives must be an object');
    else {
      for (const [origId, alts] of Object.entries(prog.alternatives)) {
        if (!definedExerciseIds.has(origId)) {
          errors.push(`alternatives['${origId}']: no exercise with id '${origId}' exists in this program`);
        }
        if (!Array.isArray(alts)) { errors.push(`alternatives['${origId}'] must be an array`); continue; }
        alts.forEach((alt, ai) => {
          const where = `alternatives['${origId}'][${ai}]`;
          if (!alt || typeof alt !== 'object') { errors.push(`${where} must be an object`); return; }
          for (const key of missingKeys(alt, ['id', 'name', 'note'])) errors.push(`${where} missing ${key}`);
          noteId(alt.id, where);
        });
      }
    }
  }
  return errors;
}

module.exports = { validateProgram, collectExistingIds, REQUIRED_TOP, REQUIRED_EX };
