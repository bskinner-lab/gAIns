// tools/smoke-render.js
'use strict';
const { withApp } = require('./app-shim');

/**
 * Render every view of one program under the DOM shim.
 * @param {string|undefined} htmlPath  defaults to ../index.html
 * @param {number} programIdx
 * @returns {{ok: boolean, rendered: string[], error?: string}}
 */
function smokeRender(htmlPath, programIdx = 0) {
  try {
    return withApp({ htmlPath, storage: { hypertrophy_program: String(programIdx) } }, app => {
      const rendered = [];

      if (programIdx < 0 || programIdx >= app.PROGRAMS.length) {
        return { ok: false, rendered, error: `program index ${programIdx} out of range (0..${app.PROGRAMS.length - 1})` };
      }
      if (app.currentProgramIdx !== programIdx) {
        return { ok: false, rendered, error: `boot selected program ${app.currentProgramIdx}, expected ${programIdx}` };
      }

      const scroll = app.elements.get('scroll');
      const views = [
        ...app.DAYS.map(d => ({ name: 'day', dayId: d.id, label: `day:${d.id}` })),
        { name: 'plan', label: 'plan' },
        { name: 'progress', label: 'progress' },
        { name: 'settings', label: 'settings' },
      ];

      for (const v of views) {
        try {
          app.view.name = v.name;
          if (v.dayId) app.view.dayId = v.dayId;
          scroll.innerHTML = '';
          app.render();
          if (!scroll.innerHTML || scroll.innerHTML.length < 20) {
            return { ok: false, rendered, error: `view "${v.label}" produced empty markup` };
          }
          rendered.push(v.label);
        } catch (e) {
          return { ok: false, rendered, error: `view "${v.label}" threw: ${e.message}` };
        }
      }
      return { ok: true, rendered };
    });
  } catch (e) {
    return { ok: false, rendered: [], error: `boot failed: ${e.message}` };
  }
}

function main(argv) {
  const htmlPath = argv[2] || undefined;
  const idx = argv[3] === undefined ? 0 : Number(argv[3]);
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
