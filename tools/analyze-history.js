// tools/analyze-history.js
'use strict';
const fs = require('fs');
const path = require('path');

const EFFORT_LEVELS = ['low', 'medium', 'high'];

/** Newest *.json in dir by mtime, or null. */
function findNewestExport(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return null; }
  const files = entries
    .filter(f => f.toLowerCase().endsWith('.json'))
    .map(f => path.join(dir, f))
    .map(p => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].p : null;
}

/**
 * Collapse export versions 1, 2 and 3 into one shape.
 * v1/v2 predate multi-program support; the app's own migration attributes them
 * to meso1, so we do the same.
 */
function normalizeExport(raw) {
  if (raw && raw.version === 3 && raw.programs) {
    const programs = {};
    for (const [id, data] of Object.entries(raw.programs)) {
      programs[id] = { weeks: data.weeks || {}, currentWeek: data.currentWeek || 1 };
    }
    return { programs };
  }
  if (raw && raw.version === 2 && raw.weeks) {
    return { programs: { meso1: { weeks: raw.weeks, currentWeek: raw.currentWeek || 1 } } };
  }
  if (raw && raw.state && typeof raw.currentWeek === 'number') {
    return {
      programs: {
        meso1: { weeks: { [String(raw.currentWeek)]: raw.state }, currentWeek: raw.currentWeek },
      },
    };
  }
  throw new Error('unrecognized export format — expected version 1, 2 or 3');
}

/** Least-squares slope of y over x; null with fewer than two points. */
function slopeOf(points) {
  if (!points || points.length < 2) return null;
  const n = points.length;
  const sx = points.reduce((a, p) => a + p[0], 0);
  const sy = points.reduce((a, p) => a + p[1], 0);
  const sxy = points.reduce((a, p) => a + p[0] * p[1], 0);
  const sxx = points.reduce((a, p) => a + p[0] * p[0], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return (n * sxy - sx * sy) / denom;
}

function emptyStat() {
  return {
    completed: 0, skipped: 0, slots: 0, skipRate: 0,
    weeksTouched: 0, weeks: [],
    firstWeight: null, lastWeight: null, slope: null, weightPoints: [],
    effortCounts: { low: 0, medium: 0, high: 0 },
    swappedTo: {},
  };
}

/**
 * Per-program, per-exercise statistics keyed by the ORIGINAL exercise id
 * (swaps are recorded on the original, so this keeps one row per plan slot).
 * @returns {Record<string, Record<string, ReturnType<typeof emptyStat>>>}
 */
function perExercise(normalized) {
  const out = {};
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const byEx = (out[progId] = {});
    const weekNums = Object.keys(prog.weeks).map(Number).sort((a, b) => a - b);

    for (const w of weekNums) {
      const weekData = prog.weeks[String(w)] || {};
      for (const dayData of Object.values(weekData)) {
        const sets = dayData.sets || {};
        const weights = dayData.weights || {};
        const effort = dayData.effort || {};
        const swaps = dayData.swaps || {};

        for (const [exId, arr] of Object.entries(sets)) {
          if (!Array.isArray(arr)) continue;
          const s = (byEx[exId] = byEx[exId] || emptyStat());
          s.slots += arr.length;
          for (const v of arr) {
            if (v === true) s.completed++;
            else if (v === 'skipped') s.skipped++;
          }
          if (!s.weeks.includes(w)) s.weeks.push(w);

          // Assumes one weight per exercise per week — if an exercise id ever
          // appeared on two days within the same week, this would push two
          // points at the same x and skew the slope. Not live today (no id
          // repeats across days in PROGRAMS), but worth knowing if that changes.
          const weight = weights[exId];
          if (typeof weight === 'number' && !Number.isNaN(weight)) {
            s.weightPoints.push([w, weight]);
          }
          const eff = effort[exId];
          if (EFFORT_LEVELS.includes(eff)) s.effortCounts[eff]++;
          // Counts WEEKS a swap was recorded, not swap events — a swap made once
          // and left in place across later weeks increments this each week, which
          // is what makes it directly comparable to weeksTouched (e.g. "swapped in
          // 2 of 3 trained weeks").
          if (swaps[exId]) s.swappedTo[swaps[exId]] = (s.swappedTo[swaps[exId]] || 0) + 1;
        }
      }
    }

    for (const s of Object.values(byEx)) {
      s.weeksTouched = s.weeks.length;
      // Denominator is completed+skipped, not slots — slots includes sets not
      // yet attempted this (in-progress) week, which would otherwise dilute
      // skipRate for exactly the exercises being skipped.
      const attempted = s.completed + s.skipped;
      s.skipRate = attempted ? s.skipped / attempted : 0;
      s.weightPoints.sort((a, b) => a[0] - b[0]);
      if (s.weightPoints.length) {
        s.firstWeight = s.weightPoints[0][1];
        s.lastWeight = s.weightPoints[s.weightPoints.length - 1][1];
      }
      s.slope = slopeOf(s.weightPoints);
    }
  }
  return out;
}

module.exports = {
  findNewestExport, normalizeExport, slopeOf, perExercise, EFFORT_LEVELS,
};
