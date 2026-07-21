# Training Evidence

Rulebook for `/newplan`. Every claim here is applied by the generator; if you
disagree with a plan, this is the file to argue with.

**Last researched:** 2026-07-21

## Volume landmarks

Weekly hard sets per muscle. Mirrored machine-readably in
`tools/volume-landmarks.json` — the two are kept in sync by
`tools/evidence-sync.test.js`, so edit both together.

The literature gives a robust dose-response curve for hypertrophy as a
function of total weekly volume, and a well-supported floor for "large,
directly-trained" muscle groups, but it does **not** contain muscle-by-muscle
RCTs for all 16 muscles this app tracks — no meta-analysis has isolated, say,
rear-delt-specific MRV. The numbers below extrapolate the general
dose-response finding to each muscle, adjusted for two things the evidence
does support: (1) large prime-mover muscle groups need ≥10 sets/week to
maximize growth, and (2) small, frequently-recruited muscles (rear/side delts,
traps, forearms, abs) tolerate disproportionately more volume per week because
each set costs less systemic fatigue and they receive constant indirect
exposure from compound work.

An umbrella review of 137 systematic reviews found that, per Schoenfeld et al.
(2017), "at least 10 weekly sets per muscle group is necessary to maximize
increases in muscle mass," with a graded dose-response below that
([Grgic & Ruzic, umbrella review, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9302196/)).
That floor is the anchor for every "large muscle" `mavLow` value below
(chest, lats, upper_back, quads, hamstrings, glutes all sit at or above it).

| Muscle | MEV | MAV | MRV | Notes |
|---|---|---|---|---|
| `chest` | 8 | 12–20 | 22 | Large, directly-trained; anchored to the ≥10-set/week floor. |
| `front_delt` | 0 | 6–12 | 16 | Heavy indirect stimulus from all pressing (0.5 credit on incline/machine/close-grip press in `muscle-map.json`), so direct MEV is 0. |
| `side_delt` | 8 | 16–24 | 26 | Small isolated muscle, low per-set fatigue cost; commonly cited with the highest MRV of the delt heads. |
| `rear_delt` | 6 | 10–18 | 24 | Same low-fatigue-cost logic as side delt; gets partial credit from rows too. |
| `lats` | 10 | 14–20 | 25 | Large, directly-trained; anchored to the ≥10-set/week floor. |
| `upper_back` | 8 | 12–20 | 25 | Large, directly-trained; anchored to the ≥10-set/week floor. |
| `traps` | 0 | 6–14 | 20 | Heavy indirect stimulus from pulls/deadlifts/shrugging pattern in rows. |
| `biceps` | 8 | 12–18 | 20 | Small muscle, high recoverability, but tendon/elbow fatigue caps MRV below delts. |
| `triceps` | 6 | 10–16 | 18 | Gets indirect credit from all pressing, so direct MEV is lower than biceps. |
| `forearms` | 0 | 4–10 | 15 | Almost entirely indirect (grip) stimulus; rarely a growth bottleneck. |
| `quads` | 8 | 12–18 | 20 | Large, directly-trained; anchored to the ≥10-set/week floor. |
| `hamstrings` | 6 | 10–16 | 20 | Large, directly-trained; anchored to the ≥10-set/week floor. |
| `glutes` | 6 | 10–18 | 22 | Raised from earlier placeholder values: glutes are a prime hip-extensor mover in squat/RDL/leg press/lunge/pull-through work and belong in the same "large muscle, ≥10-set floor" bucket as quads and hamstrings, not below it. |
| `calves` | 8 | 12–18 | 20 | Trains well at high frequency but per-set fatigue is nontrivial (ankle/Achilles loading). |
| `abs` | 4 | 8–16 | 24 | MRV raised from the earlier placeholder: abs recover unusually fast and are commonly trained near-daily in applied practice without volume-tolerance breakdown; no dedicated meta-analysis isolates abs MRV, so this is a practice-consensus extrapolation rather than a cited number. |
| `spinal_erectors` | 0 | 4–10 | 12 | Deliberately conservative MRV — heavy axial/spinal loading has the highest per-set injury and fatigue cost of any muscle group, so this app keeps direct erector volume low regardless of recoverability arguments. |

## Frequency

Schoenfeld, Ogborn & Krieger's meta-analysis of 10 studies found training a
muscle twice per week produced significantly greater hypertrophy than once
per week (ES 0.49 ± 0.08 vs 0.30 ± 0.07, *p* = 0.002), and recommended "major
muscle groups should be trained at least twice a week to maximize muscle
growth"
([Schoenfeld, Ogborn & Krieger, *Sports Medicine*, 2016](https://pubmed.ncbi.nlm.nih.gov/27102172/)).
Once weekly volume is equated, however, a later synthesis found "resistance
training frequency does not significantly or meaningfully impact muscle
hypertrophy"
([Schoenfeld et al. 2019, cited in Grgic & Ruzic umbrella review, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9302196/)).
**Bottom line applied here:** frequency is a container for volume, not an
independent lever — hit ≥2×/week per muscle so weekly sets can be spread
across sessions without any single session becoming excessive, but don't
chase a 3rd or 4th weekly hit on a muscle that is already getting its volume
in 2 sessions.

## Proximity to failure

Refalo et al.'s systematic review and meta-analysis found momentary failure
training was **not** significantly superior to non-failure training for
hypertrophy (ES 0.12, 95% CI −0.13–0.37, *p* = 0.343); across all definitions
of "training to failure" the pooled advantage was trivial (ES 0.19, 95% CI
0.00–0.37, *p* = 0.045)
([Refalo et al., *Sports Medicine*, 2022](https://pmc.ncbi.nlm.nih.gov/pmc/articles/PMC9935748/)).
A more recent 8-week trial in resistance-trained individuals likewise found
"similar muscle hypertrophy" comparing training to momentary failure against
training with a fixed reps-in-reserve target
([Refalo, Helms et al., *Journal of Sports Sciences*, 2024](https://www.tandfonline.com/doi/full/10.1080/02640414.2024.2321021)).
**Applied here:** most working sets sit at 1–3 RIR; compound barbell/machine
lifts stay off 0 RIR (technique breakdown risk on the last reps, and higher
systemic fatigue for a trivial hypertrophy edge), while isolation
work can occasionally push to 0 RIR / true failure late in a session where
the failure point is a simple pin or stop rather than a loss of bar control.

## Lengthened-position bias

A within-participant RCT randomized 25 trained lifters' upper-body limbs to
lengthened-partial vs full-ROM training for 8 weeks and found "similar"
muscle-thickness gains across sites (Bayes factors 0.16–0.39, moderate
support for no difference) and similar 10RM strength-endurance changes
([Wolf et al., *PeerJ*, 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC11829627/)).
That single-exercise result sits alongside earlier single-exercise
comparisons: three trials found lengthened-partial or long-length-biased
training matched or exceeded full-ROM hypertrophy, while final-range partials
(short muscle length) consistently lagged
(Kassiano et al. 2022; Pedrosa et al. 2021; Goto et al. 2019 — summarized in
[Stronger by Science's review of the lengthened-partials literature](https://www.strongerbyscience.com/stretch-mediated-hypertrophy/)).
**Applied here:** the evidence does not support replacing full-ROM work with
partials, but it does support biasing exercise selection toward movements
that load the target muscle in a lengthened position (e.g. incline curls
over preacher curls, RDLs over good mornings) when two options are otherwise
equivalent, and avoiding exercises that truncate the stretched portion of the
rep.

## Rep ranges

A meta-analysis of 21 studies (41 effect sizes) found no statistically
significant difference in hypertrophy across loads from roughly 30–100% of
1RM (~5–35 reps) when sets were taken close to failure and volume was
equated (*p* = 0.56)
([summarized in Stronger by Science's "hypertrophy rep range" review](https://www.strongerbyscience.com/hypertrophy-range-fact-fiction/),
citing Schoenfeld et al.'s dose-response work also referenced in the
[umbrella review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9302196/), which
separately notes loads ≤60% 1RM "can promote substantial increases in muscle
hypertrophy" while flagging a trend favoring heavier loads and cautioning
against very slow (10s/rep) tempos as inferior for hypertrophy). **Applied
here:** rep range is a fatigue-management and joint-comfort tool, not a
growth lever — moderate ranges (6–15) are the default for shoulder-cautious
compound work because they let RIR be judged accurately without needing
near-failure sets at very low reps (higher injury/technique risk per rep) or
very high reps (higher cumulative joint stress at a given weekly volume).

## Progression models

Plotkin et al. randomized 43 trained lifters to progress either load (fixed
8–12 reps, weight increases) or reps (fixed weight, reps increase) over 8
weeks and found both viable, with hypertrophy and strength gains "practically
equivalent" between groups
([Plotkin et al., *PeerJ*, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/)).
Separately, an NSCA commentary argues mesocycle progression should prioritize
weekly increases in **sets** over increases in %1RM, since volume is the
variable with the clearest dose-response signal
([*Strength & Conditioning Journal*, 2020](https://journals.lww.com/nsca-scj/fulltext/2020/10000/re__mesocycle_progression_in_hypertrophy__volume.15.aspx)).
**Applied here:** the generator should progress mesocycles primarily by
adding sets (moving a muscle from MEV toward MAV/MRV across the block) and
secondarily by adding reps or load within a session — never by chasing all
three simultaneously, which produces fatigue faster than growth.

## Deload timing and structure

A cross-sectional survey of competitive strength/physique athletes found
deloads were implemented roughly every 5.6 ± 2.3 weeks (range 1–12), lasting
6.4 ± 1.7 days. Deloads most commonly cut sets-per-week and reps-per-set,
cut load and RIR-to-failure on multi-joint lifts, but left training
*frequency* and exercise selection largely unchanged
([Rogerson et al., *Sports Medicine – Open*, 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10948666/)).
**Applied here:** the 8-week mesocycle's Overreach → Deload transition cuts
volume (fewer sets, not fewer sessions) and cuts effort (higher RIR, lighter
loads on compounds) rather than skipping training days outright, matching
what practitioners actually do rather than a full week off.

## Exercise rotation vs retention

Baz-Valle et al. randomized resistance-trained men to either a fixed
lower-body exercise selection or a randomized-exercise-per-session protocol
for 8 weeks: both groups produced statistically similar quadriceps
muscle-thickness and 1RM strength gains (trivial-to-small between-group
effect sizes), but the randomized group reported significantly better
training motivation, while the fixed group had somewhat better bench-press
transfer (motor-learning effect)
([Baz-Valle et al., *PLOS ONE*, 2019](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0226989)).
Broader reviews of exercise variation describe a middle path: "some degree of
systematic variation seems to enhance regional hypertrophic adaptations…
whereas excessive, random variation may compromise muscular gains." **Applied
here:** the generator should retain compound anchor lifts across a
mesocycle (motor-learning benefit, easy progression tracking) while rotating
accessory/isolation exercises on a slower cadence (e.g. every 4–8 weeks, at
mesocycle boundaries) rather than every session — structured variation, not
random variation.

## Shoulder-cautious constraints

Rules that survive regardless of what the data suggests, unless the user's
run-time shoulder answer explicitly relaxes them:
- No behind-the-neck presses or pulldowns (extreme external rotation +
  overhead load is the classic impingement mechanism).
- Overhead and horizontal pressing defaults to neutral or semi-pronated grip
  (palms facing each other), not a fixed pronated bar grip — a neutral hand
  path avoids the internal-rotation-plus-elevation combination most linked
  to subacromial impingement pain
  ([overview of neutral-grip pressing and impingement risk](https://www.zing.coach/fitness-library/overhead-press-alternative)).
- Every push/pull/upper day keeps the prehab protocol (band pull-aparts,
  face pulls, external rotations) regardless of what volume the generator
  otherwise assigns — an EMG study found band pull-aparts and external
  rotations reliably drive infraspinatus/teres-minor and mid/lower-trap
  activity depending on hand position and pull direction, which is the
  physiological basis for using them as rotator-cuff and scapular-control
  maintenance work
  ([Band Pull-Apart EMG study, *International Journal of Sports Physical Therapy*](https://ijspt.scholasticahq.com/article/33026-band-pull-apart-exercise-effects-of-movement-direction-and-hand-position-on-shoulder-muscle-activity)).
- Direct rear/side delt and rotator-cuff work stays off 0 RIR — per the
  proximity-to-failure evidence above, going to failure buys a trivial
  hypertrophy edge, and for a joint with a shoulder history that trade is not
  worth taking on the smallest, most injury-relevant muscles in the program.
- Close-grip / neutral-grip triceps work is preferred over wide-grip
  barbell bench variations for direct triceps isolation, consistent with the
  same internal-rotation-avoidance logic above.
- These constraints apply even during Overreach/high-fatigue weeks — deload
  timing and structure (see above) reduces volume and effort, it never
  removes the prehab protocol or reintroduces a banned movement pattern.

## Sources

- [Grgic & Ruzic (umbrella review), 2022 — Resistance Training Variables for Optimization of Muscle Hypertrophy](https://pmc.ncbi.nlm.nih.gov/articles/PMC9302196/)
- [Schoenfeld, Ogborn & Krieger, *Sports Medicine*, 2016 — Effects of Resistance Training Frequency on Muscle Hypertrophy](https://pubmed.ncbi.nlm.nih.gov/27102172/)
- [Refalo et al., *Sports Medicine*, 2022 — Influence of Resistance Training Proximity-to-Failure on Skeletal Muscle Hypertrophy](https://pmc.ncbi.nlm.nih.gov/pmc/articles/PMC9935748/)
- [Refalo, Helms et al., *Journal of Sports Sciences*, 2024 — Similar hypertrophy following training to failure or with RIR](https://www.tandfonline.com/doi/full/10.1080/02640414.2024.2321021)
- [Wolf et al., *PeerJ*, 2025 — Lengthened partial repetitions elicit similar muscular adaptations as full ROM](https://pmc.ncbi.nlm.nih.gov/articles/PMC11829627/)
- [Stronger by Science — Do Lengthened Partials Really Stimulate Stretch-Mediated Hypertrophy?](https://www.strongerbyscience.com/stretch-mediated-hypertrophy/)
- [Stronger by Science — The "Hypertrophy Rep Range": Fact or Fiction?](https://www.strongerbyscience.com/hypertrophy-range-fact-fiction/)
- [Plotkin et al., *PeerJ*, 2022 — Progressive overload without progressing load](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/)
- [*Strength & Conditioning Journal*, 2020 — RE: Mesocycle Progression in Hypertrophy: Volume Versus Intensity](https://journals.lww.com/nsca-scj/fulltext/2020/10000/re__mesocycle_progression_in_hypertrophy__volume.15.aspx)
- [Rogerson et al., *Sports Medicine – Open*, 2024 — Deloading Practices in Strength and Physique Sports](https://pmc.ncbi.nlm.nih.gov/articles/PMC10948666/)
- [Baz-Valle et al., *PLOS ONE*, 2019 — Effects of exercise variation on muscle thickness, maximal strength and motivation](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0226989)
- [Band Pull-Apart Exercise: Effects of Movement Direction and Hand Position on Shoulder Muscle Activity, *IJSPT*](https://ijspt.scholasticahq.com/article/33026-band-pull-apart-exercise-effects-of-movement-direction-and-hand-position-on-shoulder-muscle-activity)
