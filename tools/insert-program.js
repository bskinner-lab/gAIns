// tools/insert-program.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadApp, extractScript, APP_HTML } = require('./app-shim');
const { smokeRender } = require('./smoke-render');

const REQUIRED_TOP = ['name', 'subtitle', 'totalWeeks', 'days', 'protocolItems', 'mesocycle', 'weekPhases'];
const REQUIRED_EX = ['id', 'name', 'sets', 'reps', 'rpe', 'note', 'llp', 'compound', 'rest', 'restLabel', 'muscles'];
const REQUIRED_DAY = ['id', 'label', 'title', 'subtitle', 'exercises'];

/** Every exercise id already live in the app — programs and swap targets alike. */
function collectExistingIds(htmlPath = APP_HTML) {
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
 * problem rather than making the caller play whack-a-mole.
 * @returns {string[]}
 */
function validateProgram(prog, existingIds = new Set()) {
  const errors = [];
  if (!prog || typeof prog !== 'object') return ['program must be an object'];

  for (const key of REQUIRED_TOP) {
    if (prog[key] === undefined || prog[key] === null) errors.push(`missing required field: ${key}`);
  }
  if (typeof prog.totalWeeks === 'number' && Array.isArray(prog.weekPhases) &&
      prog.weekPhases.length !== prog.totalWeeks) {
    errors.push(`weekPhases has ${prog.weekPhases.length} entries but totalWeeks is ${prog.totalWeeks}`);
  }
  if (Array.isArray(prog.weekPhases)) {
    prog.weekPhases.forEach((ph, i) => {
      for (const key of ['label', 'rpe', 'llp', 'color']) {
        if (ph[key] === undefined) errors.push(`weekPhases[${i}] missing ${key}`);
      }
    });
  }
  if (Array.isArray(prog.mesocycle)) {
    prog.mesocycle.forEach((ph, i) => {
      for (const key of ['weeks', 'label', 'rpe', 'rir', 'color', 'points']) {
        if (ph[key] === undefined) errors.push(`mesocycle[${i}] missing ${key}`);
      }
    });
  }
  if (Array.isArray(prog.protocolItems) && prog.protocolItems.length === 0) {
    errors.push('protocolItems is empty');
  }

  const seen = new Set();
  const noteId = (id, where) => {
    if (!id) return;
    if (seen.has(id)) errors.push(`${where}: duplicate id '${id}' within the new program`);
    else if (existingIds.has(id)) errors.push(`${where}: id '${id}' already exists in index.html`);
    seen.add(id);
  };

  if (!Array.isArray(prog.days) || prog.days.length === 0) {
    errors.push('days must be a non-empty array');
  } else {
    prog.days.forEach((day, di) => {
      for (const key of REQUIRED_DAY) {
        if (day[key] === undefined) errors.push(`days[${di}] missing ${key}`);
      }
      if (!Array.isArray(day.exercises) || day.exercises.length === 0) {
        errors.push(`day ${day.id || di} has no exercises`);
        return;
      }
      day.exercises.forEach((ex, ei) => {
        const where = `${day.id || di}/exercises[${ei}]`;
        for (const key of REQUIRED_EX) {
          if (ex[key] === undefined) errors.push(`${where} missing ${key}`);
        }
        if (ex.rest !== undefined && typeof ex.rest !== 'number') {
          errors.push(`${where}: rest must be a number (got ${typeof ex.rest})`);
        }
        if (ex.muscles !== undefined &&
            (typeof ex.muscles !== 'object' || Object.keys(ex.muscles).length === 0)) {
          errors.push(`${where}: muscles must be a non-empty object`);
        }
        noteId(ex.id, where);
      });
    });
  }

  if (prog.alternatives !== undefined) {
    if (typeof prog.alternatives !== 'object') errors.push('alternatives must be an object');
    else {
      for (const [origId, alts] of Object.entries(prog.alternatives)) {
        if (!Array.isArray(alts)) { errors.push(`alternatives['${origId}'] must be an array`); continue; }
        alts.forEach((alt, ai) => {
          const where = `alternatives['${origId}'][${ai}]`;
          for (const key of ['id', 'name', 'note']) {
            if (alt[key] === undefined) errors.push(`${where} missing ${key}`);
          }
          noteId(alt.id, where);
        });
      }
    }
  }
  return errors;
}

module.exports = { validateProgram, collectExistingIds, REQUIRED_TOP, REQUIRED_EX };
