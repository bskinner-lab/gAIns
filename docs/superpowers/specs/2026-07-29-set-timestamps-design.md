# Set Timestamps — Design

**Date:** 2026-07-29
**Backlog item:** TODO.md Tier 0 #1

## Problem

Nothing in the persisted model knows when anything happened.

`state` is keyed `program → week → day → {sets, weights, reps, effort, protocol,
swaps}`, with no timestamp anywhere. `advanceToCurrentWeek()` bumps the week when
the previous one is fully complete, so "Week 5" is an ordinal counter with no
connection to the calendar. The export (`version: 3`) carries no dates either —
the only date in the whole system is the export filename.

Questions that cannot currently be answered:

- When did I last train legs?
- What is my actual training frequency?
- Was this mesocycle run over 8 weeks or dragged across 5 months?
- How long did a session take, and how much rest did I actually take?
- What does progress look like plotted against real dates?

**Why this is Tier 0:** it is the only backlog item that is retroactively
unrecoverable. Everything else can be built six months from now against data that
still exists. Every session logged without a date loses its date permanently.

Existing undated history at time of writing: **two complete 8-week mesocycles,
~1,568 logged sets** (`meso1` 782/816, `meso2` 786/828).

## Goals

All four confirmed in design discussion:

1. When did I last train X — day-level dates and real training frequency
2. Real elapsed mesocycle time — 8 weeks vs. 5 months
3. Session duration and pacing — requires per-set granularity
4. Charts over calendar time instead of ordinal week numbers

Goal 3 is what forces per-set rather than per-day timestamps.

## Non-goals

- Event sourcing / full undo history (see Approach C below — rejected)
- Time-of-day precision for backfilled historical data
- Any change to the rest-timer clock logic
- Consuming the new data in the UI — this spec lands the data model only.
  Charts and stats are TODO.md items 5 and 6.

## Data shape

One new map per day, alongside `weights` and `reps`:

```js
state[dayId].times = {
  "db-press_0": { at: 1785340666000, src: "log" },
  "db-press_1": { at: 1785340812000, src: "bulk" },
}
```

- Key: `${exId}_${setIdx}` — same convention as `weights` and `reps`
- `at`: epoch milliseconds
- `src`: provenance, one of four values

### Provenance values

| `src`  | Written by                              | Means                                                   |
| ------ | --------------------------------------- | ------------------------------------------------------- |
| `log`  | `logActiveSet`, `toggleSet`             | Set logged individually. Real and precise.              |
| `skip` | `skipSet`                               | One set deliberately skipped. Real moment, no performance. |
| `bulk` | `completeDay`, `skipDay`, `skipExercise` | Many sets resolved in one tap. Real day, meaningless minute. |
| `est`  | Backfill only                           | Derived from a start date. Never measured.              |

Provenance is the core of the design. `completeDay()`, `skipDay()`, and
`skipExercise()` resolve many sets in a single tap; without a flag, twenty sets
land in the same millisecond and any naive pacing analysis reads that as a
twenty-set workout completed instantly.

With the flag, each consumer picks its own honesty bar:

- Session duration / pacing reads **only** `log`
- "When did I last train X" reads `log`, `skip`, `bulk`
- Calendar charts read all four, rendering `est` distinctly

Nothing downstream gets silently corrupted.

**Why `est` overloads `src` instead of being a separate boolean:** for backfilled
data we genuinely do not know whether a set was logged, skipped, or
bulk-resolved. `est` is the complete truth about those entries. A second field
would invite fabricating a distinction we do not have.

## Chosen approach

**Parallel `times` map** (Approach A). Purely additive — no existing field
changes shape, so `isResolved`, `completedSets`, `skippedSetsCount`,
`isDayComplete`, `getStartDay`, `activeSet`, `hasPendingSet`, and `openSetIndex`
are all untouched.

### Rejected alternatives

**B. Upgrade `sets` entries from scalars to objects**
(`sets[exId][i] = {done, at, src}`). Conceptually cleanest — the timestamp lives
on the thing it describes. Rejected because those scalars are compared
identity-wise (`=== true`, `=== 'skipped'`, `=== false`) across nine functions,
all four migration paths, and export/import. Dozens of comparisons to find and
convert, with 1,568 sets of irreplaceable data as the regression surface. Large
risk for an ergonomic gain.

**C. Append-only event log** (`state[dayId].events = [...]`). Richest option:
undo becomes an event, real pacing analysis falls out. Rejected because
`sets[]` and `events[]` become two sources of truth requiring reconciliation —
a state-model rewrite wearing a timestamp feature's clothes. Approach A's data
is a clean input if C is ever wanted later; nothing here has to be undone.

## Write points

Complete map of code that resolves a set.

### Writes a timestamp

| Function         | Location  | `src`  |
| ---------------- | --------- | ------ |
| `logActiveSet`   | JS ~2859  | `log`  |
| `toggleSet`      | JS ~2105  | `log`  |
| `skipSet`        | JS ~2208  | `skip` |
| `skipExercise`   | JS ~2225  | `bulk` |
| `skipDay`        | JS ~2245  | `bulk` |
| `completeDay`    | JS ~2265  | `bulk` |

### Deletes a timestamp

A set that was un-done was not performed. A stale timestamp is worse than none.

- `undoSet` (JS ~2853)
- The toggle-off branch in `toggleSet` (`wasDone` early return)
- The un-skip branches in `skipSet`, `skipExercise`, `skipDay`
- `resetWeek` — clears the whole week's `times` map alongside `weights` and
  `effort`. Omitting it leaves a `src: "log"` orphan that backfill can never
  repair, since backfill only ever overwrites `est` entries.

### Must NOT write timestamps

`prefillFromPreviousWeeks()` (JS ~1938) carries prior weeks' values into a fresh
week. A timestamp riding along would manufacture a date for a set that was never
performed. Requires explicit exclusion and a test pinning it.

## Clock seam

Timestamps route through a single `nowMs()` helper the test shim can stub.

Used **only** by this feature. The rest timer's existing `Date.now()` calls stay
untouched — that logic works, is sensitive to backgrounding, and is out of scope.

## Export: a v3-labelled superset

The export format gains `times` and per-program `startDate`, but the version
integer **stays at 3**. The new format is a structural superset of v3 — both
additions are extra keys older builds never read — and the v3 import branch
writes each week's day state to `localStorage` verbatim, so `times` rides along
for free.

```js
{
  version: 3,
  programs: {
    meso1: { weeks: {...}, currentWeek: 8, startDate: "2026-03-02" }
  },
  currentProgram: 1
}
```

Changes:

- `exportData` includes each day's `times` and per-program `startDate` when set,
  keeping `version: 3`
- `importData` branch becomes
  `if ((data.version === 4 || data.version === 3) && data.programs)`,
  plus reading optional `progData.startDate`. Nothing emits 4; accepting it is
  defensive cover for files written by an interim build.
- `migrateDayState` gains `times: savedDay.times || {}`, matching how `reps` is
  already handled
- v2 and legacy (v1) import branches are not touched

### Compatibility

The **version integer is the import gate**, not the day-state shape. A file
labelled 4 misses `=== 3`, misses `=== 2`, misses the legacy
`data.state && data.currentWeek` branch, and falls through to
`alert('Invalid backup file.')` — zero data imported. Keeping the label at 3 is
precisely what preserves both directions:

- A pre-`times` v3 backup imports into this build cleanly, with `times` empty
- A backup from this build imports into the **currently shipped build** as well:
  the label matches its `=== 3` branch, and `times`/`startDate` are extra keys
  it ignores. No one-way door.

This matters because export/import is the only backup path off the phone
holding the real training log.

## Backfill

**Explicit user action, never automatic.** Migration alone never invents a date;
`times` starts empty and stays empty. An import silently fabricating 1,568 dates
is exactly the failure mode the flagged-estimate decision exists to prevent.

- Settings gains a per-program "training started on ___" date field
- `startDate` is stored as an ISO date string (`"2026-03-02"`), no time component
- Only submitting that field generates `est` entries
- Derivation: `date = startDate + (week − 1) × 7 days + dayIndex`, where
  `dayIndex` is the position of the day in the program's `DAYS` array (0-based),
  **not** a weekday number
- Every set in a day gets that day's date with `src: "est"`
- `at` for an `est` entry is **local midnight** of the derived date. Day-level
  precision only — the estimate never pretends to a time of day, and consumers
  must not read minute-level meaning from an `est` timestamp
- Assumes a program has at most 7 days, so a week's `dayIndex` offsets stay
  within that week. Both current programs have 5. A program with more than 7
  days would overlap into the next week's dates; out of scope, but the backfill
  routine should refuse rather than silently produce wrong dates

### Idempotency and the safety property

Backfill only ever writes or overwrites entries with `src: "est"`. It never
touches `log`, `skip`, or `bulk`.

Consequences: a start date can be revised freely, any number of times, with zero
risk to real recorded data — and backfill cannot corrupt anything even if run by
accident.

## Testing

New file `tools/timestamps.test.js`, modeled on `tools/reps.test.js` — same
`node:test` + `withApp`/`loadApp` shim and click-synthesis helper.

Baseline before this work: **179 tests passing.**

Run with `node --test tools/*.test.js`. The directory form (`node --test tools/`)
fails on the installed Node version; use the glob.

### Coverage

*Shape and round trip*

1. Fresh install gives every day a `times` map
2. State saved without a `times` key loads without error (v3 back-compat)
3. Timestamps survive a save/load round trip

*Write points — one per `src` value*

4. `logActiveSet` writes `src: "log"` with the stubbed clock's value
5. `toggleSet` writes `src: "log"`
6. `skipSet` writes `src: "skip"`
7. `completeDay` / `skipDay` / `skipExercise` write `src: "bulk"`

*Deletion*

8. `undoSet` removes the entry entirely
9. Each toggle-off branch removes the entry

*Properties most likely to rot silently*

10. `prefillFromPreviousWeeks` copies weights and reps forward but **not** `times`
11. Backfill re-run overwrites `est` and leaves `log`/`skip`/`bulk` untouched
11b. Backfill refuses a program with more than 7 days rather than producing
    overlapping dates

*Export/import*

12. Export emits `version: 3` carrying `times` and `startDate`
13. A pre-`times` v3 backup imports cleanly, `times` empty, zero fabricated dates
14. A v3 backup carrying `times` round-trips through export → import intact

Tests 10 and 11 are the highest-value cases. Both encode "do not fabricate or
destroy real training data," both would fail silently and invisibly, and both
would corrupt history that cannot be recovered.

## Risks

| Risk                                            | Mitigation                                        |
| ----------------------------------------------- | ------------------------------------------------- |
| Prefill fabricates dates for unperformed sets   | Explicit exclusion + test 10                      |
| Backfill destroys real timestamps               | `est`-only write rule + test 11                   |
| Stale timestamps survive an undo                | Delete on every un-resolve path + tests 8, 9      |
| Bulk taps corrupt pacing stats                  | `src: "bulk"` provenance flag                     |
| Import silently invents history                 | Backfill is a separate, explicit user action      |
| Existing 1,568 sets damaged during migration    | Purely additive shape; no existing field changes  |

## Out of scope

Consuming this data — calendar charts, frequency stats, session duration
readouts, "last trained N days ago" — is deliberately deferred. This spec lands
the data model and stops the ongoing data loss. TODO.md items 5 and 6 build on
it.

## Related

- Corrects TODO.md item 4: per-set weights already partially exist. Both
  `toggleSet` and `logActiveSet` write `weights[exId_i]` alongside
  `weights[exId]`; only `saveWeight()` (the text input path) writes
  exercise-level only. That item is smaller than originally written up.
