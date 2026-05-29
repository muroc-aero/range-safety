"""Thin adapter over the hangar plot-rendering entry point.

The dashboard renders run visualizations (planform, lift, convergence,
etc.) as PNGs. That rendering lives in the-hangar and is being relocated
by the viewer-split work, so this adapter is the single place that
re-points when the split lands:

- Target (post-split): ``hangar.viewer.embedded.generate_plot_png`` plus
  the open registry ``hangar.sdk.viz.plot_registry``.
- On current main: the equivalent under ``hangar.sdk.viz``.

A backend is resolved lazily from a prioritized candidate list and the
adapter degrades gracefully: ``plot_types`` returns ``[]`` and
``plot_png`` raises :class:`PlotUnavailable` when nothing is importable,
so the rest of the dashboard works without plotting wired up. That wiring
is finalized in Phase 2 (the visualization view).
"""

from __future__ import annotations

import importlib
from typing import Callable

# (module, attribute) candidates, most-preferred first. Extend/re-point
# here when the viewer split lands; nothing else in the dashboard changes.
_PNG_TARGETS: tuple[tuple[str, str], ...] = (
    ("hangar.viewer.embedded", "generate_plot_png"),
    ("hangar.sdk.viz.viewer_server", "generate_plot_png"),
    ("hangar.sdk.viz.embedded", "generate_plot_png"),
)
_TYPES_TARGETS: tuple[tuple[str, str], ...] = (
    ("hangar.sdk.viz.plot_registry", "plot_types_for_run"),
    ("hangar.sdk.viz.plot_registry", "list_plot_types"),
)


class PlotUnavailable(RuntimeError):
    """Raised when no plot-rendering backend is importable."""


def _resolve(targets: tuple[tuple[str, str], ...]) -> Callable | None:
    for module_name, attr in targets:
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            continue
        fn = getattr(module, attr, None)
        if callable(fn):
            return fn
    return None


def plot_png(run_id: str, plot_type: str) -> bytes:
    """Render a plot to PNG bytes via the resolved backend.

    Raises:
        PlotUnavailable: if no backend can be imported (not yet wired).
    """
    fn = _resolve(_PNG_TARGETS)
    if fn is None:
        raise PlotUnavailable(
            "No plot-rendering backend importable. Plot rendering is wired "
            "in Phase 2 (visualization view) / after the viewer split."
        )
    return fn(run_id, plot_type)


def plot_types(run_id: str) -> list[str]:
    """Return available plot types for a run, or [] if not resolvable."""
    fn = _resolve(_TYPES_TARGETS)
    if fn is None:
        return []
    try:
        return list(fn(run_id))
    except Exception:
        return []
