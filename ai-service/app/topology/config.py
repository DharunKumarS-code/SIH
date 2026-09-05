"""Configurable thresholds for the deterministic 2D polygon geometry engine
(Phase 7). Every knob is environment-variable overridable — same convention as
app/gnss/config.py and app/elevation/config.py: nothing here is a hidden
magic number.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    max_polygons_per_request: int = _i("TOPOLOGY_MAX_POLYGONS", 5_000)
    max_pairs_per_request: int = _i("TOPOLOGY_MAX_PAIRS", 20_000)

    # Chennai sits entirely inside UTM zone 44N — the same projected CRS
    # already exercised by the Phase 6 GNSS/CORS transform tests. Polygon
    # validity/area/overlap are only ever meaningful on planar (metre)
    # coordinates, never directly on WGS84 degrees.
    projected_crs: str = os.environ.get("TOPOLOGY_PROJECTED_CRS", "EPSG:32644")

    disclaimer: str = (
        "RULE_ENGINE / DETERMINISTIC_VALIDATION output. Polygon validity, "
        "self-intersection, area and overlap are computed with shapely on "
        "planar (UTM-projected) coordinates — plain computational geometry, "
        "not AI/ML. This is a geometry check only: it never modifies stored "
        "geometry and is not a legal cadastral survey."
    )


settings = Settings()
