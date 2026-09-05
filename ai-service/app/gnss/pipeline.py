"""GNSS/CORS CRS-transformation pipeline (Phase 6).

    source CRS + points  ->  validated pyproj transform  ->  target CRS points

This is the ONLY processing step Phase 6 delegates to Python — everything
else (parsing, field validation, outlier detection, parcel association,
boundary verification) is deterministic JS in the Node backend. Never
fabricates a transformed coordinate: a point that fails to transform comes
back as `null` with the failure counted in `notes`, never silently dropped or
guessed.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .config import settings
from .crs import transform_points

pipeline_stages = [
    "Point batch input",
    "Source/target CRS parsing",
    "pyproj Transformer construction",
    "Per-point transformation",
    "Transformation status + notes",
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def run_transform(points: list[dict], source_crs: str | None, target_crs: str | None = "EPSG:4326") -> dict:
    started = _now()
    target_crs = target_crs or "EPSG:4326"

    if not source_crs:
        return {
            "status": "UNKNOWN",
            "transformApplied": False,
            "sourceCRS": source_crs,
            "targetCRS": target_crs,
            "points": [],
            "note": "No source CRS supplied — transformation was not attempted (never guessed).",
            "disclaimer": settings.disclaimer,
            "generatedAt": started,
        }

    if len(points) > settings.max_points_per_request:
        return {
            "status": "TRANSFORMATION_UNAVAILABLE",
            "transformApplied": False,
            "sourceCRS": source_crs,
            "targetCRS": target_crs,
            "points": [],
            "note": f"Batch of {len(points)} points exceeds the {settings.max_points_per_request}-point limit per request.",
            "disclaimer": settings.disclaimer,
            "generatedAt": started,
        }

    pairs = [(p.get("x"), p.get("y")) for p in points]
    status, transformed, note = transform_points(pairs, source_crs, target_crs)

    out_points = []
    for i, t in enumerate(transformed):
        out_points.append({
            "index": i,
            "x": t[0] if t else None,
            "y": t[1] if t else None,
            "transformStatus": "OK" if t else "FAILED",
        })

    return {
        "status": status,
        "transformApplied": status == "REPROJECTED",
        "sourceCRS": source_crs,
        "targetCRS": target_crs,
        "points": out_points,
        "note": note,
        "disclaimer": settings.disclaimer,
        "generatedAt": started,
    }
