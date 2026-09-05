"""Room detection (Phase 4).

Wall mask -> interior free space (walls removed, the exterior region discarded)
-> connected components -> room polygons. Room TYPE is a documented heuristic
(size rank + shape); when a model with real room classes is wired in
(``FLOORPLAN_MODEL=semseg``) its labels replace the heuristic via classmap.

Room-type confidence from the classical path is capped
(``classical_type_conf_cap``) so heuristic labels are honestly flagged for
human review — the pipeline never fabricates a confident room label.
"""
from __future__ import annotations

import numpy as np
from skimage.measure import label, regionprops
from skimage.morphology import binary_dilation, disk
from skimage.segmentation import clear_border

from .config import settings
from .geometry import mask_to_polygon, min_rect_dims, rectangularity


def _interior_space(wmask: np.ndarray):
    """Free space fully enclosed by walls (exterior discarded).

    Doorway gaps are SEALED (wall dilation by ``room_seal_px``) before component
    labelling so rooms joined only by a door become distinct; extent is then
    recovered per-room by dilating the sealed blob back into the true free space.
    Returns (labels, free_space) where ``labels`` are the sealed room cores.
    """
    free = ~wmask
    sealed_walls = binary_dilation(wmask, disk(settings.room_seal_px))
    sealed_free = clear_border(~sealed_walls)
    labels = label(sealed_free, connectivity=1)
    return labels, free


def _heuristic_type(area_px: float, short_side: float, long_side: float,
                    rank: int, n_rooms: int) -> tuple[str, float]:
    """(APP class, type-confidence). Deterministic, deliberately conservative."""
    aspect = (long_side / short_side) if short_side > 0 else 1.0
    if short_side <= settings.corridor_max_width_px and aspect >= settings.corridor_min_aspect:
        return "CORRIDOR", 0.45
    if n_rooms <= 1:
        return "ROOM", 0.30
    # size-rank bands: smallest -> wet rooms, largest -> living
    frac = rank / max(1, n_rooms - 1)
    if frac <= 0.15:
        return "BATHROOM", 0.40
    if frac <= 0.35:
        return "KITCHEN", 0.38
    if frac >= 0.85:
        return "LIVING_ROOM", 0.42
    return "BEDROOM", 0.35


def detect_rooms(wmask: np.ndarray, prob: np.ndarray, scale_m_per_px: float | None):
    """Return list of room feature dicts (pixel-space geometry)."""
    lbl, free = _interior_space(wmask)
    if lbl.max() == 0:
        return []

    regs = [r for r in regionprops(lbl) if r.area >= settings.tiny_polygon_area_px]
    regs.sort(key=lambda r: r.area)
    kept = [r for r in regs if r.area >= max(1, settings.room_min_area_px // 3)]
    n = len(kept)

    rooms = []
    wall_edge = binary_dilation(wmask, disk(1))
    seal = disk(settings.room_seal_px + 1)
    for rank, r in enumerate(kept):
        core = lbl == r.label
        # recover true room extent: grow the sealed core back into open free space
        blob = binary_dilation(core, seal) & free
        if blob.sum() < settings.room_min_area_px:
            continue
        geom, gstatus, gissues, ring = mask_to_polygon(blob)
        if geom is None and not ring:
            continue
        ys, xs = np.where(blob)
        area_px = float(blob.sum())
        minr, minc, maxr, maxc = int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1
        short_side, long_side = min_rect_dims(geom) if geom is not None else (0.0, 0.0)
        rtype, tconf = _heuristic_type(area_px, short_side, long_side, rank, n)
        tconf = min(tconf, settings.classical_type_conf_cap)

        # geometric confidence: enclosed by walls + reasonably rectangular
        border = binary_dilation(blob, disk(1)) & ~blob
        enclosed = float((border & wall_edge).sum()) / max(1, int(border.sum()))
        rect = rectangularity(geom) if geom is not None else 0.0
        geo_conf = float(np.clip(0.35 + 0.4 * enclosed + 0.25 * rect, 0, 1))

        if scale_m_per_px:
            area_val = round(area_px * scale_m_per_px * scale_m_per_px, 2)
            area_unit, area_status = "M2", "SCALED"
        else:
            area_val = round(area_px, 1)
            area_unit, area_status = "PIXEL_SQUARED", "SCALE_UNAVAILABLE"

        review = (
            tconf < settings.conf_med
            or geo_conf < settings.conf_med
            or gstatus != "VALID"
            or (scale_m_per_px is not None and area_val < settings.room_min_area_m2)
        )
        rooms.append(
            {
                "featureId": f"FP-RM-{rank + 1:06d}",
                "class": rtype,
                "roomType": rtype,
                "pixelPolygon": ring,
                "geom": geom,
                "areaPx": round(area_px, 1),
                "area": area_val,
                "areaUnit": area_unit,
                "areaStatus": area_status,
                "confidence": round(min(geo_conf, 0.4 + tconf), 3),
                "typeConfidence": round(tconf, 3),
                "geometryConfidence": round(geo_conf, 3),
                "geometryStatus": gstatus,
                "geometryIssues": gissues,
                "bboxPx": [int(minc), int(minr), int(maxc), int(maxr)],
                "reviewRequired": bool(review),
            }
        )
    return rooms
