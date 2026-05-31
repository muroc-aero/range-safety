"""Post-run constraint satisfaction checks.

Verifies that all constraints specified in the plan are satisfied
at the final point of a completed run.
"""

from __future__ import annotations

from pathlib import Path

from hangar.results_reader import init_analysis_db, query_run_results, resolve_scalar


def _check(name: str, passed: bool, message: str, **extra: object) -> dict:
    """Build a check result dict.

    ``extra`` carries the optional structured fields (label, value, bound,
    bound_type, margin) the dashboard uses to draw a value-vs-bound margin
    bar. They are additive; the name/passed/message fields are unchanged.
    """
    return {"name": name, "passed": passed, "message": message, **extra}


def _signed_margin(value: float, bound: float, bound_type: str) -> float | None:
    """Signed, scale-normalized slack to an inequality bound.

    >0 means satisfied with room, ~0 means on the bound, <0 means violated.
    Normalizing by ``max(|bound|, |value|)`` keeps it well-defined even when
    the bound is zero (e.g. ``failure <= 0``), and bounds it to roughly
    [-1, 1] so a bar can render it directly. Equality constraints have no
    meaningful slack (they are met or not), so they return ``None`` and the
    strip renders them as a met/unmet chip rather than a bar.
    """
    if bound_type == "equals":
        return None
    scale = max(abs(bound), abs(value), 1e-12)
    if bound_type == "upper":
        return (bound - value) / scale
    if bound_type == "lower":
        return (value - bound) / scale
    return None


def assert_constraints(
    run_id: str,
    plan: dict,
    db_path: Path | None = None,
    tol: float = 1e-6,
) -> dict:
    """Check that all plan constraints are satisfied at the final point.

    Args:
        run_id: Run entity ID to assess.
        plan: Plan dictionary containing constraints.
        db_path: Path to analysis DB. Uses default if None.
        tol: Tolerance for constraint satisfaction.

    Returns:
        Dict with keys:
        - passed: bool (True if all constraints satisfied)
        - checks: list of check dicts (name, passed, message)
        - summary: human-readable summary string
    """
    init_analysis_db(db_path)

    checks: list[dict] = []
    constraints = plan.get("constraints", [])

    if not constraints:
        return {
            "passed": True,
            "checks": [_check(
                "no_constraints",
                True,
                "No constraints defined in plan",
            )],
            "summary": "No constraints to check",
        }

    # Get final case data
    cases = query_run_results(run_id)
    if not cases:
        return {
            "passed": False,
            "checks": [_check(
                "has_case_data",
                False,
                f"No case data for run '{run_id}'",
            )],
            "summary": "No case data available",
        }

    # Use final case, fall back to last driver case
    final_cases = [c for c in cases if c["case_type"] == "final"]
    if final_cases:
        final_data = final_cases[-1].get("data", {})
    else:
        final_data = cases[-1].get("data", {})

    # Check each constraint
    for con in constraints:
        con_name = con.get("name", "<unknown>")

        # Find the variable value in final data
        value = _find_constraint_value(con_name, final_data)
        if value is None:
            checks.append(_check(
                f"constraint_{con_name}",
                False,
                f"Constraint '{con_name}' not found in final case data",
            ))
            continue

        # Check bounds
        satisfied = True
        details = f"value={value:.6g}"
        bound_type: str | None = None
        bound: float | None = None

        if "upper" in con:
            bound_type, bound = "upper", con["upper"]
            if value > bound + tol:
                satisfied = False
                details += f", violates upper={bound} by {value - bound:.6g}"
            else:
                details += f", upper={bound} OK"

        if "lower" in con:
            bound_type, bound = "lower", con["lower"]
            if value < bound - tol:
                satisfied = False
                details += f", violates lower={bound} by {bound - value:.6g}"
            else:
                details += f", lower={bound} OK"

        if "equals" in con:
            bound_type, bound = "equals", con["equals"]
            if abs(value - bound) > tol:
                satisfied = False
                details += f", violates equals={bound} by {abs(value - bound):.6g}"
            else:
                details += f", equals={bound} OK"

        margin = (
            _signed_margin(value, bound, bound_type)
            if bound_type is not None
            else None
        )
        checks.append(_check(
            f"constraint_{con_name}",
            satisfied,
            f"Constraint '{con_name}': {details}",
            label=con_name.rsplit(".", 1)[-1],
            value=value,
            bound=bound,
            bound_type=bound_type,
            margin=margin,
        ))

    all_passed = all(c["passed"] for c in checks)
    n_satisfied = sum(1 for c in checks if c["passed"])
    summary = (
        f"Constraints: {n_satisfied}/{len(checks)} satisfied"
        if checks
        else "No constraint checks performed"
    )

    return {
        "passed": all_passed,
        "checks": checks,
        "summary": summary,
    }


def _find_constraint_value(
    con_name: str,
    data: dict,
) -> float | None:
    """Find a constraint variable's scalar value in case data.

    Delegates to the shared ``resolve_scalar`` seam resolver so constraint
    lookup matches exactly how the headline projection and opt-history
    trajectories resolve names. This also fixes a prior bug: matching the full
    partial path as a substring missed recorder keys with extra intermediate
    groups (e.g. plan ``AS_point_0.wing_perf.failure`` vs recorded
    ``AS_point_0.wing_perf.struct_funcs.failure.failure``); resolving on the
    last path segment finds it.
    """
    return resolve_scalar(data, con_name)
