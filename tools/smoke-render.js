// tools/smoke-render.js
'use strict';
const { withApp } = require('./app-shim');

function countMatches(html, re) {
  const m = html.match(re);
  return m ? m.length : 0;
}

// A representative-day / every-week strategy, not the full days×weeks cross
// product: mesocycle/weekPhases truncation is indexed purely by week number,
// not by which day is on screen, so one day is enough to catch it at every
// week. The exercise-composition check (every day, real exercise counts)
// already runs once per day at week 1, so nothing is lost by not repeating
// it at every week — it would just re-render the same day markup N times.
function smokeRender(htmlPath, programIdx = 0) {
  try {
    return withApp({ htmlPath, storage: { hypertrophy_program: String(programIdx) } }, app => {
      const rendered = [];

      if (!Number.isInteger(programIdx) || programIdx < 0 || programIdx >= app.PROGRAMS.length) {
        return { ok: false, rendered, error: `program index ${programIdx} out of range (0..${app.PROGRAMS.length - 1})` };
      }
      if (app.currentProgramIdx !== programIdx) {
        return { ok: false, rendered, error: `boot selected program ${app.currentProgramIdx}, expected ${programIdx}` };
      }

      const prog = app.PROGRAMS[programIdx];
      if (app.WEEK_PHASES.length !== prog.totalWeeks) {
        return {
          ok: false, rendered,
          error: `program ${programIdx}: weekPhases.length (${app.WEEK_PHASES.length}) !== totalWeeks (${prog.totalWeeks})`,
        };
      }

      const scroll = app.elements.get('scroll');
      const overlays = app.elements.get('overlays');
      const fail = (label, week, msg) => ({ ok: false, rendered, error: `view "${label}" at week ${week}: ${msg}` });

      function renderDay(day, week) {
        const label = `day:${day.id}`;
        app.view.name = 'day';
        app.view.dayId = day.id;
        scroll.innerHTML = '';
        app.render();
        if (!scroll.innerHTML || scroll.innerHTML.length < 20) return fail(label, week, 'produced empty markup');
        if (day.exercises.length === 0) return fail(label, week, 'day defines 0 exercises');
        const exCount = countMatches(scroll.innerHTML, /<div class="ex">/g);
        if (exCount !== day.exercises.length) {
          return fail(label, week, `rendered ${exCount} exercise cards, expected ${day.exercises.length}`);
        }
        rendered.push(week === 1 ? label : `${label}@week${week}`);
        return null;
      }

      function renderPlan(week) {
        app.view.name = 'plan';
        scroll.innerHTML = '';
        app.render();
        if (!scroll.innerHTML || scroll.innerHTML.length < 20) return fail('plan', week, 'produced empty markup');
        if (prog.mesocycle.length === 0) return fail('plan', week, 'program defines an empty mesocycle');
        const phaseCount = countMatches(scroll.innerHTML, /class="ph( now)?"/g);
        if (phaseCount !== prog.mesocycle.length) {
          return fail('plan', week, `rendered ${phaseCount} mesocycle phase rows, expected ${prog.mesocycle.length}`);
        }
        rendered.push(week === 1 ? 'plan' : `plan@week${week}`);
        return null;
      }

      // Every day, at week 1.
      for (const day of app.DAYS) {
        const err = renderDay(day, 1);
        if (err) return err;
      }

      // Plan, progress, settings at week 1.
      {
        const err = renderPlan(1);
        if (err) return err;
      }
      for (const v of [{ name: 'progress', label: 'progress' }, { name: 'settings', label: 'settings' }]) {
        try {
          app.view.name = v.name;
          scroll.innerHTML = '';
          app.render();
          if (!scroll.innerHTML || scroll.innerHTML.length < 20) return fail(v.label, 1, 'produced empty markup');
          rendered.push(v.label);
        } catch (e) {
          return fail(v.label, 1, `threw: ${e.message}`);
        }
      }

      // Tip overlay: GLOSSARY['RPE'] is a static entry every program's exercise
      // tags reference (data-act="tip" data-t="RPE"), so it's always safe to probe.
      {
        app.view.name = 'day';
        app.view.dayId = app.DAYS[0].id;
        app.view.tip = 'RPE';
        overlays.innerHTML = '';
        try {
          app.render();
        } catch (e) {
          return fail('tip', 1, `threw: ${e.message}`);
        }
        if (!overlays.innerHTML || !overlays.innerHTML.includes('RPE')) {
          return fail('tip', 1, 'tip overlay did not render RPE glossary entry');
        }
        rendered.push('tip');
        app.view.tip = null;
      }

      // Swap overlay: find any exercise, on any day, with EXERCISE_ALTERNATIVES
      // — Task 9 splices `alternatives` data in, and nothing else in this gate
      // ever renders it.
      {
        let swappable = null;
        for (const day of app.DAYS) {
          for (const ex of day.exercises) {
            if (app.EXERCISE_ALTERNATIVES[ex.id]) { swappable = { dayId: day.id, origId: ex.id }; break; }
          }
          if (swappable) break;
        }
        if (!swappable) {
          return { ok: false, rendered, error: `program ${programIdx}: no exercise has an EXERCISE_ALTERNATIVES entry — swap overlay cannot be exercised` };
        }
        app.view.name = 'day';
        app.view.dayId = swappable.dayId;
        app.view.swap = { dayId: swappable.dayId, origId: swappable.origId };
        overlays.innerHTML = '';
        try {
          app.render();
        } catch (e) {
          return fail('swap', 1, `threw: ${e.message}`);
        }
        const altCount = app.EXERCISE_ALTERNATIVES[swappable.origId].length;
        const optCount = countMatches(overlays.innerHTML, /data-act="doswap"/g);
        if (!overlays.innerHTML.includes('Swap Exercise') || optCount !== altCount) {
          return fail('swap', 1, `rendered ${optCount} swap options, expected ${altCount}`);
        }
        rendered.push('swap');
        app.view.swap = null;
      }

      // Remaining weeks: representative day + plan, to catch weekPhases/mesocycle
      // truncation anywhere in the array without re-rendering every day per week.
      const representative = app.DAYS[0];
      for (let week = 2; week <= prog.totalWeeks; week++) {
        app.clickHandler({ target: { closest: () => ({ dataset: { act: 'wk', d: '1' } }) } });
        let err = renderDay(representative, week);
        if (err) return err;
        err = renderPlan(week);
        if (err) return err;
      }

      return { ok: true, rendered };
    });
  } catch (e) {
    return { ok: false, rendered: [], error: `boot failed: ${e.message}` };
  }
}

function main(argv) {
  const htmlPath = argv[2] || undefined;
  const idxArg = argv[3];
  const idx = idxArg === undefined ? 0 : Number(idxArg);
  if (idxArg !== undefined && !Number.isInteger(idx)) {
    console.error(`smoke FAILED — program index "${idxArg}" is not an integer`);
    process.exit(1);
    return;
  }
  const result = smokeRender(htmlPath, idx);
  if (result.ok) {
    console.log(`smoke ok — program ${idx}, ${result.rendered.length} views: ${result.rendered.join(', ')}`);
    process.exit(0);
  }
  console.error(`smoke FAILED — program ${idx}: ${result.error}`);
  process.exit(1);
}

if (require.main === module) main(process.argv);

module.exports = { smokeRender };
