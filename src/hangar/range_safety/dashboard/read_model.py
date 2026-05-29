"""Read-only projection over the hangar stores, one method per view.

The dashboard owns no primary data store in this version. The read model
reads provenance / run results through the ``hangar-results-reader`` seam,
loads plan versions from the omd plan store as YAML, computes the
element-level plan diff and state projection itself, runs the range-safety
assertions for verification, and renders plots through the plot adapter.
All methods return plain JSON-able dicts (the same data also feeds the
JSON API), per DESIGN_data_contract.md.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from hangar.results_reader import (
    init_analysis_db,
    query_entity,
    query_provenance_dag,
    query_run_results,
)

from hangar.range_safety.dashboard import plan_diff, plot_adapter, state_machine
from hangar.range_safety.dashboard.plan_store import (
    default_plan_store,
    latest_version,
    list_plans,
    list_versions,
    load_plan,
)

_VERIFY_RELATIONS = frozenset({"verifies", "satisfies", "violates"})


def _parse_metadata(entity: dict) -> dict:
    raw = (entity or {}).get("metadata")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


class ReadModel:
    """Read-only access to a single analysis DB + plan store.

    Args:
        db_path: Analysis DB path. None uses ``OMD_DB_PATH`` / the default.
        plan_store: Plan store directory. None resolves from the
            environment (``OMD_PLAN_STORE`` / ``OMD_DATA_ROOT``).
    """

    def __init__(self, *, db_path: str | Path | None = None,
                 plan_store: str | Path | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else None
        self.plan_store = Path(plan_store) if plan_store is not None else default_plan_store()
        # Single source of truth for DB connection state (the seam).
        init_analysis_db(self.db_path)

    # -- helpers -----------------------------------------------------------

    def _plan(self, plan_id: str, version: int | None = None) -> dict:
        return load_plan(self.plan_store, plan_id, version) or {}

    def _dag(self, plan_id: str) -> dict:
        return query_provenance_dag(plan_id)

    # -- state projection --------------------------------------------------

    def get_state(self, plan_id: str) -> dict:
        """The full five-state projection for the dashboard shell."""
        plan = self._plan(plan_id)
        dag = self._dag(plan_id)
        projection = state_machine.get_state(plan, dag)
        projection["plan_id"] = plan_id
        projection["plan_version"] = latest_version(self.plan_store, plan_id)
        return projection

    def machine(self) -> dict:
        """Static machine definition (states + edges) for the shell."""
        return state_machine.describe_machine()

    # -- enumeration (shell selectors) ------------------------------------

    def list_plans(self) -> list[dict]:
        """Plans available in the store, with their latest version and state.

        Powers the shell's plan selector. Cheap fields only; the per-plan
        state inference is a single DAG read each.
        """
        out = []
        for plan_id in list_plans(self.plan_store):
            plan = self._plan(plan_id)
            dag = self._dag(plan_id)
            out.append({
                "plan_id": plan_id,
                "version": latest_version(self.plan_store, plan_id),
                "name": (plan.get("metadata") or {}).get("name"),
                "current_state": state_machine.infer_current_state(plan, dag)["current"],
            })
        return out

    def list_runs(self, plan_id: str) -> list[dict]:
        """Run records recorded for a plan (newest first), for the run selector."""
        dag = self._dag(plan_id)
        runs = [
            {
                "run_id": e.get("entity_id"),
                "version": e.get("version"),
                "created_at": e.get("created_at"),
            }
            for e in (dag.get("entities") or [])
            if e.get("entity_type") == "run_record"
        ]
        runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return runs

    # -- view 1: requirements ---------------------------------------------

    def view_requirements(self, plan_id: str, version: int | None = None) -> dict:
        plan = self._plan(plan_id, version)
        dag = self._dag(plan_id)

        # Index verify edges by the requirement they target.
        edges_by_req: dict[str, list[dict]] = {}
        for edge in dag.get("edges") or []:
            if edge.get("relation") in _VERIFY_RELATIONS:
                edges_by_req.setdefault(edge.get("object_id"), []).append({
                    "relation": edge.get("relation"),
                    "subject_id": edge.get("subject_id"),
                })

        requirements = []
        for req in plan.get("requirements") or []:
            rid = req.get("id")
            requirements.append({
                "id": rid,
                "text": req.get("text"),
                "type": req.get("type"),
                "priority": req.get("priority"),
                "status": req.get("status", "open"),
                "acceptance_criteria": req.get("acceptance_criteria", []),
                "traces_to": req.get("traces_to", []),
                "verification_edges": edges_by_req.get(rid, []),
            })
        return {"plan_id": plan_id, "requirements": requirements}

    # -- view 2a: plan -----------------------------------------------------

    def view_plan(self, plan_id: str, version: int | None = None) -> dict:
        plan = self._plan(plan_id, version)
        dag = self._dag(plan_id)
        nodes = [
            {
                "id": e.get("entity_id"),
                "entity_type": e.get("entity_type"),
                "parent_id": e.get("parent_id"),
                "version": e.get("version"),
            }
            for e in dag.get("entities") or []
        ]
        edges = [
            {
                "relation": e.get("relation"),
                "source": e.get("subject_id"),
                "target": e.get("object_id"),
            }
            for e in dag.get("edges") or []
        ]
        return {
            "plan_id": plan_id,
            "version": version if version is not None else latest_version(self.plan_store, plan_id),
            "plan": plan,
            "decisions": plan.get("decisions", []),
            "nodes": nodes,
            "edges": edges,
        }

    # -- view 2b: plan diff ------------------------------------------------

    def view_plan_diff(
        self,
        plan_id: str,
        version_a: int | None = None,
        version_b: int | None = None,
    ) -> dict:
        """Element-level diff between two plan versions.

        Defaults to ``parent_version`` (or the previous stored version)
        vs the latest, matching the plan-diff view's default selection.
        """
        versions = list_versions(self.plan_store, plan_id)
        if version_b is None:
            version_b = versions[-1] if versions else None
        if version_a is None:
            plan_b_meta = (self._plan(plan_id, version_b).get("metadata") or {})
            version_a = plan_b_meta.get("parent_version")
            if version_a is None:
                earlier = [v for v in versions if version_b is None or v < version_b]
                version_a = earlier[-1] if earlier else version_b

        plan_a = self._plan(plan_id, version_a)
        plan_b = self._plan(plan_id, version_b)
        changes = plan_diff.diff_plans(plan_a, plan_b)
        return {
            "plan_id": plan_id,
            "version_a": version_a,
            "version_b": version_b,
            "changes": changes,
            "summary": plan_diff.summarize_diff(changes),
        }

    # -- view 2c: study ----------------------------------------------------

    def _latest_run_metrics(self, plan_id: str) -> dict:
        """Final-case metrics of the newest run for a plan, or {}."""
        runs = self.list_runs(plan_id)
        if not runs:
            return {}
        cases = query_run_results(runs[0]["run_id"])
        final = next((c for c in cases if c.get("case_type") == "final"), None)
        if final is None and cases:
            final = cases[-1]
        data = (final or {}).get("data") or {}
        return {k: v for k, v in data.items() if isinstance(v, (int, float))}

    def view_study(self, study_id: str) -> dict:
        """A collection of related plans (a study / trade space).

        Membership (v1): plans whose ``metadata.study`` equals ``study_id``;
        if none match, ``study_id`` is treated as a single plan and the
        study is that plan on its own. Lineage edges come from each member's
        ``metadata.derived_from`` (a parent plan id). Metrics are the final
        numeric outputs of each member's newest run, so the view can render
        a study-vs-metric matrix. This is the v1 scope; richer study
        modeling is a later item (see DESIGN_views.md 2c).
        """
        all_ids = list_plans(self.plan_store)
        members_ids = [
            pid for pid in all_ids
            if str((self._plan(pid).get("metadata") or {}).get("study") or "") == study_id
        ]
        if not members_ids and study_id in all_ids:
            members_ids = [study_id]

        members = []
        lineage = []
        metric_keys: set[str] = set()
        for pid in members_ids:
            plan = self._plan(pid)
            meta = plan.get("metadata") or {}
            dag = self._dag(pid)
            metrics = self._latest_run_metrics(pid)
            metric_keys.update(metrics)
            members.append({
                "plan_id": pid,
                "version": latest_version(self.plan_store, pid),
                "name": meta.get("name"),
                "current_state": state_machine.infer_current_state(plan, dag)["current"],
                "objective": (plan.get("objective") or {}).get("name"),
                "metrics": metrics,
            })
            parent = meta.get("derived_from")
            if parent:
                lineage.append({"source": parent, "target": pid})

        return {
            "study_id": study_id,
            "members": members,
            "lineage": lineage,
            "metric_keys": sorted(metric_keys),
        }

    # -- view 3: results ---------------------------------------------------

    def plan_for_run(self, run_id: str) -> dict | None:
        """Load the plan a run belongs to (via the run entity's plan_id)."""
        entity = query_entity(run_id)
        plan_id = (entity or {}).get("plan_id")
        if not plan_id:
            return None
        return self._plan(plan_id)

    def view_results(self, run_id: str, plan: dict | None = None) -> dict:
        cases = query_run_results(run_id)
        final = None
        for case in cases:
            if case.get("case_type") == "final":
                final = case
        if final is None and cases:
            final = cases[-1]

        validation: dict[str, Any] = {}
        # Assertions are optional and imported lazily (they pull the
        # range-safety assertion modules, which read through the seam).
        try:
            from hangar.range_safety.assertions import (  # noqa: PLC0415
                assert_convergence,
                assert_constraints,
            )

            validation["convergence"] = assert_convergence(run_id, db_path=self.db_path)
            if plan is not None:
                validation["constraints"] = assert_constraints(
                    run_id, plan, db_path=self.db_path
                )
        except Exception as exc:  # noqa: BLE001 - surfaced, not fatal
            validation["error"] = str(exc)

        run_entity = query_entity(run_id)
        return {
            "run_id": run_id,
            "run_entity": run_entity,
            "final": final.get("data") if final else None,
            "history": cases,
            "validation": validation,
        }

    def plot_types(self, run_id: str) -> list[str]:
        return plot_adapter.plot_types(run_id)

    def plot_png(self, run_id: str, plot_type: str) -> bytes:
        return plot_adapter.plot_png(run_id, plot_type)

    # -- view 4: reasoning trace ------------------------------------------

    def view_reasoning(self, plan_id: str, focus: str | None = None) -> dict:
        """Subgraph linking results -> reasoning/observations -> requirements.

        Nodes are the run_record / assessment / decision / requirement
        entities; edges are the satisfies/violates/verifies/justifies
        relations among them. ``focus`` (a requirement or result id)
        narrows the subgraph to that node's neighborhood.
        """
        dag = self._dag(plan_id)
        relevant_types = {"run_record", "assessment", "decision", "requirement"}
        nodes = []
        for ent in dag.get("entities") or []:
            if ent.get("entity_type") in relevant_types:
                nodes.append({
                    "id": ent.get("entity_id"),
                    "entity_type": ent.get("entity_type"),
                    "metadata": _parse_metadata(ent),
                })
        reasoning_relations = _VERIFY_RELATIONS | {"justifies", "wasDerivedFrom"}
        edges = [
            {
                "relation": e.get("relation"),
                "source": e.get("subject_id"),
                "target": e.get("object_id"),
            }
            for e in dag.get("edges") or []
            if e.get("relation") in reasoning_relations
        ]

        if focus is not None:
            keep = {focus}
            keep |= {e["target"] for e in edges if e["source"] == focus}
            keep |= {e["source"] for e in edges if e["target"] == focus}
            nodes = [n for n in nodes if n["id"] in keep]
            edges = [e for e in edges if e["source"] in keep and e["target"] in keep]

        return {"plan_id": plan_id, "focus": focus, "nodes": nodes, "edges": edges}

    # -- view 5: report / summary -----------------------------------------

    def view_report(self, plan_id: str, version: int | None = None) -> dict:
        plan = self._plan(plan_id, version)
        dag = self._dag(plan_id)
        state = state_machine.get_state(plan, dag)

        scorecard = {"verified": 0, "violated": 0, "waived": 0, "open": 0, "draft": 0}
        for req in plan.get("requirements") or []:
            status = req.get("status", "open")
            scorecard[status] = scorecard.get(status, 0) + 1

        analysis_plan = plan.get("analysis_plan") or {}
        phases = [
            {"id": p.get("id"), "name": p.get("name"), "mode": p.get("mode")}
            for p in analysis_plan.get("phases") or []
        ]
        return {
            "plan_id": plan_id,
            "version": version if version is not None else latest_version(self.plan_store, plan_id),
            "current_state": state["current"],
            "scorecard": scorecard,
            "phases": phases,
            "replan_triggers": state_machine.replan_triggers(plan),
            "decisions": plan.get("decisions", []),
        }
