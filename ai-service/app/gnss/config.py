"""Configurable thresholds for the GNSS/CORS CRS-transformation endpoint.

Same convention as app/elevation/config.py — every knob is environment-variable
overridable, nothing is hard-coded through the codebase.
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
    max_points_per_request: int = _i("GNSS_MAX_TRANSFORM_POINTS", 20_000)

    disclaimer: str = (
        "GNSS/CORS DEMO / MODEL OUTPUT. Coordinate transformation is a "
        "deterministic pyproj CRS conversion only — it does not verify, "
        "certify or improve survey accuracy. Reported accuracy is only ever "
        "the value supplied with the dataset; it is never inferred from the "
        "coordinate transform. Not official, survey-certified or "
        "government-authoritative data."
    )


settings = Settings()

TRANSFORM_STATUS = ("MATCHED", "REPROJECTED", "MISMATCH", "UNKNOWN", "TRANSFORMATION_UNAVAILABLE")
