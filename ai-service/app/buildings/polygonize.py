"""Binary mask -> vector building polygons.

connected components -> contour extraction -> shapely polygon -> simplify ->
geometry repair. Per-component confidence = mean probability inside the blob.
"""
from __future__ import annotations

import numpy as np
from shapely.geometry import Polygon
from shapely.validation import make_valid
from skimage import measure

from .config import settings


def _repair(poly: Polygon):
    """Return (geom_or_None, status, issues)."""
    issues: list[str] = []
    if poly.is_empty:
        return None, "ERROR", ["empty polygon"]
    if poly.is_valid:
        if poly.area <= 0:
            return None, "ERROR", ["degenerate (zero-area) polygon"]
        return poly, "VALID", issues
    # invalid (e.g. self-intersecting) — note: shapely reports area 0 for a
    # bow-tie, so do NOT reject on area before attempting a repair.
    issues.append("invalid geometry (self-intersection?)")
    fixed = poly.buffer(0)
    if fixed.is_valid and not fixed.is_empty and fixed.geom_type == "Polygon":
        return fixed, "WARNING", issues + ["repaired with buffer(0)"]
    mv = make_valid(poly)
    # pick the largest polygonal component
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


def mask_to_polygons(prob: np.ndarray):
    """prob: float [0,1] map. Returns list of dicts with pixel-space geometry."""
    thr = settings.building_confidence_threshold
    binary = prob >= thr
    labels = measure.label(binary, connectivity=2)
    out = []
    for region in measure.regionprops(labels):
        if region.area < settings.min_building_area_px:
            continue
        # contour of this component (row, col); pad so find_contours closes it
        minr, minc, maxr, maxc = region.bbox
        sub = (labels[minr:maxr, minc:maxc] == region.label).astype(np.float32)
        sub = np.pad(sub, 1)
        contours = measure.find_contours(sub, 0.5)
        if not contours:
            continue
        contour = max(contours, key=len)
        # (row, col) -> (x, y) in full-image pixel coords
        xy = [(c[1] - 1 + minc, c[0] - 1 + minr) for c in contour]
        if len(xy) < 4:
            continue
        poly = Polygon(xy)
        if settings.simplify_tolerance_px > 0:
            poly = poly.simplify(settings.simplify_tolerance_px, preserve_topology=True)
        geom, status, issues = _repair(poly)
        conf = float(np.clip(prob[region.coords[:, 0], region.coords[:, 1]].mean(), 0, 1))
        out.append(
            {
                "pixel_polygon": list(geom.exterior.coords) if geom else list(poly.exterior.coords),
                "geom": geom,          # shapely (pixel space) or None
                "confidence": round(conf, 3),
                "area_px": float(region.area),
                "geometry_status": status,
                "geometry_issues": issues,
                "bbox_px": [int(minc), int(minr), int(maxc), int(maxr)],
            }
        )
    return out
