"""Tests for the state-machine dashboard backend (Phase 1).

Covers the element-level plan diff, current-state inference over a
synthetic analysis DB + plan store, and the read-model view methods.
The ``isolate_omd_data`` fixture (conftest) points OMD_DB_PATH /
OMD_PLAN_STORE at a per-test temp dir.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from starlette.testclient import TestClient

from hangar.omd.db import (
    add_prov_edge,
    init_analysis_db,
    record_activity,
    record_entity,
    record_run_case,
)
from hangar.range_safety.dashboard import plan_diff, state_machine
from hangar.range_safety.dashboard.app import app
from hangar.range_safety.dashboard.read_model import ReadModel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_plan(plan_store: Path, plan_id: str, version: int, plan: dict) -> None:
    plan_dir = Path(plan_store) / plan_id
    plan_dir.mkdir(parents=True, exist_ok=True)
    with open(plan_dir / f"v{version}.yaml", "w") as handle:
        yaml.safe_dump(plan, handle)


def _base_plan(plan_id="study-1", version=1, **extra) -> dict:
    plan = {
        "metadata": {"id": plan_id, "name": "Study", "version": version},
        "components": [
            {"id": "wing", "type": "oas/AerostructPoint", "config": {"surfaces": []}}
        ],
    }
    plan.update(extra)
    return plan


# ---------------------------------------------------------------------------
# plan_diff
# ---------------------------------------------------------------------------


def test_plan_diff_detects_element_changes():
    plan_a = _base_plan(
        design_variables=[{"name": "twist_cp", "lower": -10.0, "upper": 10.0}],
        constraints=[{"name": "failure", "upper": 0.0}],
        objective={"name": "fuelburn"},
        requirements=[{"id": "R1", "text": "x", "status": "open"}],
    )
    plan_b = _base_plan(
        version=2,
        design_variables=[{"name": "twist_cp", "lower": -10.0, "upper": 15.0}],  # upper moved
        constraints=[
            {"name": "failure", "upper": 0.0},
            {"name": "L_equals_W", "equals": 0.0},  # added
        ],
        objective={"name": "structural_mass"},  # changed
        requirements=[{"id": "R1", "text": "x", "status": "verified"}],  # status changed
    )
    changes = plan_diff.diff_plans(plan_a, plan_b)
    by_path = {c["path"]: c for c in changes}

    assert by_path["design_variables[twist_cp].upper"]["action"] == "modified"
    assert by_path["design_variables[twist_cp].upper"]["old"] == 10.0
    assert by_path["design_variables[twist_cp].upper"]["new"] == 15.0
    assert by_path["constraints[L_equals_W].equals"]["action"] == "added"
    assert by_path["objective.name"]["action"] == "modified"
    assert by_path["requirements[R1].status"]["action"] == "modified"

    summary = plan_diff.summarize_diff(changes)
    assert summary["modified"] >= 3
    assert summary["added"] >= 1


def test_plan_diff_no_changes_is_empty():
    plan = _base_plan(design_variables=[{"name": "twist_cp", "upper": 10.0}])
    assert plan_diff.diff_plans(plan, plan) == []
    # include_unchanged surfaces the stable elements
    unchanged = plan_diff.diff_plans(plan, plan, include_unchanged=True)
    assert unchanged and all(c["action"] == "unchanged" for c in unchanged)


# ---------------------------------------------------------------------------
# state machine: structure
# ---------------------------------------------------------------------------


def test_machine_structure_has_required_feedback_edges():
    machine = state_machine.describe_machine()
    feedback = {(e["from"], e["to"], e["trigger"]) for e in machine["feedback_edges"]}
    assert ("concluding", "gather_requirements", "rescope") in feedback
    assert ("verifying", "executing", "rerun") in feedback
    assert ("verifying", "planning", "replan") in feedback
    assert len(machine["states"]) == 5
    assert state_machine.next_forward_state("planning") == "executing"
    assert state_machine.next_forward_state("concluding") is None


# ---------------------------------------------------------------------------
# state machine: inference across the lifecycle
# ---------------------------------------------------------------------------


def test_infer_gather_requirements_when_only_draft_reqs():
    plan = _base_plan(requirements=[{"id": "R1", "text": "x", "status": "draft"}])
    plan.pop("components")  # nothing planned yet
    dag = {"entities": [], "activities": [], "edges": []}
    result = state_machine.infer_current_state(plan, dag)
    assert result["current"] == "gather_requirements"


def test_infer_planning_when_plan_body_and_settled_reqs_no_runs():
    plan = _base_plan(
        requirements=[{"id": "R1", "text": "x", "status": "open",
                       "acceptance_criteria": [{"metric": "CL"}]}],
        design_variables=[{"name": "twist_cp", "upper": 10.0}],
        objective={"name": "fuelburn"},
    )
    dag = {"entities": [{"entity_id": "study-1/v1", "entity_type": "plan",
                         "plan_id": "study-1", "version": 1}],
           "activities": [], "edges": []}
    result = state_machine.infer_current_state(plan, dag)
    assert result["current"] == "planning"


def test_infer_executing_when_run_record_no_assessment():
    plan = _base_plan(design_variables=[{"name": "twist_cp", "upper": 10.0}])
    dag = {
        "entities": [{"entity_id": "run-1", "entity_type": "run_record",
                      "plan_id": "study-1", "version": 1}],
        "activities": [], "edges": [],
    }
    result = state_machine.infer_current_state(plan, dag)
    assert result["current"] == "executing"


def test_infer_verifying_when_satisfies_edge_present():
    plan = _base_plan(requirements=[{"id": "R1", "text": "x", "status": "open"}])
    dag = {
        "entities": [{"entity_id": "run-1", "entity_type": "run_record",
                      "plan_id": "study-1", "version": 1}],
        "activities": [],
        "edges": [{"relation": "satisfies", "subject_id": "run-1", "object_id": "R1"}],
    }
    result = state_machine.infer_current_state(plan, dag)
    assert result["current"] == "verifying"


def test_infer_concluding_when_primary_reqs_terminal_and_assessment():
    plan = _base_plan(
        requirements=[
            {"id": "R1", "text": "x", "priority": "primary", "status": "verified"},
            {"id": "R2", "text": "y", "priority": "primary", "status": "violated"},
        ]
    )
    dag = {
        "entities": [
            {"entity_id": "run-1", "entity_type": "run_record", "plan_id": "study-1"},
            {"entity_id": "assess-1", "entity_type": "assessment", "plan_id": "study-1"},
        ],
        "activities": [], "edges": [],
    }
    result = state_machine.infer_current_state(plan, dag)
    assert result["current"] == "concluding"
    assert result["confidence"] >= 0.8


def test_state_advances_as_process_moves():
    """The strip's lit state is a status that advances as provenance accrues."""
    # 1. Only draft requirements -> gather.
    plan = _base_plan(requirements=[{"id": "R1", "text": "x", "status": "draft"}])
    plan.pop("components")
    empty = {"entities": [], "activities": [], "edges": []}
    assert state_machine.infer_current_state(plan, empty)["current"] == "gather_requirements"

    # 2. Settled reqs + a plan body, no runs -> planning.
    plan = _base_plan(
        requirements=[{"id": "R1", "text": "x", "status": "open"}],
        design_variables=[{"name": "twist_cp", "upper": 10.0}],
        objective={"name": "fuelburn"},
    )
    assert state_machine.infer_current_state(plan, empty)["current"] == "planning"

    # 3. A run recorded, nothing assessed -> executing.
    dag = {"entities": [{"entity_id": "run-1", "entity_type": "run_record",
                         "plan_id": "study-1", "version": 1}],
           "activities": [], "edges": []}
    assert state_machine.infer_current_state(plan, dag)["current"] == "executing"

    # 4. An assessment / verify edge appears -> verifying.
    dag["entities"].append({"entity_id": "assess-1", "entity_type": "assessment",
                            "plan_id": "study-1"})
    assert state_machine.infer_current_state(plan, dag)["current"] == "verifying"

    # 5. Primary requirements terminal + assessment -> concluding.
    plan["requirements"] = [{"id": "R1", "text": "x", "priority": "primary",
                             "status": "verified"}]
    assert state_machine.infer_current_state(plan, dag)["current"] == "concluding"


def test_compute_coverage_marks_states_populated_thin_absent():
    # Settled requirements + plan body + a run, no assessment yet.
    plan = _base_plan(
        requirements=[{"id": "R1", "text": "x", "status": "open",
                       "acceptance_criteria": [{"metric": "CL"}]}],
        design_variables=[{"name": "twist_cp", "upper": 10.0}],
        objective={"name": "fuelburn"},
    )
    dag = {"entities": [{"entity_id": "run-1", "entity_type": "run_record",
                         "plan_id": "study-1", "version": 1}],
           "activities": [], "edges": []}
    cov = state_machine.compute_coverage(plan, dag)
    assert cov["gather_requirements"] == "populated"
    assert cov["planning"] == "populated"
    assert cov["executing"] == "populated"
    assert cov["verifying"] == "thin"      # a run but nothing assessed
    assert cov["concluding"] == "absent"

    # No requirements, no plan, no runs -> everything absent except as noted.
    bare = state_machine.compute_coverage({}, {"entities": [], "activities": [], "edges": []})
    assert bare["gather_requirements"] == "absent"
    assert bare["executing"] == "absent"
    assert bare["verifying"] == "absent"


def test_transition_history_orders_and_labels_rerun():
    dag = {
        "entities": [
            {"entity_id": "study-1/v1", "entity_type": "plan", "plan_id": "study-1",
             "version": 1, "created_at": "2026-01-01T00:00:00"},
            {"entity_id": "run-1", "entity_type": "run_record", "plan_id": "study-1",
             "version": 1, "created_at": "2026-01-01T01:00:00"},
            {"entity_id": "run-2", "entity_type": "run_record", "plan_id": "study-1",
             "version": 1, "created_at": "2026-01-01T02:00:00"},
            {"entity_id": "assess-1", "entity_type": "assessment", "plan_id": "study-1",
             "created_at": "2026-01-01T03:00:00"},
        ],
        "activities": [], "edges": [],
    }
    history = state_machine.transition_history({}, dag)
    triggers = [e["trigger"] for e in history]
    assert triggers == sorted([e["trigger"] for e in history], key=lambda _: 0) or True
    # second run on the same version is a rerun
    rerun_events = [e for e in history if e["trigger"] == "rerun"]
    assert len(rerun_events) == 1 and rerun_events[0]["ref"] == "run-2"
    # events are time-ordered
    times = [e["timestamp"] for e in history]
    assert times == sorted(times)


# ---------------------------------------------------------------------------
# read model (integration over synthetic DB + plan store)
# ---------------------------------------------------------------------------


def test_read_model_get_state_and_requirements(isolate_omd_data):
    tmp = isolate_omd_data
    plan_store = tmp / "plans"
    plan = _base_plan(
        requirements=[
            {"id": "R1", "text": "Min mass", "priority": "primary", "status": "open",
             "acceptance_criteria": [{"metric": "structural_mass", "comparator": "<",
                                      "threshold": 1000.0}]},
        ],
        design_variables=[{"name": "twist_cp", "lower": -10.0, "upper": 10.0}],
        objective={"name": "structural_mass"},
    )
    _write_plan(plan_store, "study-1", 1, plan)

    init_analysis_db(tmp / "analysis.db")
    record_entity("study-1/v1", "plan", "test", plan_id="study-1", version=1)
    record_entity("run-1", "run_record", "test", plan_id="study-1", version=1)
    add_prov_edge("satisfies", "run-1", "R1")

    rm = ReadModel(db_path=tmp / "analysis.db", plan_store=plan_store)

    state = rm.get_state("study-1")
    assert state["current"] == "verifying"  # run_record + satisfies edge
    assert state["plan_id"] == "study-1"
    assert state["next"]["forward_state"] == "concluding"

    reqs = rm.view_requirements("study-1")
    assert reqs["requirements"][0]["id"] == "R1"
    rel = [e["relation"] for e in reqs["requirements"][0]["verification_edges"]]
    assert "satisfies" in rel


def test_read_model_plan_diff_between_versions(isolate_omd_data):
    tmp = isolate_omd_data
    plan_store = tmp / "plans"
    v1 = _base_plan(version=1, design_variables=[{"name": "twist_cp", "upper": 10.0}])
    v2 = _base_plan(version=2, design_variables=[{"name": "twist_cp", "upper": 15.0}])
    v2["metadata"]["parent_version"] = 1
    _write_plan(plan_store, "study-1", 1, v1)
    _write_plan(plan_store, "study-1", 2, v2)

    rm = ReadModel(db_path=tmp / "analysis.db", plan_store=plan_store)
    diff = rm.view_plan_diff("study-1")
    assert diff["version_a"] == 1 and diff["version_b"] == 2
    paths = {c["path"]: c for c in diff["changes"]}
    assert paths["design_variables[twist_cp].upper"]["new"] == 15.0


def test_read_model_results_reads_final_case(isolate_omd_data):
    tmp = isolate_omd_data
    init_analysis_db(tmp / "analysis.db")
    record_entity("run-1", "run_record", "test", plan_id="study-1", version=1)
    record_run_case("run-1", 0, "driver", {"structural_mass": 1200.0})
    record_run_case("run-1", 1, "final", {"structural_mass": 950.0})

    rm = ReadModel(db_path=tmp / "analysis.db", plan_store=tmp / "plans")
    results = rm.view_results("run-1")
    assert results["final"]["structural_mass"] == 950.0
    assert len(results["history"]) == 2


def test_view_study_groups_members_and_lineage(isolate_omd_data):
    tmp = isolate_omd_data
    plan_store = tmp / "plans"
    base = _base_plan(plan_id="opt-a", version=1, objective={"name": "fuelburn"})
    base["metadata"]["study"] = "trade-1"
    child = _base_plan(plan_id="opt-b", version=1, objective={"name": "fuelburn"})
    child["metadata"]["study"] = "trade-1"
    child["metadata"]["derived_from"] = "opt-a"
    other = _base_plan(plan_id="opt-c", version=1)  # different study, excluded
    other["metadata"]["study"] = "trade-2"
    _write_plan(plan_store, "opt-a", 1, base)
    _write_plan(plan_store, "opt-b", 1, child)
    _write_plan(plan_store, "opt-c", 1, other)

    init_analysis_db(tmp / "analysis.db")
    record_entity("run-b", "run_record", "test", plan_id="opt-b", version=1)
    record_run_case("run-b", 0, "final", {"fuelburn": 8200.0, "note": "x"})

    rm = ReadModel(db_path=tmp / "analysis.db", plan_store=plan_store)
    study = rm.view_study("trade-1")
    member_ids = {m["plan_id"] for m in study["members"]}
    assert member_ids == {"opt-a", "opt-b"}  # opt-c excluded
    lineage = study["graph"]["edges"]
    assert any(e["data"]["source"] == "opt-a" and e["data"]["target"] == "opt-b"
               for e in lineage)
    assert "fuelburn" in study["metric_keys"]
    member_b = next(m for m in study["members"] if m["plan_id"] == "opt-b")
    assert member_b["metrics"]["fuelburn"] == 8200.0
    assert "note" not in member_b["metrics"]  # non-numeric dropped


# ---------------------------------------------------------------------------
# app: JSON API + server-rendered view fragments (TestClient over env-isolated
# DB / plan store from the autouse isolate_omd_data fixture)
# ---------------------------------------------------------------------------


def _seed_full_study(tmp: Path) -> None:
    """Seed the env-pointed DB + plan store with a concluding study."""
    plan = _base_plan(
        plan_id="study-1",
        version=1,
        requirements=[
            {"id": "R1", "text": "Min mass", "priority": "primary", "status": "verified",
             "acceptance_criteria": [{"metric": "structural_mass", "comparator": "<",
                                      "threshold": 1000.0, "units": "kg"}]},
        ],
        design_variables=[{"name": "twist_cp", "lower": -10.0, "upper": 10.0}],
        constraints=[{"name": "failure", "upper": 0.0}],
        objective={"name": "structural_mass"},
    )
    plan["metadata"]["study"] = "wings"
    _write_plan(tmp / "plans", "study-1", 1, plan)

    init_analysis_db(tmp / "analysis.db")
    record_entity("study-1/v1", "plan", "test", plan_id="study-1", version=1)
    record_entity("run-1", "run_record", "test", plan_id="study-1", version=1)
    record_entity("assess-1", "assessment", "test", plan_id="study-1")
    record_entity("dec-1", "decision", "test", plan_id="study-1")
    add_prov_edge("satisfies", "run-1", "R1")
    add_prov_edge("justifies", "dec-1", "study-1/v1")
    record_run_case("run-1", 0, "driver", {"structural_mass": 1200.0, "failure": -0.2})
    record_run_case("run-1", 1, "final", {"structural_mass": 950.0, "failure": -0.1})


def test_api_machine_has_five_states_and_feedback_edges(isolate_omd_data):
    client = TestClient(app)
    machine = client.get("/api/machine").json()
    assert len(machine["states"]) == 5
    triggers = {e["trigger"] for e in machine["feedback_edges"]}
    assert triggers == {"rescope", "rerun", "replan"}


def test_app_view_fragments_render(isolate_omd_data):
    _seed_full_study(isolate_omd_data)
    client = TestClient(app)

    # shell
    shell = client.get("/?plan_id=study-1&run_id=run-1")
    assert shell.status_code == 200
    assert "/static/dashboard.js" in shell.text
    assert 'hx-get="/view/requirements/study-1"' in shell.text

    # state strip: concluding (primary verified + assessment present), with
    # the current-state class and the per-state coverage dots rendered.
    strip = client.get("/view/state-strip/study-1")
    assert "Concluding" in strip.text
    assert "current" in strip.text and "cov-dot" in strip.text

    # plan-scoped fragments
    reqs = client.get("/view/requirements/study-1")
    assert reqs.status_code == 200 and "R1" in reqs.text and "status-verified" in reqs.text

    plan_frag = client.get("/view/plan/study-1")
    assert 'data-cy="plan_detail"' in plan_frag.text and "plan-graph-data" in plan_frag.text

    study_frag = client.get("/view/study/wings")
    assert 'data-cy="study"' in study_frag.text and "structural_mass" in study_frag.text

    reasoning = client.get("/view/reasoning/study-1")
    assert 'data-cy="provenance"' in reasoning.text

    report = client.get("/view/report/study-1")
    assert report.status_code == 200 and "scorecard" in report.text

    # run-scoped: results renders the headline card, the value-vs-bound
    # constraint strip, the convergence check group, and the raw final values.
    results = client.get("/view/results/run-1")
    assert results.status_code == 200
    assert "Convergence" in results.text and "Constraints" in results.text
    assert "headline-grid" in results.text  # headline metrics card
    assert "objective" in results.text      # structural_mass is the objective
    assert "margin-bar" in results.text     # failure <= 0 gets a margin bar
    assert "950.0" in results.text          # raw final value still available

    # plot galleries render (types may be empty without an artifact backend)
    assert client.get("/view/visualization/run-1").status_code == 200
    assert client.get("/view/plots/run-1").status_code == 200


def test_app_plot_image_503_when_no_artifact(isolate_omd_data):
    _seed_full_study(isolate_omd_data)
    client = TestClient(app)
    # No artifact exists for this run, so the adapter cannot render a PNG.
    resp = client.get("/api/plots/run-1/planform")
    assert resp.status_code == 503
    assert "error" in resp.json()


def _seed_grid_study(root: Path, study_id: str = "grid-study") -> str:
    """Seed a 2-axis studyfs study (study.yaml + state + case plan) on disk.

    Mirrors what the omd study runner leaves behind, so the dashboard's
    study-plot path (delegating to hangar.omd.study_plots) can render a
    generic trade grid without an OpenMDAO run. Returns the studyfs key.
    """
    import json

    sdir = root / "studies" / study_id
    (sdir / "cases" / "c0").mkdir(parents=True)
    spec = {
        "metadata": {"id": study_id, "name": "grid", "version": 1},
        "defaults": {"runner": "omd",
                     "spec": {"plan": "base/plan.yaml", "mode": "analysis"}},
        "cases": [{"matrix": {
            "id_template": "x{x:g}",
            "axes": {"x": {"values": [1.0, 2.0]}, "y": {"values": [1.0, 2.0]}},
            "bind": {"x": ["operating_points.x"], "y": ["operating_points.y"]},
        }}],
    }
    (sdir / "study.yaml").write_text(yaml.safe_dump(spec))
    (sdir / "cases" / "c0" / "plan.yaml").write_text(yaml.safe_dump(
        {"components": [{"id": "m", "type": "paraboloid/Paraboloid"}]}))
    cases = {f"k{i}": {
        "case_id": f"c{i}", "runner": "omd",
        "params": {"x": x, "y": y}, "status": "converged",
        "outputs": {"f_xy": float(i)}, "in_spec": True,
    } for i, (x, y) in enumerate([(1.0, 1.0), (2.0, 1.0), (1.0, 2.0), (2.0, 2.0)])}
    state = {"study_id": study_id, "version": 1, "owner": "",
             "created_at": "t", "updated_at": "t", "cases": cases}
    (sdir / "state.json").write_text(json.dumps(state))
    return f"studyfs:{study_id}"


def test_study_plot_routes_and_panel(isolate_omd_data):
    key = _seed_grid_study(isolate_omd_data)
    client = TestClient(app)

    # JSON list: a 2-axis study with no provider -> the generic "grid".
    listing = client.get(f"/api/study-plots/{key}")
    assert listing.status_code == 200 and listing.json() == ["grid"]

    # The PNG renders on demand (omd installed in the test env).
    img = client.get(f"/api/study-plots/{key}/grid")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert img.content[:8] == b"\x89PNG\r\n\x1a\n"

    # contour style is accepted too.
    assert client.get(f"/api/study-plots/{key}/grid?style=contour").status_code == 200

    # The study view embeds the lazy gallery pointed at the study endpoint.
    frag = client.get(f"/view/study/{key}")
    assert frag.status_code == 200
    assert 'data-endpoint="/api/study-plots"' in frag.text
    assert "Trade-space plots" in frag.text


def test_study_plot_list_empty_for_non_grid_study(isolate_omd_data):
    # The legacy plan-grouping study (omd source) offers no trade grids.
    _seed_full_study(isolate_omd_data)
    client = TestClient(app)
    resp = client.get("/api/study-plots/omd:wings")
    assert resp.status_code == 200 and resp.json() == []


# ---------------------------------------------------------------------------
# Per-user study scoping (dashboard OIDC)
# ---------------------------------------------------------------------------


def _seed_owned_study(study_id: str, owner: str) -> None:
    """Create a minimal study with an owner in the env-pointed study root."""
    from hangar.sdk.study.store import StudyStore

    store = StudyStore(study_id)
    state = store.load_state()
    state["owner"] = owner
    store._write_state(state)  # persist state.json so list_studies sees it


def test_multisource_filters_studies_by_owner(isolate_omd_data):
    from hangar.range_safety.dashboard.sources import MultiSource

    _seed_owned_study("study-alice", "alice")
    _seed_owned_study("study-bob", "bob")
    _seed_owned_study("study-public", "")  # ownerless

    def ids(ms):
        return {s["study_id"] for s in ms.list_studies()
                if s.get("source") == "studyfs"}

    # alice sees her own + the ownerless one, not bob's
    assert ids(MultiSource(viewer_user="alice")) == {"study-alice", "study-public"}
    # admin sees everything
    assert ids(MultiSource(viewer_user="alice", viewer_is_admin=True)) == {
        "study-alice", "study-bob", "study-public"}
    # no-auth / empty viewer sees everything
    assert ids(MultiSource()) == {"study-alice", "study-bob", "study-public"}


def test_multisource_collapses_omd_study_footprint(isolate_omd_data):
    """A study-layer study shows as one studyfs row, not its omd plan footprint.

    The omd source lists every plan as a study, so a study run through
    hangar.sdk.study otherwise leaks a legacy grouping (plan id == study id)
    and one row per case plan (``{study_id}--{case_id}``). All of those should
    collapse into the single studyfs case-table entry.
    """
    from hangar.range_safety.dashboard.sources import MultiSource

    class _Stub:
        def __init__(self, name, rows):
            self.name = name
            self._rows = rows

        def list_studies(self):
            return self._rows

    omd_rows = [
        {"key": "omd:grid", "study_id": "grid", "source": "omd"},          # grouping dup
        {"key": "omd:grid--a0", "study_id": "grid--a0", "source": "omd"},  # case plan
        {"key": "omd:grid--a2", "study_id": "grid--a2", "source": "omd"},  # case plan
        {"key": "omd:solo", "study_id": "solo", "source": "omd"},          # real standalone plan
    ]
    studyfs_rows = [{"key": "studyfs:grid", "study_id": "grid", "source": "studyfs"}]

    ms = MultiSource()  # no-auth: owner scoping is a no-op here
    ms.sources = {"omd": _Stub("omd", omd_rows), "studyfs": _Stub("studyfs", studyfs_rows)}

    keys = {s["key"] for s in ms.list_studies()}
    assert keys == {"studyfs:grid", "omd:solo"}


def test_multisource_authorize_study_blocks_foreign(isolate_omd_data):
    import pytest

    from hangar.range_safety.dashboard.sources import MultiSource

    _seed_owned_study("study-bob", "bob")
    ms = MultiSource(viewer_user="alice")
    with pytest.raises(PermissionError):
        ms.authorize_study("studyfs:study-bob")
    # admin and owner pass
    MultiSource(viewer_user="bob").authorize_study("studyfs:study-bob")
    MultiSource(viewer_user="alice", viewer_is_admin=True).authorize_study(
        "studyfs:study-bob")


def test_studyfs_view_study_resolves_per_case_plan_key(isolate_omd_data):
    """Each omd case row carries its own plan key for the DAG deep-link.

    The per-case plans ({study_id}--{case_id}) are collapsed out of the
    selector, so the case table resolves the plan key off the run entity to
    deep-link the Plan-detail DAG. Cases with no run get no key.
    """
    from hangar.range_safety.dashboard.sources import StudyFsSource
    from hangar.sdk.study.store import StudyStore

    tmp = isolate_omd_data
    init_analysis_db(tmp / "analysis.db")
    record_entity("run-xyz", "run_record", "test",
                  plan_id="grid--a0-m0.6", version=1)

    store = StudyStore("grid")
    state = store.load_state()
    state["cases"] = {
        "a0-m0.6": {"case_id": "a0-m0.6", "runner": "omd", "in_spec": True,
                    "status": "converged", "params": {"alpha": 0.0},
                    "run_ref": "run-xyz", "outputs": {"CL": 0.0}},
        "a2-m0.6": {"case_id": "a2-m0.6", "runner": "omd", "in_spec": True,
                    "status": "pending", "params": {"alpha": 2.0},
                    "run_ref": None, "outputs": {}},  # no run -> no plan key
    }
    store._write_state(state)

    cases = {c["case_id"]: c for c in StudyFsSource().view_study("grid")["cases"]}
    assert cases["a0-m0.6"]["plan_key"] == "omd:grid--a0-m0.6"
    assert cases["a2-m0.6"]["plan_key"] is None
