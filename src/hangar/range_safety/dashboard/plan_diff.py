"""Element-level diff between two analysis plan versions.

omd's ``hangar.omd.provenance.provenance_diff`` reports only a shallow
top-level-key diff (which sections changed). The dashboard's plan-diff
view needs to show *which* design-variable bound moved, *which* constraint
was added, *which* solver was swapped. This module flattens a plan into a
map of stable element paths and diffs two such maps.

Element paths are keyed by the natural identifier of each element so a
replan is legible at the field level, for example::

    design_variables[twist_cp].upper
    constraints[failure].upper
    requirements[R2].status
    solvers.nonlinear.type
    objective.name
    components[wing].config

The output is a list of ``{path, action, old, new}`` records with action
in ``added | removed | modified | unchanged`` (unchanged omitted unless
requested), matching DESIGN_data_contract.md.
"""

from __future__ import annotations

from typing import Any

# Fields compared per element kind. Kept explicit (rather than recursing
# arbitrarily) so the diff granularity matches what the plan-diff view
# renders. List/dict-valued fields (acceptance_criteria, config, options)
# are compared as whole values: a change shows old -> new for that field.
_REQUIREMENT_FIELDS = ("text", "type", "priority", "status", "traces_to", "acceptance_criteria")
_DV_FIELDS = ("lower", "upper", "scaler", "ref", "ref0", "units", "initial", "traces_to")
_CONSTRAINT_FIELDS = ("lower", "upper", "equals", "scaler", "units", "point", "traces_to")
_OBJECTIVE_FIELDS = ("name", "scaler", "units", "traces_to")
_OPTIMIZER_FIELDS = ("type", "options")


def flatten_plan(plan: dict) -> dict[str, Any]:
    """Flatten a plan dict into a map of element path -> value.

    Only the elements that the dashboard diffs are included. Plan
    ``metadata`` (version identity) is intentionally excluded.
    """
    out: dict[str, Any] = {}
    if not isinstance(plan, dict):
        return out

    for req in plan.get("requirements", []) or []:
        rid = req.get("id")
        if rid is None:
            continue
        base = f"requirements[{rid}]"
        for field in _REQUIREMENT_FIELDS:
            if field in req:
                out[f"{base}.{field}"] = req[field]

    for dv in plan.get("design_variables", []) or []:
        name = dv.get("name")
        if name is None:
            continue
        base = f"design_variables[{name}]"
        for field in _DV_FIELDS:
            if field in dv:
                out[f"{base}.{field}"] = dv[field]

    for con in plan.get("constraints", []) or []:
        name = con.get("name")
        if name is None:
            continue
        base = f"constraints[{name}]"
        for field in _CONSTRAINT_FIELDS:
            if field in con:
                out[f"{base}.{field}"] = con[field]

    objective = plan.get("objective")
    if isinstance(objective, dict):
        for field in _OBJECTIVE_FIELDS:
            if field in objective:
                out[f"objective.{field}"] = objective[field]

    solvers = plan.get("solvers") or {}
    for kind in ("nonlinear", "linear"):
        solver = solvers.get(kind)
        if isinstance(solver, dict):
            if "type" in solver:
                out[f"solvers.{kind}.type"] = solver["type"]
            if "options" in solver:
                out[f"solvers.{kind}.options"] = solver["options"]

    optimizer = plan.get("optimizer")
    if isinstance(optimizer, dict):
        for field in _OPTIMIZER_FIELDS:
            if field in optimizer:
                out[f"optimizer.{field}"] = optimizer[field]

    for comp in plan.get("components", []) or []:
        cid = comp.get("id")
        if cid is None:
            continue
        base = f"components[{cid}]"
        if "type" in comp:
            out[f"{base}.type"] = comp["type"]
        if "config" in comp:
            out[f"{base}.config"] = comp["config"]

    for dec in plan.get("decisions", []) or []:
        did = dec.get("id") or dec.get("decision")
        if did is None:
            continue
        out[f"decisions[{did}]"] = dec

    analysis_plan = plan.get("analysis_plan") or {}
    if "replan_triggers" in analysis_plan:
        out["analysis_plan.replan_triggers"] = analysis_plan["replan_triggers"]
    for phase in analysis_plan.get("phases", []) or []:
        pid = phase.get("id")
        if pid is not None:
            out[f"analysis_plan.phases[{pid}]"] = phase

    return out


def diff_plans(
    plan_a: dict,
    plan_b: dict,
    *,
    include_unchanged: bool = False,
) -> list[dict]:
    """Diff two plans at the element level.

    Args:
        plan_a: The earlier plan version (the "from" side).
        plan_b: The later plan version (the "to" side).
        include_unchanged: When True, emit ``unchanged`` records too
            (useful for rendering a full graph where every node carries a
            diff status). Default False emits only real changes.

    Returns:
        List of ``{path, action, old, new}`` sorted by path. ``action``
        is one of ``added``, ``removed``, ``modified``, ``unchanged``.
    """
    flat_a = flatten_plan(plan_a)
    flat_b = flatten_plan(plan_b)
    changes: list[dict] = []
    for path in sorted(set(flat_a) | set(flat_b)):
        in_a = path in flat_a
        in_b = path in flat_b
        old = flat_a.get(path)
        new = flat_b.get(path)
        if in_a and not in_b:
            changes.append({"path": path, "action": "removed", "old": old, "new": None})
        elif in_b and not in_a:
            changes.append({"path": path, "action": "added", "old": None, "new": new})
        elif old != new:
            changes.append({"path": path, "action": "modified", "old": old, "new": new})
        elif include_unchanged:
            changes.append({"path": path, "action": "unchanged", "old": old, "new": new})
    return changes


def summarize_diff(changes: list[dict]) -> dict[str, int]:
    """Count changes by action, for a plan-diff header/badge."""
    summary = {"added": 0, "removed": 0, "modified": 0, "unchanged": 0}
    for change in changes:
        action = change.get("action")
        if action in summary:
            summary[action] += 1
    return summary
