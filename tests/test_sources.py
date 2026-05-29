"""Tests for the multi-source seam: SdkSessionSource + MultiSource dispatch.

The autouse ``isolate_omd_data`` fixture points OMD_* and HANGAR_DATA_DIR at a
per-test temp dir, so both the omd analysis DB / plan store and the sdk
sessions.db / ArtifactStore are isolated.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from hangar.omd.db import init_analysis_db, record_entity, record_run_case
from hangar.range_safety.dashboard import state_machine
from hangar.range_safety.dashboard.sources import (
    MultiSource,
    SdkSessionSource,
    split_key,
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

    # Thin-by-design views.
    assert src.view_requirements(sid)["requirements"] == []
    assert src.view_plan_diff(sid)["changes"] == []


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
