"""CRS parsing + point transformation for GNSS/CORS control points.

Mirrors app/elevation/crs.py's honesty rules: a CRS is only ever taken from
what the caller explicitly supplied, never guessed. `pyproj` is optional at
import time (same pattern as elevation) — if unavailable, every transform
reports TRANSFORMATION_UNAVAILABLE rather than crashing the service.
"""
from __future__ import annotations

try:
    from pyproj import CRS, Transformer

    _HAS_PYPROJ = True
except Exception:  # pragma: no cover
    _HAS_PYPROJ = False


def normalise_crs(crs_like):
    if not crs_like or not _HAS_PYPROJ:
        return None
    try:
        return CRS.from_user_input(crs_like)
    except Exception:
        return None


def is_geographic(crs_like) -> bool | None:
    """True/False if determinable, None if the CRS could not be parsed."""
    crs = normalise_crs(crs_like)
    if crs is None:
        return None
    return bool(crs.is_geographic)


def transform_points(points: list[tuple[float, float]], source_crs: str, target_crs: str = "EPSG:4326"):
    """Transform a batch of (x, y) pairs from source_crs -> target_crs.

    Returns (status, transformed, note):
      status: MATCHED (already the target CRS) | REPROJECTED | MISMATCH |
              UNKNOWN | TRANSFORMATION_UNAVAILABLE
      transformed: list of (x, y) in target_crs, or None per-point on failure
      note: human-readable explanation, never a fabricated success message.
    """
    if not _HAS_PYPROJ:
        return "TRANSFORMATION_UNAVAILABLE", [None] * len(points), "pyproj is not installed on the ai-service — cannot transform. Coordinates were not altered."

    src = normalise_crs(source_crs)
    tgt = normalise_crs(target_crs)
    if src is None or tgt is None:
        return "UNKNOWN", [None] * len(points), "Source or target CRS could not be parsed — transformation was not attempted."

    if src.equals(tgt):
        return "MATCHED", list(points), f"Source and target CRS already match ({tgt.to_string()}) — no transform needed."

    try:
        transformer = Transformer.from_crs(src, tgt, always_xy=True)
        out = []
        for x, y in points:
            try:
                tx, ty = transformer.transform(x, y)
                if tx is None or ty is None or not (tx == tx) or not (ty == ty):  # NaN check
                    out.append(None)
                else:
                    out.append((tx, ty))
            except Exception:
                out.append(None)
        failed = sum(1 for p in out if p is None)
        note = f"Reprojected {src.to_string()} -> {tgt.to_string()}."
        if failed:
            note += f" {failed} of {len(points)} point(s) failed to transform."
        return "REPROJECTED", out, note
    except Exception as e:
        return "MISMATCH", [None] * len(points), f"CRS transform pipeline could not be constructed ({src.to_string()} -> {tgt.to_string()}): {e}"
