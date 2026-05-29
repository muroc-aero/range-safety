"""Starlette app exposing the dashboard read model.

Phase 1 ships the JSON/HTTP API: one endpoint per view plus the state
projection, each a thin wrapper over a ``ReadModel`` method. This is the
API-first contract from DESIGN_views.md. Server-rendered htmx fragments
and Cytoscape graph views are Phase 2; they attach as additional handlers
over the same read-model methods, so adding them does not change this
surface.

Run locally::

    uvicorn hangar.range_safety.dashboard.app:app --reload

The app reads ``OMD_DB_PATH`` / ``OMD_PLAN_STORE`` from the environment
(same as the rest of omd); a ``ReadModel`` is built per request.
"""

from __future__ import annotations

from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from hangar.range_safety.dashboard import plot_adapter
from hangar.range_safety.dashboard.read_model import ReadModel


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


async def results(request):
    return JSONResponse(_read_model().view_results(request.path_params["run_id"]))


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


routes = [
    Route("/api/machine", machine),
    Route("/api/state/{plan_id}", state),
    Route("/api/requirements/{plan_id}", requirements),
    Route("/api/plan/{plan_id}", plan),
    Route("/api/plan-diff/{plan_id}", plan_diff),
    Route("/api/results/{run_id}", results),
    Route("/api/reasoning/{plan_id}", reasoning),
    Route("/api/report/{plan_id}", report),
    Route("/api/plots/{run_id}", plot_type_list),
    Route("/api/plots/{run_id}/{plot_type}", plot_image),
]

app = Starlette(routes=routes)
