"""GNSS/CORS high-precision spatial control (Phase 6, additive).

Python's only role in this phase is coordinate reference system (CRS)
transformation via `pyproj` — the one genuine capability gap in the Node
backend (which does everything else: parsing, validation, outlier detection,
parcel association, boundary verification — deterministic JS, same pattern as
`backend/src/services/geometry3d/validate.js`). If this service is
unreachable, the Node layer reports `TRANSFORMATION_UNAVAILABLE` and degrades
gracefully — it never guesses a CRS or fabricates a transformed coordinate.
"""
from .config import settings
from .pipeline import pipeline_stages, run_transform

__all__ = ["settings", "pipeline_stages", "run_transform"]
