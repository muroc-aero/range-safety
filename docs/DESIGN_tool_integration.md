# Design: Tool Integration and Multi-Source Read Model

How the range-safety dashboard renders the five states regardless of which
tool produced the data, and how new tools plug in. This is the design
target after Phase 2 (single-source omd views). It is driven by one
observation: every current and future tool records provenance in one of two
patterns, and the two are asymmetric in what they cover.

## The two patterns

### omd pattern (plan-centric)
- Store: `analysis.db` (PROV-Agent entities/activities/edges/run_cases) plus
  a versioned plan document under `{OMD_PLAN_STORE}/{plan_id}/v{N}.yaml`.
- Strong at: Planning (a rich provenance DAG with decomposed sub-entities,
  decision/reasoning nodes, `partOf` containment, status colors, dashed
  `wasDerivedFrom` replan edges; plan versions; element-level diff).
- Weak at: Results (a view exists but is thin; see the TODO below).
- Read seam today: `hangar-results-reader` (`query_provenance_dag`,
  `query_run_results`, `query_entity`).

### sdk pattern (oas / ocp / pyc, session-centric)
- Store: `{HANGAR_DATA}/.provenance/sessions.db`
  (`hangar.sdk.provenance.db.get_session_graph(session_id)` returns
  `tool_call` / `decision` nodes with `informs` / `decides` edges) plus the
  filesystem `ArtifactStore` (`{HANGAR_DATA}/{user}/{session}/{run}/`) holding
  per-run results and rendered plots.
- Strong at: the execution graph (tool_call/decision) and plots; has
  `set_requirements` and `log_decision` tools.
- Weak at: structured Plan (no plan document or versions) and Concluding.

The asymmetry is the design problem: omd is rich where sdk is thin (Plan),
and sdk is rich where omd is thin (Execution graph, plots).

## State-first shell, tool adapters underneath

The dashboard's contract is the five states plus the feedback loops. It does
not know about tools. Underneath sits one **Source adapter** per pattern that
maps a tool's recorded data into the five state views.

```
ReadModel (state-first, tool-agnostic)
    |
    +-- SourceRegistry: study_id -> Source
    |
    +-- OmdSource(analysis_db, plan_store)        # plan-centric
    +-- SdkSessionSource(sessions_db, artifacts)  # session-centric
    +-- <FutureSource>                            # one file per new pattern
```

A study key is `{source}:{id}` (e.g. `omd:paraboloid-trade`,
`oas:sess-abc`). The shell selector aggregates studies across all registered
sources; every drill-down route carries the source so the right adapter
renders.

## Normalized contracts

Views consume normalized data so they stay tool-agnostic. Each Source emits:

### GraphElements (the common execution-graph format)
```
{
  "nodes": [{"id", "label", "type", "group", "status", "meta"}],
  "edges": [{"source", "target", "label", "relation"}]
}
```
Both omd's provenance DAG and sdk's session graph map onto this, so one
Cytoscape renderer (style lifted from the existing viewers) draws both. This
is the cross-tool execution graph, and the first view to unify.

### StateCoverage
```
{ <state>: {"status": "populated" | "thin" | "absent", "source", "todo"} }
```
So the state strip shows honestly which states are populated, thin, or
skipped, and links a thin/absent state to the TODO that will flesh it out.

### Existing view dicts
`view_requirements`, `view_results`, `view_report`, etc. become Source
outputs, so an `SdkSessionSource` can return its own shape for the same view.

## Per-state source mapping

| State | omd | sdk (oas/ocp/pyc) |
|-------|-----|-------------------|
| Gather Requirements | `plan.requirements` | `set_requirements` (TODO: normalize storage) |
| Planning | plan graph + versions + diff | thin: no plan document; show config + decisions (TODO) |
| Executing | run records + results (TODO: enrich results) | session graph + artifact results + plots |
| Verifying | assessment + decisions + reasoning (partial) | `log_decision` + `cross_references` + assertions |
| Concluding | report scorecard | thin: artifact summary (TODO) |

The dashboard renders each state with whatever the owning Source has and
badges thin/absent states.

## Graph rendering: share a builder (decided approach)

The execution-graph view must match the existing tool viewers. Three options
were considered:

- **Share a builder (chosen).** Factor each tool's element-building into a
  reusable `build_*_elements(...) -> GraphElements` in the-hangar; the
  existing HTML viewers and the dashboard both call it. Single source of
  truth, consistent style across states and tools, dashboard owns
  drill-down. Cost: two small the-hangar PRs (omd + sdk) and migrating the
  existing viewers to the shared builder.
- Replicate the rendering inside the dashboard. Rejected: the graphs drift
  as omd/sdk evolve; double maintenance.
- Iframe the existing viewers into state panels. Rejected: two different UIs
  in one dashboard, inconsistent chrome, no cross-linking/drill-down,
  theming and port/auth friction.

Concretely:
- omd: extract the element-builder out of `provenance.provenance_dag_html`
  into `build_provenance_elements(plan_id) -> GraphElements`; the HTML viewer
  calls it too.
- sdk: add `build_session_elements(session_id) -> GraphElements` over
  `get_session_graph`.
- Dashboard: one Cytoscape config (style from the existing viewers) renders
  any `GraphElements`.

## Future tools

A new tool joins by the pattern it fits, with zero dashboard change in the
common case:
- Records via omd plans (a new factory): already covered by `OmdSource`.
- An MCP server on hangar-sdk: already covered by `SdkSessionSource`.
- A genuinely new shape: implement one `Source` adapter emitting the
  normalized contracts. Views do not change.

The extensibility seam is the `Source` interface plus the two normalized
contracts.

## Agentic workflows and status tracking

The per-tool skills (`oas-cli-guide`, `omd-cli-guide`, and the cross-tool
`design-study-workflow` / `multi-tool-composition`) drive the agent through
gather -> plan -> run -> verify -> conclude. Each action writes provenance
through its tool. The dashboard re-derives state on every read, so there is
no separate workflow engine and thin/skipped states fall out naturally
(a skill that never records requirements leaves Gather skipped). The lever to
make a state less thin is the skill: have each tool's skill record the
missing piece at the right step (TODO list below).

## Cross-tool studies

A design study that spans tools (e.g. oas geometry feeding an omd plan) links
via `cross_references` / `link_cross_tool_result`. Surfacing a combined,
multi-source study view is a later item (the study view is single-source in
this version).

## TODO backlog (tracked here, scheduled in ROADMAP.md)

- [ ] `SdkSessionSource`: read `sessions.db` + ArtifactStore; map session
      graph, requirements, decisions, results, plots into the state views.
- [ ] Shared graph element-builder in the-hangar (omd + sdk), one Cytoscape
      renderer in the dashboard; migrate existing viewers to it.
- [x] Plot dispatch by run origin: omd runs via
      `hangar.omd.plotting.generate_plots` (recorder `.sql`, factory plot
      types, n2 excluded); sdk runs via `hangar.sdk.viz.generate_plot_png`
      (ArtifactStore). Each Source owns its plot path; the dashboard shows
      one gallery of all of a run's types.
- [ ] `StateCoverage` contract + thin/absent badges in the state strip
      (sources already return thin views; the badge layer is still TODO).
- [ ] Enhance the omd results view (current one is thin: add the per-tool
      headline metrics, optimization histories, constraint strip).
- [ ] Fill the sdk-pattern thin states: structured Plan extraction from a
      session, Concluding summary.
- [ ] Skills: record the currently-missing pieces (e.g. OAS/OCP/pyC skills
      call `set_requirements` at gather and `log_decision` at verify) so the
      thin states populate from real agentic runs.
- Concluding mechanism: agents record a **conclusion artifact** at the
      concluding step (a `conclusion` entity `wasDerivedFrom` the chosen result,
      with `satisfies`/`violates` edges to the requirements + headline metrics +
      narrative). The Report view aggregates it and Concluding coverage becomes
      `populated` from it. See `DESIGN_state_machine.md` ("How an agent records a
      conclusion").
  - [x] **omd**: `record_conclusion` + `omd-cli conclude` auto-derive
        per-requirement verdicts from the acceptance criteria, write the
        `conclusion` entity + edges; state machine, Report view, and the
        `omd-cli-guide` skill updated.
  - [ ] **sdk** (oas/ocp/pyc): a `record_conclusion` tool writing a
        `decision`-backed conclusion, the dashboard sdk source reading it, and
        the per-tool skills' closing step.
- [ ] Multi-source study key + shell selector aggregating all sources.
- [ ] Cross-tool combined study view via `cross_references`.
