---
description: Generate a new hypertrophy mesocycle from your logged training data and insert it into the app
---

# /newplan

Generate the next mesocycle for gAIns, improving on the previous block(s) using
the user's own logged data, and insert it into `index.html` — but only through
`tools/insert-program.js`. You never hand-edit `index.html` in this command.

## Refresh mode

If `$ARGUMENTS` contains `--research`: re-run the web research described in
`docs/training-evidence.md` → "Sources", rewrite that file and
`tools/volume-landmarks.json` together (they must stay in sync — see the note
at the top of the "Volume landmarks" section), then run
`node --test tools/evidence-sync.test.js` to confirm the doc and the JSON still
agree. Report what changed and stop. Do not generate a program in this mode.

## Step 1 — Find the export

```bash
ls -t data/*.json 2>/dev/null | head -5
```

If there are no files, stop and tell the user:

> No export found. In the app: **Settings → Export**, then move the downloaded
> `gains-backup-*.json` into `data/` and run `/newplan` again.

Do not fall back to generating without data unless the user explicitly asks.

## Step 2 — Analyze

```bash
node tools/analyze-history.js
```

This prints a markdown report — read all of it, it's the evidence base for
everything you design below. If every program shows "No logged data", tell
the user which programs were empty and ask whether to proceed on the evidence
doc and the three run-time answers alone before continuing.

Two things about the report shape that matter for what you do with it:

- **The volume table's heading names the week count the average covers**
  (`avg over N weeks with completed sets`) — a week the user only opened
  without logging a completed set is excluded, so don't discount the average
  as if it were diluted by idle weeks; it already isn't.
- **`skipRate` in the per-exercise table counts only attempted sets**
  (completed + skipped), not raw slots — a set the user hasn't gotten to yet
  this week doesn't count against the exercise.

## Step 3 — Read the rulebook

Read `docs/training-evidence.md` in full. It governs volume landmarks,
frequency, proximity to failure, lengthened-position bias, rep ranges,
progression, deloads, exercise rotation, and the shoulder-cautious
constraints. Every generation rule below traces back to a section in that
document — if you're improvising past what it says, say so in the brief
instead of presenting it as settled.

**Where the document itself records disagreement between sources** (e.g. the
Israetel volume-first progression argument vs. the published rebuttal it
drew, or the Werkhausen partial-ROM result sitting slightly apart from the
other lengthened-position studies), do not silently pick a side. Choose a
position within the range the document supports, and say which you chose and
why in the "Changed vs. last block" section of the brief.

## Step 4 — Ask three questions

Use a single `AskUserQuestion` call with exactly these three, and no others:

1. **Days/week** — how many training days this block? (3 / 4 / 5)
2. **Shoulder status** — current shoulder and joint state? (Fine, relax the
   cautions / Manageable, keep the cautions / Flaring, minimize overhead and
   pressing)
3. **Emphasis** — (Balanced / Bring up a lagging area — name it / Strength-leaning,
   heavier compounds and lower reps)

Only answer 1 to question 2 ("Fine, relax the cautions") relaxes the
shoulder-cautious constraints in Step 5 below — and only if the user's actual
words go further than the button label and explicitly state both that there
is no current shoulder pain or impingement history *and* that they want the
restricted movements back. A generic "feels fine" with no explicit request
does not relax anything. If in doubt, keep the constraints and note in the
brief that you kept them conservatively.

## Step 5 — Design the block

Apply, in this order:

1. **Carry forward** exercises with good adherence (low skip rate) and a
   positive weight slope. These are working; don't change them just to
   change them.
2. **Handle the analyzer's flag buckets — they are not interchangeable:**
   - **Rejected** (skipped > 40% of attempted sets): drop the exercise. The
     muscle group got no real work from it; pick a genuinely different
     exercise for that slot.
   - **Substituted** (the user swapped away from it in more than half the
     weeks they touched it): this is **not** a signal to cut the muscle
     group. It means the user has reliably been training it via their own
     substitute the whole time. Promote that substitute into the slot as the
     new primary exercise — do not drop the volume, and do not read this
     bucket as a rejection.
   - **Stalled** (no load progress across ≥4 weeks at high effort): change
     the stimulus — different exercise, rep range, or angle — rather than
     just adding more sets of the same movement.
   - **Under-stimulating** (majority-low effort with no load progress):
     usually a loading or rep-range problem, not an exercise problem —
     tighten RPE targets or adjust load before swapping the movement out.
3. **Allocate volume per muscle** using the report's volume table against
   `docs/training-evidence.md`'s landmarks (MEV/MAV/MRV), biased by the
   emphasis answer. Check every muscle against **both** ends — cutting below
   MEV is the obvious failure, but quietly pushing a muscle past MRV is the
   one that actually risks injury or overtraining, so don't only scan for
   under-training:
   - A muscle reported **below MEV** or flagged in "Volume gaps — under-trained"
     needs real work started, not a token set.
   - A muscle **above MRV** gets its volume brought down into range this
     block, regardless of emphasis — MRV is a ceiling, not a target.
   - For everything else, **ramp within the block using both of the app's
     two existing mechanisms together** — they are not alternatives:
     1. Each exercise's baseline `sets` field is the week-1 (Foundation,
        near-MEV) load.
     2. The ramp toward MAV across the block is then expressed as concrete,
        named set-count deltas in the relevant phase's `mesocycle[].points`
        entries — this is how `meso1`/`meso2` already do it in `index.html`
        (e.g. Overload: `'+1 set to: lateral delts, rear delts, biceps'`;
        High Stimulus: `'+1 drop set per workout (laterals or curls)'`,
        `'Volume near MRV'`; Overreach: `'+1 set to weak points'`; Deload:
        `'Volume ↓ 50–60%'`). Write your points the same way: name the
        specific muscle(s) or exercises getting the delta, not "add volume."
     3. **The math must check out**: baseline `sets` plus the accumulated
        `points` deltas at the Overreach/High-Stimulus phase should land the
        muscle near MAV-high and must never exceed MRV once you add up what
        the points actually prescribe.
     4. RPE/effort targets per phase (already required by `weekPhases`) are
        the complementary lever — rising RPE across phases is expected
        alongside the points-driven set deltas, not instead of them.

     **Worked example — side delts** (landmarks: MEV 8, MAV 16–24, MRV 26).
     Suppose the block trains them on three days, with baseline `sets` of
     4 + 3 + 3 = **10 weekly sets in week 1** — just above MEV, correct for
     Foundation. Then:

     | Phase | Points entry | Delta | Running weekly sets |
     |---|---|---|---|
     | Foundation (wk 1–2) | — | — | 10 |
     | Overload (wk 3–4) | `'+2 sets to: lateral delts'` | +2 | 12 |
     | High Stimulus (wk 5–6) | `'+2 sets to: lateral delts, rear delts'` | +2 | 14 |
     | Overreach (wk 7) | `'+2 sets to weak points (lateral delts)'` | +2 | 16 |
     | Deload (wk 8) | `'Volume ↓ 50–60%'` | −50% | ~8 |

     Peak is 16 — inside MAV (16–24), clear of MRV (26). That is the
     arithmetic you must be able to show for **every** muscle in the brief:
     week-1 baseline, each delta that names it, and the peak-week total
     checked against that muscle's MAV and MRV. If a muscle's peak lands
     above MRV, cut deltas until it doesn't. If it never reaches MAV-low, the
     block under-delivers and the deltas are too timid.
   - Emphasis: "bring up a lagging area" pushes that muscle's target toward
     MAV-high (via a larger points-driven delta, never past MRV);
     "strength-leaning" shifts rep ranges down and RPE targets slightly lower
     (more reps in reserve on compounds) without necessarily changing set
     counts; "balanced" just follows the landmarks.
4. **Set block length**: 8 weeks by default. Use 6 weeks only if the
   adherence table shows completion collapsing after week 5–6 in the
   analyzed data — cite the specific week and completion number in the brief
   if you do this.
5. **Preserve the shoulder-cautious constraints** from
   `docs/training-evidence.md` unless Step 4's shoulder answer explicitly
   relaxed them (see the standard above — don't relax on a vague "feeling
   fine"). This means: no behind-the-neck presses/pulldowns, neutral/semi-pronated
   grip by default on pressing, the prehab protocol (band pull-aparts, face
   pulls, external rotations) on every push/pull/upper day regardless of
   emphasis, direct rear/side-delt and rotator-cuff work kept off 0 RIR, and
   close/neutral-grip triceps work preferred over wide-grip barbell variants.
   These hold through Overreach/high-fatigue weeks too — deload cuts volume
   and effort, never the prehab protocol or a banned movement pattern.

### Writing the JSON

Write the result to `newplan.json` (gitignored) in exactly the shape
`tools/insert-program.js`'s `validateProgram` checks — use
`tools/fixtures/program-valid.json` as a complete, minimal working example of
the shape, not just a reference to skim.

Concretely, `validateProgram` will reject the file if:

- Any of `name, subtitle, totalWeeks, days, protocolItems, mesocycle,
  weekPhases` is missing.
- `totalWeeks` isn't a positive integer, or `weekPhases.length !== totalWeeks`.
- Any `weekPhases` entry is missing `label, rpe, llp, color`.
- Any `mesocycle` entry is missing `weeks, label, rpe, rir, color, points`.
- Any day is missing `id, label, title, subtitle, exercises`, has a duplicate
  `id` within the program, or has zero exercises.
- Any exercise is missing `id, name, sets, reps, rpe, note, llp, compound,
  rest, restLabel, muscles` — `llp`/`compound` must be real booleans, `sets`
  a positive number, `rest` a number.
- `muscles` is empty, or references a muscle key not in
  `tools/volume-landmarks.json`, or a credit that isn't a number in `(0, 1]`.
- Any id (exercise or alternative) is empty, non-string, duplicated within
  the new program, or already used elsewhere in `index.html` — this command
  does not check that for you ahead of time; `insert-program.js` does, at
  Gate 1.
- **`alternatives` is missing or every entry is empty** — every generated
  program must define at least one exercise alternative. In practice, give
  each exercise **2–3 alternatives**, not just the one required to pass
  validation — it's good program design (the analyzer's *substituted* bucket
  above exists precisely because users swap), and the app's swap button reads
  straight from this data.

  **`alternatives` is a single top-level object keyed by the original exercise
  id — not a field on each exercise.** This is the easiest mistake to make
  here, and the error you get if you make it (`program must define at least
  one exercise alternative`) points at the wrong problem: it will read as
  "add more alternatives" when the real fix is "move them to the top level."
  The shape is:

  ```json
  "alternatives": {
    "m3_rope_pushdown": [
      { "id": "m3_alt_vbar_pushdown", "name": "V-Bar Pushdown", "note": "Straighter wrist path" },
      { "id": "m3_alt_skulls", "name": "Skull Crushers (EZ Bar)", "note": "More long-head stretch" }
    ]
  }
  ```

  Every key must name an exercise that actually exists in the program.

Do **not** include a top-level `id` field — `insert-program.js` assigns the
next free `mesoN`. Prefix every new exercise id (and every alternative id)
with `m<N>_` where `<N>` is that next program number. Determine `N`
deterministically: the analyzer's report lists the program ids that already
exist (its `progId` values are the same `mesoN` keys `insert-program.js`
works with), and the inserter always assigns the next integer after the
highest one present — so `N` is just one past the highest existing `mesoN`.
Treat Gate 1's "id already exists" error as a backstop that catches a
miscount, not the primary way to discover `N`.

## Step 6 — Present the brief and wait

Print, in this order:

1. **Per-muscle weekly sets** — a table with the new block's week-1 and
   peak-week (Overload/High Stimulus) target sets, next to the analyzed
   actual from Step 2's volume table, for every muscle you changed. Check
   every row against **both** landmark ends before printing it: below MEV is
   the failure that's easy to spot, but a peak-week number that clears MRV is
   the one that puts a real person at risk of injury or overtraining, so
   verify the peak-week figure (baseline + accumulated `points` deltas)
   against MRV explicitly, not just against MEV/MAV.
2. **Day-by-day exercise list** — name, sets, reps, RPE, for every day.
3. **Changed vs. last block, and why** — one line per change. Every line
   must cite either a specific analyzer flag (rejected / substituted /
   stalled / under-stimulating / below-MEV / above-MRV, with the exercise or
   muscle name) or a named rule from `docs/training-evidence.md` (e.g.
   "frequency ≥2×/week per muscle" or "shoulder-cautious: neutral grip
   default"). A line that just asserts "this is better" without a citation
   is not acceptable here — rewrite it or cut it.

Then ask whether to insert. **Do not run Step 7 before the user approves.**

## Step 7 — Insert

```bash
node tools/insert-program.js newplan.json
```

This runs four gates and writes nothing to `index.html` unless all four
pass: splice-anchor uniqueness, schema + id validation (`validateProgram`),
`node --check` on the resulting script, and a full smoke render of the new
program's days/plan/progress/settings views. On failure, report the specific
gate and error the script printed, fix `newplan.json`, and retry once. If it
fails again, stop and show the user the error — do not edit `index.html` by
hand to work around it.

On success, report the assigned program id and tell the user:

- The change is uncommitted — review it with `git diff index.html`.
- The new program will be auto-selected next time the app loads.

Offer to commit. Do not commit without being asked.
