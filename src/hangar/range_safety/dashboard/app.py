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

import logging
import os
from pathlib import Path

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from hangar.range_safety.dashboard import plot_adapter, state_machine
from hangar.range_safety.dashboard.sources import MultiSource

logger = logging.getLogger(__name__)

_HERE = Path(__file__).parent
templates = Jinja2Templates(directory=str(_HERE / "templates"))


def _read_model(request: Request | None = None) -> MultiSource:
    # Aggregates the omd + sdk + studyfs sources; dispatches by {source}:{id}
    # key. Scoped to the authenticated viewer (set by the OIDC wrapper on
    # request.state); empty user / no-auth mode sees everything.
    user = getattr(request.state, "viewer_user", "") if request else ""
    is_admin = getattr(request.state, "viewer_is_admin", False) if request else False
    return MultiSource(viewer_user=user, viewer_is_admin=is_admin)


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
    return JSONResponse(await _query(lambda: _read_model(request).machine()))


def _filter_studies(studies: list[dict], src: str, query: str) -> list[dict]:
    """Source + case-insensitive substring filter (mirrors the shell selector)."""
    if src in ("omd", "sdk", "studyfs"):
        studies = [s for s in studies if s.get("source") == src]
    if query:
        ql = query.lower()
        studies = [s for s in studies
                   if ql in (s.get("study_id") or "").lower()
                   or ql in (s.get("label") or "").lower()]
    return studies


async def studies(request):
    """Study list for the SPA landing grid (newest-first, viewer-scoped)."""
    src = request.query_params.get("src") or "all"
    query = (request.query_params.get("q") or "").strip()

    def _run():
        return _filter_studies(_read_model(request).list_studies(), src, query)

    return JSONResponse(await _query(_run))


async def runs(request):
    """Run records for a study key (newest-first), for the SPA run selector."""
    study_key = request.path_params["study_key"]
    return JSONResponse(await _query(lambda: _read_model(request).list_runs(study_key)))


async def state(request):
    plan_id = request.path_params["plan_id"]
    return JSONResponse(await _query(lambda: _read_model(request).get_state(plan_id)))


async def requirements(request):
    plan_id = request.path_params["plan_id"]
    version = _int_param(request, "version")
    return JSONResponse(await _query(
        lambda: _read_model(request).view_requirements(plan_id, version)))


async def plan(request):
    plan_id = request.path_params["plan_id"]
    version = _int_param(request, "version")
    return JSONResponse(await _query(
        lambda: _read_model(request).view_plan(plan_id, version)))


async def plan_diff(request):
    plan_id = request.path_params["plan_id"]
    version_a = _int_param(request, "version_a")
    version_b = _int_param(request, "version_b")
    return JSONResponse(await _query(
        lambda: _read_model(request).view_plan_diff(plan_id, version_a, version_b)))


async def study(request):
    study_id = request.path_params["study_id"]
    return JSONResponse(await _query(lambda: _read_model(request).view_study(study_id)))


async def results(request):
    run_id = request.path_params["run_id"]
    return JSONResponse(await _query(lambda: _read_model(request).view_results(run_id)))


async def reasoning(request):
    plan_id = request.path_params["plan_id"]
    focus = request.query_params.get("focus")
    return JSONResponse(await _query(
        lambda: _read_model(request).view_reasoning(plan_id, focus)))


async def report(request):
    plan_id = request.path_params["plan_id"]
    version = _int_param(request, "version")
    return JSONResponse(await _query(
        lambda: _read_model(request).view_report(plan_id, version)))


async def plot_type_list(request):
    run_id = request.path_params["run_id"]
    return JSONResponse(await _query(lambda: _read_model(request).plot_types(run_id)))


async def plot_image(request):
    run_id = request.path_params["run_id"]
    plot_type = request.path_params["plot_type"]
    try:
        png = await _query(lambda: _read_model(request).plot_png(run_id, plot_type))
    except plot_adapter.PlotUnavailable as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    return Response(content=png, media_type="image/png")


async def study_plot_type_list(request):
    study_id = request.path_params["study_id"]
    return JSONResponse(await _query(
        lambda: _read_model(request).study_plot_types(study_id)))


async def study_plot_image(request):
    study_id = request.path_params["study_id"]
    plot_type = request.path_params["plot_type"]
    style = request.query_params.get("style") or "paper"
    try:
        png = await _query(
            lambda: _read_model(request).study_plot_png(study_id, plot_type, style))
    except plot_adapter.PlotUnavailable as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    return Response(content=png, media_type="image/png")


# ---------------------------------------------------------------------------
# Shell + server-rendered view fragments
# ---------------------------------------------------------------------------


def _shell_ctx(request, plan_id, run_id, src, query) -> dict:
    """Gather the shell template context (sync; runs in the threadpool)."""
    rm = _read_model(request)

    # Selector list: newest-first (sorted in list_studies), filtered by source
    # and a case-insensitive substring on the id / label.
    all_studies = rm.list_studies()
    studies = all_studies
    if src in ("omd", "sdk", "studyfs"):
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


_SPA_DIR = _HERE / "static" / "spa"
_SPA_INDEX = _SPA_DIR / "index.html"


def _spa_built() -> bool:
    return _SPA_INDEX.exists()


async def spa_index(request):
    """Serve the built React SPA shell.

    Falls back to the legacy server-rendered htmx shell when the SPA has not
    been built (a source checkout without ``frontend`` built), so the
    dashboard still works pre-build and in tests. The SPA does its own routing
    and data fetching against the ``/api/*`` endpoints; assets resolve under
    the ``/static/spa/`` mount (Vite ``base``).
    """
    if _spa_built():
        return FileResponse(_SPA_INDEX)
    return await shell(request)


async def spa_catchall(request):
    """History-API fallback: client-side routes (``/study/...``,
    ``/provenance/...``, ``/servers``) return the SPA shell so a deep link or
    refresh lands on the app, not a 404. Real routes (API/static/health/auth)
    are registered earlier and win; an unmatched ``/api`` or ``/view`` path is
    a genuine miss, so return JSON 404 rather than masking it with the shell."""
    path = request.path_params.get("spa_path", "")
    if path.startswith(("api/", "view/", "static/")):
        return JSONResponse({"error": "not found"}, status_code=404)
    return await spa_index(request)


async def shell(request):
    # ``study`` is a back-compat alias for ``plan_id`` (older omd tool results
    # and external links emitted ``?study=studyfs:<id>``).
    plan_id = (request.query_params.get("plan_id")
               or request.query_params.get("study") or None)
    run_id = request.query_params.get("run_id") or None
    src = request.query_params.get("src") or "all"
    query = (request.query_params.get("q") or "").strip()
    ctx = await run_in_threadpool(_shell_ctx, request, plan_id, run_id, src, query)
    return templates.TemplateResponse(request, "shell.html", ctx)


def _state_strip_ctx(request, plan_id, run_id) -> dict:
    rm = _read_model(request)
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
    ctx = await run_in_threadpool(_state_strip_ctx, request, plan_id, run_id)
    return templates.TemplateResponse(request, "_state_strip.html", ctx)


async def view_requirements(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model(request).view_requirements(plan_id))
    return templates.TemplateResponse(request, "_requirements.html", {"data": data})


async def view_plan(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model(request).view_plan(plan_id))
    return templates.TemplateResponse(request, "_plan.html", {"data": data})


async def view_plan_diff(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model(request).view_plan_diff(plan_id))
    return templates.TemplateResponse(request, "_plan_diff.html", {"data": data})


async def view_study(request):
    study_id = request.path_params["study_id"]
    data = await _query(lambda: _read_model(request).view_study(study_id))
    return templates.TemplateResponse(request, "_study.html", {"data": data})


async def view_reasoning(request):
    plan_id = request.path_params["plan_id"]
    focus = request.query_params.get("focus")
    data = await _query(lambda: _read_model(request).view_reasoning(plan_id, focus))
    return templates.TemplateResponse(request, "_reasoning.html", {"data": data})


async def view_report(request):
    plan_id = request.path_params["plan_id"]
    data = await _query(lambda: _read_model(request).view_report(plan_id))
    return templates.TemplateResponse(request, "_report.html", {"data": data})


async def view_results(request):
    run_id = request.path_params["run_id"]
    data = await _query(lambda: _read_model(request).view_results(run_id))
    return templates.TemplateResponse(request, "_results.html", {"data": data})


async def view_plots(request):
    # One gallery listing every plot type the owning source offers for the
    # run (omd factory plots from the recorder, or sdk ArtifactStore plots).
    # Splitting "visualization" vs "optimization" plots was tool-specific;
    # the source decides what is available.
    run_id = request.path_params["run_id"]
    plot_types = await _query(lambda: _read_model(request).plot_types(run_id))
    return templates.TemplateResponse(request, "_plot_gallery.html", {
        "title": "Plots & visualization",
        "subtitle": "domain and optimization plots rendered for this run",
        "run_id": run_id, "plot_types": plot_types})


# Back-compat alias; the nav now has a single Plots entry.
view_visualization = view_plots


async def healthz(request):
    return JSONResponse({"status": "ok"})


async def _on_not_authorized(request: Request, exc: Exception) -> Response:
    """A study the viewer does not own (or a missing study) -> 403."""
    return JSONResponse({"error": "not authorized for this study"},
                        status_code=403)


def _content_routes() -> list[tuple[str, str, object]]:
    """(path, name, endpoint) for every authenticated content route.

    Static assets and the auth/health endpoints are added separately and
    are NOT wrapped by the OIDC decorator.
    """
    return [
        # shell -- SPA when built, legacy htmx shell otherwise
        ("/", "shell", spa_index),
        # server-rendered view fragments (htmx)
        ("/view/state-strip/{plan_id}", "view_state_strip", view_state_strip),
        ("/view/requirements/{plan_id}", "view_requirements", view_requirements),
        ("/view/plan/{plan_id}", "view_plan", view_plan),
        ("/view/plan-diff/{plan_id}", "view_plan_diff", view_plan_diff),
        ("/view/study/{study_id}", "view_study", view_study),
        ("/view/reasoning/{plan_id}", "view_reasoning", view_reasoning),
        ("/view/report/{plan_id}", "view_report", view_report),
        ("/view/results/{run_id}", "view_results", view_results),
        ("/view/visualization/{run_id}", "view_visualization", view_visualization),
        ("/view/plots/{run_id}", "view_plots", view_plots),
        # JSON API
        ("/api/machine", "machine", machine),
        ("/api/studies", "studies", studies),
        ("/api/runs/{study_key}", "runs", runs),
        ("/api/state/{plan_id}", "state", state),
        ("/api/requirements/{plan_id}", "requirements", requirements),
        ("/api/plan/{plan_id}", "plan", plan),
        ("/api/plan-diff/{plan_id}", "plan_diff", plan_diff),
        ("/api/study/{study_id}", "study", study),
        ("/api/results/{run_id}", "results", results),
        ("/api/reasoning/{plan_id}", "reasoning", reasoning),
        ("/api/report/{plan_id}", "report", report),
        ("/api/plots/{run_id}", "plot_type_list", plot_type_list),
        ("/api/plots/{run_id}/{plot_type}", "plot_image", plot_image),
        ("/api/study-plots/{study_id}", "study_plot_type_list", study_plot_type_list),
        ("/api/study-plots/{study_id}/{plot_type}", "study_plot_image", study_plot_image),
    ]


def build_app() -> tuple[Starlette, str]:
    """Assemble the dashboard app, with OIDC login when configured.

    Returns ``(app, auth_mode)`` where auth_mode is ``"oidc"`` or ``""``.
    Mirrors the unified viewer (``hangar.viewer.server.build_app``): the
    same ``hangar.sdk.viz.viewer_auth`` browser-OIDC session flow protects
    every content route, so the dashboard reuses the ``hangar-viewer``
    Keycloak client and the ``HANGAR_VIEWER_*`` env. Without OIDC config it
    runs open (local dev), and ``MultiSource`` sees an empty viewer -> all
    studies visible.
    """
    from hangar.sdk.viz.viewer_auth import build_viewer_oidc_config, require_viewer_oidc
    from hangar.sdk.viz.viewer_routes import _build_oidc_routes

    static = Mount("/static", StaticFiles(directory=str(_HERE / "static")),
                   name="static")
    exception_handlers = {PermissionError: _on_not_authorized}

    oidc_config = build_viewer_oidc_config()
    if oidc_config is not None:
        from starlette.middleware.sessions import SessionMiddleware

        decorator = require_viewer_oidc(oidc_config)
        routes = [Route(p, decorator(h), name=n) for p, n, h in _content_routes()]
        routes += _build_oidc_routes(oidc_config)
        routes += [Route("/healthz", healthz), static]
        # SPA history-API fallback, registered LAST so /api, /static, /healthz
        # and the OIDC routes win. Auth-wrapped like the other content routes.
        routes += [Route("/{spa_path:path}", decorator(spa_catchall),
                         name="spa_catchall")]

        resource_server_url = os.environ.get(
            "RESOURCE_SERVER_URL", "http://localhost:7655").rstrip("/")

        # The dashboard is started by the uvicorn CLI (no custom main()), so
        # OIDC discovery -- which populates config.authorization_endpoint /
        # token_endpoint from Keycloak's well-known doc -- must run inside the
        # ASGI lifespan. Without it login_redirect emits a host-relative
        # authorize URL and the browser loops on the dashboard itself. Use a
        # lifespan context manager rather than on_startup= (dropped in newer
        # Starlette).
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _lifespan(_app):
            from hangar.sdk.viz.viewer_auth import discover_oidc_endpoints
            await discover_oidc_endpoints(oidc_config)
            yield

        app = Starlette(
            routes=routes,
            exception_handlers=exception_handlers,
            lifespan=_lifespan,
            middleware=[
                Middleware(
                    SessionMiddleware,
                    secret_key=oidc_config.session_secret,
                    session_cookie="hangar_dashboard_session",
                    same_site="lax",
                    https_only=resource_server_url.startswith("https"),
                    max_age=86400,
                ),
            ],
        )
        app.state.oidc_config = oidc_config
        return app, "oidc"

    # No auth (local dev): every study visible, no login.
    logger.warning(
        "Range-safety dashboard running without authentication. Set "
        "HANGAR_VIEWER_OIDC_CLIENT_SECRET (+ HANGAR_VIEWER_OIDC_CLIENT_ID, "
        "HANGAR_VIEWER_SESSION_SECRET) for per-user access control.")
    routes = [Route(p, h, name=n) for p, n, h in _content_routes()]
    routes += [Route("/healthz", healthz), static]
    routes += [Route("/{spa_path:path}", spa_catchall, name="spa_catchall")]
    return Starlette(routes=routes, exception_handlers=exception_handlers), ""


app, _AUTH_MODE = build_app()
