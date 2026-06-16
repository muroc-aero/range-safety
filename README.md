# hangar-range-safety

Plan validation, post-run assertions, and a state-machine analysis dashboard
for MDAO workflows.

This package adds three things on top of the Hangar tool servers:

1. **Pre-run plan validation** -- structural, traceability, and heuristic
   checks on an assembled plan before it runs.
2. **Post-run assertions** -- convergence and constraint-satisfaction checks
   on a completed run.
3. **The dashboard** -- a server-driven web UI that replays any analysis as a
   five-stage state machine (gather requirements, plan, execute, verify,
   conclude), reading from both omd plan provenance and SDK session
   provenance.

It is a separate package (`muroc-aero/range-safety`) consumed as a git submodule
under `the-hangar` at `packages/range-safety`. It reads the-hangar data
read-only through the `hangar-results-reader` seam and a thin plot adapter, and
builds on `hangar-sdk` and `hangar-omd`. It never writes to the analysis or
session databases.

## Layout

```
src/hangar/range_safety/
├── cli.py              # range-safety CLI: validate, assert
├── validators/         # pre-run plan checks
│   ├── structural.py   #   plan well-formedness against the component catalog
│   ├── traceability.py #   requirements <-> DV/constraint/objective traceability
│   └── heuristics.py   #   soft checks (DV bounds, common misconfigurations)
├── assertions/         # post-run checks
│   ├── convergence.py  #   did the optimizer/solver converge
│   └── constraints.py  #   are the plan's constraints satisfied at the result
└── dashboard/          # Starlette app: JSON API + server-rendered htmx views
    ├── app.py          #   routes
    ├── sources.py      #   OmdSource + SdkSessionSource behind a MultiSource
    ├── read_model.py   #   read-only access to provenance/plans/results
    ├── state_machine.py#   five-stage inference + verdict derivation
    ├── plan_diff.py     #   per-element plan diff
    ├── plan_store.py
    └── plot_adapter.py #   plot dispatch by origin (omd vs sdk)
```

## CLI

```bash
# Validate an assembled plan before running it.
range-safety validate plan.yaml [--catalog-dir DIR]

# Assert convergence + constraint satisfaction on a completed run.
range-safety assert <run_id> --plan plan.yaml [--db analysis.db]
```

Both emit JSON and exit non-zero on a hard failure (`validate` on any error
finding, `assert` on any failed check), so they slot into CI or an agent's
verify step. `validate` honors `HANGAR_CATALOG_DIR` when `--catalog-dir` is
omitted.

## Dashboard

The dashboard is a Starlette app. Run it locally with uvicorn:

```bash
uvicorn hangar.range_safety.dashboard.app:app --reload
```

The primary UI is a React 18 + Vite + TypeScript SPA (`frontend/`, built into
`dashboard/static/spa/`) served at `/`; it talks only to the `/api/<name>`
read-model endpoints. The same API still backs the legacy server-rendered htmx
fragments at `/view/<name>`, which remain as a fallback: when the SPA has not
been built (a source checkout without `npm run build`), `/` serves the htmx
shell instead. Graphs render with Cytoscape (light Instrument palette in the
SPA), plots as matplotlib PNGs from `/api/plots/...`.

See `frontend/README.md` for the SPA architecture and dev/build commands. The
Docker image builds the SPA in a `node` stage; a plain `pip install` from a
source tree ships only the htmx fallback unless the SPA was built first.

Studies are keyed `{source}:{id}`; the shell aggregates every source. The omd
path reads plan provenance and renders plots through
`hangar.omd.plotting`; the sdk path reads `sessions.db` plus the artifact store
and renders through `hangar.sdk.viz`. The state strip polls for live updates as
a run progresses.

In a deployment the dashboard runs as its own service. The Hangar tool images
(for example omd) do not bundle this package, so their in-container autostart
hook (`RS_DASHBOARD_AUTOSTART`) stays off there.

### Authentication

The dashboard reuses the unified viewer's browser-OIDC flow
(`hangar.sdk.viz.viewer_auth`): set `HANGAR_VIEWER_OIDC_CLIENT_ID`,
`HANGAR_VIEWER_OIDC_CLIENT_SECRET`, `HANGAR_VIEWER_SESSION_SECRET`,
`OIDC_ISSUER_URL`, and `RESOURCE_SERVER_URL` (the dashboard's external base)
and every content route requires a Keycloak login; the OAuth callback is
`{RESOURCE_SERVER_URL}/viewer/callback`. With those unset the dashboard runs
open (local dev). Once authenticated, the study list and study-scoped views
are filtered to the viewer's studies: a study records its `owner` (the user
who first ran it, from `get_current_user()`), and a user sees their own plus
ownerless studies; members of `HANGAR_VIEWER_ADMIN_ROLE` see everything.
omd/sdk run detail relies on omd's existing per-row `user` scoping.

## Development

This package is part of the the-hangar uv workspace. From a full-stack clone
(submodule resolved):

```bash
git clone --recurse-submodules https://github.com/muroc-aero/the-hangar
cd the-hangar
uv sync                       # picks up packages/range-safety via the workspace
uv run pytest packages/range-safety/tests/
```

After committing changes here, push this repo, then bump the submodule pointer
(gitlink) in the-hangar.

## Docs

Design and contract docs live in `docs/`:

- `ROADMAP.md` -- phased build plan and current status
- `DESIGN_state_machine.md` -- the five stages, transitions, verdict derivation
- `DESIGN_data_contract.md` -- the read-model contract
- `DESIGN_views.md` -- the views and their backing read-model methods
- `DESIGN_tool_integration.md` -- multi-source (omd + sdk) consolidation

The boundary inventory between this package and the-hangar lives in the-hangar
at `docs/hangar-range-safety-boundary.md`.

## License

See [LICENSE](LICENSE).
