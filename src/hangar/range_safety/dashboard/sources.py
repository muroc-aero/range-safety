"""Tool Source adapters and the multi-source façade.

The dashboard is state-first and tool-agnostic. Each ``Source`` maps one
provenance pattern into the five state views and the normalized graph
elements (see ``DESIGN_tool_integration.md``):

- ``OmdSource``  -- plan-centric (omd ``analysis.db`` + plan store). This is
  the existing ``ReadModel``.
- ``SdkSessionSource`` -- session-centric (sdk ``sessions.db`` +
  ``ArtifactStore``), for oas / ocp / pyc. Strong at the execution graph,
  results, and plots; thin at structured Plan / requirements / Concluding
  (those carry TODO markers, see the design doc).

``MultiSource`` aggregates the sources and dispatches by a ``{source}:{id}``
study/run key. An unprefixed id defaults to omd (back-compat).
"""

from __future__ import annotations

import json
from pathlib import Path as _Path
from typing import Any

from hangar.range_safety.dashboard import plot_adapter, state_machine
from hangar.range_safety.dashboard.read_model import ReadModel

DEFAULT_SOURCE = "omd"


def split_key(key: str, default: str = DEFAULT_SOURCE) -> tuple[str, str]:
    """Split a ``{source}:{id}`` key; an unprefixed key uses ``default``."""
    if key and ":" in key:
        source, _, ident = key.partition(":")
        return source, ident
    return default, key


# Display order + unit hints for sdk headline scalars across oas / ocp / pyc.
# Keys not listed still appear, after the known ones, in declaration order.
_SDK_HEADLINE_ORDER = [
    "CL", "CD", "CM", "L_over_D",          # oas aero
    "fuelburn", "failure", "structural_mass",
    "fuel_burn", "range", "MTOW", "TOFL",  # ocp mission
    "TSFC", "Fn", "OPR", "thrust",         # pyc cycle
]
_SDK_UNITS = {
    "fuelburn": "kg", "fuel_burn": "kg", "structural_mass": "kg",
    "range": "km", "MTOW": "kg", "TOFL": "m",
    "TSFC": "lbm/hr/lbf", "Fn": "lbf", "thrust": "lbf",
}


def _sdk_headline(results: dict) -> list[dict]:
    """Headline metrics from an sdk envelope's already-clean named scalars.

    No path resolution: the envelope exposes ``CL``/``CD``/``L_over_D`` etc.
    at the top level. Known keys lead in a stable order; the rest follow.
    Heavy / private payload (surfaces, ``_surface_dicts``, ...) is skipped.
    """
    scalars = {
        k: v for k, v in (results or {}).items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
        and not k.startswith("_")
    }
    ordered = [k for k in _SDK_HEADLINE_ORDER if k in scalars]
    ordered += [k for k in scalars if k not in _SDK_HEADLINE_ORDER]
    return [
        {
            "name": k,
            "label": k,
            "value": scalars[k],
            "unit": _SDK_UNITS.get(k, ""),
            "role": "metric",
        }
        for k in ordered
    ]


def _sdk_checks(validation: dict | None) -> list[dict]:
    """Map an sdk validation envelope onto the normalized check-strip groups.

    The envelope's ``all_findings`` (physics / numerics checks, each with a
    severity and message) become a single "Physics & numerics" group so sdk
    runs render the same check strip as omd's convergence/constraint checks.
    """
    if not validation:
        return []
    findings = validation.get("all_findings") or validation.get("findings") or []
    items = [
        {
            "name": f.get("check_id", ""),
            "passed": bool(f.get("passed", True)),
            "message": f.get("message", ""),
            "severity": f.get("severity"),
        }
        for f in findings
    ]
    if not items:
        return []
    summary = (
        f"{validation.get('error_count', 0)} error(s), "
        f"{validation.get('warning_count', 0)} warning(s)"
    )
    return [{
        "title": "Physics & numerics",
        "passed": bool(validation.get("passed", all(i["passed"] for i in items))),
        "summary": summary,
        "items": items,
    }]


class OmdSource(ReadModel):
    """Plan-centric source (the original read model)."""

    name = "omd"

    def view_results(self, run_id: str, plan: dict | None = None) -> dict:
        # Resolve the run's plan so the constraint assertions run too, making
        # the dispatch uniform with the sdk source (single-arg view_results).
        if plan is None:
            plan = self.plan_for_run(run_id)
        data = super().view_results(run_id, plan=plan)
        # Attach the provenance / execution graph for the run's plan. This is
        # the lineage DAG (build_provenance_elements); it is intentionally the
        # "needs enhancement" results graph for now, shown alongside the table.
        from hangar.omd.provenance import build_provenance_elements  # noqa: PLC0415
        from hangar.results_reader import query_entity  # noqa: PLC0415

        plan_id = (query_entity(run_id) or {}).get("plan_id")
        if plan_id:
            data["graph"] = build_provenance_elements(plan_id, db_path=self.db_path)
            data["graph_style"] = "provenance"
        return data

    # -- plots: omd renders from the recorder .sql (factory-aware), a
    # different path from the sdk ArtifactStore. -------------------------

    def _run_plot_meta(self, run_id: str) -> dict:
        from hangar.results_reader import query_entity  # noqa: PLC0415

        entity = query_entity(run_id) or {}
        raw = entity.get("metadata")
        if isinstance(raw, str) and raw:
            try:
                return json.loads(raw)
            except (ValueError, TypeError):
                return {}
        return raw if isinstance(raw, dict) else {}

    def plot_types(self, run_id: str) -> list[str]:
        from hangar.omd.registry import (  # noqa: PLC0415
            get_all_plot_providers, get_plot_provider, get_plot_provider_with_slots,
        )

        meta = self._run_plot_meta(run_id)
        component_types = meta.get("component_types")
        if component_types and len(component_types) > 1:
            names: set[str] = set()
            for ctype in component_types.values():
                names |= set(get_plot_provider(ctype))
            return sorted(names)
        ct = meta.get("component_type")
        if ct:
            provider = get_plot_provider_with_slots(ct, meta.get("slot_providers"))
        else:
            provider = get_all_plot_providers()
        # n2 is an interactive HTML diagram, not a PNG; the image gallery
        # only serves rasterized plots.
        return sorted(name for name in provider if name != "n2")

    def plot_png(self, run_id: str, plot_type: str) -> bytes:
        from hangar.omd.db import omd_data_root, recordings_dir  # noqa: PLC0415
        from hangar.omd.plotting import generate_plots  # noqa: PLC0415

        rec_path = recordings_dir() / f"{run_id}.sql"
        if not rec_path.exists():
            raise plot_adapter.PlotUnavailable(f"No recorder for run {run_id!r}.")
        meta = self._run_plot_meta(run_id)
        out_dir = omd_data_root() / "plots" / run_id
        saved = generate_plots(
            rec_path,
            plot_types=[plot_type],
            output_dir=out_dir,
            component_type=meta.get("component_type"),
            component_types=meta.get("component_types"),
            slot_providers=meta.get("slot_providers"),
        )
        path = saved.get(plot_type) if saved else None
        if not path or not _Path(path).exists():
            raise plot_adapter.PlotUnavailable(
                f"omd produced no {plot_type!r} plot for run {run_id!r}."
            )
        return _Path(path).read_bytes()

    @staticmethod
    def _cheap_state(types: set) -> str:
        # Rough state for the selector from entity-type presence alone (no
        # plan YAML read, no per-plan DAG). The selected study still gets the
        # full inference via get_state.
        if "assessment" in types:
            return state_machine.VERIFYING
        if "run_record" in types:
            return state_machine.EXECUTING
        return state_machine.PLANNING

    def list_studies(self) -> list[dict]:
        # One bulk query over the entities table (O(1) DB round-trips) instead
        # of per-plan _plan() + _dag() + inference, which is O(plans) and was
        # ~18s with 1500+ plans.
        from hangar.results_reader.db import _get_conn  # noqa: PLC0415

        rows = _get_conn().execute(
            "SELECT plan_id, entity_type, version, created_at "
            "FROM entities WHERE plan_id IS NOT NULL"
        ).fetchall()
        types_by_plan: dict[str, set] = {}
        version_by_plan: dict[str, int] = {}
        updated_by_plan: dict[str, str] = {}
        for r in rows:
            pid = r["plan_id"]
            types_by_plan.setdefault(pid, set()).add(r["entity_type"])
            if r["entity_type"] == "plan" and r["version"] is not None:
                version_by_plan[pid] = max(version_by_plan.get(pid, 0), r["version"])
            ts = r["created_at"] or ""
            if ts > updated_by_plan.get(pid, ""):
                updated_by_plan[pid] = ts

        return [
            {
                "key": f"{self.name}:{pid}",
                "study_id": pid,
                "label": pid,
                "version": version_by_plan.get(pid),
                "current_state": self._cheap_state(types_by_plan[pid]),
                "source": self.name,
                "updated": updated_by_plan.get(pid, ""),
            }
            for pid in sorted(types_by_plan)
        ]


class SdkSessionSource:
    """Session-centric source for oas / ocp / pyc (sdk provenance + artifacts).

    Reads the shared sdk ``sessions.db`` (tool_call / decision graph via
    ``build_session_elements``) and the filesystem ``ArtifactStore`` (results
    and plots). Requirements live only in the runtime SessionManager today and
    are not persisted, so the requirements / plan-diff / report views are thin
    for replayed sessions (TODO in the design doc: persist them).
    """

    name = "sdk"

    def __init__(self, sessions_db=None, data_dir=None) -> None:
        from hangar.sdk.provenance import db as _sdb  # noqa: PLC0415
        from hangar.sdk.artifacts.store import ArtifactStore  # noqa: PLC0415

        self._sdb = _sdb
        _sdb.init_db(sessions_db)
        self._store = ArtifactStore(data_dir)

    # -- enumeration -------------------------------------------------------

    @staticmethod
    def _state_from_counts(n_tool: int, n_dec: int) -> str:
        if n_dec > 0:
            return state_machine.VERIFYING
        if n_tool > 0:
            return state_machine.EXECUTING
        return state_machine.PLANNING

    def list_studies(self) -> list[dict]:
        # Cheap: list_sessions already returns per-session tool_call /
        # decision counts, so the selector state needs no per-session graph
        # build or artifact scan (those would be O(sessions) filesystem hits).
        out = []
        for s in self._sdb.list_sessions():
            sid = s.get("session_id")
            out.append({
                "key": f"{self.name}:{sid}",
                "study_id": sid,
                "label": s.get("project") or sid,
                "version": None,
                "current_state": self._state_from_counts(
                    s.get("tool_call_count", 0), s.get("decision_count", 0)),
                "source": self.name,
                "updated": s.get("started_at") or "",
            })
        return out

    def list_runs(self, session_id: str) -> list[dict]:
        runs = []
        for e in self._store.list(session_id=session_id):
            rid = e.get("run_id", "")
            if not rid or not rid[0].isdigit():
                continue  # skip internal artifacts (e.g. _provenance_graph)
            runs.append({
                "run_id": rid,
                "version": None,
                "created_at": e.get("created_at") or rid,
            })
        runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return runs

    # -- state -------------------------------------------------------------

    def _signals(self, session_id: str) -> dict:
        graph = self._sdb.get_session_graph(session_id)
        n_tool = sum(1 for n in graph["nodes"] if n.get("type") == "tool_call")
        n_dec = sum(1 for n in graph["nodes"] if n.get("type") == "decision")
        n_runs = len(self.list_runs(session_id))
        return {"n_tool_calls": n_tool, "n_decisions": n_dec, "n_runs": n_runs}

    def _infer(self, session_id: str) -> dict:
        s = self._signals(session_id)
        if s["n_decisions"] > 0:
            current, conf = state_machine.VERIFYING, 0.6
        elif s["n_tool_calls"] > 0 or s["n_runs"] > 0:
            current, conf = state_machine.EXECUTING, 0.6
        else:
            current, conf = state_machine.PLANNING, 0.4
        return {"current": current, "confidence": conf, "signals": s}

    def get_state(self, session_id: str) -> dict:
        inferred = self._infer(session_id)
        s = inferred["signals"]
        # sdk coverage: requirements are runtime-only (not persisted) so Gather
        # is absent; there is no structured plan document so Planning is thin;
        # Concluding is not modelled yet. (See DESIGN_tool_integration TODOs.)
        coverage = {
            state_machine.GATHER_REQUIREMENTS: state_machine.ABSENT,
            state_machine.PLANNING: state_machine.THIN,
            state_machine.EXECUTING: (state_machine.POPULATED
                                      if (s["n_tool_calls"] or s["n_runs"]) else state_machine.ABSENT),
            state_machine.VERIFYING: (state_machine.POPULATED if s["n_decisions"]
                                      else (state_machine.THIN if s["n_tool_calls"] else state_machine.ABSENT)),
            state_machine.CONCLUDING: state_machine.ABSENT,
        }
        return {
            "current": inferred["current"],
            "confidence": inferred["confidence"],
            "signals": s,
            "coverage": coverage,
            "transitions": [],  # TODO: derive from tool_call seq + decisions
            "next": {
                "forward_state": state_machine.next_forward_state(inferred["current"]),
                "replan_triggers": [],
            },
            "plan_id": session_id,
            "plan_version": None,
        }

    # -- views -------------------------------------------------------------

    def _session_graph(self, session_id: str) -> dict:
        return self._sdb.build_session_elements(session_id)

    def view_requirements(self, session_id: str, version=None) -> dict:
        # Thin: sdk requirements are runtime-only (set_requirements) and not
        # persisted, so there is nothing to replay. TODO: persist them.
        return {"plan_id": session_id, "requirements": []}

    def view_plan(self, session_id: str, version=None) -> dict:
        # No structured plan document for an sdk session; surface the
        # tool_call/decision execution graph as the structure view (rendered
        # with the provenance/session style, not the plan-detail style).
        return {
            "plan_id": session_id,
            "version": None,
            "plan": {},
            "decisions": [],
            "graph": self._session_graph(session_id),
            "graph_style": "session",
        }

    def view_plan_diff(self, session_id: str, version_a=None, version_b=None) -> dict:
        # No plan versions for sdk sessions. TODO: derive from re-runs.
        return {"plan_id": session_id, "version_a": None, "version_b": None,
                "changes": [], "summary": {"added": 0, "removed": 0, "modified": 0}}

    def view_study(self, session_id: str) -> dict:
        state = self._infer(session_id)["current"]
        return {
            "study_id": session_id,
            "members": [{"plan_id": session_id, "version": None, "name": session_id,
                         "current_state": state, "objective": None, "metrics": {}}],
            "metric_keys": [],
            "graph": {"nodes": [{"data": {"id": session_id, "label": session_id,
                                          "kind": "study_member", "current_state": state}}],
                      "edges": []},
        }

    def view_reasoning(self, session_id: str, focus=None) -> dict:
        # The session graph (tool_call -> decision) is the reasoning trace.
        return {"plan_id": session_id, "focus": focus, "graph": self._session_graph(session_id)}

    def view_report(self, session_id: str, version=None) -> dict:
        # Thin until requirements/assessments are persisted for sdk sessions.
        return {"plan_id": session_id, "version": None, "current_state": self._infer(session_id)["current"],
                "scorecard": {"verified": 0, "violated": 0, "waived": 0, "open": 0, "draft": 0},
                "phases": [], "replan_triggers": [], "decisions": []}

    def view_results(self, run_id: str) -> dict:
        artifact = self._store.get(run_id) or {}
        results = artifact.get("results") or {}
        final = {k: v for k, v in results.items() if isinstance(v, (int, float, str, bool))}
        data = {
            "run_id": run_id,
            "run_entity": artifact.get("metadata"),
            # The sdk envelope already exposes clean named scalars, so the
            # headline maps straight off them (no path resolution needed).
            "headline": _sdk_headline(results),
            "constraints": [],  # sdk has no plan constraints; findings -> checks
            # The envelope's own validation block (physics/numerics findings)
            # is no longer discarded: it maps onto the same check strip as omd.
            "checks": _sdk_checks(artifact.get("validation")),
            "opt_history": {},  # single-shot analyses have no iteration history
            "final": final or None,
            "history": [],
            "validation": artifact.get("validation") or {},
        }
        # Execution graph: the run's session tool_call/decision graph.
        session_id = (artifact.get("metadata") or {}).get("session_id")
        if session_id:
            data["graph"] = self._sdb.build_session_elements(session_id)
            data["graph_style"] = "session"
        return data

    def plot_types(self, run_id: str) -> list[str]:
        return plot_adapter.plot_types(run_id)

    def plot_png(self, run_id: str, plot_type: str) -> bytes:
        return plot_adapter.plot_png(run_id, plot_type)


class MultiSource:
    """Aggregate the registered sources and dispatch by ``{source}:{id}`` key.

    Used by the Starlette app. omd is always present; the sdk source is added
    if the sdk provenance/artifact stack is importable and initialises.
    """

    def __init__(self) -> None:
        self.sources: dict[str, Any] = {"omd": OmdSource()}
        try:
            self.sources["sdk"] = SdkSessionSource()
        except Exception:  # noqa: BLE001 - sdk store optional/uninitialised
            pass

    def _src(self, key: str):
        source, ident = split_key(key)
        return self.sources.get(source, self.sources["omd"]), ident

    # static machine definition (tool-agnostic)
    def machine(self) -> dict:
        return state_machine.describe_machine()

    def list_studies(self) -> list[dict]:
        studies: list[dict] = []
        for src in self.sources.values():
            try:
                studies.extend(src.list_studies())
            except Exception:  # noqa: BLE001 - a bad source must not break the list
                continue
        # Newest first (by last-updated timestamp), so the most recent
        # analyses are at the top of the selector.
        studies.sort(key=lambda s: s.get("updated") or "", reverse=True)
        return studies

    def list_runs(self, study_key: str) -> list[dict]:
        src, ident = self._src(study_key)
        prefix = study_key.split(":", 1)[0] if ":" in study_key else "omd"
        runs = src.list_runs(ident)
        # Re-prefix run ids so run-scoped routes can dispatch back.
        for r in runs:
            r["run_id"] = f"{prefix}:{r['run_id']}"
        return runs

    # -- view dispatch (study-scoped) -------------------------------------

    def get_state(self, study_key: str) -> dict:
        src, ident = self._src(study_key)
        state = src.get_state(ident)
        state["plan_id"] = study_key
        return state

    def view_requirements(self, study_key, version=None):
        src, ident = self._src(study_key)
        return src.view_requirements(ident, version)

    def view_plan(self, study_key, version=None):
        src, ident = self._src(study_key)
        return src.view_plan(ident, version)

    def view_plan_diff(self, study_key, version_a=None, version_b=None):
        src, ident = self._src(study_key)
        return src.view_plan_diff(ident, version_a, version_b)

    def view_study(self, study_key):
        src, ident = self._src(study_key)
        return src.view_study(ident)

    def view_reasoning(self, study_key, focus=None):
        src, ident = self._src(study_key)
        return src.view_reasoning(ident, focus)

    def view_report(self, study_key, version=None):
        src, ident = self._src(study_key)
        return src.view_report(ident, version)

    # -- view dispatch (run-scoped) ---------------------------------------

    def view_results(self, run_key: str) -> dict:
        src, ident = self._src(run_key)
        data = src.view_results(ident)
        data["run_id"] = run_key
        return data

    def plot_types(self, run_key: str) -> list[str]:
        src, ident = self._src(run_key)
        return src.plot_types(ident)

    def plot_png(self, run_key: str, plot_type: str) -> bytes:
        src, ident = self._src(run_key)
        return src.plot_png(ident, plot_type)
