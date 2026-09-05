"""Wall detection (Phase 4).

Input : a stitched per-pixel WALL probability map [0,1].
Output: a cleaned boolean wall mask + wall-region polygons + centreline
        segments (from a morphological skeleton).

Handles thick/thin/internal/external walls and small gaps WITHOUT over-merging
unrelated walls: closing is limited to ``wall_close_px`` and objects shorter
than ``wall_min_length_px`` are dropped. Wall geometry is validated (in
``validation.py``) before rooms are inferred from it.
"""
from __future__ import annotations

import numpy as np
from skimage.measure import label, regionprops
from skimage.morphology import (
    binary_closing,
    binary_opening,
    disk,
    remove_small_objects,
    skeletonize,
)

from .config import settings
from .geometry import mask_to_polygon


def wall_mask(prob: np.ndarray) -> np.ndarray:
    thr = settings.wall_dark_threshold
    m = prob >= thr
    m = binary_opening(m, disk(1))
    if settings.wall_close_px > 0:
        m = binary_closing(m, disk(settings.wall_close_px))
    m = remove_small_objects(m, min_size=max(8, settings.wall_min_length_px))
    return m


def _centreline_segments(mask: np.ndarray, max_segments: int = 4000):
    """Skeletonise the wall mask and emit poly-line segments (pixel coords)."""
    try:
        skel = skeletonize(mask)
    except Exception:
        return []
    ys, xs = np.where(skel)
    if len(xs) == 0:
        return []
    # cheap segmentation: connected skeleton fragments -> bounding poly-lines
    lbl = label(skel, connectivity=2)
    segs = []
    for r in regionprops(lbl):
        if r.area < max(4, settings.wall_min_length_px // 2):
            continue
        coords = r.coords  # (row, col)
        # endpoints ~ the two mutually-farthest points (diameter of the fragment)
        pr, pc = coords[:, 0], coords[:, 1]
        i0 = int(np.argmin(pr + pc))
        i1 = int(np.argmax(pr + pc))
        segs.append([[int(pc[i0]), int(pr[i0])], [int(pc[i1]), int(pr[i1])]])
        if len(segs) >= max_segments:
            break
    return segs


def detect_walls(prob: np.ndarray):
    """Return (mask, wall_features, centreline_segments)."""
    mask = wall_mask(prob)
    features = []
    if mask.any():
        lbl = label(mask, connectivity=2)
        for idx, r in enumerate(regionprops(lbl), start=1):
            if r.area < settings.wall_min_length_px:
                continue
            blob = lbl == r.label
            geom, status, issues, ring = mask_to_polygon(blob, simplify_px=1.0)
            minr, minc, maxr, maxc = r.bbox
            conf = float(np.clip(prob[r.coords[:, 0], r.coords[:, 1]].mean(), 0, 1))
            features.append(
                {
                    "featureId": f"FP-WL-{idx:06d}",
                    "class": "WALL",
                    "pixelPolygon": ring,
                    "geom": geom,
                    "areaPx": float(r.area),
                    "confidence": round(conf, 3),
                    "geometryStatus": status,
                    "geometryIssues": issues,
                    "bboxPx": [int(minc), int(minr), int(maxc), int(maxr)],
                }
            )
    return mask, features, _centreline_segments(mask)
