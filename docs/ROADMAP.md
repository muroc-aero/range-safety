# Range-Safety Dashboard: Roadmap

Bootstrap and build plan for the state-machine analysis dashboard. The
dashboard ships in this repo (`range-safety`); it consumes read-only
contracts from `the-hangar`. The boundary inventory lives in
`the-hangar` at `docs/hangar-range-safety-boundary.md`.

## Locked decisions

1. **Dev / sync.** `range-safety` is developed as a git submodule under
   `the-hangar` at `packages/range-safety`, using the SSH remote. The uv
   workspace (`members = ["packages/*"]`) picks it up transparently, so
   no per-machine pyproject edits are needed for full-stack dev. The one
   recurring cost is a submodule-pointer bump commit in `the-hangar`
   after pushing range-safety changes.
2. **Frontend.** API-first. The backend state machine and read model are
   pure Python and are the part that must get the the-hangar interfaces
   right. The frontend is a server-driven thin client: htmx for
   navigation / live refresh / form posts, Cytoscape for graph views, no
   build step. The JSON/HTTP API is designed so a single view can later
   be replaced by a SPA component without a rewrite.
3. **Viewer split.** Build on `the-hangar` `main`, but design to the
   intended boundaries of the `claude/hangar-repo-separation-KoJOR` split
   branch (`hangar.sdk.viz.plot_registry`,
   `hangar.viewer.embedded.generate_plot_png`,
   `hangar.viewer.reader.MultiDBProvenanceReader`). That branch is a
   reference draft to steal from; it may not land verbatim. Provenance /
   plan / diff data is consumed through a results-reader seam; plot
   rendering goes through a thin one-file adapter. The viewer split runs
   as a parallel, non-blocking track.
4. **Deploy.** The VPS runs a Docker image built in CI. CI resolves the
   submodule with a deploy key, so the private source and creds never
   land on the VPS. Fits the existing docker-compose + Caddy + scp flow
   in `lakesideai-infra`.

## Phase 0 -- Repo and workspace setup

Goal: `range-safety` is its own private repo with history, consumed as a
submodule, and the workspace stays clean for both full-stack and
open-only clones. This phase contains the only irreversible, outward-
facing step (a push to the private repo); run it deliberately.

- [ ] **Extract with history.** From a fresh `the-hangar` clone:
      `git filter-repo --path packages/range-safety`, lift `src/` and
      `tests/` to the repo root, add a root `pyproject.toml`, push to
      `git@github.com:muroc-aero/range-safety.git` `main`. (Confirm before
      pushing; this populates the currently-empty private repo.)
- [ ] **Submodule.** In `the-hangar`: `git rm -r packages/range-safety`,
      then `git submodule add git@github.com:muroc-aero/range-safety.git packages/range-safety`.
- [ ] **Workspace hygiene (the-hangar).** Move `hangar-range-safety`
      (and `hangar-viewer`) out of the committed root `pyproject.toml`
      member / dependency lists; add them conditionally in
      `scripts/dev-setup.sh` so an open-only clone (`--pypi`, no private
      submodule) `uv sync`s cleanly.
- [ ] **Results-reader seam (the-hangar).** Extract read-only query
      functions + schema constants from `hangar.omd.db` into
      `hangar-results-reader`; re-export from `hangar.omd.db`. Repoint the
      existing range-safety assertions at the seam.
- [ ] **Verify.** `git clone --recurse-submodules` + `dev-setup.sh`
      yields a working full-stack env; `dev-setup.sh --pypi` without the
      submodule still passes the open test suite.
- [ ] **Docs move.** These `docs/` files travel into the range-safety
      repo as its initial documentation.

## Phase 1 -- Backend: state machine + read model

Goal: the Python core, fully testable without a frontend. This is the
part that validates the the-hangar interfaces.

- [ ] `dashboard/read_model.py` -- read-only access to provenance, plan,
      run results, decisions, diffs, through the results-reader seam and
      the plot adapter. See `DESIGN_data_contract.md`.
- [ ] `dashboard/state_machine.py` -- the five states, transitions, and
      feedback arrows; current-state inference from provenance + plan
      status. See `DESIGN_state_machine.md`.
- [ ] Element-level plan diff (the-hangar `provenance_diff` is shallow;
      the dashboard computes a deeper, per-element diff for the plan-diff
      view).
- [ ] `dashboard/app.py` -- Starlette routes exposing the state machine
      and each view's data as JSON, plus server-rendered fragments.
- [ ] Tests against fixture provenance DBs + plans (reuse the existing
      `tests/` fixtures).

## Phase 2 -- Views (server-driven, htmx + Cytoscape)

Goal: the six views, each backed by a read-model method. See
`DESIGN_views.md`.

- [ ] Requirements view (Gather Requirements).
- [ ] Plan view + plan-diff graph view + study view (Planning).
- [ ] Results / visualization / plots views (Executing), built on the
      plot adapter and provenance reader.
- [ ] Reasoning-trace view linking results to observations, reasoning
      objects, and requirements (Verifying).
- [ ] Report / summary dashboard (Concluding).
- [ ] Top-level dashboard: current state, history, planned next step.

## Phase 3 -- Deploy

- [ ] Dockerfile that installs the workspace with the submodule resolved
      at build time.
- [ ] CI deploy key for the private repo; image build + push.
- [ ] Wire into `lakesideai-infra` docker-compose + Caddy route.
- [ ] Auth: reuse the viewer's OIDC / basic-auth path.

## Phase 4 -- Human-in-the-loop and editable graphs (next version)

Out of scope for this version; design hooks now, build later.

- [ ] Write-back interface: engineer-entered changes (edit a
      requirement, override a decision, adjust a DV bound) captured as
      new plan versions / decision entities, then re-incorporated.
- [ ] Editable node graphs: drag-edit plan / study / reasoning graphs.
      This is the most likely trigger to introduce a per-view SPA
      component (e.g. React-Flow) against the existing JSON API. The
      API-first design in Phase 1 exists specifically to make this a
      bolt-on, not a rewrite.

## Open items to settle during Phase 0/1

- Results-reader seam: exact module name and the set of functions /
  constants to move.
- Submodule URL scheme for CI (deploy key vs token).
- Whether the dashboard mounts under the existing viewer app or runs as
  its own Starlette app behind the same Caddy host.
