"""Load plan versions from the omd plan store, without importing omd.

omd writes assembled plan versions to ``{OMD_DATA_ROOT}/plans/{plan_id}/
v{N}.yaml`` (configurable via ``OMD_PLAN_STORE`` / ``OMD_DATA_ROOT``). The
dashboard reads them directly as YAML so the read path stays free of an
OpenMDAO import. The store directory is resolved from the environment, or
injected explicitly by the read model for tests and deployment.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

_VERSION_RE = re.compile(r"^v(\d+)\.ya?ml$")


def default_plan_store() -> Path:
    """Resolve the plan store directory from the environment.

    Mirrors ``hangar.omd.db.plan_store_dir`` without importing omd:
    ``OMD_PLAN_STORE`` if set, else ``{OMD_DATA_ROOT}/plans`` (default
    ``hangar_data/omd/plans``).
    """
    env = os.environ.get("OMD_PLAN_STORE")
    if env:
        return Path(env)
    root = os.environ.get("OMD_DATA_ROOT", "hangar_data/omd")
    return Path(root) / "plans"


def list_plans(plan_store: Path) -> list[str]:
    """Return the sorted plan ids that have at least one stored version.

    A plan id is a subdirectory of the store containing a ``vN.yaml``.
    """
    store = Path(plan_store)
    if not store.is_dir():
        return []
    plans = [
        entry.name
        for entry in store.iterdir()
        if entry.is_dir() and list_versions(store, entry.name)
    ]
    return sorted(plans)


def list_versions(plan_store: Path, plan_id: str) -> list[int]:
    """Return the sorted list of version numbers stored for a plan."""
    plan_dir = Path(plan_store) / plan_id
    if not plan_dir.is_dir():
        return []
    versions = []
    for entry in plan_dir.iterdir():
        match = _VERSION_RE.match(entry.name)
        if match:
            versions.append(int(match.group(1)))
    return sorted(versions)


def latest_version(plan_store: Path, plan_id: str) -> int | None:
    """Return the highest stored version number, or None if none exist."""
    versions = list_versions(plan_store, plan_id)
    return versions[-1] if versions else None


def load_plan(plan_store: Path, plan_id: str, version: int | None = None) -> dict | None:
    """Load a plan version as a dict.

    Args:
        plan_store: Plan store directory.
        plan_id: Plan identifier.
        version: Specific version, or None for the latest.

    Returns:
        The parsed plan dict, or None if the requested version is absent.
    """
    if version is None:
        version = latest_version(plan_store, plan_id)
        if version is None:
            return None
    plan_dir = Path(plan_store) / plan_id
    for name in (f"v{version}.yaml", f"v{version}.yml"):
        path = plan_dir / name
        if path.is_file():
            with open(path) as handle:
                loaded = yaml.safe_load(handle)
            return loaded if isinstance(loaded, dict) else None
    return None
