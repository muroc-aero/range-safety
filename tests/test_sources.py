"""Tests for the multi-source seam: SdkSessionSource + MultiSource dispatch.

The autouse ``isolate_omd_data`` fixture points OMD_* and HANGAR_DATA_DIR at a
per-test temp dir, so both the omd analysis DB / plan store and the sdk
sessions.db / ArtifactStore are isolated.
"""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from starlette.testclient import TestClient

from hangar.omd.db import init_analysis_db, record_entity, record_run_case
from hangar.range_safety.dashboard import state_machine
from hangar.range_safety.dashboard.app import app
from hangar.range_safety.dashboard.sources import (
    MultiSource,
    SdkSessionSource,
    split_key,
    _sdk_checks,
    _sdk_headline,
)


def _seed_sdk_session(tmp: Path) -> tuple[str, str]:
    """Seed an sdk session (tool calls + decision) and one artifact."""
    from hangar.sdk.artifacts.store import ArtifactStore
    from hangar.sdk.provenance import db as sdb

    sdb.init_db(None)  # resolves to {HANGAR_DATA_DIR}/.provenance/sessions.db
    sid = "sess-test-1"
    sdb.record_session(sid)
    sdb.record_tool_call("call-0", sid, 0, "create_surface", "{}", "{}", "ok", None,
                         "2026-01-01T00:00:00+00:00", 0.1)
    sdb.record_decision("dec-0", sid, 1, "mesh_resolution", "use a fine mesh",
                        "call-0", "num_y=15", "high")
    sdb.record_tool_call("call-1", sid, 2, "run_aero_analysis", "{}", "{}", "ok", None,
                         "2026-01-01T00:00:01+00:00", 1.0)

    run_id = ArtifactStore().save(
        session_id=sid, analysis_type="aero", tool_name="run_aero_analysis",
        surfaces=["wing"], parameters={"alpha": 5.0},
        results={"CL": 0.52, "CD": 0.011, "surfaces": {}},
    )
    return sid, run_id


# ---------------------------------------------------------------------------
# split_key
# ---------------------------------------------------------------------------


def test_split_key():
    assert split_key("omd:study-1") == ("omd", "study-1")
    assert split_key("sdk:sess-9") == ("sdk", "sess-9")
    assert split_key("bare-id") == ("omd", "bare-id")  # default source


# ---------------------------------------------------------------------------
# sdk envelope -> normalized headline + check strip
# ---------------------------------------------------------------------------


def test_sdk_headline_orders_known_keys_and_skips_payload():
    results = {
        "CD": 0.0043, "CL": 0.47, "L_over_D": 109.7,
        "surfaces": {}, "_surface_dicts": {}, "standard_detail": {},
    }
    headline = _sdk_headline(results)
    labels = [m["label"] for m in headline]
    # Known keys lead in the stable display order; heavy/private payload drops.
    assert labels == ["CL", "CD", "L_over_D"]
    assert all(m["role"] == "metric" for m in headline)


def test_sdk_checks_maps_validation_findings():
    validation = {
        "passed": True, "error_count": 0, "warning_count": 1,
        "all_findings": [
            {"check_id": "physics.cd_positive", "passed": True,
             "message": "CD > 0", "severity": "error"},
            {"check_id": "physics.cl_reasonable", "passed": True,
             "message": "CL ok", "severity": "warning"},
        ],
    }
    groups = _sdk_checks(validation)
    assert len(groups) == 1
    group = groups[0]
    assert group["title"] == "Physics & numerics" and group["passed"] is True
    assert [i["name"] for i in group["items"]] == [
        "physics.cd_positive", "physics.cl_reasonable"]
    assert group["items"][1]["severity"] == "warning"


def test_sdk_checks_empty_without_validation():
    assert _sdk_checks(None) == []
    assert _sdk_checks({}) == []


# ---------------------------------------------------------------------------
# SdkSessionSource
# ---------------------------------------------------------------------------


def test_sdk_session_source_views(isolate_omd_data):
    sid, run_id = _seed_sdk_session(isolate_omd_data)
    src = SdkSessionSource()

    studies = {s["study_id"]: s for s in src.list_studies()}
    assert sid in studies and studies[sid]["source"] == "sdk"

    # A session with a decision infers verifying.
    state = src.get_state(sid)
    assert state["current"] == state_machine.VERIFYING
    assert state["signals"]["n_tool_calls"] == 2 and state["signals"]["n_decisions"] == 1

    # Execution graph carries tool_call + decision kinds in the shared form.
    graph = src.view_plan(sid)["graph"]
    kinds = {n["data"]["kind"] for n in graph["nodes"]}
    assert kinds == {"tool_call", "decision"}
    node_ids = {n["data"]["id"] for n in graph["nodes"]}
    for e in graph["edges"]:
        assert e["data"]["source"] in node_ids and e["data"]["target"] in node_ids

    # The reasoning trace is the same session graph.
    assert src.view_reasoning(sid)["graph"]["nodes"]

    # The artifact shows up as a run with scalar results and plot types.
    runs = src.list_runs(sid)
    assert any(r["run_id"] == run_id for r in runs)
    results = src.view_results(run_id)
    assert results["final"]["CL"] == 0.52
    assert "planform" in src.plot_types(run_id)  # aero analysis_type

    # No requirements were set for this session, so the view stays empty.
    assert src.view_requirements(sid)["requirements"] == []
    assert src.view_plan_diff(sid)["changes"] == []


def test_sdk_persisted_requirements_replay(isolate_omd_data):
    """Requirements persisted by set_requirements replay into the Gather view."""
    from hangar.sdk.provenance import db as sdb

    sid, _ = _seed_sdk_session(isolate_omd_data)
    sdb.record_requirements(sid, [
        {"path": "CL", "operator": ">=", "value": 0.4, "label": "min_CL"},
        {"path": "surfaces.wing.failure", "operator": "<", "value": 1.0},
    ])
    src = SdkSessionSource()

    reqs = src.view_requirements(sid)["requirements"]
    assert len(reqs) == 2
    # Labelled requirement keeps its label as id/text; criteria carry the assertion.
    assert reqs[0]["id"] == "min_CL"
    assert reqs[0]["acceptance_criteria"][0] == {
        "metric": "CL", "comparator": ">=", "threshold": 0.4}
    # Unlabelled requirement falls back to a positional id and expression text.
    assert reqs[1]["id"] == "R2"
    assert reqs[1]["status"] == "open" and reqs[1]["priority"] is None

    # Gather-Requirements coverage flips to populated; report counts them open.
    coverage = src.get_state(sid)["coverage"]
    assert coverage[state_machine.GATHER_REQUIREMENTS] == state_machine.POPULATED
    assert src.view_report(sid)["scorecard"]["open"] == 2


def test_sdk_requirements_only_session_infers_gathering(isolate_omd_data):
    """A session with requirements but no tool calls is in Gather Requirements."""
    from hangar.sdk.provenance import db as sdb

    sdb.init_db(None)
    sid = "sess-req-only"
    sdb.record_session(sid)
    sdb.record_requirements(sid, [{"path": "CL", "operator": ">=", "value": 0.4}])

    state = SdkSessionSource().get_state(sid)
    assert state["current"] == state_machine.GATHER_REQUIREMENTS
    assert state["coverage"][state_machine.GATHER_REQUIREMENTS] == state_machine.POPULATED


# ---------------------------------------------------------------------------
# Conclusion artifacts (concluding stage)
# ---------------------------------------------------------------------------


def test_conclusion_signal_drives_coverage_and_inference():
    """A conclusion entity alone makes Concluding populated and inferred."""
    plan = {"requirements": [{"id": "R1", "priority": "primary", "status": "open"}]}
    dag = {
        "entities": [{"entity_type": "conclusion", "entity_id": "conclusion-r1"}],
        "edges": [], "activities": [],
    }
    assert state_machine.compute_signals(plan, dag)["n_conclusions"] == 1
    assert state_machine.compute_coverage(plan, dag)[state_machine.CONCLUDING] == \
        state_machine.POPULATED
    inferred = state_machine.infer_current_state(plan, dag)
    assert inferred["current"] == state_machine.CONCLUDING
    assert inferred["confidence"] >= 0.9


def test_omd_conclusion_end_to_end(isolate_omd_data):
    """record_conclusion populates Concluding, the report, and the requirement edge."""
    from hangar.omd.run import record_conclusion
    from hangar.range_safety.dashboard.read_model import ReadModel

    tmp = isolate_omd_data
    plan = {
        "metadata": {"id": "wing-opt", "name": "Wing", "version": 1},
        "components": [{"id": "wing", "type": "oas/AeroPoint", "config": {"surfaces": []}}],
        "requirements": [
            {"id": "R1", "text": "cruise lift", "priority": "primary",
             "acceptance_criteria": [{"metric": "CL", "comparator": ">=", "threshold": 0.4}]},
        ],
    }
    plan_dir = tmp / "plans" / "wing-opt"
    plan_dir.mkdir(parents=True)
    (plan_dir / "v1.yaml").write_text(yaml.safe_dump(plan))

    init_analysis_db(tmp / "analysis.db")
    plan_entity = "wing-opt/v1"
    record_entity(plan_entity, "plan", "test", plan_id="wing-opt", version=1)
    record_entity(f"{plan_entity}/req/R1", "requirement", "test", plan_id="wing-opt",
                  version=1, metadata=json.dumps(plan["requirements"][0]))
    record_entity("run-1", "run_record", "test", plan_id="wing-opt")
    record_run_case("run-1", 0, "final", {"CL": 0.5})

    rm = ReadModel()
    # Before: no conclusion artifact, requirement still open -> not concluding.
    assert rm.get_state("wing-opt")["coverage"][state_machine.CONCLUDING] != \
        state_machine.POPULATED

    result = record_conclusion("run-1", plan, "wing-opt", narrative="meets cruise lift")
    assert result["verdict"] == "meets"

    # After: Concluding populated + inferred current.
    state = rm.get_state("wing-opt")
    assert state["current"] == state_machine.CONCLUDING
    assert state["coverage"][state_machine.CONCLUDING] == state_machine.POPULATED

    # Report surfaces the conclusion with its verdict and per-requirement breakdown.
    report = rm.view_report("wing-opt")
    assert len(report["conclusions"]) == 1
    c = report["conclusions"][0]
    assert c["verdict"] == "meets" and c["narrative"] == "meets cruise lift"
    assert c["requirements"][0]["verdict"] == "satisfies"

    # The satisfies edge surfaces as a verification edge on the requirement.
    reqs = rm.view_requirements("wing-opt")["requirements"]
    rels = {e["relation"] for e in reqs[0]["verification_edges"]}
    assert "satisfies" in rels


# ---------------------------------------------------------------------------
# MultiSource dispatch
# ---------------------------------------------------------------------------


def test_multisource_dispatches_by_prefix(isolate_omd_data):
    tmp = isolate_omd_data

    # An omd plan + study.
    plan = {
        "metadata": {"id": "study-1", "name": "Demo", "version": 1},
        "components": [{"id": "wing", "type": "oas/AerostructPoint", "config": {"surfaces": []}}],
        "requirements": [{"id": "R1", "text": "x", "priority": "primary", "status": "verified"}],
    }
    plan_dir = tmp / "plans" / "study-1"
    plan_dir.mkdir(parents=True)
    (plan_dir / "v1.yaml").write_text(yaml.safe_dump(plan))
    init_analysis_db(tmp / "analysis.db")
    record_entity("study-1/v1", "plan", "test", plan_id="study-1", version=1)
    record_entity("run-1", "run_record", "test", plan_id="study-1", version=1)
    record_entity("assess-1", "assessment", "test", plan_id="study-1")
    record_run_case("run-1", 0, "final", {"structural_mass": 950.0})

    sid, _ = _seed_sdk_session(tmp)

    ms = MultiSource()
    assert set(ms.sources) >= {"omd", "sdk"}

    studies = {s["key"]: s for s in ms.list_studies()}
    assert "omd:study-1" in studies and f"sdk:{sid}" in studies

    # Dispatch routes to the right source.
    assert ms.get_state("omd:study-1")["current"] == state_machine.CONCLUDING
    assert ms.get_state(f"sdk:{sid}")["current"] == state_machine.VERIFYING
    # Unprefixed defaults to omd.
    assert ms.get_state("study-1")["current"] == state_machine.CONCLUDING

    # Run ids are re-prefixed so run-scoped routes dispatch back.
    sdk_runs = ms.list_runs(f"sdk:{sid}")
    assert sdk_runs and sdk_runs[0]["run_id"].startswith("sdk:")
    res = ms.view_results(sdk_runs[0]["run_id"])
    assert res["final"] and res["run_id"].startswith("sdk:")


def test_list_studies_sorted_newest_first(isolate_omd_data):
    tmp = isolate_omd_data
    init_analysis_db(tmp / "analysis.db")
    record_entity("old/v1", "plan", "t", plan_id="old", version=1)
    record_entity("new/v1", "plan", "t", plan_id="new", version=1)
    studies = MultiSource().list_studies()
    keys = [s["key"] for s in studies]
    assert "omd:old" in keys and "omd:new" in keys
    # The list is ordered by the 'updated' timestamp, newest first.
    ups = [s.get("updated") or "" for s in studies]
    assert ups == sorted(ups, reverse=True)


def test_shell_filters_by_source_and_text(isolate_omd_data):
    tmp = isolate_omd_data
    init_analysis_db(tmp / "analysis.db")
    record_entity("wing-opt/v1", "plan", "t", plan_id="wing-opt", version=1)
    record_entity("engine-sizing/v1", "plan", "t", plan_id="engine-sizing", version=1)
    _seed_sdk_session(tmp)

    client = TestClient(app)
    # Source filter: omd only -> no [sdk] options.
    omd_only = client.get("/?src=omd").text
    assert "[omd]" in omd_only and "[sdk]" not in omd_only
    # Text filter: substring on the analysis id.
    filtered = client.get("/?q=wing").text
    assert "wing-opt" in filtered and "engine-sizing" not in filtered


# ---------------------------------------------------------------------------
# End-to-end replay: a real omd optimization rendered through the dashboard
# (mirrors omd's own e2e eval, at the paraboloid's low cost).
# ---------------------------------------------------------------------------


def test_replay_omd_optimization_e2e(isolate_omd_data):
    from hangar.omd.run import run_plan

    tmp = isolate_omd_data
    plan = {
        "metadata": {"id": "parab", "name": "Paraboloid", "version": 1},
        "operating_points": {"x": 0.0, "y": 0.0},
        "components": [{"id": "paraboloid", "type": "paraboloid/Paraboloid", "config": {}}],
        "design_variables": [
            {"name": "x", "lower": -50.0, "upper": 50.0},
            {"name": "y", "lower": -50.0, "upper": 50.0},
        ],
        "objective": {"name": "paraboloid.f_xy"},
        "optimizer": {"type": "SLSQP", "options": {"maxiter": 50}},
        "requirements": [{"id": "R1", "text": "reach optimum", "priority": "primary",
                          "status": "open"}],
    }
    plan_path = tmp / "plan.yaml"
    plan_path.write_text(yaml.safe_dump(plan))
    result = run_plan(plan_path, mode="optimize", recording_level="driver",
                      db_path=tmp / "analysis.db")
    assert result["status"] in ("converged", "completed")
    run_id = result["run_id"]

    ms = MultiSource()

    # The omd study is listed and its state is inferred from real provenance.
    assert "omd:parab" in {s["key"] for s in ms.list_studies()}
    state = ms.get_state("omd:parab")
    assert state["current"] in (state_machine.EXECUTING, state_machine.VERIFYING,
                                state_machine.CONCLUDING)

    # The plan view is the omd PLAN DETAIL graph (plan/problem structure),
    # not the provenance DAG: plan root + design variables + objective.
    pv = ms.view_plan("omd:parab")
    assert pv["graph_style"] == "plan_detail"
    node_types = {n["data"]["node_type"] for n in pv["graph"]["nodes"]}
    assert "plan" in node_types and "design_variable" in node_types
    assert "objective" in node_types

    # Results read the real final objective.
    runs = ms.list_runs("omd:parab")
    assert runs and runs[0]["run_id"] == f"omd:{run_id}"
    results = ms.view_results(f"omd:{run_id}")
    assert results["final"]["paraboloid.f_xy"] < -27.0  # analytic optimum is -82/3

    # Headline projection surfaces the plan objective first, by name.
    headline = results["headline"]
    assert headline and headline[0]["role"] == "objective"
    assert headline[0]["label"] == "f_xy"
    assert headline[0]["value"] < -27.0

    # Optimization history carries the objective + DV trajectories, downsampled.
    hist = results["opt_history"]
    assert hist["iterations"] and len(hist["iterations"]) <= 100
    assert hist["objective"]["label"] == "f_xy"
    assert len(hist["objective"]["values"]) == len(hist["iterations"])
    dv_labels = {d["label"] for d in hist.get("design_variables", [])}
    assert {"x", "y"} <= dv_labels

    # Plots render through the omd recorder path (factory-aware), PNG bytes.
    types = ms.plot_types(f"omd:{run_id}")
    assert "convergence" in types and "n2" not in types
    png = ms.plot_png(f"omd:{run_id}", "convergence")
    assert png[:4] == b"\x89PNG"
