// tools/session-length.test.js
//
// Meso 3 is time-budgeted: every session has to fit an hour-ish, because the
// block runs 5 days a week alongside a deficit and an 80-minute workout is the
// one that gets skipped. PULL and UPPER used to run 74 and 77 minutes at the
// week-7 peak; the fix was to lift work off them onto the two lower days, which
// had 15+ minutes of headroom, rather than to shorten rests.
//
// The estimate below is a model, not a stopwatch. It exists so that adding a
// set or an exercise makes the cost visible in a diff instead of six weeks
// later in the gym. Real sessions run longer than this — waiting for a rack,
// changing plates, talking to someone — so the ceiling is deliberately set at
// the point where the modelled session is already at the edge of the budget.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./app-shim');

const app = loadApp();
const MESO3 = app.PROGRAMS[2];

// Time under load per set, in seconds. A compound set is longer than an
// isolation set: more reps at a slower tempo, plus unracking and setup.
const WORK_COMPOUND = 45;
const WORK_ISOLATION = 32;

// Prehab that opens every protocol day: band pull-aparts 2×20 plus external
// rotations 2×15/arm. Not deloaded, so it is a flat cost in every week.
const PREHAB_SECONDS = 300;

// The Zone 2 finisher is prescribed as one 10-minute set; `rest` covers the
// walk back and the log entry.
const ZONE2_SECONDS = 600;
const isZone2 = ex => ex.reps.includes('min') && !ex.compound && ex.rpe === '5–6';

// Sets consume n rests, not n-1: the last one doubles as the walk to the next
// station and the setup there.
function exerciseSeconds(ex, week) {
  const n = app.setsForWeek(ex, week, MESO3);
  if (isZone2(ex)) return ZONE2_SECONDS + ex.rest;
  return n * (ex.compound ? WORK_COMPOUND : WORK_ISOLATION) + n * ex.rest;
}

function sessionMinutes(day, week) {
  let s = day.protocol ? PREHAB_SECONDS : 0;
  for (const ex of day.exercises) s += exerciseSeconds(ex, week);
  return s / 60;
}

// ── The budget ───────────────────────────────────────────────────────────────
// Weeks 1–7 accumulate; week 8 halves every set count and is asserted only
// against the ceiling, since a deload is meant to be short.
const ACCUMULATION_WEEKS = [1, 2, 3, 4, 5, 6, 7];
const MAX_MINUTES = 70;
const MIN_MINUTES = 45;

for (const week of ACCUMULATION_WEEKS) {
  test(`every meso3 session in week ${week} fits the ${MAX_MINUTES}-minute budget`, () => {
    for (const day of MESO3.days) {
      const mins = sessionMinutes(day, week);
      assert.ok(mins <= MAX_MINUTES,
        `meso3 ${day.id} (${day.title}) in week ${week}: ${mins.toFixed(1)} min exceeds ` +
        `the ${MAX_MINUTES}-minute budget — move work to a shorter day rather than ` +
        `cutting rest periods, which buys minutes by degrading the sets you keep`);
    }
  });
}

test('no meso3 accumulation session is so short it is doing nothing', () => {
  for (const week of ACCUMULATION_WEEKS) {
    for (const day of MESO3.days) {
      const mins = sessionMinutes(day, week);
      assert.ok(mins >= MIN_MINUTES,
        `meso3 ${day.id} (${day.title}) in week ${week}: ${mins.toFixed(1)} min is under ` +
        `${MIN_MINUTES} — it has room to absorb volume from a longer day`);
    }
  }
});

test('the meso3 deload is the shortest week', () => {
  for (const day of MESO3.days) {
    const deload = sessionMinutes(day, 8);
    const peak = sessionMinutes(day, 7);
    assert.ok(deload < peak,
      `meso3 ${day.id} (${day.title}): the deload runs ${deload.toFixed(1)} min against ` +
      `${peak.toFixed(1)} at the week-7 peak — a deload that is not shorter is not a deload`);
  }
});

// ── The spread ───────────────────────────────────────────────────────────────
// Two 77-minute days next to a 47-minute one is the same weekly work badly
// distributed. Keeping the gap closed is what makes the budget hold without
// deleting sets.
const MAX_SPREAD_MINUTES = 20;

test(`meso3 sessions within a week stay within ${MAX_SPREAD_MINUTES} minutes of each other`, () => {
  for (const week of ACCUMULATION_WEEKS) {
    const mins = MESO3.days.map(d => ({ day: `${d.id} (${d.title})`, mins: sessionMinutes(d, week) }));
    const longest = mins.reduce((a, b) => (b.mins > a.mins ? b : a));
    const shortest = mins.reduce((a, b) => (b.mins < a.mins ? b : a));
    const spread = longest.mins - shortest.mins;
    assert.ok(spread <= MAX_SPREAD_MINUTES,
      `meso3 week ${week}: ${longest.day} runs ${longest.mins.toFixed(1)} min against ` +
      `${shortest.day} at ${shortest.mins.toFixed(1)} — a ${spread.toFixed(1)}-minute spread. ` +
      `Move an exercise from the long day to the short one.`);
  }
});
