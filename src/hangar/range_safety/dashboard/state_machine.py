"""The dashboard's five-state machine and current-state inference.

States model the lifecycle of an analysis study:

    gather_requirements -> planning -> executing -> verifying -> concluding

with the required feedback edges:

    concluding -> gather_requirements   (rescope)
    verifying   -> executing            (rerun)
    verifying   -> planning             (replan)

The dashboard owns no separate workflow engine. It *infers* the current
state from data already recorded in the provenance and plan stores, so it
reflects reality whether the work was driven by an agent, a CLI, or a
human. See DESIGN_state_machine.md.

All functions take plain data (a plan dict and a provenance DAG dict as
returned by ``query_provenance_dag``) and return plain JSON-able dicts.
"""

from __future__ import annotations

import json
from typing import Any

# ---------------------------------------------------------------------------
# Machine structure
# ---------------------------------------------------------------------------

GATHER_REQUIREMENTS = "gather_requirements"
PLANNING = "planning"
EXECUTING = "executing"
VERIFYING = "verifying"
CONCLUDING = "concluding"

STATES: tuple[str, ...] = (
    GATHER_REQUIREMENTS,
    PLANNING,
    EXECUTING,
    VERIFYING,
    CONCLUDING,
)

STATE_LABELS: dict[str, str] = {
    GATHER_REQUIREMENTS: "Gather Requirements",
    PLANNING: "Planning",
    EXECUTING: "Executing / Running",
    VERIFYING: "Verifying / Analyzing",
    CONCLUDING: "Concluding",
}

# Forward edges: the nominal progression.
FORWARD_EDGES: tuple[tuple[str, str], ...] = (
    (GATHER_REQUIREMENTS, PLANNING),
    (PLANNING, EXECUTING),
    (EXECUTING, VERIFYING),
    (VERIFYING, CONCLUDING),
)

# Feedback edges: (from, to, trigger). First-class in the model, not just
# UI arrows -- each backward transition is recorded with a reason.
FEEDBACK_EDGES: tuple[tuple[str, str, str], ...] = (
    (CONCLUDING, GATHER_REQUIREMENTS, "rescope"),
    (VERIFYING, EXECUTING, "rerun"),
    (VERIFYING, PLANNING, "replan"),
)

_TERMINAL_REQ_STATUSES = frozenset({"verified", "violated", "waived"})
_VERIFY_RELATIONS = frozenset({"verifies", "satisfies", "violates"})


def describe_machine() -> dict:
    """Return the machine definition for rendering the dashboard shell."""
    return {
        "states": [{"id": s, "label": STATE_LABELS[s]} for s in STATES],
        "forward_edges": [{"from": a, "to": b} for a, b in FORWARD_EDGES],
        "feedback_edges": [
            {"from": a, "to": b, "trigger": t} for a, b, t in FEEDBACK_EDGES
        ],
    }


def next_forward_state(current: str) -> str | None:
    """Return the next state in the forward progression, or None at the end."""
    for src, dst in FORWARD_EDGES:
        if src == current:
            return dst
    return None


def replan_triggers(plan: dict) -> list[str]:
    """Return the plan's declared replan triggers (may be empty)."""
    analysis_plan = (plan or {}).get("analysis_plan") or {}
    triggers = analysis_plan.get("replan_triggers") or []
    return [str(t) for t in triggers]


# ---------------------------------------------------------------------------
# Signal extraction
# ---------------------------------------------------------------------------


def _entities_of_type(dag: dict, entity_type: str) -> list[dict]:
    return [
        e for e in (dag.get("entities") or [])
        if e.get("entity_type") == entity_type
    ]


def _is_terminal_requirement(req: dict) -> bool:
    return req.get("status") in _TERMINAL_REQ_STATUSES


def compute_signals(plan: dict, dag: dict) -> dict[str, Any]:
    """Extract the boolean/count signals the inference rules key off of.

    Returned as a dict so the dashboard can show *why* a state was
    inferred (the confidence breakdown).
    """
    plan = plan or {}
    dag = dag or {}

    requirements = plan.get("requirements") or []
    primary = [r for r in requirements if r.get("priority") == "primary"]
    # If no requirement is explicitly flagged primary, treat all as primary
    # for the terminal-status test (a study with unprioritized requirements
    # still concludes when they are all resolved).
    primary_set = primary or requirements

    run_records = _entities_of_type(dag, "run_record")
    assessments = _entities_of_type(dag, "assessment")

    edges = dag.get("edges") or []
    verify_edges = [e for e in edges if e.get("relation") in _VERIFY_RELATIONS]
    satisfies = sum(1 for e in edges if e.get("relation") == "satisfies")
    violates = sum(1 for e in edges if e.get("relation") == "violates")
    derived_edges = [e for e in edges if e.get("relation") == "wasDerivedFrom"]

    activities = dag.get("activities") or []
    activity_in_progress = any(
        a.get("status") not in (None, "completed", "failed") for a in activities
    )

    plan_versions = {
        e.get("version") for e in _entities_of_type(dag, "plan")
        if e.get("version") is not None
    }

    has_plan_body = any(
        plan.get(key) for key in ("components", "design_variables", "constraints", "objective")
    )
    # Requirements are "settled" once at least one has moved past draft or
    # carries acceptance criteria (i.e. authoring has progressed beyond a
    # bare requirement stub).
    reqs_settled = bool(requirements) and any(
        (r.get("status") not in (None, "draft")) or r.get("acceptance_criteria")
        for r in requirements
    )

    return {
        "n_requirements": len(requirements),
        "n_primary_requirements": len(primary_set),
        "primary_requirements_terminal": bool(primary_set)
        and all(_is_terminal_requirement(r) for r in primary_set),
        "requirements_settled": reqs_settled,
        "has_plan_body": has_plan_body,
        "n_run_records": len(run_records),
        "n_assessments": len(assessments),
        "n_verify_edges": len(verify_edges),
        "n_satisfies": satisfies,
        "n_violates": violates,
        "n_plan_versions": len(plan_versions),
        "n_derived_edges": len(derived_edges),
        "activity_in_progress": activity_in_progress,
    }


# ---------------------------------------------------------------------------
# Current-state inference
# ---------------------------------------------------------------------------


def infer_current_state(plan: dict, dag: dict) -> dict:
    """Infer the current state from recorded data.

    Returns ``{current, confidence, signals}`` where confidence is a
    heuristic in [0, 1] reflecting how unambiguous the signals are.
    """
    s = compute_signals(plan, dag)

    if s["primary_requirements_terminal"] and s["n_assessments"] > 0:
        current, confidence = CONCLUDING, 0.9
    elif s["n_run_records"] > 0 and (s["n_assessments"] > 0 or s["n_verify_edges"] > 0):
        current, confidence = VERIFYING, 0.8
    elif s["n_run_records"] > 0:
        current, confidence = EXECUTING, 0.75
    elif s["activity_in_progress"]:
        current, confidence = EXECUTING, 0.6
    elif s["has_plan_body"] and s["requirements_settled"]:
        current, confidence = PLANNING, 0.7
    elif s["has_plan_body"]:
        current, confidence = PLANNING, 0.55
    elif s["n_requirements"] > 0:
        current, confidence = GATHER_REQUIREMENTS, 0.6
    else:
        current, confidence = GATHER_REQUIREMENTS, 0.3

    return {"current": current, "confidence": confidence, "signals": s}


# ---------------------------------------------------------------------------
# Transition history (best-effort, derived from timestamps)
# ---------------------------------------------------------------------------


def _entity_time(entity: dict) -> str:
    return entity.get("created_at") or ""


def _metadata(entity: dict) -> dict:
    raw = entity.get("metadata")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def transition_history(plan: dict, dag: dict) -> list[dict]:
    """Derive an ordered list of transition events from recorded data.

    This is a best-effort reconstruction (the dashboard does not record
    explicit transitions in this version): plan-version entities map to
    planning / replan, run_records to executing / rerun, assessments to
    verifying, and a requirement change after a conclusion to rescope.
    Each event is ``{from_state, to_state, trigger, timestamp, ref}`` with
    trigger in ``forward | replan | rerun | rescope``.
    """
    dag = dag or {}
    events: list[dict] = []

    plan_entities = sorted(_entities_of_type(dag, "plan"), key=_entity_time)
    run_records = sorted(_entities_of_type(dag, "run_record"), key=_entity_time)
    assessments = sorted(_entities_of_type(dag, "assessment"), key=_entity_time)

    # Planning / replan from plan versions.
    for idx, ent in enumerate(plan_entities):
        meta = _metadata(ent)
        is_replan = idx > 0 or meta.get("parent_version") is not None
        events.append({
            "from_state": PLANNING if is_replan else GATHER_REQUIREMENTS,
            "to_state": PLANNING,
            "trigger": "replan" if is_replan else "forward",
            "timestamp": _entity_time(ent),
            "ref": ent.get("entity_id"),
        })

    # Executing / rerun from run_records (grouped by plan version).
    seen_versions: set[Any] = set()
    for ent in run_records:
        version = ent.get("version")
        is_rerun = version in seen_versions
        seen_versions.add(version)
        events.append({
            "from_state": EXECUTING if is_rerun else PLANNING,
            "to_state": EXECUTING,
            "trigger": "rerun" if is_rerun else "forward",
            "timestamp": _entity_time(ent),
            "ref": ent.get("entity_id"),
        })

    # Verifying from assessments.
    for ent in assessments:
        events.append({
            "from_state": EXECUTING,
            "to_state": VERIFYING,
            "trigger": "forward",
            "timestamp": _entity_time(ent),
            "ref": ent.get("entity_id"),
        })

    events.sort(key=lambda e: e["timestamp"])
    return events


# ---------------------------------------------------------------------------
# Top-level projection
# ---------------------------------------------------------------------------


def get_state(plan: dict, dag: dict) -> dict:
    """Full state projection for the dashboard shell.

    Returns ``{current, confidence, signals, transitions, next}`` where
    ``next`` is ``{forward_state, replan_triggers}``.
    """
    inferred = infer_current_state(plan, dag)
    return {
        "current": inferred["current"],
        "confidence": inferred["confidence"],
        "signals": inferred["signals"],
        "transitions": transition_history(plan, dag),
        "next": {
            "forward_state": next_forward_state(inferred["current"]),
            "replan_triggers": replan_triggers(plan),
        },
    }
