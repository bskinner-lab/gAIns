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

// ── Flag thresholds ───────────────────────────────────────────────
// Judgment calls, not research-derived. They decide what gets dropped from the
// next block, so they are named and centralized for easy tuning.
const REJECT_SKIP_RATE = 0.40;   // skipped more than 40% of sets actually attempted
const STALL_MIN_WEEKS  = 4;      // weeks of logged weight needed to call a stall
const LOW_EFFORT_SHARE = 0.5;    // majority-low effort counts as under-stimulating

/** Muscle profile for a performed exercise, falling back to the slot it filled. */
function resolveMuscles(performedId, originalId, muscleMap) {
  return muscleMap[performedId] || muscleMap[originalId] || {};
}

/**
 * Average weekly sets per muscle, per program. Completed sets only — skipped
 * work is exactly the thing we do not want to count as stimulus.
 */
function weeklyVolume(normalized, muscleMap) {
  const out = {};
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const totals = {};
    const weekNums = Object.keys(prog.weeks);
    for (const w of weekNums) {
      for (const dayData of Object.values(prog.weeks[w] || {})) {
        const sets = dayData.sets || {};
        const swaps = dayData.swaps || {};
        for (const [exId, arr] of Object.entries(sets)) {
          if (!Array.isArray(arr)) continue;
          const done = arr.filter(v => v === true).length;
          if (!done) continue;
          const muscles = resolveMuscles(swaps[exId] || exId, exId, muscleMap);
          for (const [muscle, credit] of Object.entries(muscles)) {
            totals[muscle] = (totals[muscle] || 0) + done * credit;
          }
        }
      }
    }
    const weeksWithData = weekNums.length || 1;
    const avg = {};
    for (const [muscle, total] of Object.entries(totals)) avg[muscle] = total / weeksWithData;
    out[progId] = avg;
  }
  return out;
}

/** Classify exercises into the three actionable buckets. */
function flagExercises(statsForProgram) {
  const rejected = [], stalled = [], underStimulating = [];

  for (const [exId, s] of Object.entries(statsForProgram)) {
    const swapWeeks = Object.values(s.swappedTo).reduce((a, n) => a + n, 0);
    if (s.skipRate > REJECT_SKIP_RATE) {
      rejected.push({ exId, reason: `skipped ${Math.round(s.skipRate * 100)}% of sets attempted` });
    } else if (s.weeksTouched && swapWeeks > s.weeksTouched / 2) {
      const target = Object.keys(s.swappedTo).join(', ');
      rejected.push({ exId, reason: `swapped away to ${target} in ${swapWeeks}/${s.weeksTouched} weeks` });
    }

    const effortTotal = s.effortCounts.low + s.effortCounts.medium + s.effortCounts.high;
    if (s.weightPoints.length >= STALL_MIN_WEEKS && s.slope !== null && s.slope <= 0 && s.effortCounts.high > 0) {
      stalled.push({ exId, reason: `no load progress across ${s.weightPoints.length} weeks at high effort` });
    }
    if (effortTotal && s.effortCounts.low / effortTotal > LOW_EFFORT_SHARE && (s.slope === null || s.slope <= 0)) {
      underStimulating.push({ exId, reason: `${s.effortCounts.low}/${effortTotal} sessions rated low effort with no load progress` });
    }
  }
  return { rejected, stalled, underStimulating };
}

/** Compare average weekly volume against the landmarks. */
function flagVolume(volumeForProgram, landmarks) {
  const below = [], above = [];
  for (const [muscle, l] of Object.entries(landmarks)) {
    const sets = volumeForProgram[muscle] || 0;
    if (l.mev > 0 && sets < l.mev) below.push({ muscle, sets, mev: l.mev });
    else if (sets > l.mrv) above.push({ muscle, sets, mrv: l.mrv });
  }
  return { below, above };
}

function num(n, digits = 1) {
  return n === null || n === undefined ? '—' : Number(n).toFixed(digits).replace(/\.0$/, '');
}

/** True if any set slot in the given week's data is not yet attempted (`false`). */
function weekHasUnattempted(weekData) {
  for (const dayData of Object.values(weekData || {})) {
    const sets = dayData.sets || {};
    for (const arr of Object.values(sets)) {
      if (Array.isArray(arr) && arr.some(v => v === false)) return true;
    }
  }
  return false;
}

/** Full analysis object for one export. */
function analyze(raw, muscleMap, landmarks) {
  const normalized = normalizeExport(raw);
  const stats = perExercise(normalized);
  const volume = weeklyVolume(normalized, muscleMap);
  const programs = {};

  for (const progId of Object.keys(normalized.programs)) {
    const weeks = Object.keys(normalized.programs[progId].weeks).map(Number).sort((a, b) => a - b);
    const progStats = stats[progId] || {};
    let completed = 0, skipped = 0, slots = 0;
    for (const s of Object.values(progStats)) {
      completed += s.completed; skipped += s.skipped; slots += s.slots;
    }
    const latestWeek = weeks[weeks.length - 1];
    const latestWeekInProgress = latestWeek !== undefined &&
      weekHasUnattempted(normalized.programs[progId].weeks[String(latestWeek)]);
    programs[progId] = {
      weeks,
      hasData: slots > 0,
      completed, skipped, slots,
      latestWeek, latestWeekInProgress,
      stats: progStats,
      volume: volume[progId] || {},
      exerciseFlags: flagExercises(progStats),
      volumeFlags: flagVolume(volume[progId] || {}, landmarks),
    };
  }
  return { programs, landmarks };
}

/** Markdown report — this is what the /newplan command actually reads. */
function renderReport(analysis) {
  const lines = ['# Training history analysis', ''];

  lines.push('## Adherence', '');
  lines.push('| Program | Weeks with data | Sets completed | Sets skipped | Completion |');
  lines.push('|---|---|---|---|---|');
  for (const [progId, p] of Object.entries(analysis.programs)) {
    const pct = p.slots ? Math.round((p.completed / p.slots) * 100) : 0;
    lines.push(`| ${progId} | ${p.weeks.join(', ') || '—'} | ${p.completed} | ${p.skipped} | ${pct}% |`);
  }
  lines.push('');
  const empty = Object.entries(analysis.programs).filter(([, p]) => !p.hasData).map(([id]) => id);
  if (empty.length) {
    lines.push(`> No logged data for: ${empty.join(', ')}. Excluded from inference.`, '');
  }
  const inProgress = Object.entries(analysis.programs).filter(([, p]) => p.latestWeekInProgress);
  for (const [, p] of inProgress) {
    lines.push(`> Week ${p.latestWeek} is in progress; its unattempted sets are excluded from skip rates.`, '');
  }

  for (const [progId, p] of Object.entries(analysis.programs)) {
    if (!p.hasData) continue;

    lines.push(`## Per exercise — ${progId}`, '');
    lines.push('| Exercise | Done | Skipped | Skip % | Weeks | Weight | Slope/wk | Effort L/M/H | Swapped to |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const [exId, s] of Object.entries(p.stats)) {
      const weight = s.firstWeight === null ? '—' : `${num(s.firstWeight)} → ${num(s.lastWeight)}`;
      const swaps = Object.keys(s.swappedTo).join(', ') || '—';
      const e = s.effortCounts;
      lines.push(
        `| ${exId} | ${s.completed} | ${s.skipped} | ${Math.round(s.skipRate * 100)}% | ` +
        `${s.weeksTouched} | ${weight} | ${num(s.slope)} | ${e.low}/${e.medium}/${e.high} | ${swaps} |`
      );
    }
    lines.push('');

    lines.push(`## Weekly volume by muscle — ${progId}`, '');
    lines.push('| Muscle | Avg sets/week | MEV | MAV | MRV | Status |');
    lines.push('|---|---|---|---|---|---|');
    for (const [muscle, l] of Object.entries(analysis.landmarks)) {
      const sets = p.volume[muscle] || 0;
      let status = 'in range';
      if (l.mev > 0 && sets < l.mev) status = 'BELOW MEV';
      else if (sets > l.mrv) status = 'ABOVE MRV';
      else if (sets < l.mavLow) status = 'below MAV';
      lines.push(`| ${muscle} | ${num(sets)} | ${l.mev} | ${l.mavLow}–${l.mavHigh} | ${l.mrv} | ${status} |`);
    }
    lines.push('');

    lines.push(`## Flags — ${progId}`, '');
    const buckets = [
      ['Rejected (drop from next block)', p.exerciseFlags.rejected],
      ['Stalled (change the stimulus)', p.exerciseFlags.stalled],
      ['Under-stimulating (too light)', p.exerciseFlags.underStimulating],
    ];
    for (const [title, items] of buckets) {
      lines.push(`### ${title}`, '');
      if (!items.length) lines.push('_none_', '');
      else {
        for (const f of items) lines.push(`- \`${f.exId}\` — ${f.reason}`);
        lines.push('');
      }
    }
    lines.push('### Volume gaps', '');
    if (!p.volumeFlags.below.length && !p.volumeFlags.above.length) lines.push('_none_', '');
    else {
      for (const f of p.volumeFlags.below) lines.push(`- **${f.muscle}** under-trained: ${num(f.sets)} sets/week vs MEV ${f.mev}`);
      for (const f of p.volumeFlags.above) lines.push(`- **${f.muscle}** over-trained: ${num(f.sets)} sets/week vs MRV ${f.mrv}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const explicit = argv[2];
  const file = explicit || findNewestExport(path.join(__dirname, '..', 'data'));
  if (!file) {
    console.error(
      'No export found.\n' +
      'In the app: Settings → Export, then move the downloaded gains-backup-*.json into ./data/'
    );
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const muscleMap = require('./muscle-map.json');
  const landmarks = require('./volume-landmarks.json');
  console.error(`Analyzing ${file}`);
  console.log(renderReport(analyze(raw, muscleMap, landmarks)));
}

if (require.main === module) main(process.argv);

module.exports = {
  findNewestExport, normalizeExport, slopeOf, perExercise, EFFORT_LEVELS,
  resolveMuscles, weeklyVolume, flagExercises, flagVolume, analyze, renderReport,
  REJECT_SKIP_RATE, STALL_MIN_WEEKS, LOW_EFFORT_SHARE,
};
