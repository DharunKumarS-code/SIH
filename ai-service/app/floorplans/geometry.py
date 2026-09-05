"""Shared vector-geometry helpers for the floor-plan pipeline (Phase 4).

Mask -> contour -> shapely polygon -> simplify -> repair, plus IoU. Mirrors the
repair contract of ``app/buildings/polygonize.py`` (never silently drop a
polygon; an unrepairable one keeps status ``ERROR``).
"""
from __future__ import annotations

import numpy as np
from shapely.geometry import Polygon
from shapely.validation import make_valid
from skimage import measure

from .config import settings


def repair(poly: Polygon):
    """Return (geom_or_None, status, issues)."""
    issues: list[str] = []
    if poly is None or poly.is_empty:
        return None, "ERROR", ["empty polygon"]
    if poly.is_valid:
        if poly.area <= 0:
            return None, "ERROR", ["degenerate (zero-area) polygon"]
        return poly, "VALID", issues
    issues.append("invalid geometry (self-intersection?)")
    fixed = poly.buffer(0)
    if fixed.is_valid and not fixed.is_empty and fixed.geom_type == "Polygon":
        return fixed, "WARNING", issues + ["repaired with buffer(0)"]
    mv = make_valid(poly)
    cands = []
    if mv.geom_type == "Polygon":
        cands = [mv]
    elif mv.geom_type in ("MultiPolygon", "GeometryCollection"):
        cands = [g for g in mv.geoms if g.geom_type == "Polygon"]
    if cands:
        best = max(cands, key=lambda g: g.area)
        if best.is_valid and best.area > 0:
            return best, "WARNING", issues + ["repaired with make_valid (largest part kept)"]
    return None, "ERROR", issues + ["could not be safely repaired"]


def mask_to_polygon(mask: np.ndarray, simplify_px: float | None = None):
    """Largest-contour polygon of a boolean blob in FULL-image pixel coords.

    ``mask`` is a full-image boolean array for ONE connected component.
    Returns (geom_or_None, status, issues, pixel_ring).
    """
    if not mask.any():
        return None, "ERROR", ["empty mask"], []
    ys, xs = np.where(mask)
    minr, minc, maxr, maxc = ys.min(), xs.min(), ys.max() + 1, xs.max() + 1
    sub = np.pad(mask[minr:maxr, minc:maxc].astype(np.float32), 1)
    contours = measure.find_contours(sub, 0.5)
    if not contours:
        return None, "ERROR", ["no contour"], []
    contour = max(contours, key=len)
    xy = [(c[1] - 1 + minc, c[0] - 1 + minr) for c in contour]
    if len(xy) < 4:
        return None, "ERROR", ["contour too short"], xy
    poly = Polygon(xy)
    tol = settings.simplify_tolerance_px if simplify_px is None else simplify_px
    if tol and tol > 0:
        poly = poly.simplify(tol, preserve_topology=True)
    geom, status, issues = repair(poly)
    ring = list(geom.exterior.coords) if geom else xy
    return geom, status, issues, [[round(x, 2), round(y, 2)] for x, y in ring]


def iou(a: Polygon, b: Polygon) -> float:
    if a is None or b is None or a.is_empty or b.is_empty:
        return 0.0
    try:
        inter = a.intersection(b).area
        union = a.area + b.area - inter
        return inter / union if union > 0 else 0.0
    except Exception:
        return 0.0


def min_rect_dims(poly: Polygon):
    """(short_side, long_side) of the minimum rotated rectangle, in px."""
    if poly is None or poly.is_empty:
        return 0.0, 0.0
    try:
        mr = poly.minimum_rotated_rectangle
        pts = list(mr.exterior.coords)[:4]
        if len(pts) < 4:
            return 0.0, 0.0
        e1 = np.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        e2 = np.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        return float(min(e1, e2)), float(max(e1, e2))
    except Exception:
        return 0.0, 0.0


def rectangularity(poly: Polygon) -> float:
    """area / bounding-rect area in [0,1] — 1.0 for a perfect rectangle."""
    s, l = min_rect_dims(poly)
    denom = s * l
    if denom <= 0:
        return 0.0
    return float(min(1.0, poly.area / denom))
