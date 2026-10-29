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

const work = ex => (ex.compound ? WORK_COMPOUND : WORK_ISOLATION);

// Sets consume n rests, not n-1: the last one doubles as the walk to the next
// station and the setup there.
function exerciseSeconds(ex, week, prog) {
  const n = app.setsForWeek(ex, week, prog);
  if (isZone2(ex)) return ZONE2_SECONDS + ex.rest;
  return n * (work(ex) + ex.rest);
}

// A superset round, priced the way supersetStep() runs it: A1, the walk, A2,
// then the longer of the two rests minus the walk and A2's set (each muscle's
// rest already includes the partner's work), never under the floor. Sets past
// the shorter exercise's count run straight, with their own rest.
function pairSeconds(a, b, week, prog) {
  const na = app.setsForWeek(a, week, prog), nb = app.setsForWeek(b, week, prog);
  const rounds = Math.min(na, nb);
  const T = app.SUPERSET_TRANSITION_SEC;
  const rest = Math.max(Math.max(a.rest, b.rest) - T - work(b), app.SUPERSET_MIN_REST_SEC);
  return rounds * (work(a) + T + work(b) + rest)
    + (na - rounds) * (work(a) + a.rest) + (nb - rounds) * (work(b) + b.rest);
}

function sessionMinutes(day, week, prog = MESO3) {
  let s = day.protocol ? PREHAB_SECONDS : 0;
  const priced = new Set();
  for (const ex of day.exercises) {
    if (priced.has(ex)) continue;
    const partner = app.supersetPartner(day, ex);
    if (partner) { s += pairSeconds(ex, partner, week, prog); priced.add(partner); }
    else s += exerciseSeconds(ex, week, prog);
  }
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

// ── Meso 4 ───────────────────────────────────────────────────────────────────
// Meso 4 shipped without this guard and ran 63–87 minutes from week 5 on —
// PULL worst — so sets were being skipped every session to get out of the gym.
// From week 6 it runs isolations (and the abs work beside two of the big
// compounds) as supersets of exercises that share no prime mover, and trims
// the redundant sets: the third row on PULL, the excess triceps and glute
// volume that every press and squat was already crediting. Weeks 1–5 are the
// block as it was actually trained and are not asserted against this budget.
const MESO4 = app.PROGRAMS.find(p => p.id === 'meso4');
const MESO4_BUDGET_WEEKS = [6, 7, 8];
const MESO4_MAX_MINUTES = 50;

for (const week of MESO4_BUDGET_WEEKS) {
  test(`every meso4 session in week ${week} fits the ${MESO4_MAX_MINUTES}-minute budget`, () => {
    for (const day of MESO4.days) {
      const mins = sessionMinutes(day, week, MESO4);
      assert.ok(mins <= MESO4_MAX_MINUTES,
        `meso4 ${day.id} (${day.title}) in week ${week}: ${mins.toFixed(1)} min exceeds ` +
        `the ${MESO4_MAX_MINUTES}-minute budget — pair it with a non-competing exercise, or ` +
        `trim a set, before shortening a rest`);
    }
  });
}

// Every block after meso4 is generated by /newplan, which is told to fit this
// budget from week 1. This is where that instruction is enforced.
const LATER = app.PROGRAMS.slice(app.PROGRAMS.indexOf(MESO4) + 1);
for (const prog of LATER) {
  test(`every ${prog.id} session fits the ${MESO4_MAX_MINUTES}-minute budget in every week`, () => {
    for (let week = 1; week <= prog.totalWeeks; week++) {
      for (const day of prog.days) {
        const mins = sessionMinutes(day, week, prog);
        assert.ok(mins <= MESO4_MAX_MINUTES,
          `${prog.id} ${day.id} (${day.title}) in week ${week}: ${mins.toFixed(1)} min exceeds ` +
          `the ${MESO4_MAX_MINUTES}-minute budget — superset it or cut redundant sets (see /newplan)`);
      }
    }
  });
}

test('the meso4 supersets are what make the budget hold', () => {
  // Price the same sets as straight sets. If this stops being far over the
  // budget, the pairs are no longer earning their place in the plan.
  const straight = (day, week) => {
    let s = day.protocol ? PREHAB_SECONDS : 0;
    for (const ex of day.exercises) s += exerciseSeconds(ex, week, MESO4);
    return s / 60;
  };
  const over = MESO4.days.filter(d => straight(d, 7) > MESO4_MAX_MINUTES + 5);
  assert.ok(over.length >= 3,
    `only ${over.length} meso4 sessions run 5+ min over budget as straight sets in week 7`);
});
