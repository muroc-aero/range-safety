"""Tests for constraint satisfaction assertions."""

from __future__ import annotations

from pathlib import Path

from hangar.omd.db import (
    init_analysis_db,
    record_entity,
    record_run_case,
)
from hangar.range_safety.assertions.constraints import assert_constraints


def _setup_run(db_path: Path, run_id: str, final_data: dict) -> None:
    """Insert a run with given final case data."""
    init_analysis_db(db_path)
    record_entity(
        entity_id=run_id,
        entity_type="run_record",
        created_by="test",
        plan_id="test-plan",
    )
    record_run_case(run_id, 0, "final", final_data)


def test_satisfied_constraints_pass(isolate_omd_data):
    """All constraints satisfied passes."""
    db_path = isolate_omd_data / "analysis.db"
    run_id = "run-sat-001"
    _setup_run(db_path, run_id, {"failure": -0.5, "CL": 0.5})

    plan = {
        "constraints": [
            {"name": "failure", "upper": 0.0},
        ],
    }
    result = assert_constraints(run_id, plan, db_path=db_path)
    assert result["passed"] is True


def test_violated_upper_bound_fails(isolate_omd_data):
    """Constraint violating upper bound fails."""
    db_path = isolate_omd_data / "analysis.db"
    run_id = "run-viol-001"
    _setup_run(db_path, run_id, {"failure": 0.5})

    plan = {
        "constraints": [
            {"name": "failure", "upper": 0.0},
        ],
    }
    result = assert_constraints(run_id, plan, db_path=db_path)
    assert result["passed"] is False


def test_violated_equals_fails(isolate_omd_data):
    """Constraint violating equals bound fails."""
    db_path = isolate_omd_data / "analysis.db"
    run_id = "run-eq-001"
    _setup_run(db_path, run_id, {"L_equals_W": 0.5})

    plan = {
        "constraints": [
            {"name": "L_equals_W", "equals": 0.0},
        ],
    }
    result = assert_constraints(run_id, plan, db_path=db_path)
    assert result["passed"] is False


def test_no_constraints_passes(isolate_omd_data):
    """Plan with no constraints passes trivially."""
    db_path = isolate_omd_data / "analysis.db"
    init_analysis_db(db_path)
    result = assert_constraints("any-run", {}, db_path=db_path)
    assert result["passed"] is True


def test_missing_constraint_variable_fails(isolate_omd_data):
    """Constraint variable not found in data fails."""
    db_path = isolate_omd_data / "analysis.db"
    run_id = "run-miss-001"
    _setup_run(db_path, run_id, {"CL": 0.5})

    plan = {
        "constraints": [
            {"name": "nonexistent_var", "upper": 1.0},
        ],
    }
    result = assert_constraints(run_id, plan, db_path=db_path)
    assert result["passed"] is False


def test_constraint_resolves_deep_dotted_path(isolate_omd_data):
    """A plan's partial constraint name resolves to a deeper recorder key.

    Plans name constraints by a partial path (``AS_point_0.wing_perf.failure``)
    but the recorder stores a deeper key (``...struct_funcs.failure.failure``).
    The shared resolver matches on the last segment, so it is found.
    """
    db_path = isolate_omd_data / "analysis.db"
    run_id = "run-deep-001"
    _setup_run(db_path, run_id, {
        "AS_point_0.wing_perf.struct_funcs.failure.failure": -0.04,
    })
    plan = {"constraints": [{"name": "AS_point_0.wing_perf.failure", "upper": 0.0}]}
    result = assert_constraints(run_id, plan, db_path=db_path)

    assert result["passed"] is True
    check = result["checks"][0]
    # Structured fields drive the dashboard's value-vs-bound margin bar.
    assert check["value"] == -0.04
    assert check["bound_type"] == "upper" and check["bound"] == 0.0
    assert check["margin"] is not None and check["margin"] > 0  # satisfied with room


def test_equality_constraint_has_no_margin_bar(isolate_omd_data):
    """Equality constraints carry structured fields but no slack margin."""
    db_path = isolate_omd_data / "analysis.db"
    run_id = "run-eq-margin"
    _setup_run(db_path, run_id, {"L_equals_W": 0.0})
    plan = {"constraints": [{"name": "L_equals_W", "equals": 0.0}]}
    check = assert_constraints(run_id, plan, db_path=db_path)["checks"][0]

    assert check["bound_type"] == "equals"
    assert check["value"] == 0.0
    assert check["margin"] is None  # rendered as a met/unmet chip, not a bar
