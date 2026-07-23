# Design: Out-of-Order Exercise Logging + Custom Weight & Reps Entry

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation plan

## Problem

Two limitations in the day view:

1. **Logging is strictly sequential.** `activeSet(day)` walks `day.exercises` in plan order and
   returns the first set that is still `false`. The bottom bar's LOG SET button and the in-card
   `LOG` cell both follow that single active set, so a lifter who does exercise 5 before exercise 2
   — because a machine is occupied, or because they superset — cannot record it when it happens.
   They must either log out of sequence into the wrong slot or wait.

2. **Weight entry is stepper-only, and reps aren't recorded at all.** The bottom bar exposes a
   ±2.5 lb stepper. Jumping from 45 to 185 lb takes 56 taps, and non-2.5 increments (fixed-plate
   machines, kg plates, dumbbell jumps) are unreachable. Separately, the app prescribes a rep range
   per exercise (`ex.reps`, e.g. `"12–15"`) but never stores what was actually performed, so
   "3×12 at 70 lb" and "3×15 at 70 lb" are indistinguishable in history.

## Goals

- Let the user select any exercise on the current day and log into it, in any order.
- Let the user type an exact weight instead of stepping to it.
- Record actual reps performed, per set, as first-class persisted data.
- Preserve 100% of existing logged data and keep old exports importable.
- Stay within the single-file, no-build, vanilla-JS architecture (`CLAUDE.md`).

## Non-Goals

- **Reordering sets within an exercise.** Sets stay strictly in order inside a given exercise;
  only the choice of exercise is free.
- **Rep-aware analysis.** `tools/analyze-history.js` continues to ignore `reps`. Reps flow into
  exports and sit there until a later pass teaches the analyzer to use them (volume-load, rep
  progression). Explicitly out of scope here.
- **Rep PRs.** PR detection stays weight-only.
- Surfacing reps in the Plan or Progress views beyond the day-view set rows.
- Any change to the storage key scheme or export version number.

## Chosen approach

**Approach A — mirror the existing `weights` pattern.** Reps get their own map on the day state,
keyed exactly like `weights`, and their own pending value on `view` alongside `pendW`. This was
chosen over a richer per-set record object (`{weight, reps, rir}`) because it requires **no
migration**: absent keys read as "not recorded," which is precisely the state of every set logged
before this change.

---

## Part 1 — Out-of-order exercise selection

### State

One new field on `view`:

```js
selectedExId: null   // string | null
```

It holds the **original** exercise id from `day.exercises[]` — not the resolved one — so a
selection survives swapping that exercise. It is pure UI state: never persisted to
`localStorage`, never exported.

### `activeSet(day)` gains a preferred starting point

Current behavior:

```js
function activeSet(day) {
  for (const o of day.exercises) {
    const ex = resolveExercise(day.id, o);
    const arr = state[day.id].sets[ex.id] || [];
    const i = arr.findIndex(v => v === false);
    if (i !== -1) return { ex, orig: o, i };
  }
  return null;
}
```

New behavior, in order:

1. If `view.selectedExId` names an exercise on this day whose resolved set array still has a
   `false` entry, return that exercise's first incomplete set.
2. Otherwise fall back to the existing plan-order scan, unchanged.

`activeSet()` **stays pure.** It must never clear `view.selectedExId`, because it is called during
render (`exercisesHTML`, `renderBottomBar`) — mutating view state from a render path causes
render-order-dependent bugs. Clearing happens only in the action handlers that complete a set.

Because `exercisesHTML` derives `activeI` from the single `activeSet()` call
(`const activeI = act && act.ex.id === ex.id ? act.i : -1`), the in-card `LOG` cell follows the
selection automatically with **no change to the set-row renderer**.

### Selecting

The exercise card header (`.ex-top`, or a wrapper around the name) emits:

```html
data-act="selectex" data-ex="<originalId>"
```

The swap button lives inside that header and carries its own `data-act="swap"`. The delegated
handler resolves via `closest('[data-act]')`, so the nearest ancestor wins and the swap button
keeps working — no special-casing needed, but the nesting must be preserved.

Handler:

```js
else if (act === 'selectex') {
  const id = el.dataset.ex;
  view.selectedExId = (view.selectedExId === id) ? null : id;   // toggle
  view.pendKey = '';
}
```

Clearing `view.pendKey` forces `syncPending()` to recompute the prefilled weight/reps for the
newly targeted set.

An exercise whose sets are all resolved (`done + skipped === ex.sets`) is **not** selectable —
emit no `data-act` on its header. Selecting it could not produce an active set anyway, and the
toggle would silently do nothing.

### Clearing

The selection clears in four places where `view.pendKey` already clears — day change (`day`),
week change (`wk`), program switch (`prog`), and swap (`doswap`) — plus two completion paths:

- `logActiveSet()` — after writing, if the selected exercise now has no `false` sets, clear.
  `activeSet()` returns `{ ex, orig, i }`, so `act.orig.id` is the original id to compare against
  `view.selectedExId` directly.
- `skipSet()` — same check. **This is the easy one to miss** for two reasons. First, skip is a
  separate code path from log, and skipping the selected exercise's final remaining set completes
  it just as logging does. Second, `skipSet(dayId, exId, setIdx)` receives the **resolved** exercise
  id, while `view.selectedExId` holds the **original** — so the check must map back, e.g. find the
  `day.exercises` entry whose `resolveExercise(dayId, o).id === exId` and compare that entry's `.id`.
  A naive `exId === view.selectedExId` comparison silently fails for any swapped exercise.

If neither path completes the exercise, the selection persists — the user stays on that exercise
for its next set, which is the point.

Undoing a completed set on some *other* exercise does not clear the selection; the selection still
wins. With no selection active, `activeSet()` falls back to plan order and jumps to the undone
set — existing behavior, unchanged.

### Visual

The selected card gets a `.sel` modifier: an accent left-border and a lightly tinted header, using
the existing `--accent` custom property. No new colors outside the three theme blocks.

---

## Part 2 — Reps as recorded data

### Storage

A new `reps` map on each day's state, mirroring `weights` exactly:

- `reps[exId]` — the exercise's working value (last logged)
- `reps[exId_i]` — the value for set `i`

`initState()` defaults it the way `effort` already is:

```js
reps: savedDay.reps || {},
```

No migration function is needed. Legacy state has no `reps` key and reads as "not recorded."

`saveState()` serializes the whole day object, so `reps` persists with no change there.

### Export / import

The export already writes whole day blobs, so `reps` rides along with **no version bump**.
`importData` stores day objects verbatim, so importing a pre-reps export yields days without a
`reps` key — handled by the `savedDay.reps || {}` default.

### `getExerciseHistory()`

Two changes:

```js
const rawR = (dayState.reps || {})[exId];
const reps = (rawR === '' || rawR == null) ? null : Number(rawR);
```

and the skip guard widens so a reps-only week isn't dropped:

```js
if (weight == null && reps == null && !eff) continue;
out.push({ week: w, weight, reps, effort: eff });
```

`priorWeekEntry()` needs no change — it returns whole history entries, which now carry `reps`.

### Prefill (`view.pendR`)

Computed in `syncPending()` alongside `pendW`, in this order:

1. The prior week's reps for **this same set** — `priorWeekEntry(...)` for the exercise, then that
   week's `reps[exId_i]`, falling back to its exercise-level `reps[exId]`.
2. Otherwise the **first integer parsed out of `ex.reps`**. That string is inconsistent across
   programs: `"6–10"` → 6, `"12–15"` → 12, `"10 each leg"` → 10, `"8–12 each leg"` → 8,
   `"15 + LLP"` → 15. First-integer gives the low end of a range, the per-leg count where relevant,
   and never inflates the target.
3. If neither yields a number, leave `pendR` empty rather than guessing.

Note the deliberate asymmetry with weight: `pendW` prefers the **previous set in the current
session** (`weights[exId_(i-1)]`) before falling back to stored/prior-week values, because weight
usually carries across sets within an exercise. Reps do not — they typically *drop* set to set as
fatigue accumulates, so carrying set 1's reps into set 3 would prefill a number the user is
unlikely to hit. Last week's reps for the same set index is the better anchor, which is what was
chosen.

### Writing

`logActiveSet()` gains two lines beside the existing weight writes:

```js
state[day.id].reps[ex.id] = r;
state[day.id].reps[`${ex.id}_${i}`] = r;
```

If `view.pendR` is empty/invalid, **write nothing** — leaving the keys absent keeps "not recorded"
a single unambiguous state instead of splitting it between missing and zero.

### Display

Set rows show `weight × reps` where reps were recorded (`70 × 8 ●`), falling back to the current
`70 ●` when they weren't — so all pre-existing history renders exactly as it does today.

---

## Part 3 — Inline numeric entry

### The re-render problem

A 500 ms `setInterval` calls `render()`, which rebuilds `#bottombar`'s `innerHTML` wholesale. A
focused `<input>` in that subtree would lose its caret and any partially-typed value within half a
second. Nothing in the app currently faces this: the file contains exactly **one** `<input>`, the
import file picker, which lives outside the day-view render path.

### Solution

A new `view.editing` field (`'w'`, `'r'`, or `null`). While it is non-null, `renderBottomBar()`
returns early and leaves its DOM untouched, so typing is never interrupted.

- Tapping the weight value emits `data-act="editw"`; tapping the reps value emits `data-act="editr"`.
  The handler sets `view.editing`, renders once to swap that stepper's value display for an
  `<input inputmode="decimal">` (weight) / `inputmode="numeric"` (reps), then focuses and selects it.
- Commit on `change` / Enter / blur → parse, clamp, write to `view.pendW` / `view.pendR`, clear
  `view.editing`, re-render.
- Cancel on Escape → discard, clear `view.editing`, re-render.

The ± steppers remain: the field is an addition, not a replacement.

**Accepted tradeoff:** while a field is focused, the minimized rest pill's countdown display stops
ticking for those few seconds. The timer itself is timestamp-based (`view.restEnd` vs `Date.now()`)
and is unaffected — only its display pauses, and it catches up on the first render after commit.

### Validation

- Weight: `parseFloat`, clamped to ≥ 0.
- Reps: `parseInt`, clamped to ≥ 0.
- Non-numeric or empty input **reverts to the prior value** rather than writing garbage.

### Interaction with overlays

`view.editing` freezes the bottom bar, so anything that opens an overlay — rest, tip, swap,
confirm — must clear `view.editing` first, as must day / week / program changes. Otherwise the bar
stays frozen behind the overlay showing a stale exercise.

---

## Verification

No browser required; this follows the existing headless toolchain.

1. `node --check` on the extracted script (per `CLAUDE.md`).
2. `node tools/smoke-render.js` — all 24 views per program must still render.
3. New behavior tests in `tools/` driving the delegated click handler via `withApp()`:
   - Select a later exercise → the LOG target moves to it; plan-order exercises are untouched.
   - Log it → `sets`, `weights`, and `reps` all wrote at both the exercise and per-set keys.
   - Complete the selected exercise by logging → selection cleared, active set falls back to plan order.
   - Complete it by **skipping** the last set → selection cleared (separate path from log).
   - Log with a blank reps field → no `reps` key written; the set still logs.
   - Toggle: tapping the selected card again clears the selection.
   - A fully-completed exercise's header emits no `selectex`.
4. Round-trip: export with reps → import → reps survive. Import a **pre-reps** export → no crash,
   set rows render without the `× reps` suffix.
5. Full suite: `node --test tools/*.test.js` (127 existing tests) with no regressions.

## Risks

| Risk | Mitigation |
|---|---|
| Frozen bottom bar if `view.editing` is never cleared | Clear it on every overlay open and on day/week/program change; blur handler is the backstop. |
| Selection points at a swapped-away exercise | Selection stores the **original** id and resolves through `resolveExercise()`; swap also clears it. |
| Stale prefill after selection change | `selectex` clears `view.pendKey`, forcing `syncPending()` to recompute. |
| `reps` breaking older importers | Additive key only; no version bump; absent key defaults to `{}`. |
