# Design: On-Demand Workout Plan Generator (`/newplan`)

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Problem

gAIns ships two hand-authored 8-week mesocycles (`meso1`, `meso2`). Writing a third by hand means
re-deriving volume allocation, exercise selection, and phase structure from scratch, with no
systematic use of what the previous two blocks revealed about what actually got trained.

We want a slash command that generates a new mesocycle on demand — informed by evidence-based
hypertrophy research and by the user's own logged training data — and inserts it into `index.html`
automatically.

## Decisions

| Question | Decision |
|---|---|
| What informs "improves upon" | Program definitions in `index.html` **plus** the user's exported training data |
| How the export reaches the command | Dropped into a gitignored `data/`; newest `*.json` wins |
| Web research | Cached `docs/training-evidence.md`, refreshable via `/newplan --research` |
| Insertion behavior | Append as next `mesoN`; new program auto-selected on next load; prior programs and their history untouched |
| Review gate | Command prints an approval brief and waits for a yes before writing |
| Missing inputs | Three multiple-choice questions at run time: days available, shoulder/joint status, emphasis |
| Architecture | Slash command orchestrating deterministic Node helpers |

Rejected alternatives: a pure-prompt command (re-derives analysis by eyeball each run, hand-edits a
2,465-line file); an in-app JS generator (can only apply rules hard-coded today, discards the
research angle, bloats the single-file design).

## Components

```
.claude/commands/newplan.md      # orchestrator prompt (the only Claude-driven piece)
docs/training-evidence.md        # researched constraints with citations
tools/muscle-map.json            # legacy exercise id → muscle groups with fractional credit
tools/analyze-history.js         # export + PROGRAMS → markdown analysis report
tools/insert-program.js          # program JSON → spliced into index.html, gated
tools/smoke-render.js            # headless render of the app under a document shim
data/                            # user exports (gitignored)
```

Each helper is independently runnable and has no hidden dependencies on the others.

### `tools/muscle-map.json`

Flat map covering every exercise id in `meso1` and `meso2`:

```json
{ "chest_supported_row": { "lats": 1.0, "upper_back": 1.0, "biceps": 0.5 } }
```

Fractional credit for secondary movers prevents inflated per-muscle volume. The map only needs to
cover legacy ids — generated programs carry a `muscles` field inline, so it does not grow with each
new block.

### `tools/analyze-history.js`

`node tools/analyze-history.js [export.json] > analysis.md`

Pure function of (export JSON, `index.html`, muscle map) → markdown. No network, no writes.

Input shape (export `version: 3`):

```
{ version: 3, currentProgram: <idx>,
  programs: { <progId>: { currentWeek: <n>,
    weeks: { <n>: { <dayId>: { sets:    { <exId>: [true|'skipped'|false, ...] },
                               weights: { <exId>: <number|null> },
                               effort:  { <exId>: 'low'|'medium'|'high'|'' },
                               protocol:[...], swaps: { <origExId>: <newExId> } } } } } } }
```

Versions 1 and 2 are also accepted; their layouts are documented by the migration code in
`index.html` (`hypertrophy_migrated_v3`).

Report sections:

1. **Adherence** — per program and week: sets completed vs. skipped, days finished, weeks with any
   data. Programs with no data are flagged and excluded from inference.
2. **Per exercise** — sets completed, skip rate, weeks touched, first→last weight and percent
   change, per-week slope, effort distribution, swap-away target if any.
3. **Per muscle, per week** — sets credited through the muscle map with swaps resolved, averaged
   over weeks actually trained.
4. **Flags**:
   - *Rejected* — skip rate above 40%, or consistently swapped away.
   - *Stalled* — flat weight across 4+ weeks at `high` effort.
   - *Under-stimulating* — consistent `low` effort with no load increase.
   - *Volume gaps* — muscles below or above the evidence-doc landmarks.

### `docs/training-evidence.md`

Researched once, cited every run. Each claim carries a source link. Topics:

- Weekly set landmarks per muscle group (MEV / MAV / MRV)
- Training frequency per muscle per week
- Proximity to failure by exercise type (compound vs. isolation)
- Lengthened-position / stretch-biased exercise selection
- Rep-range effects on hypertrophy
- Progressive-overload models across a block
- Deload timing and structure
- Exercise rotation vs. retention between blocks

`/newplan --research` re-runs the web sweep and rewrites this file.

### `.claude/commands/newplan.md`

Flow:

1. Locate newest `data/*.json`. If absent, stop with export instructions (opt-in override to
   proceed without data).
2. Run `analyze-history.js`.
3. Ask three multiple-choice questions: days/week available, shoulder and joint status, emphasis
   (balanced / bring up a lagging area / strength-leaning).
4. Read `docs/training-evidence.md` and the analysis.
5. Design the block; write `newplan.json`.
6. Print the approval brief; wait for approval.
7. Run `insert-program.js`; report what changed, leave it uncommitted, offer to commit.

Generation rules:

- **Carry forward** exercises with good adherence and a positive weight slope.
- **Replace** everything in the rejected and stalled lists, choosing substitutes by the evidence
  doc's selection criteria and the reported shoulder status.
- **Allocate volume** per muscle inside the evidence landmarks, biased by the emphasis answer;
  ramp from near-MEV in week 1 to MAV by the overreach week rather than a flat weekly number.
- **Block length** defaults to 8 weeks; if adherence historically collapses after week 5–6,
  generate 6 weeks instead. `totalWeeks` is already per-program.
- **Preserve shoulder-cautious constraints** (`protocolItems`, neutral grips, no behind-the-neck)
  unless the shoulder answer says otherwise.
- Every generated exercise carries the existing field set (`id`, `name`, `sets`, `reps`, `rpe`,
  `note`, `llp`, `compound`, `rest`, `restLabel`) plus `muscles`. The command also generates 2–3
  `EXERCISE_ALTERNATIVES` entries per exercise and a matching `mesocycle[]` / `weekPhases[]` pair.

Approval brief contents: per-muscle weekly-sets table with the new block beside meso1/meso2
actuals; day-by-day exercise list; a "changed vs. last block, and why" section where each line
cites a specific analyzer flag or evidence-doc rule.

### App change: `autoSelectNewProgram()`

`hypertrophy_program` stores an *index*, so appending a program leaves the user on the old one. Add
a short function to `index.html`, called during init: maintain a `hypertrophy_seen_programs` list of
ids; if any program id is not in the list, switch to it and record all current ids. First load after
generation lands on the new block; subsequent manual chip selection sticks. Written once in app
code, so the inserter only ever touches data.

### `tools/insert-program.js`

`node tools/insert-program.js newplan.json`

Finds the next free `mesoN` id, builds the modified file in memory — program literal spliced before
the `];` that closes `PROGRAMS`, `EXERCISE_ALTERNATIVES` entries merged — then runs four gates
before writing:

1. **Schema validation** — required fields present, `weekPhases.length === totalWeeks`, `rest`
   numeric, `muscles` non-empty, `days` non-empty.
2. **Global id uniqueness** — `EXERCISE_ALTERNATIVES` is keyed by bare exercise id, so ids must be
   unique across all programs. Generated ids take an `m<N>_` prefix and are checked against every
   existing id.
3. **`node --check`** on the extracted script block.
4. **`tools/smoke-render.js`** — evals the script under the minimal `document`/`localStorage` shim
   described in `CLAUDE.md`, switches to the new program, and renders every day plus the plan and
   progress views.

`index.html` is overwritten only if all four pass. On failure the file is untouched and the specific
error is reported.

## Failure modes

| Condition | Behavior |
|---|---|
| No `data/*.json` | Stop with export instructions; explicit opt-in to proceed without data |
| Export present, no logged history | Warn which programs were empty; ask whether to proceed on evidence + answers alone |
| Export is v1 or v2 shape | Analyzer handles both legacy layouts |
| Generated JSON fails a gate | `index.html` untouched; report the failure; retry generation once, then give up |
| Command run twice | Appends `meso4`, `meso5`, …; prior programs and history intact |

## Constraints preserved

- Single-file app: no new runtime files. All helpers are dev tools, never loaded by the browser.
- No build step; helpers are plain Node scripts with no dependencies.
- Existing compatibility shims and migration functions are untouched.
- `data/` is gitignored — training logs stay out of the repo.

## Out of scope

- Editing or deleting existing programs.
- Pruning the program chip row as blocks accumulate (manual for now).
- Any in-app UI for generation.
