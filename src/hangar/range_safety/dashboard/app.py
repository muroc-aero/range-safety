"""Starlette app for the dashboard: JSON API + server-rendered views.

Two parallel surfaces over the same ``ReadModel`` methods:

- ``/api/<name>`` returns plain JSON (the API-first contract from
  DESIGN_data_contract.md; any view can be re-implemented as a SPA
  component against these without backend change).
- ``/`` serves the dashboard shell and ``/view/<name>`` returns
  server-rendered htmx fragments (DESIGN_views.md). Graph and plot
  fragments embed their data as JSON and are hydrated client-side by
  ``static/dashboard.js`` (Cytoscape / plot gallery).

Run locally::

    uvicorn hangar.range_safety.dashboard.app:app --reload

The app reads ``OMD_DB_PATH`` / ``OMD_PLAN_STORE`` from the environment
(same as the rest of omd); a ``ReadModel`` is built per request.
"""

from __future__ import annotations

from pathlib import Path

from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from hangar.range_safety.dashboard import plot_adapter, state_machine
from hangar.range_safety.dashboard.read_model import ReadModel

_HERE = Path(__file__).parent
templates = Jinja2Templates(directory=str(_HERE / "templates"))

# Plot types that belong to the optimization / comparison gallery; the rest
# are domain visualizations. Used to split views 3b and 3c.
_OPT_PLOT_TYPES = frozenset({
    "opt_history", "opt_dv_evolution", "opt_comparison",
    "opt_multipoint", "multipoint_comparison",
})


def _read_model() -> ReadModel:
    # db_path / plan_store default to the environment-configured locations.
    return ReadModel()


def _int_param(request, name):
    value = request.query_params.get(name)
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------


async def machine(request):
    return JSONResponse(_read_model().machine())


async def state(request):
    return JSONResponse(_read_model().get_state(request.path_params["plan_id"]))


async def requirements(request):
    rm = _read_model()
    return JSONResponse(rm.view_requirements(
        request.path_params["plan_id"], _int_param(request, "version")))


async def plan(request):
    rm = _read_model()
    return JSONResponse(rm.view_plan(
        request.path_params["plan_id"], _int_param(request, "version")))


async def plan_diff(request):
    rm = _read_model()
    return JSONResponse(rm.view_plan_diff(
        request.path_params["plan_id"],
        _int_param(request, "version_a"),
        _int_param(request, "version_b"),
    ))


async def study(request):
    return JSONResponse(_read_model().view_study(request.path_params["study_id"]))


async def results(request):
    return JSONResponse(_results_data(_read_model(), request.path_params["run_id"]))


async def reasoning(request):
    rm = _read_model()
    return JSONResponse(rm.view_reasoning(
        request.path_params["plan_id"], request.query_params.get("focus")))


async def report(request):
    rm = _read_model()
    return JSONResponse(rm.view_report(
        request.path_params["plan_id"], _int_param(request, "version")))


async def plot_type_list(request):
    return JSONResponse(_read_model().plot_types(request.path_params["run_id"]))


async def plot_image(request):
    rm = _read_model()
    try:
        png = rm.plot_png(request.path_params["run_id"], request.path_params["plot_type"])
    except plot_adapter.PlotUnavailable as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    return Response(content=png, media_type="image/png")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _results_data(rm: ReadModel, run_id: str) -> dict:
    """view_results with the run's plan resolved (so constraints run too)."""
    return rm.view_results(run_id, plan=rm.plan_for_run(run_id))


# ---------------------------------------------------------------------------
# Shell + server-rendered view fragments
# ---------------------------------------------------------------------------


async def shell(request):
    rm = _read_model()
    plan_id = request.query_params.get("plan_id") or None
    run_id = request.query_params.get("run_id") or None
    ctx = {
        "plans": rm.list_plans(),
        "plan_id": plan_id,
        "run_id": run_id,
        "runs": rm.list_runs(plan_id) if plan_id else [],
        "machine": rm.machine(),
        "state": rm.get_state(plan_id) if plan_id else None,
        "state_labels": state_machine.STATE_LABELS,
    }
    return templates.TemplateResponse(request, "shell.html", ctx)


async def view_state_strip(request):
    rm = _read_model()
    plan_id = request.path_params["plan_id"]
    return templates.TemplateResponse(request, "_state_strip.html", {
        "machine": rm.machine(),
        "state": rm.get_state(plan_id),
        "state_labels": state_machine.STATE_LABELS,
    })


async def view_requirements(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_requirements.html", {
        "data": rm.view_requirements(request.path_params["plan_id"])})


async def view_plan(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_plan.html", {
        "data": rm.view_plan(request.path_params["plan_id"])})


async def view_plan_diff(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_plan_diff.html", {
        "data": rm.view_plan_diff(request.path_params["plan_id"])})


async def view_study(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_study.html", {
        "data": rm.view_study(request.path_params["study_id"])})


async def view_reasoning(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_reasoning.html", {
        "data": rm.view_reasoning(
            request.path_params["plan_id"], request.query_params.get("focus"))})


async def view_report(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_report.html", {
        "data": rm.view_report(request.path_params["plan_id"])})


async def view_results(request):
    rm = _read_model()
    return templates.TemplateResponse(request, "_results.html", {
        "data": _results_data(rm, request.path_params["run_id"])})


async def view_visualization(request):
    rm = _read_model()
    run_id = request.path_params["run_id"]
    types = [t for t in rm.plot_types(run_id) if t not in _OPT_PLOT_TYPES]
    return templates.TemplateResponse(request, "_plot_gallery.html", {
        "title": "Visualization", "subtitle": "domain plots (planform, lift, mesh, stress)",
        "run_id": run_id, "plot_types": types})


async def view_plots(request):
    rm = _read_model()
    run_id = request.path_params["run_id"]
    types = [t for t in rm.plot_types(run_id) if t in _OPT_PLOT_TYPES]
    return templates.TemplateResponse(request, "_plot_gallery.html", {
        "title": "Optimization / comparison plots",
        "subtitle": "objective convergence, DV evolution, before / after",
        "run_id": run_id, "plot_types": types})


routes = [
    # shell
    Route("/", shell),
    # server-rendered view fragments (htmx)
    Route("/view/state-strip/{plan_id}", view_state_strip),
    Route("/view/requirements/{plan_id}", view_requirements),
    Route("/view/plan/{plan_id}", view_plan),
    Route("/view/plan-diff/{plan_id}", view_plan_diff),
    Route("/view/study/{study_id}", view_study),
    Route("/view/reasoning/{plan_id}", view_reasoning),
    Route("/view/report/{plan_id}", view_report),
    Route("/view/results/{run_id}", view_results),
    Route("/view/visualization/{run_id}", view_visualization),
    Route("/view/plots/{run_id}", view_plots),
    # JSON API
    Route("/api/machine", machine),
    Route("/api/state/{plan_id}", state),
    Route("/api/requirements/{plan_id}", requirements),
    Route("/api/plan/{plan_id}", plan),
    Route("/api/plan-diff/{plan_id}", plan_diff),
    Route("/api/study/{study_id}", study),
    Route("/api/results/{run_id}", results),
    Route("/api/reasoning/{plan_id}", reasoning),
    Route("/api/report/{plan_id}", report),
    Route("/api/plots/{run_id}", plot_type_list),
    Route("/api/plots/{run_id}/{plot_type}", plot_image),
    # static assets
    Mount("/static", StaticFiles(directory=str(_HERE / "static")), name="static"),
]

app = Starlette(routes=routes)
