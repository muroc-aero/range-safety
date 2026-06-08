# Design: Dashboard State Machine

The dashboard presents an engineering analysis task as a five-state
machine. The states model the lifecycle of a study; the dashboard's job
is to show, at any moment, what the agent is doing, what it has done, and
what it plans to do next, and to give each state a view to click into.

## States

```
   ┌──────────────────────┐
   │ 1. Gather Requirements│◄──────────────────────────┐
   └───────────┬──────────┘                            │
               │                                        │ (re-scope)
               ▼                                        │
   ┌──────────────────────┐                            │
   │ 2. Planning          │◄───────────────┐           │
   └───────────┬──────────┘                │           │
               │                            │ (replan)  │
               ▼                            │           │
   ┌──────────────────────┐                │           │
   │ 3. Executing/Running  │◄──────────┐    │           │
   └───────────┬──────────┘           │    │           │
               │                       │    │           │
               ▼                       │    │           │
   ┌──────────────────────┐  (rerun)  │    │           │
   │ 4. Verifying/Analyzing├───────────┘    │           │
   └───────────┬──────────┘  (re-plan)──────┘           │
               │                                        │
               ▼                                        │
   ┌──────────────────────┐                            │
   │ 5. Concluding        ├────────────────────────────┘
   └──────────────────────┘
```

Forward edges: 1 -> 2 -> 3 -> 4 -> 5.

Feedback edges (required):
- 5 Concluding -> 1 Gather Requirements: conclusions re-scope the study
  (new or revised requirements).
- 4 Verifying -> 3 Executing: results are inconclusive or a run failed;
  re-run with adjusted inputs.
- 4 Verifying -> 2 Planning: results invalidate the plan; replan
  (different DVs, constraints, components, solver).

The feedback edges are first-class in the model, not just UI arrows.
Each backward transition is recorded as a transition event with a reason,
so the dashboard can show the loop history (how many replan cycles, why
each happened).

## Each state has a view

| State | Attached view(s) | Primary data source |
|---|---|---|
| 1. Gather Requirements | Requirements view | plan `requirements`, `requirement` entities, `acceptance_criterion` |
| 2. Planning | Plan view + Plan-diff graph view + Study view | plan schema, plan versions, `provenance_diff` + element diff |
| 3. Executing/Running | Results view + Visualization view + Plots view | `run_cases`, artifacts, plot adapter, provenance DAG |
| 4. Verifying/Analyzing | Reasoning-trace view | results + `decision`/observation entities + `satisfies`/`violates` edges to requirements |
| 5. Concluding | Report / summary dashboard | assessments, analysis_plan phases, aggregated status |

View specifications are in `DESIGN_views.md`.

## What "current state" means

The dashboard does not own a separate workflow engine. It infers state
from the data already recorded in the provenance and plan stores, so it
reflects reality whether the work was driven by an agent, a CLI, or a
human. Inference rules (read model computes these):

- **Gather Requirements** is the current state when a plan exists but has
  requirements in `draft`/`open` status with no acceptance criteria
  resolved, and no `run_record` entities yet.
- **Planning** when requirements are settled and the latest plan version
  has components / DVs / constraints / objective but no executed
  `run_record` for that version. Active replanning shows as a new plan
  version derived (`wasDerivedFrom`) from a prior one.
- **Executing** when there is an `activity` in progress or recent
  `run_record` entities for the current plan version, and no assessment
  yet.
- **Verifying** when `run_record` entities exist and assertions /
  assessments are being produced (`assessment` entities, `verifies` /
  `satisfies` / `violates` edges being written).
- **Concluding** when all primary requirements have a terminal status
  (`verified` / `violated` / `waived`) for the current plan version and a
  summary assessment exists.

Because state is derived, the dashboard can also show a **confidence**
for the inferred current state and let a human pin it explicitly (a
Phase 4 write-back hook).

## How an agent records a conclusion

> **Implemented (2026-06).** This is built end-to-end. For omd it is the
> `conclusion` entity written by `omd-cli conclude` (Phase A). For the
> session tools (oas / ocp / pyc) it is a `decision` row with
> `decision_type = "conclusion"` and the verdict payload in the
> `decisions.metadata_json` column, written by the `record_conclusion` MCP
> tool / CLI command (Phase B). The dashboard `SdkSessionSource` reads it via
> `hangar.sdk.provenance.db.get_conclusion(session_id)`: a conclusion flips
> Concluding to `populated`, scores the Report view, and replays the
> per-requirement verdicts. Verdicts are **auto-derived** from the persisted
> requirements vs. the chosen run's results (`derive_conclusion`); the agent
> supplies only the chosen run id and a short narrative. The contract is
> listed in `the-hangar` at `docs/hangar-range-safety-boundary.md`.

Concluding must be something an agent (or human) actively *does*, not only
something inferred. The mechanism reuses the existing provenance vocabulary,
so it is additive:

- The agent records a **conclusion artifact** at the concluding step: a
  provenance entity (a `decision` with `stage = "concluding"`, or a dedicated
  `conclusion` entity type) that is **tied to the result(s) it is based on**
  (`wasDerivedFrom` the chosen / final `run_record`, and/or referencing the
  result artifact ids) and **tied to the requirements it resolves**
  (`satisfies` / `violates` / `justifies` edges to the `requirement`
  entities). It carries the headline outcome (key metrics), the per-primary
  -requirement verdict, and a short narrative.
- The **Report view** aggregates these conclusion artifacts alongside the
  requirements scorecard and the analysis-plan phases; Concluding **coverage**
  is `populated` once a conclusion artifact exists (today it is inferred from
  terminal requirements + an assessment, which is weaker).
- This parallels the verifying-stage linkage (results -> reasoning ->
  requirements) and is recorded the same way: the per-tool **skills** add a
  "record the conclusion" step at the end of the workflow (TODO in
  `DESIGN_tool_integration.md` and the skills). For tools that only emit
  results artifacts, the simplest form is a conclusion entity that
  `wasDerivedFrom` the final result artifact, so "concluding" is just
  "an agent recorded what the results mean for the requirements."

## Transition events

A transition is recorded with: `from_state`, `to_state`, `timestamp`,
`trigger` (`forward` | `replan` | `rerun` | `rescope`), `reason`, and the
`plan_version` / `run_id` it relates to. Forward transitions are inferred
from the data; backward transitions are inferred when a new plan version
is derived (replan), a re-run of the same plan version appears (rerun),
or requirements change after a conclusion (rescope).

This gives the top-level dashboard three things to render:
- **Doing now:** the current inferred state + the in-progress activity.
- **Done:** the ordered transition history, including loop-backs.
- **Next:** the next forward state, plus any pending `replan_triggers`
  from the plan's `analysis_plan` that are close to firing.

## Mapping to existing data

The state machine is a read-time projection over:
- Plan schema: `requirements[].status`, `analysis_plan.phases`,
  `analysis_plan.replan_triggers`, `metadata.version` /
  `parent_version`.
- omd analysis DB: `entities` (types `requirement`, `run_record`,
  `assessment`, `phase`), `activities` (status), `prov_edges`
  (`satisfies`, `violates`, `verifies`, `precedes`, `executes`,
  `wasDerivedFrom`).
- range-safety assertions: `assert_convergence`, `assert_constraints`
  feed the Verifying state and the requirement terminal status.

No new persistent state store is required for this version. Transition
events are derived; if we later need durable, human-pinned state, that is
a Phase 4 addition (a small `dashboard_state` table or a decision-entity
convention), designed not to break the derive-from-data default.
