# Design: Data Contract and Read Model

How the dashboard reads from `the-hangar` and what it computes itself.
The dashboard owns no primary data store in this version; it is a
read-time projection over the provenance / plan / artifact stores, plus
the range-safety validators and assertions. The boundary inventory lives
in `the-hangar` at `docs/hangar-range-safety-boundary.md`; this document
is the range-safety side: how those contracts are consumed and where the
dashboard adds logic.

## Principles

- **Read-only against the-hangar.** The dashboard never writes to the
  omd or sdk provenance DBs. Human-edit write-back (Phase 4) produces new
  plan versions / decision entities through the normal omd authoring
  path, not direct DB writes.
- **Consume through seams, not internals.** Provenance / run data goes
  through the results-reader seam; plot rendering goes through a thin
  adapter; both target the split branch's intended boundaries so the
  dashboard re-points with minimal change when the split lands.
- **Derive, don't duplicate.** State and transitions are inferred from
  existing data (see `DESIGN_state_machine.md`), so the dashboard is
  correct regardless of whether work was driven by an agent, CLI, or
  human.

## Read model surface

`dashboard/read_model.py` exposes one method per view plus the state
projection. All return plain dicts (JSON-serializable). Indicative
surface:

```
get_state(study_or_plan_id) -> {current, confidence, transitions, next}
view_requirements(plan_id, version=None) -> {...}
view_plan(plan_id, version=None) -> {nodes, edges, decisions}
view_plan_diff(plan_id, version_a, version_b) -> {nodes, edges, changes}
view_study(study_id) -> {members, lineage, metrics}
view_results(run_id) -> {final, history, validation, assertions}
plot_types(run_id) -> [str]
plot_png(run_id, plot_type) -> bytes
view_reasoning(plan_id, version=None, focus=None) -> {nodes, edges}
view_report(plan_id, version=None) -> {scorecard, phases, key_results, narrative}
```

## Multi-source read model (Phase 2.5)

The read model is being generalized behind a `Source` adapter so it renders
the five states for any tool, not just omd. Each Source maps one provenance
pattern into the view methods above and the normalized `GraphElements` /
`StateCoverage` contracts. `OmdSource` (plan-centric) is today's behavior;
`SdkSessionSource` (session-centric, for oas/ocp/pyc) reads `sessions.db`
(`get_session_graph`) + the ArtifactStore. New tools join by the pattern
they fit, or by adding one Source. The full design, per-state mapping, and
the graph-builder decision live in `DESIGN_tool_integration.md`.

## Contracts consumed from the-hangar

### Results-reader seam (provenance / run data)
Target dependency: `hangar-results-reader` (read-only, no OpenMDAO).
Until extracted, these are imported from `hangar.omd.db` and re-exported
from the seam for back-compat:
- `init_analysis_db(db_path=None)`
- `query_run_results(run_id, variables=None) -> list[{iteration, case_type, timestamp, data}]`
- `query_entity(entity_id) -> dict | None`
- `query_provenance_dag(plan_id) -> dict`
- Schema constants: `KNOWN_ENTITY_TYPES`, `KNOWN_PROV_RELATIONS`.

The existing range-safety assertions already import
`init_analysis_db`, `query_run_results`, `query_entity` from
`hangar.omd.db`. Repoint those at the seam in the same change.

### Cross-tool session graph
`hangar.sdk.provenance.db.get_session_graph(session_id) -> {nodes, edges}`
for the cross-tool reasoning trace (`tool_call` / `decision` nodes,
`cross_references`).

### Plan schema and versions
`hangar.omd.plan_schema` for structure. Plan versions are entities
`"<plan_id>/v<N>"`; `metadata.version` / `parent_version` give lineage.
Plan YAML is loadable via the entity `storage_ref`.

### Plan diff
`hangar.omd.provenance.provenance_diff(plan_id, a, b) -> {changes, ...}`
gives a shallow top-level-key diff (`{key, action}`,
action in added/removed/modified, metadata skipped). The dashboard needs
more, so it computes an **element-level diff** itself (below).

### Plot adapter
A single module `dashboard/plot_adapter.py` wrapping the plot entry
point:
- Target: `hangar.viewer.embedded.generate_plot_png(run_id, plot_type)`
  and `hangar.sdk.viz.plot_registry` for available types.
- On current `main`: the equivalent in `hangar.sdk.viz.viewer_server`.
The adapter is the only place that changes when the viewer split lands.

### Multi-DB reader (target)
`hangar.viewer.reader.MultiDBProvenanceReader` for merging sessions /
graphs across tool DBs in a deployed multi-tool setting. Until it lands,
the read model opens the configured DBs directly through the seam. Same
shape, so the swap is internal to the read model.

## What the dashboard computes itself

### Element-level plan diff
Keyed by stable element paths so a replan is legible at the field level:
- `requirements[<id>].status`, `.acceptance_criteria`
- `design_variables[<name>].lower` / `.upper` / `.scaler`
- `constraints[<name>].lower` / `.upper` / `.equals`
- `objective.name`
- `solvers.nonlinear.type`, `solvers.linear.type`
- `components[<id>].type` / `.config`
- `decisions[<id>]` (added / superseded)

Output per element: `{path, action, old, new}` with action in
`added | removed | modified | unchanged`. This feeds the plan-diff graph
view and the replan transition reasons.

### State projection and transitions
The inference rules in `DESIGN_state_machine.md`, computed over plan
status + entities + edges + assertions. Produces current state,
confidence, ordered transition history (forward / replan / rerun /
rescope), and the next forward state plus near-firing `replan_triggers`.

### Verifying-stage linkage
Assemble the reasoning-trace subgraph by walking
result/`run_record` -> `decision`/observation -> `satisfies` /
`violates` / `verifies` -> `requirement`, attaching the assertion
outcomes from `assert_convergence` / `assert_constraints` and the
acceptance-criterion actual-vs-threshold values.

## Write-back interface (Phase 4 sketch)

Out of scope for this version; recorded so the read model and routes are
shaped to accommodate it without redesign.

- **Edit a requirement / DV bound / decision:** the dashboard does not
  mutate stores in place. A human edit produces a new plan version (a
  derived entity, `wasDerivedFrom` the prior), authored through the omd
  plan-authoring path. The dashboard then re-derives state, and the
  edit shows up as a replan transition with `trigger = rescope` or
  `replan` and a human-supplied reason.
- **Override a verification verdict / add an observation:** recorded as a
  `decision` / observation entity with `confidence` and `reasoning`,
  linked by the appropriate relation, so it appears in the reasoning
  trace as a human-authored node.
- **Pin the current state:** an optional explicit state override (small
  `dashboard_state` record or decision-entity convention) that takes
  precedence over inference, with the inferred state still shown for
  comparison.

These hooks reuse existing entity / edge types and the plan-versioning
mechanism, so "automatically incorporating human-added changes" is the
same re-derivation the dashboard already does on every read.

## Config

The read model is configured with the DB / artifact locations it reads
(per-tool DBs, or the multi-DB reader's `HANGAR_VIEWER_DBS`-style map),
the plan store directory, and the catalog directory
(`HANGAR_CATALOG_DIR`). No hard paths; all injectable for tests and
deploy.
