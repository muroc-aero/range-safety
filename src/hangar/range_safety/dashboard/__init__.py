"""State-machine analysis dashboard for range-safety.

A read-time projection over the hangar provenance / plan / run-result
stores that presents an engineering analysis task as a five-state machine
(gather requirements, planning, executing, verifying, concluding) with the
required feedback loops. The backend is pure Python and API-first; see the
design docs under ``docs/`` (DESIGN_state_machine, DESIGN_views,
DESIGN_data_contract).

Phase 1 surface:
- ``state_machine`` -- the states, transitions, feedback edges, and
  current-state inference from recorded data.
- ``plan_diff`` -- element-level diff between two plan versions (deeper
  than omd's shallow ``provenance_diff``).
- ``read_model`` -- read-only access returning plain JSON-able dicts, one
  method per view plus the state projection.
"""

from __future__ import annotations

from hangar.range_safety.dashboard import plan_diff, state_machine
from hangar.range_safety.dashboard.read_model import ReadModel

__all__ = ["ReadModel", "plan_diff", "state_machine"]
