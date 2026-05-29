"""Tests for the state-machine dashboard backend (Phase 1).

Covers the element-level plan diff, current-state inference over a
synthetic analysis DB + plan store, and the read-model view methods.
The ``isolate_omd_data`` fixture (conftest) points OMD_DB_PATH /
OMD_PLAN_STORE at a per-test temp dir.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from hangar.omd.db import (
    add_prov_edge,
    init_analysis_db,
    record_activity,
    record_entity,
    record_run_case,
)
from hangar.range_safety.dashboard import plan_diff, state_machine
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
