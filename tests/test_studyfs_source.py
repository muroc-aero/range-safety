"""Tests for the studyfs source: SDK study store -> dashboard case table."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from hangar.range_safety.dashboard import state_machine
from hangar.range_safety.dashboard.app import app
from hangar.range_safety.dashboard.sources import MultiSource, StudyFsSource
from hangar.sdk.study import StudyStore
from hangar.sdk.study.expand import StudyCase


def _seed_study(study_id: str = "demo-grid", done: int = 2) -> StudyStore:
    """Create a study with 3 cases, *done* of them completed."""
    store = StudyStore(study_id)
    store.save_spec(f"metadata: {{id: {study_id}}}\n", version=1)
    cases = [
        StudyCase(case_id=f"r{r}", case_key=f"key-{r}", runner="omd",
                  params={"range_nm": float(r)},
                  spec={"plan": "base/plan.yaml"},
                  source="matrix" if r < 700 else "manual")
        for r in (300, 500, 700)
    ]
    store.sync_cases(cases, version=1)
    for i, case in enumerate(cases[:done]):
        store.update_case(
            case.case_key, status="completed", run_ref=f"run-2026-{i}",
            outputs={"MTOW_kg": 4000.0 + i}, wall_time_s=12.0)
    return store


def test_list_studies_reports_progress(isolate_omd_data):
    _seed_study(done=2)
    src = StudyFsSource()
    studies = src.list_studies()
    assert len(studies) == 1
    entry = studies[0]
    assert entry["key"] == "studyfs:demo-grid"
    assert entry["label"] == "demo-grid (2/3)"
    assert entry["current_state"] == state_machine.EXECUTING
    assert entry["source"] == "studyfs"


def test_state_transitions_with_progress(isolate_omd_data):
    _seed_study(done=0)
    src = StudyFsSource()
    assert src.get_state("demo-grid")["current"] == state_machine.PLANNING

    _seed_study(done=3)
    state = src.get_state("demo-grid")
    assert state["current"] == state_machine.VERIFYING
    assert state["signals"]["cases_done"] == 3
    assert state["coverage"][state_machine.EXECUTING] == state_machine.POPULATED


def test_view_study_case_table(isolate_omd_data):
    _seed_study(done=2)
    data = StudyFsSource().view_study("demo-grid")
    assert data["key"] == "studyfs:demo-grid"
    assert data["param_keys"] == ["range_nm"]
    assert data["output_keys"] == ["MTOW_kg"]
    assert data["progress"]["done"] == 2
    assert data["progress"]["total"] == 3
    by_id = {c["case_id"]: c for c in data["cases"]}
    assert by_id["r300"]["status"] == "completed"
    assert by_id["r300"]["outputs"]["MTOW_kg"] == 4000.0
    assert by_id["r700"]["status"] == "pending"
    assert by_id["r700"]["source"] == "manual"
    # legacy member-matrix shape stays empty so the template branches
    assert data["members"] == []


def test_multisource_dispatch_and_run_listing(isolate_omd_data):
    _seed_study(done=2)
    multi = MultiSource()
    assert "studyfs" in multi.sources

    studies = multi.list_studies()
    assert any(s["key"] == "studyfs:demo-grid" for s in studies)

    runs = multi.list_runs("studyfs:demo-grid")
    assert {r["run_id"] for r in runs} == {"studyfs:run-2026-0", "studyfs:run-2026-1"}

    data = multi.view_study("studyfs:demo-grid")
    assert data["progress"]["total"] == 3


def test_view_study_fragment_renders_case_table(isolate_omd_data):
    _seed_study(done=2)
    client = TestClient(app)
    resp = client.get("/view/study/studyfs:demo-grid")
    assert resp.status_code == 200
    html = resp.text
    assert "Case table" in html
    assert "r300" in html
    assert "MTOW_kg" in html
    assert "2/3" in html
    # in-progress studies self-refresh
    assert 'hx-trigger="every 10s"' in html


def test_finished_study_fragment_does_not_poll(isolate_omd_data):
    _seed_study(done=3)
    client = TestClient(app)
    html = client.get("/view/study/studyfs:demo-grid").text
    assert "hx-trigger" not in html
    assert "3/3" in html


def test_shell_lists_studyfs_source(isolate_omd_data):
    _seed_study(done=1)
    client = TestClient(app)
    resp = client.get("/api/studies", params={"src": "studyfs"})
    assert resp.status_code == 200
    assert "demo-grid" in {s["study_id"] for s in resp.json()}


def test_run_scoped_views_delegate_to_omd(isolate_omd_data):
    _seed_study(done=1)
    src = StudyFsSource(omd=None)
    from hangar.range_safety.dashboard.plot_adapter import PlotUnavailable

    with pytest.raises(PlotUnavailable):
        src.plot_types("run-2026-0")
