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

Handlers are ``async`` (Starlette runs them on the event loop), but the
read model and matplotlib rendering are synchronous and can be slow, so
every read-model call runs in the threadpool via ``run_in_threadpool`` —
one slow plot render must not block every other dashboard request
(head-of-line) when several viewers share one instance.
"""

from __future__ import annotations

from pathlib import Path

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from hangar.range_safety.dashboard import plot_adapter, state_machine
from hangar.range_safety.dashboard.sources import MultiSource

_HERE = Path(__file__).parent
templates = Jinja2Templates(directory=str(_HERE / "templates"))


def _read_model() -> MultiSource:
    # Aggregates the omd + sdk sources; dispatches by {source}:{id} key.
    return MultiSource()


async def _query(fn):
    """Run a sync read-model closure in the threadpool.

    ``_read_model()`` construction is included in the closure so any I/O it
    does also stays off the event loop.
    """
    return await run_in_threadpool(fn)


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
    return JSONResponse(await _query(lambda: _read_model().machine()))


async def state(request):
    plan_id = request.path_params["plan_id"]
    return JSONResponse(await _query(lambda: _read_model().get_state(plan_id)))


async def requirements(request):
    plan_id = request.path_params["plan_id"]
    version = _int_param(request, "version")
    return JSONResponse(await _query(
        lambda: _read_model().view_requirements(plan_id, version)))


async def plan(request):
    plan_id = request.path_params["plan_id"]
    version = _int_param(request, "version")
    return JSONResponse(await _query(
        lambda: _read_model().view_plan(plan_id, version)))


async def plan_diff(request):
    plan_id = request.path_params["plan_id"]
    version_a = _int_param(request, "version_a")
    version_b = _int_param(request, "version_b")
    return JSONResponse(await _query(
        lambda: _read_model().view_plan_diff(plan_id, version_a, version_b)))


async def study(request):
    study_id = request.path_params["study_id"]
    return JSONResponse(await _query(lambda: _read_model().view_study(study_id)))


async def results(request):
    run_id = request.path_params["run_id"]
    return JSONResponse(await _query(lambda: _read_model().view_results(run_id)))


async def reasoning(request):
    plan_id = request.path_params["plan_id"]
    focus = request.query_params.get("focus")
    return JSONResponse(await _query(
        lambda: _read_model().view_reasoning(plan_id, focus)))


async def report(request):
    plan_id = request.path_params["plan_id"]
    version = _int_param(request, "version")
    return JSONResponse(await _query(
        lambda: _read_model().view_report(plan_id, version)))


async def plot_type_list(request):
    run_id = request.path_params["run_id"]
    return JSONResponse(await _query(lambda: _read_model().plot_types(run_id)))


async def plot_image(request):
    run_id = request.path_params["run_id"]
    plot_type = request.path_params["plot_type"]
    try:
        png = await _query(lambda: _read_model().plot_png(run_id, plot_type))
    except plot_adapter.PlotUnavailable as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    return Response(content=png, media_type="image/png")


# ---------------------------------------------------------------------------
# Shell + server-rendered view fragments
# ---------------------------------------------------------------------------


def _shell_ctx(plan_id, run_id, src, query) -> dict:
    """Gather the shell template context (sync; runs in the threadpool)."""
    rm = _read_model()

    # Selector list: newest-first (sorted in list_studies), filtered by source
    # and a case-insensitive substring on the id / label.
    all_studies = rm.list_studies()
    studies = all_studies
    if src in ("omd", "sdk"):
        studies = [s for s in studies if s.get("source") == src]
    if query:
        ql = query.lower()
        studies = [s for s in studies
                   if ql in (s.get("study_id") or "").lower()
                   or ql in (s.get("label") or "").lower()]

    runs = rm.list_runs(plan_id) if plan_id else []
    # Default to the study's latest run so the run-scoped views (results,
    # plots) and the strip's executing link are reachable without a manual
    # pick. The selector still lets you change it.
    if plan_id and not run_id and runs:
        run_id = runs[0]["run_id"]
    return {
        "studies": studies,
        "studies_total": len(all_studies),
        "studies_shown": len(studies),
        "src": src,
        "q": query,
        "plan_id": plan_id,
        "run_id": run_id,
        "runs": runs,
        "machine": rm.machine(),
        "state": rm.get_state(plan_id) if plan_id else None,
        "state_labels": state_machine.STATE_LABELS,
    }


async def shell(request):
    plan_id = request.query_params.get("plan_id") or None
    run_id = request.query_params.get("run_id") or None
    src = request.query_params.get("src") or "all"
    query = (request.query_params.get("q") or "").strip()
    ctx = await run_in_threadpool(_shell_ctx, plan_id, run_id, src, query)
    return templates.TemplateResponse(request, "shell.html", ctx)


def _state_strip_ctx(plan_id, run_id) -> dict:
    rm = _read_model()
    if not run_id:
        runs = rm.list_runs(plan_id)
        run_id = runs[0]["run_id"] if runs else None
    return {
        "machine": rm.machine(),
        "state": rm.get_state(plan_id),
        "state_labels": state_machine.STATE_LABELS,
        "plan_id": plan_id,
        "run_id": run_id,
    }


async def view_state_strip(request):
    plan_id = request.path_params["plan_id"]
    run_id = request.query_params.get("run_id") or None
    ctx = await run_in_threadpool(_state_strip_ctx, plan_id, run_id)
    return templates.TemplateResponse(request, "_state_strip.html", ctx)


async def view_requirements(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model().view_requirements(plan_id))
    return templates.TemplateResponse(request, "_requirements.html", {"data": data})


async def view_plan(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model().view_plan(plan_id))
    return templates.TemplateResponse(request, "_plan.html", {"data": data})


async def view_plan_diff(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model().view_plan_diff(plan_id))
    return templates.TemplateResponse(request, "_plan_diff.html", {"data": data})


async def view_study(request):
    study_id = request.path_params["study_id"]
    data = await _query(lambda: _read_model().view_study(study_id))
    return templates.TemplateResponse(request, "_study.html", {"data": data})


async def view_reasoning(request):
    plan_id = request.path_params["plan_id"]
    focus = request.query_params.get("focus")
    data = await _query(lambda: _read_model().view_reasoning(plan_id, focus))
    return templates.TemplateResponse(request, "_reasoning.html", {"data": data})


async def view_report(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model().view_report(plan_id))
    return templates.TemplateResponse(request, "_report.html", {"data": data})


async def view_results(request):
    run_id = request.path_params["run_id"]
    data = await _query(lambda: _read_model().view_results(run_id))
    return templates.TemplateResponse(request, "_results.html", {"data": data})


async def view_plots(request):
    # One gallery listing every plot type the owning source offers for the
    # run (omd factory plots from the recorder, or sdk ArtifactStore plots).
    # Splitting "visualization" vs "optimization" plots was tool-specific;
    # the source decides what is available.
    run_id = request.path_params["run_id"]
    plot_types = await _query(lambda: _read_model().plot_types(run_id))
    return templates.TemplateResponse(request, "_plot_gallery.html", {
        "title": "Plots & visualization",
        "subtitle": "domain and optimization plots rendered for this run",
        "run_id": run_id, "plot_types": plot_types})


# Back-compat alias; the nav now has a single Plots entry.
view_visualization = view_plots


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
