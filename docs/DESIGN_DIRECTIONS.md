# Design Directions: Where Range-Safety Could Go Next

Status review (2026-07-09) plus six deliberately divergent design directions
for the next capability jump. Each direction is a different answer to the same
question the package exists to answer:

> **Overall objective.** When an AI agent (or a human driving the tools) runs
> an engineering analysis, how does anyone come to *justified trust* in the
> conclusion — before the run (is the plan sound?), after the run (did it
> converge, are the constraints met?), and across the whole lifecycle (can a
> reviewer see what was required, planned, executed, verified, concluded)?

The name is the mission: a **range safety officer** for agentic MDAO — an
independent function that watches the flight, has its own instruments, and can
call the abort.

---

## Part 1 — Current status

What exists today (main @ `889aeb8`, all merged):

1. **Pre-run validators** (`validators/`) — structural well-formedness against
   the component catalog, requirements↔DV/constraint/objective traceability,
   and soft heuristics. CLI: `range-safety validate`.
2. **Post-run assertions** (`assertions/`) — convergence and
   constraint-satisfaction checks on a completed run. CLI: `range-safety
   assert`. Both emit JSON and exit non-zero, so they slot into CI or an
   agent's verify step.
3. **The dashboard** — Starlette API + React/Vite SPA (htmx fallback) that
   replays any analysis as the five-stage state machine
   (gather-requirements → plan → execute → verify → conclude, with
   rescope/replan/rerun feedback edges). Multi-source: `OmdSource`
   (plan-centric) and `SdkSessionSource` (session-centric, oas/ocp/pyc) behind
   a normalized contract. Conclusions are first-class end-to-end
   (`omd-cli conclude`, `record_conclusion`), with verdicts auto-derived from
   persisted requirements. OIDC auth, per-user study scoping, Docker deploy
   path.

Known open items (per `ROADMAP.md`): study-list UX at ~1600 studies, the
viewer-split plot-adapter seam, Phase 3 deploy polish, and Phase 4
(human-in-the-loop write-back / editable graphs).

**The honest architectural summary:** everything shipped so far is
*retrospective and self-reported*. Range-safety is a read-only projection over
provenance **the agent itself chose to record**, checked at two fixed
checkpoints (before the run, after the run), rendered for a human who has to
come look. That was the right V1 — it forced the data contracts into
existence. But measured against the objective, three structural gaps remain:

- **No authority.** The RSO can see the flight but has no destruct button.
  Validators and assertions are advisory; nothing stops a bad run mid-flight.
- **No independence.** All evidence comes from the flight vehicle's own
  telemetry. If the agent mis-records, mis-concludes, or simply doesn't call
  `log_decision`, the dashboard faithfully replays a fiction.
- **Binary, point-wise verdicts.** Pass/fail at a single converged point, with
  no notion of confidence, margin, or validity region.

The six directions below each attack one of these gaps hard. They are
intentionally *not* a roadmap — they are diverging bets, mostly mutually
compatible, sketched to the point where the first buildable slice is visible.

---

## Part 2 — Six wild directions

### Direction 1 — The Flight Termination System
**Inversion: from passive observer to inline authority.**

Today range-safety watches databases after the fact. Instead, put it *in the
loop*: a policy-enforcement proxy that sits between the agent and the Hangar
tool servers (an MCP middleware — every `run_plan`, `run_optimization`,
`run_mission_analysis` call flows through it).

- **Pre-flight hold:** a tool call that references an unvalidated or
  validation-failing plan is held or rejected — the existing validators become
  gate conditions instead of advice.
- **In-flight envelopes:** live telemetry checks during a run — iteration
  budgets, wall-clock/compute budgets, physics sanity envelopes (CL, stress
  ratios, T4 limits), requirement drift ("the last 4 runs stopped referencing
  requirement R-3"). Violations trigger *hold* (pause, ask a human), *abort*
  (kill the run, record why), or *waiver* (a signed human override, itself a
  provenance entity).
- **The dashboard grows the button:** the Phase-4 "write-back" hook becomes
  literal — HOLD / ABORT / WAIVE controls on the state strip.

This is the smallest conceptual change with the biggest character change:
range-safety stops being a viewer product and becomes a *control* product.
First slice: wrap one tool server (omd) in a proxy that enforces
`validate`-before-`run_plan` and an iteration budget, with waivers recorded as
decisions. The provenance vocabulary already has everything needed.

Risk: a gate that cries wolf gets bypassed. The waiver path must be cheaper
than disabling the proxy, and every gate decision must be explainable in one
sentence in the dashboard.

### Direction 2 — Independent Surveillance (the red-team twin)
**Inversion: from self-reported telemetry to independent tracking.**

A real range has radar that does not belong to the vehicle. Give range-safety
its own instruments: for every conclusion an agent records, an independent
**verification agent** (a separate model/context that never sees the primary
agent's reasoning, only the plan, the raw artifacts, and the requirements)
attempts to *refute* it:

- **Re-derivation:** recompute the verdicts from raw result artifacts, not
  from the agent's recorded decisions. Disagreement = flag.
- **Cross-fidelity sanity:** check the high-fidelity answer against an
  independent low-fidelity method (handbook drag buildup vs. OAS; Breguet
  range vs. OpenConcept mission integration). Beyond tolerance = flag.
- **Perturbation replication:** re-run the chosen case with jittered initial
  guesses / mesh density; a conclusion that survives only at one exact
  configuration is fragile and gets marked so.
- **N-version dissent:** for high-stakes studies, N verifiers with different
  lenses (numerics, physics, traceability) vote; the Report view grows a
  **dissent panel** showing who disagreed and why.

The five-stage machine gets a sixth, adversarial overlay: every `satisfies`
edge the primary agent writes can be countered by a `disputes` edge from the
twin. Trust is what survives cross-examination, not what was asserted.

First slice: a `range-safety challenge <study>` CLI that re-derives
conclusion verdicts from artifacts and runs one cross-fidelity check, writing
`disputes`/`corroborates` edges the dashboard already knows how to draw.

Risk: cost (every study runs twice-ish) and false dissent from legitimate
fidelity gaps. Mitigate by tiering: cheap re-derivation always, replication
and N-version only on studies tagged high-stakes.

### Direction 3 — Certification-as-Code (the airworthiness dossier compiler)
**Inversion: from a dashboard you look at to a certificate that compiles.**

Recast the whole lifecycle as a machine-checkable **assurance case** (GSN /
Claims-Argument-Evidence, the structure behind DO-178C / ARP4754 practice):

- Requirements → top-level **claims**.
- Plans and their traceability → the **argument strategy** decomposing claims.
- Runs, plots, assertion results → **evidence** nodes, content-hashed.
- Validators/assertions/conclusions → **inference rules** connecting evidence
  to claims.

Then `range-safety certify <study>` either *compiles* — emitting a signed,
hash-chained, self-contained dossier (HTML/PDF + machine-readable graph) that
any third party can re-verify without access to your infrastructure — or
fails with a list of **open proof obligations** ("claim C2 has no evidence for
the off-design corner", "evidence E7's hash doesn't match the artifact
store"). The dashboard's Report view becomes the compiler's error/success
output; the state machine becomes the type system.

This is the direction that turns range-safety from an internal tool into an
artifact your customer, your chief engineer, or a regulator consumes. It also
gives agents a crisp objective: an agentic study is *done* when it compiles.

First slice: define the claim/evidence schema as a projection of the existing
read model (requirements, conclusions, `satisfies`/`violates` edges are ~80%
of it), add artifact hashing, and emit a static dossier for the demo study
`omd:cessna-composite-wing`.

Risk: assurance-case formalisms can become bureaucratic theater. Keep the
argument schema tiny (one page) and let the compiler's failure messages, not
the notation, be the product.

### Direction 4 — The Probabilistic Trust Field
**Inversion: from binary pass/fail to belief, margin, and information value.**

Every verdict today is a boolean at a point. Real confidence is a
distribution: solver tolerance, mesh convergence (Richardson/GCI), input
uncertainty, and model-form error all smear the answer. Direction 4 makes
range-safety the keeper of a **Bayesian belief network over the
requirements**:

- Each assertion contributes a likelihood, not a verdict: `P(constraint
  satisfied)` given solver residuals, discretization error estimates, and
  declared model validity.
- The Report view renders a **trust field**: per-requirement probability with
  margin, not a green/red dot. "MEETS (p=0.97, margin 2.1σ)" vs "MEETS
  (p=0.55)" are wildly different conclusions the current UI renders
  identically.
- The wild part: run the network *forward*. At the Verifying stage,
  range-safety computes **expected information gain** per candidate next run
  ("a mesh-refinement rerun would move P(R-2) by ±0.3; another optimizer
  restart would move nothing") and *suggests the next experiment*. The
  verify→rerun/replan feedback edges stop being annotations of what the agent
  did and become recommendations for what it should do. Range-safety quietly
  becomes the planner.

First slice: no BN machinery yet — just replace boolean assertion outputs
with (verdict, p, margin, dominant-uncertainty-source) tuples using what's
already available (optimizer residuals, constraint slack normalized by
tolerance, mesh-sweep GCI where a sweep exists), and render the trust field
in the Report view.

Risk: fake precision. A made-up prior is worse than an honest boolean. Ship
only likelihood terms with defensible sources, and always show *why* p is
what it is.

### Direction 5 — The Flight Recorder (event-sourced ground truth + time travel)
**Inversion: from projecting state out of tool databases to owning an
append-only ground truth you can replay and fork.**

Today "what happened" is inferred read-time from two heterogeneous stores.
Direction 5 makes range-safety the **black box**: every tool call, artifact,
decision, and transition is captured as an event in an append-only,
content-addressed log (hash-chained, à la git). Two capabilities fall out
that no amount of dashboard polish can provide:

- **Deterministic replay as the ultimate assertion.** "Do I trust this
  conclusion?" becomes "re-execute the log from event 0 and diff." Divergence
  *is* the finding — a flaky solver, an environment drift, a nondeterministic
  mesh. `range-safety replay <study> --verify` is a stronger check than any
  static assertion.
- **Counterfactual forks.** Scrub the timeline in the dashboard, pick an
  event, fork: "what if the DV bound had been 10% tighter from run 3
  onward?" The fork replays cached events up to the divergence point and
  re-executes after it — a first-class *what-if* machine for reviews, cheap
  because the prefix is cache-hit. The five-stage state machine becomes a
  scrubber, and the replan/rerun feedback loops become literal branches in a
  DAG of timelines.

First slice: an event-capture shim at the same proxy seam as Direction 1
(they share infrastructure — the FTS needs the live event stream anyway),
writing a hash-chained JSONL per study, plus `replay --verify` for omd plans
(which are already declarative and mostly deterministic).

Risk: replay determinism is hard at the edges (solver seeds, BLAS threading,
tool versions). Scope it: bit-exact where possible, tolerance-band replay
elsewhere, and record the environment fingerprint so divergence is at least
attributable.

### Direction 6 — The Chase Plane (push companion, not pull dashboard)
**Inversion: from a place you go to a presence that comes to you.**

Every capability so far assumes a human opens a browser. Real range safety is
a *person on console* during the window. Direction 6 makes range-safety an
always-on observer agent tailing the provenance stores (or Direction 5's
event log) in real time, that:

- **Narrates:** posts a running commentary to Slack/chat per study — "Study
  cessna-composite-wing entered Verifying; 2 of 3 requirements met, R-3
  violated by 4%" — with deep links into the dashboard views.
- **Interrupts:** pages a human only on anomaly (envelope breach, dissent
  from Direction 2, a study looping planning↔executing 5 times without a new
  decision, an agent concluding without any verify-stage activity — that last
  one is the single most important alarm in the whole system).
- **Answers:** is conversational over the read model — "why did run 14
  fail?", "what changed between plan v3 and v4?" answered from
  `plan_diff` and provenance, in the channel, without anyone opening the SPA.
- **Holds the pen:** in review meetings, drives the waiver flow (Direction 1)
  and records the human decisions as provenance, so the meeting itself enters
  the record.

This is the cheapest direction to prototype (the read model already answers
every question; it needs a tailer + a chat surface) and the one that changes
day-to-day behavior most: oversight stops being a chore someone remembers to
do and becomes ambient.

Risk: notification fatigue → muted channel → no oversight. The interrupt
policy is the product; start brutally quiet (the conclude-without-verify
alarm and envelope breaches only) and let users opt into more.

---

## Part 3 — How the directions relate

They are one system viewed from six angles, and they compose:

```
                 ┌────────────────────────────────────┐
                 │ 5. Flight Recorder (event log)      │  ← shared substrate
                 └───────┬────────────────────┬───────┘
                         │                    │
        ┌────────────────▼──────┐   ┌─────────▼──────────────┐
        │ 1. FTS (inline gates)  │   │ 6. Chase Plane (push)  │
        └────────────────┬──────┘   └─────────┬──────────────┘
                         │                    │
        ┌────────────────▼──────┐   ┌─────────▼──────────────┐
        │ 2. Red-team twin       │   │ 4. Trust field (p, σ)  │
        └────────────────┬──────┘   └─────────┬──────────────┘
                         │                    │
                 ┌───────▼────────────────────▼───────┐
                 │ 3. Certification compiler (output)  │
                 └────────────────────────────────────┘
```

- **1 and 5 share a seam** (the tool-call proxy / event tap) — building either
  makes the other cheap.
- **2 and 4 share a philosophy** (evidence must be earned) — the twin's
  corroborations/disputes are exactly the likelihood terms the trust field
  wants.
- **3 is the sink:** whatever else is built, the dossier compiler is where it
  all becomes an external, verifiable artifact.
- **6 is the ambient surface** over all of it.

If forced to pick an order: **6 first** (days, not weeks; changes behavior
immediately; validates the read model against real questions), then **1+5
together** at the proxy seam (authority + ground truth), then **2 or 4**
depending on whether the pressing doubt is *agent honesty* (→2) or *numerical
confidence* (→4), with **3** as the capstone that makes the whole thing
legible to the outside world.

None of this discards the V1: the state machine, read model, Source adapters,
and conclusion contract are the substrate every direction builds on. V1 built
the instruments; these directions put an officer on console.
