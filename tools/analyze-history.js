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

/**
 * Parse a weight value into a finite number, or null if it isn't one. The app
 * writes weights from `<input>` values, so strings ("135", "47.5") are the
 * norm on real exports, not a corruption — this must accept those while still
 * rejecting junk ("", "abc", null, NaN, Infinity).
 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Per-program, per-day map from legacy numeric index (an exercise's position
 * within its day) to its real exercise id — mirrors `rebuildLegacyIdMap()` in
 * index.html, built from the same `day.exercises` order.
 * @returns {Record<string, Record<string, Record<string, string>>>}
 */
function buildLegacyIdMap(programs) {
  const map = {};
  for (const prog of programs || []) {
    const dayMap = (map[prog.id] = {});
    for (const day of prog.days || []) {
      dayMap[day.id] = {};
      day.exercises.forEach((ex, i) => { dayMap[day.id][i] = ex.id; });
    }
  }
  return map;
}

/**
 * Mirrors `migrateDayState()` in index.html exactly: a day is already
 * id-keyed (leave alone) unless EVERY key in `sets` is numeric, in which case
 * every numeric key is remapped through `dayIdMap` to its real exercise id.
 * Keys with no entry in `dayIdMap` (index doesn't exist in this day) are
 * dropped rather than carried through or thrown on.
 */
function migrateLegacyDayState(dayId, sd, dayIdMap) {
  if (!sd || !sd.sets) return sd;
  const hasStringKeys = Object.keys(sd.sets).some(k => isNaN(k));
  if (hasStringKeys) return sd;
  const map = dayIdMap[dayId];
  if (!map) return sd;
  const m = { sets: {}, weights: {}, effort: {}, protocol: sd.protocol || [], swaps: sd.swaps || {} };
  Object.keys(sd.sets).forEach(k => {
    const exId = map[k];
    if (exId) m.sets[exId] = sd.sets[k];
  });
  if (sd.weights) {
    Object.keys(sd.weights).forEach(k => {
      if (k.includes('_')) {
        const [ei, si] = k.split('_');
        const exId = map[ei];
        if (exId) m.weights[`${exId}_${si}`] = sd.weights[k];
      } else {
        const exId = map[k];
        if (exId) m.weights[exId] = sd.weights[k];
      }
    });
  }
  if (sd.effort) {
    Object.keys(sd.effort).forEach(k => {
      const exId = map[k];
      if (exId) m.effort[exId] = sd.effort[k];
    });
  }
  return m;
}

/**
 * Mutates `normalized` in place, migrating every day in every week of every
 * program from legacy index-keyed state to id-keyed state where needed. The
 * map is built per program because meso1 and meso2 have different days and
 * exercise orders.
 */
function migrateLegacyState(normalized, programs) {
  const idMap = buildLegacyIdMap(programs);
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const dayIdMap = idMap[progId] || {};
    for (const weekData of Object.values(prog.weeks)) {
      for (const dayId of Object.keys(weekData || {})) {
        weekData[dayId] = migrateLegacyDayState(dayId, weekData[dayId], dayIdMap);
      }
    }
  }
  return normalized;
}

/**
 * True exactly when the app would treat this day's `sets` as legacy
 * numeric-index keys rather than real exercise ids — mirrors the check in
 * `migrateLegacyDayState`/`migrateDayState` (index.html): id-keyed iff at
 * least one key is non-numeric. An empty `sets` object has nothing to
 * mis-map either way, so it is not flagged.
 */
function isLegacyDayState(sd) {
  if (!sd || !sd.sets) return false;
  const keys = Object.keys(sd.sets);
  return keys.length > 0 && !keys.some(k => isNaN(k));
}

/**
 * Legacy index-keyed weeks are EXCLUDED from analysis, not migrated, even
 * though `migrateLegacyState` above can technically remap them. Migrating
 * assumes the day's exercise ORDER at the time it was logged matches the
 * CURRENT program definition — but that order changes. On this user's real
 * export, meso1 day4 had `close_grip_bench` inserted at index 3 after weeks
 * 1-6 were logged, shifting every later index by one. Migrating week 6
 * against today's order attributes index 3's value (actually
 * `cable_lat_raise_upper`, confirmed by comparing against week 7, which is
 * already id-keyed) to `close_grip_bench` instead — a fabricated 100 -> 7.5
 * "regression" that never happened. day1/2/3/5 happen to still align at
 * offset 0 on this export; day4 does not. There is no single global
 * correction (day4 needs +1, the others need +0), and reconstructing each
 * day's historical order well enough to trust it is not possible from a
 * single week of overlap. So: exclude, don't guess. Do not resurrect the
 * migration path here without solving that problem for real.
 *
 * @returns {{normalized: object, excluded: Record<string, {week: number, day: string}[]>}}
 */
function excludeLegacyState(normalized) {
  const excluded = {};
  const cleaned = { programs: {} };
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const weeks = {};
    for (const [wk, weekData] of Object.entries(prog.weeks)) {
      const keptDays = {};
      for (const [dayId, dayData] of Object.entries(weekData || {})) {
        if (isLegacyDayState(dayData)) {
          (excluded[progId] = excluded[progId] || []).push({ week: Number(wk), day: dayId });
        } else {
          keptDays[dayId] = dayData;
        }
      }
      if (Object.keys(keptDays).length) weeks[wk] = keptDays;
    }
    cleaned.programs[progId] = { weeks, currentWeek: prog.currentWeek };
  }
  return { normalized: cleaned, excluded };
}

/** Group a flat `{week, day}[]` exclusion list into `{week, days[]}[]`, sorted. */
function groupExcluded(excludedList) {
  const byWeek = {};
  for (const { week, day } of excludedList) {
    (byWeek[week] = byWeek[week] || []).push(day);
  }
  return Object.keys(byWeek)
    .map(Number)
    .sort((a, b) => a - b)
    .map(w => ({ week: w, days: byWeek[w].sort() }));
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
 * Static reverse map, substitute id -> original id, built from
 * `EXERCISE_ALTERNATIVES` (index.html): every id an exercise could EVER be
 * swapped to, not just the one currently recorded in a given week's `swaps`.
 * Needed because `performSwap()` adds the new substitute's `sets` key
 * without deleting the previous one — see the comment on `resolveDaySlots`
 * for why that leaves stale keys behind that this week's own `swaps` object
 * can't explain on its own.
 */
function buildAltReverseMap(exerciseAlternatives) {
  const rev = {};
  for (const [origId, alts] of Object.entries(exerciseAlternatives || {})) {
    for (const alt of alts || []) rev[alt.id] = origId;
  }
  return rev;
}

/**
 * Resolve one day's `sets` keys down to one `slotKey` per plan slot, so a
 * slot with a live swap is counted once under its original id rather than
 * split across rows. Three shapes have to collapse into that one row:
 *  1. Not swapped this week — `sets` keyed by the original id itself.
 *  2. Currently swapped — `sets` keyed by this week's `swaps[origId]`.
 *  3. Stale — `sets` STILL has a key from an EARLIER substitute the user
 *     has since swapped away from. `performSwap()` in index.html never
 *     deletes the old key when a new one is written, so on a real export a
 *     day can carry two `alt_*` keys for the same slot in the same week:
 *     the live one from this week's `swaps`, and an orphan left over from a
 *     prior swap that `swaps` no longer mentions. `altReverse` (built from
 *     the static `EXERCISE_ALTERNATIVES`, not this week's `swaps`) is what
 *     lets the orphan be recognized as belonging to the same slot at all.
 * When both a live and a stale key resolve to the same slot, the live one
 * wins — the stale one is abandoned state, not real training that week.
 * @returns {[string, string][]} [origId, slotKey] pairs, one per slot touched
 */
function resolveDaySlots(dayData, altReverse) {
  const sets = dayData.sets || {};
  const swaps = dayData.swaps || {};
  const origOf = {};
  for (const [origId, subId] of Object.entries(swaps)) origOf[subId] = origId;

  const bySlot = {};
  for (const slotKey of Object.keys(sets)) {
    if (!Array.isArray(sets[slotKey])) continue;
    const origId = origOf[slotKey] || (altReverse && altReverse[slotKey]) || slotKey;
    const isLive = slotKey === origId || swaps[origId] === slotKey;
    if (!(origId in bySlot) || isLive) bySlot[origId] = slotKey;
  }
  return Object.entries(bySlot);
}

/**
 * Per-program, per-exercise statistics keyed by the ORIGINAL exercise id
 * (swaps are recorded on the original, so this keeps one row per plan slot).
 * `exerciseAlternatives` is optional — pass the real `EXERCISE_ALTERNATIVES`
 * from index.html to also fold in stale prior-substitute keys (see
 * `resolveDaySlots`); omitting it still folds the CURRENT week's swap
 * correctly, it just can't recognize an orphaned older one.
 * @returns {Record<string, Record<string, ReturnType<typeof emptyStat>>>}
 */
function perExercise(normalized, exerciseAlternatives) {
  const out = {};
  const altReverse = buildAltReverseMap(exerciseAlternatives);
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

        for (const [exId, slotKey] of resolveDaySlots(dayData, altReverse)) {
          const arr = sets[slotKey];
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
          //
          // Read by `slotKey`, not `exId`: when a swap is live, `weights[exId]`
          // (the original) is stale leftover from before the swap, and
          // `weights[slotKey]` (the substitute) is the real number for this
          // week. Reading by slotKey picks whichever one was actually logged
          // this week and never lets the stale entry create a phantom point.
          const weight = toNumber(weights[slotKey]);
          if (weight !== null) {
            s.weightPoints.push([w, weight]);
          }
          const eff = effort[slotKey];
          if (EFFORT_LEVELS.includes(eff)) s.effortCounts[eff]++;
          // Counts WEEKS a swap was recorded, not swap events — a swap made once
          // and left in place across later weeks increments this each week, which
          // is what makes it directly comparable to weeksTouched (e.g. "swapped in
          // 2 of 3 trained weeks"). Looked up via `exId` (the original slot) so
          // this works whether `sets` happens to still be keyed by the original
          // or has already moved to the substitute.
          const subId = swaps[exId];
          if (subId) s.swappedTo[subId] = (s.swappedTo[subId] || 0) + 1;
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
 * Count weeks in a program's `weeks` map that have at least one COMPLETED set
 * somewhere. `initState()` in the app calls `saveState()` unconditionally on
 * every visit, so a week the user merely opened — the most common state, since
 * opening the app to preview the plan predates training it — writes an
 * all-false sets blob and shows up in the export. That week must not count
 * toward a volume average it contributed nothing to.
 */
function countWeeksWithCompletedSets(weeksObj) {
  let count = 0;
  for (const weekData of Object.values(weeksObj || {})) {
    const hasCompleted = Object.values(weekData || {}).some(dayData =>
      Object.values(dayData.sets || {}).some(arr => Array.isArray(arr) && arr.some(v => v === true))
    );
    if (hasCompleted) count++;
  }
  return count;
}

/**
 * Average weekly sets per muscle, per program. Completed sets only — skipped
 * work is exactly the thing we do not want to count as stimulus. Averaged
 * over weeks that actually had completed work, not every week key present —
 * see countWeeksWithCompletedSets.
 */
function weeklyVolume(normalized, muscleMap, exerciseAlternatives) {
  const out = {};
  const altReverse = buildAltReverseMap(exerciseAlternatives);
  for (const [progId, prog] of Object.entries(normalized.programs)) {
    const totals = {};
    for (const weekData of Object.values(prog.weeks)) {
      for (const dayData of Object.values(weekData || {})) {
        const sets = dayData.sets || {};
        // `slotKey` (from resolveDaySlots — see its comment for why a naive
        // `swaps[exId]` lookup misses once a swap is live, and why a stale
        // prior-substitute key must be excluded rather than double-counted)
        // is always the performed id; resolve its muscle profile and fall
        // back to the slot's own profile when the substitute has none of
        // its own — the common case, since `alt_*` ids aren't in
        // muscle-map.json.
        for (const [origId, slotKey] of resolveDaySlots(dayData, altReverse)) {
          const arr = sets[slotKey];
          const done = arr.filter(v => v === true).length;
          if (!done) continue;
          const muscles = resolveMuscles(slotKey, origId, muscleMap);
          for (const [muscle, credit] of Object.entries(muscles)) {
            totals[muscle] = (totals[muscle] || 0) + done * credit;
          }
        }
      }
    }
    const weeksWithData = countWeeksWithCompletedSets(prog.weeks) || 1;
    const avg = {};
    for (const [muscle, total] of Object.entries(totals)) avg[muscle] = total / weeksWithData;
    out[progId] = avg;
  }
  return out;
}

/**
 * Classify exercises into actionable buckets. `rejected` and `substituted`
 * are both "stop programming the original exercise", but they call for
 * opposite actions: a skip-driven rejection means the muscle group got no
 * work and needs a genuinely new exercise; a swap-driven one means the user
 * has been reliably training it via their own substitute the whole time, so
 * the correct move is to promote that substitute into the slot, not drop it.
 * Keeping them in one "Rejected" bucket would read as "cut this" in both
 * cases, which is wrong for the swap case.
 */
function flagExercises(statsForProgram) {
  const rejected = [], substituted = [], stalled = [], underStimulating = [];

  for (const [exId, s] of Object.entries(statsForProgram)) {
    const swapWeeks = Object.values(s.swappedTo).reduce((a, n) => a + n, 0);
    if (s.skipRate > REJECT_SKIP_RATE) {
      rejected.push({ exId, reason: `skipped ${Math.round(s.skipRate * 100)}% of sets attempted` });
    } else if (s.weeksTouched && swapWeeks > s.weeksTouched / 2) {
      const target = Object.keys(s.swappedTo).join(', ');
      substituted.push({ exId, reason: `swapped away to ${target} in ${swapWeeks}/${s.weeksTouched} weeks` });
    }

    const effortTotal = s.effortCounts.low + s.effortCounts.medium + s.effortCounts.high;
    if (s.weightPoints.length >= STALL_MIN_WEEKS && s.slope !== null && s.slope <= 0 && s.effortCounts.high > 0) {
      stalled.push({ exId, reason: `no load progress across ${s.weightPoints.length} weeks at high effort` });
    }
    if (effortTotal && s.effortCounts.low / effortTotal > LOW_EFFORT_SHARE && (s.slope === null || s.slope <= 0)) {
      underStimulating.push({ exId, reason: `${s.effortCounts.low}/${effortTotal} sessions rated low effort with no load progress` });
    }
  }
  return { rejected, substituted, stalled, underStimulating };
}

/**
 * Compare average weekly volume against the landmarks. `statuses` gives the
 * classification per muscle so renderReport's table can reuse it instead of
 * re-deriving the same mev/mavLow/mrv comparisons a second time.
 */
function flagVolume(volumeForProgram, landmarks) {
  const below = [], above = [], statuses = {};
  for (const [muscle, l] of Object.entries(landmarks)) {
    const sets = volumeForProgram[muscle] || 0;
    let status = 'in range';
    if (l.mev > 0 && sets < l.mev) {
      status = 'BELOW MEV';
      below.push({ muscle, sets, mev: l.mev });
    } else if (sets > l.mrv) {
      status = 'ABOVE MRV';
      above.push({ muscle, sets, mrv: l.mrv });
    } else if (sets < l.mavLow) {
      status = 'below MAV';
    }
    statuses[muscle] = status;
  }
  return { below, above, statuses };
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

/**
 * Full analysis object for one export. Legacy index-keyed weeks (see
 * `excludeLegacyState`) are dropped before any statistic is computed — they
 * are untrustworthy, not merely differently-shaped, so there is no "opt in
 * to migrating them" flag here. `exerciseAlternatives` is optional (the real
 * `EXERCISE_ALTERNATIVES` from index.html) — see `resolveDaySlots` for what
 * it buys: recognizing a stale prior-substitute key left behind by a swap
 * that has since been swapped away from again.
 */
function analyze(raw, muscleMap, landmarks, exerciseAlternatives) {
  const rawNormalized = normalizeExport(raw);
  const { normalized, excluded } = excludeLegacyState(rawNormalized);
  const stats = perExercise(normalized, exerciseAlternatives);
  const volume = weeklyVolume(normalized, muscleMap, exerciseAlternatives);
  const programs = {};
  const excludedReport = {};
  for (const progId of Object.keys(rawNormalized.programs)) {
    excludedReport[progId] = groupExcluded(excluded[progId] || []);
  }

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
    const volumeWeeks = countWeeksWithCompletedSets(normalized.programs[progId].weeks);
    programs[progId] = {
      weeks,
      hasData: slots > 0,
      completed, skipped, slots,
      latestWeek, latestWeekInProgress,
      stats: progStats,
      volume: volume[progId] || {},
      volumeWeeks,
      exerciseFlags: flagExercises(progStats),
      volumeFlags: flagVolume(volume[progId] || {}, landmarks),
    };
  }
  return { programs, landmarks, excluded: excludedReport };
}

/** Markdown report — this is what the /newplan command actually reads. */
function renderReport(analysis) {
  const lines = ['# Training history analysis', ''];

  const excludedEntries = Object.entries(analysis.excluded || {}).filter(([, list]) => list.length);
  if (excludedEntries.length) {
    lines.push('## ⚠ Excluded weeks — legacy exercise-index keys', '');
    lines.push(
      '> These weeks store `sets` keyed by each exercise\'s numeric position within ' +
      'its day, not by exercise id. The program\'s exercise order has changed since ' +
      'they were logged, so that position-to-exercise mapping can no longer be ' +
      'trusted — remapping them against the CURRENT order silently produces fabricated ' +
      'numbers. They are excluded entirely from every statistic below, not guessed at. ' +
      'What follows is not the full training history.',
      ''
    );
    lines.push('| Program | Week | Days |', '|---|---|---|');
    for (const [progId, list] of excludedEntries) {
      for (const { week, days } of list) {
        lines.push(`| ${progId} | ${week} | ${days.join(', ')} |`);
      }
    }
    lines.push('');
  }

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

    const weekWord = p.volumeWeeks === 1 ? 'week' : 'weeks';
    lines.push(`## Weekly volume by muscle — ${progId} (avg over ${p.volumeWeeks} ${weekWord} with completed sets)`, '');
    lines.push('| Muscle | Avg sets/week | MEV | MAV | MRV | Status |');
    lines.push('|---|---|---|---|---|---|');
    for (const [muscle, l] of Object.entries(analysis.landmarks)) {
      const sets = p.volume[muscle] || 0;
      const status = p.volumeFlags.statuses[muscle];
      lines.push(`| ${muscle} | ${num(sets)} | ${l.mev} | ${l.mavLow}–${l.mavHigh} | ${l.mrv} | ${status} |`);
    }
    lines.push('');

    lines.push(`## Flags — ${progId}`, '');
    const buckets = [
      ['Rejected (drop from next block)', p.exerciseFlags.rejected],
      ['Substitute promoted — replace the exercise, keep the slot', p.exerciseFlags.substituted],
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
  const { EXERCISE_ALTERNATIVES } = require('./app-shim').loadApp();
  console.error(`Analyzing ${file}`);
  console.log(renderReport(analyze(raw, muscleMap, landmarks, EXERCISE_ALTERNATIVES)));
}

if (require.main === module) main(process.argv);

module.exports = {
  findNewestExport, normalizeExport, slopeOf, perExercise, EFFORT_LEVELS,
  resolveMuscles, weeklyVolume, countWeeksWithCompletedSets, flagExercises, flagVolume,
  analyze, renderReport, toNumber, buildLegacyIdMap, migrateLegacyState,
  isLegacyDayState, excludeLegacyState, buildAltReverseMap, resolveDaySlots,
  REJECT_SKIP_RATE, STALL_MIN_WEEKS, LOW_EFFORT_SHARE,
};
