# Design: Dashboard Views

Six views, one per state (Planning has three). All views are
server-rendered fragments driven by htmx, with Cytoscape for graph
views, no build step. Each view is backed by a read-model method that
returns plain data; the same method feeds a JSON endpoint, so any view
can later be re-implemented as a SPA component without backend change.

## Terminology and information architecture

Two levels, kept distinct:

- **Analysis** -- one engineering analysis task: a single **plan** (with its
  versions) plus its **runs / results**. An analysis is what moves through the
  **five-state machine** (gather_requirements -> planning -> executing ->
  verifying -> concluding, with the rescope / rerun / replan feedback loops).
  The **state strip** shows the current analysis's inferred state (a status
  indicator; it does not change with the view tab). The toolbar selector picks
  an analysis.
- **State views** -- one per state, for the selected analysis: Requirements
  (gather), Plan detail + Plan diff (planning), Results + Plots (executing),
  Reasoning trace (verifying), Report (concluding). The left nav lists these
  under "Analysis lifecycle", aligned with the strip.
- **Study** -- an OPTIONAL larger scope: a *collection* of related analyses
  (multiple plans, multiple results) such as a trade space or campaign. A
  study is NOT a lifecycle state. It has its own overview (members, lineage,
  metrics) that you drill *from* into a single analysis. Members are analyses
  sharing `metadata.study`. This view is an early stub; the real
  multi-analysis content is still to be built.

Plan-graph note: the Planning view is the omd PLAN DETAIL graph
(`hangar.omd.plan_graph.build_plan_graph`, the plan/problem structure), NOT
the provenance/execution DAG. The provenance DAG
(`build_provenance_elements`) is the execution lineage and lives under the
Results (executing) view (to be enhanced).

Common shape for every view:
- A read-model method `view_<name>(...) -> dict` (pure data).
- A route `GET /view/<name>` returning a server-rendered fragment, and
  `GET /api/<name>` returning the same data as JSON.
- htmx swaps the fragment into the dashboard shell; Cytoscape views
  receive their graph JSON from the `/api/<name>` endpoint.

> Multi-source note (Phase 2.5): the views are tool-agnostic. The data
> behind each view comes from a per-tool Source adapter (omd plan-centric,
> sdk session-centric for oas/ocp/pyc), and graph views render a normalized
> `GraphElements` shape produced by a shared element-builder, so the same
> view works regardless of which tool produced the data. Where a tool has
> no data for a state, the view renders thin/absent with a TODO badge. See
> `DESIGN_tool_integration.md`. Status today: only the omd Source is wired.

> Roadmap note (next version): the graph views below (plan-diff, study,
> reasoning-trace) are read-only and laid out with Cytoscape in this
> version. Direct editing (drag nodes, rewire edges, edit-in-place with
> write-back) is the planned next version and is the most likely point to
> introduce a per-view SPA component such as React-Flow. The data
> contracts here are designed so that swap is additive. See
> `DESIGN_data_contract.md` for the write-back hooks.

## 1. Requirements view (Gather Requirements)

Purpose: show the requirement set and its acceptance criteria, and each
requirement's current status and what it traces to.

Data: plan `requirements[]` (`id`, `text`, `type`, `priority`, `status`,
`acceptance_criteria`, `traces_to`) joined with `requirement` /
`acceptance_criterion` entities and any `satisfies` / `violates` edges
from the verifying stage.

Rendering: a table or card list grouped by `priority`
(primary / secondary / goal), with a status chip
(draft / open / verified / violated / waived) and the acceptance criteria
(`metric comparator threshold units`) per requirement. A traceability
column links to the DVs / constraints / objective each requirement
governs (cross-links into the plan view).

Interactions (this version): filter by status / priority; click a
requirement to see its criteria and trace targets. Editing requirements
is a Phase 4 write-back hook.

## 2a. Plan view (Planning)

Purpose: the current plan version rendered as the existing plan / problem
graph (components, shared vars, solvers, DVs, constraints, objective,
decisions).

Data: the latest plan version (or a selected version) and its decomposed
sub-entities (`surface_def`, `operating_point`, `solver_config`,
`opt_setup`, `decision`, slot configs) plus `justifies` edges from
decisions to elements.

Rendering: reuse the established Cytoscape DAG style from the provenance
viewer. Nodes colored by entity type; click-to-inspect side panel with
the element's config and the decisions that justify it.

## 2b. Plan-diff graph view (Planning)

Purpose: a graph-based plan view that highlights differences between plan
versions, so a replan loop is legible.

Data: two plan versions. `hangar.omd.provenance.provenance_diff` gives a
shallow top-level diff; this view needs **element-level** granularity
(which DV bound changed, which constraint was added, which solver
swapped, which decision was added / superseded). The deeper diff is
computed in the read model (see `DESIGN_data_contract.md`), keyed by
stable element paths (e.g. `solvers.nonlinear.type`,
`design_variables[twist_cp].upper`).

Rendering: a single Cytoscape graph of the plan with per-node / per-edge
diff status (added / removed / modified / unchanged) shown by color and
badge. A version selector picks `version_a` / `version_b`; default is
`parent_version` vs `version`. Modified nodes show old -> new in the side
panel.

Interactions (this version): pick versions, hover for old/new values,
filter to changed-only. Editing is the next-version editable-graph
roadmap item.

## 2c. Study view (Planning)

Purpose: visualize and interact with a larger set of planned analyses
(a study / trade space), not just one plan. This is the view to design
out further; the spec here is the v1 scope.

Data: a collection of related plans / plan versions (a "study") and their
status: which are planned, running, done; their objective / key metrics
where available; their lineage (`wasDerivedFrom`).

Rendering (v1): a graph or matrix of the study members. Graph mode uses
Cytoscape with one node per plan/case and lineage edges; matrix mode
shows a study-vs-metric table (sortable). Each member links into its plan
view and, if executed, its results view.

Interactions (v1, read-only): select members, sort by metric, open a
member. Spawning / editing study members from this view is the
next-version editable-graph + write-back item.

## 3a. Results view (Executing)

Purpose: a useful, specific results view per run, built on but going
beyond the raw provenance views.

Data: `query_run_results(run_id)` (case data), the run's artifact
summary, validation findings, and convergence info. For optimization
runs, the objective / DV histories.

Rendering: a results header (status, duration, key outputs such as CL /
CD / L/D / failure / TSFC depending on tool), a final-values table, a
constraint-satisfaction strip (fed by `assert_constraints`), and a
convergence summary (fed by `assert_convergence`).

> TODO (Phase 2.5): the current results view is thin (final-values table +
> validation strips only). Enhance with per-tool headline metrics,
> optimization objective/DV histories, and a clearer constraint strip. The
> omd `summary` command and the sdk artifact summary are prior art to reuse.

## 3b. Visualization view (Executing)

Purpose: domain visualizations of the run (planform, mesh, lift
distribution, etc.), distinct from generic provenance.

Data / rendering: served through the plot adapter
(`generate_plot_png(run_id, plot_type)`), with available plot types from
the plot registry (`plot_types` for the run's analysis type). Images are
fetched per type and cached client-side by content hash, matching the
existing viewer pattern.

> TODO (Phase 2.5): the plot adapter must dispatch by run origin. sdk runs
> (oas/ocp/pyc MCP) render via `hangar.sdk.viz.generate_plot_png`
> (ArtifactStore). omd runs render via
> `hangar.omd.plotting.generate_plots` (recorder `.sql`, factory-aware plot
> types) and are NOT covered by the ArtifactStore path, so omd runs show no
> plots today. Detect which store owns the run and route accordingly.

## 3c. Plots view (Executing)

Purpose: optimization-history and comparison plots (objective
convergence, DV evolution, before / after), and multipoint comparisons.

Data / rendering: same plot adapter, the optimization / comparison plot
types. A small gallery with type selector. Interactive (Plotly) variants
are optional and deferred; static PNGs first.

## 4. Reasoning-trace view (Verifying/Analyzing)

Purpose: show the connections between results, observations, logical
reasoning objects (decision / reasoning entities), and the requirements
they bear on. This is the analytical heart of the verifying state.

Data: a focused subgraph: `run_record` / result entities ->
observation / `decision` entities -> `satisfies` / `violates` /
`verifies` edges -> `requirement` entities. Decisions carry `reasoning`,
`selected_action`, `confidence`, `alternatives_considered`. Cross-tool
results are linked via `cross_references`.

Rendering: a Cytoscape graph with three lanes or a layered layout:
results on one side, requirements on the other, reasoning / observation
nodes in between, edges labeled with the relation. Click a reasoning node
to read its full rationale and the alternatives considered; click a
`satisfies` / `violates` edge to see the criterion and the actual vs
threshold value.

Interactions (this version): focus on a requirement to see only its
supporting / refuting trace; focus on a result to see what it informs.
Adding observations or overriding a verdict is a Phase 4 write-back hook.

## 5. Report / summary dashboard (Concluding)

Purpose: a report and summary view: did the study meet its requirements,
what are the conclusions, what are the open replan triggers.

Data: per-requirement terminal status for the current plan version,
aggregated from the verifying-stage edges and assertions; the
`analysis_plan` phases and their success criteria; `replan_triggers` and
whether any fired; the headline metrics of the chosen / final run.

Rendering: a requirements-met scorecard (verified / violated / waived
counts), a phase-completion strip, a key-results panel, and a narrative
summary block assembled from assessments and decisions. Exportable
(print / static HTML), reusing the existing dashboard-HTML generation
pattern.

## Top-level dashboard shell

Wraps all views. Shows the state-machine diagram with the current state
highlighted, the transition history (including replan / rerun / rescope
loops), and a "next" indicator (next forward state plus near-firing
replan triggers). Clicking a state loads that state's view(s) via htmx.
Live state is refreshed by htmx polling (or SSE) against
`GET /api/state`.
